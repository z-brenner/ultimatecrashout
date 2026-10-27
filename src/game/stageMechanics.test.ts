import { describe, expect, it, vi } from "vitest";
import type { MatchConfig, StageId } from "./contracts";
import { createEmptyInput, createGame, type GameEvent } from "./engine";
import {
  hazardOverlaps,
  hazardPhase,
  platformMotionMaxSpeed,
  platformMotionPosition,
} from "./stageMechanics.mjs";
import type { StageDefinition } from "./stages";

const { TEST_STAGE, HAZARD } = vi.hoisted(() => ({
  TEST_STAGE: "mechanics-test" as StageId,
  HAZARD: {
    id: "gate",
    kind: "zone" as const,
    area: { x: 0, y: 40, width: 120, height: 80 },
    schedule: { periodFrames: 300, warningFrames: 60, activeFrames: 30 },
    hit: { damage: 10, angle: 70, baseKnockback: 60, knockbackGrowth: 0.5, mirrorX: true },
    color: "#ff3b3b",
  },
}));

// A copy of Crash Course with a sideways lift, a fast elevator, and a hazard,
// so these tests do not depend on any shipped stage's tuning.
vi.mock("./stages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stages")>();
  const base = actual.STAGE_DEFINITIONS["crash-course" as StageId];
  const stage: StageDefinition = {
    ...base,
    id: TEST_STAGE,
    platforms: [
      base.platforms.find(({ id }) => id === "main")!,
      {
        id: "lift", x: -400, y: 100, width: 200, height: 24, kind: "platform",
        motion: { path: [{ x: -400, y: 100 }, { x: 400, y: 100 }], periodFrames: 240 },
      },
      {
        id: "elevator", x: 600, y: 60, width: 200, height: 24, kind: "platform",
        motion: { path: [{ x: 600, y: 60 }, { x: 600, y: 660 }], periodFrames: 120 },
      },
    ],
    hazards: [HAZARD],
  };
  return {
    ...actual,
    getStageDefinition: (id: StageId) => (id === TEST_STAGE ? stage : actual.getStageDefinition(id)),
  };
});

