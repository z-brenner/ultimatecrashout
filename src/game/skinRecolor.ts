import { recolorPixels, type SkinSwap } from "./skinPalette.mjs";

/**
 * Browser half of palette-swap skins: draws a source image (atlas or
 * portrait), recolours it with recolorPixels, and serves the result as a blob
 * URL. Blob URLs keep every consumer (Image, <img>, decode()) unchanged.
 */

/**
 * "match" recolours (atlases) are released when the next match is prepared;
 * "ui" recolours (portraits) are few and live for the session.
 */
export type RecolorScope = "match" | "ui";

interface CacheEntry {
  job: Promise<string>;
  scope: RecolorScope;
  url?: string;
}

const cache = new Map<string, CacheEntry>();
/** Keys whose recolour failed: not retried, so callers settle on the original art. */
const failed = new Set<string>();

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
/** Two workers recolour a skin's atlases in parallel without touching the main thread. */
const WORKER_COUNT = 2;
let workers: Worker[] | null | undefined;
let nextJob = 0;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

const failAllWorkers = (): void => {
  for (const worker of workers ?? []) worker.terminate();
  workers = null;
  for (const job of pending.values()) job.reject(new Error("Recolour worker failed"));
  pending.clear();
};

/** The worker pool, or null where unsupported (callers recolour on the main thread). */
const recolorWorkers = (): Worker[] | null => {
  if (workers !== undefined) return workers;
  workers = null;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return workers;
  try {
    workers = Array.from({ length: WORKER_COUNT }, () =>
      new Worker(new URL("./skinRecolor.worker.ts", import.meta.url), { type: "module" }));
  } catch {
    return workers;
  }
  for (const worker of workers) {
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.blob) job.resolve(event.data.blob);
      else job.reject(new Error(event.data.error ?? "Recolour failed"));
    });
    // A worker that cannot start fails every job; recolour on the main thread instead.
    worker.addEventListener("error", failAllWorkers);
  }
  return workers;
};

const recolorInWorker = (url: string, swaps: readonly SkinSwap[]): Promise<Blob> | null => {
  const pool = recolorWorkers();
  if (!pool) return null;
  const id = (nextJob += 1);
  // The worker resolves URLs against its own script, so send an absolute one.
  const absolute = new URL(baseImageUrl(url), document.baseURI).href;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    pool[id % pool.length]!.postMessage({ id, url: absolute, swaps });
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

/**
 * Blob URL of `url` recoloured by `swaps`. Concurrent requests share one job.
 * A failed recolour is remembered and rejects at once from then on.
 */
export const recoloredImageUrl = (
  url: string,
  swaps: readonly SkinSwap[],
  scope: RecolorScope = "ui",
): Promise<string> => {
  const key = cacheKey(url, swaps);
  const cached = cache.get(key);
  if (cached) {
    // A UI request keeps an atlas recolour alive past the next release.
    if (scope === "ui") cached.scope = "ui";
    return cached.job;
  }
  if (failed.has(key)) return Promise.reject(new Error(`Recolouring ${url} failed`));
  const entry: CacheEntry = { scope, job: Promise.resolve("") };
  entry.job = recolor(url, swaps).then(
    (blobUrl) => {
      // Released while in flight: the caller still gets a working URL. It is
      // simply no longer cached (and is not revoked under its consumer).
      if (cache.get(key) === entry) entry.url = blobUrl;
      return blobUrl;
    },
    (error: unknown) => {
      if (cache.get(key) === entry) cache.delete(key);
      failed.add(key);
      throw error;
    },
  );
  cache.set(key, entry);
  return entry.job;
};

/** The finished blob URL, if this recolour already completed. */
export const readyRecoloredImageUrl = (url: string, swaps: readonly SkinSwap[]): string | null =>
  cache.get(cacheKey(url, swaps))?.url ?? null;

/** Whether this recolour failed (callers show the original art). */
export const recolorFailed = (url: string, swaps: readonly SkinSwap[]): boolean =>
  failed.has(cacheKey(url, swaps));

/**
 * Revokes finished match-scoped recolours not in `keep` (the atlases the next
 * match uses). Images already decoded from a revoked URL keep rendering.
 */
export const releaseRecoloredImages = (
  keep: Iterable<{ url: string; swaps: readonly SkinSwap[] }>,
): void => {
  const kept = new Set([...keep].map(({ url, swaps }) => cacheKey(url, swaps)));
  for (const [key, entry] of cache) {
    if (entry.scope !== "match" || kept.has(key)) continue;
    cache.delete(key);
    if (entry.url) URL.revokeObjectURL(entry.url);
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
