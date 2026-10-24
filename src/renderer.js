import {
  WORLD_SIZE,
  TILE_TYPES,
  TERRAIN_COLORS,
  mulberry32,
  hashString
} from './world.js';
import { drawAvatar, getAvatarImage, loadAvatarImage } from './avatar.js';
import { shouldMirror, UP } from './facing.js';
import { getAnimationProfile } from './animation.js';
import sceneryAssets from '../data/nature_scenery.json' with { type: 'json' };

export const TILE = 48;
export const CHARACTER_HEIGHT = TILE * 1.72;
export const COMPANION_HEIGHT = TILE * 1.05;
export const PET_HEIGHT = COMPANION_HEIGHT * 2; // Twice the companion size to match 256x256 rendering area

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function makeTileTextures() {
  const textures = {};
  const scale = 2;
  const size = TILE * scale;

  for (const type of TILE_TYPES) {
    textures[type] = [];
    for (let variant = 0; variant < 3; variant++) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const random = mulberry32(hashString(`${type}:${variant}:playpark`));
      ctx.fillStyle = TERRAIN_COLORS[type];
      ctx.fillRect(0, 0, size, size);

      if (type === 'grass' || type === 'field') {
        for (let i = 0; i < 26; i++) {
          const x = random() * size;
          const y = random() * size;
          if (type === 'grass') {
            ctx.fillStyle = random() > 0.5 ? 'rgba(192, 223, 120, 0.32)' : 'rgba(30, 65, 43, 0.32)';
            ctx.fillRect(x, y, 2 + random() * 2, 2 + random() * 2);
          } else {
            ctx.fillStyle = random() > 0.55 ? 'rgba(216, 202, 102, 0.55)' : 'rgba(72, 94, 36, 0.3)';
            ctx.fillRect(x, y, 2 + random() * 2, 2 + random() * 2);
          }
        }
      }

      if (type === 'dirt') {
        for (let i = 0; i < 20; i++) {
          ctx.fillStyle = random() > 0.5 ? 'rgba(84, 60, 52, 0.28)' : 'rgba(196, 154, 108, 0.26)';
          ctx.fillRect(random() * size, random() * size, 2 + random() * 3, 2 + random() * 2);
        }
      }

      if (type === 'sand') {
        for (let i = 0; i < 24; i++) {
          ctx.fillStyle = random() > 0.5 ? 'rgba(255, 240, 168, 0.32)' : 'rgba(140, 112, 64, 0.2)';
          ctx.fillRect(random() * size, random() * size, 2, 2);
        }
      }

      if (type === 'water') {
        for (let i = 0; i < 7; i++) {
          const x = random() * size;
          const y = random() * size;
          ctx.fillStyle = 'rgba(213, 245, 255, 0.28)';
          ctx.fillRect(x, y, 10 + random() * 18, 2);
          ctx.fillStyle = 'rgba(18, 74, 104, 0.24)';
          ctx.fillRect(x + 8, y + 5, 8 + random() * 10, 2);
        }
      }

      if (type === 'field') {
        ctx.strokeStyle = 'rgba(213, 184, 91, 0.48)';
        ctx.lineWidth = 2;
        for (let i = 1; i < 5; i++) {
          const y = (size * i) / 5;
          ctx.beginPath();
          ctx.moveTo(size * 0.08, y);
          ctx.lineTo(size * 0.92, y);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(216, 202, 102, 0.5)';
        for (let i = 0; i < 4; i++) ctx.fillRect(size * (0.15 + i * 0.2), size * 0.17, 2, size * 0.66);
      }

      ctx.strokeStyle = 'rgba(232, 245, 223, 0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      textures[type].push(canvas);
    }
  }

  return textures;
}

export class WorldRenderer {
  constructor({ canvas, minimap } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.('2d') || null;
    this.minimap = minimap;
    this.mctx = minimap?.getContext?.('2d') || null;
    this.tileTextures = null;
    this.minimapBase = null;
    this.sceneryImages = new Map();
    this.initScenery();
  }

  initScenery() {
    if (typeof Image === 'undefined') return;
    for (const [key, uri] of Object.entries(sceneryAssets)) {
      const img = new Image();
      img.src = uri;
      this.sceneryImages.set(key, img);
    }
  }

  initTextures() {
    if (!this.tileTextures && typeof document !== 'undefined') {
      this.tileTextures = makeTileTextures();
    }
  }

