import { avatarDataUrl, bindAnimatedAvatar } from './avatar.js';
import { formatCompanionInfo } from './characters.js';

export class DialogueManager {
  constructor({ containerId = 'dialogue', onDialogueEnd, onFriendshipChange, onPlayGame } = {}) {
    this.dialogueNpc = null;
    this.onDialogueEnd = onDialogueEnd;
    this.onFriendshipChange = onFriendshipChange;
    this.onPlayGame = onPlayGame;
    this.container = document.getElementById(containerId);
    this.avatar = document.getElementById('dialogue-avatar');
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
    bindAnimatedAvatar(this.avatar, character.recipe, 0);
    this.avatar.alt = `${character.name}'s character`;
    this.name.textContent = character.name;

    // Handle companion dialogue (shows name, class, and type)
    if (character.isCompanion) {
      const info = formatCompanionInfo(character);
      this.setBeat(info.text, [
        { label: 'Nice buddy!', className: 'primary', onClick: () => this.close() }
      ]);
      return;
    }

    const npc = character;
    if (isFriend) {
      const choices = [];
      if (canPlayTicTacToe) {
        choices.push({
          label: 'Play Tic-Tac-Toe',
          className: 'primary',
          onClick: () => {
            const opponent = this.dialogueNpc;
            this.close();
            this.onPlayGame?.('tic-tac-toe', opponent);
          }
        });
      }
      choices.push({ label: 'See you', className: choices.length ? 'pill quiet' : 'primary', onClick: () => this.close() });

      this.setBeat(`Hi, I'm ${npc.name}. Good to see you again!`, choices);
      return;
    }

    this.setBeat(`Hi, I'm ${npc.name}. Do you want to be friends?`, [
      { label: 'Yes', className: 'primary', onClick: () => this.acceptFriendship() },
      { label: 'No', className: 'pill quiet', onClick: () => this.declineFriendship() }
    ]);
  }

  openCustomBeat(npc, text, choices) {
    if (!npc || !this.container) return;
    this.dialogueNpc = npc;
    document.body.classList.add('dialogue-open');
    this.container.hidden = false;
    bindAnimatedAvatar(this.avatar, npc.recipe, 0);
    this.avatar.alt = `${npc.name}'s character`;
    this.name.textContent = npc.name;
    this.setBeat(text, choices);
  }

  acceptFriendship() {
    if (!this.dialogueNpc) return;
    const npc = this.dialogueNpc;
    this.onFriendshipChange?.(npc.id, true);
    this.setBeat(`Yay! ${npc.name} is your friend now.`, [
      { label: 'Nice', className: 'primary', onClick: () => this.close() }
    ]);
  }

  declineFriendship() {
    if (!this.dialogueNpc) return;
    this.setBeat('No worries. Maybe next time.', [
      { label: 'Bye', className: 'pill', onClick: () => this.close() }
    ]);
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
