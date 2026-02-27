"use strict";
(function () {

/* ═══════════════════════════════════════
   LOADING SCREEN — brief splash on start
   ═══════════════════════════════════════ */
(function initLoading() {
  const ld = document.getElementById("v-loading");
  if (!ld) return;
  // Hide after 900ms with a fade
  setTimeout(() => {
    ld.style.transition = "opacity .4s ease";
    ld.style.opacity = "0";
    setTimeout(() => { ld.style.display = "none"; }, 420);
  }, 900);
})();

// ─────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────
const GLYPHS = {
  wP:"♙",wR:"♖",wN:"♘",wB:"♗",wQ:"♕",wK:"♔",
  bP:"♟",bR:"♜",bN:"♞",bB:"♝",bQ:"♛",bK:"♚",
};
const CAP_GLYPHS   = { p:"♟", r:"♜", n:"♞", b:"♝", q:"♛", k:"♚" };
const WHITE_GLYPHS = { p:"♙", r:"♖", n:"♘", b:"♗", q:"♕", k:"♔" };
const PIECE_NAMES  = { p:"Pawn", r:"Rook", n:"Knight", b:"Bishop", q:"Queen", k:"King" };
const PROMO_PIECES = [
  { type:"q", name:"Queen"  },
  { type:"r", name:"Rook"   },
  { type:"b", name:"Bishop" },
  { type:"n", name:"Knight" },
];
const PIECE_VALUES = { q:9, r:5, b:3, n:3, p:1, k:0 };

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
const chess    = new Chess();
let mode       = null;      // 'online'|'offline'
let role       = null;      // 'w'|'b'|'spectator'
let selSq      = null;
let legalSqs   = [];
let lastMove   = null;
let moveLog    = [];
let gameOver   = false;
let muted      = false;
// aiDiff: difficulty selected in lobby (changes via buttons before/during game)
let aiDiff       = "medium";
// lockedDiff: SNAPSHOTTED when game starts — AI always uses this, never drifts
let lockedDiff   = "medium";
let aiThinking   = false;
let clocks     = { w:600, b:600 };
let clockIv    = null;
let roomId     = null;
let pendingPromo = null;
const isMobile = () => window.innerWidth <= 760;

// ─────────────────────────────────────────────────────────
// DOM
// ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const boardEl = $("chessboard");

const VIEWS = {
  lobby:  $("v-lobby"),
  search: $("v-search"),
  wait:   $("v-wait"),
  error:  $("v-error"),
  game:   $("v-game"),
};

// ─────────────────────────────────────────────────────────
// VIEW SYSTEM
// ─────────────────────────────────────────────────────────
function show(name) {
  Object.values(VIEWS).forEach(v => {
    v.classList.remove("active");
    v.style.display = "none";
  });
  const v = VIEWS[name];
  if (!v) return;
  v.style.display = "flex";
  requestAnimationFrame(() => v.classList.add("active"));
  if (name === "game") {
    // Multiple fitBoard calls to ensure correct sizing after render
    setTimeout(fitBoard, 50);
    setTimeout(fitBoard, 200);
    setTimeout(fitBoard, 500);
  }
}

// ─────────────────────────────────────────────────────────
// DECORATIVE LOBBY BOARD
// ─────────────────────────────────────────────────────────
(function buildDecoBoard() {
  const el = $("deco-board");
  if (!el) return;
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const sq = document.createElement("div");
    sq.className = "dsq " + ((r+c)%2===0 ? "lt" : "dk");
    el.appendChild(sq);
  }
})();

// ─────────────────────────────────────────────────────────
// SOUNDS
// ─────────────────────────────────────────────────────────
let actx = null;
function getACtx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
function tone(freq, dur, type="sine", vol=0.26) {
  if (muted) return;
  try {
    const c=getACtx(), o=c.createOscillator(), g=c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+dur);
    o.start(); o.stop(c.currentTime+dur);
  } catch(_){}
}
const SFX = {
  move()     { tone(440,0.07); },
  capture()  { tone(220,0.14,"sawtooth"); setTimeout(()=>tone(160,0.09),55); },
  check()    { tone(580,0.09,"square"); setTimeout(()=>tone(460,0.12,"square"),110); },
  checkmate(){ [920,700,480,260].forEach((f,i)=>setTimeout(()=>tone(f,0.2,"sawtooth",0.3),i*110)); },
  start()    { [330,440,550,660].forEach((f,i)=>setTimeout(()=>tone(f,0.1),i*70)); },
  illegal()  { tone(140,0.1,"square",0.18); },
  promo()    { [528,660,792].forEach((f,i)=>setTimeout(()=>tone(f,0.12),i*90)); },
  found()    { [440,550,660,880].forEach((f,i)=>setTimeout(()=>tone(f,0.1),i*70)); },
};

