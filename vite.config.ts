import { fileURLToPath } from "node:url";
import { defineConfig, type Connect } from "vite";
import {
  findForbiddenAssetsInDirectory,
  isBlockedPublicRuntimeRequestPath,
} from "./scripts/public_asset_boundary.mjs";
import { contentWatchPlugin, openFighterRuntimePlugin } from "./scripts/content_dev_plugin.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

const publicRuntimeBoundary: Connect.NextHandleFunction = (request, response, next) => {
  if (!isBlockedPublicRuntimeRequestPath(request.url ?? "")) {
    next();
    return;
  }
  response.statusCode = 404;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("This path is not part of the public runtime.");
};

/**
 * Relative by default so one build works at a domain root or any sub-path
 * (e.g. user.github.io/ultimatecrashout/). Set UC_BASE_PATH to an absolute
 * prefix such as "/games/crashout/" when a host needs absolute URLs.
 */
const deploymentBase = process.env.UC_BASE_PATH ?? "./";

export default defineConfig(({ command }) => ({
  base: command === "build" ? deploymentBase : "/",
  plugins: [openFighterRuntimePlugin({ root }), contentWatchPlugin({ root }), {
    name: "ultimate-crashout-public-asset-boundary",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(publicRuntimeBoundary);
    },
    configurePreviewServer(server) {
      server.middlewares.use(publicRuntimeBoundary);
    },
    closeBundle() {
      if (command !== "build") return;
      const forbidden = findForbiddenAssetsInDirectory(`${root}/dist`);
      if (forbidden.length > 0) {
        throw new Error(
          `The public build contains non-redistributable asset paths:\n${forbidden.join("\n")}`,
        );
      }
    },
  }],
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.local-private/**",
      "e2e/**",
    ],
  },
}));
