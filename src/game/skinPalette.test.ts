import { describe, expect, it } from "vitest";
import {
  hsvToRgb,
  isSwappableColor,
  parseHexColor,
  recolorPixels,
  rgbToHsv,
} from "./skinPalette.mjs";

const pixels = (...colors: [number, number, number, number][]) => new Uint8ClampedArray(colors.flat());
const at = (data: Uint8ClampedArray, index: number) => Array.from(data.slice(index * 4, index * 4 + 4));
const CRIMSON = [{ from: "#f6c41a", to: "#c8323c" }];

describe("skin palette", () => {
  it("round-trips colours through HSV", () => {
    for (const hex of ["#f6c41a", "#c8323c", "#20cea6", "#16161c", "#ffffff", "#000000"]) {
      const rgb = parseHexColor(hex)!;
      const back = hsvToRgb(...rgbToHsv(...rgb));
      back.forEach((channel, index) => expect(Math.abs(channel - rgb[index]!)).toBeLessThanOrEqual(1));
    }
    expect(parseHexColor("red")).toBeNull();
  });

  it("only accepts saturated, visible source colours", () => {
    expect(isSwappableColor("#f6c41a")).toBe(true);
    expect(isSwappableColor("#808080")).toBe(false);
    expect(isSwappableColor("#0a0505")).toBe(false);
    expect(isSwappableColor("nope")).toBe(false);
  });

  it("moves the matched colour family and keeps alpha", () => {
    const data = pixels([246, 196, 26, 255], [246, 196, 26, 90]);
    expect(recolorPixels(data, CRIMSON)).toBe(2);
    const [r, g, b, a] = at(data, 0);
    expect([r, g, b]).toEqual(parseHexColor("#c8323c"));
    expect(a).toBe(255);
    expect(at(data, 1)[3]).toBe(90);
  });

  it("keeps each pixel's shading relative to the source colour", () => {
    const data = pixels([246, 196, 26, 255], [123, 98, 13, 255]);
    recolorPixels(data, CRIMSON);
    const light = rgbToHsv(...(at(data, 0).slice(0, 3) as [number, number, number]));
    const dark = rgbToHsv(...(at(data, 1).slice(0, 3) as [number, number, number]));
    expect(Math.abs(light[0] - dark[0])).toBeLessThan(3);
    expect(dark[2] / light[2]).toBeCloseTo(0.5, 1);
  });

  it("never touches outlines, greys, whites, transparent pixels, or other hues", () => {
    const untouched: [number, number, number, number][] = [
      [22, 22, 28, 255],
      [128, 128, 128, 255],
      [255, 255, 255, 255],
      [246, 196, 26, 0],
      [40, 90, 230, 255],
    ];
    const data = pixels(...untouched);
    expect(recolorPixels(data, CRIMSON)).toBe(0);
    expect(Array.from(data)).toEqual(untouched.flat());
  });

  it("fades out toward the tolerance edge instead of banding", () => {
    const [h, s, v] = rgbToHsv(246, 196, 26);
    const shifted = (degrees: number) => hsvToRgb(h + degrees, s, v);
    const data = pixels([...shifted(4), 255], [...shifted(16), 255], [...shifted(22), 255], [...shifted(30), 255]);
    const before = Array.from(data);
    recolorPixels(data, CRIMSON);
    const moved = [0, 1, 2, 3].map((index) =>
      Math.abs(data[index * 4]! - before[index * 4]!) + Math.abs(data[index * 4 + 1]! - before[index * 4 + 1]!));
    expect(moved[0]).toBeGreaterThan(moved[1]!);
    expect(moved[1]).toBeGreaterThan(moved[2]!);
    expect(moved[2]).toBeGreaterThan(0);
    expect(moved[3]).toBe(0);
  });

  it("applies the closest of several swaps", () => {
    const data = pixels([246, 196, 26, 255], [255, 84, 60, 255]);
    recolorPixels(data, [
      { from: "#f6c41a", to: "#20cea6" },
      { from: "#ff543c", to: "#2a6cff" },
    ]);
    expect(at(data, 0).slice(0, 3)).toEqual(parseHexColor("#20cea6"));
    expect(at(data, 1).slice(0, 3)).toEqual(parseHexColor("#2a6cff"));
  });
});
