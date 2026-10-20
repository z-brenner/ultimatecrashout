import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Held by `fighter:build -- <id>` and `stage:build -- <id>` while they rewrite
 * atlases, thumbnails, and checksums, so the dev server waits for the whole
 * build instead of reloading on intermediate files.
 */
export const CONTENT_BUILD_LOCK = ".content-build.lock";

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error?.code === "EPERM";
  }
};

/** The running build's lock, or null (no lock, unreadable, or its process died). */
export const readContentBuildLock = (root) => {
  try {
    const lock = JSON.parse(readFileSync(join(root, CONTENT_BUILD_LOCK), "utf8"));
    return Number.isInteger(lock.pid) && isAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
};

export const withContentBuildLock = async (root, label, build) => {
  const path = join(root, CONTENT_BUILD_LOCK);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ pid: process.pid, label, startedAt: new Date().toISOString() })}\n`);
  renameSync(temporary, path);
  try {
    return await build();
  } finally {
    rmSync(path, { force: true });
  }
};
