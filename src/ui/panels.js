import { avatarDataUrl, bindAnimatedAvatar } from '../avatar.js';
import { loadStats } from '../storage.js';
import { formatCompanionInfo } from '../characters.js';

const $ = id => document.getElementById(id);

export const TABS = ['backpack', 'companions', 'friends', 'stats', 'debug'];

export class PanelsUI {
  constructor({
    getGame,
    getFriends,
    onThrowBall,
    onUnfurlTTT,
    onPackUpTTT,
    isTTTOpen,
    onSave,
    onSelect,
    onAddNeighbour,
    onNewPark,
    onToggleWander
  }) {
    this.getGame = getGame;
    this.getFriends = getFriends;
    this.onThrowBall = onThrowBall;
    this.onUnfurlTTT = onUnfurlTTT;
    this.onPackUpTTT = onPackUpTTT;
    this.isTTTOpen = isTTTOpen;
    this.onSave = onSave;
    this.onSelect = onSelect;
    this.onAddNeighbour = onAddNeighbour;
    this.onNewPark = onNewPark;
    this.onToggleWander = onToggleWander;
    this.cardCharacter = null;
    this.activeTab = null;
    this.lastActiveTab = 'backpack';
    this.focusedIndex = 0;
    this.bindEvents();
    this.bindKeyboardNav();
  }

  friendNpcs() {
    const game = this.getGame();
    if (!game) return [];
    const friends = this.getFriends();
    return game.npcs.filter(npc => friends.has(npc.id));
  }

  isMenuOpen() {
    return this.activeTab !== null;
  }

  // --- Active Tab Switching & Highlighting ---

  setActiveTab(tabName) {
    if (!TABS.includes(tabName)) return;
    this.activeTab = tabName;
    this.lastActiveTab = tabName;
    this.focusedIndex = 0;

    // Update active-tab styling on HUD buttons
    $('inventory-toggle')?.classList.toggle('active-tab', tabName === 'backpack');
    $('companion-toggle')?.classList.toggle('active-tab', tabName === 'companions');
    $('friends-toggle')?.classList.toggle('active-tab', tabName === 'friends');
    $('stats-toggle')?.classList.toggle('active-tab', tabName === 'stats');
    $('debug-toggle')?.classList.toggle('active-tab', tabName === 'debug');

    // Close other panels and open target
    this.closeCard();
    if (tabName !== 'backpack') this.closeInventoryPanel();
    if (tabName !== 'companions') this.closeCompanionPanel();
    if (tabName !== 'friends') this.closeFriendsPanel();
    if (tabName !== 'stats') this.closeStatsPanel();
    if (tabName !== 'debug') this.closeDebugPanel();

    if (tabName === 'backpack') this.openInventoryPanel();
    else if (tabName === 'companions') this.openCompanionPanel();
    else if (tabName === 'friends') this.openFriendsPanel();
    else if (tabName === 'stats') this.openStatsPanel();
    else if (tabName === 'debug') this.openDebugPanel();

    this.updateVerticalFocus();
  }

