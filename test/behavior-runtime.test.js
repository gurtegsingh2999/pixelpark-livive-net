import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileConfig } from '../src/behavior/config.js';
import { createBlackboard } from '../src/behavior/blackboard.js';
import { BehaviorRuntime } from '../src/behavior/runtime.js';
import { EventLog } from '../src/behavior/events.js';

const realRaw = JSON.parse(fs.readFileSync(new URL('../data/behaviors.json', import.meta.url), 'utf8'));

function makeConfig({ behaviors, assignments, tick = {}, limits = {}, cooldowns = {} }) {
  return compileConfig({
    version: 1,
    tick: {
      decisionIntervalMs: 100,
      maxDecisionsPerTick: 24,
      maxActionsPerTick: 64,
      ...tick
    },
    limits: {
      maxOpenNpcGames: 1,
      maxFriendshipsPerNpc: 6,
      maxPairRecords: 256,
      npcGames: ['tic-tac-toe'],
      friendThreshold: { greets: 2, activities: 1 },
      ...limits
    },
    cooldowns,
    styleFamilies: {},
    selectors: { nearest: { type: 'nearest' } },
    behaviors,
    assignments
  }, { extraActions: ['probe'] });
}

function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('FSM follows state.next and completes when a terminal state finishes', () => {
  const config = makeConfig({
    behaviors: {
      chain: {
        priority: 10,
        when: { eq: ['actor.kind', 'npc'] },
        target: null,
        states: {
          s1: { action: 'probe', durationMs: 100, next: 's2' },
          s2: { action: 'probe', durationMs: 100, next: null }
        }
      }
    },
    assignments: [{ match: { kind: 'npc' }, behavior: 'chain' }]
  });

  const npc = { id: 'npc-a', x: 2, y: 2, recipe: { style: 'voxel-art' } };
  const blackboard = createBlackboard({ actors: [npc], player: null });
  const probes = [];
  const events = new EventLog(100);
  const streamed = [];
  const runtime = new BehaviorRuntime({
    config,
    blackboard,
    events,
    rng: seeded(1),
    onEvent: entry => streamed.push(entry.type),
    actions: {
      probe: ctx => {
        probes.push(ctx.stateName);
        return { done: true };
      }
    }
  });

  runtime.update(100);
  runtime.update(100);

  assert.deepEqual(probes, ['s1', 's2']);
  const starts = events.list({ type: 'behavior.start' });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].detail.state, 's1');
  assert.equal(events.list({ type: 'behavior.complete' }).length, 1);
  assert.equal(runtime.getEntry('npc-a').behaviorId, null);
  assert.ok(streamed.includes('behavior.start'), 'onEvent receives live events for speech/UI hooks');
  assert.ok(streamed.includes('behavior.complete'));
});

test('equal priorities tie-break by behavior id and higher priority wins', () => {
  const tieConfig = makeConfig({
    tick: { decisionIntervalMs: 100 },
    behaviors: {
      beta: {
        priority: 50,
        when: { eq: ['actor.kind', 'npc'] },
        states: { only: { action: 'probe', durationMs: 5000, next: null } }
      },
      alpha: {
        priority: 50,
        when: { eq: ['actor.kind', 'npc'] },
        states: { only: { action: 'probe', durationMs: 5000, next: null } }
      }
    },
    assignments: [{ match: { kind: 'npc' }, behavior: 'alpha' }]
  });
  const npc = { id: 'npc-a', x: 1, y: 1, recipe: { style: 'voxel-art' } };
  const blackboard = createBlackboard({ actors: [npc] });
  const events = new EventLog(50);
  const runtime = new BehaviorRuntime({
    config: tieConfig,
    blackboard,
    events,
    actions: { probe: () => ({ done: false }) }
  });

  runtime.update(100);
  assert.equal(events.list({ type: 'behavior.start' })[0].detail.behaviorId, 'alpha');

  const priorityConfig = makeConfig({
    tick: { decisionIntervalMs: 100 },
    behaviors: {
      alpha: {
        priority: 50,
        when: { eq: ['actor.kind', 'npc'] },
        states: { only: { action: 'probe', durationMs: 5000, next: null } }
      },
      gamma: {
        priority: 70,
        when: { eq: ['actor.kind', 'npc'] },
        states: { only: { action: 'probe', durationMs: 5000, next: null } }
      }
    },
    assignments: [{ match: { kind: 'npc' }, behavior: 'alpha' }]
  });
  const events2 = new EventLog(50);
  const runtime2 = new BehaviorRuntime({
    config: priorityConfig,
    blackboard: createBlackboard({ actors: [{ ...npc }] }),
    events: events2,
    actions: { probe: () => ({ done: false }) }
  });
  runtime2.update(100);
  assert.equal(events2.list({ type: 'behavior.start' })[0].detail.behaviorId, 'gamma');
});

