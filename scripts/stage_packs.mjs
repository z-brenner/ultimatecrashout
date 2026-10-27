#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { holdContentBuildLock } from "./content_build_lock.mjs";
import {
  STAGE_MECHANICS_LIMITS as LIMITS,
  platformMotionMaxSpeed,
  platformMotionPosition,
} from "../src/game/stageMechanics.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = resolve(process.env.STAGE_PACKS_ROOT ?? join(projectRoot, "stages"));
const registryOut = resolve(
  process.env.STAGE_REGISTRY_OUT ?? join(projectRoot, "src/game/generated/openStageRegistry.ts"),
);
const pipelineConfigPath = resolve(
  process.env.STAGE_PIPELINE_CONFIG ?? join(packRoot, "pipeline.config.json"),
);
const [command, ...args] = process.argv.slice(2);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const validUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const validatePoint = (point, label) => {
  assert(isObject(point), `${label} must be an object`);
  assert(finite(point.x) && finite(point.y), `${label} must contain finite x/y values`);
};

const parseChecksums = async (directory, id) => {
  const checksumPath = join(directory, "SHA256SUMS");
  const provenancePath = join(directory, "PROVENANCE.md");
  const [checksumText, provenance] = await Promise.all([
    readFile(checksumPath, "utf8"),
    readFile(provenancePath, "utf8"),
  ]).catch((error) => {
    fail(`${id}: PROVENANCE.md or SHA256SUMS is missing (${error instanceof Error ? error.message : error})`);
  });
  assert(provenance.trim().length > 0, `${id}: PROVENANCE.md is empty`);
  const checksums = new Map();
  for (const [index, line] of checksumText.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})  ([^\s].*)$/);
    assert(match, `${id}: invalid SHA256SUMS line ${index + 1}`);
    assert(!checksums.has(match[2]), `${id}: duplicate checksum for ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
};

const validateAsset = async (
  directory,
  id,
  assetPath,
  label,
  allowedExtensions,
  maximumBytes,
  checksums,
) => {
  assert(nonEmpty(assetPath), `${id}: render.${label} is missing`);
  assert(!isAbsolute(assetPath), `${id}: render.${label} must be relative`);
  assert(!assetPath.includes("\\"), `${id}: render.${label} must use / separators`);
  const absolute = resolve(directory, assetPath);
  const prefix = `${directory}${sep}`;
  assert(absolute.startsWith(prefix), `${id}: render.${label} escapes the stage pack`);
  const info = await lstat(absolute).catch(() => null);
  assert(info?.isFile(), `${id}: asset ${assetPath} is missing`);
  assert(!info.isSymbolicLink(), `${id}: symbolic links are prohibited (${assetPath})`);
  assert(allowedExtensions.has(extname(assetPath).toLowerCase()), `${id}: invalid extension for ${assetPath}`);
  assert(info.size <= maximumBytes, `${id}: ${assetPath} exceeds ${maximumBytes} bytes`);
  const expected = checksums.get(assetPath);
  assert(expected, `${id}: checksum missing for ${assetPath}`);
  const actual = createHash("sha256").update(await readFile(absolute)).digest("hex");
  assert(actual === expected, `${id}: incorrect checksum for ${assetPath}`);
  return absolute;
};

const integerInRange = (value, minimum, maximum) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

const onlyKeys = (value, allowed, label) => {
  for (const key of Object.keys(value)) {
    assert(allowed.includes(key), `${label}.${key} is not a known field (${allowed.join(", ")})`);
  }
};

/** A moving one-way platform; returns every position it occupies, for the blast-zone check. */
const validateMotion = (id, platform) => {
  const label = `${id}: ${platform.id}.motion`;
  const { motion } = platform;
  assert(isObject(motion), `${label} must be an object`);
  onlyKeys(motion, ["path", "periodFrames", "mode", "easing", "phaseFrames", "sprite"], label);
  assert(platform.kind === "platform" && platform.id !== "main",
    `${label}: only one-way platforms (kind "platform") can move; ground, main, and ledges stay put`);
  assert(platform.surfaceY === undefined, `${label}: a moving platform must be flat (no surfaceY)`);
  assert(Array.isArray(motion.path) && motion.path.length >= 2 && motion.path.length <= LIMITS.maxPathPoints,
    `${label}.path must list 2-${LIMITS.maxPathPoints} points`);
  motion.path.forEach((point, index) => validatePoint(point, `${label}.path[${index}]`));
  assert(integerInRange(motion.periodFrames, LIMITS.minPeriodFrames, LIMITS.maxPeriodFrames),
    `${label}.periodFrames must be an integer from ${LIMITS.minPeriodFrames} to ${LIMITS.maxPeriodFrames}`);
  assert(motion.mode === undefined || motion.mode === "pingpong" || motion.mode === "loop",
    `${label}.mode must be "pingpong" or "loop"`);
  assert(motion.easing === undefined || motion.easing === "linear" || motion.easing === "sine",
    `${label}.easing must be "linear" or "sine"`);
  assert(motion.easing !== "sine" || motion.mode !== "loop", `${label}: sine easing only applies to pingpong`);
  assert(motion.phaseFrames === undefined || integerInRange(motion.phaseFrames, 0, motion.periodFrames - 1),
    `${label}.phaseFrames must be an integer from 0 to periodFrames - 1`);
  const start = platformMotionPosition(motion, 0);
  assert(Math.abs(start.x - platform.x) <= 0.5 && Math.abs(start.y - platform.y) <= 0.5,
    `${label}: ${platform.id}.x/y must be where the motion starts on frame 0 ` +
    `(${Math.round(start.x * 10) / 10}, ${Math.round(start.y * 10) / 10})`);
  const speed = platformMotionMaxSpeed(motion);
  assert(speed <= LIMITS.maxPlatformSpeed,
    `${label} moves up to ${speed.toFixed(1)} units per frame; the limit is ${LIMITS.maxPlatformSpeed} ` +
    "(lengthen periodFrames or shorten the path)");
  return motion.path;
};

const validateHazards = (id, hazards, blast) => {
  assert(Array.isArray(hazards) && hazards.length <= LIMITS.maxHazards,
    `${id}: gameplay.hazards must be a list of at most ${LIMITS.maxHazards} hazards`);
  const ids = new Set();
  hazards.forEach((hazard, index) => {
    const label = `${id}: gameplay.hazards[${index}]`;
    assert(isObject(hazard), `${label} must be an object`);
    onlyKeys(hazard, ["id", "kind", "area", "schedule", "hit", "color"], label);
    assert(nonEmpty(hazard.id) && ID_PATTERN.test(hazard.id), `${label}.id must be a lowercase kebab-case id`);
    assert(!ids.has(hazard.id), `${label}.id ${hazard.id} is used twice`);
    ids.add(hazard.id);
    assert(hazard.kind === "zone", `${label}.kind must be "zone"`);

    const { area } = hazard;
    assert(isObject(area), `${label}.area must be an object`);
    onlyKeys(area, ["x", "y", "width", "height"], `${label}.area`);
    assert(finite(area.x) && finite(area.y), `${label}.area needs finite x and y (its centre)`);
    assert(finite(area.width) && area.width >= LIMITS.minHazardSize &&
      finite(area.height) && area.height >= LIMITS.minHazardSize,
      `${label}.area width and height must be at least ${LIMITS.minHazardSize}`);
    assert(area.x - area.width / 2 > blast.left && area.x + area.width / 2 < blast.right &&
      area.y - area.height / 2 > blast.bottom && area.y + area.height / 2 < blast.top,
      `${label}.area must lie inside the blastZone`);

    const { schedule } = hazard;
    assert(isObject(schedule), `${label}.schedule must be an object`);
    onlyKeys(schedule, ["periodFrames", "warningFrames", "activeFrames", "phaseFrames"], `${label}.schedule`);
    assert(integerInRange(schedule.periodFrames, LIMITS.minPeriodFrames, LIMITS.maxPeriodFrames),
      `${label}.schedule.periodFrames must be an integer from ${LIMITS.minPeriodFrames} to ${LIMITS.maxPeriodFrames}`);
    assert(Number.isInteger(schedule.warningFrames) && schedule.warningFrames >= LIMITS.minWarningFrames,
      `${label}.schedule.warningFrames must be at least ${LIMITS.minWarningFrames}: players must see it coming`);
    assert(positiveInteger(schedule.activeFrames), `${label}.schedule.activeFrames must be a positive integer`);
    assert(schedule.warningFrames + schedule.activeFrames < schedule.periodFrames,
      `${label}.schedule: warningFrames + activeFrames must be less than periodFrames`);
    assert(schedule.phaseFrames === undefined || integerInRange(schedule.phaseFrames, 0, schedule.periodFrames - 1),
      `${label}.schedule.phaseFrames must be an integer from 0 to periodFrames - 1`);

    const { hit } = hazard;
    assert(isObject(hit), `${label}.hit must be an object`);
    onlyKeys(hit, ["damage", "angle", "baseKnockback", "knockbackGrowth", "mirrorX"], `${label}.hit`);
    assert(finite(hit.damage) && hit.damage >= 0 && hit.damage <= LIMITS.maxHazardDamage,
      `${label}.hit.damage must be 0-${LIMITS.maxHazardDamage}`);
    assert(finite(hit.angle) && hit.angle >= 0 && hit.angle < 360, `${label}.hit.angle must be 0-359 degrees`);
    assert(finite(hit.baseKnockback) && hit.baseKnockback >= 0, `${label}.hit.baseKnockback must be a non-negative number`);
    assert(finite(hit.knockbackGrowth) && hit.knockbackGrowth >= 0 && hit.knockbackGrowth <= 3,
      `${label}.hit.knockbackGrowth must be 0-3`);
    assert(hit.mirrorX === undefined || typeof hit.mirrorX === "boolean", `${label}.hit.mirrorX must be true or false`);
    assert(COLOR_PATTERN.test(hazard.color ?? ""), `${label}.color must be a #rrggbb colour`);
  });
};

