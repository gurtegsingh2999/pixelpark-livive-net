// Self-contained ES module chess engine for Play Park
// Board representation: Array of 64 squares (index = row * 8 + col)
// row 0 is top (rank 8, Black/opponent side)
// row 7 is bottom (rank 1, White/player side)
// col 0 is file a, col 7 is file h
// Each piece is { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' } or null

export const WHITE = 'w';
export const BLACK = 'b';

export const PIECES = {
  PAWN: 'p',
  KNIGHT: 'n',
  BISHOP: 'b',
  ROOK: 'r',
  QUEEN: 'q',
  KING: 'k'
};

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class ChessEngine {
  constructor(fen = INITIAL_FEN) {
    this.board = Array(64).fill(null);
    this.turn = WHITE;
    this.castling = {
      w: { k: true, q: true },
      b: { k: true, q: true }
    };
    this.epSquare = null; // index of en-passant target square, or null
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.history = [];
    this.loadFen(fen);
  }

  loadFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const [placement, turn, castling, ep, half, full] = parts;

    this.board = Array(64).fill(null);
    let row = 0;
    let col = 0;

    for (const char of placement) {
      if (char === '/') {
        row++;
        col = 0;
      } else if (char >= '1' && char <= '8') {
        col += parseInt(char, 10);
      } else {
        const color = char === char.toUpperCase() ? WHITE : BLACK;
        const type = char.toLowerCase();
        this.board[row * 8 + col] = { type, color };
        col++;
      }
    }

    this.turn = turn === 'b' ? BLACK : WHITE;

    this.castling = {
      w: { k: castling ? castling.includes('K') : false, q: castling ? castling.includes('Q') : false },
      b: { k: castling ? castling.includes('k') : false, q: castling ? castling.includes('q') : false }
    };

    if (ep && ep !== '-') {
      const epCol = ep.charCodeAt(0) - 97;
      const epRow = 8 - parseInt(ep[1], 10);
      this.epSquare = epRow * 8 + epCol;
    } else {
      this.epSquare = null;
    }

    this.halfMoves = half ? parseInt(half, 10) : 0;
    this.fullMoves = full ? parseInt(full, 10) : 1;
    this.history = [];
  }

  toFen() {
    let placement = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r * 8 + c];
        if (!piece) {
          empty++;
        } else {
          if (empty > 0) {
            placement += empty;
            empty = 0;
          }
          const char = piece.color === WHITE ? piece.type.toUpperCase() : piece.type;
          placement += char;
        }
      }
      if (empty > 0) placement += empty;
      if (r < 7) placement += '/';
    }

    const turn = this.turn;
    let castling = '';
    if (this.castling.w.k) castling += 'K';
    if (this.castling.w.q) castling += 'Q';
    if (this.castling.b.k) castling += 'k';
    if (this.castling.b.q) castling += 'q';
    if (!castling) castling = '-';

    let ep = '-';
    if (this.epSquare !== null) {
      const c = this.epSquare % 8;
      const r = Math.floor(this.epSquare / 8);
      ep = String.fromCharCode(97 + c) + (8 - r);
    }

    return `${placement} ${turn} ${castling} ${ep} ${this.halfMoves} ${this.fullMoves}`;
  }

  getPiece(square) {
    if (square < 0 || square >= 64) return null;
    return this.board[square];
  }

  findKing(color) {
    for (let i = 0; i < 64; i++) {
      const piece = this.board[i];
      if (piece && piece.type === PIECES.KING && piece.color === color) {
        return i;
      }
    }
    return -1;
  }

  isSquareAttacked(square, byColor) {
    const targetR = Math.floor(square / 8);
    const targetC = square % 8;

    // 1. Pawn attacks: a pawn on (r, c) attacks diagonally in pawn move direction
    // If byColor is WHITE, pawns move row - 1, so they attack (r - 1, c ± 1).
    // Therefore, target square (targetR, targetC) is attacked by white pawn from (targetR + 1, targetC ± 1).
    // If byColor is BLACK, pawns move row + 1, so attacks come from (targetR - 1, targetC ± 1).
    const pawnRow = byColor === WHITE ? targetR + 1 : targetR - 1;
    if (pawnRow >= 0 && pawnRow < 8) {
      for (const dc of [-1, 1]) {
        const c = targetC + dc;
        if (c >= 0 && c < 8) {
          const piece = this.board[pawnRow * 8 + c];
          if (piece && piece.color === byColor && piece.type === PIECES.PAWN) {
            return true;
          }
        }
      }
    }

    // 2. Knight attacks
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = targetR + dr;
      const c = targetC + dc;
      if (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const piece = this.board[r * 8 + c];
        if (piece && piece.color === byColor && piece.type === PIECES.KNIGHT) {
          return true;
        }
      }
    }

    // 3. King attacks (adjacent 1-square in 8 directions)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = targetR + dr;
        const c = targetC + dc;
        if (r >= 0 && r < 8 && c >= 0 && c < 8) {
          const piece = this.board[r * 8 + c];
          if (piece && piece.color === byColor && piece.type === PIECES.KING) {
            return true;
          }
        }
      }
    }

    // 4. Straight line rays (Rook and Queen)
    const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of straightDirs) {
      let r = targetR + dr;
      let c = targetC + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const piece = this.board[r * 8 + c];
        if (piece) {
          if (piece.color === byColor && (piece.type === PIECES.ROOK || piece.type === PIECES.QUEEN)) {
            return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    // 5. Diagonal rays (Bishop and Queen)
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of diagDirs) {
      let r = targetR + dr;
      let c = targetC + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const piece = this.board[r * 8 + c];
        if (piece) {
          if (piece.color === byColor && (piece.type === PIECES.BISHOP || piece.type === PIECES.QUEEN)) {
            return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  isInCheck(color = this.turn) {
    const kingSquare = this.findKing(color);
    if (kingSquare === -1) return false;
    const opponent = color === WHITE ? BLACK : WHITE;
    return this.isSquareAttacked(kingSquare, opponent);
  }

  // Generates pseudo-legal moves for square or whole active side
  generatePseudoMoves(fromSquare = null) {
    const moves = [];
    const color = this.turn;
    const enemyColor = color === WHITE ? BLACK : WHITE;

    const startIdx = fromSquare !== null ? fromSquare : 0;
    const endIdx = fromSquare !== null ? fromSquare + 1 : 64;

    for (let i = startIdx; i < endIdx; i++) {
      const piece = this.board[i];
      if (!piece || piece.color !== color) continue;

      const r = Math.floor(i / 8);
      const c = i % 8;

      if (piece.type === PIECES.PAWN) {
        const forward = color === WHITE ? -1 : 1;
        const startRow = color === WHITE ? 6 : 1;
        const promoRow = color === WHITE ? 0 : 7;

        // 1-step advance
        const nextR = r + forward;
        if (nextR >= 0 && nextR < 8 && !this.board[nextR * 8 + c]) {
          if (nextR === promoRow) {
            for (const promo of [PIECES.QUEEN, PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT]) {
              moves.push({ from: i, to: nextR * 8 + c, piece, promotion: promo });
            }
          } else {
            moves.push({ from: i, to: nextR * 8 + c, piece });

            // 2-step advance
            const doubleR = r + forward * 2;
            if (r === startRow && !this.board[doubleR * 8 + c]) {
              moves.push({ from: i, to: doubleR * 8 + c, piece });
            }
          }
        }

        // Diagonal captures & En Passant
        for (const dc of [-1, 1]) {
          const capC = c + dc;
          if (capC >= 0 && capC < 8 && nextR >= 0 && nextR < 8) {
            const capTarget = nextR * 8 + capC;
            const targetPiece = this.board[capTarget];

            if (targetPiece && targetPiece.color === enemyColor) {
              if (nextR === promoRow) {
                for (const promo of [PIECES.QUEEN, PIECES.ROOK, PIECES.BISHOP, PIECES.KNIGHT]) {
                  moves.push({ from: i, to: capTarget, piece, captured: targetPiece, promotion: promo });
                }
              } else {
                moves.push({ from: i, to: capTarget, piece, captured: targetPiece });
              }
            } else if (capTarget === this.epSquare) {
              // En passant capture
              const epPawnSquare = r * 8 + capC;
              const epPiece = this.board[epPawnSquare];
              moves.push({ from: i, to: capTarget, piece, captured: epPiece, isEnPassant: true });
            }
          }
        }
      } else if (piece.type === PIECES.KNIGHT) {
        const knightOffsets = [
          [-2, -1], [-2, 1], [-1, -2], [-1, 2],
          [1, -2], [1, 2], [2, -1], [2, 1]
        ];
        for (const [dr, dc] of knightOffsets) {
          const toR = r + dr;
          const toC = c + dc;
          if (toR >= 0 && toR < 8 && toC >= 0 && toC < 8) {
            const target = toR * 8 + toC;
            const targetPiece = this.board[target];
            if (!targetPiece || targetPiece.color === enemyColor) {
              moves.push({ from: i, to: target, piece, captured: targetPiece || null });
            }
          }
        }
      } else if (piece.type === PIECES.KING) {
        // Standard 1-square moves
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const toR = r + dr;
            const toC = c + dc;
            if (toR >= 0 && toR < 8 && toC >= 0 && toC < 8) {
              const target = toR * 8 + toC;
              const targetPiece = this.board[target];
              if (!targetPiece || targetPiece.color === enemyColor) {
                moves.push({ from: i, to: target, piece, captured: targetPiece || null });
              }
            }
          }
        }

        // Castling
        // King cannot castle if in check
        const opponent = enemyColor;
        if (!this.isSquareAttacked(i, opponent)) {
          // Kingside castling
          if (this.castling[color].k) {
            const sqF = r * 8 + 5;
            const sqG = r * 8 + 6;
            const rookSq = r * 8 + 7;
            const rook = this.board[rookSq];
            if (
              !this.board[sqF] && !this.board[sqG] &&
              rook && rook.type === PIECES.ROOK && rook.color === color &&
              !this.isSquareAttacked(sqF, opponent) && !this.isSquareAttacked(sqG, opponent)
            ) {
              moves.push({ from: i, to: sqG, piece, isCastling: 'k' });
            }
          }
          // Queenside castling
          if (this.castling[color].q) {
            const sqD = r * 8 + 3;
            const sqC = r * 8 + 2;
            const sqB = r * 8 + 1;
            const rookSq = r * 8 + 0;
            const rook = this.board[rookSq];
            if (
              !this.board[sqD] && !this.board[sqC] && !this.board[sqB] &&
              rook && rook.type === PIECES.ROOK && rook.color === color &&
              !this.isSquareAttacked(sqD, opponent) && !this.isSquareAttacked(sqC, opponent)
            ) {
              moves.push({ from: i, to: sqC, piece, isCastling: 'q' });
            }
          }
        }
      } else {
        // Sliding pieces: Rook, Bishop, Queen
        const dirs = [];
        if (piece.type === PIECES.ROOK || piece.type === PIECES.QUEEN) {
          dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        }
        if (piece.type === PIECES.BISHOP || piece.type === PIECES.QUEEN) {
          dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        }

        for (const [dr, dc] of dirs) {
          let toR = r + dr;
          let toC = c + dc;
          while (toR >= 0 && toR < 8 && toC >= 0 && toC < 8) {
            const target = toR * 8 + toC;
            const targetPiece = this.board[target];
            if (!targetPiece) {
              moves.push({ from: i, to: target, piece, captured: null });
            } else {
              if (targetPiece.color === enemyColor) {
                moves.push({ from: i, to: target, piece, captured: targetPiece });
              }
              break;
            }
            toR += dr;
            toC += dc;
          }
        }
      }
    }

    return moves;
  }

  // Generate legal moves (filtering moves that leave King in check)
  moves({ square = null } = {}) {
    const pseudoMoves = this.generatePseudoMoves(square);
    const legalMoves = [];

    for (const move of pseudoMoves) {
      this.makeMoveRaw(move);
      const isLegal = !this.isInCheck(move.piece.color);
      this.undoMoveRaw();
      if (isLegal) {
        legalMoves.push(move);
      }
    }

    return legalMoves;
  }

  // Low-level move execution for search and undo
  makeMoveRaw(move) {
    const prevCastling = {
      w: { ...this.castling.w },
      b: { ...this.castling.b }
    };
    const prevEpSquare = this.epSquare;
    const prevHalfMoves = this.halfMoves;
    const prevTurn = this.turn;

    const fromPiece = this.board[move.from];
    let captured = move.captured || this.board[move.to];
    let epPawnSquare = null;

    if (move.isEnPassant) {
      const fromR = Math.floor(move.from / 8);
      const toC = move.to % 8;
      epPawnSquare = fromR * 8 + toC;
      captured = this.board[epPawnSquare];
      this.board[epPawnSquare] = null;
    }

    // Move piece on board
    this.board[move.from] = null;
    if (move.promotion) {
      this.board[move.to] = { type: move.promotion, color: fromPiece.color };
    } else {
      this.board[move.to] = fromPiece;
    }

    // Castling rook move
    let castlingRookFrom = null;
    let castlingRookTo = null;
    if (move.isCastling === 'k') {
      const r = Math.floor(move.from / 8);
      castlingRookFrom = r * 8 + 7;
      castlingRookTo = r * 8 + 5;
      this.board[castlingRookTo] = this.board[castlingRookFrom];
      this.board[castlingRookFrom] = null;
    } else if (move.isCastling === 'q') {
      const r = Math.floor(move.from / 8);
      castlingRookFrom = r * 8 + 0;
      castlingRookTo = r * 8 + 3;
      this.board[castlingRookTo] = this.board[castlingRookFrom];
      this.board[castlingRookFrom] = null;
    }

    // Update epSquare: set if double pawn push
    if (fromPiece.type === PIECES.PAWN && Math.abs(move.to - move.from) === 16) {
      this.epSquare = (move.from + move.to) / 2;
    } else {
      this.epSquare = null;
    }

    // Update castling rights
    if (fromPiece.type === PIECES.KING) {
      this.castling[fromPiece.color].k = false;
      this.castling[fromPiece.color].q = false;
    } else if (fromPiece.type === PIECES.ROOK) {
      if (move.from === 56) this.castling.w.q = false;
      if (move.from === 63) this.castling.w.k = false;
      if (move.from === 0) this.castling.b.q = false;
      if (move.from === 7) this.castling.b.k = false;
    }

    // If opponent rook captured on original square
    if (captured && captured.type === PIECES.ROOK) {
      if (move.to === 56) this.castling.w.q = false;
      if (move.to === 63) this.castling.w.k = false;
      if (move.to === 0) this.castling.b.q = false;
      if (move.to === 7) this.castling.b.k = false;
    }

    // Turn and clocks
    this.turn = this.turn === WHITE ? BLACK : WHITE;
    if (fromPiece.type === PIECES.PAWN || captured) {
      this.halfMoves = 0;
    } else {
      this.halfMoves++;
    }

    this.history.push({
      move,
      prevCastling,
      prevEpSquare,
      prevHalfMoves,
      prevTurn,
      captured,
      epPawnSquare,
      castlingRookFrom,
      castlingRookTo
    });
  }

  undoMoveRaw() {
    const last = this.history.pop();
    if (!last) return null;

    const {
      move,
      prevCastling,
      prevEpSquare,
      prevHalfMoves,
      prevTurn,
      captured,
      epPawnSquare,
      castlingRookFrom,
      castlingRookTo
    } = last;

    // Restore moving piece
    const movedPiece = this.board[move.to];
    if (move.promotion) {
      this.board[move.from] = { type: PIECES.PAWN, color: movedPiece.color };
    } else {
      this.board[move.from] = movedPiece;
    }

    // Restore captured piece
    if (move.isEnPassant) {
      this.board[move.to] = null;
      this.board[epPawnSquare] = captured;
    } else {
      this.board[move.to] = captured;
    }

    // Restore castled rook
    if (castlingRookFrom !== null && castlingRookTo !== null) {
      this.board[castlingRookFrom] = this.board[castlingRookTo];
      this.board[castlingRookTo] = null;
    }

    this.castling = prevCastling;
    this.epSquare = prevEpSquare;
    this.halfMoves = prevHalfMoves;
    this.turn = prevTurn;

    return move;
  }

  playMove(moveInput) {
    // moveInput can be { from, to, promotion }
    const legalMoves = this.moves({ square: moveInput.from });
    const chosen = legalMoves.find(m => {
      const sameTo = m.to === moveInput.to;
      const promoMatches = moveInput.promotion ? m.promotion === moveInput.promotion : (!m.promotion || m.promotion === 'q');
      return sameTo && promoMatches;
    });

    if (!chosen) return false;
    this.makeMoveRaw(chosen);
    return true;
  }

  isCheckmate() {
    return this.isInCheck() && this.moves().length === 0;
  }

  isStalemate() {
    return !this.isInCheck() && this.moves().length === 0;
  }

  isGameOver() {
    return this.moves().length === 0 || this.halfMoves >= 100;
  }
}
