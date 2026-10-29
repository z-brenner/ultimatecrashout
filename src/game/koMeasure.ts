/**
 * KO-percent measurement for calibration and tests (not used by the game).
 *
 * The convention of Smash KO tables: the attacker stands at centre stage,
 * the target right in front of it at a given percent; uncharged unless
 * `charge` (0-1) says otherwise; no DI; the target idles. The hit goes
 * through the engine's own hit path, from each of the move's bubbles in
 * turn, and the strongest counts. A multi-hit move's earlier hits are
 * counted as damage before its last, launching hit. Only a KO through a
 * side or top blast line counts (an idle target that just falls off the
 * bottom would have recovered). Returns the lowest percent (to `step`) that
 * KOs, or null.
 */
import type { FighterId, InputFrame, StageId } from "./contracts";
import {
  chargeDamageScale,
  competitiveHitboxesForMove,
  createEmptyInput,
  createGame,
  meleeHitScaling,
  type GameEvent,
} from "./engine";
import { getFighterDefinition, type AttackDefinition, type MoveName } from "./roster";

interface Runtime {
  percent: number;
}
interface Internals {
  fighters: [Runtime, Runtime];
  stage: { blastZone: { left: number; right: number; top: number; bottom: number } };
  resolveAttackHit(
    attacker: Runtime, target: Runtime, move: AttackDefinition, moveName: MoveName,
    targetInput: InputFrame, damageScale: number, source: GameEvent["source"],
    launchScale: number, intermediateMultiHit: boolean, canBeCountered: boolean,
  ): void;
}

/** One way the move can land its launching hit. */
interface LaunchingHit {
  move: AttackDefinition;
  damageScale: number;
  launchScale: number;
  source: GameEvent["source"];
  /** Damage the move's earlier hits deal first. */
  priorDamage: number;
}

/** Every distinct launching hit of `name`, as the engine scales it. */
export const launchingHits = (attacker: FighterId, name: MoveName, charge = 0): LaunchingHit[] => {
  const move = getFighterDefinition(attacker).attacks[name];
  const maximumHits = Math.max(1, move.multiHit ?? 1);
  const chargeScale = chargeDamageScale(move, charge * (move.maxChargeFrames ?? 1));
  const priorDamage = move.damage * chargeScale * (maximumHits - 1) / maximumHits;
  if (move.projectile && !move.alsoMelee) {
    // Projectile hits carry no bubble multipliers (see resolveProjectiles).
    return [{ move, damageScale: chargeScale / maximumHits, launchScale: 1, source: "projectile", priorDamage }];
  }
  const seen = new Set<string>();
  const hits: LaunchingHit[] = [];
  for (let frame = 0; frame < move.active; frame += 1) {
    for (const hitbox of competitiveHitboxesForMove(name, move, frame)) {
      const { damageScale, launchScale, launchMove } = meleeHitScaling(move, hitbox, chargeScale, maximumHits);
      const key = [damageScale, launchScale, launchMove.angle, launchMove.baseKnockback, launchMove.knockbackGrowth].join();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ move: launchMove, damageScale, launchScale, source: "melee", priorDamage });
    }
  }
  return hits;
};

const kos = (
  attacker: FighterId,
  target: FighterId,
  name: MoveName,
  hit: LaunchingHit,
  percent: number,
  stage: StageId,
): boolean => {
  const game = createGame({
    players: [
      { fighter: attacker, skin: "00", name: "A", slot: 0, cpu: false, cpuLevel: 1 },
      { fighter: target, skin: "00", name: "T", slot: 1, cpu: false, cpuLevel: 1 },
    ],
    stocks: 3, items: false, itemFrequency: "medium", stage, stageHazards: false,
  }, { countdownFrames: 0, spawnPositions: [{ x: -50, y: 60 }, { x: 0, y: 60 }] });
  const internals = game as unknown as Internals;
  const idle = (): [InputFrame, InputFrame] => [createEmptyInput(), createEmptyInput()];
  for (let frame = 0; frame < 20; frame += 1) game.step(idle());
  const [a, t] = internals.fighters;
  t.percent = percent + hit.priorDamage;
  internals.resolveAttackHit(
    a, t, hit.move, name, createEmptyInput(), hit.damageScale, hit.source, hit.launchScale, false, false,
  );
  for (let frame = 0; frame < 420; frame += 1) {
    const ko = game.step(idle()).events.find(({ type, slot }) => type === "ko" && slot === 1);
    if (ko) return (ko.position?.y ?? 0) > internals.stage.blastZone.bottom;
  }
  return false;
};

const lowestKoPercent = (
  test: (percent: number) => boolean,
  max: number,
  step: number,
): number | null => {
  if (!test(max)) return null;
  if (test(0)) return 0;
  let low = 0;
  let high = max;
  while (high - low > step) {
    const middle = Math.floor((low + high) / 2);
    if (test(middle)) high = middle;
    else low = middle;
  }
  return high;
};

export const koPercent = (
  attacker: FighterId,
  target: FighterId,
  move: MoveName,
  { stage = "verdant-grove" as StageId, max = 300, step = 1, charge = 0 } = {},
): number | null => {
  let best: number | null = null;
  for (const hit of launchingHits(attacker, move, charge)) {
    const percent = lowestKoPercent((value) => kos(attacker, target, move, hit, value, stage), best ?? max, step);
    if (percent !== null && (best === null || percent < best)) best = percent;
  }
  return best;
};
