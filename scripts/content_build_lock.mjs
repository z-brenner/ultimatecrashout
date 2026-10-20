import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content builds (pack builds, atlas and thumbnail generators) each hold a
 * lock file here while they rewrite assets, so the dev server waits for the
 * whole build instead of reloading on intermediate files. One file per
 * process, so concurrent builds never release each other's lock.
 */
export const CONTENT_BUILD_LOCKS = ".content-builds";
/** A lock this old is stale even if its PID was reused by another process. */
const MAX_LOCK_AGE_MS = 2 * 60 * 60 * 1000;

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error?.code === "EPERM";
  }
};

/** A running build's lock, or null when none is held by a live process. */
export const readContentBuildLock = (root, now = Date.now()) => {
  let names = [];
  try {
    names = readdirSync(join(root, CONTENT_BUILD_LOCKS)).filter((name) => name.endsWith(".json"));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const lock = JSON.parse(readFileSync(join(root, CONTENT_BUILD_LOCKS, name), "utf8"));
      const age = now - Date.parse(lock.startedAt);
      if (Number.isInteger(lock.pid) && isAlive(lock.pid) && age >= 0 && age < MAX_LOCK_AGE_MS) return lock;
    } catch {
      // Unreadable or half-written: not a lock (yet).
    }
  }
  return null;
};

/**
 * Takes this process's lock and returns its release. The lock is also
 * released on process exit; a killed process leaves a file the reader
 * ignores once the PID is gone.
 */
export const holdContentBuildLock = (root, label) => {
  const directory = join(root, CONTENT_BUILD_LOCKS);
  const path = join(directory, `${process.pid}.json`);
  const temporary = `${path}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify({ pid: process.pid, label, startedAt: new Date().toISOString() })}\n`);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  const release = () => {
    process.removeListener("exit", release);
    rmSync(path, { force: true });
  };
  process.once("exit", release);
  return release;
};

export const withContentBuildLock = async (root, label, build) => {
  const release = holdContentBuildLock(root, label);
  try {
    return await build();
  } finally {
    release();
  }
};
