import test from 'node:test';
import assert from 'node:assert/strict';
import engineConfig from '../data/engine_config.json' with { type: 'json' };
import itemsConfig from '../data/items.json' with { type: 'json' };
import rewardsConfig from '../data/rewards.json' with { type: 'json' };
import { createItemInstance, getItemDefinition } from '../src/inventory.js';
import {
  COMPANION_CAPS,
  applyNpcReward,
  applyReward,
  pickPoolItem,
  resolveItemPool,
  rollNpcReward,
  rollReward
} from '../src/rewards.js';

const EFFECT_ITEM_IDS = Object.entries(itemsConfig.catalog)
  .filter(([, item]) => item.kind === 'effect')
  .map(([id]) => id)
  .sort();

function makeCharacter(id, extra = {}) {
  return {
    id,
    name: extra.name || id,
    coins: 0,
    inventory: [],
    equipped: [],
    stabledCompanions: [],
    ...extra
  };
}

function makeGame(companions = []) {
  return {
    player: makeCharacter('player', { name: 'You', isPlayer: true }),
    companions: [...companions],
    makeCompanion(input, buddy) {
      return {
        ...input,
        buddyId: buddy.id,
        isCompanion: true,
        inventory: Array.isArray(input.inventory) ? input.inventory : [],
        equipped: Array.isArray(input.equipped) ? input.equipped : []
      };
    },
    getCompanionsFor(id) {
      return this.companions.filter(comp => comp.buddyId === id);
    }
  };
}

function makeNpc(id = 'npc-1', extra = {}) {
  return makeCharacter(id, { name: 'Fern', ...extra });
}

/** Deterministic random that yields `values` in order, then `fallback`. */
function scripted(values, fallback = 0.99) {
  let index = 0;
  return () => (index < values.length ? values[index++] : fallback);
}

test('companion caps are data-driven and match the phase-2 defaults', () => {
  assert.deepEqual(engineConfig.companions, {
    playerActiveMax: 3,
    npcActiveMax: 2,
    npcReserveMax: 6,
    globalActiveMax: 80
  });
  assert.equal(COMPANION_CAPS.playerActiveMax, 3);
  assert.equal(COMPANION_CAPS.npcActiveMax, 2);
  assert.equal(COMPANION_CAPS.npcReserveMax, 6);
  assert.equal(COMPANION_CAPS.globalActiveMax, 80);
});

test('npc economy config is separate and references only catalog items', () => {
  assert.deepEqual(rewardsConfig.miniGames['tic-tac-toe'].win, {
    coins: 10,
    bonusRollChance: 0.5,
    bonusLootTable: 'ttt_win_loot'
  });

  const win = rewardsConfig.npcMiniGames['tic-tac-toe'].win;
  assert.equal(win.coins, 2);
  assert.equal(win.itemChance, 0.7);
  assert.equal(win.itemPool, 'npc_effect_pool');
  assert.equal(win.companionChance, 0.8);
  assert.equal(win.bonusRollChance, 0.35);
  assert.equal(win.bonusLootTable, 'npc_ttt_bonus');
  assert.deepEqual(rewardsConfig.npcMiniGames['tic-tac-toe'].draw, { coins: 1 });
  assert.deepEqual(rewardsConfig.npcMiniGames['tic-tac-toe'].loss, {});

  const pool = rewardsConfig.npcLootTables.npc_effect_pool;
  assert.deepEqual([...pool].sort(), EFFECT_ITEM_IDS);
  for (const id of pool) assert.ok(getItemDefinition(id), `${id} missing from catalog`);
  assert.ok(!rewardsConfig.lootTables.npc_effect_pool, 'npc pool must not leak into player tables');

  for (const [tableId, table] of Object.entries(rewardsConfig.npcLootTables)) {
    if (tableId === 'npc_effect_pool') continue;
    assert.ok(Array.isArray(table) && table.length > 0, `${tableId} must not be empty`);
    for (const row of table) {
      assert.ok(Number.isFinite(row.weight) && row.weight > 0, `${tableId} weight`);
      if (row.type === 'item') {
        for (const id of row.pool || []) assert.ok(getItemDefinition(id), `${tableId}/${id}`);
      }
      if (row.type === 'coins') assert.ok(Number.isFinite(row.amount) && row.amount >= 0);
    }
  }
});

