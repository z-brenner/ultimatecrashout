import { describe, expect, it, vi } from "vitest";
import {
  CAMERA_FALL_FOLLOW_RATE,
  CAMERA_HORIZONTAL_FOLLOW_RATE,
  CAMERA_MAX_HORIZONTAL_SPEED,
  CAMERA_MAX_VERTICAL_SPEED,
  CAMERA_MAX_ZOOM_IN_SPEED,
  CAMERA_MAX_ZOOM_OUT_SPEED,
  CAMERA_RISE_FOLLOW_RATE,
  CAMERA_SAFE_BOTTOM_RATIO,
  CAMERA_SAFE_TOP_RATIO,
  CAMERA_SCREEN_ANCHOR_RATIO,
  CAMERA_ZOOM_IN_RATE,
  CAMERA_ZOOM_OUT_RATE,
  GameRenderer,
  SPRITE_REFERENCE_HEIGHT_PX,
  SPRITE_VISUAL_TO_BODY_RATIO,
  cameraShakeOffset,
  cameraSmoothingAmount,
  clampStageCameraX,
  clampStageCameraY,
  computeGameplayCameraTarget,
  spritePixelScale,
  fighterArtFootOffset,
  fighterShadowOffset,
  findOpaquePixelBounds,
  minimumStageArtZoom,
  smoothCameraValue,
  updateGameplayCameraGoal,
  clampCameraToBounds,
  stageCameraBounds,
} from "./render";
import type { GameSnapshot } from "./engine";
import { OPEN_STAGE_IDS, type StageId } from "./contracts";
import { FIGHTER_IDS, getFighterDefinition } from "./roster";
import { DEFAULT_STAGE_ID, STAGE_IDS, getStageDefinition } from "./stages";

const cameraFighter = (
  x: number,
  y: number,
  velocity = { x: 0, y: 0 },
  size = { width: 62, height: 82 },
  respawnFrames = 0,
) => ({ position: { x, y }, velocity, size, respawnFrames });

describe("findOpaquePixelBounds", () => {
  it("returns the tight bounds of visible pixels", () => {
    const pixels = new Uint8ClampedArray(5 * 4 * 4);
    const setAlpha = (x: number, y: number, alpha: number): void => {
      pixels[(y * 5 + x) * 4 + 3] = alpha;
    };

    setAlpha(1, 1, 255);
    setAlpha(3, 2, 120);
    setAlpha(4, 3, 12);

    expect(findOpaquePixelBounds(pixels, 5, 4)).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 2,
    });
  });

  it("returns null for a fully transparent frame", () => {
    expect(findOpaquePixelBounds(new Uint8ClampedArray(3 * 2 * 4), 3, 2)).toBeNull();
  });

  it("normalises atlas silhouettes to gameplay body proportions", () => {
    for (const fighter of FIGHTER_IDS) {
      const visibleWorldHeight =
        SPRITE_REFERENCE_HEIGHT_PX[fighter] * spritePixelScale(fighter);
      expect(visibleWorldHeight).toBeCloseTo(
        getFighterDefinition(fighter).size.height * SPRITE_VISUAL_TO_BODY_RATIO,
        5,
      );
    }

    expect(SPRITE_VISUAL_TO_BODY_RATIO).toBe(1.17);
  });

  it("anchors atlas feet and shadows to each fighter's physical ground contact", () => {
    for (const fighter of FIGHTER_IDS) {
      const halfHeight = getFighterDefinition(fighter).size.height / 2;
      expect(fighterArtFootOffset(getFighterDefinition(fighter).size.height, true)).toBe(halfHeight);
      expect(fighterShadowOffset(getFighterDefinition(fighter).size.height, true)).toBe(halfHeight);
    }
  });

  it("preserves local-sprite anchors when atlas sheets are disabled", () => {
    expect(fighterArtFootOffset(82, false)).toBe(54);
    expect(fighterShadowOffset(82, false)).toBe(53);
  });
});

