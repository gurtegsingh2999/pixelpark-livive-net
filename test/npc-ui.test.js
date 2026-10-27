import test from 'node:test';
import assert from 'node:assert/strict';
import {
  npcCardSummary,
  npcEconomySummary,
  npcRosterLabel,
  shouldShowNpcRoster
} from '../src/ui/panels.js';

function npc(overrides = {}) {
  return {
    id: 'npc-1',
    name: 'Fern',
    isPlayer: false,
    coins: 4,
    inventory: [],
    equipped: [],
    stabledCompanions: [],
    ...overrides
  };
}

function companion(overrides = {}) {
  return {
    id: 'comp-1',
    name: 'Moss',
    buddyId: 'npc-1',
    isCompanion: true,
    inventory: [],
    equipped: [],
    ...overrides
  };
}

test('shouldShowNpcRoster only accepts neighbour characters', () => {
  assert.equal(shouldShowNpcRoster(npc()), true);
  assert.equal(shouldShowNpcRoster({ id: 'npc-2' }), true);
  assert.equal(shouldShowNpcRoster({ id: 'player', isPlayer: true }), false);
  assert.equal(shouldShowNpcRoster({ id: 'player' }), false);
  assert.equal(shouldShowNpcRoster({ id: 'comp-1', isCompanion: true }), false);
  assert.equal(shouldShowNpcRoster(null), false);
  assert.equal(shouldShowNpcRoster(undefined), false);
});

test('npcCardSummary counts active and reserve buddies with effect names', () => {
  const owner = npc({
    stabledCompanions: [
      {
        id: 'reserve-1',
        name: 'Mo',
        recipe: { style: 'dog' },
        inventory: [{ id: 'hover-halo', uid: 'hover-halo-1' }],
        equipped: [{ slot: 'head', uid: 'hover-halo-1' }]
      }
    ]
  });
  const companions = [
    companion({
      id: 'active-1',
      name: 'Moss',
      inventory: [{ id: 'lucky-clover', uid: 'lucky-clover-0' }],
      equipped: [{ slot: 'charm', uid: 'lucky-clover-0' }]
    }),
    companion({ id: 'active-2', name: 'Pip' }),
    companion({ id: 'player-buddy', name: 'Sunny', buddyId: 'player' })
  ];

  const summary = npcCardSummary(owner, { companions, cap: 2 });

  assert.equal(summary.isNpc, true);
  assert.equal(summary.kind, 'npc');
  assert.deepEqual(summary.counts.active, 2);
  assert.equal(summary.counts.reserve, 1);
  assert.equal(summary.counts.cap, 2);
  assert.deepEqual(summary.activeBuddies.map(buddy => buddy.name), ['Moss', 'Pip']);
  assert.deepEqual(summary.activeBuddies[0].effects, ['Lucky Clover']);
  assert.deepEqual(summary.activeBuddies[1].effects, []);
  assert.equal(summary.reserveBuddies[0].name, 'Mo');
  assert.equal(summary.reserveBuddies[0].role, 'reserve');
  assert.deepEqual(summary.reserveBuddies[0].effects, ['Hover Halo']);
  assert.equal(summary.labels.buddies, '2/2 active · 1 in reserve');
});

test('npcCardSummary reads worn effects and the bag, and is read-only', () => {
  const owner = npc({
    coins: 7,
    inventory: [
      { id: 'hover-halo', uid: 'hover-halo-0', name: 'Hover Halo' },
      { id: 'ball', uid: 'ball-0', name: 'Bouncy Ball', action: 'throw' }
    ],
    equipped: [{ slot: 'head', uid: 'hover-halo-0' }]
  });

  const summary = npcCardSummary(owner, { companions: [] });

  assert.deepEqual(summary.wornNames, ['Hover Halo']);
  assert.equal(summary.counts.bag, 2);
  assert.equal(summary.counts.coins, 7);
  assert.deepEqual(summary.bag.effectNames, ['Hover Halo']);
  assert.deepEqual(summary.bag.otherNames, ['Bouncy Ball']);
  assert.equal(summary.labels.bag, '2 items · 1 effect item');
  assert.equal(summary.labels.buddies, '0 active · 0 in reserve');
});

test('npcCardSummary falls back to the owner reserves and bag, and explicit lists win', () => {
  const owner = npc({
    inventory: [{ id: 'ball', uid: 'ball-0', name: 'Bouncy Ball' }],
    stabledCompanions: [{ id: 'reserve-1', name: 'Mo' }]
  });

  const fallback = npcCardSummary(owner, { companions: [] });
  assert.equal(fallback.counts.reserve, 1);
  assert.equal(fallback.counts.bag, 1);

  const explicit = npcCardSummary(owner, {
    companions: [],
    reserves: [],
    inventory: []
  });
  assert.equal(explicit.counts.reserve, 0);
  assert.equal(explicit.counts.bag, 0);
});

test('npcCardSummary reports player and companion kinds without an NPC roster', () => {
  const player = npcCardSummary(
    { id: 'player', name: 'You', isPlayer: true },
    { companions: [companion({ buddyId: 'player' })] }
  );
  assert.equal(player.isNpc, false);
  assert.equal(player.kind, 'player');
  assert.equal(player.counts.active, 0);
  assert.deepEqual(player.activeBuddies, []);

  const buddy = npcCardSummary(
    companion({ buddyId: 'npc-1', stabledCompanions: [{ id: 'reserve-1' }] }),
    { companions: [] }
  );
  assert.equal(buddy.isNpc, false);
  assert.equal(buddy.kind, 'companion');
  assert.equal(buddy.counts.active, 0);
  assert.equal(buddy.counts.reserve, 0);
});

test('npcRosterLabel is compact and cap-aware', () => {
  assert.equal(npcRosterLabel({ active: 2, reserve: 1, cap: 2 }), '2/2 active · 1 in reserve');
  assert.equal(npcRosterLabel({ active: 1, reserve: 0 }), '1 active · 0 in reserve');
  assert.equal(npcRosterLabel({}), '0 active · 0 in reserve');
  assert.equal(npcRosterLabel(), '0 active · 0 in reserve');
});

test('npcEconomySummary counts NPC buddies, reserves, stocked NPCs, and coins', () => {
  const npcs = [
    npc({ id: 'npc-1', coins: 4, stabledCompanions: [{ id: 'reserve-1' }] }),
    npc({ id: 'npc-2', coins: 2, stabledCompanions: [] }),
    { id: 'player', isPlayer: true, coins: 99, stabledCompanions: [{ id: 'p' }] }
  ];
  const companions = [
    { id: 'a1', buddyId: 'npc-1' },
    { id: 'a2', buddyId: 'npc-1' },
    { id: 'p1', buddyId: 'player' }
  ];

  const economy = npcEconomySummary(npcs, companions);

  assert.equal(economy.npcCount, 2);
  assert.equal(economy.globalActive, 3);
  assert.equal(economy.activeBuddies, 2);
  assert.equal(economy.reserveBuddies, 1);
  assert.equal(economy.npcsWithReserve, 1);
  assert.equal(economy.coins, 6);
  assert.equal(economy.label, '3 followers · 1 in reserve · 1/2 NPCs stocked');
});

test('npcEconomySummary tolerates missing input', () => {
  const economy = npcEconomySummary();
  assert.equal(economy.npcCount, 0);
  assert.equal(economy.globalActive, 0);
  assert.equal(economy.reserveBuddies, 0);
  assert.equal(economy.coins, 0);
  assert.equal(economy.label, '0 followers · 0 in reserve · 0/0 NPCs stocked');
});
