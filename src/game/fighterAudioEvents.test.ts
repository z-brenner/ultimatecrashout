import { describe, expect, it } from "vitest";
import type { FighterId, PlayerSlot } from "./contracts";
import type { GameEvent } from "./engine";
import { HURT_CUE_MIN_DAMAGE, fighterCuesForEvent } from "./fighterAudioEvents";

const fighters: Record<PlayerSlot, FighterId> = { 0: "buckle", 1: "george" };
const cues = (event: Partial<GameEvent> & Pick<GameEvent, "type">) =>
  fighterCuesForEvent({ frame: 1, ...event }, (slot) => fighters[slot]);

describe("fighter cues for game events", () => {
  it("voices the attacker by the kind of move", () => {
    expect(cues({ type: "attack", slot: 0, move: "jab" })).toEqual([["buckle", "attack", 0]]);
    expect(cues({ type: "attack", slot: 0, move: "forward-air" })).toEqual([["buckle", "attack", 0]]);
    expect(cues({ type: "attack", slot: 1, move: "up-smash" })).toEqual([["george", "smash", 1]]);
    expect(cues({ type: "attack", slot: 1, move: "side-special" })).toEqual([["george", "special", 1]]);
  });

  it("voices the fighter who was hit, not the attacker, and only at a real hit", () => {
    expect(cues({ type: "hit", slot: 0, target: 1, damage: HURT_CUE_MIN_DAMAGE })).toEqual([["george", "hurt", 1]]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: HURT_CUE_MIN_DAMAGE - 1 })).toEqual([]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: 12, armored: true })).toEqual([]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: 0, sound: "water-push" })).toEqual([]);
    // Stage hazards hit with no attacker.
    expect(cues({ type: "hit", target: 0, damage: 10, source: "hazard" })).toEqual([["buckle", "hurt", 0]]);
  });

  it("voices jumps, taunts, KOs (the fighter KO'd), and the winner", () => {
    expect(cues({ type: "jump", slot: 0 })).toEqual([["buckle", "jump", 0]]);
    expect(cues({ type: "taunt", slot: 1 })).toEqual([["george", "taunt", 1]]);
    expect(cues({ type: "ko", slot: 1, target: 0 })).toEqual([["george", "ko", 1]]);
    expect(cues({ type: "match-end", slot: 0, winner: 0 })).toEqual([["buckle", "victory", 0]]);
  });

  it("names the slot, so two players on one fighter are separate voices", () => {
    const mirror = (slot: PlayerSlot) => (["buckle", "buckle"] as const)[slot];
    expect(fighterCuesForEvent({ frame: 1, type: "hit", slot: 0, target: 1, damage: 9 }, mirror))
      .toEqual([["buckle", "hurt", 1]]);
  });

  it("stays quiet for events without a fighter or a cue", () => {
    expect(cues({ type: "jump" })).toEqual([]);
    expect(cues({ type: "land", slot: 0 })).toEqual([]);
    expect(cues({ type: "shield-hit", slot: 0, target: 1 })).toEqual([]);
  });
});