test('decision throttling keeps one active behavior between decision ticks', () => {
  const config = makeConfig({
    tick: { decisionIntervalMs: 1000 },
    behaviors: {
      alpha: {
        priority: 10,
        when: { eq: ['actor.kind', 'npc'] },
        states: { only: { action: 'probe', durationMs: 5000, next: null } }
      }
    },
    assignments: [{ match: { kind: 'npc' }, behavior: 'alpha' }]
  });
  const npc = { id: 'npc-a', x: 1, y: 1, recipe: { style: 'voxel-art' } };
  const events = new EventLog(50);
  const runtime = new BehaviorRuntime({
    config,
    blackboard: createBlackboard({ actors: [npc] }),
    events,
    actions: { probe: () => ({ done: false }) }
  });

  for (let i = 0; i < 9; i++) runtime.update(100);
  assert.equal(events.list({ type: 'behavior.start' }).length, 0);
  runtime.update(100);
  assert.equal(events.list({ type: 'behavior.start' }).length, 1);
  for (let i = 0; i < 9; i++) runtime.update(100);
  assert.equal(events.list({ type: 'behavior.start' }).length, 1, 'same behavior is kept, not restarted');
});

function runSocialFixture(seed, durationMs = 180000) {
  const config = compileConfig(realRaw);
  const rng = seeded(seed);
  const npcA = { id: 'npc-a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const npcB = { id: 'npc-b', x: 6, y: 5, recipe: { style: 'voxel-art' } };
  const player = { id: 'player', x: 30, y: 30, isPlayer: true };
  const blackboard = createBlackboard({
    actors: [npcA, npcB],
    player,
    styleFamilies: config.styleFamilies,
    maxPairRecords: config.limits.maxPairRecords,
    maxFriendshipsPerNpc: config.limits.maxFriendshipsPerNpc,
    friendThreshold: config.limits.friendThreshold
  });
  const events = new EventLog(5000);
  let polls = 0;
  const runtime = new BehaviorRuntime({
    config,
    blackboard,
    events,
    rng,
    deps: {
      tryStep: () => false,
      face: (actor, direction) => { actor.direction = direction; },
      startGame: () => { polls = 0; return { ok: true, token: 'ttt-session' }; },
      gameStatus: () => {
        polls += 1;
        return polls < 30 ? { active: true, phase: 'playing' } : { active: false, outcome: 'draw' };
      }
    }
  });

  for (let elapsed = 0; elapsed < durationMs; elapsed += 100) runtime.update(100);

  return {
    runtime,
    events,
    blackboard,
    npcA,
    npcB,
    starts: events.list({ type: 'behavior.start' }).map(entry => entry.detail.behaviorId)
  };
}

test('social fixture greets, befriends, then plays Tic-Tac-Toe without oscillation', () => {
  const result = runSocialFixture(99);
  const counts = result.starts.reduce((map, id) => {
    map[id] = (map[id] || 0) + 1;
    return map;
  }, {});

  assert.equal(counts.greet, 2, 'friend threshold needs exactly two greetings');
  assert.equal(counts.befriend, 1, 'friendship is attempted once per pair');
  assert.ok((counts.inviteGame || 0) >= 1, 'friends should start an NPC game');
  assert.ok(result.starts.length <= 20, `unexpected behavior churn: ${result.starts.length}`);
  assert.equal(result.blackboard.isFriend(result.npcA, result.npcB), true);
  assert.equal(result.blackboard.friendCount(result.npcA), 1);
  assert.equal(result.blackboard.friendCount(result.npcB), 1);

  const snapshots = result.runtime.snapshot();
  assert.ok(snapshots.actors.every(actor => actor.lockedBy === null || actor.lockedBy.includes(actor.actorId)));
  assert.equal(snapshots.actors.length, 2, 'at most one active behavior per actor');

  const gameEvents = result.events.list({ type: 'game.start' });
  assert.ok(gameEvents.length >= 1);
  assert.equal(gameEvents[0].detail.game, 'tic-tac-toe');
  assert.equal(result.events.list({ type: 'game.end' }).length, gameEvents.length);
});

test('identical seeds produce identical behavior sequences', () => {
  const first = runSocialFixture(1234, 120000);
  const second = runSocialFixture(1234, 120000);
  assert.deepEqual(first.starts, second.starts);
  assert.deepEqual(
    first.blackboard.serializeRelations(),
    second.blackboard.serializeRelations()
  );
});

test('short run does not flip-flop between behaviors', () => {
  const result = runSocialFixture(5, 12000);
  assert.ok(result.starts.length <= 4, `too many starts in 12s: ${result.starts.join(', ')}`);
  const perActor = new Map();
  for (const entry of result.events.list({ type: 'behavior.start' })) {
    const id = entry.detail.actorId;
    perActor.set(id, (perActor.get(id) || 0) + 1);
  }
  assert.ok([...perActor.values()].every(count => count <= 2));
});
