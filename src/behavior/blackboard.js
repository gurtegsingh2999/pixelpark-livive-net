/**
 * Lightweight read model for the behavior runtime.
 *
 * The blackboard never owns the Game or characters. It indexes an injected actor list
 * into coarse spatial buckets, exposes deterministic queries for selectors, and keeps
 * optional NPC-to-NPC pair facts (greets, shared activities, friendship). Persistence
 * can either serialize `serializeRelations()` or inject a `query.relation` adapter that
 * reads the save's own social store.
 */

const DEFAULT_FRIEND_THRESHOLD = Object.freeze({ greets: 2, activities: 1 });
const BUCKET_SIZE = 8;

export function actorKind(actor) {
  if (!actor) return 'unknown';
  if (actor.isPlayer) return 'player';
  if (actor.isCompanion) return 'companion';
  return 'npc';
}

export function actorStyle(actor) {
  return actor?.recipe?.style || actor?.style || '';
}

export function actorFamily(actor, styleFamilies = {}) {
  const style = actorStyle(actor);
  return actor?.recipe?.family || actor?.family || styleFamilies?.[style] || '';
}

export function pairKey(a, b) {
  const left = typeof a === 'string' ? a : a?.id;
  const right = typeof b === 'string' ? b : b?.id;
  if (!left || !right) return '';
  return [String(left), String(right)].sort().join('::');
}

export function friendThresholdMet(relation, threshold = DEFAULT_FRIEND_THRESHOLD) {
  return (relation?.greets || 0) >= (threshold.greets ?? 2) &&
    (relation?.activities || 0) >= (threshold.activities ?? 1);
}

export class Blackboard {
  constructor({
    actors = [],
    player = null,
    now = 0,
    styleFamilies = {},
    query = {},
    maxPairRecords = 256,
    maxFriendshipsPerNpc = 6,
    friendThreshold = DEFAULT_FRIEND_THRESHOLD
  } = {}) {
    this.styleFamilies = styleFamilies;
    this.query = query || {};
    this.maxPairRecords = maxPairRecords;
    this.maxFriendshipsPerNpc = maxFriendshipsPerNpc;
    this.friendThreshold = { ...DEFAULT_FRIEND_THRESHOLD, ...friendThreshold };
    this.player = player;
    this.now = now;
    this.actors = [];
    this.byId = new Map();
    this.buckets = new Map();
    this.pairs = new Map();
    this.sync(actors, player, now);
  }

  sync(actors = [], player = this.player, now = this.now) {
    this.actors = Array.isArray(actors) ? actors.filter(Boolean) : [];
    this.player = player || null;
    this.now = now;
    this.byId = new Map();
    this.buckets = new Map();

    if (this.player?.id != null) this.byId.set(this.player.id, this.player);
    for (const actor of this.actors) {
      if (actor?.id != null) this.byId.set(actor.id, actor);
      if (!isPositioned(actor)) continue;
      const key = this.bucketKey(actor.x, actor.y);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(actor);
      else this.buckets.set(key, [actor]);
    }
    return this;
  }

  setNow(now) {
    this.now = now;
    return this;
  }

  bucketKey(x, y) {
    return `${Math.floor(x / BUCKET_SIZE)},${Math.floor(y / BUCKET_SIZE)}`;
  }

  all() {
    return this.actors;
  }

  get(id) {
    if (id == null) return null;
    if (typeof this.query.get === 'function') {
      const found = this.query.get(id);
      if (found) return found;
    }
    return this.byId.get(id) || null;
  }

  others(actor) {
    return this.actors.filter(other => other !== actor && other?.id !== actor?.id);
  }

  kindOf(actor) {
    return typeof this.query.kindOf === 'function' ? this.query.kindOf(actor) : actorKind(actor);
  }

  styleOf(actor) {
    return actorStyle(actor);
  }

  familyOf(actor) {
    return actorFamily(actor, this.styleFamilies);
  }

