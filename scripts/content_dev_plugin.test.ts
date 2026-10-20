import { EventEmitter } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPEN_FIGHTER_RUNTIME_MODULE,
  classifyContentChange,
  contentWatchPlugin,
  openFighterRuntimePlugin,
  readOpenFighterRuntime,
} from "./content_dev_plugin.mjs";
import { OPEN_2D_FIGHTER_IDS, OPEN_3D_FIGHTER_IDS } from "../src/game/generated/openFighterRegistry";

const root = fileURLToPath(new URL("..", import.meta.url));
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("open fighter runtime module", () => {
  it("reports readiness for every registered fighter", () => {
    const { metadata, status } = readOpenFighterRuntime(root);
    expect(Object.keys(status).sort()).toEqual([...OPEN_2D_FIGHTER_IDS, ...OPEN_3D_FIGHTER_IDS].sort());
    expect(Object.keys(metadata.fighters).sort()).toEqual([...OPEN_2D_FIGHTER_IDS].sort());
    expect(status.buckle).toEqual({ visualReady: true, productionReady: true });
  });

  it("serves the data as a virtual module read at load time", () => {
    const plugin = openFighterRuntimePlugin({ root }) as {
      resolveId: (id: string) => string | null;
      load: (id: string) => string | null;
    };
    const resolved = plugin.resolveId(OPEN_FIGHTER_RUNTIME_MODULE)!;
    expect(plugin.resolveId("./other")).toBeNull();
    expect(plugin.load("./other")).toBeNull();
    const source = plugin.load(resolved)!;
    expect(source).toContain("export const OPEN_2D_RUNTIME_CONTENT = {\"metadata\":");
    expect(source).toContain("export const OPEN_FIGHTER_RUNTIME_STATUS = {");
  });
});

describe("content change classification", () => {
  it.each([
    ["fighters/buckle/fighter.json", { kind: "sync", packs: "fighters" }],
    ["fighters/buckle/render.json", { kind: "sync", packs: "fighters" }],
    ["fighters/buckle/sprites/jab.png", { kind: "sync", packs: "fighters" }],
    ["fighters/pipeline.config.json", { kind: "sync", packs: "fighters" }],
    ["stages/crash-course/stage.json", { kind: "sync", packs: "stages" }],
    ["stages/crash-course/arena.webp", { kind: "sync", packs: "stages" }],
    ["public/assets/characters/open/2d-animation-metadata.json", { kind: "reload" }],
    ["scripts/open_fighter_pipeline/manifest.json", { kind: "reload" }],
    ["src/game/generated/openFighterRegistry.ts", { kind: "reload" }],
    ["src/game/generated/openStageRegistry.ts", { kind: "reload" }],
    ["public/assets/ui/fighters/buckle/select/00.png", { kind: "reload" }],
    // Mid-build atlas churn waits for the metadata written at the end.
    ["public/assets/characters/open/buckle/00/jab.webp", null],
    ["fighters/README.md", null],
    ["stages/crash-course/PROVENANCE.md", null],
    ["src/game/engine.ts", null],
  ])("%s", (path, expected) => {
    expect(classifyContentChange(root, join(root, path))).toEqual(expected);
  });

  it("ignores files outside the repository", () => {
    expect(classifyContentChange(root, join(root, "..", "fighters/x/fighter.json"))).toBeNull();
  });
});

type SyncResult = { ok: boolean; output: string };
type WatchPlugin = {
  configureServer: (server: unknown) => void;
  hotUpdate: (options: { file: string }) => unknown;
};

