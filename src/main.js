import { Game } from './game.js';
import {
  createRecipe,
  createCompanionRecipe,
  avatarDataUrl,
  preloadAvatars
} from './avatar.js';
import {
  generateWorld,
  encodeTerrain,
  decodeTerrain,
  makeSeed,
  isWalkable,
  findOpenTile
} from './world.js';
import { PLAYER_NAMES, COMPANION_NAMES, pickName, pickVibe } from './names.js';
import { serializeSave, saveState, loadSave, clearSave } from './storage.js';
import { DialogueManager } from './dialogue.js';
import { createStarterInventory } from './inventory.js';
import { FetchMiniGame } from './games/fetch.js';
import { TicTacToeMiniGame } from './games/tic-tac-toe.js';
import { SetupWizard } from './ui/wizard.js';
import { PanelsUI } from './ui/panels.js';

const MAX_NPCS = 40;
const DEFAULT_CROWD = 10;

const $ = id => document.getElementById(id);

let game = null;
let draft = null;
let dialogue = null;
let fetchGame = null;
let tttGame = null;
let wizard = null;
let panels = null;
let friends = new Set();
let toastTimer = 0;
let entered = false;

function makeId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
  return `${prefix}-${value}`;
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function friendNpcs() {
  if (!game) return [];
  return game.npcs.filter(npc => friends.has(npc.id));
}

function onFriendshipChanged(npcId, isFriend) {
  if (isFriend) friends.add(npcId);
  else friends.delete(npcId);
  panels?.updateFriendsUI();
  saveNow();
}

function onDialogueEnded() {
  game?.select(null);
  game?.resumeFromDialogue();
  panels?.updateFriendsUI();
  saveNow();
}

function onPlayGame(type, opponent) {
  if (type === 'tic-tac-toe') {
    tttGame?.unfurlBoard(opponent);
  }
}

function openDialogue(npc) {
  if (!npc) return;
  panels?.closeAllPanels();
  game.select(npc.id);
  const isFriend = friends.has(npc.id);
  const hasTTT = Boolean(game?.player?.inventory?.some(i => i.id === 'tic-tac-toe'));
  dialogue.open(npc, isFriend, { canPlayTicTacToe: isFriend && hasTTT });
}

function makeDraft() {
  const worldSeed = makeSeed();
  const world = generateWorld(worldSeed);
  const playerBuddyId = 'player';
  const playerCompanion = {
    id: makeId('comp'),
    name: randomFrom(COMPANION_NAMES),
    buddyId: playerBuddyId,
    recipe: createCompanionRecipe()
  };

  return {
    worldSeed,
    world,
    playerName: randomFrom(PLAYER_NAMES),
    playerRecipe: createRecipe(),
    playerCompanion,
    playerInventory: createStarterInventory(),
    npcs: [],
    crowdCount: DEFAULT_CROWD,
    crowdInitialized: false
  };
}

function makeNpc() {
  const used = new Set(draft.npcs.map(npc => npc.name));
  const npcId = makeId('npc');
  return {
    id: npcId,
    name: pickName(used),
    recipe: createRecipe(),
    vibe: pickVibe(),
    inventory: createStarterInventory(),
    companion: {
      id: makeId('comp'),
      name: randomFrom(COMPANION_NAMES),
      buddyId: npcId,
      recipe: createCompanionRecipe()
    }
  };
}

function openWizard({ fresh = false } = {}) {
  if (fresh || !draft) {
    draft = makeDraft();
    ensureGame();
    friends = new Set();
  }

  if (dialogue?.isOpen()) dialogue.close();
  panels?.closeAllPanels();
  entered = false;
  game.setInteractive(false);
  game.setPreview(draft.world.grid, draft.worldSeed, draft.world.spawn);
  panels?.updateFriendsUI();
  wizard.setDraft(draft);
  wizard.open({ fresh });
}

