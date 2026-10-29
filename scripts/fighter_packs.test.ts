import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const cli = join(projectRoot, "scripts/fighter_packs.mjs");
const temporaryRoots: string[] = [];

const createWorkspace = (): {
  root: string;
  packs: string;
  registry: string;
  manifest3D: string;
  manifest2D: string;
} => {
  const root = mkdtempSync(join(tmpdir(), "super-bash-folds-fighter-pack-"));
  temporaryRoots.push(root);
  const packs = join(root, "fighters");
  mkdirSync(packs);
  copyFileSync(join(projectRoot, "fighters/pipeline.config.json"), join(packs, "pipeline.config.json"));
  return {
    root,
    packs,
    registry: join(root, "generated/openFighterRegistry.ts"),
    manifest3D: join(root, "generated/manifest.json"),
    manifest2D: join(root, "generated/2d_manifest.json"),
  };
};

const runCli = (
  workspace: ReturnType<typeof createWorkspace>,
  ...args: string[]
): string => execFileSync(process.execPath, [cli, ...args], {
  cwd: projectRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    FIGHTER_PACKS_ROOT: workspace.packs,
    FIGHTER_REGISTRY_OUT: workspace.registry,
    OPEN_3D_MANIFEST_OUT: workspace.manifest3D,
    OPEN_2D_MANIFEST_OUT: workspace.manifest2D,
  },
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("fighter pack CLI", () => {
  it("scaffolds a draft that stays out of the generated roster", () => {
    const workspace = createWorkspace();

    expect(runCli(workspace, "new", "example-fighter", "--kind", "2d")).toContain(
      "Draft fighter pack created",
    );
    const draft = JSON.parse(
      readFileSync(join(workspace.packs, "example-fighter/fighter.json"), "utf8"),
    );
    expect(draft).toMatchObject({ id: "example-fighter", kind: "2d", status: "draft" });

    expect(runCli(workspace, "build")).toContain("1 draft(s) skipped");
    expect(readFileSync(workspace.registry, "utf8")).toContain(
      "export const OPEN_FIGHTER_PACKS = [] as const",
    );
  });

  it("registers a ready drop-in pack without editing src", () => {
    const workspace = createWorkspace();
    const fighterDirectory = join(workspace.packs, "community-fighter");
    cpSync(join(projectRoot, "fighters/rgs-stick"), fighterDirectory, { recursive: true });

    const fighterPath = join(fighterDirectory, "fighter.json");
    const fighter = JSON.parse(readFileSync(fighterPath, "utf8"));
    fighter.id = "community-fighter";
    fighter.order = 10;
    fighter.identity.displayName = "Community Fighter";
    writeFileSync(fighterPath, `${JSON.stringify(fighter, null, 2)}\n`);

    runCli(workspace, "build");

    const registry = readFileSync(workspace.registry, "utf8");
    const manifest2D = JSON.parse(readFileSync(workspace.manifest2D, "utf8"));
    expect(registry).toContain('"community-fighter"');
    expect(registry).toContain('"displayName": "Community Fighter"');
    expect(Object.keys(manifest2D.fighters)).toEqual(["community-fighter"]);
    expect(JSON.parse(readFileSync(workspace.manifest3D, "utf8")).fighters).toEqual({});
  });

  const writeReadyPack = (
    workspace: ReturnType<typeof createWorkspace>,
    edit: (gameplay: Record<string, unknown>) => void,
  ): void => {
    const fighterDirectory = join(workspace.packs, "rgs-stick");
    cpSync(join(projectRoot, "fighters/rgs-stick"), fighterDirectory, { recursive: true });
    const fighterPath = join(fighterDirectory, "fighter.json");
    const fighter = JSON.parse(readFileSync(fighterPath, "utf8"));
    edit(fighter.gameplay);
    writeFileSync(fighterPath, `${JSON.stringify(fighter, null, 2)}\n`);
  };

  it("accepts authored attacks, hitboxes, throws, and jump counts", () => {
    const workspace = createWorkspace();
    writeReadyPack(workspace, (gameplay) => {
      gameplay.maxJumps = 3;
      gameplay.attacks = {
        jab: {
          label: "Snap Jab",
          damage: 4,
          startup: 2,
          active: 3,
          recovery: 8,
          hitboxes: [
            { offset: { x: 20, y: 6 }, radius: 14, kind: "sour", priority: 2 },
            { offset: { x: 38, y: 6 }, endOffset: { x: 44, y: 4 }, radius: 12, activeStart: 0, activeEnd: 2, kind: "sweet" },
          ],
        },
      };
      gameplay.throws = { back: { damage: 11, baseKnockback: 60 } };
      (gameplay.attacks as Record<string, unknown>)["down-air"] = {
        landingLag: 18,
        autoCancel: { before: 3, after: 30 },
        hitboxes: [{ offset: { x: 0, y: -40 }, radius: 12, angle: 270, baseKnockback: 30, knockbackGrowth: 0.6 }],
      };
      (gameplay.attacks as Record<string, unknown>)["down-special"] = {
        intangible: { start: 0, end: 4 },
        superArmor: { start: 5, end: 12 },
      };
    });

    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"label": "Snap Jab"');
    expect(registry).toContain('"maxJumps": 3');
    expect(registry).toContain('"landingLag": 18');
    expect(registry).toContain('"superArmor"');
  });

  it.each([
    [{ attacks: { "super-jab": { damage: 3 } } }, "unknown move gameplay.attacks.super-jab"],
    [{ attacks: { jab: { startup: 0 } } }, "gameplay.attacks.jab.startup must be a positive integer"],
    [{ attacks: { jab: { hitboxes: [{ offset: { x: 1 }, radius: 4 }] } } }, "hitboxes[0].offset must be an {x, y} vector"],
    [{ attacks: { jab: { hitboxes: [{ offset: { x: 1, y: 0 }, radius: 4, activeStart: 3, activeEnd: 1 }] } } }, "activeEnd is before activeStart"],
    [{ throws: { sideways: { damage: 3 } } }, "unknown throw gameplay.throws.sideways"],
    [{ maxJumps: 9 }, "gameplay.maxJumps must be an integer from 1 to 6"],
    [{ attacks: { jab: { landingLag: 8 } } }, "gameplay.attacks.jab.landingLag only applies to aerials"],
    [{ attacks: { "neutral-air": { autoCancel: {} } } }, "neutral-air.autoCancel must set before and/or after"],
    [{ attacks: { "neutral-air": { autoCancel: { befor: 3, after: 20 } } } }, "unknown field gameplay.attacks.neutral-air.autoCancel.befor"],
    [{ attacks: { "neutral-air": { autoCancel: { before: 30, after: 20 } } } }, "neutral-air.autoCancel.before must be lower than after"],
    [{ attacks: { jab: { superArmor: { start: 1, end: 4, from: 2 } } } }, "unknown field gameplay.attacks.jab.superArmor.from"],
    [{ attacks: { "down-special": { superArmor: { start: 9, end: 2 } } } }, "down-special.superArmor.end is before start"],
    [{ attacks: { jab: { intangible: { start: -1, end: 2 } } } }, "jab.intangible.start and end must be non-negative integers"],
    [{ attacks: { jab: { hitboxes: [{ offset: { x: 1, y: 0 }, radius: 4, baseKnockback: -5 }] } } }, "hitboxes[0].baseKnockback must be a non-negative number"],
  ])("rejects invalid gameplay overrides (%j)", (overrides, message) => {
    const workspace = createWorkspace();
    writeReadyPack(workspace, (gameplay) => Object.assign(gameplay, overrides));
    expect(() => runCli(workspace, "build")).toThrow(message);
  });

  const writeSkinnedPack = (workspace: ReturnType<typeof createWorkspace>, skins: unknown): void => {
    const fighterDirectory = join(workspace.packs, "rgs-stick");
    cpSync(join(projectRoot, "fighters/rgs-stick"), fighterDirectory, { recursive: true });
    const fighterPath = join(fighterDirectory, "fighter.json");
    const fighter = JSON.parse(readFileSync(fighterPath, "utf8"));
    fighter.visual.skins = skins;
    writeFileSync(fighterPath, `${JSON.stringify(fighter, null, 2)}\n`);
  };

  it("accepts palette-swap skins and publishes them in the registry", () => {
    const workspace = createWorkspace();
    writeSkinnedPack(workspace, [
      { name: "Crimson", swaps: [{ from: "#f6c41a", to: "#c8323c" }] },
      { name: "Teal", swaps: [{ from: "#f6c41a", to: "#20cea6", tolerance: 30 }, { from: "#ff543c", to: "#2a6cff" }] },
    ]);
    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"name": "Crimson"');
    expect(registry).toContain('"tolerance": 30');
  });

  it.each([
    [[], "visual.skins must be a list of 1-3 skins"],
    [[{ name: "A", swaps: [{ from: "#f6c41a", to: "#c8323c" }] }, { name: "B", swaps: [{ from: "#f6c41a", to: "#000000" }] },
      { name: "C", swaps: [{ from: "#f6c41a", to: "#ffffff" }] }, { name: "D", swaps: [{ from: "#f6c41a", to: "#123456" }] }],
    "visual.skins must be a list of 1-3 skins"],
    [[{ name: "Crimson", swaps: [] }], "visual.skins[0].swaps must list 1-6 colour swaps"],
    [[{ name: "Crimson", swaps: [{ from: "red", to: "#c8323c" }] }], "visual.skins[0].swaps[0].from must be a #rrggbb colour"],
    [[{ name: "Ghost", swaps: [{ from: "#808080", to: "#c8323c" }] }], "visual.skins[0].swaps[0].from #808080 is too grey or dark"],
    [[{ name: "Crimson", swaps: [{ from: "#f6c41a", to: "#c8323c", tolerance: 120 }] }], "visual.skins[0].swaps[0].tolerance must be 1-90"],
    [[{ name: "Crimson", swaps: [{ from: "#f6c41a", to: "#c8323c", hue: 3 }] }], "visual.skins[0].swaps[0].hue is not a swap field"],
    [[{ name: "Crimson", swaps: [{ from: "#f6c41a", to: "#c8323c" }] }, { name: "crimson ", swaps: [{ from: "#f6c41a", to: "#123456" }] }],
      'visual.skins[1].name "crimson " is used twice'],
    [[{ name: "Crimson", palette: "red", swaps: [{ from: "#f6c41a", to: "#c8323c" }] }], "visual.skins[0].palette is not a skin field"],
  ])("rejects invalid skins (%j)", (skins, message) => {
    const workspace = createWorkspace();
    writeSkinnedPack(workspace, skins);
    expect(() => runCli(workspace, "build")).toThrow(message);
  });

  const writeStripPack = (
    workspace: ReturnType<typeof createWorkspace>,
    strips: string[],
    renderEdit: (render: Record<string, unknown>) => void = () => undefined,
  ): void => {
    const fighterDirectory = join(workspace.packs, "strip-fighter");
    mkdirSync(join(fighterDirectory, "sprites"), { recursive: true });
    const fighter = JSON.parse(readFileSync(join(projectRoot, "fighters/buckle/fighter.json"), "utf8"));
    fighter.id = "strip-fighter";
    // Only the sprites are copied; Buckle's sound files stay behind.
    delete fighter.audio;
    writeFileSync(join(fighterDirectory, "fighter.json"), JSON.stringify(fighter));
    const render = JSON.parse(readFileSync(join(projectRoot, "fighters/buckle/render.json"), "utf8"));
    renderEdit(render);
    writeFileSync(join(fighterDirectory, "render.json"), JSON.stringify(render));
    for (const name of strips) {
      copyFileSync(
        join(projectRoot, "fighters/buckle/sprites/idle.png"),
        join(fighterDirectory, "sprites", name),
      );
    }
  };

  it("expands a sprite-strip folder and fills missing slots from related strips", () => {
    const workspace = createWorkspace();
    writeStripPack(workspace, ["idle.png", "jab.png", "jump.png"]);
    runCli(workspace, "build");
    const render = JSON.parse(readFileSync(workspace.manifest2D, "utf8")).fighters["strip-fighter"];
    expect(render.spriteStrips).toBeUndefined();
    expect(Object.keys(render.slots.direct).sort()).toEqual(["idle", "jab", "jump"]);
    expect(render.slots.author_required).toMatchObject({
      forward_smash: "jab",
      double_jump: "jump",
      fast_fall: "jump",
      walk: "idle",
    });
    expect(Object.keys(render.slots.author_required)).toHaveLength(47);
    expect(render.actions.jab).toEqual({
      type: "strip",
      sheet: expect.stringMatching(/strip-fighter\/sprites\/jab\.png$/),
      frameWidth: 160,
      frameHeight: 160,
    });
    expect(render.actions.idle.fps).toBe(8);
  });

  it.each([
    [["idle.png", "punch.png"], () => undefined, "unknown sprite strip(s) punch.png"],
    [["jab.png"], () => undefined, "spriteStrips requires at least idle.png"],
    [["idle.png"], (render: Record<string, any>) => { render.spriteStrips.directory = "../../elsewhere"; }, "must stay inside the fighter pack"],
  ])("rejects invalid sprite-strip packs (%j)", (strips, edit, message) => {
    const workspace = createWorkspace();
    writeStripPack(workspace, strips, edit);
    expect(() => runCli(workspace, "build")).toThrow(message);
  });

  it("scaffolds a 2D draft with a sprite-strip folder", () => {
    const workspace = createWorkspace();
    runCli(workspace, "new", "fresh-fighter", "--kind", "2d");
    const render = JSON.parse(readFileSync(join(workspace.packs, "fresh-fighter/render.json"), "utf8"));
    expect(render.spriteStrips).toMatchObject({ directory: "sprites", frameWidth: 128, frameHeight: 128 });
    expect(readFileSync(join(workspace.packs, "fresh-fighter/sprites/README.md"), "utf8")).toContain("idle.png");
  });

  it.each([
    [{ grab_hold: 2 }, "visual.keyFrames.grab_hold is not an attack animation slot"],
    [{ jab: -1 }, "visual.keyFrames.jab must be a non-negative integer"],
  ])("rejects invalid animation key frames (%j)", (keyFrames, message) => {
    const workspace = createWorkspace();
    const fighterDirectory = join(workspace.packs, "rgs-stick");
    cpSync(join(projectRoot, "fighters/rgs-stick"), fighterDirectory, { recursive: true });
    const fighterPath = join(fighterDirectory, "fighter.json");
    const fighter = JSON.parse(readFileSync(fighterPath, "utf8"));
    fighter.visual.keyFrames = keyFrames;
    writeFileSync(fighterPath, JSON.stringify(fighter));
    expect(() => runCli(workspace, "build")).toThrow(message);
  });

  /** rgs-stick with an audio block; `files` are written into its audio/ folder. */
  const writeVoicedPack = (
    workspace: ReturnType<typeof createWorkspace>,
    audio: unknown,
    files: Record<string, Buffer> = {},
  ): string => {
    const fighterDirectory = join(workspace.packs, "rgs-stick");
    cpSync(join(projectRoot, "fighters/rgs-stick"), fighterDirectory, { recursive: true });
    mkdirSync(join(fighterDirectory, "audio"));
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(fighterDirectory, "audio", name), bytes);
    const fighterPath = join(fighterDirectory, "fighter.json");
    const fighter = JSON.parse(readFileSync(fighterPath, "utf8"));
    fighter.audio = audio;
    writeFileSync(fighterPath, JSON.stringify(fighter));
    return fighterDirectory;
  };
  const ogg = (size = 64): Buffer => Buffer.concat([Buffer.from("OggS"), Buffer.alloc(size - 4)]);
  const voiced = (cues: unknown) => ({ attribution: "Test sounds", license: { id: "CC0-1.0" }, cues });

  it("bundles a pack's own sound cues through the registry", () => {
    const workspace = createWorkspace();
    writeVoicedPack(workspace, voiced({
      attack: ["audio/swing-1.ogg", "audio/swing-2.ogg"],
      hurt: ["audio/oof.ogg"],
      // One file may serve several cues.
      taunt: ["audio/swing-1.ogg"],
    }), { "swing-1.ogg": ogg(), "swing-2.ogg": ogg(), "oof.ogg": ogg() });

    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toMatch(/import fighterAudio0 from "[./]*\/?.*fighters\/rgs-stick\/audio\/swing-1\.ogg\?url";/);
    expect(registry).toContain("attack: [fighterAudio0, fighterAudio1],");
    expect(registry).toContain("hurt: [fighterAudio2],");
    expect(registry).toContain("taunt: [fighterAudio3],");
  });

  it("emits an empty audio table when no pack has sounds", () => {
    const workspace = createWorkspace();
    writeReadyPack(workspace, () => {});
    runCli(workspace, "build");
    expect(readFileSync(workspace.registry, "utf8")).toMatch(/export const OPEN_FIGHTER_AUDIO: .* = \{\};/);
  });

  it.each([
    [{ attribution: "x", license: { id: "CC0-1.0" }, cues: { attack: ["audio/a.ogg"] }, volume: 2 },
      "audio.volume is not an audio field"],
    [{ license: { id: "CC0-1.0" }, cues: { attack: ["audio/a.ogg"] } }, "audio.attribution is missing"],
    [{ attribution: "x", cues: { attack: ["audio/a.ogg"] } }, "audio.license.id is missing"],
    [voiced({}), "audio.cues must name at least one cue"],
    [voiced({ yell: ["audio/a.ogg"] }), "audio.cues.yell is not a cue (attack, smash, special"],
    [voiced({ attack: "audio/a.ogg" }), "audio.cues.attack must list 1-4 files"],
    [voiced({ attack: ["audio/a.ogg", "audio/a.ogg"] }), "audio.cues.attack lists a file twice"],
    [voiced({ attack: ["../rgs-stick/audio/a.ogg", "../../escape.ogg"] }), "audio.cues.attack[1] escapes the fighter pack"],
    [voiced({ attack: ["audio/a.flac"] }), "audio.cues.attack[0] must be one of .ogg, .mp3, .m4a, .wav"],
    [voiced({ attack: ["audio/missing.ogg"] }), "audio.cues.attack[0] (audio/missing.ogg) is missing"],
    [voiced({ attack: ["audio/fake.ogg"] }), "audio/fake.ogg is not a valid .ogg file"],
    [voiced({ attack: ["audio/huge.ogg"] }), "audio/huge.ogg is 300 KiB; a cue file may be at most 256 KiB"],
    [voiced({ attack: ["audio/b1.ogg", "audio/b2.ogg", "audio/b3.ogg", "audio/b4.ogg"],
      hurt: ["audio/b5.ogg", "audio/b6.ogg", "audio/b7.ogg", "audio/b8.ogg"], ko: ["audio/b9.ogg"] }),
    "audio files total 2250 KiB; a pack may ship at most 2048 KiB"],
  ])("rejects invalid audio (%j)", (audio, message) => {
    const workspace = createWorkspace();
    const big = ogg(250 * 1024);
    writeVoicedPack(workspace, audio, {
      "a.ogg": ogg(),
      "a.flac": ogg(),
      "fake.ogg": Buffer.from("ID3 not really ogg"),
      "huge.ogg": ogg(300 * 1024),
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [`b${index}.ogg`, big])),
    });
    expect(() => runCli(workspace, "build")).toThrow(message);
  });
});