describe("content watch plugin", () => {
  const savedVitest = process.env.VITEST;
  afterEach(() => {
    process.env.VITEST = savedVitest;
  });

  const startServer = (runSync: (root: string, script: string) => Promise<SyncResult>) => {
    delete process.env.VITEST;
    const watcher = new EventEmitter();
    const ws = Object.assign(new EventEmitter(), { send: vi.fn() });
    const runtimeModule = { id: "runtime" };
    const moduleGraph = {
      getModuleById: vi.fn(() => runtimeModule),
      invalidateModule: vi.fn(),
    };
    const server = {
      config: { logger: { info: vi.fn(), error: vi.fn() } },
      environments: { client: { moduleGraph } },
      watcher,
      ws,
    };
    const plugin = contentWatchPlugin({ root, runSync, debounceMs: 1, reloadQuietMs: 5 }) as unknown as WatchPlugin;
    plugin.configureServer(server);
    const emit = (event: string, path: string) => watcher.emit("all", event, join(root, path));
    const sent = () => ws.send.mock.calls.map(([payload]) => payload as { type: string; err?: { message: string } });
    return { plugin, ws, moduleGraph, emit, sent };
  };

  it("syncs once per burst of pack saves", async () => {
    const runSync = vi.fn(async () => ({ ok: true, output: "15 fighter pack(s) synchronized." }));
    const { emit, ws } = startServer(runSync);
    emit("change", "fighters/buckle/fighter.json");
    emit("change", "fighters/buckle/fighter.json");
    emit("add", "fighters/buckle/sprites/jab.png");
    emit("change", "src/game/engine.ts");
    await settle();
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(root, "scripts/fighter_packs.mjs");
    // Success needs no reload of its own: the rewritten registry triggers one.
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("reloads once for a regenerated registry and manifest, replacing Vite's own update", async () => {
    const { plugin, emit, sent, moduleGraph } = startServer(vi.fn());
    expect(plugin.hotUpdate({ file: join(root, "src/game/generated/openFighterRegistry.ts") })).toEqual([]);
    expect(plugin.hotUpdate({ file: join(root, "src/game/engine.ts") })).toBeUndefined();
    emit("change", "src/game/generated/openFighterRegistry.ts");
    emit("change", "scripts/open_fighter_pipeline/manifest.json");
    await settle();
    expect(sent()).toEqual([{ type: "full-reload" }]);
    expect(moduleGraph.invalidateModule).toHaveBeenCalledTimes(1);
  });

  it("waits for the end of an atlas build before reloading", async () => {
    const { emit, sent } = startServer(vi.fn());
    emit("unlink", "public/assets/characters/open/buckle/00/jab.webp");
    emit("add", "public/assets/characters/open/buckle/00/jab.webp");
    await settle();
    expect(sent()).toEqual([]);
    emit("change", "public/assets/characters/open/2d-animation-metadata.json");
    await settle();
    expect(sent()).toEqual([{ type: "full-reload" }]);
  });

  it("keeps each pack type's error until that type is fixed", async () => {
    const results: Record<string, SyncResult[]> = {
      "scripts/fighter_packs.mjs": [
        { ok: false, output: "buckle: gameplay.attacks.jab.startup must be a positive integer" },
        { ok: true, output: "15 fighter pack(s) synchronized." },
      ],
      "scripts/stage_packs.mjs": [{ ok: true, output: "1 stage pack(s) synchronized." }],
    };
    const runSync = vi.fn(async (_root: string, script: string) => results[script]!.shift()!);
    const { emit, ws, sent } = startServer(runSync);
    emit("change", "fighters/buckle/fighter.json");
    await settle();
    expect(sent().at(-1)?.err?.message).toContain("jab.startup must be a positive integer");

    // A good stage save must not hide the still-invalid fighter pack.
    emit("change", "stages/crash-course/stage.json");
    await settle();
    expect(sent().filter(({ type }) => type === "full-reload")).toEqual([]);

    // A reloaded or newly opened tab sees the error again.
    ws.send.mockClear();
    ws.emit("connection");
    expect(sent().at(-1)?.err?.message).toContain("jab.startup");

    // Fixing the fighter clears the overlay, even if the registry is unchanged.
    emit("change", "fighters/buckle/fighter.json");
    await settle();
    expect(sent().at(-1)).toEqual({ type: "full-reload" });
    ws.send.mockClear();
    ws.emit("connection");
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("re-runs a sync requested while one is in flight", async () => {
    let finish: (value: SyncResult) => void = () => undefined;
    const runSync = vi.fn(() => new Promise<SyncResult>((resolve) => { finish = resolve; }));
    const { emit } = startServer(runSync);
    emit("change", "fighters/buckle/fighter.json");
    await settle();
    emit("change", "fighters/buckle/fighter.json");
    await settle();
    expect(runSync).toHaveBeenCalledTimes(1);
    finish({ ok: true, output: "" });
    await settle();
    expect(runSync).toHaveBeenCalledTimes(2);
    finish({ ok: true, output: "" });
  });

  it("treats a crashed sync as a failure and keeps syncing afterwards", async () => {
    const runSync = vi.fn()
      .mockRejectedValueOnce(new Error("spawn ENOENT"))
      .mockResolvedValueOnce({ ok: true, output: "" });
    const { emit, sent } = startServer(runSync);
    emit("change", "stages/crash-course/stage.json");
    await settle();
    expect(sent().at(-1)?.err?.message).toContain("spawn ENOENT");
    emit("change", "stages/crash-course/stage.json");
    await settle();
    expect(runSync).toHaveBeenCalledTimes(2);
    expect(sent().at(-1)).toEqual({ type: "full-reload" });
  });

  it("stays inert inside Vitest", () => {
    process.env.VITEST = "true";
    const watcher = { on: vi.fn() };
    const plugin = contentWatchPlugin({ root }) as unknown as WatchPlugin;
    plugin.configureServer({ config: { logger: {} }, watcher, ws: { send: vi.fn(), on: vi.fn() } });
    expect(watcher.on).not.toHaveBeenCalled();
    expect(plugin.hotUpdate({ file: join(root, "src/game/generated/openFighterRegistry.ts") })).toBeUndefined();
  });
});