function onTTTGameEnd(winner, opponent) {
  if (!opponent) return;
  const winText = winner === 'X'
    ? `Great game! You won that round. Want to play again?`
    : (winner === 'O' ? `Haha, gotcha! Good match. Want another round?` : `That was a tight draw! Want a rematch?`);

  dialogue.openCustomBeat(opponent, winText, [
    {
      label: 'Play again',
      className: 'primary',
      onClick: () => {
        dialogue.close();
        tttGame?.resetRound();
      }
    },
    {
      label: 'Pack up',
      className: 'pill quiet',
      onClick: () => {
        dialogue.close();
        tttGame?.packUpBoard();
      }
    }
  ]);
}

function handleActionKey(character) {
  if (tttGame?.isOpen()) {
    tttGame.handleAction(character);
  }
}

function onAbandonPrompt(onConfirm, onCancel) {
  const opponent = tttGame?.activeBoard?.opponent;
  const oppName = opponent?.name || 'Your friend';
  dialogue.openCustomBeat(opponent, `${oppName}: Are you walking away? Abandon the Tic-Tac-Toe game and pack up?`, [
    {
      label: 'Abandon & pack up',
      className: 'danger',
      onClick: () => {
        dialogue.close();
        onConfirm();
      }
    },
    {
      label: 'Keep playing',
      className: 'primary',
      onClick: () => {
        dialogue.close();
        onCancel();
      }
    }
  ]);
}

function ensureGame() {
  if (!game) {
    dialogue = new DialogueManager({
      onDialogueEnd: onDialogueEnded,
      onFriendshipChange: onFriendshipChanged,
      onPlayGame
    });

    game = new Game({
      canvas: $('world'),
      minimap: $('minimap'),
      onSelect: character => panels?.showCard(character),
      onToast: showToast,
      onDialogue: openDialogue,
      onActionKey: handleActionKey
    });

    fetchGame = new FetchMiniGame({ game, onToast: showToast });
    tttGame = new TicTacToeMiniGame({
      game,
      onToast: showToast,
      onGameEnd: onTTTGameEnd,
      onAbandonPrompt
    });
    game.registerMiniGame(fetchGame);
    game.registerMiniGame(tttGame);
  }
  return game;
}

function updateWanderButton() {
  const button = $('wander-toggle');
  const on = Boolean(game?.wander);
  button.setAttribute('aria-pressed', String(on));
  button.querySelector('.label').textContent = on ? 'Wander on' : 'Wander paused';
}

function updateMeta() {
  const seed = draft?.worldSeed || '';
  $('world-meta').textContent = `64 × 64 · ${seed}`;
}

function makeLiveNpc() {
  const used = new Set(game.npcs.map(npc => npc.name));
  const npcId = makeId('npc');
  return {
    id: npcId,
    name: pickName(used),
    recipe: createRecipe(),
    vibe: pickVibe(),
    inventory: createStarterInventory(),
    companion: {
      id: makeId('comp'),
      name: randomFrom(COMPANION_NAMES),
      buddyId: npcId,
      recipe: createCompanionRecipe()
    }
  };
}

