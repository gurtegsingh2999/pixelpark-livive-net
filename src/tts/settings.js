import voicesData from '../../data/voices.json' with { type: 'json' };

// Per-device voice settings. Kept apart from the park save on purpose: a save
// can move between devices, but whether this device talks out loud cannot.
export const SETTINGS_KEY = voicesData.settings.key;
export const VOICE_MODES = Object.freeze(['off', 'basic', 'hd']);
export const VOLUME_STEPS = Object.freeze([...voicesData.settings.volumeSteps]);
export const DEFAULT_SETTINGS = Object.freeze({ ...voicesData.settings.defaults });

const isMode = value => VOICE_MODES.includes(value);

function clampVolume(value, fallback) {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) return fallback;
  return Math.round(Math.min(1, Math.max(0, number)) * 100) / 100;
}

/**
 * Normalise stored settings. Accepts the raw JSON string, an object, or
 * nothing; unknown or broken fields fall back to the defaults.
 *
 * @returns {{ voices: 'off'|'basic'|'hd', volume: number, bubbles: boolean, lastOn: 'basic'|'hd' }}
 */
export function parseSettings(raw, defaults = DEFAULT_SETTINGS) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const voices = isMode(source.voices) ? source.voices : defaults.voices;
  const lastOn = source.lastOn === 'basic' || source.lastOn === 'hd'
    ? source.lastOn
    : (voices !== 'off' ? voices : defaults.lastOn);
  return {
    voices,
    volume: clampVolume(source.volume, defaults.volume),
    bubbles: typeof source.bubbles === 'boolean' ? source.bubbles : defaults.bubbles,
    lastOn
  };
}

/** Read settings from `storage`; private mode or a full disk just means defaults. */
export function loadSettings(storage = globalThis.localStorage) {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null);
  } catch {
    return parseSettings(null);
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(parseSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/** Switch mode, remembering the last spoken mode so mute can bring it back. */
export function withMode(settings, mode) {
  const current = parseSettings(settings);
  if (!isMode(mode)) return current;
  return { ...current, voices: mode, lastOn: mode === 'off' ? current.lastOn : mode };
}

/** `M`: off goes back to the last spoken mode, anything else goes off. */
export function toggleMute(settings) {
  const current = parseSettings(settings);
  return withMode(current, current.voices === 'off' ? current.lastOn : 'off');
}

/** Next volume step, wrapping; a volume between steps moves to the next one up. */
export function nextVolume(volume, steps = VOLUME_STEPS) {
  const value = clampVolume(volume, steps[0]);
  const next = steps.find(step => step > value + 1e-9);
  return next ?? steps[0];
}
