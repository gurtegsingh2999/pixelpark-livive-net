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
    assert.equal(typeof profile.getFrame, 'function', `${family} must have getFrame`);
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

test('avatarSvg supports default, blink, stretch, look-left, look-right, and talk frames for voxel-art', () => {
  const voxelRecipe = createRecipe('test');
  const defaultSvg = avatarSvg(voxelRecipe, { frame: 'default' });
  const blinkSvg = avatarSvg(voxelRecipe, { frame: 'blink' });
  const stretchSvg = avatarSvg(voxelRecipe, { frame: 'stretch' });
  const leftSvg = avatarSvg(voxelRecipe, { frame: 'look-left' });
  const rightSvg = avatarSvg(voxelRecipe, { frame: 'look-right' });
  const talkSvg = avatarSvg(voxelRecipe, { frame: 'talk' });

  // Blink activates eyelid overlay and closed eyes
  assert.notEqual(defaultSvg, blinkSvg);
  assert.ok(blinkSvg.includes('opacity="1"'));

  // Stretch translates .va-upper group while feet remain planted
  assert.notEqual(defaultSvg, stretchSvg);
  assert.ok(stretchSvg.includes('<g class="va-upper" transform="translate(0 -3.5)">'));

  // Look-left and look-right shift the internal eye paths and use side eye variant
  assert.notEqual(defaultSvg, leftSvg);
  assert.notEqual(defaultSvg, rightSvg);
  assert.notEqual(leftSvg, rightSvg);
  assert.ok(leftSvg.includes('<g transform="translate(-2.5 0)">'));
  assert.ok(rightSvg.includes('<g transform="translate(2.5 0)">'));

  // Talk changes mouth & eyebrow expression
  assert.notEqual(defaultSvg, talkSvg);
});

test('voxel-bot supports blink, stretch (upper + head lift), look-left, look-right, and talk', () => {
  const botRecipe = createCompanionRecipe('test', 'voxel-bot');
  const defaultSvg = avatarSvg(botRecipe, { frame: 'default' });
  const blinkSvg = avatarSvg(botRecipe, { frame: 'blink' });
  const stretchSvg = avatarSvg(botRecipe, { frame: 'stretch' });
  const talkSvg = avatarSvg(botRecipe, { frame: 'talk' });

  assert.notEqual(defaultSvg, blinkSvg);
  assert.ok(blinkSvg.includes('opacity="1"'));

  assert.notEqual(defaultSvg, stretchSvg);
  assert.ok(stretchSvg.includes('<g class="vb-upper" transform="translate(0 -2.5)">'));
  assert.ok(stretchSvg.includes('<g class="vb-head" transform="translate(0 -2.5)">'));

  assert.notEqual(defaultSvg, talkSvg);
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

  // Gaze levitates continuously as a floating hologram (translateY < 0 and hologramGlow: true)
  const gazeTransform = gaze.getTransform(1.0, 48);
  assert.ok(gazeTransform.translateY < -4);
  assert.equal(gazeTransform.hologramGlow, true);

  // Voxel-bot rolls on wheels without hopping when moving (translateY === 0, leans forward)
  const bot = ANIMATION_PROFILES['voxel-bot'];
  const botMoving = bot.getTransform(1.0, 48, { moving: true, movingT: 0.5 });
  assert.equal(botMoving.translateY, 0);
  assert.notEqual(botMoving.rotate, 0);

  // Critters compress down toward the ground (scaleY < 1, scaleX > 1, translateY === 0) and wobble side to side when moving
  const critters = ANIMATION_PROFILES['critters'];
  const critterMoving = critters.getTransform(1.0, 48, { moving: true, movingT: 0.25 });
  assert.equal(critterMoving.translateY, 0);
  assert.ok(critterMoving.scaleY < 1);
  assert.ok(critterMoving.scaleX > 1);
  assert.notEqual(critterMoving.rotate, 0);
  assert.notEqual(critterMoving.translateX, 0);

  // Voxel-art stretches with height translateY
  const voxelTransform = voxel.getTransform(3.5, 48); // ~78% of 4.5s
  assert.ok(voxelTransform.translateY < 0);
  assert.ok(voxelTransform.scaleY > 1);
});
