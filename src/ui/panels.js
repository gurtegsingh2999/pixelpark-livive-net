import { avatarDataUrl, bindAnimatedAvatar } from '../avatar.js';
import { loadStats } from '../storage.js';
import { formatCompanionInfo } from '../characters.js';
import { activeEntries, equip, getEffectForItem, unequip } from '../effects.js';

const $ = id => document.getElementById(id);

export const TABS = ['backpack', 'companions', 'friends', 'stats', 'debug'];

/**
 * Resolve what clicking a bag item should do, without branching on item ids.
 * Mini-game metadata supplies the game id for `unfurl` toys.
 */
export function itemAction(item, gameMetas = []) {
  if (!item || typeof item !== 'object') return { type: 'none' };
  if (item.action === 'throw') return { type: 'throw', item };
  if (getEffectForItem(item) || item.action === 'equip') return { type: 'equip', item };
  if (item.action === 'unfurl') {
    const meta = gameMetas.find(entry => entry && entry.itemId === item.id) || null;
    return meta
      ? { type: 'unfurl', gameId: meta.id, meta, item }
      : { type: 'none', item };
  }
  return { type: 'none', item };
}

function effectBadge(effect) {
  return effect?.ui?.badge || effect?.badge || '';
}

function chipLabel(entry) {
  return entry?.effect?.name || entry?.effect?.id || entry?.itemId || 'effect';
}

const TAB_CONFIGS = {
  backpack: { toggleId: 'inventory-toggle', panelId: 'inventory-panel', listId: 'inventory-list' },
  companions: { toggleId: 'companion-toggle', panelId: 'companion-panel', listId: 'companion-details' },
  friends: { toggleId: 'friends-toggle', panelId: 'friends-panel', listId: 'friend-list' },
  stats: { toggleId: 'stats-toggle', panelId: 'stats-panel', listId: 'stats-list' },
  debug: { toggleId: 'debug-toggle', panelId: 'debug-panel', listId: 'debug-actions' }
};

export class PanelsUI {
  constructor({
    getGame,
    getFriends,
    onThrowBall,
    onUnfurlTTT,
    onPackUpTTT,
    isTTTOpen,
    onUnfurlCheckers,
    onPackUpCheckers,
    isCheckersOpen,
    onUnfurlChess,
    onPackUpChess,
    isChessOpen,
    onSave,
    onSelect,
    onAddNeighbour,
    onNewPark,
    onToggleWander,
    onPlayGame,
    onPackUpGame,
    isGameOpen,
    getGameMetas,
    getHostState,
    getBehaviorSummary,
    onGrantEffects,
    onTriggerNpcGame,
    onToast
  }) {
    this.getGame = getGame;
    this.getFriends = getFriends;
    this.onThrowBall = onThrowBall;
    this.onUnfurlTTT = onUnfurlTTT;
    this.onPackUpTTT = onPackUpTTT;
    this.isTTTOpen = isTTTOpen;
    this.onUnfurlCheckers = onUnfurlCheckers;
    this.onPackUpCheckers = onPackUpCheckers;
    this.isCheckersOpen = isCheckersOpen;
    this.onUnfurlChess = onUnfurlChess;
    this.onPackUpChess = onPackUpChess;
    this.isChessOpen = isChessOpen;
    this.onSave = onSave;
    this.onSelect = onSelect;
    this.onAddNeighbour = onAddNeighbour;
    this.onNewPark = onNewPark;
    this.onToggleWander = onToggleWander;
    this.onPlayGame = onPlayGame;
    this.onPackUpGame = onPackUpGame;
    this.isGameOpen = isGameOpen;
    this.getGameMetas = getGameMetas;
    this.getHostState = getHostState;
    this.getBehaviorSummary = getBehaviorSummary;
    this.onGrantEffects = onGrantEffects;
    this.onTriggerNpcGame = onTriggerNpcGame;
    this.onToast = onToast;
    this.cardCharacter = null;
    this.activeTab = null;
    this.lastActiveTab = 'backpack';
    this.focusedIndex = 0;
    this.effectTargetSelections = new Map();
    this.bindEvents();
    this.bindKeyboardNav();
  }

  friendNpcs() {
    const game = this.getGame();
    if (!game) return [];
    const friends = this.getFriends();
    return game.npcs.filter(npc => friends.has(npc.id));
  }

  effectTargets() {
    const game = this.getGame();
    if (!game?.player) return [];
    const active = typeof game.getCompanionsFor === 'function'
      ? game.getCompanionsFor('player')
      : (game.companions || []).filter(comp => comp.buddyId === 'player');
    return [game.player, ...(active || [])].filter(Boolean);
  }

