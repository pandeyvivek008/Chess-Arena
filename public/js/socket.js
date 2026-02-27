/**
 * Chess Arena — socket.js
 * Clean Socket.io wrapper
 */
"use strict";

window.ChessSocket = (function () {
  let _s = null;
  const H = {};
  function fire(e, d) { if (H[e]) H[e](d); }

  function connect() {
    if (_s && _s.connected) return;
    _s = io(window.location.origin, { reconnection:true, reconnectionDelay:1200, reconnectionAttempts:8 });
    _s.on("connect",              () => fire("connected"));
    _s.on("disconnect",           () => fire("disconnected"));
    _s.on("reconnect",            () => fire("reconnected"));
    _s.on("searching",            () => fire("searching"));
    _s.on("matchFound",           d  => fire("matchFound",   d));
    _s.on("assignRole",           r  => fire("role",         r));
    _s.on("gameSnapshot",         d  => fire("snapshot",     d));
    _s.on("moveMade",             d  => fire("moveMade",     d));
    _s.on("invalidMove",          () => fire("invalidMove"));
    _s.on("clockTick",            d  => fire("clockTick",    d));
    _s.on("clockTimeout",         d  => fire("clockTimeout", d));
    _s.on("playerResigned",       d  => fire("resigned",     d));
    _s.on("gameRestarted",        () => fire("restarted"));
    _s.on("opponentDisconnected", () => fire("oppDc"));
    _s.on("roomError",            d  => fire("roomError",    d));
  }

  function on(e,fn)    { H[e]=fn; }
  function off(e)      { delete H[e]; }
  function findMatch()          { _s && _s.emit("findMatch"); }
  function cancelSearch()       { _s && _s.emit("cancelSearch"); }
  function joinRoom(id,create)  { _s && _s.emit("joinRoom",{roomId:id,create:!!create}); }
  function sendMove(mv)         { _s && _s.emit("move",mv); }
  function sendResign()         { _s && _s.emit("resign"); }
  function sendRestart()        { _s && _s.emit("requestRestart"); }
  function disconnect()         { if(_s){_s.disconnect();_s=null;} }

  return { connect, on, off, findMatch, cancelSearch, joinRoom, sendMove, sendResign, sendRestart, disconnect };
})();
