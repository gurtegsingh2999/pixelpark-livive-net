import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeSave, loadSave, clearSave, STORAGE_KEY } from '../src/storage.js';

test('serializeSave handles empty or uninitialized game', () => {
  assert.equal(serializeSave(null, null, new Set()), null);
  assert.equal(serializeSave({}, null, new Set()), null);
});

test('serializeSave accurately serializes game state', () => {
  const fakeTerrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
  const fakeGame = {
    worldSeed: 'test-seed',
    terrain: fakeTerrain,
    wander: true,
    player: {
      name: 'Tester',
      recipe: { seed: 'p-seed', look: {} },
      x: 10,
      y: 12,
      direction: 1
    },
    npcs: [
      {
        id: 'npc-1',
        name: 'Pip',
        recipe: { seed: 'n-seed', look: {} },
        vibe: 'Friendly',
        x: 14,
        y: 15,
        direction: 0
      }
    ]
  };
  const fakeDraft = {};
  const friends = new Set(['npc-1']);

  const save = serializeSave(fakeGame, fakeDraft, friends);
  assert.equal(save.version, 1);
  assert.equal(save.worldSeed, 'test-seed');
  assert.equal(save.playerName, 'Tester');
  assert.equal(save.player.x, 10);
  assert.equal(save.player.y, 12);
  assert.equal(save.npcs.length, 1);
  assert.equal(save.npcs[0].id, 'npc-1');
  assert.deepEqual(save.friends, ['npc-1']);
  assert.equal(save.wander, true);
});
