export interface Point {
  x: number;
  y: number;
}

export interface PlatformMotion {
  /** 2–8 absolute world points; the platform centre travels along them. */
  path: readonly Point[];
  periodFrames: number;
  mode?: "pingpong" | "loop";
  /** Ping-pong only: "sine" slows into each end of the path. */
  easing?: "linear" | "sine";
  phaseFrames?: number;
  /** Optional sprite (pack-relative) drawn at the arena's pixel scale. */
  sprite?: string;
}

export interface HazardSchedule {
  periodFrames: number;
  warningFrames: number;
  activeFrames: number;
  phaseFrames?: number;
}

export interface HazardHit {
  damage: number;
  /** Degrees: 0 launches right, 90 straight up. */
  angle: number;
  baseKnockback: number;
  knockbackGrowth: number;
  /** Mirror the angle for fighters left of the zone's centre (launch away). */
  mirrorX?: boolean;
}

export interface HazardDefinition {
  id: string;
  kind: "zone";
  /** Centre and size in world units. */
  area: { x: number; y: number; width: number; height: number };
  schedule: HazardSchedule;
  hit: HazardHit;
  color: string;
}

export interface HazardPhase {
  state: "idle" | "warning" | "active";
  cycle: number;
  progress: number;
}

export const STAGE_MECHANICS_LIMITS: Readonly<{
  maxPathPoints: number;
  minPeriodFrames: number;
  maxPeriodFrames: number;
  maxPlatformSpeed: number;
  maxHazards: number;
  minHazardSize: number;
  maxHazardDamage: number;
  minWarningFrames: number;
}>;
export function platformMotionPosition(motion: PlatformMotion, frame: number): Point;
export function platformMotionMaxSpeed(motion: PlatformMotion): number;
export function hazardPhase(schedule: HazardSchedule, frame: number): HazardPhase;
export function hazardOverlaps(
  area: HazardDefinition["area"],
  center: Point,
  halfWidth: number,
  halfHeight: number,
): boolean;
