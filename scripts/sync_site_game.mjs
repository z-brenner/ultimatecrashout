import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "dist");
const target = resolve(root, "website", "public");

if (!existsSync(resolve(source, "index.html")) || !existsSync(resolve(source, "assets"))) {
  throw new Error("Missing public game build. Run npm run build:public first.");
}

// The game build uses relative URLs, so it is copied whole under /play/.
// Older syncs placed its assets at the site root; remove that copy too.
rmSync(resolve(target, "assets"), { recursive: true, force: true });
rmSync(resolve(target, "play"), { recursive: true, force: true });
mkdirSync(resolve(target, "play"), { recursive: true });
cpSync(source, resolve(target, "play"), { recursive: true });

console.log("Public game bundle synchronized into the hosted site.");
