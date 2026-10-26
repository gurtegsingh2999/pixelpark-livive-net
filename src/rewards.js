import rewardsConfig from '../data/rewards.json' with { type: 'json' };
import { createCompanionRecipe } from './avatar.js';
import { COMPANION_NAMES } from './names.js';
import { resolveFx } from './effects.js';
import { createItemInstance, getItemDefinition } from './inventory.js';

function rollCompanion() {
  const name = COMPANION_NAMES[Math.floor(Math.random() * COMPANION_NAMES.length)];
  const recipe = createCompanionRecipe();
  return {
    id: `comp-${Math.random().toString(36).slice(2, 9)}`,
    name,
    recipe,
    buddyId: 'player'
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

  const roll = typeof random === 'function' ? random() : Math.random();
  const value = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0;
  return ids[Math.floor(value * ids.length)] || ids[ids.length - 1];
}

export function rollReward(game, gameType, outcome) {
  const spec = rewardsConfig.miniGames?.[gameType]?.[outcome];
  if (!spec) return null;

  const result = {
    coins: spec.coins || 0,
    items: [],
    newCompanion: null
  };

  // Guaranteed companion reward if configured on spec
  if (spec.rewardCompanion) {
    result.newCompanion = rollCompanion();
  }

  if (spec.bonusRollChance && Math.random() < spec.bonusRollChance && spec.bonusLootTable) {
    const table = rewardsConfig.lootTables[spec.bonusLootTable] || [];
    const totalWeight = table.reduce((sum, item) => sum + (item.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    let chosen = null;
    for (const item of table) {
      roll -= (item.weight || 1);
      if (roll <= 0) {
        chosen = item;
        break;
      }
    }

    if (chosen) {
      if (chosen.type === 'coins') {
        result.coins += chosen.amount || 10;
      } else if (chosen.type === 'companion') {
        result.newCompanion = rollCompanion();
      } else if (chosen.type === 'item') {
        const itemId = pickPoolItem(chosen.pool);
        if (itemId) result.items.push({ id: itemId });
      }
    }
  }

  return result;
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

export function applyReward(game, reward) {
  if (!reward || !game?.player) return [];
  const notifications = [];
  const player = game.player;

  // 1. Coins
  const coins = Number.isFinite(reward.coins) && reward.coins > 0 ? reward.coins : 0;
  if (coins > 0) {
    player.coins = (player.coins || 0) + coins;
    notifications.push(`+${coins} 🪙`);
  }

  // 2. Lucky Clover bonus (player's own gear only; added once per reward)
  const cloverBonus = Math.max(0, Math.floor(resolveFx(player).stats.coinBonus));
  if (cloverBonus > 0) {
    player.coins = (player.coins || 0) + cloverBonus;
    notifications.push(`+${cloverBonus} 🪙 🍀`);
  }

  // 3. Item rewards
  if (Array.isArray(reward.items) && reward.items.length) {
    if (!Array.isArray(player.inventory)) {
      player.inventory = [];
    }
    for (const spec of reward.items) {
      const instance = addItemReward(player.inventory, spec);
      if (!instance) continue;
      notifications.push(`Got ${instance.name || instance.id}!`);
    }
  }

  // 4. New Companion
  if (reward.newCompanion) {
    const activePlayerCompanions = game.getCompanionsFor('player');
    if (activePlayerCompanions.length < 3) {
      // Add directly as active companion
      const comp = game.makeCompanion(reward.newCompanion, game.player);
      game.companions.push(comp);
      notifications.push(`New companion: ${reward.newCompanion.name}!`);
    } else {
      // Stabled / Party reserve
      if (!Array.isArray(game.player.stabledCompanions)) {
        game.player.stabledCompanions = [];
      }
      game.player.stabledCompanions.push(reward.newCompanion);
      notifications.push(`New companion added to your collection: ${reward.newCompanion.name}!`);
    }
  }

  return notifications;
}
