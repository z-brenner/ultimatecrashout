#!/usr/bin/env python3
"""Generate the original "Crash Course" stage art (CC0).

Draws a crash-test facility to match the platform geometry in
stages/crash-course/stage.json, then `npm run stage:build -- crash-course`
derives the thumbnail and checksums.

Requires Python 3.9+ and Pillow:  python3 scripts/starter_stage/generate_crash_course.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2] / "stages" / "crash-course"
W, H = 1920, 1080
SS = 2  # supersampling

YELLOW = (246, 196, 26)
INK = (22, 22, 28)
STEEL = (78, 92, 112)
STEEL_DARK = (44, 54, 70)
STEEL_LIGHT = (138, 156, 178)
CORAL = (255, 84, 60)


def load_stage() -> dict:
    return json.loads((ROOT / "stage.json").read_text())


def to_px(stage: dict, x: float, y: float) -> tuple[float, float]:
    art = stage["render"]["art"]
    unit = art["worldUnitsPerPixel"]
    return (art["originPx"]["x"] + x / unit) * SS, (art["originPx"]["y"] - y / unit) * SS


def backdrop() -> Image.Image:
    image = Image.new("RGB", (W * SS, H * SS))
    draw = ImageDraw.Draw(image)
    for row in range(H * SS):
        t = row / (H * SS)
        color = tuple(int(a + (b - a) * t) for a, b in zip((18, 26, 44), (52, 66, 92)))
        draw.line([(0, row), (W * SS, row)], fill=color)
    # Hangar wall: tall panels and windows.
    for index in range(0, 13):
        x0 = index * 160 * SS - 40 * SS
        draw.rectangle([x0, 140 * SS, x0 + 150 * SS, 820 * SS], fill=(30, 40, 58), outline=(40, 52, 74), width=4 * SS)
        draw.rectangle([x0 + 22 * SS, 190 * SS, x0 + 128 * SS, 330 * SS], fill=(66, 104, 140))
        draw.line([x0 + 75 * SS, 190 * SS, x0 + 75 * SS, 330 * SS], fill=(30, 40, 58), width=4 * SS)
    # Overhead light rig.
    draw.rectangle([0, 96 * SS, W * SS, 120 * SS], fill=STEEL_DARK)
    for index in range(7):
        cx = (140 + index * 280) * SS
        draw.polygon([(cx - 30 * SS, 120 * SS), (cx + 30 * SS, 120 * SS), (cx + 150 * SS, 760 * SS), (cx - 150 * SS, 760 * SS)],
                     fill=(60, 74, 98))
        draw.rectangle([cx - 34 * SS, 108 * SS, cx + 34 * SS, 132 * SS], fill=(250, 240, 200))
    # Hazard stripe band and the event banner.
    stripe_y = 820 * SS
    draw.rectangle([0, stripe_y, W * SS, stripe_y + 40 * SS], fill=YELLOW)
    for x in range(-80, W + 80, 80):
        draw.polygon([(x * SS, stripe_y + 40 * SS), ((x + 40) * SS, stripe_y + 40 * SS),
                      ((x + 80) * SS, stripe_y), ((x + 40) * SS, stripe_y)], fill=INK)
    draw.rectangle([0, (stripe_y + 40 * SS), W * SS, H * SS], fill=(26, 32, 44))
    image = image.filter(ImageFilter.GaussianBlur(3 * SS))
    return image


def target_marker(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    draw.ellipse([cx - r - 3 * SS, cy - r - 3 * SS, cx + r + 3 * SS, cy + r + 3 * SS], fill=INK)
    box = [cx - r, cy - r, cx + r, cy + r]
    for start, color in ((-90, YELLOW), (0, INK), (90, YELLOW), (180, INK)):
        draw.pieslice(box, start, start + 90, fill=color)


def draw_platform(draw: ImageDraw.ImageDraw, stage: dict, platform: dict) -> None:
    left, top = to_px(stage, platform["x"] - platform["width"] / 2, platform["y"] + platform["height"] / 2)
    right, bottom = to_px(stage, platform["x"] + platform["width"] / 2, platform["y"] - platform["height"] / 2)
    if platform["kind"] == "ground":
        draw.rectangle([left, top, right, bottom + 400 * SS], fill=STEEL_DARK)
        draw.rectangle([left, top, right, top + 34 * SS], fill=STEEL_LIGHT)
        # Hazard edge on the walkable surface.
        stripe = 22 * SS
        for x in range(int(left), int(right), stripe * 2):
            draw.polygon([(x, top + 34 * SS), (x + stripe, top + 34 * SS), (x + stripe * 2, top + 56 * SS), (x + stripe, top + 56 * SS)],
                         fill=YELLOW)
        draw.rectangle([left, top + 56 * SS, right, top + 62 * SS], fill=INK)
        # Riveted panels and crash markers on the body.
        panel = 180 * SS
        for x in range(int(left) + 30 * SS, int(right) - panel, panel + 20 * SS):
            draw.rectangle([x, top + 90 * SS, x + panel, top + 220 * SS], outline=STEEL, width=5 * SS)
            for rx in (x + 14 * SS, x + panel - 14 * SS):
                for ry in (top + 104 * SS, top + 206 * SS):
                    draw.ellipse([rx - 5 * SS, ry - 5 * SS, rx + 5 * SS, ry + 5 * SS], fill=STEEL_LIGHT)
        target_marker(draw, (left + right) / 2, top + 155 * SS, 46 * SS)
        draw.line([left, top, right, top], fill=(220, 232, 245), width=4 * SS)
    else:
        draw.rectangle([left, top, right, bottom + 10 * SS], fill=INK)
        draw.rectangle([left + 4 * SS, top + 4 * SS, right - 4 * SS, bottom + 4 * SS], fill=YELLOW)
        stripe = 18 * SS
        for x in range(int(left) + 4 * SS, int(right) - 4 * SS, stripe * 2):
            draw.polygon([(x, bottom + 4 * SS), (x + stripe, bottom + 4 * SS), (x + stripe * 2, top + 4 * SS), (x + stripe, top + 4 * SS)],
                         fill=INK)
        draw.line([left, top, right, top], fill=(255, 245, 210), width=4 * SS)
        # Support cables up to the light rig.
        for x in (left + 24 * SS, right - 24 * SS):
            draw.line([x, top, x, 120 * SS], fill=(90, 104, 126), width=3 * SS)


def arena(stage: dict, base: Image.Image) -> Image.Image:
    image = base.copy()
    draw = ImageDraw.Draw(image)
    for platform in stage["gameplay"]["platforms"]:
        if platform["kind"] != "ground":
            draw_platform(draw, stage, platform)
    for platform in stage["gameplay"]["platforms"]:
        if platform["kind"] == "ground":
            draw_platform(draw, stage, platform)
    return image


def main() -> int:
    stage = load_stage()
    assets = ROOT / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    base = backdrop()
    full = arena(stage, base)
    base.resize((W, H), Image.Resampling.LANCZOS).save(assets / "backdrop.webp", lossless=False, quality=86, method=6)
    full_small = full.resize((W, H), Image.Resampling.LANCZOS)
    full_small.save(assets / "arena.webp", lossless=False, quality=88, method=6)
    full_small.convert("RGBA").save(assets / "preview.png", optimize=True)
    print(f"Wrote Crash Course art to {assets}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