const config = (overrides: Partial<MatchConfig> = {}): MatchConfig => ({
  players: [
    { fighter: "kaykit-knight", skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
    { fighter: "george", skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
  ],
  stocks: 3,
  items: false,
  itemFrequency: "medium",
  stage: TEST_STAGE,
  ...overrides,
});

const idle = (): [ReturnType<typeof createEmptyInput>, ReturnType<typeof createEmptyInput>] =>
  [createEmptyInput(), createEmptyInput()];

describe("stage mechanics (pure)", () => {
  const lift = { path: [{ x: -400, y: 100 }, { x: 400, y: 100 }], periodFrames: 240 };

  it("ping-pongs along the path once per period", () => {
    expect(platformMotionPosition(lift, 0)).toEqual({ x: -400, y: 100 });
    expect(platformMotionPosition(lift, 60)).toEqual({ x: 0, y: 100 });
    expect(platformMotionPosition(lift, 120)).toEqual({ x: 400, y: 100 });
    expect(platformMotionPosition(lift, 180)).toEqual({ x: 0, y: 100 });
    expect(platformMotionPosition(lift, 240)).toEqual(platformMotionPosition(lift, 0));
    expect(platformMotionMaxSpeed(lift)).toBeCloseTo(800 / 120, 5);
  });

  it("eases into each end with sine easing, and loops back to the start in loop mode", () => {
    const eased = { ...lift, easing: "sine" as const };
    expect(platformMotionPosition(eased, 120).x).toBeCloseTo(400, 5);
    // Slow near the ends, fast in the middle.
    expect(platformMotionPosition(eased, 1).x - platformMotionPosition(eased, 0).x)
      .toBeLessThan(platformMotionPosition(eased, 61).x - platformMotionPosition(eased, 60).x);

    const loop = { path: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], periodFrames: 100, mode: "loop" as const };
    // Perimeter 100 + 100 + 141.4; a quarter of the way is on the first leg's end.
    expect(platformMotionPosition(loop, 25).x).toBeCloseTo(85.36, 1);
    expect(platformMotionPosition(loop, 100)).toEqual({ x: 0, y: 0 });
  });

  it("phases a hazard through idle, warning, and active, numbering each activation", () => {
    const { schedule } = HAZARD;
    expect(hazardPhase(schedule, 0)).toMatchObject({ state: "idle", cycle: 0 });
    expect(hazardPhase(schedule, 209)).toMatchObject({ state: "idle" });
    expect(hazardPhase(schedule, 210)).toMatchObject({ state: "warning", progress: 0 });
    expect(hazardPhase(schedule, 270)).toMatchObject({ state: "active", cycle: 0, progress: 0 });
    expect(hazardPhase(schedule, 299)).toMatchObject({ state: "active", cycle: 0 });
    expect(hazardPhase(schedule, 570)).toMatchObject({ state: "active", cycle: 1 });
    expect(hazardPhase({ ...schedule, phaseFrames: 100 }, 170)).toMatchObject({ state: "active" });
  });

  it("tests box overlap against a zone", () => {
    expect(hazardOverlaps(HAZARD.area, { x: 70, y: 40 }, 15, 30)).toBe(true);
    expect(hazardOverlaps(HAZARD.area, { x: 80, y: 40 }, 15, 30)).toBe(false);
  });
});

describe("stage mechanics in a match", () => {
  it("carries a fighter standing on a moving platform", () => {
    const game = createGame(config(), {
      countdownFrames: 0,
      spawnPositions: [{ x: -400, y: 200 }, { x: 900, y: 60 }],
    });
    let snapshot = game.getSnapshot();
    for (let frame = 0; frame < 20 && !snapshot.fighters[0].grounded; frame += 1) snapshot = game.step(idle());
    expect(snapshot.fighters[0].grounded).toBe(true);
    const lift = () => snapshot.stage.platforms.find(({ id }) => id === "lift")!;
    const offset = snapshot.fighters[0].position.x - lift().x;
    for (let frame = 0; frame < 60; frame += 1) snapshot = game.step(idle());
    // The lift travelled 400 units; the idle fighter rode it without sliding.
    expect(lift().x).toBeGreaterThan(-100);
    expect(snapshot.fighters[0].grounded).toBe(true);
    expect(snapshot.fighters[0].position.x - lift().x).toBeCloseTo(offset, 3);
    expect(snapshot.fighters[0].position.y).toBeGreaterThan(112);
  });

  it("lands a falling fighter on a platform rising into it instead of passing through", () => {
    // The elevator rises 10 units a frame; the fighter falls onto it from above.
    const game = createGame(config(), {
      countdownFrames: 0,
      spawnPositions: [{ x: -900, y: 60 }, { x: 600, y: 420 }],
    });
    let snapshot = game.getSnapshot();
    let landedOn: number | null = null;
    for (let frame = 0; frame < 90; frame += 1) {
      snapshot = game.step(idle());
      const fighter = snapshot.fighters[1];
      const elevator = snapshot.stage.platforms.find(({ id }) => id === "elevator")!;
      if (fighter.grounded && fighter.position.y > 100) {
        landedOn = elevator.y;
        break;
      }
      // Never below the elevator's top while still above the floor.
      expect(fighter.position.y).toBeGreaterThan(elevator.y - 12);
    }
    expect(landedOn).not.toBeNull();
  });

  it("warns, then launches a fighter in an active hazard once per activation, with no KO credit", () => {
    const game = createGame(config(), {
      countdownFrames: 0,
      spawnPositions: [{ x: -20, y: 60 }, { x: -900, y: 60 }],
    });
    const states: string[] = [];
    const hazardEvents: GameEvent[] = [];
    let snapshot = game.getSnapshot();
    for (let frame = 1; frame <= 299; frame += 1) {
      snapshot = game.step(idle());
      states.push(snapshot.stage.hazards[0]!.state);
      hazardEvents.push(...snapshot.events.filter(({ source }) => source === "hazard"));
      if (frame < 270) expect(snapshot.fighters[0].percent).toBe(0);
    }
    expect(states.indexOf("warning")).toBe(209);
    expect(states.indexOf("active")).toBe(269);
    expect(hazardEvents).toHaveLength(1);
    expect(hazardEvents[0]).toMatchObject({ target: 0, damage: 10 });
    expect(hazardEvents[0]!.slot).toBeUndefined();
    expect(snapshot.fighters[0].percent).toBe(10);
    // Left of the zone's centre with mirrorX: launched up and to the left.
    expect(hazardEvents[0]!.velocity!.x).toBeLessThan(0);
    expect(hazardEvents[0]!.velocity!.y).toBeGreaterThan(0);
    expect(snapshot.fighters[1].percent).toBe(0);
  });

  it("turns hazard zones off with the match rule, but keeps platforms moving", () => {
    const game = createGame(config({ stageHazards: false }), {
      countdownFrames: 0,
      spawnPositions: [{ x: -20, y: 60 }, { x: -900, y: 60 }],
    });
    let snapshot = game.getSnapshot();
    for (let frame = 0; frame < 300; frame += 1) snapshot = game.step(idle());
    expect(snapshot.stage.hazards).toEqual([]);
    expect(snapshot.fighters[0].percent).toBe(0);
    expect(snapshot.stage.platforms.find(({ id }) => id === "lift")!.x).not.toBe(-400);
  });

  it("replays identically: platform positions depend only on the frame", () => {
    const run = () => {
      const game = createGame(config(), { countdownFrames: 0, spawnPositions: [{ x: -400, y: 200 }, { x: 600, y: 420 }] });
      let snapshot = game.getSnapshot();
      for (let frame = 0; frame < 400; frame += 1) snapshot = game.step(idle());
      return snapshot.fighters.map(({ position, percent }) => [position.x, position.y, percent]);
    };
    expect(run()).toEqual(run());
  });
});