// ─────────────────────────────────────────────────────────
// BOARD SIZING
// Mobile:  board = device width minus 12px padding (6px each side)
// Desktop: board = fits available column
// ─────────────────────────────────────────────────────────
function fitBoard() {
  if (!boardEl) return;

  let size;

  if (isMobile()) {
    // Strict: board must not exceed screen width
    // Total horizontal: 6px left pad + 14px coord col + 3px gap + board + 6px right pad
    const coordW = 14 + 3; // coord-ranks width + gap
    const pad    = 12;     // 6px each side
    size = Math.min(
      window.innerWidth - pad - coordW,   // width constraint
      window.innerHeight * 0.52           // height constraint (don't take too much vertical)
    );
  } else {
    // Desktop: fit inside board-col
    const boardCol = document.querySelector(".board-col");
    if (!boardCol) return;
    const colRect  = boardCol.getBoundingClientRect();
    const strips   = boardCol.querySelectorAll(".player-strip");
    const capbars  = boardCol.querySelectorAll(".captured-bar");
    let usedH = 0;
    strips .forEach(s => usedH += s.offsetHeight + 3);
    capbars.forEach(c => usedH += c.offsetHeight + 3);
    usedH += 30; // coords + gap

    const avlH = colRect.height - usedH;
    const avlW = colRect.width  - 30;
    size = Math.min(avlH, avlW, 680);
  }

  size = Math.max(160, Math.floor(size / 8) * 8); // multiple of 8
  const sq  = Math.floor(size / 8);
  const pSz = Math.floor(sq * 0.76);

  boardEl.style.width  = size + "px";
  boardEl.style.height = size + "px";
  document.querySelectorAll(".pc").forEach(p => p.style.fontSize = pSz + "px");

  const coordRanks = $("coord-ranks");
  const coordFiles = $("coord-files");
  if (coordRanks) coordRanks.style.height = size + "px";
  if (coordFiles) coordFiles.style.width  = size + "px";
}

let resizeTm;
window.addEventListener("resize", () => {
  clearTimeout(resizeTm);
  resizeTm = setTimeout(fitBoard, 80);
});

// ─────────────────────────────────────────────────────────
// BOARD RENDER
// ─────────────────────────────────────────────────────────
function renderBoard() {
  boardEl.innerHTML = "";
  const board  = chess.board();
  const flip   = role === "b";
  const checkK = chess.in_check() ? findKing(chess.turn()) : null;

  for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
    const sq    = sn(r, c);
    const piece = board[r][c];
    const light = (r+c) % 2 === 0;

    const cell = document.createElement("div");
    cell.className = "sq " + (light ? "lt" : "dk");
    cell.dataset.sq = sq;

    if (sq === selSq)            cell.classList.add("sel");
    if (sq === lastMove?.from)   cell.classList.add("lmf");
    if (sq === lastMove?.to)     cell.classList.add("lmt");
    if (legalSqs.includes(sq))  cell.classList.add("leg");
    if (piece && legalSqs.includes(sq)) cell.classList.add("occ");
    if (sq === checkK)           cell.classList.add("chk");

    if (piece) {
      const p = document.createElement("div");
      p.className = "pc " + (piece.color === "w" ? "wh" : "bl");
      p.textContent = GLYPHS[(piece.color==="w"?"w":"b") + piece.type.toUpperCase()];
      cell.appendChild(p);
    }

    cell.addEventListener("click", () => onSquareClick(sq));
    boardEl.appendChild(cell);
  }

  boardEl.classList.toggle("flipped", flip);
  renderCoords();
  fitBoard();
}

function renderCoords() {
  const flip  = role === "b";
  const ranks = flip ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const files = flip ? ["h","g","f","e","d","c","b","a"] : ["a","b","c","d","e","f","g","h"];
  const re = $("coord-ranks"), fe = $("coord-files");
  re.innerHTML = ""; fe.innerHTML = "";
  ranks.forEach(v => { const s=document.createElement("span"); s.textContent=v; re.appendChild(s); });
  files.forEach(v => { const s=document.createElement("span"); s.textContent=v; fe.appendChild(s); });
}

