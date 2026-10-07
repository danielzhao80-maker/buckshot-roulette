// ============================================================
// server.js -- Multiplayer game server
// Uses Express for static files and Socket.io for real-time
// room-based 1v1 matchmaking (Buckshot Roulette online mode).
// ============================================================

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Disable caching so updated client code is picked up immediately.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Any non-asset URL (including the friendly "/Users/.../shooting-game" path
// we display in the address bar) returns the game's index.html so refreshes work.
app.get(/^(?!\/socket\.io).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Room Management ──────────────────────────────────────────
// Each room holds exactly 2 players for a 1v1 match.
const rooms = new Map();

/** Generate a unique 4-character room code (no ambiguous chars like I/O/0/1). */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

// ── Socket Events ────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  let currentRoom = null;

  // -- Create a new room and wait for an opponent --
  socket.on('create-room', () => {
    const code = generateRoomCode();
    const room = {
      code,
      players: new Map(),
      state: 'waiting',
      hostAddress: socket.handshake.address
    };
    room.players.set(socket.id, {
      seatIndex: 0,
      health: 100,
      kills: 0,
      deaths: 0
    });
    rooms.set(code, room);
    currentRoom = code;
    socket.join(code);

    socket.emit('room-created', { code, seatIndex: 0 });
    console.log('Room created:', code, 'host=', room.hostAddress);
  });

  function tryStartGame(room) {
    if (!room || room.state === 'playing') return;
    if (room.players.size < 2) return;
    if (!room.startPending) return;
    room.state = 'playing';
    io.to(room.code).emit('game-start', { playerCount: 2 });
    console.log('Game started in room:', room.code);
  }

  // -- Join an existing room by code --
  socket.on('join-room', (data) => {
    const code = data.code.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room-error', { message: 'Room not found' });
      return;
    }
    if (room.players.size >= 2) {
      socket.emit('room-error', { message: 'Room is full' });
      return;
    }
    if (room.state !== 'waiting') {
      socket.emit('room-error', { message: 'Game already in progress' });
      return;
    }
    // Multiplayer requires two distinct devices — block joiners on the host's address.
    if (room.hostAddress && socket.handshake.address === room.hostAddress) {
      socket.emit('room-error', { message: 'Join from a different device — host and joiner cannot share an address' });
      return;
    }

    room.players.set(socket.id, {
      seatIndex: 1,
      health: 100,
      kills: 0,
      deaths: 0
    });
    currentRoom = code;
    socket.join(code);

    socket.emit('room-joined', { code, seatIndex: 1 });

    // Notify the host that an opponent has arrived — host clicks START MATCH to begin.
    socket.to(code).emit('opponent-joined');
    console.log('Opponent joined room:', code);

    // If the host already pressed START MATCH while waiting, auto-start now.
    tryStartGame(room);
  });

  // -- Only the host (seatIndex 0) can start the match.
  // If the joiner hasn't arrived yet, mark the start as pending and
  // auto-start the moment they join. --
  socket.on('start-match', () => {
    if (!currentRoom) {
      socket.emit('room-error', { message: 'No active room' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      socket.emit('room-error', { message: 'Room no longer exists' });
      return;
    }
    const player = room.players.get(socket.id);
    if (!player || player.seatIndex !== 0) {
      socket.emit('start-error', { message: 'Only the host can start the match' });
      return;
    }
    if (room.state === 'playing') return;

    // Mark pending and try to start; if alone, will start once joiner enters.
    room.startPending = true;
    socket.emit('start-pending');
    tryStartGame(room);
  });

  // -- Relay game state between players --
  socket.on('player-update', (state) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('player-update', state);
  });

  socket.on('player-shoot', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('opponent-shoot', data);
  });

  socket.on('player-item', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('opponent-item', data);
  });

  // -- Host broadcasts round state (shells) so both players see the same gun --
  socket.on('round-state', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('round-state', data);
  });

  // -- Process damage: apply to opponent, check for kills --
  socket.on('hit-report', (data) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Find the target (the other player)
    for (const [id, player] of room.players) {
      if (id !== socket.id) {
        player.health = Math.max(0, player.health - (data.damage || 15));

        io.to(id).emit('player-damaged', { damage: data.damage || 15 });

        if (player.health <= 0) {
          player.deaths++;
          const shooter = room.players.get(socket.id);
          if (shooter) shooter.kills++;

          io.to(id).emit('player-killed', {
            target: 'self',
            opponentKills: shooter ? shooter.kills : 0
          });
          socket.emit('player-killed', {
            target: 'opponent',
            opponentKills: player.kills
          });

          console.log('Kill in room', currentRoom);
        }
        break;
      }
    }
  });

  socket.on('respawn', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      player.health = 100;
    }

    socket.to(currentRoom).emit('player-respawned', { id: socket.id });
  });

  socket.on('leave-room', () => {
    if (currentRoom) {
      cleanupRoom(socket, currentRoom);
      currentRoom = null;
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (currentRoom) {
      cleanupRoom(socket, currentRoom);
      currentRoom = null;
    }
  });

  /** Remove a player from their room; delete the room if empty. */
  function cleanupRoom(socket, roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(socket.id);
    socket.leave(roomCode);

    if (room.players.size === 0) {
      rooms.delete(roomCode);
      console.log('Room deleted:', roomCode);
    } else {
      io.to(roomCode).emit('opponent-disconnected');
    }
  }
});

// ── Start Server ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serving ${__dirname}`);
  console.log(`Port ${PORT}`);
  console.log(`  → ${__dirname}`);
});
