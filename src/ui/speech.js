/**
 * Non-modal, world-space speech bubbles.
 *
 * The model is DOM-free and belongs to gameplay state: integration calls
 * `show()` when an actor says something, advances `update(dtMs)` from the
 * render loop, and calls `render(ctx, cameraOrView)` on a canvas layer.
 *
 * `render` expects the context to already be translated into world space, which
 * is how `WorldRenderer` draws tiles and characters. If that is not the case,
 * pass `{ worldSpace: false, camera: { x, y }, tileSize }` (or a plain camera
 * object plus `screenSpace: true`) and the bubble keeps itself screen-aligned.
 *
 * Positions come from an injected `getActor(actorId)`, so bubbles follow a
 * moving actor without the speech layer owning characters. A position captured
 * at `show()` time is used as a fallback for actors that are not resolvable.
 */

export const DEFAULT_BUBBLE_DURATION_MS = 2400;
export const DEFAULT_MAX_BUBBLES = 8;
export const DEFAULT_BUBBLE_MAX_WIDTH = 152;
export const MAX_BUBBLE_TEXT_LENGTH = 140;

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 60000;
const DEFAULT_TILE_SIZE = 48;
const DEFAULT_HEAD_HEIGHT_TILES = 1.7;
const PADDING_X = 8;
const PADDING_Y = 6;
const LINE_HEIGHT = 13;
const FONT_SIZE = 11;
const RADIUS = 8;
const TAIL_HEIGHT = 5;
const HEAD_GAP = 10;

const COLORS = Object.freeze({
  background: 'rgba(12, 20, 14, 0.92)',
  border: 'rgba(163, 210, 139, 0.45)',
  text: '#edf4e9',
  tail: 'rgba(12, 20, 14, 0.92)'
});

/**
 * @typedef {Object} SpeechBubble
 * @property {string} actorId
 * @property {string} text
 * @property {string|null} key
 * @property {number} durationMs
 * @property {number} remainingMs
 * @property {number|null} x
 * @property {number|null} y
 * @property {number} seq
 */

export class SpeechBubbles {
  /**
   * @param {object} [options]
   * @param {(actorId: string) => ({x:number,y:number}|null)} [options.getActor]
   * @param {number} [options.maxBubbles=8]
   * @param {number} [options.defaultDurationMs=2400]
   * @param {number} [options.maxWidth=152]
   * @param {number} [options.tileSize=48]
   * @param {number} [options.headHeightTiles=1.7]
   */
  constructor({
    getActor = null,
    maxBubbles = DEFAULT_MAX_BUBBLES,
    defaultDurationMs = DEFAULT_BUBBLE_DURATION_MS,
    maxWidth = DEFAULT_BUBBLE_MAX_WIDTH,
    tileSize = DEFAULT_TILE_SIZE,
    headHeightTiles = DEFAULT_HEAD_HEIGHT_TILES
  } = {}) {
    this.getActor = typeof getActor === 'function' ? getActor : null;
    this.maxBubbles = Math.max(1, Math.floor(Number(maxBubbles) || DEFAULT_MAX_BUBBLES));
    this.defaultDurationMs = clampDuration(defaultDurationMs);
    this.maxWidth = Math.max(48, Number(maxWidth) || DEFAULT_BUBBLE_MAX_WIDTH);
    this.tileSize = Math.max(1, Number(tileSize) || DEFAULT_TILE_SIZE);
    this.headHeightTiles = Math.max(0, Number(headHeightTiles) || DEFAULT_HEAD_HEIGHT_TILES);
    this.now = 0;
    this.sequence = 0;
    this.bubbles = new Map();
  }

  /** Replace the actor resolver after construction (useful for tests and late wiring). */
  setActorResolver(getActor) {
    this.getActor = typeof getActor === 'function' ? getActor : null;
    return this;
  }

