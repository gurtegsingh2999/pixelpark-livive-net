import { avatarDataUrl, bindAnimatedAvatar } from '../avatar.js';
import { loadStats } from '../storage.js';

const $ = id => document.getElementById(id);

export class PanelsUI {
  constructor({
    getGame,
    getFriends,
    onThrowBall,
    onUnfurlTTT,
    onPackUpTTT,
    isTTTOpen,
    onSave,
    onSelect
  }) {
    this.getGame = getGame;
    this.getFriends = getFriends;
    this.onThrowBall = onThrowBall;
    this.onUnfurlTTT = onUnfurlTTT;
    this.onPackUpTTT = onPackUpTTT;
    this.isTTTOpen = isTTTOpen;
    this.onSave = onSave;
    this.onSelect = onSelect;
    this.cardCharacter = null;
    this.bindEvents();
  }

  friendNpcs() {
    const game = this.getGame();
    if (!game) return [];
    const friends = this.getFriends();
    return game.npcs.filter(npc => friends.has(npc.id));
  }

  // --- Inventory Panel ---

  closeInventoryPanel() {
    const panel = $('inventory-panel');
    if (panel) {
      panel.hidden = true;
      $('inventory-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  toggleInventoryPanel() {
    const panel = $('inventory-panel');
    if (!panel) return;
    const opening = panel.hidden;
    if (!opening) {
      this.closeInventoryPanel();
      return;
    }
    this.closeCard();
    this.closeFriendsPanel();
    this.closeStatsPanel();
    panel.hidden = false;
    $('inventory-toggle')?.setAttribute('aria-expanded', 'true');
    this.renderInventory();
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
          this.closeInventoryPanel();
          this.onThrowBall?.({ color: item.color });
        });
      } else if (item.id === 'tic-tac-toe') {
        action.textContent = this.isTTTOpen?.() ? 'Pack up' : 'Unfurl';
        action.addEventListener('click', () => {
          this.closeInventoryPanel();
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

  // --- Stats Panel ---

  closeStatsPanel() {
    const panel = $('stats-panel');
    if (panel) {
      panel.hidden = true;
      $('stats-toggle')?.setAttribute('aria-expanded', 'false');
    }
  }

  toggleStatsPanel() {
    const panel = $('stats-panel');
    if (!panel) return;
    const opening = panel.hidden;
    if (!opening) {
      this.closeStatsPanel();
      return;
    }
    this.closeCard();
    this.closeFriendsPanel();
    this.closeInventoryPanel();
    panel.hidden = false;
    $('stats-toggle')?.setAttribute('aria-expanded', 'true');
    this.renderStats();
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
    $('friends-panel').hidden = true;
    $('friends-toggle').setAttribute('aria-expanded', 'false');
  }

  toggleFriendsPanel() {
    const panel = $('friends-panel');
    const opening = panel.hidden;
    if (!opening) {
      this.closeFriendsPanel();
      return;
    }
    this.closeCard();
    this.closeInventoryPanel();
    this.closeStatsPanel();
    panel.hidden = false;
    $('friends-toggle').setAttribute('aria-expanded', 'true');
    this.updateFriendsUI();
    this.renderFriendList();
  }

  renderFriendList() {
    const list = $('friend-list');
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
    $('friends-count').textContent = `${count}/${total}`;
    $('friends-toggle').setAttribute('aria-label', `Friend list: ${count} of ${total} neighbours`);
    $('friends-summary').textContent = count
      ? `${count} of ${total} neighbour${total === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} your friend.`
      : 'No friends yet. Bump into a neighbour and say yes.';

    if (!$('friends-panel').hidden) this.renderFriendList();
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
    $('npc-card').hidden = true;
    this.getGame()?.select(null);
  }

  isAnyPanelOpen() {
    return Boolean(
      ($('inventory-panel') && !$('inventory-panel').hidden) ||
      ($('stats-panel') && !$('stats-panel').hidden) ||
      ($('friends-panel') && !$('friends-panel').hidden) ||
      ($('npc-card') && !$('npc-card').hidden)
    );
  }

  closeAllPanels() {
    this.closeCard();
    this.closeFriendsPanel();
    this.closeInventoryPanel();
    this.closeStatsPanel();
  }

  bindEvents() {
    $('inventory-toggle')?.addEventListener('click', () => this.toggleInventoryPanel());
    $('inventory-close')?.addEventListener('click', () => this.closeInventoryPanel());
    $('stats-toggle')?.addEventListener('click', () => this.toggleStatsPanel());
    $('stats-close')?.addEventListener('click', () => this.closeStatsPanel());

    $('friends-toggle')?.addEventListener('click', () => this.toggleFriendsPanel());
    $('friends-close')?.addEventListener('click', () => this.closeFriendsPanel());
    $('npc-close')?.addEventListener('click', () => this.closeCard());
  }
}
