import rewardsConfig from '../data/rewards.json' with { type: 'json' };
import { createCompanionRecipe } from './avatar.js';
import { COMPANION_NAMES } from './names.js';

export function rollReward(game, gameType, outcome) {
  const spec = rewardsConfig.miniGames?.[gameType]?.[outcome];
  if (!spec) return null;

  const result = {
    coins: spec.coins || 0,
    items: [],
    newCompanion: null
  };

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
        const name = COMPANION_NAMES[Math.floor(Math.random() * COMPANION_NAMES.length)];
        const recipe = createCompanionRecipe();
        result.newCompanion = {
          id: `comp-${Math.random().toString(36).slice(2, 9)}`,
          name,
          recipe,
          buddyId: 'player'
        };
      }
    }
  }

  return result;
}

export function applyReward(game, reward) {
  if (!reward || !game?.player) return [];
  const notifications = [];

  // 1. Coins
  if (reward.coins > 0) {
    game.player.coins = (game.player.coins || 0) + reward.coins;
    notifications.push(`+${reward.coins} 🪙`);
  }

  // 2. New Companion
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