function scatterNpcs(terrain, component, spawn, count) {
  const walkableCells = (component && component.length ? component : [])
    .filter(cell => isWalkable(terrain[cell.y]?.[cell.x]) && !(cell.x === spawn.x && cell.y === spawn.y));

  if (walkableCells.length < count * 2) {
    walkableCells.length = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (isWalkable(terrain[y]?.[x]) && !(x === spawn.x && y === spawn.y)) {
          walkableCells.push({ x, y });
        }
      }
    }
  }

  for (let i = walkableCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [walkableCells[i], walkableCells[j]] = [walkableCells[j], walkableCells[i]];
  }

  const chosen = [];
  const distanceFromSpawn = cell => Math.abs(cell.x - spawn.x) + Math.abs(cell.y - spawn.y);

  const near = walkableCells.filter(cell => distanceFromSpawn(cell) >= 3 && distanceFromSpawn(cell) <= 12);
  const mid = walkableCells.filter(cell => distanceFromSpawn(cell) > 12 && distanceFromSpawn(cell) <= 25);
  const far = walkableCells.filter(cell => distanceFromSpawn(cell) > 25);

  const pool = [];
  const maxLen = Math.max(near.length, mid.length, far.length);
  for (let i = 0; i < maxLen; i++) {
    if (far[i]) pool.push(far[i]);
    if (mid[i]) pool.push(mid[i]);
    if (near[i]) pool.push(near[i]);
  }
  pool.push(...walkableCells);

  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (isWalkable(terrain[cell.y]?.[cell.x]) &&
        chosen.every(other => Math.abs(other.x - cell.x) + Math.abs(other.y - cell.y) >= 3)) {
      chosen.push(cell);
    }
  }

  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (isWalkable(terrain[cell.y]?.[cell.x]) &&
        chosen.every(other => Math.abs(other.x - cell.x) + Math.abs(other.y - cell.y) >= 2)) {
      chosen.push(cell);
    }
  }

  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (isWalkable(terrain[cell.y]?.[cell.x]) &&
        !chosen.some(other => other.x === cell.x && other.y === cell.y)) {
      chosen.push(cell);
    }
  }

  return chosen;
}

function buildLiveNpcs() {
  const spots = scatterNpcs(draft.world.grid, draft.world.component, draft.world.spawn, draft.npcs.length);
  const occupied = new Set([`${draft.world.spawn.x},${draft.world.spawn.y}`]);

  return draft.npcs.map((npc, index) => {
    let spot = spots[index];

    if (!spot || !isWalkable(draft.world.grid[spot.y]?.[spot.x]) || occupied.has(`${spot.x},${spot.y}`)) {
      spot = findOpenTile(draft.world.grid, draft.world.spawn, occupied, 4);
    }
    occupied.add(`${spot.x},${spot.y}`);

    return {
      id: npc.id,
      name: npc.name,
      recipe: npc.recipe,
      vibe: npc.vibe,
      inventory: npc.inventory || createStarterInventory(),
      companion: npc.companion,
      x: spot.x,
      y: spot.y
    };
  });
}

async function enterPark() {
  const button = $('enter-park');
  button.disabled = true;
  button.textContent = 'Opening the gate…';

  const npcs = buildLiveNpcs();
  const companions = [];

  if (draft.playerCompanion) {
    companions.push({
      ...draft.playerCompanion,
      x: draft.world.spawn.x,
      y: draft.world.spawn.y
    });
  }

  for (const npc of npcs) {
    if (npc.companion) {
      companions.push({
        ...npc.companion,
        x: npc.x,
        y: npc.y
      });
    }
  }

  await preloadAvatars([
    draft.playerRecipe,
    draft.playerCompanion?.recipe,
    ...npcs.map(npc => npc.recipe),
    ...companions.map(c => c.recipe)
  ]);

  const playerName = draft.playerName.trim() || 'You';
  const state = {
    version: 1,
    worldSeed: draft.worldSeed,
    terrain: encodeTerrain(draft.world.grid),
    playerName,
    playerRecipe: draft.playerRecipe,
    player: {
      x: draft.world.spawn.x,
      y: draft.world.spawn.y,
      inventory: draft.playerInventory || createStarterInventory()
    },
    npcs,
    companions,
    friends: [],
    wander: true
  };

  applyState(state);
  panels?.closeCard();
  wizard.close();
  game.setInteractive(true);
  game.start();
  updateWanderButton();
  updateMeta();
  saveNow();
  showToast(`Welcome to the park, ${playerName}. Check your Bag for toys!`);
  button.disabled = false;
  button.textContent = 'Enter the park';
}

