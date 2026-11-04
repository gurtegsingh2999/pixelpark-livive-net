import {
  WORLD_SIZE,
  decodeTerrain,
  encodeTerrain,
  isWalkable,
  typeAt,
  findOpenTile
} from '../world.js';
import { reservationAtTile } from '../characters.js';
import { directionForStep } from '../facing.js';

const TELEPORT_DISTANCE = 3;

function cloneActor(actor) {
  return {
    id: actor.id,
    kind: actor.kind,
    name: actor.name || 'friend',
    recipe: actor.recipe || null,
    vibe: actor.vibe || '',
    voice: actor.voice,
    buddyId: actor.buddyId || null,
    ownerIsPlayer: actor.ownerIsPlayer === true,
    x: actor.x,
    y: actor.y,
    toX: actor.x,
    toY: actor.y,
    moving: false,
    direction: Number(actor.direction) || 0
  };
}

function inPark(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y < WORLD_SIZE && y >= 0 && x < WORLD_SIZE;
}

/**
 * Pure two-player room. The host tab is the only caller.
 * Tile claims follow `reservationAtTile`: the tile you stand on and the tile
 * you are walking onto are both taken.
 */
export function createRoom({ worldSeed, terrain, actors = [], wander = true } = {}) {
  const encoded = typeof terrain === 'string' ? terrain : encodeTerrain(terrain);
  const grid = typeof terrain === 'string' ? decodeTerrain(terrain) : terrain;
  if (!grid || encoded.length !== WORLD_SIZE * WORLD_SIZE) {
    throw new TypeError('createRoom requires a 64 by 64 terrain');
  }

  const roster = new Map();
  for (const actor of actors) {
    if (!actor?.id || !inPark(actor.x, actor.y)) continue;
    roster.set(actor.id, cloneActor(actor));
  }
  if (!roster.has('host')) {
    throw new TypeError('createRoom requires a host actor');
  }

  const locks = new Map();
  let guestJoined = false;

  function blocks(mover, obstacle) {
    if (!mover || !obstacle || mover === obstacle) return false;
    if (obstacle.kind === 'companion' && obstacle.ownerIsPlayer) return false;
    if (mover.kind === 'companion' && mover.ownerIsPlayer) return false;
    if (mover.kind === 'npc' && obstacle.kind === 'companion') return false;
    return true;
  }

  function obstacles(mover) {
    const list = [];
    for (const actor of roster.values()) {
      if (blocks(mover, actor)) list.push(actor);
    }
    return list;
  }

  function occupiedKeys() {
    const taken = new Set();
    for (const actor of roster.values()) {
      taken.add(`${actor.x},${actor.y}`);
      if (actor.moving) taken.add(`${actor.toX},${actor.toY}`);
    }
    return taken;
  }

  function settle(actor) {
    if (!actor?.moving) return;
    actor.x = actor.toX;
    actor.y = actor.toY;
    actor.moving = false;
  }

  function reject(actor, reason) {
    return { ok: false, reason, x: actor.x, y: actor.y, toX: actor.x, toY: actor.y, dir: actor.direction };
  }

  function commit(actor, toX, toY) {
    actor.moving = true;
    actor.toX = toX;
    actor.toY = toY;
    actor.direction = directionForStep(toX - actor.x, toY - actor.y);
    return {
      ok: true,
      reason: null,
      x: actor.x,
      y: actor.y,
      toX,
      toY,
      dir: actor.direction
    };
  }

  function teleportLanding(actor, dx, dy) {
    let landing = null;
    const others = obstacles(actor);
    for (let distance = 1; distance <= TELEPORT_DISTANCE; distance++) {
      const tx = actor.x + dx * distance;
      const ty = actor.y + dy * distance;
      if (!inPark(tx, ty)) break;
      if (reservationAtTile(others, tx, ty)) continue;
      landing = { x: tx, y: ty, distance };
    }
    return landing;
  }

  return {
    get worldSeed() {
      return worldSeed;
    },
    get terrain() {
      return grid;
    },
    get guestJoined() {
      return guestJoined;
    },
    actor(id) {
      const actor = roster.get(id);
      return actor ? { ...actor } : null;
    },
    actors() {
      return [...roster.values()].map(actor => ({ ...actor }));
    },
    join({ name, recipe, companion } = {}) {
      if (guestJoined) return { ok: false, reason: 'full' };
      const host = roster.get('host');
      const spawn = findOpenTile(grid, { x: host.x, y: host.y }, occupiedKeys(), 1);
      roster.set('guest', cloneActor({
        id: 'guest',
        kind: 'player',
        name: name || 'friend',
        recipe,
        x: spawn.x,
        y: spawn.y
      }));
      let placed = null;
      if (companion?.id && companion.recipe) {
        const spot = findOpenTile(grid, spawn, occupiedKeys(), 1);
        roster.set(companion.id, cloneActor({
          id: companion.id,
          kind: 'companion',
          name: companion.name || 'buddy',
          recipe: companion.recipe,
          buddyId: 'guest',
          ownerIsPlayer: true,
          x: spot.x,
          y: spot.y
        }));
        placed = { id: companion.id, name: companion.name || 'buddy', recipe: companion.recipe, x: spot.x, y: spot.y };
      }
      guestJoined = true;
      return { ok: true, spawn: { x: spawn.x, y: spawn.y }, companion: placed };
    },
    step(id, { fromX, fromY, dx, dy, teleport = false } = {}) {
      const actor = roster.get(id);
      if (!actor || actor.kind !== 'player') return { ok: false, reason: 'who', x: 0, y: 0 };
      if (actor.moving) {
        if (fromX === actor.toX && fromY === actor.toY) settle(actor);
        else return reject(actor, 'origin');
      }
      if (fromX !== actor.x || fromY !== actor.y) return reject(actor, 'origin');
      const sx = Math.sign(Number(dx)) || 0;
      const sy = Math.sign(Number(dy)) || 0;
      if (Math.abs(sx) + Math.abs(sy) !== 1) return reject(actor, 'direction');

      if (teleport) {
        const landing = teleportLanding(actor, sx, sy);
        if (!landing) return reject(actor, 'blocked');
        return commit(actor, landing.x, landing.y);
      }

      const nx = actor.x + sx;
      const ny = actor.y + sy;
      if (!isWalkable(typeAt(grid, nx, ny))) return reject(actor, 'terrain');
      if (reservationAtTile(obstacles(actor), nx, ny)) return reject(actor, 'reserved');
      return commit(actor, nx, ny);
    },
    pose(update, fromRole) {
      const actor = roster.get(update?.id);
      if (!actor || actor.kind === 'player') return { ok: false, reason: 'who' };
      const guestOwned = actor.buddyId === 'guest';
      if (guestOwned && fromRole !== 'guest') return { ok: false, reason: 'role' };
      if (!guestOwned && fromRole !== 'host') return { ok: false, reason: 'role' };
      const x = update.x;
      const y = update.y;
      const toX = update.toX;
      const toY = update.toY;
      if (![x, y, toX, toY].every(inPark)) return { ok: false, reason: 'tile' };
      actor.x = x;
      actor.y = y;
      actor.toX = toX;
      actor.toY = toY;
      actor.moving = update.moving !== false && (x !== toX || y !== toY);
      actor.direction = Number.isInteger(update.dir) ? update.dir : actor.direction;
      if (!actor.moving) {
        actor.x = toX;
        actor.y = toY;
      }
      return { ok: true };
    },
    finish(id) {
      settle(roster.get(id));
      return this.actor(id);
    },
    lock(npcId, by) {
      const npc = roster.get(npcId);
      if (!npc || npc.kind !== 'npc') return { ok: false, reason: 'who' };
      const holder = locks.get(npcId);
      if (holder && holder !== by) return { ok: false, reason: 'busy' };
      locks.set(npcId, by);
      return { ok: true };
    },
    unlock(npcId, by) {
      if (locks.get(npcId) === by) locks.delete(npcId);
      return { ok: true };
    },
    isLocked(npcId) {
      return locks.get(npcId) || null;
    },
    snapshot() {
      const host = roster.get('host');
      const npcs = [];
      const companions = [];
      for (const actor of roster.values()) {
        if (actor.kind === 'npc') {
          npcs.push({
            id: actor.id,
            name: actor.name,
            recipe: actor.recipe,
            vibe: actor.vibe,
            voice: actor.voice,
            x: actor.x,
            y: actor.y,
            direction: actor.direction
          });
        } else if (actor.kind === 'companion') {
          companions.push({
            id: actor.id,
            name: actor.name,
            recipe: actor.recipe,
            buddyId: actor.buddyId,
            x: actor.x,
            y: actor.y,
            direction: actor.direction
          });
        }
      }
      return {
        worldSeed,
        terrain: encoded,
        wander,
        host: {
          name: host.name,
          recipe: host.recipe,
          x: host.x,
          y: host.y,
          direction: host.direction
        },
        npcs,
        companions
      };
    }
  };
}

