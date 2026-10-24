import { createVoxelAvatar, createCompanionAvatar } from '../vendor/dicebear-voxel.js';
import { makeSeed } from './world.js';
import { getAnimationProfile } from './animation.js';
import petSprites from '../data/cubeworld_pets.json' with { type: 'json' };
import avatarConfig from '../data/avatar_config.json' with { type: 'json' };

export const CUBEWORLD_PETS = avatarConfig.cubeWorldPets;
export const CUBEWORLD_CREATURES = avatarConfig.cubeWorldCreatures;
export const COMPANION_STYLES = [...avatarConfig.companionBaseStyles, ...CUBEWORLD_PETS, ...CUBEWORLD_CREATURES];

export const TOP_VARIANTS = avatarConfig.topVariants;
export const OUTFIT_VARIANTS = avatarConfig.outfitVariants;
export const GLASSES_VARIANTS = avatarConfig.glassesVariants;
export const BEARD_VARIANTS = avatarConfig.beardVariants;
export const COLOR_PALETTES = avatarConfig.colorPalettes;

export const LOOK_KEYS = ['top', 'outfit', 'glasses', 'beard', 'skin', 'hair', 'shirt', 'pants', 'shoes'];

const RANDOM = 'random';
const NONE = 'none';

export function createRecipe(seed = makeSeed(), look = {}) {
  return {
    seed: String(seed),
    look: Object.fromEntries(LOOK_KEYS.map(key => [key, look[key] || RANDOM]))
  };
}

export function createCompanionRecipe(seed = makeSeed(), style) {
  const chosenStyle = style || COMPANION_STYLES[Math.floor(Math.random() * COMPANION_STYLES.length)];
  return {
    isCompanion: true,
    style: chosenStyle,
    seed: String(seed)
  };
}

export function cloneRecipe(recipe) {
  if (recipe.isCompanion) {
    return createCompanionRecipe(recipe.seed, recipe.style);
  }
  return createRecipe(recipe.seed, recipe.look);
}

export function rerollRecipe(recipe) {
  if (recipe.isCompanion) {
    return createCompanionRecipe(makeSeed(), recipe.style);
  }
  return createRecipe(makeSeed(), recipe.look);
}

export function canonicalRecipe(recipe) {
  if (recipe.isCompanion) {
    return JSON.stringify({
      isCompanion: true,
      style: recipe.style,
      seed: recipe.seed
    });
  }
  return JSON.stringify({
    seed: recipe.seed,
    look: Object.fromEntries(LOOK_KEYS.map(key => [key, recipe.look?.[key] || RANDOM]))
  });
}

function recipeOptions(recipe) {
  if (recipe.isCompanion) {
    return {
      seed: recipe.seed || 'companion',
      size: 320,
      backgroundColor: [],
      tags: ['animation'],
      borderRadius: 0
    };
  }

  const look = recipe.look || {};
  const options = {
    seed: recipe.seed || 'park',
    size: 320,
    backgroundColor: [],
    tags: ['animation'],
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

export function avatarSvg(recipe, { frame = 'default' } = {}) {
  const baseKey = canonicalRecipe(recipe);
  const key = `${baseKey}:${frame}`;
  if (!svgCache.has(key)) {
    if (recipe.isCompanion && (CUBEWORLD_PETS.includes(recipe.style) || CUBEWORLD_CREATURES.includes(recipe.style))) {
      // Cube World pets & creatures are pre-rendered into high-res pixel-perfect isometric sprites
      const sprite = petSprites[recipe.style] || petSprites['dog'];
      const dataUrl = sprite[frame] || sprite['default'];
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="320" height="320"><image href="${dataUrl}" width="128" height="128"/></svg>`;
    }

    const profile = getAnimationProfile(recipe);
    const baseOptions = recipeOptions(recipe);
    const frameOptions = (frame !== 'default' && profile.getRecipeFrameOptions)
      ? profile.getRecipeFrameOptions(baseOptions, frame)
      : baseOptions;

    let rawSvg;
    if (recipe.isCompanion) {
      rawSvg = createCompanionAvatar(recipe.style, frameOptions);
    } else {
      rawSvg = createVoxelAvatar(frameOptions);
    }

    if (frame !== 'default' && profile.makeFrameSvg) {
      svgCache.set(key, profile.makeFrameSvg(rawSvg, frame));
    } else {
      svgCache.set(key, rawSvg);
    }
  }
  return svgCache.get(key);
}

export function avatarDataUrl(recipe, { frame = 'default' } = {}) {
  if (recipe?.isCompanion && (CUBEWORLD_PETS.includes(recipe.style) || CUBEWORLD_CREATURES.includes(recipe.style))) {
    const sprite = petSprites[recipe.style] || petSprites['dog'];
    return sprite[frame] || sprite['default'];
  }

  const baseKey = canonicalRecipe(recipe);
  const key = `${baseKey}:${frame}`;
  if (!imageCache.has(key)) imageCache.set(key, {});
  const entry = imageCache.get(key);
  if (!entry.url) {
    entry.url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(recipe, { frame }))}`;
  }
  return entry.url;
}

export function getAvatarImage(recipe, { frame = 'default' } = {}) {
  const key = `${canonicalRecipe(recipe)}:${frame}`;
  return imageCache.get(key)?.image || null;
}

export function loadAvatarImage(recipe, { frame = 'default' } = {}) {
  const key = `${canonicalRecipe(recipe)}:${frame}`;
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
    image.src = avatarDataUrl(recipe, { frame });
  });

  return entry.promise;
}

export async function preloadAvatars(recipes) {
  const unique = new Map();
  for (const recipe of recipes) {
    if (recipe) unique.set(canonicalRecipe(recipe), recipe);
  }
  const promises = [];
  for (const recipe of unique.values()) {
    const profile = getAnimationProfile(recipe);
    const frames = profile.frames || ['default', 'blink'];
    for (const frame of frames) {
      promises.push(loadAvatarImage(recipe, { frame }));
    }
  }
  const results = await Promise.allSettled(promises);
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

// --- Live DOM <img> Avatar Animator ---
// Drives multi-frame animations (blink, look-left, look-right, stretch, talk) on DOM <img> elements
const animatedDomImages = new Map();
let domAnimTimer = null;

function ensureDomAnimLoop() {
  if (domAnimTimer || typeof window === 'undefined') return;
  const start = performance.now();
  domAnimTimer = window.setInterval(() => {
    const t = (performance.now() - start) / 1000;
    for (const [imgEl, state] of animatedDomImages.entries()) {
      if (!imgEl.isConnected) {
        animatedDomImages.delete(imgEl);
        continue;
      }
      const profile = getAnimationProfile(state.recipe);
      const frame = profile.getFrame ? profile.getFrame(t + state.offset) : 'default';
      if (frame !== state.lastFrame) {
        state.lastFrame = frame;
        imgEl.src = avatarDataUrl(state.recipe, { frame });
      }
    }
  }, 140);
}

export function bindAnimatedAvatar(imgEl, recipe, offset = 0) {
  if (!imgEl || !recipe) return;
  imgEl.src = avatarDataUrl(recipe, { frame: 'default' });
  animatedDomImages.set(imgEl, { recipe, offset, lastFrame: 'default' });
  ensureDomAnimLoop();
}
