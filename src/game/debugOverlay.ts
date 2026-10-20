import type { ActiveMeleeHitbox } from "./engine";

/**
 * Shared drawing for the collision debug views (the in-match F9 overlay and
 * the Lab), so both read the same: yellow hurtbox, blue while intangible,
 * purple under super armor; hitboxes red (sweet), orange, yellow (sour).
 */

export interface HurtboxCapsule {
  x: number;
  y: number;
  radius: number;
  /** Distance from the capsule centre to each cap's centre. */
  segment: number;
}

const HITBOX_COLORS: Readonly<Record<ActiveMeleeHitbox["kind"], string>> = {
  sweet: "255, 60, 70",
  normal: "255, 150, 40",
  sour: "255, 220, 90",
};

export const drawHurtboxCapsule = (
  ctx: CanvasRenderingContext2D,
  capsule: HurtboxCapsule,
  state: { intangible: boolean; armored: boolean },
): void => {
  const tint = state.intangible ? "120, 220, 255" : state.armored ? "190, 120, 255" : "255, 230, 80";
  const { x, y, radius, segment } = capsule;
  ctx.fillStyle = `rgba(${tint}, ${state.intangible ? 0.16 : 0.2})`;
  ctx.strokeStyle = `rgba(${tint}, 0.9)`;
  ctx.beginPath();
  ctx.arc(x, y - segment, radius, Math.PI, 0);
  ctx.lineTo(x + radius, y + segment);
  ctx.arc(x, y + segment, radius, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
};

export const drawOriginMarker = (ctx: CanvasRenderingContext2D, x: number, y: number): void => {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 3, y - 3, 6, 6);
};

export const drawHitboxCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  kind: ActiveMeleeHitbox["kind"],
): void => {
  const color = HITBOX_COLORS[kind];
  ctx.fillStyle = `rgba(${color}, 0.35)`;
  ctx.strokeStyle = `rgba(${color}, 0.95)`;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
};
