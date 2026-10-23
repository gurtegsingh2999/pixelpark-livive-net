export class TicTacToeMiniGame {
  constructor({ game, onToast } = {}) {
    this.game = game;
    this.onToast = onToast || (() => {});
    this.activeBoard = null;
    // activeBoard: {
    //   originX, originY, // top-left tile (3x3 grid: x in [originX, originX+2], y in [originY, originY+2])
    //   grid: Array(9).fill(null), // 'X' or 'O'
    //   opponent: npc,
    //   turn: 'player' | 'opponent',
    //   winner: null,
    //   status: 'playing' | 'ended'
    // }
  }

  isOpen() {
    return Boolean(this.activeBoard);
  }

  canPlaceAt(originX, originY) {
    if (!this.game?.terrain) return false;
    // Check if 3x3 tiles are all within bounds and walkable
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const tx = originX + dx;
        const ty = originY + dy;
        if (tx < 0 || tx >= 64 || ty < 0 || ty >= 64) return false;
        const tileType = this.game.terrain[ty]?.[tx];
        if (tileType !== 'grass' && tileType !== 'dirt' && tileType !== 'field') {
          return false;
        }
      }
    }
    return true;
  }

  findPlacementSpot(aroundX, aroundY) {
    // Try offsets around character to find a valid 3x3 patch
    const offsets = [
      { dx: 1, dy: -1 },
      { dx: -3, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -3 },
      { dx: 2, dy: 0 },
      { dx: -4, dy: 0 }
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
      this.onToast('Not enough open ground here to unfurl the giant Tic-Tac-Toe board.');
      return false;
    }

    this.activeBoard = {
      originX: spot.originX,
      originY: spot.originY,
      grid: Array(9).fill(null),
      opponent,
      turn: 'player',
      winner: null,
      status: 'playing'
    };

    this.onToast('Unfurled Tic-Tac-Toe board! Walk onto a space and press Enter to mark X.');
    return true;
  }

  packUpBoard() {
    if (!this.activeBoard) return;
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
      this.onToast(`It's ${this.activeBoard.opponent?.name || 'opponent'}'s turn.`);
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

    const winner = this.checkWinner();
    if (winner) {
      this.activeBoard.winner = winner;
      this.activeBoard.status = 'ended';
      if (winner === 'draw') {
        this.onToast("Tic-Tac-Toe ended in a draw! Good match.");
      } else {
        const winnerName = winner === 'X' ? 'You' : (this.activeBoard.opponent?.name || 'Opponent');
        this.onToast(`${winnerName} won the Tic-Tac-Toe game!`);
      }
      return true;
    }

    // Switch turns
    if (isPlayer) {
      this.activeBoard.turn = 'opponent';
      this.scheduleOpponentTurn();
    } else {
      this.activeBoard.turn = 'player';
      this.onToast("Your turn! Step onto a square and press Enter.");
    }

    return true;
  }

  scheduleOpponentTurn() {
    if (!this.activeBoard || this.activeBoard.status !== 'playing') return;
    const opponent = this.activeBoard.opponent;
    if (!opponent) {
      this.activeBoard.turn = 'player';
      return;
    }

    // Find available spots
    const available = [];
    this.activeBoard.grid.forEach((val, idx) => {
      if (val === null) available.push(idx);
    });

    if (!available.length) return;

    // Pick a random available cell or center
    const chosenIndex = available.includes(4) && Math.random() > 0.4
      ? 4
      : available[Math.floor(Math.random() * available.length)];

    const col = chosenIndex % 3;
    const row = Math.floor(chosenIndex / 3);
    const targetX = this.activeBoard.originX + col;
    const targetY = this.activeBoard.originY + row;

    // Move opponent to cell
    opponent.x = targetX;
    opponent.y = targetY;

    // Place O after a brief pause
    setTimeout(() => {
      if (this.activeBoard && this.activeBoard.turn === 'opponent') {
        this.handleAction(opponent);
      }
    }, 600);
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
    ctx.fillStyle = 'rgba(245, 238, 220, 0.92)';
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

    ctx.restore();
  }
}
