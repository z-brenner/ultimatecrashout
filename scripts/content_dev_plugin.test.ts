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
    ["stages/crash-course/stage.json", { kind: "sync", packs: "stages" }],
    ["public/assets/characters/open/2d-animation-metadata.json", { kind: "runtime" }],
    ["scripts/open_fighter_pipeline/manifest.json", { kind: "runtime" }],
    ["public/assets/characters/open/buckle/00/jab.webp", { kind: "runtime" }],
    ["public/assets/ui/fighters/buckle/select/00.png", { kind: "runtime" }],
    ["fighters/buckle/sprites/jab.png", null],
    ["fighters/README.md", null],
    ["src/game/engine.ts", null],
  ])("%s", (path, expected) => {
    expect(classifyContentChange(root, join(root, path))).toEqual(expected);
  });

  it("ignores files outside the repository", () => {
    expect(classifyContentChange(root, join(root, "..", "fighters/x/fighter.json"))).toBeNull();
  });
});

describe("content watch plugin", () => {
  const savedVitest = process.env.VITEST;
  afterEach(() => {
    process.env.VITEST = savedVitest;
  });

  const startServer = (runSync: (root: string, script: string) => Promise<{ ok: boolean; output: string }>) => {
    delete process.env.VITEST;
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const runtimeModule = { id: "runtime" };
    const moduleGraph = {
      getModuleById: vi.fn(() => runtimeModule),
      invalidateModule: vi.fn(),
    };
    const server = {
      config: { logger: { info: vi.fn(), error: vi.fn() } },
      environments: { client: { moduleGraph } },
      watcher,
      ws: { send: vi.fn() },
    };
    const plugin = contentWatchPlugin({ root, runSync, debounceMs: 1 }) as {
      configureServer: (server: unknown) => void;
    };
    plugin.configureServer(server);
    const emit = (event: string, path: string) => watcher.emit("all", event, join(root, path));
    return { server, moduleGraph, emit, watcher };
  };

  it("syncs once per burst of pack saves and watches pack folders", async () => {
    const runSync = vi.fn(async () => ({ ok: true, output: "15 fighter pack(s) synchronized." }));
    const { emit, watcher, server } = startServer(runSync);
    expect(watcher.add).toHaveBeenCalledWith([join(root, "fighters"), join(root, "stages")]);
    emit("change", "fighters/buckle/fighter.json");
    emit("change", "fighters/buckle/fighter.json");
    emit("change", "fighters/buckle/render.json");
    emit("change", "src/game/engine.ts");
    await settle();
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(root, "scripts/fighter_packs.mjs");
    // Success needs no reload of its own: the rewritten registry triggers one.
    expect(server.ws.send).not.toHaveBeenCalled();
  });

  it("shows validation failures in the overlay and clears them on the next good save", async () => {
    const runSync = vi.fn()
      .mockResolvedValueOnce({ ok: false, output: "buckle: gameplay.attacks.jab.startup must be a positive integer" })
      .mockResolvedValueOnce({ ok: true, output: "1 stage pack(s) synchronized." });
    const { emit, server } = startServer(runSync);
    emit("change", "stages/crash-course/stage.json");
    await settle();
    expect(server.ws.send).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      err: expect.objectContaining({ message: expect.stringContaining("jab.startup must be a positive integer") }),
    }));
    emit("change", "stages/crash-course/stage.json");
    await settle();
    expect(server.ws.send).toHaveBeenLastCalledWith({ type: "full-reload" });
  });

  it("re-runs a sync requested while one is in flight", async () => {
    let finish: (value: { ok: boolean; output: string }) => void = () => undefined;
    const runSync = vi.fn(() => new Promise<{ ok: boolean; output: string }>((resolve) => { finish = resolve; }));
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

  it("reloads the runtime module once when atlases land", async () => {
    const { emit, server, moduleGraph } = startServer(vi.fn());
    emit("add", "public/assets/characters/open/buckle/00/jab.webp");
    emit("add", "public/assets/characters/open/buckle/00/idle.webp");
    emit("change", "public/assets/characters/open/2d-animation-metadata.json");
    await settle();
    expect(moduleGraph.invalidateModule).toHaveBeenCalledTimes(1);
    expect(server.ws.send).toHaveBeenCalledTimes(1);
    expect(server.ws.send).toHaveBeenCalledWith({ type: "full-reload" });
  });

  it("stays inert inside Vitest", () => {
    process.env.VITEST = "true";
    const watcher = { add: vi.fn(), on: vi.fn() };
    const plugin = contentWatchPlugin({ root }) as { configureServer: (server: unknown) => void };
    plugin.configureServer({ config: { logger: {} }, watcher, ws: { send: vi.fn() } });
    expect(watcher.add).not.toHaveBeenCalled();
    expect(watcher.on).not.toHaveBeenCalled();
  });
});
