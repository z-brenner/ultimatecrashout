import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isSwappableColor, parseHexColor } from "../src/game/skinPalette.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const suggest = (id: string): string =>
  execFileSync(process.execPath, ["scripts/fighter_skins.mjs", id], { encoding: "utf8" });

describe.skipIf(!hasFfmpeg)("fighter:skins suggester", () => {
  it("suggests three valid skins that avoid skin tones", () => {
    const output = suggest("kenney-toon");
    expect(output).toMatch(/looks like skin tone: not suggested/);
    const skins = JSON.parse(output.slice(output.indexOf("[")));
    expect(skins).toHaveLength(3);
    for (const { name, swaps } of skins) {
      expect(name.length).toBeGreaterThan(0);
      for (const { from, to, tolerance } of swaps) {
        expect(isSwappableColor(from)).toBe(true);
        expect(parseHexColor(to)).not.toBeNull();
        expect(tolerance).toBeGreaterThanOrEqual(1);
        expect(tolerance).toBeLessThanOrEqual(90);
      }
    }
  });

  it("keeps a saturated cape apart from a muted face of a similar hue", () => {
    const output = suggest("kaykit-knight");
    const skins = JSON.parse(output.slice(output.indexOf("[")));
    // The cape sits near 355°; the shadowed face near 20° must stay outside the tolerance.
    expect(skins[0].swaps[0].tolerance).toBeLessThan(20);
  });

  it("says when a fighter has nothing to swap", () => {
    expect(suggest("rgs-stick")).toMatch(/leave visual.skins out/);
  });
});
