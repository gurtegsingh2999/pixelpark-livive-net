import test from 'node:test';
import assert from 'node:assert/strict';
import { occupantAtTile, reservationAtTile, formatCompanionInfo, canCollide, spectatorOffsets } from '../src/characters.js';
import { DOWN, LEFT, RIGHT, UP, directionForStep, shouldMirror } from '../src/facing.js';
import { NPC_NAMES, VIBES, pickName, pickVibe } from '../src/names.js';
import { Game } from '../src/game.js';

const idle = { id: 'idle', x: 2, y: 3, moving: false };
const walker = { id: 'walker', x: 5, y: 5, moving: true, toX: 6, toY: 5 };

test('occupantAtTile only sees characters on the tile right now', () => {
  assert.equal(occupantAtTile([idle, walker], 2, 3), idle);
  assert.equal(occupantAtTile([idle, walker], 6, 5), null);
  assert.equal(occupantAtTile([idle, walker], 9, 9), null);
});

test('reservationAtTile reserves both current and destination tiles', () => {
  assert.equal(reservationAtTile([idle, walker], 5, 5), walker);
  assert.equal(reservationAtTile([idle, walker], 6, 5), walker);
  assert.equal(reservationAtTile([idle, walker], 7, 5), null);
});

test('reservations and occupancy honour exclusions', () => {
  assert.equal(occupantAtTile([idle], 2, 3, idle), null);
  assert.equal(reservationAtTile([walker], 6, 5, walker), null);
});

test('directionForStep maps movement to four directions', () => {
  assert.equal(directionForStep(0, 1), DOWN);
  assert.equal(directionForStep(1, 0), RIGHT);
  assert.equal(directionForStep(0, -1), UP);
  assert.equal(directionForStep(-1, 0), LEFT);
});

test('only rightward movement is mirrored', () => {
  assert.equal(shouldMirror(RIGHT), true);
  assert.equal(shouldMirror(LEFT), false);
  assert.equal(shouldMirror(UP), false);
  assert.equal(shouldMirror(DOWN), false);
});

test('pickName keeps names unique', () => {
  const used = new Set();
  const source = ['A', 'B', 'C'];
  assert.equal(pickName(used, source, () => 0), 'A');
  assert.equal(pickName(used, source, () => 0), 'B');
  assert.equal(pickName(new Set(source), source, () => 0), 'A 2');
  assert.ok(NPC_NAMES.length >= source.length);
});

test('pickVibe returns a known vibe', () => {
  assert.ok(VIBES.includes(pickVibe(() => 0)));
});

test('formatCompanionInfo formats companion name, class, and type', () => {
  const skel = formatCompanionInfo({ name: 'Bones', recipe: { style: 'skeleton-armor' } });
  assert.equal(skel.name, 'Bones');
  assert.equal(skel.class, 'Creature');
  assert.equal(skel.type, 'Skeleton Armor');
  assert.equal(skel.text, 'Bones, Creature, Skeleton Armor');

  const dog = formatCompanionInfo({ name: 'Rusty', recipe: { style: 'dog' } });
  assert.equal(dog.class, 'Pet');
  assert.equal(dog.type, 'Dog');
  assert.equal(dog.text, 'Rusty, Pet, Dog');

  const bot = formatCompanionInfo({ name: 'Spark', recipe: { style: 'voxel-bot' } });
  assert.equal(bot.class, 'Voxel Bot');
  assert.equal(bot.type, 'Robot');
  assert.equal(bot.text, 'Spark, Voxel Bot, Robot');
});

