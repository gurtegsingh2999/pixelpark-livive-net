import itemConfig from '../data/items.json' with { type: 'json' };

export const BALL_COLORS = itemConfig.ballColors;
export const ITEM_CATALOG = itemConfig.catalog;

let instanceCounter = 0;

export function getItemDefinition(id) {
  return ITEM_CATALOG[id] || null;
}

/**
 * Mint a unique id for an item instance. Callers that need persistence-safe,
 * reproducible ids can pass their own uid in `overrides` instead.
 */
function nextItemUid(id) {
  instanceCounter += 1;
  const base = typeof id === 'string' && id ? id : 'item';
  return `${base}-${instanceCounter.toString(36)}`;
}

/**
 * Build an item instance from the catalog. Unknown ids still produce a minimal
 * instance so callers can degrade gracefully instead of crashing.
 */
export function createItemInstance(id, overrides = {}) {
  if (typeof id !== 'string' || !id) return null;
  const extra = overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    ? overrides
    : {};
  const base = ITEM_CATALOG[id] || { id };
  const uid = typeof extra.uid === 'string' && extra.uid ? extra.uid : nextItemUid(id);
  return { ...base, ...extra, id: extra.id || base.id || id, uid };
}

/**
 * Give a legacy item (one saved before instances existed) a deterministic uid.
 * Reused uids are left alone, so this is safe to call repeatedly.
 */
export function ensureItemUid(item, index = 0) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.uid === 'string' && item.uid) return item.uid;
  const id = typeof item.id === 'string' && item.id ? item.id : 'item';
  const suffix = Number.isInteger(index) && index >= 0 ? index : 0;
  item.uid = `${id}-${suffix}`;
  return item.uid;
}

/** Exact uid lookup. */
export function findItemByUid(inventory, uid) {
  if (!Array.isArray(inventory) || typeof uid !== 'string' || !uid) return null;
  return inventory.find(item => item && item.uid === uid) || null;
}

/**
 * Look up an item by uid, falling back to item id for legacy saves whose
 * equipped entries reference an item id rather than an instance uid.
 */
export function getItemInstance(inventory, uidOrId) {
  if (!Array.isArray(inventory) || typeof uidOrId !== 'string' || !uidOrId) return null;
  return findItemByUid(inventory, uidOrId)
    || inventory.find(item => item && item.id === uidOrId)
    || null;
}

/**
 * Return a copy of the inventory with every entry turned into an instance.
 * String ids and legacy definitions are tolerated.
 */
export function normalizeInventory(inventory) {
  if (!Array.isArray(inventory)) return [];
  return inventory.reduce((items, entry, index) => {
    if (typeof entry === 'string' && entry) {
      items.push(createItemInstance(entry));
      return items;
    }
    if (!entry || typeof entry !== 'object') return items;
    const item = { ...entry };
    ensureItemUid(item, index);
    items.push(item);
    return items;
  }, []);
}

export function createStarterInventory() {
  return itemConfig.starter.map(spec => {
    const base = ITEM_CATALOG[spec.id];
    const item = { ...base };
    if (spec.randomize) {
      const pool = itemConfig[spec.randomize.from];
      if (Array.isArray(pool) && pool.length) {
        item[spec.randomize.field] = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    return item;
  });
}
