#!/usr/bin/env node
/**
 * Suggests palette-swap skins for a fighter pack from its own atlases.
 *
 *   npm run fighter:skins -- <id>             print colour families and a suggested visual.skins
 *   npm run fighter:skins -- <id> --preview   also write .generated/skins/<id>.png (original + each skin)
 *   npm run fighter:skins -- <id> --write     store the suggestion (or the current skins) in fighter.json
 *
 * Suggestions are a starting point: review the preview (or the Lab, with
 * `npm run dev`) and adjust names, colours, and tolerances by hand.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIN_SWAP_SATURATION,
  hsvToRgb,
  parseHexColor,
  recolorPixels,
  rgbToHsv,
} from "../src/game/skinPalette.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const id = args.find((argument) => !argument.startsWith("--"));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!id) fail("Usage: npm run fighter:skins -- <fighter-id> [--preview] [--write]");

const packPath = join(root, "fighters", id, "fighter.json");
if (!existsSync(packPath)) fail(`Fighter pack not found: fighters/${id}/fighter.json`);
const pack = JSON.parse(readFileSync(packPath, "utf8"));

/** Slots sampled for colour statistics: neutral poses show the whole body. */
const SAMPLE_SLOTS = ["idle", "run", "jab", "victory"];
/** Named targets for suggestions; chosen far from the fighter's own hues. */
const PALETTE = [
  ["Crimson", "#c8323c"],
  ["Ember", "#f07828"],
  ["Gold", "#f0b428"],
  ["Emerald", "#23a55a"],
  ["Teal", "#18b4a0"],
  ["Cobalt", "#2a5cdc"],
  ["Violet", "#7c3ce0"],
  ["Rose", "#e0508c"],
];

const hex = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
const hueDistance = (left, right) => {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
};

const decodeAtlas = (slot) => {
  const path = join(root, "public/assets/characters/open", id, "00", `${slot}.webp`);
  if (!existsSync(path)) return null;
  const { streams } = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", path]));
  const { width, height } = streams[0];
  const raw = execFileSync("ffmpeg", ["-v", "quiet", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {
    maxBuffer: 1 << 28,
  });
  return { width, height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) };
};

const atlases = SAMPLE_SLOTS.map(decodeAtlas).filter(Boolean);
if (atlases.length === 0) fail(`${id}: no built atlases; run npm run fighter:build -- ${id} first`);

// Colour families: 10° hue bins over saturated, visible, opaque pixels.
const BINS = 36;
const bins = new Map();
let opaque = 0;
for (const { data } of atlases) {
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128) continue;
    opaque += 1;
    const [hue, saturation, value] = rgbToHsv(data[index], data[index + 1], data[index + 2]);
    if (saturation < MIN_SWAP_SATURATION || value < 0.08) continue;
    const bin = Math.round(hue / (360 / BINS)) % BINS;
    const entry = bins.get(bin) ?? { count: 0, x: 0, y: 0, saturation: 0, value: 0 };
    entry.count += 1;
    // Circular mean, so reds either side of 0° average correctly.
    entry.x += Math.cos((hue * Math.PI) / 180);
    entry.y += Math.sin((hue * Math.PI) / 180);
    entry.saturation += saturation;
    entry.value += value;
    bins.set(bin, entry);
  }
}

// Grow families from the largest bin outward through neighbouring bins of
// similar saturation. A saturation jump splits a family even when hues touch:
// a red cape (saturated) next to a shadowed face (muted) must stay separate.
const families = [];
const remaining = new Map(bins);
const meanSaturation = (entry) => entry.saturation / entry.count;
while (remaining.size > 0) {
  const [seed, seedEntry] = [...remaining.entries()].sort((left, right) => right[1].count - left[1].count)[0];
  const family = { count: 0, x: 0, y: 0, saturation: 0, value: 0 };
  const absorb = (bin) => {
    const entry = remaining.get(bin);
    for (const key of Object.keys(family)) family[key] += entry[key];
    remaining.delete(bin);
  };
  absorb(seed);
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 3; step += 1) {
      const bin = (seed + direction * step + BINS) % BINS;
      const entry = remaining.get(bin);
      if (!entry || Math.abs(meanSaturation(entry) - meanSaturation(seedEntry)) > 0.18) break;
      absorb(bin);
    }
  }
  const hue = ((Math.atan2(family.y, family.x) * 180) / Math.PI + 360) % 360;
  const saturation = family.saturation / family.count;
  const value = family.value / family.count;
  families.push({
    hue,
    saturation,
    value,
    share: family.count / opaque,
    color: hex(hsvToRgb(hue, saturation, value)),
    // Warm, moderately saturated, light: recolouring it would recolour faces and hands.
    skinTone: hue >= 8 && hue <= 45 && saturation >= 0.15 && saturation <= 0.62 && value >= 0.5,
  });
}

