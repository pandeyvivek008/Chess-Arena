"use strict";

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const Chess      = require("chess.js").Chess || require("chess.js");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/",             (_, res) => res.render("index"));
app.get("/room/:roomId", (_, res) => res.render("index"));

// ─────────────────────────────────────────────────────────────────
// ROOM MANAGEMENT
// ─────────────────────────────────────────────────────────────────
const rooms = new Map();

function makeRoom(roomId, isPrivate = false) {
  return {
    id:        roomId,
    isPrivate,
    chess:     new Chess(),
    players:   { white: null, black: null },
    // Extended move history: { san, from, to, captured, capturedBy, flags, piece }
    moveLog:   [],
    lastMove:  null,
    clocks:    { w: 600, b: 600 },
    clockTick: null,
  };
}

function getRoom(id)       { return rooms.get(id); }
function getOrMake(id, prv) {
  if (!rooms.has(id)) rooms.set(id, makeRoom(id, prv));
  return rooms.get(id);
}

function roomStatus(room) {
  const c = room.chess;
  if (c.in_checkmate()) return { type: "checkmate", turn: c.turn() };
  if (c.in_draw())      return { type: "draw",      turn: c.turn() };
  if (c.in_stalemate()) return { type: "stalemate", turn: c.turn() };
  if (c.in_check())     return { type: "check",     turn: c.turn() };
  return                       { type: "playing",   turn: c.turn() };
}

function capturedPieces(chess) {
  const init = { p:8, r:2, n:2, b:2, q:1 };
  const cnt  = { w:{}, b:{} };
  for (const row of chess.board())
    for (const sq of row)
      if (sq) cnt[sq.color][sq.type] = (cnt[sq.color][sq.type]||0)+1;
  const cap = { w:[], b:[] };
  for (const [t,q] of Object.entries(init)) {
    for (let i=0; i < q-(cnt.b[t]||0); i++) cap.w.push(t); // captured BY white
    for (let i=0; i < q-(cnt.w[t]||0); i++) cap.b.push(t); // captured BY black
  }
  return cap;
}

function snapshot(room) {
  const pc = (room.players.white?1:0)+(room.players.black?1:0);
  return {
    fen:         room.chess.fen(),
    pgn:         room.chess.pgn(),
    moveLog:     room.moveLog,
    lastMove:    room.lastMove,
    status:      roomStatus(room),
    playerCount: pc,
    clocks:      { ...room.clocks },
    captured:    capturedPieces(room.chess),
    isPrivate:   room.isPrivate,
  };
}

function startClock(room) {
  if (room.clockTick) return;
  room.clockTick = setInterval(() => {
    const color = room.chess.turn();
    room.clocks[color] = Math.max(0, room.clocks[color]-1);
    io.to(room.id).emit("clockTick", { ...room.clocks });
    if (room.clocks[color] === 0) {
      stopClock(room);
      io.to(room.id).emit("clockTimeout", {
        loser:  color==="w"?"White":"Black",
        winner: color==="w"?"Black":"White",
      });
    }
  }, 1000);
}

function stopClock(room) {
  clearInterval(room.clockTick);
  room.clockTick = null;
}

function resetRoom(room) {
  stopClock(room);
  room.chess    = new Chess();
  room.moveLog  = [];
  room.lastMove = null;
  room.clocks   = { w:600, b:600 };
}

// ─────────────────────────────────────────────────────────────────
// MATCHMAKING QUEUE
// ─────────────────────────────────────────────────────────────────
let matchQueue = null; // single waiting socket

function tryMatch(socket) {
  if (matchQueue && matchQueue.id !== socket.id && matchQueue.connected) {
    // Match found — create room
    const roomId = "mm-" + Math.random().toString(36).slice(2,8).toUpperCase();
    const room   = makeRoom(roomId, false);
    rooms.set(roomId, room);

    // Randomly assign colors
    const [w, b] = Math.random() < 0.5
      ? [matchQueue, socket]
      : [socket, matchQueue];

    room.players.white = w.id;
    room.players.black = b.id;
    w.playerRole = "w";
    b.playerRole = "b";
    w.roomId = roomId;
    b.roomId = roomId;
    w.join(roomId);
    b.join(roomId);

    matchQueue = null;

    w.emit("assignRole", "w");
    b.emit("assignRole", "b");
    w.emit("matchFound", { roomId });
    b.emit("matchFound", { roomId });
    io.to(roomId).emit("gameSnapshot", snapshot(room));
  } else {
    // Put in queue
    matchQueue = socket;
    socket.emit("searching");
  }
}

