/**
 * Bounded debug event log. Old entries are overwritten once the ring is full so a
 * long-running park cannot grow behavior telemetry without bound.
 */

export class EventLog {
  constructor(limit = 200) {
    this.limit = Math.max(1, Number(limit) || 200);
    this.entries = [];
    this.sequence = 0;
  }

  push(type, detail = {}, now = 0) {
    const entry = Object.freeze({
      seq: ++this.sequence,
      type: String(type || 'event'),
      at: now,
      detail
    });
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    return entry;
  }

  list({ type = null, since = null, limit = null } = {}) {
    let result = this.entries;
    if (type != null) result = result.filter(entry => entry.type === type);
    if (since != null) result = result.filter(entry => entry.at >= since);
    if (limit != null) result = result.slice(-limit);
    return result.slice();
  }

  last() {
    return this.entries[this.entries.length - 1] || null;
  }

  clear() {
    this.entries.length = 0;
    return this;
  }

  get size() {
    return this.entries.length;
  }

  [Symbol.iterator]() {
    return this.entries[Symbol.iterator]();
  }
}

export function createEventLog(limit = 200) {
  return new EventLog(limit);
}
