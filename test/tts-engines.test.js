import test from 'node:test';
import assert from 'node:assert/strict';
import {
  englishLocalVoices, guessGender, pickLocalVoice, createWebSpeechEngine
} from '../src/tts/engines/webspeech.js';
import {
  pitchToCents, HD_LOAD, createProgressTracker, createKokoroEngine, createAudioOutput
} from '../src/tts/engines/kokoro.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

const local = (name, lang = 'en-US') => ({ name, lang, voiceURI: name, localService: true });
const VOICES = [
  local('Samantha'),
  local('Daniel', 'en-GB'),
  local('Karen', 'en-AU'),
  local('Fred'),
  local('Bubbles'),
  local('Thomas', 'fr-FR'),
  { name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'g', localService: false }
];

test('basic voices keep only on-device English voices', () => {
  const names = englishLocalVoices(VOICES).map(voice => voice.name);
  assert.deepEqual(names, ['Samantha', 'Daniel', 'Karen', 'Fred']);
  assert.equal(englishLocalVoices([local('Moira', 'en_IE')]).length, 1, 'Android-style en_IE counts');
});

test('guessGender reads whole words from voice names', () => {
  assert.equal(guessGender('Microsoft Zira - English (United States)'), 'female');
  assert.equal(guessGender('Daniel (Enhanced)'), 'male');
  assert.equal(guessGender('English United States Female'), 'female', '"female" is not read as "male"');
  assert.equal(guessGender('Aloysius'), null);
});

test('pickLocalVoice prefers language, then gender, and is stable', () => {
  const voices = englishLocalVoices(VOICES);
  assert.equal(pickLocalVoice({ id: 'bm_george', lang: 'en-GB', gender: 'male' }, voices).name, 'Daniel');
  const usFemale = pickLocalVoice({ id: 'af_heart', lang: 'en-US', gender: 'female' }, voices);
  assert.equal(usFemale.name, 'Samantha');
  assert.equal(pickLocalVoice({ id: 'am_adam', lang: 'en-US', gender: 'male' }, voices).name, 'Fred');
  // British female: no en-GB female, so it stays in en-GB rather than switching accent.
  assert.equal(pickLocalVoice({ id: 'bf_emma', lang: 'en-GB', gender: 'female' }, voices).name, 'Daniel');
  const again = pickLocalVoice({ id: 'af_nova', lang: 'en-US', gender: 'other' }, voices);
  assert.equal(pickLocalVoice({ id: 'af_nova', lang: 'en-US', gender: 'other' }, [...voices].reverse()), again);
  assert.equal(pickLocalVoice({ id: 'x' }, []), null);
});

function fakeSynth(voices = VOICES, { lateVoices = false } = {}) {
  const listeners = new Map();
  const synth = {
    spoken: [],
    cancels: 0,
    list: lateVoices ? [] : voices,
    getVoices: () => synth.list,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type) { for (const fn of [...(listeners.get(type) || [])]) fn(); },
    speak(utterance) { synth.spoken.push(utterance); },
    cancel() {
      synth.cancels += 1;
      for (const utterance of synth.spoken) utterance.onerror?.({ error: 'interrupted' });
    }
  };
  return synth;
}

class FakeUtterance {
  constructor(text) { this.text = text; }
}

test('Web Speech engine loads late voice lists and speaks with pitch, rate, and volume', async () => {
  const synth = fakeSynth(VOICES, { lateVoices: true });
  const engine = createWebSpeechEngine({ synth, Utterance: FakeUtterance, setTimer: () => 0, clearTimer: () => {} });
  assert.equal(engine.selfPlaying, true);
  const loading = engine.load();
  assert.equal(engine.status(), 'loading');
  synth.list = VOICES;
  synth.fire('voiceschanged');
  await loading;
  assert.equal(engine.status(), 'ready');

  engine.setVolume(0.5);
  const line = engine.synth('hello there', { id: 'bm_george', lang: 'en-GB', gender: 'male', pitch: 1.1, rate: 0.9 });
  const utterance = synth.spoken.at(-1);
  assert.deepEqual([utterance.text, utterance.voice.name, utterance.pitch, utterance.rate, utterance.volume],
    ['hello there', 'Daniel', 1.1, 0.9, 0.5]);
  utterance.onend();
  assert.equal(await line, null, 'resolves null: the engine played it itself');

  engine.synth('cut me off', { id: 'af_heart', lang: 'en-US', gender: 'female' });
  engine.stop();
  assert.equal(synth.cancels, 1);

  assert.ok(engine.unlock('voices on.'));
  assert.equal(synth.spoken.at(-1).text, 'voices on.');
  engine.unlock('');
  assert.equal(synth.spoken.at(-1).volume, 0, 'a silent unlock is silent');
});

test('Web Speech engine is unsupported without on-device English voices', async () => {
  const engine = createWebSpeechEngine({ synth: fakeSynth([VOICES[6]]), Utterance: FakeUtterance, setTimer: fn => { fn(); return 0; }, clearTimer: () => {} });
  await engine.load();
  assert.equal(engine.status(), 'unsupported');
  assert.equal(createWebSpeechEngine({ synth: null, Utterance: null }).status(), 'unsupported');
});

test('pitch maps to detune cents; hd asks for q8 on WASM', () => {
  assert.equal(pitchToCents(1), 0);
  assert.equal(pitchToCents(2), 1200);
  assert.equal(pitchToCents(0.5), -1200);
  assert.equal(pitchToCents(0), 0);
  assert.deepEqual({ ...HD_LOAD }, { type: 'load', device: 'wasm', model: 'q8' });
});