test('player rewards keep their existing coins, items, and companion behaviour', () => {
  const game = makeGame();
  assert.equal(rollReward(game, 'tic-tac-toe', 'draw').coins, 3);
  assert.equal(rollReward(game, 'tic-tac-toe', 'loss').coins, 1);
  assert.equal(rollReward(game, 'tic-tac-toe', 'win').coins, 10);

  const checkers = rollReward(game, 'checkers', 'win');
  assert.ok(checkers.coins >= 25);
  assert.equal(checkers.newCompanion.buddyId, 'player');

  const ttt = rollReward(game, 'tic-tac-toe', 'win');
  assert.deepEqual(ttt.items, [], 'player ttt stays companion-only');

  const notices = applyReward(game, {
    coins: 4,
    items: [{ id: 'hover-halo' }, { id: 'hover-halo' }]
  });
  assert.equal(game.player.coins, 4);
  assert.equal(game.player.inventory.length, 2);
  assert.equal(game.player.inventory[0].id, 'hover-halo');
  assert.equal(typeof game.player.inventory[0].uid, 'string');
  assert.notEqual(game.player.inventory[0].uid, game.player.inventory[1].uid);
  assert.ok(notices.some(notice => notice.includes('Hover Halo')));
});

test('existing player stash behaviour survives the owner refactor', () => {
  const stashed = makeCharacter('stash-1', { buddyId: 'player' });
  const game = makeGame([stashed]);
  game.player.stabledCompanions.push({ id: 'old', name: 'Old', buddyId: 'player' });

  const notices = applyReward(game, {
    newCompanion: { id: 'comp-new', name: 'Pip', recipe: { seed: 's' } }
  });

  assert.equal(game.companions.length, 2, 'active cap 3 is not reached yet');
  assert.equal(game.companions[1].buddyId, 'player');
  assert.equal(game.companions[1].name, 'Pip');
  assert.equal(game.player.stabledCompanions.length, 1);
  assert.ok(notices.some(notice => notice.includes('Pip')));

  const full = makeGame([
    { id: 'a', buddyId: 'player' },
    { id: 'b', buddyId: 'player' },
    { id: 'c', buddyId: 'player' }
  ]);
  applyReward(full, { newCompanion: { id: 'comp-x', name: 'Mo' } });
  assert.equal(full.companions.length, 3);
  assert.equal(full.player.stabledCompanions.length, 1);
  assert.equal(full.player.stabledCompanions[0].name, 'Mo');
  assert.equal(full.player.stabledCompanions[0].buddyId, 'player');
});

test('NPC win rolls base coins, item pool drops, and a buddy from configured chances', () => {
  const npc = makeNpc();
  const game = makeGame();

  const all = rollNpcReward(game, npc, 'tic-tac-toe', 'win', { random: () => 0 });
  assert.equal(all.coins, 4, '2 base + 2 bonus coins');
  assert.deepEqual(all.items, [{ id: 'big-o-bracelet' }]);
  assert.equal(all.newCompanion.buddyId, 'npc-1');

  const itemOnly = rollNpcReward(game, npc, 'tic-tac-toe', 'win', {
    random: scripted([0.5, 0.99, 0.9, 0.9])
  });
  assert.equal(itemOnly.coins, 2);
  assert.deepEqual(itemOnly.items, [{ id: 'teleport-tricorder' }]);
  assert.equal(itemOnly.newCompanion, null);

  const companionOnly = rollNpcReward(game, npc, 'tic-tac-toe', 'win', {
    random: scripted([0.9, 0.5, 0.0, 0.5])
  });
  assert.equal(companionOnly.coins, 2);
  assert.deepEqual(companionOnly.items, []);
  assert.equal(companionOnly.newCompanion.buddyId, 'npc-1');
  assert.equal(typeof companionOnly.newCompanion.name, 'string');

  const none = rollNpcReward(game, npc, 'tic-tac-toe', 'win', { random: () => 0.99 });
  assert.equal(none.coins, 2);
  assert.deepEqual(none.items, []);
  assert.equal(none.newCompanion, null);
});

test('NPC bonus loot table can add coins or an item', () => {
  const npc = makeNpc();
  const game = makeGame();

  const coins = rollNpcReward(game, npc, 'tic-tac-toe', 'win', {
    random: scripted([0.9, 0.9, 0.2, 0.0])
  });
  assert.equal(coins.coins, 4);
  assert.deepEqual(coins.items, []);

  const item = rollNpcReward(game, npc, 'tic-tac-toe', 'win', {
    random: scripted([0.9, 0.9, 0.2, 0.6, 0.0])
  });
  assert.equal(item.coins, 2);
  assert.deepEqual(item.items, [{ id: 'lucky-clover' }]);
});

