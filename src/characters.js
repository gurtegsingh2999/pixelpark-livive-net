export function occupantAtTile(characters, x, y, exclude = null) {
  return characters.find(character => character !== exclude && character.x === x && character.y === y) || null;
}

export function reservationAtTile(characters, x, y, exclude = null) {
  for (const character of characters) {
    if (character === exclude) continue;
    if (character.x === x && character.y === y) return character;
    if (character.moving && character.toX === x && character.toY === y) return character;
  }
  return null;
}

export function formatCompanionInfo(companion) {
  const style = companion?.recipe?.style || '';
  const pets = ['dog', 'cat', 'chicken', 'chick', 'horse', 'pig', 'sheep', 'wolf', 'raccoon', 'hedgehog'];
  const creatures = ['yeti', 'demon', 'goblin', 'giant', 'skeleton', 'skeleton-armor', 'skeleton_armor', 'zombie', 'wizard'];
  const name = companion?.name || 'Buddy';

  let compClass = 'Companion';
  let compType = style ? style.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Companion';

  if (pets.includes(style)) {
    compClass = 'Pet';
    compType = style.charAt(0).toUpperCase() + style.slice(1);
  } else if (creatures.includes(style)) {
    compClass = 'Creature';
    compType = style.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } else if (style === 'voxel-bot') {
    compClass = 'Voxel Bot';
    compType = 'Robot';
  } else if (style === 'gaze') {
    compClass = 'Digi-Buddy';
    compType = 'Hologram';
  } else if (style === 'critters') {
    compClass = 'Critter';
    compType = 'Blob';
  }

  return {
    name,
    class: compClass,
    type: compType,
    text: `${name}, ${compClass}, ${compType}`
  };
}
