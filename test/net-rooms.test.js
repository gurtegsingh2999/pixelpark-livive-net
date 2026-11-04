import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom } from '../src/net/room.js';
import { createHostSession, createGuestSession } from '../src/net/session.js';
import { serializeSave } from '../src/storage.js';
import { encodeTerrain } from '../src/world.js';

function grassGrid() {
  return Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
}

function parkRoom(extra = {}) {
  const grid = grassGrid();
  if (extra.water) grid[extra.water.y][extra.water.x] = 'water';
  return createRoom({
    worldSeed: 'fern-test',
    terrain: grid,
    actors: [
      {
        id: 'host',
        kind: 'player',
        name: 'Ada',
        recipe: { seed: 'ada', look: { hair: 'short' } },
        x: 10,
        y: 10
      },
      {
        id: 'npc-1',
        kind: 'npc',
        name: 'Pip',
        recipe: { seed: 'pip', look: {} },
        x: 14,
        y: 10
      },
      {
        id: 'comp-host',
        kind: 'companion',
        name: 'Moss',
        recipe: { seed: 'moss', style: 'dog' },
        buddyId: 'host',
        ownerIsPlayer: true,
        x: 10,
        y: 11
      },
      ...(extra.actors || [])
    ]
  });
}

const guestLook = {
  name: 'Bea',
  recipe: { seed: 'bea', look: { hair: 'long' } },
  companion: { id: 'comp-guest', name: 'Dot', recipe: { seed: 'dot', style: 'cat' } }
};

