import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessEngine, WHITE, BLACK, PIECES, INITIAL_FEN } from '../src/games/chess-engine.js';
import { ChessMiniGame, CHESS_BOARD_SIZE } from '../src/games/chess.js';

test('ChessEngine initializes standard board and FEN export/import', () => {
  const engine = new ChessEngine();
  assert.equal(engine.turn, WHITE);
  assert.equal(engine.board.length, 64);
  // White King on e1 (row 7, col 4 -> 60)
  assert.deepEqual(engine.board[60], { type: PIECES.KING, color: WHITE });
  // Black King on e8 (row 0, col 4 -> 4)
  assert.deepEqual(engine.board[4], { type: PIECES.KING, color: BLACK });

  const fen = engine.toFen();
  assert.equal(fen, INITIAL_FEN);

  const customFen = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2';
  const customEngine = new ChessEngine(customFen);
  assert.equal(customEngine.turn, WHITE);
  assert.equal(customEngine.epSquare, 2 * 8 + 2); // c6: row 2, col 2 = 18
  assert.equal(customEngine.toFen(), customFen);
});

test('ChessEngine generates legal moves and filters self-check', () => {
  const engine = new ChessEngine();
  const initialMoves = engine.moves();
  // 16 pawn moves (8 single + 8 double) + 4 knight moves = 20 opening moves
  assert.equal(initialMoves.length, 20);

  // Pin test: White King on e1 (60), White Rook on e2 (52), Black Rook on e8 (4)
  // White Rook cannot move sideways off e-file because it leaves King in check
  const pinnedFen = '4r3/8/8/8/8/8/4R3/4K3 w - - 0 1';
  const pinEngine = new ChessEngine(pinnedFen);
  const rookMoves = pinEngine.moves({ square: 52 });
  // Rook can only move along e-file: e3, e4, e5, e6, e7, e8 (capture)
  for (const m of rookMoves) {
    assert.equal(m.to % 8, 4); // All destinations must be column e (col index 4)
  }
  assert.ok(rookMoves.length > 0);
});

test('ChessEngine handles castling rules and king/rook move invalidation', () => {
  // Setup white with clear castling path
  const castlingFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const engine = new ChessEngine(castlingFen);
  const kingMoves = engine.moves({ square: 60 });
  const castleK = kingMoves.find(m => m.isCastling === 'k');
  const castleQ = kingMoves.find(m => m.isCastling === 'q');
  assert.ok(castleK, 'Kingside castling should be available');
  assert.ok(castleQ, 'Queenside castling should be available');

  // Execute kingside castling
  engine.playMove({ from: 60, to: 62 });
  assert.equal(engine.board[62].type, PIECES.KING);
  assert.equal(engine.board[61].type, PIECES.ROOK); // Castled rook moves to f1 (61)
  assert.equal(engine.board[63], null); // h1 empty

  // Rights should be cleared for white
  assert.equal(engine.castling.w.k, false);
  assert.equal(engine.castling.w.q, false);
});

test('ChessEngine handles En Passant capture', () => {
  // White pawn on e5 (rank 5 -> row 3, col 4 = 28), Black pawn on d5 (row 3, col 3 = 27)
  const epFen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  const engine = new ChessEngine(epFen);
  assert.equal(engine.epSquare, 19); // d6 = rank 6 -> row 2, col 3 -> 19

  const pawnMoves = engine.moves({ square: 28 });
  const epMove = pawnMoves.find(m => m.isEnPassant);
  assert.ok(epMove, 'En passant move should be generated');
  assert.equal(epMove.to, 19);

  engine.playMove(epMove);
  assert.equal(engine.board[19].type, PIECES.PAWN);
  assert.equal(engine.board[27], null, 'Black pawn on d5 should be captured by en passant');
});

test('ChessEngine detects Checkmate and Stalemate', () => {
  // Scholar's mate: 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#
  const mateFen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  const mateEngine = new ChessEngine(mateFen);
  assert.equal(mateEngine.isInCheck(BLACK), true);
  assert.equal(mateEngine.isCheckmate(), true);
  assert.equal(mateEngine.isStalemate(), false);

  // Classic stalemate: Black King in corner, White Queen trapping without check
  const stalemateFen = 'k7/2Q5/8/8/8/8/8/4K3 b - - 0 1';
  const staleEngine = new ChessEngine(stalemateFen);
  assert.equal(staleEngine.isInCheck(BLACK), false);
  assert.equal(staleEngine.moves().length, 0);
  assert.equal(staleEngine.isStalemate(), true);
  assert.equal(staleEngine.isCheckmate(), false);
});

