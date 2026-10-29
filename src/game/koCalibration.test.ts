import { describe, expect, it } from "vitest";
import { OPEN_FIGHTER_IDS, type FighterId } from "./contracts";
import { koPercent, kosAt } from "./koMeasure";
import { getFighterDefinition, type MoveName } from "./roster";

/**
 * KO timing pinned to Smash Ultimate's ranges. Each number is the lowest
 * percent at which the move KOs a mid-weight (Kaykit Knight, weight 103)
 * from centre stage on Verdant Grove: uncharged, strongest hitbox, no DI,
 * as Smash KO tables are measured. Bands are Ultimate's typical values for
 * the move class, with room for each fighter's own tuning.
 */
const MID: FighterId = "kaykit-knight";

const STANDARD_BANDS: ReadonlyArray<[MoveName, number, number]> = [
  ["forward-smash", 95, 125],
  ["up-smash", 105, 140],
  ["down-smash", 105, 145],
  ["forward-tilt", 140, 220],
  ["forward-air", 115, 165],
  ["back-air", 120, 175],
  ["up-air", 160, 240],
];

describe("KO timing (Smash Ultimate ranges)", () => {
  it.each(STANDARD_BANDS)("a standard fighter's %s KOs a mid-weight at %i to %i percent", (move, low, high) => {
    const percent = koPercent(MID, MID, move, { step: 2 });
    expect(percent).not.toBeNull();
    expect(percent!).toBeGreaterThanOrEqual(low);
    expect(percent!).toBeLessThanOrEqual(high);
  });

  it("keeps every fighter's uncharged smashes and normals out of early-KO territory", () => {
    const early: string[] = [];
    for (const fighter of OPEN_FIGHTER_IDS) {
      for (const move of Object.keys(getFighterDefinition(fighter).attacks) as MoveName[]) {
        // Smash's strongest uncharged moves (heavies' smashes, charge punches)
        // KO around 70-90%; nothing uncharged should KO a mid-weight sooner.
        // Knockback grows with percent, so surviving 69% means surviving below it.
        if (kosAt(fighter, MID, move, 69)) early.push(`${fighter} ${move} ${koPercent(fighter, MID, move)}%`);
      }
    }
    expect(early).toEqual([]);
  }, 30_000);

  it("makes heavy hitters KO earlier and light ones later, through damage", () => {
    const fsmash = (fighter: FighterId) => koPercent(fighter, MID, "forward-smash", { step: 2 })!;
    expect(fsmash("yeti")).toBeLessThan(fsmash(MID) - 10);
    expect(fsmash("rgs-stick")).toBeGreaterThan(fsmash(MID) + 8);
  });

  it("lets heavier targets survive longer", () => {
    const against = (target: FighterId) => koPercent(MID, target, "forward-smash", { step: 2 })!;
    expect(against("rgs-stick")).toBeLessThan(against(MID));
    expect(against("yeti")).toBeGreaterThan(against(MID));
  });

  it("charges a smash to about Smash's full-charge KO percent", () => {
    const full = koPercent(MID, MID, "forward-smash", { step: 2, charge: 1 })!;
    const uncharged = koPercent(MID, MID, "forward-smash", { step: 2 })!;
    expect(full).toBeGreaterThanOrEqual(55);
    expect(full).toBeLessThanOrEqual(85);
    expect(uncharged - full).toBeGreaterThan(25);
  });
});
