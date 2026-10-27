import { hashString } from '../world.js';
import voicesData from '../../data/voices.json' with { type: 'json' };

export const VOICE_POOL = voicesData.pool;
export const VOICE_VARIANTS = voicesData.variants;
export const VOICE_GENDERS = voicesData.genders;
export const VOICE_ACCENTS = voicesData.accents;
const LIMITS = voicesData.limits;

/**
 * The stable string a character's voice is derived from. Characters keep their
 * seed on the recipe; id and name are fallbacks for hand-built records.
 */
export function seedOf(character) {
  const seed = character?.recipe?.seed ?? character?.seed ?? character?.id ?? character?.name;
  return seed == null ? 'park' : String(seed);
}

export function findVoice(id, pool = VOICE_POOL) {
  if (typeof id !== 'string') return null;
  return pool.find(voice => voice.id === id) || null;
}

export function filterPool(pool = VOICE_POOL, { gender = null, accent = null } = {}) {
  return pool.filter(voice => (!gender || voice.gender === gender) && (!accent || voice.accent === accent));
}

/** A stored voice counts only if it is still in the pool. */
export function storedVoice(character, pool = VOICE_POOL) {
  return findVoice(character?.voice, pool) ? character.voice : null;
}

// Rendezvous ranking: each seed orders the pool its own way, and adding a voice
// later only changes picks where the new voice ranks first.
function rank(seed, id) {
  return hashString(`${seed}|${id}`);
}

/**
 * Pick a pool voice id for a character. Stored voices win. Otherwise the
 * least-used voices are candidates, the gender with fewer neighbours among
 * them is preferred, and the seed breaks the remaining tie.
 *
 * @param {object} character
 * @param {Array<object>} [pool]
 * @param {{ usage?: Map<string, number> }} [options] voice id -> neighbours using it
 * @returns {string|null}
 */
export function assignVoice(character, pool = VOICE_POOL, { usage = new Map() } = {}) {
  const stored = storedVoice(character, pool);
  if (stored) return stored;
  if (!pool.length) return null;

  const usesOf = voice => usage.get(voice.id) || 0;
  const leastUses = Math.min(...pool.map(usesOf));
  let candidates = pool.filter(voice => usesOf(voice) === leastUses);

  const genderUses = new Map();
  for (const voice of pool) {
    genderUses.set(voice.gender, (genderUses.get(voice.gender) || 0) + usesOf(voice));
  }
  const fewest = Math.min(...candidates.map(voice => genderUses.get(voice.gender)));
  candidates = candidates.filter(voice => genderUses.get(voice.gender) === fewest);

  const seed = seedOf(character);
  let best = candidates[0];
  for (const voice of candidates) {
    if (rank(seed, voice.id) < rank(seed, best.id)) best = voice;
  }
  return best.id;
}

/**
 * Give every record a pool voice, keeping valid stored ones. Stored voices are
 * counted first so existing neighbours never lose theirs to a newcomer.
 * Returns shallow copies; the input is not mutated.
 */
export function assignVoices(characters, pool = VOICE_POOL) {
  const list = Array.isArray(characters) ? characters : [];
  const usage = new Map();
  for (const character of list) {
    const stored = storedVoice(character, pool);
    if (stored) usage.set(stored, (usage.get(stored) || 0) + 1);
  }
  return list.map(character => {
    if (storedVoice(character, pool)) return { ...character };
    const voice = assignVoice(character, pool, { usage });
    if (voice) usage.set(voice, (usage.get(voice) || 0) + 1);
    return voice ? { ...character, voice } : { ...character };
  });
}

/** Count how many of `characters` use each voice (assigning missing ones). */
export function voiceUsage(characters, pool = VOICE_POOL) {
  const usage = new Map();
  for (const character of assignVoices(characters, pool)) {
    if (character.voice) usage.set(character.voice, (usage.get(character.voice) || 0) + 1);
  }
  return usage;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Resolve a character to the engine-facing voice: pool entry plus the pitch and
 * rate offsets of its variant. `variant` 0 is the plain voice; repeats of the
 * same voice in a roster get 1, 2, ...
 *
 * @returns {{ id, engineVoice, lang, gender, accent, pitch, rate, variant }|null}
 */
export function resolveVoice(character, pool = VOICE_POOL, { variant = 0, variants = VOICE_VARIANTS } = {}) {
  const entry = findVoice(assignVoice(character, pool), pool);
  if (!entry) return null;
  const count = Math.max(1, variants.length);
  const index = ((Math.floor(Number(variant)) || 0) % count + count) % count;
  const offset = variants[index] || { pitch: 0, rate: 0 };
  return {
    id: entry.id,
    engineVoice: entry.engineVoice,
    lang: entry.lang,
    gender: entry.gender,
    accent: entry.accent,
    pitch: round(clamp((entry.pitch ?? 1) + (offset.pitch || 0), LIMITS.pitchMin, LIMITS.pitchMax)),
    rate: round(clamp((entry.rate ?? 1) + (offset.rate || 0), LIMITS.rateMin, LIMITS.rateMax)),
    variant: index
  };
}

/**
 * Resolve a whole roster. The first holder of a voice (in roster order) gets
 * variant 0, the next variant 1, and so on.
 *
 * @returns {Map<string, object>} character id -> resolved voice
 */
export function resolveVoices(characters, pool = VOICE_POOL, { variants = VOICE_VARIANTS } = {}) {
  const resolved = new Map();
  const holders = new Map();
  for (const character of assignVoices(characters, pool)) {
    if (!character.voice) continue;
    const variant = holders.get(character.voice) || 0;
    holders.set(character.voice, variant + 1);
    resolved.set(character.id, resolveVoice(character, pool, { variant, variants }));
  }
  return resolved;
}

/** Cache key part for a resolved voice: same engine voice and tuning, same audio. */
export function voiceCacheKey(voice) {
  if (!voice) return 'none';
  return `${voice.engineVoice}@${voice.pitch}/${voice.rate}`;
}
