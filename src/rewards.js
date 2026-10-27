import rewardsConfig from '../data/rewards.json' with { type: 'json' };
import engineConfig from '../data/engine_config.json' with { type: 'json' };
import { createCompanionRecipe } from './avatar.js';
import { COMPANION_NAMES } from './names.js';
import { resolveFx } from './effects.js';
import { createItemInstance, getItemDefinition } from './inventory.js';

const DEFAULT_COMPANION_CAPS = {
  playerActiveMax: 3,
  npcActiveMax: 2,
  npcReserveMax: 6,
  globalActiveMax: 80
};

/** Data-driven companion caps from `data/engine_config.json`. */
export const COMPANION_CAPS = {
  ...DEFAULT_COMPANION_CAPS,
  ...(engineConfig.companions && typeof engineConfig.companions === 'object'
    ? engineConfig.companions
    : {})
};

function randomSource(random) {
  return typeof random === 'function' ? random : Math.random;
}

/** Clamp a random value to [0, 1); bad values fall back to 0. */
function randomValue(random) {
  const raw = randomSource(random)();
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.999999);
}

function rollCompanion(buddyId = 'player', random = Math.random) {
  const names = Array.isArray(COMPANION_NAMES) && COMPANION_NAMES.length ? COMPANION_NAMES : ['Buddy'];
  const name = names[Math.floor(randomValue(random) * names.length)];
  const recipe = createCompanionRecipe();
  return {
    id: `comp-${Math.random().toString(36).slice(2, 9)}`,
    name,
    recipe,
    buddyId
  };
}

/**
 * Pick a catalog item id from a loot-table pool. Unknown ids are skipped so a
 * stale or malformed pool degrades to "nothing dropped" instead of crashing.
 * `random` is injectable for deterministic tests.
 */
