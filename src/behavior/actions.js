/**
 * Behavior action verbs.
 *
 * Actions are pure with respect to world state: they read `ctx.actor` / `ctx.target` and
 * request movement through injected helpers. They never write `actor.x` or `actor.y`.
 * The only teleport-like path is the opt-in `ctx.snapTo(actor, tile)` fallback used by
 * `followTarget` when its leash is exceeded; integration supplies it explicitly and it
 * is expected to respect the game's own collision/reservation rules.
 *
 * ctx = {
 *   actor, target, params, now, dtMs, elapsedMs, durationMs,
 *   memory, stateMemory, rng, blackboard,
 *   tryStep(actor, dx, dy, durationMs) -> boolean,
 *   findPath(actor, target, blocked) -> [{x,y}],
 *   face(actor, direction) -> void,
 *   select(name, params) -> actor | {x,y} | null,
 *   emit(type, detail) -> void,
 *   startGame({ game, actor, partner }) -> { ok, token } | boolean,
 *   gameStatus(token) -> { active, outcome },
 *   abortGame(token) -> void,
 *   resolveFriendship({ actor, target, interaction }) -> object,
 *   snapTo(actor, {x,y}) -> void,
 *   allowedGames: string[]
 * }
 *
 * Each action returns `{ done: boolean, reason?: string, next?: string }`.
 */

import { DOWN, RIGHT, UP, LEFT } from '../facing.js';

const DIRECTIONS = Object.freeze([
  { dx: 0, dy: 1, direction: DOWN },
  { dx: 1, dy: 0, direction: RIGHT },
  { dx: 0, dy: -1, direction: UP },
  { dx: -1, dy: 0, direction: LEFT }
]);

export const ACTION_NAMES = Object.freeze([
  'wait',
  'wanderStep',
  'seek',
  'followTarget',
  'faceTarget',
  'emote',
  'say',
  'startGame',
  'awaitGame',
  'resolveFriendship',
  'abort'
]);

export function getAction(name) {
  return ACTION_MAP[name] || null;
}

function wait(ctx) {
  return finishAfterDuration(ctx);
}

function wanderStep(ctx) {
  const { actor, stateMemory, params, now, rng } = ctx;
  if (!actor || actor.moving) return { done: false };
  if (stateMemory.nextStepAt == null) stateMemory.nextStepAt = now;
  if (now < stateMemory.nextStepAt) return { done: false };

  const interval = params.stepIntervalMs ?? 320;
  stateMemory.nextStepAt = now + interval;

  const directions = shuffled(DIRECTIONS, rng);
  if (params.preferForward && Number.isFinite(actor.direction)) {
    const index = directions.findIndex(item => item.direction === actor.direction);
    if (index > 0) directions.unshift(...directions.splice(index, 1));
  }

  for (const step of directions) {
    if (tryStep(ctx, step.dx, step.dy, params.stepDurationMs)) {
      stateMemory.blocked = false;
      return { done: false, moved: true };
    }
  }

  if (!stateMemory.blocked) {
    stateMemory.blocked = true;
    emit(ctx, 'wander.blocked', { actorId: actor.id });
  }
  return { done: false, moved: false, reason: 'blocked' };
}

function seek(ctx) {
  const { actor, target, stateMemory, params, now } = ctx;
  const point = entityPoint(target);
  if (!actor || !point) return { done: true, reason: 'no-target' };

  const tolerance = params.tolerance ?? 1;
  if (distance(actor, point) <= tolerance) return { done: true, reason: 'arrived' };
  if (actor.moving) return { done: false };

  if (stateMemory.nextStepAt == null) stateMemory.nextStepAt = now;
  if (now < stateMemory.nextStepAt) return { done: false };
  stateMemory.nextStepAt = now + (params.stepIntervalMs ?? 280);

  if (params.repathMs && stateMemory.path?.length && now < (stateMemory.repathAt ?? 0)) {
    // Keep the current path until the repath interval elapses.
  } else if (!stateMemory.path?.length) {
    stateMemory.path = nextPath(ctx, point, params);
    stateMemory.repathAt = now + (params.repathMs ?? 2500);
    stateMemory.failures = 0;
  }

  const next = stateMemory.path?.[0];
  if (!next) {
    if (tryStepToward(ctx, point, params)) return { done: false, moved: true };
    return { done: true, reason: 'unreachable' };
  }

  const dx = next.x - actor.x;
  const dy = next.y - actor.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    stateMemory.path = [];
    stateMemory.failures = (stateMemory.failures || 0) + 1;
    return { done: stateMemory.failures > 3, reason: stateMemory.failures > 3 ? 'unreachable' : undefined };
  }

  if (tryStep(ctx, dx, dy, params.stepDurationMs)) {
    stateMemory.path.shift();
    stateMemory.failures = 0;
    return { done: false, moved: true };
  }

  stateMemory.path = [];
  stateMemory.failures = (stateMemory.failures || 0) + 1;
  return { done: stateMemory.failures > 5, reason: stateMemory.failures > 5 ? 'blocked' : undefined };
}

