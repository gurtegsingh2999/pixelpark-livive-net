import itemConfig from '../data/items.json' with { type: 'json' };

export const BALL_COLORS = itemConfig.ballColors;
export const ITEM_CATALOG = itemConfig.catalog;

export function getItemDefinition(id) {
  return ITEM_CATALOG[id] || null;
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
