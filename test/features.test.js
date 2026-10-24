import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterInventory, BALL_COLORS } from '../src/inventory.js';
import { createCompanionRecipe, canonicalRecipe, COMPANION_STYLES } from '../src/avatar.js';
import { TicTacToeMiniGame } from '../src/games/tic-tac-toe.js';
import { CheckersMiniGame } from '../src/games/checkers.js';
import { FetchMiniGame } from '../src/games/fetch.js';
import { recordGameResult, loadStats } from '../src/storage.js';

test('createStarterInventory yields ball, tic-tac-toe, and checkers', () => {
  const inv = createStarterInventory();
  assert.equal(inv.length, 3);
  const ball = inv.find(i => i.id === 'ball');
  const ttt = inv.find(i => i.id === 'tic-tac-toe');
  const checkers = inv.find(i => i.id === 'checkers');
  assert.ok(ball);
  assert.ok(ttt);
  assert.ok(checkers);
  assert.ok(BALL_COLORS.includes(ball.color));
});

test('createCompanionRecipe creates valid companion recipe', () => {
  const recipe = createCompanionRecipe('test-seed', 'critters');
  assert.equal(recipe.isCompanion, true);
  assert.equal(recipe.style, 'critters');
  assert.equal(recipe.seed, 'test-seed');
  const canonical = canonicalRecipe(recipe);
  assert.ok(canonical.includes('critters'));
});

test('TicTacToeMiniGame logic detects winning lines and draws', () => {
  const game = new TicTacToeMiniGame();
  game.activeBoard = {
    originX: 10,
    originY: 10,
    grid: ['X', 'X', 'X', null, 'O', null, 'O', null, null],
    turn: 'player',
    status: 'playing'
  };
  assert.equal(game.checkWinner(), 'X');

  game.activeBoard.grid = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.equal(game.checkWinner(), 'draw');
});

test('TicTacToeMiniGame maps cell correctly to 3x3 tiles', () => {
  const game = new TicTacToeMiniGame();
  game.activeBoard = { originX: 10, originY: 10, grid: Array(9).fill(null) };
  assert.deepEqual(game.cellAtTile(10, 10), { row: 0, col: 0, index: 0 });
  assert.deepEqual(game.cellAtTile(11, 12), { row: 2, col: 1, index: 7 });
  assert.equal(game.cellAtTile(9, 10), null);
  assert.equal(game.cellAtTile(13, 10), null);
});

test('TicTacToeMiniGame requires walkable margins around board', () => {
  const fakeTerrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
  const game = new TicTacToeMiniGame({ game: { terrain: fakeTerrain } });
  assert.equal(game.canPlaceAt(10, 10), true);

  // Border violation (against water)
  fakeTerrain[10][13] = 'water'; // Right boundary tile
  assert.equal(game.canPlaceAt(10, 10), false);
});

test('TicTacToeMiniGame handles keep playing without looping abandon prompt', () => {
  let promptCount = 0;
  let cancelCb = null;
  const fakeTerrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
  const fakeGame = {
    terrain: fakeTerrain,
    player: { x: 20, y: 20, moving: false, path: [] },
    heldKeys: [],
    destination: null
  };
  const ttt = new TicTacToeMiniGame({
    game: fakeGame,
    onToast: () => {},
    onAbandonPrompt: (confirm, cancel) => {
      promptCount++;
      cancelCb = cancel;
    }
  });
  ttt.activeBoard = {
    originX: 10,
    originY: 10,
    sidelineX: 13,
    sidelineY: 11,
    status: 'playing',
    turn: 'player'
  };

  // 1st tick: player is far away, prompt fires once
  ttt.update(0.016);
  assert.equal(promptCount, 1);

  // User chooses "Keep playing"
  cancelCb();
  assert.equal(ttt.returningToBoard, true);
  assert.ok(fakeGame.player.path.length > 0);

  // Next ticks while returning: prompt must not fire again
  ttt.update(0.016);
  ttt.update(0.016);
  assert.equal(promptCount, 1);

  // Once player arrives back within boundary:
  fakeGame.player.x = 9;
  fakeGame.player.y = 11;
  fakeGame.player.path = [];
  ttt.update(0.016);
  assert.equal(ttt.returningToBoard, false);
  assert.equal(promptCount, 1);
});

test('CheckersMiniGame initializes, detects moves, captures and kings', () => {
  const checkers = new CheckersMiniGame();
  const pieces = checkers.createInitialPieces();
  assert.equal(pieces.length, 64);

  // Red (player) pieces start at bottom (rows 5, 6, 7), 12 pieces total
  const playerPieces = pieces.filter(p => p?.side === 'player');
  const opponentPieces = pieces.filter(p => p?.side === 'opponent');
  assert.equal(playerPieces.length, 12);
  assert.equal(opponentPieces.length, 12);

  // Legal opening moves for player from row 5
  const moves = checkers.getLegalMoves('player', pieces);
  assert.ok(moves.length > 0);
  assert.ok(moves.every(m => m.from.row === 5));

  // Test jump capture and king promotion logic
  const customPieces = Array(64).fill(null);
  // Player piece at row 2, col 1 (index 17)
  customPieces[2 * 8 + 1] = { side: 'player', king: false };
  // Opponent piece at row 1, col 2 (index 10)
  customPieces[1 * 8 + 2] = { side: 'opponent', king: false };

  checkers.activeBoard = {
    originX: 10,
    originY: 10,
    pieces: customPieces,
    turn: 'player',
    status: 'playing',
    multiJumpFrom: null
  };

  const jumpMoves = checkers.getLegalMoves('player', customPieces);
  assert.equal(jumpMoves.length, 1);
  assert.equal(jumpMoves[0].to.row, 0);
  assert.equal(jumpMoves[0].to.col, 3);
  assert.ok(jumpMoves[0].jumped);

  const res = checkers.applyMove(jumpMoves[0]);
  assert.equal(res.completed, true);
  // King promotion should happen at row 0
  assert.equal(checkers.activeBoard.pieces[0 * 8 + 3].king, true);
  // Jumped piece removed
  assert.equal(checkers.activeBoard.pieces[1 * 8 + 2], null);
});
