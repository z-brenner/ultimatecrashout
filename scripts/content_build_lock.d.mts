export const CONTENT_BUILD_LOCK: ".content-build.lock";
export function readContentBuildLock(root: string): { pid: number; label: string; startedAt: string } | null;
export function withContentBuildLock<T>(root: string, label: string, build: () => Promise<T> | T): Promise<T>;
