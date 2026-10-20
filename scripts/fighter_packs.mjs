#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = resolve(process.env.FIGHTER_PACKS_ROOT ?? join(projectRoot, "fighters"));
const registryOut = resolve(
  process.env.FIGHTER_REGISTRY_OUT ?? join(projectRoot, "src/game/generated/openFighterRegistry.ts"),
);
const manifest3DOut = resolve(
  process.env.OPEN_3D_MANIFEST_OUT ?? join(projectRoot, "scripts/open_fighter_pipeline/manifest.json"),
);
const manifest2DOut = resolve(
  process.env.OPEN_2D_MANIFEST_OUT ?? join(projectRoot, "scripts/open_fighter_pipeline/2d_manifest.json"),
);
const pipelineConfigPath = join(packRoot, "pipeline.config.json");
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);

const SPECIAL_NAMES = ["neutral-special", "side-special", "up-special", "down-special"];
const MOVE_NAMES = new Set([
  "jab", "dash-attack", "forward-tilt", "up-tilt", "down-tilt",
  "forward-smash", "up-smash", "down-smash", "neutral-air", "forward-air",
  "back-air", "up-air", "down-air", ...SPECIAL_NAMES,
]);
const MATERIALS = new Set([
  "physical", "blade", "heavy", "fire", "electric", "energy", "wind", "water",
]);
const TRAITS = new Set(["blade", "heavy", "electric"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const fail = (message) => {
  throw new Error(message);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const validUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const validateCommon = (pack, directoryName) => {
  assert(isObject(pack), `${directoryName}: fighter.json must contain an object`);
  assert(pack.schemaVersion === 1, `${directoryName}: schemaVersion must equal 1`);
  assert(pack.status === "draft" || pack.status === "ready", `${directoryName}: invalid status`);
  assert(nonEmpty(pack.id) && ID_PATTERN.test(pack.id), `${directoryName}: invalid id`);
  assert(pack.id === directoryName, `${directoryName}: id ${pack.id} does not match the directory`);
  assert(pack.kind === "2d" || pack.kind === "3d", `${pack.id}: kind must be 2d or 3d`);
  assert(positiveInteger(pack.order), `${pack.id}: order must be a positive integer`);
  assert(isObject(pack.identity), `${pack.id}: identity is missing`);
  for (const key of ["displayName", "archetype", "playstyle"]) {
    assert(nonEmpty(pack.identity[key]), `${pack.id}: identity.${key} is missing`);
  }
  assert(isObject(pack.identity.colors), `${pack.id}: identity.colors is missing`);
  for (const key of ["primary", "secondary", "accent"]) {
    assert(COLOR_PATTERN.test(pack.identity.colors[key] ?? ""), `${pack.id}: invalid ${key} color`);
  }
};

const THROW_NAMES = new Set(["forward", "back", "up", "down"]);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value) => finite(value) && value >= 0;
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isVec2 = (value) => isObject(value) && finite(value.x) && finite(value.y);
const ATTACK_FIELD_CHECKS = {
  label: [nonEmpty, "a non-empty string"],
  startup: [positiveInteger, "a positive integer (frames)"],
  active: [positiveInteger, "a positive integer (frames)"],
  recovery: [nonNegativeInteger, "a non-negative integer (frames)"],
  damage: [nonNegative, "a non-negative number"],
  angle: [finite, "a number (degrees)"],
  baseKnockback: [nonNegative, "a non-negative number"],
  knockbackGrowth: [nonNegative, "a non-negative number"],
  hitstop: [nonNegativeInteger, "a non-negative integer (frames)"],
  hitstun: [nonNegativeInteger, "a non-negative integer (frames)"],
  radius: [positive, "a positive number"],
  offset: [isVec2, "an {x, y} vector"],
  shieldDamage: [nonNegative, "a non-negative number"],
  chargeable: [(value) => typeof value === "boolean", "a boolean"],
  maxChargeFrames: [positiveInteger, "a positive integer (frames)"],
  movement: [isVec2, "an {x, y} vector"],
  airMovement: [isVec2, "an {x, y} vector"],
  selfDamage: [nonNegative, "a non-negative number"],
  multiHit: [positiveInteger, "a positive integer"],
  hitboxes: [Array.isArray, "an array"],
  landingLag: [nonNegativeInteger, "a non-negative integer (frames)"],
};
const AERIAL_MOVES = new Set(["neutral-air", "forward-air", "back-air", "up-air", "down-air"]);

const validateFrameWindow = (id, where, window) => {
  assert(isObject(window), `${id}: ${where} must be an object with start and end`);
  assert(nonNegativeInteger(window.start) && nonNegativeInteger(window.end),
    `${id}: ${where}.start and end must be non-negative integers (move frames)`);
  assert(window.end >= window.start, `${id}: ${where}.end is before start`);
  for (const key of Object.keys(window)) {
    assert(key === "start" || key === "end", `${id}: unknown field ${where}.${key}`);
  }
};
const HITBOX_KINDS = new Set(["sweet", "normal", "sour"]);

const validateHitbox = (id, where, hitbox) => {
  assert(isObject(hitbox), `${id}: ${where} must be an object`);
  assert(isVec2(hitbox.offset), `${id}: ${where}.offset must be an {x, y} vector`);
  assert(positive(hitbox.radius), `${id}: ${where}.radius must be a positive number`);
  assert(hitbox.endOffset === undefined || isVec2(hitbox.endOffset), `${id}: ${where}.endOffset must be an {x, y} vector`);
  for (const key of ["activeStart", "activeEnd"]) {
    assert(hitbox[key] === undefined || nonNegativeInteger(hitbox[key]), `${id}: ${where}.${key} must be a non-negative integer`);
  }
  assert(hitbox.activeStart === undefined || hitbox.activeEnd === undefined || hitbox.activeEnd >= hitbox.activeStart,
    `${id}: ${where}.activeEnd is before activeStart`);
  for (const key of ["damageMultiplier", "knockbackMultiplier"]) {
    assert(hitbox[key] === undefined || nonNegative(hitbox[key]), `${id}: ${where}.${key} must be a non-negative number`);
  }
  assert(hitbox.priority === undefined || finite(hitbox.priority), `${id}: ${where}.priority must be a number`);
  assert(hitbox.angle === undefined || finite(hitbox.angle), `${id}: ${where}.angle must be a number (degrees)`);
  for (const key of ["baseKnockback", "knockbackGrowth"]) {
    assert(hitbox[key] === undefined || nonNegative(hitbox[key]), `${id}: ${where}.${key} must be a non-negative number`);
  }
  assert(hitbox.kind === undefined || HITBOX_KINDS.has(hitbox.kind), `${id}: ${where}.kind must be sweet, normal, or sour`);
};

const validateGameplayOverrides = (id, gameplay) => {
  if (gameplay.attacks !== undefined) {
    assert(isObject(gameplay.attacks), `${id}: gameplay.attacks must be an object`);
    for (const [move, override] of Object.entries(gameplay.attacks)) {
      assert(MOVE_NAMES.has(move), `${id}: unknown move gameplay.attacks.${move}`);
      assert(isObject(override), `${id}: gameplay.attacks.${move} must be an object`);
      for (const [field, value] of Object.entries(override)) {
        const check = ATTACK_FIELD_CHECKS[field];
        // Less common mechanics (projectiles, specialMovement, counters…) are
        // typed by the engine; the generic checks cover the frame-data core.
        if (!check) continue;
        assert(check[0](value), `${id}: gameplay.attacks.${move}.${field} must be ${check[1]}`);
      }
      for (const [index, hitbox] of (override.hitboxes ?? []).entries()) {
        validateHitbox(id, `gameplay.attacks.${move}.hitboxes[${index}]`, hitbox);
      }
      for (const key of ["landingLag", "autoCancel"]) {
        assert(override[key] === undefined || AERIAL_MOVES.has(move),
          `${id}: gameplay.attacks.${move}.${key} only applies to aerials`);
      }
      if (override.autoCancel !== undefined) {
        const window = override.autoCancel;
        const where = `gameplay.attacks.${move}.autoCancel`;
        assert(isObject(window) && (window.before !== undefined || window.after !== undefined),
          `${id}: ${where} must set before and/or after`);
        for (const key of Object.keys(window)) {
          assert(key === "before" || key === "after", `${id}: unknown field ${where}.${key}`);
          assert(nonNegativeInteger(window[key]),
            `${id}: ${where}.${key} must be a non-negative integer (move frames)`);
        }
        assert(window.before === undefined || window.after === undefined || window.before < window.after,
          `${id}: ${where}.before must be lower than after (otherwise every landing auto-cancels)`);
      }
      for (const key of ["intangible", "superArmor"]) {
        if (override[key] !== undefined) {
          validateFrameWindow(id, `gameplay.attacks.${move}.${key}`, override[key]);
        }
      }
    }
  }
  if (gameplay.throws !== undefined) {
    assert(isObject(gameplay.throws), `${id}: gameplay.throws must be an object`);
    for (const [name, override] of Object.entries(gameplay.throws)) {
      assert(THROW_NAMES.has(name), `${id}: unknown throw gameplay.throws.${name}`);
      assert(isObject(override), `${id}: gameplay.throws.${name} must be an object`);
      for (const [field, value] of Object.entries(override)) {
        assert(["damage", "angle", "baseKnockback", "knockbackGrowth"].includes(field),
          `${id}: unknown field gameplay.throws.${name}.${field}`);
        assert(field === "angle" ? finite(value) : nonNegative(value),
          `${id}: gameplay.throws.${name}.${field} must be a ${field === "angle" ? "number" : "non-negative number"}`);
      }
    }
  }
  assert(gameplay.maxJumps === undefined || (positiveInteger(gameplay.maxJumps) && gameplay.maxJumps <= 6),
    `${id}: gameplay.maxJumps must be an integer from 1 to 6`);
  for (const key of ["shieldHealth", "shieldRegen", "traction", "airAcceleration"]) {
    assert(gameplay[key] === undefined || positive(gameplay[key]), `${id}: invalid gameplay.${key}`);
  }
};

const validateReadyPack = (pack, render, config) => {
  const { id, gameplay, visual, effects } = pack;
  assert(isObject(gameplay), `${id}: gameplay is missing`);
  assert(isObject(gameplay.size), `${id}: gameplay.size is missing`);
  for (const key of ["width", "height"]) {
    assert(positive(gameplay.size[key]), `${id}: invalid gameplay.size.${key}`);
  }
  for (const key of [
    "spriteReferenceHeight", "weight", "dash", "run", "air", "gravity", "fall",
    "fastFall", "jump", "doubleJump", "shortHop",
  ]) {
    assert(positive(gameplay[key]), `${id}: invalid gameplay.${key}`);
  }
  for (const key of ["dashFrames", "jumpSquat"]) {
    assert(positiveInteger(gameplay[key]), `${id}: invalid gameplay.${key}`);
  }
  for (const key of ["power", "speed", "reach"]) {
    assert(gameplay[key] === undefined || positive(gameplay[key]), `${id}: invalid gameplay.${key}`);
  }
  assert(isObject(gameplay.specials), `${id}: gameplay.specials is missing`);
  for (const special of SPECIAL_NAMES) {
    const definition = gameplay.specials[special];
    assert(isObject(definition), `${id}: special ${special} is missing`);
    assert(nonEmpty(definition.label), `${id}: ${special} label is missing`);
    assert(typeof definition.damage === "number" && definition.damage >= 0, `${id}: invalid ${special} damage`);
  }
  validateGameplayOverrides(id, gameplay);

  assert(isObject(visual), `${id}: visual is missing`);
  assert(visual.sourceFacing === "left" || visual.sourceFacing === "right", `${id}: invalid sourceFacing`);
  assert(nonEmpty(visual.attribution), `${id}: attribution is missing`);
  assert(validUrl(visual.sourcePage), `${id}: invalid sourcePage`);
  assert(isObject(visual.license) && nonEmpty(visual.license.id), `${id}: license is missing`);
  assert(visual.license.url === undefined || validUrl(visual.license.url), `${id}: invalid license URL`);

  assert(isObject(effects), `${id}: effects is missing`);
  assert(isObject(effects.materials), `${id}: effects.materials is missing`);
  for (const [move, material] of Object.entries(effects.materials)) {
    assert(MOVE_NAMES.has(move), `${id}: unknown effect move ${move}`);
    assert(MATERIALS.has(material), `${id}: unknown material ${material}`);
  }
  assert(Array.isArray(effects.traits), `${id}: effects.traits must be an array`);
  assert(new Set(effects.traits).size === effects.traits.length, `${id}: duplicate effect trait`);
  for (const trait of effects.traits) assert(TRAITS.has(trait), `${id}: unknown trait ${trait}`);

  assert(isObject(render), `${id}: render.json must contain an object`);
  for (const key of ["displayName", "author", "sourcePage", "license", "licenseUrl"]) {
    assert(nonEmpty(render[key]), `${id}: render.${key} is missing`);
  }
  assert(render.sourcePage === visual.sourcePage, `${id}: sourcePage differs between fighter.json and render.json`);
  assert(render.license === visual.license.id, `${id}: license differs between fighter.json and render.json`);
  if (render.additionalSources !== undefined) {
    assert(Array.isArray(render.additionalSources), `${id}: additionalSources must be an array`);
    for (const [index, source] of render.additionalSources.entries()) {
      assert(isObject(source), `${id}: invalid additionalSources[${index}]`);
      for (const key of ["role", "name", "author", "license"]) {
        assert(nonEmpty(source[key]), `${id}: additionalSources[${index}].${key} is missing`);
      }
      assert(validUrl(source.sourcePage), `${id}: invalid additionalSources[${index}].sourcePage`);
      assert(validUrl(source.licenseUrl), `${id}: invalid additionalSources[${index}].licenseUrl`);
    }
  }

  if (pack.kind === "3d") {
    assert(nonEmpty(render.model), `${id}: 3D model is missing`);
    assert(nonEmpty(render.armature), `${id}: armature is missing`);
    assert(nonEmpty(render.slotProfile), `${id}: slotProfile is missing`);
    const profile = config.threeD.slotProfiles[render.slotProfile];
    assert(isObject(profile), `${id}: unknown slotProfile ${render.slotProfile}`);
    assert(isObject(render.actionAliases), `${id}: actionAliases is missing`);
    for (const alias of Object.values(profile)) {
      assert(nonEmpty(render.actionAliases[alias]), `${id}: missing animation alias ${alias}`);
    }
    const slotNames = new Set(Object.keys(profile));
    const direct = render.directSlots ?? [];
    const authorRequired = render.authorRequiredSlots ?? [];
    assert(Array.isArray(direct) && Array.isArray(authorRequired), `${id}: invalid 3D classifications`);
    for (const slot of [...direct, ...authorRequired]) {
      assert(slotNames.has(slot), `${id}: unknown 3D slot ${slot}`);
    }
    assert(new Set([...direct, ...authorRequired]).size === direct.length + authorRequired.length,
      `${id}: 3D slot classified more than once`);
  } else {
    assert(isObject(render.actions) && Object.keys(render.actions).length > 0, `${id}: 2D actions are missing`);
    assert(isObject(render.slots), `${id}: 2D slots are missing`);
    const expectedSlots = Object.keys(config.threeD.slotProfiles["platform-fighter"]);
    const classified = [];
    for (const grade of ["direct", "adapted", "author_required"]) {
      assert(isObject(render.slots[grade]), `${id}: slots.${grade} is missing`);
      for (const [slot, action] of Object.entries(render.slots[grade])) {
        assert(expectedSlots.includes(slot), `${id}: unknown 2D slot ${slot}`);
        assert(render.actions[action] !== undefined, `${id}: missing 2D action ${action}`);
        classified.push(slot);
      }
    }
    assert(classified.length === expectedSlots.length, `${id}: ${classified.length}/${expectedSlots.length} slots 2D`);
    assert(new Set(classified).size === classified.length, `${id}: 2D slot classified more than once`);
  }
};

// Fallback chain for slots a sprite-strip pack does not provide yet. Each
// missing slot borrows the first available strip in its chain, then idle.
const SPRITE_STRIP_FALLBACKS = {
  crouch: ["idle"],
  walk: ["run"],
  turn: ["idle"],
  dash: ["run", "walk"],
  run: ["walk", "dash"],
  jump_squat: ["crouch"],
  jump: ["double_jump", "fall"],
  double_jump: ["jump"],
  fall: ["jump"],
  fast_fall: ["fall", "jump"],
  jab: ["forward_tilt"],
  dash_attack: ["forward_tilt", "jab"],
  forward_tilt: ["jab"],
  up_tilt: ["up_air", "jab"],
  down_tilt: ["jab"],
  forward_smash: ["forward_tilt", "jab"],
  up_smash: ["up_tilt", "up_air", "jab"],
  down_smash: ["down_tilt", "jab"],
  neutral_air: ["jab"],
  forward_air: ["neutral_air", "forward_tilt", "jab"],
  back_air: ["neutral_air", "jab"],
  up_air: ["up_tilt", "neutral_air", "jab"],
  down_air: ["neutral_air", "jab"],
  neutral_special: ["jab"],
  side_special: ["forward_tilt", "jab"],
  up_special: ["up_air", "jump"],
  down_special: ["down_tilt", "jab"],
  spot_dodge: ["shield", "crouch"],
  roll_forward: ["dash", "run"],
  roll_back: ["roll_forward", "dash", "run"],
  air_dodge: ["fall", "jump"],
  shield: ["crouch"],
  item_hold: ["idle"],
  item_pickup: ["crouch"],
  item_attack: ["forward_tilt", "jab"],
  grab: ["jab"],
  grab_hold: ["grab"],
  grabbed: ["hurt"],
  forward_throw: ["grab", "forward_tilt"],
  back_throw: ["forward_throw", "grab"],
  up_throw: ["forward_throw", "grab"],
  down_throw: ["forward_throw", "grab"],
  hurt: ["knockback"],
  knockback: ["hurt"],
  downed: ["hurt", "knockback"],
  ledge: ["fall", "jump"],
  entrance: ["idle"],
  taunt: ["victory"],
  victory: ["taunt"],
};

const resolveStripFallback = (slot, available, visited = new Set()) => {
  if (available.has(slot)) return slot;
  visited.add(slot);
  for (const candidate of SPRITE_STRIP_FALLBACKS[slot] ?? []) {
    if (visited.has(candidate)) continue;
    const resolved = resolveStripFallback(candidate, available, visited);
    if (resolved) return resolved;
  }
  return available.has("idle") ? "idle" : null;
};

/**
 * Expands render.spriteStrips (one horizontal PNG strip per animation slot in a
 * folder inside the pack) into the explicit actions/slots form consumed by the
 * 2D atlas builder. Explicit actions/slots in render.json are left untouched.
 */
const expandSpriteStrips = async (render, directory, slotNames) => {
  const strips = render.spriteStrips;
  if (strips === undefined) return render;
  const id = render.displayName ?? directory;
  assert(isObject(strips), `${id}: spriteStrips must be an object`);
  assert(render.actions === undefined && render.slots === undefined,
    `${id}: use either spriteStrips or actions/slots in render.json, not both`);
  assert(nonEmpty(strips.directory), `${id}: spriteStrips.directory is missing`);
  assert(positiveInteger(strips.frameWidth) && positiveInteger(strips.frameHeight),
    `${id}: spriteStrips.frameWidth and frameHeight must be positive integers`);
  const absoluteDirectory = resolve(directory, strips.directory);
  // path.relative is separator-agnostic, so this holds on Windows too.
  const insidePack = relative(directory, absoluteDirectory);
  assert(insidePack === "" || (!insidePack.startsWith("..") && !isAbsolute(insidePack)),
    `${id}: spriteStrips.directory must stay inside the fighter pack`);
  let files;
  try {
    files = await readdir(absoluteDirectory);
  } catch {
    fail(`${id}: spriteStrips.directory ${strips.directory} does not exist`);
  }
  const slotSet = new Set(slotNames);
  const unknown = files.filter((name) => name.endsWith(".png") && !slotSet.has(name.slice(0, -4)));
  assert(unknown.length === 0, `${id}: unknown sprite strip(s) ${unknown.join(", ")}; name files after animation slots`);
  const available = new Set(files.filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)));
  assert(available.has("idle"), `${id}: spriteStrips requires at least idle.png`);
  const frameSizes = isObject(strips.frameSizes) ? strips.frameSizes : {};
  const fps = isObject(strips.fps) ? strips.fps : {};
  const relativeDirectory = relative(projectRoot, absoluteDirectory).split(sep).join("/");
  const actions = {};
  for (const slot of slotNames.filter((name) => available.has(name))) {
    const size = frameSizes[slot] ?? {};
    actions[slot] = {
      type: "strip",
      sheet: `${relativeDirectory}/${slot}.png`,
      frameWidth: size.frameWidth ?? strips.frameWidth,
      frameHeight: size.frameHeight ?? strips.frameHeight,
      ...(positive(fps[slot]) ? { fps: fps[slot] } : {}),
    };
  }
  const slots = { direct: {}, adapted: {}, author_required: {} };
  for (const slot of slotNames) {
    if (available.has(slot)) slots.direct[slot] = slot;
    else slots.author_required[slot] = resolveStripFallback(slot, available);
  }
  const { spriteStrips: _spriteStrips, ...rest } = render;
  return { ...rest, actions, slots };
};