function followTarget(ctx) {
  const { actor, stateMemory, params, now, rng } = ctx;
  const target = ctx.target || (typeof ctx.select === 'function' ? ctx.select('buddy') : null);
  const point = entityPoint(target);
  if (!actor || !point) return { done: true, reason: 'no-target' };

  if (stateMemory.nextStepAt == null) stateMemory.nextStepAt = now;
  if (stateMemory.nextRoamAt == null) stateMemory.nextRoamAt = now + (params.roamIntervalMs ?? 3000);
  if (params.stepDurationMs != null) stateMemory.stepDurationMs = params.stepDurationMs;

  const offset = params.offset || null;
  const desired = offset
    ? { x: clampTile(point.x + (offset.x || 0)), y: clampTile(point.y + (offset.y || 0)) }
    : point;

  const buddyDistance = distance(actor, point);
  const desiredDistance = distance(actor, desired);
  const settleDistance = offset ? 0.75 : (params.distance ?? 1.5);
  const leash = params.leash ?? 10;

  // Documented fallback: only when the integration supplies snapTo and the companion has
  // been left far behind. Never used for tile-by-tile movement.
  if (buddyDistance > leash && typeof ctx.snapTo === 'function') {
    ctx.snapTo(actor, desired);
    emit(ctx, 'follow.leash', { actorId: actor.id, targetId: target?.id ?? null });
    return { done: true, reason: 'leashed' };
  }

  const roamChance = params.roamChance ?? 0;
  if (roamChance > 0 && buddyDistance <= (params.distance ?? 1.5) + (params.roamRadius ?? 2) &&
      now >= stateMemory.nextRoamAt) {
    stateMemory.nextRoamAt = now + (params.roamIntervalMs ?? 3000);
    if (rng() < roamChance) {
      const step = shuffled(DIRECTIONS, rng)[0];
      if (tryStep(ctx, step.dx, step.dy, params.stepDurationMs)) {
        return { done: false, moved: true, roaming: true };
      }
    }
  }

  if (desiredDistance <= settleDistance) return { done: true, reason: 'settled' };
  if (actor.moving) return { done: false };
  if (now < stateMemory.nextStepAt) return { done: false };

  const stepInterval = params.stepIntervalMs ?? 700;
  stateMemory.nextStepAt = now + stepInterval;

  const dx = desired.x - actor.x;
  const dy = desired.y - actor.y;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  const primary = Math.abs(dx) >= Math.abs(dy)
    ? [{ dx: stepX, dy: 0 }, { dx: 0, dy: stepY }]
    : [{ dx: 0, dy: stepY }, { dx: stepX, dy: 0 }];

  for (const step of primary) {
    if ((step.dx || step.dy) && tryStep(ctx, step.dx, step.dy, params.stepDurationMs)) {
      return { done: false, moved: true };
    }
  }

  if (params.allowPath !== false && typeof ctx.findPath === 'function') {
    const path = nextPath(ctx, desired, params);
    const next = path[0];
    if (next) {
      const pdx = next.x - actor.x;
      const pdy = next.y - actor.y;
      if (Math.abs(pdx) + Math.abs(pdy) === 1 && tryStep(ctx, pdx, pdy, params.stepDurationMs)) {
        return { done: false, moved: true, pathing: true };
      }
    }
  }

  return { done: false, moved: false, reason: 'blocked' };
}

function faceTarget(ctx) {
  const { actor, target } = ctx;
  const point = entityPoint(target);
  if (!actor || !point) return { done: true, reason: 'no-target' };
  const dx = point.x - actor.x;
  const dy = point.y - actor.y;
  if (!dx && !dy) return { done: true, reason: 'same-tile' };
  const direction = Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? RIGHT : LEFT)
    : (dy > 0 ? DOWN : UP);
  if (typeof ctx.face === 'function') ctx.face(actor, direction);
  emit(ctx, 'face', { actorId: actor.id, direction });
  return { done: true, direction };
}

function emote(ctx) {
  const { actor, params, stateMemory } = ctx;
  if (!stateMemory.sent) {
    stateMemory.sent = true;
    emit(ctx, 'emote', { actorId: actor?.id ?? null, emote: params.emote || 'wave' });
  }
  return finishAfterDuration(ctx);
}

function say(ctx) {
  const { actor, params, stateMemory } = ctx;
  if (!stateMemory.sent) {
    stateMemory.sent = true;
    emit(ctx, 'say', {
      actorId: actor?.id ?? null,
      key: params.key || 'chat',
      text: params.text || '...'
    });
  }
  return finishAfterDuration(ctx);
}

