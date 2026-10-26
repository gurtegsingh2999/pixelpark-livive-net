import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileConfig, resolveAssignment } from '../src/behavior/config.js';
import { createBlackboard } from '../src/behavior/blackboard.js';
import { select } from '../src/behavior/selectors.js';
import { actions } from '../src/behavior/actions.js';
import { BehaviorRuntime } from '../src/behavior/runtime.js';

const realRaw = JSON.parse(fs.readFileSync(new URL('../data/behaviors.json', import.meta.url), 'utf8'));
const config = compileConfig(realRaw);

function becomeFriends(blackboard, a, b) {
  blackboard.recordGreet(a, b);
  blackboard.recordGreet(a, b);
  blackboard.recordActivity(a, b);
  return blackboard.attemptFriendship(a, b);
}

test('style assignments use distinct follow parameters', () => {
  const cases = [
    ['dog', { cadence: 'trot', distance: 2.5, stepIntervalMs: 620, roamChance: 0.35 }],
    ['gaze', { cadence: 'hover', distance: 1, stepIntervalMs: 700, hover: true }],
    ['clay', { cadence: 'hop-roll', distance: 1.2, stepIntervalMs: 520, hop: true, roll: true }],
    ['skeleton', { cadence: 'shamble', distance: 1.5, stepIntervalMs: 900, shamble: true }],
    ['cat', { cadence: 'generic', distance: 1.5, stepIntervalMs: 700 }]
  ];

  for (const [style, expected] of cases) {
    const resolved = resolveAssignment(
      { id: style, isCompanion: true, recipe: { style } },
      config
    );
    assert.equal(resolved.behavior, 'follow', `${style} should follow`);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(resolved.params[key], value, `${style}.${key}`);
    }
  }

  const gaze = resolveAssignment({ id: 'g', isCompanion: true, recipe: { style: 'gaze' } }, config);
  assert.deepEqual(gaze.params.offset, { x: 1, y: 0 });
  const clay = resolveAssignment({ id: 'c', isCompanion: true, recipe: { style: 'clay' } }, config);
  assert.equal(clay.params.roamIntervalMs, 4200);
});

test('follow runtime applies style params and targets the companion buddy', () => {
  const player = { id: 'player', x: 20, y: 20, isPlayer: true };
  const make = (id, style, y) => ({
    id,
    x: 20,
    y,
    isCompanion: true,
    buddyId: 'player',
    recipe: { style }
  });
  const companions = [
    make('dog', 'dog', 24),
    make('gaze', 'gaze', 25),
    make('clay', 'clay', 26),
    make('bones', 'skeleton', 27)
  ];
  const blackboard = createBlackboard({
    actors: companions,
    player,
    styleFamilies: config.styleFamilies
  });
  let seed = 11;
  const runtime = new BehaviorRuntime({
    config,
    blackboard,
    rng: () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    },
    deps: {
      tryStep: (actor, dx, dy) => {
        actor.x += dx;
        actor.y += dy;
        return true;
      }
    }
  });

  for (let i = 0; i < 10; i++) runtime.update(100);
  const snapshot = runtime.snapshot();
  const byId = new Map(snapshot.actors.map(entry => [entry.actorId, entry]));

  for (const companion of companions) {
    const entry = byId.get(companion.id);
    assert.equal(entry.behaviorId, 'follow');
    assert.equal(entry.targetId, 'player');
  }
  assert.equal(byId.get('dog').params.cadence, 'trot');
  assert.equal(byId.get('gaze').params.cadence, 'hover');
  assert.equal(byId.get('clay').params.cadence, 'hop-roll');
  assert.equal(byId.get('bones').params.cadence, 'shamble');
});

test('selectors cover nearest, byId, mutualFriend, buddy, and midpoint', () => {
  const player = { id: 'player', x: 5, y: 6, isPlayer: true };
  const a = { id: 'a', x: 5, y: 5, recipe: { style: 'voxel-art' } };
  const b = { id: 'b', x: 6, y: 5, recipe: { style: 'voxel-art' } };
  const c = { id: 'c', x: 8, y: 5, recipe: { style: 'voxel-art' } };
  const d = { id: 'd', x: 10, y: 5, recipe: { style: 'voxel-art' } };
  const pet = { id: 'pet', x: 4, y: 5, isCompanion: true, buddyId: 'a', recipe: { style: 'dog' } };
  const blackboard = createBlackboard({ actors: [a, b, c, d, pet], player });
  becomeFriends(blackboard, a, b);
  becomeFriends(blackboard, c, d);

  const nearest = select('nearest', {
    blackboard,
    actor: a,
    params: { kind: 'npc', maxDistance: 3, notFriends: true }
  });
  assert.equal(nearest.id, 'c', 'b is a friend, so the next non-friend is c');

  assert.equal(select('byId', { blackboard, actor: a, params: { id: 'd' } }).id, 'd');
  assert.equal(select('mutualFriend', { blackboard, actor: a, params: { maxDistance: 4 } }).id, 'b');
  assert.equal(select('buddy', { blackboard, actor: pet }).id, 'a');
  assert.deepEqual(select('midpoint', { blackboard, actor: a, params: { b: 'c' } }), { x: 7, y: 5 });

  // Player proximity suppresses both the actor and the candidate.
  assert.equal(select('nearest', {
    blackboard,
    actor: a,
    params: { kind: 'npc', maxDistance: 4, minPlayerDistance: 3 }
  }), null);
});

