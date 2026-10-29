// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusPortraits } from "./portraitFocus";

/** A 64×64 alpha mask, opaque in the given box. */
const mask = (box: { left: number; top: number; right: number; bottom: number }): ImageData => {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) data[(y * 64 + x) * 4 + 3] = 255;
  }
  return { data, width: 64, height: 64 } as ImageData;
};

const portrait = (art: string): HTMLImageElement => {
  const host = document.createElement("span");
  host.innerHTML = `<img class="cc-portrait__sprite" data-portrait-art="${art}" src="${art}">`;
  document.body.append(host);
  const image = host.querySelector("img")!;
  Object.defineProperty(image, "naturalWidth", { value: 192, configurable: true });
  Object.defineProperty(image, "complete", { value: true, configurable: true });
  return image;
};

const stubCanvas = (frames: Array<ImageData | Error>) => {
  const getImageData = vi.fn(() => {
    const next = frames.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D);
  return getImageData;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("portrait focus", () => {
  it("scales and shifts the image so the head fills the frame, measuring each art once", () => {
    const getImageData = stubCanvas([mask({ left: 24, top: 32, right: 39, bottom: 63 })]);
    const image = portrait("/a.png");
    focusPortraits(document.body);
    expect(image.dataset.portraitFocus).toBe("head");
    expect(Number.parseFloat(image.style.width)).toBeGreaterThan(100);
    expect(Number.parseFloat(image.style.top)).toBeLessThan(0);

    // Another skin of the same art (its recolour shares the alpha) reuses the crop.
    const skin = portrait("/a.png");
    skin.setAttribute("src", "blob:skin");
    focusPortraits(document.body);
    expect(skin.style.width).toBe(image.style.width);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it("drops an earlier crop when a reloaded image cannot be measured", () => {
    stubCanvas([mask({ left: 10, top: 5, right: 50, bottom: 60 }), new Error("tainted")]);
    const image = portrait("/b.png");
    focusPortraits(document.body);
    expect(image.style.position).toBe("absolute");

    image.dataset.portraitArt = "/c.png";
    image.dispatchEvent(new Event("load"));
    expect(image.style.position).toBe("");
    expect(image.style.width).toBe("");
    expect(image.dataset.portraitFocus).toBe("none");
  });
});
