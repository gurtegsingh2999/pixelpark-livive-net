import { Style, Avatar } from '@dicebear/core';
import definition from '@dicebear/styles/voxel-art.json';

const style = new Style(definition);

export function createVoxelAvatar(options = {}) {
  return new Avatar(style, options).toString();
}

export { style as voxelArtStyle };