test('canCollide enforces player companion no-collision rule and asymmetric NPC companion rules', () => {
  const npc = { id: 'npc1', isPlayer: false, isCompanion: false };
  const otherNpc = { id: 'npc2', isPlayer: false, isCompanion: false };
  const player = { id: 'player', isPlayer: true, isCompanion: false };
  const npcCompanion = { id: 'comp1', buddyId: 'npc1', isPlayer: false, isCompanion: true };
  const otherNpcCompanion = { id: 'comp2', buddyId: 'npc2', isPlayer: false, isCompanion: true };
  const playerCompanion = { id: 'comp-player', buddyId: 'player', isPlayer: false, isCompanion: true };

  // Player's companions NEVER collide with anyone or anything
  assert.equal(canCollide(playerCompanion, player), false);
  assert.equal(canCollide(player, playerCompanion), false);
  assert.equal(canCollide(playerCompanion, npc), false);
  assert.equal(canCollide(npc, playerCompanion), false);
  assert.equal(canCollide(playerCompanion, npcCompanion), false);

  // Walking NPC is NOT blocked by an NPC companion (can walk through)
  assert.equal(canCollide(npc, npcCompanion), false);

  // NPC Companion IS blocked by an NPC (cannot walk through)
  assert.equal(canCollide(npcCompanion, npc), true);

  // NPC Companion is blocked by the player and other NPC companions
  assert.equal(canCollide(npcCompanion, player), true);
  assert.equal(canCollide(npcCompanion, otherNpcCompanion), true);

  // Player collides with NPC
  assert.equal(canCollide(player, npc), true);

  // NPCs collide with other NPCs and the player
  assert.equal(canCollide(npc, otherNpc), true);
  assert.equal(canCollide(npc, player), true);

  // Self cannot collide with self
  assert.equal(canCollide(npc, npc), false);
  assert.equal(canCollide(npcCompanion, npcCompanion), false);
});

test('spectatorOffsets alternates companions above and below the player', () => {
  assert.deepEqual(spectatorOffsets(0), []);
  assert.deepEqual(spectatorOffsets(1), [1]);
  assert.deepEqual(spectatorOffsets(2), [1, -1]);
  assert.deepEqual(spectatorOffsets(5), [1, -1, 2, -2, 3]);
});

test('the game module loads', () => {
  assert.equal(typeof Game, 'function');
});

test('addNpc properly tracks companion with buddy', () => {
  const game = new Game();
  game.terrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'g'));
  game.player = { x: 30, y: 30 };
  const rawNpc = { id: 'npc-test', name: 'Sam', recipe: { style: 'voxel-art' } };
  const rawComp = { id: 'comp-test', name: 'Rusty', buddyId: 'npc-test', recipe: { style: 'dog' } };

  const added = game.addNpc(rawNpc, rawComp);
  assert.equal(added.id, 'npc-test');
  assert.equal(game.npcs.length, 1);
  assert.equal(game.companions.length, 1);
  assert.equal(game.companions[0].id, 'comp-test');
  assert.equal(game.companions[0].buddyId, 'npc-test');
  assert.ok(Number.isFinite(game.companions[0].x));
  assert.ok(Number.isFinite(game.companions[0].y));
  assert.notEqual(game.companions[0].x, NaN);
  assert.notEqual(game.companions[0].y, NaN);
  // Ensure the NPC didn't spawn immediately under the player
  const distPlayerNpc = Math.abs(added.x - game.player.x) + Math.abs(added.y - game.player.y);
  assert.ok(distPlayerNpc >= 6, `Expected distance >= 6, got ${distPlayerNpc}`);
});

test('companions cheer with individual timing and turn in place', () => {
  const game = new Game();
  const player = { id: 'player', x: 30, y: 30 };
  game.player = player;
  game.companions = [
    game.makeCompanion({ id: 'comp-a', name: 'A', direction: RIGHT }, player),
    game.makeCompanion({ id: 'comp-b', name: 'B', direction: RIGHT }, player)
  ];

  game.triggerCheer('player', 1.4);

  for (const comp of game.companions) {
    assert.ok(comp.cheerTimer > 0);
    assert.ok(Number.isFinite(comp.cheerPhase));
    assert.ok(comp.cheerRate > 0);
    assert.ok(comp.cheerHeight > 0);
  }

  const comp = game.companions[0];
  comp.cheerTurnTimer = 0;
  comp.direction = RIGHT;
  game.updateCompanion(comp, 0.016);
  assert.ok([DOWN, LEFT, RIGHT].includes(comp.direction), 'cheer should turn in place');
  assert.ok(comp.cheerElapsed > 0, 'hop clock advances for the renderer');
  assert.ok(comp.cheerTurnTimer > 0);

  // Facing is restored once the cheer finishes.
  comp.cheerReturnDirection = LEFT;
  comp.cheerTimer = 0.01;
  game.updateCompanion(comp, 0.05);
  assert.equal(comp.cheerTimer, 0);
  assert.equal(comp.direction, LEFT);
});
