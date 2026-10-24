import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATION_PROFILES, getAnimationProfile } from '../src/animation.js';
import { createRecipe, createCompanionRecipe, avatarSvg } from '../src/avatar.js';

test('ANIMATION_PROFILES defines distinct isolated animations for each family', () => {
  const families = ['voxel-art', 'voxel-bot', 'clay', 'critters', 'gaze', 'sprouts'];
  for (const family of families) {
    const profile = ANIMATION_PROFILES[family];
    assert.ok(profile, `Profile for ${family} must exist`);
    assert.equal(typeof profile.getTransform, 'function', `${family} must have getTransform`);
    assert.equal(typeof profile.isBlinking, 'function', `${family} must have isBlinking`);
    assert.equal(typeof profile.makeFrameSvg, 'function', `${family} must have makeFrameSvg`);
  }
});

test('getAnimationProfile selects correct family profile from recipes', () => {
  const player = createRecipe('test');
  assert.equal(getAnimationProfile(player).family, 'voxel-art');

  const bot = createCompanionRecipe('test', 'voxel-bot');
  assert.equal(getAnimationProfile(bot).family, 'voxel-bot');

  const critter = createCompanionRecipe('test', 'critters');
  assert.equal(getAnimationProfile(critter).family, 'critters');
});

test('avatarSvg supports default and blink frames for voxel-art and companions', () => {
  const voxelRecipe = createRecipe('test');
  const defaultVoxelSvg = avatarSvg(voxelRecipe, { frame: 'default' });
  const blinkVoxelSvg = avatarSvg(voxelRecipe, { frame: 'blink' });
  assert.notEqual(defaultVoxelSvg, blinkVoxelSvg);
  assert.ok(blinkVoxelSvg.includes('opacity="1"'));

  const botRecipe = createCompanionRecipe('test', 'voxel-bot');
  const defaultBotSvg = avatarSvg(botRecipe, { frame: 'default' });
  const blinkBotSvg = avatarSvg(botRecipe, { frame: 'blink' });
  assert.notEqual(defaultBotSvg, blinkBotSvg);
  assert.ok(blinkBotSvg.includes('opacity="1"'));
});

test('voxel-art supports gaze directions: look-left and look-right', () => {
  const voxelRecipe = createRecipe('test');
  const defaultSvg = avatarSvg(voxelRecipe, { frame: 'default' });
  const leftSvg = avatarSvg(voxelRecipe, { frame: 'look-left' });
  const rightSvg = avatarSvg(voxelRecipe, { frame: 'look-right' });

  assert.notEqual(defaultSvg, leftSvg);
  assert.notEqual(defaultSvg, rightSvg);
  assert.notEqual(leftSvg, rightSvg);
  assert.ok(leftSvg.includes('translate(26.5 49)'));
  assert.ok(rightSvg.includes('translate(31.5 49)'));
});

test('family animation profiles have different transforms and loops', () => {
  const gaze = ANIMATION_PROFILES['gaze'];
  const sprouts = ANIMATION_PROFILES['sprouts'];
  const clay = ANIMATION_PROFILES['clay'];
  const voxel = ANIMATION_PROFILES['voxel-art'];

  // Sprouts sways with rotation
  const sproutsTransform = sprouts.getTransform(1.1, 48);
  assert.notEqual(sproutsTransform.rotate, 0);

  // Clay jiggles and squashes
  const clayTransform = clay.getTransform(0.95, 48);
  assert.notEqual(clayTransform.scaleY, 1);

  // Gaze hops with translateY
  const gazeTransform = gaze.getTransform(3.8, 48); // ~73% of 5.2s
  assert.ok(gazeTransform.translateY < 0);

  // Voxel-art stretches with height translateY
  const voxelTransform = voxel.getTransform(4.8, 48); // ~87% of 5.5s
  assert.ok(voxelTransform.translateY < 0);
  assert.ok(voxelTransform.scaleY > 1);
});
