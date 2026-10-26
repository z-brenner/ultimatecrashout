import { recolorPixels, type SkinSwap } from "./skinPalette.mjs";

/**
 * Browser half of palette-swap skins: draws a source image (atlas or
 * portrait), recolours it with recolorPixels, and serves the result as a blob
 * URL. Blob URLs keep every consumer (Image, <img>, decode()) unchanged.
 */

/** Recoloured atlases/portraits kept; an evicted one is regenerated on demand. */
const CACHE_LIMIT = 160;
const cache = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

/** The image a skin URL is derived from: skin URLs carry a #skin-NN fragment. */
export const baseImageUrl = (url: string): string => url.replace(/#.*$/, "");

const cacheKey = (url: string, swaps: readonly SkinSwap[]): string =>
  `${baseImageUrl(url)}|${JSON.stringify(swaps)}`;

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
let worker: Worker | null | undefined;
let nextJob = 0;
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>();

/**
 * One shared worker keeps the per-pixel loop off the main thread, so
 * recolouring a skin never drops game frames. Null where unsupported.
 */
const recolorWorker = (): Worker | null => {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return worker;
  try {
    worker = new Worker(new URL("./skinRecolor.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return worker;
  }
  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.blob) job.resolve(event.data.blob);
    else job.reject(new Error(event.data.error ?? "Recolour failed"));
  });
  worker.addEventListener("error", () => {
    // A worker that cannot start fails every job; recolour on the main thread instead.
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) job.reject(new Error("Recolour worker failed"));
    pending.clear();
  });
  return worker;
};

const recolorInWorker = (url: string, swaps: readonly SkinSwap[]): Promise<Blob> | null => {
  const target = recolorWorker();
  if (!target) return null;
  const id = (nextJob += 1);
  // The worker resolves URLs against its own script, so send an absolute one.
  const absolute = new URL(baseImageUrl(url), document.baseURI).href;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    target.postMessage({ id, url: absolute, swaps });
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

const evict = (): void => {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    const url = ready.get(oldest);
    cache.delete(oldest);
    ready.delete(oldest);
    // Images already decoded from it keep rendering; new requests regenerate.
    if (url) URL.revokeObjectURL(url);
  }
};

/**
 * Blob URL of `url` recoloured by `swaps`. Concurrent requests share one job;
 * a failed job is dropped from the cache so the next request retries.
 */
export const recoloredImageUrl = (url: string, swaps: readonly SkinSwap[]): Promise<string> => {
  const key = cacheKey(url, swaps);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const job = recolor(url, swaps).then(
    (blobUrl) => {
      if (cache.get(key) === job) ready.set(key, blobUrl);
      else URL.revokeObjectURL(blobUrl);
      return blobUrl;
    },
    (error: unknown) => {
      if (cache.get(key) === job) cache.delete(key);
      throw error;
    },
  );
  cache.set(key, job);
  evict();
  return job;
};

/** The finished blob URL, if this recolour already completed. */
export const readyRecoloredImageUrl = (url: string, swaps: readonly SkinSwap[]): string | null =>
  ready.get(cacheKey(url, swaps)) ?? null;

/**
 * The URL to load for an atlas definition: the file itself, or its recoloured
 * blob for a palette skin. A failed recolour falls back to the original
 * colours, which beats an invisible fighter.
 */
export const atlasImageUrl = async (
  definition: { mediaUrl: string; palette?: readonly SkinSwap[] },
): Promise<string> => {
  if (!definition.palette) return definition.mediaUrl;
  try {
    return await recoloredImageUrl(definition.mediaUrl, definition.palette);
  } catch {
    return baseImageUrl(definition.mediaUrl);
  }
};