const visible = families.filter(({ share }) => share >= 0.01);
// A swap is only noticeable on a family that is large, saturated, and bright
// enough: rank by that salience rather than by pixel count alone.
const salience = ({ share, saturation, value }) => share * saturation * value;
const MIN_SALIENCE = 0.01;
for (const family of visible) family.salience = salience(family);
console.log(`${id}: colour families in ${atlases.length} atlases (share of opaque pixels)`);
for (const family of visible) {
  console.log(
    `  ${family.color}  hue ${Math.round(family.hue).toString().padStart(3)}°  ` +
    `${(family.share * 100).toFixed(1).padStart(5)}%  salience ${salience(family).toFixed(3)}` +
    `${family.skinTone ? "  (looks like skin tone: not suggested)" : ""}`,
  );
}

const target = visible
  .filter(({ skinTone }) => !skinTone)
  .sort((left, right) => right.salience - left.salience)
  .find((family) => family.salience >= MIN_SALIENCE);
let suggestion = null;
if (!target) {
  console.log(
    `\n${id} has no colour family large, saturated, and bright enough for a visible swap ` +
    "(outlines, greys, and near-blacks never change).\nPalette skins cannot distinguish it; leave visual.skins out.",
  );
} else {
  // Stay clear of other families (e.g. skin tone) so they are not swept up.
  const nearest = visible
    .filter((family) => family !== target)
    .map((family) => hueDistance(family.hue, target.hue))
    .reduce((minimum, distance) => Math.min(minimum, distance), Infinity);
  const tolerance = Math.max(10, Math.min(30, Math.floor(nearest - 8)));
  // Farthest hues from the original first; picks spread apart, relaxing the
  // spacing when the palette cannot fit three widely spaced targets.
  const candidates = PALETTE
    .map(([name, color]) => ({ name, hue: rgbToHsv(...parseHexColor(color))[0] }))
    .sort((left, right) => hueDistance(right.hue, target.hue) - hueDistance(left.hue, target.hue));
  let picks = [];
  for (const spacing of [70, 45, 30]) {
    picks = [];
    for (const candidate of candidates) {
      if (hueDistance(candidate.hue, target.hue) < 60) continue;
      if (picks.some((pick) => hueDistance(pick.hue, candidate.hue) < spacing)) continue;
      picks.push(candidate);
      if (picks.length === 3) break;
    }
    if (picks.length === 3) break;
  }
  suggestion = picks.map(({ name, hue }) => ({
    name,
    // Keeps the fighter's own saturation and brightness, so a muted outfit
    // stays muted, but lifts very dark or dull families enough to read.
    swaps: [{
      from: target.color,
      to: hex(hsvToRgb(hue, Math.max(target.saturation, 0.45), Math.max(target.value, 0.4))),
      tolerance,
    }],
  }));
  console.log(`\nSuggested visual.skins (recolours the ${target.color} family, tolerance ${tolerance}°):`);
  console.log(JSON.stringify(suggestion, null, 2));
}

const skins = pack.visual.skins ?? suggestion;

if (args.includes("--preview") && skins) {
  const { width, height, data } = atlases[0];
  const cellHeight = Math.min(height, 192);
  const frameWidth = Math.min(width, 192 * 4);
  const rows = [data, ...skins.map(({ swaps }) => {
    const copy = data.slice();
    recolorPixels(copy, swaps);
    return copy;
  })];
  const sheet = Buffer.concat(rows.map((pixels) => {
    const strip = Buffer.alloc(frameWidth * cellHeight * 4);
    for (let y = 0; y < cellHeight; y += 1) {
      Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, frameWidth * 4).copy(strip, y * frameWidth * 4);
    }
    return strip;
  }));
  const output = join(root, ".generated/skins", `${id}.png`);
  mkdirSync(dirname(output), { recursive: true });
  execFileSync("ffmpeg", [
    "-v", "quiet", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${frameWidth}x${cellHeight * rows.length}`, "-i", "-", output,
  ], { input: sheet });
  console.log(`\nPreview (original, then ${skins.map(({ name }) => name).join(", ")}): ${output}`);
}

if (args.includes("--write")) {
  if (!suggestion && !pack.visual.skins) fail(`${id}: nothing to write`);
  pack.visual.skins = pack.visual.skins ?? suggestion;
  writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`\nWrote visual.skins to fighters/${id}/fighter.json; run npm run fighter:build to validate.`);
}
