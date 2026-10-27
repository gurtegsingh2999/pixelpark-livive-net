import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_ACTION_NAMES,
  socialActions,
  createSocialActions,
  createNpcGameAdapter,
  bridgeBehaviorEvents,
  NPC_GAME_OPTIONS,
  NPC_GAME_IDS
} from '../src/behavior/actions/social.js';
import { SpeechBubbles } from '../src/ui/speech.js';

function makeCtx(overrides = {}) {
  const events = [];
  const friendships = [];
  const ctx = {
    actor: { id: 'npc-a', x: 5, y: 5 },
    target: { id: 'npc-b', x: 6, y: 5 },
    params: {},
    now: 0,
    dtMs: 100,
    elapsedMs: 0,
    durationMs: 900,
    memory: {},
    stateMemory: {},
    rng: () => 0.5,
    allowedGames: ['tic-tac-toe'],
    emit: (type, detail = {}) => events.push({ type, detail }),
    resolveFriendship: request => {
      friendships.push(request);
      return { ok: true, friends: false, reason: 'threshold' };
    },
    ...overrides
  };
  return { ctx, events, friendships };
}

function createFakeHost({ failStart = null, busy = false, autoClose = false } = {}) {
  const calls = {
    start: [],
    close: [],
    recordGameResult: 0,
    rollReward: 0,
    applyReward: 0,
    onGameEnd: 0,
    toasts: [],
    cheers: 0
  };
  const hooks = {
    recordGameResult() { calls.recordGameResult += 1; },
    rollReward() { calls.rollReward += 1; return { id: 'loot' }; },
    applyReward() { calls.applyReward += 1; return ['loot']; },
    onGameEnd() { calls.onGameEnd += 1; },
    onToast(message) { calls.toasts.push(message); },
    onCheer() { calls.cheers += 1; },
    onEvent() {}
  };

  let sequence = 0;
  let session = null;
  let state = busy
    ? { active: true, gameId: 'checkers', phase: 'playing', settled: false, outcome: null }
    : { active: false, gameId: null, phase: null, settled: false, outcome: null };

  const host = {
    hooks,
    get session() { return session; },
    isOpen: () => state.active,
    get activeGameId() { return state.gameId; },
    start(gameId, options = {}) {
      calls.start.push({ gameId, ...options });
      if (failStart) return { ok: false, reason: failStart, message: 'nope' };
      if (state.active) return { ok: false, reason: 'busy', activeGameId: state.gameId };
      sequence += 1;
      session = { id: `sess-${sequence}`, gameId, settled: false };
      state = { active: true, gameId, phase: 'playing', settled: false, outcome: null };
      return { ok: true, gameId, session, phase: 'playing' };
    },
    getState() { return { ...state }; },
    close(options = {}) {
      calls.close.push({ ...options });
      const previous = state;
      session = null;
      state = {
        active: false,
        gameId: previous.gameId,
        phase: 'closed',
        settled: false,
        outcome: options.outcome ?? previous.outcome ?? null
      };
      return { ok: true, gameId: previous.gameId, reason: options.reason, settlement: null };
    },
    getMeta(gameId) {
      return { id: gameId, title: gameId === 'tic-tac-toe' ? 'Tic-Tac-Toe' : gameId };
    },
    finishGame(outcome = 'draw') {
      state = {
        active: !autoClose,
        gameId: state.gameId,
        phase: 'ending',
        settled: true,
        outcome
      };
      if (session) session.settled = true;
      if (autoClose) session = null;
    }
  };

  return { host, calls, state: () => state, session: () => session };
}

test('exports the five social verbs for runtime extraActions', () => {
  assert.deepEqual([...SOCIAL_ACTION_NAMES], [
    'speak',
    'bubble',
    'startNpcGame',
    'awaitNpcGame',
    'resolveNpcFriendship'
  ]);
  for (const name of SOCIAL_ACTION_NAMES) {
    assert.equal(typeof socialActions[name], 'function', `${name} is available from the default set`);
  }
  assert.deepEqual([...NPC_GAME_IDS], ['tic-tac-toe']);
  assert.equal(NPC_GAME_OPTIONS.record, false);
  assert.equal(NPC_GAME_OPTIONS.reward, false);
  assert.equal(NPC_GAME_OPTIONS.settle, false);
  assert.equal(NPC_GAME_OPTIONS.suppressPlayer, true);
});