function applyState(state) {
  const terrain = decodeTerrain(state.terrain) || generateWorld(state.worldSeed).grid;
  const rawPlayer = {
    id: 'player',
    name: state.playerName || 'You',
    recipe: state.playerRecipe,
    x: Number.isFinite(Number(state.player?.x)) ? Math.round(Number(state.player.x)) : 32,
    y: Number.isFinite(Number(state.player?.y)) ? Math.round(Number(state.player.y)) : 32,
    direction: state.player?.direction ?? 0,
    inventory: state.player?.inventory || createStarterInventory()
  };
  if (!isWalkable(terrain[rawPlayer.y]?.[rawPlayer.x])) {
    const spot = findOpenTile(terrain, { x: 32, y: 32 });
    rawPlayer.x = spot.x;
    rawPlayer.y = spot.y;
  }

  const npcs = (Array.isArray(state.npcs) ? state.npcs : [])
    .filter(npc => npc && npc.recipe && npc.name)
    .map(npc => {
      const hasPosition = Number.isFinite(Number(npc.x)) && Number.isFinite(Number(npc.y));
      const entry = {
        id: npc.id || makeId('npc'),
        name: npc.name,
        recipe: npc.recipe,
        vibe: npc.vibe || '',
        inventory: npc.inventory || createStarterInventory(),
        x: hasPosition ? Math.round(Number(npc.x)) : -1,
        y: hasPosition ? Math.round(Number(npc.y)) : -1,
        direction: Number(npc.direction) || 0
      };
      if (!isWalkable(terrain[entry.y]?.[entry.x])) {
        const spot = findOpenTile(terrain, { x: rawPlayer.x, y: rawPlayer.y });
        entry.x = spot.x;
        entry.y = spot.y;
      }
      return entry;
    });

  const occupiedPositions = new Set([`${rawPlayer.x},${rawPlayer.y}`]);
  for (const npc of npcs) {
    let key = `${npc.x},${npc.y}`;
    if (occupiedPositions.has(key)) {
      const spot = findOpenTile(terrain, { x: rawPlayer.x, y: rawPlayer.y }, occupiedPositions, 1);
      npc.x = spot.x;
      npc.y = spot.y;
      key = `${npc.x},${npc.y}`;
    }
    occupiedPositions.add(key);
  }

  let companions = Array.isArray(state.companions) ? state.companions : [];
  if (!companions.length) {
    companions.push({
      id: makeId('comp'),
      name: randomFrom(COMPANION_NAMES),
      buddyId: 'player',
      recipe: createCompanionRecipe(),
      x: rawPlayer.x,
      y: rawPlayer.y,
      direction: 0
    });
    for (const npc of npcs) {
      companions.push({
        id: makeId('comp'),
        name: randomFrom(COMPANION_NAMES),
        buddyId: npc.id,
        recipe: createCompanionRecipe(),
        x: npc.x,
        y: npc.y,
        direction: 0
      });
    }
  }

  ensureGame();
  game.setWorld({
    terrain,
    worldSeed: state.worldSeed,
    player: rawPlayer,
    npcs,
    companions,
    wander: state.wander !== false
  });
  friends = new Set(
    (Array.isArray(state.friends) ? state.friends : [])
      .filter(id => npcs.some(npc => npc.id === id))
  );
  draft = {
    worldSeed: state.worldSeed,
    world: { grid: terrain, spawn: { x: rawPlayer.x, y: rawPlayer.y }, component: [] },
    playerName: rawPlayer.name,
    playerRecipe: rawPlayer.recipe,
    playerInventory: rawPlayer.inventory,
    npcs,
    crowdCount: npcs.length,
    crowdInitialized: true
  };
  wizard.setDraft(draft);
  entered = true;
  updateWanderButton();
  panels?.updateFriendsUI();
  updateMeta();
}

function saveNow() {
  if (!entered) return;
  const state = serializeSave(game, draft, friends);
  saveState(state);
}

