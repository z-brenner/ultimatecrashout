import {
  ANIMATION_SLOT_MOVE,
  REMOTE_ANIMATION_CONFIG,
  REMOTE_ANIMATION_SLOTS,
  firstHitFrame,
  isFighterVisualReady,
  moveAnimationFrame,
  remoteAnimationSetForFighter,
  type RemoteAnimationDefinition,
  type RemoteAnimationSlot,
} from "../game/characterAssets";
import { FIGHTER_VISUAL_MANIFESTS } from "../game/fighterVisuals";
import { FIGHTER_SKINS } from "../game/content";
import type { FighterId, InputFrame, SkinId, StageId } from "../game/contracts";
import {
  competitiveHitboxesForMove,
  createEmptyInput,
  createGame,
  fighterHurtboxProfile,
  moveFrameWindowActive,
  moveHasMeleeHitboxes,
  type ActiveMeleeHitbox,
  type GameEvent,
} from "../game/engine";
import { drawHitboxCircle, drawHurtboxCapsule, drawOriginMarker } from "../game/debugOverlay";
import { ITEM_DEFINITIONS, isAutomaticItem, type ItemKind } from "../game/items";
import { FIGHTER_IDS, getFighterDefinition, type MoveName } from "../game/roster";
import { findOpaquePixelBounds, spritePixelScale } from "../game/render";
import {
  DEFAULT_STAGE_ID,
  STAGE_DEFINITIONS,
  STAGE_IDS,
  stageSurfaceYAt,
  stageWorldToPixel,
} from "../game/stages";

export const TEST_LAB_ANIMATION_SLOTS = REMOTE_ANIMATION_SLOTS;
export const TEST_LAB_EFFECTS = [
  "none",
  "hit",
  "shield",
  "projectile",
  "explosion",
  "smoke",
  "speed",
  "invincible",
  "ko",
] as const;
type TestLabEffect = (typeof TEST_LAB_EFFECTS)[number];

export interface LabPlaybackState {
  fighter: FighterId;
  skin: SkinId;
  animation: RemoteAnimationSlot;
  facing: -1 | 1;
  speed: number;
  loop: boolean;
  playing: boolean;
  /** Atlas frame on screen. In move mode it is derived from moveFrame. */
  frame: number;
  /** Engine frame of the move (0 = first frame), used for attack slots. */
  moveFrame: number;
}

export type LabMovePhase = "startup" | "active" | "recovery";

export interface LabMoveFrameData {
  move: MoveName;
  moveFrame: number;
  totalFrames: number;
  phase: LabMovePhase;
  /** Atlas frame the game shows on this move frame (key frames applied). */
  atlasFrame: number;
  keyFrame: number | null;
  /** Move frame the key frame is pinned to (first frame a hitbox can connect). */
  strikeFrame: number;
  /** Melee hitboxes able to connect on this frame, in fighter-local units. */
  hitboxes: ActiveMeleeHitbox[];
  intangible: boolean;
  armored: boolean;
}

/** What the engine does on one frame of an attack, for the Lab's frame-data view. */
export const labMoveFrameData = (
  fighter: FighterId,
  slot: RemoteAnimationSlot,
  moveFrame: number,
  frameCount: number,
): LabMoveFrameData | null => {
  const moveName = ANIMATION_SLOT_MOVE[slot];
  if (!moveName) return null;
  const move = getFighterDefinition(fighter).attacks[moveName];
  const totalFrames = move.startup + move.active + move.recovery;
  const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor(moveFrame)));
  const phase: LabMovePhase = frame < move.startup
    ? "startup"
    : frame < move.startup + move.active ? "active" : "recovery";
  // moveAnimationFrame ignores a key frame outside the atlas, so report none.
  const authoredKeyFrame = FIGHTER_VISUAL_MANIFESTS[fighter].keyFrames[slot];
  const keyFrame = authoredKeyFrame !== undefined && authoredKeyFrame >= 0 && authoredKeyFrame < frameCount
    ? authoredKeyFrame
    : null;
  return {
    move: moveName,
    moveFrame: frame,
    totalFrames,
    phase,
    atlasFrame: moveAnimationFrame(frame, move, frameCount, keyFrame ?? undefined),
    keyFrame,
    strikeFrame: firstHitFrame(move),
    hitboxes: moveHasMeleeHitboxes(move) && phase === "active"
      ? competitiveHitboxesForMove(moveName, move, frame - move.startup)
      : [],
    intangible: moveFrameWindowActive(move.intangible, frame),
    armored: moveFrameWindowActive(move.superArmor, frame),
  };
};

