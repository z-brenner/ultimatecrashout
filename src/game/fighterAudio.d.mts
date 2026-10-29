export type FighterAudioCueName =
  | "attack"
  | "smash"
  | "special"
  | "jump"
  | "hurt"
  | "ko"
  | "taunt"
  | "victory"
  | "announce";

export const FIGHTER_AUDIO_CUES: Readonly<Record<FighterAudioCueName, string>>;
export const FIGHTER_AUDIO_LIMITS: Readonly<{
  maxVariants: number;
  maxFileBytes: number;
  maxPackBytes: number;
  extensions: readonly string[];
}>;
export function audioMatchesExtension(bytes: Uint8Array, extension: string): boolean;
export function pickVariant(count: number, previous: number, random?: () => number): number;
