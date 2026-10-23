import { Game } from './game.js';
import {
  createRecipe,
  createCompanionRecipe,
  rerollRecipe,
  avatarDataUrl,
  preloadAvatars,
  TOP_VARIANTS,
  OUTFIT_VARIANTS,
  GLASSES_VARIANTS,
  BEARD_VARIANTS,
  COLOR_PALETTES,
  prettyLabel
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

const MAX_NPCS = 40;
const DEFAULT_CROWD = 10;
const LOOK_FIELDS = ['top', 'outfit', 'glasses', 'beard', 'skin', 'hair', 'shirt', 'pants', 'shoes'];
const COLOR_FIELDS = ['skin', 'hair', 'shirt', 'pants', 'shoes'];

const $ = id => document.getElementById(id);

let game = null;
let draft = null;
let cardCharacter = null;
let dialogue = null;
let fetchGame = null;
let tttGame = null;
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

function renderFriendList() {
  const list = $('friend-list');
  list.replaceChildren();
  const npcs = friendNpcs();

  if (!npcs.length) {
    const empty = document.createElement('p');
    empty.className = 'friend-empty';
    empty.textContent = 'No friends yet. Bump into a neighbour and say yes.';
    list.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const npc of npcs) {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.setAttribute('role', 'listitem');

    const image = document.createElement('img');
    image.src = avatarDataUrl(npc.recipe);
    image.alt = '';

    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = npc.name;
    const vibe = document.createElement('small');
    vibe.textContent = npc.vibe || 'Park friend';
    copy.append(name, vibe);

    row.append(image, copy);
    fragment.append(row);
  }
  list.append(fragment);
}

function renderInventory() {
  const list = $('inventory-list');
  if (!list) return;
  list.replaceChildren();

  const inventory = game?.player?.inventory || [];
  if (!inventory.length) {
    const empty = document.createElement('p');
    empty.className = 'friend-empty';
    empty.textContent = 'Your bag is empty.';
    list.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of inventory) {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.setAttribute('role', 'listitem');

    const icon = document.createElement('span');
    icon.style.fontSize = '28px';
    icon.style.lineHeight = '1';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '44px';
    icon.style.height = '44px';
    icon.textContent = item.icon || '📦';
    if (item.color) icon.style.textShadow = `0 0 8px ${item.color}`;

    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = item.name;
    const desc = document.createElement('small');
    desc.textContent = item.description;
    copy.append(name, desc);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'pill';

    if (item.id === 'ball') {
      action.textContent = 'Throw';
      action.addEventListener('click', () => {
        closeInventoryPanel();
        fetchGame?.throwBall({ color: item.color });
      });
    } else if (item.id === 'tic-tac-toe') {
      action.textContent = tttGame?.isOpen() ? 'Pack up' : 'Unfurl';
      action.addEventListener('click', () => {
        closeInventoryPanel();
        if (tttGame?.isOpen()) {
          tttGame.packUpBoard();
        } else {
          // Find closest friend or default to first friend or nearby npc
          const friend = friendNpcs()[0] || game.npcs[0];
          tttGame?.unfurlBoard(friend);
        }
      });
    }

    row.append(icon, copy, action);
    fragment.append(row);
  }
  list.append(fragment);
}

function updateFriendsUI() {
  if (game) {
    for (const id of [...friends]) {
      if (!game.getNpc(id)) friends.delete(id);
    }
  }

  const total = game?.npcs.length || 0;
  const count = friends.size;
  $('friends-count').textContent = `${count}/${total}`;
  $('friends-toggle').setAttribute('aria-label', `Friend list: ${count} of ${total} neighbours`);
  $('friends-summary').textContent = count
    ? `${count} of ${total} neighbour${total === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} your friend.`
    : 'No friends yet. Bump into a neighbour and say yes.';

  if (!$('friends-panel').hidden) renderFriendList();
}

function closeFriendsPanel() {
  $('friends-panel').hidden = true;
  $('friends-toggle').setAttribute('aria-expanded', 'false');
}

function toggleFriendsPanel() {
  const panel = $('friends-panel');
  const opening = panel.hidden;
  if (!opening) {
    closeFriendsPanel();
    return;
  }
  closeCard();
  closeInventoryPanel();
  panel.hidden = false;
  $('friends-toggle').setAttribute('aria-expanded', 'true');
  updateFriendsUI();
  renderFriendList();
}

function closeInventoryPanel() {
  const panel = $('inventory-panel');
  if (panel) {
    panel.hidden = true;
    $('inventory-toggle').setAttribute('aria-expanded', 'false');
  }
}

function toggleInventoryPanel() {
  const panel = $('inventory-panel');
  if (!panel) return;
  const opening = panel.hidden;
  if (!opening) {
    closeInventoryPanel();
    return;
  }
  closeCard();
  closeFriendsPanel();
  panel.hidden = false;
  $('inventory-toggle').setAttribute('aria-expanded', 'true');
  renderInventory();
}

function onFriendshipChanged(npcId, isFriend) {
  if (isFriend) friends.add(npcId);
  else friends.delete(npcId);
  updateFriendsUI();
  saveNow();
}

function onDialogueEnded() {
  game?.select(null);
  game?.resumeFromDialogue();
  updateFriendsUI();
  saveNow();
}

function onPlayGame(type, opponent) {
  if (type === 'tic-tac-toe') {
    tttGame?.unfurlBoard(opponent);
  }
}

function openDialogue(npc) {
  if (!npc) return;
  closeCard();
  closeFriendsPanel();
  closeInventoryPanel();
  game.select(npc.id);
  const isFriend = friends.has(npc.id);
  const hasTTT = Boolean(game?.player?.inventory?.some(i => i.id === 'tic-tac-toe'));
  dialogue.open(npc, isFriend, { canPlayTicTacToe: isFriend && hasTTT });
}

function fillSelect(select, entries) {
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    fragment.append(option);
  }
  select.append(fragment);
}

