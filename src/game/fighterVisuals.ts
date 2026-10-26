import { OPEN_FIGHTER_RUNTIME_STATUS as OPEN_FIGHTER_RUNTIME_DATA } from "virtual:open-fighter-runtime";
import type { FighterId, OpenFighterId, SkinId } from "./contracts";
import type { RemoteAnimationSlot } from "./characterAssets";
import { OPEN_FIGHTER_PACKS } from "./generated/openFighterRegistry";
import { publicAsset } from "./publicAsset";
import type { SkinSwap } from "./skinPalette.mjs";

/** A runtime palette-swap skin declared in the pack's visual.skins. */
export interface FighterSkinPalette {
  name: string;
  swaps: readonly SkinSwap[];
}

/** Skins after 00 are recoloured from the 00 art, in pack order. */
const ALTERNATE_SKIN_IDS = ["01", "02", "03"] as const satisfies readonly SkinId[];

export interface FighterVisualManifest {
  fighter: FighterId;
  sourceKind: "open-3d" | "open-2d";
  atlasRoot: string;
  portraitRoot: string;
  sourceFacing: "left" | "right";
  availableSkins: readonly SkinId[];
  attribution: string;
  sourcePage: string;
  license: { id: string; url?: string };
  /**
   * Per attack slot: the atlas frame that should be on screen on the move's
   * first active frame (see moveAnimationFrame).
   */
  keyFrames: Readonly<Partial<Record<RemoteAnimationSlot, number>>>;
  /** Palette swaps for skins 01–03; skin 00 is the original art. */
  skinPalettes: Readonly<Partial<Record<SkinId, FighterSkinPalette>>>;
}

interface FighterRuntimeStatus {
  visualReady: boolean;
  productionReady: boolean;
}

const OPEN_FIGHTER_RUNTIME_STATUS = OPEN_FIGHTER_RUNTIME_DATA as Readonly<
  Partial<Record<OpenFighterId, FighterRuntimeStatus>>
>;

const declaredSkins = (pack: (typeof OPEN_FIGHTER_PACKS)[number]): readonly FighterSkinPalette[] =>
  // Optional, so absent from most packs' literal types.
  (pack.visual as { skins?: readonly FighterSkinPalette[] }).skins ?? [];

const skinPalettes = (skins: readonly FighterSkinPalette[]): Partial<Record<SkinId, FighterSkinPalette>> =>
  Object.fromEntries(skins.slice(0, ALTERNATE_SKIN_IDS.length).map((skin, index) => [ALTERNATE_SKIN_IDS[index], skin]));

export const FIGHTER_VISUAL_MANIFESTS = Object.fromEntries(
  OPEN_FIGHTER_PACKS.map((pack) => [pack.id, {
    fighter: pack.id,
    sourceKind: pack.kind === "3d" ? "open-3d" : "open-2d",
    atlasRoot: publicAsset(`assets/characters/open/${pack.id}`),
    portraitRoot: publicAsset(`assets/ui/fighters/${pack.id}/select`),
    sourceFacing: pack.visual.sourceFacing,
    availableSkins: ["00", ...ALTERNATE_SKIN_IDS.slice(0, declaredSkins(pack).length)],
    attribution: pack.visual.attribution,
    sourcePage: pack.visual.sourcePage,
    license: pack.visual.license,
    // Optional, so absent from most packs' literal types.
    keyFrames: (pack.visual as {
      keyFrames?: Readonly<Partial<Record<RemoteAnimationSlot, number>>>;
    }).keyFrames ?? {},
    skinPalettes: skinPalettes(declaredSkins(pack)),
  } satisfies FighterVisualManifest]),
) as unknown as Readonly<Record<FighterId, FighterVisualManifest>>;

export const isFighterVisualReady = (fighter: FighterId): boolean =>
  OPEN_FIGHTER_RUNTIME_STATUS[fighter]?.visualReady === true;

export const isFighterProductionReady = (fighter: FighterId): boolean =>
  OPEN_FIGHTER_RUNTIME_STATUS[fighter]?.productionReady === true;

export const CHARACTER_PORTRAITS = Object.fromEntries(
  Object.entries(FIGHTER_VISUAL_MANIFESTS).map(([fighter, manifest]) => [
    fighter,
    `${manifest.portraitRoot}/00.png`,
  ]),
) as Readonly<Record<FighterId, string>>;
