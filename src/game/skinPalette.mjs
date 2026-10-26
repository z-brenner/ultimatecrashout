/**
 * Palette-swap skins: recolour sprite pixels whose hue matches a pack-declared
 * source colour, keeping each pixel's shading. Pure (no DOM) so the browser
 * runtime, the pack validator, and the skin suggester share one definition.
 */

/** Below this saturation a pixel is neutral (outlines, whites, greys) and never recoloured. */
export const MIN_SWAP_SATURATION = 0.18;
/** Below this value a pixel is near-black shading and never recoloured. */
export const MIN_SWAP_VALUE = 0.08;
export const DEFAULT_SWAP_TOLERANCE = 24;
export const MAX_SKIN_SWAPS = 6;

export const parseHexColor = (hex) => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

/** RGB 0–255 → [hue 0–360, saturation 0–1, value 0–1]. */
export const rgbToHsv = (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : delta / max, max / 255];
};

export const hsvToRgb = (hue, saturation, value) => {
  const chroma = value * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second];
  const offset = value - chroma;
  return [
    Math.round((r + offset) * 255),
    Math.round((g + offset) * 255),
    Math.round((b + offset) * 255),
  ];
};

/** Signed shortest hue difference, in (-180, 180]. */
export const hueDelta = (from, to) => {
  const delta = (((to - from) % 360) + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
};

/** Whether a colour is saturated and bright enough to act as a swap source. */
export const isSwappableColor = (hex) => {
  const rgb = parseHexColor(hex);
  if (!rgb) return false;
  const [, saturation, value] = rgbToHsv(...rgb);
  return saturation >= MIN_SWAP_SATURATION && value >= MIN_SWAP_VALUE;
};

export const compileSwaps = (swaps) => swaps.map(({ from, to, tolerance = DEFAULT_SWAP_TOLERANCE }) => {
  const [fromHue, fromSaturation, fromValue] = rgbToHsv(...parseHexColor(from));
  const [toHue, toSaturation, toValue] = rgbToHsv(...parseHexColor(to));
  return {
    fromHue,
    toHue,
    saturationScale: toSaturation / Math.max(0.01, fromSaturation),
    valueScale: toValue / Math.max(0.01, fromValue),
    tolerance,
    // The swap fades in above the neutral threshold over this width, and is
    // at full strength by the source colour's own saturation, so a muted
    // source family (steel, camo) is recoloured fully, not partly.
    neutralFade: Math.min(MIN_SWAP_SATURATION, Math.max(0.04, fromSaturation - MIN_SWAP_SATURATION)),
  };
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** New colour for one opaque pixel, or null when no swap applies. */
const swapColor = (r, g, b, compiled) => {
  const [hue, saturation, value] = rgbToHsv(r, g, b);
  if (saturation < MIN_SWAP_SATURATION || value < MIN_SWAP_VALUE) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const swap of compiled) {
    const distance = Math.abs(hueDelta(swap.fromHue, hue));
    if (distance <= swap.tolerance && distance < bestDistance) {
      best = swap;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  // Full strength in the inner half of the tolerance, fading to zero at its
  // edge, so gradients into neighbouring hues do not band.
  const edge = clamp01((best.tolerance - bestDistance) / (best.tolerance * 0.5));
  const weight = edge * edge * (3 - 2 * edge);
  // Fade the swap out across the neutral threshold too.
  const neutral = clamp01((saturation - MIN_SWAP_SATURATION) / best.neutralFade);
  const strength = weight * neutral;
  if (strength <= 0) return null;
  const [tr, tg, tb] = hsvToRgb(
    best.toHue + hueDelta(best.fromHue, hue),
    clamp01(saturation * best.saturationScale),
    clamp01(value * best.valueScale),
  );
  return [
    Math.round(r + (tr - r) * strength),
    Math.round(g + (tg - g) * strength),
    Math.round(b + (tb - b) * strength),
  ];
};

/**
 * Recolours RGBA pixels in place. Alpha is never changed, so sprite bounds
 * and anchoring are identical across skins. Returns the number of pixels changed.
 */
export const recolorPixels = (data, swaps) => {
  const compiled = compileSwaps(swaps);
  // Sprite art repeats colours heavily; memoise per RGB triple.
  const memo = new Map();
  let changed = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const key = (data[index] << 16) | (data[index + 1] << 8) | data[index + 2];
    let result = memo.get(key);
    if (result === undefined) {
      result = swapColor(data[index], data[index + 1], data[index + 2], compiled);
      memo.set(key, result);
    }
    if (result === null) continue;
    data[index] = result[0];
    data[index + 1] = result[1];
    data[index + 2] = result[2];
    changed += 1;
  }
  return changed;
};
