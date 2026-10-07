// ============================================================
// network.js -- Socket.io client for online multiplayer
// Manages connection, room creation/joining, and relaying
// game events (shoots, items, disconnects) to/from the server.
// ============================================================

const Network = {
  socket: null,
  connected: false,
  roomCode: null,
  seatIndex: -1,     // 0 = host, 1 = joiner

  // Callbacks (set by game code before connecting)
  onGameStart: null,
  onOpponentShoot: null,
  onOpponentItem: null,
  onOpponentDisconnect: null,
  onGameState: null,

  connect() {
    if (this.socket) return;
    this.socket = io();

    this.socket.on('connect', () => { this.connected = true; });

    this.socket.on('room-created', (data) => {
      this.roomCode = data.code;
      this.seatIndex = data.seatIndex;
    });

    this.socket.on('room-joined', (data) => {
      this.roomCode = data.code;
      this.seatIndex = data.seatIndex;
    });

    this.socket.on('game-start', (data) => {
      if (this.onGameStart) this.onGameStart(data);
    });

    this.socket.on('opponent-shoot', (data) => {
      if (this.onOpponentShoot) this.onOpponentShoot(data);
    });

    this.socket.on('opponent-item', (data) => {
      if (this.onOpponentItem) this.onOpponentItem(data);
    });

    this.socket.on('game-state', (data) => {
      if (this.onGameState) this.onGameState(data);
    });

    this.socket.on('opponent-disconnected', () => {
      if (this.onOpponentDisconnect) this.onOpponentDisconnect();
    });

    this.socket.on('room-error', (data) => {
      alert(data.message);
    });
  },

  createRoom() {
    if (!this.socket) this.connect();
    this.socket.emit('create-room');
  },

  joinRoom(code) {
    if (!this.socket) this.connect();
    this.socket.emit('join-room', { code: code.toUpperCase() });
  },

  sendShoot(data) {
    if (this.socket) this.socket.emit('player-shoot', data);
  },

  sendItem(data) {
    if (this.socket) this.socket.emit('player-item', data);
  },

  leaveRoom() {
    if (this.socket) this.socket.emit('leave-room');
    this.roomCode = null;
    this.seatIndex = -1;
  },

  disconnect() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this.connected = false;
    this.roomCode = null;
    this.seatIndex = -1;
  }
};