export function pickPoolItem(pool, random = Math.random) {
  if (!Array.isArray(pool) || !pool.length) return null;

  const ids = [];
  const seen = new Set();
  for (const entry of pool) {
    const id = typeof entry === 'string'
      ? entry
      : (entry && typeof entry === 'object' ? entry.id : null);
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (!getItemDefinition(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return null;

  const value = randomValue(random);
  return ids[Math.floor(value * ids.length)] || ids[ids.length - 1];
}

/** Look up a loot table by name, preferring the active economy's tables. */
function resolveLootTable(name, source) {
  if (typeof name !== 'string' || !name) return [];
  const primary = source === 'npcMiniGames' ? rewardsConfig.npcLootTables : rewardsConfig.lootTables;
  const secondary = source === 'npcMiniGames' ? rewardsConfig.lootTables : rewardsConfig.npcLootTables;
  const table = primary?.[name] ?? secondary?.[name];
  return Array.isArray(table) ? table : [];
}

/**
 * Resolve an `itemPool` value. It may be a literal array of item ids or the
 * name of a table. Loot-table rows are flattened into their item pools, and
 * unknown entries are left for `pickPoolItem` to filter out.
 */
export function resolveItemPool(pool, source = 'miniGames') {
  const flatten = table => {
    const ids = [];
    for (const entry of table) {
      if (typeof entry === 'string') {
        ids.push(entry);
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.id === 'string') ids.push(entry.id);
        if (Array.isArray(entry.pool)) ids.push(...entry.pool);
      }
    }
    return ids;
  };

  if (Array.isArray(pool)) return flatten(pool);
  if (typeof pool !== 'string' || !pool) return [];
  return flatten(resolveLootTable(pool, source));
}

/** Weighted pick from a loot table; `null` for an empty or malformed table. */
function rollLootRow(table, random) {
  if (!Array.isArray(table) || !table.length) return null;
  const totalWeight = table.reduce((sum, row) => sum + (Number(row?.weight) || 1), 0);
  let roll = randomValue(random) * totalWeight;
  for (const row of table) {
    if (!row || typeof row !== 'object') continue;
    roll -= Number(row.weight) || 1;
    if (roll <= 0) return row;
  }
  const fallback = table[table.length - 1];
  return fallback && typeof fallback === 'object' ? fallback : null;
}

function applyLootRow(row, result, { random, source, buddyId }) {
  if (!row || typeof row !== 'object') return;
  if (row.type === 'coins') {
    result.coins += row.amount || 10;
    return;
  }
  if (row.type === 'companion') {
    result.newCompanion = rollCompanion(buddyId, random);
    return;
  }
  if (row.type === 'item') {
    const itemId = pickPoolItem(resolveItemPool(row.pool, source), random);
    if (itemId) result.items.push({ id: itemId });
  }
}

function rollFromTable(table, gameType, outcome, { owner, source, random }) {
  const spec = table?.[gameType]?.[outcome];
  if (!spec) return null;

  const buddyId = owner?.id || 'player';
  const result = {
    coins: spec.coins || 0,
    items: [],
    newCompanion: null
  };

  // Guaranteed companion reward if configured on spec (player economy).
  if (spec.rewardCompanion) {
    result.newCompanion = rollCompanion(buddyId, random);
  }

  // Chance-based item drop (NPC economy, also usable by player specs).
  if (Number(spec.itemChance) > 0 && randomValue(random) < Number(spec.itemChance)) {
    const itemId = pickPoolItem(resolveItemPool(spec.itemPool, source), random);
    if (itemId) result.items.push({ id: itemId });
  }

  // Chance-based companion drop (NPC economy).
  if (Number(spec.companionChance) > 0 && randomValue(random) < Number(spec.companionChance)) {
    result.newCompanion = rollCompanion(buddyId, random);
  }

  if (Number(spec.bonusRollChance) > 0 && spec.bonusLootTable
    && randomValue(random) < Number(spec.bonusRollChance)) {
    applyLootRow(rollLootRow(resolveLootTable(spec.bonusLootTable, source), random), result, {
      random,
      source,
      buddyId
    });
  }

  return result;
}

/**
 * Roll a mini-game reward for an owner. Defaults to the player and the
 * player-facing `miniGames` table. Pass `{ owner, source, random }` to target
 * an NPC (`source: 'npcMiniGames'`) or inject a deterministic random.
 */
export function rollReward(game, gameType, outcome, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const owner = opts.owner || game?.player || null;
  const source = typeof opts.source === 'string' && opts.source ? opts.source : 'miniGames';
  const table = source === 'npcMiniGames' ? rewardsConfig.npcMiniGames : rewardsConfig.miniGames;
  return rollFromTable(table, gameType, outcome, {
    owner,
    source,
    random: randomSource(opts.random)
  });
}

/**
 * Roll an NPC-vs-NPC mini-game reward. Always uses `npcMiniGames`; unknown
 * game types or outcomes return `null` so callers can skip settlement.
 */
export function rollNpcReward(game, npc, gameType, outcome, options = {}) {
  if (!npc || typeof npc !== 'object') return null;
  const opts = options && typeof options === 'object' ? options : {};
  return rollReward(game, gameType, outcome, {
    owner: npc,
    source: 'npcMiniGames',
    random: opts.random
  });
}

function isPlayerOwner(owner) {
  return Boolean(owner && (owner.isPlayer || owner.id === 'player'));
}

function activeCompanionsFor(game, ownerId) {
  if (game && typeof game.getCompanionsFor === 'function') {
    const list = game.getCompanionsFor(ownerId);
    return Array.isArray(list) ? list : [];
  }
  const companions = Array.isArray(game?.companions) ? game.companions : [];
  return companions.filter(comp => comp && comp.buddyId === ownerId);
}

function globalCompanionCount(game) {
  return Array.isArray(game?.companions) ? game.companions.length : 0;
}

function makeReserveCompanion(owner, spec) {
  const reserve = { ...(spec && typeof spec === 'object' ? spec : {}) };
  reserve.buddyId = owner.id;
  if (!Array.isArray(reserve.inventory)) reserve.inventory = [];
  if (!Array.isArray(reserve.equipped)) reserve.equipped = [];
  if (!Number.isFinite(reserve.coins)) reserve.coins = 0;
  if (!Array.isArray(reserve.stabledCompanions)) reserve.stabledCompanions = [];
  return reserve;
}

function addActiveCompanion(game, owner, spec) {
  const input = { ...(spec && typeof spec === 'object' ? spec : {}), buddyId: owner.id };
  const companion = typeof game.makeCompanion === 'function'
    ? game.makeCompanion(input, owner)
    : { ...input, isCompanion: true, inventory: [], equipped: [] };
  if (!Array.isArray(game.companions)) game.companions = [];
  game.companions.push(companion);
  return companion;
}

/**
 * Add one reward item to an inventory as a fresh instance. Existing entries are
 * never replaced, and a uid collision falls back to a minted reward uid.
 */
function addItemReward(inventory, spec) {
  const id = typeof spec === 'string'
    ? spec
    : (spec && typeof spec === 'object' ? spec.id : null);
  if (typeof id !== 'string' || !id) return null;
  if (!getItemDefinition(id)) return null;

  const instance = createItemInstance(id);
  if (!instance) return null;

  const taken = new Set();
  for (const entry of inventory) {
    if (entry && typeof entry.uid === 'string' && entry.uid) taken.add(entry.uid);
  }

  const preferred = spec && typeof spec === 'object' && typeof spec.uid === 'string' && spec.uid
    ? spec.uid
    : null;

  if (preferred && !taken.has(preferred)) {
    instance.uid = preferred;
  } else if (taken.has(instance.uid)) {
    let suffix = 1;
    let uid = `${id}-reward-${suffix}`;
    while (taken.has(uid)) {
      suffix += 1;
      uid = `${id}-reward-${suffix}`;
    }
    instance.uid = uid;
  }

  inventory.push(instance);
  return instance;
}

/**
 * Apply a rolled reward to an owner (player by default). Coins, item instances,
 * Lucky Clover bonus, and new companions all land on the owner; companions
 * respect the owner's active cap and reserve collection. Returns toast-ready
 * notification strings.
 */
export function applyReward(game, reward, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const owner = opts.owner || game?.player || null;
  if (!reward || !owner) return [];

  const notifications = [];
  const ownerName = typeof owner.name === 'string' && owner.name ? owner.name : 'They';

  // 1. Coins
  const coins = Number.isFinite(reward.coins) && reward.coins > 0 ? reward.coins : 0;
  if (coins > 0) {
    owner.coins = (Number.isFinite(owner.coins) ? owner.coins : 0) + coins;
    notifications.push(`+${coins} 🪙`);
  }

  // 2. Lucky Clover bonus (owner's own gear only; added once per reward)
  const cloverBonus = Math.max(0, Math.floor(resolveFx(owner).stats.coinBonus));
  if (cloverBonus > 0) {
    owner.coins = (Number.isFinite(owner.coins) ? owner.coins : 0) + cloverBonus;
    notifications.push(`+${cloverBonus} 🪙 🍀`);
  }

  // 3. Item rewards
  if (Array.isArray(reward.items) && reward.items.length) {
    if (!Array.isArray(owner.inventory)) {
      owner.inventory = [];
    }
    for (const spec of reward.items) {
      const instance = addItemReward(owner.inventory, spec);
      if (!instance) continue;
      notifications.push(`Got ${instance.name || instance.id}!`);
    }
  }

  // 4. New Companion
  if (reward.newCompanion) {
    const player = isPlayerOwner(owner);
    const activeMax = player ? COMPANION_CAPS.playerActiveMax : COMPANION_CAPS.npcActiveMax;
    const active = activeCompanionsFor(game, owner.id);
    const underGlobalCap = globalCompanionCount(game) < COMPANION_CAPS.globalActiveMax;
    const reserve = Array.isArray(owner.stabledCompanions) ? owner.stabledCompanions : [];

    if (active.length < activeMax && underGlobalCap) {
      addActiveCompanion(game, owner, reward.newCompanion);
      notifications.push(`New companion: ${reward.newCompanion.name}!`);
    } else {
      const reserveMax = player ? Infinity : COMPANION_CAPS.npcReserveMax;
      if (reserve.length >= reserveMax) {
        notifications.push(`${ownerName}'s collection is full.`);
      } else {
        const stabled = makeReserveCompanion(owner, reward.newCompanion);
        owner.stabledCompanions = reserve.concat(stabled);
        notifications.push(player
          ? `New companion added to your collection: ${stabled.name}!`
          : `${ownerName} added ${stabled.name} to their collection!`);
      }
    }
  }

  return notifications;
}

/** Apply an NPC reward to that NPC only; the player is never touched. */
export function applyNpcReward(game, npc, reward) {
  if (!npc || typeof npc !== 'object') return [];
  return applyReward(game, reward, { owner: npc });
}
