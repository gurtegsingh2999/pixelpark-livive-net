import {
  EFFECT_CATALOG,
  equip,
  equippedInSlot,
  getItemEffectId,
  slotCapacity
} from '../effects.js';
import { ensureItemUid, findItemByUid, getItemInstance } from '../inventory.js';

/**
 * Pure NPC auto-equip planner.
 *
 * Policy (Phase 2 v1):
 * - sort candidate effect items by `effect.ai.priority` (desc) then item id;
 * - `self` / `party` effects only target the owner;
 * - `buddy` effects only target active companions;
 * - `any` effects try the owner first, then companions in roster order;
 * - pick the first target with a free slot; otherwise leave the item in the bag;
 * - never unequip, swap, or discard a worn effect.
 */

export const LOADOUT_TARGETS = ['self', 'party', 'buddy', 'any'];

const TARGET_SET = new Set(LOADOUT_TARGETS);
const DEFAULT_PRIORITY = 0;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function inventoryOf(character) {
  return Array.isArray(character?.inventory) ? character.inventory : [];
}

function characterId(character) {
  return typeof character?.id === 'string' && character.id ? character.id : null;
}

function effectPriority(effect) {
  const priority = effect?.ai?.priority;
  return Number.isFinite(priority) ? priority : DEFAULT_PRIORITY;
}

function effectTarget(effect) {
  const declared = effect?.ai?.target;
  if (TARGET_SET.has(declared)) return declared;
  const fallback = effect?.target;
  return TARGET_SET.has(fallback) ? fallback : 'self';
}

