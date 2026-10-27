import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker, createLru, matchesKey, shouldSpeak, SPEAK_RULES } from '../src/tts/speaker.js';

const VOICE = { id: 'af_heart', engineVoice: 'af_heart', pitch: 1, rate: 1, variant: 0 };
const OTHER_VOICE = { id: 'bm_george', engineVoice: 'bm_george', pitch: 1, rate: 1, variant: 0 };

const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Engine whose generations finish only when the test says so (or instantly). */
function fakeEngine({ status = 'ready', manual = false, selfPlaying = false, fail = false } = {}) {
  const engine = {
    id: 'fake',
    selfPlaying,
    calls: [],
    pending: [],
    stops: 0,
    status: () => status,
    load: async () => {},
    synth(text, voice) {
      engine.calls.push({ text, voice: voice.engineVoice });
      if (fail) return Promise.reject(new Error('synth failed'));
      if (selfPlaying) return Promise.resolve(null);
      if (!manual) return Promise.resolve({ text });
      const gate = deferred();
      engine.pending.push({ text, ...gate });
      return gate.promise.then(() => ({ text }));
    },
    stop() {
      engine.stops += 1;
    }
  };
  return engine;
}

/** Player whose clips end when the test calls `end()` (or instantly). */
function fakePlayer({ manual = false } = {}) {
  const player = {
    played: [],
    stopped: 0,
    clips: [],
    play(audio, options) {
      player.played.push({ text: audio.text, ...options });
      const gate = deferred();
      const clip = { done: manual ? gate.promise : Promise.resolve(), end: gate.resolve, stop: () => { player.stopped += 1; gate.resolve(); } };
      player.clips.push(clip);
      return clip;
    }
  };
  return player;
}

const bubbleRules = (overrides = {}) => ({
  ...SPEAK_RULES,
  bubbles: { ...SPEAK_RULES.bubbles, enabled: true, ...overrides }
});

test('matchesKey and shouldSpeak follow the data rules', () => {
  assert.ok(matchesKey('ttt.win', ['ttt.*']));
  assert.ok(!matchesKey('tttx.win', ['ttt.*']));
  assert.ok(matchesKey('stranger', ['stranger']));
  assert.ok(shouldSpeak('stranger'));
  assert.ok(shouldSpeak('chess.abandoned'));
  assert.ok(shouldSpeak('fetch.abandonPrompt'));
  assert.ok(!shouldSpeak('companion'));
  assert.ok(!shouldSpeak('playerMenu'));
  assert.ok(!shouldSpeak(null));
  assert.ok(!shouldSpeak('social.npcGamePrompt'));
});

test('LRU evicts the least recently used entry', () => {
  const lru = createLru(2);
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 3);
  assert.ok(lru.has('a'));
  assert.ok(!lru.has('b'));
  assert.equal(lru.size, 2);
});

test('dialogue lines are cleaned, split, and played in order', async () => {
  const engine = fakeEngine();
  const player = fakePlayer();
  const ends = [];
  const speaker = createSpeaker({ engine, player, onEnd: (item, info) => ends.push(info) });
  const result = speaker.speak({
    actorId: 'npc-1', key: 'ttt.loss', voice: VOICE, speakerName: 'Pip',
    text: 'Haha, gotcha! Good match. Want another round?\nRewards: 3 coins'
  });
  assert.equal(result.status, 'playing');
  assert.deepEqual(await result.done, { cancelled: false });
  assert.deepEqual(player.played.map(clip => clip.text), ['Haha, gotcha!', 'Good match. Want another round?']);
  assert.deepEqual(ends, [{ cancelled: false }]);
  assert.equal(speaker.state().current, null);
});

test('a new beat cancels the current one', async () => {
  const engine = fakeEngine();
  const player = fakePlayer({ manual: true });
  const speaker = createSpeaker({ engine, player });
  const first = speaker.speak({ actorId: 'npc-1', key: 'stranger', voice: VOICE, text: 'Hi, I am Pip. Do you want to be friends?' });
  await flush();
  assert.equal(player.played.length, 1);

  const second = speaker.speak({ actorId: 'npc-1', key: 'accepted', voice: VOICE, text: 'Yay! Pip is your friend now.' });
  assert.deepEqual(await first.done, { cancelled: true });
  assert.equal(player.stopped, 1);
  assert.equal(engine.stops, 1);
  await flush();
  assert.equal(player.played.at(-1).text, 'Yay! Pip is your friend now.');
  player.clips.at(-1).end();
  assert.deepEqual(await second.done, { cancelled: false });
});

