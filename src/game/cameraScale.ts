/**
 * The camera frames a 1280×720 reference view; real windows scale it. Shared
 * by the renderer's camera and the battle HUD, so they always agree.
 */
export const CAMERA_REFERENCE_WIDTH = 1280;
export const CAMERA_REFERENCE_HEIGHT = 720;

/**
 * How much bigger (or smaller) than the reference the view is: by height on
 * wide windows (they see more to the sides), by width on narrow or portrait
 * ones (they see more above and below), so the fighters always fit.
 */
export const cameraViewScale = (viewportWidth: number, viewportHeight: number): number =>
  Math.max(0.05, Math.min(viewportHeight / CAMERA_REFERENCE_HEIGHT, viewportWidth / CAMERA_REFERENCE_WIDTH));
