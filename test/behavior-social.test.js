import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileConfig } from '../src/behavior/config.js';
import {
  Blackboard,
  createBlackboard,
  friendThresholdMet,
  pairKey
} from '../src/behavior/blackboard.js';
import { BehaviorRuntime } from '../src/behavior/runtime.js';
import { EventLog } from '../src/behavior/events.js';
import { Arbiter, comparePriority } from '../src/behavior/arbiter.js';
import { CooldownStore, sampleDuration } from '../src/behavior/cooldowns.js';

const realRaw = JSON.parse(fs.readFileSync(new URL('../data/behaviors.json', import.meta.url), 'utf8'));

function seeded(seed = 3) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function makeSocialRuntime({ actors, player, seed = 3 }) {
  const config = compileConfig(realRaw);
  const blackboard = createBlackboard({
    actors,
    player,
    styleFamilies: config.styleFamilies,
    maxPairRecords: config.limits.maxPairRecords,
    maxFriendshipsPerNpc: config.limits.maxFriendshipsPerNpc,
    friendThreshold: config.limits.friendThreshold
  });
  const events = new EventLog(2000);
  const runtime = new BehaviorRuntime({
    config,
    blackboard,
    events,
    rng: seeded(seed),
    deps: {
      tryStep: () => false,
      face: (actor, direction) => { actor.direction = direction; }
    }
  });
  return { runtime, blackboard, events, config };
}

