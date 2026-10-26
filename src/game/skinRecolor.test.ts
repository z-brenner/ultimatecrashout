// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SWAPS = [{ from: "#f6c41a", to: "#c8323c" }] as const;
const requested: string[] = [];
let failing = new Set<string>();

/** Loads instantly (or fails for URLs in `failing`), like a cached atlas. */
class StubImage {
  decoding = "auto";
  naturalWidth = 2;
  naturalHeight = 1;
  private listeners: Record<string, () => void> = {};
  addEventListener(type: string, listener: () => void): void {
    this.listeners[type] = listener;
  }
  set src(value: string) {
    requested.push(value);
    queueMicrotask(() => this.listeners[failing.has(value) ? "error" : "load"]?.());
  }
}

const loadModule = async () => {
  vi.resetModules();
  return import("./skinRecolor");
};

let created = 0;
let revoked: string[] = [];
let lastPixels: Uint8ClampedArray | null = null;

beforeEach(() => {
  requested.length = 0;
  failing = new Set();
  created = 0;
  revoked = [];
  vi.stubGlobal("Image", StubImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => {
      lastPixels = new Uint8ClampedArray([246, 196, 26, 255, 128, 128, 128, 255]);
      return { data: lastPixels };
    },
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"])));
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:skin-${(created += 1)}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("skin recolouring", () => {
  it("recolours the base image once per atlas and palette", async () => {
    const { recoloredImageUrl, readyRecoloredImageUrl } = await loadModule();
    const url = "/assets/characters/open/buckle/00/idle.webp?v=1#skin-01";
    const [first, second] = await Promise.all([recoloredImageUrl(url, SWAPS), recoloredImageUrl(url, SWAPS)]);
    expect(first).toBe("blob:skin-1");
    expect(second).toBe(first);
    // The fragment never reaches the request: skins share the 00 download.
    expect(requested).toEqual(["/assets/characters/open/buckle/00/idle.webp?v=1"]);
    expect(Array.from(lastPixels!.slice(0, 3))).toEqual([200, 50, 60]);
    expect(Array.from(lastPixels!.slice(4, 7))).toEqual([128, 128, 128]);
    expect(readyRecoloredImageUrl(url, SWAPS)).toBe(first);
    expect(readyRecoloredImageUrl(url, [{ from: "#f6c41a", to: "#2a5cdc" }])).toBeNull();
  });

  it("falls back to the original art on failure, and retries once the failure is stale", async () => {
    const { atlasImageUrl, recoloredImageUrl, recolorFailed } = await loadModule();
    const mediaUrl = "/assets/characters/open/buckle/00/jab.webp?v=1#skin-02";
    failing.add("/assets/characters/open/buckle/00/jab.webp?v=1");
    await expect(atlasImageUrl({ mediaUrl, palette: SWAPS })).resolves.toBe("/assets/characters/open/buckle/00/jab.webp?v=1");
    expect(recolorFailed(mediaUrl, SWAPS)).toBe(true);
    // Not re-requested on every render while the failure is recent...
    failing.clear();
    const before = requested.length;
    await expect(recoloredImageUrl(mediaUrl, SWAPS)).rejects.toThrow();
    expect(requested).toHaveLength(before);
    // ...but a transient error does not disable the skin for the session.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    expect(recolorFailed(mediaUrl, SWAPS)).toBe(false);
    await expect(recoloredImageUrl(mediaUrl, SWAPS)).resolves.toBe("blob:skin-1");
    await expect(atlasImageUrl({ mediaUrl: "/plain.webp" })).resolves.toBe("/plain.webp");
  });

  it("revokes a recolour only when its last owner lets go", async () => {
    const { recoloredImageUrl, readyRecoloredImageUrl, releaseRecoloredImages } = await loadModule();
    const kept = await recoloredImageUrl("/atlas-kept.webp", SWAPS, "match");
    await recoloredImageUrl("/atlas-dropped.webp", SWAPS, "match");
    const shared = await recoloredImageUrl("/atlas-shared.webp", SWAPS, "match");
    await recoloredImageUrl("/atlas-shared.webp", SWAPS, "lab");
    const portrait = await recoloredImageUrl("/portrait.png", SWAPS, "ui");

    // Closing the Lab never frees what the match still holds.
    releaseRecoloredImages("lab");
    expect(revoked).toEqual([]);
    expect(readyRecoloredImageUrl("/atlas-shared.webp", SWAPS)).toBe(shared);

    releaseRecoloredImages("match", [{ url: "/atlas-kept.webp#skin-01", swaps: SWAPS }]);
    expect(revoked.sort()).toEqual(["blob:skin-2", "blob:skin-3"]);
    expect(readyRecoloredImageUrl("/atlas-kept.webp", SWAPS)).toBe(kept);
    expect(readyRecoloredImageUrl("/atlas-dropped.webp", SWAPS)).toBeNull();
    expect(readyRecoloredImageUrl("/portrait.png", SWAPS)).toBe(portrait);
  });

  it("frees a released in-flight recolour when it lands, unless it was adopted again", async () => {
    const { recoloredImageUrl, readyRecoloredImageUrl, releaseRecoloredImages } = await loadModule();
    const orphan = recoloredImageUrl("/atlas-orphan.webp", SWAPS, "match");
    releaseRecoloredImages("match");
    await orphan;
    expect(revoked).toEqual(["blob:skin-1"]);
    expect(readyRecoloredImageUrl("/atlas-orphan.webp", SWAPS)).toBeNull();

    const first = recoloredImageUrl("/atlas-adopted.webp", SWAPS, "lab");
    releaseRecoloredImages("lab");
    const second = recoloredImageUrl("/atlas-adopted.webp", SWAPS, "match");
    // One shared job, not a duplicate recolour.
    expect(second).toBe(first);
    await expect(second).resolves.toBe("blob:skin-2");
    expect(revoked).toEqual(["blob:skin-1"]);
    expect(readyRecoloredImageUrl("/atlas-adopted.webp", SWAPS)).toBe("blob:skin-2");
  });

  it("gives each recolour a stable DOM-safe token", async () => {
    const { recolorToken } = await loadModule();
    const token = recolorToken("/select/00.png", SWAPS);
    expect(token).toMatch(/^skin-[0-9a-z]+$/);
    expect(recolorToken("/select/00.png#skin-01", SWAPS)).toBe(token);
    expect(recolorToken("/select/00.png", [{ from: "#f6c41a", to: "#2a5cdc" }])).not.toBe(token);
  });
});