function addNeighbour() {
  if (!game.player) return;
  if (game.npcs.length >= MAX_NPCS) {
    showToast('The park is full. Forty neighbours is plenty.');
    return;
  }
  const npc = makeLiveNpc();
  game.addNpc(npc, npc.companion);
  panels?.updateFriendsUI();
  saveNow();
  showToast(`${npc.name} and their buddy ${npc.companion.name} moved in.`);
}

function toggleWander() {
  if (!game) return;
  game.setWander(!game.wander);
  updateWanderButton();
  saveNow();
  showToast(game.wander ? 'Neighbours are wandering.' : 'Neighbours are staying put.');
}

function rerollCardCharacter() {
  const cardCharacter = panels?.cardCharacter;
  if (!cardCharacter || cardCharacter.isPlayer || cardCharacter.isCompanion) return;
  const recipe = createRecipe();
  cardCharacter.recipe = recipe;
  cardCharacter.vibe = pickVibe();
  game.updateNpcRecipe(cardCharacter.id, recipe);
  $('npc-avatar').src = avatarDataUrl(recipe);
  $('npc-vibe').textContent = cardCharacter.vibe;
  saveNow();
  showToast(`New look for ${cardCharacter.name}.`);
}

function removeCardCharacter() {
  const cardCharacter = panels?.cardCharacter;
  if (!cardCharacter || cardCharacter.isPlayer || cardCharacter.isCompanion) return;
  const name = cardCharacter.name;
  friends.delete(cardCharacter.id);
  game.removeNpc(cardCharacter.id);
  panels?.closeCard();
  panels?.updateFriendsUI();
  saveNow();
  showToast(`${name} left the park.`);
}

function bindEvents() {
  $('wander-toggle').addEventListener('click', toggleWander);
  $('add-npc').addEventListener('click', addNeighbour);
  $('new-park').addEventListener('click', () => {
    if (!window.confirm('Start a new park? Your current park and neighbours will be replaced.')) return;
    clearSave();
    entered = false;
    openWizard({ fresh: true });
  });

  $('npc-shuffle').addEventListener('click', rerollCardCharacter);
  $('npc-remove').addEventListener('click', removeCardCharacter);

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (dialogue?.isOpen()) {
      dialogue.close();
      return;
    }
    panels?.closeAllPanels();
  });

  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  window.setInterval(saveNow, 8000);
}

function boot() {
  panels = new PanelsUI({
    getGame: () => game,
    getFriends: () => friends,
    onThrowBall: options => fetchGame?.throwBall(options),
    onUnfurlTTT: opponent => tttGame?.unfurlBoard(opponent),
    onPackUpTTT: () => tttGame?.packUpBoard(),
    isTTTOpen: () => tttGame?.isOpen(),
    onSave: saveNow,
    onSelect: character => panels?.showCard(character)
  });

  wizard = new SetupWizard({
    onEnterPark: enterPark,
    onDraftChange: (action, count) => {
      if (action === 'to-crowd') {
        if (!draft.crowdInitialized) wizard.resizeCrowd(draft.crowdCount || DEFAULT_CROWD, makeNpc);
        else wizard.renderCrowd();
      } else if (action === 'resize-crowd') {
        wizard.resizeCrowd(count, makeNpc);
      }
    },
    makeSeed
  });

  ensureGame();
  bindEvents();

  const saved = loadSave();
  if (saved) {
    applyState(saved);
    panels.closeCard();
    wizard.close();
    game.start();
    game.setInteractive(true);
    updateWanderButton();
    updateMeta();
    showToast('Welcome back to the park.');
  } else {
    draft = makeDraft();
    wizard.setDraft(draft);
    openWizard();
    game.start();
    updateMeta();
  }
}

boot();

window.playPark = {
  get game() { return game; },
  get draft() { return draft; },
  get fetchGame() { return fetchGame; },
  get tttGame() { return tttGame; }
};