function removeFromQueue(socket) {
  if (matchQueue && matchQueue.id === socket.id) matchQueue = null;
}

// ─────────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {

  // ── PUBLIC MATCHMAKING ───────────────────────────────────────
  socket.on("findMatch", () => {
    tryMatch(socket);
  });

  socket.on("cancelSearch", () => {
    removeFromQueue(socket);
  });

  // ── PRIVATE ROOM JOIN ────────────────────────────────────────
  socket.on("joinRoom", ({ roomId, create }) => {
    let room;
    if (create) {
      room = makeRoom(roomId, true);
      rooms.set(roomId, room);
    } else {
      room = getRoom(roomId);
      if (!room) { socket.emit("roomError", "invalid"); return; }
      const pc = (room.players.white?1:0)+(room.players.black?1:0);
      if (pc >= 2) { socket.emit("roomError", "full"); return; }
    }

    socket.join(roomId);
    socket.roomId = roomId;

    if (!room.players.white) {
      room.players.white = socket.id;
      socket.playerRole  = "w";
    } else if (!room.players.black) {
      room.players.black = socket.id;
      socket.playerRole  = "b";
    } else {
      socket.playerRole = "spectator";
    }

    socket.emit("assignRole", socket.playerRole);
    io.to(roomId).emit("gameSnapshot", snapshot(room));
  });

  // ── MOVE (with pawn promotion support) ───────────────────────
  socket.on("move", (move) => {
    const room = getRoom(socket.roomId);
    if (!room || socket.playerRole === "spectator") return;
    const chess = room.chess;
    if (chess.turn()==="w" && socket.id!==room.players.white) return;
    if (chess.turn()==="b" && socket.id!==room.players.black) return;

    // move.promotion will be set by client (queen/rook/bishop/knight)
    let result;
    try { result = chess.move(move); } catch(_) { result = null; }
    if (!result) { socket.emit("invalidMove"); return; }

    const moveEntry = {
      num:       Math.ceil(room.moveLog.length / 2) + (result.color==="w" ? 1 : 0),
      san:       result.san,
      from:      result.from,
      to:        result.to,
      piece:     result.piece,
      color:     result.color,
      captured:  result.captured || null,
      flags:     result.flags,
      promotion: result.promotion || null,
    };
    room.moveLog.push(moveEntry);
    room.lastMove = { from: result.from, to: result.to };

    if (room.players.white && room.players.black && !room.clockTick) startClock(room);
    const status = roomStatus(room);
    if (["checkmate","draw","stalemate"].includes(status.type)) stopClock(room);

    io.to(socket.roomId).emit("gameSnapshot", snapshot(room));
    io.to(socket.roomId).emit("moveMade", {
      ...moveEntry, status,
    });
  });

  // ── RESIGN ───────────────────────────────────────────────────
  socket.on("resign", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    stopClock(room);
    const color  = socket.id===room.players.white ? "White" : "Black";
    io.to(socket.roomId).emit("playerResigned", {
      color, winner: color==="White"?"Black":"White",
    });
  });

  // ── RESTART ──────────────────────────────────────────────────
  socket.on("requestRestart", () => {
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (socket.id!==room.players.white && socket.id!==room.players.black) return;
    resetRoom(room);
    io.to(socket.roomId).emit("gameRestarted");
    io.to(socket.roomId).emit("gameSnapshot", snapshot(room));
  });

  // ── DISCONNECT ───────────────────────────────────────────────
  socket.on("disconnect", () => {
    removeFromQueue(socket);
    const room = getRoom(socket.roomId);
    if (!room) return;
    if (socket.id===room.players.white) room.players.white = null;
    if (socket.id===room.players.black) room.players.black = null;
    const empty = !room.players.white && !room.players.black;
    if (empty) {
      stopClock(room);
      rooms.delete(socket.roomId);
    } else {
      stopClock(room);
      io.to(socket.roomId).emit("opponentDisconnected");
      io.to(socket.roomId).emit("gameSnapshot", snapshot(room));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess Arena Server running on port ${PORT}`);
});
