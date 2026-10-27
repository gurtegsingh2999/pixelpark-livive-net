import { createSpeaker, SPEAK_RULES } from './speaker.js';
import { parseSettings, withMode, toggleMute as muteSettings, nextVolume } from './settings.js';
import { chooseEngine } from './select.js';

/** Only neighbours talk: never the player, companions, or a placeholder with no id. */
export function canSpeakAs(character) {
  if (!character || character.id == null) return false;
  if (character.isPlayer === true || character.id === 'player') return false;
  return !character.isCompanion;
}

/**
 * Glue between the voice settings, the two engines, and the speaker. No DOM:
 * engines, the Kokoro audio output, storage, and copy are injected, so the
 * whole flow runs in Node with fakes.
 *
 * Engines: `{ id, status(), load(onProgress?), synth(), stop(), setVolume?(v), unlock?(text, volume) }`.
 * Kokoro's `load` must settle (never reject) and leave its status at
 * 'ready', 'unsupported', or 'error'.
 *
 * @param {object} deps
 * @param {{ webspeech?: object|null, kokoro?: object|null }} deps.engines
 * @param {object|null} [deps.player] Kokoro audio output `{ play, setVolume?, unlock? }`
 * @param {object} [deps.rules] data/voices.json `speak`
 * @param {object|string|null} [deps.settings] stored settings
 * @param {(settings:object) => void} [deps.save]
 * @param {(character:object) => object|null} [deps.voiceFor] resolved voice for a character
 * @param {(id:string) => object|null} [deps.resolveActor]
 * @param {(actor:object) => number|null} [deps.distanceTiles] distance from the player
 * @param {object} [deps.notices] data/dialogues.json `voicesMenu.notices`
 * @param {(text:string, key:string) => void} [deps.onNotice]
 * @param {(state:object) => void} [deps.onChange]
 * @param {(fn:Function) => void} [deps.defer]
 */
export function createVoiceController({
  engines = {},
  player = null,
  rules = SPEAK_RULES,
  settings = null,
  save = null,
  voiceFor = () => null,
  resolveActor = () => null,
  distanceTiles = () => null,
  notices = {},
  onNotice = null,
  onChange = null,
  defer = fn => { Promise.resolve().then(fn); }
} = {}) {
  let current = parseSettings(settings);
  let engineId = null;
  let progress = null;
  let swapQueued = false;
  let unlocked = false;

  const speaker = createSpeaker({ engine: null, player, rules, onEnd: () => queueApply() });
  const statusOf = name => engines[name]?.status?.() ?? 'unsupported';

  function state() {
    return {
      mode: current.voices,
      engine: engineId,
      kokoro: statusOf('kokoro'),
      webspeech: statusOf('webspeech'),
      progress,
      volume: current.volume,
      bubbles: current.bubbles
    };
  }

  const changed = () => onChange?.(state());
  const notice = key => { if (notices[key]) onNotice?.(notices[key], key); };

  function persist(next) {
    current = next;
    save?.(current);
  }

  function applyVolume() {
    engines.webspeech?.setVolume?.(current.volume);
    engines.kokoro?.setVolume?.(current.volume);
    player?.setVolume?.(current.volume);
  }

  // Point the speaker at the engine the mode wants. Without `force`, a line
  // that is playing finishes first and the swap happens when it ends.
  function apply({ force = false } = {}) {
    const target = chooseEngine(current.voices, { kokoro: statusOf('kokoro'), webspeech: statusOf('webspeech') });
    if (target === engineId) return;
    if (!force && target && engineId && speaker.state().current) return;
    engineId = target;
    speaker.setEngine(target ? engines[target] : null);
    changed();
  }

  function queueApply() {
    if (swapQueued) return;
    swapQueued = true;
    defer(() => {
      swapQueued = false;
      apply();
    });
  }

  function downgradeFromHd(key) {
    if (current.voices !== 'hd') return;
    persist(withMode(current, 'basic'));
    notice(key);
  }

  function loadKokoro() {
    const hd = engines.kokoro;
    progress = 0;
    const loading = hd.load(value => {
      progress = value;
      changed();
    });
    changed();
    Promise.resolve(loading).catch(() => {}).then(() => {
      progress = null;
      const status = statusOf('kokoro');
      if (status === 'ready') {
        if (current.voices === 'hd') notice('hdReady');
      } else if (status === 'unsupported') {
        downgradeFromHd('hdUnsupported');
      } else if (current.voices === 'hd') {
        // A failed download may work next time; keep hd stored, speak basic for now.
        notice('hdFailed');
      }
      apply();
      changed();
    });
  }

  // Start whatever the mode needs. Web Speech is cheap and covers hd while it loads.
  function ensure() {
    if (current.voices === 'off') return;
    const web = engines.webspeech;
    if (web && statusOf('webspeech') === 'idle') {
      Promise.resolve(web.load()).catch(() => {}).then(() => {
        if (statusOf('webspeech') === 'unsupported' && current.voices === 'basic') notice('basicUnsupported');
        apply();
        changed();
      });
    }
    if (current.voices !== 'hd') return;
    const status = statusOf('kokoro');
    if (status === 'unsupported') downgradeFromHd('hdUnsupported');
    else if (status === 'idle' || status === 'error') loadKokoro();
  }

  /**
   * Call from inside a click or key handler. Safari only lets speech and Web
   * Audio start from a user gesture, so this speaks a short line (or a silent
   * one) and resumes the AudioContext synchronously.
   */
  function unlock(text = '', { volume = current.volume } = {}) {
    if (current.voices === 'off') return false;
    engines.webspeech?.unlock?.(text, volume);
    if (current.voices === 'hd') player?.unlock?.();
    unlocked = true;
    return true;
  }

  function setMode(mode) {
    persist(withMode(current, mode));
    if (current.voices === 'off') speaker.cancel();
    else unlock(notices.unlock || '');
    ensure();
    apply({ force: true });
    changed();
    return state();
  }

  function toggleMute() {
    return setMode(muteSettings(current).voices);
  }

  function cycleVolume() {
    persist({ ...current, volume: nextVolume(current.volume) });
    applyVolume();
    changed();
    return state();
  }

  /** A dialogue beat opened. `key` decides whether it is spoken (data/voices.json). */
  function speakBeat(character, text, key) {
    if (!engineId || !canSpeakAs(character)) return null;
    return speaker.speak({
      kind: 'dialogue',
      actorId: character.id,
      text,
      key,
      voice: voiceFor(character),
      speakerName: character.name
    });
  }

  /** A behaviour `say` event. Off unless both the setting and data/voices.json allow bubbles. */
  function speakSay({ actorId, key = null, text, visualOnly = false } = {}) {
    if (!current.bubbles || !engineId) return null;
    const actor = resolveActor(actorId);
    if (!canSpeakAs(actor)) return null;
    return speaker.speak({
      kind: 'bubble',
      actorId: actor.id,
      text,
      key: key ? `social.${key}` : null,
      voice: voiceFor(actor),
      speakerName: actor.name,
      visualOnly: Boolean(visualOnly),
      distanceTiles: distanceTiles(actor)
    });
  }

  /** Bring up the stored mode on boot (hd loads from the browser cache after the first time). */
  function start() {
    applyVolume();
    ensure();
    apply({ force: true });
    changed();
  }

  return {
    start,
    state,
    settings: () => ({ ...current }),
    setMode,
    toggleMute,
    cycleVolume,
    unlock,
    isUnlocked: () => unlocked,
    speakBeat,
    speakSay,
    cancel: () => speaker.cancel(),
    speaker
  };
}
