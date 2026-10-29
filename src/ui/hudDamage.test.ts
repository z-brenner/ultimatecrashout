import { describe, expect, it } from "vitest";
import { DAMAGE_COLOR_STOPS, damageColor, formatDamage } from "./hudDamage";
import { portraitCrop } from "./portraitFocus";

const rgb = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

describe("HUD damage readout", () => {
  it("hits each colour stop exactly and clamps outside them", () => {
    for (const [percent, color] of DAMAGE_COLOR_STOPS) expect(damageColor(percent)).toBe(color);
    expect(damageColor(-5)).toBe("#ffffff");
    expect(damageColor(Number.NaN)).toBe("#ffffff");
    expect(damageColor(999)).toBe(DAMAGE_COLOR_STOPS.at(-1)![1]);
  });

  it("warms steadily: blue and green fall as damage rises", () => {
    let previous = rgb(damageColor(0));
    for (let percent = 5; percent <= 200; percent += 5) {
      const [, green, blue] = rgb(damageColor(percent));
      expect(green).toBeLessThanOrEqual(previous[1]!);
      expect(blue).toBeLessThanOrEqual(previous[2]! + 1);
      previous = rgb(damageColor(percent));
    }
    // Halfway between two stops is halfway between their colours.
    expect(rgb(damageColor(90))[1]).toBeCloseTo((0xb1 + 0x5a) / 2, -0.5);
  });

  it("shows whole percent and tenths, without float drift, capped at 999.9", () => {
    expect(formatDamage(0)).toEqual({ whole: "0", tenths: ".0" });
    expect(formatDamage(12.3)).toEqual({ whole: "12", tenths: ".3" });
    expect(formatDamage(0.1 + 0.2)).toEqual({ whole: "0", tenths: ".3" });
    expect(formatDamage(57.99)).toEqual({ whole: "57", tenths: ".9" });
    expect(formatDamage(1234)).toEqual({ whole: "999", tenths: ".9" });
    expect(formatDamage(-3)).toEqual({ whole: "0", tenths: ".0" });
  });
});

describe("portrait head crop", () => {
  /** A width×height RGBA image, opaque inside the given box. */
  const image = (width: number, height: number, box: { left: number; top: number; right: number; bottom: number }) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = box.top; y <= box.bottom; y += 1) {
      for (let x = box.left; x <= box.right; x += 1) data[(y * width + x) * 4 + 3] = 255;
    }
    return data;
  };

  it("frames the top of a tall figure, centred on it", () => {
    // A figure in the lower middle, 40% of the height tall.
    const crop = portraitCrop(image(100, 100, { left: 40, top: 55, right: 59, bottom: 94 }), 100, 100)!;
    expect(crop.size).toBeCloseTo(0.3, 5);
    expect(crop.x + crop.size / 2).toBeCloseTo(0.5, 2);
    // Starts just above the head.
    expect(crop.y).toBeLessThan(0.55);
    expect(crop.y).toBeGreaterThan(0.5);
  });

  it("keeps a wide figure's full width and stays inside the image", () => {
    const crop = portraitCrop(image(100, 100, { left: 2, top: 30, right: 97, bottom: 70 }), 100, 100)!;
    expect(crop.size).toBe(1);
    expect(crop).toMatchObject({ x: 0, y: 0 });
    const corner = portraitCrop(image(100, 100, { left: 0, top: 0, right: 30, bottom: 60 }), 100, 100)!;
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.y).toBeGreaterThanOrEqual(0);
    expect(corner.x + corner.size).toBeLessThanOrEqual(1);
  });

  it("returns nothing for an empty image", () => {
    expect(portraitCrop(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toBeNull();
  });
});