function sn(r, c) { return String.fromCharCode(97+c) + (8-r); }
function findKing(color) {
  const b = chess.board();
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
    const p = b[r][c];
    if (p && p.type==="k" && p.color===color) return sn(r, c);
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// PAWN PROMOTION MODAL
// ─────────────────────────────────────────────────────────
function askPromotion(color) {
  return new Promise(resolve => {
    const overlay = $("promo-overlay");
    const choices = $("promo-choices");
    choices.innerHTML = "";
    PROMO_PIECES.forEach(({type, name}) => {
      const btn = document.createElement("div");
      btn.className = "promo-piece";
      btn.innerHTML = `
        <div class="pp-icon">${color==="w" ? WHITE_GLYPHS[type] : CAP_GLYPHS[type]}</div>
        <div class="pp-name">${name}</div>
      `;
      btn.addEventListener("click", () => {
        overlay.classList.add("hidden");
        SFX.promo();
        resolve(type);
      });
      choices.appendChild(btn);
    });
    overlay.classList.remove("hidden");
  });
}

function needsPromotion(from, to) {
  const piece = chess.get(from);
  if (!piece || piece.type !== "p") return false;
  const toRank = parseInt(to[1]);
  return (piece.color==="w" && toRank===8) || (piece.color==="b" && toRank===1);
}

// ─────────────────────────────────────────────────────────
// SQUARE CLICK — with processing lock to prevent double-tap
// ─────────────────────────────────────────────────────────
let clickProcessing = false; // prevents double-tap race condition

async function onSquareClick(sq) {
  if (gameOver || aiThinking) return;
  if (clickProcessing) return;          // ← prevent rapid double-tap
  if (mode==="online" && role==="spectator") return;
  if ($("promo-overlay") && !$("promo-overlay").classList.contains("hidden")) return;

  const piece = chess.get(sq);

  if (selSq === sq) { clearSel(); renderBoard(); return; }

  if (!selSq) {
    if (!piece || piece.color !== role) return;
    if (piece.color !== chess.turn()) return;
    selSq    = sq;
    legalSqs = chess.moves({square:sq, verbose:true}).map(m => m.to);
    renderBoard(); return;
  }

  if (piece && piece.color === role) {
    selSq    = sq;
    legalSqs = chess.moves({square:sq, verbose:true}).map(m => m.to);
    renderBoard(); return;
  }

  let promotion = "q";
  if (needsPromotion(selSq, sq)) {
    const movingColor = chess.get(selSq)?.color || role;
    promotion = await askPromotion(movingColor);
  }

  const mv = { from:selSq, to:sq, promotion };
  clearSel();

  if (mode === "online") {
    ChessSocket.sendMove(mv);
    renderBoard();
  } else {
    clickProcessing = true;             // ← lock while applying move
    let res = null;
    try { res = chess.move(mv); } catch(_) { res = null; }
    clickProcessing = false;            // ← unlock immediately after

    if (!res) { SFX.illegal(); renderBoard(); return; }

    lastMove = { from:res.from, to:res.to };
    moveLog.push({
      num:       Math.ceil((moveLog.length+1)/2),
      san:       res.san,
      from:      res.from,
      to:        res.to,
      piece:     res.piece,
      color:     res.color,
      captured:  res.captured || null,
      flags:     res.flags,
      promotion: res.promotion || null,
    });

    popPieces();
    playSoundLocal();
    renderBoard();
    renderMoveLog();
    updateCaptures();
    updateStatus(localStatus(), 2);
    if (!chess.game_over()) setTimeout(runAI, 60);
  }
}

function clearSel() { selSq = null; legalSqs = []; }

// Animate only the piece that just landed on the destination square
// Animating ALL pieces caused the board-wide blink/flash
function popPieces() {
  if (!lastMove) return;
  requestAnimationFrame(() => {
    const destCell = boardEl.querySelector(`[data-sq="${lastMove.to}"]`);
    if (!destCell) return;
    const pc = destCell.querySelector(".pc");
    if (!pc) return;
    pc.classList.remove("pop");
    void pc.offsetWidth; // minimal reflow — just this one element
    pc.classList.add("pop");
  });
}

// ─────────────────────────────────────────────────────────
// AI RUNNER
// Uses lockedDiff (snapshotted at game start).
// Natural think delays per difficulty so moves don't feel instant.
// Double-fire prevention: aiThinking flag checked before scheduling.
// ─────────────────────────────────────────────────────────
function runAI() {
  // Guard: only run when it's actually the computer's turn
  if (mode !== "offline") return;
  if (chess.turn() !== "b") return;
  if (chess.game_over()) return;
  if (aiThinking) return;         // prevent double-scheduling

  aiThinking = true;

  const diffLabels = { easy:"🟢 Easy", medium:"🟡 Medium", hard:"🔴 Hard" };
  setStatus("thinking", `🤖 ${diffLabels[lockedDiff] || "Computer"} thinking…`);
  showThinkBar(true);

  // Natural feel: Easy is fast, Hard gets a moment to "think" visually
  // The AI itself will take its allotted time (400ms / 900ms / 1800ms)
  // We add a small extra visual delay so moves don't appear instant
  const visualDelay = { easy: 300, medium: 200, hard: 120 };
  const delay = visualDelay[lockedDiff] || 200;

  setTimeout(() => {
    // Extra safety: if game ended while we were waiting, abort
    if (chess.game_over() || chess.turn() !== "b") {
      aiThinking = false;
      showThinkBar(false);
      return;
    }

    const mv = ChessAI.getBestMove(chess, lockedDiff);

    if (mv) {
      let res = null;
      try { res = chess.move(mv); } catch(_) { res = null; }

      if (res) {
        lastMove = { from: res.from, to: res.to };
        moveLog.push({
          num:       Math.ceil((moveLog.length + 1) / 2),
          san:       res.san,
          from:      res.from,
          to:        res.to,
          piece:     res.piece,
          color:     res.color,
          captured:  res.captured  || null,
          flags:     res.flags,
          promotion: res.promotion || null,
        });
        popPieces();
        playSoundLocal();
      }
    }

    // CRITICAL: reset aiThinking BEFORE rendering so player can click
    aiThinking = false;
    showThinkBar(false);

    renderBoard();
    renderMoveLog();
    updateCaptures();

    const st = localStatus();
    updateStatus(st, 2);

    if (chess.game_over()) {
      const playerWon = st.type === "checkmate" && st.turn === "b";
      ChessAI.recordResult(lockedDiff, playerWon);
    }
  }, delay);
}

let thinkBar = null;
function showThinkBar(on) {
  if (on && !thinkBar) {
    thinkBar = document.createElement("div");
    thinkBar.style.cssText = "position:absolute;bottom:0;left:0;right:0;height:3px;overflow:hidden;z-index:10;pointer-events:none;";
    thinkBar.innerHTML = '<div style="height:100%;background:linear-gradient(90deg,#d4a843,#48a87c,#d4a843);background-size:200%;animation:thkSlide 1.3s linear infinite"></div>';
    if (!$("thkStyle")) {
      const st = document.createElement("style"); st.id = "thkStyle";
      st.textContent = "@keyframes thkSlide{from{background-position:200% 0}to{background-position:-200% 0}}";
      document.head.appendChild(st);
    }
    const bw = document.querySelector(".board-frame");
    if (bw) { bw.style.position = "relative"; bw.appendChild(thinkBar); }
  } else if (!on && thinkBar) {
    thinkBar.remove(); thinkBar = null;
  }
}

// ─────────────────────────────────────────────────────────
// SOUNDS
// ─────────────────────────────────────────────────────────
function playSoundLocal() {
  const st = localStatus();
  if (st.type === "checkmate") { SFX.checkmate(); return; }
  if (st.type === "check")     { SFX.check(); return; }
  const last = moveLog[moveLog.length-1];
  if (last?.captured) { SFX.capture(); return; }
  SFX.move();
}

function playSoundFromEvent(ev) {
  if (!ev) return;
  if (ev.status?.type === "checkmate") { SFX.checkmate(); return; }
  if (ev.status?.type === "check")     { SFX.check(); return; }
  if (ev.captured)                     { SFX.capture(); return; }
  SFX.move();
}

// ─────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────
function localStatus() {
  const c = chess;
  if (c.in_checkmate()) return { type:"checkmate", turn:c.turn() };
  if (c.in_draw())      return { type:"draw",      turn:c.turn() };
  if (c.in_stalemate()) return { type:"stalemate", turn:c.turn() };
  if (c.in_check())     return { type:"check",     turn:c.turn() };
  return                       { type:"playing",   turn:c.turn() };
}

function updateStatus(status, pc) {
  if (!status) return;
  $("status-card").className = "status-card";
  const isMe = status.turn === role;
  if (pc < 2 && mode === "online") { setStatus("waiting","⏳ Waiting for opponent…"); return; }

  switch (status.type) {
    case "checkmate":
      gameOver = true; stopClock();
      setStatus("checkmate", `♚ Checkmate! ${status.turn==="w"?"Black":"White"} wins`);
      setTimeout(() => {
        showGameOver("🏆", "Checkmate!", `${status.turn==="w"?"Black ♟":"White ♙"} wins!`);
      }, 350);
      break;
    case "draw":
      gameOver = true; stopClock();
      setStatus("", "½–½ Draw");
      setTimeout(() => showGameOver("🤝","Draw!","The game is a draw."), 350);
      break;
    case "stalemate":
      gameOver = true; stopClock();
      setStatus("", "Stalemate — Draw");
      setTimeout(() => showGameOver("🤝","Stalemate!","Draw by stalemate."), 350);
      break;
    case "check":
      setStatus("check", `⚠️ ${status.turn==="w"?"White":"Black"} is in Check!`);
      break;
    default:
      if (isMe) setStatus("your-turn","🟢 Your turn");
      else setStatus("", mode==="offline" ? "🤖 Computer's turn" : `⌛ ${status.turn==="w"?"White":"Black"}'s turn`);
  }

  if (!gameOver) {
    $("strip-me" ).classList.toggle("active", status.turn===role && role!=="spectator");
    $("strip-opp").classList.toggle("active", status.turn!==role && role!=="spectator");
  }
}

function setStatus(cls, msg) {
  $("status-card").className = "status-card" + (cls ? " "+cls : "");
  $("sc-text").textContent = msg;
}

// ─────────────────────────────────────────────────────────
// CLOCKS
// ─────────────────────────────────────────────────────────
function startLocalClock() {
  stopClock();
  if (mode !== "offline") return;
  clockIv = setInterval(() => {
    const c = chess.turn();
    clocks[c] = Math.max(0, clocks[c]-1);
    renderClocks();
    if (clocks[c] === 0) {
      stopClock(); gameOver = true;
      showGameOver("⏰","Time's Up!",`${c==="w"?"White":"Black"} ran out of time!`);
    }
  }, 1000);
}
function stopClock() { clearInterval(clockIv); clockIv = null; }
function renderClocks() {
  const mc = role==="b" ? "b" : "w", oc = mc==="w" ? "b" : "w";
  const ct = chess.turn();
  setClockEl($("clock-me"),  clocks[mc], ct===mc && !gameOver);
  setClockEl($("clock-opp"), clocks[oc], ct===oc && !gameOver);
}
function setClockEl(el, secs, running) {
  el.textContent = fmtClock(secs);
  el.className = "ps-clock" + (secs<60 ? " urgent" : running ? " running" : "");
}
function fmtClock(s) {
  return String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0");
}

// ─────────────────────────────────────────────────────────
// MOVE LOG RENDER
// Mobile: shows only live/recent moves (last 10 half-moves)
// Desktop: full history
// ─────────────────────────────────────────────────────────
function renderMoveLog() {
  const tb = $("log-tbody"), em = $("log-empty");
  if (!moveLog.length) { em.style.display="block"; tb.innerHTML=""; return; }
  em.style.display = "none"; tb.innerHTML = "";

  // On mobile, show only most recent moves (last 6 pairs = 12 half-moves)
  let logToShow = moveLog;
  const MAX_MOBILE_MOVES = 12;
  if (isMobile() && moveLog.length > MAX_MOBILE_MOVES) {
    logToShow = moveLog.slice(-MAX_MOBILE_MOVES);
  }

  const n = logToShow.length;
  for (let i=0; i<n; i+=2) {
    const tr = document.createElement("tr");
    const wEntry = logToShow[i], bEntry = logToShow[i+1];

    const ln = document.createElement("td"); ln.className="ln";
    // Show correct move number even when showing subset
    const moveNum = isMobile() && moveLog.length > MAX_MOBILE_MOVES
      ? Math.ceil((moveLog.length - MAX_MOBILE_MOVES + i + 1) / 2)
      : (i/2 + 1);
    ln.textContent = moveNum + ".";

    const lw = document.createElement("td"); lw.className="lw";
    const lb = document.createElement("td"); lb.className="lb";

    if (wEntry) lw.innerHTML = formatMoveCell(wEntry);
    if (bEntry) lb.innerHTML = formatMoveCell(bEntry);
    if (i === n-1)   lw.classList.add("lat");
    if (i+1 === n-1) lb.classList.add("lat");

    tr.appendChild(ln); tr.appendChild(lw); tr.appendChild(lb);
    tb.appendChild(tr);
  }
  $("log-scroll").scrollTop = 99999;
}

function formatMoveCell(entry) {
  let html = entry.san;
  if (entry.captured) html += ` <span class="cap-flag" title="${PIECE_NAMES[entry.captured]} captured">×</span>`;
  if (entry.promotion) html += ` <span class="promo-flag" title="Promoted to ${PIECE_NAMES[entry.promotion]}">↑</span>`;
  return html;
}

// ─────────────────────────────────────────────────────────
// CAPTURES DISPLAY
// ─────────────────────────────────────────────────────────
function updateCaptures(cap) {
  if (!cap) cap = localCaptured();
  const mc = role==="b" ? "b" : "w", oc = mc==="w" ? "b" : "w";
  renderCapBar($("cap-me"),  cap[mc]);
  renderCapBar($("cap-opp"), cap[oc]);
  const myScore  = calcScore(cap[mc]);
  const oppScore = calcScore(cap[oc]);
  $("cap-score-me" ).textContent = myScore  > oppScore  ? `+${myScore  - oppScore}` : "";
  $("cap-score-opp").textContent = oppScore > myScore   ? `+${oppScore - myScore}`  : "";
  renderCapSummary($("cs-white"), cap.w, false);
  renderCapSummary($("cs-black"), cap.b, true);
}
function renderCapBar(el, pieces) {
  el.innerHTML = "";
  [...pieces].sort((a,b)=>(PIECE_VALUES[b]||0)-(PIECE_VALUES[a]||0)).forEach(t => {
    const s = document.createElement("span");
    s.textContent = CAP_GLYPHS[t]||t; s.title = PIECE_NAMES[t]||t;
    el.appendChild(s);
  });
}
function renderCapSummary(el, pieces, showWhite) {
  el.innerHTML = "";
  [...pieces].sort((a,b)=>(PIECE_VALUES[b]||0)-(PIECE_VALUES[a]||0)).forEach(t => {
    const s = document.createElement("span");
    s.textContent = showWhite ? (WHITE_GLYPHS[t]||t) : (CAP_GLYPHS[t]||t);
    s.title = PIECE_NAMES[t]||t;
    el.appendChild(s);
  });
}
function calcScore(pieces) { return pieces.reduce((s,t) => s+(PIECE_VALUES[t]||0), 0); }
function localCaptured() {
  const init = {p:8,r:2,n:2,b:2,q:1};
  const cnt  = {w:{},b:{}};
  for (const row of chess.board()) for (const sq of row) if (sq) cnt[sq.color][sq.type] = (cnt[sq.color][sq.type]||0)+1;
  const cap = {w:[],b:[]};
  for (const [t,q] of Object.entries(init)) {
    for (let i=0; i<q-(cnt.b[t]||0); i++) cap.w.push(t);
    for (let i=0; i<q-(cnt.w[t]||0); i++) cap.b.push(t);
  }
  return cap;
}

// ─────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────
function resetState() {
  selSq=null; legalSqs=[]; lastMove=null; moveLog=[];
  gameOver=false; aiThinking=false; clocks={w:600,b:600};
  clickProcessing=false;
  stopClock(); showThinkBar(false);
  pendingPromo=null;
}

// ─────────────────────────────────────────────────────────
// DIFFICULTY BUTTONS — sync visual state
// ─────────────────────────────────────────────────────────
function syncDiffButtons(containerId, diff) {
  document.querySelectorAll(`#${containerId} .dbtn`).forEach(b => {
    b.classList.toggle("active", b.dataset.d === diff);
  });
}

// ─────────────────────────────────────────────────────────
// PLAYER STRIPS SETUP
// ─────────────────────────────────────────────────────────
function setupStrips(myRole) {
  if (myRole === "w") {
    $("my-ava").textContent="♙";  $("my-name").textContent="You (White)";
    $("opp-ava").textContent="♟"; $("opp-name").textContent = mode==="offline" ? `Computer (${aiDiff})` : "Black";
  } else {
    $("my-ava").textContent="♟";  $("my-name").textContent="You (Black)";
    $("opp-ava").textContent="♙"; $("opp-name").textContent="White";
  }
}

// ─────────────────────────────────────────────────────────
// MATCHMAKING SEARCH TIMER
// ─────────────────────────────────────────────────────────
let searchSecs=0, searchIv=null;
function startSearchTimer() {
  searchSecs=0; clearInterval(searchIv);
  searchIv = setInterval(() => { searchSecs++; $("search-time").textContent=searchSecs+"s"; }, 1000);
}
function stopSearchTimer() { clearInterval(searchIv); searchIv=null; }

// ─────────────────────────────────────────────────────────
// ONLINE — QUICK MATCH
// ─────────────────────────────────────────────────────────
function startQuickMatch() {
  mode="online"; chess.reset(); resetState();
  history.replaceState(null,"","/");
  show("search"); startSearchTimer();
  ChessSocket.connect();
  ChessSocket.on("connected",   () => ChessSocket.findMatch());
  ChessSocket.on("reconnected", () => ChessSocket.findMatch());
  ChessSocket.on("searching",   () => {});
  ChessSocket.on("matchFound", ({roomId:rid}) => {
    roomId=rid; stopSearchTimer(); SFX.found();
    showToast("⚡ Opponent found!");
    $("gbar-room").textContent = `Match: ${rid}`;
    history.replaceState(null,"","/room/"+rid);
  });
  attachOnlineHandlers();
}

// ─────────────────────────────────────────────────────────
// ONLINE — PRIVATE ROOM
// ─────────────────────────────────────────────────────────
function startPrivateRoom() {
  const rid = Math.random().toString(36).slice(2,8).toUpperCase();
  roomId=rid; mode="online"; chess.reset(); resetState();
  history.pushState(null,"","/room/"+rid);
  $("share-input").value = window.location.href;
  $("wait-color").textContent = "You play as White ♙";
  show("wait");
  ChessSocket.connect();
  ChessSocket.on("connected",   () => ChessSocket.joinRoom(rid, true));
  ChessSocket.on("reconnected", () => ChessSocket.joinRoom(rid, false));
  $("gbar-room").textContent = `Room: ${rid}`;
  attachOnlineHandlers();
}

// ─────────────────────────────────────────────────────────
// ONLINE — JOIN EXISTING ROOM
// ─────────────────────────────────────────────────────────
function joinRoom(rid) {
  rid = rid.toUpperCase();
  roomId=rid; mode="online"; chess.reset(); resetState();
  history.replaceState(null,"","/room/"+rid);
  $("share-input").value = window.location.origin+"/room/"+rid;
  show("wait");
  ChessSocket.connect();
  ChessSocket.on("connected",   () => ChessSocket.joinRoom(rid, false));
  ChessSocket.on("reconnected", () => ChessSocket.joinRoom(rid, false));
  $("gbar-room").textContent = `Room: ${rid}`;
  attachOnlineHandlers();
}

// ─────────────────────────────────────────────────────────
// SHARED ONLINE HANDLERS
// ─────────────────────────────────────────────────────────
function attachOnlineHandlers() {
  ChessSocket.on("disconnected", () => showToast("⚠️ Connection lost…"));
  ChessSocket.on("oppDisc",      () => showToast("⚠️ Opponent disconnected"));
  ChessSocket.on("roomError", (type) => {
    ChessSocket.disconnect();
    if (type==="full") showError("Room Full","This game already has 2 players.");
    else               showError("Invalid Room","This room doesn't exist.");
  });
  ChessSocket.on("role", (r) => {
    role = r;
    if (r==="spectator") { ChessSocket.disconnect(); showError("Room Full","Already 2 players."); return; }
    $("wait-color").textContent = r==="w" ? "You play as White ♙" : "You play as Black ♟";
    setupStrips(r);
  });
  ChessSocket.on("snapshot", (data) => {
    chess.load(data.fen);
    moveLog=data.moveLog||[]; lastMove=data.lastMove||null;
    clocks=data.clocks||{w:600,b:600}; gameOver=false; clearSel();
    if (VIEWS.game.style.display !== "flex") {
      $("ai-panel").classList.add("hidden");
      $("btn-undo").style.display="none";
      show("game"); SFX.start();
    }
    renderBoard(); renderMoveLog(); updateCaptures(data.captured);
    renderClocks(); updateStatus(data.status, data.playerCount);
  });
  ChessSocket.on("moveMade", (ev) => {
    playSoundFromEvent(ev); popPieces();
    if (ev.promotion) showToast(`♛ Promoted to ${PIECE_NAMES[ev.promotion]}!`);
  });
  ChessSocket.on("clockTick",    t => { clocks=t; renderClocks(); });
  ChessSocket.on("clockTimeout", ({loser,winner}) => {
    gameOver=true; stopClock();
    showGameOver("⏰","Time's Up!",`${loser} ran out of time — ${winner} wins!`);
  });
  ChessSocket.on("resigned", ({color,winner}) => {
    gameOver=true;
    showGameOver("🏳️","Resigned",`${color} resigned — ${winner} wins!`);
    SFX.checkmate();
  });
  ChessSocket.on("restarted", () => {
    gameOver=false; chess.reset(); resetState();
    renderBoard(); renderMoveLog(); updateCaptures(); renderClocks();
    showToast("New game!"); SFX.start();
  });
  ChessSocket.on("invalidMove", () => { SFX.illegal(); showToast("Invalid move!"); });
}

// ─────────────────────────────────────────────────────────
// OFFLINE — start vs Computer
// aiDiff is already set from lobby selection — do NOT change it here
// ─────────────────────────────────────────────────────────
function startOffline() {
  mode="offline"; chess.reset(); resetState();
  role="w"; history.replaceState(null,"","/");
  ChessSocket.disconnect();

  // LOCK the difficulty — snapshot aiDiff into lockedDiff
  // From this point, AI always uses lockedDiff regardless of button clicks
  lockedDiff = aiDiff;

  setupStrips("w");
  $("gbar-room").textContent = `vs AI (${aiDiff})`;
  $("ai-panel").classList.remove("hidden");
  $("btn-undo").style.display = "flex";

  // Sync in-game diff buttons to match lobby selection
  syncDiffButtons("game-diff", aiDiff);

  show("game");
  renderBoard(); renderMoveLog(); updateCaptures();
  renderClocks(); updateStatus(localStatus(), 2);
  SFX.start(); startLocalClock();
}

// ─────────────────────────────────────────────────────────
// URL ROOM CHECK ON LOAD
// ─────────────────────────────────────────────────────────
function checkUrlRoom() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0]==="room" && parts[1]) { setTimeout(() => joinRoom(parts[1]), 120); return true; }
  return false;
}