const loadPacks = async () => {
  const config = await readJson(pipelineConfigPath);
  assert(config.version === 1, "fighters/pipeline.config.json: invalid version");
  assert(isObject(config.threeD?.slotProfiles?.["platform-fighter"]), "platform-fighter profile is missing");
  const directories = (await readdir(packRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const loaded = [];
  for (const directoryName of directories) {
    const directory = join(packRoot, directoryName);
    const pack = await readJson(join(directory, "fighter.json"));
    const rawRender = await readJson(join(directory, "render.json"));
    validateCommon(pack, directoryName);
    // Drafts may not have any sprites yet; only ready packs are expanded.
    const render = pack.status === "ready"
      ? await expandSpriteStrips(
          rawRender,
          directory,
          Object.keys(config.threeD.slotProfiles["platform-fighter"]),
        )
      : rawRender;
    if (pack.status === "ready") validateReadyPack(pack, render, config);
    loaded.push({ pack, render, directory });
  }
  const ids = loaded.map(({ pack }) => pack.id);
  const orders = loaded.filter(({ pack }) => pack.status === "ready").map(({ pack }) => pack.order);
  assert(new Set(ids).size === ids.length, "Duplicate fighter pack IDs");
  assert(new Set(orders).size === orders.length, "Duplicate ready fighter pack order values");
  loaded.sort((left, right) => left.pack.order - right.pack.order || left.pack.id.localeCompare(right.pack.id));
  return { config, loaded };
};

const generatedOutputs = ({ config, loaded }) => {
  const ready = loaded.filter(({ pack }) => pack.status === "ready");
  const packs = ready.map(({ pack }) => pack);
  const ids3D = packs.filter(({ kind }) => kind === "3d").map(({ id }) => id);
  const ids2D = packs.filter(({ kind }) => kind === "2d").map(({ id }) => id);
  const registry = [
    "/* Generated by scripts/fighter_packs.mjs. Do not edit directly. */",
    `export const OPEN_3D_FIGHTER_IDS = ${JSON.stringify(ids3D, null, 2)} as const;`,
    `export const OPEN_2D_FIGHTER_IDS = ${JSON.stringify(ids2D, null, 2)} as const;`,
    "/** Every ready fighter in pack `order`, regardless of render pipeline. */",
    `export const OPEN_FIGHTER_IDS_BY_ORDER = ${JSON.stringify(packs.map(({ id }) => id), null, 2)} as const;`,
    `export const OPEN_FIGHTER_PACKS = ${JSON.stringify(packs, null, 2)} as const;`,
    "",
  ].join("\n");
  const manifest3D = {
    generatedBy: "scripts/fighter_packs.mjs",
    version: config.threeD.version,
    slotProfiles: config.threeD.slotProfiles,
    fighters: Object.fromEntries(
      ready.filter(({ pack }) => pack.kind === "3d").map(({ pack, render }) => [pack.id, render]),
    ),
  };
  const manifest2D = {
    generatedBy: "scripts/fighter_packs.mjs",
    version: config.twoD.version,
    cellSize: config.twoD.cellSize,
    columns: config.twoD.columns,
    excludedCandidates: config.twoD.excludedCandidates ?? {},
    fighters: Object.fromEntries(
      ready.filter(({ pack }) => pack.kind === "2d").map(({ pack, render }) => [pack.id, render]),
    ),
  };
  return new Map([
    [registryOut, registry],
    [manifest3DOut, json(manifest3D)],
    [manifest2DOut, json(manifest2D)],
  ]);
};

const writeAtomic = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content);
  await rename(temporary, path);
};