function resolveItemEffectId(item) {
  const declared = item?.effectId || item?.effect;
  if (typeof declared === 'string' && declared) return declared;
  return getItemEffectId(item);
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function inferredUid(item, index) {
  if (typeof item?.uid === 'string' && item.uid) return item.uid;
  const id = typeof item?.id === 'string' && item.id ? item.id : 'item';
  const suffix = Number.isInteger(index) && index >= 0 ? index : 0;
  return `${id}-${suffix}`;
}

function itemIdOf(item, effectId) {
  if (typeof item?.id === 'string' && item.id) return item.id;
  return effectId;
}

function equippedUids(character) {
  const uids = new Set();
  const equipped = Array.isArray(character?.equipped) ? character.equipped : [];
  for (const entry of equipped) {
    if (typeof entry === 'string' && entry) {
      uids.add(entry);
    } else if (isObject(entry) && typeof entry.uid === 'string' && entry.uid) {
      uids.add(entry.uid);
    }
  }
  return uids;
}

function compareCandidates(a, b) {
  const byPriority = effectPriority(b.effect) - effectPriority(a.effect);
  if (byPriority) return byPriority;
  return compareStrings(a.itemId, b.itemId) || compareStrings(a.uid, b.uid);
}

function targetsFor(effect, owner, companions) {
  switch (effectTarget(effect)) {
    case 'buddy':
      return companions.slice();
    case 'any':
      return [owner, ...companions];
    case 'party':
    case 'self':
    default:
      return [owner];
  }
}

function wearsEffect(character, effect, equippedFor) {
  const entries = equippedFor(character, effect.slot);
  return entries.some(entry => {
    const id = entry?.effectId || entry?.effect?.id;
    return id === effect.id;
  });
}

function slotBlockReason(character, effect, slot, capacity, equippedFor) {
  if (!(capacity > 0)) return 'no-slot';
  if (equippedFor(character, slot).length >= capacity) return 'no-free-slot';
  if (effect.stacking === 'unique' && wearsEffect(character, effect, equippedFor)) {
    return 'already-worn';
  }
  return null;
}

// Plan-time slot occupancy: worn entries plus moves already planned in this run.
function createSlotTracker(equippedFor) {
  const counts = new Map();

  function slotMap(character) {
    let map = counts.get(character);
    if (!map) {
      map = new Map();
      counts.set(character, map);
    }
    return map;
  }

  function used(character, slot) {
    const map = slotMap(character);
    if (!map.has(slot)) map.set(slot, equippedFor(character, slot).length);
    return map.get(slot);
  }

  function reserve(character, slot) {
    slotMap(character).set(slot, used(character, slot) + 1);
  }

  return { used, reserve };
}

/**
 * Plan auto-equip moves without mutating any character.
 * Returns `{ moves, skipped }`; each move carries the item instance, uid,
 * resolved effect/slot, and target character + targetId.
 */
export function planAutoEquip(owner, companions = [], options = {}) {
  const moves = [];
  const skipped = [];
  if (!isObject(owner)) return { moves, skipped };

  const settings = isObject(options) ? options : {};
  const catalog = isObject(settings.effects) ? settings.effects : EFFECT_CATALOG;
  const effectFor = typeof settings.getEffect === 'function'
    ? settings.getEffect
    : id => catalog[id] || null;
  const capacityFor = typeof settings.slotCapacity === 'function'
    ? settings.slotCapacity
    : slotCapacity;
  const equippedFor = typeof settings.equippedInSlot === 'function'
    ? settings.equippedInSlot
    : equippedInSlot;

  const party = (Array.isArray(companions) ? companions : []).filter(isObject);
  const tracker = createSlotTracker(equippedFor);

  // Equipped instances stay in the bag; never re-home or re-equip them.
  const wornUids = new Set();
  for (const character of [owner, ...party]) {
    for (const uid of equippedUids(character)) wornUids.add(uid);
  }

  const candidates = [];
  inventoryOf(owner).forEach((item, index) => {
    if (!isObject(item)) return;
    const effectId = resolveItemEffectId(item);
    if (!effectId) return;
    const effect = effectFor(effectId);
    if (!isObject(effect) || typeof effect.id !== 'string') return;

    const slot = typeof effect.slot === 'string' && effect.slot
      ? effect.slot
      : (typeof item.slot === 'string' && item.slot ? item.slot : null);
    if (!slot) return;

    const uid = inferredUid(item, index);
    const itemId = itemIdOf(item, effect.id);
    if (wornUids.has(uid) || wornUids.has(itemId)) return;

    candidates.push({
      item,
      uid,
      itemId,
      effectId: effect.id,
      effect,
      slot
    });
  });
  candidates.sort(compareCandidates);

  for (const candidate of candidates) {
    const capacity = capacityFor(candidate.slot);
    const choices = targetsFor(candidate.effect, owner, party);
    const target = choices.find(character => {
      if (tracker.used(character, candidate.slot) >= capacity) return false;
      if (candidate.effect.stacking === 'unique'
        && wearsEffect(character, candidate.effect, equippedFor)) return false;
      return true;
    }) || null;

    if (!target) {
      skipped.push({
        item: candidate.item,
        uid: candidate.uid,
        itemId: candidate.itemId,
        effectId: candidate.effectId,
        slot: candidate.slot,
        reason: 'no-free-slot'
      });
      continue;
    }

    tracker.reserve(target, candidate.slot);
    moves.push({
      item: candidate.item,
      uid: candidate.uid,
      itemId: candidate.itemId,
      effectId: candidate.effectId,
      effect: candidate.effect,
      slot: candidate.slot,
      targetId: characterId(target),
      target
    });
  }

  return { moves, skipped };
}

function resolveOwnedItem(character, uidOrItem) {
  const inventory = inventoryOf(character);
  if (typeof uidOrItem === 'string' && uidOrItem) {
    return getItemInstance(inventory, uidOrItem);
  }
  if (!isObject(uidOrItem)) return null;
  if (inventory.includes(uidOrItem)) return uidOrItem;
  if (typeof uidOrItem.uid === 'string' && uidOrItem.uid) {
    return findItemByUid(inventory, uidOrItem.uid);
  }
  return null;
}

/**
 * Move an item instance between two characters, preserving its uid. Returns a
 * result object instead of throwing; the item is only removed from `from` once
 * the destination has accepted it.
 */
export function transferItem(from, to, uidOrItem) {
  if (!isObject(from) || !isObject(to)) return { ok: false, reason: 'no-character' };
  if (from === to) return { ok: false, reason: 'same-character' };

  const item = resolveOwnedItem(from, uidOrItem);
  if (!item) return { ok: false, reason: 'not-found' };

  const index = from.inventory.indexOf(item);
  if (index < 0) return { ok: false, reason: 'not-found' };

  const uid = ensureItemUid(item, index);
  if (!Array.isArray(to.inventory)) to.inventory = [];
  if (findItemByUid(to.inventory, uid)) {
    return { ok: false, reason: 'duplicate-uid', uid, item };
  }

  from.inventory.splice(index, 1);
  to.inventory.push(item);

  return {
    ok: true,
    item,
    uid,
    itemId: typeof item.id === 'string' ? item.id : null,
    fromId: characterId(from),
    toId: characterId(to)
  };
}

function describeEquip(move, result) {
  return {
    item: move.item,
    uid: result.uid || move.uid,
    itemId: result.itemId || move.itemId,
    effectId: result.effectId || move.effectId,
    slot: result.slot || move.slot,
    targetId: move.targetId
  };
}

function describeSkip(move, reason) {
  return {
    item: move.item,
    uid: move.uid,
    itemId: move.itemId,
    effectId: move.effectId,
    slot: move.slot,
    targetId: move.targetId,
    reason
  };
}

/**
 * Apply the planner to the live characters using `equip` from effects.js.
 * Companion-bound items are transferred first and moved back if equipping
 * fails, so an item is never duplicated or lost. Mutates inventories/equipped
 * lists; returns `{ equipped, skipped, moved }`.
 */
export function autoEquipOwner(owner, companions = [], options = {}) {
  const result = { equipped: [], skipped: [], moved: [] };
  if (!isObject(owner)) return result;

  const settings = isObject(options) ? options : {};
  const now = Number.isFinite(settings.now) ? settings.now : 0;
  const party = (Array.isArray(companions) ? companions : []).filter(isObject);
  const capacityFor = typeof settings.slotCapacity === 'function'
    ? settings.slotCapacity
    : slotCapacity;
  const equippedFor = typeof settings.equippedInSlot === 'function'
    ? settings.equippedInSlot
    : equippedInSlot;

  // Give legacy bag items the same deterministic uid the planner infers.
  inventoryOf(owner).forEach((item, index) => {
    if (isObject(item)) ensureItemUid(item, index);
  });

  const plan = planAutoEquip(owner, party, settings);

  for (const move of plan.moves) {
    const target = move.target;
    if (!isObject(target)) {
      result.skipped.push(describeSkip(move, 'no-target'));
      continue;
    }

    const blocked = slotBlockReason(
      target,
      move.effect || { id: move.effectId, slot: move.slot },
      move.slot,
      capacityFor(move.slot),
      equippedFor
    );
    if (blocked) {
      result.skipped.push(describeSkip(move, blocked));
      continue;
    }

    if (!Array.isArray(target.equipped)) target.equipped = [];

    if (target === owner) {
      const outcome = equip(owner, move.item, now);
      if (outcome.ok && (!Array.isArray(outcome.swapped) || outcome.swapped.length === 0)) {
        result.equipped.push(describeEquip(move, outcome));
      } else {
        result.skipped.push(describeSkip(move, outcome.ok ? 'would-swap' : outcome.reason));
      }
      continue;
    }

    if (!Array.isArray(target.inventory)) target.inventory = [];
    const transfer = transferItem(owner, target, move.item);
    if (!transfer.ok) {
      result.skipped.push(describeSkip(move, transfer.reason));
      continue;
    }

    const outcome = equip(target, transfer.item, now);
    if (outcome.ok && (!Array.isArray(outcome.swapped) || outcome.swapped.length === 0)) {
      result.equipped.push(describeEquip(move, outcome));
      result.moved.push({
        item: transfer.item,
        uid: transfer.uid,
        itemId: transfer.itemId,
        fromId: transfer.fromId,
        toId: transfer.toId
      });
    } else {
      // Never leave the item on a companion it could not equip.
      transferItem(target, owner, transfer.item);
      result.skipped.push(describeSkip(move, outcome.ok ? 'would-swap' : outcome.reason));
    }
  }

  result.skipped.push(...plan.skipped);
  return result;
}