// ─────────────────────────────────────────────────────────
// ERROR / GAME OVER
// ─────────────────────────────────────────────────────────
function showError(title, msg) {
  $("err-icon").textContent="⚠️"; $("err-title").textContent=title; $("err-msg").textContent=msg;
  show("error");
}
function showGameOver(glyph, title, result) {
  $("gom-glyph").textContent=glyph; $("gom-title").textContent=title; $("gom-result").textContent=result;
  $("gameover-overlay").classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────
// LOBBY WIRING
// ─────────────────────────────────────────────────────────
show("lobby");
if (!checkUrlRoom()) { /* stay on lobby */ }

$("btn-quickmatch").addEventListener("click", startQuickMatch);
$("btn-private"   ).addEventListener("click", startPrivateRoom);
$("btn-join-toggle").addEventListener("click", () => {
  const jb = $("join-box"); jb.classList.toggle("hidden");
  if (!jb.classList.contains("hidden")) $("join-input").focus();
});
$("join-go").addEventListener("click", () => {
  let val = $("join-input").value.trim();
  if (!val) { showToast("Enter a room code or link"); return; }
  const m = val.match(/\/room\/([A-Z0-9]+)/i);
  if (m) val = m[1];
  joinRoom(val.toUpperCase());
});
$("join-input").addEventListener("keydown", e => { if(e.key==="Enter") $("join-go").click(); });

// Lobby AI toggle
$("btn-ai-toggle").addEventListener("click", () => {
  const ab = $("ai-box"); ab.classList.toggle("hidden");
  if (!ab.classList.contains("hidden")) syncDiffButtons("lobby-diff", aiDiff);
});

// ── LOBBY DIFFICULTY BUTTONS ──
// Sets aiDiff BEFORE game starts. This value carries into startOffline().
document.querySelectorAll("#lobby-diff .dbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    aiDiff = btn.dataset.d;
    syncDiffButtons("lobby-diff", aiDiff);
    const labels = { easy:"🟢 Easy", medium:"🟡 Medium", hard:"🔴 Hard" };
    showToast(`Difficulty: ${labels[aiDiff] || aiDiff}`);
  });
});
$("ai-go").addEventListener("click", startOffline);

