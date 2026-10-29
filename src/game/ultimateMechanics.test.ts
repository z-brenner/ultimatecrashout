import { describe, expect, it } from "vitest";
import type { ActionName, FighterId, InputFrame, MatchConfig } from "./contracts";
import {
  NEUTRAL_AIR_DODGE_FRAMES,
  SHORT_HOP_AERIAL_DAMAGE_SCALE,
  competitiveHitboxesForMove,
  PARRY_ATTACKER_EXTRA_FREEZE_FRAMES,
  SHIELD_DROP_FRAMES,
  createEmptyInput,
  createGame,
  type GameEvent,
} from "./engine";
import { getFighterDefinition } from "./roster";
import { DEFAULT_STAGE_ID } from "./stages";

const matchConfig = (first: FighterId = "kaykit-knight", second: FighterId = "kaykit-knight"): MatchConfig => ({
  players: [
    { fighter: first, skin: "00", name: "P1", slot: 0, cpu: false, cpuLevel: 1 },
    { fighter: second, skin: "00", name: "P2", slot: 1, cpu: false, cpuLevel: 1 },
  ],
  stocks: 3,
  items: false,
  itemFrequency: "medium",
  stage: DEFAULT_STAGE_ID,
});

const input = ({
  held = [],
  pressed = [],
  direction = { x: 0, y: 0 },
}: { held?: ActionName[]; pressed?: ActionName[]; direction?: { x: number; y: number } } = {}): InputFrame => ({
  held: new Set(held),
  pressed: new Set(pressed),
  released: new Set(),
  direction,
  analog: false,
});

const empty = createEmptyInput;
const shieldHeld = () => input({ held: ["shield"] });

const newGame = (spawns = [{ x: -40, y: 60 }, { x: 40, y: 60 }]) => {
  const game = createGame(matchConfig(), { countdownFrames: 0, spawnPositions: [spawns[0]!, spawns[1]!] });
  for (let frame = 0; frame < 30; frame += 1) game.step([empty(), empty()]);
  return game;
};

describe("perfect shield (parry)", () => {
  /**
   * P2 shields, then P1 starts a forward tilt and P2 lets go of shield
   * `releaseDelay` frames later. Returns what the strike did.
   */
  const strikeAfterRelease = (releaseDelay: number) => {
    const game = newGame();
    game.step([empty(), input({ held: ["shield"], pressed: ["shield"] })]);
    for (let frame = 0; frame < 8; frame += 1) game.step([empty(), shieldHeld()]);
    const shieldBefore = game.getSnapshot().fighters[1].shield;
    const events: GameEvent[] = [];
    const moveFrames: number[] = [];
    const ftilt = input({ held: ["right", "attack"], pressed: ["attack"], direction: { x: 1, y: 0 } });
    for (let frame = 0; frame < 40; frame += 1) {
      const p1 = frame === 0 ? ftilt : input({ held: ["right"], direction: { x: 1, y: 0 } });
      const snapshot = game.step([p1, frame < releaseDelay ? shieldHeld() : empty()]);
      events.push(...snapshot.events);
      moveFrames.push(snapshot.fighters[0].moveFrame);
    }
    const parryIndex = events.findIndex(({ type }) => type === "parry");
    return {
      parried: parryIndex >= 0,
      shieldHit: events.some(({ type }) => type === "shield-hit"),
      hit: events.some(({ type, target }) => type === "hit" && target === 1),
      percent: game.getSnapshot().fighters[1].percent,
      shieldLost: shieldBefore - game.getSnapshot().fighters[1].shield,
      events,
      moveFrames,
    };
  };

  it("parries a hit that lands just after shield is let go, at no cost to the shield", () => {
    const outcomes = Array.from({ length: 16 }, (_, delay) => strikeAfterRelease(delay));
    const parries = outcomes.filter(({ parried }) => parried);
    expect(parries.length).toBeGreaterThanOrEqual(3);
    expect(parries.length).toBeLessThanOrEqual(5);
    for (const parry of parries) {
      expect(parry.percent).toBe(0);
      expect(parry.shieldHit).toBe(false);
      expect(parry.events.find(({ type }) => type === "parry")).toMatchObject({ slot: 1, target: 0, sound: "parry" });
    }
  });

  it("leaves the shield drop after the parry window open to punishment", () => {
    const outcomes = Array.from({ length: 16 }, (_, delay) => strikeAfterRelease(delay));
    // Release far enough ahead of the hit that it lands mid-drop: a clean hit.
    expect(outcomes.some(({ hit, parried, percent }) => hit && !parried && percent > 0)).toBe(true);
    // Never let go: an ordinary shield hit.
    const held = strikeAfterRelease(40);
    expect(held.shieldHit).toBe(true);
    expect(held.parried).toBe(false);
    expect(held.percent).toBe(0);
  });

  it("freezes a parried attacker longer than the parrying fighter", () => {
    const parry = Array.from({ length: 16 }, (_, delay) => strikeAfterRelease(delay)).find(({ parried }) => parried)!;
    const frozenAt = parry.moveFrames.findIndex((frame, index) => index > 0 && frame === parry.moveFrames[index - 1]);
    let frozen = 0;
    for (let index = frozenAt; index < parry.moveFrames.length && parry.moveFrames[index] === parry.moveFrames[frozenAt]; index += 1) {
      frozen += 1;
    }
    expect(frozen).toBeGreaterThanOrEqual(PARRY_ATTACKER_EXTRA_FREEZE_FRAMES);
  });

  it("makes letting go of shield take a moment, but jumping out of it does not", () => {
    const game = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]);
    for (let frame = 0; frame < 6; frame += 1) game.step([shieldHeld(), empty()]);
    game.step([empty(), empty()]);
    // Mid-drop an attack does not start straight away.
    const midDrop = game.step([input({ held: ["attack"], pressed: ["attack"] }), empty()]);
    expect(midDrop.fighters[0].state).not.toBe("attack");
    for (let frame = 0; frame < SHIELD_DROP_FRAMES; frame += 1) game.step([empty(), empty()]);
    expect(game.step([input({ held: ["attack"], pressed: ["attack"] }), empty()]).fighters[0].state).toBe("attack");

    const jumper = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    jumper.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]);
    for (let frame = 0; frame < 6; frame += 1) jumper.step([shieldHeld(), empty()]);
    const jump = jumper.step([input({ held: ["shield", "jump"], pressed: ["jump"] }), empty()]);
    expect(jump.fighters[0].state).toBe("jump-squat");
  });
});

