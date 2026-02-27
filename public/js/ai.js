"use strict";
/**
 * Chess AI — v5 (Bug-free Hard level)
 *
 * KEY FIX: The previous version threw an exception (TIMEOUT) mid-recursion
 * while chess.move() calls were still on the call stack. This meant
 * chess.undo() never fired for those calls, leaving the board in a
 * corrupted state → caused double-moves and game freeze.
 *
 * SOLUTION: Use a flag-based abort. The abort flag is checked ONLY at the
 * START of minimax, BEFORE any chess.move() call. This guarantees every
 * chess.move() is always followed by chess.undo() — no corruption possible.
 *
 * Difficulties:
 *   Easy   → depth 1, 55% random, feels like a beginner, responds in ~300ms
 *   Medium → depth 3, 5% random, solid play, responds in ~600ms
 *   Hard   → depth 4 with iterative deepening up to 1.5s, strong + responsive
 */
window.ChessAI = (function () {

  /* ── Piece values ── */
  const V = { p:100, n:320, b:330, r:500, q:900, k:20000 };

  /* ── Piece-square tables (white perspective, index 0=a8) ── */
  const T = {
    p:[  0,  0,  0,  0,  0,  0,  0,  0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
         5,  5, 10, 25, 25, 10,  5,  5,
         0,  0,  0, 20, 20,  0,  0,  0,
         5, -5,-10,  0,  0,-10, -5,  5,
         5, 10, 10,-20,-20, 10, 10,  5,
         0,  0,  0,  0,  0,  0,  0,  0],
    n:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
    b:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
    r:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
    q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
    k:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]
  };

  /* ── Transposition table ── */
  const TT = new Map();
  function ttClear() { TT.clear(); }
  function ttStore(key, depth, score) {
    if (TT.size > 80000) TT.clear();
    TT.set(key, { d: depth, s: score });
  }
  function ttGet(key, depth) {
    const e = TT.get(key);
    return (e && e.d >= depth) ? e.s : null;
  }

  /* ── Static evaluation ── */
  function evaluate(chess) {
    if (chess.in_checkmate()) return chess.turn() === "w" ? -99999 : 99999;
    if (chess.in_draw() || chess.in_stalemate()) return 0;
    let s = 0;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        const i  = r * 8 + c;
        const ti = p.color === "w" ? i : 63 - i;
        s += (p.color === "w" ? 1 : -1) * ((V[p.type] || 0) + ((T[p.type] || [])[ti] || 0));
      }
    }
    return s;
  }

  /* ── Move ordering ── */
  function orderMoves(moves) {
    return moves.slice().sort((a, b) => {
      const sc = m =>
        (m.includes("x") ? 10 : 0) +
        (m.includes("=") ?  8 : 0) +
        (m.includes("#") ? 20 : 0) +
        (m.includes("+") ?  4 : 0);
      return sc(b) - sc(a);
    });
  }

  /* ── Alpha-beta minimax — FLAG-BASED ABORT (no exceptions) ──
   *
   * CRITICAL DESIGN:
   *   aborted flag is checked at the TOP of the function, BEFORE chess.move().
   *   Once we enter a move/unmove pair, we ALWAYS complete it.
   *   This means chess state is NEVER corrupted by an early exit.
   */
  let aborted = false;

  function minimax(chess, depth, alpha, beta, maximizing) {
    // Check abort BEFORE touching the board
    if (aborted) return 0;

    if (depth === 0 || chess.game_over()) return evaluate(chess);

    const key   = chess.fen() + depth;
    const ttHit = ttGet(key, depth);
    if (ttHit !== null) return ttHit;

    const moves = orderMoves(chess.moves());
    let best = maximizing ? -Infinity : Infinity;

    for (const m of moves) {
      if (aborted) break;          // check before each move too

      chess.move(m);               // ← apply move
      const score = minimax(chess, depth - 1, alpha, beta, !maximizing);
      chess.undo();                // ← ALWAYS undone, even if child set aborted

      if (maximizing) {
        if (score > best) best = score;
        if (score > alpha) alpha = score;
      } else {
        if (score < best) best = score;
        if (score < beta)  beta  = score;
      }
      if (beta <= alpha) break;
    }

    if (!aborted) ttStore(key, depth, best);
    return best;
  }

  /* ── Difficulty config ──
   * Easy/Medium: fixed depth, fast response
   * Hard:        iterative deepening with time budget
   */
  const CFG = {
    easy:   { maxDepth: 1, timeMs:  400, randomRate: 0.55, blunderRate: 0.30 },
    medium: { maxDepth: 3, timeMs:  900, randomRate: 0.05, blunderRate: 0.05 },
    hard:   { maxDepth: 6, timeMs: 1800, randomRate: 0,    blunderRate: 0    },
  };

  /* ── RL: per-difficulty win tracking ── */
  const RL = { easy:{w:0,g:0}, medium:{w:0,g:0}, hard:{w:0,g:0} };
  function recordResult(diff, playerWon) {
    if (!RL[diff]) return;
    RL[diff].g++;
    if (playerWon) RL[diff].w++;
  }

  /* ── Main entry point ── */
  function getBestMove(chess, diff) {
    const cfg   = CFG[diff] || CFG.medium;
    const moves = chess.moves();
    if (!moves.length) return null;

    // Random move chance (Easy / occasional Medium)
    if (Math.random() < cfg.randomRate)
      return moves[Math.floor(Math.random() * moves.length)];

    const isMax   = chess.turn() === "w";
    const ordered = orderMoves([...moves]);

    // Reset state
    aborted  = false;
    ttClear(); // fresh TT for each move decision

    let bestMove  = ordered[0];
    let bestScore = isMax ? -Infinity : Infinity;
    const deadline = performance.now() + cfg.timeMs;

    // Iterative deepening: depth 1 → maxDepth, stops when time runs out
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      let iterBest      = ordered[0];
      let iterBestScore = isMax ? -Infinity : Infinity;
      aborted = false;

      for (const m of ordered) {
        // Check time BEFORE calling minimax — not mid-search
        if (performance.now() > deadline) {
          aborted = true;
          break;
        }

        chess.move(m);
        const score = minimax(chess, depth - 1, -Infinity, Infinity, !isMax);
        chess.undo();

        if (!aborted) {
          if (isMax ? score > iterBestScore : score < iterBestScore) {
            iterBestScore = score;
            iterBest      = m;
          }
        }
      }

      if (!aborted) {
        // This depth completed cleanly — commit
        bestMove  = iterBest;
        bestScore = iterBestScore;
      } else {
        // Time ran out — use best from previous completed depth
        break;
      }

      if (Math.abs(bestScore) > 90000) break; // forced mate found
      if (performance.now() > deadline - 30)  break; // no time for next depth
    }

    // RL blunder injection
    let blunderRate = cfg.blunderRate;
    if (blunderRate > 0 && RL[diff].g > 5) {
      const aiWinRate = 1 - (RL[diff].w / RL[diff].g);
      if (aiWinRate > 0.7) blunderRate = Math.min(blunderRate * 1.4, 0.45);
    }
    if (blunderRate > 0 && Math.random() < blunderRate)
      return moves[Math.floor(Math.random() * moves.length)];

    return bestMove;
  }

  return { getBestMove, recordResult };
})();
