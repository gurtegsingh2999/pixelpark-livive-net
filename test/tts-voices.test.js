import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_POOL,
  VOICE_VARIANTS,
  seedOf,
  assignVoice,
  assignVoices,
  voiceUsage,
  resolveVoice,
  resolveVoices,
  filterPool,
  voiceCacheKey
} from '../src/tts/voices.js';

function npc(index, extra = {}) {
  return { id: `npc-${index}`, name: `N${index}`, recipe: { seed: `fern-${index}`, look: {} }, ...extra };
}

const roster = count => Array.from({ length: count }, (_, index) => npc(index));

test('seedOf prefers the recipe seed, then id and name', () => {
  assert.equal(seedOf(npc(1)), 'fern-1');
  assert.equal(seedOf({ id: 'npc-x' }), 'npc-x');
  assert.equal(seedOf({ name: 'Pip' }), 'Pip');
  assert.equal(seedOf(null), 'park');
});

test('assignment is deterministic per seed', () => {
  const first = assignVoice(npc(7));
  assert.ok(VOICE_POOL.some(voice => voice.id === first));
  assert.equal(assignVoice(npc(7)), first);
  assert.equal(assignVoice({ id: 'other', recipe: { seed: 'fern-7' } }), first, 'the seed, not the id, drives the pick');
  assert.deepEqual(assignVoices(roster(40)).map(entry => entry.voice), assignVoices(roster(40)).map(entry => entry.voice));
});

test('neighbours get distinct voices until the pool runs out', () => {
  const assigned = assignVoices(roster(40));
  const firstRound = assigned.slice(0, VOICE_POOL.length).map(entry => entry.voice);
  assert.equal(new Set(firstRound).size, VOICE_POOL.length);
  const usage = voiceUsage(assigned);
  assert.ok(Math.max(...usage.values()) <= 2, '40 neighbours never stack three on one voice');
});

test('genders stay balanced while both still have unused voices', () => {
  const smaller = Math.min(
    filterPool(VOICE_POOL, { gender: 'female' }).length,
    filterPool(VOICE_POOL, { gender: 'male' }).length
  );
  const assigned = assignVoices(roster(smaller * 2));
  const gender = id => VOICE_POOL.find(voice => voice.id === id).gender;
  for (let count = 1; count <= assigned.length; count++) {
    const slice = assigned.slice(0, count).map(entry => gender(entry.voice));
    const female = slice.filter(value => value === 'female').length;
    assert.ok(Math.abs(female - (count - female)) <= 1, `gender gap after ${count} neighbours`);
  }
});

test('repeats of a voice get pitch/rate variants', () => {
  const resolved = resolveVoices(roster(40));
  assert.equal(resolved.size, 40);
  const values = [...resolved.values()];
  assert.equal(values.filter(voice => voice.variant === 0).length, VOICE_POOL.length);
  const repeats = values.filter(voice => voice.variant > 0);
  assert.equal(repeats.length, 40 - VOICE_POOL.length);
  for (const voice of repeats) {
    const plain = values.find(other => other.id === voice.id && other.variant === 0);
    assert.notEqual(voiceCacheKey(voice), voiceCacheKey(plain));
  }
});

test('a stored voice wins and is counted before new picks', () => {
  const stored = VOICE_POOL[3].id;
  assert.equal(assignVoice(npc(1, { voice: stored })), stored);

  const others = roster(5);
  const plain = assignVoices(others).map(entry => entry.voice);
  const withStored = assignVoices([npc(99, { voice: plain[2] }), ...others]);
  assert.equal(withStored[0].voice, plain[2]);
  assert.ok(!withStored.slice(1).some(entry => entry.voice === plain[2]), 'the stored voice is already taken');
});

test('unknown stored voice ids fall back to the seeded pick', () => {
  const fallback = assignVoice(npc(4));
  assert.equal(assignVoice(npc(4, { voice: 'zz_missing' })), fallback);
  assert.equal(resolveVoice(npc(4, { voice: 42 })).id, fallback);
  assert.equal(assignVoices([npc(4, { voice: 'zz_missing' })])[0].voice, fallback);
});

test('assignVoices does not mutate its input and handles odd input', () => {
  const input = roster(2);
  const output = assignVoices(input);
  assert.equal(input[0].voice, undefined);
  assert.ok(output[0].voice);
  assert.deepEqual(assignVoices(null), []);
  assert.equal(assignVoice(npc(1), []), null);
  assert.equal(resolveVoice(npc(1), []), null);
});

test('resolveVoice applies variant offsets within limits', () => {
  const base = resolveVoice(npc(2));
  assert.equal(base.variant, 0);
  assert.equal(base.pitch, 1);
  assert.equal(base.rate, 1);
  const shifted = resolveVoice(npc(2), VOICE_POOL, { variant: 1 });
  assert.equal(shifted.pitch, Math.round((1 + VOICE_VARIANTS[1].pitch) * 1000) / 1000);
  assert.equal(shifted.rate, Math.round((1 + VOICE_VARIANTS[1].rate) * 1000) / 1000);
  const wrapped = resolveVoice(npc(2), VOICE_POOL, { variant: VOICE_VARIANTS.length });
  assert.equal(wrapped.variant, 0);
  const extreme = resolveVoice(npc(2), VOICE_POOL, { variants: [{ pitch: 9, rate: -9 }] });
  assert.equal(extreme.pitch, 2);
  assert.equal(extreme.rate, 0.5);
});

test('filterPool narrows by gender and accent', () => {
  const britishMen = filterPool(VOICE_POOL, { gender: 'male', accent: 'british' });
  assert.ok(britishMen.length > 0);
  assert.ok(britishMen.every(voice => voice.id.startsWith('bm_')));
});