describe("shield drop timing", () => {
  it("lasts exactly the shield-drop frames, the release frame counting as the first", () => {
    const game = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]);
    for (let frame = 0; frame < 6; frame += 1) game.step([shieldHeld(), empty()]);
    game.step([empty(), empty()]);
    // Mash attack: it may start only once the drop is over.
    let firstAttack = 0;
    for (let frame = 1; frame <= 20 && firstAttack === 0; frame += 1) {
      const fighter = game.step([input({ held: ["attack"], pressed: ["attack"] }), empty()]).fighters[0];
      if (fighter.state === "attack") firstAttack = frame;
    }
    expect(firstAttack).toBe(SHIELD_DROP_FRAMES);
  });
});

describe("air dodge (Ultimate)", () => {
  const airborne = () => {
    // Out past the side platforms, so nothing catches the fall.
    const game = newGame([{ x: -620, y: 60 }, { x: 300, y: 60 }]);
    game.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
    let snapshot = game.getSnapshot();
    for (let frame = 0; frame < 10 && snapshot.fighters[0].grounded; frame += 1) {
      snapshot = game.step([input({ held: ["jump"] }), empty()]);
    }
    expect(snapshot.fighters[0].grounded).toBe(false);
    // Double jump at the peak: high enough that a whole air dodge ends airborne.
    for (let frame = 0; frame < 20; frame += 1) game.step([input({ held: ["jump"] }), empty()]);
    game.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
    for (let frame = 0; frame < 6; frame += 1) game.step([input({ held: ["jump"] }), empty()]);
    return game;
  };

  it("leaves the fighter free to act after an air dodge, with no helpless fall", () => {
    const game = airborne();
    expect(game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]).fighters[0]).toMatchObject({
      state: "dodge",
      dodgeKind: "air",
    });
    for (let frame = 0; frame < NEUTRAL_AIR_DODGE_FRAMES; frame += 1) game.step([empty(), empty()]);
    const after = game.step([input({ held: ["attack"], pressed: ["attack"] }), empty()]).fighters[0];
    expect(after.grounded).toBe(false);
    expect(after.state).toBe("attack");
    expect(after.currentMove).toBe("neutral-air");
  });

  it("allows one air dodge per airtime", () => {
    const game = airborne();
    game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]);
    for (let frame = 0; frame < NEUTRAL_AIR_DODGE_FRAMES; frame += 1) game.step([empty(), empty()]);
    const second = game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]).fighters[0];
    expect(second.grounded).toBe(false);
    expect(second.state).not.toBe("dodge");
  });

  it("sends a directional air dodge the same distance whatever the stick tilt", () => {
    const travel = (direction: { x: number; y: number }) => {
      const game = airborne();
      const start = game.getSnapshot().fighters[0].position.x;
      game.step([input({ held: ["shield", "right"], pressed: ["shield"], direction }), empty()]);
      for (let frame = 0; frame < 12; frame += 1) game.step([empty(), empty()]);
      return game.getSnapshot().fighters[0].position.x - start;
    };
    const full = travel({ x: 1, y: 0 });
    expect(full).toBeGreaterThan(60);
    expect(travel({ x: 0.5, y: 0 })).toBeCloseTo(full, 0);
  });
});