  closeMenu() {
    this.activeTab = null;
    $('inventory-toggle')?.classList.remove('active-tab');
    $('companion-toggle')?.classList.remove('active-tab');
    $('friends-toggle')?.classList.remove('active-tab');
    $('stats-toggle')?.classList.remove('active-tab');
    $('debug-toggle')?.classList.remove('active-tab');
    this.closeAllPanels();
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

  // --- Inventory Panel ---

  closeInventoryPanel() {
    const panel = $('inventory-panel');
    if (panel) {
      panel.hidden = true;
      $('inventory-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  openInventoryPanel() {
    const panel = $('inventory-panel');
    if (!panel) return;
    panel.hidden = false;
    $('inventory-toggle')?.setAttribute('aria-expanded', 'true');
    this.renderInventory();
  }

  toggleInventoryPanel() {
    if (this.activeTab === 'backpack') {
      this.closeMenu();
    } else {
      this.setActiveTab('backpack');
    }
  }

  renderInventory() {
    const list = $('inventory-list');
    if (!list) return;
    list.replaceChildren();

    const game = this.getGame();
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
          this.closeMenu();
          this.onThrowBall?.({ color: item.color });
        });
      } else if (item.id === 'tic-tac-toe') {
        action.textContent = this.isTTTOpen?.() ? 'Pack up' : 'Unfurl';
        action.addEventListener('click', () => {
          this.closeMenu();
          if (this.isTTTOpen?.()) {
            this.onPackUpTTT?.();
          } else {
            const friend = this.friendNpcs()[0] || game.npcs[0];
            this.onUnfurlTTT?.(friend);
          }
        });
      }

      row.append(icon, copy, action);
      fragment.append(row);
    }
    list.append(fragment);
  }

  // --- Companion Panel ---

  closeCompanionPanel() {
    const panel = $('companion-panel');
    if (panel) {
      panel.hidden = true;
      $('companion-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  openCompanionPanel() {
    const panel = $('companion-panel');
    if (!panel) return;
    panel.hidden = false;
    $('companion-toggle')?.setAttribute('aria-expanded', 'true');
    this.renderCompanion();
  }

  toggleCompanionPanel() {
    if (this.activeTab === 'companions') {
      this.closeMenu();
    } else {
      this.setActiveTab('companions');
    }
  }

  renderCompanion() {
    const list = $('companion-details');
    if (!list) return;
    list.replaceChildren();

    const game = this.getGame();
    const companion = game?.companions?.find(c => c.buddyId === 'player');
    const summary = $('companion-summary');

    if (!companion) {
      if (summary) summary.textContent = 'No companions currently following you.';
      const empty = document.createElement('p');
      empty.className = 'friend-empty';
      empty.textContent = 'No companion following you right now.';
      list.append(empty);
      return;
    }

    const info = formatCompanionInfo(companion);
    if (summary) {
      summary.textContent = `${companion.name} the ${info.type} · ${info.class}`;
    }

    const row = document.createElement('div');
    row.className = 'friend-row';
    row.setAttribute('role', 'listitem');

    const image = document.createElement('img');
    bindAnimatedAvatar(image, companion.recipe, 0);
    image.alt = companion.name;

    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `${companion.name} (${info.type})`;
    const sub = document.createElement('small');
    sub.textContent = `${info.class} · Following you`;
    copy.append(name, sub);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'pill';
    action.textContent = 'Inspect';
    action.addEventListener('click', () => {
      this.showCard(companion);
    });

    row.append(image, copy, action);
    list.append(row);
  }

  // --- Stats Panel ---

  closeStatsPanel() {
    const panel = $('stats-panel');
    if (panel) {
      panel.hidden = true;
      $('stats-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  openStatsPanel() {
    const panel = $('stats-panel');
    if (!panel) return;
    panel.hidden = false;
    $('stats-toggle')?.setAttribute('aria-expanded', 'true');
    this.renderStats();
  }

  toggleStatsPanel() {
    if (this.activeTab === 'stats') {
      this.closeMenu();
    } else {
      this.setActiveTab('stats');
    }
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

  // --- Friends Panel ---

  closeFriendsPanel() {
    const panel = $('friends-panel');
    if (panel) {
      panel.hidden = true;
      $('friends-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  openFriendsPanel() {
    const panel = $('friends-panel');
    if (!panel) return;
    panel.hidden = false;
    $('friends-toggle')?.setAttribute('aria-expanded', 'true');
    this.updateFriendsUI();
    this.renderFriendList();
  }

  toggleFriendsPanel() {
    if (this.activeTab === 'friends') {
      this.closeMenu();
    } else {
      this.setActiveTab('friends');
    }
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

      const image = document.createElement('img');
      bindAnimatedAvatar(image, npc.recipe, Math.random() * 5);
      image.alt = '';

      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = npc.name;
      const vibe = document.createElement('small');
      vibe.textContent = npc.vibe || 'Park friend';
      copy.append(name, vibe);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'pill';
      action.textContent = 'Card';
      action.addEventListener('click', () => {
        this.showCard(npc);
      });

      row.append(image, copy, action);
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

  // --- Debug Panel ---

  closeDebugPanel() {
    const panel = $('debug-panel');
    if (panel) {
      panel.hidden = true;
      $('debug-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  openDebugPanel() {
    const panel = $('debug-panel');
    if (!panel) return;
    panel.hidden = false;
    $('debug-toggle')?.setAttribute('aria-expanded', 'true');
    this.updateDebugUI();
  }

  toggleDebugPanel() {
    if (this.activeTab === 'debug') {
      this.closeMenu();
    } else {
      this.setActiveTab('debug');
    }
  }

  updateDebugUI() {
    const game = this.getGame();
    const wanderBtn = $('debug-wander-btn');
    const wanderLabel = $('debug-wander-label');
    if (wanderBtn && game) {
      wanderBtn.textContent = game.wander ? 'Pause' : 'Resume';
      if (wanderLabel) {
        wanderLabel.textContent = game.wander ? 'Neighbours are currently wandering' : 'Neighbours are staying put';
      }
    }
  }

  // --- Character Inspection Card ---

  showCard(character) {
    if (!character) {
      this.closeCard();
      return;
    }
    this.closeFriendsPanel();
    this.closeInventoryPanel();
    this.closeStatsPanel();
    this.closeCompanionPanel();
    this.closeDebugPanel();
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
    this.closeFriendsPanel();
    this.closeInventoryPanel();
    this.closeStatsPanel();
    this.closeCompanionPanel();
    this.closeDebugPanel();
  }

  // --- Vertical Keyboard Navigation Inside Panels ---

  getActiveActionElements() {
    let container = null;
    if (this.activeTab === 'backpack') container = $('inventory-list');
    else if (this.activeTab === 'companions') container = $('companion-details');
    else if (this.activeTab === 'friends') container = $('friend-list');
    else if (this.activeTab === 'stats') container = $('stats-list');
    else if (this.activeTab === 'debug') container = $('debug-actions');

    if (!container) return [];
    const buttons = Array.from(container.querySelectorAll('button'));
    if (buttons.length) return buttons;
    const rows = Array.from(container.querySelectorAll('.friend-row'));
    return rows;
  }

  removeVerticalFocus() {
    this.focusedIndex = -1;
    document.querySelectorAll('.friend-row.nav-focused').forEach(r => r.classList.remove('nav-focused'));
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  updateVerticalFocus() {
    const items = this.getActiveActionElements();
    if (!items.length) return;

    if (this.focusedIndex < 0) this.focusedIndex = 0;
    if (this.focusedIndex >= items.length) this.focusedIndex = items.length - 1;

    // Remove nav-focused styling from previous rows
    document.querySelectorAll('.friend-row.nav-focused').forEach(r => r.classList.remove('nav-focused'));

    const item = items[this.focusedIndex];
    if (item instanceof HTMLButtonElement) {
      item.closest('.friend-row')?.classList.add('nav-focused');
      item.closest('.friend-row')?.scrollIntoView?.({ block: 'nearest' });
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
    }
  }

  bindKeyboardNav() {
    window.addEventListener('keydown', event => {
      if (!this.isMenuOpen()) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;

      const key = event.key.toLowerCase();

      if (key === 'escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeMenu();
        return;
      }

      if (key === 'arrowleft' || key === 'a') {
        event.preventDefault();
        event.stopPropagation();
        this.cycleTab(-1);
        return;
      }

      if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        event.stopPropagation();
        this.cycleTab(1);
        return;
      }

      if (key === 'arrowup' || key === 'w') {
        event.preventDefault();
        event.stopPropagation();
        this.navigateVertical(-1);
        return;
      }

      if (key === 'arrowdown' || key === 's') {
        event.preventDefault();
        event.stopPropagation();
        this.navigateVertical(1);
        return;
      }

      if (key === 'enter' || key === ' ') {
        // If an item in panel is focused, click it
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

    $('debug-wander-btn')?.addEventListener('click', () => {
      this.onToggleWander?.();
      this.updateDebugUI();
    });

    $('debug-add-npc')?.addEventListener('click', () => {
      this.onAddNeighbour?.();
    });

    $('debug-new-park')?.addEventListener('click', () => {
      this.onNewPark?.();
    });

    $('npc-close')?.addEventListener('click', () => this.closeCard());
  }
}
