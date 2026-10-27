import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_KEY, DEFAULT_SETTINGS, parseSettings, loadSettings, saveSettings, withMode, toggleMute, nextVolume
} from '../src/tts/settings.js';
import { chooseEngine, voicesStatus, describePill, voicesMenu } from '../src/tts/select.js';
import dialogues from '../data/dialogues.json' with { type: 'json' };

const COPY = dialogues.voicesMenu;

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value))
  };
}

test('settings default to voices off and live under their own key', () => {
  assert.equal(SETTINGS_KEY, 'playpark.settings.v1');
  assert.notEqual(SETTINGS_KEY, 'playpark.save.v1');
  assert.deepEqual(parseSettings(null), { voices: 'off', volume: 0.8, bubbles: false, lastOn: 'basic' });
  assert.deepEqual(parseSettings(null), { ...DEFAULT_SETTINGS });
});

test('parseSettings repairs broken or partial values', () => {
  assert.deepEqual(parseSettings('{not json'), parseSettings(null));
  assert.deepEqual(parseSettings('[1,2]'), parseSettings(null));
  assert.equal(parseSettings({ voices: 'loud' }).voices, 'off');
  assert.equal(parseSettings({ volume: 7 }).volume, 1);
  assert.equal(parseSettings({ volume: -1 }).volume, 0);
  assert.equal(parseSettings({ volume: 'x' }).volume, 0.8);
  assert.equal(parseSettings({ volume: null }).volume, 0.8);
  assert.equal(parseSettings({ bubbles: 'yes' }).bubbles, false);
  assert.equal(parseSettings({ voices: 'hd' }).lastOn, 'hd', 'a stored mode doubles as the mode to unmute to');
  assert.equal(parseSettings(JSON.stringify({ voices: 'basic', volume: 0.5 })).volume, 0.5);
});

test('load and save survive missing or throwing storage', () => {
  const storage = memoryStorage();
  assert.ok(saveSettings({ voices: 'hd', volume: 0.5 }, storage));
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { voices: 'hd', volume: 0.5, bubbles: false, lastOn: 'hd' });
  assert.equal(loadSettings(storage).voices, 'hd');

  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.equal(loadSettings(broken).voices, 'off');
  assert.equal(saveSettings({ voices: 'basic' }, broken), false);
  assert.equal(saveSettings({ voices: 'basic' }, null), false);
});

test('mute toggles between off and the last spoken mode', () => {
  let settings = withMode(parseSettings(null), 'hd');
  assert.equal(settings.voices, 'hd');
  settings = toggleMute(settings);
  assert.deepEqual([settings.voices, settings.lastOn], ['off', 'hd']);
  settings = toggleMute(settings);
  assert.equal(settings.voices, 'hd');
  assert.equal(toggleMute(parseSettings(null)).voices, 'basic', 'first unmute is basic');
  assert.equal(withMode(settings, 'nope').voices, 'hd', 'unknown modes are ignored');
});

test('volume cycles through the steps and wraps', () => {
  assert.equal(nextVolume(0.25), 0.5);
  assert.equal(nextVolume(0.5), 0.8);
  assert.equal(nextVolume(0.8), 1);
  assert.equal(nextVolume(1), 0.25);
  assert.equal(nextVolume(0.6), 0.8, 'between steps moves up');
});

test('chooseEngine: hd uses Kokoro once ready, basic voices until then', () => {
  assert.equal(chooseEngine('off', { kokoro: 'ready', webspeech: 'ready' }), null);
  assert.equal(chooseEngine('basic', { kokoro: 'ready', webspeech: 'ready' }), 'webspeech');
  assert.equal(chooseEngine('basic', { webspeech: 'unsupported' }), null);
  assert.equal(chooseEngine('hd', { kokoro: 'ready', webspeech: 'unsupported' }), 'kokoro');
  assert.equal(chooseEngine('hd', { kokoro: 'loading', webspeech: 'ready' }), 'webspeech');
  assert.equal(chooseEngine('hd', { kokoro: 'unsupported', webspeech: 'ready' }), 'webspeech');
  assert.equal(chooseEngine('hd', { kokoro: 'loading', webspeech: 'loading' }), null);
});

test('voices status, pill, and menu text', () => {
  assert.equal(voicesStatus({ mode: 'off', engine: null }).status, 'off');
  assert.deepEqual(voicesStatus({ mode: 'hd', kokoro: 'loading', engine: 'webspeech', progress: 0.426 }), { status: 'loading', percent: 42 });
  assert.equal(voicesStatus({ mode: 'hd', kokoro: 'ready', engine: 'kokoro' }).status, 'hd');
  assert.equal(voicesStatus({ mode: 'basic', engine: 'webspeech' }).status, 'basic');
  assert.equal(voicesStatus({ mode: 'basic', webspeech: 'unsupported' }).status, 'none');
  assert.equal(voicesStatus({ mode: 'basic', webspeech: 'loading' }).status, 'starting');

  const loading = describePill({ mode: 'hd', kokoro: 'loading', engine: 'webspeech', progress: 0.5 }, COPY);
  assert.deepEqual([loading.icon, loading.label, loading.loading], ['🔊', 'hd 50%', true]);
  assert.equal(describePill({ mode: 'off' }, COPY).icon, '🔇');

  const menu = voicesMenu({ mode: 'hd', kokoro: 'ready', engine: 'kokoro', volume: 0.8 }, COPY);
  assert.equal(menu.text, 'voices: hd voices');
  assert.deepEqual(menu.items.map(item => item.id), ['off', 'basic', 'hd', 'volume', 'back']);
  assert.equal(menu.items.find(item => item.id === 'hd').className, 'primary', 'current mode is marked');
  assert.equal(menu.items.find(item => item.id === 'volume').label, 'volume 80%');
  assert.match(menu.items.find(item => item.id === 'hd').label, /~190 MB, one-time/);
  for (const item of menu.items) {
    const words = item.label.replace(' MB', ' mb');
    assert.equal(words, words.toLowerCase(), `${item.id} copy is lower-case`);
  }
});
