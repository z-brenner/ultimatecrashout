export const CONTENT_BUILD_LOCKS: ".content-builds";
export interface ContentBuildLock {
  pid: number;
  label: string;
  startedAt: string;
}
export function readContentBuildLock(root: string, now?: number): ContentBuildLock | null;
export function holdContentBuildLock(root: string, label: string): () => void;
export function withContentBuildLock<T>(root: string, label: string, build: () => Promise<T> | T): Promise<T>;
