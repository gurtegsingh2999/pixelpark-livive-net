import { cleanForSpeech, splitSentences } from './text.js';
import { voiceCacheKey } from './voices.js';
import voicesData from '../../data/voices.json' with { type: 'json' };

export const SPEAK_RULES = voicesData.speak;
export const CACHE_SIZE = voicesData.cache.maxEntries;

const MINUTE_MS = 60_000;

/** Small LRU map: `get` refreshes an entry, `set` evicts the oldest past `limit`. */
export function createLru(limit = CACHE_SIZE) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    has(key) {
      return entries.has(key);
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > Math.max(0, limit)) entries.delete(entries.keys().next().value);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    }
  };
}

/** `ttt.*` matches `ttt.win`; anything else must match exactly. */
export function matchesKey(key, patterns = []) {
  if (typeof key !== 'string' || !key) return false;
  return patterns.some(pattern => (pattern.endsWith('.*')
    ? key.startsWith(pattern.slice(0, -1))
    : key === pattern));
}

/** Whether a dialogue key is spoken. Unlabelled beats (menus, prompts) stay silent. */
export function shouldSpeak(key, rules = SPEAK_RULES) {
  if (matchesKey(key, rules.skip)) return false;
  return matchesKey(key, rules.dialogue);
}

/**
 * Speech queue and cancel rules for one injected engine. Pure: no DOM, no
 * AudioContext. Dialogue interrupts everything; bubbles only speak into
 * silence and are dropped otherwise. At most one engine generation is in
 * flight, sentences of a line play in order, and the next sentence generates
 * while the current one plays.
 *
 * Engine: `{ id, status(), load(), synth(text, voice), stop(), selfPlaying? }`.
 * `synth` resolving `null` means the engine played the line itself and the
 * promise resolved when it finished (Web Speech); set `selfPlaying: true` on
 * such engines so the speaker never pre-generates through them.
 *
 * Player: `{ play(audio, { volume, pan, pitch, rate }) -> { done: Promise, stop() } }`.
 *
 * @param {object} deps
 * @param {object|null} [deps.engine]
 * @param {object|null} [deps.player]
 * @param {object} [deps.rules] data/voices.json `speak`
 * @param {number} [deps.cacheSize]
 * @param {() => number} [deps.now]
 * @param {(item:object) => void} [deps.onStart]
 * @param {(item:object, info:{cancelled:boolean, error?:unknown}) => void} [deps.onEnd]
 * @param {(error:unknown, item:object|null) => void} [deps.onError]
 */
