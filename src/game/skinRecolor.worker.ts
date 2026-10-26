/// <reference lib="webworker" />
import { recolorPixels, type SkinSwap } from "./skinPalette.mjs";

/** Recolours one image off the main thread; replies with a PNG blob or an error. */
self.addEventListener("message", async (event: MessageEvent<{ id: number; url: string; swaps: SkinSwap[] }>) => {
  const { id, url, swaps } = event.data;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("OffscreenCanvas 2D is unavailable");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    recolorPixels(pixels.data, swaps);
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
