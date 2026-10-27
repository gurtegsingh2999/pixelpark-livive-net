import test from 'node:test';
import assert from 'node:assert/strict';
import engineConfig from '../data/engine_config.json' with { type: 'json' };
import itemsConfig from '../data/items.json' with { type: 'json' };
import effectsConfig from '../data/effects.json' with { type: 'json' };
import rewardsConfig from '../data/rewards.json' with { type: 'json' };
import { EFFECT_CATALOG, EFFECT_SLOTS, slotCapacity } from '../src/effects.js';
import { LOADOUT_TARGETS } from '../src/npc/loadout.js';
import { COMPANION_CAPS as GAME_CAPS } from '../src/game.js';
import { COMPANION_CAPS as REWARD_CAPS, resolveItemPool } from '../src/rewards.js';
import { NPC_GAME_IDS } from '../src/behavior/actions/social.js';

const CATALOG = itemsConfig.catalog;
const NPC_OUTCOMES = new Set(['win', 'draw', 'loss']);
const LOOT_ROW_TYPES = new Set(['coins', 'item', 'companion']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function itemDefinition(id) {
  return CATALOG[id] || null;
}

test('companion caps exist in engine config, are sane, and match both runtime exports', () => {
  const caps = engineConfig.companions;
  assert.ok(isObject(caps), 'engine_config.companions must be an object');

  const expected = {
    playerActiveMax: 3,
    npcActiveMax: 2,
    npcReserveMax: 6,
    globalActiveMax: 80
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(caps[key], value, `${key} has the locked phase-2 value`);
    assert.ok(Number.isInteger(caps[key]) && caps[key] > 0, `${key} must be a positive integer`);
  }

  assert.ok(caps.playerActiveMax >= caps.npcActiveMax, 'player cap is at least the NPC cap');
  assert.ok(caps.npcActiveMax >= 1, 'NPCs can always follow with at least one buddy');
  assert.ok(caps.npcReserveMax >= caps.npcActiveMax, 'reserve cap is at least the active cap');
  assert.ok(
    caps.globalActiveMax >= caps.playerActiveMax + caps.npcActiveMax,
    'global cap must leave room for the player plus one NPC party'
  );

  for (const key of Object.keys(expected)) {
    assert.equal(GAME_CAPS[key], caps[key], `game.js ${key} mirrors engine config`);
    assert.equal(REWARD_CAPS[key], caps[key], `rewards.js ${key} mirrors engine config`);
  }
});

test('every effect declares valid ai priority/target metadata and a catalog item', () => {
  const effects = Object.entries(EFFECT_CATALOG);
  assert.ok(effects.length >= 10, 'the ability catalog is not empty');

  assert.deepEqual(
    Object.keys(EFFECT_CATALOG).sort(),
    Object.keys(effectsConfig.effects).sort(),
    'the runtime catalog is the data file'
  );

  for (const [effectId, effect] of effects) {
    assert.equal(effect.id, effectId, `${effectId} id matches its catalog key`);
    assert.ok(isObject(effect.ai), `${effectId} has ai metadata`);
    assert.ok(
      Number.isFinite(effect.ai.priority) && effect.ai.priority >= 0,
      `${effectId} ai.priority must be a non-negative number`
    );
    assert.ok(
      LOADOUT_TARGETS.includes(effect.ai.target),
      `${effectId} ai.target must be one of ${LOADOUT_TARGETS.join(', ')}`
    );

    assert.ok(EFFECT_SLOTS[effect.slot], `${effectId} uses a real effect slot`);
    assert.ok(slotCapacity(effect.slot) >= 1, `${effectId} slot has capacity`);

    const item = itemDefinition(effect.itemId);
    assert.ok(item, `${effectId} item ${effect.itemId} exists in items.json`);
    assert.equal(item.kind, 'effect', `${effect.itemId} is an effect item`);
    assert.equal(item.effect, effectId, `${effect.itemId} points back at ${effectId}`);
    assert.ok(
      Array.isArray(item.owners) && item.owners.includes('npc'),
      `${effect.itemId} can be owned by NPCs`
    );
  }
});

test('every NPC loot table entry references catalog items and valid row shapes', () => {
  const tables = rewardsConfig.npcLootTables;
  assert.ok(isObject(tables), 'rewards.json has npcLootTables');

  for (const [tableId, table] of Object.entries(tables)) {
    assert.ok(Array.isArray(table) && table.length > 0, `${tableId} must be a non-empty array`);

    if (tableId === 'npc_effect_pool') {
      for (const id of table) {
        assert.equal(typeof id, 'string', `${tableId} entries are item ids`);
        const item = itemDefinition(id);
        assert.ok(item, `${tableId}/${id} exists in the catalog`);
        assert.equal(item.kind, 'effect', `${tableId}/${id} is an ability item`);
        const effect = EFFECT_CATALOG[item.effect];
        assert.ok(effect, `${tableId}/${id} has an effect definition`);
        assert.ok(isObject(effect.ai), `${tableId}/${id} can be auto-equipped by an NPC`);
      }
      continue;
    }

    for (const [index, row] of table.entries()) {
      assert.ok(isObject(row), `${tableId}[${index}] must be an object`);
      assert.ok(LOOT_ROW_TYPES.has(row.type), `${tableId}[${index}] has a known row type`);
      assert.ok(
        Number.isFinite(row.weight) && row.weight > 0,
        `${tableId}[${index}] weight must be positive`
      );

      if (row.type === 'coins') {
        assert.ok(
          Number.isInteger(row.amount) && row.amount >= 0,
          `${tableId}[${index}] coin amount must be a non-negative integer`
        );
      }
      if (row.type === 'item') {
        assert.ok(
          Array.isArray(row.pool) && row.pool.length > 0,
          `${tableId}[${index}] item row has a pool`
        );
        for (const id of row.pool) {
          assert.ok(itemDefinition(id), `${tableId}[${index}]/${id} exists in the catalog`);
        }
      }
      if (row.type === 'companion') {
        assert.equal(row.pool, undefined, `${tableId}[${index}] companion rows use no item pool`);
      }
    }
  }
});

test('npcMiniGames specs reference existing bonus tables and use valid fields', () => {
  const specs = rewardsConfig.npcMiniGames;
  assert.ok(isObject(specs) && Object.keys(specs).length > 0, 'rewards.json has npcMiniGames');

  const tables = rewardsConfig.npcLootTables;
  const referencedTables = new Set();

  for (const [gameId, outcomes] of Object.entries(specs)) {
    assert.ok(NPC_GAME_IDS.includes(gameId), `${gameId} is an NPC-playable game`);
    assert.ok(isObject(outcomes), `${gameId} declares outcomes`);

    for (const outcome of Object.keys(outcomes)) {
      assert.ok(NPC_OUTCOMES.has(outcome), `${gameId} has a known outcome: ${outcome}`);
    }
    assert.ok(outcomes.win, `${gameId} must define a win outcome`);

    for (const [outcome, spec] of Object.entries(outcomes)) {
      const path = `npcMiniGames.${gameId}.${outcome}`;
      assert.ok(isObject(spec), `${path} must be an object`);

      if (spec.coins !== undefined) {
        assert.ok(
          Number.isInteger(spec.coins) && spec.coins >= 0,
          `${path}.coins must be a non-negative integer`
        );
      }

      for (const chanceKey of ['itemChance', 'companionChance', 'bonusRollChance']) {
        if (spec[chanceKey] === undefined) continue;
        assert.ok(
          Number.isFinite(spec[chanceKey]) && spec[chanceKey] >= 0 && spec[chanceKey] <= 1,
          `${path}.${chanceKey} must be a probability`
        );
      }

      if (spec.itemPool !== undefined) {
        let ids = [];
        if (typeof spec.itemPool === 'string') {
          ids = resolveItemPool(spec.itemPool, 'npcMiniGames');
          assert.ok(ids.length > 0, `${path}.itemPool resolves to at least one item`);
          referencedTables.add(spec.itemPool);
        } else {
          assert.ok(Array.isArray(spec.itemPool), `${path}.itemPool is a table name or id array`);
          ids = spec.itemPool;
          assert.ok(ids.length > 0, `${path}.itemPool is not empty`);
        }
        for (const id of ids) {
          assert.ok(itemDefinition(id), `${path}.itemPool/${id} exists in the catalog`);
        }
      }

      if (spec.itemChance > 0) {
        assert.ok(spec.itemPool !== undefined, `${path} needs an itemPool when items can drop`);
      }

      if (spec.bonusLootTable !== undefined) {
        assert.equal(typeof spec.bonusLootTable, 'string', `${path}.bonusLootTable is a table name`);
        assert.ok(tables[spec.bonusLootTable], `${path}.bonusLootTable exists in npcLootTables`);
        referencedTables.add(spec.bonusLootTable);
      }
      if (spec.bonusRollChance > 0) {
        assert.ok(spec.bonusLootTable, `${path} needs a bonusLootTable when bonus rolls can happen`);
      }

      if (outcome === 'win') {
        const grantsSomething = (spec.coins || 0) > 0
          || (spec.itemChance || 0) > 0
          || (spec.companionChance || 0) > 0
          || spec.rewardCompanion === true;
        assert.ok(grantsSomething, `${path} must grant coins, an item, or a buddy`);
      }

      if (outcome === 'loss') {
        assert.equal(spec.rewardCompanion, undefined, `${path} must not guarantee a buddy`);
        assert.equal((spec.itemChance || 0), 0, `${path} must not drop items`);
        assert.equal((spec.companionChance || 0), 0, `${path} must not drop buddies`);
        assert.equal((spec.coins || 0), 0, `${path} is meant to grant nothing`);
      }
    }

    assert.ok((outcomes.draw?.coins || 0) > 0, `${gameId} draw pays a small coin amount`);
  }

  for (const tableId of Object.keys(tables)) {
    assert.ok(referencedTables.has(tableId), `npcLootTables.${tableId} is referenced by a spec`);
  }

  assert.equal(
    rewardsConfig.lootTables.npc_effect_pool,
    undefined,
    'NPC pools do not leak into player loot tables'
  );
  assert.equal(
    rewardsConfig.miniGames['tic-tac-toe']?.win?.itemPool,
    undefined,
    'player tic-tac-toe keeps its own reward shape'
  );
});