test('cancel() (dialogue close) stops audio and the engine', async () => {
  const engine = fakeEngine();
  const player = fakePlayer({ manual: true });
  const speaker = createSpeaker({ engine, player });
  const line = speaker.speak({ actorId: 'npc-1', key: 'friend', voice: VOICE, text: 'Good to see you again!' });
  await flush();
  assert.equal(speaker.cancel(), true);
  assert.deepEqual(await line.done, { cancelled: true });
  assert.equal(player.stopped, 1);
  assert.equal(engine.stops, 1);
  assert.equal(speaker.cancel(), false, 'nothing left to cancel');
});

test('dialogue beats out bubbles, and a busy speaker drops bubbles', async () => {
  const engine = fakeEngine();
  const player = fakePlayer({ manual: true });
  const speaker = createSpeaker({ engine, player, rules: bubbleRules() });
  const bubble = speaker.speak({ kind: 'bubble', actorId: 'npc-2', key: 'social.greet', voice: OTHER_VOICE, text: 'hi there!' });
  assert.equal(bubble.status, 'playing');
  await flush();

  const line = speaker.speak({ actorId: 'npc-1', key: 'stranger', voice: VOICE, text: 'Hi, I am Pip.' });
  assert.deepEqual(await bubble.done, { cancelled: true });
  assert.equal(line.status, 'playing');

  const late = speaker.speak({ kind: 'bubble', actorId: 'npc-3', key: 'social.chat', voice: OTHER_VOICE, text: 'nice day in the park.' });
  assert.deepEqual([late.status, late.reason], ['dropped', 'busy']);
});

test('bubbles respect the off switch, distance, visual-only, dedupe, and rate cap', async () => {
  const engine = fakeEngine();
  const player = fakePlayer();
  let clock = 0;
  const off = createSpeaker({ engine, player });
  assert.equal(off.speak({ kind: 'bubble', actorId: 'a', key: 'social.greet', voice: VOICE, text: 'hi!' }).reason, 'bubbles-off');

  const speaker = createSpeaker({ engine, player, now: () => clock, rules: bubbleRules({ maxPerMinute: 2 }) });
  const say = (actorId, text, extra = {}) => speaker.speak({ kind: 'bubble', actorId, key: 'social.greet', voice: VOICE, text, ...extra });

  assert.equal(say('a', 'hi!', { distanceTiles: 20 }).reason, 'far');
  assert.equal(say('a', 'yay!', { visualOnly: true }).reason, 'visual-only');
  assert.equal(speaker.speak({ kind: 'bubble', actorId: 'a', key: 'stranger', voice: VOICE, text: 'hi!' }).reason, 'key');

  await say('a', 'hi!').done;
  await flush();
  clock = 1000;
  assert.equal(say('a', 'hi!').reason, 'duplicate');
  await say('b', 'hello!').done;
  await flush();
  clock = 2000;
  assert.equal(say('c', 'howdy!').reason, 'rate');
  clock = 61_000;
  assert.equal(say('c', 'howdy!').status, 'playing');
});

test('cache hits skip synth', async () => {
  const engine = fakeEngine();
  const player = fakePlayer();
  const speaker = createSpeaker({ engine, player });
  await speaker.speak({ actorId: 'npc-1', key: 'declined', voice: VOICE, text: 'No worries. Maybe next time.' }).done;
  const calls = engine.calls.length;
  await flush();
  await speaker.speak({ actorId: 'npc-2', key: 'declined', voice: VOICE, text: 'No worries. Maybe next time.' }).done;
  assert.equal(engine.calls.length, calls);
  assert.equal(player.played.length, 2);

  await flush();
  await speaker.speak({ actorId: 'npc-3', key: 'declined', voice: OTHER_VOICE, text: 'No worries. Maybe next time.' }).done;
  assert.ok(engine.calls.length > calls, 'a different voice is a different clip');
});

test('only one generation is in flight, and stale results never play', async () => {
  const engine = fakeEngine({ manual: true });
  const player = fakePlayer();
  const speaker = createSpeaker({ engine, player });
  speaker.speak({ actorId: 'npc-1', key: 'stranger', voice: VOICE, text: 'Hi, I am Pip. Do you want to be friends?' });
  await flush();
  assert.equal(engine.pending.length, 1);

  const next = speaker.speak({ actorId: 'npc-2', key: 'friend', voice: OTHER_VOICE, text: 'Good to see you again!' });
  await flush();
  assert.equal(engine.pending.length, 1, 'the new line waits for the stale generation');
  engine.pending[0].resolve();
  await flush();
  assert.equal(engine.pending.length, 2);
  assert.equal(player.played.length, 0, 'the cancelled line is not played');
  engine.pending[1].resolve();
  await next.done;
  assert.deepEqual(player.played.map(clip => clip.text), ['Good to see you again!']);
  assert.ok(speaker.cache.has('fake|af_heart@1/1|Hi, I am Pip.'), 'the stale result is still cached');
});