  buildMinimapBase(terrain) {
    if (!terrain || typeof document === 'undefined') return;
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = WORLD_SIZE * scale;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        ctx.fillStyle = TERRAIN_COLORS[terrain[y][x]];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    this.minimapBase = canvas;
  }

  variantFor(x, y) {
    return Math.abs((x * 73856093) ^ (y * 19349663) ^ (x * y * 83492791)) % 3;
  }

  drawFrame(game) {
    if (!game.terrain) return;
    this.initTextures();
    const { ctx } = this;
    const { width, height, camera, terrain } = game;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b110d';
    ctx.fillRect(0, 0, width, height);

    const camX = Math.round(camera.x);
    const camY = Math.round(camera.y);
    ctx.save();
    ctx.translate(-camX, -camY);

    const x0 = clamp(Math.floor(camX / TILE) - 1, 0, WORLD_SIZE - 1);
    const y0 = clamp(Math.floor(camY / TILE) - 1, 0, WORLD_SIZE - 1);
    const x1 = clamp(Math.ceil((camX + width) / TILE) + 1, 0, WORLD_SIZE - 1);
    const y1 = clamp(Math.ceil((camY + height) / TILE) + 1, 0, WORLD_SIZE - 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const texture = this.tileTextures[terrain[y][x]][this.variantFor(x, y)];
        ctx.drawImage(texture, x * TILE, y * TILE, TILE, TILE);
      }
    }

    // Render ground-based mini games
    for (const mg of game.miniGames) {
      if (mg.renderGround) mg.renderGround(ctx, camera);
      else if (mg.render) mg.render(ctx, { x: 0, y: 0 });
    }