describe("short-hop aerials", () => {
  it("short hops straight into an aerial when jump and attack are pressed together", () => {
    const game = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    const groundY = game.getSnapshot().fighters[0].position.y;
    game.step([input({ held: ["jump", "attack"], pressed: ["jump", "attack"] }), empty()]);
    let peak = groundY;
    let aerial: string | null = null;
    for (let frame = 0; frame < 60; frame += 1) {
      const fighter = game.step([input({ held: ["jump", "attack"] }), empty()]).fighters[0];
      peak = Math.max(peak, fighter.position.y);
      if (!fighter.grounded && fighter.currentMove) aerial ??= fighter.currentMove;
    }
    expect(aerial).toBe("neutral-air");

    // Jump held alone is a full hop: the chord keeps it short however long jump is held.
    const fullHop = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    fullHop.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
    let fullPeak = groundY;
    for (let frame = 0; frame < 60; frame += 1) {
      fullPeak = Math.max(fullPeak, fullHop.step([input({ held: ["jump"] }), empty()]).fighters[0].position.y);
    }
    expect(peak - groundY).toBeLessThan((fullPeak - groundY) * 0.8);
  });

  it("treats attack late in jump squat as an ordinary full-hop aerial", () => {
    const game = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    const groundY = game.getSnapshot().fighters[0].position.y;
    game.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
    game.step([input({ held: ["jump"] }), empty()]);
    game.step([input({ held: ["jump", "attack"], pressed: ["attack"] }), empty()]);
    let peak = groundY;
    for (let frame = 0; frame < 60; frame += 1) {
      peak = Math.max(peak, game.step([input({ held: ["jump"] }), empty()]).fighters[0].position.y);
    }
    const fullHop = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    fullHop.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
    let fullPeak = groundY;
    for (let frame = 0; frame < 60; frame += 1) {
      fullPeak = Math.max(fullPeak, fullHop.step([input({ held: ["jump"] }), empty()]).fighters[0].position.y);
    }
    expect(peak).toBeCloseTo(fullPeak, 0);
  });

  it("short hops into an aerial when jump and attack are pressed together out of shield", () => {
    const game = newGame([{ x: -300, y: 60 }, { x: 300, y: 60 }]);
    game.step([input({ held: ["shield"], pressed: ["shield"] }), empty()]);
    for (let frame = 0; frame < 6; frame += 1) game.step([shieldHeld(), empty()]);
    game.step([input({ held: ["shield", "jump", "attack"], pressed: ["jump", "attack"] }), empty()]);
    let aerial: string | null = null;
    for (let frame = 0; frame < 30; frame += 1) {
      const fighter = game.step([empty(), empty()]).fighters[0];
      if (!fighter.grounded && fighter.currentMove) aerial ??= fighter.currentMove;
    }
    expect(aerial).toBe("neutral-air");
  });

  it("deals 0.85× damage with an aerial during a short hop, full damage otherwise", () => {
    const nair = getFighterDefinition("kaykit-knight").attacks["neutral-air"];
    const bubbleDamage = new Set<number>();
    for (let frame = 0; frame < nair.active; frame += 1) {
      for (const hitbox of competitiveHitboxesForMove("neutral-air", nair, frame)) {
        bubbleDamage.add(Math.round(nair.damage * hitbox.damageMultiplier * 1000) / 1000);
      }
    }
    const isBubbleDamage = (damage: number, scale: number) =>
      [...bubbleDamage].some((value) => Math.abs(value * scale - damage) < 0.01);

    // Jump and attack together, right beside P2: the rising nair connects.
    const shortHop = newGame([{ x: -20, y: 60 }, { x: 20, y: 60 }]);
    shortHop.step([input({ held: ["jump", "attack"], pressed: ["jump", "attack"] }), empty()]);
    for (let frame = 0; frame < 40; frame += 1) shortHop.step([empty(), empty()]);
    const shortDamage = shortHop.getSnapshot().fighters[1].percent;
    expect(isBubbleDamage(shortDamage, SHORT_HOP_AERIAL_DAMAGE_SCALE)).toBe(true);
    expect(isBubbleDamage(shortDamage, 1)).toBe(false);

    // A full hop's nair on the way down: full damage.
    const fullDamage = Array.from({ length: 40 }, (_, delay) => {
      const game = newGame([{ x: -20, y: 60 }, { x: 20, y: 60 }]);
      game.step([input({ held: ["jump"], pressed: ["jump"] }), empty()]);
      for (let frame = 0; frame < 4 + delay; frame += 1) game.step([input({ held: ["jump"] }), empty()]);
      // Jump stays held: letting go this early would turn it into a short hop.
      game.step([input({ held: ["jump", "attack"], pressed: ["attack"] }), empty()]);
      for (let frame = 0; frame < 30; frame += 1) game.step([input({ held: ["jump"] }), empty()]);
      return game.getSnapshot().fighters[1].percent;
    }).find((percent) => percent > 0);
    expect(fullDamage).toBeDefined();
    expect(isBubbleDamage(fullDamage!, 1)).toBe(true);
  });
});
