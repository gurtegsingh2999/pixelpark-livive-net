import { avatarDataUrl, bindAnimatedAvatar } from './avatar.js';
import { formatCompanionInfo } from './characters.js';
import dialogueData from '../data/dialogues.json' with { type: 'json' };

function interpolate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

export class DialogueManager {
  constructor({ containerId = 'dialogue', onDialogueEnd, onFriendshipChange, onPlayGame, getGame } = {}) {
    this.dialogueNpc = null;
    this.onDialogueEnd = onDialogueEnd;
    this.onFriendshipChange = onFriendshipChange;
    this.onPlayGame = onPlayGame;
    this.getGame = getGame;
    this.container = document.getElementById(containerId);
    this.name = document.getElementById('dialogue-name');
    this.text = document.getElementById('dialogue-text');
    this.choices = document.getElementById('dialogue-choices');
  }

  isOpen() {
    return this.container && !this.container.hidden;
  }

  setBeat(text, choices) {
    if (!this.text || !this.choices) return;
    this.text.textContent = text;
    this.choices.replaceChildren();

    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = choice.className || 'pill';
      button.textContent = choice.label;
      button.addEventListener('click', choice.onClick);
      this.choices.append(button);
    }

    this.bindArrowNavigation();
    window.requestAnimationFrame(() => this.choices.querySelector('button')?.focus({ preventScroll: true }));
  }

  bindArrowNavigation() {
    if (this._hasKeyNav) return;
    this._hasKeyNav = true;

    window.addEventListener('keydown', event => {
      if (!this.isOpen()) return;
      const key = event.key.toLowerCase();
      const isNext = key === 'arrowright' || key === 'arrowdown' || key === 's' || key === 'd';
      const isPrev = key === 'arrowleft' || key === 'arrowup' || key === 'w' || key === 'a';

      if (!isNext && !isPrev) return;

      const buttons = Array.from(this.choices.querySelectorAll('button'));
      if (!buttons.length) return;

      event.preventDefault();
      event.stopPropagation();

      const currentIndex = buttons.indexOf(document.activeElement);
      let nextIndex = 0;
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (isNext) {
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (isPrev) {
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      }
      buttons[nextIndex]?.focus({ preventScroll: true });
    }, { capture: true });
  }

  open(character, isFriend, { canPlayTicTacToe = false } = {}) {
    if (!character || !this.container) return;
    this.dialogueNpc = character;
    document.body.classList.add('dialogue-open');
    this.container.hidden = false;
    this.name.textContent = character.name;
    this.updatePosition();

    // Handle companion dialogue (shows name, class, and type)
    if (character.isCompanion) {
      const info = formatCompanionInfo(character);
      const choices = dialogueData.dialogues.companion.choices.map(c => ({
        ...c,
        onClick: () => this.close()
      }));
      this.setBeat(info.text, choices);
      return;
    }

    const npc = character;
    if (isFriend) {
      const choices = [];
      if (canPlayTicTacToe) {
        choices.push({
          label: dialogueData.dialogues.friend.playTttLabel,
          className: 'primary',
          onClick: () => {
            const opponent = this.dialogueNpc;
            this.close();
            this.onPlayGame?.('tic-tac-toe', opponent);
          }
        });
      }
      choices.push({
        label: dialogueData.dialogues.friend.closeLabel,
        className: choices.length ? 'pill quiet' : 'primary',
        onClick: () => this.close()
      });

      this.setBeat(interpolate(dialogueData.dialogues.friend.text, { name: npc.name }), choices);
      return;
    }

    const strangerSpec = dialogueData.dialogues.stranger;
    const choices = strangerSpec.choices.map(c => ({
      label: c.label,
      className: c.className,
      onClick: c.action === 'accept' ? () => this.acceptFriendship() : () => this.declineFriendship()
    }));
    this.setBeat(interpolate(strangerSpec.text, { name: npc.name }), choices);
  }

  openCustomBeat(npc, text, choices) {
    if (!npc || !this.container) return;
    this.dialogueNpc = npc;
    document.body.classList.add('dialogue-open');
    this.container.hidden = false;
    this.name.textContent = npc.name;
    this.setBeat(text, choices);
    this.updatePosition();
  }

  triggerFocusedChoice() {
    const active = document.activeElement;
    if (active && active.parentElement === this.choices) {
      active.click();
      return true;
    }
    const first = this.choices?.querySelector('button');
    if (first) {
      first.click();
      return true;
    }
    return false;
  }

  updatePosition() {
    if (!this.isOpen() || !this.dialogueNpc || !this.container) return;
    const game = this.getGame?.();
    if (!game) return;

    const npc = this.dialogueNpc;
    const pos = game.interpolated ? game.interpolated(npc) : { x: npc.x, y: npc.y };
    const screenX = (pos.x + 0.5) * 48 - game.camera.x;
    const screenY = pos.y * 48 - game.camera.y;

    // Anchor bubble near the speaking NPC (slightly above / next to them)
    const bubbleW = this.container.offsetWidth || 280;
    const bubbleH = this.container.offsetHeight || 120;
    const pad = 12;

    let left = screenX + 24; // to the right of NPC
    // If overflowing right viewport edge, flip to left of NPC
    if (left + bubbleW > window.innerWidth - pad) {
      left = screenX - bubbleW - 24;
    }
    // Clamp to viewport
    left = Math.max(pad, Math.min(window.innerWidth - bubbleW - pad, left));

    let top = screenY - bubbleH / 2;
    // Keep away from top bar and bottom touch controls
    top = Math.max(70, Math.min(window.innerHeight - bubbleH - 140, top));

    this.container.style.left = `${Math.round(left)}px`;
    this.container.style.top = `${Math.round(top)}px`;
  }

  acceptFriendship() {
    if (!this.dialogueNpc) return;
    const npc = this.dialogueNpc;
    this.onFriendshipChange?.(npc.id, true);
    const spec = dialogueData.dialogues.accepted;
    const choices = spec.choices.map(c => ({
      ...c,
      onClick: () => this.close()
    }));
    this.setBeat(interpolate(spec.text, { name: npc.name }), choices);
  }

  declineFriendship() {
    if (!this.dialogueNpc) return;
    const spec = dialogueData.dialogues.declined;
    const choices = spec.choices.map(c => ({
      ...c,
      onClick: () => this.close()
    }));
    this.setBeat(spec.text, choices);
  }

  close() {
    if (!this.isOpen()) return;
    this.container.hidden = true;
    document.body.classList.remove('dialogue-open');
    const npc = this.dialogueNpc;
    this.dialogueNpc = null;
    this.onDialogueEnd?.(npc);
  }
}