  distance(a, b) {
    if (!a || !b) return Infinity;
    if (typeof this.query.distance === 'function') return this.query.distance(a, b);
    if (!isPositioned(a) || !isPositioned(b)) return Infinity;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  neighbours(actor, { radius = 4, kinds = null, includePlayer = false } = {}) {
    if (!actor || !isPositioned(actor)) return [];
    const wanted = normaliseKinds(kinds);
    const found = new Map();
    const cellRadius = Math.ceil(radius / BUCKET_SIZE);
    const cx = Math.floor(actor.x / BUCKET_SIZE);
    const cy = Math.floor(actor.y / BUCKET_SIZE);

    for (let oy = -cellRadius; oy <= cellRadius; oy++) {
      for (let ox = -cellRadius; ox <= cellRadius; ox++) {
        const bucket = this.buckets.get(`${cx + ox},${cy + oy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === actor || other.id === actor.id) continue;
          if (!includePlayer && other.isPlayer) continue;
          if (wanted && !wanted.has(this.kindOf(other))) continue;
          const dist = this.distance(actor, other);
          if (dist > radius) continue;
          found.set(other.id ?? other, other);
        }
      }
    }

    return [...found.values()].sort((a, b) => {
      const delta = this.distance(actor, a) - this.distance(actor, b);
      if (delta) return delta;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
  }

  buddy(actor) {
    if (!actor) return null;
    if (typeof this.query.buddy === 'function') {
      const found = this.query.buddy(actor);
      if (found) return found;
    }
    if (actor.buddyId == null) return null;
    if (this.player && this.player.id === actor.buddyId) return this.player;
    return this.get(actor.buddyId);
  }

  midpoint(a, b) {
    if (typeof this.query.midpoint === 'function') {
      const found = this.query.midpoint(a, b);
      if (found) return found;
    }
    if (!isPositioned(a) || !isPositioned(b)) return null;
    return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
  }

  nearestOpen(point, params = {}) {
    if (typeof this.query.nearestOpen === 'function') return this.query.nearestOpen(point, params);
    return point ? { x: point.x, y: point.y } : null;
  }

  pairCount() {
    return this.pairs.size;
  }

  relation(a, b) {
    if (!a || !b) return emptyRelation();
    if (typeof this.query.relation === 'function') {
      return normaliseRelation(this.query.relation(a, b));
    }
    const key = pairKey(a, b);
    return normaliseRelation(this.pairs.get(key));
  }

  isFriend(a, b) {
    if (typeof this.query.isFriend === 'function') return Boolean(this.query.isFriend(a, b));
    return this.relation(a, b).friends === true;
  }

  friendsOf(actor) {
    if (!actor) return new Set();
    if (typeof this.query.friendsOf === 'function') {
      const result = this.query.friendsOf(actor);
      return result instanceof Set ? result : new Set(result || []);
    }
    const id = actor.id;
    const friends = new Set();
    for (const relation of this.pairs.values()) {
      if (!relation.friends) continue;
      if (relation.a === id) friends.add(relation.b);
      else if (relation.b === id) friends.add(relation.a);
    }
    return friends;
  }

  friendCount(actor) {
    if (!actor) return 0;
    if (typeof this.query.friendCount === 'function') return this.query.friendCount(actor);
    return this.friendsOf(actor).size;
  }

  recordGreet(a, b) {
    return this.#mutatePair(a, b, relation => {
      relation.greets += 1;
    });
  }

  recordActivity(a, b) {
    return this.#mutatePair(a, b, relation => {
      relation.activities += 1;
    });
  }

  canBecomeFriends(a, b) {
    if (!a || !b || a === b) return { ok: false, reason: 'invalid-pair', relation: emptyRelation() };
    const relation = this.relation(a, b);
    if (relation.friends) return { ok: false, reason: 'already-friends', relation };
    if (!friendThresholdMet(relation, this.friendThreshold)) {
      return { ok: false, reason: 'threshold', relation };
    }
    if (this.friendCount(a) >= this.maxFriendshipsPerNpc) {
      return { ok: false, reason: 'friend-cap', relation };
    }
    if (this.friendCount(b) >= this.maxFriendshipsPerNpc) {
      return { ok: false, reason: 'friend-cap', relation };
    }
    if (!this.pairs.has(pairKey(a, b)) && this.pairs.size >= this.maxPairRecords) {
      return { ok: false, reason: 'pair-cap', relation };
    }
    return { ok: true, reason: 'ok', relation };
  }

  attemptFriendship(a, b) {
    const check = this.canBecomeFriends(a, b);
    if (!check.ok) return { ...check, friends: false };
    this.#mutatePair(a, b, relation => {
      relation.friends = true;
    });
    return {
      ok: true,
      friends: true,
      reason: 'ok',
      relation: this.relation(a, b),
      actorFriendCount: this.friendCount(a),
      targetFriendCount: this.friendCount(b)
    };
  }

  /**
   * Default interaction resolver used when the integration layer does not inject one.
   * C2 may replace it with the save-backed resolver; semantics stay the same.
   */
  applyInteraction(a, b, interaction) {
    if (interaction === 'greet') {
      this.recordGreet(a, b);
      return this.#interactionResult(a, b, 'greet', true);
    }
    if (interaction === 'activity' || interaction === 'game') {
      this.recordActivity(a, b);
      return this.#interactionResult(a, b, 'activity', true);
    }
    if (interaction === 'befriend') {
      const result = this.attemptFriendship(a, b);
      return {
        ...result,
        interaction: 'befriend',
        greets: result.relation?.greets ?? 0,
        activities: result.relation?.activities ?? 0,
        thresholdMet: friendThresholdMet(result.relation, this.friendThreshold)
      };
    }
    return { ok: false, friends: false, reason: 'unknown-interaction', interaction };
  }

  facts(actor, extra = {}) {
    const distanceToPlayer = this.player ? this.distance(actor, this.player) : 1e9;
    const relation = extra.target ? this.relation(actor, extra.target) : emptyRelation();
    return {
      now: this.now,
      actor: {
        id: actor?.id ?? null,
        kind: this.kindOf(actor),
        style: this.styleOf(actor),
        family: this.familyOf(actor),
        moving: Boolean(actor?.moving),
        inDialogue: Boolean(actor?.inDialogue),
        inMiniGame: Boolean(actor?.inMiniGame),
        friendCount: this.friendCount(actor),
        ...(extra.actor || {})
      },
      player: {
        present: Boolean(this.player),
        distance: distanceToPlayer,
        nearby: distanceToPlayer <= (extra.socialRadius ?? 3)
      },
      target: extra.target
        ? {
            present: true,
            id: extra.target.id ?? null,
            kind: this.kindOf(extra.target),
            style: this.styleOf(extra.target),
            family: this.familyOf(extra.target),
            distance: this.distance(actor, extra.target),
            friendCount: this.friendCount(extra.target)
          }
        : { present: false },
      pair: {
        present: Boolean(extra.target),
        distance: extra.target ? this.distance(actor, extra.target) : Infinity,
        greets: relation.greets,
        activities: relation.activities,
        friends: relation.friends,
        thresholdMet: friendThresholdMet(relation, this.friendThreshold)
      },
      limits: { ...(extra.limits || {}) },
      counts: {
        openNpcGames: extra.openNpcGames || 0,
        pairRecords: this.pairCount(),
        ...(extra.counts || {})
      },
      social: {
        dialogueOpen: Boolean(extra.dialogueOpen),
        suppressed: Boolean(extra.suppressed),
        ...(extra.social || {})
      }
    };
  }

  serializeRelations() {
    return {
      version: 1,
      pairs: [...this.pairs.entries()].map(([key, relation]) => ({ key, ...relation }))
    };
  }

  loadRelations(data) {
    const pairs = Array.isArray(data) ? data : data?.pairs;
    if (!Array.isArray(pairs)) return this;
    this.pairs.clear();
    for (const entry of pairs) {
      if (!entry?.key) continue;
      this.pairs.set(entry.key, normaliseRelation(entry));
    }
    this.#trimPairs();
    return this;
  }

  #interactionResult(a, b, interaction, ok) {
    const relation = this.relation(a, b);
    return {
      ok,
      friends: relation.friends,
      reason: 'ok',
      interaction,
      greets: relation.greets,
      activities: relation.activities,
      thresholdMet: friendThresholdMet(relation, this.friendThreshold)
    };
  }

  #mutatePair(a, b, mutate) {
    if (!a || !b || a === b) return emptyRelation();
    const key = pairKey(a, b);
    let relation = this.pairs.get(key);
    if (!relation) {
      relation = { a: a.id, b: b.id, greets: 0, activities: 0, friends: false };
      this.pairs.set(key, relation);
      this.#trimPairs(key);
    }
    mutate(relation);
    return normaliseRelation(relation);
  }

  #trimPairs(protectedKey = null) {
    while (this.pairs.size > this.maxPairRecords) {
      const victim = [...this.pairs.keys()].find(key => key !== protectedKey) ?? [...this.pairs.keys()][0];
      if (!victim) break;
      this.pairs.delete(victim);
    }
  }
}

export function createBlackboard(options) {
  return new Blackboard(options);
}

function emptyRelation() {
  return { greets: 0, activities: 0, friends: false };
}

function normaliseRelation(relation) {
  return {
    ...(relation || {}),
    greets: Number(relation?.greets) || 0,
    activities: Number(relation?.activities) || 0,
    friends: relation?.friends === true
  };
}

function normaliseKinds(kinds) {
  if (kinds == null) return null;
  const list = Array.isArray(kinds) ? kinds : [kinds];
  return new Set(list.filter(Boolean));
}

function isPositioned(actor) {
  return Number.isFinite(actor?.x) && Number.isFinite(actor?.y);
}
