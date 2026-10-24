import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterInventory, BALL_COLORS } from '../src/inventory.js';
import { createCompanionRecipe, canonicalRecipe, COMPANION_STYLES } from '../src/avatar.js';
import { TicTacToeMiniGame } from '../src/games/tic-tac-toe.js';
import { FetchMiniGame } from '../src/games/fetch.js';
import { recordGameResult, loadStats } from '../src/storage.js';

test('createStarterInventory yields ball and tic-tac-toe', () => {
  const inv = createStarterInventory();
  assert.equal(inv.length, 2);
  const ball = inv.find(i => i.id === 'ball');
  const ttt = inv.find(i => i.id === 'tic-tac-toe');
  assert.ok(ball);
  assert.ok(ttt);
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
