import {
  WORLD_SIZE,
  TILE_TYPES,
  TERRAIN_COLORS,
  DIRS,
  isWalkable,
  typeAt,
  findOpenTile,
  findPath,
  mulberry32,
  hashString
} from './world.js';
import { drawAvatar, getAvatarImage, loadAvatarImage } from './avatar.js';
import { occupantAtTile, reservationAtTile } from './characters.js';
import { directionForStep, shouldMirror } from './facing.js';

const TILE = 48;
const CHARACTER_HEIGHT = TILE * 1.72;
const PLAYER_STEP = 0.17;
const NPC_STEP = 0.38;
const MOVE_KEYS = new Map([
  ['w', { dx: 0, dy: -1, dir: 2 }],
  ['arrowup', { dx: 0, dy: -1, dir: 2 }],
  ['s', { dx: 0, dy: 1, dir: 0 }],
  ['arrowdown', { dx: 0, dy: 1, dir: 0 }],
  ['a', { dx: -1, dy: 0, dir: 3 }],
  ['arrowleft', { dx: -1, dy: 0, dir: 3 }],
  ['d', { dx: 1, dy: 0, dir: 1 }],
  ['arrowright', { dx: 1, dy: 0, dir: 1 }]
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeTileTextures() {
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

export class Game {
  constructor({ canvas, minimap, onSelect, onToast, onDialogue }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.onToast = onToast || (() => {});
    this.onDialogue = onDialogue || (() => {});

    this.terrain = null;
    this.worldSeed = null;
    this.player = null;
    this.npcs = [];
    this.wander = true;
    this.previewFocus = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    this.camera = { x: 0, y: 0 };
    this.cameraSnap = true;
    this.time = 0;
    this.last = 0;
    this.running = false;
    this.interactive = false;
    this.hovered = null;
    this.selected = null;
    this.dialogueNpc = null;
    this.paused = false;
    this.destination = null;
    this.pointer = { x: -1, y: -1 };
    this.heldKeys = [];
    this.tileTextures = makeTileTextures();
    this.minimapBase = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cameraSnap = true;
  }

  makeCharacter(input, isPlayer = false) {
    const x = clamp(Math.round(Number(input.x) || 0), 0, WORLD_SIZE - 1);
    const y = clamp(Math.round(Number(input.y) || 0), 0, WORLD_SIZE - 1);
    return {
      id: input.id ?? (isPlayer ? 'player' : `npc-${Math.random().toString(36).slice(2, 9)}`),
      name: input.name || 'Wanderer',
      recipe: input.recipe,
      vibe: input.vibe || '',
      isPlayer,
      x,
      y,
      fromX: x,
      fromY: y,
      toX: x,
      toY: y,
      moving: false,
      elapsed: 0,
      duration: isPlayer ? PLAYER_STEP : NPC_STEP,
      direction: Number(input.direction) || 0,
      wait: 0.3 + Math.random() * 1.2,
      path: []
    };
  }

  setWorld({ terrain, worldSeed, player, npcs, wander = true }) {
    this.terrain = terrain;
    this.worldSeed = worldSeed;
    this.player = player ? this.makeCharacter(player, true) : null;
    this.npcs = (npcs || []).map(npc => this.makeCharacter(npc, false));
    this.wander = wander;
    this.selected = null;
    this.hovered = null;
    this.dialogueNpc = null;
    this.paused = false;
    this.destination = null;
    this.heldKeys = [];
    this.previewFocus = this.player
      ? { x: this.player.x, y: this.player.y }
      : { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    this.buildMinimapBase();
    this.cameraSnap = true;
  }

  setPreview(terrain, worldSeed, focus) {
    this.terrain = terrain;
    this.worldSeed = worldSeed;
    this.player = null;
    this.npcs = [];
    this.selected = null;
    this.hovered = null;
    this.dialogueNpc = null;
    this.paused = false;
    this.destination = null;
    this.previewFocus = focus || { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    this.buildMinimapBase();
    this.cameraSnap = true;
  }

  setInteractive(value) {
    this.interactive = Boolean(value);
    if (!this.interactive) {
      this.heldKeys = [];
      this.canvas.style.cursor = 'default';
    }
  }

  setWander(value) {
    this.wander = Boolean(value);
  }

  addNpc(input) {
    if (!this.terrain) return null;
    const focus = this.player || this.previewFocus;
    const occupied = new Set();
    for (const npc of this.npcs) {
      occupied.add(`${npc.x},${npc.y}`);
      if (npc.moving) occupied.add(`${npc.toX},${npc.toY}`);
    }
    if (this.player) {
      occupied.add(`${this.player.x},${this.player.y}`);
      if (this.player.moving) occupied.add(`${this.player.toX},${this.player.toY}`);
    }
    const spot = input?.x != null && input?.y != null
      ? { x: input.x, y: input.y }
      : findOpenTile(this.terrain, focus, occupied, 2);
    const character = this.makeCharacter({ ...input, x: spot.x, y: spot.y }, false);
    this.npcs.push(character);
    return character;
  }

  removeNpc(id) {
    this.npcs = this.npcs.filter(npc => npc.id !== id);
    if (this.selected?.id === id) this.selected = null;
    if (this.hovered?.id === id) this.hovered = null;
  }

  updateNpcRecipe(id, recipe) {
    const npc = this.npcs.find(item => item.id === id);
    if (npc) npc.recipe = recipe;
  }

  getNpc(id) {
    return this.npcs.find(item => item.id === id) || null;
  }

  characterById(id) {
    if (id === 'player') return this.player;
    return this.getNpc(id);
  }

  select(id) {
    this.selected = id ? this.characterById(id) : null;
  }

  npcAtTile(x, y, exclude = null) {
    return occupantAtTile(this.npcs, x, y, exclude);
  }

  reservedBy(x, y, exclude = null) {
    const characters = this.player ? [...this.npcs, this.player] : this.npcs;
    return reservationAtTile(characters, x, y, exclude);
  }

  tryPlayerStep(dx, dy) {
    if (!this.terrain || !this.player || this.player.moving) return false;
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!isWalkable(typeAt(this.terrain, nx, ny))) return false;

    const npc = this.npcAtTile(nx, ny);
    if (npc) {
      this.openDialogueWith(npc);
      return false;
    }

    if (this.reservedBy(nx, ny, this.player)) {
      this.heldKeys = [];
      this.player.path = [];
      this.destination = null;
      return false;
    }

    return this.tryStep(this.player, dx, dy, PLAYER_STEP);
  }

  openDialogueWith(npc) {
    if (!npc || this.dialogueNpc) return;
    this.dialogueNpc = npc;
    this.paused = true;
    this.interactive = false;
    this.heldKeys = [];
    this.destination = null;
    if (this.player) this.player.path = [];
    this.hovered = null;
    this.canvas.style.cursor = 'default';
    this.onDialogue(npc);
  }

  resumeFromDialogue() {
    this.dialogueNpc = null;
    this.paused = false;
    this.interactive = true;
  }

  buildMinimapBase() {
    if (!this.terrain) return;
    const scale = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = WORLD_SIZE * scale;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < WORLD_SIZE; y++) {
      for (let x = 0; x < WORLD_SIZE; x++) {
        ctx.fillStyle = TERRAIN_COLORS[this.terrain[y][x]];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    this.minimapBase = canvas;
  }

  cameraFocus() {
    if (this.player) return this.interpolated(this.player);
    return this.previewFocus;
  }

  updateCamera(dt) {
    const worldPx = WORLD_SIZE * TILE;
    const focus = this.cameraFocus();
    const focusX = (focus.x + 0.5) * TILE;
    const focusY = (focus.y + 0.5) * TILE;
    let targetX = focusX - this.width / 2;
    let targetY = focusY - this.height / 2;
    targetX = worldPx <= this.width ? (worldPx - this.width) / 2 : clamp(targetX, 0, worldPx - this.width);
    targetY = worldPx <= this.height ? (worldPx - this.height) / 2 : clamp(targetY, 0, worldPx - this.height);

    if (this.cameraSnap) {
      this.camera.x = targetX;
      this.camera.y = targetY;
      this.cameraSnap = false;
      return;
    }

    const t = 1 - Math.exp(-dt * 9);
    this.camera.x += (targetX - this.camera.x) * t;
    this.camera.y += (targetY - this.camera.y) * t;
  }

  interpolated(character) {
    const t = character.moving
      ? clamp(character.elapsed / character.duration, 0, 1)
      : 1;
    return {
      x: character.fromX + (character.toX - character.fromX) * t,
      y: character.fromY + (character.toY - character.fromY) * t
    };
  }

  tryStep(character, dx, dy, duration) {
    if (!this.terrain) return false;
    const nx = character.x + dx;
    const ny = character.y + dy;
    if (!isWalkable(typeAt(this.terrain, nx, ny))) return false;
    character.fromX = character.x;
    character.fromY = character.y;
    character.toX = nx;
    character.toY = ny;
    character.moving = true;
    character.elapsed = 0;
    character.duration = duration;
    character.direction = directionForStep(dx, dy);
    return true;
  }

  updatePlayer(dt) {
    const player = this.player;
    if (!player) return;

    if (player.moving) {
      player.elapsed += dt;
      if (player.elapsed >= player.duration) {
        player.x = player.toX;
        player.y = player.toY;
        player.moving = false;
        player.elapsed = 0;
      }
      return;
    }

    if (this.heldKeys.length) {
      const move = this.heldKeys[this.heldKeys.length - 1];
      this.tryPlayerStep(move.dx, move.dy);
      this.destination = null;
      return;
    }

    if (player.path.length) {
      const next = player.path.shift();
      const dx = next.x - player.x;
      const dy = next.y - player.y;
      if (Math.abs(dx) + Math.abs(dy) === 1 && this.tryPlayerStep(dx, dy)) {
        if (!player.path.length) this.destination = null;
        return;
      }
      player.path = [];
      this.destination = null;
    }
  }

  updateNpc(npc, dt) {
    if (npc.moving) {
      npc.elapsed += dt;
      if (npc.elapsed >= npc.duration) {
        npc.x = npc.toX;
        npc.y = npc.toY;
        npc.moving = false;
        npc.elapsed = 0;
        npc.wait = 0.5 + Math.random() * 1.6;
      }
      return;
    }

    if (!this.wander) return;
    npc.wait -= dt;
    if (npc.wait > 0) return;

    const occupied = new Set();
    for (const other of this.npcs) {
      if (other !== npc) {
        occupied.add(`${other.x},${other.y}`);
        if (other.moving) occupied.add(`${other.toX},${other.toY}`);
      }
    }
    if (this.player) {
      occupied.add(`${this.player.x},${this.player.y}`);
      if (this.player.moving) occupied.add(`${this.player.toX},${this.player.toY}`);
    }

    const options = [];
    for (const { dx, dy } of DIRS) {
      const nx = npc.x + dx;
      const ny = npc.y + dy;
      if (!isWalkable(typeAt(this.terrain, nx, ny))) continue;
      if (occupied.has(`${nx},${ny}`)) continue;
      options.push({ dx, dy, same: (dx === 1 && npc.direction === 1) || (dx === -1 && npc.direction === 3) || (dy === 1 && npc.direction === 0) || (dy === -1 && npc.direction === 2) });
    }

    if (!options.length) {
      npc.wait = 0.7;
      return;
    }

    const forward = options.filter(option => option.same);
    const pool = forward.length && Math.random() < 0.55 ? forward : options;
    const move = pool[Math.floor(Math.random() * pool.length)];
    this.tryStep(npc, move.dx, move.dy, NPC_STEP);
  }

  update(dt) {
    this.time += dt;
    if (!this.paused) {
      this.updatePlayer(dt);
      for (const npc of this.npcs) this.updateNpc(npc, dt);
    }
    this.updateCamera(dt);
    if (this.destination && this.time > this.destination.until) this.destination = null;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.frame);
  }

  variantFor(x, y) {
    return Math.abs((x * 73856093) ^ (y * 19349663) ^ (x * y * 83492791)) % 3;
  }

  render() {
    if (!this.terrain) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#0b110d';
    ctx.fillRect(0, 0, this.width, this.height);

    const camX = Math.round(this.camera.x);
    const camY = Math.round(this.camera.y);
    ctx.save();
    ctx.translate(-camX, -camY);

    const x0 = clamp(Math.floor(camX / TILE) - 1, 0, WORLD_SIZE - 1);
    const y0 = clamp(Math.floor(camY / TILE) - 1, 0, WORLD_SIZE - 1);
    const x1 = clamp(Math.ceil((camX + this.width) / TILE) + 1, 0, WORLD_SIZE - 1);
    const y1 = clamp(Math.ceil((camY + this.height) / TILE) + 1, 0, WORLD_SIZE - 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const texture = this.tileTextures[this.terrain[y][x]][this.variantFor(x, y)];
        ctx.drawImage(texture, x * TILE, y * TILE, TILE, TILE);
      }
    }

    if (this.destination) {
      const pulse = 0.5 + Math.sin(this.time * 7) * 0.5;
      const cx = (this.destination.x + 0.5) * TILE;
      const cy = (this.destination.y + 0.5) * TILE;
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

    const characters = [];
    if (this.player) characters.push(this.player);
    characters.push(...this.npcs);
    characters.sort((a, b) => this.interpolated(a).y - this.interpolated(b).y);

    for (const character of characters) {
      this.drawCharacter(character);
    }

    ctx.restore();

    const hovered = this.hovered || this.selected;
    if (hovered) this.drawNameplate(hovered);
    this.drawMinimap();
  }

  drawCharacter(character) {
    const { ctx } = this;
    const position = this.interpolated(character);
    const footX = (position.x + 0.5) * TILE;
    const footY = (position.y + 1) * TILE;
    const movingT = character.moving ? clamp(character.elapsed / character.duration, 0, 1) : 0;
    const idle = Math.sin(this.time * 2.2 + (hashString(character.id) % 100)) * 0.7;
    const lift = character.moving ? Math.sin(movingT * Math.PI) * TILE * 0.09 : idle * 0.3;
    const width = CHARACTER_HEIGHT;
    const top = footY - CHARACTER_HEIGHT - lift;

    if (character === this.player || character === this.selected || character === this.hovered) {
      ctx.beginPath();
      ctx.ellipse(footX, footY - 2, TILE * 0.42, TILE * 0.16, 0, 0, Math.PI * 2);
      ctx.fillStyle = character === this.player ? 'rgba(229, 244, 165, 0.16)' : 'rgba(229, 244, 165, 0.28)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 244, 165, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const image = getAvatarImage(character.recipe);
    if (image) {
      drawAvatar(ctx, image, footX - width / 2, top, width, CHARACTER_HEIGHT, shouldMirror(character.direction));
    } else {
      loadAvatarImage(character.recipe).catch(() => {});
      ctx.fillStyle = 'rgba(20, 30, 22, 0.8)';
      ctx.beginPath();
      ctx.arc(footX, footY - CHARACTER_HEIGHT * 0.45, CHARACTER_HEIGHT * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(229, 244, 165, 0.5)';
      ctx.stroke();
    }
  }

  drawNameplate(character) {
    const { ctx } = this;
    const position = this.interpolated(character);
    const footX = (position.x + 0.5) * TILE - this.camera.x;
    const footY = (position.y + 1) * TILE - this.camera.y;
    const label = character.isPlayer ? `${character.name} · you` : character.name;
    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const width = textWidth + 16;
    const height = 22;
    const x = clamp(footX - width / 2, 6, this.width - width - 6);
    const y = footY - CHARACTER_HEIGHT - 24;
    ctx.fillStyle = 'rgba(10, 17, 12, 0.9)';
    ctx.strokeStyle = 'rgba(163, 210, 139, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, 6);
    else ctx.rect(x, y, width, height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#edf4e9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
    ctx.restore();
  }

  drawMinimap() {
    if (!this.minimapBase) return;
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
      this.camera.x * scale,
      this.camera.y * scale,
      Math.min(size, this.width * scale),
      Math.min(size, this.height * scale)
    );

    for (const npc of this.npcs) {
      const position = this.interpolated(npc);
      mctx.beginPath();
      mctx.arc((position.x + 0.5) * (size / WORLD_SIZE), (position.y + 0.5) * (size / WORLD_SIZE), Math.max(2, size / 110), 0, Math.PI * 2);
      mctx.fillStyle = 'rgba(233, 240, 232, 0.65)';
      mctx.fill();
    }

    if (this.player) {
      const position = this.interpolated(this.player);
      mctx.beginPath();
      mctx.arc((position.x + 0.5) * (size / WORLD_SIZE), (position.y + 0.5) * (size / WORLD_SIZE), Math.max(3, size / 75), 0, Math.PI * 2);
      mctx.fillStyle = '#e5f4a5';
      mctx.fill();
      mctx.strokeStyle = 'rgba(10, 17, 12, 0.9)';
      mctx.lineWidth = Math.max(1.5, size / 180);
      mctx.stroke();
    }
  }

  pointerWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return { sx, sy, x: sx + this.camera.x, y: sy + this.camera.y };
  }

  characterAtScreen(sx, sy) {
    const characters = [...this.npcs];
    if (this.player) characters.push(this.player);
    characters.sort((a, b) => this.interpolated(b).y - this.interpolated(a).y);
    for (const character of characters) {
      const position = this.interpolated(character);
      const footX = (position.x + 0.5) * TILE - this.camera.x;
      const footY = (position.y + 1) * TILE - this.camera.y;
      const width = CHARACTER_HEIGHT * 0.78;
      if (sx >= footX - width / 2 && sx <= footX + width / 2 && sy >= footY - CHARACTER_HEIGHT && sy <= footY) {
        return character;
      }
    }
    return null;
  }

  handlePointerMove(event) {
    if (!this.interactive) return;
    const { sx, sy } = this.pointerWorld(event);
    this.pointer = { x: sx, y: sy };
    const character = this.characterAtScreen(sx, sy);
    this.hovered = character;
    this.canvas.style.cursor = character ? 'pointer' : 'default';
  }

  handlePointerLeave() {
    this.hovered = null;
    this.canvas.style.cursor = 'default';
  }

  handlePointerDown(event) {
    if (!this.interactive || event.button !== 0) return;
    const { sx, sy, x, y } = this.pointerWorld(event);
    const character = this.characterAtScreen(sx, sy);
    if (character) {
      this.selected = character;
      this.onSelect(character);
      return;
    }

    const tileX = Math.floor(x / TILE);
    const tileY = Math.floor(y / TILE);
    if (!this.player || !this.terrain) return;
    if (!isWalkable(typeAt(this.terrain, tileX, tileY))) {
      this.onToast('That spot is water.');
      return;
    }

    const blocked = new Set();
    for (const npc of this.npcs) {
      blocked.add(`${npc.x},${npc.y}`);
      if (npc.moving) blocked.add(`${npc.toX},${npc.toY}`);
    }
    const path = findPath(this.terrain, { x: this.player.x, y: this.player.y }, { x: tileX, y: tileY }, blocked);
    if (path.length) {
      this.player.path = path;
      this.destination = { x: tileX, y: tileY, until: this.time + 1.4 };
      this.heldKeys = [];
      this.selected = null;
      this.onSelect(null);
    } else {
      this.onToast('No clear path there.');
    }
  }

  handleKeyDown(event) {
    if (!this.interactive || !this.player) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const move = MOVE_KEYS.get(event.key.toLowerCase());
    if (!move) return;
    event.preventDefault();
    if (!this.heldKeys.some(item => item.key === event.key.toLowerCase())) {
      this.heldKeys.push({ key: event.key.toLowerCase(), ...move });
    }
    this.player.path = [];
    this.destination = null;
    if (!this.player.moving) this.tryPlayerStep(move.dx, move.dy);
  }

  handleKeyUp(event) {
    const key = event.key.toLowerCase();
    this.heldKeys = this.heldKeys.filter(item => item.key !== key);
  }

  handleBlur() {
    this.heldKeys = [];
  }
}
