import { avatarDataUrl } from './avatar.js';

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

    window.requestAnimationFrame(() => this.choices.querySelector('button')?.focus({ preventScroll: true }));
  }

  open(npc, isFriend, { canPlayTicTacToe = false } = {}) {
    if (!npc || !this.container) return;
    this.dialogueNpc = npc;
    document.body.classList.add('dialogue-open');
    this.container.hidden = false;
    this.avatar.src = avatarDataUrl(npc.recipe);
    this.avatar.alt = `${npc.name}'s character`;
    this.name.textContent = npc.name;

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
    this.avatar.src = avatarDataUrl(npc.recipe);
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
