import { findPath, isWalkable, typeAt } from '../world.js';
import { recordGameResult } from '../storage.js';

export class TicTacToeMiniGame {
  constructor({ game, onToast, onGameEnd } = {}) {
    this.game = game;
    this.onToast = onToast || (() => {});
    this.onGameEnd = onGameEnd || (() => {});
    this.activeBoard = null;
    // activeBoard: {
    //   originX, originY,
    //   grid: Array(9).fill(null),
    //   opponent: npc,
    //   turn: 'player' | 'opponent',
    //   winner: null,
    //   status: 'playing' | 'ended',
    //   thinkingTimer: 0,
    //   steppingTo: null
    // }
  }

  isOpen() {
    return Boolean(this.activeBoard);
  }

  // Ensure board has at least 1 extra walkable tile to the left, right, top, and bottom
  // i.e., bounds from originX - 1 to originX + 3, and originY - 1 to originY + 3
  canPlaceAt(originX, originY) {
    if (!this.game?.terrain) return false;
    for (let dy = -1; dy <= 3; dy++) {
      for (let dx = -1; dx <= 3; dx++) {
        const tx = originX + dx;
        const ty = originY + dy;
        if (tx < 0 || tx >= 64 || ty < 0 || ty >= 64) return false;
        const tileType = this.game.terrain[ty]?.[tx];
        if (!isWalkable(tileType)) {
          return false;
        }
      }
    }
    return true;
  }

  findPlacementSpot(aroundX, aroundY) {
    // Try offsets around player to find a spot with required margins
    const offsets = [
      { dx: 2, dy: -1 },
      { dx: -4, dy: -1 },
      { dx: -1, dy: 2 },
      { dx: -1, dy: -4 },
      { dx: 3, dy: 0 },
      { dx: -5, dy: 0 },
      { dx: 2, dy: 2 },
      { dx: -4, dy: -4 }
    ];

    for (const offset of offsets) {
      const ox = aroundX + offset.dx;
      const oy = aroundY + offset.dy;
      if (this.canPlaceAt(ox, oy)) {
        return { originX: ox, originY: oy };
      }
    }
    return null;
  }

  unfurlBoard(opponent) {
    if (!this.game?.player) return false;
    const player = this.game.player;
    const spot = this.findPlacementSpot(player.x, player.y);

    if (!spot) {
      this.onToast('Need open ground with room to stand around to lay out Tic-Tac-Toe.');
      return false;
    }

    // Set up opponent and stage them
    if (opponent) {
      opponent.inMiniGame = true;
      opponent.path = [];
      opponent.moving = false;

      // Position opponent on the right side of the board in the middle row:
      // (originX + 3, originY + 1)
      const sidelineX = spot.originX + 3;
      const sidelineY = spot.originY + 1;
      opponent.x = sidelineX;
      opponent.y = sidelineY;
      opponent.fromX = sidelineX;
      opponent.fromY = sidelineY;
      opponent.toX = sidelineX;
      opponent.toY = sidelineY;
      opponent.direction = 3; // Facing left toward the board

      // Position opponent's companion beside them: (originX + 4, originY + 1)
      const comp = this.game.getCompanionFor(opponent.id);
      if (comp) {
        const compX = spot.originX + 4;
        const compY = spot.originY + 1;
        comp.x = compX;
        comp.y = compY;
        comp.fromX = compX;
        comp.fromY = compY;
        comp.toX = compX;
        comp.toY = compY;
        comp.fetchTarget = null;
        comp.direction = 3;
      }
    }

    this.activeBoard = {
      originX: spot.originX,
      originY: spot.originY,
      grid: Array(9).fill(null),
      opponent,
      turn: 'player',
      winner: null,
      status: 'playing',
      thinkingTimer: 0,
      steppingTo: null
    };

    this.onToast(`Unfurled Tic-Tac-Toe! ${opponent?.name || 'Opponent'} is ready on the sideline. Step on a square and press Enter to mark X.`);
    return true;
  }