/** Frame under a playhead measured in timeline frames (fractional while playing). */
export const labTimelineFrame = (frameCount: number, playhead: number, loop: boolean): number => {
  const raw = Math.max(0, Math.floor(playhead));
  return loop ? raw % frameCount : Math.min(frameCount - 1, raw);
};

export const labFrameAtTime = (
  definition: Pick<RemoteAnimationDefinition, "frameCount" | "fps">,
  elapsedSeconds: number,
  speed: number,
  loop: boolean,
): number => labTimelineFrame(definition.frameCount, elapsedSeconds * definition.fps * speed, loop);

const fighterLabel = (fighter: FighterId): string =>
  getFighterDefinition(fighter).displayName;

const DEFAULT_LAB_FIGHTER = FIGHTER_IDS[0];

if (!DEFAULT_LAB_FIGHTER) {
  throw new Error("No fighter is available for the Lab.");
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export class TestLabController {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly image = new Image();
  private state: LabPlaybackState = {
    fighter: DEFAULT_LAB_FIGHTER,
    skin: "00",
    animation: "idle",
    facing: 1,
    speed: 1,
    loop: true,
    playing: true,
    frame: 0,
    moveFrame: 0,
  };
  private showHurtbox = false;
  private showFrameData = false;
  private readonly boundsCanvas = document.createElement("canvas");
  private readonly boundsCache = new Map<string, ReturnType<typeof findOpaquePixelBounds> | null>();
  private moveDataCache: { key: string; data: LabMoveFrameData | null } | null = null;
  /**
   * Playback position in timeline frames: engine move frames for attacks,
   * atlas frames otherwise. Stepping sets it to an exact integer, so resuming
   * never lands on the previous frame and changing speed never moves it.
   */
  private playhead = 0;
  private previousTimestamp = performance.now();
  private raf = 0;
  private destroyed = false;
  private selectedStage: StageId = DEFAULT_STAGE_ID;
  private selectedItem: ItemKind = "vitality-fruit";
  private selectedEffect: TestLabEffect = "none";

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = this.markup();
    const canvas = this.root.querySelector<HTMLCanvasElement>("[data-lab-canvas]");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) throw new Error("The Lab canvas is unavailable.");
    this.canvas = canvas;
    this.context = context;
    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("change", this.handleChange);
    this.root.addEventListener("input", this.handleInput);
    this.image.decoding = "async";
    this.image.addEventListener("load", this.draw);
    this.loadAnimation(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.image.removeEventListener("load", this.draw);
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("change", this.handleChange);
    this.root.removeEventListener("input", this.handleInput);
  }

  private definition(): RemoteAnimationDefinition {
    return remoteAnimationSetForFighter(
      this.state.fighter,
      this.state.skin,
      REMOTE_ANIMATION_CONFIG,
    ).animations[this.state.animation];
  }

  private markup(): string {
    const itemOptions = Object.entries(ITEM_DEFINITIONS)
      .map(([id, item]) => `<option value="${id}">${escapeHtml(item.label)}</option>`)
      .join("");
    return `
      <div class="cc-lab-workbench">
        <aside class="cc-lab-reel" aria-label="Lab selectors">
          <div class="cc-lab-reel__label"><span>Bank A</span><strong>Fighter</strong></div>
          <label>Fighter
            <select data-lab-field="fighter">
              ${FIGHTER_IDS.map((fighter) => `<option value="${fighter}"${isFighterVisualReady(fighter) ? "" : " disabled"}>${fighterLabel(fighter)}${isFighterVisualReady(fighter) ? "" : " — render required"}</option>`).join("")}
            </select>
          </label>
          <label>Skin
            <select data-lab-field="skin">
              ${FIGHTER_SKINS[this.state.fighter].map((skin) => `<option value="${skin.id}">${skin.label}</option>`).join("")}
            </select>
          </label>
          <label>Animation
            <select data-lab-field="animation">
              ${TEST_LAB_ANIMATION_SLOTS.map((slot) => `<option value="${slot}">${slot}</option>`).join("")}
            </select>
          </label>
          <label>Facing
            <select data-lab-field="facing">
              <option value="1">Right</option>
              <option value="-1">Left</option>
            </select>
          </label>
          <div class="cc-lab-reel__label"><span>Bank B</span><strong>Stage & items</strong></div>
          <label>Stage
            <select data-lab-field="stage">
              ${STAGE_IDS.map((id) => `<option value="${id}">${escapeHtml(STAGE_DEFINITIONS[id].displayName)}</option>`).join("")}
            </select>
          </label>
          <label>Item
            <select data-lab-field="item">${itemOptions}</select>
          </label>
          <label>Visual effect
            <select data-lab-field="effect">
              ${TEST_LAB_EFFECTS.map((effect) => `<option value="${effect}">${effect}</option>`).join("")}
            </select>
          </label>
          <div class="cc-lab-item-preview" data-lab-item-preview aria-live="polite"></div>
          <button class="cc-lab-exercise" type="button" data-lab-action="exercise-item">Test item</button>
          <output class="cc-lab-item-result" data-lab-item-result>Scenario ready</output>
        </aside>

        <section class="cc-lab-monitor" aria-label="Frame-by-frame preview">
          <div class="cc-lab-monitor__header">
            <div><span>TEST LAB / FRAME UNIT</span><strong data-lab-clip-name>${escapeHtml(fighterLabel(this.state.fighter))} • idle</strong></div>
            <output data-lab-fps>30 FPS</output>
          </div>
          <div class="cc-lab-stage" data-lab-stage="${DEFAULT_STAGE_ID}">
            <canvas data-lab-canvas width="512" height="512" aria-label="Animation frame"></canvas>
            <div class="cc-lab-effect" data-lab-effect="none" aria-hidden="true"><i></i><b></b><em></em></div>
            <svg class="cc-lab-overlay cc-lab-overlay--collision" data-lab-overlay="collision" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" aria-label="Solid volumes, platforms, and stage ledges" hidden>
              ${this.stageCollisionMarkup(DEFAULT_STAGE_ID)}
            </svg>
          </div>
          <div class="cc-lab-transport">
            <button type="button" data-lab-action="previous" aria-label="Previous frame">◀|</button>
            <button type="button" data-lab-action="toggle" data-lab-play>Pause</button>
            <button type="button" data-lab-action="next" aria-label="Next frame">|▶</button>
            <label>Speed
              <input type="range" min="0.1" max="2" step="0.1" value="1" data-lab-field="speed">
              <output data-lab-speed>1.0×</output>
            </label>
            <label class="cc-lab-check"><input type="checkbox" data-lab-field="loop" checked> Loop</label>
          </div>
          <div class="cc-lab-timeline">
            <input type="range" min="0" max="1" value="0" data-lab-field="frame" aria-label="Exact frame">
            <output data-lab-frame>Frame 1 / 1</output>
          </div>
          <div class="cc-lab-debug">
            <label><input type="checkbox" data-lab-overlay-toggle="hurt"> Hurtbox</label>
            <label><input type="checkbox" data-lab-overlay-toggle="hit"> Hitboxes &amp; frame data</label>
            <label><input type="checkbox" data-lab-overlay-toggle="collision"> Collisions</label>
            <output data-lab-engine-state>playing=true · loop=true · facing=1</output>
          </div>
        </section>
      </div>`;
  }

  private loadAnimation(reset: boolean): void {
    if (reset) {
      this.playhead = 0;
      this.state.frame = 0;
      this.state.moveFrame = 0;
    }
    const definition = this.definition();
    this.image.src = definition.mediaUrl;
    this.syncMoveFrame();
    const slider = this.root.querySelector<HTMLInputElement>("[data-lab-field='frame']");
    if (slider) {
      slider.max = String(Math.max(0, this.timelineLength() - 1));
      slider.value = String(this.timelinePosition());
    }
    this.canvas.style.filter = "none";
    this.updateLabels();
    this.draw();
  }

  private readonly tick = (timestamp: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.1, Math.max(0, (timestamp - this.previousTimestamp) / 1000));
    this.previousTimestamp = timestamp;
    if (this.state.playing && this.image.complete && this.image.naturalWidth > 0) {
      const moveMode = this.moveData() !== null;
      this.playhead += dt * (moveMode ? 60 : this.definition().fps) * this.state.speed;
      const total = this.timelineLength();
      const next = labTimelineFrame(total, this.playhead, this.state.loop);
      if (next !== this.timelinePosition()) {
        if (moveMode) {
          this.state.moveFrame = next;
          this.syncMoveFrame();
        } else {
          this.state.frame = next;
        }
        this.draw();
        this.updateLabels();
      }
      if (!this.state.loop && next === total - 1) {
        this.state.playing = false;
        this.updateLabels();
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private readonly draw = (): void => {
    const definition = this.definition();
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.image.complete || this.image.naturalWidth <= 0) return;
    const sourceX = (this.state.frame % definition.columns) * definition.cellSize;
    const sourceY = Math.floor(this.state.frame / definition.columns) * definition.cellSize;
    ctx.save();
    const sourceFacing = definition.sourceFacing === "right" ? 1 : -1;
    if (this.state.facing !== sourceFacing) {
      ctx.translate(this.canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(
      this.image,
      sourceX,
      sourceY,
      definition.cellSize,
      definition.cellSize,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    ctx.restore();
    if (this.showHurtbox || this.showFrameData) this.drawFrameData(definition, sourceX, sourceY);
  };

  /** Move-mode frame data for the current selection, or null for non-attack slots. */
  private moveData(): LabMoveFrameData | null {
    const frameCount = this.definition().frameCount;
    const key = `${this.state.fighter}|${this.state.animation}|${this.state.moveFrame}|${frameCount}`;
    if (this.moveDataCache?.key !== key) {
      this.moveDataCache = {
        key,
        data: labMoveFrameData(this.state.fighter, this.state.animation, this.state.moveFrame, frameCount),
      };
    }
    return this.moveDataCache.data;
  }

  private syncMoveFrame(): void {
    const data = this.moveData();
    if (data) this.state.frame = data.atlasFrame;
  }

  private timelineLength(): number {
    return this.moveData()?.totalFrames ?? this.definition().frameCount;
  }

  private timelinePosition(): number {
    return this.moveData() ? this.state.moveFrame : this.state.frame;
  }

  /**
   * Draws the engine's hurtbox and active hitboxes over the sprite, anchored
   * like the match renderer: the cell is centred on the fighter and its lowest
   * opaque pixel (or the cell bottom for an empty cell) sits on the fighter's
   * feet (body centre + height / 2).
   */
  private drawFrameData(definition: RemoteAnimationDefinition, sourceX: number, sourceY: number): void {
    const bounds = this.cellBounds(definition, sourceX, sourceY);
    const fighter = getFighterDefinition(this.state.fighter);
    const cellToCanvas = this.canvas.width / definition.cellSize;
    const unit = cellToCanvas / spritePixelScale(this.state.fighter);
    const feetY = (bounds ? bounds.y + bounds.height : definition.cellSize) * cellToCanvas;
    const origin = { x: this.canvas.width / 2, y: feetY - (fighter.size.height / 2) * unit };
    const data = this.moveData();
    const ctx = this.context;
    ctx.save();
    ctx.lineWidth = 2;
    if (this.showHurtbox) {
      const profile = fighterHurtboxProfile(fighter.size, this.state.animation === "crouch" ? "crouch" : "idle");
      drawHurtboxCapsule(ctx, {
        x: origin.x,
        y: origin.y - profile.centerOffsetY * unit,
        radius: profile.radius * unit,
        segment: Math.max(0, profile.halfHeight - profile.radius) * unit,
      }, { intangible: data?.intangible ?? false, armored: data?.armored ?? false });
    }
    if (this.showFrameData) {
      drawOriginMarker(ctx, origin.x, origin.y);
      for (const hitbox of data?.hitboxes ?? []) {
        drawHitboxCircle(
          ctx,
          origin.x + hitbox.offset.x * this.state.facing * unit,
          origin.y - hitbox.offset.y * unit,
          hitbox.radius * unit,
          hitbox.kind,
        );
      }
    }
    ctx.restore();
  }

  /** Opaque bounds of one atlas cell, cached: scanning a cell reads every pixel. */
  private cellBounds(definition: RemoteAnimationDefinition, sourceX: number, sourceY: number) {
    const key = `${definition.mediaUrl}#${sourceX},${sourceY}`;
    if (this.boundsCache.has(key)) return this.boundsCache.get(key) ?? null;
    const size = definition.cellSize;
    const context = this.boundsCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    this.boundsCanvas.width = size;
    this.boundsCanvas.height = size;
    context.clearRect(0, 0, size, size);
    context.drawImage(this.image, sourceX, sourceY, size, size, 0, 0, size, size);
    let bounds: ReturnType<typeof findOpaquePixelBounds> | null = null;
    try {
      bounds = findOpaquePixelBounds(context.getImageData(0, 0, size, size).data, size, size);
    } catch {
      bounds = null;
    }
    this.boundsCache.set(key, bounds);
    return bounds;
  }

  private updateLabels(): void {
    const definition = this.definition();
    const name = this.root.querySelector<HTMLElement>("[data-lab-clip-name]");
    const fps = this.root.querySelector<HTMLOutputElement>("[data-lab-fps]");
    const frame = this.root.querySelector<HTMLOutputElement>("[data-lab-frame]");
    const state = this.root.querySelector<HTMLOutputElement>("[data-lab-engine-state]");
    const play = this.root.querySelector<HTMLButtonElement>("[data-lab-play]");
    const slider = this.root.querySelector<HTMLInputElement>("[data-lab-field='frame']");
    if (name) name.textContent = `${fighterLabel(this.state.fighter)} • ${definition.label}`;
    const data = this.moveData();
    if (fps) {
      fps.value = data
        ? `${Math.round(60 * this.state.speed)} FPS · engine frames`
        : `${Math.round(definition.fps * this.state.speed)} FPS`;
    }
    if (frame) {
      frame.value = data
        ? `Move frame ${data.moveFrame + 1} / ${data.totalFrames} · ${data.phase} · sprite ${data.atlasFrame + 1} / ${definition.frameCount}`
        : `Frame ${this.state.frame + 1} / ${definition.frameCount}`;
    }
    if (state) {
      state.value = data
        ? `${data.move} · strike on move frame ${data.strikeFrame + 1}${data.keyFrame === null ? " · no key frame" : ` · key sprite ${data.keyFrame + 1}`}${data.intangible ? " · intangible" : ""}${data.armored ? " · super armor" : ""}`
        : `playing=${this.state.playing} · loop=${this.state.loop} · facing=${this.state.facing} · frame=${this.state.frame}`;
    }
    if (play) play.textContent = this.state.playing ? "Pause" : "Play";
    if (slider) slider.value = String(this.timelinePosition());
    this.updateItemPreview();
  }

  private stageCollisionMarkup(stage: StageId): string {
    const definition = STAGE_DEFINITIONS[stage];
    const surfaces = definition.platforms.map((platform) => {
      const leftX = platform.x - platform.width / 2;
      const rightX = platform.x + platform.width / 2;
      const topLeft = stageWorldToPixel(stage, {
        x: leftX,
        y: stageSurfaceYAt(platform, leftX),
      });
      const topRight = stageWorldToPixel(stage, {
        x: rightX,
        y: stageSurfaceYAt(platform, rightX),
      });
      if (platform.kind === "platform") {
        return `<line x1="${topLeft.x.toFixed(2)}" y1="${topLeft.y.toFixed(2)}" x2="${topRight.x.toFixed(2)}" y2="${topRight.y.toFixed(2)}" data-stage-surface="${escapeHtml(platform.id)}" class="is-platform" />`;
      }

      const bottomRight = stageWorldToPixel(stage, {
        x: rightX,
        y: stageSurfaceYAt(platform, rightX) - platform.height,
      });
      const bottomLeft = stageWorldToPixel(stage, {
        x: leftX,
        y: stageSurfaceYAt(platform, leftX) - platform.height,
      });
      const points = [topLeft, topRight, bottomRight, bottomLeft]
        .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" ");
      return `<polygon points="${points}" data-stage-surface="${escapeHtml(platform.id)}" class="is-ground" />`;
    }).join("");

    const ledges = definition.ledges.map((ledge) => {
      const platform = definition.platforms.find(({ id }) => id === ledge.platformId);
      if (!platform) return "";
      const x = platform.x + (ledge.side === "left" ? -platform.width / 2 : platform.width / 2);
      const point = stageWorldToPixel(stage, { x, y: stageSurfaceYAt(platform, x) });
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="5" data-stage-ledge="${escapeHtml(`${ledge.platformId}:${ledge.side}`)}" class="is-ledge" />`;
    }).join("");

    return surfaces + ledges;
  }

  private updateItemPreview(): void {
    const select = this.root.querySelector<HTMLSelectElement>("[data-lab-field='item']");
    const preview = this.root.querySelector<HTMLElement>("[data-lab-item-preview]");
    const kind = select?.value as ItemKind | undefined;
    const item = kind ? ITEM_DEFINITIONS[kind] : undefined;
    if (!preview || !item) return;
    preview.innerHTML = `
      <img src="${item.iconUrl}" alt="" decoding="async" draggable="false">
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.effect)} • ${item.charges} charge${item.charges > 1 ? "s" : ""}</small></div>`;
  }

  private readonly handleClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-lab-action]") : null;
    const action = target?.dataset.labAction;
    if (!action) return;
    if (action === "toggle") {
      this.state.playing = !this.state.playing;
      if (this.state.playing && !this.state.loop && this.timelinePosition() >= this.timelineLength() - 1) {
        this.playhead = 0;
        this.state.frame = 0;
        this.state.moveFrame = 0;
        this.syncMoveFrame();
      }
    } else if (action === "previous" || action === "next") {
      this.state.playing = false;
      const direction = action === "next" ? 1 : -1;
      if (this.moveData()) {
        this.state.moveFrame = Math.max(0, Math.min(this.timelineLength() - 1, this.state.moveFrame + direction));
        this.syncMoveFrame();
      } else {
        this.state.frame = Math.max(
          0,
          Math.min(this.definition().frameCount - 1, this.state.frame + direction),
        );
      }
      this.playhead = this.timelinePosition();
      this.draw();
    } else if (action === "exercise-item") {
      this.exerciseSelectedItem();
    }
    this.updateLabels();
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target instanceof HTMLInputElement && this.syncOverlayToggle(target)) return;
    const field = target.dataset.labField;
    if (field === "fighter" && target instanceof HTMLSelectElement) {
      this.state.fighter = target.value as FighterId;
      const skinSelect = this.root.querySelector<HTMLSelectElement>("[data-lab-field='skin']");
      if (skinSelect) {
        const skins = FIGHTER_SKINS[this.state.fighter];
        if (!skins.some(({ id }) => id === this.state.skin)) {
          this.state.skin = skins[0]!.id;
        }
        skinSelect.innerHTML = skins
          .map((skin) => `<option value="${skin.id}">${skin.label}</option>`)
          .join("");
        skinSelect.value = this.state.skin;
      }
      this.loadAnimation(true);
    } else if (field === "skin") {
      this.state.skin = target.value as SkinId;
      this.loadAnimation(false);
    } else if (field === "animation") {
      this.state.animation = target.value as RemoteAnimationSlot;
      this.loadAnimation(true);
    } else if (field === "facing") {
      this.state.facing = target.value === "-1" ? -1 : 1;
      this.draw();
      this.updateLabels();
    } else if (field === "loop" && target instanceof HTMLInputElement) {
      this.state.loop = target.checked;
      this.updateLabels();
    } else if (field === "stage") {
      this.selectedStage = target.value as StageId;
      const stage = this.root.querySelector<HTMLElement>("[data-lab-stage]");
      if (stage) stage.dataset.labStage = target.value;
      const collision = this.root.querySelector<SVGElement>("[data-lab-overlay='collision']");
      if (collision) collision.innerHTML = this.stageCollisionMarkup(this.selectedStage);
    } else if (field === "item") {
      this.selectedItem = target.value as ItemKind;
      this.updateItemPreview();
    } else if (field === "effect") {
      this.selectedEffect = target.value as TestLabEffect;
      const effect = this.root.querySelector<HTMLElement>("[data-lab-effect]");
      if (effect) {
        effect.dataset.labEffect = "none";
        void effect.offsetWidth;
        effect.dataset.labEffect = this.selectedEffect;
      }
    }
  };

  private readonly handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    // Native checkboxes emit `input` before `change`, while some browser
    // automation surfaces only expose one of the two. Keep the diagnostic
    // layers in sync on both events so the Lab always mirrors the checkbox.
    if (this.syncOverlayToggle(target)) return;
    const field = target.dataset.labField;
    if (field === "frame") {
      this.state.playing = false;
      if (this.moveData()) {
        this.state.moveFrame = Number(target.value);
        this.syncMoveFrame();
      } else {
        this.state.frame = Number(target.value);
      }
      this.playhead = this.timelinePosition();
      this.draw();
      this.updateLabels();
    } else if (field === "speed") {
      this.state.speed = Number(target.value);
      const output = this.root.querySelector<HTMLOutputElement>("[data-lab-speed]");
      if (output) output.value = `${this.state.speed.toFixed(1)}×`;
      this.updateLabels();
    }
  };

  private syncOverlayToggle(target: HTMLInputElement): boolean {
    const overlay = target.dataset.labOverlayToggle;
    if (!overlay) return false;
    if (overlay === "hurt" || overlay === "hit") {
      // Hurtbox and frame data are drawn on the sprite canvas, aligned to the engine.
      if (overlay === "hurt") this.showHurtbox = target.checked;
      else this.showFrameData = target.checked;
      this.draw();
      return true;
    }
    const layer = this.root.querySelector<Element>(`[data-lab-overlay="${overlay}"]`);
    // `hidden` is not a reflected property on SVGElement, so assigning
    // `layer.hidden` leaves the collision SVG's attribute untouched.
    layer?.toggleAttribute("hidden", !target.checked);
    return true;
  }

  private exerciseSelectedItem(): void {
    const output = this.root.querySelector<HTMLOutputElement>("[data-lab-item-result]");
    const definition = ITEM_DEFINITIONS[this.selectedItem];
    const targetFighter =
      FIGHTER_IDS.find((fighter) => fighter !== this.state.fighter) ??
      this.state.fighter;
    const game = createGame(
      {
        players: [
          { fighter: this.state.fighter, skin: this.state.skin, name: "Test", slot: 0, cpu: false, cpuLevel: 1 },
          { fighter: targetFighter, skin: "00", name: "Target", slot: 1, cpu: false, cpuLevel: 1 },
        ],
        stocks: 3,
        items: false,
        itemFrequency: "medium",
        stage: this.selectedStage,
      },
      { countdownFrames: 0, seed: 7, spawnPositions: [{ x: -90, y: 52 }, { x: 90, y: 52 }] },
    );
    const idle = (): [InputFrame, InputFrame] => [createEmptyInput(), createEmptyInput()];
    for (let frame = 0; frame < 90; frame += 1) game.step(idle());
    const position = game.getSnapshot().fighters[0].position;
    game.spawnItem(this.selectedItem, position);
    const events: GameEvent[] = [];
    const record = (pair: [InputFrame, InputFrame]): void => {
      events.push(...game.step(pair).events);
    };
    if (isAutomaticItem(this.selectedItem)) {
      record(idle());
    } else {
      record([this.testInput("grab"), createEmptyInput()]);
      for (let frame = 0; frame < 8; frame += 1) record(idle());
      record([this.testInput("attack", 1), createEmptyInput()]);
      for (let frame = 0; frame < 120; frame += 1) record(idle());
    }
    const snapshot = game.getSnapshot();
    const used = events.some((event) => event.type === "item-use" && event.item === this.selectedItem);
    const hit = events.some((event) => event.type === "hit" && event.item === this.selectedItem);
    const held = snapshot.fighters[0].heldItem;
    const world = snapshot.items.find((item) => item.kind === this.selectedItem);
    if (output) {
      output.value = `${used ? "USE ✓" : "USE —"} · ${hit ? "HIT ✓" : held ? `${held.charges} charge(s)` : world ? world.mode : definition.effect}`;
    }
  }

  private testInput(action: "grab" | "attack", x = 0): InputFrame {
    return {
      held: new Set([action]),
      pressed: new Set([action]),
      released: new Set(),
      direction: { x, y: 0 },
    };
  }
}