export function createSpeaker({
  engine = null,
  player = null,
  rules = SPEAK_RULES,
  cacheSize = CACHE_SIZE,
  now = () => Date.now(),
  onStart = null,
  onEnd = null,
  onError = null
} = {}) {
  const cache = createLru(cacheSize);
  const bubbleTimes = [];
  const lastLine = new Map();
  let currentEngine = engine;
  let current = null;
  let handle = null;
  let generation = 0;
  let inFlight = null;
  let enabled = true;
  let nextId = 1;

  const bubbleRules = () => rules.bubbles || {};
  const engineReady = () => Boolean(currentEngine) && currentEngine.status?.() === 'ready';
  const cacheKey = (voice, text) => `${currentEngine?.id || 'engine'}|${voiceCacheKey(voice)}|${text}`;

  // Serialise engine calls so a cancelled generation finishes before the next starts.
  function generate(text, voice) {
    const key = cacheKey(voice, text);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const engineAtCall = currentEngine;
    const previous = inFlight || Promise.resolve();
    const run = previous.catch(() => {}).then(() => engineAtCall.synth(text, voice));
    const tracked = run.then(audio => {
      if (audio) cache.set(key, audio);
      return audio;
    });
    const marker = tracked.catch(() => {}).then(() => {
      if (inFlight === marker) inFlight = null;
    });
    inFlight = marker;
    return tracked;
  }

  function finish(item, info) {
    if (item.finished) return;
    item.finished = true;
    if (current === item) {
      current = null;
      handle = null;
    }
    onEnd?.(item, info);
    item.resolve(info);
  }

  async function run(item, token) {
    const live = () => token === generation && current === item;
    onStart?.(item);
    const canPrefetch = !currentEngine.selfPlaying;
    let pending = generate(item.sentences[0], item.voice);
    try {
      for (let index = 0; index < item.sentences.length; index++) {
        const audio = await pending;
        if (!live()) return;
        const hasNext = index + 1 < item.sentences.length;
        if (!audio) {
          // The engine spoke it already; ask for the next sentence now.
          if (hasNext) pending = generate(item.sentences[index + 1], item.voice);
          continue;
        }
        if (hasNext && canPrefetch) pending = generate(item.sentences[index + 1], item.voice);
        if (player?.play) {
          handle = player.play(audio, {
            volume: item.volume,
            pan: item.pan,
            pitch: item.voice?.pitch ?? 1,
            rate: item.voice?.rate ?? 1
          });
          await handle?.done;
          if (!live()) return;
          handle = null;
        }
        if (hasNext && !canPrefetch) pending = generate(item.sentences[index + 1], item.voice);
      }
      finish(item, { cancelled: false });
    } catch (error) {
      if (!live()) return;
      onError?.(error, item);
      finish(item, { cancelled: false, error });
    }
  }

  function dropped(reason) {
    return { status: 'dropped', reason, id: null, done: Promise.resolve({ cancelled: true }) };
  }

  function bubbleGate(request, at) {
    const settings = bubbleRules();
    if (!settings.enabled) return 'bubbles-off';
    if (request.visualOnly && settings.skipVisualOnly !== false) return 'visual-only';
    if (settings.keys && !matchesKey(request.key, settings.keys)) return 'key';
    if (Number.isFinite(request.distanceTiles) && Number.isFinite(settings.maxDistanceTiles)
      && request.distanceTiles > settings.maxDistanceTiles) return 'far';
    if (current || inFlight) return 'busy';
    const previous = lastLine.get(request.actorId);
    if (previous && previous.text === request.cleaned && at - previous.at < (settings.dedupeMs ?? 0)) {
      return 'duplicate';
    }
    while (bubbleTimes.length && at - bubbleTimes[0] >= MINUTE_MS) bubbleTimes.shift();
    if (Number.isFinite(settings.maxPerMinute) && bubbleTimes.length >= settings.maxPerMinute) return 'rate';
    return null;
  }

  /**
   * Ask for a line to be spoken.
   *
   * @param {{ actorId, text, voice, kind?: 'dialogue'|'bubble', key?: string,
   *   speakerName?: string, volume?: number, pan?: number, distanceTiles?: number,
   *   visualOnly?: boolean }} request
   * @returns {{ status: 'playing'|'dropped', reason?: string, id: number|null, done: Promise }}
   */
  function speak(request = {}) {
    const kind = request.kind === 'bubble' ? 'bubble' : 'dialogue';
    if (!enabled) return dropped('disabled');
    if (!engineReady()) return dropped('engine-not-ready');
    if (!request.voice) return dropped('no-voice');
    if (kind === 'dialogue' && !shouldSpeak(request.key, rules)) return dropped('key');

    const cleaned = cleanForSpeech(request.text, { speakerName: request.speakerName });
    if (!cleaned) return dropped('empty');
    const at = now();

    if (kind === 'dialogue') {
      if (current && current.kind === 'dialogue' && current.actorId === request.actorId && current.text === cleaned) {
        return { status: 'playing', reason: 'duplicate', id: current.id, done: current.done };
      }
      cancel();
    } else {
      const reason = bubbleGate({ ...request, cleaned }, at);
      if (reason) return dropped(reason);
      bubbleTimes.push(at);
    }

    let resolve;
    const done = new Promise(res => { resolve = res; });
    const item = {
      id: nextId++,
      kind,
      key: request.key ?? null,
      actorId: request.actorId ?? null,
      text: cleaned,
      sentences: splitSentences(cleaned),
      voice: request.voice,
      volume: request.volume ?? (kind === 'bubble' ? bubbleRules().volume ?? 1 : 1),
      pan: request.pan ?? 0,
      done,
      resolve,
      finished: false
    };
    lastLine.set(item.actorId, { text: cleaned, at });
    current = item;
    run(item, generation);
    return { status: 'playing', id: item.id, done };
  }

  /** Stop whatever is speaking (new beat, dialogue closed, mute). */
  function cancel() {
    generation += 1;
    const item = current;
    if (!item) return false;
    handle?.stop?.();
    handle = null;
    currentEngine?.stop?.();
    finish(item, { cancelled: true });
    return true;
  }

  /**
   * Generate a line into the cache without playing it, only into silence and
   * never through an engine that plays as it generates.
   */
  async function prewarm(text, voice, { speakerName = null } = {}) {
    if (!enabled || !engineReady() || currentEngine.selfPlaying || !voice) return false;
    const cleaned = cleanForSpeech(text, { speakerName });
    if (!cleaned) return false;
    const token = generation;
    for (const sentence of splitSentences(cleaned)) {
      if (token !== generation || current) return false;
      if (cache.has(cacheKey(voice, sentence))) continue;
      try {
        await generate(sentence, voice);
      } catch (error) {
        onError?.(error, null);
        return false;
      }
    }
    return true;
  }

  return {
    speak,
    cancel,
    prewarm,
    setEngine(next) {
      cancel();
      currentEngine = next || null;
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) cancel();
    },
    isBusy() {
      return Boolean(current || inFlight);
    },
    state() {
      return {
        enabled,
        current: current ? { id: current.id, kind: current.kind, actorId: current.actorId, key: current.key } : null,
        inFlight: Boolean(inFlight),
        cached: cache.size
      };
    },
    cache
  };
}
