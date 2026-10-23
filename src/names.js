import entityData from '../data/entities.json' with { type: 'json' };

export const NPC_NAMES = entityData.npcNames;
export const PLAYER_NAMES = entityData.playerNames;
export const COMPANION_NAMES = entityData.companionNames || [];
export const VIBES = entityData.vibes;

export function pickName(used, source = NPC_NAMES, random = Math.random) {
  const remaining = source.filter(name => !used.has(name));
  const pool = remaining.length ? remaining : source;
  const name = pool[Math.floor(random() * pool.length)];
  let unique = name;
  let suffix = 2;
  while (used.has(unique)) unique = `${name} ${suffix++}`;
  used.add(unique);
  return unique;
}

export function pickVibe(random = Math.random) {
  return VIBES[Math.floor(random() * VIBES.length)];
}
