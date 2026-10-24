import { findPath, isWalkable, typeAt } from '../world.js';
import { recordGameResult } from '../storage.js';

export class TicTacToeMiniGame {
  constructor({ game, onToast, onGameEnd, onAbandonPrompt } = {}) {
    this.game = game;
    this.onToast = onToast || (() => {});
    this.onGameEnd = onGameEnd || (() => {});
    this.onAbandonPrompt = onAbandonPrompt || (() => {});
    this.activeBoard = null;
    this.nextStarter = 'player'; // Alternate starting player between rounds
    this.abandonPromptActive = false;
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
    // Directly next to the player on the right (player at aroundX, board starts at aroundX + 1)
    const offsets = [
      { dx: 1, dy: -1 }, // directly adjacent right!
      { dx: 1, dy: 0 },
      { dx: 1, dy: -2 },
      { dx: 2, dy: -1 },
      { dx: -3, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -3 }
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

    const starter = this.nextStarter;
    this.nextStarter = starter === 'player' ? 'opponent' : 'player';

    // Position opponent and companion on sideline: (originX + 3, originY + 1)
    const sidelineX = spot.originX + 3;
    const sidelineY = spot.originY + 1;

    if (opponent) {
      opponent.inMiniGame = true;
      opponent.path = [];
      opponent.moving = false;

      // Opponent walks or stages to sideline
      const oppPath = findPath(this.game.terrain, { x: opponent.x, y: opponent.y }, { x: sidelineX, y: sidelineY });
      if (oppPath.length) {
        opponent.path = oppPath;
      } else {
        opponent.x = sidelineX;
        opponent.y = sidelineY;
      }
      opponent.direction = 3; // Facing left toward board

      // Companion stands beside opponent: (originX + 4, originY + 1)
      const comp = this.game.getCompanionFor(opponent.id);
      if (comp) {
        comp.fetchTarget = null;
        comp.stagedDestination = { x: spot.originX + 4, y: sidelineY };
        const compPath = findPath(this.game.terrain, { x: comp.x, y: comp.y }, comp.stagedDestination);
        if (compPath.length) {
          comp.path = compPath;
        } else {
          comp.x = spot.originX + 4;
          comp.y = sidelineY;
        }
        comp.direction = 3;
      }
    }

    // Also stage player's companion beside the player
    const playerComp = this.game.getCompanionFor(player.id);
    if (playerComp) {
      playerComp.fetchTarget = null;
      playerComp.stagedDestination = { x: player.x, y: spot.originY + 1 };
      const pCompPath = findPath(this.game.terrain, { x: playerComp.x, y: playerComp.y }, playerComp.stagedDestination);
      if (pCompPath.length) {
        playerComp.path = pCompPath;
      }
    }

    this.activeBoard = {
      originX: spot.originX,
      originY: spot.originY,
      sidelineX,
      sidelineY,
      grid: Array(9).fill(null),
      opponent,
      turn: starter,
      winner: null,
      status: 'unfolding', // 'unfolding', 'playing', 'refolding', 'ended'
      foldPhase: 0, // 0 = single center-left tile, 1 = col 0, 2 = col 0 & 1, 3 = full 3x3
      foldTimer: 0,
      thinkingTimer: starter === 'opponent' ? 0.8 : 0
    };

    this.abandonPromptActive = false;
    this.onToast(`Unfurling Tic-Tac-Toe board on the ground...`);
    return true;
  }

  resetRound() {
    if (!this.activeBoard) return;
    const starter = this.nextStarter;
    this.nextStarter = starter === 'player' ? 'opponent' : 'player';

    this.activeBoard.grid = Array(9).fill(null);
    this.activeBoard.turn = starter;
    this.activeBoard.winner = null;
    this.activeBoard.status = 'playing';
    this.activeBoard.thinkingTimer = starter === 'opponent' ? 0.4 + Math.random() * 0.4 : 0;
    this.walkOpponentToSideline();

    const starterText = starter === 'player' ? 'You start!' : `${this.activeBoard.opponent?.name || 'Opponent'} starts!`;
    this.onToast(`New round! ${starterText}`);
  }

  walkOpponentToSideline() {
    const board = this.activeBoard;
    if (!board || !board.opponent) return;
    const opponent = board.opponent;
    if (opponent.x !== board.sidelineX || opponent.y !== board.sidelineY) {
      const path = findPath(this.game.terrain, { x: opponent.x, y: opponent.y }, { x: board.sidelineX, y: board.sidelineY });
      if (path.length) {
        opponent.path = path;
      } else {
        opponent.x = board.sidelineX;
        opponent.y = board.sidelineY;
      }
      opponent.direction = 3;
    }
  }

  isTileOnBoard(x, y) {
    if (!this.activeBoard) return false;
    const { originX, originY } = this.activeBoard;
    return x >= originX && x <= originX + 2 && y >= originY && y <= originY + 2;
  }

  startRefolding(onComplete) {
    if (!this.activeBoard) return;
    this.activeBoard.status = 'refolding';
    this.activeBoard.foldPhase = 3;
    this.activeBoard.foldTimer = 0;
    this.activeBoard.onRefoldComplete = onComplete;
    this.walkOpponentToSideline();
  }

  packUpBoard() {
    if (!this.activeBoard) return;
    this.startRefolding(() => {
      if (this.activeBoard?.opponent) {
        this.activeBoard.opponent.inMiniGame = false;
      }
      this.activeBoard = null;
      this.onToast('Packed up the Tic-Tac-Toe board into your bag.');
    });
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

    // Trigger cheer for the character's buddy
    this.game.triggerCheer(character.id, 1.2);

    // If opponent made their move, walk them back to their sideline standby position
    if (!isPlayer) {
      setTimeout(() => {
        if (this.activeBoard) this.walkOpponentToSideline();
      }, 300);
    }

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

      // Notify callback to trigger rematch dialogue
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
      this.activeBoard.thinkingTimer = 0.2 + Math.random() * 0.6;
    } else {
      this.activeBoard.turn = 'player';
      this.onToast("Your turn! Step onto a square and press Enter.");
    }

    return true;
  }

