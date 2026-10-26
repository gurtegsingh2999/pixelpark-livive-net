/**
 * Behavior configuration validation, compilation, freezing, and assignment resolution.
 *
 * `compileConfig(raw)` validates `data/behaviors.json`, returns a deep-frozen clone, and
 * appends a deterministic `behaviorOrder` (priority high to low, id ascending for ties).
 * Importing a raw JSON object directly is fine; runtime calls compileConfig once.
 */

import { assertPredicate } from './predicates.js';
import { ACTION_NAMES } from './actions.js';
import { SELECTOR_NAMES } from './selectors.js';

const COOLDOWN_SCOPES = new Set(['actor', 'pair', 'global']);
const ACTOR_KINDS = new Set(['npc', 'companion', 'player']);
const ACTION_SET = new Set(ACTION_NAMES);
const SELECTOR_SET = new Set(SELECTOR_NAMES);

export class BehaviorConfigError extends Error {
  constructor(errors) {
    const first = errors[0];
    super(`invalid behavior config: ${first?.path || 'config'} ${first?.message || 'failed validation'}`);
    this.name = 'BehaviorConfigError';
    this.errors = errors;
  }
}

export function compileConfig(raw, { extraActions = [] } = {}) {
  const result = validateConfig(raw, { extraActions });
  if (!result.ok) throw new BehaviorConfigError(result.errors);
  const config = structuredClone(raw);
  config.behaviorOrder = Object.keys(config.behaviors).sort((a, b) => {
    const priorityDelta = (config.behaviors[b].priority ?? 0) - (config.behaviors[a].priority ?? 0);
    return priorityDelta || a.localeCompare(b);
  });
  return deepFreeze(config);
}

