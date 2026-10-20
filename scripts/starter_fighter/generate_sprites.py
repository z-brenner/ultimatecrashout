#!/usr/bin/env python3
"""Generate the original "Buckle" starter fighter sprite strips.

Buckle is an original crash-test brawler drawn procedurally from a small
skeleton, so every pixel is reproducible from this file. The output is one
horizontal PNG strip per animation slot in fighters/buckle/sprites/, which
`npm run fighter:build -- buckle` turns into runtime atlases.

Requires Python 3.9+ and Pillow:  python3 scripts/starter_fighter/generate_sprites.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FRAME = 160
SCALE = 4  # supersampling factor for anti-aliased edges
GROUND = 154
OUT = Path(__file__).resolve().parents[2] / "fighters" / "buckle" / "sprites"

INK = (22, 22, 28, 255)
SUIT = (246, 196, 26, 255)
SUIT_BACK = (196, 150, 14, 255)
GLOVE = (255, 84, 60, 255)
GLOVE_BACK = (200, 58, 44, 255)
VISOR = (40, 52, 70, 255)
VISOR_SHINE = (140, 220, 255, 255)
SMEAR = (255, 255, 255, 120)

TORSO = 34
HEAD_R = 15
UPPER_ARM = 19
LOWER_ARM = 19
UPPER_LEG = 22
LOWER_LEG = 22

# Joint angles are in degrees measured from straight down; positive values
# rotate toward the facing direction (+x). Lower segments are relative bends.
BASE = dict(
    torso=6, head=0,
    uaf=-20, laf=95, uab=15, lab=80,
    ulf=14, llf=-12, ulb=-12, llb=-8,
    dx=0.0, dy=0.0, rot=0.0, ground=True,
)


def pose(**changes: float) -> dict:
    result = dict(BASE)
    result.update(changes)
    return result


def lerp_pose(a: dict, b: dict, t: float) -> dict:
    eased = 0.5 - 0.5 * math.cos(math.pi * t)
    out = {}
    for key, value in a.items():
        if isinstance(value, bool):
            out[key] = a[key] if t < 0.5 else b[key]
        else:
            out[key] = value + (b[key] - value) * eased
    return out


def timeline(keys: list[dict], frames: int, loop: bool = False) -> list[dict]:
    """Spread keyframes evenly over `frames` frames."""
    if len(keys) == 1:
        return [dict(keys[0]) for _ in range(frames)]
    sequence = keys + [keys[0]] if loop else keys
    spans = len(sequence) - 1
    result = []
    for frame in range(frames):
        position = (frame / frames if loop else frame / max(1, frames - 1)) * spans
        index = min(spans - 1, int(position))
        result.append(lerp_pose(sequence[index], sequence[index + 1], position - index))
    return result


def vector(angle: float, length: float) -> tuple[float, float]:
    radians = math.radians(angle)
    return math.sin(radians) * length, math.cos(radians) * length


def skeleton(p: dict) -> dict[str, tuple[float, float]]:
    hip = (0.0, 0.0)
    tx, ty = vector(180 - p["torso"], TORSO)  # torso points up; + leans forward
    chest = (hip[0] + tx, hip[1] + ty)
    shoulder = (hip[0] + tx * 0.86, hip[1] + ty * 0.86)
    hx, hy = vector(180 - p["torso"] - p["head"], HEAD_R + 4)
    head = (chest[0] + hx, chest[1] + hy)

    def limb(origin, upper, bend, upper_len, lower_len):
        ux, uy = vector(upper, upper_len)
        mid = (origin[0] + ux, origin[1] + uy)
        lx, ly = vector(upper + bend, lower_len)
        return mid, (mid[0] + lx, mid[1] + ly)

    elbow_f, hand_f = limb(shoulder, p["uaf"], p["laf"], UPPER_ARM, LOWER_ARM)
    elbow_b, hand_b = limb(shoulder, p["uab"], p["lab"], UPPER_ARM, LOWER_ARM)
    knee_f, foot_f = limb(hip, p["ulf"], p["llf"], UPPER_LEG, LOWER_LEG)
    knee_b, foot_b = limb(hip, p["ulb"], p["llb"], UPPER_LEG, LOWER_LEG)
    joints = dict(
        hip=hip, chest=chest, shoulder=shoulder, head=head,
        elbow_f=elbow_f, hand_f=hand_f, elbow_b=elbow_b, hand_b=hand_b,
        knee_f=knee_f, foot_f=foot_f, knee_b=knee_b, foot_b=foot_b,
    )
    if p["rot"]:
        pivot = ((hip[0] + chest[0]) / 2, (hip[1] + chest[1]) / 2)
        radians = math.radians(p["rot"])
        cos, sin = math.cos(radians), math.sin(radians)
        joints = {
            name: (
                pivot[0] + (x - pivot[0]) * cos - (y - pivot[1]) * sin,
                pivot[1] + (x - pivot[0]) * sin + (y - pivot[1]) * cos,
            )
            for name, (x, y) in joints.items()
        }
    # Place the figure in the frame: grounded poses stand on GROUND, airborne
    # poses keep their lowest point slightly above it.
    lowest = max(y for name, (x, y) in joints.items()) + 5
    if not p["ground"]:
        lowest = max(lowest, min(y for _, y in joints.values()) + 112)
    offset_x = FRAME / 2 + p["dx"]
    offset_y = GROUND - lowest + p["dy"]
    # Keep every limb (plus outline) inside the cell; clipping reads worse
    # than a pose that sits a little off the floor line.
    margin = HEAD_R + 4
    xs = [x + offset_x for x, _ in joints.values()]
    ys = [y + offset_y for _, y in joints.values()]
    offset_x += max(0.0, margin - min(xs)) - max(0.0, max(xs) - (FRAME - margin))
    offset_y += max(0.0, margin - min(ys)) - max(0.0, max(ys) - (FRAME - 6))
    return {name: (x + offset_x, y + offset_y) for name, (x, y) in joints.items()}


def draw_frame(p: dict, trail: list[tuple[float, float]] | None = None) -> Image.Image:
    image = Image.new("RGBA", (FRAME * SCALE, FRAME * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    j = skeleton(p)
    s = lambda point: (point[0] * SCALE, point[1] * SCALE)  # noqa: E731

    def capsule(a, b, width, color):
        draw.line([s(a), s(b)], fill=color, width=int(width * SCALE))
        for point in (a, b):
            r = width * SCALE / 2
            x, y = s(point)
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

    def outlined(a, b, width, color):
        capsule(a, b, width + 4, INK)
        capsule(a, b, width, color)

    def dot(point, radius, color, outline=True):
        x, y = s(point)
        if outline:
            r = (radius + 2) * SCALE
            draw.ellipse([x - r, y - r, x + r, y + r], fill=INK)
        r = radius * SCALE
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

    if trail and len(trail) >= 2:
        draw.line([s(point) for point in trail], fill=SMEAR, width=10 * SCALE, joint="curve")

    # Back limbs first so the near side reads in front.
    outlined(j["hip"], j["knee_b"], 11, SUIT_BACK)
    outlined(j["knee_b"], j["foot_b"], 10, SUIT_BACK)
    dot(j["foot_b"], 6.5, GLOVE_BACK)
    outlined(j["shoulder"], j["elbow_b"], 10, SUIT_BACK)
    outlined(j["elbow_b"], j["hand_b"], 9, SUIT_BACK)
    dot(j["hand_b"], 6.5, GLOVE_BACK)

    # Torso with the crash-test seam.
    outlined(j["hip"], j["chest"], 24, SUIT)
    mid = ((j["hip"][0] + j["chest"][0]) / 2, (j["hip"][1] + j["chest"][1]) / 2)
    capsule(j["hip"], mid, 3, INK)
    dot(mid, 4.5, INK, outline=False)
    dot(mid, 2.5, SUIT, outline=False)

    # Head: quartered target marker plus a visor facing forward.
    hx, hy = s(j["head"])
    r = (HEAD_R + 2) * SCALE
    draw.ellipse([hx - r, hy - r, hx + r, hy + r], fill=INK)
    r = HEAD_R * SCALE
    box = [hx - r, hy - r, hx + r, hy + r]
    tilt = p["torso"] + p["head"] + p["rot"]
    draw.pieslice(box, -90 + tilt, 0 + tilt, fill=SUIT)
    draw.pieslice(box, 0 + tilt, 90 + tilt, fill=INK)
    draw.pieslice(box, 90 + tilt, 180 + tilt, fill=SUIT)
    draw.pieslice(box, 180 + tilt, 270 + tilt, fill=INK)
    vx, vy = vector(90 + tilt * -1 + 0, HEAD_R * 0.55)
    visor = (j["head"][0] + vx, j["head"][1] - 1 + vy * 0.2)
    dot(visor, 5.2, VISOR)
    dot((visor[0] + 1.6, visor[1] - 1.6), 1.6, VISOR_SHINE, outline=False)

    outlined(j["hip"], j["knee_f"], 12, SUIT)
    outlined(j["knee_f"], j["foot_f"], 11, SUIT)
    dot(j["foot_f"], 7, GLOVE)
    outlined(j["shoulder"], j["elbow_f"], 11, SUIT)
    outlined(j["elbow_f"], j["hand_f"], 10, SUIT)
    dot(j["hand_f"], 7.5, GLOVE)

    return image.resize((FRAME, FRAME), Image.Resampling.LANCZOS)


def strip(poses: list[dict], striker: str | None = None, active: range | None = None) -> Image.Image:
    sheet = Image.new("RGBA", (FRAME * len(poses), FRAME), (0, 0, 0, 0))
    history: list[tuple[float, float]] = []
    for index, p in enumerate(poses):
        trail = None
        if striker:
            history.append(skeleton(p)[striker])
            if active is not None and index in active:
                trail = history[-3:]
        sheet.alpha_composite(draw_frame(p, trail), (index * FRAME, 0))
    return sheet


GUARD = pose()
CROUCH = pose(torso=28, uaf=40, laf=80, uab=30, lab=80, ulf=75, llf=-130, ulb=40, llb=-120)
AIR = pose(ground=False, uaf=-60, laf=60, uab=-40, lab=60, ulf=40, llf=-70, ulb=10, llb=-50)
TUCK = pose(ground=False, torso=25, uaf=60, laf=90, uab=50, lab=90, ulf=100, llf=-150, ulb=85, llb=-140)
SPLAY = pose(ground=False, torso=-10, uaf=-120, laf=10, uab=130, lab=10, ulf=40, llf=0, ulb=-40, llb=0)


def walk_cycle(frames: int, stride: float, lean: float, arm: float, bounce: float) -> list[dict]:
    result = []
    for i in range(frames):
        phase = 2 * math.pi * i / frames
        swing = math.sin(phase)
        result.append(pose(
            torso=lean,
            ulf=swing * stride, llf=-15 - max(0.0, -swing) * stride * 1.6,
            ulb=-swing * stride, llb=-15 - max(0.0, swing) * stride * 1.6,
            uaf=-swing * arm, laf=70, uab=swing * arm, lab=70,
            dy=-abs(math.cos(phase)) * bounce,
        ))
    return result


def spin(base: dict, frames: int, turns: float = 1.0, direction: float = 1.0) -> list[dict]:
    return [dict(base, rot=direction * 360 * turns * i / frames) for i in range(frames)]


def build() -> dict[str, tuple[Image.Image, int]]:
    """Return {slot: (strip, fps)}."""
    a: dict[str, tuple[list[dict], dict]] = {}

    def add(slot, poses, fps=12, striker=None, active=None):
        a[slot] = (poses, dict(fps=fps, striker=striker, active=active))

    add("idle", [pose(dy=1.5 * math.sin(2 * math.pi * i / 6), uaf=-20 + 4 * math.sin(2 * math.pi * i / 6)) for i in range(6)], 8)
    add("crouch", timeline([GUARD, CROUCH], 4), 12)
    add("walk", walk_cycle(8, 26, 6, 22, 1.5), 10)
    add("turn", timeline([GUARD, pose(torso=0, uaf=20, laf=40, uab=-20, lab=40), GUARD], 3), 12)
    add("dash", timeline([pose(torso=20, ulf=50, llf=-40, ulb=-40, llb=-30, uaf=-50, uab=50),
                          pose(torso=34, ulf=60, llf=-60, ulb=-55, llb=-20, uaf=-70, uab=70)], 5), 14)
    add("run", walk_cycle(8, 44, 22, 55, 3), 14)
    add("jump_squat", timeline([GUARD, CROUCH], 3), 15)
    add("jump", timeline([pose(ground=False, uaf=-150, laf=20, uab=-120, lab=30, ulf=30, llf=-40, ulb=-5, llb=-20), AIR], 4), 10)
    add("double_jump", spin(TUCK, 6), 15)
    add("fall", [dict(AIR, uaf=-60 - 12 * math.sin(i), uab=-40 + 12 * math.sin(i)) for i in range(4)], 8)
    add("fast_fall", timeline([pose(ground=False, torso=0, uaf=-170, laf=0, uab=-165, lab=0, ulf=5, llf=0, ulb=-5, llb=0)], 3), 10)

    add("jab", timeline([GUARD, pose(torso=14, uaf=95, laf=0, uab=10, lab=90), pose(torso=12, uaf=85, laf=0, uab=20, lab=90), GUARD], 5), 14, "hand_f", range(1, 3))
    add("dash_attack", timeline([pose(torso=30, ulf=40, llf=-40, ulb=-50, llb=-30),
                                 pose(torso=55, uaf=120, laf=0, uab=100, lab=0, ulf=70, llf=-30, ulb=-60, llb=-10, dx=6),
                                 pose(torso=50, uaf=110, laf=0, uab=95, lab=0, ulf=60, llf=-40, ulb=-50, llb=-20, dx=8),
                                 CROUCH], 6), 14, "hand_f", range(1, 4))
    add("forward_tilt", timeline([GUARD, pose(torso=-14, ulf=95, llf=0, ulb=-8, llb=-6, uaf=-40, uab=40),
                                  pose(torso=-18, ulf=100, llf=-4, ulb=-10, llb=-6, uaf=-50, uab=50), GUARD], 6), 14, "foot_f", range(1, 4))
    add("up_tilt", timeline([CROUCH, pose(torso=0, uaf=120, laf=40, ulf=10, ulb=-10),
                             pose(torso=-8, uaf=175, laf=10, ulf=5, ulb=-15), GUARD], 6), 14, "hand_f", range(1, 4))
    add("down_tilt", timeline([CROUCH, dict(CROUCH, ulf=100, llf=-10, torso=10), dict(CROUCH, ulf=105, llf=-5, torso=8), CROUCH], 5), 14, "foot_f", range(1, 4))
    add("forward_smash", timeline([GUARD, pose(torso=-22, uaf=-130, laf=20, uab=-150, lab=20, ulf=20, ulb=-30),
                                   pose(torso=-24, uaf=-150, laf=10, uab=-160, lab=10, ulf=22, ulb=-32),
                                   pose(torso=40, uaf=100, laf=0, uab=95, lab=0, ulf=55, llf=-40, ulb=-35, llb=-10, dx=6),
                                   pose(torso=42, uaf=95, laf=0, uab=92, lab=0, ulf=55, llf=-40, ulb=-35, llb=-10, dx=6), GUARD], 8), 12, "hand_f", range(4, 7))
    add("up_smash", timeline([GUARD, CROUCH, dict(CROUCH, torso=34),
                              pose(torso=-6, uaf=178, laf=0, uab=170, lab=0, ulf=5, llf=0, ulb=-5, llb=0, dy=-8),
                              pose(torso=-10, uaf=175, laf=5, uab=168, lab=5, ulf=5, llf=0, ulb=-5, llb=0, dy=-6), GUARD], 8), 12, "hand_f", range(4, 7))
    add("down_smash", timeline([GUARD, CROUCH, pose(torso=10, ulf=95, llf=-5, ulb=-95, llb=5, uaf=-90, uab=90, laf=0, lab=0),
                                pose(torso=8, ulf=100, llf=0, ulb=-100, llb=0, uaf=-95, uab=95, laf=0, lab=0), CROUCH], 8), 12, "foot_f", range(3, 6))
    add("neutral_air", spin(SPLAY, 6, 0.5), 14, "hand_f", range(1, 5))
    add("forward_air", timeline([dict(AIR, uaf=-170, laf=10, uab=-160, lab=10, torso=-10),
                                 dict(AIR, uaf=60, laf=0, uab=50, lab=0, torso=30),
                                 dict(AIR, uaf=30, laf=10, uab=25, lab=10, torso=28), AIR], 6), 14, "hand_f", range(1, 4))
    add("back_air", timeline([TUCK, dict(AIR, torso=20, ulb=-105, llb=0, ulf=60, llf=-90),
                              dict(AIR, torso=22, ulb=-110, llb=0, ulf=60, llf=-90), AIR], 5), 14, "foot_b", range(1, 4))
    add("up_air", timeline([TUCK, dict(AIR, torso=-25, ulf=170, llf=0, ulb=20, llb=-40, rot=-20),
                            dict(AIR, torso=-30, ulf=200, llf=0, ulb=25, llb=-40, rot=-35), AIR], 6), 14, "foot_f", range(1, 4))
    add("down_air", timeline([TUCK, dict(AIR, torso=0, ulf=5, llf=0, ulb=-5, llb=0, uaf=-160, uab=-150, laf=0, lab=0),
                              dict(AIR, torso=0, ulf=0, llf=0, ulb=0, llb=0, uaf=-170, uab=-165, laf=0, lab=0), AIR], 6), 14, "foot_f", range(1, 4))

    add("neutral_special", timeline([GUARD, pose(torso=-15, uaf=-120, laf=60), pose(torso=24, uaf=95, laf=0, ulf=40, llf=-20),
                                     pose(torso=22, uaf=90, laf=5, ulf=40, llf=-20), GUARD], 7), 12, "hand_f", range(2, 5))
    add("side_special", timeline([CROUCH, pose(ground=False, torso=82, uaf=96, laf=0, uab=90, lab=0, ulf=-84, llf=0, ulb=-92, llb=0),
                                  pose(ground=False, torso=86, uaf=98, laf=0, uab=92, lab=0, ulf=-88, llf=0, ulb=-96, llb=0), CROUCH], 6), 14, "hand_f", range(1, 5))
    add("up_special", [dict(pose(ground=False, torso=-4, uaf=170, laf=10, uab=150, lab=30, ulf=10, llf=-20, ulb=-20, llb=-30), rot=-60 * i) for i in range(6)], 14, "hand_f", range(0, 6))
    add("down_special", timeline([GUARD, dict(CROUCH, uaf=120, laf=110, uab=110, lab=120),
                                  dict(CROUCH, uaf=125, laf=110, uab=115, lab=120, dy=1), GUARD], 6), 12)

    add("spot_dodge", timeline([GUARD, dict(CROUCH, torso=-20, dx=-4), GUARD], 5), 12)
    add("roll_forward", [dict(TUCK, ground=True, rot=60 * i, dx=-8 + 3 * i) for i in range(6)], 14)
    add("roll_back", [dict(TUCK, ground=True, rot=-60 * i, dx=8 - 3 * i) for i in range(6)], 14)
    add("air_dodge", spin(TUCK, 5, 0.5, -1), 12)
    add("shield", timeline([dict(GUARD, torso=-2, uaf=110, laf=110, uab=100, lab=120, ulf=25, llf=-30, ulb=-20, llb=-20)], 3), 8)

    add("item_hold", [pose(uaf=80, laf=20, dy=1.2 * math.sin(2 * math.pi * i / 4)) for i in range(4)], 8)
    add("item_pickup", timeline([GUARD, dict(CROUCH, uaf=60, laf=10), GUARD], 4), 12)
    add("item_attack", timeline([pose(uaf=-160, laf=20, torso=-10), pose(uaf=95, laf=0, torso=25), pose(uaf=80, laf=0, torso=22), GUARD], 5), 14, "hand_f", range(1, 3))
    add("grab", timeline([GUARD, pose(torso=20, uaf=88, laf=0, uab=82, lab=0, ulf=35, llf=-20), pose(torso=18, uaf=85, laf=10, uab=80, lab=10), GUARD], 6), 14)
    add("grab_hold", [pose(torso=16, uaf=82, laf=20, uab=76, lab=20, dy=math.sin(i) * 1.2) for i in range(4)], 8)
    add("grabbed", [dict(SPLAY, ground=True, torso=-12, uaf=-150 + 15 * math.sin(i * 2), uab=150 - 15 * math.sin(i * 2), ulf=15, ulb=-10) for i in range(4)], 10)
    add("forward_throw", timeline([pose(torso=10, uaf=80, laf=40, uab=70, lab=40), pose(torso=-10, uaf=60, laf=60),
                                   pose(torso=34, uaf=100, laf=0, uab=95, lab=0, ulf=45, llf=-30), GUARD], 6), 12, "hand_f", range(2, 4))
    add("back_throw", timeline([pose(torso=10, uaf=80, laf=40), pose(torso=-30, uaf=-110, laf=10, uab=-100, lab=10, ulb=-40, llb=-20),
                                pose(torso=-34, uaf=-120, laf=5, uab=-115, lab=5, ulb=-45), GUARD], 6), 12, "hand_f", range(1, 4))
    add("up_throw", timeline([CROUCH, pose(torso=-4, uaf=175, laf=0, uab=170, lab=0, dy=-4), pose(torso=-6, uaf=178, laf=0, uab=172, lab=0, dy=-6), GUARD], 6), 12, "hand_f", range(1, 3))
    add("down_throw", timeline([pose(uaf=-170, laf=10, uab=-165, lab=10, torso=-6), dict(CROUCH, uaf=70, laf=0, uab=65, lab=0, torso=40),
                                dict(CROUCH, uaf=65, laf=0, uab=60, lab=0, torso=42), GUARD], 6), 12, "hand_f", range(1, 3))

    add("hurt", timeline([pose(torso=-22, head=-15, uaf=-110, laf=20, uab=120, lab=20, ulf=20, ulb=-25), GUARD], 4), 10)
    add("knockback", spin(dict(SPLAY, torso=-30), 4, 0.25, -1), 10)
    add("downed", [pose(ground=True, torso=-90 + i, head=-6, rot=0, uaf=-120, laf=10, uab=-100, lab=20, ulf=-80, llf=0, ulb=-95, llb=0) for i in range(4)], 6)
    add("ledge", [pose(ground=False, torso=-4, uaf=-178, laf=0, uab=-172, lab=0, ulf=10 + 6 * math.sin(i * 1.6), llf=-20, ulb=-10, llb=-25) for i in range(4)], 8)
    add("entrance", timeline([dict(TUCK, rot=-90), dict(CROUCH, dy=0), GUARD, pose(uaf=-178, laf=0, torso=-4), GUARD], 8), 10)
    add("taunt", [pose(torso=-4, uaf=-120 + 10 * math.sin(i * 0.8), laf=-100, uab=-115 - 10 * math.sin(i * 0.8), lab=100, dy=-2 * abs(math.sin(i * 0.8))) for i in range(8)], 10)
    add("victory", timeline([GUARD, CROUCH, pose(ground=False, uaf=-178, laf=0, uab=40, lab=90, ulf=40, llf=-90, ulb=-10, llb=-60, dy=-10),
                             pose(uaf=-175, laf=0, uab=30, lab=90), pose(uaf=-178, laf=-20, uab=25, lab=90)], 8), 10)

    return {
        slot: (strip(poses, options["striker"], options["active"]), options["fps"])
        for slot, (poses, options) in a.items()
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    strips = build()
    for slot, (image, _fps) in strips.items():
        image.save(OUT / f"{slot}.png", optimize=True)
    print(f"Wrote {len(strips)} sprite strips to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
