/**
 * Lock arbiter for behaviors, dialogue, pairs, and NPC mini-games.
 *
 * The runtime chooses the highest-priority eligible behavior first, then calls `commit`.
 * The arbiter itself does not preempt: a conflict simply denies the request, which keeps
 * integration deterministic and avoids lock churn. Priority ordering is exposed through
 * `comparePriority` for schedulers and debug tools.
 */

import { pairKey } from './blackboard.js';

export const LOCK_KINDS = Object.freeze(['behavior', 'dialogue', 'game', 'social']);

export function comparePriority(a, b) {
  const priorityDelta = (b?.priority ?? 0) - (a?.priority ?? 0);
  if (priorityDelta) return priorityDelta;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

export class Arbiter {
  constructor({ maxNpcGames = 1, now = 0 } = {}) {
    this.maxNpcGames = maxNpcGames;
    this.now = now;
    this.dialogueOpen = false;
    this.dialogueOwner = null;
    this.tokens = new Map();
    this.actorLocks = new Map();
    this.pairLocks = new Map();
    this.gameLocks = new Set();
  }

  setDialogue(open, owner = 'player') {
    this.dialogueOpen = Boolean(open);
    this.dialogueOwner = open ? owner : null;
    return this.dialogueOpen;
  }

  isDialogueOpen() {
    return this.dialogueOpen;
  }

  isActorLocked(actorId) {
    return this.actorLocks.has(actorId);
  }

  isPairLocked(pair) {
    const key = typeof pair === 'string' ? pair : pairKey(pair?.a ?? pair?.[0], pair?.b ?? pair?.[1]);
    return key ? this.pairLocks.has(key) : false;
  }

  isGameLocked() {
    return this.gameLocks.size > 0;
  }

  gameCount() {
    return this.gameLocks.size;
  }

  canStart(request = {}) {
    return this.explain(request).ok;
  }

  explain(request = {}) {
    const conflicts = this.#conflicts(request);
    return { ok: conflicts.length === 0, conflicts, reasons: conflicts.map(item => item.reason) };
  }

  commit(request = {}) {
    const id = String(request.id || 'anonymous');
    if (this.tokens.has(id)) return this.tokens.get(id);
    const conflicts = this.#conflicts({ ...request, id });
    if (conflicts.length) return null;

    const pair = normalisePair(request.pair);
    const actors = [...new Set((request.actors || []).filter(value => value != null).map(String))];
    const token = deepFreezeToken({
      id,
      kind: LOCK_KINDS.includes(request.kind) ? request.kind : 'behavior',
      priority: Number(request.priority) || 0,
      actors,
      pair,
      game: Boolean(request.game),
      now: request.now ?? this.now
    });

    this.tokens.set(id, token);
    for (const actorId of actors) this.actorLocks.set(actorId, id);
    if (pair) this.pairLocks.set(pair, id);
    if (token.game) this.gameLocks.add(id);
    return token;
  }

  release(tokenOrId) {
    const id = typeof tokenOrId === 'string' ? tokenOrId : tokenOrId?.id;
    if (id == null) return false;
    const token = this.tokens.get(id);
    if (!token) return false;

    this.tokens.delete(id);
    for (const actorId of token.actors) {
      if (this.actorLocks.get(actorId) === id) this.actorLocks.delete(actorId);
    }
    if (token.pair && this.pairLocks.get(token.pair) === id) this.pairLocks.delete(token.pair);
    this.gameLocks.delete(id);
    return true;
  }

  releaseActor(actorId) {
    const id = this.actorLocks.get(actorId);
    return id ? this.release(id) : false;
  }

  releaseAll() {
    this.tokens.clear();
    this.actorLocks.clear();
    this.pairLocks.clear();
    this.gameLocks.clear();
    return this;
  }

  snapshot() {
    return {
      dialogue: { open: this.dialogueOpen, owner: this.dialogueOwner },
      maxNpcGames: this.maxNpcGames,
      games: [...this.gameLocks],
      actors: [...this.actorLocks.entries()].map(([actorId, id]) => ({ actorId, id })),
      pairs: [...this.pairLocks.entries()].map(([pair, id]) => ({ pair, id })),
      tokens: [...this.tokens.values()].map(token => ({ ...token }))
    };
  }

  #conflicts(request = {}) {
    const id = String(request.id || 'anonymous');
    if (this.tokens.has(id)) return [];
    const conflicts = [];

    if (this.dialogueOpen && request.kind !== 'dialogue') {
      conflicts.push({ reason: 'dialogue', holder: this.dialogueOwner });
    }

    for (const actor of request.actors || []) {
      const holder = this.actorLocks.get(String(actor));
      if (holder && holder !== id) conflicts.push({ reason: 'actor', actor: String(actor), holder });
    }

    const pair = normalisePair(request.pair);
    if (pair) {
      const holder = this.pairLocks.get(pair);
      if (holder && holder !== id) conflicts.push({ reason: 'pair', pair, holder });
    }

    if (request.game && this.gameLocks.size >= this.maxNpcGames) {
      conflicts.push({ reason: 'game', holder: [...this.gameLocks] });
    }

    return conflicts;
  }
}

export function createArbiter(options) {
  return new Arbiter(options);
}

function normalisePair(pair) {
  if (!pair) return null;
  if (typeof pair === 'string') return pair;
  if (Array.isArray(pair)) return pairKey(pair[0], pair[1]);
  return pairKey(pair.a, pair.b);
}

function deepFreezeToken(token) {
  Object.freeze(token.actors);
  return Object.freeze(token);
}
