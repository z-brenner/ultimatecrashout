// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_FIGHTER_IDS } from "../game/contracts";
import { getFighterDefinition } from "../game/roster";
import { DEFAULT_STAGE_ID, getStageDefinition } from "../game/stages";
import { UIController } from "./ui";

const OPEN_P1 = OPEN_FIGHTER_IDS[0];
const OPEN_P2 = OPEN_FIGHTER_IDS[1];

const click = (root: HTMLElement, selector: string): void => {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing UI control: ${selector}`);
  element.click();
};

const toCharacterSelect = (root: HTMLElement): void => {
  click(root, "[data-ui-action='boot-skip']");
  click(root, "[data-ui-action='title-start']");
  click(root, "[data-ui-action='home-play']");
};

describe("Smash-style menus and screens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("sweeps in a READY TO FIGHT banner once both players lock in, and it leads to the stages", () => {
    const root = document.createElement("div");
    document.body.append(root);
    // Run focus moves (queued on the next frame) straight away.
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callback(0); return 1; }));
    const onUiSound = vi.fn();
    const ui = new UIController(root, { onUiSound });
    toCharacterSelect(root);

    expect(root.querySelector(".cc-ready-banner")).toBeNull();
    click(root, "[data-ui-action='toggle-player-ready'][data-player-slot='0']");
    expect(root.querySelector(".cc-ready-banner")).toBeNull();
    click(root, "[data-ui-action='toggle-player-ready'][data-player-slot='1']");

    const banner = root.querySelector<HTMLElement>(".cc-ready-banner");
    expect(banner?.textContent).toMatch(/Ready to fight/i);
    expect(banner?.classList.contains("is-entering")).toBe(true);
    expect(document.activeElement).toBe(banner);
    // One way forward at a time, so a click or a test never finds two.
    expect(root.querySelectorAll("[data-ui-action='open-stage-select']")).toHaveLength(1);
    expect(onUiSound.mock.calls.filter(([cue]) => cue === "ready-to-fight")).toHaveLength(1);

    // Another redraw while ready keeps the banner without replaying its entrance.
    ui.showCharacterSelect();
    expect(root.querySelector(".cc-ready-banner")?.classList.contains("is-entering")).toBe(false);
    expect(onUiSound.mock.calls.filter(([cue]) => cue === "ready-to-fight")).toHaveLength(1);

    click(root, ".cc-ready-banner");
    expect(ui.screen).toBe("stage-select");

    // Back from the stages, a player un-readies: the banner goes.
    click(root, "[data-ui-action='stage-back']");
    click(root, "[data-ui-action='toggle-player-ready'][data-player-slot='1']");
    expect(root.querySelector(".cc-ready-banner")).toBeNull();
    ui.destroy();
  });

  it("shows both fighters on a versus splash and holds it briefly after a fast load", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    let resolveLaunch: (() => void) | undefined;
    const onStartMatch = vi.fn(() => new Promise<void>((resolve) => { resolveLaunch = resolve; }));
    const ui = new UIController(root, { onStartMatch }, { initialFighters: [OPEN_P1, OPEN_P2], versusSplashMs: 1_000 });
    toCharacterSelect(root);
    click(root, "[data-ui-action='toggle-player-ready'][data-player-slot='0']");
    click(root, "[data-ui-action='toggle-player-ready'][data-player-slot='1']");
    click(root, "[data-ui-action='open-stage-select']");
    click(root, `[data-ui-action='select-stage'][data-stage='${DEFAULT_STAGE_ID}']`);
    click(root, "[data-ui-action='stage-confirm']");

    expect(ui.screen).toBe("match-loading");
    const names = [...root.querySelectorAll(".cc-versus__name strong")].map((node) => node.textContent);
    expect(names).toEqual([getFighterDefinition(OPEN_P1).displayName, getFighterDefinition(OPEN_P2).displayName]);
    expect(root.querySelector(".cc-versus__stage strong")?.textContent).toBe(getStageDefinition(DEFAULT_STAGE_ID).displayName);

    resolveLaunch?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(ui.screen).toBe("match-loading");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ui.screen).toBe("gameplay");
    ui.destroy();
  });

  it("ranks both players on the results screen with each one's stats", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const ui = new UIController(root, {}, { initialFighters: [OPEN_P1, OPEN_P2] });
    toCharacterSelect(root);
    ui.showResults({
      winner: 1,
      durationMs: 95_000,
      kos: [1, 3],
      falls: [3, 1],
      selfDestructs: [1, 0],
      damageDealt: [212.34, 301.5],
      damageTaken: [301.5, 212.34],
    });

    expect(root.querySelector("#cc-result-title")?.textContent).toContain(getFighterDefinition(OPEN_P2).displayName);
    const places = [...root.querySelectorAll(".cc-results__player-place")].map((node) => node.textContent);
    expect(places).toEqual(["2", "1"]);
    const rows = Object.fromEntries([...root.querySelectorAll(".cc-results__table tbody tr")].map((row) => [
      row.querySelector("th")?.textContent,
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    ]));
    expect(rows).toEqual({
      KOs: ["1", "3"],
      Falls: ["3", "1"],
      "Self-destructs": ["1", "0"],
      "Damage dealt": ["212.3%", "301.5%"],
      "Damage taken": ["301.5%", "212.3%"],
    });
    expect(root.querySelector(".cc-results__table caption")?.textContent).toContain("1:35");
    ui.destroy();
  });

  it("reads falls from the other player's KOs when a result carries KOs only", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const ui = new UIController(root, {}, { initialFighters: [OPEN_P1, OPEN_P2] });
    toCharacterSelect(root);
    ui.showResults({ winner: 0, durationMs: 30_000, kos: [3, 1] });
    const falls = [...root.querySelectorAll(".cc-results__table tbody tr")]
      .find((row) => row.querySelector("th")?.textContent === "Falls")!;
    expect([...falls.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["1", "3"]);
    const dealt = [...root.querySelectorAll(".cc-results__table tbody tr")]
      .find((row) => row.querySelector("th")?.textContent === "Damage dealt")!;
    expect([...dealt.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["—", "—"]);
    ui.destroy();
  });
});