// Cancel
$("btn-cancel-search").addEventListener("click", () => {
  ChessSocket.cancelSearch(); ChessSocket.disconnect(); stopSearchTimer();
  history.replaceState(null,"","/"); show("lobby");
});
$("btn-cancel-wait").addEventListener("click", () => {
  ChessSocket.disconnect(); history.replaceState(null,"","/"); show("lobby");
});
$("btn-err-home").addEventListener("click", () => {
  history.replaceState(null,"","/"); show("lobby");
});

// ─────────────────────────────────────────────────────────
// GAME TOPBAR
// ─────────────────────────────────────────────────────────
$("gbar-back").addEventListener("click", () => {
  ChessSocket.disconnect(); stopClock();
  history.replaceState(null,"","/");
  $("gameover-overlay").classList.add("hidden");
  show("lobby");
});
$("gbar-mute").addEventListener("click", () => {
  muted = !muted;
  $("ico-snd").innerHTML = muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  showToast(muted ? "🔇 Muted" : "🔊 Sound on");
});

// ─────────────────────────────────────────────────────────
// GAME ACTIONS
// ─────────────────────────────────────────────────────────
$("btn-resign").addEventListener("click", () => {
  if (gameOver || role==="spectator") return;
  if (mode==="online") ChessSocket.sendResign();
  else { gameOver=true; stopClock(); showGameOver("🏳️","You Resigned","Computer wins!"); }
});
$("btn-restart").addEventListener("click", () => {
  if (mode==="online") { ChessSocket.sendRestart(); return; }
  chess.reset(); resetState();
  lockedDiff = aiDiff; // re-lock with current selection
  setupStrips("w");
  syncDiffButtons("game-diff", aiDiff);
  renderBoard(); renderMoveLog(); updateCaptures();
  renderClocks(); updateStatus(localStatus(), 2);
  showToast("New game!"); SFX.start(); startLocalClock();
});
$("btn-undo").addEventListener("click", () => {
  if (mode!=="offline" || aiThinking || gameOver) return;
  chess.undo(); chess.undo();
  moveLog = moveLog.slice(0,-2); lastMove=null; clearSel();
  renderBoard(); renderMoveLog(); updateCaptures();
  updateStatus(localStatus(), 2); showToast("Move undone");
});
$("btn-share").addEventListener("click", () => {
  navigator.clipboard.writeText(window.location.href)
    .then(() => showToast("✅ Link copied!"), () => showToast(window.location.href));
});
$("btn-pgn").addEventListener("click", () => {
  const pgn = chess.pgn() || "No moves yet";
  navigator.clipboard.writeText(pgn).then(() => showToast("PGN copied!"), ()=>{});
});

