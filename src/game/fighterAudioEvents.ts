import type { FighterAudioCue } from "./audio";
import type { FighterId, PlayerSlot } from "./contracts";
import type { GameEvent } from "./engine";

/** Hits below this damage (in %) do not make the fighter cry out, so a jab chain is not a chorus. */
export const HURT_CUE_MIN_DAMAGE = 5;

/** Which of the attacker's own cues a move starts with. */
const attackCue = (move: GameEvent["move"]): FighterAudioCue =>
  move?.endsWith("smash") ? "smash" : move?.endsWith("special") ? "special" : "attack";

/**
 * The per-fighter sound cues a game event triggers, as [fighter, cue] pairs.
 * `fighterIn` maps a player slot to the fighter playing it.
 */
export const fighterCuesForEvent = (
  event: GameEvent,
  fighterIn: (slot: PlayerSlot) => FighterId | undefined,
): Array<[FighterId, FighterAudioCue]> => {
  const actor = event.slot === undefined ? undefined : fighterIn(event.slot);
  switch (event.type) {
    case "attack":
      return actor ? [[actor, attackCue(event.move)]] : [];
    case "jump":
    case "taunt":
    case "ko":
      return actor ? [[actor, event.type]] : [];
    case "match-end":
      return actor ? [[actor, "victory"]] : [];
    case "hit": {
      // The fighter who was hit reacts, unless armor absorbed the flinch.
      const target = event.target === undefined ? undefined : fighterIn(event.target);
      const hurts = target && !event.armored && event.sound !== "water-push" &&
        (event.damage ?? 0) >= HURT_CUE_MIN_DAMAGE;
      return hurts ? [[target, "hurt"]] : [];
    }
    default:
      return [];
  }
};
