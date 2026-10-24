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

/**
 * Checks whether an moving entity (mover) can collide with or is blocked by an obstacle entity.
 *
 * Collision exclusion rules:
 * - Walking NPCs are NOT blocked by companions (an NPC can walk through a companion).
 * - Companions ARE blocked by NPCs, the player, and other companions (companions cannot walk through NPCs).
 * - Players and NPCs are blocked by other NPCs.
 * - Players bump into companions (initiates dialogue).
 */
export function canCollide(mover, obstacle) {
  if (!mover || !obstacle || mover === obstacle) return false;

  // Collision exclusion: An NPC walking is NOT blocked by a companion
  if (!mover.isCompanion && !mover.isPlayer && obstacle.isCompanion) {
    return false;
  }

  // All other combinations collide (companions vs NPCs, companions vs companions, player vs all, NPCs vs NPCs/player)
  return true;
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
