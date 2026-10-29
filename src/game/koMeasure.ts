/**
 * KO-percent measurement for calibration and tests (not used by the game).
 *
 * The convention of Smash KO tables: the attacker stands at centre stage,
 * the target right in front of it at a given percent; the move's strongest
 * hitbox, uncharged unless `charge` (0-1) says otherwise; no DI; the target idles. Only a KO through a side or top
 * blast line counts (an idle target that just falls off the bottom would have
 * recovered). Returns the lowest percent (to `step`) that KOs, or null.
 */
import type { FighterId, InputFrame, StageId } from "./contracts";
import { FULL_CHARGE_DAMAGE_BONUS, createEmptyInput, createGame } from "./engine";
import { getFighterDefinition, type AttackDefinition, type MoveName } from "./roster";

interface Runtime {
  percent: number;
  hitstopFrames: number;
}
interface Internals {
  fighters: [Runtime, Runtime];
  stage: { blastZone: { left: number; right: number; top: number; bottom: number } };
  applyLaunch(
    target: Runtime, attacker: Runtime, damage: number, angle: number,
    baseKnockback: number, growth: number, hitstun: number, input: InputFrame,
  ): void;
}

/** The move's values as its strongest hitbox delivers them. */
export const strongestHit = (move: AttackDefinition) => {
  const hitboxes = move.hitboxes ?? [];
  const strongest = hitboxes.reduce<(typeof hitboxes)[number] | undefined>(
    (best, hitbox) => (hitbox.knockbackMultiplier ?? 1) > (best?.knockbackMultiplier ?? 1) ? hitbox : best,
    undefined,
  );
  const knockbackScale = strongest?.knockbackMultiplier ?? 1;
  return {
    damage: move.damage * (strongest?.damageMultiplier ?? 1),
    angle: strongest?.angle ?? move.angle,
    baseKnockback: (strongest?.baseKnockback ?? move.baseKnockback) * knockbackScale,
    knockbackGrowth: (strongest?.knockbackGrowth ?? move.knockbackGrowth) * knockbackScale,
  };
};

const kos = (
  attacker: FighterId,
  target: FighterId,
  move: MoveName,
  percent: number,
  stage: StageId,
  charge: number,
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
  t.percent = percent;
  const definition = getFighterDefinition(attacker).attacks[move];
  const hit = strongestHit(definition);
  // Charge adds damage only (see the engine's chargeScale).
  const chargeScale = definition.chargeable ? 1 + charge * FULL_CHARGE_DAMAGE_BONUS : 1;
  internals.applyLaunch(t, a, hit.damage * chargeScale, hit.angle, hit.baseKnockback, hit.knockbackGrowth, 0, createEmptyInput());
  t.hitstopFrames = 4;
  for (let frame = 0; frame < 420; frame += 1) {
    const ko = game.step(idle()).events.find(({ type, slot }) => type === "ko" && slot === 1);
    if (ko) return (ko.position?.y ?? 0) > internals.stage.blastZone.bottom;
  }
  return false;
};

export const koPercent = (
  attacker: FighterId,
  target: FighterId,
  move: MoveName,
  { stage = "verdant-grove" as StageId, max = 300, step = 1, charge = 0 } = {},
): number | null => {
  if (!kos(attacker, target, move, max, stage, charge)) return null;
  let low = 0;
  let high = max;
  if (kos(attacker, target, move, low, stage, charge)) return 0;
  while (high - low > step) {
    const middle = Math.floor((low + high) / 2);
    if (kos(attacker, target, move, middle, stage, charge)) high = middle;
    else low = middle;
  }
  return high;
};
