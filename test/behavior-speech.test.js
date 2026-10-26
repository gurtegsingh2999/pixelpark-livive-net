import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeechBubbles,
  createSpeechBubbles,
  DEFAULT_BUBBLE_DURATION_MS
} from '../src/ui/speech.js';

function fakeCanvas() {
  const calls = {
    save: 0,
    restore: 0,
    roundRects: [],
    rects: [],
    text: [],
    measures: 0,
    fills: 0,
    strokes: 0,
    paths: 0
  };
  const ctx = {
    globalAlpha: 1,
    fillRect() {},
    save() { calls.save += 1; },
    restore() { calls.restore += 1; },
    beginPath() { calls.paths += 1; },
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect(x, y, width, height) { calls.rects.push({ x, y, width, height }); },
    roundRect(x, y, width, height, radius) { calls.roundRects.push({ x, y, width, height, radius }); },
    fill() { calls.fills += 1; },
    stroke() { calls.strokes += 1; },
    fillText(text, x, y) { calls.text.push({ text, x, y }); },
    measureText(text) {
      calls.measures += 1;
      return { width: text.length * 6 };
    }
  };
  return { ctx, calls };
}

test('shows one bubble per actor and replaces older text', () => {
  const bubbles = createSpeechBubbles();
  const shown = bubbles.show({ actorId: 'npc-a', text: '  hi   there  ', durationMs: 1200 });

  assert.equal(shown.actorId, 'npc-a');
  assert.equal(shown.text, 'hi there', 'whitespace is normalised');
  assert.equal(shown.durationMs, 1200);
  assert.equal(bubbles.activeFor('npc-a').text, 'hi there');
  assert.equal(bubbles.list().length, 1);

  bubbles.show({ actorId: 'npc-a', text: 'again' });
  assert.equal(bubbles.list().length, 1);
  assert.equal(bubbles.activeFor('npc-a').text, 'again');
  assert.equal(bubbles.activeFor('npc-b'), null);
});

test('update expires bubbles after their duration', () => {
  const bubbles = new SpeechBubbles({ defaultDurationMs: 1000 });
  bubbles.show({ actorId: 'npc-a', text: 'hello' });
  bubbles.show({ actorId: 'npc-b', text: 'yo', durationMs: 2000 });

  assert.equal(bubbles.update(999).length, 2);
  assert.equal(bubbles.activeFor('npc-a').remainingMs, 1);
  assert.equal(bubbles.update(1).length, 1);
  assert.equal(bubbles.activeFor('npc-a'), null);
  assert.equal(bubbles.activeFor('npc-b').text, 'yo');

  assert.throws(() => bubbles.update(-1), TypeError);
  assert.throws(() => bubbles.update(Number.NaN), TypeError);
});

test('bubble count is bounded by maxBubbles, oldest first out', () => {
  const bubbles = new SpeechBubbles({ maxBubbles: 3 });
  for (const id of ['a', 'b', 'c', 'd']) bubbles.show({ actorId: id, text: `from ${id}` });

  assert.deepEqual(bubbles.list().map(bubble => bubble.actorId), ['b', 'c', 'd']);
  assert.equal(bubbles.snapshot().maxBubbles, 3);
  assert.equal(bubbles.snapshot().version, 1);
  assert.deepEqual(bubbles.snapshot().bubbles.map(bubble => bubble.actorId), ['b', 'c', 'd']);
});

test('clear removes one actor or all actors', () => {
  const bubbles = new SpeechBubbles();
  bubbles.show({ actorId: 'a', text: 'one' });
  bubbles.show({ actorId: 'b', text: 'two' });

  assert.equal(bubbles.clear('a'), 1);
  assert.equal(bubbles.activeFor('a'), null);
  assert.equal(bubbles.clear(), 1);
  assert.equal(bubbles.list().length, 0);
});

test('blank text and missing actor ids are ignored', () => {
  const bubbles = new SpeechBubbles();
  assert.equal(bubbles.show({ actorId: 'a', text: '   ' }), null);
  assert.equal(bubbles.show({ text: 'hello' }), null);
  assert.equal(bubbles.list().length, 0);
});