test('greet starts for nearby idle NPCs when the player is far away', () => {
  const npcA = { id: 'npc-a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const npcB = { id: 'npc-b', x: 6, y: 5, recipe: { style: 'voxel-art' } };
  const player = { id: 'player', x: 30, y: 30, isPlayer: true };
  const { runtime, events, blackboard } = makeSocialRuntime({ actors: [npcA, npcB], player });

  for (let i = 0; i < 30; i++) runtime.update(100); // 3 seconds

  const greetStarts = events.list({ type: 'behavior.start' })
    .filter(entry => entry.detail.behaviorId === 'greet');
  assert.equal(greetStarts.length, 1);
  assert.equal(greetStarts[0].detail.targetId, 'npc-b');
  assert.equal(blackboard.relation(npcA, npcB).greets, 1);
  assert.equal(blackboard.relation(npcA, npcB).friends, false);
});

test('player proximity suppresses social behaviors within three tiles', () => {
  const npcA = { id: 'npc-a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const npcB = { id: 'npc-b', x: 6, y: 5, recipe: { style: 'voxel-art' } };
  const player = { id: 'player', x: 5, y: 6, isPlayer: true }; // distance 1 from A, 2 from B
  const { runtime, events } = makeSocialRuntime({ actors: [npcA, npcB], player });

  for (let i = 0; i < 60; i++) runtime.update(100); // 6 seconds

  const starts = events.list({ type: 'behavior.start' }).map(entry => entry.detail.behaviorId);
  assert.ok(!starts.includes('greet'), `greet should be suppressed: ${starts.join(', ')}`);
  assert.ok(!starts.includes('befriend'));
  assert.ok(!starts.includes('inviteGame'));
});

test('NPCs four tiles apart are out of greet range', () => {
  const npcA = { id: 'npc-a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const npcB = { id: 'npc-b', x: 9, y: 5, recipe: { style: 'voxel-art' } };
  const { runtime, events } = makeSocialRuntime({ actors: [npcA, npcB], player: null });

  for (let i = 0; i < 30; i++) runtime.update(100);
  const starts = events.list({ type: 'behavior.start' }).map(entry => entry.detail.behaviorId);
  assert.ok(!starts.includes('greet'));
});

test('pair cooldown prevents an immediate second greet', () => {
  const npcA = { id: 'npc-a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const npcB = { id: 'npc-b', x: 6, y: 5, recipe: { style: 'voxel-art' } };
  const { runtime, events, blackboard } = makeSocialRuntime({ actors: [npcA, npcB], player: null });

  for (let i = 0; i < 80; i++) runtime.update(100); // 8 seconds, greet is ~2s + cooldown 20-30s
  const greetStarts = events.list({ type: 'behavior.start' })
    .filter(entry => entry.detail.behaviorId === 'greet');
  assert.equal(greetStarts.length, 1);
  assert.equal(blackboard.relation(npcA, npcB).greets, 1);
});

test('friend threshold is deterministic: two greets plus one shared activity', () => {
  const blackboard = new Blackboard({ maxPairRecords: 256, maxFriendshipsPerNpc: 6 });
  const a = { id: 'a' };
  const b = { id: 'b' };

  blackboard.recordGreet(a, b);
  assert.equal(friendThresholdMet(blackboard.relation(a, b)), false);
  blackboard.recordGreet(a, b);
  assert.equal(friendThresholdMet(blackboard.relation(a, b)), false);
  blackboard.recordActivity(a, b);
  assert.equal(friendThresholdMet(blackboard.relation(a, b)), true);

  const result = blackboard.applyInteraction(a, b, 'befriend');
  assert.equal(result.ok, true);
  assert.equal(result.friends, true);
  assert.equal(blackboard.isFriend(a, b), true);
  assert.equal(blackboard.isFriend(b, a), true);
  assert.equal(blackboard.attemptFriendship(a, b).reason, 'already-friends');
});

test('friendship cap is six per NPC and pair records are bounded', () => {
  const blackboard = new Blackboard({ maxPairRecords: 256, maxFriendshipsPerNpc: 6 });
  const a = { id: 'a' };

  for (let index = 1; index <= 6; index++) {
    const friend = { id: `f${index}` };
    blackboard.recordGreet(a, friend);
    blackboard.recordGreet(a, friend);
    blackboard.recordActivity(a, friend);
    assert.equal(blackboard.attemptFriendship(a, friend).friends, true);
  }
  assert.equal(blackboard.friendCount(a), 6);

  const seventh = { id: 'f7' };
  blackboard.recordGreet(a, seventh);
  blackboard.recordGreet(a, seventh);
  blackboard.recordActivity(a, seventh);
  const capped = blackboard.attemptFriendship(a, seventh);
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'friend-cap');
  assert.equal(blackboard.friendCount(a), 6);

  const bounded = new Blackboard({ maxPairRecords: 2 });
  bounded.recordGreet({ id: 'x' }, { id: 'y' });
  bounded.recordGreet({ id: 'x' }, { id: 'z' });
  bounded.recordGreet({ id: 'x' }, { id: 'w' });
  assert.equal(bounded.pairCount(), 2);
  assert.equal(pairKey({ id: 'x' }, { id: 'y' }).startsWith('x'), true);
});

test('cooldowns are scoped by actor, pair, and global keys', () => {
  const rng = () => 0.5;
  assert.equal(sampleDuration([1000, 2000], () => 0), 1000);
  assert.equal(sampleDuration([1000, 2000], () => 1), 2000);
  assert.equal(sampleDuration({ durationMs: 500 }, rng), 500);

  const store = new CooldownStore({ now: 100 });
  const consumed = store.consume('actor', 'npc-a:greet', [1000, 2000], 100, rng);
  assert.equal(consumed.ok, true);
  assert.equal(consumed.durationMs, 1500);
  assert.equal(store.isReady('actor', 'npc-a:greet', 1599), false);
  assert.equal(store.isReady('actor', 'npc-a:greet', 1600), true);
  assert.equal(store.isReady('actor', 'npc-b:greet', 100), true, 'other actors are independent');

  store.start('pair', 'a::b', 5000, 100);
  assert.equal(store.isReady('pair', 'a::c', 100), true);
  assert.equal(store.remaining('pair', 'a::b', 1100), 4000);
  assert.equal(store.isReady('pair', 'a::b', 5100), true);

  store.start('global', 'inviteGameGlobal', 20000, 100);
  assert.equal(store.isReady('global', 'inviteGameGlobal', 5000), false);
  assert.equal(store.isReady('global', 'otherGlobal', 5000), true);

  const snapshot = store.serialize(100);
  assert.equal(snapshot.version, 1);
  const restored = CooldownStore.deserialize(snapshot, { now: 100 });
  assert.equal(restored.readyAt('pair', 'a::b'), 5100);
  assert.equal(restored.readyAt('global', 'inviteGameGlobal'), 20100);
});

test('arbiter locks actors, pairs, dialogue, and the single NPC game slot', () => {
  const arbiter = new Arbiter({ maxNpcGames: 1 });
  const first = arbiter.commit({
    id: 'behavior:npc-a:greet',
    priority: 60,
    actors: ['npc-a'],
    pair: 'npc-a::npc-b'
  });
  assert.ok(first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-a:wander', actors: ['npc-a'] }), false);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-c:greet', actors: ['npc-c'], pair: 'npc-a::npc-b' }), false);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-c:greet', actors: ['npc-c'], pair: 'npc-c::npc-d' }), true);

  const game = arbiter.commit({ id: 'behavior:npc-c:inviteGame', actors: ['npc-c'], game: true });
  assert.ok(game);
  assert.equal(arbiter.gameCount(), 1);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-d:inviteGame', actors: ['npc-d'], game: true }), false);
  assert.equal(arbiter.release(game), true);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-c:inviteGame', actors: ['npc-c'], game: true }), true);
  assert.equal(arbiter.release(first), true);

  arbiter.setDialogue(true);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-a:greet', actors: ['npc-a'] }), false);
  assert.equal(arbiter.canStart({ id: 'dialogue:player', kind: 'dialogue' }), true);
  arbiter.setDialogue(false);
  assert.equal(arbiter.canStart({ id: 'behavior:npc-a:greet', actors: ['npc-a'] }), true);

  assert.ok(comparePriority({ id: 'a', priority: 50 }, { id: 'b', priority: 10 }) < 0);
  assert.ok(comparePriority({ id: 'a', priority: 10 }, { id: 'b', priority: 50 }) > 0);
});
