/**
 * Settlement pipeline: winner seat -> outcome, stats/reward callbacks, and
 * end-dialogue choices. Side effects are injected so tests stay pure.
 */
import { OUTCOMES } from './contract.js';

export const COMPETITIVE_OUTCOMES = Object.freeze(['win', 'loss', 'draw']);

export const DEFAULT_END_CHOICES = Object.freeze([
  { label: 'Play again', className: 'primary', action: 'play_again' },
  { label: 'Pack up', className: 'pill quiet', action: 'pack_up' }
]);

export const DEFAULT_ABANDON_CHOICES = Object.freeze([
  { label: 'Abandon & Pack up', className: 'danger', action: 'abandon' },
  { label: 'Keep Playing', className: 'pill', action: 'keep_playing' }
]);

/**
 * Map a winner seat to a player-relative outcome. `seat` is the seat whose
 * perspective we report from (seat 0 by default).
 */
export function outcomeForSeat(winnerSeat, seat = 0) {
  if (winnerSeat === null || winnerSeat === undefined || winnerSeat === 'draw') return 'draw';
  if (typeof winnerSeat === 'string' && OUTCOMES.includes(winnerSeat)) return winnerSeat;
  const numeric = Number(winnerSeat);
  if (!Number.isFinite(numeric)) return 'draw';
  return numeric === Number(seat) ? 'win' : 'loss';
}

export function isCompetitiveOutcome(outcome) {
  return COMPETITIVE_OUTCOMES.includes(outcome);
}

/**
 * Settle one finished game.
 *
 * @param {object} args
 * @param {object} args.meta
 * @param {number|null} [args.winnerSeat]
 * @param {string} [args.outcome]
 * @param {number} [args.seat=0] perspective seat
 * @param {object|null} [args.opponent]
 * @param {object|null} [args.player]
 * @param {object|null} [args.game] passed through to reward callbacks
 * @param {Function} [args.recordGameResult] ({ opponentId, opponentName, result }) => void
 * @param {Function} [args.rollReward] (game, rewardKey, outcome) => reward
 * @param {Function} [args.applyReward] (game, reward) => notifications
 * @param {boolean} [args.record=true]
 * @param {boolean} [args.reward=true]
 */
export function settleGame({
  meta = {},
  winnerSeat = null,
  outcome = null,
  seat = 0,
  opponent = null,
  player = null,
  game = null,
  recordGameResult = null,
  rollReward = null,
  applyReward = null,
  record = true,
  reward = true
} = {}) {
  const resolvedOutcome = outcome || outcomeForSeat(winnerSeat, seat);
  if (!OUTCOMES.includes(resolvedOutcome)) {
    throw new Error(`Unknown mini-game outcome: ${resolvedOutcome}`);
  }

  const settlement = {
    gameId: meta.id || null,
    outcome: resolvedOutcome,
    seat,
    winnerSeat,
    stats: null,
    reward: null,
    notifications: [],
    recorded: false,
    rewarded: false,
    opponentId: opponent?.id ?? null,
    opponentName: opponent?.name ?? null,
    playerId: player?.id ?? null
  };

  if (record && isCompetitiveOutcome(resolvedOutcome) && typeof recordGameResult === 'function') {
    settlement.stats = recordGameResult({
      opponentId: opponent?.id,
      opponentName: opponent?.name,
      result: resolvedOutcome
    }) ?? null;
    settlement.recorded = true;
  }

  if (reward && typeof rollReward === 'function') {
    const gameType = meta.rewardKey || meta.id || null;
    if (gameType) {
      const rolled = rollReward(game, gameType, resolvedOutcome);
      settlement.reward = rolled ?? null;
      if (rolled && typeof applyReward === 'function') {
        const notifications = applyReward(game, rolled);
        settlement.notifications = Array.isArray(notifications) ? notifications : [];
        settlement.rewarded = true;
      }
    }
  }

  return settlement;
}

function interpolate(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined ? match : String(values[key])
  ));
}

function cloneChoices(choices) {
  return choices.map(choice => ({ ...choice }));
}

const FALLBACK_TEXT = Object.freeze({
  win: 'Great game! You won that round. Want to play again?',
  loss: 'Good match! Want another round?',
  draw: 'That was a tight draw! Want a rematch?',
  complete: 'Nice round! Want to play again?',
  abandoned: 'No worries, we packed the game away.'
});

/**
 * Build the end-of-game dialogue payload from a game's dialogue key. The
 * dialogue spec is injected (usually data/dialogues.json[dialogueKey]).
 */
export function buildEndDialogue({
  meta = {},
  outcome = 'draw',
  opponentName = 'Friend',
  dialogueSpec = null
} = {}) {
  const spec = dialogueSpec && typeof dialogueSpec === 'object' ? dialogueSpec : {};
  const text = spec[outcome] || FALLBACK_TEXT[outcome] || FALLBACK_TEXT.draw;
  const choices = Array.isArray(spec.endChoices) ? spec.endChoices : DEFAULT_END_CHOICES;
  return {
    key: meta.dialogueKey || null,
    outcome,
    text: interpolate(text, { name: opponentName }),
    choices: cloneChoices(choices)
  };
}

export function buildAbandonPrompt({
  meta = {},
  opponentName = 'Friend',
  dialogueSpec = null
} = {}) {
  const spec = dialogueSpec && typeof dialogueSpec === 'object' ? dialogueSpec : {};
  const text = spec.abandonPrompt || '{name}: Leaving already? Pack the game up?';
  const choices = Array.isArray(spec.abandonChoices) ? spec.abandonChoices : DEFAULT_ABANDON_CHOICES;
  return {
    key: meta.dialogueKey || null,
    text: interpolate(text, { name: opponentName }),
    choices: cloneChoices(choices)
  };
}

/**
 * Resolve a dialogue spec from a data/dialogues.json object by metadata key.
 */
export function dialogueForMeta(meta, dialogues = null) {
  if (!dialogues || !meta?.dialogueKey) return null;
  const key = meta.dialogueKey;
  return dialogues[key] || dialogues.dialogues?.[key] || null;
}
