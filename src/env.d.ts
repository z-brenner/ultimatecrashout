/// <reference types="vite/client" />

/**
 * Open fighter runtime data served by scripts/content_dev_plugin.mjs: audited
 * 2D animation metadata, and per-fighter visual/publication status used by
 * menus before combat code loads. Reloads in `npm run dev` when packs or
 * atlases change.
 */
declare module "virtual:open-fighter-runtime" {
  export const OPEN_2D_RUNTIME_CONTENT: unknown;
  export const OPEN_FIGHTER_RUNTIME_STATUS: unknown;
}
