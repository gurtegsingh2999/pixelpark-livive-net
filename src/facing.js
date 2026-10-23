export const DOWN = 0;
export const RIGHT = 1;
export const UP = 2;
export const LEFT = 3;

export function directionForStep(dx, dy) {
  if (dy > 0) return DOWN;
  if (dx > 0) return RIGHT;
  if (dy < 0) return UP;
  return LEFT;
}

// Voxel Art characters face slightly left by default, so only a rightward
// step is mirrored.
export function shouldMirror(direction) {
  return direction === RIGHT;
}
