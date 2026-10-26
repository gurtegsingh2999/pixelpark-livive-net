/**
 * Data-driven behavior scheduler + finite state machine.
 *
 * Integration contract:
 * - `update(dtMs)` advances timers. The game passes `dt * 1000` from its seconds-based loop.
 * - `deps.tryStep(actor, dx, dy, durationMs)` must preserve collision/reservation rules.
 *   The adapter converts ms to the game's step duration unit.
 * - `deps.findPath(actor, target, blocked)` returns a list of `{x,y}` tiles.
 * - Behavior runtime never persists live entries to saves; persist only cooldowns/relations.
 *
 * Each actor keeps one active behavior. Decisions are throttled by `tick.decisionIntervalMs`.
 * Candidates are ordered by effective priority then behavior id, which makes tie-breaks
 * deterministic. The current behavior is kept while it remains eligible so cooldowns do
 * not interrupt a state machine mid-run.
 */

import { compileConfig, resolveAssignment } from './config.js';
import { Blackboard, pairKey } from './blackboard.js';
import { select } from './selectors.js';
import { evaluatePredicate } from './predicates.js';
import { CooldownStore, sampleDuration } from './cooldowns.js';
import { Arbiter } from './arbiter.js';
import { EventLog } from './events.js';
import { actions as BUILTIN_ACTIONS } from './actions.js';

export class BehaviorRuntime {
  constructor({
    config,
    blackboard = null,
    actors = [],
    player = null,
    query = {},
    deps = {},
    rng = Math.random,
    events = null,
    cooldowns = null,
    arbiter = null,
    actions = {},
    now = 0,
    onEvent = null
  } = {}) {
    if (!config) throw new TypeError('BehaviorRuntime requires a behavior config');
    this.config = config.behaviorOrder
      ? config
      : compileConfig(config, { extraActions: Object.keys(actions) });
    this.rng = rng;
    this.now = now;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.deps = {
      face: (actor, direction) => {
        if (actor) actor.direction = direction;
      },
      ...deps
    };
    this.actions = { ...BUILTIN_ACTIONS, ...actions };
    this.events = events || new EventLog(200);
    this.cooldowns = cooldowns || new CooldownStore({ now });
    this.arbiter = arbiter || new Arbiter({ maxNpcGames: this.config.limits.maxOpenNpcGames, now });
    this.blackboard = blackboard || new Blackboard({
      actors,
      player,
      now,
      styleFamilies: this.config.styleFamilies,
      query,
      maxPairRecords: this.config.limits.maxPairRecords,
      maxFriendshipsPerNpc: this.config.limits.maxFriendshipsPerNpc,
      friendThreshold: this.config.limits.friendThreshold
    });
    this.entries = new Map();
    this.decisionTimer = 0;
    this.enabled = true;
    this.lastActionCount = 0;
  }

  update(dtMs) {
    const delta = Number(dtMs);
    if (!Number.isFinite(delta) || delta < 0) {
      throw new TypeError('update(dtMs) expects a non-negative number of milliseconds');
    }
    if (!this.enabled) return this.snapshot();

    this.now += delta;
    this.blackboard.setNow(this.now);
    this.cooldowns.now = this.now;
    this.arbiter.now = this.now;
    this.#pruneEntries();

    this.decisionTimer += delta;
    const interval = this.config.tick.decisionIntervalMs;
    if (this.decisionTimer >= interval) {
      this.decisionTimer %= interval;
      this.#decide();
    }

    this.#runActions(delta);
    this.cooldowns.prune(this.now);
    return this.snapshot();
  }

  /** Replace the world snapshot. Live behavior state is intentionally reset. */
  setWorld({ actors = [], player = null, now = this.now } = {}) {
    for (const entry of this.entries.values()) this.#interrupt(entry, 'world-reset');
    this.entries.clear();
    this.now = now;
    this.blackboard.sync(actors, player, now);
    this.cooldowns.now = now;
    return this;
  }

