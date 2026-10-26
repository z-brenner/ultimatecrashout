import { describe, expect, it } from "vitest";
import {
  CHARACTER_PORTRAITS,
  FIGHTER_VISUAL_MANIFESTS,
  isFighterProductionReady,
  isFighterVisualReady,
} from "./characterAssets";
import { FIGHTER_SKINS, SKIN_IDS } from "./content";
import { FIGHTER_IDS, OPEN_2D_FIGHTER_IDS } from "./roster";

describe("fighter skins", () => {
  it("declares the rendered skin plus each fighter's palette skins", () => {
    expect(SKIN_IDS).toEqual(["00", "01", "02", "03"]);
    for (const fighter of FIGHTER_IDS) {
      const skins = FIGHTER_SKINS[fighter];
      const palettes = FIGHTER_VISUAL_MANIFESTS[fighter].skinPalettes;
      expect(skins.map(({ id }) => id)).toEqual(["00", ...Object.keys(palettes)]);
      expect(skins[0]).toMatchObject({ label: "Classic", swaps: [] });
      for (const skin of skins) {
        // Every skin recolours the one rendered portrait.
        expect(skin.portrait).toBe(`/assets/ui/fighters/${fighter}/select/00.png`);
        expect(skin.visualReady).toBe(isFighterVisualReady(fighter));
        expect(skin.productionReady).toBe(isFighterProductionReady(fighter));
        if (skin.id !== "00") {
          expect(skin.label).toBe(palettes[skin.id]?.name);
          expect(skin.swaps.length).toBeGreaterThan(0);
        }
      }
      expect(CHARACTER_PORTRAITS[fighter]).toBe(skins[0]?.portrait);
    }
    expect(OPEN_2D_FIGHTER_IDS.every(isFighterVisualReady)).toBe(true);
    expect(FIGHTER_SKINS.buckle.map(({ label }) => label)).toEqual(["Classic", "Cobalt", "Mint", "Rose"]);
  });

  it("keeps authored materials unfiltered", () => {
    for (const skins of Object.values(FIGHTER_SKINS)) {
      expect(skins.every(({ filter }) => filter === "none")).toBe(true);
    }
  });
});
