import { applyNpcReward, rollNpcReward } from '../rewards.js';
import { autoEquipOwner } from './loadout.js';

/**
 * Runtime glue for the NPC economy.
 *
 * NPC-vs-NPC games settle through this module only: the winner rolls the
 * `npcMiniGames` table, receives coins/items/companions on their own record,
 * and then auto-equips new gear on themselves or an active buddy. Player
 * rewards, stats, dialogue, and cheer are never touched here.
 */

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlayerOwner(owner) {
  return Boolean(owner && (owner.isPlayer === true || owner.id === 'player'));
}

function activeCompanionsFor(game, ownerId) {
  if (typeof game?.getCompanionsFor === 'function') {
    const list = game.getCompanionsFor(ownerId);
    if (Array.isArray(list)) return list;
  }
  return Array.isArray(game?.companions)
    ? game.companions.filter(comp => comp && comp.buddyId === ownerId)
    : [];
}

/**
 * Award one NPC game result to a single winner.
 *
 * Draws are handled by the caller with one call per participant and
 * `outcome: 'draw'`; this helper intentionally settles only one owner.
 * Unknown games, missing owners, and player owners fail softly instead of
 * throwing so a bad result callback can never break the runtime.
 *
 * @param {object} input
 * @param {object} input.game live Game-like object (player, companions, makeCompanion)
 * @param {object} input.winner NPC character record
 * @param {object|null} [input.loser]
 * @param {string} input.gameId mini-game id, e.g. 'tic-tac-toe'
 * @param {string} input.outcome `'win'`, `'loss'`, or `'draw'`
 * @param {number} [input.now] effect timestamp in ms
 * @param {() => number} [input.random] deterministic random for tests
 */
export function awardNpcGame({
  game = null,
  winner = null,
  loser = null,
  gameId = null,
  outcome = 'win',
  now = 0,
  random
} = {}) {
  if (!isObject(winner)) return { ok: false, reason: 'no-winner' };
  if (!isObject(game)) return { ok: false, reason: 'no-game' };
  if (isPlayerOwner(winner)) return { ok: false, reason: 'player-owner' };
  if (typeof gameId !== 'string' || !gameId) return { ok: false, reason: 'no-game-id' };

  const reward = rollNpcReward(game, winner, gameId, outcome, { random });
  if (!reward) return { ok: false, reason: 'no-reward' };

  const notices = applyNpcReward(game, winner, reward);
  const loadout = autoEquipOwner(
    winner,
    activeCompanionsFor(game, winner.id),
    { now: Number.isFinite(now) ? now : 0 }
  );

  return {
    ok: true,
    winner,
    loser: isObject(loser) ? loser : null,
    reward,
    notices,
    equipped: loadout.equipped,
    skipped: loadout.skipped,
    moved: loadout.moved
  };
}
