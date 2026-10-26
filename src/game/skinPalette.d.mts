export interface SkinSwap {
  /** Source colour (#rrggbb); must be saturated enough to match (see isSwappableColor). */
  from: string;
  /** Target colour (#rrggbb). */
  to: string;
  /** Hue distance in degrees matched around `from` (default DEFAULT_SWAP_TOLERANCE). */
  tolerance?: number;
}
export const MIN_SWAP_SATURATION: number;
export const MIN_SWAP_VALUE: number;
export function hueDelta(from: number, to: number): number;
export const DEFAULT_SWAP_TOLERANCE: number;
export const MAX_SKIN_SWAPS: number;
export function parseHexColor(hex: string | undefined): [number, number, number] | null;
export function rgbToHsv(r: number, g: number, b: number): [number, number, number];
export function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number];
export function isSwappableColor(hex: string): boolean;
export function recolorPixels(data: Uint8ClampedArray | Uint8Array, swaps: readonly SkinSwap[]): number;
