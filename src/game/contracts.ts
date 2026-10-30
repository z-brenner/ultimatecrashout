import {
  OPEN_2D_FIGHTER_IDS,
  OPEN_3D_FIGHTER_IDS,
  OPEN_FIGHTER_IDS_BY_ORDER,
} from "./generated/openFighterRegistry";
import { OPEN_STAGE_IDS } from "./generated/openStageRegistry";

export { OPEN_2D_FIGHTER_IDS, OPEN_3D_FIGHTER_IDS, OPEN_STAGE_IDS };

/** All distributable fighters in pack `order`, regardless of rendering pipeline. */
export const OPEN_FIGHTER_IDS = OPEN_FIGHTER_IDS_BY_ORDER;

/** Runtime roster order used by gameplay and content-driven UI surfaces. */
export const FIGHTER_IDS = OPEN_FIGHTER_IDS;

export type Open3DFighterId = (typeof OPEN_3D_FIGHTER_IDS)[number];
export type Open2DFighterId = (typeof OPEN_2D_FIGHTER_IDS)[number];
export type OpenFighterId = (typeof OPEN_FIGHTER_IDS)[number];
export type FighterId = (typeof FIGHTER_IDS)[number];

export const isOpenFighterId = (fighter: FighterId): fighter is OpenFighterId =>
  (OPEN_FIGHTER_IDS as readonly FighterId[]).includes(fighter);

export const isOpen2DFighterId = (fighter: FighterId): fighter is Open2DFighterId =>
  (OPEN_2D_FIGHTER_IDS as readonly FighterId[]).includes(fighter);

export const isOpen3DFighterId = (fighter: FighterId): fighter is Open3DFighterId =>
  (OPEN_3D_FIGHTER_IDS as readonly FighterId[]).includes(fighter);

export type PlayerSlot = 0 | 1;

export type SkinId = "00" | "01" | "02" | "03";

export type OpenStageId = (typeof OPEN_STAGE_IDS)[number];
export type StageId = OpenStageId;

export type ActionName =
  | "left"
  | "right"
  | "up"
  | "down"
  | "jump"
  | "attack"
  | "special"
  | "shield"
  | "grab"
  | "pause";

export type BindingMap = Record<ActionName, string>;

export interface InputFrame {
  held: Set<ActionName>;
  pressed: Set<ActionName>;
  released: Set<ActionName>;
  direction: { x: number; y: number };
  /** True when direction comes from an analogue stick rather than digital keys. */
  analog?: boolean;
}

export interface PlayerSetup {
  fighter: FighterId;
  skin: SkinId;
  name: string;
  slot: PlayerSlot;
  cpu: boolean;
  cpuLevel: 1 | 2 | 3;
}

export interface GameSettings {
  musicVolume: number;
  effectsVolume: number;
  shake: number;
  flashes: number;
  items: boolean;
  itemFrequency: "low" | "medium" | "high";
  /** Stage hazard zones on stages that have them. */
  stageHazards: boolean;
  bindings: [BindingMap, BindingMap];
  tutorialSeen: boolean;
}

export interface MatchConfig {
  players: [PlayerSetup, PlayerSetup];
  stocks: number;
  /** Null or omitted keeps the traditional untimed stock battle. */
  timeLimitSeconds?: number | null;
  items: boolean;
  itemFrequency: GameSettings["itemFrequency"];
  stage: StageId;
  /** Stage hazard zones; omitted means on. Moving platforms always move. */
  stageHazards?: boolean;
}

export interface MatchResult {
  winner: PlayerSlot;
  durationMs: number;
  /** KOs each player scored on the other. */
  kos: [number, number];
  /** Stocks each player lost, however. */
  falls?: [number, number];
  /** Falls with no opponent's hit to credit. */
  selfDestructs?: [number, number];
  /** Percent each player dealt to the other. */
  damageDealt?: [number, number];
  /** Percent each player took, from any source. */
  damageTaken?: [number, number];
}
