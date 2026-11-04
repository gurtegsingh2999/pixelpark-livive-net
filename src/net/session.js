import { createClockOffset } from './clock.js';
import { createRateWindow, motionFromMessage, sanitizeMessage } from './protocol.js';

function axis(character) {
  return {
    dx: Math.sign(character.toX - character.fromX),
    dy: Math.sign(character.toY - character.fromY)
  };
}

function stepBody(character) {
  const { dx, dy } = axis(character);
  return {
    fromX: character.fromX,
    fromY: character.fromY,
    dx,
    dy,
    teleport: character.motionStyle === 'teleport',
    dur: character.duration,
    motion: character.motionStyle === 'teleport' ? 'teleport' : null,
    arrive: Number.isFinite(character.motionArriveAt) ? character.motionArriveAt : 1
  };
}

export function poseFromCharacter(character) {
  return {
    id: character.id,
    x: character.moving ? character.fromX : character.x,
    y: character.moving ? character.fromY : character.y,
    toX: character.moving ? character.toX : character.x,
    toY: character.moving ? character.toY : character.y,
    dir: character.direction || 0,
    dur: character.duration,
    moving: Boolean(character.moving),
    motion: character.motionStyle === 'teleport' ? 'teleport' : null,
    arrive: Number.isFinite(character.motionArriveAt) ? character.motionArriveAt : 1
  };
}

/**
 * Coalesce actor poses so a crowd stays under the inbound message cap.
 * Call `flush` on a timer (the bridge uses poseFlushMs).
 */
export function createPoseBatch(send) {
  const pending = new Map();
  return {
    note(pose) {
      if (!pose?.id) return;
      pending.set(pose.id, pose);
    },
    flush() {
      if (!pending.size) return false;
      const actors = [...pending.values()];
      pending.clear();
      send({ t: 'poses', actors });
      return true;
    },
    get size() {
      return pending.size;
    }
  };
}

export function createHostSession({ room, send, now = () => 0, hooks = {} } = {}) {
  const limit = createRateWindow();
  let guest = null;

  function emit(message) {
    send(message);
  }

  function receive(raw, at = now()) {
    const message = sanitizeMessage(raw);
    if (!message) return;
    if (message.t !== 'ping' && message.t !== 'pong' && !limit.allow(at)) return;
    if (message.t === 'join') {
      const result = room.join(message);
      if (!result.ok) {
        emit({ t: 'full' });
        return;
      }
      guest = message;
      room.finish('host');
      emit({
        t: 'welcome',
        hostNow: now(),
        spawn: result.spawn,
        companion: result.companion,
        snapshot: room.snapshot()
      });
      hooks.onGuest?.({ ...result, name: message.name, recipe: message.recipe });
      return;
    }
    if (message.t === 'step') {
      const result = room.step('guest', message);
      if (!result.ok) {
        emit({ t: 'step-no', seq: message.seq, x: result.x, y: result.y, toX: result.x, toY: result.y, moving: false, at: now() });
        return;
      }
      const notice = {
        t: 'step-ok',
        seq: message.seq,
        id: 'guest',
        ...result,
        dur: message.dur,
        motion: message.motion,
        arrive: message.arrive,
        at: now(),
        moving: true
      };
      emit(notice);
      hooks.onGuestStep?.(notice);
      return;
    }
    if (message.t === 'poses') {
      for (const pose of message.actors) {
        const applied = room.pose(pose, 'guest');
        if (applied.ok) hooks.onPose?.(pose);
      }
      return;
    }
    if (message.t === 'say') {
      if (!message.text) return;
      hooks.onSay?.('guest', message.text);
      return;
    }
    if (message.t === 'lock') {
      const result = room.lock(message.id, 'guest');
      emit({ t: 'lock-result', id: message.id, ok: result.ok, by: 'guest' });
      if (result.ok) hooks.onLock?.({ id: message.id, by: 'guest', on: true });
      return;
    }
    if (message.t === 'unlock') {
      room.unlock(message.id, 'guest');
      hooks.onLock?.({ id: message.id, by: 'guest', on: false });
      return;
    }
    if (message.t === 'ping') {
      emit({ t: 'pong', n: message.n, at: message.at, replyAt: now() });
      return;
    }
    if (message.t === 'bye') hooks.onBye?.();
  }

  return {
    receive,
    commitLocalStep(character) {
      const body = stepBody(character);
      const result = room.step('host', body);
      if (!result.ok) return result;
      emit({
        t: 'move',
        id: 'host',
        ...result,
        dur: body.dur,
        motion: body.motion,
        arrive: body.arrive,
        at: now(),
        moving: true
      });
      if (result.toX !== character.toX || result.toY !== character.toY) {
        character.toX = result.toX;
        character.toY = result.toY;
        character.direction = result.dir;
      }
      return result;
    },
    notePose(character) {
      const pose = poseFromCharacter(character);
      const applied = room.pose(pose, 'host');
      return applied.ok ? pose : null;
    },
    say(text) {
      emit({ t: 'say', text });
    },
    lock(npcId) {
      const result = room.lock(npcId, 'host');
      if (result.ok) emit({ t: 'lock-result', id: npcId, ok: true, by: 'host' });
      return result;
    },
    unlock(npcId) {
      room.unlock(npcId, 'host');
      emit({ t: 'lock-result', id: npcId, ok: false, by: 'host' });
    },
    finish(id) {
      room.finish(id);
    },
    bye() {
      emit({ t: 'bye' });
    },
    get guest() {
      return guest;
    }
  };
}