  resetRound() {
    if (!this.activeBoard) return;
    this.activeBoard.grid = Array(9).fill(null);
    this.activeBoard.turn = 'player';
    this.activeBoard.winner = null;
    this.activeBoard.status = 'playing';
    this.activeBoard.thinkingTimer = 0;
    this.activeBoard.steppingTo = null;

    // Return opponent to sideline if needed
    const opponent = this.activeBoard.opponent;
    if (opponent) {
      const sidelineX = this.activeBoard.originX + 3;
      const sidelineY = this.activeBoard.originY + 1;
      opponent.x = sidelineX;
      opponent.y = sidelineY;
      opponent.direction = 3;
    }

    this.onToast('New round! Step onto a square and press Enter to mark X.');
  }

  packUpBoard() {
    if (!this.activeBoard) return;
    if (this.activeBoard.opponent) {
      this.activeBoard.opponent.inMiniGame = false;
    }
    this.activeBoard = null;
    this.onToast('Packed up the Tic-Tac-Toe board.');
  }

  cellAtTile(x, y) {
    if (!this.activeBoard) return null;
    const { originX, originY } = this.activeBoard;
    const col = x - originX;
    const row = y - originY;
    if (col >= 0 && col < 3 && row >= 0 && row < 3) {
      return { row, col, index: row * 3 + col };
    }
    return null;
  }

  handleAction(character) {
    if (!this.activeBoard || this.activeBoard.status !== 'playing') return false;
    const isPlayer = character === this.game.player;
    if (isPlayer && this.activeBoard.turn !== 'player') {
      this.onToast(`It's ${this.activeBoard.opponent?.name || 'opponent'}'s turn to think.`);
      return false;
    }

    const cell = this.cellAtTile(character.x, character.y);
    if (!cell) {
      if (isPlayer) {
        this.onToast('Step onto an open square of the Tic-Tac-Toe board to play your turn.');
      }
      return false;
    }

    if (this.activeBoard.grid[cell.index] !== null) {
      if (isPlayer) this.onToast('That square is already taken!');
      return false;
    }

    const symbol = isPlayer ? 'X' : 'O';
    this.activeBoard.grid[cell.index] = symbol;

    // Trigger cheer for the character's buddy
    this.game.triggerCheer(character.id, 1.2);

    const winner = this.checkWinner();
    if (winner) {
      this.activeBoard.winner = winner;
      this.activeBoard.status = 'ended';

      let resultOutcome = 'draw';
      if (winner === 'X') resultOutcome = 'win';
      else if (winner === 'O') resultOutcome = 'loss';

      const opponent = this.activeBoard.opponent;
      recordGameResult({
        opponentId: opponent?.id,
        opponentName: opponent?.name,
        result: resultOutcome
      });

      if (winner === 'draw') {
        this.onToast("Tic-Tac-Toe ended in a draw! Good match.");
        this.game.triggerCheer(this.game.player?.id, 1.5);
        if (opponent) this.game.triggerCheer(opponent.id, 1.5);
      } else {
        const winnerName = winner === 'X' ? 'You' : (opponent?.name || 'Opponent');
        const winnerId = winner === 'X' ? this.game.player?.id : opponent?.id;
        this.onToast(`${winnerName} won the Tic-Tac-Toe game!`);
        this.game.triggerCheer(winnerId, 2.5);
      }

      // Notify callback to trigger "Want to play again?" dialogue
      setTimeout(() => {
        if (this.activeBoard && this.activeBoard.status === 'ended') {
          this.onGameEnd(winner, opponent);
        }
      }, 1000);

      return true;
    }

    // Switch turns
    if (isPlayer) {
      this.activeBoard.turn = 'opponent';
      this.activeBoard.thinkingTimer = 1.2; // Contemplate for 1.2s
    } else {
      this.activeBoard.turn = 'player';
      this.onToast("Your turn! Step onto a square and press Enter.");
    }

    return true;
  }

  update(dt) {
    if (!this.activeBoard || this.activeBoard.status !== 'playing') return;

    // Opponent thinking and walking flow
    if (this.activeBoard.turn === 'opponent') {
      const opponent = this.activeBoard.opponent;
      if (!opponent) return;

      if (this.activeBoard.thinkingTimer > 0) {
        this.activeBoard.thinkingTimer -= dt;
        if (this.activeBoard.thinkingTimer <= 0) {
          // Finished contemplating: select tile and walk
          this.executeOpponentMove();
        }
      }
    }
  }

