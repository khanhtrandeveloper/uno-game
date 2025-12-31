const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { nanoid } = require("nanoid");
const { createGame, makePublicState, playCard, drawAction, callUno } = require("./game");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.json({ ok: true, message: "UNO server running" });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const rooms = new Map();
const socketIndex = new Map();

function createRoomId() {
  return nanoid(6).toUpperCase();
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function broadcastState(room) {
  for (const player of room.players) {
    const state = room.game
      ? makePublicState(room.game, player.id)
      : {
          roomId: room.roomId,
          hostId: room.hostId,
          started: false,
          currentPlayerId: null,
          direction: 1,
          pendingDraw: 0,
          activeColor: null,
          winnerId: null,
          unoPendingPlayerId: null,
          unoCalled: false,
          topCard: null,
          players: room.players.map((p) => ({
            id: p.id,
            name: p.name,
            isSelf: p.id === player.id,
            hand: p.id === player.id ? p.hand : null,
            handCount: p.hand.length
          }))
        };
    io.to(player.socketId).emit("game:state", state);
  }
}

function ensureRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }
  return room;
}

function findQuickRoom() {
  for (const room of rooms.values()) {
    if (!room.started && room.players.length < 4) {
      return room;
    }
  }
  return null;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, callback) => {
    const roomId = createRoomId();
    const playerId = nanoid(8);
    const room = {
      roomId,
      hostId: playerId,
      started: false,
      players: [
        {
          id: playerId,
          socketId: socket.id,
          name: name?.trim() || "Player 1",
          hand: []
        }
      ]
    };
    rooms.set(roomId, room);
    socketIndex.set(socket.id, { roomId, playerId });
    socket.join(roomId);
    callback?.({ ok: true, roomId, playerId });
    broadcastState(room);
  });

  socket.on("room:join", ({ roomId, name }, callback) => {
    const room = ensureRoom(roomId);
    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }
    if (room.started) {
      callback?.({ ok: false, error: "Game already started." });
      return;
    }
    if (room.players.length >= 4) {
      callback?.({ ok: false, error: "Room full." });
      return;
    }
    const playerId = nanoid(8);
    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: name?.trim() || `Player ${room.players.length + 1}`,
      hand: []
    });
    socketIndex.set(socket.id, { roomId, playerId });
    socket.join(roomId);
    callback?.({ ok: true, roomId, playerId });
    broadcastState(room);
  });

  socket.on("room:quick", ({ name }, callback) => {
    let room = findQuickRoom();
    if (!room) {
      const roomId = createRoomId();
      const playerId = nanoid(8);
      room = {
        roomId,
        hostId: playerId,
        started: false,
        players: [
          {
            id: playerId,
            socketId: socket.id,
            name: name?.trim() || "Player 1",
            hand: []
          }
        ]
      };
      rooms.set(roomId, room);
      socketIndex.set(socket.id, { roomId, playerId });
      socket.join(roomId);
      callback?.({ ok: true, roomId, playerId, created: true });
      broadcastState(room);
      return;
    }

    const playerId = nanoid(8);
    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: name?.trim() || `Player ${room.players.length + 1}`,
      hand: []
    });
    socketIndex.set(socket.id, { roomId: room.roomId, playerId });
    socket.join(room.roomId);
    callback?.({ ok: true, roomId: room.roomId, playerId, created: false });
    broadcastState(room);
  });

  socket.on("room:leave", () => {
    removePlayer(socket.id);
  });

  socket.on("game:start", () => {
    const info = socketIndex.get(socket.id);
    if (!info) return;
    const room = ensureRoom(info.roomId);
    if (!room || room.started || room.hostId !== info.playerId) {
      return;
    }
    if (room.players.length < 2) {
      io.to(socket.id).emit("error", "Need at least 2 players.");
      return;
    }
    const game = createGame(room.roomId, room.hostId, room.players);
    room.started = true;
    room.game = game;
    broadcastState(room);
  });

  socket.on("game:play", ({ cardId, cardIds, chosenColor }, callback) => {
    const info = socketIndex.get(socket.id);
    if (!info) return;
    const room = ensureRoom(info.roomId);
    if (!room?.game) return;
    const payloadIds = cardIds || cardId;
    const result = playCard(room.game, info.playerId, payloadIds, chosenColor);
    if (!result.ok) {
      callback?.(result);
      return;
    }
    callback?.({ ok: true });
    broadcastState(room);
  });

  socket.on("game:uno", (callback) => {
    const info = socketIndex.get(socket.id);
    if (!info) return;
    const room = ensureRoom(info.roomId);
    if (!room?.game) return;
    const result = callUno(room.game, info.playerId);
    if (!result.ok) {
      callback?.(result);
      return;
    }
    callback?.({ ok: true });
    broadcastState(room);
  });

  socket.on("game:draw", (callback) => {
    const info = socketIndex.get(socket.id);
    if (!info) return;
    const room = ensureRoom(info.roomId);
    if (!room?.game) return;
    const result = drawAction(room.game, info.playerId);
    if (!result.ok) {
      callback?.(result);
      return;
    }
    callback?.({ ok: true });
    broadcastState(room);
  });

  socket.on("disconnect", () => {
    removePlayer(socket.id);
  });
});

function removePlayer(socketId) {
  const info = socketIndex.get(socketId);
  if (!info) return;
  const room = ensureRoom(info.roomId);
  if (!room) return;
  const removedIndex = room.players.findIndex((player) => player.socketId === socketId);
  room.players = room.players.filter((player) => player.socketId !== socketId);
  socketIndex.delete(socketId);

  if (room.players.length === 0) {
    rooms.delete(info.roomId);
    return;
  }
  if (room.hostId === info.playerId) {
    room.hostId = room.players[0].id;
  }
  if (room.game) {
    room.game.players = room.players;
    if (removedIndex !== -1 && removedIndex < room.game.currentPlayerIndex) {
      room.game.currentPlayerIndex = Math.max(0, room.game.currentPlayerIndex - 1);
    }
    if (room.game.currentPlayerIndex >= room.players.length) {
      room.game.currentPlayerIndex = 0;
    }
  }
  broadcastState(room);
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`UNO server listening on ${PORT}`);
});