function startGame(ctx) {
  const { actor, target, params, memory } = ctx;
  if (memory.gameStarted) return { done: true, reason: 'already-started' };
  const game = params.game;
  const allowed = ctx.allowedGames || [];
  if (!game || (allowed.length && !allowed.includes(game))) {
    emit(ctx, 'game.blocked', { actorId: actor?.id ?? null, game, reason: 'not-allowed' });
    return { done: true, reason: 'game-not-allowed' };
  }
  if (typeof ctx.startGame !== 'function') {
    return { done: true, reason: 'startGame-unavailable' };
  }

  const result = ctx.startGame({ game, actor, partner: target, participants: [actor?.id, target?.id] });
  const ok = result === true || result?.ok === true;
  memory.gameStarted = true;
  memory.gameToken = result?.token ?? result?.session ?? null;
  emit(ctx, 'game.start', {
    actorId: actor?.id ?? null,
    partnerId: target?.id ?? null,
    game,
    ok,
    reason: result?.reason ?? null
  });
  return { done: true, reason: ok ? 'started' : 'game-unavailable' };
}

function awaitGame(ctx) {
  const { actor, target, params, memory, now } = ctx;
  const token = memory.gameToken;
  if (!token) return { done: true, reason: 'no-game' };
  if (memory.gameTimeoutAt == null) memory.gameTimeoutAt = now + (params.timeoutMs ?? 20000);

  if (typeof ctx.gameStatus !== 'function') return { done: true, reason: 'no-status' };

  const status = ctx.gameStatus(token) || {};
  const active = status.active === true || status.phase === 'playing' || status.phase === 'ready';
  if (active) {
    if (now > memory.gameTimeoutAt) {
      ctx.abortGame?.(token);
      emit(ctx, 'game.timeout', { actorId: actor?.id ?? null, game: params.game || null });
      return { done: true, reason: 'timeout' };
    }
    return { done: false };
  }

  emit(ctx, 'game.end', {
    actorId: actor?.id ?? null,
    partnerId: target?.id ?? null,
    outcome: status.outcome || 'complete'
  });
  return { done: true, reason: status.outcome || 'ended' };
}

function resolveFriendship(ctx) {
  const { actor, target, params, stateMemory } = ctx;
  if (stateMemory.resolved) return { done: true, reason: 'already-resolved' };
  if (!target) return { done: true, reason: 'no-target' };

  const interaction = params.interaction || 'greet';
  const result = typeof ctx.resolveFriendship === 'function'
    ? ctx.resolveFriendship({ actor, target, interaction })
    : { ok: false, friends: false, reason: 'unavailable' };

  stateMemory.resolved = true;
  stateMemory.result = result;
  emit(ctx, 'friendship.resolve', {
    actorId: actor?.id ?? null,
    targetId: target.id ?? null,
    interaction,
    friends: result?.friends === true,
    reason: result?.reason ?? null
  });
  return { done: true, reason: result?.friends ? 'friends' : (result?.reason || 'pending') };
}

function abort(ctx) {
  const { actor, target, params, memory } = ctx;
  if (memory.gameToken) ctx.abortGame?.(memory.gameToken);
  emit(ctx, 'abort', {
    actorId: actor?.id ?? null,
    targetId: target?.id ?? null,
    reason: params.reason || 'abort'
  });
  return { done: true, reason: params.reason || 'abort' };
}

const ACTION_MAP = Object.freeze({
  wait,
  wanderStep,
  seek,
  followTarget,
  faceTarget,
  emote,
  say,
  startGame,
  awaitGame,
  resolveFriendship,
  abort
});

export const actions = ACTION_MAP;

function finishAfterDuration(ctx) {
  const duration = Math.max(0, Number(ctx.durationMs) || 0);
  if (duration <= 0) return { done: true };
  return { done: ctx.elapsedMs >= duration };
}

function tryStep(ctx, dx, dy, durationMs) {
  if (typeof ctx.tryStep !== 'function') return false;
  return ctx.tryStep(ctx.actor, dx, dy, durationMs) === true;
}

function tryStepToward(ctx, point, params) {
  const { actor } = ctx;
  const dx = point.x - actor.x;
  const dy = point.y - actor.y;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return (stepX && tryStep(ctx, stepX, 0, params.stepDurationMs)) ||
      (stepY && tryStep(ctx, 0, stepY, params.stepDurationMs)) || false;
  }
  return (stepY && tryStep(ctx, 0, stepY, params.stepDurationMs)) ||
    (stepX && tryStep(ctx, stepX, 0, params.stepDurationMs)) || false;
}

function nextPath(ctx, point, params) {
  if (typeof ctx.findPath !== 'function') return [];
  const path = ctx.findPath(ctx.actor, point, params.blocked || null) || [];
  return path
    .filter(tile => tile && Number.isFinite(tile.x) && Number.isFinite(tile.y))
    .filter(tile => !(tile.x === ctx.actor.x && tile.y === ctx.actor.y));
}

function emit(ctx, type, detail) {
  if (typeof ctx.emit === 'function') ctx.emit(type, detail);
}

function entityPoint(value) {
  if (value == null) return null;
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: value.x, y: value.y };
  return null;
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return Infinity;
  }
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function shuffle(array, rng) {
  const copy = array.slice();
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// Kept as a named helper so tests can replace Math.random with a seeded generator.
function shuffled(array, rng) {
  return shuffle(array, typeof rng === 'function' ? rng : Math.random);
}

function clampTile(value) {
  return Math.max(0, Math.round(value));
}
