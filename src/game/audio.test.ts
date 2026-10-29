import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_AUDIO_SAMPLES,
  LOCAL_MUSIC_TRACKS,
  createAudioEngine,
  fighterCueSources,
  type FighterAudioCue,
} from "./audio";
import { FIGHTER_IDS } from "./contracts";
import { FIGHTER_AUDIO_CUES, pickVariant } from "./fighterAudio.mjs";
import { OPEN_FIGHTER_AUDIO } from "./generated/openFighterRegistry";
import { DEFAULT_STAGE_ID, STAGE_IDS } from "./stages";

class FakeAudio {
  readonly source: string;
  paused = true;
  currentTime = 0;
  volume = 1;
  loop = false;
  preload = "";
  readonly play = vi.fn(async () => {
    this.paused = false;
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly addEventListener = vi.fn();

  constructor(source: string) {
    this.source = source;
  }
}

const harness = (random?: () => number) => {
  const players: FakeAudio[] = [];
  const audio = createAudioEngine({
    random,
    masterVolume: 0.5,
    musicVolume: 0.6,
    effectsVolume: 0.8,
    audioFactory: (source) => {
      const player = new FakeAudio(source);
      players.push(player);
      return player as unknown as HTMLAudioElement;
    },
  });
  return { audio, players };
};

describe("local audio engine", () => {
  it("declares only redistributable tracks", () => {
    expect(Object.keys(LOCAL_MUSIC_TRACKS)).toEqual(["menu", ...STAGE_IDS]);
    for (const source of Object.values(LOCAL_MUSIC_TRACKS)) {
      expect(source).toMatch(/^\/assets\/audio\/open\/music\/.+\.ogg$/);
      expect(source).not.toMatch(/^https?:/);
    }
    expect(LOCAL_MUSIC_TRACKS.menu).toBe("/assets/audio/open/music/menu-loop.ogg");
    expect(LOCAL_MUSIC_TRACKS[DEFAULT_STAGE_ID]).toBe(
      "/assets/audio/open/music/battle-loop.ogg",
    );
  });

  it("routes every sample through the open asset library", () => {
    for (const source of Object.values(LOCAL_AUDIO_SAMPLES)) {
      expect(source).toMatch(/^\/assets\/audio\/open\//);
    }
    // A fighter's cues are its own pack's files or the shared samples.
    const shared = new Set<string>(Object.values(LOCAL_AUDIO_SAMPLES));
    for (const fighter of FIGHTER_IDS) {
      const own = new Set(Object.values(OPEN_FIGHTER_AUDIO[fighter] ?? {}).flat());
      for (const cue of Object.keys(FIGHTER_AUDIO_CUES) as FighterAudioCue[]) {
        for (const source of fighterCueSources(fighter, cue)) {
          expect(own.has(source) || shared.has(source)).toBe(true);
        }
      }
    }
  });

  it("reuses one loop across repeated submenu starts and switches by stage", async () => {
    const { audio, players } = harness();
    audio.startMenuMusic();
    audio.startMenuMusic();
    audio.startMenuMusic();
    await Promise.resolve();

    expect(players).toHaveLength(1);
    expect(players[0]?.source).toBe(LOCAL_MUSIC_TRACKS.menu);
    expect(players[0]?.loop).toBe(true);
    expect(players[0]?.play).toHaveBeenCalledTimes(1);
    expect(players[0]?.volume).toBeCloseTo(0.3);

    audio.startCombatMusic(0.4, DEFAULT_STAGE_ID);
    expect(players).toHaveLength(2);
    expect(players[0]?.pause).toHaveBeenCalledTimes(1);
    expect(players[1]?.source).toBe(LOCAL_MUSIC_TRACKS[DEFAULT_STAGE_ID]);
    audio.startCombatMusic(0.8, DEFAULT_STAGE_ID);
    expect(players).toHaveLength(2);

    audio.pauseMusic();
    expect(audio.isMusicPaused).toBe(true);
    audio.resumeMusic();
    await Promise.resolve();
    expect(audio.isMusicPaused).toBe(false);
    expect(players[1]?.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("plays local UI, announcer, fighter and item samples", () => {
    const { audio, players } = harness();
    audio.boot();
    audio.menuMove();
    audio.menuMove();
    audio.menuConfirm();
    audio.menuBack();
    audio.ready();
    audio.countdown(3);
    audio.countdown(0);
    audio.fighterCue("george", "jump");
    audio.item("blast-core");
    audio.cue("dodge");
    audio.cue("grab");
    audio.cue("throw");
    audio.cue("projectile");
    audio.cue("item-pickup");
    audio.cue("respawn");
    audio.cue("ledge");
    audio.cue("water-push");
    audio.cue("projectile-reflect");
    audio.cue("swing-light");
    audio.cue("swing-heavy");
    audio.cue("special");
    audio.cue("l-cancel");
    audio.cue("wavedash");

    const sources = players.map((player) => player.source);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.bootIntro);
    expect(sources.filter((source) => source === LOCAL_AUDIO_SAMPLES.menuMove)).toHaveLength(1);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.menuConfirm);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.menuBack);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.ready);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.three);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.go);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.dodge);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.itemBomb);
    expect(sources).toContain(LOCAL_AUDIO_SAMPLES.itemReflect);
    expect(sources).toEqual(expect.arrayContaining([
      LOCAL_AUDIO_SAMPLES.dodge,
      LOCAL_AUDIO_SAMPLES.grab,
      LOCAL_AUDIO_SAMPLES.throw,
      LOCAL_AUDIO_SAMPLES.projectile,
      LOCAL_AUDIO_SAMPLES.itemPickup,
      LOCAL_AUDIO_SAMPLES.respawn,
      LOCAL_AUDIO_SAMPLES.ledge,
      LOCAL_AUDIO_SAMPLES.waterPush,
      LOCAL_AUDIO_SAMPLES.dodge,
      LOCAL_AUDIO_SAMPLES.throw,
      LOCAL_AUDIO_SAMPLES.projectile,
    ]));
  });

  it("falls back to the shared samples for a fighter without its own sounds", () => {
    expect(OPEN_FIGHTER_AUDIO.george).toBeUndefined();
    const { audio, players } = harness();
    audio.fighterCue("george", "attack");
    audio.fighterCue("george", "smash");
    audio.fighterCue("george", "special");
    audio.fighterCue("george", "taunt");
    audio.fighterCue("george", "hurt");
    audio.fighterCue("george", "ko");
    audio.fighterCue("wolf", "jump");
    audio.announceFighter("kaykit-knight");

    // Every attack kind and the taunt borrow the attack sample; hurt and ko stay silent.
    expect(players.map(({ source }) => source)).toEqual([
      LOCAL_AUDIO_SAMPLES.hitLight,
      LOCAL_AUDIO_SAMPLES.hitLight,
      LOCAL_AUDIO_SAMPLES.hitLight,
      LOCAL_AUDIO_SAMPLES.hitLight,
      LOCAL_AUDIO_SAMPLES.dodge,
      LOCAL_AUDIO_SAMPLES.ready,
    ]);
  });

  describe("a fighter with its own sounds", () => {
    const buckle = OPEN_FIGHTER_AUDIO.buckle!;
    let now = 0;
    afterEach(() => vi.restoreAllMocks());
    // Far enough apart that no repeat is deduplicated.
    const spacedOut = () => vi.spyOn(performance, "now").mockImplementation(() => (now += 1_000));

    it("plays the pack's file for every cue it declares", () => {
      spacedOut();
      const { audio, players } = harness(() => 0);
      for (const cue of Object.keys(buckle) as FighterAudioCue[]) {
        audio.fighterCue("buckle", cue);
        expect(buckle[cue]).toContain(players.at(-1)!.source);
      }
      expect(players).toHaveLength(Object.keys(buckle).length);
    });

    it("varies among a cue's files without repeating one back to back", () => {
      spacedOut();
      let seed = 7;
      const { audio, players } = harness(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      for (let index = 0; index < 30; index += 1) audio.fighterCue("buckle", "attack");
      const sources = players.map(({ source }) => source);
      expect(new Set(sources)).toEqual(new Set(buckle.attack));
      for (let index = 1; index < sources.length; index += 1) expect(sources[index]).not.toBe(sources[index - 1]);
    });

    it("does not count a variant dropped inside the gap as heard", () => {
      let time = 0;
      vi.spyOn(performance, "now").mockImplementation(() => time);
      const rolls = [0, 0.99, 0];
      const { audio, players } = harness(() => rolls.shift() ?? 0);
      audio.fighterCue("buckle", "hurt", 0); // plays variant 0
      time = 50;
      audio.fighterCue("buckle", "hurt", 0); // picks another variant, but inside the gap: dropped
      time = 1_000;
      audio.fighterCue("buckle", "hurt", 0); // must still avoid variant 0
      expect(players.map(({ source }) => source)).toEqual([buckle.hurt![0], buckle.hurt![1]]);
    });

    it("gives two players on the same fighter separate voices", () => {
      vi.spyOn(performance, "now").mockReturnValue(5_000);
      const { audio, players } = harness();
      audio.fighterCue("buckle", "hurt", 0);
      audio.fighterCue("buckle", "hurt", 1);
      expect(players).toHaveLength(2);
    });

    it("does not repeat an attack file when a smash borrows the attack files", async () => {
      vi.resetModules();
      vi.doMock("./generated/openFighterRegistry", async (importOriginal) => ({
        ...(await importOriginal<typeof import("./generated/openFighterRegistry")>()),
        OPEN_FIGHTER_AUDIO: { buckle: { attack: ["/a1.ogg", "/a2.ogg"] } },
      }));
      const { createAudioEngine: createFresh } = await import("./audio");
      vi.doUnmock("./generated/openFighterRegistry");
      spacedOut();
      const sources: string[] = [];
      const audio = createFresh({
        random: () => 0,
        audioFactory: (source) => {
          sources.push(source);
          return new FakeAudio(source) as unknown as HTMLAudioElement;
        },
      });
      audio.fighterCue("buckle", "attack", 0);
      audio.fighterCue("buckle", "smash", 0);
      audio.fighterCue("buckle", "taunt", 0);
      expect(sources).toEqual(["/a1.ogg", "/a2.ogg", "/a1.ogg"]);
    });

    it("does not let a repeat inside a cue's gap through", () => {
      vi.spyOn(performance, "now").mockReturnValue(5_000);
      const { audio, players } = harness();
      audio.fighterCue("buckle", "hurt");
      audio.fighterCue("buckle", "hurt");
      audio.fighterCue("buckle", "ko");
      expect(players.map(({ source }) => source)).toEqual([expect.stringContaining("hurt"), buckle.ko![0]]);
    });

    it("preloads each file once, without playing it, and plays it first from that element", () => {
      spacedOut();
      const { audio, players } = harness();
      audio.preloadFighters(["buckle", "george", "buckle"]);
      const files = new Set(Object.values(buckle).flat());
      expect(players.map(({ source }) => source).sort()).toEqual([...files].sort());
      expect(players.every((player) => player.load.mock.calls.length === 1 && player.play.mock.calls.length === 0))
        .toBe(true);
      audio.preloadFighters(["buckle"]);
      expect(players).toHaveLength(files.size);

      // The first play reuses the loaded element; an overlapping one gets its own.
      audio.fighterCue("buckle", "ko", 0);
      const ko = players.find(({ source }) => source === buckle.ko![0])!;
      expect(ko.play).toHaveBeenCalledTimes(1);
      expect(players).toHaveLength(files.size);
      audio.fighterCue("buckle", "ko", 1);
      expect(players).toHaveLength(files.size + 1);
      expect(players.at(-1)!.source).toBe(buckle.ko![0]);
    });
  });

  it("picks every variant, and never the previous one when there is a choice", () => {
    expect(pickVariant(1, 0, () => 0.99)).toBe(0);
    // The first pick can land on any variant, including the last.
    expect(pickVariant(3, -1, () => 0.99)).toBe(2);
    expect(pickVariant(3, -1, () => 0)).toBe(0);
    expect([0, 0.5, 0.99].map((roll) => pickVariant(3, 1, () => roll))).toEqual([0, 2, 2]);
    expect([0, 0.99].map((roll) => pickVariant(2, 0, () => roll))).toEqual([1, 1]);
  });

  it("does not report an autoplay unlock before a real track exists", async () => {
    const { audio } = harness();
    await expect(audio.unlock()).resolves.toBe(false);
    audio.startMenuMusic();
    await expect(audio.unlock()).resolves.toBe(true);
  });

  it("captures the first keyboard or pointer gesture before UI propagation stops", () => {
    const { audio } = harness();
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as EventTarget;

    const cleanup = audio.installAutoplayUnlock(target);

    expect(target.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(target.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });
});
