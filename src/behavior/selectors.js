/**
 * Data-driven target selectors. Every selector receives an injected blackboard plus the
 * acting character, so behavior definitions never reach into Game directly.
 *
 * Selector params are intentionally plain:
 *   nearest       { kind, maxDistance, radius, minPlayerDistance, notFriends, friendsOnly,
 *                   minGreets, minActivities, excludeIds }
 *   byId          { id | actorId }
 *   mutualFriend  { kind, maxDistance, minPlayerDistance }
 *   buddy         {}
 *   midpoint      { a, b, open }  (ids or {x,y}; defaults to actor + buddy)
 */

export const SELECTOR_NAMES = Object.freeze(['nearest', 'byId', 'mutualFriend', 'buddy', 'midpoint']);

export function select(name, { blackboard, actor, params = {}, facts = {} } = {}) {
  if (!blackboard || !actor) return null;
  switch (name) {
    case 'nearest':
      return nearest(blackboard, actor, params);
    case 'byId':
      return byId(blackboard, actor, params);
    case 'mutualFriend':
      return mutualFriend(blackboard, actor, params);
    case 'buddy':
      return buddy(blackboard, actor, params);
    case 'midpoint':
      return midpoint(blackboard, actor, params, facts);
    default:
      return null;
  }
}

export function nearest(blackboard, actor, params = {}) {
  const kind = params.kind ?? 'npc';
  const maxDistance = params.maxDistance ?? params.radius ?? 4;
  const radius = params.radius ?? maxDistance;
  const minPlayerDistance = params.minPlayerDistance ?? 0;
  const excludeIds = new Set(params.excludeIds || []);

  if (minPlayerDistance > 0 && blackboard.player &&
      blackboard.distance(actor, blackboard.player) <= minPlayerDistance) {
    return null;
  }

  const candidates = blackboard.neighbours(actor, { radius, kinds: kind })
    .filter(candidate => !excludeIds.has(candidate.id))
    .filter(candidate => blackboard.distance(actor, candidate) <= maxDistance)
    .filter(candidate => {
      if (minPlayerDistance <= 0 || !blackboard.player) return true;
      return blackboard.distance(candidate, blackboard.player) > minPlayerDistance;
    })
    .filter(candidate => {
      if (params.friendsOnly || params.requireFriend) return blackboard.isFriend(actor, candidate);
      if (params.notFriends) return !blackboard.isFriend(actor, candidate);
      return true;
    })
    .filter(candidate => {
      const relation = blackboard.relation(actor, candidate);
      if (params.minGreets != null && relation.greets < params.minGreets) return false;
      if (params.minActivities != null && relation.activities < params.minActivities) return false;
      if (params.maxFriendCount != null && blackboard.friendCount(candidate) > params.maxFriendCount) return false;
      return true;
    });

  return candidates[0] || null;
}

export function byId(blackboard, actor, params = {}) {
  const id = params.id ?? params.actorId ?? params.targetId;
  if (id == null) return null;
  if (actor?.id === id) return actor;
  return blackboard.get(id);
}

export function mutualFriend(blackboard, actor, params = {}) {
  const maxDistance = params.maxDistance ?? params.radius ?? 4;
  const minPlayerDistance = params.minPlayerDistance ?? 0;
  if (minPlayerDistance > 0 && blackboard.player &&
      blackboard.distance(actor, blackboard.player) <= minPlayerDistance) {
    return null;
  }

  const candidates = blackboard.neighbours(actor, {
    radius: params.radius ?? maxDistance,
    kinds: params.kind ?? 'npc'
  })
    .filter(candidate => blackboard.distance(actor, candidate) <= maxDistance)
    .filter(candidate => blackboard.isFriend(actor, candidate) && blackboard.isFriend(candidate, actor))
    .filter(candidate => {
      if (minPlayerDistance <= 0 || !blackboard.player) return true;
      return blackboard.distance(candidate, blackboard.player) > minPlayerDistance;
    });

  return candidates[0] || null;
}

export function buddy(blackboard, actor, params = {}) {
  const found = blackboard.buddy(actor);
  if (!found) return null;
  if (params.kind != null && blackboard.kindOf(found) !== params.kind) return null;
  if (params.maxDistance != null && blackboard.distance(actor, found) > params.maxDistance) return null;
  return found;
}

export function midpoint(blackboard, actor, params = {}, facts = {}) {
  const a = resolvePoint(blackboard, actor, params.a ?? actor);
  const b = resolvePoint(blackboard, actor, params.b ?? params.with ?? params.targetId ?? blackboard.buddy(actor));
  if (!a || !b) return null;
  const point = blackboard.midpoint(a, b);
  if (!point) return null;
  if (params.open) return blackboard.nearestOpen(point, params);
  return point;
}

function resolvePoint(blackboard, actor, value) {
  if (value == null) return null;
  if (typeof value === 'string') return blackboard.get(value);
  if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value;
  return null;
}
