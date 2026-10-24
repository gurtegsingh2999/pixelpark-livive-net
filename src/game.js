import {
  WORLD_SIZE,
  DIRS,
  isWalkable,
  typeAt,
  findOpenTile,
  findPath
} from './world.js';
import { occupantAtTile, reservationAtTile, canCollide } from './characters.js';
import { directionForStep } from './facing.js';
import { WorldRenderer, TILE, CHARACTER_HEIGHT, COMPANION_HEIGHT } from './renderer.js';
import engineConfig from '../data/engine_config.json' with { type: 'json' };

export { TILE, CHARACTER_HEIGHT, COMPANION_HEIGHT } from './renderer.js';

export const PLAYER_STEP = engineConfig.timings.playerStep;
export const NPC_STEP = engineConfig.timings.npcStep;
export const COMPANION_STEP = engineConfig.timings.companionStep;

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

export class Game {
  constructor({ canvas, minimap, onSelect, onToast, onDialogue, onActionKey, isMenuOpen } = {}) {
    this.canvas = canvas;
    this.renderer = new WorldRenderer({ canvas, minimap });
    this.onSelect = onSelect || (() => {});
    this.onToast = onToast || (() => {});
    this.onDialogue = onDialogue || (() => {});
    this.onActionKey = onActionKey || (() => {});
    this.isMenuOpen = isMenuOpen || (() => false);

    this.terrain = null;
    this.worldSeed = null;
    this.player = null;
    this.npcs = [];
    this.companions = [];
    this.miniGames = [];
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

  registerMiniGame(miniGame) {
    this.miniGames.push(miniGame);
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
    this.renderer.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
      inventory: Array.isArray(input.inventory) ? input.inventory : [],
      coins: Number.isFinite(input.coins) ? input.coins : 0,
      stabledCompanions: Array.isArray(input.stabledCompanions) ? input.stabledCompanions : [],
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

  makeCompanion(input, buddy) {
    const defaultX = buddy?.x ?? 0;
    const defaultY = buddy?.y ?? 0;
    const rawX = Number.isFinite(Number(input.x)) ? Number(input.x) : defaultX;
    const rawY = Number.isFinite(Number(input.y)) ? Number(input.y) : defaultY;
    const x = clamp(Math.round(rawX), 0, WORLD_SIZE - 1);
    const y = clamp(Math.round(rawY), 0, WORLD_SIZE - 1);
    return {
      id: input.id || `comp-${Math.random().toString(36).slice(2, 9)}`,
      name: input.name || 'Buddy',
      buddyId: buddy.id,
      recipe: input.recipe,
      isCompanion: true,
      x,
      y,
      fromX: x,
      fromY: y,
      toX: x,
      toY: y,
      moving: false,
      elapsed: 0,
      duration: COMPANION_STEP,
      direction: Number(input.direction) || 0,
      fetchTarget: null,
      carryingBall: false,
      cheerTimer: 0,
      path: []
    };
  }

  triggerCheer(buddyId, duration = 1.4) {
    const comps = this.getCompanionsFor(buddyId);
    for (const comp of comps) {
      comp.cheerTimer = duration;
    }
  }

  getCompanionFor(buddyId) {
    return this.companions.find(comp => comp.buddyId === buddyId) || null;
  }

  getCompanionsFor(buddyId) {
    return this.companions.filter(comp => comp.buddyId === buddyId);
  }

  setWorld({ terrain, worldSeed, player, npcs, companions = [], wander = true }) {
    this.terrain = terrain;
    this.worldSeed = worldSeed;
    this.player = player ? this.makeCharacter(player, true) : null;
    this.npcs = (npcs || []).map(npc => this.makeCharacter(npc, false));

    // Initialize companions
    this.companions = [];
    const allBuddies = this.player ? [this.player, ...this.npcs] : [...this.npcs];
    for (const comp of companions) {
      const buddy = allBuddies.find(b => b.id === comp.buddyId);
      if (buddy) this.companions.push(this.makeCompanion(comp, buddy));
    }

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
    this.renderer.buildMinimapBase(terrain);
    this.cameraSnap = true;
  }

  setPreview(terrain, worldSeed, focus) {
    this.terrain = terrain;
    this.worldSeed = worldSeed;
    this.player = null;
    this.npcs = [];
    this.companions = [];
    this.selected = null;
    this.hovered = null;
    this.dialogueNpc = null;
    this.paused = false;
    this.destination = null;
    this.previewFocus = focus || { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    this.renderer.buildMinimapBase(terrain);
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

  getNpc(id) {
    return this.npcs.find(npc => npc.id === id) || null;
  }

  addNpc(raw, companionRaw = null) {
    if (!this.terrain || !this.player) return null;
    const occupied = new Set([`${this.player.x},${this.player.y}`]);
    for (const npc of this.npcs) occupied.add(`${npc.x},${npc.y}`);
    for (const comp of this.companions) occupied.add(`${comp.x},${comp.y}`);
    // Search for an open tile at a comfortable distance from the player (e.g. 6-10 tiles)
    let spot = findOpenTile(this.terrain, { x: this.player.x, y: this.player.y }, occupied, 6);
    if (!spot) {
      spot = findOpenTile(this.terrain, { x: this.player.x, y: this.player.y }, occupied, 2);
    }
    const npc = this.makeCharacter({ ...raw, x: spot.x, y: spot.y });
    this.npcs.push(npc);
    occupied.add(`${npc.x},${npc.y}`);

    if (companionRaw) {
      const compSpot = findOpenTile(this.terrain, { x: npc.x, y: npc.y }, occupied, 1);
      const comp = this.makeCompanion({ ...companionRaw, x: compSpot.x, y: compSpot.y }, npc);
      this.companions.push(comp);
    }
    return npc;
  }

  removeNpc(id) {
    this.npcs = this.npcs.filter(npc => npc.id !== id);
    this.companions = this.companions.filter(comp => comp.buddyId !== id);
    if (this.selected?.id === id) this.selected = null;
    if (this.hovered?.id === id) this.hovered = null;
  }

  updateNpcRecipe(id, recipe) {
    const npc = this.getNpc(id);
    if (npc) npc.recipe = recipe;
  }

  select(id) {
    if (!id) {
      this.selected = null;
      return;
    }
    if (id === 'player') {
      this.selected = this.player;
      return;
    }
    this.selected = this.getNpc(id) || this.companions.find(c => c.id === id) || null;
  }

  allOtherCharacters(exclude = null) {
    const list = [];
    if (this.player && this.player !== exclude) list.push(this.player);
    for (const npc of this.npcs) {
      if (npc !== exclude) list.push(npc);
    }
    for (const comp of this.companions) {
      if (comp !== exclude) list.push(comp);
    }
    return list;
  }

  tryPlayerStep(dx, dy) {
    if (!this.player || !this.interactive || this.paused) return false;
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    this.player.direction = directionForStep(dx, dy);

    // Check collision with NPCs
    const bumpNpc = occupantAtTile(this.npcs, nx, ny);
    if (bumpNpc) {
      const isMiniGameActive = this.miniGames.some(m => m.isOpen && m.isOpen());
      if (isMiniGameActive && bumpNpc.inMiniGame) {
        this.heldKeys = [];
        this.player.path = [];
        this.destination = null;
        return false;
      }
      this.openDialogueWith(bumpNpc);
      return false;
    }

    // Check collision with Companions (opens dialogue with companion details)
    const bumpComp = occupantAtTile(this.companions, nx, ny);
    if (bumpComp) {
      this.openDialogueWith(bumpComp);
      return false;
    }

    // Prevent stepping into any tile reserved by an NPC or Companion
    const reservedBy = reservationAtTile([...this.npcs, ...this.companions], nx, ny);
    if (reservedBy) {
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

    // Strict occupancy and reservation collision with collision exclusion rule:
    // Filter other characters using canCollide(character, other)
    // (e.g. Walking NPCs are not blocked by companions, but companions are blocked by NPCs)
    const collidingObstacles = this.allOtherCharacters(character).filter(other => canCollide(character, other));
    if (reservationAtTile(collidingObstacles, nx, ny)) {
      return false;
    }

    // Check if any active mini-game blocks movement onto this tile
    for (const miniGame of this.miniGames) {
      if (miniGame.blocksStep && miniGame.blocksStep(character, nx, ny)) {
        return false;
      }
    }

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

    if (npc.inMiniGame) {
      if (npc.path && npc.path.length) {
        const next = npc.path.shift();
        const dx = next.x - npc.x;
        const dy = next.y - npc.y;
        if (Math.abs(dx) + Math.abs(dy) === 1) {
          this.tryStep(npc, dx, dy, NPC_STEP);
        } else {
          npc.path = [];
        }
      }
      return;
    }

    if (!this.wander) return;
    npc.wait -= dt;
    if (npc.wait > 0) return;

    const occupied = new Set();
    for (const other of this.allOtherCharacters(npc)) {
      if (canCollide(npc, other)) {
        occupied.add(`${other.x},${other.y}`);
        if (other.moving) occupied.add(`${other.toX},${other.toY}`);
      }
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

  getMiniGameBlockedTiles() {
    const blocked = new Set();
    for (const game of this.miniGames) {
      if (game.isOpen?.() && game.activeBoard?.originX !== undefined) {
        for (let by = 0; by < 3; by++) {
          for (let bx = 0; bx < 3; bx++) {
            blocked.add(`${game.activeBoard.originX + bx},${game.activeBoard.originY + by}`);
          }
        }
      }
    }
    return blocked;
  }

  updateCompanion(comp, dt) {
    if (comp.cheerTimer > 0) {
      comp.cheerTimer = Math.max(0, comp.cheerTimer - dt);
    }

    if (comp.moving) {
      comp.elapsed += dt;
      if (comp.elapsed >= comp.duration) {
        comp.x = comp.toX;
        comp.y = comp.toY;
        comp.moving = false;
        comp.elapsed = 0;
      }
      return;
    }

    // During active mini-games, companions only move if they are navigating to their staged spectator position
    const isMiniGameActive = this.miniGames.some(m => m.isOpen && m.isOpen());
    if (isMiniGameActive) {
      if (comp.stagedDestination) {
        if (comp.x === comp.stagedDestination.x && comp.y === comp.stagedDestination.y) {
          comp.stagedDestination = null;
          comp.path = [];
          return;
        }
        if (comp.path && comp.path.length) {
          const next = comp.path.shift();
          const dx = next.x - comp.x;
          const dy = next.y - comp.y;
          if (Math.abs(dx) + Math.abs(dy) === 1) {
            this.tryStep(comp, dx, dy, COMPANION_STEP);
          } else {
            const blocked = this.getMiniGameBlockedTiles();
            const repath = findPath(this.terrain, { x: comp.x, y: comp.y }, comp.stagedDestination, blocked);
            comp.path = repath.length ? repath : [];
          }
          return;
        } else {
          const blocked = this.getMiniGameBlockedTiles();
          const repath = findPath(this.terrain, { x: comp.x, y: comp.y }, comp.stagedDestination, blocked);
          if (repath.length) {
            comp.path = repath;
          } else {
            comp.x = comp.stagedDestination.x;
            comp.y = comp.stagedDestination.y;
            comp.stagedDestination = null;
          }
        }
      }
      comp.moving = false;
      return;
    }

    // Determine target location: either fetchTarget or trailing its buddy
    let target = comp.fetchTarget;
    if (!target) {
      const buddy = (this.player && this.player.id === comp.buddyId)
        ? this.player
        : this.npcs.find(n => n.id === comp.buddyId);

      if (!buddy) return;

      // For multiple player companions, trail in an entourage behind the buddy or previous companion
      let leader = buddy;
      if (comp.buddyId === 'player') {
        const playerComps = this.getCompanionsFor('player');
        const index = playerComps.indexOf(comp);
        if (index > 0 && playerComps[index - 1]) {
          leader = playerComps[index - 1];
        }
      }

      const dist = Math.hypot(leader.x - comp.x, leader.y - comp.y);
      if (dist <= 1.5) return;

      target = { x: leader.x, y: leader.y };
    }

    // Path or step toward target
    const dx = target.x - comp.x;
    const dy = target.y - comp.y;
    const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (stepX !== 0 && this.tryStep(comp, stepX, 0, COMPANION_STEP)) return;
      if (stepY !== 0 && this.tryStep(comp, 0, stepY, COMPANION_STEP)) return;
    } else {
      if (stepY !== 0 && this.tryStep(comp, 0, stepY, COMPANION_STEP)) return;
      if (stepX !== 0 && this.tryStep(comp, stepX, 0, COMPANION_STEP)) return;
    }
  }

  update(dt) {
    this.time += dt;
    if (!this.paused) {
      this.updatePlayer(dt);
      for (const npc of this.npcs) this.updateNpc(npc, dt);
      for (const comp of this.companions) this.updateCompanion(comp, dt);
      for (const game of this.miniGames) game.update?.(dt);
    }
    this.updateCamera(dt);
    if (this.destination && this.time > this.destination.until) this.destination = null;
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.renderer.drawFrame(this);
    this.onFrame?.();
    requestAnimationFrame(this.frame);
  }

  pointerWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return { sx, sy, x: sx + this.camera.x, y: sy + this.camera.y };
  }

  characterAtScreen(sx, sy) {
    const characters = [...this.npcs, ...this.companions];
    if (this.player) characters.push(this.player);
    characters.sort((a, b) => this.interpolated(b).y - this.interpolated(a).y);
    for (const character of characters) {
      const position = this.interpolated(character);
      const footX = (position.x + 0.5) * TILE - this.camera.x;
      const footY = (position.y + 1) * TILE - this.camera.y;
      const h = character.isCompanion ? COMPANION_HEIGHT : CHARACTER_HEIGHT;
      const width = h * 0.78;
      if (sx >= footX - width / 2 && sx <= footX + width / 2 && sy >= footY - h && sy <= footY) {
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
    if (this.isMenuOpen()) return;

    if (event.key === 'Enter' || event.key === ' ') {
      this.onActionKey?.(this.player);
      return;
    }

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
