import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  COMPANION_CAPS,
  getReserveCompanions,
  activeCompanionCap,
  companionCounts,
  countActiveCompanions
} from '../src/game.js';

function npcOwner(id = 'npc-1') {
  return { id, name: 'Fern', isPlayer: false, stabledCompanions: [] };
}

test('roster helpers expose safe defaults and per-owner caps', () => {
  assert.deepEqual(getReserveCompanions(null), []);
  assert.deepEqual(getReserveCompanions({}), []);
  const reserve = [{ id: 'comp-1' }];
  assert.equal(getReserveCompanions({ stabledCompanions: reserve }), reserve);

  assert.equal(activeCompanionCap({ id: 'player' }), COMPANION_CAPS.playerActiveMax);
  assert.equal(activeCompanionCap({ id: 'player', isPlayer: true }), COMPANION_CAPS.playerActiveMax);
  assert.equal(activeCompanionCap(npcOwner()), COMPANION_CAPS.npcActiveMax);

  assert.deepEqual(companionCounts(npcOwner(), []), {
    active: 0,
    reserve: 0,
    cap: COMPANION_CAPS.npcActiveMax
  });
});

test('addActiveCompanion creates an active buddy for an NPC owner', () => {
  const game = new Game();
  game.companions = [];
  const npc = npcOwner();

  const companion = game.addActiveCompanion(npc, {
    id: 'npc-buddy-1',
    name: 'Moss',
    recipe: { style: 'dog' },
    inventory: [{ id: 'lucky-clover', uid: 'lucky-clover-0' }],
    equipped: [{ slot: 'charm', uid: 'lucky-clover-0' }]
  });

  assert.equal(companion.id, 'npc-buddy-1');
  assert.equal(companion.buddyId, 'npc-1');
  assert.equal(companion.inventory[0].uid, 'lucky-clover-0');
  assert.deepEqual(companion.equipped, [{ slot: 'charm', uid: 'lucky-clover-0' }]);
  assert.equal(game.companions.length, 1);
  assert.equal(game.getCompanionsFor('npc-1').length, 1);
  assert.deepEqual(game.companionCounts(npc), {
    active: 1,
    reserve: 0,
    cap: COMPANION_CAPS.npcActiveMax
  });
});

test('reserveCompanion persists ownership defaults without touching the active roster', () => {
  const game = new Game();
  game.companions = [];
  const npc = npcOwner();

  const reserved = game.reserveCompanion(npc, {
    id: 'npc-reserve-1',
    name: 'Mo',
    recipe: { style: 'dog' },
    inventory: [{ id: 'buddy-cape', uid: 'buddy-cape-0' }],
    equipped: undefined
  });

  assert.equal(reserved.buddyId, 'npc-1');
  assert.deepEqual(reserved.inventory, [{ id: 'buddy-cape', uid: 'buddy-cape-0' }]);
  assert.deepEqual(reserved.equipped, []);
  assert.equal(reserved.coins, 0);
  assert.deepEqual(reserved.stabledCompanions, []);
  assert.equal(npc.stabledCompanions.length, 1);
  assert.equal(game.companions.length, 0);
  assert.deepEqual(game.companionCounts(npc), {
    active: 0,
    reserve: 1,
    cap: COMPANION_CAPS.npcActiveMax
  });
});

test('activateReserveCompanion enforces the active cap and then moves gear across', () => {
  const game = new Game();
  game.companions = [];
  const npc = npcOwner();
  const cap = COMPANION_CAPS.npcActiveMax;

  for (let index = 0; index < cap; index++) {
    const companion = game.addActiveCompanion(npc, { id: `npc-buddy-${index}`, name: `Buddy ${index}` });
    assert.ok(companion);
  }
  assert.equal(game.companionCounts(npc).active, cap);

  const reserved = game.reserveCompanion(npc, {
    id: 'npc-reserve-1',
    name: 'Mo',
    recipe: { style: 'dog' },
    inventory: [{ id: 'lucky-clover', uid: 'lucky-clover-0' }],
    equipped: [{ slot: 'charm', uid: 'lucky-clover-0' }]
  });
  assert.ok(reserved);

  const denied = game.activateReserveCompanion(npc, 'npc-reserve-1');
  assert.equal(denied.ok, false);
  assert.equal(denied.companion, null);
  assert.equal(denied.reason, 'at-cap');
  assert.equal(npc.stabledCompanions.length, 1);

  game.companions = game.companions.filter(comp => comp.id !== 'npc-buddy-0');
  const activated = game.activateReserveCompanion(npc, 'npc-reserve-1');
  assert.equal(activated.ok, true);
  assert.equal(activated.reason, null);
  assert.equal(activated.companion.id, 'npc-reserve-1');
  assert.equal(activated.companion.buddyId, 'npc-1');
  assert.equal(activated.companion.equipped[0].uid, 'lucky-clover-0');
  assert.equal(game.companions.some(comp => comp.id === 'npc-reserve-1'), true);
  assert.equal(npc.stabledCompanions.length, 0);
  assert.equal(game.companionCounts(npc).active, cap);

  assert.deepEqual(game.activateReserveCompanion(npc, 'missing'), {
    ok: false,
    companion: null,
    reason: 'not-found'
  });
});

test('global and per-owner active counts track the flat companion list', () => {
  const game = new Game();
  const first = npcOwner('npc-1');
  const second = npcOwner('npc-2');
  game.companions = [];
  game.addActiveCompanion(first, { id: 'comp-1' });
  game.addActiveCompanion(second, { id: 'comp-2' });
  game.addActiveCompanion(second, { id: 'comp-3' });

  assert.equal(game.globalCompanionCount(), 3);
  assert.equal(countActiveCompanions(game.companions, 'npc-1'), 1);
  assert.equal(countActiveCompanions(game.companions, 'npc-2'), 2);
  assert.equal(countActiveCompanions(game.companions, 'npc-3'), 0);
  assert.deepEqual(game.companionCounts(first), {
    active: 1,
    reserve: 0,
    cap: COMPANION_CAPS.npcActiveMax
  });
});

test('roster helpers keep player active cap separate from NPC cap', () => {
  const game = new Game();
  const player = { id: 'player', isPlayer: true, stabledCompanions: [] };
  game.companions = [];
  game.addActiveCompanion(player, { id: 'player-comp-1' });

  const counts = game.companionCounts(player);
  assert.equal(counts.active, 1);
  assert.equal(counts.cap, COMPANION_CAPS.playerActiveMax);
});

test('activateReserveCompanion refuses to exceed the global active cap', () => {
  const game = new Game();
  const npc = npcOwner();
  game.companions = Array.from({ length: COMPANION_CAPS.globalActiveMax }, (_, index) => ({
    id: `other-${index}`,
    buddyId: 'other',
    name: `Other ${index}`
  }));
  game.reserveCompanion(npc, { id: 'npc-reserve-global', name: 'Mo' });

  const result = game.activateReserveCompanion(npc, 'npc-reserve-global');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'global-cap');
  assert.equal(game.companions.length, COMPANION_CAPS.globalActiveMax);
  assert.equal(npc.stabledCompanions.length, 1);
});