test('download progress is weighted by size and stays under 100% until loaded', () => {
  const tracker = createProgressTracker();
  tracker.update({ status: 'initiate', file: 'config.json' });
  assert.equal(tracker.update({ status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 50, total: 100 }), 0.5);
  assert.equal(tracker.update({ status: 'progress', file: 'tokenizer.json', loaded: 0, total: 100 }), 0.25);
  tracker.update({ status: 'done', file: 'tokenizer.json' });
  assert.equal(tracker.update({ status: 'done', file: 'onnx/model_quantized.onnx' }), 0.99);
});

function fakeWorker({ failLoad = false, crash = false } = {}) {
  const listeners = { message: [], error: [] };
  const worker = {
    posted: [],
    terminated: false,
    addEventListener(type, fn) { listeners[type].push(fn); },
    crash() { for (const fn of listeners.error) fn({ message: 'module workers not supported' }); },
    send(data) { for (const fn of listeners.message) fn({ data }); },
    terminate() { worker.terminated = true; },
    postMessage(message) {
      worker.posted.push(message);
      queueMicrotask(() => {
        if (crash) return worker.crash();
        if (message.type === 'load') {
          worker.send({ type: 'progress', status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 5, total: 10 });
          if (failLoad) worker.send({ type: 'error', id: null, during: 'load', message: 'no adapter' });
          else worker.send({ type: 'loaded', device: 'wasm', model: 'q8' });
        }
        if (message.type === 'generate') {
          worker.send({ type: 'audio', id: message.id, pcm: new Float32Array([0.1, 0.2]), sampleRate: 24000 });
        }
      });
    }
  };
  return worker;
}

function fakeContext() {
  const context = {
    state: 'running',
    destination: { name: 'out' },
    sources: [],
    gains: [],
    createBuffer: (channels, length, sampleRate) => ({ channels, length, sampleRate, copyToChannel(data) { this.data = data; } }),
    createBufferSource() {
      const source = {
        detune: { value: 0 },
        playbackRate: { value: 1 },
        connect: node => node,
        disconnect() {},
        start() { source.started = true; },
        stop() { source.stopped = true; source.onended?.(); }
      };
      context.sources.push(source);
      return source;
    },
    createGain() {
      const gain = { gain: { value: 1 }, connect: node => node };
      context.gains.push(gain);
      return gain;
    },
    resume() { context.state = 'running'; return Promise.resolve(); }
  };
  return context;
}

test('Kokoro engine loads q8 on WASM explicitly, with no WebGPU probe', async () => {
  const worker = fakeWorker();
  const output = { context: () => fakeContext() };
  const progress = [];
  const engine = createKokoroEngine({ createWorker: () => worker, output });
  await engine.load(value => progress.push(value));
  assert.equal(engine.status(), 'ready');
  assert.deepEqual(worker.posted, [{ type: 'load', device: 'wasm', model: 'q8' }]);
  assert.deepEqual(progress, [0.5, 1]);

  const buffer = await engine.synth('hello', { engineVoice: 'af_heart', rate: 1.06, pitch: 0.92 });
  const generate = worker.posted.at(-1);
  assert.deepEqual([generate.type, generate.voice, generate.speed], ['generate', 'af_heart', 1.06], 'rate goes in as speed');
  assert.equal(generate.pitch, undefined, 'pitch stays out of the model');
  assert.deepEqual([buffer.length, buffer.sampleRate, buffer.data[1]], [2, 24000, Float32Array.from([0.2])[0]]);
});

test('Kokoro engine is unsupported only without WebAssembly or a working worker', async () => {
  const worker = fakeWorker({ crash: true });
  const engine = createKokoroEngine({ createWorker: () => worker });
  await engine.load();
  assert.equal(engine.status(), 'unsupported');
  assert.ok(worker.terminated);
  await assert.rejects(engine.synth('hi', { engineVoice: 'af_heart' }));

  const noWorkers = createKokoroEngine({ createWorker: null });
  await noWorkers.load();
  assert.equal(noWorkers.status(), 'unsupported');

  let made = 0;
  const noWasm = createKokoroEngine({ createWorker: () => { made += 1; return fakeWorker(); }, hasWasm: false });
  await noWasm.load();
  assert.deepEqual([noWasm.status(), made], ['unsupported', 0]);

  const throwing = createKokoroEngine({ createWorker: () => { throw new Error('no module workers'); } });
  await throwing.load();
  assert.equal(throwing.status(), 'unsupported');
});

test('Kokoro engine load failures settle as error and can be retried', async () => {
  let attempt = 0;
  const engine = createKokoroEngine({ createWorker: () => fakeWorker({ failLoad: attempt++ === 0 }) });
  await engine.load();
  assert.equal(engine.status(), 'error');
  assert.match(engine.info().error, /no adapter/);
  await engine.load();
  assert.equal(engine.status(), 'ready');
});

test('audio output applies pitch as detune, never rate, and scales by master volume', async () => {
  const context = fakeContext();
  const output = createAudioOutput({ createContext: () => context });
  output.setVolume(0.5);
  const clip = output.play({ length: 2 }, { volume: 0.6, pitch: 2, rate: 1.5 });
  const source = context.sources[0];
  assert.equal(source.detune.value, 1200);
  assert.equal(source.playbackRate.value, 1, 'rate is already in the audio');
  assert.equal(context.gains[0].gain.value, 0.3);
  assert.ok(source.started);
  clip.stop();
  await clip.done;
  assert.ok(source.stopped);

  context.state = 'suspended';
  assert.ok(output.unlock());
  await flush();
  assert.equal(context.state, 'running');
  assert.ok(createAudioOutput({ createContext: () => null }).play({}, {}).done instanceof Promise);
});
