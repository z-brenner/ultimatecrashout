import { describe, expect, it } from "vitest";
import type { InputFrame } from "./contracts";
import { createEmptyInput, createGame, type GameEvent, type GameSnapshot } from "./engine";
import { FINAL_FINISHER, FINISHER, finisherFromEvents, finisherWeight } from "./finisher";
import { GameRenderer } from "./render";

const snapshotWithStocks = (stocks: [number, number]) =>
  ({ fighters: stocks.map((count) => ({ stocks: count })) }) as unknown as GameSnapshot;
const launch = (predictedKo: boolean, target: 0 | 1 = 1): GameEvent =>
  ({ type: "launch", frame: 10, slot: (1 - target) as 0 | 1, target, predictedKo });

describe("finishing blow timing", () => {
  it("snaps in, holds, and eases out to nothing", () => {
    const { seconds } = FINISHER;
    expect(finisherWeight(0, seconds)).toBe(0);
    expect(finisherWeight(seconds * 0.15, seconds)).toBeCloseTo(1, 5);
    expect(finisherWeight(seconds * 0.4, seconds)).toBe(1);
    expect(finisherWeight(seconds * 0.8, seconds)).toBeGreaterThan(0);
    expect(finisherWeight(seconds * 0.8, seconds)).toBeLessThan(1);
    expect(finisherWeight(seconds, seconds)).toBe(0);
    expect(finisherWeight(-1, seconds)).toBe(0);
    // Easing out never jumps back up.
    let previous = 1;
    for (let t = seconds * 0.6; t < seconds; t += seconds / 50) {
      const weight = finisherWeight(t, seconds);
      expect(weight).toBeLessThanOrEqual(previous + 1e-9);
      previous = weight;
    }
  });

  it("starts only on a launch predicted to KO, and lingers on the match's last stock", () => {
    expect(finisherFromEvents([launch(false)], snapshotWithStocks([3, 3]))).toBeNull();
    expect(finisherFromEvents([launch(true)], snapshotWithStocks([3, 3])))
      .toEqual({ target: 1, attacker: 0, final: false, timing: FINISHER });
    expect(finisherFromEvents([launch(true)], snapshotWithStocks([3, 1])))
      .toMatchObject({ final: true, timing: FINAL_FINISHER });
    expect(FINAL_FINISHER.seconds).toBeGreaterThan(FINISHER.seconds);
    expect(FINAL_FINISHER.timeScale).toBeLessThan(FINISHER.timeScale);
  });
});

describe("finishing blow camera", () => {
  type Harness = {
    finisher: unknown;
    camera: { x: number; y: number; zoom: number };
    height: number;
    reducedMotion: boolean;
    finisherStrength(): number;
  };
  const prototype = GameRenderer.prototype as unknown as {
    finisherCamera(this: Harness, snapshot: GameSnapshot): Harness["camera"] | null;
    finisherStrength(this: Harness): number;
  };
  const snapshot = { fighters: [{ position: { x: 0, y: 0 } }, { position: { x: 900, y: 400 } }] } as unknown as GameSnapshot;
  const harness = (elapsed: number, reducedMotion = false): Harness => ({
    finisher: { target: 1, final: false, timing: FINISHER, elapsed },
    camera: { x: 0, y: 110, zoom: 0.8 },
    height: 720,
    reducedMotion,
    finisherStrength: prototype.finisherStrength,
  });

  it("punches in on the launched fighter at full strength", () => {
    const camera = prototype.finisherCamera.call(harness(FINISHER.seconds * 0.4), snapshot)!;
    expect(camera.zoom).toBeCloseTo(0.8 * FINISHER.zoom, 5);
    expect(camera.x).toBe(900);
  });

  it("leaves the camera alone with reduced motion, or once the blow is over", () => {
    expect(prototype.finisherCamera.call(harness(FINISHER.seconds * 0.4, true), snapshot)).toBeNull();
    expect(prototype.finisherCamera.call(harness(FINISHER.seconds), snapshot)).toBeNull();
  });
});

describe("launch events", () => {
  type Runtime = { percent: number; hitstopFrames: number; position: { x: number; y: number } };
  type Internals = {
    fighters: [Runtime, Runtime];
    applyLaunch(target: Runtime, attacker: Runtime, damage: number, angle: number,
      baseKnockback: number, growth: number, hitstun: number, input: InputFrame): void;
  };
  const launched = (percent: number) => {
    const game = createGame({
      players: [
        { fighter: "george", skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
        { fighter: "buckle", skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
      ],
      stocks: 3, items: false, itemFrequency: "medium", stage: "verdant-grove", stageHazards: false,
    }, { countdownFrames: 0, spawnPositions: [{ x: -200, y: 60 }, { x: 200, y: 60 }] });
    const internals = game as unknown as Internals;
    const [attacker, target] = internals.fighters;
    for (let frame = 0; frame < 20; frame += 1) game.step([createEmptyInput(), createEmptyInput()]);
    target.percent = percent;
    internals.applyLaunch(target, attacker, 18, 45, 40, 1, 0, createEmptyInput());
    target.hitstopFrames = 3;
    const events: GameEvent[] = [];
    for (let frame = 0; frame < 300; frame += 1) {
      events.push(...game.step([createEmptyInput(), createEmptyInput()]).events);
    }
    return events;
  };

  it("announces each launch once, when hitlag ends, with whether it KOs", () => {
    const weak = launched(0).filter(({ type }) => type === "launch");
    expect(weak).toHaveLength(1);
    expect(weak[0]).toMatchObject({ slot: 0, target: 1, predictedKo: false });

    const deadly = launched(220);
    const deadlyLaunch = deadly.find(({ type }) => type === "launch")!;
    expect(deadlyLaunch).toMatchObject({ target: 1, predictedKo: true });
    // The KO it predicted follows.
    expect(deadly.some(({ type, slot, frame }) => type === "ko" && slot === 1 && frame > deadlyLaunch.frame)).toBe(true);
  });
});
