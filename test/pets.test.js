import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionRecipe, canonicalRecipe, avatarSvg, avatarDataUrl, CUBEWORLD_PETS } from '../src/avatar.js';
import { getAnimationProfile } from '../src/animation.js';

test('CUBEWORLD_PETS includes all 9 Quaternius animals', () => {
  const expected = ['dog', 'cat', 'chicken', 'chick', 'horse', 'pig', 'sheep', 'wolf', 'raccoon'];
  for (const pet of expected) {
    assert.ok(CUBEWORLD_PETS.includes(pet), `Expected pet ${pet} in CUBEWORLD_PETS`);
  }
});

test('createCompanionRecipe supports pet styles and renders valid data URLs', () => {
  for (const pet of CUBEWORLD_PETS) {
    const recipe = createCompanionRecipe('seed-123', pet);
    assert.equal(recipe.isCompanion, true);
    assert.equal(recipe.style, pet);

    // Default frame
    const defaultUrl = avatarDataUrl(recipe, { frame: 'default' });
    assert.ok(defaultUrl.startsWith('data:image/png;base64,'));

    // Walk and cheer frames
    const walk1Url = avatarDataUrl(recipe, { frame: 'walk1' });
    const cheerUrl = avatarDataUrl(recipe, { frame: 'cheer' });
    assert.ok(walk1Url.startsWith('data:image/png;base64,'));
    assert.ok(cheerUrl.startsWith('data:image/png;base64,'));
    assert.notEqual(walk1Url, cheerUrl);

    // SVG wrapper for UI embedding
    const svg = avatarSvg(recipe);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('image href="data:image/png;base64,'));
  }
});

test('pet animation profiles have custom quadruped / avian locomotion', () => {
  const dogProfile = getAnimationProfile({ isCompanion: true, style: 'dog' });
  assert.equal(dogProfile.family, 'pet-dog');
  assert.equal(dogProfile.frames.includes('walk1'), true);

  const movingTransform = dogProfile.getTransform(1.0, 48, { moving: true, movingT: 0.5 });
  assert.ok(movingTransform.translateY < 0); // Trot hop

  const chickenProfile = getAnimationProfile({ isCompanion: true, style: 'chicken' });
  assert.equal(chickenProfile.family, 'pet-chicken');
  const chickenMoving = chickenProfile.getTransform(1.0, 48, { moving: true, movingT: 0.25 });
  assert.notEqual(chickenMoving.rotate, 0); // Head peck tilt
});
