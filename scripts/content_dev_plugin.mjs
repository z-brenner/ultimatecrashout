import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Open fighter runtime data (2D animation metadata and per-fighter
 * readiness) as a virtual module instead of Vite `define` constants, so
 * `npm run dev` picks up rebuilt packs and atlases without a restart.
 */
export const OPEN_FIGHTER_RUNTIME_MODULE = "virtual:open-fighter-runtime";
const RESOLVED_RUNTIME_MODULE = `\0${OPEN_FIGHTER_RUNTIME_MODULE}`;

const METADATA_2D = "public/assets/characters/open/2d-animation-metadata.json";
const MANIFEST_3D = "scripts/open_fighter_pipeline/manifest.json";
const RUNTIME_INPUT_ROOTS = ["public/assets/characters/open/", "public/assets/ui/fighters/"];
const SYNC_SCRIPTS = {
  fighters: "scripts/fighter_packs.mjs",
  stages: "scripts/stage_packs.mjs",
};
const PACK_FILE = /^(fighters|stages)\/[^/]+\/(fighter|render|stage)\.json$/;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const readOpenFighterRuntime = (root) => {
  const open2DAssetsRoot = join(root, "public/assets/characters/open");
  const metadata = readJson(join(root, METADATA_2D));
  const slots = Object.keys(Object.values(metadata.fighters)[0] ?? {});
  const hasCompleteAtlasSet = (fighter) =>
    slots.length === 50 &&
    slots.every((slot) => existsSync(join(open2DAssetsRoot, fighter, "00", `${slot}.webp`))) &&
    existsSync(join(root, "public/assets/ui/fighters", fighter, "select/00.png"));
  const manifest3D = readJson(join(root, MANIFEST_3D));
  const status = {
    ...Object.fromEntries(
      Object.entries(metadata.fighters).map(([fighter, fighterSlots]) => {
        const visualReady = Object.keys(fighterSlots).length === slots.length && hasCompleteAtlasSet(fighter);
        return [fighter, {
          visualReady,
          productionReady: visualReady &&
            Object.values(fighterSlots).every((slot) =>
              typeof slot === "object" && slot !== null && slot.coverage === "direct"
            ),
        }];
      }),
    ),
    ...Object.fromEntries(
      Object.entries(manifest3D.fighters).map(([fighter, definition]) => {
        const visualReady = hasCompleteAtlasSet(fighter);
        return [fighter, {
          visualReady,
          productionReady: visualReady && definition.directSlots?.length === slots.length,
        }];
      }),
    ),
  };
  return { metadata, status };
};

/** Repository-relative, forward-slash path, or null outside the root. */
const repositoryPath = (root, file) => {
  const path = relative(root, file);
  if (!path || path.startsWith("..")) return null;
  return path.split(sep).join("/");
};

/** What a changed file means for the dev server. */
export const classifyContentChange = (root, file) => {
  const path = repositoryPath(root, file);
  if (!path) return null;
  const pack = path.match(PACK_FILE);
  if (pack) return { kind: "sync", packs: pack[1] };
  if (
    path === METADATA_2D ||
    path === MANIFEST_3D ||
    (RUNTIME_INPUT_ROOTS.some((prefix) => path.startsWith(prefix)) && /\.(webp|png)$/.test(path))
  ) {
    return { kind: "runtime" };
  }
  return null;
};

const runNodeScript = (root, script) =>
  new Promise((resolve) => {
    execFile(process.execPath, [script, "build"], { cwd: root }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });

export const openFighterRuntimePlugin = ({ root }) => ({
  name: "ultimate-crashout-open-fighter-runtime",
  resolveId(id) {
    return id === OPEN_FIGHTER_RUNTIME_MODULE ? RESOLVED_RUNTIME_MODULE : null;
  },
  load(id) {
    if (id !== RESOLVED_RUNTIME_MODULE) return null;
    const { metadata, status } = readOpenFighterRuntime(root);
    return [
      `export const OPEN_2D_RUNTIME_CONTENT = ${JSON.stringify({ metadata })};`,
      `export const OPEN_FIGHTER_RUNTIME_STATUS = ${JSON.stringify(status)};`,
    ].join("\n");
  },
});

/**
 * Dev-server half: saving a fighter or stage pack re-runs the (fast) registry
 * sync, and new atlases or metadata reload the runtime module. Invalid packs
 * show the validator's message in Vite's error overlay.
 */
export const contentWatchPlugin = ({ root, runSync = runNodeScript, debounceMs = 80 }) => ({
  name: "ultimate-crashout-content-watch",
  apply: "serve",
  configureServer(server) {
    if (process.env.VITEST) return;
    const logger = server.config.logger;
    const queues = {};
    let failed = false;

    let reloadTimer;
    const reloadRuntime = () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(invalidateRuntime, debounceMs);
    };
    const invalidateRuntime = () => {
      for (const environment of Object.values(server.environments ?? {})) {
        const module = environment.moduleGraph?.getModuleById(RESOLVED_RUNTIME_MODULE);
        if (module) environment.moduleGraph.invalidateModule(module);
      }
      server.ws.send({ type: "full-reload" });
    };

    const sync = async (packs) => {
      const queue = (queues[packs] ??= { running: false, pending: false, timer: undefined });
      if (queue.running) {
        queue.pending = true;
        return;
      }
      queue.running = true;
      const result = await runSync(root, SYNC_SCRIPTS[packs]);
      queue.running = false;
      if (result.ok) {
        logger.info(`[content] ${result.output || `${packs} synchronized`}`, { timestamp: true });
        // The rewritten registry reloads the page on its own; after a failure
        // the registry may be unchanged, so clear the error overlay here.
        if (failed) server.ws.send({ type: "full-reload" });
        failed = false;
      } else {
        failed = true;
        logger.error(`[content] ${packs} sync failed:\n${result.output}`, { timestamp: true });
        server.ws.send({
          type: "error",
          err: { message: `${packs} pack sync failed:\n${result.output}`, stack: "", plugin: "ultimate-crashout-content-watch" },
        });
      }
      if (queue.pending) {
        queue.pending = false;
        await sync(packs);
      }
    };

    const schedule = (packs) => {
      const queue = (queues[packs] ??= { running: false, pending: false, timer: undefined });
      clearTimeout(queue.timer);
      queue.timer = setTimeout(() => void sync(packs), debounceMs);
    };

    server.watcher.add([join(root, "fighters"), join(root, "stages")]);
    server.watcher.on("all", (event, file) => {
      if (event !== "add" && event !== "change" && event !== "unlink") return;
      const change = classifyContentChange(root, file);
      if (change?.kind === "sync") schedule(change.packs);
      else if (change?.kind === "runtime") reloadRuntime();
    });
  },
});
