import { avatarDataUrl, bindAnimatedAvatar } from '../avatar.js';
import { loadStats } from '../storage.js';
import { formatCompanionInfo } from '../characters.js';

const $ = id => document.getElementById(id);

export const TABS = ['backpack', 'companions', 'friends', 'stats', 'debug'];

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
    this.onUnfurlCheckers = onUnfurlCheckers;
    this.onPackUpCheckers = onPackUpCheckers;
    this.isCheckersOpen = isCheckersOpen;
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

  renderInventory() {
    const list = $('inventory-list');
    if (!list) return;
    list.replaceChildren();

    const game = this.getGame();
    const inventory = game?.player?.inventory || [];
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
      const name = document.createElement('strong');
      name.textContent = item.name;
      const desc = document.createElement('small');
      desc.textContent = item.description;
      copy.append(name, desc);

      row.addEventListener('click', () => {
        if (item.id === 'ball') {
          this.closeMenu();
          this.onThrowBall?.({ color: item.color });
        } else if (item.id === 'tic-tac-toe') {
          this.closeMenu();
          if (this.isTTTOpen?.()) {
            this.onPackUpTTT?.();
          } else {
            const friend = this.friendNpcs()[0] || game.npcs[0];
            this.onUnfurlTTT?.(friend);
          }
        } else if (item.id === 'checkers') {
          this.closeMenu();
          if (this.isCheckersOpen?.()) {
            this.onPackUpCheckers?.();
          } else {
            const friend = this.friendNpcs()[0] || game.npcs[0];
            this.onUnfurlCheckers?.(friend);
          }
        }
      });

      row.append(icon, copy);
      fragment.append(row);
    }
    list.append(fragment);
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
      const name = document.createElement('strong');
      name.textContent = `${companion.name} (${info.type})`;
      const sub = document.createElement('small');
      sub.textContent = `${info.class} · Active follower (Click to inspect / bench)`;
      copy.append(name, sub);

      row.addEventListener('click', () => {
        if (activeCompanions.length > 1) {
          // Allow toggling between active and stabled
          game.companions = game.companions.filter(c => c.id !== companion.id);
          if (!game.player.stabledCompanions) game.player.stabledCompanions = [];
          game.player.stabledCompanions.push({
            id: companion.id,
            name: companion.name,
            recipe: companion.recipe,
            buddyId: 'player'
          });
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
        const name = document.createElement('strong');
        name.textContent = `${stabled.name} (${info.type})`;
        const sub = document.createElement('small');
        sub.textContent = `${info.class} · Resting in collection`;
        copy.append(name, sub);

        row.addEventListener('click', () => {
          if (activeCompanions.length >= 3) {
            // Swap with first active companion
            const removed = activeCompanions[0];
            game.companions = game.companions.filter(c => c.id !== removed.id);
            game.player.stabledCompanions.push({
              id: removed.id,
              name: removed.name,
              recipe: removed.recipe,
              buddyId: 'player'
            });
          }
          // Remove from stabled and activate
          game.player.stabledCompanions = game.player.stabledCompanions.filter(c => c.id !== stabled.id);
          const activated = game.makeCompanion(stabled, game.player);
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
    const rows = Array.from(container.querySelectorAll('.friend-row'));
    if (rows.length) return rows;
    return Array.from(container.querySelectorAll('button'));
  }

  updateVerticalFocus() {
    const items = this.getActiveActionElements();
    if (!items.length) return;

    if (this.focusedIndex < 0) this.focusedIndex = 0;
    if (this.focusedIndex >= items.length) this.focusedIndex = items.length - 1;

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
