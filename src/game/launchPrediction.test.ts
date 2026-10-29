import { describe, expect, it } from "vitest";
import type { FighterId, InputFrame, MatchConfig, StageId } from "./contracts";
import { createEmptyInput, createGame, predictLaunchKo, type GameEvent } from "./engine";
import { STAGE_IDS } from "./stages";

interface Runtime {
  slot: 0 | 1;
  percent: number;
  position: { x: number; y: number };
  previousPosition: { x: number; y: number };
  velocity: { x: number; y: number };
  grounded: boolean;
  supportPlatform: string | null;
  hitstopFrames: number;
  hitstunFrames: number;
  stocks: number;
}
type Internals = {
  fighters: [Runtime, Runtime];
  applyLaunch: (
    target: Runtime, attacker: Runtime, damage: number, angle: number,
    baseKnockback: number, growth: number, hitstun: number, input: InputFrame,
  ) => void;
};

/** Small seeded generator, so the sweep is the same on every run. */
const rng = (seed: number) => () => {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
  return (seed >>> 8) / 0x1000000;
};

const toward = (x: number): InputFrame => {
  const direction = { x: x > 0 ? -1 : 1, y: 0 };
  return { ...createEmptyInput(), held: new Set([direction.x < 0 ? "left" : "right"]), direction };
};

const FIGHTERS: FighterId[] = ["kaykit-knight", "george", "buckle", "yeti", "rgs-stick"];

interface Trial { predicted: boolean; ko: boolean; koInHitstun: boolean }

/** Launches one fighter with random knockback and returns what was predicted and what happened. */
const trial = (random: () => number, stage: StageId, drift: boolean): Trial => {
  const fighter = FIGHTERS[Math.floor(random() * FIGHTERS.length)]!;
  const config: MatchConfig = {
    players: [
      { fighter: "george", skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
      { fighter, skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
    ],
    stocks: 3, items: false, itemFrequency: "medium", stage, stageHazards: false,
  };
  const game = createGame(config, {
    countdownFrames: 0,
    spawnPositions: [{ x: 0, y: 60 }, { x: -500 + random() * 1000, y: 80 + random() * 400 }],
  });
  const internals = game as unknown as Internals;
  const [attacker, target] = internals.fighters;
  for (let frame = 0; frame < 3; frame += 1) game.step([createEmptyInput(), createEmptyInput()]);
  target.percent = random() * 220;
  // Mostly up-and-away angles, some sideways and downward (spikes).
  const angle = random() < 0.85 ? random() * 180 : 200 + random() * 140;
  internals.applyLaunch(target, attacker, 8 + random() * 22, angle, 20 + random() * 70, 0.5 + random() * 0.8, 0, createEmptyInput());
  target.hitstopFrames = 1;

  let launch: GameEvent | undefined;
  let hitstunAtLaunch = 0;
  let framesSinceLaunch = 0;
  for (let frame = 0; frame < 420; frame += 1) {
    const targetInput = drift ? toward(target.position.x) : createEmptyInput();
    const snapshot = game.step([createEmptyInput(), targetInput]);
    if (launch) framesSinceLaunch += 1;
    for (const event of snapshot.events) {
      if (event.type === "launch" && event.target === 1 && !launch) {
        launch = event;
        hitstunAtLaunch = target.hitstunFrames;
      }
      if (event.type === "ko" && event.slot === 1) {
        return { predicted: Boolean(launch?.predictedKo), ko: true, koInHitstun: framesSinceLaunch <= hitstunAtLaunch };
      }
    }
  }
  return { predicted: Boolean(launch?.predictedKo), ko: false, koInHitstun: false };
};

describe("launch KO prediction", () => {
  it.each(STAGE_IDS.map((stage) => [stage]))("never predicts a KO that does not happen (%s)", (stage) => {
    const random = rng(0xc0ffee ^ stage.length);
    const trials: Trial[] = [];
    for (let index = 0; index < 160; index += 1) trials.push(trial(random, stage, index % 2 === 1));
    const falsePositives = trials.filter(({ predicted, ko }) => predicted && !ko);
    expect(falsePositives).toEqual([]);
    // It is conservative, not useless: it calls most KOs that happen during hitstun.
    const hitstunKos = trials.filter(({ koInHitstun }) => koInHitstun);
    const called = hitstunKos.filter(({ predicted }) => predicted);
    expect(hitstunKos.length).toBeGreaterThan(20);
    expect(called.length / hitstunKos.length).toBeGreaterThan(0.85);
  });

  it("stops at the first surface in the way", () => {
    const base = {
      position: { x: 0, y: 200 },
      velocity: { x: 0, y: 0 },
      hitstunFrames: 200,
      gravity: 2000,
      maxFallSpeed: 900,
      airAcceleration: 1200,
      size: { width: 60, height: 100 },
      blastZone: { left: -1000, right: 1000, top: 900, bottom: -600 },
    };
    // Straight up, hard: a KO through the top...
    const up = { ...base, launchVelocity: { x: 0, y: 9 }, surfaces: [] };
    expect(predictLaunchKo(up)).toBe(true);
    // ...unless a solid ceiling is in the way.
    expect(predictLaunchKo({ ...up, surfaces: [{ left: -200, right: 200, top: 600, bottom: 500, solid: true }] })).toBe(false);
    // A one-way platform does not stop a fighter flying up through it.
    expect(predictLaunchKo({ ...up, surfaces: [{ left: -200, right: 200, top: 400, bottom: 400, solid: false }] })).toBe(true);
    // A spike onto a platform below lands on it.
    const spike = { ...base, launchVelocity: { x: 0, y: -8 } };
    expect(predictLaunchKo({ ...spike, surfaces: [] })).toBe(true);
    expect(predictLaunchKo({ ...spike, surfaces: [{ left: -200, right: 200, top: 0, bottom: 0, solid: false }] })).toBe(false);
    // Too weak to reach any blast line before hitstun ends (here, 20 frames).
    expect(predictLaunchKo({ ...base, hitstunFrames: 20, launchVelocity: { x: 2, y: 2 }, surfaces: [] })).toBe(false);
  });
});