test('text is capped and rendered on at most two lines', () => {
  const bubbles = new SpeechBubbles();
  const longText = 'hello there this is a very long speech bubble line that should wrap and then be cut off';
  const bubble = bubbles.show({ actorId: 'npc-a', text: longText, x: 5, y: 5 });

  assert.ok(bubble.text.length <= 140);
  const { ctx, calls } = fakeCanvas();
  assert.equal(bubbles.render(ctx), 1);
  assert.equal(calls.roundRects.length, 1, 'uses roundRect when available');
  assert.equal(calls.text.length, 2, 'max two lines');
  assert.ok(calls.text.some(line => line.text.endsWith('…')), 'overflow is ellipsized');
});

test('render resolves live actor positions through getActor', () => {
  const actor = { id: 'npc-a', x: 2, y: 3 };
  const bubbles = new SpeechBubbles({ getActor: id => (id === actor.id ? actor : null) });
  bubbles.show({ actorId: 'npc-a', text: 'hi!', x: 1, y: 1 });

  const { ctx, calls } = fakeCanvas();
  assert.equal(bubbles.render(ctx, { tileSize: 40 }), 1);
  const first = calls.roundRects[0];
  assert.ok(first.x < 100 && first.x > 60, 'centred over live tile x=2');
  assert.ok(first.y < 130, 'drawn above the actor');

  actor.x = 10;
  bubbles.render(ctx, { tileSize: 40 });
  const second = calls.roundRects[1];
  assert.ok(second.x > first.x + 200, 'bubble follows the actor');
});

test('show-time coordinates are used when the actor is not resolvable', () => {
  const bubbles = new SpeechBubbles({ getActor: () => null });
  bubbles.show({ actorId: 'npc-a', text: 'here', x: 4, y: 6 });

  const { ctx, calls } = fakeCanvas();
  assert.equal(bubbles.render(ctx, { tileSize: 32 }), 1);
  const box = calls.roundRects[0];
  assert.ok(Math.abs((box.x + box.width / 2) - 4.5 * 32) < 1);
});

test('bubbles without any position are skipped', () => {
  const bubbles = new SpeechBubbles();
  bubbles.show({ actorId: 'npc-a', text: 'nowhere' });

  const { ctx, calls } = fakeCanvas();
  assert.equal(bubbles.render(ctx), 0);
  assert.equal(calls.roundRects.length, 0);
  assert.equal(calls.text.length, 0);
});

test('screen-space rendering applies the camera and clamps to view bounds', () => {
  const bubbles = new SpeechBubbles({ maxWidth: 152 });
  bubbles.show({ actorId: 'npc-a', text: 'a fairly long line of text', x: 2, y: 3 });
  const { ctx, calls } = fakeCanvas();

  assert.equal(bubbles.render(ctx, {
    worldSpace: false,
    camera: { x: 20, y: 10 },
    tileSize: 40,
    width: 120
  }), 1);
  const box = calls.roundRects[0];
  assert.equal(box.x, 4, 'clamped inside the viewport');
  assert.ok(calls.text[0].x < 120);
});

test('render restores the context and tolerates a minimal fake canvas', () => {
  const bubbles = new SpeechBubbles();
  bubbles.show({ actorId: 'npc-a', text: 'hi', x: 1, y: 1 });

  const noRoundRect = {
    fillRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect() { this.rected = true; },
    fill() {},
    stroke() {},
    fillText() {},
    measureText: text => ({ width: text.length * 5 })
  };
  assert.equal(bubbles.render(noRoundRect), 1);
  assert.equal(noRoundRect.rected, true);

  assert.equal(bubbles.render(null), 0);
  assert.equal(bubbles.render({}), 0);
});

test('snapshot and default duration are stable for debug panels', () => {
  const bubbles = new SpeechBubbles();
  const bubble = bubbles.show({ actorId: 'npc-a', text: 'hello', key: 'greet' });
  assert.equal(bubble.durationMs, DEFAULT_BUBBLE_DURATION_MS);
  assert.equal(bubble.key, 'greet');

  const snapshot = bubbles.snapshot();
  assert.equal(snapshot.now, 0);
  assert.equal(snapshot.bubbles[0].actorId, 'npc-a');
  assert.equal(typeof bubbles.setActorResolver, 'function');
});
