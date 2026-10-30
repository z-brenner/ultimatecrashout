import { describe, expect, it } from "vitest";
import type { ActionName, InputFrame, MatchConfig } from "./contracts";
import { createEmptyInput, createGame } from "./engine";
import { DEFAULT_STAGE_ID } from "./stages";

const config: MatchConfig = {
  players: [
    { fighter: "kaykit-knight", skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
    { fighter: "kaykit-knight", skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
  ],
  stocks: 1,
  items: false,
  itemFrequency: "medium",
  stage: DEFAULT_STAGE_ID,
};

const press = (...actions: ActionName[]): InputFrame => ({
  held: new Set(actions),
  pressed: new Set(actions),
  released: new Set(),
  direction: { x: 0, y: 0 },
  analog: false,
});

interface Fighter {
  position: { x: number; y: number };
  previousPosition: { x: number; y: number };
  grounded: boolean;
  supportPlatform: string | null;
  lastHitBy: number | null;
}

/** Puts a fighter past the bottom blast line, as if it had fallen. */
const dropOut = (game: ReturnType<typeof createGame>, slot: 0 | 1): void => {
  const fighter = (game as unknown as { fighters: [Fighter, Fighter] }).fighters[slot];
  fighter.position.y = -5_000;
  fighter.previousPosition.y = -5_000;
  fighter.grounded = false;
  fighter.supportPlatform = null;
};

const newGame = () => {
  const game = createGame(config, { countdownFrames: 0, spawnPositions: [{ x: -40, y: 60 }, { x: 40, y: 60 }] });
  for (let frame = 0; frame < 30; frame += 1) game.step([createEmptyInput(), createEmptyInput()]);
  return game;
};

describe("match result stats", () => {
  it("credits damage dealt and taken, and a KO, to the right players", () => {
    const game = newGame();
    game.step([press("attack"), createEmptyInput()]);
    for (let frame = 0; frame < 30; frame += 1) game.step([createEmptyInput(), createEmptyInput()]);
    const percent = game.getSnapshot().fighters[1].percent;
    expect(percent).toBeGreaterThan(0);

    dropOut(game, 1);
    let result = game.getSnapshot().result;
    for (let frame = 0; frame < 5 && !result; frame += 1) result = game.step([createEmptyInput(), createEmptyInput()]).result;
    expect(result).toMatchObject({
      winner: 0,
      kos: [1, 0],
      falls: [0, 1],
      selfDestructs: [0, 0],
    });
    expect(result!.damageDealt![0]).toBeCloseTo(percent, 6);
    expect(result!.damageTaken![1]).toBeCloseTo(percent, 6);
    expect(result!.damageDealt![1]).toBe(0);
    expect(result!.damageTaken![0]).toBe(0);
  });

  it("counts a fall with no hit to credit as a self-destruct", () => {
    const game = newGame();
    dropOut(game, 0);
    let result = game.getSnapshot().result;
    for (let frame = 0; frame < 5 && !result; frame += 1) result = game.step([createEmptyInput(), createEmptyInput()]).result;
    expect(result).toMatchObject({ winner: 1, kos: [0, 0], falls: [1, 0], selfDestructs: [1, 0] });
  });
});