const syncGenerated = async (state) => {
  const outputs = generatedOutputs(state);
  for (const [path, content] of outputs) await writeAtomic(path, content);
  return outputs;
};

const checkGenerated = async (state) => {
  for (const [path, expected] of generatedOutputs(state)) {
    let actual;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      fail(`Generated output is missing: ${path}`);
    }
    assert(actual === expected, `Generated output is outdated: ${path}. Run npm run fighter:build`);
  }
};

const run = (executable, executableArgs, options = {}) => {
  const result = spawnSync(executable, executableArgs, {
    cwd: projectRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.status !== 0) fail(`${executable} failed with code ${result.status}`);
};

const scaffold = async () => {
  const id = args.find((argument) => !argument.startsWith("--"));
  const kindIndex = args.indexOf("--kind");
  const kind = kindIndex >= 0 ? args[kindIndex + 1] : undefined;
  assert(id && ID_PATTERN.test(id), "Usage: npm run fighter:new -- <id> --kind 2d|3d");
  assert(kind === "2d" || kind === "3d", "--kind must be 2d or 3d");
  const destination = join(packRoot, id);
  try {
    await access(destination);
    fail(`Fighter pack ${id} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
  const { loaded } = await loadPacks();
  const order = Math.max(0, ...loaded.map(({ pack }) => pack.order)) + 10;
  const displayName = id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
  const fighter = {
    $schema: "../fighter.schema.json",
    schemaVersion: 1,
    status: "draft",
    id,
    kind,
    order,
    identity: {
      displayName,
      archetype: "Prototype",
      playstyle: "Define in the fighter pack",
      colors: { primary: "#4f7cff", secondary: "#222838", accent: "#ffe066" },
    },
    gameplay: {
      size: { width: 64, height: 92 },
      spriteReferenceHeight: 138,
      weight: 100,
      dash: 1.7,
      dashFrames: 8,
      run: 1.6,
      air: 1,
      gravity: 0.1,
      fall: 2.1,
      fastFall: 2.9,
      jump: 2.6,
      doubleJump: 2.35,
      jumpSquat: 4,
      shortHop: 0.63,
      specials: Object.fromEntries(SPECIAL_NAMES.map((name) => [name, {
        label: displayName,
        damage: 10,
      }])),
    },
    visual: {
      sourceFacing: "right",
      attribution: displayName,
      sourcePage: "https://example.invalid/replace-with-source",
      license: { id: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    },
    effects: { materials: {}, traits: [] },
  };
  const render = kind === "3d"
    ? {
        displayName,
        author: "Replace with author",
        sourcePage: fighter.visual.sourcePage,
        license: fighter.visual.license.id,
        licenseUrl: fighter.visual.license.url,
        model: "fighters/replace-with-model.glb",
        armature: "Armature",
        cameraAxis: "-X",
        sourceFacing: "right",
        framingPadding: 1.15,
        slotProfile: "platform-fighter",
        actionAliases: {},
        directSlots: [],
        authorRequiredSlots: [],
      }
    : {
        displayName,
        author: "Replace with author",
        sourcePage: fighter.visual.sourcePage,
        license: fighter.visual.license.id,
        licenseUrl: fighter.visual.license.url,
        defaultFps: 12,
        preferredScale: 1,
        spriteStrips: {
          directory: "sprites",
          frameWidth: 128,
          frameHeight: 128,
          fps: { idle: 8, walk: 10, run: 14 },
        },
      };
  await mkdir(destination, { recursive: false });
  await writeFile(join(destination, "fighter.json"), json(fighter));
  await writeFile(join(destination, "render.json"), json(render));
  if (kind === "2d") {
    await mkdir(join(destination, "sprites"));
    await writeFile(join(destination, "sprites", "README.md"), [
      `# ${displayName} sprite strips`,
      "",
      "Add one horizontal PNG strip per animation slot, named after the slot",
      "(`idle.png`, `walk.png`, `jab.png`, ...). Frames are laid left to right,",
      "all the same size as `spriteStrips.frameWidth` x `frameHeight` in",
      "render.json, on a transparent background, with the character facing",
      "`visual.sourceFacing` and standing on the bottom edge.",
      "",
      "Only `idle.png` is required. Missing slots borrow a related strip",
      "(for example `fast_fall` uses `fall`) and are reported as",
      "author_required until you draw them. The full slot list is in",
      "fighters/pipeline.config.json.",
      "",
    ].join("\n"));
  }
  console.log(`Draft fighter pack created: ${destination}`);
  console.log("Complete fighter.json and render.json, then set status to ready.");
};

