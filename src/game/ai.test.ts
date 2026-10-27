import { describe, expect, it } from "vitest";
import type { MatchConfig } from "./contracts";
import {
  AI_DIFFICULTIES,
  createCpuController,
  projectileSpecialDirectionForFighter,
} from "./ai";
import { createGame } from "./engine";
import { DEFAULT_STAGE_ID } from "./stages";

const config: MatchConfig = {
  players: [
    { fighter: "kaykit-knight", skin: "00", name: "CPU", slot: 0, cpu: true, cpuLevel: 3 },
    { fighter: "george", skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
  ],
  stocks: 3,
  items: false,
  itemFrequency: "medium",
  stage: DEFAULT_STAGE_ID,
};

describe("CpuController", () => {
  it("differentiates the reaction times of all three levels", () => {
    expect(AI_DIFFICULTIES[3].reactionFrames[1]).toBeLessThan(
      AI_DIFFICULTIES[1].reactionFrames[0],
    );
    expect(AI_DIFFICULTIES[3].mistakeChance).toBeLessThan(AI_DIFFICULTIES[2].mistakeChance);
    expect(AI_DIFFICULTIES[3].defendChance).toBeGreaterThan(AI_DIFFICULTIES[1].defendChance);
  });

  it("walks out of a warning or live hazard zone, away from its centre", () => {
    const game = createGame(config, {
      countdownFrames: 0,
      spawnPositions: [{ x: -30, y: 60 }, { x: 400, y: 60 }],
    });
    const base = game.step([createCpuController(0, 3).next(game.getSnapshot()), createCpuController(1, 1).next(game.getSnapshot())]);
    const withHazard = (state: "idle" | "warning" | "active") => ({
      ...base,
      phase: "playing" as const,
      stage: {
        ...base.stage,
        hazards: [{ id: "gate", area: { x: 0, y: 60, width: 60, height: 120 }, color: "#ff3b3b", state, progress: 0 }],
      },
    });
    // Left of the zone's centre: escape to the left.
    expect(createCpuController(0, 3).next(withHazard("warning")).direction.x).toBe(-1);
    expect(createCpuController(0, 1).next(withHazard("active")).direction.x).toBe(-1);
    // Level 1 does not read the warning yet; nobody reacts to an idle zone.
    const relaxed = createCpuController(0, 1, 7).next(withHazard("warning"));
    const unaware = createCpuController(0, 1, 7).next(withHazard("idle"));
    expect(relaxed.direction).toEqual(unaware.direction);
  });

  it("does not flee a hazard off the edge of the stage", () => {
    // Default stage: the main platform spans x -710 to 710.
    const game = createGame(config, {
      countdownFrames: 0,
      spawnPositions: [{ x: -650, y: 60 }, { x: 400, y: 60 }],
    });
    const base = game.step([createCpuController(0, 3).next(game.getSnapshot()), createCpuController(1, 1).next(game.getSnapshot())]);
    const near = (state: "idle" | "active") => ({
      ...base,
      phase: "playing" as const,
      stage: {
        ...base.stage,
        hazards: [{ id: "edge", area: { x: -600, y: 60, width: 60, height: 120 }, color: "#ff3b3b", state, progress: 0 }],
      },
    });
    // Running left would leave the stage: the CPU plays on instead of fleeing.
    expect(createCpuController(0, 3, 9).next(near("active")).direction)
      .toEqual(createCpuController(0, 3, 9).next(near("idle")).direction);
  });

  it("uses an upward special to recover from very low offstage", () => {
    const game = createGame(config, {
      countdownFrames: 0,
      spawnPositions: [{ x: 670, y: -250 }, { x: 0, y: 100 }],
    });
    const frame = createCpuController(0, 3, 42).next(game.getSnapshot());
    expect(frame.pressed.has("special")).toBe(true);
    expect(frame.pressed.has("up")).toBe(true);
    expect(frame.direction.x).toBeLessThan(0);
    expect(frame.direction.y).toBeGreaterThan(0);
  });

  it("aims the move slot that owns each open projectile", () => {
    expect(projectileSpecialDirectionForFighter("kaykit-knight", 1)).toEqual({ x: 0, y: 0 });
    expect(projectileSpecialDirectionForFighter("rgs-stick", 1)).toBeNull();
  });

  it("produces an autonomous duel that lands a hit", () => {
    const versusConfig: MatchConfig = {
      ...config,
      players: [
        { ...config.players[0], name: "CPU 1" },
        { ...config.players[1], cpu: true, cpuLevel: 3, name: "CPU 2" },
      ],
    };
    const game = createGame(versusConfig, { countdownFrames: 0, seed: 7 });
    const first = createCpuController(0, 3, 11);
    const second = createCpuController(1, 3, 29);
    let hitCount = 0;
    for (let frame = 0; frame < 1_800 && hitCount === 0; frame += 1) {
      const before = game.getSnapshot();
      const snapshot = game.step([first.next(before), second.next(before)]);
      hitCount += snapshot.events.filter((event) => event.type === "hit").length;
    }
    expect(hitCount).toBeGreaterThan(0);
  });
});
