import voicesData from '../../data/voices.json' with { type: 'json' };

export const TEXT_RULES = voicesData.text;

const SPEAKABLE = /[\p{L}\p{N}]/u;
// Emoji and pictographs, plus the joiners and modifiers that glue them together.
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
// Anything outside letters, digits, spaces, and plain sentence punctuation.
const ODD_CHARACTERS = /[^\p{L}\p{N}\p{M}\s.,!?;:'’"“”()\-–—%$/]/gu;
// "Name:" or "Two Words:" at the very start, the dialogue speaker convention.
const GENERIC_PREFIX = /^[\p{Lu}][\p{L}'’-]{0,23}(?: [\p{Lu}][\p{L}'’-]{0,23})?:\s+/u;
const COUNTDOWN = /\s*\(\d+\)\s*$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasSpeakableText(text) {
  return SPEAKABLE.test(String(text ?? ''));
}

function dropLines(text, prefixes) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(EMOJI, ' ').replace(COUNTDOWN, '').trim())
    .filter(Boolean);
  const kept = lines.filter(line => !prefixes.some(prefix => line.startsWith(prefix)));
  // A line break is a pause; end bare lines with a full stop so they don't run together.
  return kept.map(line => (/[\p{L}\p{N}]$/u.test(line) && kept.length > 1 ? `${line}.` : line)).join(' ');
}

function stripSpeakerPrefix(text, speakerName) {
  if (speakerName) {
    const own = new RegExp(`^${escapeRegExp(String(speakerName).trim())}\\s*:\\s*`, 'iu');
    if (own.test(text)) return text.replace(own, '');
  }
  return text.replace(GENERIC_PREFIX, '');
}

function applyReplacements(text, replacements) {
  let next = text;
  for (const [from, to] of Object.entries(replacements || {})) {
    const pattern = /^\w+$/.test(from)
      ? new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g')
      : new RegExp(`\\s*${escapeRegExp(from)}\\s*`, 'g');
    next = next.replace(pattern, /^\w+$/.test(from) ? to : ` ${to} `);
  }
  return next;
}

function tidy(text) {
  return text
    .replace(EMOJI, ' ')
    .replace(/(?:…|\.{2,})(?=\s*[\p{L}\p{N}])/gu, ', ')
    .replace(/…|\.{2,}/g, '.')
    .replace(ODD_CHARACTERS, ' ')
    .replace(/([!?.,;:])\1+/g, '$1')
    .replace(/([!?])[.,;:]+/g, '$1')
    .replace(/\s+([!?.,;:])/g, '$1')
    .replace(/^[\s.,!?;:\-–—]+/, '')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/[\s,;:\-–—]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cut to at most `maxChars`, preferring the last sentence end past halfway,
 * then the last word boundary. Never returns an empty string for real text.
 */
export function clampForSpeech(text, maxChars = TEXT_RULES.maxChars) {
  const value = String(text ?? '').trim();
  if (value.length <= maxChars) return value;
  const head = value.slice(0, maxChars);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd >= maxChars / 2) return head.slice(0, sentenceEnd + 1);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return `${cut.replace(/[\s,;:\-–—]+$/, '')}.`;
}

/**
 * Turn a dialogue or bubble line into text an engine can read: no speaker
 * prefix, emoji, reward footer, countdown, or odd punctuation, clamped in
 * length. Returns '' when nothing speakable is left (an emote, "…").
 *
 * @param {string} text
 * @param {{ speakerName?: string|null, rules?: object }} [options]
 */
export function cleanForSpeech(text, { speakerName = null, rules = TEXT_RULES } = {}) {
  const raw = String(text ?? '');
  if (!hasSpeakableText(raw.replace(EMOJI, ''))) return '';

  const lines = dropLines(raw, rules.dropLinePrefixes || []);
  const replaced = applyReplacements(lines, rules.replacements);
  let spoken = tidy(stripSpeakerPrefix(replaced.trim(), speakerName));
  // A line that is only a name ("Sage:") still deserves to be read.
  if (!hasSpeakableText(spoken)) spoken = tidy(replaced);
  if (!hasSpeakableText(spoken)) return '';
  return clampForSpeech(spoken, rules.maxChars);
}

/**
 * Split cleaned text into sentences for sentence-by-sentence generation.
 * Fragments shorter than `minChars` ride along with the next sentence so a
 * lone "Yay!" doesn't become its own clip.
 */
export function splitSentences(text, { minChars = TEXT_RULES.minSentenceChars } = {}) {
  const parts = String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(part => hasSpeakableText(part));
  const sentences = [];
  let carry = '';
  for (const part of parts) {
    const joined = carry ? `${carry} ${part}` : part;
    if (joined.length < minChars) {
      carry = joined;
      continue;
    }
    sentences.push(joined);
    carry = '';
  }
  if (carry) {
    if (sentences.length) sentences[sentences.length - 1] += ` ${carry}`;
    else sentences.push(carry);
  }
  return sentences;
}