function buildLookControls() {
  fillSelect($('look-top'), [
    { value: 'random', label: 'Random' },
    { value: 'none', label: 'None' },
    ...TOP_VARIANTS.map(value => ({ value, label: prettyLabel(value) }))
  ]);
  fillSelect($('look-outfit'), [
    { value: 'random', label: 'Random' },
    ...OUTFIT_VARIANTS.map(value => ({ value, label: prettyLabel(value) }))
  ]);
  fillSelect($('look-glasses'), [
    { value: 'random', label: 'Random' },
    { value: 'none', label: 'None' },
    ...GLASSES_VARIANTS.map(value => ({ value, label: prettyLabel(value) }))
  ]);
  fillSelect($('look-beard'), [
    { value: 'random', label: 'Random' },
    { value: 'none', label: 'None' },
    ...BEARD_VARIANTS.map(value => ({ value, label: prettyLabel(value) }))
  ]);

  for (const key of COLOR_FIELDS) {
    fillSelect($(`look-${key}`), [
      { value: 'random', label: 'Random' },
      ...COLOR_PALETTES[key].map(color => ({ value: color, label: color }))
    ]);
  }

  for (const key of LOOK_FIELDS) {
    $(`look-${key}`).addEventListener('change', event => {
      draft.playerRecipe.look[key] = event.target.value;
      syncCreator();
    });
  }
}

function syncSwatches() {
  for (const key of COLOR_FIELDS) {
    const swatch = $(`swatch-${key}`);
    const value = draft.playerRecipe.look[key];
    if (value === 'random') {
      swatch.style.background = 'conic-gradient(from 20deg, #f4d7bd, #c08457, #74452a, #8a3a2a, #f4d7bd)';
      swatch.title = 'Random colour';
    } else {
      swatch.style.background = value;
      swatch.title = value;
    }
  }
}

