/**
 * Deployment base for files served from public/. Vite sets BASE_URL from the
 * `base` option: "./" for the default relative build (works at any URL path),
 * "/" in dev and tests, or an absolute prefix such as "/ultimatecrashout/".
 */
const BASE_URL = (() => {
  const base = import.meta.env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
})();

/**
 * Resolves a public/ file path against the deployment base. Accepts paths with
 * or without a leading slash: publicAsset("/assets/x.svg") and
 * publicAsset("assets/x.svg") are equivalent.
 */
export const publicAsset = (path: string): string =>
  `${BASE_URL}${path.replace(/^\/+/, "")}`;
