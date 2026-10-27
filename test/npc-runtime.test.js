import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemInstance } from '../src/inventory.js';
import { equip } from '../src/effects.js';
import { awardNpcGame } from '../src/npc/game-rewards.js';

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
  const player = makeCharacter('player', { name: 'You', isPlayer: true, coins: 7 });
  const game = {
    player,
    npcs: [],
    companions: [...companions],
    makeCompanion(input = {}, buddy) {
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
  return game;
}

function makeNpc(id = 'npc-1', extra = {}) {
  return makeCharacter(id, { name: 'Fern', ...extra });
}

function makeBuddy(id, buddyId) {
  return {
    id,
    name: id,
    buddyId,
    isCompanion: true,
    inventory: [],
    equipped: []
  };
}

/** Deterministic random that yields `values` in order, then `fallback`. */
function scripted(values, fallback = 0.99) {
  let index = 0;
  return () => (index < values.length ? values[index++] : fallback);
}

test('awardNpcGame grants coins, an effect item, a companion, and auto-equips', () => {
  const winner = makeNpc();
  const game = makeGame();
  game.npcs.push(winner);
  const playerBefore = structuredClone(game.player);

  // item chance pass, first pool item (big-o-bracelet), companion chance pass,
  // first companion name, bonus roll fail.
  const random = scripted([0.1, 0, 0.1, 0, 0.99]);
  const result = awardNpcGame({
    game,
    winner,
    gameId: 'tic-tac-toe',
    outcome: 'win',
    now: 1200,
    random
  });

  assert.equal(result.ok, true);
  assert.equal(result.reward.coins, 2);
  assert.equal(winner.coins, 2);
  assert.ok(winner.inventory.some(item => item.id === 'big-o-bracelet'));
  assert.equal(game.companions.length, 1);
  assert.equal(game.companions[0].buddyId, winner.id);

  assert.equal(result.equipped.length, 1);
  assert.equal(result.equipped[0].itemId, 'big-o-bracelet');
  assert.equal(winner.equipped.length, 1);
  assert.equal(winner.equipped[0].itemId, 'big-o-bracelet');
  assert.ok(result.notices.length >= 3);

  // The player is untouched by NPC settlement.
  assert.deepEqual(game.player, playerBefore);
});

test('auto-equip moves a reward item onto an NPC buddy when the owner is full', () => {
  const winner = makeNpc();
  const buddy = makeBuddy('comp-1', winner.id);
  const game = makeGame([buddy]);
  game.npcs.push(winner);

  const jar = createItemInstance('glowworm-jar');
  winner.inventory.push(jar);
  const equippedJar = equip(winner, jar, 0);
  assert.equal(equippedJar.ok, true);

  // item chance pass, pick teleport-tricorder (last pool entry), no companion,
  // no bonus roll.
  const result = awardNpcGame({
    game,
    winner,
    gameId: 'tic-tac-toe',
    outcome: 'win',
    now: 900,
    random: scripted([0.1, 0.95, 0.99, 0.99])
  });

  assert.equal(result.ok, true);
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].toId, buddy.id);
  assert.equal(buddy.equipped.length, 1);
  assert.equal(buddy.equipped[0].itemId, 'teleport-tricorder');
  assert.ok(buddy.inventory.some(item => item.id === 'teleport-tricorder'));
  assert.ok(!winner.inventory.some(item => item.id === 'teleport-tricorder'));
  assert.equal(winner.coins, 2);
});

test('draw rewards both participants with the configured draw coins', () => {
  const a = makeNpc('npc-a', { name: 'Fern' });
  const b = makeNpc('npc-b', { name: 'Moss' });
  const game = makeGame();
  game.npcs.push(a, b);
  const playerBefore = structuredClone(game.player);

  const resultA = awardNpcGame({
    game,
    winner: a,
    loser: b,
    gameId: 'tic-tac-toe',
    outcome: 'draw',
    now: 1000,
    random: scripted([])
  });
  const resultB = awardNpcGame({
    game,
    winner: b,
    loser: a,
    gameId: 'tic-tac-toe',
    outcome: 'draw',
    now: 1000,
    random: scripted([])
  });

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(a.coins, 1);
  assert.equal(b.coins, 1);
  assert.deepEqual(resultA.reward.items, []);
  assert.deepEqual(resultB.reward.items, []);
  assert.equal(game.companions.length, 0);
  assert.deepEqual(game.player, playerBefore);
});

test('failed or empty rewards return a reason without throwing', () => {
  const winner = makeNpc();
  const game = makeGame();
  game.npcs.push(winner);

  assert.deepEqual(
    awardNpcGame({ game, winner: null, gameId: 'tic-tac-toe', outcome: 'win' }),
    { ok: false, reason: 'no-winner' }
  );
  assert.deepEqual(
    awardNpcGame({ game, winner, gameId: 'unknown-game', outcome: 'win' }),
    { ok: false, reason: 'no-reward' }
  );
  assert.deepEqual(
    awardNpcGame({ game, winner: game.player, gameId: 'tic-tac-toe', outcome: 'win' }),
    { ok: false, reason: 'player-owner' }
  );
  assert.doesNotThrow(() => awardNpcGame({ game: null, winner, gameId: 'tic-tac-toe' }));

  const loss = awardNpcGame({
    game,
    winner,
    gameId: 'tic-tac-toe',
    outcome: 'loss',
    random: scripted([])
  });
  assert.equal(loss.ok, true);
  assert.equal(loss.reward.coins, 0);
  assert.deepEqual(loss.reward.items, []);
  assert.equal(winner.coins, 0);
});

test('a companion reward at the active cap goes to reserve and still returns ok', () => {
  const winner = makeNpc();
  const game = makeGame([
    makeBuddy('comp-1', winner.id),
    makeBuddy('comp-2', winner.id)
  ]);
  game.npcs.push(winner);

  // No item, companion chance passes, first name, no bonus roll.
  const result = awardNpcGame({
    game,
    winner,
    gameId: 'tic-tac-toe',
    outcome: 'win',
    now: 100,
    random: scripted([0.99, 0.1, 0, 0.99])
  });

  assert.equal(result.ok, true);
  assert.equal(game.companions.length, 2);
  assert.equal(winner.stabledCompanions.length, 1);
  assert.equal(winner.stabledCompanions[0].buddyId, winner.id);
  assert.ok(result.notices.some(notice => notice.includes('collection')));
});
