import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceController, canSpeakAs } from '../src/tts/controller.js';
import { DialogueManager } from '../src/dialogue.js';
import { bridgeBehaviorEvents } from '../src/behavior/actions/social.js';
import dialogues from '../data/dialogues.json' with { type: 'json' };

const NOTICES = dialogues.voicesMenu.notices;
const flush = () => new Promise(resolve => setImmediate(resolve));
const NPC = { id: 'npc-1', name: 'Sage' };
const VOICE = { id: 'af_heart', engineVoice: 'af_heart', lang: 'en-US', gender: 'female', pitch: 1, rate: 1, variant: 0 };

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

/** Self-playing like Web Speech: each line ends when the test calls `endLine()`. */
function fakeWebSpeech({ supported = true } = {}) {
  const engine = {
    id: 'webspeech',
    selfPlaying: true,
    state: 'idle',
    loads: 0,
    spoken: [],
    unlocks: [],
    gates: [],
    stops: 0,
    volume: null,
    status: () => engine.state,
    async load() {
      engine.loads += 1;
      engine.state = supported ? 'ready' : 'unsupported';
    },
    synth(text, voice) {
      engine.spoken.push({ text, voice });
      const gate = deferred();
      engine.gates.push(gate);
      return gate.promise.then(() => null);
    },
    endLine() {
      engine.gates.shift()?.resolve();
    },
    stop() {
      engine.stops += 1;
      for (const gate of engine.gates.splice(0)) gate.resolve();
    },
    setVolume(value) { engine.volume = value; },
    unlock(text, volume) { engine.unlocks.push({ text, volume }); }
  };
  return engine;
}

/** Kokoro-like: `finish(outcome)` settles the download. */
function fakeKokoro() {
  const engine = {
    id: 'kokoro',
    state: 'idle',
    loads: 0,
    calls: [],
    gate: null,
    status: () => engine.state,
    load(onProgress) {
      engine.loads += 1;
      engine.state = 'loading';
      engine.gate = deferred();
      onProgress?.(0.3);
      return engine.gate.promise;
    },
    finish(outcome) {
      engine.state = outcome;
      engine.gate.resolve();
    },
    synth(text) {
      engine.calls.push(text);
      return Promise.resolve({ text });
    },
    stop() {}
  };
  return engine;
}

function fakePlayer() {
  return {
    played: [],
    unlocks: 0,
    volume: null,
    play(audio) {
      this.played.push(audio.text);
      return { done: Promise.resolve(), stop() {} };
    },
    unlock() { this.unlocks += 1; },
    setVolume(value) { this.volume = value; }
  };
}

function setup({ settings = null, webspeech = fakeWebSpeech(), kokoro = fakeKokoro(), rules } = {}) {
  const saved = [];
  const notices = [];
  const player = fakePlayer();
  const actors = new Map([[NPC.id, NPC]]);
  const controller = createVoiceController({
    engines: { webspeech, kokoro },
    player,
    ...(rules ? { rules } : {}),
    settings,
    save: value => saved.push({ ...value }),
    voiceFor: () => VOICE,
    resolveActor: id => actors.get(id) || null,
    distanceTiles: () => 2,
    notices: NOTICES,
    onNotice: (text, key) => notices.push(key)
  });
  return { controller, webspeech, kokoro, player, saved, notices };
}

test('canSpeakAs: neighbours only', () => {
  assert.ok(canSpeakAs(NPC));
  assert.ok(!canSpeakAs({ id: 'player', name: 'Me' }));
  assert.ok(!canSpeakAs({ id: 'p2', isPlayer: true }));
  assert.ok(!canSpeakAs({ id: 'comp-1', isCompanion: true }));
  assert.ok(!canSpeakAs({ name: 'Game' }), 'placeholders without an id stay silent');
  assert.ok(!canSpeakAs(null));
});

test('voices start off: nothing loads and nothing speaks', async () => {
  const { controller, webspeech, kokoro } = setup();
  controller.start();
  await flush();
  assert.equal(controller.state().mode, 'off');
  assert.equal(webspeech.loads + kokoro.loads, 0);
  assert.equal(controller.speakBeat(NPC, 'Hi there!', 'stranger'), null);
});

