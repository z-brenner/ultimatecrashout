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
const SYNC_SCRIPTS = {
  fighters: "scripts/fighter_packs.mjs",
  stages: "scripts/stage_packs.mjs",
};
/**
 * Files the game reads only through a full reload. Atlas builds rewrite
 * dozens of .webp files and finish with the metadata, so the metadata (not
 * each atlas) is the reload point; a half-built fighter is never served.
 */
const RELOAD_FILES = new Set([
  METADATA_2D,
  MANIFEST_3D,
  "src/game/generated/openFighterRegistry.ts",
  "src/game/generated/openStageRegistry.ts",
]);
const PORTRAIT = /^public\/assets\/ui\/fighters\/[^/]+\/select\/00\.png$/;
const GENERATED_REGISTRIES = new Set([
  "src/game/generated/openFighterRegistry.ts",
  "src/game/generated/openStageRegistry.ts",
]);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path} (${error instanceof Error ? error.message : error}). ` +
      "If a content build is running, the page reloads when it finishes.");
  }
};

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
  // Every pack input (JSON, sprite strips, stage art, pipeline config) feeds
  // the sync's validation; the sync itself never writes inside these folders.
  const pack = path.match(/^(fighters|stages)\/.+/);
  if (pack && !path.endsWith(".md")) return { kind: "sync", packs: pack[1] };
  if (RELOAD_FILES.has(path) || PORTRAIT.test(path)) return { kind: "reload" };
  return null;
};

const newQueue = () => ({ running: false, pending: false, timer: undefined });

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
 * Dev-server half: saving anything in a fighter or stage pack re-runs the
 * (fast) registry sync; regenerated registries, manifests, and finished atlas
 * builds reload the page once. Invalid packs show the validator's message in
 * Vite's error overlay until they are fixed, across reloads and new tabs.
 */
export const contentWatchPlugin = ({ root, runSync = runNodeScript, debounceMs = 80, reloadQuietMs = 300 }) => {
  const enabled = () => !process.env.VITEST;
  return {
    name: "ultimate-crashout-content-watch",
    apply: "serve",
    // The plugin owns reloads for generated registries, so one save never
    // reloads twice (Vite's own update plus ours).
    hotUpdate({ file }) {
      if (!enabled()) return;
      const path = repositoryPath(root, file);
      if (path && GENERATED_REGISTRIES.has(path)) return [];
    },
    configureServer(server) {
      if (!enabled()) return;
      const logger = server.config.logger;
      const queues = { fighters: newQueue(), stages: newQueue() };
      /** Latest sync error per pack type; null once that type syncs cleanly. */
      const failures = { fighters: null, stages: null };

      const sendFailures = () => {
        const messages = Object.entries(failures)
          .filter(([, message]) => message !== null)
          .map(([packs, message]) => `${packs} pack sync failed:\n${message}`);
        if (messages.length === 0) return false;
        server.ws.send({
          type: "error",
          err: { message: messages.join("\n\n"), stack: "", plugin: "ultimate-crashout-content-watch" },
        });
        return true;
      };

      let reloadTimer;
      const scheduleReload = () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          for (const environment of Object.values(server.environments ?? {})) {
            const module = environment.moduleGraph?.getModuleById(RESOLVED_RUNTIME_MODULE);
            if (module) environment.moduleGraph.invalidateModule(module);
          }
          server.ws.send({ type: "full-reload" });
        }, reloadQuietMs);
      };

      const sync = async (packs) => {
        const queue = queues[packs];
        if (queue.running) {
          queue.pending = true;
          return;
        }
        queue.running = true;
        let result;
        try {
          result = await runSync(root, SYNC_SCRIPTS[packs]);
        } catch (error) {
          result = { ok: false, output: error instanceof Error ? error.message : String(error) };
        } finally {
          queue.running = false;
        }
        const wasFailing = failures[packs] !== null;
        if (result.ok) {
          failures[packs] = null;
          logger.info(`[content] ${result.output || `${packs} synchronized`}`, { timestamp: true });
          // A changed registry reloads the page through the watcher. A fix
          // that restores the previous registry changes no file, so reload
          // here to clear the overlay (debounced into the same reload).
          if (wasFailing && !sendFailures()) scheduleReload();
        } else {
          failures[packs] = result.output;
          logger.error(`[content] ${packs} sync failed:\n${result.output}`, { timestamp: true });
          sendFailures();
        }
        if (queue.pending) {
          queue.pending = false;
          await sync(packs);
        }
      };

      const schedule = (packs) => {
        const queue = queues[packs];
        clearTimeout(queue.timer);
        queue.timer = setTimeout(() => void sync(packs), debounceMs);
      };

      // A reload reconnects every tab: show a still-invalid pack again.
      server.ws.on("connection", () => {
        sendFailures();
      });
      server.watcher.on("all", (event, file) => {
        if (event !== "add" && event !== "change" && event !== "unlink") return;
        const change = classifyContentChange(root, file);
        if (change?.kind === "sync") schedule(change.packs);
        else if (change?.kind === "reload") scheduleReload();
      });
    },
  };
};