  executeOpponentMove() {
    const board = this.activeBoard;
    if (!board || board.status !== 'playing') return;
    const opponent = board.opponent;
    if (!opponent) return;

    // Find available spots
    const available = [];
    board.grid.forEach((val, idx) => {
      if (val === null) available.push(idx);
    });

    if (!available.length) return;

    // AI logic: center first, or winning move, or random
    const chosenIndex = available.includes(4) && Math.random() > 0.3
      ? 4
      : available[Math.floor(Math.random() * available.length)];

    const col = chosenIndex % 3;
    const row = Math.floor(chosenIndex / 3);
    const targetX = board.originX + col;
    const targetY = board.originY + row;

    // Pathfind opponent to the target cell
    const path = findPath(this.game.terrain, { x: opponent.x, y: opponent.y }, { x: targetX, y: targetY });
    if (path.length) {
      opponent.path = path;
      // When opponent arrives, handleAction
      const checkArrival = setInterval(() => {
        if (!this.activeBoard || this.activeBoard.turn !== 'opponent') {
          clearInterval(checkArrival);
          return;
        }
        if (opponent.x === targetX && opponent.y === targetY && !opponent.moving) {
          clearInterval(checkArrival);
          this.handleAction(opponent);
        }
      }, 100);
    } else {
      // Direct step fallback
      opponent.x = targetX;
      opponent.y = targetY;
      this.handleAction(opponent);
    }
  }

  checkWinner() {
    const g = this.activeBoard.grid;
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diagonals
    ];

    for (const [a, b, c] of lines) {
      if (g[a] && g[a] === g[b] && g[a] === g[c]) {
        return g[a];
      }
    }

    if (g.every(cell => cell !== null)) {
      return 'draw';
    }

    return null;
  }

  render(ctx, camera) {
    if (!this.activeBoard) return;
    const { originX, originY, grid } = this.activeBoard;
    const TILE = 48;
    const boardSize = TILE * 3;
    const screenX = originX * TILE - camera.x;
    const screenY = originY * TILE - camera.y;

    ctx.save();
    // Canvas mat / ground blanket
    ctx.fillStyle = 'rgba(245, 238, 220, 0.94)';
    ctx.fillRect(screenX - 4, screenY - 4, boardSize + 8, boardSize + 8);

    ctx.strokeStyle = 'rgba(120, 80, 50, 0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(screenX - 4, screenY - 4, boardSize + 8, boardSize + 8);

    // Grid lines
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.7)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    for (let i = 1; i < 3; i++) {
      // Vertical
      ctx.beginPath();
      ctx.moveTo(screenX + i * TILE, screenY);
      ctx.lineTo(screenX + i * TILE, screenY + boardSize);
      ctx.stroke();

      // Horizontal
      ctx.beginPath();
      ctx.moveTo(screenX, screenY + i * TILE);
      ctx.lineTo(screenX + boardSize, screenY + i * TILE);
      ctx.stroke();
    }

    // Render pieces
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const piece = grid[r * 3 + c];
        if (!piece) continue;

        const cx = screenX + (c + 0.5) * TILE;
        const cy = screenY + (r + 0.5) * TILE;

        if (piece === 'X') {
          ctx.strokeStyle = '#e74c3c';
          ctx.lineWidth = 6;
          const s = 14;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s);
          ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx + s, cy - s);
          ctx.lineTo(cx - s, cy + s);
          ctx.stroke();
        } else if (piece === 'O') {
          ctx.strokeStyle = '#2980b9';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Status indicator banner on board if ended
    if (this.activeBoard.status === 'ended') {
      ctx.fillStyle = 'rgba(20, 30, 22, 0.85)';
      ctx.fillRect(screenX, screenY + boardSize / 2 - 20, boardSize, 40);
      ctx.fillStyle = '#edf4e9';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = this.activeBoard.winner === 'draw'
        ? 'Draw Game!'
        : `${this.activeBoard.winner === 'X' ? 'You' : (this.activeBoard.opponent?.name || 'Opponent')} Won!`;
      ctx.fillText(label, screenX + boardSize / 2, screenY + boardSize / 2);
    }

    ctx.restore();
  }
}
