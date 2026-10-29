import type { FighterAudioCue } from "./audio";
import type { FighterId, PlayerSlot } from "./contracts";
import type { GameEvent } from "./engine";

/** Hits below this damage (in %) do not make the fighter cry out, so a jab chain is not a chorus. */
export const HURT_CUE_MIN_DAMAGE = 5;

/** Which of the attacker's own cues a move starts with. */
const attackCue = (move: GameEvent["move"]): FighterAudioCue =>
  move?.endsWith("smash") ? "smash" : move?.endsWith("special") ? "special" : "attack";

export type FighterCueTrigger = [fighter: FighterId, cue: FighterAudioCue, slot: PlayerSlot];

/**
 * The per-fighter sound cues a game event triggers, with the slot whose
 * fighter speaks. `fighterIn` maps a player slot to the fighter playing it.
 */
export const fighterCuesForEvent = (
  event: GameEvent,
  fighterIn: (slot: PlayerSlot) => FighterId | undefined,
): FighterCueTrigger[] => {
  const by = (slot: PlayerSlot | undefined, cue: FighterAudioCue): FighterCueTrigger[] => {
    const fighter = slot === undefined ? undefined : fighterIn(slot);
    return fighter && slot !== undefined ? [[fighter, cue, slot]] : [];
  };
  switch (event.type) {
    case "attack":
      return by(event.slot, attackCue(event.move));
    case "jump":
    case "taunt":
    case "ko":
      return by(event.slot, event.type);
    case "match-end":
      return by(event.slot, "victory");
    case "hit": {
      // The fighter who was hit reacts, unless armor absorbed the flinch.
      const hurts = !event.armored && event.sound !== "water-push" && (event.damage ?? 0) >= HURT_CUE_MIN_DAMAGE;
      return hurts ? by(event.target, "hurt") : [];
    }
    default:
      return [];
  }
};
