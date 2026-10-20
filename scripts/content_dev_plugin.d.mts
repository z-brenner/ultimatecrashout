import type { Plugin } from "vite";

export const OPEN_FIGHTER_RUNTIME_MODULE: "virtual:open-fighter-runtime";
export interface OpenFighterRuntimeStatus {
  visualReady: boolean;
  productionReady: boolean;
}
export function readOpenFighterRuntime(root: string): {
  metadata: { fighters: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  status: Record<string, OpenFighterRuntimeStatus>;
};
export function classifyContentChange(
  root: string,
  file: string,
): { kind: "sync"; packs: "fighters" | "stages" } | { kind: "runtime" } | null;
export function openFighterRuntimePlugin(options: { root: string }): Plugin;
export function contentWatchPlugin(options: {
  root: string;
  runSync?: (root: string, script: string) => Promise<{ ok: boolean; output: string }>;
  debounceMs?: number;
}): Plugin;