test('speak and bubble show a bubble once and emit a non-duplicating say event', () => {
  const bubbles = new SpeechBubbles();
  const actions = createSocialActions({ bubbles });
  const { ctx, events } = makeCtx({ params: { text: 'hi!', key: 'greet' } });

  assert.deepEqual(actions.speak(ctx), { done: false });
  assert.equal(bubbles.activeFor('npc-a').text, 'hi!');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'say');
  assert.equal(events[0].detail.bubble, false, 'bridge must not draw it twice');

  actions.speak(ctx);
  assert.equal(events.length, 1, 'state memory prevents repeats');

  ctx.stateMemory = {};
  ctx.params = { emote: 'wave' };
  actions.bubble(ctx);
  assert.equal(bubbles.activeFor('npc-a').text, '👋');
  assert.equal(events.length, 2);
  assert.equal(events[1].detail.visualOnly, true);
});

test('startNpcGame opens Tic-Tac-Toe with two AI seats and player settlement suppressed', () => {
  const { host, calls } = createFakeHost();
  const adapter = createNpcGameAdapter({ host });
  const actions = createSocialActions({ adapter });
  const { ctx, events } = makeCtx();

  const result = actions.startNpcGame(ctx);
  assert.equal(result.done, true);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'started');
  assert.match(result.token, /sess-1/);
  assert.equal(ctx.memory.npcGameStarted, true);
  assert.equal(ctx.memory.npcGameToken, result.token);

  assert.equal(calls.start.length, 1);
  const call = calls.start[0];
  assert.equal(call.gameId, 'tic-tac-toe');
  assert.deepEqual(call.controllers, ['ai', 'ai']);
  assert.equal(call.seats.length, 2);
  assert.equal(call.seats[0].character.id, 'npc-a');
  assert.equal(call.seats[1].character.id, 'npc-b');
  assert.equal(call.seats[0].controller, 'ai');
  assert.equal(call.seats[1].controller, 'ai');
  assert.equal(call.options.npc, true);
  assert.equal(call.options.record, false);
  assert.equal(call.options.reward, false);
  assert.equal(call.options.settle, false);
  assert.equal(call.options.dialogue, false);

  assert.equal(host.hooks.recordGameResult, undefined, 'stats hook fenced off');
  assert.equal(host.hooks.rollReward, undefined, 'reward hook fenced off');
  assert.equal(host.hooks.onGameEnd, undefined, 'end dialogue fenced off');
  assert.equal(host.hooks.onToast, undefined, 'player toasts fenced off');

  assert.equal(events.filter(event => event.type === 'game.start').length, 1);
  assert.equal(events[0].detail.npc, true);
  assert.equal(events[0].detail.ok, true);
});

test('startNpcGame rejects non-Tic-Tac-Toe games before touching the host', () => {
  const { host, calls } = createFakeHost();
  const adapter = createNpcGameAdapter({ host });
  const actions = createSocialActions({ adapter });

  const direct = adapter.start({ game: 'checkers', actor: { id: 'a' }, partner: { id: 'b' } });
  assert.deepEqual(direct, { ok: false, reason: 'not-allowed', game: 'checkers' });
  assert.equal(calls.start.length, 0);

  const { ctx, events } = makeCtx({ params: { game: 'checkers' } });
  const result = actions.startNpcGame(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'game-not-allowed');
  assert.equal(calls.start.length, 0);
  assert.equal(events[0].type, 'game.blocked');

  const restricted = createNpcGameAdapter({ host, allowedGames: ['checkers'] });
  assert.deepEqual(
    restricted.start({ game: 'tic-tac-toe', actor: { id: 'a' }, partner: { id: 'b' } }),
    { ok: false, reason: 'not-allowed', game: 'tic-tac-toe' }
  );
});

