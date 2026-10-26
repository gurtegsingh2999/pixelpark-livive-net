import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BehaviorConfigError,
  actorProfile,
  compileConfig,
  resolveAssignment,
  resolveAssignments,
  validateConfig
} from '../src/behavior/config.js';
import { evaluatePredicate } from '../src/behavior/predicates.js';

const URL_BEHAVIORS = new URL('../data/behaviors.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(URL_BEHAVIORS, 'utf8'));

test('behaviors.json declares the approved limits and deterministic friend threshold', () => {
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.limits, {
    maxOpenNpcGames: 1,
    maxFriendshipsPerNpc: 6,
    maxPairRecords: 256,
    npcGames: ['tic-tac-toe'],
    friendThreshold: { greets: 2, activities: 1 }
  });
  assert.deepEqual(raw.social, {
    greetRadius: 3,
    gameRadius: 4,
    greetPlayerSuppression: 3,
    gamePlayerSuppression: 4
  });
  assert.ok(raw.tick.decisionIntervalMs > 0);
  assert.ok(raw.tick.maxDecisionsPerTick > 0);
  assert.ok(raw.tick.maxActionsPerTick > 0);
});

test('behavior config compiles, validates, and freezes nested data', () => {
  const report = validateConfig(raw);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.errors, []);

  const config = compileConfig(raw);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.behaviors.greet));
  assert.ok(Object.isFrozen(config.behaviors.greet.states));
  assert.ok(Object.isFrozen(config.assignments[0]));
  assert.deepEqual(config.behaviorOrder, ['inviteGame', 'befriend', 'greet', 'follow', 'wander']);
  assert.ok(config.behaviors.greet.target.params.maxDistance <= raw.social.greetRadius);
  assert.equal(config.behaviors.inviteGame.target.params.maxDistance, raw.social.gameRadius);
  assert.equal(config.behaviors.inviteGame.locks.game, true);
});

test('invalid configs report useful paths and throw from compileConfig', () => {
  const badAction = structuredClone(raw);
  badAction.behaviors.greet.states.face.action = 'flyAway';
  const actionReport = validateConfig(badAction);
  assert.equal(actionReport.ok, false);
  assert.ok(actionReport.errors.some(error => error.path === 'behaviors.greet.states.face.action'));
  assert.throws(() => compileConfig(badAction), BehaviorConfigError);

  const badNext = structuredClone(raw);
  badNext.behaviors.wander.states.idle.next = 'missing-state';
  const nextReport = validateConfig(badNext);
  assert.equal(nextReport.ok, false);
  assert.ok(nextReport.errors.some(error => error.path === 'behaviors.wander.states.idle.next'));

  const badVersion = structuredClone(raw);
  badVersion.version = 2;
  assert.equal(validateConfig(badVersion).ok, false);
  assert.equal(validateConfig(null).ok, false);
});

test('assignments resolve style, family, then kind overrides', () => {
  const config = compileConfig(raw);

  const dog = resolveAssignment({ id: 'dog', isCompanion: true, recipe: { style: 'dog' } }, config);
  assert.equal(dog.behavior, 'follow');
  assert.equal(dog.params.cadence, 'trot');
  assert.equal(dog.params.distance, 2.5);
  assert.equal(dog.params.roamChance, 0.35);

  const gaze = resolveAssignment({ id: 'gaze', isCompanion: true, recipe: { style: 'gaze' } }, config);
  assert.equal(gaze.params.cadence, 'hover');
  assert.equal(gaze.params.hover, true);
  assert.deepEqual(gaze.params.offset, { x: 1, y: 0 });

  const clay = resolveAssignment({ id: 'clay', isCompanion: true, recipe: { style: 'clay' } }, config);
  assert.equal(clay.params.cadence, 'hop-roll');
  assert.equal(clay.params.hop, true);
  assert.equal(clay.params.roll, true);

  const skeleton = resolveAssignment(
    { id: 'bones', isCompanion: true, recipe: { style: 'skeleton-armor' } },
    config
  );
  assert.equal(skeleton.behavior, 'follow');
  assert.equal(skeleton.params.cadence, 'shamble');
  assert.equal(skeleton.params.shamble, true);

  const generic = resolveAssignment({ id: 'cat', isCompanion: true, recipe: { style: 'cat' } }, config);
  assert.equal(generic.behavior, 'follow');
  assert.equal(generic.params.cadence, 'generic');

  const npc = resolveAssignment({ id: 'npc', recipe: { style: 'voxel-art' } }, config);
  assert.equal(npc.behavior, 'wander');

  const dogMatches = resolveAssignments({ id: 'dog', isCompanion: true, recipe: { style: 'dog' } }, config);
  assert.equal(dogMatches.length, 2, 'specific style plus generic companion fallback');
  assert.equal(dogMatches[0].params.cadence, 'trot');
  assert.equal(dogMatches[1].params.cadence, 'generic');
});

