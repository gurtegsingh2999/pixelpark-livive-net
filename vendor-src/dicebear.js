import { Style, Avatar } from '@dicebear/core';
import voxelDef from '@dicebear/styles/voxel-art.json';
import clayDef from '@dicebear/styles/clay.json';
import crittersDef from '@dicebear/styles/critters.json';
import gazeDef from '@dicebear/styles/gaze.json';
import sproutsDef from '@dicebear/styles/sprouts.json';
import voxelBotDef from '@dicebear/styles/voxel-bot.json';

const voxelArtStyle = new Style(voxelDef);
const styles = {
  'voxel-art': voxelArtStyle,
  'clay': new Style(clayDef),
  'critters': new Style(crittersDef),
  'gaze': new Style(gazeDef),
  'sprouts': new Style(sproutsDef),
  'voxel-bot': new Style(voxelBotDef)
};

export function createVoxelAvatar(options = {}) {
  const opts = { tags: ['animation'], ...options };
  return new Avatar(voxelArtStyle, opts).toString();
}

export function createCompanionAvatar(styleName, options = {}) {
  const s = styles[styleName] || styles['critters'];
  const opts = { tags: ['animation'], ...options };
  return new Avatar(s, opts).toString();
}

export { voxelArtStyle, styles };