  effectItemKey(item) {
    return item?.uid || item?.id || '';
  }

  moveItemInstance(from, to, uidOrItem) {
    if (!from || !to || from === to) return null;
    const inventory = Array.isArray(from.inventory) ? from.inventory : (from.inventory = []);
    const uid = typeof uidOrItem === 'string' ? uidOrItem : uidOrItem?.uid;
    const id = typeof uidOrItem === 'object' ? uidOrItem?.id : null;
    const index = inventory.findIndex(candidate => (
      candidate && ((uid && candidate.uid === uid) || (!uid && id && candidate.id === id))
    ));
    if (index < 0) return null;
    const [item] = inventory.splice(index, 1);
    if (!Array.isArray(to.inventory)) to.inventory = [];
    to.inventory.push(item);
    return item;
  }

  findEquippedOwner(item) {
    const game = this.getGame();
    if (!game) return null;
    const owners = [
      game.player,
      ...(game.companions || []),
      ...(game.player?.stabledCompanions || [])
    ].filter(Boolean);
    for (const owner of owners) {
      const entry = this.equippedEntry(owner, item);
      if (entry) return { owner, entry };
    }
    return null;
  }

  isMenuOpen() {
    return this.activeTab !== null;
  }

  setActiveTab(tabName) {
    if (!TABS.includes(tabName)) return;
    this.activeTab = tabName;
    this.lastActiveTab = tabName;
    this.focusedIndex = 0;

    this.closeCard();
    for (const [tab, cfg] of Object.entries(TAB_CONFIGS)) {
      const isActive = tab === tabName;
      $(cfg.toggleId)?.classList.toggle('active-tab', isActive);
      $(cfg.toggleId)?.setAttribute('aria-expanded', String(isActive));
      const panel = $(cfg.panelId);
      if (panel) panel.hidden = !isActive;
    }

    if (tabName === 'backpack') this.renderInventory();
    else if (tabName === 'companions') this.renderCompanion();
    else if (tabName === 'friends') { this.updateFriendsUI(); this.renderFriendList(); }
    else if (tabName === 'stats') this.renderStats();
    else if (tabName === 'debug') this.updateDebugUI();

    this.updateVerticalFocus();
  }

  closeMenu() {
    this.activeTab = null;
    for (const cfg of Object.values(TAB_CONFIGS)) {
      $(cfg.toggleId)?.classList.remove('active-tab');
      $(cfg.toggleId)?.setAttribute('aria-expanded', 'false');
      const panel = $(cfg.panelId);
      if (panel) panel.hidden = true;
    }
    this.closeCard();
  }

  cycleTab(direction) {
    if (!this.activeTab) {
      this.setActiveTab(this.lastActiveTab || 'backpack');
      return;
    }
    const currentIndex = TABS.indexOf(this.activeTab);
    const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
    this.setActiveTab(TABS[nextIndex]);
  }

  // --- Panel Shortcuts ---
  closeInventoryPanel() { this.closeMenu(); }
  openInventoryPanel() { this.setActiveTab('backpack'); }
  toggleInventoryPanel() { this.activeTab === 'backpack' ? this.closeMenu() : this.setActiveTab('backpack'); }

  closeCompanionPanel() { this.closeMenu(); }
  openCompanionPanel() { this.setActiveTab('companions'); }
  toggleCompanionPanel() { this.activeTab === 'companions' ? this.closeMenu() : this.setActiveTab('companions'); }

  closeStatsPanel() { this.closeMenu(); }
  openStatsPanel() { this.setActiveTab('stats'); }
  toggleStatsPanel() { this.activeTab === 'stats' ? this.closeMenu() : this.setActiveTab('stats'); }

  closeFriendsPanel() { this.closeMenu(); }
  openFriendsPanel() { this.setActiveTab('friends'); }
  toggleFriendsPanel() { this.activeTab === 'friends' ? this.closeMenu() : this.setActiveTab('friends'); }

  closeDebugPanel() { this.closeMenu(); }
  openDebugPanel() { this.setActiveTab('debug'); }
  toggleDebugPanel() { this.activeTab === 'debug' ? this.closeMenu() : this.setActiveTab('debug'); }

  // --- Render Helpers ---

  gameMetas() {
    return Array.isArray(this.getGameMetas?.()) ? this.getGameMetas() : [];
  }

  notify(message) {
    if (typeof this.onToast === 'function') this.onToast(message);
  }

