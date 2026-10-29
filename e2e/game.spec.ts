import { expect, test } from "@playwright/test";
import {
  debugApi,
  fighters,
  holdKey,
  readyFighterIds,
  readyStageIds,
  trackProblems,
  waitForPlaying,
} from "./helpers";

test.describe("menus", () => {
  test("boots to the title and the main menu without errors", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    // The start prompt pulses forever, so press Enter like a player would.
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-ui-action='home-play']")).toBeVisible();
    await expect(page).toHaveTitle(/Ultimate Crashout/);
    expect(problems).toEqual([]);
  });

  test("character select lists every ready fighter pack automatically", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    // The start prompt pulses forever, so press Enter like a player would.
    await page.keyboard.press("Enter");
    await page.locator("[data-ui-action='home-play']").click();

    const cards = page.locator("[data-ui-action='pick-fighter']");
    const expected = readyFighterIds();
    await expect(cards).toHaveCount(expected.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.fighter)))
      .toEqual(expected);
    // Every portrait thumbnail actually loads.
    await expect.poll(() => page.locator(".cc-fighter-card img").evaluateAll((images) =>
      images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
    )).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe("stage select", () => {
  test("lists every ready stage pack and starts a match on the chosen one", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.locator("[data-ui-action='home-play']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='0']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='1']").click();
    await page.locator("[data-ui-action='open-stage-select']").click();

    const cards = page.locator("[data-ui-action='select-stage']");
    const expected = readyStageIds();
    expect(expected.length).toBeGreaterThan(1);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.stage)))
      .toEqual(expected);
    const last = expected.at(-1)!;
    await page.locator(`[data-ui-action='select-stage'][data-stage='${last}']`).click();
    await page.locator("[data-ui-action='stage-confirm']").click();
    await waitForPlaying(page);
    expect(await page.evaluate((api) =>
      (window as unknown as Record<string, { getSnapshot(): { stage: { id: string } } }>)[api]!.getSnapshot().stage.id,
    "__ULTIMATE_CRASHOUT__")).toBe(last);
    expect(problems).toEqual([]);
  });
});

test.describe("local match", () => {
  test("plays a full menu-to-match flow with two keyboard players", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    // The start prompt pulses forever, so press Enter like a player would.
    await page.keyboard.press("Enter");
    await page.locator("[data-ui-action='home-play']").click();

    await page.locator("[data-ui-action='pick-fighter'][data-fighter='buckle']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='0']").click();
    await page.locator("[data-ui-action='pick-fighter'][data-fighter='rgs-stick']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='1']").click();
    await page.locator("[data-ui-action='open-stage-select']").click();
    await page.locator("[data-ui-action='select-stage']").first().click();
    await page.locator("[data-ui-action='stage-confirm']").click();

    await waitForPlaying(page);
    const start = await fighters(page);
    expect(start?.map(({ fighter }) => fighter)).toEqual(["buckle", "rgs-stick"]);

    // P1 (WASD) walks right; P2 (arrows) walks left.
    await page.keyboard.down("KeyD");
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(500);
    await page.keyboard.up("KeyD");
    await page.keyboard.up("ArrowLeft");
    const moved = await fighters(page);
    expect(moved![0]!.x).toBeGreaterThan(start![0]!.x + 40);
    expect(moved![1]!.x).toBeLessThan(start![1]!.x - 40);

    // P1 jumps.
    await page.keyboard.press("KeyH");
    await expect.poll(async () => (await fighters(page))![0]!.y, { timeout: 2_000 })
      .toBeGreaterThan(start![0]!.y + 20);

    // Pause and resume.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-ui-action='pause-resume']")).toBeVisible();
    await page.locator("[data-ui-action='pause-resume']").click();
    await expect(page.locator("[data-ui-action='pause-resume']")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("a landed attack deals damage", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./?match=buckle,rgs-stick&items=0");
    await waitForPlaying(page);
    // Close the gap, then jab until the hit registers.
    await holdKey(page, "KeyD", 650);
    await expect.poll(async () => {
      await page.keyboard.press("KeyF");
      return (await fighters(page))![1]!.percent;
    }, { timeout: 8_000, intervals: [150] }).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("the F9 collision overlay toggles without disturbing play", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./?match=buckle,rgs-stick&items=0");
    await waitForPlaying(page);
    await page.keyboard.press("F9");
    await holdKey(page, "KeyD", 200);
    await page.keyboard.press("F9");
    expect((await fighters(page))![0]!.state).not.toBe("ko");
    expect(problems).toEqual([]);
  });
});

test.describe("controller", () => {
  test("a connected gamepad drives a fighter", async ({ page }) => {
    // Chromium cannot attach real controllers in CI, so expose one virtual
    // standard-mapping pad through navigator.getGamepads().
    await page.addInitScript(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
      const pad = {
        id: "Virtual Xbox Controller (STANDARD GAMEPAD)",
        index: 0,
        connected: true,
        mapping: "standard",
        timestamp: 0,
        axes: [0, 0, 0, 0],
        buttons,
        vibrationActuator: null,
      };
      (window as unknown as { __virtualPad: typeof pad }).__virtualPad = pad;
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [pad, null, null, null],
        configurable: true,
      });
      window.addEventListener("load", () => {
        const event = new Event("gamepadconnected");
        Object.defineProperty(event, "gamepad", { value: pad });
        window.dispatchEvent(event);
      });
    });
    const problems = trackProblems(page);
    await page.goto("./?match=buckle,rgs-stick&items=0");
    await waitForPlaying(page);
    const start = await fighters(page);

    const setStick = (x: number) => page.evaluate((value) => {
      const pad = (window as unknown as { __virtualPad: { axes: number[]; timestamp: number } }).__virtualPad;
      pad.axes[0] = value;
      pad.timestamp += 1;
    }, x);
    await setStick(1);
    await page.waitForTimeout(600);
    await setStick(0);

    const after = await fighters(page);
    const moved = after!.map((fighter, slot) => Math.abs(fighter.x - start![slot]!.x));
    expect(Math.max(...moved)).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });
});

