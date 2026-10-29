import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const cli = join(projectRoot, "scripts/stage_packs.mjs");
const fixture = join(projectRoot, "stages/verdant-grove");
const temporaryRoots: string[] = [];

const createWorkspace = (): { root: string; packs: string; registry: string } => {
  const root = mkdtempSync(join(tmpdir(), "super-bash-folds-stage-pack-"));
  temporaryRoots.push(root);
  const packs = join(root, "stages");
  mkdirSync(packs);
  copyFileSync(join(projectRoot, "stages/pipeline.config.json"), join(packs, "pipeline.config.json"));
  cpSync(fixture, join(packs, "verdant-grove"), { recursive: true });
  return {
    root,
    packs,
    registry: join(root, "generated/openStageRegistry.ts"),
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
    STAGE_PACKS_ROOT: workspace.packs,
    STAGE_REGISTRY_OUT: workspace.registry,
  },
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("stage pack CLI", () => {
  it("scaffolds a draft that stays out of the generated stage inventory", () => {
    const workspace = createWorkspace();
    expect(runCli(workspace, "new", "community-stage", "--kind", "2d")).toContain(
      "Draft stage pack created",
    );
    const draft = JSON.parse(
      readFileSync(join(workspace.packs, "community-stage/stage.json"), "utf8"),
    );
    expect(draft).toMatchObject({ id: "community-stage", status: "draft" });

    expect(runCli(workspace, "build")).toContain("1 draft(s) skipped");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"verdant-grove"');
    expect(registry).not.toContain('"community-stage"');
  });

  it("registers a ready drop-in pack without editing application source", () => {
    const workspace = createWorkspace();
    const communityDirectory = join(workspace.packs, "community-grove");
    cpSync(fixture, communityDirectory, { recursive: true });
    const stagePath = join(communityDirectory, "stage.json");
    const stage = JSON.parse(readFileSync(stagePath, "utf8"));
    stage.id = "community-grove";
    stage.order = 20;
    stage.identity.displayName = "Community Grove";
    writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`);

    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"community-grove"');
    expect(registry).toContain('"displayName": "Community Grove"');
    expect(registry).toContain("community-grove/assets/arena.webp?url");
  });

  it("rejects an asset path escaping its pack", () => {
    const workspace = createWorkspace();
    const stagePath = join(workspace.packs, "verdant-grove/stage.json");
    const stage = JSON.parse(readFileSync(stagePath, "utf8"));
    stage.render.preview = "../outside.png";
    writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`);

    expect(() => runCli(workspace, "build")).toThrow(/escapes the stage pack/);
  });

  it("rejects assets reached through a symlinked folder outside its pack", () => {
    const workspace = createWorkspace();
    const assets = join(workspace.packs, "verdant-grove/assets");
    const outside = join(workspace.root, "outside-assets");
    renameSync(assets, outside);
    symlinkSync(outside, assets);

    expect(() => runCli(workspace, "build")).toThrow(/escapes the stage pack through a symbolic link/);
  });

  it("detects a stale generated registry", () => {
    const workspace = createWorkspace();
    runCli(workspace, "build");
    const stagePath = join(workspace.packs, "verdant-grove/stage.json");
    const stage = JSON.parse(readFileSync(stagePath, "utf8"));
    stage.identity.description = "Updated description";
    writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`);

    expect(() => runCli(workspace, "check")).toThrow(/Outdated registry/);
  });

  /** Verdant Grove with its top platform moving and a hazard; sprite optional. */
  const writeMechanicsPack = (
    workspace: ReturnType<typeof createWorkspace>,
    edit: (gameplay: Record<string, unknown>) => void = () => undefined,
    sprite = false,
  ): void => {
    const directory = join(workspace.packs, "verdant-grove");
    const stagePath = join(directory, "stage.json");
    const stage = JSON.parse(readFileSync(stagePath, "utf8"));
    const top = stage.gameplay.platforms.find(({ id }: { id: string }) => id === "top");
    top.motion = {
      path: [{ x: 0, y: 317 }, { x: 0, y: 500 }],
      periodFrames: 240,
      easing: "sine",
      ...(sprite ? { sprite: "assets/top.png" } : {}),
    };
    stage.gameplay.hazards = [{
      id: "geyser",
      kind: "zone",
      area: { x: 0, y: 60, width: 80, height: 120 },
      schedule: { periodFrames: 600, warningFrames: 60, activeFrames: 45 },
      hit: { damage: 12, angle: 85, baseKnockback: 50, knockbackGrowth: 0.7, mirrorX: true },
      color: "#4fd1ff",
    }];
    edit(stage.gameplay);
    writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`);
    if (sprite) {
      copyFileSync(join(directory, "assets/preview.png"), join(directory, "assets/top.png"));
      const bytes = readFileSync(join(directory, "assets/top.png"));
      const hash = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(join(directory, "SHA256SUMS"), `${readFileSync(join(directory, "SHA256SUMS"), "utf8")}${hash}  assets/top.png\n`);
    }
  };

  it("accepts moving platforms, hazards, and platform sprites", () => {
    const workspace = createWorkspace();
    writeMechanicsPack(workspace, () => undefined, true);
    runCli(workspace, "build");
    const registry = readFileSync(workspace.registry, "utf8");
    expect(registry).toContain('"periodFrames": 240');
    expect(registry).toContain('"id": "geyser"');
    expect(registry).toContain("verdant-grove/assets/top.png?url");
    expect(registry).toMatch(/"spriteUrls": \{\s*"top": stage\d+Sprite0Url/);
  });

  type Platform = { id: string; motion?: Record<string, unknown>; [key: string]: unknown };
  const top = (gameplay: Record<string, unknown>) =>
    (gameplay.platforms as Platform[]).find(({ id }) => id === "top")!;
  const hazard = (gameplay: Record<string, unknown>) =>
    (gameplay.hazards as Record<string, Record<string, unknown>>[])[0]!;

  it.each([
    ["motion on ground", (g: Record<string, unknown>) => {
      (g.platforms as Platform[])[0]!.motion = { path: [{ x: 0, y: -96 }, { x: 10, y: -96 }], periodFrames: 120 };
    }, "only one-way platforms (kind \"platform\") can move"],
    ["one path point", (g: Record<string, unknown>) => { top(g).motion!.path = [{ x: 0, y: 317 }]; }, "top.motion.path must list 2-8 points"],
    ["start mismatch", (g: Record<string, unknown>) => { top(g).x = 50; }, "top.x/y must be where the motion starts on frame 0 (0, 317)"],
    ["too fast", (g: Record<string, unknown>) => {
      // 383 units each way in 30 frames, with sine easing peaking near 20 units a frame.
      top(g).motion!.path = [{ x: 0, y: 317 }, { x: 0, y: 700 }];
      top(g).motion!.periodFrames = 60;
    }, "top.motion moves up to"],
    ["leaves blast zone", (g: Record<string, unknown>) => {
      top(g).motion!.path = [{ x: 0, y: 317 }, { x: 0, y: 1200 }];
      top(g).motion!.periodFrames = 3600;
    }, "top exceeds the blastZone at the top"],
    ["sine loop", (g: Record<string, unknown>) => { top(g).motion!.mode = "loop"; }, "sine easing only applies to pingpong"],
    ["unknown motion field", (g: Record<string, unknown>) => { top(g).motion!.speed = 3; }, "top.motion.speed is not a known field"],
    ["no warning", (g: Record<string, unknown>) => { (hazard(g).schedule as Record<string, number>).warningFrames = 5; },
      "gameplay.hazards[0].schedule.warningFrames must be at least 30"],
    ["schedule overflow", (g: Record<string, unknown>) => { (hazard(g).schedule as Record<string, number>).activeFrames = 560; },
      "warningFrames + activeFrames must be less than periodFrames"],
    ["huge damage", (g: Record<string, unknown>) => { (hazard(g).hit as Record<string, number>).damage = 90; },
      "gameplay.hazards[0].hit.damage must be 0-40"],
    ["zone outside", (g: Record<string, unknown>) => { (hazard(g).area as Record<string, number>).x = 1300; },
      "gameplay.hazards[0].area must lie inside the blastZone"],
    ["bad colour", (g: Record<string, unknown>) => { hazard(g).color = "blue" as never; }, "gameplay.hazards[0].color must be a #rrggbb colour"],
  ])("rejects invalid stage mechanics: %s", (_name, edit, message) => {
    const workspace = createWorkspace();
    writeMechanicsPack(workspace, edit);
    expect(() => runCli(workspace, "build")).toThrow(message);
  });

  const hasCwebp = spawnSync("cwebp", ["-version"], { stdio: "ignore" }).status === 0;

  it.skipIf(!hasCwebp)("derives the thumbnail and checksums for one pack on build", () => {
    const workspace = createWorkspace();
    const directory = join(workspace.packs, "verdant-grove");
    rmSync(join(directory, "assets/preview.thumb.webp"));
    writeFileSync(join(directory, "SHA256SUMS"), "");

    expect(runCli(workspace, "build", "verdant-grove")).toContain(
      "verdant-grove: thumbnail and SHA256SUMS regenerated (4 files)",
    );
    const sums = readFileSync(join(directory, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums.map((line) => line.split("  ")[1])).toEqual([
      "assets/arena.webp",
      "assets/backdrop.webp",
      "assets/preview.png",
      "assets/preview.thumb.webp",
    ]);
    // The regenerated pack passes the full validator.
    expect(runCli(workspace, "check")).toContain("1 stage pack(s) valid");
  });
});