test('ChessMiniGame placement, staging, and AI move selection', () => {
  const fakeTerrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
  const fakePlayer = { x: 20, y: 20, direction: 0 };
  const fakeOpponent = { id: 'npc-1', name: 'Bob', x: 22, y: 20, direction: 0 };
  const fakeGame = {
    terrain: fakeTerrain,
    player: fakePlayer,
    npcs: [fakeOpponent],
    companions: [],
    getCompanionsFor: () => [],
    getCompanionFor: () => null,
    triggerCheer: () => {}
  };

  const miniGame = new ChessMiniGame({ game: fakeGame });
  assert.equal(miniGame.canPlaceAt(10, 10), true);
  const spot = miniGame.findPlacementSpot(fakePlayer.x, fakePlayer.y);
  assert.ok(spot);

  // Unfurl board
  const unfurled = miniGame.unfurlBoard(fakeOpponent);
  assert.equal(unfurled, true);
  assert.ok(miniGame.isOpen());
  assert.equal(miniGame.activeBoard.status, 'unfolding');

  // Complete unfolding
  miniGame.activeBoard.status = 'playing';
  miniGame.activeBoard.turn = 'opponent';

  // AI evaluation and best move
  const bestMove = miniGame.getBestMoveForOpponent();
  assert.ok(bestMove, 'AI should choose a move');
  assert.ok(bestMove.from !== undefined && bestMove.to !== undefined);

  // Board cell mapping
  const originX = miniGame.activeBoard.originX;
  const originY = miniGame.activeBoard.originY;
  const cell = miniGame.cellAtTile(originX, originY);
  assert.deepEqual(cell, { row: 0, col: 0, square: 0 });

  const outside = miniGame.cellAtTile(originX - 1, originY);
  assert.equal(outside, null);
});

test('ChessMiniGame blocks bystanders from entering and evacuates board occupants', () => {
  const fakeTerrain = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 'grass'));
  const player = { id: 'player', x: 9, y: 12, moving: false, path: [] };
  const opponent = { id: 'npc-opp', x: 18, y: 13, moving: false, path: [] };
  const bystander = { id: 'npc-bystander', x: 12, y: 12, moving: false, path: [] };
  const fakeGame = {
    terrain: fakeTerrain,
    player,
    npcs: [bystander, opponent],
    companions: [],
    getCompanionsFor: () => [],
    getCompanionFor: () => null,
    triggerCheer: () => {}
  };

  const miniGame = new ChessMiniGame({ game: fakeGame });
  miniGame.activeBoard = { originX: 10, originY: 10, opponent };

  // Bystanders may not step onto the board from outside...
  bystander.x = 9;
  bystander.y = 12;
  assert.equal(miniGame.blocksStep(bystander, 10, 12), true);
  // ...but anyone already on the board is free to leave.
  bystander.x = 12;
  bystander.y = 12;
  assert.equal(miniGame.blocksStep(bystander, 11, 12), false);
  // Players, the active opponent, and staging companions are never blocked.
  assert.equal(miniGame.blocksStep(player, 10, 10), false);
  assert.equal(miniGame.blocksStep(opponent, 10, 10), false);
  const stagingComp = { id: 'comp', isCompanion: true, stagedDestination: { x: 9, y: 13 } };
  assert.equal(miniGame.blocksStep(stagingComp, 10, 10), false);

  // Board footprint maths
  assert.equal(miniGame.isTileOnBoard(10, 10), true);
  assert.equal(miniGame.isTileOnBoard(17, 17), true);
  assert.equal(miniGame.isTileOnBoard(18, 10), false);
  assert.equal(miniGame.isTileOnBoard(9, 10), false);

  // A bystander caught on the new board gets a path to safety.
  miniGame.evacuateBoard(10, 10, [player, opponent]);
  const dest = bystander.path.length ? bystander.path[bystander.path.length - 1] : bystander;
  const stillInside = dest.x >= 10 && dest.x < 18 && dest.y >= 10 && dest.y < 18;
  assert.equal(stillInside, false);
});
