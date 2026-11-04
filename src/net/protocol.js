import netConfig from '../../data/net_config.json' with { type: 'json' };

export const NET_CONFIG = Object.freeze({ ...netConfig });

const SNAPSHOT_TYPES = new Set(['welcome']);

export function shouldPersistSave(role) {
  return role !== 'guest';
}

export function clampText(value, max) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max).trimEnd();
}

export function clampSay(value) {
  return clampText(value, NET_CONFIG.sayMaxLength);
}

export function clampName(value) {
  return clampText(value, NET_CONFIG.nameMaxLength) || 'friend';
}

export function sanitizeRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const seed = typeof recipe.seed === 'string' ? recipe.seed.slice(0, 80) : '';
  if (!seed) return null;
  const result = { seed };
  if (recipe.isCompanion === true) result.isCompanion = true;
  if (typeof recipe.style === 'string' && recipe.style) {
    result.style = recipe.style.slice(0, 40);
  }
  if (recipe.look && typeof recipe.look === 'object') {
    const look = {};
    for (const [key, value] of Object.entries(recipe.look)) {
      if (Object.keys(look).length >= 24) break;
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      if (!key || key.length > 40 || value.length > 40) continue;
      look[key] = value;
    }
    if (Object.keys(look).length) result.look = look;
  }
  return result;
}

function tile(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 63) return null;
  return number;
}

function unitAxis(dx, dy) {
  const x = Number(dx);
  const y = Number(dy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sx = Math.sign(x);
  const sy = Math.sign(y);
  if (Math.abs(sx) + Math.abs(sy) !== 1) return null;
  return { dx: sx, dy: sy };
}

function duration(value, fallback = 0.18) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0.05, Math.min(1, number));
}

function arriveAt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0.05, Math.min(1, number));
}

/**
 * Keep one gameplay message inside the configured byte cap.
 * Snapshots are allowed to be larger and are split by `frameMessage`.
 */
export function messageByteLength(message) {
  try {
    return JSON.stringify(message).length;
  } catch {
    return Infinity;
  }
}

export function withinMessageLimit(message) {
  const size = messageByteLength(message);
  const cap = SNAPSHOT_TYPES.has(message?.t)
    ? NET_CONFIG.snapshotMaxBytes
    : NET_CONFIG.maxMessageBytes;
  return size <= cap;
}

let chunkSequence = 0;

export function frameMessage(message, chunkBytes = NET_CONFIG.chunkBytes) {
  if (!message || typeof message !== 'object') return [];
  const json = JSON.stringify(message);
  const limit = SNAPSHOT_TYPES.has(message.t)
    ? NET_CONFIG.snapshotMaxBytes
    : NET_CONFIG.maxMessageBytes;
  if (json.length > limit) return [];
  if (json.length <= chunkBytes) return [message];
  const count = Math.ceil(json.length / chunkBytes);
  chunkSequence += 1;
  const id = `c${chunkSequence.toString(36)}${json.length.toString(36)}`;
  const frames = [];
  for (let index = 0; index < count; index++) {
    frames.push({
      t: 'chunk',
      id,
      i: index,
      n: count,
      d: json.slice(index * chunkBytes, (index + 1) * chunkBytes)
    });
  }
  return frames;
}

export function createAssembler() {
  const groups = new Map();
  return function push(frame) {
    if (!frame || typeof frame !== 'object') return null;
    if (frame.t !== 'chunk') return frame;
    const id = typeof frame.id === 'string' ? frame.id : '';
    const count = Number(frame.n);
    const index = Number(frame.i);
    if (!id || !Number.isInteger(count) || count < 2 || count > 64) return null;
    if (!Number.isInteger(index) || index < 0 || index >= count) return null;
    if (typeof frame.d !== 'string') return null;
    let group = groups.get(id);
    if (!group) {
      group = { n: count, parts: [] };
      groups.set(id, group);
    }
    if (group.n !== count) return null;
    group.parts[index] = frame.d;
    if (group.parts.filter(part => typeof part === 'string').length < count) return null;
    groups.delete(id);
    try {
      return JSON.parse(group.parts.join(''));
    } catch {
      return null;
    }
  };
}

