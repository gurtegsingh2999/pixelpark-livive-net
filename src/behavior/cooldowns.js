/**
 * Cooldown store with actor, pair, and global scopes.
 *
 * Durations are sampled from behavior data: a fixed milliseconds value, a `[min, max]`
 * range, or an object carrying `durationMs`. Sampling uses the injected RNG so runtime
 * and tests are deterministic. Pair keys come from `pairKey()` in blackboard.js.
 */

export const COOLDOWN_SCOPES = Object.freeze(['actor', 'pair', 'global']);

export function sampleDuration(spec, rng = Math.random) {
  const value = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec.durationMs : spec;
  if (typeof value === 'number') return Math.max(0, value);
  if (Array.isArray(value) && value.length === 2) {
    const min = Math.max(0, Number(value[0]) || 0);
    const max = Math.max(min, Number(value[1]) || 0);
    return Math.round(min + rng() * (max - min));
  }
  return 0;
}

export class CooldownStore {
  constructor({ now = 0, maxEntries = 1024 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  readyAt(scope, key) {
    return this.entries.get(storageKey(scope, key))?.readyAt ?? 0;
  }

  remaining(scope, key, now = this.now) {
    return Math.max(0, this.readyAt(scope, key) - now);
  }

  isReady(scope, key, now = this.now) {
    return this.readyAt(scope, key) <= now;
  }

  start(scope, key, durationMs, now = this.now) {
    assertScope(scope);
    const readyAt = Math.max(this.readyAt(scope, key), now + Math.max(0, durationMs));
    const id = storageKey(scope, key);
    const existing = this.entries.get(id);
    if (existing) {
      existing.readyAt = readyAt;
    } else {
      this.entries.set(id, { scope, key, readyAt });
      this.#trim();
    }
    return readyAt;
  }

  consume(scope, key, spec, now = this.now, rng = Math.random) {
    if (!this.isReady(scope, key, now)) {
      return { ok: false, readyAt: this.readyAt(scope, key) };
    }
    const durationMs = sampleDuration(spec, rng);
    return { ok: true, durationMs, readyAt: this.start(scope, key, durationMs, now) };
  }

  sample(spec, rng = Math.random) {
    return sampleDuration(spec, rng);
  }

  clear(scope = null) {
    if (scope == null) {
      this.entries.clear();
      return this;
    }
    for (const [id, entry] of this.entries) {
      if (entry.scope === scope) this.entries.delete(id);
    }
    return this;
  }

  prune(now = this.now) {
    this.now = now;
    for (const [id, entry] of this.entries) {
      if (entry.readyAt <= now) this.entries.delete(id);
    }
    return this;
  }

  size() {
    return this.entries.size;
  }

  list() {
    return [...this.entries.values()].map(entry => ({ ...entry }));
  }

  serialize(now = this.now) {
    return {
      version: 1,
      entries: this.list().filter(entry => entry.readyAt > now)
    };
  }

  static deserialize(data, { now = 0, maxEntries = 1024 } = {}) {
    const store = new CooldownStore({ now, maxEntries });
    const entries = Array.isArray(data) ? data : data?.entries;
    if (!Array.isArray(entries)) return store;
    for (const entry of entries) {
      if (!entry || !COOLDOWN_SCOPES.includes(entry.scope) || entry.key == null) continue;
      if (!Number.isFinite(entry.readyAt)) continue;
      store.entries.set(storageKey(entry.scope, entry.key), {
        scope: entry.scope,
        key: entry.key,
        readyAt: entry.readyAt
      });
    }
    store.#trim();
    return store;
  }

  #trim() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }
}

export function createCooldowns(options) {
  return new CooldownStore(options);
}

function storageKey(scope, key) {
  return `${scope}:${key}`;
}

function assertScope(scope) {
  if (!COOLDOWN_SCOPES.includes(scope)) throw new Error(`unknown cooldown scope: ${scope}`);
}
