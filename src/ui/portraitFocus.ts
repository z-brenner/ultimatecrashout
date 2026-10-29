/**
 * Frames a fighter portrait's head and shoulders in a small circle (HUD
 * portraits and stock icons). Portrait art places the fighter anywhere in its
 * square, so the crop comes from the image's own opaque pixels.
 */

/** A square crop, as fractions of the image: top-left corner and side. */
export interface PortraitCrop {
  x: number;
  y: number;
  size: number;
}

const ALPHA_THRESHOLD = 40;
/** The crop's side as a share of the figure's height: head and shoulders. */
const HEAD_SHARE = 0.58;

/** The head-and-shoulders crop of an RGBA image, or null if it is empty. */
export const portraitCrop = (rgba: ArrayLike<number>, width: number, height: number): PortraitCrop | null => {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) <= ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const figureWidth = (right - left + 1) / width;
  const figureHeight = (bottom - top + 1) / height;
  // Wide figures (quadrupeds) need their full width; tall ones their upper part.
  const size = Math.min(1, Math.max(0.3, figureWidth * 1.05, figureHeight * HEAD_SHARE));
  const centerX = (left + right + 1) / 2 / width;
  // A little headroom above the top of the figure.
  const cropTop = top / height - size * 0.06;
  const clamp = (value: number) => Math.min(1 - size, Math.max(0, value));
  return { x: clamp(centerX - size / 2), y: clamp(cropTop), size };
};

/**
 * Crops by art: a skin's recolour keeps the original's alpha, so all skins of
 * one portrait share one measurement (data-portrait-art names the original).
 */
const crops = new Map<string, PortraitCrop | null>();
const SAMPLE = 64;

const measure = (image: HTMLImageElement): PortraitCrop | null => {
  const key = image.dataset.portraitArt || image.currentSrc || image.src;
  const cached = crops.get(key);
  if (cached !== undefined) return cached;
  let crop: PortraitCrop | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
      crop = portraitCrop(context.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, SAMPLE);
    }
  } catch {
    // No canvas (tests) or an unreadable image: show it uncropped.
  }
  crops.set(key, crop);
  return crop;
};

const CROP_STYLES = ["position", "maxWidth", "objectFit", "width", "height", "left", "top"] as const;

const apply = (image: HTMLImageElement): void => {
  const crop = image.naturalWidth ? measure(image) : null;
  if (!crop) {
    // No crop for this image (unreadable or empty): drop any earlier one and show the CSS default.
    for (const property of CROP_STYLES) image.style[property] = "";
    image.dataset.portraitFocus = "none";
    return;
  }
  // Scale the image so the crop fills its frame, and shift the crop into view.
  const scale = 100 / crop.size;
  image.style.position = "absolute";
  image.style.maxWidth = "none";
  image.style.objectFit = "fill";
  image.style.width = `${scale.toFixed(2)}%`;
  image.style.height = `${scale.toFixed(2)}%`;
  image.style.left = `${(-crop.x * scale).toFixed(2)}%`;
  image.style.top = `${(-crop.y * scale).toFixed(2)}%`;
  image.dataset.portraitFocus = "head";
};

/** Crops every portrait image under `root` now, and again whenever one (re)loads, e.g. a recoloured skin. */
export const focusPortraits = (root: ParentNode): void => {
  for (const image of root.querySelectorAll<HTMLImageElement>("img.cc-portrait__sprite")) {
    if (image.dataset.portraitFocusBound !== "1") {
      image.dataset.portraitFocusBound = "1";
      image.addEventListener("load", () => apply(image));
      image.addEventListener("error", () => apply(image));
    }
    if (image.complete) apply(image);
  }
};
