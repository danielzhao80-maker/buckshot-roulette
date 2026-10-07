// ============================================================
// main.js -- Entry point & menu wiring
// Hooks up all menu buttons to the Game, Network, and
// FPSGame modules. Runs once on page load.
// ============================================================

(function () {
  Game.init();

  // ── DOM References ───────────────────────────────────────
  const hubMenu         = document.getElementById('hub-menu');
  const bsMenu          = document.getElementById('menu');
  const fpsMenu         = document.getElementById('fps-menu');
  const onlineMenu      = document.getElementById('online-menu');
  const waitingRoom     = document.getElementById('waiting-room');
  const roomCodeDisplay = document.getElementById('room-code-display');

  // ── Hub Menu (hidden -- reserved for multi-game hub) ─────
  document.getElementById('btn-buckshot').addEventListener('click', () => {
    hubMenu.classList.add('hidden');

    // Offer to resume a saved offline game
    const saved = SaveSystem.load();
    if (saved && saved.mode === 'offline') {
      if (confirm('Resume saved game? (Round ' + (saved.round || 1) + ')')) {
        bsMenu.classList.add('hidden');
        Game.restore(saved);
        return;
      } else {
        SaveSystem.clear();
      }
    }
    bsMenu.classList.remove('hidden');
  });

  document.getElementById('btn-fps').addEventListener('click', () => {
    hubMenu.classList.add('hidden');
    fpsMenu.classList.remove('hidden');
  });

  // ── Buckshot Roulette Menus ──────────────────────────────

  document.getElementById('btn-offline').addEventListener('click', () => {
    bsMenu.classList.add('hidden');
    SaveSystem.clear();
    Game.start('offline');
  });

  document.getElementById('btn-online').addEventListener('click', () => {
    bsMenu.classList.add('hidden');
    onlineMenu.classList.remove('hidden');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    onlineMenu.classList.add('hidden');
    bsMenu.classList.remove('hidden');
  });

  document.getElementById('btn-back-hub').addEventListener('click', () => {
    bsMenu.classList.add('hidden');
    hubMenu.classList.remove('hidden');
  });

  // ── Online: Create Room ──────────────────────────────────

  document.getElementById('btn-create-room').addEventListener('click', () => {
    Network.connect();
    Network.createRoom();
    onlineMenu.classList.add('hidden');
    waitingRoom.classList.remove('hidden');

    // Poll until the server sends back a room code
    const checkCode = setInterval(() => {
      if (Network.roomCode) {
        clearInterval(checkCode);
        roomCodeDisplay.textContent = Network.roomCode;
      }
    }, 100);

    Network.onGameStart = () => {
      waitingRoom.classList.add('hidden');
      Game.start('online');
    };
  });

  // ── Online: Join Room ────────────────────────────────────

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('input-room-code').value.trim().toUpperCase();
    if (code.length !== 4) { alert('Enter a 4-character room code'); return; }

    Network.connect();
    Network.onGameStart = () => {
      onlineMenu.classList.add('hidden');
      Game.start('online');
    };
    Network.joinRoom(code);
  });

  document.getElementById('btn-cancel-wait').addEventListener('click', () => {
    Network.leaveRoom();
    waitingRoom.classList.add('hidden');
    bsMenu.classList.remove('hidden');
  });

  // ── Game Over ────────────────────────────────────────────

  document.getElementById('btn-play-again').addEventListener('click', () => {
    document.getElementById('game-over').classList.add('hidden');
    Game.start(Game.mode);
  });

  document.getElementById('btn-main-menu').addEventListener('click', () => {
    location.reload();
  });

  // ── Arcade skin shop ─────────────────────────────────────
  // The shop (arcade-shop.js) calls this after every buy/equip. New skins
  // apply at once to whatever scene is built; scenes built later read
  // ArcadeSkins directly. Purely cosmetic.
  window.applyArcadeSkins = function (skins) {
    if (!window.ArcadeSkins || !ArcadeSkins.set) return;
    ArcadeSkins.set(skins); // same validation as the ?arcadeSkins= / localStorage read
    if (GameScene.scene) {
      GameScene._applyBgSkin();
      GameScene._applyGunSkin();
    }
    if (FPSGame.scene) FPSGame._applyBgSkin();
  };

  // ⚡ Arcade abilities: show only Buckshot's in the shop. Game reads them live
  // (ArcadeShop.abilityValue at the moment of use), so the apply hook is a no-op.
  if (window.ArcadeShop && window.ArcadeShop.setGame) window.ArcadeShop.setGame('buckshot');
  window.applyArcadeAbilities = () => {};

  // Play coins (earned in the arcade) → bonus items for your next offline rounds.
  if (window.ArcadeShop && window.ArcadeShop.registerCurrency) {
    window.ArcadeShop.registerCurrency({
      name: 'Bonus Items', emoji: '🎁', rate: 3,
      note: 'Up to 2 are added to your items each offline round (the table holds 4).',
      grant(amount) {
        const have = parseInt(localStorage.getItem(BONUS_ITEMS_KEY), 10) || 0;
        localStorage.setItem(BONUS_ITEMS_KEY, String(have + amount));
      },
    });
    window.ArcadeShop.registerCurrency({
      name: 'Extra Lives', emoji: '❤️', rate: 1,
      note: 'Each one gives you a gold bonus charge at the start of one offline round.',
      grant(amount) {
        const have = parseInt(localStorage.getItem(EXTRA_LIVES_KEY), 10) || 0;
        localStorage.setItem(EXTRA_LIVES_KEY, String(have + amount));
      },
    });
  }

  ['btn-skins', 'btn-pause-skins'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (!window.ArcadeShop) { btn.classList.add('hidden'); return; }
    btn.addEventListener('click', () => window.ArcadeShop.open());
  });

  // ── Pause ────────────────────────────────────────────────

  document.getElementById('btn-resume').addEventListener('click', () => Game.resume());
  document.getElementById('btn-quit').addEventListener('click', () => Game.quit());

  document.addEventListener('keydown', (e) => {
    const gameVisible = Game.els && Game.els.gameScreen
      && !Game.els.gameScreen.classList.contains('hidden');
    if (e.key === 'Escape' && !Game.gameOver && gameVisible) {
      Game.togglePause();
    }
  });

  // ── FPS Arena (hidden mode) ──────────────────────────────

  document.getElementById('btn-fps-start').addEventListener('click', () => {
    fpsMenu.classList.add('hidden');
    FPSGame.init();
  });

  document.getElementById('btn-fps-back').addEventListener('click', () => {
    fpsMenu.classList.add('hidden');
    hubMenu.classList.remove('hidden');
  });
})();