function syncCreator() {
  $('player-name').value = draft.playerName;
  $('player-seed').value = draft.playerRecipe.seed;
  for (const key of LOOK_FIELDS) {
    const select = $(`look-${key}`);
    const value = draft.playerRecipe.look[key] || 'random';
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  syncSwatches();
  const preview = $('player-preview');
  preview.src = avatarDataUrl(draft.playerRecipe);
  preview.alt = `${draft.playerName}'s Voxel Art character`;
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

function resizeCrowd(count) {
  draft.crowdCount = count;
  draft.crowdInitialized = true;
  while (draft.npcs.length < count) draft.npcs.push(makeNpc());
  if (draft.npcs.length > count) draft.npcs.length = count;
  $('crowd-count-label').value = String(count);
  $('crowd-count').value = String(count);
  renderCrowd();
}

function rerollDraftNpc(npc, card) {
  npc.recipe = createRecipe();
  npc.vibe = pickVibe();
  if (npc.companion) npc.companion.recipe = createCompanionRecipe();
  const image = card.querySelector('img');
  const vibe = card.querySelector('small');
  if (image) image.src = avatarDataUrl(npc.recipe);
  if (vibe) vibe.textContent = npc.vibe;
}

function renderCrowd() {
  const grid = $('crowd-grid');
  grid.replaceChildren();
  if (!draft.npcs.length) {
    const empty = document.createElement('p');
    empty.className = 'crowd-empty';
    empty.textContent = 'An empty park. You can always invite neighbours later.';
    grid.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const npc of draft.npcs) {
    const card = document.createElement('div');
    card.className = 'crowd-card';
    card.setAttribute('role', 'listitem');

    const image = document.createElement('img');
    image.src = avatarDataUrl(npc.recipe);
    image.alt = `${npc.name}, park neighbour`;
    image.loading = 'lazy';

    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = npc.name;
    const vibe = document.createElement('small');
    vibe.textContent = npc.vibe;
    copy.append(name, vibe);

    const shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.className = 'icon-button';
    shuffle.textContent = '↻';
    shuffle.title = `New look for ${npc.name}`;
    shuffle.setAttribute('aria-label', `New look for ${npc.name}`);
    shuffle.addEventListener('click', () => rerollDraftNpc(npc, card));

    card.append(image, copy, shuffle);
    fragment.append(card);
  }
  grid.append(fragment);
}

function setWizardStep(step) {
  $('step-character').hidden = step !== 1;
  $('step-crowd').hidden = step !== 2;
  $('step-dot-1').classList.toggle('active', step === 1);
  $('step-dot-1').classList.toggle('done', step > 1);
  $('step-dot-2').classList.toggle('active', step === 2);
}

function openWizard({ fresh = false } = {}) {
  if (fresh || !draft) {
    draft = makeDraft();
    ensureGame();
    friends = new Set();
  }

  if (dialogue?.isOpen()) dialogue.close();
  closeFriendsPanel();
  closeInventoryPanel();
  entered = false;
  game.setInteractive(false);
  game.setPreview(draft.world.grid, draft.worldSeed, draft.world.spawn);
  $('hud').hidden = true;
  $('wizard').hidden = false;
  document.body.classList.add('wizard-open');
  $('npc-card').hidden = true;
  closeCard();
  updateFriendsUI();
  syncCreator();
  setWizardStep(1);
  window.setTimeout(() => $('player-name').focus({ preventScroll: true }), 120);
}

function closeWizard() {
  $('wizard').hidden = true;
  $('hud').hidden = false;
  document.body.classList.remove('wizard-open');
}

function handleActionKey(character) {
  if (tttGame?.isOpen()) {
    tttGame.handleAction(character);
  }
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
      onSelect: handleSelect,
      onToast: showToast,
      onDialogue: openDialogue,
      onActionKey: handleActionKey
    });

    fetchGame = new FetchMiniGame({ game, onToast: showToast });
    tttGame = new TicTacToeMiniGame({ game, onToast: showToast });
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

function handleSelect(character) {
  if (!character) {
    closeCard();
    return;
  }
  closeFriendsPanel();
  closeInventoryPanel();
  cardCharacter = character;
  game.select(character.isPlayer ? 'player' : character.id);

  const isPlayer = character.isPlayer;
  const isCompanion = character.isCompanion;
  $('npc-avatar').src = avatarDataUrl(character.recipe);
  $('npc-avatar').alt = `${character.name}'s character`;

  if (isPlayer) {
    $('npc-name').textContent = `${character.name} · you`;
    $('npc-vibe').textContent = 'Mayor of the park, apparently.';
  } else if (isCompanion) {
    $('npc-name').textContent = `${character.name} · buddy`;
    $('npc-vibe').textContent = 'A loyal companion exploring the park.';
  } else {
    $('npc-name').textContent = character.name;
    $('npc-vibe').textContent = character.vibe || 'A park regular.';
  }

  $('npc-shuffle').hidden = isPlayer || isCompanion;
  $('npc-remove').hidden = isPlayer || isCompanion;
  $('npc-card').hidden = false;
}

function closeCard() {
  cardCharacter = null;
  $('npc-card').hidden = true;
  game?.select(null);
}

function scatterNpcs(component, spawn, count) {
  const cells = component.filter(cell => !(cell.x === spawn.x && cell.y === spawn.y));
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const chosen = [];
  const distanceFromSpawn = cell => Math.abs(cell.x - spawn.x) + Math.abs(cell.y - spawn.y);
  const near = cells.filter(cell => distanceFromSpawn(cell) >= 3 && distanceFromSpawn(cell) <= 14);
  const far = cells.filter(cell => distanceFromSpawn(cell) > 14);
  const pool = [...near, ...far, ...cells];

  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (chosen.every(other => Math.abs(other.x - cell.x) + Math.abs(other.y - cell.y) >= 2)) {
      chosen.push(cell);
    }
  }
  for (const cell of pool) {
    if (chosen.length >= count) break;
    if (!chosen.some(other => other.x === cell.x && other.y === cell.y)) chosen.push(cell);
  }
  return chosen;
}