test.describe("skins", () => {
  test("a mirror match gives player 2 a recoloured skin, off the main thread", async ({ page }) => {
    const problems = trackProblems(page);
    const workers: string[] = [];
    page.on("worker", (worker) => workers.push(worker.url()));
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.locator("[data-ui-action='home-play']").click();

    await page.locator("[data-ui-action='pick-fighter'][data-fighter='buckle']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='0']").click();
    await page.locator("[data-ui-action='pick-fighter'][data-fighter='buckle']").click();
    await expect(page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='1'] small"))
      .toHaveText("Buckle • Cobalt");
    // Recolouring starts a worker on first use; allow for a cold start on a busy runner.
    const RECOLOR_TIMEOUT = { timeout: 15_000 };
    const portrait = page.locator(".cc-player-panel--p2 .cc-portrait__sprite");
    await expect(portrait).toHaveAttribute("src", /^blob:/, RECOLOR_TIMEOUT);
    await expect(portrait).not.toHaveAttribute("data-skin-portrait", /.*/);

    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='1']").click();
    await page.locator("[data-ui-action='open-stage-select']").click();
    await page.locator("[data-ui-action='select-stage']").first().click();
    await page.locator("[data-ui-action='stage-confirm']").click();
    await waitForPlaying(page);
    expect(await page.evaluate((api) =>
      (window as unknown as Record<string, { getSnapshot(): { fighters: { skin: string }[] } }>)[api]!
        .getSnapshot().fighters.map(({ skin }) => skin),
    debugApi)).toEqual(["00", "01"]);
    await expect(page.locator(".cc-hud-player").nth(1).locator(".cc-portrait__sprite"))
      .toHaveAttribute("src", /^blob:/, RECOLOR_TIMEOUT);
    expect(workers.some((url) => url.includes("skinRecolor.worker"))).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe("stage mechanics", () => {
  test("Crash Course moves its platform and cycles its laser gate", async ({ page }) => {
    const problems = trackProblems(page);
    await page.goto("./");
    await page.locator("[data-ui-action='boot-skip']").click();
    await expect(page.locator("[data-ui-action='title-start']")).toBeVisible();
    await page.keyboard.press("Enter");
    await page.locator("[data-ui-action='home-play']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='0']").click();
    await page.locator("[data-ui-action='toggle-player-ready'][data-player-slot='1']").click();
    await page.locator("[data-ui-action='open-stage-select']").click();
    await page.locator("[data-ui-action='select-stage'][data-stage='crash-course']").click();
    await expect(page.locator("[data-ui-action='toggle-hazards']")).toHaveAttribute("aria-checked", "true");
    await page.locator("[data-ui-action='stage-confirm']").click();
    await waitForPlaying(page);

    type StageState = { top: number; hazard: string | undefined };
    const stage = () => page.evaluate((api) => {
      const snapshot = (window as unknown as Record<string, {
        getSnapshot(): { stage: { platforms: { id: string; x: number }[]; hazards: { state: string }[] } };
      }>)[api]!.getSnapshot();
      return {
        top: snapshot.stage.platforms.find(({ id }) => id === "top")!.x,
        hazard: snapshot.stage.hazards[0]?.state,
      } satisfies StageState;
    }, debugApi);
    const start = await stage();
    await expect.poll(async () => Math.abs((await stage()).top - start.top), { timeout: 5_000 }).toBeGreaterThan(40);
    // The gate warns about 7.5 s into the match, then fires.
    await expect.poll(async () => (await stage()).hazard, { timeout: 15_000, intervals: [100] }).toBe("warning");
    await expect.poll(async () => (await stage()).hazard, { timeout: 5_000, intervals: [50] }).toBe("active");
    expect(problems).toEqual([]);
  });
});

test.describe("fighter audio", () => {
  test("a fighter with its own sounds plays them, preloaded before the match", async ({ page }) => {
    const problems = trackProblems(page);
    // Record what the game plays and what it only preloads.
    await page.addInitScript(() => {
      const log = { played: [] as string[], loaded: [] as string[] };
      (window as unknown as { audioLog: typeof log }).audioLog = log;
      const { play, load } = HTMLMediaElement.prototype;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        log.played.push(this.src);
        return play.call(this);
      };
      HTMLMediaElement.prototype.load = function (this: HTMLMediaElement) {
        log.loaded.push(this.src);
        return load.call(this);
      };
    });
    await page.goto("./?match=buckle,rgs-stick&items=0");
    await waitForPlaying(page);
    const audioLog = () => page.evaluate(() => (window as unknown as { audioLog: { played: string[]; loaded: string[] } }).audioLog);
    const ownCue = (cue: string) => (url: string) => new RegExp(`/${cue}-\\d-[\\w-]+\\.ogg$`).test(url);

    const before = await audioLog();
    // Every Buckle cue is fetched up front, and none has played yet.
    expect(before.loaded.filter(ownCue("attack"))).toHaveLength(3);
    expect(before.played.some(ownCue("attack"))).toBe(false);

    await page.keyboard.press("KeyF");
    await page.keyboard.press("KeyH");
    await expect.poll(async () => {
      const { played } = await audioLog();
      return [played.some(ownCue("attack")), played.some(ownCue("jump"))];
    }, { timeout: 3_000 }).toEqual([true, true]);
    expect(problems).toEqual([]);
  });
});