// ── IN-GAME DIFFICULTY BUTTONS ──
// While playing offline, allow changing difficulty mid-game.
// Easy stays Easy, Medium stays Medium, Hard stays Hard — no auto-switching.
document.querySelectorAll("#game-diff .dbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    aiDiff = btn.dataset.d;
    syncDiffButtons("game-diff", aiDiff);
    $("gbar-room").textContent = `vs AI (${aiDiff})`;
    $("opp-name").textContent  = `Computer (${aiDiff})`;
    const labels = { easy:"🟢 Easy", medium:"🟡 Medium", hard:"🔴 Hard" };
    showToast(`Difficulty: ${labels[aiDiff] || aiDiff}`);
  });
});

// ─────────────────────────────────────────────────────────
// GAME OVER MODAL
// ─────────────────────────────────────────────────────────
$("gom-again").addEventListener("click", () => {
  $("gameover-overlay").classList.add("hidden");
  $("btn-restart").click();
});
$("gom-menu").addEventListener("click", () => {
  $("gameover-overlay").classList.add("hidden");
  $("gbar-back").click();
});
$("gameover-overlay").addEventListener("click", e => {
  if (e.target === $("gameover-overlay")) $("gameover-overlay").classList.add("hidden");
});

// ─────────────────────────────────────────────────────────
// COPY BUTTON
// ─────────────────────────────────────────────────────────
$("btn-copy").addEventListener("click", () => {
  const url = $("share-input").value;
  navigator.clipboard.writeText(url).then(() => {
    $("btn-copy").textContent="Copied!"; $("btn-copy").classList.add("copied");
    setTimeout(() => { $("btn-copy").textContent="Copy"; $("btn-copy").classList.remove("copied"); }, 2200);
  }, () => showToast(url));
});

// ─────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────
let toastTm;
function showToast(msg) {
  const t = $("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTm);
  toastTm = setTimeout(() => t.classList.remove("show"), 2800);
}

})();
