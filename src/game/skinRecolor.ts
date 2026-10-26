import { recolorPixels, type SkinSwap } from "./skinPalette.mjs";

/**
 * Browser half of palette-swap skins: draws a source image (atlas or
 * portrait), recolours it with recolorPixels, and serves the result as a blob
 * URL. Blob URLs keep every consumer (Image, <img>, decode()) unchanged.
 */

/**
 * Who holds a recolour. "match" (the sprite library's atlases) and "lab"
 * release theirs explicitly; "ui" (portraits, few) live for the session. A
 * blob URL is revoked only once no owner is left.
 */
export type RecolorScope = "match" | "lab" | "ui";

interface CacheEntry {
  job: Promise<string>;
  owners: Set<RecolorScope>;
  url?: string;
}

const cache = new Map<string, CacheEntry>();
/** Recent failures, so a broken source is not re-requested on every render. */
const failures = new Map<string, number>();
const FAILURE_RETRY_MS = 30_000;

/** The image a skin URL is derived from: skin URLs carry a #skin-NN fragment. */
export const baseImageUrl = (url: string): string => url.replace(/#.*$/, "");

const cacheKey = (url: string, swaps: readonly SkinSwap[]): string =>
  `${baseImageUrl(url)}|${JSON.stringify(swaps)}`;

/** A stable, DOM-attribute-safe token for one recolour (FNV-1a of its key). */
export const recolorToken = (url: string, swaps: readonly SkinSwap[]): string => {
  let hash = 0x811c9dc5;
  for (const character of cacheKey(url, swaps)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `skin-${hash.toString(36)}`;
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Cannot load ${url}`)), { once: true });
    image.src = url;
  });

/** Main-thread recolour: the fallback where workers or OffscreenCanvas are missing. */
const recolorOnMainThread = async (url: string, swaps: readonly SkinSwap[]): Promise<Blob> => {
  const image = await loadImage(baseImageUrl(url));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixels(pixels.data, swaps);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Cannot encode the recoloured image");
  return blob;
};

type WorkerReply = { id: number; blob?: Blob; error?: string };
interface PooledWorker {
  worker: Worker;
  jobs: Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>;
}
/** Up to two workers recolour a skin's atlases in parallel, off the main thread. */
const MAX_WORKERS = 2;
const pool: PooledWorker[] = [];
let workersUnsupported = typeof Worker !== "function" || typeof OffscreenCanvas !== "function";
let nextJob = 0;

const startWorker = (): PooledWorker | null => {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./skinRecolor.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workersUnsupported = true;
    return null;
  }
  const pooled: PooledWorker = { worker, jobs: new Map() };
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const job = pooled.jobs.get(event.data.id);
    if (!job) return;
    pooled.jobs.delete(event.data.id);
    if (event.data.blob) job.resolve(event.data.blob);
    else job.reject(new Error(event.data.error ?? "Recolour failed"));
  });
  // A crashed worker fails only its own jobs (they fall back to the main
  // thread); the next job starts a fresh worker.
  worker.addEventListener("error", () => {
    worker.terminate();
    pool.splice(pool.indexOf(pooled), 1);
    for (const job of pooled.jobs.values()) job.reject(new Error("Recolour worker failed"));
    pooled.jobs.clear();
  });
  pool.push(pooled);
  return pooled;
};

/** The least busy worker; a second starts only once the first has a queue. */
const pickWorker = (): PooledWorker | null => {
  if (workersUnsupported) return null;
  const idle = pool.find(({ jobs }) => jobs.size === 0);
  if (idle) return idle;
  if (pool.length < MAX_WORKERS) return startWorker() ?? pool[0] ?? null;
  return pool.reduce((least, candidate) => candidate.jobs.size < least.jobs.size ? candidate : least);
};

const recolorInWorker = (url: string, swaps: readonly SkinSwap[]): Promise<Blob> | null => {
  const target = pickWorker();
  if (!target) return null;
  const id = (nextJob += 1);
  // The worker resolves URLs against its own script, so send an absolute one.
  const absolute = new URL(baseImageUrl(url), document.baseURI).href;
  return new Promise((resolve, reject) => {
    target.jobs.set(id, { resolve, reject });
    target.worker.postMessage({ id, url: absolute, swaps });
  });
};

const recolor = async (url: string, swaps: readonly SkinSwap[]): Promise<string> => {
  let blob: Blob;
  try {
    blob = await (recolorInWorker(url, swaps) ?? recolorOnMainThread(url, swaps));
  } catch {
    blob = await recolorOnMainThread(url, swaps);
  }
  return URL.createObjectURL(blob);
};

/** Whether this recolour failed recently (callers show the original art meanwhile). */
export const recolorFailed = (url: string, swaps: readonly SkinSwap[]): boolean => {
  const key = cacheKey(url, swaps);
  const failedAt = failures.get(key);
  if (failedAt === undefined) return false;
  if (Date.now() - failedAt < FAILURE_RETRY_MS) return true;
  failures.delete(key);
  return false;
};

/**
 * Blob URL of `url` recoloured by `swaps`, held for `scope`. Concurrent
 * requests share one job. A recent failure rejects at once; after
 * FAILURE_RETRY_MS the next request tries again.
 */
export const recoloredImageUrl = (
  url: string,
  swaps: readonly SkinSwap[],
  scope: RecolorScope = "ui",
): Promise<string> => {
  const key = cacheKey(url, swaps);
  const cached = cache.get(key);
  if (cached) {
    cached.owners.add(scope);
    return cached.job;
  }
  if (recolorFailed(url, swaps)) return Promise.reject(new Error(`Recolouring ${url} failed recently`));
  const entry: CacheEntry = { owners: new Set([scope]), job: Promise.resolve("") };
  entry.job = recolor(url, swaps).then(
    (blobUrl) => {
      entry.url = blobUrl;
      // Every owner let go while it was in flight: nothing will use it.
      if (entry.owners.size === 0) {
        cache.delete(key);
        URL.revokeObjectURL(blobUrl);
      }
      return blobUrl;
    },
    (error: unknown) => {
      cache.delete(key);
      failures.set(key, Date.now());
      throw error;
    },
  );
  cache.set(key, entry);
  return entry.job;
};

/** The finished blob URL, if this recolour already completed. */
export const readyRecoloredImageUrl = (url: string, swaps: readonly SkinSwap[]): string | null =>
  cache.get(cacheKey(url, swaps))?.url ?? null;

/**
 * `scope` lets go of every recolour except those in `keep`. A recolour with no
 * owner left is revoked now, or as soon as it finishes if still in flight;
 * a new request before then adopts it instead. Images already decoded from a
 * revoked URL keep rendering.
 */
export const releaseRecoloredImages = (
  scope: Exclude<RecolorScope, "ui">,
  keep: Iterable<{ url: string; swaps: readonly SkinSwap[] }> = [],
): void => {
  const kept = new Set([...keep].map(({ url, swaps }) => cacheKey(url, swaps)));
  for (const [key, entry] of cache) {
    if (kept.has(key) || !entry.owners.delete(scope) || entry.owners.size > 0) continue;
    if (entry.url) {
      cache.delete(key);
      URL.revokeObjectURL(entry.url);
    }
  }
};

/**
 * The URL to load for an atlas definition: the file itself, or its recoloured
 * blob for a palette skin. A failed recolour falls back to the original
 * colours, which beats an invisible fighter.
 */
export const atlasImageUrl = async (
  definition: { mediaUrl: string; palette?: readonly SkinSwap[] },
  scope: RecolorScope = "match",
): Promise<string> => {
  if (!definition.palette) return definition.mediaUrl;
  try {
    return await recoloredImageUrl(definition.mediaUrl, definition.palette, scope);
  } catch {
    return baseImageUrl(definition.mediaUrl);
  }
};