  /**
   * Show one bubble. A newer bubble from the same actor replaces the old one so
   * a chatty NPC can never stack a column of text.
   *
   * @param {object} input
   * @param {string|number} input.actorId
   * @param {string} input.text
   * @param {number} [input.durationMs]
   * @param {number} [input.x] fallback world tile x
   * @param {number} [input.y] fallback world tile y
   * @param {string} [input.key] optional dialogue key for debug/analytics
   * @returns {SpeechBubble|null}
   */
  show({ actorId, text, durationMs, x = null, y = null, key = null } = {}) {
    if (actorId == null) return null;
    const clean = normaliseText(text);
    if (!clean) return null;

    const id = String(actorId);
    this.bubbles.delete(id);
    const bubble = {
      actorId: id,
      actorRef: actorId,
      text: clean,
      key: key == null ? null : String(key),
      durationMs: clampDuration(durationMs == null ? this.defaultDurationMs : durationMs),
      remainingMs: 0,
      x: Number.isFinite(x) ? x : null,
      y: Number.isFinite(y) ? y : null,
      seq: ++this.sequence
    };
    bubble.remainingMs = bubble.durationMs;
    this.bubbles.set(id, bubble);
    this.#trim();
    return publicBubble(bubble);
  }

  /**
   * Advance timers and drop expired bubbles.
   * @param {number} dtMs
   * @returns {SpeechBubble[]} active bubbles after the update
   */
  update(dtMs) {
    const delta = Number(dtMs);
    if (!Number.isFinite(delta) || delta < 0) {
      throw new TypeError('update(dtMs) expects a non-negative number of milliseconds');
    }
    this.now += delta;
    for (const [actorId, bubble] of this.bubbles) {
      bubble.remainingMs -= delta;
      if (bubble.remainingMs <= 0) this.bubbles.delete(actorId);
    }
    return this.list();
  }

  /** Active bubbles, oldest first. */
  list() {
    return [...this.bubbles.values()]
      .sort((a, b) => a.seq - b.seq)
      .map(publicBubble);
  }

  /** The bubble currently shown for one actor, or null. */
  activeFor(actorId) {
    if (actorId == null) return null;
    const bubble = this.bubbles.get(String(actorId));
    return bubble ? publicBubble(bubble) : null;
  }

  /** Remove one actor's bubble, or every bubble when `actorId` is omitted. */
  clear(actorId = null) {
    if (actorId == null) {
      const count = this.bubbles.size;
      this.bubbles.clear();
      return count;
    }
    return this.bubbles.delete(String(actorId)) ? 1 : 0;
  }

  /** Serialisable state for debug panels and snapshot tests. */
  snapshot() {
    return {
      version: 1,
      now: this.now,
      maxBubbles: this.maxBubbles,
      bubbles: this.list()
    };
  }

  /**
   * Draw all live bubbles. Missing positions are skipped rather than drawn at
   * an arbitrary tile.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} [cameraOrView]
   * @param {{x:number,y:number}} [cameraOrView.camera]
   * @param {number} [cameraOrView.x]
   * @param {number} [cameraOrView.y]
   * @param {number} [cameraOrView.tileSize]
   * @param {number} [cameraOrView.headHeight] pixels above the tile's foot line
   * @param {boolean} [cameraOrView.worldSpace=true]
   * @param {boolean} [cameraOrView.screenSpace=false]
   * @param {number} [cameraOrView.width]
   * @param {number} [cameraOrView.height]
   * @returns {number} number of bubbles drawn
   */
  render(ctx, cameraOrView = {}) {
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.fillText !== 'function') return 0;

    const view = cameraOrView || {};
    const camera = resolveCamera(view);
    const worldSpace = view.worldSpace === undefined
      ? view.screenSpace !== true
      : view.worldSpace !== false;
    const tileSize = Math.max(1, Number(view.tileSize) || this.tileSize);
    const headLift = Number.isFinite(view.headHeight)
      ? Number(view.headHeight)
      : this.headHeightTiles * tileSize;
    const offsetX = worldSpace ? 0 : -(camera.x || 0);
    const offsetY = worldSpace ? 0 : -(camera.y || 0);
    const boundsWidth = Number.isFinite(view.width) ? view.width : null;

