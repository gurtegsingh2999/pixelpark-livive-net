/**
 * Pure predicate evaluator for data-driven behavior conditions.
 *
 * Values are read from a plain facts object using dotted paths. The left operand of
 * a comparison is always a facts path; the right operand is a literal unless it is
 * wrapped as `{ "$path": "a.b" }`. This keeps behavior JSON declarative and avoids
 * evaluating arbitrary code.
 *
 * Supported operators: all, any, not, eq, neq, lt, lte, gt, gte, in, min, max, exists.
 * `min`/`max` are inclusive numeric bounds (`value >= bound` / `value <= bound`).
 * Missing facts never throw: comparisons are false, `exists` is false, and `not`
 * simply inverts the inner result.
 */

export const PREDICATE_OPERATORS = Object.freeze([
  'all', 'any', 'not',
  'eq', 'neq', 'lt', 'lte', 'gt', 'gte',
  'in', 'min', 'max', 'exists'
]);

const OPERATOR_SET = new Set(PREDICATE_OPERATORS);

export function getFact(facts, path) {
  if (path == null || typeof path !== 'string') return undefined;
  if (path === '') return undefined;
  let current = facts;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function rightOperand(value, facts) {
  if (value && typeof value === 'object' && !Array.isArray(value) && '$path' in value) {
    return getFact(facts, value.$path);
  }
  return value;
}

function compareNumber(actual, expected, test) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
  if (typeof expected !== 'number' || !Number.isFinite(expected)) return false;
  return test(actual, expected);
}

export function evaluatePredicate(node, facts = {}) {
  if (node == null) return true;
  if (typeof node !== 'object' || Array.isArray(node)) {
    throw new TypeError('predicate must be an object');
  }

  const keys = Object.keys(node).filter(key => key !== '$comment');
  if (!keys.length) return true;
  if (keys.length > 1) {
    throw new Error(`predicate node must contain one operator: ${keys.join(', ')}`);
  }

  const operator = keys[0];
  const arg = node[operator];

  if (!OPERATOR_SET.has(operator)) {
    throw new Error(`unknown predicate operator: ${operator}`);
  }

  switch (operator) {
    case 'all':
      return asList(arg).every(child => evaluatePredicate(child, facts));
    case 'any':
      return asList(arg).some(child => evaluatePredicate(child, facts));
    case 'not':
      return !evaluatePredicate(arg, facts);
    case 'exists': {
      const paths = Array.isArray(arg) ? arg : [arg];
      return paths.every(path => {
        const value = getFact(facts, path);
        return value !== undefined && value !== null;
      });
    }
    case 'eq':
    case 'neq': {
      const [leftPath, right] = asPair(arg);
      const left = getFact(facts, leftPath);
      const expected = rightOperand(right, facts);
      return operator === 'eq' ? left === expected : left !== expected;
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'min':
    case 'max': {
      const [leftPath, right] = asPair(arg);
      const actual = getFact(facts, leftPath);
      const expected = rightOperand(right, facts);
      if (operator === 'lt') return compareNumber(actual, expected, (a, b) => a < b);
      if (operator === 'lte' || operator === 'max') return compareNumber(actual, expected, (a, b) => a <= b);
      if (operator === 'gt') return compareNumber(actual, expected, (a, b) => a > b);
      if (operator === 'gte' || operator === 'min') return compareNumber(actual, expected, (a, b) => a >= b);
      return false;
    }
    case 'in': {
      const [leftPath, right] = asPair(arg);
      const left = getFact(facts, leftPath);
      const collection = rightOperand(right, facts);
      if (!Array.isArray(collection)) return false;
      return collection.includes(left);
    }
    default:
      return false;
  }
}

function asList(value) {
  if (Array.isArray(value)) return value;
  return [value];
}

function asPair(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('comparison predicate expects [leftPath, value]');
  }
  return value;
}

/** Throws when a predicate tree is structurally invalid. Used by config validation. */
export function assertPredicate(node, path = 'predicate') {
  if (node == null) return true;
  if (typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`${path} must be an object`);
  }
  const keys = Object.keys(node).filter(key => key !== '$comment');
  if (!keys.length) return true;
  if (keys.length > 1) {
    throw new Error(`${path} must contain one operator: ${keys.join(', ')}`);
  }
  const operator = keys[0];
  const arg = node[operator];
  if (!OPERATOR_SET.has(operator)) {
    throw new Error(`${path} has unknown operator: ${operator}`);
  }
  if (operator === 'all' || operator === 'any') {
    if (!Array.isArray(arg) || !arg.length) throw new Error(`${path}.${operator} must be a non-empty array`);
    arg.forEach((child, index) => assertPredicate(child, `${path}.${operator}[${index}]`));
    return true;
  }
  if (operator === 'not') {
    assertPredicate(arg, `${path}.not`);
    return true;
  }
  if (operator === 'exists') {
    const paths = Array.isArray(arg) ? arg : [arg];
    if (!paths.length || paths.some(item => typeof item !== 'string' || !item)) {
      throw new Error(`${path}.exists must be a path or array of paths`);
    }
    return true;
  }
  if (!Array.isArray(arg) || arg.length !== 2 || typeof arg[0] !== 'string' || !arg[0]) {
    throw new Error(`${path}.${operator} must be [leftPath, value]`);
  }
  return true;
}