    if (game.destination) {
      const pulse = 0.5 + Math.sin(game.time * 7) * 0.5;
      const cx = (game.destination.x + 0.5) * TILE;
      const cy = (game.destination.y + 0.5) * TILE;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * (0.24 + pulse * 0.05), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(229, 244, 165, ${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#e5f4a5';
      ctx.fill();
    }

    // Render characters and scenery sorted by Y depth
    const renderables = [];
    if (game.player) renderables.push({ type: 'char', y: game.interpolated(game.player).y, entity: game.player });
    for (const npc of game.npcs) renderables.push({ type: 'char', y: game.interpolated(npc).y, entity: npc });
    for (const comp of game.companions) renderables.push({ type: 'char', y: game.interpolated(comp).y, entity: comp });

    if (Array.isArray(game.scenery)) {
      // Find bounding zones of all currently open mini-game boards (expanded by 1 tile margin)
      const hiddenZones = [];
      for (const mg of game.miniGames || []) {
        if (mg.isOpen?.() && mg.activeBoard?.originX !== undefined) {
          const size = mg.boardSize || 3;
          hiddenZones.push({
            minX: mg.activeBoard.originX - 1,
            maxX: mg.activeBoard.originX + size,
            minY: mg.activeBoard.originY - 1,
            maxY: mg.activeBoard.originY + size
          });
        }
      }

      for (const item of game.scenery) {
        // Hide scenery item if it falls on the board or within the 1-tile border margin
        const isHidden = hiddenZones.some(
          zone => item.x >= zone.minX && item.x <= zone.maxX && item.y >= zone.minY && item.y <= zone.maxY
        );
        if (!isHidden) {
          renderables.push({ type: 'scenery', y: item.y, entity: item });
        }
      }
    }

    renderables.sort((a, b) => a.y - b.y);

    for (const item of renderables) {
      if (item.type === 'char') {
        this.drawCharacter(game, item.entity);
      } else {
        this.drawSceneryItem(ctx, item.entity);
      }
    }

    ctx.restore();

    const hovered = game.hovered || game.selected;
    if (hovered) this.drawNameplate(game, hovered);
    this.drawMinimap(game);
  }

  drawSceneryItem(ctx, item) {
    const img = this.sceneryImages.get(item.type);
    if (!img || !img.complete) return;

    const isTree = item.type.includes('tree');
    const isBushOrRock = item.type.includes('bush') || item.type.includes('rock');

    // Trees stand tall (2.5 - 3.2 tiles), bushes and boulders are medium (1.4 - 1.5 tiles),
    // ground cover (flowers, mushrooms, grass) is compact (0.7 - 0.9 tiles)
    let baseW;
    let baseH;
    if (isTree) {
      baseW = TILE * 2.5;
      baseH = TILE * 3.0;
    } else if (isBushOrRock) {
      baseW = TILE * 1.5;
      baseH = TILE * 1.4;
    } else {
      baseW = TILE * 0.8;
      baseH = TILE * 0.8;
    }

    const width = baseW * (item.scale || 1);
    const height = baseH * (item.scale || 1);

    const footX = (item.x + 0.5) * TILE;
    const footY = (item.y + 1) * TILE;

    // Compensate for transparent padding at the bottom of source images so objects plant firmly on the ground
    const BOTTOM_OFFSETS = {
      'apple-tree': 0.148,
      'chestnut-tree': 0.107,
      'puffy-tree': 0.086,
      'rounded-bush': 0.068,
      'flowering-bush': 0.0,
      'rock-boulder': 0.0,
      'mushroom': 0.0,
      'mushroom-cluster': 0.0,
      'flower-red': 0.088,
      'grass-tuft': 0.0
    };
    const bottomTrim = (BOTTOM_OFFSETS[item.type] || 0) * height;

    // Draw scenery image cleanly without artificial oval shadow
    ctx.drawImage(img, footX - width / 2, footY - height + bottomTrim, width, height);
  }

  drawCharacter(game, character) {
    const { ctx } = this;
    const isCompanion = Boolean(character.isCompanion);
    const profile = getAnimationProfile(character.recipe);
    const is3DModel = Boolean(profile.family?.startsWith('pet-') || profile.family?.startsWith('creature-'));
    const height = isCompanion ? (is3DModel ? PET_HEIGHT : COMPANION_HEIGHT) : CHARACTER_HEIGHT;
    const width = height;
    const position = game.interpolated(character);
    const footX = (position.x + 0.5) * TILE;
    const footY = (position.y + 1) * TILE;
    const movingT = character.moving ? clamp(character.elapsed / character.duration, 0, 1) : 0;
    const cheerHop = isCompanion && character.cheerTimer > 0
      ? Math.abs(Math.sin((1.4 - character.cheerTimer) * 14)) * TILE * 0.45
      : 0;

    // Hash character id to de-synchronize blinks and idle cycles so neighbours don't blink in unison
    const charTimeOffset = (hashString(character.id || 'char') % 1000) * 0.01;
    const animTime = (game.time || 0) + charTimeOffset;

    // Determine family-specific procedural transform (both idle AND movement locomotion)
    const animTransform = profile.getTransform
      ? profile.getTransform(animTime, height, {
          moving: Boolean(character.moving),
          movingT,
          direction: character.direction
        })
      : { translateY: 0, translateX: 0, rotate: 0, scaleX: 1, scaleY: 1, alpha: 1, shadowScale: 1 };

    const tx = animTransform.translateX || 0;
    const ty = (animTransform.translateY || 0) - cheerHop;
    const scaleX = animTransform.scaleX ?? 1;
    const scaleY = animTransform.scaleY ?? 1;
    const rotate = animTransform.rotate || 0;
    const alpha = animTransform.alpha ?? 1;
    const shadowScale = animTransform.shadowScale ?? 1;

    const top = footY - height + ty;

    // Holographic projection glow on the ground for floating digi-buddies ('gaze')
    if (animTransform.hologramGlow) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(footX + tx * 0.5, footY - 3, TILE * 0.28 * shadowScale, TILE * 0.10 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(102, 217, 232, 0.26)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(153, 233, 242, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    if (character === game.player || character === game.selected || character === game.hovered) {
      ctx.beginPath();
      ctx.ellipse(footX, footY - 2, TILE * 0.42, TILE * 0.16, 0, 0, Math.PI * 2);
      ctx.fillStyle = character === game.player ? 'rgba(229, 244, 165, 0.16)' : 'rgba(229, 244, 165, 0.28)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 244, 165, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Alternate walk frames for pets and creatures
    let targetFrame = 'default';
    if (isCompanion && character.cheerTimer > 0 && profile.frames?.includes('cheer')) {
      targetFrame = 'cheer';
    } else if (character.moving && is3DModel) {
      // Alternate walk frames: walk1 on first half of step, walk2 on second half
      targetFrame = movingT < 0.5 ? 'walk1' : 'walk2';
    } else if (profile.getFrame) {
      const f = profile.getFrame(animTime);
      // Allow gaze companions to look around even while floating; other walkers default during step unless blinking
      targetFrame = (character.moving && f !== 'blink' && !animTransform.hologramGlow) ? 'default' : f;
    } else if (profile.isBlinking && profile.isBlinking(animTime)) {
      targetFrame = 'blink';
    }

    // For pet & creature companions facing UP (away from camera), switch to the reverse 3D view
    if (is3DModel && character.direction === UP) {
      const backKey = `back_${targetFrame}`;
      if (profile.frames?.includes(backKey)) {
        targetFrame = backKey;
      }
    }

    let image = getAvatarImage(character.recipe, { frame: targetFrame });
    if (!image) {
      // Trigger lazy load for missing frame and fallback to default frame
      loadAvatarImage(character.recipe, { frame: targetFrame }).catch(() => {});
      image = getAvatarImage(character.recipe, { frame: 'default' });
    }

    if (image) {
      const flip = shouldMirror(character.direction);
      ctx.save();
      if (tx !== 0 || rotate !== 0 || scaleX !== 1 || scaleY !== 1) {
        // Transform around character anchor (footX + tx, footY) so compression squashes downward toward the ground
        ctx.translate(footX + tx, footY);
        if (rotate !== 0) ctx.rotate(flip ? -rotate : rotate);
        if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
        ctx.translate(-(footX + tx), -footY);
      }
      drawAvatar(ctx, image, footX + tx - width / 2, top, width, height, flip, alpha);
      ctx.restore();
    } else {
      const frames = profile.frames || ['default', 'blink'];
      for (const f of frames) {
        loadAvatarImage(character.recipe, { frame: f }).catch(() => {});
      }
      ctx.fillStyle = 'rgba(20, 30, 22, 0.8)';
      ctx.beginPath();
      ctx.arc(footX, footY - height * 0.45, height * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 244, 165, 0.5)';
      ctx.stroke();
    }
  }

  drawNameplate(game, character) {
    const { ctx } = this;
    const isCompanion = Boolean(character.isCompanion);
    const profile = getAnimationProfile(character.recipe);
    const is3DModel = Boolean(profile.family?.startsWith('pet-') || profile.family?.startsWith('creature-'));
    const height = isCompanion ? (is3DModel ? PET_HEIGHT : COMPANION_HEIGHT) : CHARACTER_HEIGHT;
    const position = game.interpolated(character);
    const footX = (position.x + 0.5) * TILE - game.camera.x;
    const footY = (position.y + 1) * TILE - game.camera.y;
    let label = character.name;
    if (character.isPlayer) label = `${character.name} · you`;
    else if (isCompanion) label = `${character.name} · buddy`;

    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const width = textWidth + 16;
    const boxHeight = 22;
    const x = clamp(footX - width / 2, 6, game.width - width - 6);
    const y = footY - height - 24;
    ctx.fillStyle = 'rgba(10, 17, 12, 0.9)';
    ctx.strokeStyle = 'rgba(163, 210, 139, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, boxHeight, 6);
    else ctx.rect(x, y, width, boxHeight);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#edf4e9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + boxHeight / 2 + 0.5);
    ctx.restore();
  }

  drawMinimap(game) {
    if (!this.minimapBase || !this.mctx) return;
    const size = this.minimap.width;
    const { mctx } = this;
    mctx.clearRect(0, 0, size, size);
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(this.minimapBase, 0, 0, size, size);

    const scale = size / (WORLD_SIZE * TILE);
    mctx.fillStyle = 'rgba(229, 244, 165, 0.55)';
    mctx.strokeStyle = 'rgba(229, 244, 165, 0.55)';
    mctx.lineWidth = Math.max(1, size / 320);
    mctx.strokeRect(
      game.camera.x * scale,
      game.camera.y * scale,
      Math.min(size, game.width * scale),
      Math.min(size, game.height * scale)
    );

    for (const npc of game.npcs) {
      const position = game.interpolated(npc);
      mctx.beginPath();
      mctx.arc((position.x + 0.5) * (size / WORLD_SIZE), (position.y + 0.5) * (size / WORLD_SIZE), Math.max(2, size / 110), 0, Math.PI * 2);
      mctx.fillStyle = 'rgba(233, 240, 232, 0.65)';
      mctx.fill();
    }

    if (game.player) {
      const position = game.interpolated(game.player);
      mctx.beginPath();
      mctx.arc((position.x + 0.5) * (size / WORLD_SIZE), (position.y + 0.5) * (size / WORLD_SIZE), Math.max(3, size / 75), 0, Math.PI * 2);
      mctx.fillStyle = '#e5f4a5';
      mctx.fill();
      mctx.strokeStyle = 'rgba(10, 17, 12, 0.9)';
      mctx.lineWidth = Math.max(1.5, size / 180);
      mctx.stroke();
    }
  }
}
