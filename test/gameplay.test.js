import test from 'node:test';
import assert from 'node:assert/strict';
import { occupantAtTile, reservationAtTile, formatCompanionInfo, canCollide } from '../src/characters.js';
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

test('canCollide enforces asymmetric companion collision exclusion rule', () => {
  const npc = { id: 'npc1', isPlayer: false, isCompanion: false };
  const otherNpc = { id: 'npc2', isPlayer: false, isCompanion: false };
  const player = { id: 'player', isPlayer: true, isCompanion: false };
  const companion = { id: 'comp1', isPlayer: false, isCompanion: true };
  const otherCompanion = { id: 'comp2', isPlayer: false, isCompanion: true };

  // Walking NPC is NOT blocked by a companion (can walk through)
  assert.equal(canCollide(npc, companion), false);

  // Companion IS blocked by an NPC (cannot walk through)
  assert.equal(canCollide(companion, npc), true);

  // Companion is blocked by the player and other companions
  assert.equal(canCollide(companion, player), true);
  assert.equal(canCollide(companion, otherCompanion), true);

  // Player collides with NPC and companion (initiates dialogue)
  assert.equal(canCollide(player, npc), true);
  assert.equal(canCollide(player, companion), true);

  // NPCs collide with other NPCs and the player
  assert.equal(canCollide(npc, otherNpc), true);
  assert.equal(canCollide(npc, player), true);

  // Self cannot collide with self
  assert.equal(canCollide(npc, npc), false);
  assert.equal(canCollide(companion, companion), false);
});

test('the game module loads', () => {
  assert.equal(typeof Game, 'function');
});
