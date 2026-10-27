import { hashString } from '../../world.js';
import voicesData from '../../../data/voices.json' with { type: 'json' };

// "basic" voices: the browser's own speechSynthesis. Only on-device voices are
// used (Chrome also lists Google network voices, which would send the text
// off-site). The game's pool is Kokoro voices, so each pool entry is mapped to
// the closest local voice by language and a guessed gender.

export const WEBSPEECH_RULES = voicesData.webspeech;

const normaliseLang = lang => String(lang || '').replace('_', '-').toLowerCase();
const words = name => String(name || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);

/** On-device English voices, minus the novelty ones (Bubbles, Zarvox, ...). */
export function englishLocalVoices(voices, rules = WEBSPEECH_RULES) {
  const exclude = rules.exclude || [];
  return (Array.isArray(voices) ? voices : []).filter(voice => voice
    && voice.localService === true
    && normaliseLang(voice.lang).startsWith('en')
    && !exclude.some(name => String(voice.name || '').toLowerCase().includes(name)));
}

/** 'female' | 'male' | null from the words in a voice name. */
export function guessGender(name, hints = WEBSPEECH_RULES.genderHints) {
  const list = words(name);
  for (const gender of ['female', 'male']) {
    if ((hints?.[gender] || []).some(hint => list.includes(hint))) return gender;
  }
  return null;
}

/**
 * Closest local voice for a resolved pool voice: same language if any, then
 * same guessed gender if any, then a stable pick by the pool id so the same
 * neighbour keeps the same local voice on this device.
 *
 * @param {{ id: string, lang?: string, gender?: string }} voice
 * @param {Array<SpeechSynthesisVoice>} voices already filtered with englishLocalVoices
 */
export function pickLocalVoice(voice, voices, hints = WEBSPEECH_RULES.genderHints) {
  if (!voice || !voices?.length) return null;
  const lang = normaliseLang(voice.lang);
  let candidates = voices.filter(entry => normaliseLang(entry.lang) === lang);
  if (!candidates.length) candidates = voices;
  const sameGender = candidates.filter(entry => guessGender(entry.name, hints) === voice.gender);
  if (sameGender.length) candidates = sameGender;
  const sorted = [...candidates].sort((a, b) => String(a.voiceURI || a.name).localeCompare(String(b.voiceURI || b.name)));
  return sorted[hashString(String(voice.id ?? voice.engineVoice ?? '')) % sorted.length];
}

/**
 * Web Speech engine for the speaker. `synth` resolves `null` once the line has
 * been spoken (selfPlaying), so the speaker never pre-generates through it.
 *
 * @param {object} [deps]
 * @param {SpeechSynthesis} [deps.synth]
 * @param {typeof SpeechSynthesisUtterance} [deps.Utterance]
 * @param {object} [deps.rules] data/voices.json `webspeech`
 * @param {(fn:Function, ms:number) => any} [deps.setTimer]
 * @param {(id:any) => void} [deps.clearTimer]
 */
export function createWebSpeechEngine({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  rules = WEBSPEECH_RULES,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id)
} = {}) {
  let status = synth && Utterance ? 'idle' : 'unsupported';
  let voices = [];
  let volume = 1;
  let loading = null;
  const picked = new Map();
  // Chrome can garbage-collect a playing utterance and never fire `end`; hold it.
  const speaking = new Set();

  function refresh() {
    voices = englishLocalVoices(synth.getVoices?.() || [], rules);
    picked.clear();
    return voices.length;
  }

  function load() {
    if (status !== 'idle') return Promise.resolve();
    status = 'loading';
    loading ??= new Promise(resolve => {
      // The voice list fills in asynchronously on most browsers.
      if (refresh()) return resolve();
      let timer = null;
      const done = () => {
        synth.removeEventListener?.('voiceschanged', done);
        clearTimer(timer);
        refresh();
        resolve();
      };
      synth.addEventListener?.('voiceschanged', done);
      timer = setTimer(done, rules.loadTimeoutMs ?? 1500);
    }).then(() => {
      status = voices.length ? 'ready' : 'unsupported';
      synth.addEventListener?.('voiceschanged', refresh);
    });
    return loading;
  }

  function localFor(voice) {
    const key = voice?.id ?? voice?.engineVoice;
    if (!picked.has(key)) picked.set(key, pickLocalVoice(voice, voices, rules.genderHints));
    return picked.get(key);
  }

  function utter(text, { voice = null, pitch = 1, rate = 1, level = volume } = {}) {
    const utterance = new Utterance(text);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = level;
    return utterance;
  }

  return {
    id: 'webspeech',
    selfPlaying: true,
    status: () => status,
    load,
    synth(text, voice) {
      if (status !== 'ready') return Promise.reject(new Error('basic voices are not ready'));
      return new Promise(resolve => {
        const utterance = utter(text, { voice: localFor(voice), pitch: voice?.pitch ?? 1, rate: voice?.rate ?? 1 });
        let timer = null;
        const finish = () => {
          clearTimer(timer);
          speaking.delete(utterance);
          resolve(null);
        };
        // Cancelled lines fire `error` ('interrupted'); either way the line is over.
        utterance.onend = finish;
        utterance.onerror = finish;
        // Some engines never fire `end`; give up a little after the line should be over.
        const rate = Math.max(0.5, voice?.rate ?? 1);
        timer = setTimer(finish, (rules.endTimeoutMs ?? 4000) + (String(text).length * (rules.msPerChar ?? 110)) / rate);
        speaking.add(utterance);
        synth.speak(utterance);
      });
    },
    stop() {
      synth?.cancel?.();
    },
    setVolume(value) {
      volume = Math.min(1, Math.max(0, Number(value) || 0));
    },
    /** Speak straight away, outside the queue. Called inside a click so Safari allows speech. */
    unlock(text = '', level = volume) {
      if (!synth || !Utterance) return false;
      synth.speak(utter(text || ' ', { level: text ? level : 0 }));
      return true;
    }
  };
}
