/**
 * Data-driven stage mechanics: moving platforms and hazard zones. Pure
 * functions of the playing frame, so a match replays identically, and shared
 * by the engine, the stage pack validator, and the renderer.
 */

/** Limits the validator enforces; the engine relies on them. */
export const STAGE_MECHANICS_LIMITS = Object.freeze({
  maxPathPoints: 8,
  minPeriodFrames: 60,
  maxPeriodFrames: 3600,
  /** World units per frame. Faster platforms could outrun the landing sweep. */
  maxPlatformSpeed: 12,
  maxHazards: 6,
  minHazardSize: 16,
  maxHazardDamage: 40,
  /** A hazard must telegraph itself before it can hit. */
  minWarningFrames: 30,
});

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

/** Point at `distance` along an open polyline. */
const pointAlong = (points, distance) => {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (remaining <= length || index === points.length - 1) {
      const ratio = length === 0 ? 0 : Math.min(1, Math.max(0, remaining / length));
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= length;
  }
  return { x: points[0].x, y: points[0].y };
};

const polylineLength = (points) => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
};

/**
 * Centre of a moving platform on `frame` (0 = first playing frame).
 * "pingpong" travels the path and back once per period ("sine" easing slows
 * into each end); "loop" travels the path and returns straight to its start.
 */
export const platformMotionPosition = (motion, frame) => {
  const { path, periodFrames, mode = "pingpong", easing = "linear", phaseFrames = 0 } = motion;
  const progress = positiveModulo(frame + phaseFrames, periodFrames) / periodFrames;
  if (mode === "loop") {
    const closed = [...path, path[0]];
    return pointAlong(closed, progress * polylineLength(closed));
  }
  let travel = progress < 0.5 ? progress * 2 : 2 - progress * 2;
  if (easing === "sine") travel = (1 - Math.cos(Math.PI * travel)) / 2;
  return pointAlong(path, travel * polylineLength(path));
};

/** Fastest per-frame movement over one period, for validation. */
export const platformMotionMaxSpeed = (motion) => {
  let fastest = 0;
  let previous = platformMotionPosition(motion, 0);
  for (let frame = 1; frame <= motion.periodFrames; frame += 1) {
    const next = platformMotionPosition(motion, frame);
    fastest = Math.max(fastest, Math.hypot(next.x - previous.x, next.y - previous.y));
    previous = next;
  }
  return fastest;
};

/**
 * Where a hazard is in its cycle on `frame`. Each period ends with the warning
 * then the active window; `cycle` numbers activations so a fighter is hit at
 * most once per activation.
 */
export const hazardPhase = (schedule, frame) => {
  const { periodFrames, warningFrames, activeFrames, phaseFrames = 0 } = schedule;
  const shifted = frame + phaseFrames;
  const cycle = Math.floor(shifted / periodFrames);
  const time = positiveModulo(shifted, periodFrames);
  const activeStart = periodFrames - activeFrames;
  const warningStart = activeStart - warningFrames;
  if (time >= activeStart) {
    return { state: "active", cycle, progress: (time - activeStart) / activeFrames };
  }
  if (time >= warningStart) {
    return { state: "warning", cycle, progress: (time - warningStart) / warningFrames };
  }
  return { state: "idle", cycle, progress: time / Math.max(1, warningStart) };
};

/** Whether an axis-aligned box (centre, half extents) overlaps a hazard area. */
export const hazardOverlaps = (area, center, halfWidth, halfHeight) =>
  Math.abs(center.x - area.x) <= area.width / 2 + halfWidth &&
  Math.abs(center.y - area.y) <= area.height / 2 + halfHeight;
