import test from 'node:test';
import assert from 'node:assert/strict';
import { occupantAtTile, reservationAtTile } from '../src/characters.js';
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

test('the game module loads', () => {
  assert.equal(typeof Game, 'function');
});