test('applyNpcReward credits the NPC, never the player', () => {
  const npc = makeNpc();
  const game = makeGame();
  game.player.coins = 99;
  game.player.inventory.push(createItemInstance('ball', { uid: 'ball-player' }));
  game.player.stabledCompanions.push({ id: 'p-old', name: 'Pip', buddyId: 'player' });

  const reward = rollNpcReward(game, npc, 'tic-tac-toe', 'win', {
    random: scripted([0.5, 0.99, 0.5, 0.0, 0.9])
  });
  const notices = applyNpcReward(game, npc, reward);

  assert.equal(npc.coins, 2);
  assert.equal(npc.inventory.length, 1);
  assert.equal(npc.inventory[0].id, 'teleport-tricorder');
  assert.equal(typeof npc.inventory[0].uid, 'string');
  assert.equal(game.companions.length, 1);
  assert.equal(game.companions[0].buddyId, 'npc-1');
  assert.ok(notices.some(notice => notice.includes('Teleport Tricorder')));

  assert.equal(game.player.coins, 99);
  assert.deepEqual(game.player.inventory.map(item => item.uid), ['ball-player']);
  assert.deepEqual(game.player.stabledCompanions.map(comp => comp.id), ['p-old']);
  assert.ok(!game.companions.some(comp => comp.buddyId === 'player'));
});

test('NPCs cap at two active buddies and stash extras in stabledCompanions', () => {
  const npc = makeNpc();
  const game = makeGame([
    { id: 'a', buddyId: 'npc-1' },
    { id: 'b', buddyId: 'npc-1' }
  ]);

  const notices = applyNpcReward(game, npc, {
    newCompanion: { id: 'comp-3', name: 'Pip', recipe: { seed: 'pip' } }
  });

  assert.equal(game.companions.length, 2, 'no third active buddy');
  assert.equal(npc.stabledCompanions.length, 1);
  const stabled = npc.stabledCompanions[0];
  assert.equal(stabled.name, 'Pip');
  assert.equal(stabled.buddyId, 'npc-1');
  assert.deepEqual(stabled.inventory, []);
  assert.deepEqual(stabled.equipped, []);
  assert.equal(stabled.coins, 0);
  assert.deepEqual(stabled.stabledCompanions, []);
  assert.ok(notices.some(notice => notice.includes('Pip')));

  // A player still tops out at three active buddies.
  const playerGame = makeGame([
    { id: 'a', buddyId: 'player' },
    { id: 'b', buddyId: 'player' }
  ]);
  applyReward(playerGame, { newCompanion: { id: 'comp-3', name: 'Mo' } });
  assert.equal(playerGame.companions.length, 3);
  assert.equal(playerGame.player.stabledCompanions.length, 0);
});

test('NPC reserve cap of six is respected without throwing', () => {
  const npc = makeNpc();
  const stabled = Array.from({ length: 6 }, (_, index) => ({
    id: `stash-${index}`,
    name: `Buddy ${index}`,
    buddyId: 'npc-1'
  }));
  npc.stabledCompanions = [...stabled];
  const game = makeGame([
    { id: 'a', buddyId: 'npc-1' },
    { id: 'b', buddyId: 'npc-1' }
  ]);

  let notices;
  assert.doesNotThrow(() => {
    notices = applyNpcReward(game, npc, { newCompanion: { id: 'comp-x', name: 'Pip' } });
  });

  assert.equal(game.companions.length, 2);
  assert.equal(npc.stabledCompanions.length, 6);
  assert.deepEqual(npc.stabledCompanions.map(comp => comp.id), stabled.map(comp => comp.id));
  assert.ok(notices.some(notice => notice.includes("Fern's collection is full.")));
});

test('global active companion cap pushes new buddies to reserve', () => {
  const npc = makeNpc();
  const companions = Array.from({ length: 80 }, (_, index) => ({
    id: `comp-${index}`,
    buddyId: `other-${index}`
  }));
  const game = makeGame(companions);

  applyNpcReward(game, npc, { newCompanion: { id: 'comp-new', name: 'Pip' } });
  assert.equal(game.companions.length, 80);
  assert.equal(npc.stabledCompanions.length, 1);
  assert.equal(npc.stabledCompanions[0].buddyId, 'npc-1');

  // The player is capped by the same safety valve.
  applyReward(game, { newCompanion: { id: 'comp-player', name: 'Mo' } });
  assert.equal(game.companions.length, 80);
  assert.equal(game.player.stabledCompanions.length, 1);
});

