import netConfig from '../../data/net_config.json' with { type: 'json' };
import { preloadAvatars } from '../avatar.js';
import { decodeTerrain, generateWorld } from '../world.js';
import { createPeerLink, decodeSignal } from './link.js';
import { clampSay, motionFromMessage } from './protocol.js';
import { createRoom, parkActors } from './room.js';
import {
  createGuestSession,
  createHostSession,
  createPoseBatch,
  poseFromCharacter
} from './session.js';

const $ = id => document.getElementById(id);

/**
 * Host-tab room plus the paste-a-code link. Solo play never opens a socket.
 */
export function createNetBridge({
  getGame,
  getBubbles,
  showToast,
  isMiniGameOpen,
  captureSave,
  applyState,
  closeMenu,
  beginDialogue
} = {}) {
  let role = null;
  let phase = 'idle';
  let link = null;
  let room = null;
  let hostSession = null;
  let guestSession = null;
  let poses = null;
  let poseTimer = 0;
  let pingTimer = 0;
  let lockTimer = 0;
  let connectTimer = 0;
  let pendingLock = null;
  let guestSave = null;
  let tearing = false;
  let channelOpen = false;
  let generation = 0;

  function game() {
    return getGame?.() || null;
  }

  function toast(message) {
    showToast?.(message);
  }

  function setStatus(text) {
    const status = $('together-status');
    if (status) status.textContent = text;
  }

  function showPanel() {
    closeMenu?.();
    const panel = $('together-panel');
    const toggle = $('together-toggle');
    if (panel) panel.hidden = false;
    if (toggle) {
      toggle.classList.add('active-tab');
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  function hidePanel() {
    const panel = $('together-panel');
    const toggle = $('together-toggle');
    if (panel) panel.hidden = true;
    if (toggle) {
      toggle.classList.remove('active-tab');
      toggle.setAttribute('aria-expanded', 'false');
    }
  }

  function setPhase(next) {
    phase = next;
    refreshControls();
  }

  function refreshControls() {
    const sayRow = $('together-say-row');
    if (sayRow) sayRow.hidden = phase !== 'open';
    const leave = $('together-leave');
    if (leave) leave.hidden = phase === 'idle';
    const hostButton = $('together-host');
    if (hostButton) hostButton.hidden = phase !== 'idle';
  }

  function arm(nextRole) {
    const live = game();
    if (!live) return;
    role = nextRole;
    live.netRole = nextRole;
    live.netCanStep = () => nextRole !== 'guest' || Boolean(guestSession?.canStep());
    live.onNetMove = onNetMove;
    live.onActorArrived = onActorArrived;
  }

  function disarm() {
    const live = game();
    role = null;
    if (!live) return;
    live.netRole = null;
    live.netCanStep = null;
    live.onNetMove = null;
    live.onActorArrived = null;
    live.clearRemotePeer?.();
  }

  function onNetMove(character) {
    const live = game();
    if (!live) return { ok: true };
    if (character === live.player) {
      if (role === 'host' && hostSession) return hostSession.commitLocalStep(character);
      if (role === 'guest' && channelOpen && guestSession) return guestSession.predictFromCharacter(character);
      return { ok: true };
    }
    if (!live.simulates(character)) return { ok: true };
    if (role === 'host' && hostSession) {
      const noted = hostSession.notePose(character);
      if (channelOpen && noted) {
        noted.at = performance.now();
        poses?.note(noted);
      }
      return { ok: true };
    }
    if (role === 'guest' && channelOpen) {
      const pose = poseFromCharacter(character);
      pose.at = performance.now();
      poses?.note(pose);
    }
    return { ok: true };
  }

  function onActorArrived(character) {
    if (role !== 'host' || !hostSession) return;
    const live = game();
    if (character === live?.player) hostSession.finish('host');
    else if (character === live?.remotePlayer) hostSession.finish('guest');
    else hostSession.finish(character.id);
  }

  function showMotion(character, message, peerClock) {
    if (!character) return;
    const motion = peerClock
      ? guestSession.motion(message, performance.now())
      : motionFromMessage(message, { localNow: performance.now(), offset: 0, synced: false });
    game()?.applyNetMotion(character, motion);
  }

  function markLocked(id, on) {
    const npc = game()?.npcs?.find(entry => entry.id === id);
    if (npc) npc.inDialogue = Boolean(on);
  }

  function bubble(actorId, text) {
    getBubbles?.()?.show?.({ actorId, text });
  }

  function localAppearance() {
    const live = game();
    const player = live?.player;
    if (!player) return null;
    const companion = (live.companions || []).find(comp =>
      comp && !comp.remoteOwned && (comp.buddyId === 'player' || comp.buddyId === player.id)
    );
    return {
      name: player.name,
      recipe: player.recipe,
      companion: companion
        ? { id: companion.id, name: companion.name, recipe: companion.recipe }
        : null
    };
  }

  function carriedGear() {
    const live = game();
    const player = live?.player;
    const companion = (live?.companions || []).find(comp =>
      comp && !comp.remoteOwned && (comp.buddyId === 'player' || comp.buddyId === player?.id)
    );
    return {
      inventory: player?.inventory || [],
      equipped: player?.equipped || [],
      coins: player?.coins || 0,
      stabledCompanions: player?.stabledCompanions || [],
      companion: companion
        ? { id: companion.id, name: companion.name, recipe: companion.recipe }
        : null
    };
  }

  function placeOwnCompanion(carried, spot) {
    const live = game();
    if (!live || !carried?.companion || !spot) return;
    live.companions.push(live.makeCompanion({
      id: carried.companion.id,
      name: carried.companion.name,
      recipe: carried.companion.recipe,
      x: spot.x,
      y: spot.y
    }, live.player));
  }

  function enterGuestPark(welcome, carried) {
    const live = game();
    const snapshot = welcome.snapshot;
    const world = generateWorld(snapshot.worldSeed);
    const terrain = decodeTerrain(snapshot.terrain) || world.grid;
    const npcs = (snapshot.npcs || []).map(npc => ({
      id: npc.id,
      name: npc.name,
      recipe: npc.recipe,
      vibe: npc.vibe || '',
      voice: npc.voice,
      x: npc.x,
      y: npc.y,
      direction: npc.direction || 0,
      inventory: [],
      equipped: []
    }));
    const companions = (snapshot.companions || [])
      .filter(comp => comp.buddyId && comp.buddyId !== 'host' && comp.buddyId !== 'guest')
      .map(comp => ({
        id: comp.id,
        name: comp.name,
        recipe: comp.recipe,
        buddyId: comp.buddyId,
        x: comp.x,
        y: comp.y,
        direction: comp.direction || 0
      }));
    live.setWorld({
      terrain,
      worldSeed: snapshot.worldSeed,
      player: {
        id: 'player',
        name: live.player?.name,
        recipe: live.player?.recipe,
        x: welcome.spawn.x,
        y: welcome.spawn.y,
        direction: live.player?.direction || 0,
        inventory: carried?.inventory || [],
        equipped: carried?.equipped || [],
        coins: carried?.coins || 0,
        stabledCompanions: carried?.stabledCompanions || []
      },
      npcs,
      companions,
      scenery: world.scenery || [],
      wander: snapshot.wander !== false
    });
    const host = snapshot.host || {};
    live.attachRemote({
      name: host.name,
      recipe: host.recipe,
      x: host.x,
      y: host.y,
      direction: host.direction || 0
    });
    for (const comp of snapshot.companions || []) {
      if (comp.buddyId !== 'host') continue;
      live.companions.push(live.makeCompanion(comp, live.remotePlayer));
    }
    placeOwnCompanion(carried, welcome.companion);
    arm('guest');
    const recipes = [
      host.recipe,
      live.player?.recipe,
      ...npcs.map(npc => npc.recipe),
      ...(snapshot.companions || []).map(comp => comp.recipe)
    ];
    preloadAvatars(recipes.filter(Boolean));
    setStatus(`walking ${host.name || 'a friend'}'s park`);
    toast(`you are in ${host.name || 'a friend'}'s park`);
  }

  function attachGuestVisual(result) {
    const live = game();
    if (!live) return;
    arm('host');
    live.attachRemote({
      name: result.name,
      recipe: result.recipe,
      x: result.spawn.x,
      y: result.spawn.y,
      direction: 0
    });
    if (result.companion) {
      const companion = live.makeCompanion(result.companion, live.remotePlayer);
      companion.remoteOwned = true;
      live.companions.push(companion);
    }
    preloadAvatars([result.recipe, result.companion?.recipe].filter(Boolean));
    setStatus(`in the park with ${result.name || 'a friend'}`);
    toast(`${result.name || 'a friend'} joined the park`);
  }

  function startTimers() {
    stopTimers();
    poseTimer = window.setInterval(() => {
      if (channelOpen) poses?.flush();
    }, netConfig.poseFlushMs);
    pingTimer = window.setInterval(() => {
      if (channelOpen && role === 'guest') guestSession?.ping(performance.now());
    }, netConfig.pingMs);
  }

  function stopTimers() {
    if (poseTimer) window.clearInterval(poseTimer);
    if (pingTimer) window.clearInterval(pingTimer);
    if (lockTimer) window.clearTimeout(lockTimer);
    if (connectTimer) window.clearTimeout(connectTimer);
    poseTimer = 0;
    pingTimer = 0;
    lockTimer = 0;
    connectTimer = 0;
  }

  function armConnectTimeout() {
    if (connectTimer) window.clearTimeout(connectTimer);
    connectTimer = window.setTimeout(() => {
      if (channelOpen || phase === 'idle') return;
      toast('could not connect. your park is still here.');
      teardown({
        restore: role === 'guest',
        status: 'could not connect. your park is still here.'
      });
    }, 15000);
  }

  function hostHooks() {
    return {
      onGuest: result => attachGuestVisual(result),
      onGuestStep: message => {
        const remote = game()?.remotePlayer;
        if (!remote) return;
        remote.fromX = message.x;
        remote.fromY = message.y;
        showMotion(remote, { ...message, moving: true }, false);
      },
      onPose: pose => {
        const live = game();
        const actor = live?.companions?.find(comp => comp.id === pose.id)
          || live?.npcs?.find(npc => npc.id === pose.id);
        showMotion(actor, pose, false);
      },
      onSay: (_who, text) => bubble('remote', text),
      onLock: ({ id, on }) => markLocked(id, on),
      onBye: () => {
        toast('your friend left the park');
        teardown({ status: 'your friend left. the park is yours.' });
      }
    };
  }

  function guestHooks(carried) {
    return {
      onWelcome: message => enterGuestPark(message, carried),
      onSnap: (x, y) => {
        const player = game()?.player;
        if (player) game().snapCharacter(player, x, y);
      },
      onRemote: message => showMotion(game()?.remotePlayer, message, true),
      onPose: pose => {
        const live = game();
        const actor = live?.npcs?.find(npc => npc.id === pose.id)
          || live?.companions?.find(comp => comp.id === pose.id && comp.buddyId !== 'player');
        showMotion(actor, pose, true);
      },
      onSay: (_who, text) => bubble('remote', text),
      onLock: message => onGuestLock(message),
      onBye: reason => {
        toast(reason === 'full' ? 'that park already has two people' : 'the host left the park');
        teardown({
          restore: true,
          status: reason === 'full'
            ? 'that park already has two people'
            : 'the host left. you are back in your park.'
        });
      }
    };
  }

  function onGuestLock(message) {
    if (message.by === 'guest' && message.id === pendingLock) {
      pendingLock = null;
      if (lockTimer) window.clearTimeout(lockTimer);
      lockTimer = 0;
      if (message.on) {
        const npc = game()?.npcs?.find(entry => entry.id === message.id);
        if (npc) beginDialogue?.(npc);
        else game()?.resumeFromDialogue?.();
      } else {
        game()?.resumeFromDialogue?.();
        toast('they are busy chatting');
      }
      return;
    }
    markLocked(message.id, message.on);
  }

  function wireLink(onMessage) {
    link = createPeerLink({
      stunUrls: netConfig.stunUrls,
      onMessage,
      onStatus: name => {
        if (name === 'open') onChannelOpen();
        else if (name === 'failed') {
          toast('could not connect. your park is still here.');
          teardown({ restore: role === 'guest', status: 'could not connect. your park is still here.' });
        } else if (name === 'closed') {
          teardown({
            restore: role === 'guest',
            status: role === 'guest'
              ? 'the link closed. you are back in your park.'
              : 'the link closed. the park is yours.'
          });
        }
      }
    });
    poses = createPoseBatch(message => {
      if (channelOpen) link?.send(message);
    });
  }

  function onChannelOpen() {
    if (channelOpen) return;
    channelOpen = true;
    if (connectTimer) window.clearTimeout(connectTimer);
    connectTimer = 0;
    setPhase('open');
    refreshControls();
    startTimers();
    if (role === 'guest') {
      guestSession?.join(localAppearance());
      guestSession?.ping(performance.now());
      setStatus('stepping into their park…');
    } else {
      setStatus('waiting for your friend…');
    }
  }

  function teardown({ restore = false, status = '' } = {}) {
    if (tearing) return;
    tearing = true;
    generation += 1;
    const wasGuest = role === 'guest';
    const save = guestSave;
    const current = link;
    link = null;
    channelOpen = false;
    stopTimers();
    poses = null;
    hostSession = null;
    guestSession = null;
    room = null;
    pendingLock = null;
    guestSave = null;
    try {
      current?.close?.();
    } catch {
      // Closing a half-open channel can throw. The room still ends.
    }
    disarm();
    setPhase('idle');
    refreshControls();
    setStatus(status || 'walk the same park with one friend');
    const code = $('together-code');
    if (code) code.value = '';
    if (restore && wasGuest && save) applyState?.(save);
    tearing = false;
  }

  function leave({ notify = true } = {}) {
    if (phase === 'idle') {
      hidePanel();
      return;
    }
    if (notify && channelOpen) {
      if (role === 'host') hostSession?.bye();
      else guestSession?.bye();
    }
    const restore = role === 'guest';
    teardown({
      restore,
      status: restore ? 'you are back in your park.' : 'you left the shared park.'
    });
  }

  async function startHost() {
    const live = game();
    if (!live?.player || !live.terrain) {
      toast('step into a park first');
      return;
    }
    if (isMiniGameOpen?.()) {
      toast('pack up the game before sharing the park');
      return;
    }
    if (phase !== 'idle') return;
    const ticket = ++generation;
    showPanel();
    setStatus('making a code…');
    room = createRoom({
      worldSeed: live.worldSeed,
      terrain: live.terrain,
      wander: live.wander !== false,
      actors: parkActors(live)
    });
    wireLink(message => hostSession?.receive(message, performance.now()));
    hostSession = createHostSession({
      room,
      send: message => link?.send(message),
      now: () => performance.now(),
      hooks: hostHooks()
    });
    role = 'host';
    arm('host');
    try {
      const code = await link.startOffer();
      if (ticket !== generation) return;
      if (!code) throw new Error('no offer');
      const box = $('together-code');
      if (box) box.value = code;
      setPhase('offering');
      refreshControls();
      setStatus('send this code to a friend');
      armConnectTimeout();
    } catch {
      toast('could not start a room');
      teardown({ status: 'could not start a room. your park is still here.' });
    }
  }

  async function useCode() {
    const box = $('together-code');
    const text = box?.value?.trim() || '';
    if (!text) {
      setStatus('paste a code first');
      return;
    }
    if (isMiniGameOpen?.()) {
      toast('pack up the game before sharing the park');
      return;
    }
    const signal = await decodeSignal(text);
    if (!signal?.kind || !signal.sdp) {
      setStatus('that code did not work');
      return;
    }
    if (signal.kind === 'answer' && phase === 'offering' && role === 'host') {
      setStatus('connecting…');
      try {
        const ok = await link.acceptAnswer(signal);
        if (!ok) setStatus('that answer did not work');
      } catch {
        setStatus('that answer did not work');
      }
      return;
    }
    if (signal.kind === 'offer' && phase === 'idle') {
      const live = game();
      if (!live?.player) {
        toast('step into a park first');
        return;
      }
      showPanel();
      const ticket = ++generation;
      guestSave = captureSave?.() || null;
      const carried = carriedGear();
      wireLink(message => guestSession?.receive(message, performance.now()));
      guestSession = createGuestSession({
        send: message => link?.send(message),
        now: () => performance.now(),
        hooks: guestHooks(carried)
      });
      role = 'guest';
      try {
        const answer = await link.acceptOffer(signal);
        if (ticket !== generation) return;
        if (!answer) throw new Error('no answer');
        if (box) box.value = answer;
        setPhase('answering');
        refreshControls();
        setStatus('send this answer back');
        armConnectTimeout();
      } catch {
        toast('that code did not work');
        teardown({ status: 'that code did not work' });
      }
      return;
    }
    if (signal.kind === 'offer') setStatus('you are already hosting. paste the answer.');
    else setStatus('paste the host code first');
  }

  function sendSay() {
    if (!channelOpen) return;
    const text = clampSay($('together-say')?.value || '');
    if (!text) return;
    if (role === 'host') hostSession?.say(text);
    else guestSession?.say(text);
    bubble('player', text);
    const input = $('together-say');
    if (input) input.value = '';
  }

  function bind() {
    $('together-toggle')?.addEventListener('click', () => {
      const panel = $('together-panel');
      if (panel && !panel.hidden) hidePanel();
      else showPanel();
    });
    $('together-close')?.addEventListener('click', () => hidePanel());
    $('together-host')?.addEventListener('click', () => {
      startHost();
    });
    $('together-use')?.addEventListener('click', () => {
      useCode();
    });
    $('together-copy')?.addEventListener('click', async () => {
      const text = $('together-code')?.value || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast('code copied');
      } catch {
        $('together-code')?.focus();
        $('together-code')?.select();
        toast('copy the code from the box');
      }
    });
    $('together-say-send')?.addEventListener('click', sendSay);
    $('together-say')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendSay();
      }
    });
    $('together-leave')?.addEventListener('click', () => leave({ notify: true }));
    refreshControls();
  }

  return {
    bind,
    leave,
    inRoom() {
      return channelOpen;
    },
    active() {
      return phase !== 'idle';
    },
    role() {
      return role;
    },
    shouldSave() {
      return role !== 'guest';
    },
    requestLock(npcId) {
      if (!channelOpen || !npcId) return { ok: true };
      if (role === 'host') {
        const result = hostSession.lock(npcId);
        if (result.ok) markLocked(npcId, true);
        return result;
      }
      pendingLock = npcId;
      guestSession.lock(npcId);
      if (lockTimer) window.clearTimeout(lockTimer);
      lockTimer = window.setTimeout(() => {
        if (!pendingLock) return;
        pendingLock = null;
        game()?.resumeFromDialogue?.();
        toast('they are busy chatting');
      }, 3000);
      return { pending: true };
    },
    unlock(npcId) {
      if (!channelOpen || !npcId) return;
      markLocked(npcId, false);
      if (role === 'host') hostSession.unlock(npcId);
      else guestSession.unlock(npcId);
    }
  };
}