export function validateConfig(raw, { extraActions = [] } = {}) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  const actionSet = new Set([...ACTION_NAMES, ...extraActions]);

  if (!isPlainObject(raw)) {
    fail('config', 'must be a JSON object');
    return { ok: false, errors };
  }

  if (raw.version !== 1) fail('version', 'must be 1');

  if (!isPlainObject(raw.tick)) {
    fail('tick', 'must be an object');
  } else {
    requirePositiveInt(raw.tick.decisionIntervalMs, 'tick.decisionIntervalMs', fail);
    requirePositiveInt(raw.tick.maxDecisionsPerTick, 'tick.maxDecisionsPerTick', fail);
    requirePositiveInt(raw.tick.maxActionsPerTick, 'tick.maxActionsPerTick', fail);
  }

  if (!isPlainObject(raw.limits)) {
    fail('limits', 'must be an object');
  } else {
    requireNonNegativeInt(raw.limits.maxOpenNpcGames, 'limits.maxOpenNpcGames', fail);
    requirePositiveInt(raw.limits.maxFriendshipsPerNpc, 'limits.maxFriendshipsPerNpc', fail);
    requirePositiveInt(raw.limits.maxPairRecords, 'limits.maxPairRecords', fail);
    if (!Array.isArray(raw.limits.npcGames) || !raw.limits.npcGames.length) {
      fail('limits.npcGames', 'must be a non-empty array');
    } else {
      raw.limits.npcGames.forEach((id, index) => {
        if (typeof id !== 'string' || !id) fail(`limits.npcGames[${index}]`, 'must be a game id');
      });
    }
    if (!isPlainObject(raw.limits.friendThreshold)) {
      fail('limits.friendThreshold', 'must be an object');
    } else {
      requirePositiveInt(raw.limits.friendThreshold.greets, 'limits.friendThreshold.greets', fail);
      requirePositiveInt(raw.limits.friendThreshold.activities, 'limits.friendThreshold.activities', fail);
    }
  }

  if (raw.social != null) {
    if (!isPlainObject(raw.social)) {
      fail('social', 'must be an object');
    } else {
      for (const key of ['greetRadius', 'gameRadius', 'greetPlayerSuppression', 'gamePlayerSuppression']) {
        if (raw.social[key] != null) requireNonNegativeInt(raw.social[key], `social.${key}`, fail);
      }
    }
  }

  if (!isPlainObject(raw.cooldowns)) {
    fail('cooldowns', 'must be an object');
  } else {
    for (const [id, spec] of Object.entries(raw.cooldowns)) {
      const path = `cooldowns.${id}`;
      if (!isPlainObject(spec)) {
        fail(path, 'must be an object');
        continue;
      }
      if (!COOLDOWN_SCOPES.has(spec.scope)) fail(`${path}.scope`, 'must be actor, pair, or global');
      if (!isDuration(spec.durationMs)) fail(`${path}.durationMs`, 'must be a non-negative ms value or [min, max]');
    }
  }

  if (raw.styleFamilies != null) {
    if (!isPlainObject(raw.styleFamilies)) {
      fail('styleFamilies', 'must be an object');
    } else {
      for (const [style, family] of Object.entries(raw.styleFamilies)) {
        if (typeof family !== 'string' || !family) fail(`styleFamilies.${style}`, 'must be a family id');
      }
    }
  }

  if (!isPlainObject(raw.selectors) || !Object.keys(raw.selectors).length) {
    fail('selectors', 'must be a non-empty object');
  } else {
    for (const [id, selector] of Object.entries(raw.selectors)) {
      if (!isPlainObject(selector)) {
        fail(`selectors.${id}`, 'must be an object');
      } else if (!SELECTOR_SET.has(selector.type)) {
        fail(`selectors.${id}.type`, `must be one of ${SELECTOR_NAMES.join(', ')}`);
      }
    }
  }

  if (!isPlainObject(raw.behaviors) || !Object.keys(raw.behaviors).length) {
    fail('behaviors', 'must be a non-empty object');
  } else {
    for (const [id, behavior] of Object.entries(raw.behaviors)) {
      validateBehavior(id, behavior, raw, fail, actionSet);
    }
  }

  if (!Array.isArray(raw.assignments) || !raw.assignments.length) {
    fail('assignments', 'must be a non-empty array');
  } else {
    raw.assignments.forEach((assignment, index) => {
      const path = `assignments[${index}]`;
      if (!isPlainObject(assignment)) {
        fail(path, 'must be an object');
        return;
      }
      if (!isPlainObject(assignment.match) || !Object.keys(assignment.match).length) {
        fail(`${path}.match`, 'must match kind, style, or family');
      } else {
        for (const [key, value] of Object.entries(assignment.match)) {
          if (!['kind', 'style', 'family'].includes(key)) fail(`${path}.match.${key}`, 'unsupported match key');
          if (key === 'kind' && !ACTOR_KINDS.has(value)) fail(`${path}.match.kind`, 'must be npc, companion, or player');
          if (key !== 'kind' && (typeof value !== 'string' || !value)) fail(`${path}.match.${key}`, 'must be a style/family id');
        }
      }
      if (typeof assignment.behavior !== 'string' || !isPlainObject(raw.behaviors?.[assignment.behavior])) {
        fail(`${path}.behavior`, 'must reference a defined behavior');
      }
      if (assignment.overrides != null) {
        if (!isPlainObject(assignment.overrides)) {
          fail(`${path}.overrides`, 'must be an object');
        } else {
          if (assignment.overrides.params != null && !isPlainObject(assignment.overrides.params)) {
            fail(`${path}.overrides.params`, 'must be an object');
          }
          if (assignment.overrides.priority != null && !Number.isFinite(assignment.overrides.priority)) {
            fail(`${path}.overrides.priority`, 'must be a number');
          }
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

function validateBehavior(id, behavior, raw, fail, actionSet = ACTION_SET) {
  const path = `behaviors.${id}`;
  if (!isPlainObject(behavior)) {
    fail(path, 'must be an object');
    return;
  }
  if (!Number.isFinite(behavior.priority)) fail(`${path}.priority`, 'must be a number');
  if (behavior.when != null) {
    try {
      assertPredicate(behavior.when, `${path}.when`);
    } catch (error) {
      fail(`${path}.when`, error.message);
    }
  }
  if (behavior.target != null) {
    if (!isPlainObject(behavior.target) || !SELECTOR_SET.has(behavior.target.selector)) {
      fail(`${path}.target`, 'must declare a known selector');
    }
    if (behavior.target?.params != null && !isPlainObject(behavior.target.params)) {
      fail(`${path}.target.params`, 'must be an object');
    }
    if (behavior.target?.required != null && typeof behavior.target.required !== 'boolean') {
      fail(`${path}.target.required`, 'must be a boolean');
    }
  }
  if (behavior.params != null && !isPlainObject(behavior.params)) fail(`${path}.params`, 'must be an object');
  if (behavior.assignmentsOnly != null && typeof behavior.assignmentsOnly !== 'boolean') {
    fail(`${path}.assignmentsOnly`, 'must be a boolean');
  }
  if (behavior.locks != null) {
    if (!isPlainObject(behavior.locks)) {
      fail(`${path}.locks`, 'must be an object');
    } else if (behavior.locks.game != null && typeof behavior.locks.game !== 'boolean') {
      fail(`${path}.locks.game`, 'must be a boolean');
    }
  }
  if (behavior.cooldowns != null) {
    if (!Array.isArray(behavior.cooldowns)) {
      fail(`${path}.cooldowns`, 'must be an array');
    } else {
      behavior.cooldowns.forEach((cooldownId, index) => {
        if (!isPlainObject(raw.cooldowns?.[cooldownId])) {
          fail(`${path}.cooldowns[${index}]`, `unknown cooldown: ${cooldownId}`);
        }
      });
    }
  }
  if (behavior.maxDurationMs != null) {
    requirePositiveInt(behavior.maxDurationMs, `${path}.maxDurationMs`, fail);
  }
  if (!isPlainObject(behavior.states) || !Object.keys(behavior.states).length) {
    fail(`${path}.states`, 'must be a non-empty object');
    return;
  }
  const stateIds = Object.keys(behavior.states);
  if (behavior.initial != null && !stateIds.includes(behavior.initial)) {
    fail(`${path}.initial`, 'must reference a state');
  }
  for (const [stateId, state] of Object.entries(behavior.states)) {
    const statePath = `${path}.states.${stateId}`;
    if (!isPlainObject(state)) {
      fail(statePath, 'must be an object');
      continue;
    }
    if (!actionSet.has(state.action)) fail(`${statePath}.action`, `unknown action: ${state.action}`);
    if (state.durationMs != null && !isDuration(state.durationMs)) {
      fail(`${statePath}.durationMs`, 'must be a non-negative ms value or [min, max]');
    }
    if (state.params != null && !isPlainObject(state.params)) fail(`${statePath}.params`, 'must be an object');
    if (state.next !== undefined && state.next !== null && !stateIds.includes(state.next)) {
      fail(`${statePath}.next`, 'must reference a state or be null');
    }
    if (state.transitions != null) {
      if (!Array.isArray(state.transitions)) {
        fail(`${statePath}.transitions`, 'must be an array');
      } else {
        state.transitions.forEach((transition, index) => {
          if (!isPlainObject(transition)) {
            fail(`${statePath}.transitions[${index}]`, 'must be an object');
            return;
          }
          if (!stateIds.includes(transition.next)) {
            fail(`${statePath}.transitions[${index}].next`, 'must reference a state');
          }
          try {
            assertPredicate(transition.when, `${statePath}.transitions[${index}].when`);
          } catch (error) {
            fail(`${statePath}.transitions[${index}].when`, error.message);
          }
        });
      }
    }
  }
}

export function resolveAssignments(actor, config) {
  if (!actor || !config || !Array.isArray(config.assignments)) return [];
  const profile = actorProfile(actor, config);
  const matches = [];

  config.assignments.forEach((assignment, index) => {
    const match = assignment?.match;
    if (!isPlainObject(match)) return;
    if (!matchesProfile(profile, match)) return;
    const behavior = config.behaviors?.[assignment.behavior];
    if (!behavior) return;
    const override = isPlainObject(assignment.overrides) ? assignment.overrides : {};
    matches.push({
      index,
      specificity: specificityOf(match),
      behavior: assignment.behavior,
      priority: override.priority ?? behavior.priority,
      params: { ...(behavior.params || {}), ...(override.params || {}) },
      match: { ...match },
      assignment
    });
  });

  return matches.sort((a, b) => b.specificity - a.specificity || a.index - b.index);
}

export function resolveAssignment(actor, config) {
  return resolveAssignments(actor, config)[0] || null;
}

export function actorProfile(actor, config = {}) {
  const kind = actor?.isPlayer ? 'player' : actor?.isCompanion ? 'companion' : 'npc';
  const style = actor?.recipe?.style || actor?.style || '';
  const family = actor?.recipe?.family || actor?.family || config.styleFamilies?.[style] || '';
  return { kind, style, family };
}

function matchesProfile(profile, match) {
  if (match.kind != null && match.kind !== profile.kind) return false;
  if (match.style != null && match.style !== profile.style) return false;
  if (match.family != null && match.family !== profile.family) return false;
  return true;
}

function specificityOf(match) {
  let score = 0;
  if (match.style != null) score += 4;
  if (match.family != null) score += 2;
  if (match.kind != null) score += 1;
  return score;
}

function isDuration(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  if (!Array.isArray(value) || value.length !== 2) return false;
  return value.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0) &&
    value[0] <= value[1];
}

function requirePositiveInt(value, path, fail) {
  if (!Number.isInteger(value) || value <= 0) fail(path, 'must be a positive integer');
}

function requireNonNegativeInt(value, path, fail) {
  if (!Number.isInteger(value) || value < 0) fail(path, 'must be a non-negative integer');
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