test('repeating the same dialogue line does not restart it', async () => {
  const engine = fakeEngine();
  const player = fakePlayer({ manual: true });
  const speaker = createSpeaker({ engine, player });
  const first = speaker.speak({ actorId: 'npc-1', key: 'friend', voice: VOICE, text: 'Good to see you again!' });
  const again = speaker.speak({ actorId: 'npc-1', key: 'friend', voice: VOICE, text: 'Good to see you again!' });
  assert.equal(again.reason, 'duplicate');
  assert.equal(again.id, first.id);
  assert.equal(engine.stops, 0);
});

test('unspoken keys, empty text, missing voice, and a cold engine are dropped', () => {
  const speaker = createSpeaker({ engine: fakeEngine(), player: fakePlayer() });
  assert.equal(speaker.speak({ actorId: 'p', key: 'playerMenu', voice: VOICE, text: 'What would you like to do?' }).reason, 'key');
  assert.equal(speaker.speak({ actorId: 'p', voice: VOICE, text: 'No key.' }).reason, 'key');
  assert.equal(speaker.speak({ actorId: 'n', key: 'stranger', voice: VOICE, text: '👋' }).reason, 'empty');
  assert.equal(speaker.speak({ actorId: 'n', key: 'stranger', text: 'Hi.' }).reason, 'no-voice');
  const cold = createSpeaker({ engine: fakeEngine({ status: 'loading' }), player: fakePlayer() });
  assert.equal(cold.speak({ actorId: 'n', key: 'stranger', voice: VOICE, text: 'Hi.' }).reason, 'engine-not-ready');
  const none = createSpeaker({ player: fakePlayer() });
  assert.equal(none.speak({ actorId: 'n', key: 'stranger', voice: VOICE, text: 'Hi.' }).reason, 'engine-not-ready');
});

test('self-playing engines speak sentence by sentence without the player', async () => {
  const engine = fakeEngine({ selfPlaying: true });
  const player = fakePlayer();
  const speaker = createSpeaker({ engine, player });
  const line = speaker.speak({ actorId: 'npc-1', key: 'ttt.win', voice: VOICE, text: 'Great game! You won that round. Want to play again?' });
  assert.deepEqual(await line.done, { cancelled: false });
  assert.deepEqual(engine.calls.map(call => call.text), ['Great game! You won that round.', 'Want to play again?']);
  assert.equal(player.played.length, 0);
  assert.equal(await speaker.prewarm('Hi there.', VOICE), false, 'no silent pre-generation through a self-playing engine');
});

test('synth failures end the line and report the error', async () => {
  const errors = [];
  const speaker = createSpeaker({ engine: fakeEngine({ fail: true }), player: fakePlayer(), onError: error => errors.push(error.message) });
  const line = speaker.speak({ actorId: 'npc-1', key: 'stranger', voice: VOICE, text: 'Hi, I am Pip.' });
  const info = await line.done;
  assert.equal(info.cancelled, false);
  assert.equal(info.error.message, 'synth failed');
  assert.deepEqual(errors, ['synth failed']);
  await flush();
  assert.equal(speaker.isBusy(), false);
});

test('prewarm fills the cache so the real line skips synth', async () => {
  const engine = fakeEngine();
  const player = fakePlayer();
  const speaker = createSpeaker({ engine, player });
  assert.equal(await speaker.prewarm('Hi, I am Pip. Do you want to be friends?', VOICE), true);
  assert.equal(player.played.length, 0);
  const calls = engine.calls.length;
  await flush();
  await speaker.speak({ actorId: 'npc-1', key: 'stranger', voice: VOICE, text: 'Hi, I am Pip. Do you want to be friends?' }).done;
  assert.equal(engine.calls.length, calls);
});

test('setEnabled(false) silences and drops new lines', async () => {
  const player = fakePlayer({ manual: true });
  const speaker = createSpeaker({ engine: fakeEngine(), player });
  const line = speaker.speak({ actorId: 'npc-1', key: 'friend', voice: VOICE, text: 'Good to see you again!' });
  await flush();
  speaker.setEnabled(false);
  assert.deepEqual(await line.done, { cancelled: true });
  assert.equal(speaker.speak({ actorId: 'npc-1', key: 'friend', voice: VOICE, text: 'Again?' }).reason, 'disabled');
});

test('bubbles play at the bubble volume and carry pan and voice tuning', async () => {
  const player = fakePlayer();
  const speaker = createSpeaker({ engine: fakeEngine(), player, rules: bubbleRules() });
  const tuned = { ...VOICE, pitch: 1.08, rate: 0.94 };
  await speaker.speak({ kind: 'bubble', actorId: 'a', key: 'social.greet', voice: tuned, text: 'hi there!', pan: -0.5 }).done;
  assert.deepEqual(player.played[0], { text: 'hi there!', volume: SPEAK_RULES.bubbles.volume, pan: -0.5, pitch: 1.08, rate: 0.94 });
});