  setDialogue(open, owner = 'player') {
    return this.arbiter.setDialogue(open, owner);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      for (const entry of this.entries.values()) this.#interrupt(entry, 'disabled');
    }
    return this.enabled;
  }

  getEntry(actorId) {
    return this.entries.get(String(actorId)) || null;
  }

  snapshot() {
    return {
      now: this.now,
      decisionIntervalMs: this.config.tick.decisionIntervalMs,
      actors: [...this.entries.values()].map(entry => ({
        actorId: entry.actor?.id ?? null,
        behaviorId: entry.behaviorId,
        state: entry.stateName,
        targetId: entry.target?.id ?? null,
        params: { ...entry.behaviorParams },
        elapsedMs: entry.elapsedMs,
        lockedBy: entry.token?.id ?? null,
        startedAt: entry.startedAt
      })),
      activeNpcGames: this.arbiter.gameCount(),
      pairRecords: this.blackboard.pairCount(),
      arbiter: this.arbiter.snapshot()
    };
  }

  #decide() {
    let decisions = 0;
    const maxDecisions = this.config.tick.maxDecisionsPerTick;
    for (const actor of this.blackboard.all()) {
      if (!actor || actor.isPlayer) continue;
      if (decisions >= maxDecisions) break;
      const entry = this.#ensureEntry(actor);
      if (this.now < entry.nextDecisionAt) continue;
      entry.nextDecisionAt = this.now + this.config.tick.decisionIntervalMs;
      decisions += 1;
      this.#decideActor(entry);
    }
  }

  #ensureEntry(actor) {
    const id = String(actor.id);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        actor,
        behaviorId: null,
        stateName: null,
        behaviorParams: {},
        stateDurationMs: 0,
        target: null,
        assignment: null,
        memory: {},
        stateMemory: {},
        elapsedMs: 0,
        startedAt: 0,
        token: null,
        nextDecisionAt: 0
      };
      this.entries.set(id, entry);
    } else {
      entry.actor = actor;
    }
    return entry;
  }

  #decideActor(entry) {
    const actor = entry.actor;
    if (actor.inDialogue || actor.inMiniGame) {
      if (entry.behaviorId) this.#interrupt(entry, 'blocked');
      return;
    }

    const assignment = resolveAssignment(actor, this.config);
    const candidates = [];

    for (const behaviorId of this.config.behaviorOrder) {
      const behavior = this.config.behaviors[behaviorId];
      if (behavior.assignmentsOnly && assignment?.behavior !== behaviorId) continue;

      const isCurrent = entry.behaviorId === behaviorId;
      let target = null;
      if (behavior.target) {
        target = isCurrent && entry.target ? entry.target : this.#selectTarget(entry, behavior.target);
        if (behavior.target.required !== false && !target) continue;
      } else if (isCurrent) {
        target = entry.target;
      }

      const facts = this.#facts(entry, target, assignment);
      if (!isCurrent && !evaluatePredicate(behavior.when, facts)) continue;

      // The current behavior already consumed its cooldowns and holds its locks.
      if (!isCurrent && !this.#cooldownsReady(behavior, actor, target)) continue;

      const priority = assignment?.behavior === behaviorId ? assignment.priority : behavior.priority;
      const params = isCurrent
        ? entry.behaviorParams
        : { ...(behavior.params || {}), ...(assignment?.behavior === behaviorId ? assignment.params : {}) };

      const request = this.#lockRequest(entry, behaviorId, behavior, target, priority);
      if (!this.#canStart(entry, request)) continue;

      candidates.push({ behaviorId, behavior, target, priority, params, assignment });
    }

    candidates.sort((a, b) => b.priority - a.priority || a.behaviorId.localeCompare(b.behaviorId));
    const winner = candidates[0];

    if (!winner) {
      if (entry.behaviorId && !actor.moving) this.#interrupt(entry, 'ineligible');
      return;
    }

    if (winner.behaviorId === entry.behaviorId) {
      entry.target = winner.target;
      entry.behaviorParams = winner.params;
      entry.assignment = winner.assignment;
      return;
    }

    if (entry.behaviorId) this.#interrupt(entry, 'switch');
    if (this.#start(entry, winner)) return;
    for (const alternative of candidates.slice(1)) {
      if (this.#start(entry, alternative)) return;
    }
  }

  #start(entry, winner) {
    const behavior = winner.behavior;
    const token = this.arbiter.commit(
      this.#lockRequest(entry, winner.behaviorId, behavior, winner.target, winner.priority)
    );
    if (!token) {
      this.#emit('behavior.blocked', {
        actorId: entry.actor.id,
        behaviorId: winner.behaviorId,
        targetId: winner.target?.id ?? null
      });
      return false;
    }

    entry.behaviorId = winner.behaviorId;
    entry.behaviorParams = winner.params;
    entry.assignment = winner.assignment;
    entry.target = winner.target;
    entry.memory = {};
    entry.stateMemory = {};
    entry.token = token;
    entry.startedAt = this.now;
    entry.nextDecisionAt = this.now + this.config.tick.decisionIntervalMs;
    entry.stateName = behavior.initial || Object.keys(behavior.states)[0];
    entry.elapsedMs = 0;
    entry.stateDurationMs = sampleDuration(behavior.states[entry.stateName]?.durationMs, this.rng);

    this.#consumeCooldowns(behavior, entry.actor, winner.target);
    this.#emit('behavior.start', {
      actorId: entry.actor.id,
      behaviorId: winner.behaviorId,
      state: entry.stateName,
      targetId: winner.target?.id ?? null,
      priority: winner.priority
    });
    return true;
  }

  #runActions(dtMs) {
    this.lastDtMs = dtMs;
    let actionCount = 0;
    const maxActions = this.config.tick.maxActionsPerTick;
    let throttled = false;

    for (const entry of this.entries.values()) {
      if (!entry.behaviorId) continue;
      const behavior = this.config.behaviors[entry.behaviorId];
      const state = behavior?.states?.[entry.stateName];
      if (!behavior || !state) {
        this.#finish(entry, 'missing-state');
        continue;
      }

      entry.elapsedMs += dtMs;

      if (actionCount >= maxActions) {
        if (!throttled) {
          throttled = true;
          this.#emit('behavior.throttled', { limit: maxActions });
        }
        continue;
      }
      actionCount += 1;

      const action = this.actions[state.action];
      if (typeof action !== 'function') {
        this.#emit('behavior.error', {
          actorId: entry.actor.id,
          behaviorId: entry.behaviorId,
          reason: `unknown action: ${state.action}`
        });
        this.#finish(entry, 'unknown-action');
        continue;
      }

      const params = { ...entry.behaviorParams, ...(state.params || {}) };
      let result;
      try {
        result = action(this.#actionContext(entry, params));
      } catch (error) {
        this.#emit('behavior.error', {
          actorId: entry.actor.id,
          behaviorId: entry.behaviorId,
          message: error?.message || String(error)
        });
        this.#finish(entry, 'error');
        continue;
      }

      if (result?.done) {
        this.#advance(entry, state, result);
        continue;
      }

      if (behavior.maxDurationMs && this.now - entry.startedAt >= behavior.maxDurationMs) {
        this.#finish(entry, 'timeout');
        continue;
      }

      if (entry.stateDurationMs > 0 && entry.elapsedMs >= entry.stateDurationMs) {
        this.#advance(entry, state, { done: true, reason: 'timeout' });
      }
    }

    this.lastActionCount = actionCount;
  }

  #advance(entry, state, result) {
    const facts = this.#facts(entry, entry.target, entry.assignment, { result });
    let next = null;

    for (const transition of state.transitions || []) {
      if (evaluatePredicate(transition.when, facts)) {
        next = transition.next;
        break;
      }
    }
    if (next == null && typeof result.next === 'string') next = result.next;
    if (next == null && typeof state.next === 'string') next = state.next;

    if (next == null) {
      this.#finish(entry, result.reason || 'complete');
      return;
    }
    this.#enterState(entry, next);
  }

  #enterState(entry, stateName) {
    const behavior = this.config.behaviors[entry.behaviorId];
    const state = behavior?.states?.[stateName];
    if (!state) {
      this.#finish(entry, 'missing-state');
      return;
    }
    entry.stateName = stateName;
    entry.elapsedMs = 0;
    entry.stateMemory = {};
    entry.stateDurationMs = sampleDuration(state.durationMs, this.rng);
    this.#emit('behavior.state', {
      actorId: entry.actor.id,
      behaviorId: entry.behaviorId,
      state: stateName
    });
  }

  #finish(entry, reason) {
    if (!entry.behaviorId) return;
    const behaviorId = entry.behaviorId;
    const behavior = this.config.behaviors[behaviorId];
    const targetId = entry.target?.id ?? null;
    this.arbiter.release(entry.token);
    this.#emit('behavior.complete', {
      actorId: entry.actor.id,
      behaviorId,
      targetId,
      reason
    });
    if (behavior?.onComplete?.event) {
      this.#emit(behavior.onComplete.event, {
        actorId: entry.actor.id,
        behaviorId,
        targetId,
        reason
      });
    }
    entry.behaviorId = null;
    entry.stateName = null;
    entry.target = null;
    entry.behaviorParams = {};
    entry.assignment = null;
    entry.token = null;
    entry.memory = {};
    entry.stateMemory = {};
    entry.elapsedMs = 0;
    entry.stateDurationMs = 0;
    entry.nextDecisionAt = this.now + this.config.tick.decisionIntervalMs;
  }

  #interrupt(entry, reason) {
    if (!entry.behaviorId) return;
    const behaviorId = entry.behaviorId;
    const targetId = entry.target?.id ?? null;
    this.arbiter.release(entry.token);
    this.#emit('behavior.interrupt', {
      actorId: entry.actor.id,
      behaviorId,
      targetId,
      reason
    });
    entry.behaviorId = null;
    entry.stateName = null;
    entry.target = null;
    entry.behaviorParams = {};
    entry.assignment = null;
    entry.token = null;
    entry.memory = {};
    entry.stateMemory = {};
    entry.elapsedMs = 0;
    entry.stateDurationMs = 0;
    entry.nextDecisionAt = this.now + this.config.tick.decisionIntervalMs;
  }

  #actionContext(entry, params) {
    const deps = this.deps;
    const actor = entry.actor;
    return {
      actor,
      target: entry.target,
      params,
      now: this.now,
      dtMs: this.lastDtMs ?? 0,
      elapsedMs: entry.elapsedMs,
      durationMs: entry.stateDurationMs,
      memory: entry.memory,
      stateMemory: entry.stateMemory,
      rng: this.rng,
      blackboard: this.blackboard,
      behavior: this.config.behaviors[entry.behaviorId],
      behaviorId: entry.behaviorId,
      stateName: entry.stateName,
      allowedGames: this.config.limits.npcGames,
      tryStep: typeof deps.tryStep === 'function'
        ? (who, dx, dy, durationMs) => deps.tryStep(who, dx, dy, durationMs)
        : undefined,
      findPath: typeof deps.findPath === 'function'
        ? (who, target, blocked) => deps.findPath(who, target, blocked)
        : undefined,
      face: typeof deps.face === 'function'
        ? (who, direction) => deps.face(who, direction)
        : undefined,
      select: (name, selectorParams = {}) => select(name, {
        blackboard: this.blackboard,
        actor,
        params: selectorParams,
        facts: this.#facts(entry, entry.target, entry.assignment)
      }),
      emit: (type, detail = {}) => this.#emit(type, {
        actorId: actor.id,
        behaviorId: entry.behaviorId,
        state: entry.stateName,
        ...detail
      }),
      startGame: typeof deps.startGame === 'function' ? request => deps.startGame(request) : undefined,
      gameStatus: typeof deps.gameStatus === 'function' ? token => deps.gameStatus(token) : undefined,
      abortGame: typeof deps.abortGame === 'function' ? token => deps.abortGame(token) : undefined,
      snapTo: typeof deps.snapTo === 'function' ? (who, point) => deps.snapTo(who, point) : undefined,
      resolveFriendship: typeof deps.resolveFriendship === 'function'
        ? request => deps.resolveFriendship(request)
        : request => this.blackboard.applyInteraction(request.actor, request.target, request.interaction)
    };
  }

  #selectTarget(entry, targetSpec) {
    if (!targetSpec?.selector) return null;
    return select(targetSpec.selector, {
      blackboard: this.blackboard,
      actor: entry.actor,
      params: targetSpec.params || {},
      facts: this.#facts(entry, null, entry.assignment)
    }) || null;
  }

  #facts(entry, target, assignment, extra = {}) {
    const facts = this.blackboard.facts(entry.actor, {
      target,
      limits: this.config.limits,
      openNpcGames: this.arbiter.gameCount(),
      dialogueOpen: this.arbiter.isDialogueOpen(),
      socialRadius: this.config.social?.greetPlayerSuppression ?? 3,
      counts: {
        openNpcGames: this.arbiter.gameCount(),
        pairRecords: this.blackboard.pairCount()
      }
    });
    facts.assignment = assignment
      ? { behavior: assignment.behavior, priority: assignment.priority }
      : null;
    facts.behavior = { id: entry.behaviorId, state: entry.stateName };
    facts.result = extra.result ?? null;
    return facts;
  }

  /**
   * A higher-priority behavior may replace the current one. Conflicts with the current
   * behavior's own lock are therefore treated as preemptible; all other holders still
   * deny the request.
   */
  #canStart(entry, request) {
    const explanation = this.arbiter.explain(request);
    if (explanation.ok) return true;
    const own = entry.token?.id;
    if (!own) return false;
    return explanation.conflicts.every(conflict => {
      if (conflict.holder === own) return true;
      if (conflict.reason === 'game' && Array.isArray(conflict.holder)) {
        return conflict.holder.length === 1 && conflict.holder[0] === own;
      }
      return false;
    });
  }

  #lockRequest(entry, behaviorId, behavior, target, priority) {
    const actorId = String(entry.actor.id);
    return {
      id: `behavior:${actorId}:${behaviorId}`,
      kind: 'behavior',
      priority,
      actors: [actorId],
      pair: target?.id != null ? pairKey(actorId, target.id) : null,
      game: Boolean(behavior.locks?.game),
      now: this.now
    };
  }

  #cooldownsReady(behavior, actor, target) {
    for (const cooldownId of behavior.cooldowns || []) {
      const spec = this.config.cooldowns[cooldownId];
      if (!spec) return false;
      const key = this.#cooldownKey(spec, cooldownId, actor, target);
      if (key == null) return false;
      if (!this.cooldowns.isReady(spec.scope, key, this.now)) return false;
    }
    return true;
  }

  #consumeCooldowns(behavior, actor, target) {
    for (const cooldownId of behavior.cooldowns || []) {
      const spec = this.config.cooldowns[cooldownId];
      if (!spec) continue;
      const key = this.#cooldownKey(spec, cooldownId, actor, target);
      if (key == null) continue;
      this.cooldowns.consume(spec.scope, key, spec, this.now, this.rng);
    }
  }

  #cooldownKey(spec, cooldownId, actor, target) {
    if (spec.scope === 'actor') return actor?.id != null ? `${cooldownId}:${actor.id}` : null;
    if (spec.scope === 'pair') {
      return actor?.id != null && target?.id != null ? `${cooldownId}:${pairKey(actor.id, target.id)}` : null;
    }
    if (spec.scope === 'global') return cooldownId;
    return null;
  }

  #pruneEntries() {
    const live = new Set(this.blackboard.all().map(actor => String(actor.id)));
    for (const [id, entry] of this.entries) {
      if (!live.has(id)) {
        this.#interrupt(entry, 'despawned');
        this.entries.delete(id);
        continue;
      }
      const current = this.blackboard.get(entry.actor.id);
      if (current) entry.actor = current;
      if (entry.target?.id != null) {
        const target = this.blackboard.get(entry.target.id);
        if (target) entry.target = target;
      }
    }
  }

  #emit(type, detail = {}) {
    const entry = this.events.push(type, detail, this.now);
    if (!this.onEvent) return;
    try {
      this.onEvent(entry);
    } catch (error) {
      this.events.push('event.error', { message: error?.message || String(error) }, this.now);
    }
  }
}

export function createBehaviorRuntime(options) {
  return new BehaviorRuntime(options);
}