  update(dt) {
    if (!this.activeBoard) return;
    const board = this.activeBoard;

    // Unfolding animation phases
    if (board.status === 'unfolding') {
      board.foldTimer += dt;
      if (board.foldTimer >= 0.28) {
        board.foldTimer = 0;
        board.foldPhase++;
        if (board.foldPhase >= 3) {
          board.status = 'playing';
          this.onToast(board.turn === 'player'
            ? 'Board is ready! Step onto a square and press Enter to mark X.'
            : `${board.opponent?.name || 'Opponent'} is contemplating the first move...`);
        }
      }
      return;
    }

    // Refolding animation phases
    if (board.status === 'refolding') {
      board.foldTimer += dt;
      if (board.foldTimer >= 0.22) {
        board.foldTimer = 0;
        board.foldPhase--;
        if (board.foldPhase < 0) {
          const cb = board.onRefoldComplete;
          board.onRefoldComplete = null;
          cb?.();
        }
      }
      return;
    }

    // Distance check: If player wanders more than 2 spaces away from board boundary
    if (board.status === 'playing' && this.game.player && !this.abandonPromptActive) {
      const p = this.game.player;
      const minX = board.originX;
      const maxX = board.originX + 2;
      const minY = board.originY;
      const maxY = board.originY + 2;

      const distLeft = minX - p.x;
      const distRight = p.x - maxX;
      const distTop = minY - p.y;
      const distBottom = p.y - maxY;
      const dist = Math.max(0, distLeft, distRight, distTop, distBottom);

      if (dist > 2) {
        this.abandonPromptActive = true;
        this.onAbandonPrompt(() => {
          // Confirm abandon
          this.abandonPromptActive = false;
          this.packUpBoard();
        }, () => {
          // Cancel abandon, stay in game
          this.abandonPromptActive = false;
        });
      }
    }

    // Opponent thinking and walking flow
    if (board.status === 'playing' && board.turn === 'opponent') {
      const opponent = board.opponent;
      if (!opponent) return;

      if (board.thinkingTimer > 0) {
        board.thinkingTimer -= dt;
        if (board.thinkingTimer <= 0) {
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

    // AI logic: center first, or random
    const chosenIndex = available.includes(4) && Math.random() > 0.3
      ? 4
      : available[Math.floor(Math.random() * available.length)];

    const col = chosenIndex % 3;
    const row = Math.floor(chosenIndex / 3);
    const targetX = board.originX + col;
    const targetY = board.originY + row;

    // Clear any previous interval or lingering destination
    if (this._arrivalInterval) {
      clearInterval(this._arrivalInterval);
      this._arrivalInterval = null;
    }

    // Pathfind opponent from their current position (whether on sideline or walking back) to target cell
    const currentOppX = opponent.moving ? opponent.toX : opponent.x;
    const currentOppY = opponent.moving ? opponent.toY : opponent.y;
    const path = findPath(this.game.terrain, { x: currentOppX, y: currentOppY }, { x: targetX, y: targetY });

    if (path.length) {
      opponent.path = path;
      this._arrivalInterval = setInterval(() => {
        if (!this.activeBoard || this.activeBoard.turn !== 'opponent') {
          clearInterval(this._arrivalInterval);
          this._arrivalInterval = null;
          return;
        }
        if (opponent.x === targetX && opponent.y === targetY && !opponent.moving) {
          clearInterval(this._arrivalInterval);
          this._arrivalInterval = null;
          this.handleAction(opponent);
        }
      }, 50);
    } else {
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
    const { originX, originY, grid, status, foldPhase } = this.activeBoard;
    const TILE = 48;
    const screenX = originX * TILE - camera.x;
    const screenY = originY * TILE - camera.y;

    ctx.save();

    // Determine current rendering rect based on folding phase:
    // Phase 0: center tile (col 0, row 1)
    // Phase 1: entire first column (col 0, rows 0..2)
    // Phase 2: first two columns (cols 0..1, rows 0..2)
    // Phase 3: full 3x3 board
    let drawX = screenX;
    let drawY = screenY;
    let drawW = TILE * 3;
    let drawH = TILE * 3;

    if (status === 'unfolding' || status === 'refolding') {
      if (foldPhase === 0) {
        drawX = screenX;
        drawY = screenY + TILE;
        drawW = TILE;
        drawH = TILE;
      } else if (foldPhase === 1) {
        drawX = screenX;
        drawY = screenY;
        drawW = TILE;
        drawH = TILE * 3;
      } else if (foldPhase === 2) {
        drawX = screenX;
        drawY = screenY;
        drawW = TILE * 2;
        drawH = TILE * 3;
      }
    }

    // Canvas ground mat
    ctx.fillStyle = 'rgba(245, 238, 220, 0.94)';
    ctx.fillRect(drawX - 4, drawY - 4, drawW + 8, drawH + 8);

    ctx.strokeStyle = 'rgba(120, 80, 50, 0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(drawX - 4, drawY - 4, drawW + 8, drawH + 8);

    // Only render grid lines and pieces if fully or partially unfolded
    if (foldPhase >= 1) {
      ctx.strokeStyle = 'rgba(60, 40, 20, 0.7)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';

      // Internal lines
      if (foldPhase >= 2) {
        ctx.beginPath();
        ctx.moveTo(screenX + TILE, screenY);
        ctx.lineTo(screenX + TILE, screenY + drawH);
        ctx.stroke();
      }
      if (foldPhase >= 3) {
        ctx.beginPath();
        ctx.moveTo(screenX + TILE * 2, screenY);
        ctx.lineTo(screenX + TILE * 2, screenY + drawH);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(drawX, screenY + TILE);
      ctx.lineTo(drawX + drawW, screenY + TILE);
      ctx.moveTo(drawX, screenY + TILE * 2);
      ctx.lineTo(drawX + drawW, screenY + TILE * 2);
      ctx.stroke();
    }

    // Render pieces if in playing or ended state
    if (status === 'playing' || status === 'ended') {
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
    }

    // Status banner if ended
    if (status === 'ended') {
      const boardSize = TILE * 3;
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
