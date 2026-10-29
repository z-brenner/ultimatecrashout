/**
 * The battle HUD's damage readout: Smash-style, the number warms from white
 * through yellow and orange to a deep red as a fighter nears a KO.
 */

/** Percent → colour stops; between stops the colour is interpolated. */
export const DAMAGE_COLOR_STOPS: ReadonlyArray<readonly [percent: number, color: string]> = [
  [0, "#ffffff"],
  [35, "#fff07a"],
  [70, "#ffb13b"],
  [110, "#ff5a36"],
  [150, "#e3122a"],
  [200, "#8f0b1e"],
];

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

export const damageColor = (percent: number): string => {
  const value = Number.isFinite(percent) ? Math.max(0, percent) : 0;
  const upper = DAMAGE_COLOR_STOPS.findIndex(([stop]) => stop >= value);
  if (upper <= 0) return upper === 0 ? DAMAGE_COLOR_STOPS[0]![1] : DAMAGE_COLOR_STOPS.at(-1)![1];
  const [fromPercent, fromColor] = DAMAGE_COLOR_STOPS[upper - 1]!;
  const [toPercent, toColor] = DAMAGE_COLOR_STOPS[upper]!;
  const ratio = (value - fromPercent) / (toPercent - fromPercent);
  const from = channels(fromColor);
  const to = channels(toColor);
  return toHex(from.map((channel, index) => channel + (to[index]! - channel) * ratio));
};

/** Damage in whole tenths of a percent, as shown: 0–9999. */
export const damageTenths = (percent: number): number => {
  const value = Number.isFinite(percent) ? Math.min(999.9, Math.max(0, percent)) : 0;
  // The epsilon keeps 12.3 from flooring to 12.2 through float error.
  return Math.floor(value * 10 + 1e-6);
};

/** Whole percent and tenths, as the HUD shows them ("34" and ".5"), capped at 999.9. */
export const formatDamage = (percent: number): { whole: string; tenths: string } => {
  const tenths = damageTenths(percent);
  return { whole: String(Math.floor(tenths / 10)), tenths: `.${tenths % 10}` };
};

/** What a screen reader hears for a stock row. */
export const stockLabel = (stocks: number): string => `${stocks} stock${stocks === 1 ? "" : "s"} left`;

/** Above this many stocks the HUD shows one icon and a count instead of a row. */
export const MAX_STOCK_ICONS = 5;