    let drawn = 0;
    const ordered = [...this.bubbles.values()].sort((a, b) => a.seq - b.seq);
    for (const bubble of ordered) {
      const position = this.resolvePosition(bubble);
      if (!position) continue;

      const centerX = (position.x + 0.5) * tileSize + offsetX;
      const anchorY = (position.y + 1) * tileSize + offsetY - headLift;
      if (drawBubble(ctx, bubble, {
        centerX,
        footY: anchorY,
        maxWidth: this.maxWidth,
        boundsWidth
      })) {
        drawn += 1;
      }
    }
    return drawn;
  }

  /** World tile position for a bubble, preferring the live actor. */
  resolvePosition(bubble) {
    if (!bubble) return null;
    if (this.getActor) {
      const actor = this.getActor(bubble.actorRef ?? bubble.actorId);
      if (Number.isFinite(actor?.x) && Number.isFinite(actor?.y)) {
        return { x: actor.x, y: actor.y };
      }
    }
    if (Number.isFinite(bubble.x) && Number.isFinite(bubble.y)) {
      return { x: bubble.x, y: bubble.y };
    }
    return null;
  }

  #trim() {
    while (this.bubbles.size > this.maxBubbles) {
      const oldest = [...this.bubbles.values()].sort((a, b) => a.seq - b.seq)[0];
      if (!oldest) break;
      this.bubbles.delete(oldest.actorId);
    }
  }
}

export function createSpeechBubbles(options) {
  return new SpeechBubbles(options);
}

function drawBubble(ctx, bubble, { centerX, footY, maxWidth, boundsWidth }) {
  const measure = makeMeasure(ctx);
  const maxTextWidth = maxWidth - PADDING_X * 2;
  const lines = wrapText(bubble.text, maxTextWidth, measure);
  if (!lines.length) return false;

  const textWidth = Math.min(maxTextWidth, Math.max(...lines.map(measure)));
  const boxWidth = Math.min(maxWidth, Math.max(30, textWidth + PADDING_X * 2));
  const boxHeight = lines.length * LINE_HEIGHT + PADDING_Y * 2;
  const bottom = footY - HEAD_GAP;
  const top = bottom - boxHeight;
  let left = centerX - boxWidth / 2;
  if (boundsWidth != null) {
    left = Math.max(4, Math.min(boundsWidth - boxWidth - 4, left));
  }

  const fade = Math.min(1, bubble.remainingMs / 250);
  ctx.save();
  if (typeof ctx.globalAlpha === 'number') {
    ctx.globalAlpha *= Math.max(0, fade);
  }

  // Little tail from the bubble down toward the actor's head.
  ctx.beginPath();
  ctx.moveTo(centerX - 4, bottom - 1);
  ctx.lineTo(centerX + 4, bottom - 1);
  ctx.lineTo(centerX, bottom + TAIL_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = COLORS.tail;
  ctx.fill();

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(left, top, boxWidth, boxHeight, RADIUS);
  } else {
    ctx.rect(left, top, boxWidth, boxHeight);
  }
  ctx.fillStyle = COLORS.background;
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, left + boxWidth / 2, top + PADDING_Y + LINE_HEIGHT * (index + 0.5) + 0.5);
  }
  ctx.restore();
  return true;
}

function makeMeasure(ctx) {
  if (typeof ctx.measureText === 'function') {
    return text => ctx.measureText(text).width || 0;
  }
  return text => text.length * (FONT_SIZE * 0.56);
}

function wrapText(text, maxWidth, measure) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && current) lines.push(current);

  if (lines.length === 2) {
    const consumed = lines.join(' ');
    if (consumed.length < text.length) {
      lines[1] = ellipsize(`${lines[1]} ${text.slice(consumed.length).trim()}`.trim(), maxWidth, measure);
    } else {
      lines[1] = ellipsize(lines[1], maxWidth, measure);
    }
  }
  return lines.slice(0, 2).map(line => ellipsize(line, maxWidth, measure));
}

function ellipsize(text, maxWidth, measure) {
  let value = String(text);
  if (measure(value) <= maxWidth) return value;
  while (value.length > 1 && measure(`${value}…`) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value.trimEnd()}…`;
}

function resolveCamera(view) {
  if (Number.isFinite(view.camera?.x) && Number.isFinite(view.camera?.y)) {
    return view.camera;
  }
  if (Number.isFinite(view.x) && Number.isFinite(view.y)) return view;
  return { x: 0, y: 0 };
}

function normaliseText(value) {
  if (value == null) return '';
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= MAX_BUBBLE_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_BUBBLE_TEXT_LENGTH - 1).trimEnd()}…`;
}

function clampDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_BUBBLE_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, number));
}

function publicBubble(bubble) {
  return Object.freeze({
    actorId: bubble.actorId,
    text: bubble.text,
    key: bubble.key,
    durationMs: bubble.durationMs,
    remainingMs: Math.max(0, bubble.remainingMs),
    x: bubble.x,
    y: bubble.y,
    seq: bubble.seq
  });
}