const validateCommon = (pack, directoryName) => {
  assert(isObject(pack), `${directoryName}: stage.json must contain an object`);
  assert(pack.schemaVersion === 1, `${directoryName}: schemaVersion must equal 1`);
  assert(pack.status === "draft" || pack.status === "ready", `${directoryName}: invalid status`);
  assert(nonEmpty(pack.id) && ID_PATTERN.test(pack.id), `${directoryName}: invalid id`);
  assert(pack.id === directoryName, `${directoryName}: id ${pack.id} does not match the directory`);
  assert(positiveInteger(pack.order), `${pack.id}: order must be a positive integer`);
  assert(isObject(pack.identity), `${pack.id}: identity is missing`);
  for (const key of ["displayName", "series", "description"]) {
    assert(nonEmpty(pack.identity[key]), `${pack.id}: identity.${key} is missing`);
  }
};

const validateReadyPack = async (pack, directory, config) => {
  const { id, gameplay, render, colors, license } = pack;
  assert(isObject(gameplay), `${id}: gameplay is missing`);
  assert(Array.isArray(gameplay.platforms) && gameplay.platforms.length > 0, `${id}: platforms are missing`);
  const platformIds = new Set();
  for (const [index, platform] of gameplay.platforms.entries()) {
    assert(isObject(platform), `${id}: invalid platform ${index}`);
    assert(nonEmpty(platform.id) && ID_PATTERN.test(platform.id), `${id}: platform ${index} has no valid id`);
    assert(!platformIds.has(platform.id), `${id}: duplicate platform ${platform.id}`);
    platformIds.add(platform.id);
    for (const key of ["x", "y"]) assert(finite(platform[key]), `${id}: invalid ${platform.id}.${key}`);
    for (const key of ["width", "height"]) assert(positive(platform[key]), `${id}: invalid ${platform.id}.${key}`);
    assert(platform.kind === "ground" || platform.kind === "platform", `${id}: invalid ${platform.id}.kind`);
    if (platform.surfaceY !== undefined) {
      assert(
        Array.isArray(platform.surfaceY) && platform.surfaceY.length === 2 && platform.surfaceY.every(finite),
        `${id}: invalid ${platform.id}.surfaceY`,
      );
    }
  }
  const mainPlatforms = gameplay.platforms.filter(({ id: platformId, kind }) =>
    platformId === "main" && kind === "ground"
  );
  assert(mainPlatforms.length === 1, `${id}: exactly one main platform of kind ground is required`);

  assert(Array.isArray(gameplay.ledges), `${id}: ledges must be an array`);
  const ledgeKeys = new Set();
  for (const ledge of gameplay.ledges) {
    assert(isObject(ledge), `${id}: invalid ledge`);
    assert(ledge.side === "left" || ledge.side === "right", `${id}: invalid ledge side`);
    const platform = gameplay.platforms.find(({ id: platformId }) => platformId === ledge.platformId);
    assert(platform?.kind === "ground", `${id}: ledge ${ledge.platformId}/${ledge.side} must reference a ground`);
    const key = `${ledge.platformId}/${ledge.side}`;
    assert(!ledgeKeys.has(key), `${id}: duplicate ledge ${key}`);
    ledgeKeys.add(key);
  }

  assert(Array.isArray(gameplay.spawns) && gameplay.spawns.length === 2, `${id}: exactly two spawns are required`);
  gameplay.spawns.forEach((spawn, index) => validatePoint(spawn, `${id}: spawn ${index}`));
  assert(isObject(gameplay.blastZone), `${id}: blastZone is missing`);
  const blast = gameplay.blastZone;
  for (const key of ["left", "right", "top", "bottom"]) {
    assert(finite(blast[key]), `${id}: invalid blastZone.${key}`);
  }
  assert(blast.left < blast.right && blast.bottom < blast.top, `${id}: inverted blastZone`);
  for (const [index, spawn] of gameplay.spawns.entries()) {
    assert(
      spawn.x > blast.left && spawn.x < blast.right && spawn.y > blast.bottom && spawn.y < blast.top,
      `${id}: spawn ${index} is outside blastZone`,
    );
  }
  for (const platform of gameplay.platforms) {
    const halfWidth = platform.width / 2;
    // A moving platform must stay inside the blast zone at every path point.
    const positions = platform.motion !== undefined ? validateMotion(id, platform) : [platform];
    for (const position of positions) {
      const fallbackSurface = position.y + platform.height / 2;
      const surfaces = platform.surfaceY ?? [fallbackSurface, fallbackSurface];
      assert(position.x - halfWidth > blast.left, `${id}: ${platform.id} exceeds the blastZone on the left`);
      assert(position.x + halfWidth < blast.right, `${id}: ${platform.id} exceeds the blastZone on the right`);
      assert(Math.max(...surfaces) < blast.top, `${id}: ${platform.id} exceeds the blastZone at the top`);
      assert(Math.min(...surfaces) - platform.height > blast.bottom, `${id}: ${platform.id} exceeds the blastZone at the bottom`);
    }
  }
  if (gameplay.hazards !== undefined) validateHazards(id, gameplay.hazards, blast);

  assert(isObject(render), `${id}: render is missing`);
  assert(render.kind === "2d" || render.kind === "3d", `${id}: invalid render.kind`);
  assert(isObject(render.art), `${id}: render.art is missing`);
  assert(positiveInteger(render.art.width) && positiveInteger(render.art.height), `${id}: invalid art dimensions`);
  validatePoint(render.art.originPx, `${id}: render.art.originPx`);
  assert(positive(render.art.worldUnitsPerPixel), `${id}: invalid worldUnitsPerPixel`);
  if (render.kind === "2d") assert(render.scene === undefined, `${id}: a 2d stage must not declare scene`);
  if (render.kind === "3d") {
    assert(isObject(render.scene), `${id}: render.scene is required for a 3d stage`);
    assert(positive(render.scene.scale), `${id}: invalid render.scene.scale`);
    validatePoint(render.scene.offset, `${id}: render.scene.offset`);
    assert([-1, 1].includes(render.scene.cameraDirection), `${id}: invalid cameraDirection`);
  }

  assert(isObject(colors), `${id}: colors are missing`);
  for (const key of ["edge", "surface", "body", "shadow"]) {
    assert(COLOR_PATTERN.test(colors[key] ?? ""), `${id}: invalid colors.${key}`);
  }
  assert(isObject(license), `${id}: license is missing`);
  assert(nonEmpty(license.attribution), `${id}: attribution is missing`);
  assert(validUrl(license.sourcePage), `${id}: invalid sourcePage`);
  assert(nonEmpty(license.id), `${id}: license identifier is missing`);
  assert(validUrl(license.url), `${id}: invalid license URL`);

  const checksums = await parseChecksums(directory, id);
  const assets = {
    preview: await validateAsset(directory, id, render.preview, "preview", IMAGE_EXTENSIONS, config.assetBudgets.preview, checksums),
    thumbnail: await validateAsset(directory, id, render.thumbnail, "thumbnail", new Set([".webp"]), config.assetBudgets.thumbnail, checksums),
    arena: await validateAsset(directory, id, render.arena, "arena", IMAGE_EXTENSIONS, config.assetBudgets.arena, checksums),
    backdrop: await validateAsset(directory, id, render.backdrop, "backdrop", IMAGE_EXTENSIONS, config.assetBudgets.backdrop, checksums),
  };
  // Moving-platform sprites, drawn at the arena's pixel scale.
  const spritePaths = gameplay.platforms.flatMap((platform) =>
    platform.motion?.sprite === undefined ? [] : [[platform.id, platform.motion.sprite]]);
  assets.sprites = {};
  for (const [platformId, spritePath] of spritePaths) {
    assets.sprites[platformId] = await validateAsset(
      directory, id, spritePath, `${platformId}.motion.sprite`, IMAGE_EXTENSIONS, config.assetBudgets.sprite, checksums,
    );
  }
  if (render.kind === "3d") {
    assets.scene = await validateAsset(
      directory,
      id,
      render.scene.file,
      "scene.file",
      new Set([".glb"]),
      config.assetBudgets.scene,
      checksums,
    );
    const header = await readFile(assets.scene);
    assert(header.length >= 12 && header.toString("ascii", 0, 4) === "glTF", `${id}: invalid scene.glb`);
    assert(header.readUInt32LE(4) === 2, `${id}: scene.glb must be glTF 2`);
  }
  const expectedChecksums = new Set([
    render.preview,
    render.thumbnail,
    render.arena,
    render.backdrop,
    ...(render.kind === "3d" ? [render.scene.file] : []),
    ...spritePaths.map(([, spritePath]) => spritePath),
  ]);
  for (const checksumPath of checksums.keys()) {
    assert(expectedChecksums.has(checksumPath), `${id}: unexpected checksum ${checksumPath}`);
  }
  return assets;
};

