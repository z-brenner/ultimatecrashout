import { describe, expect, it } from "vitest";
import {
  applyAttackOverrides,
  applyThrowOverrides,
  buildStandardAttacks,
  standardThrows,
} from "./fighterBuilders";
import { createOpenFighter, type OpenFighterSeed } from "./openRoster";
import { ROSTER } from "./roster";

const specials = {
  "neutral-special": { label: "Bolt", damage: 8 },
  "side-special": { label: "Rush", damage: 10 },
  "up-special": { label: "Rise", damage: 7 },
  "down-special": { label: "Slam", damage: 12 },
} as const;

const seed: OpenFighterSeed = {
  id: "rgs-stick",
  displayName: "Override Test",
  archetype: "Test",
  playstyle: "Test",
  colors: { primary: "#000000", secondary: "#111111", accent: "#222222" },
  size: { width: 60, height: 90 },
  spriteReferenceHeight: 130,
  weight: 100,
  dash: 1.7,
  dashFrames: 8,
  run: 1.6,
  air: 1,
  gravity: 0.1,
  fall: 2.1,
  fastFall: 2.9,
  jump: 2.6,
  doubleJump: 2.35,
  jumpSquat: 4,
  shortHop: 0.63,
  specials,
};

describe("fighter pack gameplay overrides", () => {
  it("leaves the generated kit untouched without overrides", () => {
    const generated = buildStandardAttacks({ fighterName: "Override Test", specials });
    expect(applyAttackOverrides(generated)).toEqual(generated);
    expect(createOpenFighter(seed).attacks).toEqual(generated);
    expect(createOpenFighter(seed).maxJumps).toBe(2);
  });

  it("layers authored frame data and hitboxes over one move only", () => {
    const generated = buildStandardAttacks({ fighterName: "Override Test", specials });
    const hitboxes = [{ offset: { x: 40, y: 8 }, radius: 12, kind: "sweet" as const }];
    const attacks = applyAttackOverrides(generated, {
      "forward-smash": { damage: 22, baseKnockback: 70, startup: 18, hitboxes },
    });
    expect(attacks["forward-smash"]).toMatchObject({
      damage: 22,
      baseKnockback: 70,
      startup: 18,
      hitboxes,
      // Untouched fields and generated mechanics survive.
      chargeable: true,
      active: generated["forward-smash"].active,
      // Derived values follow the authored damage.
      hitstop: 10,
      shieldDamage: 22 * 0.75 + 2,
    });
    expect(attacks.jab).toBe(generated.jab);
  });

  it("keeps an explicitly authored derived value", () => {
    const generated = buildStandardAttacks({ fighterName: "Override Test", specials });
    const attacks = applyAttackOverrides(generated, { jab: { damage: 20, hitstop: 4 } });
    expect(attacks.jab.hitstop).toBe(4);
  });

  it("applies throws, jumps, and shield overrides from a seed", () => {
    const fighter = createOpenFighter({
      ...seed,
      maxJumps: 3,
      shieldHealth: 80,
      throws: { up: { damage: 12 } },
      attacks: { "up-special": { label: "Big Rise", movement: { x: 0, y: 800 } } },
    });
    expect(fighter.maxJumps).toBe(3);
    expect(fighter.shieldHealth).toBe(80);
    expect(fighter.throws.up).toEqual({ ...standardThrows().up, damage: 12 });
    expect(fighter.throws.forward).toEqual(standardThrows().forward);
    expect(fighter.attacks["up-special"]).toMatchObject({ label: "Big Rise", movement: { x: 0, y: 800 } });
    expect(applyThrowOverrides(standardThrows())).toEqual(standardThrows());
  });

  it("does not change any shipped fighter that declares no overrides", () => {
    for (const fighter of Object.values(ROSTER)) {
      expect(fighter.maxJumps).toBe(2);
      expect(Object.keys(fighter.attacks)).toHaveLength(17);
    }
  });
});