test('actor profiles expose kind, style, and family', () => {
  const config = compileConfig(raw);
  assert.deepEqual(actorProfile({ isCompanion: true, recipe: { style: 'skeleton' } }, config), {
    kind: 'companion',
    style: 'skeleton',
    family: 'creature-skeleton'
  });
  assert.deepEqual(actorProfile({ isPlayer: true, recipe: { style: 'voxel-art' } }, config), {
    kind: 'player',
    style: 'voxel-art',
    family: ''
  });
});

test('predicate evaluator supports every operator and is safe on missing facts', () => {
  const facts = {
    actor: { kind: 'npc', energy: 3, name: 'Ada', tags: ['calm', 'curious'] },
    pair: { greets: 2, activities: 0, friends: false },
    player: { distance: 9 }
  };

  assert.equal(evaluatePredicate({ eq: ['actor.kind', 'npc'] }, facts), true);
  assert.equal(evaluatePredicate({ neq: ['actor.kind', 'companion'] }, facts), true);
  assert.equal(evaluatePredicate({ lt: ['actor.energy', 4] }, facts), true);
  assert.equal(evaluatePredicate({ lte: ['actor.energy', 3] }, facts), true);
  assert.equal(evaluatePredicate({ gt: ['player.distance', 8] }, facts), true);
  assert.equal(evaluatePredicate({ gte: ['pair.greets', 2] }, facts), true);
  assert.equal(evaluatePredicate({ min: ['pair.greets', 2] }, facts), true);
  assert.equal(evaluatePredicate({ max: ['pair.activities', 1] }, facts), true);
  assert.equal(evaluatePredicate({ in: ['actor.kind', ['npc', 'companion']] }, facts), true);
  assert.equal(evaluatePredicate({ in: ['actor.kind', ['player']] }, facts), false);
  assert.equal(evaluatePredicate({ exists: 'actor.kind' }, facts), true);
  assert.equal(evaluatePredicate({ exists: ['actor.kind', 'pair.friends'] }, facts), true);
  assert.equal(evaluatePredicate({ exists: 'actor.missing' }, facts), false);

  assert.equal(evaluatePredicate({
    all: [
      { eq: ['actor.kind', 'npc'] },
      { any: [{ gte: ['pair.greets', 2] }, { eq: ['pair.friends', true] }] },
      { not: { gt: ['player.distance', 20] } }
    ]
  }, facts), true);

  assert.equal(evaluatePredicate({ eq: ['actor.missing', 'npc'] }, facts), false);
  assert.equal(evaluatePredicate({ neq: ['actor.missing', 'npc'] }, facts), true);
  assert.equal(evaluatePredicate({ lt: ['actor.missing', 3] }, facts), false);
  assert.equal(evaluatePredicate({ in: ['actor.missing', ['npc']] }, facts), false);
  assert.equal(evaluatePredicate({ not: { eq: ['actor.missing', 'npc'] } }, facts), true);

  assert.equal(evaluatePredicate({ eq: ['actor.kind', { $path: 'actor.name' }] }, facts), false);
  assert.equal(evaluatePredicate({ eq: ['actor.name', { $path: 'actor.name' }] }, facts), true);
  assert.throws(() => evaluatePredicate({ nope: ['a', 1] }, facts), /unknown predicate operator/);
});