test('draw grants a coin and loss grants nothing', () => {
  const npc = makeNpc();
  const game = makeGame();

  const draw = rollNpcReward(game, npc, 'tic-tac-toe', 'draw', { random: () => 0 });
  assert.deepEqual(draw, { coins: 1, items: [], newCompanion: null });
  applyNpcReward(game, npc, draw);
  assert.equal(npc.coins, 1);

  const loss = rollNpcReward(game, npc, 'tic-tac-toe', 'loss', { random: () => 0 });
  assert.deepEqual(loss, { coins: 0, items: [], newCompanion: null });
  const before = npc.coins;
  applyNpcReward(game, npc, loss);
  assert.equal(npc.coins, before);
  assert.equal(npc.inventory.length, 0);
  assert.equal(game.companions.length, 0);
});

test('an NPC Lucky Clover adds its coin bonus once', () => {
  const clover = createItemInstance('lucky-clover', { uid: 'clover-npc' });
  const npc = makeNpc('npc-1', {
    inventory: [clover],
    equipped: [{ slot: 'charm', uid: 'clover-npc' }]
  });
  const game = makeGame();

  const notices = applyNpcReward(game, npc, { coins: 2 });
  assert.equal(npc.coins, 3);
  assert.ok(notices.some(notice => notice.includes('🍀')));
  assert.equal(game.player.coins, 0);
});

test('unknown games, pools, items, and effects fail safe', () => {
  const npc = makeNpc();
  const game = makeGame();

  assert.equal(rollNpcReward(game, npc, 'checkers', 'win'), null, 'player-only game is not NPC-rollable');
  assert.equal(rollNpcReward(game, npc, 'unknown-game', 'win'), null);
  assert.equal(rollNpcReward(game, npc, 'tic-tac-toe', 'unknown-outcome'), null);
  assert.equal(rollReward(game, 'unknown-game', 'win'), null);

  const resolved = resolveItemPool('npc_effect_pool');
  assert.deepEqual([...resolved].sort(), EFFECT_ITEM_IDS);
  assert.deepEqual(resolveItemPool(['ball', { id: 'chess' }, null]), ['ball', 'chess']);
  assert.deepEqual(resolveItemPool('missing_table'), []);
  assert.deepEqual(resolveItemPool(null), []);
  assert.deepEqual(resolveItemPool([]), []);
  assert.equal(pickPoolItem(['mystery-trinket']), null);

  // An unknown table name yields no item, the reward still settles.
  const broken = applyNpcReward(game, npc, {
    coins: 1,
    items: [{ id: 'mystery-trinket' }, null, 'not-an-item', {}, { id: '' }]
  });
  assert.equal(npc.coins, 1);
  assert.equal(npc.inventory.length, 0);
  assert.deepEqual(broken, ['+1 🪙']);

  // Unknown equipped entries must not break clover resolution.
  npc.equipped = [{ slot: 'charm', uid: 'ghost-uid' }];
  assert.doesNotThrow(() => applyNpcReward(game, npc, { coins: 2 }));
  assert.equal(npc.coins, 3);

  assert.deepEqual(applyNpcReward(game, npc, null), []);
  assert.deepEqual(applyNpcReward(game, null, { coins: 5 }), []);
  assert.equal(game.player.coins, 0, 'a missing NPC must never credit the player');
  assert.equal(rollNpcReward(game, null, 'tic-tac-toe', 'win'), null);
  assert.doesNotThrow(() => applyNpcReward(null, npc, { coins: 1 }));
  assert.doesNotThrow(() => applyReward(game, { coins: 5 }, {}));
});

test('rollReward defaults to the player economy and owner', () => {
  const game = makeGame();
  const npc = makeNpc();
  const reward = rollReward(game, 'tic-tac-toe', 'win', {
    owner: npc,
    random: () => 0
  });

  assert.equal(reward.coins, 10);
  assert.equal(reward.newCompanion.buddyId, 'npc-1');
  assert.ok(reward.newCompanion.name);

  const playerReward = rollReward(game, 'tic-tac-toe', 'win', { random: () => 0 });
  assert.equal(playerReward.newCompanion.buddyId, 'player');
});
