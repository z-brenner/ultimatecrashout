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
    });

    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"label": "Snap Jab"');
    expect(registry).toContain('"maxJumps": 3');
  });

  it.each([
    [{ attacks: { "super-jab": { damage: 3 } } }, "unknown move gameplay.attacks.super-jab"],
    [{ attacks: { jab: { startup: 0 } } }, "gameplay.attacks.jab.startup must be a positive integer"],
    [{ attacks: { jab: { hitboxes: [{ offset: { x: 1 }, radius: 4 }] } } }, "hitboxes[0].offset must be an {x, y} vector"],
    [{ attacks: { jab: { hitboxes: [{ offset: { x: 1, y: 0 }, radius: 4, activeStart: 3, activeEnd: 1 }] } } }, "activeEnd is before activeStart"],
    [{ throws: { sideways: { damage: 3 } } }, "unknown throw gameplay.throws.sideways"],
    [{ maxJumps: 9 }, "gameplay.maxJumps must be an integer from 1 to 6"],
  ])("rejects invalid gameplay overrides (%j)", (overrides, message) => {
    const workspace = createWorkspace();
    writeReadyPack(workspace, (gameplay) => Object.assign(gameplay, overrides));
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
});
