import type { PlayerSlot } from "./contracts";
import type { GameEvent, GameSnapshot } from "./engine";

/**
 * Smash-style presentation of a finishing blow: when a launch is certain to
 * KO (the engine's predictedKo), the game slows down and the camera punches
 * in on the launched fighter; the match's last KO lingers longer and ends on
 * a GAME! splash.
 */

/** Player colours: P1 blue, P2 coral, as in the HUD. */
export const SLOT_COLORS: Readonly<Record<PlayerSlot, string>> = { 0: "#2878ff", 1: "#ff7657" };

export interface FinisherTiming {
  /** Real seconds the slow-down and camera punch last. */
  seconds: number;
  /** Simulation speed meanwhile (1 = normal). */
  timeScale: number;
  /** How far the camera zooms in, relative to the gameplay camera. */
  zoom: number;
}

export const FINISHER: FinisherTiming = { seconds: 0.5, timeScale: 0.2, zoom: 1.55 };
/** The KO that ends the match. */
export const FINAL_FINISHER: FinisherTiming = { seconds: 0.95, timeScale: 0.12, zoom: 1.8 };
/** Real seconds the GAME! splash shows before the results screen. */
export const GAME_SPLASH_SECONDS = 1.9;

export interface FinisherCue {
  target: PlayerSlot;
  attacker?: PlayerSlot;
  /** The target loses its last stock: the match ends on this KO. */
  final: boolean;
  timing: FinisherTiming;
}

/** The finishing blow announced in this batch of events, if any. */
export const finisherFromEvents = (events: readonly GameEvent[], snapshot: GameSnapshot): FinisherCue | null => {
  const launch = events.find(({ type, predictedKo, target }) => type === "launch" && predictedKo && target !== undefined);
  if (!launch || launch.target === undefined) return null;
  const final = snapshot.fighters[launch.target].stocks <= 1;
  return { target: launch.target, attacker: launch.slot, final, timing: final ? FINAL_FINISHER : FINISHER };
};

/**
 * How much of the punch-in applies `elapsed` real seconds into a finisher:
 * a fast snap in (first 15%), a hold, and an ease back out (last 40%).
 */
export const finisherWeight = (elapsed: number, seconds: number): number => {
  if (seconds <= 0 || elapsed < 0 || elapsed >= seconds) return 0;
  const progress = elapsed / seconds;
  if (progress < 0.15) return Math.sin((progress / 0.15) * Math.PI / 2);
  if (progress < 0.6) return 1;
  const out = (progress - 0.6) / 0.4;
  return 1 - out * out * (3 - 2 * out);
};
