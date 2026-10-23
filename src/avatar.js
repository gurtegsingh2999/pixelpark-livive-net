import { createVoxelAvatar } from '../vendor/dicebear-voxel.js';
import { makeSeed } from './world.js';

export const TOP_VARIANTS = [
  'afro', 'animalEars', 'beanie', 'bob', 'bowl', 'braids', 'bunnyEars', 'buns',
  'cap', 'curly', 'halfShaved', 'longStraight', 'longWavy', 'mohawk', 'partedLong',
  'ponytail', 'short', 'shoulderLength', 'sideSwept', 'spiky', 'twinTails'
];

export const OUTFIT_VARIANTS = [
  'checker', 'coat', 'dress', 'hoodie', 'jacket', 'overalls', 'plain', 'stripes', 'suit', 'tie'
];

export const GLASSES_VARIANTS = ['cat', 'round', 'shades', 'square', 'visor'];
export const BEARD_VARIANTS = ['full', 'goatee', 'mustache', 'stubble'];

export const COLOR_PALETTES = {
  skin: ['#f4d7bd', '#edc2a0', '#d9a279', '#c08457', '#9b6238', '#74452a', '#4f2d1c'],
  hair: ['#241a14', '#4a2f20', '#7a4a2a', '#b47a3f', '#d9ad62', '#e8d8b0', '#c7c7c7', '#8a3a2a', '#3f4a63', '#b34f6b'],
  shirt: ['#f76707', '#e8590c', '#12b886', '#0ca678', '#1c7ed6', '#3b5bdb', '#7048e8', '#d6336c', '#f59f00', '#495057', '#f1f3f5'],
  pants: ['#2f4160', '#343a40', '#495057', '#6741d9', '#1864ab', '#087f5b', '#846358', '#212529'],
  shoes: ['#6741d9', '#e8590c', '#2f4160', '#f1f3f5', '#c92a2a', '#1864ab', '#212529']
};

export const LOOK_KEYS = ['top', 'outfit', 'glasses', 'beard', 'skin', 'hair', 'shirt', 'pants', 'shoes'];

const RANDOM = 'random';
const NONE = 'none';

export function createRecipe(seed = makeSeed(), look = {}) {
  return {
    seed: String(seed),
    look: Object.fromEntries(LOOK_KEYS.map(key => [key, look[key] || RANDOM]))
  };
}

export function cloneRecipe(recipe) {
  return createRecipe(recipe.seed, recipe.look);
}

export function rerollRecipe(recipe) {
  return createRecipe(makeSeed(), recipe.look);
}

export function canonicalRecipe(recipe) {
  return JSON.stringify({
    seed: recipe.seed,
    look: Object.fromEntries(LOOK_KEYS.map(key => [key, recipe.look?.[key] || RANDOM]))
  });
}

function recipeOptions(recipe) {
  const look = recipe.look || {};
  const options = {
    seed: recipe.seed || 'park',
    size: 320,
    backgroundColor: [],
    animationProbability: 0,
    borderRadius: 0
  };

  if (look.top === NONE) options.topProbability = 0;
  else if (look.top && look.top !== RANDOM) {
    options.topVariant = [look.top];
    options.topProbability = 100;
  }

  if (look.outfit && look.outfit !== RANDOM) {
    options.outfitVariant = [look.outfit];
    options.outfitProbability = 100;
  }

  if (look.glasses === NONE) options.glassesProbability = 0;
  else if (look.glasses && look.glasses !== RANDOM) {
    options.glassesVariant = [look.glasses];
    options.glassesProbability = 100;
  }

  if (look.beard === NONE) options.beardProbability = 0;
  else if (look.beard && look.beard !== RANDOM) {
    options.beardVariant = [look.beard];
    options.beardProbability = 100;
  }

  for (const key of ['skin', 'hair', 'shirt', 'pants', 'shoes']) {
    const color = look[key];
    if (color && color !== RANDOM) options[`${key}Color`] = [color];
  }

  return options;
}

const svgCache = new Map();
const imageCache = new Map();

export function avatarSvg(recipe) {
  const key = canonicalRecipe(recipe);
  if (!svgCache.has(key)) {
    svgCache.set(key, createVoxelAvatar(recipeOptions(recipe)));
  }
  return svgCache.get(key);
}

export function avatarDataUrl(recipe) {
  const key = canonicalRecipe(recipe);
  if (!imageCache.has(key)) imageCache.set(key, {});
  const entry = imageCache.get(key);
  if (!entry.url) {
    entry.url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(recipe))}`;
  }
  return entry.url;
}

export function getAvatarImage(recipe) {
  return imageCache.get(canonicalRecipe(recipe))?.image || null;
}

export function loadAvatarImage(recipe) {
  const key = canonicalRecipe(recipe);
  if (!imageCache.has(key)) imageCache.set(key, {});
  const entry = imageCache.get(key);
  if (entry.promise) return entry.promise;

  entry.promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      entry.image = image;
      resolve(image);
    };
    image.onerror = () => reject(new Error('Could not render avatar'));
    image.src = avatarDataUrl(recipe);
  });

  return entry.promise;
}

export async function preloadAvatars(recipes) {
  const unique = new Map();
  for (const recipe of recipes) unique.set(canonicalRecipe(recipe), recipe);
  const results = await Promise.allSettled([...unique.values()].map(loadAvatarImage));
  return results.filter(result => result.status === 'fulfilled').length;
}

export function drawAvatar(ctx, image, x, top, width, height, flip = false, alpha = 1) {
  if (!image) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip) {
    ctx.translate(x + width / 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, -width / 2, top, width, height);
  } else {
    ctx.drawImage(image, x, top, width, height);
  }
  ctx.restore();
}

export function prettyLabel(value) {
  if (!value) return '';
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, character => character.toUpperCase());
}