  isGameOpen(gameId) {
    if (typeof this.isGameOpen === 'function') return Boolean(this.isGameOpen(gameId));
    if (gameId === 'tic-tac-toe') return Boolean(this.isTTTOpen?.());
    if (gameId === 'checkers') return Boolean(this.isCheckersOpen?.());
    if (gameId === 'chess') return Boolean(this.isChessOpen?.());
    return false;
  }

  equippedEntry(character, item) {
    if (!character) return null;
    const now = (this.getGame()?.time || 0) * 1000;
    return activeEntries(character, now)
      .filter(entry => entry.phase === 'in')
      .find(entry => (
        (item.uid && entry.uid === item.uid) || (!item.uid && entry.itemId === item.id) || entry.itemId === item.id
      )) || null;
  }

  renderWornStrip(character, list) {
    if (!character) return;
    const worn = activeEntries(character, (this.getGame()?.time || 0) * 1000)
      .filter(entry => entry.phase === 'in');
    if (!worn.length) {
      const note = document.createElement('p');
      note.className = 'panel-note worn-empty';
      note.textContent = 'Nothing worn yet. Effect items you wear show up here.';
      list.append(note);
      return;
    }

    const strip = document.createElement('div');
    strip.className = 'worn-strip';
    strip.setAttribute('aria-label', 'Currently worn effects');
    for (const entry of worn) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'worn-chip';
      chip.setAttribute('aria-label', `Take off ${chipLabel(entry)}`);

      const icon = document.createElement('span');
      icon.className = 'worn-chip-icon';
      icon.textContent = entry.effect?.ui?.icon || '✨';

      const label = document.createElement('span');
      label.textContent = chipLabel(entry);

      const badgeText = effectBadge(entry.effect);
      const badge = document.createElement('span');
      badge.className = 'ui-badge';
      badge.textContent = badgeText || entry.slot;

      const close = document.createElement('span');
      close.className = 'worn-chip-x';
      close.setAttribute('aria-hidden', 'true');
      close.textContent = '×';

      chip.append(icon, label, badge, close);
      chip.addEventListener('click', () => this.unequipEntry(character, entry.uid));
      strip.append(chip);
    }
    list.append(strip);
  }

  activateItem(item) {
    const action = itemAction(item, this.gameMetas());
    if (action.type === 'throw') {
      this.closeMenu();
      this.onThrowBall?.({ color: item.color });
      return;
    }
    if (action.type === 'equip') {
      this.toggleEffectItem(item, this.effectTargetSelections.get(this.effectItemKey(item)));
      return;
    }
    if (action.type === 'unfurl') {
      this.openTableGame(item, action.gameId);
    }
  }

  openTableGame(item, gameId) {
    if (this.isGameOpen(gameId)) {
      this.onPackUpGame?.(gameId);
      this.renderInventory();
      return;
    }

    const friend = this.friendNpcs()[0];
    if (!friend) {
      this.notify('Make a friend first — table games are for friends.');
      return;
    }

    this.closeMenu();
    if (typeof this.onPlayGame === 'function') {
      this.onPlayGame(gameId, friend);
      return;
    }

    // Legacy fallback while the host integration is unavailable.
    if (gameId === 'tic-tac-toe') this.onUnfurlTTT?.(friend);
    else if (gameId === 'checkers') this.onUnfurlCheckers?.(friend);
    else if (gameId === 'chess') this.onUnfurlChess?.(friend);
  }

  toggleEffectItem(item, targetId) {
    const game = this.getGame();
    const player = game?.player;
    if (!player) return;

    const now = (game.time || 0) * 1000;
    const equipped = this.findEquippedOwner(item);
    if (equipped) {
      const result = unequip(equipped.owner, equipped.entry.uid, now);
      if (!result?.ok) {
        this.notify('That item is not ready to take off.');
        return;
      }
      if (equipped.owner !== player) {
        this.moveItemInstance(equipped.owner, player, equipped.entry.uid);
      }
      this.onSave?.();
      this.renderInventory();
      if (this.cardCharacter) this.renderCardEffects(this.cardCharacter);
      const where = equipped.owner === player ? '' : ` from ${equipped.owner.name || 'buddy'}`;
      this.notify(`Took off ${item.name}${where}.`);
      return;
    }

    const targets = this.effectTargets();
    const target = targets.find(candidate => (
      candidate.id === targetId || (candidate.isPlayer && targetId === 'player')
    )) || player;

    const movingToCompanion = target !== player;
    if (movingToCompanion) {
      const moved = this.moveItemInstance(player, target, item);
      if (!moved) {
        this.notify('Could not move that item to your buddy.');
        return;
      }
    }

    const result = equip(target, item, now);
    if (!result?.ok) {
      if (movingToCompanion) this.moveItemInstance(target, player, item.uid || item.id);
      this.notify(result?.reason === 'unknown-item'
        ? 'That item cannot be worn.'
        : 'That item is not ready to wear.');
      return;
    }

    this.onSave?.();
    this.renderInventory();
    if (this.cardCharacter) this.renderCardEffects(this.cardCharacter);
    const suffix = target === player ? '' : ` on ${target.name || 'buddy'}`;
    this.notify(`Wearing ${item.name}${suffix}.`);
  }

  unequipEntry(character, uid) {
    const game = this.getGame();
    const player = game?.player;
    const result = unequip(character, uid, (game?.time || 0) * 1000);
    if (!result?.ok) return;
    if (player && character !== player) {
      this.moveItemInstance(character, player, uid);
    }
    this.onSave?.();
    this.renderInventory();
    if (this.cardCharacter === character) this.renderCardEffects(character);
    this.notify(character === player ? 'Took it off.' : `Took it off ${character.name || 'your buddy'}.`);
  }

  renderInventory() {
    const list = $('inventory-list');
    if (!list) return;
    list.replaceChildren();

    const game = this.getGame();
    const player = game?.player;
    const inventory = [];
    const seen = new Set();
    const owners = [
      player,
      ...(game?.companions || []),
      ...(player?.stabledCompanions || [])
    ].filter(Boolean);
    for (const owner of owners) {
      const equippedUids = new Set((owner.equipped || []).map(entry => entry?.uid).filter(Boolean));
      for (const item of owner.inventory || []) {
        if (owner !== player && item?.uid && !equippedUids.has(item.uid)) continue;
        const key = item?.uid || item?.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        inventory.push(item);
      }
    }
    const coins = game?.player?.coins || 0;

    // Coin banner
    const coinRow = document.createElement('div');
    coinRow.className = 'panel-note';
    coinRow.style.display = 'flex';
    coinRow.style.alignItems = 'center';
    coinRow.style.gap = '6px';
    coinRow.style.margin = '0 0 10px 0';
    coinRow.style.fontWeight = '600';
    coinRow.style.color = 'var(--accent)';
    coinRow.textContent = `Wallet: 🪙 ${coins} Coins`;
    list.append(coinRow);

    this.renderWornStrip(game?.player, list);

    if (!inventory.length) {
      const empty = document.createElement('p');
      empty.className = 'friend-empty';
      empty.textContent = 'Your bag is empty.';
      list.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of inventory) {
      const effect = getEffectForItem(item);
      const equipped = this.findEquippedOwner(item);
      const worn = equipped?.entry || null;
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;

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
      copy.className = 'friend-copy';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const desc = document.createElement('small');
      desc.textContent = effect?.ui?.summary || item.description || '';
      copy.append(name, desc);

      if (effect) {
        const meta = document.createElement('span');
        meta.className = 'item-effect-line';
        const badge = document.createElement('span');
        badge.className = 'ui-badge';
        badge.textContent = effectBadge(effect) || effect.slot;
        const state = document.createElement('span');
        state.className = worn ? 'item-state worn' : 'item-state';
        if (worn) {
          const ownerName = equipped.owner === player ? 'you' : (equipped.owner.name || 'buddy');
          state.textContent = `worn by ${ownerName} · tap to take off`;
        } else {
          state.textContent = `wear · ${effect.slot}`;
        }
        meta.append(badge, state);
        copy.append(meta);

        if (!worn) {
          const targets = this.effectTargets();
          if (targets.length > 1) {
            const chooser = document.createElement('select');
            chooser.className = 'effect-target-select';
            chooser.setAttribute('aria-label', `Apply ${item.name} to`);
            const key = this.effectItemKey(item);
            for (const target of targets) {
              const option = document.createElement('option');
              option.value = target.isPlayer ? 'player' : target.id;
              option.textContent = target.isPlayer ? 'Wear on you' : `Give to ${target.name || 'buddy'}`;
              chooser.append(option);
            }
            chooser.value = this.effectTargetSelections.get(key) || 'player';
            chooser.addEventListener('click', event => event.stopPropagation());
            chooser.addEventListener('change', event => {
              event.stopPropagation();
              this.effectTargetSelections.set(key, chooser.value);
            });
            copy.append(chooser);
          }
        }
      }

      row.append(icon, copy);
      row.addEventListener('click', () => this.activateItem(item));
      fragment.append(row);
    }
    list.append(fragment);
  }

  makeBuddySlot(character) {
    const slot = document.createElement('span');
    slot.className = 'buddy-slot';

    const label = document.createElement('span');
    label.className = 'buddy-slot-label';
    label.textContent = 'buddy slot';

    const buddyEntries = activeEntries(character, (this.getGame()?.time || 0) * 1000).filter(entry => entry.slot === 'buddy');
    slot.append(label);
    if (!buddyEntries.length) {
      const empty = document.createElement('span');
      empty.className = 'item-state';
      empty.textContent = 'empty';
      slot.append(empty);
      return slot;
    }
    for (const entry of buddyEntries) {
      const chip = document.createElement('span');
      chip.className = 'effect-chip';
      chip.textContent = `${entry.effect?.ui?.icon || '✨'} ${chipLabel(entry)}`;
      const badge = document.createElement('span');
      badge.className = 'ui-badge';
      badge.textContent = effectBadge(entry.effect) || entry.slot;
      chip.append(badge);
      slot.append(chip);
    }
    return slot;
  }

  renderCardEffects(character) {
    const card = $('npc-card');
    if (!card || !character) return;

    let host = $('npc-effects');
    if (!host) {
      host = document.createElement('div');
      host.id = 'npc-effects';
      host.className = 'effect-list';
      host.setAttribute('aria-label', 'Active effects');
      const actions = card.querySelector('.npc-card-actions');
      if (actions) card.insertBefore(host, actions);
      else card.append(host);
    }
    host.replaceChildren();

    const entries = activeEntries(character, (this.getGame()?.time || 0) * 1000)
      .filter(entry => entry.phase === 'in');
    if (!entries.length) {
      const note = document.createElement('span');
      note.className = 'item-state';
      note.textContent = 'no effects worn';
      host.append(note);
      return;
    }

    for (const entry of entries) {
      const chip = document.createElement('span');
      chip.className = 'effect-chip';
      const icon = document.createElement('span');
      icon.textContent = entry.effect?.ui?.icon || '✨';
      const label = document.createElement('span');
      label.textContent = chipLabel(entry);
      const badge = document.createElement('span');
      badge.className = 'ui-badge';
      badge.textContent = effectBadge(entry.effect) || entry.slot;
      chip.append(icon, label, badge);
      if (entry.inherited) {
        const inherited = document.createElement('span');
        inherited.className = 'item-state';
        inherited.textContent = 'from owner';
        chip.append(inherited);
      }
      host.append(chip);
    }
  }

  renderCompanion() {
    const list = $('companion-details');
    if (!list) return;
    list.replaceChildren();

    const game = this.getGame();
    const activeCompanions = game?.getCompanionsFor ? game.getCompanionsFor('player') : [];
    const stabledCompanions = Array.isArray(game?.player?.stabledCompanions) ? game.player.stabledCompanions : [];
    const summary = $('companion-summary');

    if (!activeCompanions.length && !stabledCompanions.length) {
      if (summary) summary.textContent = 'No companions currently following you.';
      const empty = document.createElement('p');
      empty.className = 'friend-empty';
      empty.textContent = 'No companion following you right now.';
      list.append(empty);
      return;
    }

    if (summary) {
      summary.textContent = `Active Party: ${activeCompanions.length}/3 companions following you.`;
    }

    const fragment = document.createDocumentFragment();

    // Active companions
    for (const companion of activeCompanions) {
      const info = formatCompanionInfo(companion);
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;

      const image = document.createElement('img');
      bindAnimatedAvatar(image, companion.recipe, 0);
      image.alt = companion.name;

      const copy = document.createElement('div');
      copy.className = 'friend-copy';
      const name = document.createElement('strong');
      name.textContent = `${companion.name} (${info.type})`;
      const sub = document.createElement('small');
      sub.textContent = `${info.class} · Active follower (Click to inspect / bench)`;
      copy.append(name, sub, this.makeBuddySlot(companion));

      row.addEventListener('click', () => {
        if (activeCompanions.length > 1) {
          // Allow toggling between active and stabled, keeping gear and inventory.
          game.companions = game.companions.filter(c => c.id !== companion.id);
          if (!game.player.stabledCompanions) game.player.stabledCompanions = [];
          game.player.stabledCompanions.push({ ...companion, buddyId: 'player' });
          this.renderCompanion();
          this.onSave?.();
        } else {
          this.showCard(companion);
        }
      });

      row.append(image, copy);
      fragment.append(row);
    }

    // Stabled reserve companions
    if (stabledCompanions.length) {
      const header = document.createElement('p');
      header.className = 'panel-note';
      header.style.marginTop = '12px';
      header.textContent = `Collection (${stabledCompanions.length}): Click to make active follower`;
      fragment.append(header);

      for (const stabled of stabledCompanions) {
        const info = formatCompanionInfo(stabled);
        const row = document.createElement('div');
        row.className = 'friend-row';
        row.style.opacity = '0.75';
        row.setAttribute('role', 'listitem');
        row.tabIndex = 0;

        const image = document.createElement('img');
        bindAnimatedAvatar(image, stabled.recipe, 0);
        image.alt = stabled.name;

        const copy = document.createElement('div');
        copy.className = 'friend-copy';
        const name = document.createElement('strong');
        name.textContent = `${stabled.name} (${info.type})`;
        const sub = document.createElement('small');
        sub.textContent = `${info.class} · Resting in collection`;
        copy.append(name, sub, this.makeBuddySlot(stabled));

        row.addEventListener('click', () => {
          if (activeCompanions.length >= 3) {
            // Swap with first active companion, keeping gear and inventory.
            const removed = activeCompanions[0];
            game.companions = game.companions.filter(c => c.id !== removed.id);
            game.player.stabledCompanions.push({ ...removed, buddyId: 'player' });
          }
          // Remove from stabled and activate
          game.player.stabledCompanions = game.player.stabledCompanions.filter(c => c.id !== stabled.id);
          const activated = game.makeCompanion(stabled, game.player);
          if (Array.isArray(stabled.inventory)) activated.inventory = stabled.inventory;
          if (Array.isArray(stabled.equipped)) activated.equipped = stabled.equipped;
          game.companions.push(activated);
          this.renderCompanion();
          this.onSave?.();
        });

        row.append(image, copy);
        fragment.append(row);
      }
    }

    list.append(fragment);
  }

  renderStats() {
    const list = $('stats-list');
    if (!list) return;
    list.replaceChildren();

    const stats = loadStats();
    const summary = $('stats-summary');
    const totalGames = stats.totalWins + stats.totalLosses + stats.totalDraws;
    const winRate = totalGames > 0 ? Math.round((stats.totalWins / totalGames) * 100) : 0;
    if (summary) {
      summary.textContent = `Overall Record: ${stats.totalWins}W - ${stats.totalLosses}L - ${stats.totalDraws}D (${winRate}% win rate across ${totalGames} matches)`;
    }

    const friendEntries = Object.entries(stats.friends || {});
    if (!friendEntries.length) {
      const empty = document.createElement('p');
      empty.className = 'friend-empty';
      empty.textContent = 'No matches played yet. Ask a friend to play Tic-Tac-Toe!';
      list.append(empty);
      return;
    }

    friendEntries.sort((a, b) => (b[1].wins + b[1].losses + b[1].draws) - (a[1].wins + a[1].losses + a[1].draws));

    const game = this.getGame();
    const fragment = document.createDocumentFragment();
    for (const [npcId, record] of friendEntries) {
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.setAttribute('role', 'listitem');

      const npc = game?.getNpc(npcId);
      let avatarEl;
      if (npc?.recipe) {
        avatarEl = document.createElement('img');
        bindAnimatedAvatar(avatarEl, npc.recipe, Math.random() * 5);
        avatarEl.alt = '';
      } else {
        avatarEl = document.createElement('span');
        avatarEl.style.fontSize = '24px';
        avatarEl.style.width = '44px';
        avatarEl.style.height = '44px';
        avatarEl.style.display = 'flex';
        avatarEl.style.alignItems = 'center';
        avatarEl.style.justifyContent = 'center';
        avatarEl.textContent = '🏅';
      }

      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = record.name || npc?.name || 'Neighbour';
      const sub = document.createElement('small');
      sub.textContent = `${record.wins} Wins · ${record.losses} Losses · ${record.draws} Draws`;
      copy.append(name, sub);

      row.append(avatarEl, copy);
      fragment.append(row);
    }
    list.append(fragment);
  }

  renderFriendList() {
    const list = $('friend-list');
    if (!list) return;
    list.replaceChildren();
    const npcs = this.friendNpcs();

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
      row.tabIndex = 0;

      const image = document.createElement('img');
      bindAnimatedAvatar(image, npc.recipe, Math.random() * 5);
      image.alt = '';

      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = npc.name;
      const vibe = document.createElement('small');
      vibe.textContent = npc.vibe || 'Park friend';
      copy.append(name, vibe);

      row.addEventListener('click', () => {
        this.showCard(npc);
      });

      row.append(image, copy);
      fragment.append(row);
    }
    list.append(fragment);
  }

  updateFriendsUI() {
    const game = this.getGame();
    const friends = this.getFriends();
    if (game) {
      for (const id of [...friends]) {
        if (!game.getNpc(id)) friends.delete(id);
      }
    }

    const total = game?.npcs.length || 0;
    const count = friends.size;
    const countEl = $('friends-count');
    if (countEl) countEl.textContent = `${count}/${total}`;
    $('friends-toggle')?.setAttribute('aria-label', `Friend list: ${count} of ${total} neighbours`);
    const summary = $('friends-summary');
    if (summary) {
      summary.textContent = count
        ? `${count} of ${total} neighbour${total === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} your friend.`
        : 'No friends yet. Bump into a neighbour and say yes.';
    }

    if ($('friends-panel') && !$('friends-panel').hidden) this.renderFriendList();
  }

  updateDebugUI() {
    const game = this.getGame();
    const wanderLabel = $('debug-wander-label');
    if (game && wanderLabel) {
      wanderLabel.textContent = game.wander ? 'Neighbours are wandering (press Enter to pause)' : 'Neighbours are staying put (press Enter to resume)';
    }
    this.renderDebugExtras();
  }

  renderDebugExtras() {
    const list = $('debug-actions');
    if (!list) return;
    list.querySelectorAll('[data-debug-dynamic]').forEach(row => row.remove());

    const fragment = document.createDocumentFragment();
    const addRow = ({ id, icon, title, detail, onClick }) => {
      const row = document.createElement('div');
      row.className = 'friend-row debug-row';
      row.dataset.debugDynamic = 'true';
      row.id = id;
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;

      const iconEl = document.createElement('span');
      iconEl.className = 'debug-icon';
      iconEl.textContent = icon;

      const copy = document.createElement('div');
      copy.className = 'friend-copy';
      const strong = document.createElement('strong');
      strong.textContent = title;
      const small = document.createElement('small');
      small.textContent = detail;
      copy.append(strong, small);
      row.append(iconEl, copy);

      if (typeof onClick === 'function') {
        row.addEventListener('click', onClick);
      } else {
        row.removeAttribute('tabindex');
        row.classList.add('debug-readonly');
      }
      fragment.append(row);
      return row;
    };

    addRow({
      id: 'debug-grant-effects',
      icon: '✨',
      title: 'Grant all effect items',
      detail: 'Adds the ten effect items to your bag',
      onClick: () => this.onGrantEffects?.()
    });

    addRow({
      id: 'debug-npc-game',
      icon: '🎲',
      title: 'NPC Tic-Tac-Toe',
      detail: 'Ask two neighbours to start a game',
      onClick: () => this.onTriggerNpcGame?.()
    });

    const hostState = this.getHostState?.() || null;
    const hostDetail = hostState?.active
      ? `${hostState.title || hostState.gameId} · ${hostState.phase || 'open'}${hostState.settled ? ' · settled' : ''}`
      : 'No mini-game open';
    addRow({
      id: 'debug-host-state',
      icon: '🎮',
      title: 'Game session',
      detail: hostDetail
    });

    const behavior = this.getBehaviorSummary?.() || null;
    const behaviorDetail = behavior
      ? `${behavior.actors?.length || 0} active behaviors · ${behavior.activeNpcGames || 0} NPC games · ${behavior.pairRecords || 0} pair records`
      : 'Behavior runtime not ready';
    addRow({
      id: 'debug-behavior-state',
      icon: '🧠',
      title: 'Behavior summary',
      detail: behaviorDetail
    });

    list.append(fragment);
  }

  // --- Character Inspection Card ---

  showCard(character) {
    if (!character) {
      this.closeCard();
      return;
    }
    this.closeAllPanels();
    this.cardCharacter = character;
    const game = this.getGame();
    game?.select(character.isPlayer ? 'player' : character.id);

    const isPlayer = character.isPlayer;
    const isCompanion = character.isCompanion;
    bindAnimatedAvatar($('npc-avatar'), character.recipe, 0);
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
    this.renderCardEffects(character);
    $('npc-card').hidden = false;
  }

  closeCard() {
    this.cardCharacter = null;
    if ($('npc-card')) $('npc-card').hidden = true;
    this.getGame()?.select(null);
  }

  isAnyPanelOpen() {
    return Boolean(
      ($('inventory-panel') && !$('inventory-panel').hidden) ||
      ($('companion-panel') && !$('companion-panel').hidden) ||
      ($('stats-panel') && !$('stats-panel').hidden) ||
      ($('friends-panel') && !$('friends-panel').hidden) ||
      ($('debug-panel') && !$('debug-panel').hidden) ||
      ($('npc-card') && !$('npc-card').hidden)
    );
  }

  closeAllPanels() {
    this.closeCard();
    for (const cfg of Object.values(TAB_CONFIGS)) {
      const panel = $(cfg.panelId);
      if (panel) panel.hidden = true;
    }
  }

  // --- Vertical Navigation ---

  getActiveActionElements() {
    const cfg = TAB_CONFIGS[this.activeTab];
    if (!cfg) return [];
    const container = $(cfg.listId);
    if (!container) return [];
    const rows = Array.from(container.querySelectorAll('.friend-row, .worn-chip'));
    if (rows.length) return rows;
    return Array.from(container.querySelectorAll('button'));
  }

  updateVerticalFocus() {
    const items = this.getActiveActionElements();
    if (!items.length) return;

    if (this.focusedIndex < 0) this.focusedIndex = 0;
    if (this.focusedIndex >= items.length) this.focusedIndex = items.length - 1;

    document.querySelectorAll('.friend-row.nav-focused, .worn-chip.nav-focused, .effect-chip.nav-focused').forEach(r => r.classList.remove('nav-focused'));

    const item = items[this.focusedIndex];
    if (item instanceof HTMLButtonElement) {
      const row = item.closest('.friend-row') || item;
      row.classList.add('nav-focused');
      row.scrollIntoView?.({ block: 'nearest' });
    } else if (item) {
      item.classList.add('nav-focused');
      item.scrollIntoView?.({ block: 'nearest' });
    }
  }

  navigateVertical(direction) {
    const items = this.getActiveActionElements();
    if (!items.length) return;
    if (this.focusedIndex === -1) {
      this.focusedIndex = direction > 0 ? 0 : items.length - 1;
    } else {
      this.focusedIndex = (this.focusedIndex + direction + items.length) % items.length;
    }
    this.updateVerticalFocus();
  }

  triggerFocusedAction() {
    const items = this.getActiveActionElements();
    if (!items.length || this.focusedIndex === -1) return;
    const item = items[this.focusedIndex];
    if (item instanceof HTMLButtonElement) {
      item.click();
    } else if (item) {
      const btn = item.querySelector('button');
      if (btn) btn.click();
      else item.click();
    }
  }

  bindKeyboardNav() {
    window.addEventListener('keydown', event => {
      if (!this.isMenuOpen()) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;

      const key = event.key.toLowerCase();

      if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown' ||
          key === 'a' || key === 'd' || key === 'w' || key === 's') {
        event.preventDefault();
        event.stopPropagation();
      }

      if (key === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeMenu();
        return;
      }

      if (key === 'arrowleft' || key === 'a') {
        this.cycleTab(-1);
        return;
      }

      if (key === 'arrowright' || key === 'd') {
        this.cycleTab(1);
        return;
      }

      if (key === 'arrowup' || key === 'w') {
        this.navigateVertical(-1);
        return;
      }

      if (key === 'arrowdown' || key === 's') {
        this.navigateVertical(1);
        return;
      }

      if (key === 'enter' || key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        this.triggerFocusedAction();
        return;
      }
    });
  }

  bindEvents() {
    $('inventory-toggle')?.addEventListener('click', () => this.toggleInventoryPanel());
    $('inventory-close')?.addEventListener('click', () => this.closeMenu());

    $('companion-toggle')?.addEventListener('click', () => this.toggleCompanionPanel());
    $('companion-close')?.addEventListener('click', () => this.closeMenu());

    $('stats-toggle')?.addEventListener('click', () => this.toggleStatsPanel());
    $('stats-close')?.addEventListener('click', () => this.closeMenu());

    $('friends-toggle')?.addEventListener('click', () => this.toggleFriendsPanel());
    $('friends-close')?.addEventListener('click', () => this.closeMenu());

    $('debug-toggle')?.addEventListener('click', () => this.toggleDebugPanel());
    $('debug-close')?.addEventListener('click', () => this.closeMenu());

    $('debug-wander-row')?.addEventListener('click', () => {
      this.onToggleWander?.();
      this.updateDebugUI();
    });

    $('debug-add-row')?.addEventListener('click', () => {
      this.onAddNeighbour?.();
    });

    $('debug-new-row')?.addEventListener('click', () => {
      this.onNewPark?.();
    });

    $('npc-close')?.addEventListener('click', () => this.closeCard());
  }
}
