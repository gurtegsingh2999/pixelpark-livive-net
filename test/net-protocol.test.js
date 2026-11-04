import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSay,
  createAssembler,
  createRateWindow,
  decodeSignalPlain,
  encodeSignalPlain,
  frameMessage,
  motionFromMessage,
  sanitizeMessage,
  shouldPersistSave
} from '../src/net/protocol.js';
import { createClockOffset } from '../src/net/clock.js';
import { createGuestSession, createPoseBatch } from '../src/net/session.js';

test('guest saves stay frozen and host saves keep writing', () => {
  assert.equal(shouldPersistSave('guest'), false);
  assert.equal(shouldPersistSave('host'), true);
  assert.equal(shouldPersistSave(null), true);
});

test('say text is trimmed to the bubble cap', () => {
  assert.equal(clampSay('  hello   park  '), 'hello park');
  assert.equal(clampSay('a'.repeat(200)).length, 140);
  assert.equal(clampSay('hey\u0000there'), 'hey there');
});

test('offer codes round-trip without a signaling server', () => {
  const offer = { kind: 'offer', type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' };
  const code = encodeSignalPlain(offer);
  assert.match(code, /^pp1\./);
  assert.deepEqual(decodeSignalPlain(code), offer);
  assert.equal(decodeSignalPlain('nope'), null);
  assert.equal(decodeSignalPlain('pp1.%%%'), null);
});

test('large welcomes split into chunks and come back together', () => {
  const welcome = { t: 'welcome', snapshot: { terrain: 'g'.repeat(4096), note: 'x'.repeat(9000) } };
  const frames = frameMessage(welcome, 7000);
  assert.ok(frames.length > 1);
  assert.equal(frames[0].t, 'chunk');
  const assemble = createAssembler();
  let done = null;
  for (const frame of frames) done = assemble(frame);
  assert.equal(done.snapshot.terrain.length, 4096);
  assert.equal(done.snapshot.note.length, 9000);
});

test('rate window ignores a burst past the cap', () => {
  const window = createRateWindow({ limit: 3, horizonMs: 1000 });
  assert.equal(window.allow(0), true);
  assert.equal(window.allow(10), true);
  assert.equal(window.allow(20), true);
  assert.equal(window.allow(30), false);
  assert.equal(window.allow(1000), true);
});

test('clock offset maps host time onto the guest clock', () => {
  const clock = createClockOffset();
  clock.note({ sentAt: 1000, receivedAt: 1100, hostAt: 5000 });
  assert.equal(clock.synced, true);
  assert.equal(clock.offset, 3950);
  assert.equal(clock.hostToLocal(5000), 1050);
});

test('remote steps play from arrival until the clock is synced', () => {
  const fresh = motionFromMessage(
    { x: 1, y: 2, toX: 2, toY: 2, dir: 1, dur: 0.18, at: 5000, moving: true },
    { localNow: 100, offset: 0, synced: false }
  );
  assert.equal(fresh.elapsed, 0);
  assert.equal(fresh.moving, true);
  assert.equal(fresh.toX, 2);

  const late = motionFromMessage(
    { x: 1, y: 2, toX: 2, toY: 2, dir: 1, dur: 0.18, at: 5000, moving: true },
    { localNow: 1200, offset: 3950, synced: true }
  );
  assert.ok(late.elapsed > 0);
  assert.equal(late.moving, true);
});

test('a step message keeps one cardinal tile and drops junk', () => {
  const step = sanitizeMessage({
    t: 'step',
    seq: 2,
    fromX: 4,
    fromY: 5,
    dx: 1,
    dy: 0,
    teleport: false,
    dur: 0.18
  });
  assert.equal(step.dx, 1);
  assert.equal(step.dy, 0);
  assert.equal(sanitizeMessage({ t: 'step', seq: 1, fromX: 1, fromY: 1, dx: 1, dy: 1 }), null);
  assert.equal(sanitizeMessage({ t: 'nope' }), null);
});

test('guest prediction keeps a single step in flight', () => {
  const sent = [];
  const snaps = [];
  const session = createGuestSession({
    send: message => sent.push(message),
    now: () => 0,
    hooks: { onSnap: (x, y) => snaps.push([x, y]) }
  });
  const character = {
    fromX: 3,
    fromY: 4,
    toX: 4,
    toY: 4,
    duration: 0.18,
    motionStyle: null,
    motionArriveAt: 1
  };
  assert.equal(session.predictFromCharacter(character).ok, true);
  assert.equal(session.canStep(), false);
  assert.equal(session.predictFromCharacter(character).reason, 'pending');
  session.receive({ t: 'step-no', seq: 1, x: 3, y: 4, toX: 3, toY: 4 });
  assert.deepEqual(snaps, [[3, 4]]);
  assert.equal(session.canStep(), true);
});

test('pose batches collapse to one message', () => {
  const sent = [];
  const batch = createPoseBatch(message => sent.push(message));
  batch.note({ id: 'npc-a', x: 1, y: 1, toX: 2, toY: 1 });
  batch.note({ id: 'npc-a', x: 1, y: 1, toX: 1, toY: 2 });
  batch.note({ id: 'npc-b', x: 4, y: 4, toX: 4, toY: 5 });
  assert.equal(batch.flush(), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].actors.length, 2);
  assert.equal(sent[0].actors[0].toY, 2);
  assert.equal(batch.flush(), false);
});