const build = async () => {
  const state = await loadPacks();
  await syncGenerated(state);
  const ready = state.loaded.filter(({ pack }) => pack.status === "ready");
  const drafts = state.loaded.length - ready.length;
  console.log(`${ready.length} fighter pack(s) synchronized${drafts ? `; ${drafts} draft(s) skipped` : ""}.`);
  const requestedId = args.find((argument) => !argument.startsWith("--"));
  if (!requestedId) return;
  const selected = ready.find(({ pack }) => pack.id === requestedId);
  assert(selected, `Ready fighter pack not found: ${requestedId}`);
  if (selected.pack.kind === "3d") {
    run("zsh", ["scripts/open_fighter_pipeline/render_all.sh"], {
      env: { OPEN_FIGHTERS: requestedId },
    });
  } else {
    // Called through node directly so the 2D path works on any shell/OS.
    for (const tool of ["ffmpeg", "ffprobe", "cwebp"]) {
      const probe = spawnSync(tool, ["-version"], { stdio: "ignore" });
      assert(probe.status === 0, `${tool} is required to build 2D fighters (run npm run content:doctor)`);
    }
    run(process.execPath, ["scripts/open_fighter_pipeline/build_2d_atlases.mjs"], {
      env: { OPEN_2D_FIGHTERS: requestedId },
    });
  }
  run("node", ["scripts/build_ui_thumbnails.mjs", requestedId]);
  run("node", ["scripts/validate_open_fighters.mjs"]);
};

const check = async () => {
  const state = await loadPacks();
  await checkGenerated(state);
  run("node", ["scripts/validate_open_fighters.mjs"], {
    env: args.includes("--deep") ? { OPEN_FIGHTER_DEEP: "1" } : {},
  });
  const ready = state.loaded.filter(({ pack }) => pack.status === "ready").length;
  console.log(`${ready} fighter pack(s) valid and synchronized.`);
};

const help = () => {
  console.log(`Fighter pack commands:
  npm run fighter:new -- <id> --kind 2d|3d
  npm run fighter:build
  npm run fighter:build -- <id>
  npm run fighter:check
  npm run fighter:check -- --deep`);
};

try {
  if (command === "new") await scaffold();
  else if (command === "build") await build();
  else if (command === "check") await check();
  else help();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
