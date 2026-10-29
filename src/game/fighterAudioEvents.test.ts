import { describe, expect, it } from "vitest";
import type { FighterId, PlayerSlot } from "./contracts";
import type { GameEvent } from "./engine";
import { HURT_CUE_MIN_DAMAGE, fighterCuesForEvent } from "./fighterAudioEvents";

const fighters: Record<PlayerSlot, FighterId> = { 0: "buckle", 1: "george" };
const cues = (event: Partial<GameEvent> & Pick<GameEvent, "type">) =>
  fighterCuesForEvent({ frame: 1, ...event }, (slot) => fighters[slot]);

describe("fighter cues for game events", () => {
  it("voices the attacker by the kind of move", () => {
    expect(cues({ type: "attack", slot: 0, move: "jab" })).toEqual([["buckle", "attack"]]);
    expect(cues({ type: "attack", slot: 0, move: "forward-air" })).toEqual([["buckle", "attack"]]);
    expect(cues({ type: "attack", slot: 1, move: "up-smash" })).toEqual([["george", "smash"]]);
    expect(cues({ type: "attack", slot: 1, move: "side-special" })).toEqual([["george", "special"]]);
  });

  it("voices the fighter who was hit, not the attacker, and only at a real hit", () => {
    expect(cues({ type: "hit", slot: 0, target: 1, damage: HURT_CUE_MIN_DAMAGE })).toEqual([["george", "hurt"]]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: HURT_CUE_MIN_DAMAGE - 1 })).toEqual([]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: 12, armored: true })).toEqual([]);
    expect(cues({ type: "hit", slot: 0, target: 1, damage: 0, sound: "water-push" })).toEqual([]);
    // Stage hazards hit with no attacker.
    expect(cues({ type: "hit", target: 0, damage: 10, source: "hazard" })).toEqual([["buckle", "hurt"]]);
  });

  it("voices jumps, taunts, KOs (the fighter KO'd), and the winner", () => {
    expect(cues({ type: "jump", slot: 0 })).toEqual([["buckle", "jump"]]);
    expect(cues({ type: "taunt", slot: 1 })).toEqual([["george", "taunt"]]);
    expect(cues({ type: "ko", slot: 1, target: 0 })).toEqual([["george", "ko"]]);
    expect(cues({ type: "match-end", slot: 0, winner: 0 })).toEqual([["buckle", "victory"]]);
  });

  it("stays quiet for events without a fighter or a cue", () => {
    expect(cues({ type: "jump" })).toEqual([]);
    expect(cues({ type: "land", slot: 0 })).toEqual([]);
    expect(cues({ type: "shield-hit", slot: 0, target: 1 })).toEqual([]);
  });
});
