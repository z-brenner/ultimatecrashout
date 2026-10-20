import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export interface FighterState {
  fighter: string;
  x: number;
  y: number;
  state: string;
  move: string | null;
  percent: number;
  stocks: number;
}

/** Ids of every ready fighter pack, read straight from fighters/ on disk. */
export const readyFighterIds = (): string[] => {
  const root = join(process.cwd(), "fighters");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(root, entry.name, "fighter.json"), "utf8")))
    .filter((pack) => pack.status === "ready")
    .sort((left, right) => left.order - right.order)
    .map((pack) => pack.id as string);
};

/** Ids of every ready stage pack, in pack order. */
export const readyStageIds = (): string[] => {
  const root = join(process.cwd(), "stages");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(root, entry.name, "stage.json"), "utf8")))
    .filter((pack) => pack.status === "ready")
    .sort((left, right) => left.order - right.order)
    .map((pack) => pack.id as string);
};

/** Collects uncaught errors, console errors and failed asset requests. */
export const trackProblems = (page: Page): string[] => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`);
  });
  return problems;
};

export const debugApi = "__ULTIMATE_CRASHOUT__";

export const fighters = async (page: Page): Promise<FighterState[] | null> =>
  page.evaluate((api) => {
    const hook = (window as unknown as Record<string, { getSnapshot(): any } | undefined>)[api];
    const snapshot = hook?.getSnapshot();
    return snapshot
      ? snapshot.fighters.map((fighter: any) => ({
          fighter: fighter.fighter,
          x: fighter.position.x,
          y: fighter.position.y,
          state: fighter.state,
          move: fighter.currentMove,
          percent: fighter.percent,
          stocks: fighter.stocks,
        }))
      : null;
  }, debugApi);

export const matchPhase = async (page: Page): Promise<string | null> =>
  page.evaluate((api) => {
    const hook = (window as unknown as Record<string, { getSnapshot(): any } | undefined>)[api];
    return hook?.getSnapshot()?.phase ?? null;
  }, debugApi);

/** Waits until the countdown is over and inputs are live. */
export const waitForPlaying = async (page: Page): Promise<void> => {
  await expect.poll(() => matchPhase(page), { timeout: 20_000 }).toBe("playing");
};

export const holdKey = async (page: Page, key: string, milliseconds: number): Promise<void> => {
  await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  await page.keyboard.up(key);
};