export function createRateWindow({ limit = NET_CONFIG.maxMessagesPerSec, horizonMs = 1000 } = {}) {
  const stamps = [];
  const cap = Math.max(1, Number(limit) || 1);
  return {
    allow(at) {
      const time = Number(at);
      if (!Number.isFinite(time)) return false;
      while (stamps.length && time - stamps[0] >= horizonMs) stamps.shift();
      if (stamps.length >= cap) return false;
      stamps.push(time);
      return true;
    }
  };
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text) {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const base64 = String(text).replaceAll('-', '+').replaceAll('_', '/') + pad;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeSignalPlain(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return `pp1.${bytesToBase64Url(bytes)}`;
}

export function decodeSignalPlain(code) {
  const text = String(code ?? '').trim();
  if (!text.startsWith('pp1.')) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(text.slice(4)));
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function sanitizeCompanion(companion) {
  if (!companion || typeof companion !== 'object') return null;
  const recipe = sanitizeRecipe(companion.recipe);
  const id = typeof companion.id === 'string' ? companion.id.slice(0, 80) : '';
  if (!recipe || !id) return null;
  return {
    id,
    name: clampName(companion.name || 'buddy'),
    recipe
  };
}

/**
 * Drop anything the room does not understand. Returns null for junk.
 * @param {object} input
 */
export function sanitizeMessage(input) {
  if (!input || typeof input !== 'object' || typeof input.t !== 'string') return null;
  switch (input.t) {
    case 'join': {
      const recipe = sanitizeRecipe(input.recipe);
      if (!recipe) return null;
      return {
        t: 'join',
        name: clampName(input.name),
        recipe,
        companion: sanitizeCompanion(input.companion)
      };
    }
    case 'step': {
      const fromX = tile(input.fromX);
      const fromY = tile(input.fromY);
      const axis = unitAxis(input.dx, input.dy);
      const seq = Number(input.seq);
      if (fromX == null || fromY == null || !axis) return null;
      if (!Number.isInteger(seq) || seq < 1 || seq > 1_000_000) return null;
      return {
        t: 'step',
        seq,
        fromX,
        fromY,
        dx: axis.dx,
        dy: axis.dy,
        teleport: input.teleport === true,
        dur: duration(input.dur),
        motion: input.motion === 'teleport' ? 'teleport' : null,
        arrive: arriveAt(input.arrive)
      };
    }
    case 'say':
      return { t: 'say', text: clampSay(input.text) };
    case 'lock':
    case 'unlock': {
      const id = typeof input.id === 'string' ? input.id.slice(0, 80) : '';
      if (!id) return null;
      return { t: input.t, id };
    }
    case 'ping':
    case 'pong': {
      const n = Number(input.n);
      const at = Number(input.at);
      if (!Number.isInteger(n) || !Number.isFinite(at)) return null;
      const message = { t: input.t, n, at };
      if (input.t === 'pong') {
        const replyAt = Number(input.replyAt);
        if (!Number.isFinite(replyAt)) return null;
        message.replyAt = replyAt;
      }
      return message;
    }
    case 'poses': {
      if (!Array.isArray(input.actors) || input.actors.length > 80) return null;
      const actors = [];
      for (const actor of input.actors) {
        const pose = sanitizePose(actor);
        if (pose) actors.push(pose);
      }
      if (!actors.length) return null;
      return { t: 'poses', actors };
    }
    case 'bye':
    case 'full':
      return { t: input.t };
    case 'welcome':
      return sanitizeWelcome(input);
    case 'step-ok':
    case 'step-no':
    case 'move':
      return sanitizeStepResult(input);
    case 'lock-result': {
      const id = typeof input.id === 'string' ? input.id.slice(0, 80) : '';
      if (!id) return null;
      return { t: 'lock-result', id, ok: input.ok === true, by: input.by === 'guest' ? 'guest' : 'host' };
    }
    default:
      return null;
  }
}

function sanitizePose(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const id = typeof actor.id === 'string' ? actor.id.slice(0, 80) : '';
  const x = tile(actor.x);
  const y = tile(actor.y);
  const toX = tile(actor.toX);
  const toY = tile(actor.toY);
  if (!id || x == null || y == null || toX == null || toY == null) return null;
  const dir = Number(actor.dir);
  return {
    id,
    x,
    y,
    toX,
    toY,
    dir: Number.isInteger(dir) ? Math.max(0, Math.min(3, dir)) : 0,
    dur: duration(actor.dur, 0.28),
    moving: actor.moving !== false && (x !== toX || y !== toY),
    motion: actor.motion === 'teleport' ? 'teleport' : null,
    arrive: arriveAt(actor.arrive)
  };
}

function sanitizeStepResult(input) {
  const x = tile(input.x);
  const y = tile(input.y);
  if (x == null || y == null) return null;
  const toX = tile(input.toX);
  const toY = tile(input.toY);
  const message = {
    t: input.t,
    x,
    y,
    toX: toX == null ? x : toX,
    toY: toY == null ? y : toY,
    dir: Number.isInteger(Number(input.dir)) ? Math.max(0, Math.min(3, Number(input.dir))) : 0,
    dur: duration(input.dur),
    at: Number.isFinite(Number(input.at)) ? Number(input.at) : 0,
    motion: input.motion === 'teleport' ? 'teleport' : null,
    arrive: arriveAt(input.arrive),
    moving: input.moving !== false
  };
  if (input.t === 'step-ok' || input.t === 'step-no') {
    const seq = Number(input.seq);
    if (!Number.isInteger(seq)) return null;
    message.seq = seq;
  }
  if (input.t === 'move' || input.t === 'step-ok') {
    message.id = input.id === 'guest' ? 'guest' : 'host';
  }
  if (input.t === 'step-no') message.moving = false;
  return message;
}

function sanitizeWelcome(input) {
  if (!input.snapshot || typeof input.snapshot !== 'object') return null;
  const snapshot = input.snapshot;
  if (typeof snapshot.worldSeed !== 'string' || typeof snapshot.terrain !== 'string') return null;
  if (snapshot.terrain.length !== 64 * 64) return null;
  const spawnX = tile(input.spawn?.x);
  const spawnY = tile(input.spawn?.y);
  if (spawnX == null || spawnY == null) return null;
  return {
    t: 'welcome',
    hostNow: Number(input.hostNow) || 0,
    spawn: { x: spawnX, y: spawnY },
    companion: input.companion && tile(input.companion.x) != null && tile(input.companion.y) != null
      ? {
        id: typeof input.companion.id === 'string' ? input.companion.id.slice(0, 80) : '',
        x: tile(input.companion.x),
        y: tile(input.companion.y)
      }
      : null,
    snapshot: {
      worldSeed: snapshot.worldSeed.slice(0, 80),
      terrain: snapshot.terrain,
      wander: snapshot.wander !== false,
      host: {
        name: clampName(snapshot.host?.name),
        recipe: sanitizeRecipe(snapshot.host?.recipe),
        x: tile(snapshot.host?.x) ?? 0,
        y: tile(snapshot.host?.y) ?? 0,
        direction: Number(snapshot.host?.direction) || 0
      },
      npcs: Array.isArray(snapshot.npcs) ? snapshot.npcs.slice(0, 80).map(sanitizeActor).filter(Boolean) : [],
      companions: Array.isArray(snapshot.companions)
        ? snapshot.companions.slice(0, 120).map(sanitizeActor).filter(Boolean)
        : []
    }
  };
}

function sanitizeActor(actor) {
  if (!actor || typeof actor !== 'object') return null;
  const id = typeof actor.id === 'string' ? actor.id.slice(0, 80) : '';
  const x = tile(actor.x);
  const y = tile(actor.y);
  if (!id || x == null || y == null) return null;
  const recipe = sanitizeRecipe(actor.recipe);
  if (!recipe) return null;
  return {
    id,
    name: clampName(actor.name),
    recipe,
    vibe: typeof actor.vibe === 'string' ? actor.vibe.slice(0, 160) : '',
    voice: typeof actor.voice === 'string' ? actor.voice.slice(0, 40) : undefined,
    buddyId: typeof actor.buddyId === 'string' ? actor.buddyId.slice(0, 80) : undefined,
    x,
    y,
    direction: Number(actor.direction) || 0
  };
}

/**
 * Turn a host-stamped event into a local animation clock.
 * Before the first ping lands, play the step from the moment it arrives.
 */
export function motionFromMessage(message, { localNow = 0, offset = 0, synced = false, fallbackDuration = 0.18 } = {}) {
  const x = tile(message?.x) ?? 0;
  const y = tile(message?.y) ?? 0;
  const toX = tile(message?.toX) ?? x;
  const toY = tile(message?.toY) ?? y;
  const dur = duration(message?.dur, fallbackDuration);
  const wantsMove = message?.moving !== false && (x !== toX || y !== toY);
  let elapsed = 0;
  if (wantsMove && synced) {
    const start = Number(message.at) - Number(offset);
    elapsed = Math.max(0, (Number(localNow) - start) / 1000);
  }
  const moving = wantsMove && elapsed < dur;
  return {
    x: moving ? x : toX,
    y: moving ? y : toY,
    toX,
    toY,
    direction: Number.isInteger(Number(message?.dir)) ? Number(message.dir) : 0,
    duration: dur,
    elapsed: moving ? elapsed : 0,
    moving,
    motion: message?.motion === 'teleport' ? 'teleport' : null,
    arrive: arriveAt(message?.arrive)
  };
}
