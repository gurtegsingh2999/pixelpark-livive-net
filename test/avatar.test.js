import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipe,
  rerollRecipe,
  canonicalRecipe,
  avatarSvg,
  avatarDataUrl,
  TOP_VARIANTS,
  OUTFIT_VARIANTS,
  COLOR_PALETTES
} from '../src/avatar.js';

test('recipes are complete and stable', () => {
  const recipe = createRecipe('Fern');
  assert.equal(recipe.seed, 'Fern');
  assert.equal(Object.keys(recipe.look).length, 9);
  assert.equal(canonicalRecipe(recipe), canonicalRecipe({ seed: recipe.seed, look: { ...recipe.look } }));
  assert.ok(TOP_VARIANTS.length > 0);
  assert.ok(OUTFIT_VARIANTS.length > 0);
  assert.ok(COLOR_PALETTES.skin.length > 0);
});

test('the same recipe produces the same SVG', () => {
  const recipe = createRecipe('same-seed', { top: 'short', outfit: 'hoodie', shirt: '#f76707' });
  assert.equal(avatarSvg(recipe), avatarSvg(createRecipe('same-seed', { top: 'short', outfit: 'hoodie', shirt: '#f76707' })));
});

test('rerolling keeps the look but changes the seed', () => {
  const recipe = createRecipe('old-seed', { top: 'bob', glasses: 'round' });
  const rerolled = rerollRecipe(recipe);
  assert.notEqual(rerolled.seed, recipe.seed);
  assert.deepEqual(rerolled.look, recipe.look);
});

test('avatars are generated with a transparent background', () => {
  const svg = avatarSvg(createRecipe('transparent'));
  assert.match(svg, /viewBox="0 0 128 128"/);
  assert.match(svg, /width="320"/);
  assert.doesNotMatch(svg, /<rect width="\d+" height="\d+" fill="#[0-9a-fA-F]{6}"/);
  assert.ok(svg.includes('125.2'), 'the built-in ground shadow is kept');
});

test('look overrides change the rendered avatar', () => {
  const plain = avatarSvg(createRecipe('override', { top: 'none', outfit: 'plain', glasses: 'none', beard: 'none' }));
  const styled = avatarSvg(createRecipe('override', { top: 'afro', outfit: 'suit', glasses: 'shades', beard: 'full' }));
  assert.notEqual(plain, styled);
});

test('data URLs are self-contained', () => {
  const url = avatarDataUrl(createRecipe('data-url'));
  assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.ok(url.length > 1000);
});