test('basic: the click unlocks speech, then neighbours speak and others do not', async () => {
  const { controller, webspeech, saved } = setup();
  controller.setMode('basic');
  assert.deepEqual(webspeech.unlocks, [{ text: NOTICES.unlock, volume: 0.8 }], 'unlock happens inside the click');
  assert.equal(saved.at(-1).voices, 'basic');
  await flush();
  assert.equal(controller.state().engine, 'webspeech');

  assert.equal(controller.speakBeat(NPC, "Sage: Hi! I'm Sage, nice to meet you.", 'stranger').status, 'playing');
  await flush();
  assert.equal(webspeech.spoken[0].voice, VOICE);
  assert.equal(webspeech.spoken[0].text, "Hi! I'm Sage, nice to meet you.");
  assert.equal(controller.speakBeat({ id: 'player', name: 'Me' }, 'Leaving already?', 'fetch.abandonPrompt'), null);
  assert.equal(controller.speakBeat({ id: 'c', isCompanion: true, name: 'Pip' }, 'Pip the dog', 'companion'), null);
  assert.equal(controller.speakBeat({ name: 'Your friend' }, 'Nice round!', 'fetch.complete'), null);
  assert.equal(controller.speakBeat(NPC, 'What would you like to do?', null).reason, 'key', 'menus stay silent');

  controller.cancel();
  assert.ok(webspeech.stops >= 1, 'closing the dialogue stops speech');
});

test('hd: basic voices speak while it downloads, and the swap waits for the line to end', async () => {
  const { controller, webspeech, kokoro, player, notices } = setup();
  controller.setMode('hd');
  assert.equal(player.unlocks, 1, 'the AudioContext resumes inside the click');
  assert.equal(kokoro.loads, 1);
  assert.deepEqual([controller.state().kokoro, controller.state().progress], ['loading', 0.3]);
  await flush();
  assert.equal(controller.state().engine, 'webspeech');

  controller.speakBeat(NPC, 'Want to be friends? I like the pond.', 'stranger');
  kokoro.finish('ready');
  await flush();
  assert.deepEqual(notices, ['hdReady']);
  assert.equal(controller.state().engine, 'webspeech', 'no swap mid-line');
  assert.equal(webspeech.stops, 0, 'the basic line was not cut off');

  // Two sentences: the first ending is not enough.
  webspeech.endLine();
  await flush();
  assert.equal(controller.state().engine, 'webspeech');
  webspeech.endLine();
  await flush();
  assert.equal(controller.state().engine, 'kokoro');
  controller.speakBeat(NPC, 'Yay, we are friends now!', 'accepted');
  await flush();
  assert.deepEqual(kokoro.calls, ['Yay, we are friends now!']);
  assert.deepEqual(player.played, ['Yay, we are friends now!']);
});

test('hd on a device without WebGPU + shader-f16 falls back to basic and stores it', async () => {
  const { controller, kokoro, saved, notices } = setup();
  controller.setMode('hd');
  kokoro.finish('unsupported');
  await flush();
  assert.deepEqual(notices, ['hdUnsupported']);
  assert.equal(controller.settings().voices, 'basic');
  assert.equal(saved.at(-1).voices, 'basic');
  assert.equal(controller.state().engine, 'webspeech');

  // Picking hd again on this device goes straight back to basic, without a download.
  controller.setMode('hd');
  assert.equal(kokoro.loads, 1);
  assert.equal(controller.settings().voices, 'basic');
});

test('a failed hd download keeps hd stored, speaks basic, and retries next time', async () => {
  const { controller, kokoro, notices } = setup();
  controller.setMode('hd');
  kokoro.finish('error');
  await flush();
  assert.deepEqual(notices, ['hdFailed']);
  assert.equal(controller.settings().voices, 'hd');
  assert.equal(controller.state().engine, 'webspeech');
  controller.setMode('hd');
  assert.equal(kokoro.loads, 2);
});

test('a stored hd mode loads on start; mute and unmute keep the mode', async () => {
  const { controller, kokoro, webspeech } = setup({ settings: { voices: 'hd', volume: 0.5 } });
  controller.start();
  assert.equal(kokoro.loads, 1);
  assert.equal(webspeech.volume, 0.5);
  assert.equal(webspeech.unlocks.length, 0, 'no speech without a gesture');
  kokoro.finish('ready');
  await flush();
  assert.equal(controller.state().engine, 'kokoro');

  assert.equal(controller.toggleMute().mode, 'off');
  assert.equal(controller.state().engine, null);
  assert.equal(controller.speakBeat(NPC, 'Hello again!', 'friend'), null);
  assert.equal(controller.toggleMute().mode, 'hd');
  assert.equal(controller.state().engine, 'kokoro');
});

