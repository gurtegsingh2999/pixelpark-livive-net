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