/** Build the host actor list from a live park view. Buddy ids use wire roles. */
export function parkActors(view) {
  const player = view.player;
  const actors = [{
    id: 'host',
    kind: 'player',
    name: player.name,
    recipe: player.recipe,
    x: player.moving ? player.toX : player.x,
    y: player.moving ? player.toY : player.y,
    direction: player.direction || 0
  }];
  for (const npc of view.npcs || []) {
    actors.push({
      id: npc.id,
      kind: 'npc',
      name: npc.name,
      recipe: npc.recipe,
      vibe: npc.vibe || '',
      voice: npc.voice,
      x: npc.moving ? npc.toX : npc.x,
      y: npc.moving ? npc.toY : npc.y,
      direction: npc.direction || 0
    });
  }
  for (const comp of view.companions || []) {
    if (comp.remoteOwned) continue;
    const buddyIsPlayer = comp.buddyId === 'player' || comp.buddyId === player.id || comp.ownerIsPlayer;
    actors.push({
      id: comp.id,
      kind: 'companion',
      name: comp.name,
      recipe: comp.recipe,
      buddyId: buddyIsPlayer ? 'host' : comp.buddyId,
      ownerIsPlayer: buddyIsPlayer,
      x: comp.moving ? comp.toX : comp.x,
      y: comp.moving ? comp.toY : comp.y,
      direction: comp.direction || 0
    });
  }
  return actors;
}
