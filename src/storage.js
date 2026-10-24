import { decodeTerrain, encodeTerrain } from './world.js';

export const STORAGE_KEY = 'playpark.save.v1';
export const STATS_KEY = 'playpark.stats.v1';

export function serializeSave(game, draft, friends) {
  if (!game?.terrain || !game.player || !draft) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    worldSeed: game.worldSeed,
    terrain: encodeTerrain(game.terrain),
    playerName: game.player.name,
    playerRecipe: game.player.recipe,
    player: {
      x: game.player.x,
      y: game.player.y,
      direction: game.player.direction,
      inventory: game.player.inventory || []
    },
    npcs: game.npcs.map(npc => ({
      id: npc.id,
      name: npc.name,
      recipe: npc.recipe,
      vibe: npc.vibe,
      x: npc.x,
      y: npc.y,
      direction: npc.direction,
      inventory: npc.inventory || []
    })),
    companions: (game.companions || []).map(comp => ({
      id: comp.id,
      name: comp.name,
      buddyId: comp.buddyId,
      recipe: comp.recipe,
      x: comp.x,
      y: comp.y,
      direction: comp.direction
    })),
    friends: [...friends],
    wander: game.wander
  };
}

export function saveState(state) {
  if (!state) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Saving is a convenience; the playground still works without it.
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (state?.version !== 1 || !state.playerRecipe || !decodeTerrain(state.terrain)) return null;
    return state;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) {
      return {
        totalWins: 0,
        totalLosses: 0,
        totalDraws: 0,
        friends: {}
      };
    }
    const data = JSON.parse(raw);
    return {
      totalWins: Number(data.totalWins) || 0,
      totalLosses: Number(data.totalLosses) || 0,
      totalDraws: Number(data.totalDraws) || 0,
      friends: data.friends && typeof data.friends === 'object' ? data.friends : {}
    };
  } catch {
    return { totalWins: 0, totalLosses: 0, totalDraws: 0, friends: {} };
  }
}

export function recordGameResult({ opponentId, opponentName, result }) {
  const stats = loadStats();
  if (result === 'win') stats.totalWins++;
  else if (result === 'loss') stats.totalLosses++;
  else if (result === 'draw') stats.totalDraws++;

  if (opponentId) {
    if (!stats.friends[opponentId]) {
      stats.friends[opponentId] = {
        name: opponentName || 'Neighbour',
        wins: 0,
        losses: 0,
        draws: 0
      };
    }
    if (opponentName) stats.friends[opponentId].name = opponentName;
    if (result === 'win') stats.friends[opponentId].wins++;
    else if (result === 'loss') stats.friends[opponentId].losses++;
    else if (result === 'draw') stats.friends[opponentId].draws++;
  }

  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Ignore storage errors
  }
  return stats;
}
