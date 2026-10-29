/**
 * Per-fighter sound cues: the contract shared by the fighter pack validator
 * (scripts/fighter_packs.mjs) and the audio engine (src/game/audio.ts).
 */

/** Every cue a pack may declare, and when the game plays it. */
export const FIGHTER_AUDIO_CUES = Object.freeze({
  attack: "starting a normal attack (jab, tilts, aerials, dash attack)",
  smash: "starting a smash attack; falls back to attack",
  special: "starting a special move; falls back to attack",
  jump: "jumping",
  hurt: "taking a hit of 5% or more (not on super armor)",
  ko: "being KO'd off a blast line",
  taunt: "taunting; falls back to attack",
  victory: "winning a match",
  announce: "being picked on the character select screen",
});

/** Limits the validator enforces; the game assumes them. */
export const FIGHTER_AUDIO_LIMITS = Object.freeze({
  /** Files per cue; one is picked at random each time the cue plays. */
  maxVariants: 4,
  maxFileBytes: 256 * 1024,
  /** Distinct files in one pack, all cues together. */
  maxPackBytes: 2 * 1024 * 1024,
  extensions: Object.freeze([".ogg", ".mp3", ".m4a", ".wav"]),
});

const ascii = (bytes, offset, text) =>
  bytes.length >= offset + text.length &&
  [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

/**
 * Whether a file's first bytes match its extension, so a renamed or broken
 * file fails validation instead of failing silently in the browser.
 */
export const audioMatchesExtension = (bytes, extension) => {
  switch (extension) {
    case ".ogg":
      return ascii(bytes, 0, "OggS");
    case ".mp3":
      // An ID3 tag, or a bare MPEG frame sync.
      return ascii(bytes, 0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case ".m4a":
      return ascii(bytes, 4, "ftyp");
    case ".wav":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE");
    default:
      return false;
  }
};

/**
 * Index of the variant to play: random, but never the one played last time
 * when there is a choice (`previous` is -1 the first time).
 */
export const pickVariant = (count, previous, random = Math.random) => {
  if (count <= 1) return 0;
  if (previous < 0 || previous >= count) return Math.floor(random() * count);
  const pick = Math.floor(random() * (count - 1));
  return pick >= previous ? pick + 1 : pick;
};