test('movement actions only move through injected tryStep and never mutate x/y', () => {
  const actor = { id: 'dog', x: 0, y: 0, direction: 0 };
  const target = { id: 'player', x: 5, y: 0 };
  const steps = [];

  const followResult = actions.followTarget({
    actor,
    target,
    params: { distance: 2.5, stepIntervalMs: 0, stepDurationMs: 220 },
    now: 1000,
    memory: {},
    stateMemory: {},
    rng: () => 0.5,
    tryStep: (who, dx, dy) => {
      steps.push([dx, dy]);
      return false;
    }
  });

  assert.equal(followResult.done, false);
  assert.ok(steps.length >= 1);
  assert.equal(actor.x, 0);
  assert.equal(actor.y, 0);

  const seekSteps = [];
  const seekMemory = {};
  const seekResult = actions.seek({
    actor,
    target,
    params: { tolerance: 1, stepIntervalMs: 0 },
    now: 1000,
    memory: {},
    stateMemory: seekMemory,
    rng: () => 0.5,
    findPath: () => [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    tryStep: (who, dx, dy) => {
      seekSteps.push([dx, dy]);
      return true;
    }
  });
  assert.equal(seekResult.done, false);
  assert.deepEqual(seekSteps, [[1, 0]]);
  assert.equal(actor.x, 0, 'seek must not write x');
  assert.equal(seekMemory.path.length, 1);

  const wanderSteps = [];
  actions.wanderStep({
    actor,
    params: { stepIntervalMs: 0, preferForward: true },
    now: 1000,
    memory: {},
    stateMemory: {},
    rng: () => 0.5,
    tryStep: (who, dx, dy) => {
      wanderSteps.push([dx, dy]);
      return false;
    }
  });
  assert.equal(wanderSteps.length, 4);
  assert.equal(actor.x, 0);
  assert.equal(actor.y, 0);
});

test('startGame is restricted to approved NPC games and awaits the session token', () => {
  let started = null;
  const memory = {};
  const baseContext = {
    actor: { id: 'npc-a' },
    target: { id: 'npc-b' },
    now: 1000,
    memory,
    stateMemory: {},
    allowedGames: ['tic-tac-toe'],
    emit: () => {},
    startGame: request => {
      started = request;
      return { ok: true, token: 'session-1' };
    },
    gameStatus: token => token === 'session-1'
      ? (memory.polls === undefined || memory.polls < 1
        ? { active: true, phase: 'playing' }
        : { active: false, outcome: 'draw' })
      : { active: false, outcome: 'abandoned' }
  };

  const blocked = actions.startGame({
    ...baseContext,
    params: { game: 'checkers' },
    memory: {},
    stateMemory: {}
  });
  assert.equal(blocked.done, true);
  assert.equal(blocked.reason, 'game-not-allowed');
  assert.equal(started, null);

  const allowed = actions.startGame({ ...baseContext, params: { game: 'tic-tac-toe' } });
  assert.equal(allowed.done, true);
  assert.equal(allowed.reason, 'started');
  assert.equal(started.game, 'tic-tac-toe');
  assert.equal(memory.gameToken, 'session-1');

  const waiting = actions.awaitGame({ ...baseContext, params: { timeoutMs: 20000 } });
  assert.equal(waiting.done, false);
  memory.polls = 1;
  const ended = actions.awaitGame({ ...baseContext, params: { timeoutMs: 20000 } });
  assert.equal(ended.done, true);
  assert.equal(ended.reason, 'draw');

  assert.equal(config.limits.npcGames.length, 1);
  assert.deepEqual(config.limits.npcGames, ['tic-tac-toe']);
  assert.equal(config.behaviors.inviteGame.states.start.params.game, 'tic-tac-toe');
});