test('a busy host returns busy cleanly and leaves hooks untouched', () => {
  const { host, calls } = createFakeHost({ busy: true });
  const adapter = createNpcGameAdapter({ host });

  const result = adapter.start({ game: 'tic-tac-toe', actor: { id: 'a' }, partner: { id: 'b' } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'busy');
  assert.equal(calls.start.length, 0, 'pre-check avoids disturbing the open board');
  assert.equal(typeof host.hooks.recordGameResult, 'function');
  assert.equal(typeof host.hooks.onGameEnd, 'function');
});

test('host start failures are reported as { ok: false, reason }', () => {
  const { host, calls } = createFakeHost({ failStart: 'unknown-game' });
  const adapter = createNpcGameAdapter({ host });
  const result = adapter.start({ game: 'tic-tac-toe', actor: { id: 'a' }, partner: { id: 'b' } });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-game');
  assert.equal(result.message, 'nope');
  assert.equal(calls.start.length, 1);
  assert.equal(typeof host.hooks.recordGameResult, 'function');
});

test('NPC games reject a player seat', () => {
  const { host, calls } = createFakeHost();
  const adapter = createNpcGameAdapter({ host });
  const { ctx, events } = makeCtx({ target: { id: 'player', x: 6, y: 5, isPlayer: true } });

  const result = createSocialActions({ adapter }).startNpcGame(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-npc');
  assert.equal(calls.start.length, 0);
  assert.equal(events[0].detail.reason, 'not-npc');
});

test('awaitNpcGame emits game.end once and packs up without settlement', () => {
  const { host, calls } = createFakeHost();
  const adapter = createNpcGameAdapter({ host });
  const actions = createSocialActions({ adapter });
  const { ctx, events } = makeCtx({ params: { timeoutMs: 5000 } });

  actions.startNpcGame(ctx);
  assert.deepEqual(actions.awaitNpcGame(ctx), { done: false });

  host.finishGame('draw');
  const ended = actions.awaitNpcGame(ctx);
  assert.equal(ended.done, true);
  assert.equal(ended.reason, 'draw');

  const second = actions.awaitNpcGame(ctx);
  assert.equal(second.done, true);
  assert.equal(events.filter(event => event.type === 'game.end').length, 1, 'end fires once');
  assert.equal(events.filter(event => event.type === 'game.timeout').length, 0);

  assert.equal(calls.close.length, 1);
  assert.equal(calls.close[0].settle, false);
  assert.equal(calls.close[0].record, false);
  assert.equal(calls.close[0].reward, false);
  assert.equal(calls.close[0].outcome, 'draw');
  assert.equal(typeof host.hooks.recordGameResult, 'function', 'hooks restored after the session');
  assert.equal(typeof host.hooks.onGameEnd, 'function');
});

test('awaitNpcGame tolerates a host that already closed itself', () => {
  const { host, calls } = createFakeHost({ autoClose: true });
  const adapter = createNpcGameAdapter({ host });
  const actions = createSocialActions({ adapter });
  const { ctx, events } = makeCtx();

  actions.startNpcGame(ctx);
  host.finishGame('win');
  assert.equal(actions.awaitNpcGame(ctx).done, true);
  assert.equal(events.filter(event => event.type === 'game.end').length, 1);
  assert.equal(calls.close.length, 0, 'no double close');
  assert.equal(typeof host.hooks.recordGameResult, 'function');
});

test('awaitNpcGame times out from elapsedMs without timers and aborts only once', () => {
  const { host, calls } = createFakeHost();
  const adapter = createNpcGameAdapter({ host });
  const actions = createSocialActions({ adapter });
  const { ctx, events } = makeCtx({ params: { timeoutMs: 2000 } });

  actions.startNpcGame(ctx);
  ctx.elapsedMs = 1999;
  assert.equal(actions.awaitNpcGame(ctx).done, false);

  ctx.elapsedMs = 2000;
  const timedOut = actions.awaitNpcGame(ctx);
  assert.equal(timedOut.done, true);
  assert.equal(timedOut.reason, 'timeout');
  assert.equal(events.filter(event => event.type === 'game.timeout').length, 1);

  ctx.elapsedMs = 5000;
  actions.awaitNpcGame(ctx);
  assert.equal(events.filter(event => event.type === 'game.timeout').length, 1);
  assert.equal(events.filter(event => event.type === 'game.end').length, 0);
  assert.equal(calls.close.length, 1);
  assert.equal(calls.close[0].reason, 'npc-game-timeout');
  assert.equal(calls.close[0].settle, false);
});

test('awaitNpcGame with no session token is a clean no-op', () => {
  const actions = createSocialActions();
  const { ctx, events } = makeCtx();
  assert.deepEqual(actions.awaitNpcGame(ctx), { done: true, reason: 'no-game' });
  assert.equal(events.length, 0);
});

test('resolveNpcFriendship is a thin, idempotent wrapper around the injected resolver', () => {
  const actions = createSocialActions();
  const { ctx, events, friendships } = makeCtx({ params: { interaction: 'greet' } });

  const result = actions.resolveNpcFriendship(ctx);
  assert.equal(result.done, true);
  assert.equal(result.reason, 'threshold');
  assert.equal(friendships.length, 1);
  assert.deepEqual(friendships[0].interaction, 'greet');
  assert.equal(events.filter(event => event.type === 'friendship.resolve').length, 1);

  actions.resolveNpcFriendship(ctx);
  assert.equal(friendships.length, 1, 'resolved once per state');
  assert.equal(events.filter(event => event.type === 'friendship.resolve').length, 1);

  const playerCtx = makeCtx({ target: { id: 'player', isPlayer: true } });
  assert.equal(actions.resolveNpcFriendship(playerCtx.ctx).reason, 'not-npc');
});

test('bridgeBehaviorEvents turns say/emote into bubbles and games into toasts', () => {
  const { host } = createFakeHost();
  const bubbles = new SpeechBubbles();
  const toasts = [];
  const starts = [];
  const ends = [];
  const runtime = { onEvent: null };
  const bridge = bridgeBehaviorEvents(runtime, bubbles, {
    host,
    onToast: message => toasts.push(message),
    onGameStart: detail => starts.push(detail.game),
    onGameEnd: detail => ends.push(detail.game)
  });

  runtime.onEvent({ type: 'say', detail: { actorId: 'npc-a', text: 'hi!', key: 'greet' } });
  assert.equal(bubbles.activeFor('npc-a').text, 'hi!');
  assert.equal(bubbles.activeFor('npc-a').key, 'greet');

  runtime.onEvent({ type: 'say', detail: { actorId: 'npc-a', text: 'ignored', bubble: false } });
  assert.equal(bubbles.activeFor('npc-a').text, 'hi!', 'already-rendered speaks are skipped');

  runtime.onEvent({ type: 'emote', detail: { actorId: 'npc-b', emote: 'wave' } });
  assert.equal(bubbles.activeFor('npc-b').text, '👋');

  runtime.onEvent({ type: 'game.start', detail: { game: 'tic-tac-toe', ok: true } });
  runtime.onEvent({ type: 'game.end', detail: { game: 'tic-tac-toe', outcome: 'draw' } });
  runtime.onEvent({ type: 'game.timeout', detail: { game: 'tic-tac-toe' } });

  assert.deepEqual(toasts, [
    'Tic-Tac-Toe started',
    'Tic-Tac-Toe finished · draw',
    'Tic-Tac-Toe timed out'
  ]);
  assert.deepEqual(starts, ['tic-tac-toe']);
  assert.deepEqual(ends, ['tic-tac-toe', 'tic-tac-toe']);

  bridge.detach();
  assert.equal(runtime.onEvent, null, 'restores the previous handler');
});

test('bridge composes an existing handler and can be detached', () => {
  const bubbles = new SpeechBubbles();
  const seen = [];
  const previous = entry => seen.push(entry.type);
  const runtime = { onEvent: previous };
  const bridge = bridgeBehaviorEvents(runtime, bubbles);

  runtime.onEvent({ type: 'say', detail: { actorId: 'npc-a', text: 'hello' } });
  assert.deepEqual(seen, ['say']);
  assert.equal(bubbles.activeFor('npc-a').text, 'hello');
  bridge.detach();
  assert.equal(runtime.onEvent, previous);
});

test('bridge can be used as a plain handler without a runtime', () => {
  const bubbles = new SpeechBubbles();
  const bridge = bridgeBehaviorEvents(null, bubbles);
  bridge.handle({ type: 'say', detail: { actorId: 'npc-a', text: 'direct', x: 3, y: 4 } });
  assert.equal(bubbles.activeFor('npc-a').text, 'direct');
  assert.equal(bridge.detach(), undefined);
  assert.equal(bridge.handle(null), null);
});