describe("atlas sprite frame bounds cache", () => {
  it("caches bounds per atlas crop instead of reusing the first frame", () => {
    const firstPixels = new Uint8ClampedArray(4 * 3 * 4);
    const secondPixels = new Uint8ClampedArray(4 * 3 * 4);
    firstPixels[3] = 255;
    secondPixels[(2 * 4 + 3) * 4 + 3] = 255;
    const getImageData = vi.fn()
      .mockReturnValueOnce({ data: firstPixels })
      .mockReturnValueOnce({ data: secondPixels });
    const drawImage = vi.fn();
    const harness = {
      spriteBounds: new WeakMap(),
      spriteSampleCanvas: { width: 0, height: 0 },
      spriteSampleContext: {
        clearRect: vi.fn(),
        drawImage,
        getImageData,
      },
    };
    const referenceBounds = (
      GameRenderer.prototype as unknown as {
        referenceBoundsForSprite(
          sprite: HTMLImageElement,
          source: { x: number; y: number; width: number; height: number },
        ): { x: number; y: number; width: number; height: number } | null;
      }
    ).referenceBoundsForSprite;
    const atlas = {} as HTMLImageElement;
    const firstCrop = { x: 0, y: 0, width: 4, height: 3 };
    const secondCrop = { x: 4, y: 0, width: 4, height: 3 };

    expect(referenceBounds.call(harness, atlas, firstCrop)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(referenceBounds.call(harness, atlas, secondCrop)).toEqual({
      x: 3,
      y: 2,
      width: 1,
      height: 1,
    });
    expect(referenceBounds.call(harness, atlas, firstCrop)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(getImageData).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenNthCalledWith(
      2,
      atlas,
      secondCrop.x,
      secondCrop.y,
      secondCrop.width,
      secondCrop.height,
      0,
      0,
      secondCrop.width,
      secondCrop.height,
    );
  });
});

describe("atlas sprite material compositing", () => {
  it("copies native pixels without tint or residue from the previous cell", () => {
    const atlasContext = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
      resetTransform: vi.fn(),
      fillStyle: "",
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    };
    const drawCompositeModes: string[] = [];
    atlasContext.drawImage.mockImplementation(() => {
      drawCompositeModes.push(atlasContext.globalCompositeOperation);
    });
    const mainContext = { drawImage: vi.fn() };
    const harness = {
      atlasFrameContext: atlasContext,
      atlasFrameCanvas: { width: 0, height: 0 },
      context: mainContext,
    };
    const drawAtlas = (
      GameRenderer.prototype as unknown as {
        drawAtlasSpriteFrame(
          sprite: HTMLImageElement,
          crop: { x: number; y: number; width: number; height: number },
          profile: { x: number; y: number; width: number; height: number },
        ): boolean;
      }
    ).drawAtlasSpriteFrame;

    expect(drawAtlas.call(
      harness,
      {} as HTMLImageElement,
      { x: 192, y: 0, width: 192, height: 192 },
      { x: -80, y: -90, width: 160, height: 160 },
    )).toBe(true);
    expect(drawAtlas.call(
      harness,
      {} as HTMLImageElement,
      { x: 384, y: 0, width: 192, height: 192 },
      { x: -80, y: -90, width: 160, height: 160 },
    )).toBe(true);
    expect(atlasContext.resetTransform).toHaveBeenCalledTimes(2);
    expect(atlasContext.clearRect).toHaveBeenNthCalledWith(1, 0, 0, 192, 192);
    expect(atlasContext.clearRect).toHaveBeenNthCalledWith(2, 0, 0, 192, 192);
    expect(atlasContext.drawImage).toHaveBeenCalledTimes(2);
    expect(drawCompositeModes).toEqual(["copy", "copy"]);
    expect(atlasContext.fillRect).not.toHaveBeenCalled();
    expect(atlasContext.globalCompositeOperation).toBe("source-over");
    expect(mainContext.drawImage).toHaveBeenCalledTimes(2);
  });
});

describe("stage art compositing", () => {
  it("does not initialize the WebGL loader for a 2D-only stage pack", () => {
    const openStage = OPEN_STAGE_IDS[0];
    const harness: {
      pendingNativeStage?: StageId;
      nativeStageCanvas: HTMLCanvasElement;
      nativeStageLoad?: Promise<void>;
      nativeStageRenderer?: { prepare(stage: StageId): void };
    } = {
      pendingNativeStage: openStage,
      nativeStageCanvas: {} as HTMLCanvasElement,
    };
    const prepareNativeStage = (
      GameRenderer.prototype as unknown as {
        prepareNativeStage(stage: StageId): void;
      }
    ).prepareNativeStage;

    prepareNativeStage.call(harness, openStage);

    expect(harness.pendingNativeStage).toBeUndefined();
    expect(harness.nativeStageLoad).toBeUndefined();
  });

  it("draws the arena once without stretching its edges", () => {
    const drawImage = vi.fn();
    const translate = vi.fn();
    const scale = vi.fn();
    const art = {
      complete: true,
      naturalWidth: 1920,
      naturalHeight: 1080,
    } as HTMLImageElement;
    const harness = {
      context: {
        save: vi.fn(),
        restore: vi.fn(),
        drawImage,
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      },
      stageArt: new Map([[DEFAULT_STAGE_ID, art]]),
      stageBackdrops: new Map(),
      camera: { x: 0, y: 110, zoom: 0.5 },
      width: 1600,
      height: 900,
      worldToScreen: () => ({ x: 300, y: 180 }),
      drawWorldTile: (GameRenderer.prototype as unknown as { drawWorldTile: unknown }).drawWorldTile,
    };
    harness.context = { ...harness.context, translate, scale } as typeof harness.context;
    const drawStage = (
      GameRenderer.prototype as unknown as {
        drawStage(snapshot: { stage: { id: typeof DEFAULT_STAGE_ID } }): void;
      }
    ).drawStage;

    drawStage.call(harness, { stage: { id: DEFAULT_STAGE_ID } });

    // The whole image exactly once, at its calibrated place and size...
    const fullDraws = drawImage.mock.calls.filter((call) => call.length === 5);
    expect(fullDraws).toHaveLength(1);
    const arenaCall = fullDraws[0]!;
    expect(arenaCall[0]).toBe(art);
    expect(translate).toHaveBeenCalledWith(300, 0);
    expect(arenaCall[2]).toBe(180);
    const artCalibration = getStageDefinition(DEFAULT_STAGE_ID).art;
    expect(arenaCall[3]).toBeCloseTo(artCalibration.width * artCalibration.worldUnitsPerPixel * 0.5 + 1);
    expect(arenaCall[4]).toBeCloseTo(artCalibration.height * artCalibration.worldUnitsPerPixel * 0.5);
    // ...and below it only its bottom row, carried down to the screen edge.
    const extensions = drawImage.mock.calls.filter((call) => call.length === 9);
    expect(extensions.every((call) => call[4] === 1 && call[2] === art.naturalHeight - 1)).toBe(true);
    expect(scale).not.toHaveBeenCalled();
  });

  it("continues the scene past the arena with mirrored backdrop tiles, never a second arena", () => {
    const drawImage = vi.fn();
    const translate = vi.fn();
    const scale = vi.fn();
    const image = (naturalWidth: number) => ({ complete: true, naturalWidth, naturalHeight: 1080 }) as HTMLImageElement;
    const art = image(1920);
    const backdrop = image(1920);
    const calibration = getStageDefinition(DEFAULT_STAGE_ID).art;
    const tileWidth = calibration.width * calibration.worldUnitsPerPixel;
    // The camera far to the right: the view spans the arena's edge.
    const harness = {
      context: { save: vi.fn(), restore: vi.fn(), drawImage, translate, scale, imageSmoothingEnabled: false, imageSmoothingQuality: "low" },
      stageArt: new Map([[DEFAULT_STAGE_ID, art]]),
      stageBackdrops: new Map([[DEFAULT_STAGE_ID, backdrop]]),
      camera: { x: tileWidth / 2, y: 110, zoom: 1 },
      width: 1280,
      height: 720,
      worldToScreen: (position: { x: number; y: number }) => ({ x: 640 + (position.x - tileWidth / 2), y: 100 }),
      drawWorldTile: (GameRenderer.prototype as unknown as { drawWorldTile: unknown }).drawWorldTile,
    };
    (GameRenderer.prototype as unknown as { drawStage(snapshot: unknown): void })
      .drawStage.call(harness, { stage: { id: DEFAULT_STAGE_ID } });

    const fullDraws = drawImage.mock.calls.filter((call) => call.length === 5);
    expect(fullDraws.filter(([drawn]) => drawn === art)).toHaveLength(1);
    expect(fullDraws.filter(([drawn]) => drawn === backdrop)).toHaveLength(2);
    // The tile right of the arena is mirrored, so its edge meets the arena's.
    expect(scale).toHaveBeenCalledWith(-1, 1);
  });

  it("fills the space outside the arena with the stage's dedicated backdrop", () => {
    const drawImage = vi.fn();
    const backdrop = {
      complete: true,
      naturalWidth: 2048,
      naturalHeight: 512,
    } as HTMLImageElement;
    const harness = {
      context: { drawImage },
      // Before the arena loads; afterwards the backdrop is drawn with it, in world space.
      stageArt: new Map(),
      stageBackdrops: new Map([[DEFAULT_STAGE_ID, backdrop]]),
      width: 1600,
      height: 900,
    };
    const drawStageFallback = (
      GameRenderer.prototype as unknown as {
        drawStageFallback(snapshot: { stage: { id: typeof DEFAULT_STAGE_ID } }): void;
      }
    ).drawStageFallback;

    drawStageFallback.call(harness, { stage: { id: DEFAULT_STAGE_ID } });

    expect(drawImage).toHaveBeenCalledTimes(1);
    const backdropCall = drawImage.mock.calls[0];
    expect(backdropCall).toBeDefined();
    if (!backdropCall) throw new Error("The backdrop was not drawn.");
    expect(backdropCall[0]).toBe(backdrop);
    expect(backdropCall.slice(-4)).toEqual([0, 0, 1600, 900]);
  });
});

describe("stage camera bounds", () => {
  const blastZone = { left: -1250, right: 1250, top: 1080, bottom: -760 };
  const bounds = stageCameraBounds(blastZone);

  it("sit inside the blast zone, as in Smash", () => {
    expect(bounds.left).toBeGreaterThan(blastZone.left);
    expect(bounds.right).toBeLessThan(blastZone.right);
    expect(bounds.top).toBeLessThan(blastZone.top);
    expect(bounds.bottom).toBeGreaterThan(blastZone.bottom);
  });

  it("stop the view at their edge when a fighter flies past it", () => {
    const camera = clampCameraToBounds({ x: 1200, y: 900, zoom: 1 }, bounds, 1280, 720);
    // Right and top edges of the view, in world units.
    expect(camera.x + 640 / camera.zoom).toBeCloseTo(bounds.right, 6);
    expect(camera.y + (720 * CAMERA_SCREEN_ANCHOR_RATIO) / camera.zoom).toBeCloseTo(bounds.top, 6);
  });

  it("zoom in rather than show past their edges", () => {
    const camera = clampCameraToBounds({ x: 0, y: 100, zoom: 0.2 }, bounds, 1280, 720);
    expect(1280 / camera.zoom).toBeLessThanOrEqual(bounds.right - bounds.left + 1e-6);
    expect(720 / camera.zoom).toBeLessThanOrEqual(bounds.top - bounds.bottom + 1e-6);
  });

  it("hold the live camera at the edge while a fighter is far off-stage", () => {
    const stage = { blastZone: getStageDefinition(DEFAULT_STAGE_ID).blastZone };
    const range = stageCameraBounds(stage.blastZone);
    const harness = {
      width: 1280,
      height: 720,
      camera: { x: 0, y: 200, zoom: 1 },
      cameraGoal: { x: 0, y: 200, zoom: 1 },
      cameraPrimed: true,
      cameraStableSeconds: 0,
    };
    const updateCamera = (GameRenderer.prototype as unknown as {
      updateCamera(snapshot: GameSnapshot, dt: number): void;
    }).updateCamera;
    const fighters = [cameraFighter(0, 41), cameraFighter(range.right + 300, 600)];
    for (let frame = 0; frame < 240; frame += 1) {
      updateCamera.call(harness, { fighters, events: [], stage } as unknown as GameSnapshot, 1 / 60);
      expect(harness.camera.x + 640 / harness.camera.zoom).toBeLessThanOrEqual(range.right + 1e-6);
    }
  });

  it("leave a camera already inside alone", () => {
    expect(clampCameraToBounds({ x: 20, y: 150, zoom: 1.2 }, bounds, 1280, 720)).toEqual({ x: 20, y: 150, zoom: 1.2 });
  });
});

describe("resolution-independent framing", () => {
  it.each([[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]])("shows the same view at %i×%i", (width, height) => {
    const fighters = [cameraFighter(-260, 41), cameraFighter(260, 41)];
    const target = computeGameplayCameraTarget(fighters, width, height);
    const reference = computeGameplayCameraTarget(fighters, 1280, 720);
    // Same world-to-screen proportions: zoom scales with the window height.
    expect(target.zoom / height).toBeCloseTo(reference.zoom / 720, 6);
    expect(target.y).toBeCloseTo(reference.y, 6);
    // ...through the goal update too, which applies its own zoom limits.
    const goal = updateGameplayCameraGoal(target, target, target, fighters, width, height, true);
    const referenceGoal = updateGameplayCameraGoal(reference, reference, reference, fighters, 1280, 720, true);
    expect(goal.zoom / height).toBeCloseTo(referenceGoal.zoom / 720, 6);
    const held = updateGameplayCameraGoal(target, target, target, fighters, width, height, false);
    expect(held.zoom / height).toBeCloseTo(reference.zoom / 720, 6);
  });

  it("zooms in on close fighting and out as fighters separate", () => {
    const close = computeGameplayCameraTarget([cameraFighter(-40, 41), cameraFighter(40, 41)], 1280, 720);
    const apart = computeGameplayCameraTarget([cameraFighter(-650, 41), cameraFighter(650, 41)], 1280, 720);
    expect(close.zoom).toBeGreaterThan(apart.zoom * 1.4);
  });
});

describe("clampStageCameraX", () => {
  it("keeps both horizontal arena edges outside a Mac-sized viewport", () => {
    expect(clampStageCameraX(250, 1600, 1, 1700)).toBe(50);
    expect(clampStageCameraX(-250, 1600, 1, 1700)).toBe(-50);
    expect(clampStageCameraX(250, 1600, 1600 / 1700, 1700)).toBe(0);
  });

  it("reserves overscan for camera shake", () => {
    expect(clampStageCameraX(250, 1600, 1, 1800, 48)).toBe(52);
  });
});

describe("clampStageCameraY", () => {
  it("keeps the top and bottom of the arena outside a Mac viewport", () => {
    const zoom = (900 + 96) / 1080;
    const y = clampStageCameraY(230, 900, zoom, 540, -540, 48);
    const topScreen = 900 * 0.42 - (540 - y) * zoom;
    const bottomScreen = 900 * 0.42 - (-540 - y) * zoom;
    expect(topScreen).toBeLessThanOrEqual(-48);
    expect(bottomScreen).toBeGreaterThanOrEqual(948);
  });
});

describe("minimumStageArtZoom", () => {
  it("keeps every calibrated HD arena beyond a Mac viewport including shake overscan", () => {
    const viewport = { width: 1600, height: 900 };
    const overscan = 48;

    for (const stageId of STAGE_IDS) {
      const { art } = getStageDefinition(stageId);
      const worldWidth = art.width * art.worldUnitsPerPixel;
      const worldHeight = art.height * art.worldUnitsPerPixel;
      const zoom = minimumStageArtZoom(
        viewport.width,
        viewport.height,
        worldWidth,
        worldHeight,
        overscan,
      );

      expect(worldWidth * zoom).toBeGreaterThanOrEqual(viewport.width + overscan * 2);
      expect(worldHeight * zoom).toBeGreaterThanOrEqual(viewport.height + overscan * 2);
    }
  });
});

describe("gameplay-first camera", () => {
  it.each([
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 },
  ])("places the resting ground at 68% in $width×$height", ({ width, height }) => {
    const target = computeGameplayCameraTarget(
      [cameraFighter(-186, 41), cameraFighter(186, 41)],
      width,
      height,
    );
    const groundScreenY =
      height * CAMERA_SCREEN_ANCHOR_RATIO + target.y * target.zoom;
    expect(groundScreenY / height).toBeCloseTo(0.68, 2);
    // Smash-like framing at every window size: two fighters near each other
    // fill about a sixth of the screen height each, not a fixed pixel size.
    expect((82 * target.zoom) / height).toBeGreaterThan(0.14);
    expect((82 * target.zoom) / height).toBeLessThan(0.2);
  });

  it("keeps a grounded fighter and a large high fighter in the safe area at the same time", () => {
    const width = 1280;
    const height = 720;
    const target = computeGameplayCameraTarget(
      [
        cameraFighter(-120, 41),
        cameraFighter(120, 700, { x: 0, y: 0 }, { width: 94, height: 112 }),
      ],
      width,
      height,
    );
    const anchor = height * CAMERA_SCREEN_ANCHOR_RATIO;
    const highFighterVisualTop =
      anchor - (700 + 112 * 0.67 - target.y) * target.zoom;
    const groundedVisualBottom = anchor - (0 - target.y) * target.zoom;

    expect(highFighterVisualTop).toBeGreaterThanOrEqual(height * CAMERA_SAFE_TOP_RATIO);
    expect(groundedVisualBottom).toBeLessThanOrEqual(
      height * CAMERA_SAFE_BOTTOM_RATIO,
    );
    expect(target.zoom).toBeLessThan(0.7);
  });

  it("anticipates a rapid ascent without making the zoom pump", () => {
    const still = computeGameplayCameraTarget(
      [cameraFighter(-100, 41), cameraFighter(100, 360)],
      1280,
      720,
    );
    const rising = computeGameplayCameraTarget(
      [cameraFighter(-100, 41), cameraFighter(100, 360, { x: 0, y: 1_000 })],
      1280,
      720,
    );

    expect(rising.y).toBeGreaterThan(still.y + 80);
    expect(rising.zoom).toBe(still.zoom);
  });

  it("follows ascent and zoom-out faster than the return", () => {
    const frame = 1 / 60;
    expect(cameraSmoothingAmount(frame, CAMERA_RISE_FOLLOW_RATE)).toBeGreaterThan(
      cameraSmoothingAmount(frame, CAMERA_FALL_FOLLOW_RATE),
    );
    expect(cameraSmoothingAmount(frame, CAMERA_ZOOM_OUT_RATE)).toBeGreaterThan(
      cameraSmoothingAmount(frame, CAMERA_ZOOM_IN_RATE),
    );
  });

  it("bounds every transition even after a slow frame", () => {
    const dt = 1 / 15;
    const horizontal = smoothCameraValue(
      0,
      900,
      dt,
      CAMERA_HORIZONTAL_FOLLOW_RATE,
      CAMERA_MAX_HORIZONTAL_SPEED,
    );
    const vertical = smoothCameraValue(
      100,
      900,
      dt,
      CAMERA_RISE_FOLLOW_RATE,
      CAMERA_MAX_VERTICAL_SPEED,
    );
    const zoomOut = smoothCameraValue(
      1.08,
      0.54,
      dt,
      CAMERA_ZOOM_OUT_RATE,
      CAMERA_MAX_ZOOM_OUT_SPEED,
    );
    const zoomIn = smoothCameraValue(
      0.54,
      1.08,
      dt,
      CAMERA_ZOOM_IN_RATE,
      CAMERA_MAX_ZOOM_IN_SPEED,
    );

    expect(horizontal).toBeLessThanOrEqual(CAMERA_MAX_HORIZONTAL_SPEED * dt + 1e-8);
    expect(vertical - 100).toBeLessThanOrEqual(CAMERA_MAX_VERTICAL_SPEED * dt + 1e-8);
    expect(1.08 - zoomOut).toBeLessThanOrEqual(CAMERA_MAX_ZOOM_OUT_SPEED * dt + 1e-8);
    expect(zoomIn - 0.54).toBeLessThanOrEqual(CAMERA_MAX_ZOOM_IN_SPEED * dt + 1e-8);
  });

  it("produces a continuous deterministic shake", () => {
    const first = cameraShakeOffset(1, 20);
    const repeated = cameraShakeOffset(1, 20);
    const nextFrame = cameraShakeOffset(1 + 1 / 60, 20);

    expect(repeated).toEqual(first);
    expect(Math.hypot(nextFrame.x - first.x, nextFrame.y - first.y)).toBeLessThan(8);
  });

  it("keeps its target while fighters remain inside the dead zone", () => {
    const camera = { x: 0, y: 220, zoom: 0.8 };
    const previousGoal = { ...camera };
    const fittedTarget = { x: 120, y: 360, zoom: 0.62 };

    const nextGoal = updateGameplayCameraGoal(
      camera,
      previousGoal,
      fittedTarget,
      [cameraFighter(-150, 100), cameraFighter(150, 100)],
      1280,
      720,
      false,
    );

    expect(nextGoal).toEqual(previousGoal);
  });

  it("always allows zooming back in after KO framing", () => {
    const camera = { x: 0, y: 220, zoom: 0.54 };
    const previousGoal = { ...camera };
    const fittedTarget = { x: 0, y: 220, zoom: 0.9 };
    const nextGoal = updateGameplayCameraGoal(
      camera,
      previousGoal,
      fittedTarget,
      [cameraFighter(-150, 100), cameraFighter(150, 100)],
      1280,
      720,
      false,
    );

    expect(nextGoal.zoom).toBe(0.9);
  });

  it("does not zoom back in while a silhouette still crosses the upper boundary", () => {
    const camera = { x: 0, y: 220, zoom: 0.6 };
    const previousGoal = { ...camera };
    const fittedTarget = { x: 0, y: 360, zoom: 0.9 };
    const nextGoal = updateGameplayCameraGoal(
      camera,
      previousGoal,
      fittedTarget,
      [
        cameraFighter(-120, 41),
        cameraFighter(120, 700, { x: 0, y: 0 }, { width: 94, height: 112 }),
      ],
      1280,
      720,
      false,
    );

    expect(nextGoal.zoom).toBe(previousGoal.zoom);
  });

  it("immediately recenters the camera on the respawn event", () => {
    const fighters = [cameraFighter(-150, 41), cameraFighter(150, 41)];
    const expected = computeGameplayCameraTarget(fighters, 1280, 720);
    const harness = {
      width: 1280,
      height: 720,
      camera: { x: 320, y: 620, zoom: 0.54 },
      cameraGoal: { x: 320, y: 620, zoom: 0.54 },
      cameraPrimed: true,
      cameraStableSeconds: 0,
    };
    const updateCamera = (
      GameRenderer.prototype as unknown as {
        updateCamera(snapshot: GameSnapshot, dt: number): void;
      }
    ).updateCamera;

    updateCamera.call(harness, {
      fighters,
      events: [{ type: "respawn" }],
      stage: { blastZone: getStageDefinition(DEFAULT_STAGE_ID).blastZone },
    } as unknown as GameSnapshot, 1 / 60);

    // Two fighters near the centre are well inside the stage's camera range.
    expect(harness.camera).toEqual(expected);
    expect(harness.cameraGoal).toEqual(expected);
  });

  it("moves the target only when a silhouette crosses a safe edge", () => {
    const camera = { x: 0, y: 220, zoom: 0.8 };
    const previousGoal = { ...camera };
    const fighters = [
      cameraFighter(-150, 41),
      cameraFighter(150, 570, { x: 0, y: 720 }),
    ];
    const fittedTarget = computeGameplayCameraTarget(fighters, 1280, 720);

    const nextGoal = updateGameplayCameraGoal(
      camera,
      previousGoal,
      fittedTarget,
      fighters,
      1280,
      720,
      false,
    );

    expect(nextGoal.y).toBeGreaterThan(previousGoal.y);
    expect(nextGoal.zoom).toBeLessThanOrEqual(previousGoal.zoom);
  });

  it("follows a heavy fighter's full hop and double jump from a high platform", () => {
    const width = 1280;
    const height = 720;
    const highFighter = getFighterDefinition("dark-knight-2d");
    const grounded = cameraFighter(-160, 41);
    let y = 385;
    let velocityY = 0;
    let camera = computeGameplayCameraTarget(
      [grounded, cameraFighter(160, y, { x: 0, y: velocityY }, highFighter.size)],
      width,
      height,
    );
    let cameraGoal = { ...camera };
    let minimumVisualTop = Number.POSITIVE_INFINITY;

    velocityY = highFighter.jumpSpeed;
    for (let frame = 0; frame < 70; frame += 1) {
      if (frame === 28) velocityY = highFighter.doubleJumpSpeed;
      velocityY -= highFighter.gravity / 60;
      y += velocityY / 60;
      const target = computeGameplayCameraTarget(
        [grounded, cameraFighter(160, y, { x: 0, y: velocityY }, highFighter.size)],
        width,
        height,
      );
      cameraGoal = updateGameplayCameraGoal(
        camera,
        cameraGoal,
        target,
        [grounded, cameraFighter(160, y, { x: 0, y: velocityY }, highFighter.size)],
        width,
        height,
        false,
      );
      camera.x = smoothCameraValue(
        camera.x,
        cameraGoal.x,
        1 / 60,
        CAMERA_HORIZONTAL_FOLLOW_RATE,
        CAMERA_MAX_HORIZONTAL_SPEED,
      );
      camera.y = smoothCameraValue(
        camera.y,
        cameraGoal.y,
        1 / 60,
        cameraGoal.y > camera.y ? CAMERA_RISE_FOLLOW_RATE : CAMERA_FALL_FOLLOW_RATE,
        CAMERA_MAX_VERTICAL_SPEED,
      );
      camera.zoom = smoothCameraValue(
        camera.zoom,
        cameraGoal.zoom,
        1 / 60,
        cameraGoal.zoom < camera.zoom
          ? CAMERA_ZOOM_OUT_RATE
          : CAMERA_ZOOM_IN_RATE,
        cameraGoal.zoom < camera.zoom
          ? CAMERA_MAX_ZOOM_OUT_SPEED
          : CAMERA_MAX_ZOOM_IN_SPEED,
      );
      if (y < 700) {
        const visualTop =
          height * CAMERA_SCREEN_ANCHOR_RATIO -
          (y + highFighter.size.height * 0.67 - camera.y) * camera.zoom;
        minimumVisualTop = Math.min(minimumVisualTop, visualTop);
      }
    }

    expect(minimumVisualTop).toBeGreaterThanOrEqual(height * 0.04);
  });

  it("keeps two open fighters smooth near the high platform", () => {
    const width = 1280;
    const height = 720;
    const airborneFighter = getFighterDefinition("kaykit-knight");
    const groundedFighter = getFighterDefinition("george");
    const initialFighters = [
      cameraFighter(-140, 41, { x: 0, y: 0 }, groundedFighter.size),
      cameraFighter(140, 41, { x: 0, y: 0 }, airborneFighter.size),
    ];
    const initialCamera = computeGameplayCameraTarget(initialFighters, width, height);
    const harness = {
      width,
      height,
      camera: { ...initialCamera },
      cameraGoal: { ...initialCamera },
      cameraPrimed: true,
      cameraStableSeconds: 0,
    };
    const updateCamera = (
      GameRenderer.prototype as unknown as {
        updateCamera(snapshot: GameSnapshot, dt: number): void;
      }
    ).updateCamera;
    let previous = { ...harness.camera };
    let maximumHorizontalStep = 0;
    let maximumVerticalStep = 0;
    let maximumZoomStep = 0;
    const settledZoomDirections: number[] = [];

    for (let frame = 0; frame < 150; frame += 1) {
      const ascentProgress = Math.min(1, frame / 55);
      const airborneY = 41 + 545 * (1 - Math.cos(ascentProgress * Math.PI / 2));
      const velocityY = frame < 55 ? 720 * Math.cos(ascentProgress * Math.PI / 2) : 0;
      const fighters = [
        cameraFighter(-140, 41, { x: 0, y: 0 }, groundedFighter.size),
        cameraFighter(140, airborneY, { x: 0, y: velocityY }, airborneFighter.size),
      ];

      updateCamera.call(harness, {
        fighters,
        events: [],
        stage: { blastZone: getStageDefinition(DEFAULT_STAGE_ID).blastZone },
      } as unknown as GameSnapshot, 1 / 60);

      const zoomDelta = harness.camera.zoom - previous.zoom;
      maximumHorizontalStep = Math.max(
        maximumHorizontalStep,
        Math.abs(harness.camera.x - previous.x),
      );
      maximumVerticalStep = Math.max(
        maximumVerticalStep,
        Math.abs(harness.camera.y - previous.y),
      );
      maximumZoomStep = Math.max(maximumZoomStep, Math.abs(zoomDelta));
      if (frame > 90 && Math.abs(zoomDelta) > 1e-6) {
        settledZoomDirections.push(Math.sign(zoomDelta));
      }
      previous = { ...harness.camera };
    }

    const settledDirectionChanges = settledZoomDirections.reduce(
      (changes, direction, index) =>
        index > 0 && direction !== settledZoomDirections[index - 1]
          ? changes + 1
          : changes,
      0,
    );
    expect(maximumHorizontalStep).toBeLessThanOrEqual(CAMERA_MAX_HORIZONTAL_SPEED / 60 + 1e-8);
    expect(maximumVerticalStep).toBeLessThanOrEqual(CAMERA_MAX_VERTICAL_SPEED / 60 + 1e-8);
    expect(maximumZoomStep).toBeLessThanOrEqual(CAMERA_MAX_ZOOM_OUT_SPEED / 60 + 1e-8);
    expect(settledDirectionChanges).toBeLessThanOrEqual(1);
  });

  it("ignores a fighter that is still respawning", () => {
    const activeOnly = computeGameplayCameraTarget(
      [cameraFighter(0, 41)],
      1280,
      720,
    );
    const withRespawn = computeGameplayCameraTarget(
      [cameraFighter(0, 41), cameraFighter(900, 900, { x: 0, y: 0 }, undefined, 60)],
      1280,
      720,
    );
    expect(withRespawn).toEqual(activeOnly);
  });
});