const loadPacks = async () => {
  const config = await readJson(pipelineConfigPath);
  assert(config.version === 1, "stages/pipeline.config.json: invalid version");
  assert(isObject(config.assetBudgets), "stages/pipeline.config.json: assetBudgets is missing");
  for (const key of ["preview", "thumbnail", "arena", "backdrop", "scene", "sprite"]) {
    assert(positiveInteger(config.assetBudgets[key]), `stages/pipeline.config.json: invalid ${key} budget`);
  }
  const directories = (await readdir(packRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const loaded = [];
  for (const directoryName of directories) {
    const directory = join(packRoot, directoryName);
    const pack = await readJson(join(directory, "stage.json"));
    validateCommon(pack, directoryName);
    const assets = pack.status === "ready"
      ? await validateReadyPack(pack, directory, config)
      : null;
    loaded.push({ pack, directory, assets });
  }
  const ready = loaded.filter(({ pack }) => pack.status === "ready");
  assert(ready.length > 0, "At least one ready stage pack is required");
  const ids = ready.map(({ pack }) => pack.id);
  const orders = ready.map(({ pack }) => pack.order);
  assert(new Set(ids).size === ids.length, "Duplicate stage pack IDs");
  assert(new Set(orders).size === orders.length, "Duplicate ready stage pack order values");
  loaded.sort((left, right) => left.pack.order - right.pack.order || left.pack.id.localeCompare(right.pack.id));
  return loaded;
};

const generatedRegistry = (loaded) => {
  const ready = loaded.filter(({ pack }) => pack.status === "ready");
  const imports = [];
  /** Emits a `?url` import for an asset and returns its placeholder. */
  const addImport = (identifier, absolute) => {
    let importPath = relative(dirname(registryOut), absolute).split(sep).join("/");
    if (!importPath.startsWith(".")) importPath = `./${importPath}`;
    imports.push(`import ${identifier} from ${JSON.stringify(`${importPath}?url`)};`);
    return `__${identifier}__`;
  };
  const packs = ready.map(({ pack, assets }, index) => {
    const runtime = {};
    for (const key of ["preview", "thumbnail", "arena", "backdrop", "scene"]) {
      const absolute = assets[key];
      if (!absolute) continue;
      runtime[`${key}Url`] = addImport(`stage${index}${key[0].toUpperCase()}${key.slice(1)}Url`, absolute);
    }
    const spriteEntries = Object.entries(assets.sprites ?? {});
    if (spriteEntries.length > 0) {
      runtime.spriteUrls = Object.fromEntries(spriteEntries.map(([platformId, absolute], spriteIndex) =>
        [platformId, addImport(`stage${index}Sprite${spriteIndex}Url`, absolute)]));
    }
    return { ...pack, runtime };
  });
  let literal = JSON.stringify(packs, null, 2);
  for (const line of imports) {
    const identifier = line.match(/^import (\w+) /)?.[1];
    if (identifier) literal = literal.replaceAll(JSON.stringify(`__${identifier}__`), identifier);
  }
  return [
    "/* Generated by scripts/stage_packs.mjs. Do not edit directly. */",
    ...imports,
    "",
    `export const OPEN_STAGE_IDS = ${JSON.stringify(ready.map(({ pack }) => pack.id), null, 2)} as const;`,
    "export const DEFAULT_STAGE_ID = OPEN_STAGE_IDS[0];",
    `export const OPEN_STAGE_PACKS = ${literal} as const;`,
    "",
  ].join("\n");
};

const writeAtomic = async (path, content) => {
  // Unchanged outputs are left alone so the dev server does not reload for nothing.
  if (await readFile(path, "utf8").then((current) => current === content, () => false)) return;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content);
  await rename(temporary, path);
};

const scaffold = async () => {
  const id = args.find((argument) => !argument.startsWith("--"));
  const kindIndex = args.indexOf("--kind");
  const kind = kindIndex >= 0 ? args[kindIndex + 1] : undefined;
  assert(id && ID_PATTERN.test(id), "Usage: npm run stage:new -- <id> --kind 2d|3d");
  assert(kind === "2d" || kind === "3d", "--kind must be 2d or 3d");
  const destination = join(packRoot, id);
  try {
    await access(destination);
    fail(`Stage pack ${id} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
  const loaded = await loadPacks();
  const order = Math.max(0, ...loaded.map(({ pack }) => pack.order)) + 10;
  const displayName = id.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
  const stage = {
    $schema: "../stage.schema.json",
    schemaVersion: 1,
    status: "draft",
    id,
    order,
    identity: {
      displayName,
      series: "Ultimate Crashout",
      description: "Describe the stage's gameplay identity",
    },
    gameplay: {
      platforms: [
        { id: "main", x: 0, y: -80, width: 900, height: 160, kind: "ground" },
      ],
      ledges: [
        { platformId: "main", side: "left" },
        { platformId: "main", side: "right" },
      ],
      spawns: [{ x: -180, y: 100 }, { x: 180, y: 100 }],
      blastZone: { left: -1200, right: 1200, top: 1050, bottom: -750 },
    },
    render: {
      kind,
      preview: "assets/preview.png",
      thumbnail: "assets/preview.thumb.webp",
      arena: "assets/arena.webp",
      backdrop: "assets/backdrop.webp",
      art: {
        width: 1920,
        height: 1080,
        originPx: { x: 960, y: 620 },
        worldUnitsPerPixel: 0.9,
      },
      ...(kind === "3d" ? {
        scene: {
          file: "assets/scene.glb",
          scale: 1,
          offset: { x: 0, y: 0 },
          cameraDirection: 1,
        },
      } : {}),
    },
    colors: { edge: "#ffffff", surface: "#62d683", body: "#406557", shadow: "#172d26" },
    license: {
      attribution: "Replace with author and asset name",
      sourcePage: "https://example.invalid/replace-with-source",
      id: "CC0-1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
  };
  await mkdir(join(destination, "assets"), { recursive: true });
  await writeFile(join(destination, "stage.json"), json(stage));
  await writeFile(join(destination, "PROVENANCE.md"), "# Provenance\n\nComplete this before setting the pack to `ready`.\n");
  await writeFile(join(destination, "SHA256SUMS"), "");
  console.log(`Draft stage pack created: ${destination}`);
};

/**
 * Regenerates the derived files of one pack before validation: the 512x288
 * WebP thumbnail from preview.png and SHA256SUMS for every render asset.
 * The author still writes PROVENANCE.md; checksums only prove integrity.
 */
const refreshPackAssets = async (id) => {
  assert(ID_PATTERN.test(id), `Invalid stage id: ${id}`);
  const directory = join(packRoot, id);
  const pack = await readJson(join(directory, "stage.json")).catch(() => fail(`Stage pack not found: ${id}`));
  const render = pack.render ?? {};
  const inside = (assetPath, label) => {
    assert(nonEmpty(assetPath), `${id}: render.${label} is missing`);
    const absolute = resolve(directory, assetPath);
    assert(absolute.startsWith(`${directory}${sep}`), `${id}: render.${label} escapes the stage pack`);
    return absolute;
  };
  const preview = inside(render.preview, "preview");
  const thumbnail = inside(render.thumbnail, "thumbnail");
  await access(preview).catch(() => fail(`${id}: ${render.preview} is missing`));
  for (const tool of ["cwebp"]) {
    assert(spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0,
      `${tool} is required to build stage thumbnails (run npm run content:doctor)`);
  }
  const encoded = spawnSync("cwebp", [
    "-quiet", "-q", "82", "-metadata", "none", "-resize", "512", "288", preview, "-o", thumbnail,
  ], { encoding: "utf8" });
  assert(encoded.status === 0, `${id}: thumbnail encoding failed\n${encoded.stderr ?? ""}`);
  const sprites = (pack.gameplay?.platforms ?? []).map((platform) => platform.motion?.sprite);
  const assets = [render.preview, render.thumbnail, render.arena, render.backdrop, render.scene?.file, ...sprites]
    .filter(nonEmpty);
  const lines = [];
  for (const assetPath of [...new Set(assets)].sort()) {
    const absolute = inside(assetPath, assetPath);
    const bytes = await readFile(absolute).catch(() => fail(`${id}: ${assetPath} is missing`));
    lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${assetPath}`);
  }
  await writeFile(join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
  console.log(`${id}: thumbnail and SHA256SUMS regenerated (${lines.length} files).`);
};

const build = async () => {
  const requestedId = args.find((argument) => !argument.startsWith("--"));
  if (requestedId) {
    // Released on exit, after the registry below is written too.
    holdContentBuildLock(projectRoot, `stage:build ${requestedId}`);
    await refreshPackAssets(requestedId);
  }
  const loaded = await loadPacks();
  await writeAtomic(registryOut, generatedRegistry(loaded));
  const ready = loaded.filter(({ pack }) => pack.status === "ready").length;
  const drafts = loaded.length - ready;
  console.log(`${ready} stage pack(s) synchronized${drafts ? `; ${drafts} draft(s) skipped` : ""}.`);
};

const check = async () => {
  const loaded = await loadPacks();
  const expected = generatedRegistry(loaded);
  const actual = await readFile(registryOut, "utf8").catch(() => "");
  assert(actual === expected, `Outdated registry: ${registryOut}. Run npm run stage:build`);
  const ready = loaded.filter(({ pack }) => pack.status === "ready").length;
  console.log(`${ready} stage pack(s) valid and synchronized.`);
};

const help = () => {
  console.log(`Stage pack commands:
  npm run stage:new -- <id> --kind 2d|3d
  npm run stage:build
  npm run stage:build -- <id>   # also regenerate its thumbnail and SHA256SUMS
  npm run stage:check`);
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
