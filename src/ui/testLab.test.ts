// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TEST_LAB_ANIMATION_SLOTS,
  TEST_LAB_EFFECTS,
  TestLabController,
  labFrameAtTime,
  labMoveFrameData,
  labTimelineFrame,
} from "./testLab";
import { OPEN_FIGHTER_IDS } from "../game/contracts";
import { competitiveHitboxesForMove, createEmptyInput, createGame } from "../game/engine";
import { getFighterDefinition } from "../game/roster";
import { moveAnimationFrame, remoteAnimationSetForFighter } from "../game/characterAssets";
import { DEFAULT_STAGE_ID } from "../game/stages";

const loadedSources: string[] = [];

class LabImage {
  decoding = "auto";
  complete = false;
  naturalWidth = 0;
  private source = "";

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    loadedSources.push(value);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

/** An atlas that is already decoded, so the Lab draws and plays it. */
class LoadedLabImage extends LabImage {
  override complete = true;
  override naturalWidth = 1536;
}

const mockLabCanvas = () => {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return context;
};

afterEach(() => {
  loadedSources.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Test Lab animation transport", () => {
  it("exposes every required inspection slot exactly once", () => {
    expect(TEST_LAB_ANIMATION_SLOTS).toHaveLength(50);
    expect(new Set(TEST_LAB_ANIMATION_SLOTS).size).toBe(50);
    expect(TEST_LAB_ANIMATION_SLOTS).toEqual(expect.arrayContaining([
      "idle", "crouch", "walk", "turn", "dash", "run", "jump_squat", "jump", "double_jump", "fall", "fast_fall",
      "jab", "dash_attack", "forward_tilt", "up_tilt", "down_tilt",
      "forward_smash", "up_smash", "down_smash", "neutral_air", "forward_air",
      "back_air", "up_air", "down_air", "neutral_special", "side_special",
      "up_special", "down_special", "spot_dodge", "roll_forward", "roll_back",
      "air_dodge", "shield", "item_hold", "item_pickup", "item_attack", "grab", "grab_hold", "grabbed", "forward_throw",
      "back_throw", "up_throw", "down_throw", "hurt", "knockback", "downed", "ledge",
      "entrance", "taunt", "victory",
    ]));
  });

  it("exposes the complete isolated visual-effect bank", () => {
    expect(TEST_LAB_EFFECTS).toEqual([
      "none", "hit", "shield", "projectile", "explosion", "smoke", "speed", "invincible", "ko",
    ]);
  });

  it("loops deterministically at the selected playback speed", () => {
    const clip = { frameCount: 6, fps: 12 };
    expect(labFrameAtTime(clip, 0, 1, true)).toBe(0);
    expect(labFrameAtTime(clip, 0.25, 1, true)).toBe(3);
    expect(labFrameAtTime(clip, 0.25, 2, true)).toBe(0);
  });

  it("clamps non-looping playback to the last frame", () => {
    const clip = { frameCount: 8, fps: 10 };
    expect(labFrameAtTime(clip, -2, 1, false)).toBe(0);
    expect(labFrameAtTime(clip, 0.31, 1, false)).toBe(3);
    expect(labFrameAtTime(clip, 99, 1, false)).toBe(7);
  });

  it("loads the selected open atlas without a CSS colour filter", () => {
    vi.stubGlobal("Image", LabImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new TestLabController(root);

    expect(root.querySelector("[data-lab-overlay='collision']")?.getAttribute("viewBox")).toBe(
      "0 0 1920 1080",
    );
    const fighterSelect = root.querySelector<HTMLSelectElement>("[data-lab-field='fighter']")!;
    fighterSelect.value = OPEN_FIGHTER_IDS[0];
    fighterSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const animation = root.querySelector<HTMLSelectElement>("[data-lab-field='animation']")!;
    animation.value = "crouch";
    animation.dispatchEvent(new Event("change", { bubbles: true }));

    expect(loadedSources.at(-1)).toBe(
      `/assets/characters/open/${OPEN_FIGHTER_IDS[0]}/00/crouch.webp?v=clean-animation-4`,
    );
    animation.value = "idle";
    animation.dispatchEvent(new Event("change", { bubbles: true }));
    const skin = root.querySelector<HTMLSelectElement>("[data-lab-field='skin']")!;
    expect(Array.from(skin.options, ({ value }) => value)).toEqual(["00"]);

    expect(loadedSources.at(-1)).toBe(
      `/assets/characters/open/${OPEN_FIGHTER_IDS[0]}/00/idle.webp?v=clean-animation-4`,
    );
    expect(root.querySelector<HTMLCanvasElement>("[data-lab-canvas]")?.style.filter).toBe("none");
    controller.destroy();
  });
});

describe("Test Lab move frame data", () => {
  const fsmash = getFighterDefinition("buckle").attacks["forward-smash"];
  const labSpriteCount = () =>
    remoteAnimationSetForFighter("buckle", "00").animations.forward_smash.frameCount;

  it("only applies to attack animation slots", () => {
    expect(labMoveFrameData("buckle", "idle", 0, 6)).toBeNull();
    expect(labMoveFrameData("buckle", "grab", 0, 6)).toBeNull();
    expect(labMoveFrameData("buckle", "jab", 0, 5)?.move).toBe("jab");
  });

  it("reports phases, key frames, armor, and the engine's hitboxes per move frame", () => {
    const total = fsmash.startup + fsmash.active + fsmash.recovery;
    const windup = labMoveFrameData("buckle", "forward_smash", fsmash.startup - 1, 8)!;
    expect(windup).toMatchObject({ phase: "startup", totalFrames: total, hitboxes: [] });
    expect(windup.armored).toBe(true);

    const strike = labMoveFrameData("buckle", "forward_smash", fsmash.startup, 8)!;
    expect(strike.phase).toBe("active");
    expect(strike.strikeFrame).toBe(fsmash.startup);
    expect(strike.atlasFrame).toBe(strike.keyFrame);
    expect(strike.hitboxes).toEqual(competitiveHitboxesForMove("forward-smash", fsmash, 0));
    expect(strike.hitboxes.length).toBeGreaterThan(0);

    const end = labMoveFrameData("buckle", "forward_smash", total + 50, 8)!;
    expect(end).toMatchObject({ phase: "recovery", moveFrame: total - 1, hitboxes: [] });
  });

  it("shows no melee hitboxes for projectile-only specials", () => {
    const special = getFighterDefinition("buckle").attacks["neutral-special"];
    expect(special.projectile).toBeDefined();
    const active = labMoveFrameData("buckle", "neutral_special", special.startup, 7)!;
    expect(active.phase).toBe("active");
    expect(active.hitboxes).toEqual([]);
  });

  it("matches the live engine's hitboxes on the same move frame", () => {
    const game = createGame({
      players: [
        { fighter: "buckle", skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
        { fighter: "rgs-stick", skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
      ],
      stocks: 3,
      items: false,
      itemFrequency: "medium",
      stage: DEFAULT_STAGE_ID,
    }, { countdownFrames: 0, spawnPositions: [{ x: -200, y: 60 }, { x: 200, y: 60 }] });
    for (let frame = 0; frame < 30; frame += 1) game.step([createEmptyInput(), createEmptyInput()]);
    const jab = createEmptyInput();
    jab.held.add("attack");
    jab.pressed.add("attack");
    game.step([jab, createEmptyInput()]);
    let compared = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      const fighter = game.getSnapshot().fighters[0];
      const live = game.debugActiveHitboxes();
      if (fighter.currentMove === "jab") {
        const lab = labMoveFrameData("buckle", "jab", fighter.moveFrame, 5)!;
        expect(lab.hitboxes.length).toBe(live.length);
        lab.hitboxes.forEach((hitbox, index) => {
          expect(live[index]!.position.x).toBeCloseTo(fighter.position.x + hitbox.offset.x * fighter.facing, 5);
          expect(live[index]!.position.y).toBeCloseTo(fighter.position.y + hitbox.offset.y, 5);
          expect(live[index]!.radius).toBe(hitbox.radius);
        });
        if (live.length > 0) compared += 1;
      }
      game.step([createEmptyInput(), createEmptyInput()]);
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("switches the transport to engine move frames for attack animations", () => {
    vi.stubGlobal("Image", LabImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new TestLabController(root);
    const select = (field: string, value: string) => {
      const element = root.querySelector<HTMLSelectElement>(`[data-lab-field='${field}']`)!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const slider = root.querySelector<HTMLInputElement>("[data-lab-field='frame']")!;
    const label = () => root.querySelector<HTMLOutputElement>("[data-lab-frame]")!.value;

    select("fighter", "buckle");
    select("animation", "idle");
    expect(label()).toMatch(/^Frame 1 \//);

    select("animation", "forward_smash");
    const total = fsmash.startup + fsmash.active + fsmash.recovery;
    expect(slider.max).toBe(String(total - 1));
    expect(label()).toBe(`Move frame 1 / ${total} · startup · sprite 1 / ${labSpriteCount()}`);
    for (let step = 0; step < fsmash.startup; step += 1) {
      root.querySelector<HTMLButtonElement>("[data-lab-action='next']")!.click();
    }
    expect(label()).toContain(`Move frame ${fsmash.startup + 1} / ${total} · active`);
    expect(root.querySelector<HTMLOutputElement>("[data-lab-engine-state]")!.value)
      .toContain("forward-smash · strike on move frame");
    expect(root.querySelector<HTMLButtonElement>("[data-lab-play]")!.textContent).toBe("Play");
    controller.destroy();
  });

  it("ignores key frames outside the atlas, like the renderer", () => {
    const keyFrame = labMoveFrameData("buckle", "forward_smash", fsmash.startup, 8)!.keyFrame!;
    expect(keyFrame).toBeGreaterThan(0);
    const clipped = labMoveFrameData("buckle", "forward_smash", fsmash.startup, keyFrame)!;
    expect(clipped.keyFrame).toBeNull();
    expect(clipped.atlasFrame).toBe(moveAnimationFrame(fsmash.startup, fsmash, keyFrame));
  });

  it("resumes on the stepped frame at any speed, and speed changes keep the playhead", () => {
    expect(labTimelineFrame(10, 6.999, true)).toBe(6);
    vi.stubGlobal("Image", LoadedLabImage);
    let tick: FrameRequestCallback = () => undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      tick = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mockLabCanvas();
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new TestLabController(root);
    const select = (field: string, value: string) => {
      const element = root.querySelector<HTMLSelectElement | HTMLInputElement>(`[data-lab-field='${field}']`)!;
      element.value = value;
      element.dispatchEvent(new Event(element instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
    };
    const label = () => root.querySelector<HTMLOutputElement>("[data-lab-frame]")!.value;
    select("fighter", "buckle");
    select("animation", "forward_smash");
    select("speed", "0.3");
    // 0.3 is the speed where 7 / (60 * 0.3) * 60 * 0.3 rounds to 6.999…
    for (let step = 0; step < 7; step += 1) {
      root.querySelector<HTMLButtonElement>("[data-lab-action='next']")!.click();
    }
    expect(label()).toMatch(/^Move frame 8 \//);
    select("speed", "2");
    root.querySelector<HTMLButtonElement>("[data-lab-action='toggle']")!.click();
    tick(0); // Prime the frame clock; dt is clamped to >= 0.
    tick(1); // 1 ms at 2× = 0.12 engine frames: still on the stepped frame.
    expect(label()).toMatch(/^Move frame 8 \//);
    controller.destroy();
  });

  it("draws the engine hurtbox and hitboxes on the canvas, even on an empty cell", () => {
    vi.stubGlobal("Image", LoadedLabImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const context = mockLabCanvas();
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new TestLabController(root);
    const select = (field: string, value: string) => {
      const element = root.querySelector<HTMLSelectElement>(`[data-lab-field='${field}']`)!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const toggle = (overlay: string) => {
      const box = root.querySelector<HTMLInputElement>(`[data-lab-overlay-toggle='${overlay}']`)!;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    };
    expect(root.querySelector("[data-lab-overlay='hurt']")).toBeNull();
    select("fighter", "buckle");
    select("animation", "idle");
    toggle("hurt");
    expect(context.closePath).toHaveBeenCalledTimes(1);
    const capsuleTop = () => {
      const [, y, radius] = context.arc.mock.calls[0]!;
      return (y as number) - (radius as number);
    };
    const standingTop = capsuleTop();
    context.arc.mockClear();
    select("animation", "crouch");
    expect(capsuleTop()).toBeGreaterThan(standingTop);

    // The mocked context has no getImageData, like an unreadable canvas: the
    // overlay falls back to the cell bottom instead of disappearing.
    toggle("hit");
    select("animation", "forward_smash");
    context.arc.mockClear();
    for (let step = 0; step < fsmash.startup; step += 1) {
      root.querySelector<HTMLButtonElement>("[data-lab-action='next']")!.click();
    }
    const circles = context.arc.mock.calls.filter(([, , , start, end]) => start === 0 && end === Math.PI * 2);
    expect(circles.length).toBeGreaterThanOrEqual(
      labMoveFrameData("buckle", "forward_smash", fsmash.startup, 8)!.hitboxes.length,
    );
    controller.destroy();
  });
});