export function createGuestSession({ send, now = () => 0, hooks = {} } = {}) {
  const clock = createClockOffset();
  const limit = createRateWindow();
  let seq = 0;
  let pending = null;
  let pingN = 0;

  function emit(message) {
    send(message);
  }

  function clearPending() {
    pending = null;
  }

  function receive(raw, at = now()) {
    const message = sanitizeMessage(raw);
    if (!message) return;
    if (message.t !== 'ping' && message.t !== 'pong' && !limit.allow(at)) return;
    if (message.t === 'welcome') {
      hooks.onWelcome?.(message);
      return;
    }
    if (message.t === 'full' || message.t === 'bye') {
      clearPending();
      hooks.onBye?.(message.t);
      return;
    }
    if (message.t === 'step-ok') {
      const expected = pending;
      if (!expected || message.seq !== expected.seq) return;
      clearPending();
      if (expected.toX !== message.toX || expected.toY !== message.toY) {
        hooks.onSnap?.(message.toX, message.toY);
      }
      return;
    }
    if (message.t === 'step-no') {
      if (!pending || message.seq !== pending.seq) return;
      clearPending();
      hooks.onSnap?.(message.x, message.y);
      return;
    }
    if (message.t === 'move') {
      hooks.onRemote?.(message);
      return;
    }
    if (message.t === 'poses') {
      for (const pose of message.actors) hooks.onPose?.(pose);
      return;
    }
    if (message.t === 'say') {
      if (message.text) hooks.onSay?.('host', message.text);
      return;
    }
    if (message.t === 'lock-result') {
      hooks.onLock?.({ id: message.id, by: message.by, on: message.ok });
      return;
    }
    if (message.t === 'pong') {
      clock.note({ sentAt: message.at, hostAt: message.replyAt, receivedAt: at });
      hooks.onSync?.();
    }
  }

  return {
    receive,
    clock,
    canStep() {
      return pending == null;
    },
    join(appearance) {
      emit({ t: 'join', ...appearance });
    },
    predictFromCharacter(character) {
      if (pending) {
        return { ok: false, reason: 'pending', x: character.fromX, y: character.fromY };
      }
      const body = stepBody(character);
      seq += 1;
      pending = { seq, toX: character.toX, toY: character.toY };
      emit({ t: 'step', seq, ...body });
      return { ok: true, seq };
    },
    notePose(character) {
      return poseFromCharacter(character);
    },
    say(text) {
      emit({ t: 'say', text });
    },
    lock(npcId) {
      emit({ t: 'lock', id: npcId });
    },
    unlock(npcId) {
      emit({ t: 'unlock', id: npcId });
    },
    ping(at = now()) {
      pingN += 1;
      emit({ t: 'ping', n: pingN, at });
    },
    bye() {
      emit({ t: 'bye' });
    },
    motion(message, localNow = now()) {
      return motionFromMessage(message, {
        localNow,
        offset: clock.offset,
        synced: clock.synced
      });
    }
  };
}