function buildLiveNpcs() {
  const spots = scatterNpcs(draft.world.component, draft.world.spawn, draft.npcs.length);
  return draft.npcs.map((npc, index) => {
    const spot = spots[index] || findOpenTile(draft.world.grid, draft.world.spawn);
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
  closeCard();
  closeWizard();
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

  // Companions handling (support legacy saves without companions)
  let companions = Array.isArray(state.companions) ? state.companions : [];
  if (!companions.length) {
    // Generate companions for player and existing npcs
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
  entered = true;
  updateWanderButton();
  updateFriendsUI();
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
  updateFriendsUI();
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
  if (!cardCharacter || cardCharacter.isPlayer || cardCharacter.isCompanion) return;
  const name = cardCharacter.name;
  friends.delete(cardCharacter.id);
  game.removeNpc(cardCharacter.id);
  closeCard();
  updateFriendsUI();
  saveNow();
  showToast(`${name} left the park.`);
}

function bindEvents() {
  $('shuffle-look').addEventListener('click', () => {
    draft.playerRecipe = rerollRecipe(draft.playerRecipe);
    syncCreator();
  });

  $('reset-look').addEventListener('click', () => {
    draft.playerRecipe = createRecipe(draft.playerRecipe.seed);
    syncCreator();
  });

  $('player-name').addEventListener('input', event => {
    draft.playerName = event.target.value;
  });

  $('player-seed').addEventListener('change', event => {
    const seed = event.target.value.trim() || makeSeed();
    draft.playerRecipe = createRecipe(seed, draft.playerRecipe.look);
    syncCreator();
  });

  $('to-crowd').addEventListener('click', () => {
    if (!draft.playerName.trim()) {
      draft.playerName = randomFrom(PLAYER_NAMES);
      syncCreator();
    }
    if (!draft.crowdInitialized) resizeCrowd(draft.crowdCount || DEFAULT_CROWD);
    else renderCrowd();
    setWizardStep(2);
    $('enter-park').focus({ preventScroll: true });
  });

  $('back-to-character').addEventListener('click', () => {
    setWizardStep(1);
    syncCreator();
  });

  $('crowd-count').addEventListener('input', event => {
    resizeCrowd(Number(event.target.value));
  });

  $('shuffle-crowd').addEventListener('click', () => {
    for (const npc of draft.npcs) {
      npc.recipe = createRecipe();
      npc.vibe = pickVibe();
    }
    renderCrowd();
  });

  $('enter-park').addEventListener('click', enterPark);

  $('inventory-toggle')?.addEventListener('click', toggleInventoryPanel);
  $('inventory-close')?.addEventListener('click', closeInventoryPanel);

  $('wander-toggle').addEventListener('click', toggleWander);
  $('friends-toggle').addEventListener('click', toggleFriendsPanel);
  $('friends-close').addEventListener('click', closeFriendsPanel);
  $('add-npc').addEventListener('click', addNeighbour);
  $('new-park').addEventListener('click', () => {
    if (!window.confirm('Start a new park? Your current park and neighbours will be replaced.')) return;
    clearSave();
    entered = false;
    openWizard({ fresh: true });
  });

  $('npc-close').addEventListener('click', closeCard);
  $('npc-shuffle').addEventListener('click', rerollCardCharacter);
  $('npc-remove').addEventListener('click', removeCardCharacter);

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (dialogue?.isOpen()) {
      dialogue.close();
      return;
    }
    if (!$('inventory-panel').hidden) {
      closeInventoryPanel();
      return;
    }
    if (!$('friends-panel').hidden) {
      closeFriendsPanel();
      return;
    }
    if (!$('npc-card').hidden) closeCard();
  });

  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  window.setInterval(saveNow, 8000);
}

function boot() {
  buildLookControls();
  ensureGame();
  bindEvents();

  const saved = loadSave();
  if (saved) {
    applyState(saved);
    closeCard();
    closeWizard();
    game.start();
    game.setInteractive(true);
    updateWanderButton();
    updateMeta();
    showToast('Welcome back to the park.');
  } else {
    draft = makeDraft();
    openWizard();
    game.start();
    updateMeta();
  }
}

boot();

// A small handle for tinkering in the console and for automated smoke tests.
window.playPark = {
  get game() { return game; },
  get draft() { return draft; },
  get fetchGame() { return fetchGame; },
  get tttGame() { return tttGame; }
};