test('volume steps reach both engines and the audio output', () => {
  const { controller, webspeech, player, saved } = setup({ settings: { voices: 'basic', volume: 0.8 } });
  assert.equal(controller.cycleVolume().volume, 1);
  assert.equal(webspeech.volume, 1);
  assert.equal(player.volume, 1);
  assert.equal(saved.at(-1).volume, 1);
});

test('bubble speech stays off: no setting toggle, and data/voices.json keeps bubbles disabled', async () => {
  const { controller } = setup({ settings: { voices: 'basic' } });
  controller.start();
  await flush();
  assert.equal(controller.speakSay({ actorId: NPC.id, key: 'greet', text: 'hi there!' }), null);

  const on = setup({ settings: { voices: 'basic', bubbles: true } });
  on.controller.start();
  await flush();
  const result = on.controller.speakSay({ actorId: NPC.id, key: 'greet', text: 'hi there!' });
  assert.deepEqual([result.status, result.reason], ['dropped', 'bubbles-off']);
  assert.equal(on.controller.speakSay({ actorId: 'player', key: 'greet', text: 'hi' }), null);
});

function installFakeDom() {
  const element = () => ({
    hidden: true,
    textContent: '',
    style: {},
    children: [],
    offsetWidth: 0,
    offsetHeight: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...nodes) { this.children = nodes; },
    append(node) { this.children.push(node); node.parentElement = this; },
    querySelector() { return this.children[0] || null; },
    querySelectorAll() { return this.children; },
    addEventListener(type, fn) { this.onclick = fn; },
    focus() {},
    click() { this.onclick?.(); }
  });
  const elements = Object.fromEntries(['dialogue', 'dialogue-name', 'dialogue-text', 'dialogue-choices'].map(id => [id, element()]));
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = {
    getElementById: id => elements[id] || null,
    createElement: () => element(),
    body: { classList: { add() {}, remove() {} } },
    activeElement: null
  };
  globalThis.window = { requestAnimationFrame: () => 0, addEventListener() {}, innerWidth: 1000, innerHeight: 800 };
  return () => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
  };
}

test('every dialogue beat reaches onBeat with its key', () => {
  const restore = installFakeDom();
  try {
    const beats = [];
    let ended = 0;
    const manager = new DialogueManager({
      onBeat: (npc, text, key) => beats.push({ id: npc?.id, key, text }),
      onDialogueEnd: () => { ended += 1; },
      onFriendshipChange: () => {}
    });
    manager.open(NPC, false);
    manager.acceptFriendship();
    manager.open(NPC, false);
    manager.declineFriendship();
    manager.open(NPC, true);
    manager.open({ id: 'comp-1', name: 'Pip', isCompanion: true, recipe: { style: 'dog' } }, false);
    manager.openCustomBeat(NPC, 'Great game!', [], { key: 'ttt.win' });
    manager.openCustomBeat({ id: 'player', name: 'Me' }, 'What would you like to do?', []);
    manager.setText('countdown (3)');
    assert.deepEqual(beats.map(beat => beat.key),
      ['stranger', 'accepted', 'stranger', 'declined', 'friend', 'companion', 'ttt.win', null]);
    assert.equal(beats[0].id, NPC.id);
    assert.match(beats[0].text, /Sage/);
    manager.close();
    assert.equal(ended, 1, 'close still ends the dialogue (main.js cancels speech there)');
  } finally {
    restore();
  }
});

test('bridgeBehaviorEvents hands every say event to onSay, rendered or not', () => {
  const said = [];
  const runtime = { onEvent: null };
  bridgeBehaviorEvents(runtime, null, { onSay: detail => said.push(detail) });
  runtime.onEvent({ type: 'say', detail: { actorId: 'npc-a', key: 'greet', text: 'hi!', bubble: false } });
  runtime.onEvent({ type: 'say', detail: { actorId: 'npc-a', key: 'wave', text: '👋', bubble: false, visualOnly: true } });
  runtime.onEvent({ type: 'say', detail: { actorId: null, text: 'nobody' } });
  runtime.onEvent({ type: 'emote', detail: { actorId: 'npc-a', emote: 'wave' } });
  assert.deepEqual(said.map(detail => [detail.key, Boolean(detail.visualOnly)]), [['greet', false], ['wave', true]]);
});
