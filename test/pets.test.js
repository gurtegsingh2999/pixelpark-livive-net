import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompanionRecipe,
  canonicalRecipe,
  avatarSvg,
  avatarDataUrl,
  CUBEWORLD_PETS,
  CUBEWORLD_CREATURES
} from '../src/avatar.js';
import { getAnimationProfile } from '../src/animation.js';

test('CUBEWORLD_PETS includes all 10 animals including hedgehog', () => {
  const expected = ['dog', 'cat', 'chicken', 'chick', 'horse', 'pig', 'sheep', 'wolf', 'raccoon', 'hedgehog'];
  for (const pet of expected) {
    assert.ok(CUBEWORLD_PETS.includes(pet), `Expected pet ${pet} in CUBEWORLD_PETS`);
  }
});

test('CUBEWORLD_CREATURES includes all 8 creature companions', () => {
  const expected = ['yeti', 'demon', 'goblin', 'giant', 'skeleton', 'skeleton-armor', 'zombie', 'wizard'];
  for (const creature of expected) {
    assert.ok(CUBEWORLD_CREATURES.includes(creature), `Expected creature ${creature} in CUBEWORLD_CREATURES`);
  }
});

test('createCompanionRecipe supports pet and creature styles and renders valid data URLs', () => {
  for (const style of [...CUBEWORLD_PETS, ...CUBEWORLD_CREATURES]) {
    const recipe = createCompanionRecipe('seed-123', style);
    assert.equal(recipe.isCompanion, true);
    assert.equal(recipe.style, style);

    // Default frame
    const defaultUrl = avatarDataUrl(recipe, { frame: 'default' });
    assert.ok(defaultUrl.startsWith('data:image/png;base64,'));

    // Walk and cheer frames
    const walk1Url = avatarDataUrl(recipe, { frame: 'walk1' });
    const cheerUrl = avatarDataUrl(recipe, { frame: 'cheer' });
    const backWalkUrl = avatarDataUrl(recipe, { frame: 'back_walk1' });
    assert.ok(walk1Url.startsWith('data:image/png;base64,'));
    assert.ok(cheerUrl.startsWith('data:image/png;base64,'));
    assert.ok(backWalkUrl.startsWith('data:image/png;base64,'));
    assert.notEqual(walk1Url, cheerUrl);
    assert.notEqual(walk1Url, backWalkUrl);

    // SVG wrapper for UI embedding
    const svg = avatarSvg(recipe);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('image href="data:image/png;base64,'));
  }
});

test('pet and creature animation profiles have custom locomotion', () => {
  const dogProfile = getAnimationProfile({ isCompanion: true, style: 'dog' });
  assert.equal(dogProfile.family, 'pet-dog');
  assert.equal(dogProfile.frames.includes('walk1'), true);

  const movingTransform = dogProfile.getTransform(1.0, 48, { moving: true, movingT: 0.5 });
  assert.ok(movingTransform.translateY < 0); // Trot hop

  const hedgehogProfile = getAnimationProfile({ isCompanion: true, style: 'hedgehog' });
  assert.equal(hedgehogProfile.family, 'pet-hedgehog');

  const yetiProfile = getAnimationProfile({ isCompanion: true, style: 'yeti' });
  assert.equal(yetiProfile.family, 'creature-yeti');
  assert.equal(yetiProfile.frames.includes('back_walk1'), true);

  const chickenProfile = getAnimationProfile({ isCompanion: true, style: 'chicken' });
  assert.equal(chickenProfile.family, 'pet-chicken');
  const chickenMoving = chickenProfile.getTransform(1.0, 48, { moving: true, movingT: 0.25 });
  assert.notEqual(chickenMoving.rotate, 0); // Head peck tilt
});