test('a room holds two players and refuses a third', () => {
  const room = parkRoom();
  const first = room.join(guestLook);
  assert.equal(first.ok, true);
  assert.notDeepEqual(first.spawn, { x: 10, y: 10 });
  assert.ok(first.companion);
  const second = room.join({ ...guestLook, name: 'Cy' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'full');
});

test('bad steps stay put: water, sideways, and a stale origin', () => {
  const room = parkRoom({ water: { x: 11, y: 10 } });
  const water = room.step('host', { fromX: 10, fromY: 10, dx: 1, dy: 0 });
  assert.equal(water.ok, false);
  assert.equal(water.reason, 'terrain');
  assert.equal(room.actor('host').x, 10);

  const diagonal = room.step('host', { fromX: 10, fromY: 10, dx: 1, dy: 1 });
  assert.equal(diagonal.reason, 'direction');

  const moved = room.step('host', { fromX: 10, fromY: 10, dx: 0, dy: -1 });
  assert.equal(moved.ok, true);
  const stale = room.step('host', { fromX: 10, fromY: 10, dx: -1, dy: 0 });
  assert.equal(stale.reason, 'origin');
  assert.equal(stale.x, 10);
  assert.equal(stale.y, 10);
});

test('two players cannot claim the same tile', () => {
  const room = parkRoom();
  const joined = room.join({ name: 'Bea', recipe: { seed: 'bea', look: {} } });
  const guest = room.actor('guest');
  const towardGuest = {
    fromX: 10,
    fromY: 10,
    dx: Math.sign(guest.x - 10),
    dy: Math.sign(guest.y - 10)
  };
  // Walk the host onto the guest if they spawned on a neighbour tile.
  if (Math.abs(towardGuest.dx) + Math.abs(towardGuest.dy) === 1) {
    const clash = room.step('host', towardGuest);
    assert.equal(clash.ok, false);
    assert.equal(clash.reason, 'reserved');
  } else {
    room.step('guest', { fromX: guest.x, fromY: guest.y, dx: Math.sign(10 - guest.x) || 0, dy: 0 });
  }
  const host = room.actor('host');
  const other = room.actor('guest');
  assert.ok(host.x !== other.x || host.y !== other.y);
  assert.equal(joined.ok, true);
});

test('the first accepted step wins when both players want one tile', () => {
  const room = createRoom({
    worldSeed: 'fern-test',
    terrain: grassGrid(),
    actors: [
      { id: 'host', kind: 'player', name: 'Ada', recipe: { seed: 'ada' }, x: 10, y: 10 }
    ]
  });
  const joined = room.join({ name: 'Bea', recipe: { seed: 'bea', look: {} } });
  assert.deepEqual(joined.spawn, { x: 10, y: 11 });
  const east = room.step('host', { fromX: 10, fromY: 10, dx: 1, dy: 0 });
  assert.equal(east.ok, true);
  room.finish('host');
  const hostClaim = room.step('host', { fromX: 11, fromY: 10, dx: 0, dy: 1 });
  assert.equal(hostClaim.ok, true);
  assert.deepEqual({ x: hostClaim.toX, y: hostClaim.toY }, { x: 11, y: 11 });
  const guestClaim = room.step('guest', { fromX: 10, fromY: 11, dx: 1, dy: 0 });
  assert.equal(guestClaim.ok, false);
  assert.equal(guestClaim.reason, 'reserved');
});

test('teleport lands up to 3 tiles and skips a reserved tile', () => {
  const grid = grassGrid();
  grid[10][11] = 'water';
  const room = createRoom({
    worldSeed: 'fern-test',
    terrain: grid,
    actors: [
      { id: 'host', kind: 'player', name: 'Ada', recipe: { seed: 'ada' }, x: 10, y: 10 },
      { id: 'npc-1', kind: 'npc', name: 'Pip', recipe: { seed: 'pip' }, x: 12, y: 10 }
    ]
  });
  const hop = room.step('host', { fromX: 10, fromY: 10, dx: 1, dy: 0, teleport: true });
  assert.equal(hop.ok, true);
  assert.equal(hop.toX, 13);
  assert.equal(hop.toY, 10);
  const blocked = createRoom({
    worldSeed: 'fern-test',
    terrain: grassGrid(),
    actors: [
      { id: 'host', kind: 'player', name: 'Ada', recipe: { seed: 'ada' }, x: 4, y: 4 },
      { id: 'npc-1', kind: 'npc', name: 'Pip', recipe: { seed: 'pip' }, x: 5, y: 4 },
      { id: 'npc-2', kind: 'npc', name: 'Quin', recipe: { seed: 'quin' }, x: 6, y: 4 },
      { id: 'npc-3', kind: 'npc', name: 'Rex', recipe: { seed: 'rex' }, x: 7, y: 4 }
    ]
  });
  const stuck = blocked.step('host', { fromX: 4, fromY: 4, dx: 1, dy: 0, teleport: true });
  assert.equal(stuck.ok, false);
  assert.equal(stuck.reason, 'blocked');
});

test('an npc pose reserves the destination tile', () => {
  const room = parkRoom();
  const posed = room.pose({
    id: 'npc-1',
    x: 14,
    y: 10,
    toX: 13,
    toY: 10,
    dir: 3,
    moving: true
  }, 'host');
  assert.equal(posed.ok, true);
  const intoPath = room.step('host', { fromX: 10, fromY: 10, dx: 1, dy: 0 });
  assert.equal(intoPath.ok, true);
  room.finish('host');
  const ontoDest = room.step('host', { fromX: 11, fromY: 10, dx: 1, dy: 0 });
  assert.equal(ontoDest.ok, true);
  room.finish('host');
  const clash = room.step('host', { fromX: 12, fromY: 10, dx: 1, dy: 0 });
  assert.equal(clash.ok, false);
  assert.equal(clash.reason, 'reserved');
  assert.equal(room.pose({ id: 'npc-1', x: 1, y: 1, toX: 1, toY: 2, moving: true }, 'guest').reason, 'role');
});

test('dialogue lock is per neighbour', () => {
  const room = parkRoom({
    actors: [{ id: 'npc-2', kind: 'npc', name: 'Quin', recipe: { seed: 'quin' }, x: 20, y: 20 }]
  });
  room.join({ name: 'Bea', recipe: { seed: 'bea', look: {} } });
  assert.equal(room.lock('npc-1', 'host').ok, true);
  assert.equal(room.lock('npc-1', 'guest').reason, 'busy');
  assert.equal(room.lock('npc-2', 'guest').ok, true);
  room.unlock('npc-1', 'guest');
  assert.equal(room.isLocked('npc-1'), 'host');
  room.unlock('npc-1', 'host');
  assert.equal(room.lock('npc-1', 'guest').ok, true);
});

test('host session rejects a guest step and guest snaps back', () => {
  const room = parkRoom({ water: { x: 11, y: 10 } });
  const hostMessages = [];
  const host = createHostSession({
    room,
    send: message => hostMessages.push(message),
    now: () => 50
  });
  const snaps = [];
  const guest = createGuestSession({
    send: message => host.receive(message, 10),
    now: () => 10,
    hooks: { onSnap: (x, y) => snaps.push([x, y]) }
  });
  host.receive({
    t: 'join',
    name: 'Bea',
    recipe: { seed: 'bea', look: {} }
  }, 10);
  assert.equal(hostMessages.at(-1).t, 'welcome');
  const character = {
    fromX: 10,
    fromY: 10,
    toX: 11,
    toY: 10,
    duration: 0.18,
    motionStyle: null,
    motionArriveAt: 1
  };
  // Guest predicts a step the room will refuse because they are not on (10, 10).
  guest.predictFromCharacter(character);
  const reply = hostMessages.at(-1);
  assert.equal(reply.t, 'step-no');
  guest.receive(reply, 20);
  assert.deepEqual(snaps[0], [reply.x, reply.y]);
});

test('a visiting companion is left out of the host save', () => {
  const grid = grassGrid();
  const game = {
    terrain: grid,
    worldSeed: 'fern-test',
    wander: true,
    player: {
      name: 'Ada',
      recipe: { seed: 'ada', look: {} },
      x: 3,
      y: 4,
      direction: 0,
      inventory: [],
      equipped: [],
      coins: 0,
      stabledCompanions: []
    },
    npcs: [],
    companions: [
      { id: 'mine', name: 'Moss', buddyId: 'player', recipe: { seed: 'moss', style: 'dog' }, x: 3, y: 5, direction: 0 },
      { id: 'theirs', name: 'Dot', buddyId: 'remote', recipe: { seed: 'dot', style: 'cat' }, x: 8, y: 8, direction: 1, remoteOwned: true }
    ]
  };
  const save = serializeSave(game, { worldSeed: 'fern-test' }, new Set());
  assert.deepEqual(save.companions.map(comp => comp.id), ['mine']);
  assert.equal(encodeTerrain(grid).length, 4096);
});
