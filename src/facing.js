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

// Direction & Facing Orientation Conventions:
// - Voxel Art characters & Cube World pet models are authored to face STAGE / SCREEN LEFT by default
//   (their nose / snout points towards -X in screen coordinates).
// - "Model Left" vs "Stage/Camera Left":
//   * Model Left: The character's own left side / anatomical flank (+X in model space).
//   * Stage / Camera Left: The viewer's left side of the screen (-X in canvas / screen space).
//   * Because the model faces Stage Left, the character is looking towards the viewer's left.
// - Forward-facing (facing camera):
//   * DOWN (0) and LEFT (3) use the unmirrored front sprite (facing front stage-left).
//   * RIGHT (1) mirrors the front sprite horizontally (facing front stage-right).
// - Reverse-facing (facing away from camera / walking UP):
//   * UP (2) uses the reverse 3D view (yaw = 135°, facing back stage-left).
//   * When facing UP and turning right, horizontal mirroring produces back stage-right.
// - Only RIGHT (1) movement mirrors the sprite horizontally so the character turns to face screen-right.
export function shouldMirror(direction) {
  return direction === RIGHT;
}
