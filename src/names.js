export const NPC_NAMES = [
  'Pip', 'Moss', 'Juniper', 'Bramble', 'Clover', 'Fern', 'Pebble', 'Wren', 'Ash', 'Rowan',
  'Maple', 'Sorrel', 'Nettle', 'Poppy', 'Basil', 'Hazel', 'Olive', 'Ivy', 'Rook', 'Sage',
  'Tansy', 'Thistle', 'Cricket', 'Dune', 'Ember', 'Fig', 'Ginger', 'Hollis', 'Indigo', 'Jory',
  'Kite', 'Lark', 'Marlow', 'Nim', 'Otter', 'Perry', 'Quill', 'Rue', 'Sable', 'Tilly',
  'Umi', 'Vale', 'Willa', 'Yarrow', 'Zinnia', 'Biscuit', 'Cobb', 'Dottie', 'Echo', 'Fable',
  'Gus', 'Hattie', 'Ink', 'Juno', 'Kip', 'Lumen', 'Mica', 'Nori', 'Opal', 'Pickle'
];

export const PLAYER_NAMES = [
  'Alex', 'Sam', 'Riley', 'Morgan', 'Jamie', 'Avery', 'Quinn', 'Charlie', 'Robin', 'Sasha',
  'Casey', 'Drew', 'Ellis', 'Frankie', 'Harper', 'Jules', 'Kai', 'Lane', 'Nico', 'Reese'
];

export const VIBES = [
  'Collects interesting sticks.',
  'Knows every duck by name.',
  'Always has a snack in their pocket.',
  'Is convinced the pond is haunted.',
  'Can name seventeen types of cloud.',
  'Organizes the park benches by mood.',
  'Walks everywhere at a very confident pace.',
  'Keeps a tiny notebook of good spots.',
  'Has strong opinions about gravel.',
  'Is building something out of leaves.',
  'Says hello to every tree.',
  'Once found a very important pebble.',
  'Likes to stand exactly where the path bends.',
  'Is on a personal quest for the perfect bench.',
  'Claims they can hear the flowers growing.',
  'Will trade stories for lemonade.',
  'Never has a map but is never lost.',
  'Is secretly training for a walking race.',
  'Waves at people who are not there yet.',
  'Believes every puddle is a small lake.'
];

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
