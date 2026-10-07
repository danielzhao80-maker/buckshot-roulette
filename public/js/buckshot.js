// ============================================================
// game.js -- Buckshot Roulette: core game logic
//
// Rules:
//   - 3 rounds, each player starts with 5 HP per round.
//   - Each round: shells loaded, items dealt, take turns.
//   - Pick up shotgun, aim at dealer or yourself, fire.
//   - Blank on self = extra turn. Eliminate the dealer to win.
//
// Items (unlocked in rounds 2-3):
//   - Magnifying Glass: peek at the current shell
//   - Cigarettes: restore 1 HP
//   - Beer: eject (skip) the current shell
//   - Handsaw: double damage on next shot
//   - Handcuffs: opponent skips their next turn
//   - Sticky Fingers: steal a random item from the opponent
// ============================================================

const BONUS_ITEMS_KEY = 'buckshot_bonus_items';
const EXTRA_LIVES_KEY = 'buckshot_extra_lives';

const Game = {
  // ── Game State ────────────────────────────────────────────
  mode: null,       // 'offline' or 'online'
  round: 1,
  maxRounds: 3,
  paused: false,

  roundCharges: [5, 5, 5],  // HP per round

  playerLives: 5,
  dealerLives: 5,
  maxLives: 5,

  shells: [],       // array of 'live' | 'blank'
  shellIndex: 0,    // index of next shell to fire

  playerItems: [],
  dealerItems: [],
  maxItemsPerRound: [0, 2, 4],

  isPlayerTurn: true,
  turnActive: false,
  gameOver: false,
  _cuffed: false,   // true if opponent is handcuffed (skip turn)

  sawedOff: false,  // handsaw active (2x damage)
  knownShell: null,  // magnifying glass result

  els: {},          // cached DOM element references

  // ── Initialization ──────────────────────────────────────
  init() {
    this.els = {
      roundNumber: document.getElementById('round-number'),
      shellDisplay: document.getElementById('shell-display'),
      playerLives: document.getElementById('player-lives'),
      opponentLives: document.getElementById('opponent-lives'),
      playerItems: document.getElementById('player-items'),
      turnIndicator: document.getElementById('turn-indicator'),
      turnText: document.getElementById('turn-text'),
      actions: document.getElementById('actions'),
      itemButtons: document.getElementById('item-buttons'),
      messageDisplay: document.getElementById('message-display'),
      messageText: document.getElementById('message-text'),
      gameOver: document.getElementById('game-over'),
      gameOverText: document.getElementById('game-over-text'),
      gameScreen: document.getElementById('game-screen')
    };
  },

  /** Start a new game in the given mode ('offline' or 'online'). */
  start(mode) {
    this.mode = mode;
    this.round = 1;
    this.gameOver = false;
    this.sawedOff = false;
    this.knownShell = null;
    this._cuffed = false;

    this.els.gameScreen.classList.remove('hidden');
    this.els.gameOver.classList.add('hidden');
    this.els.actions.classList.add('hidden');

    GameScene.init();
    GameAudio.init();

    GameScene.onShoot = (target) => this.playerShoot(target);
    GameScene.onGunPickedUp = () => {
      this._showMessage('AIM & CLICK TO FIRE');
    };

    document.addEventListener('click', () => GameAudio.resume(), { once: true });

    this._startRound();
    SaveSystem.start(() => this.getSaveState());
  },

  /** Restore a previously saved game state. */
  restore(saved) {
    this.mode = saved.mode;
    this.round = saved.round || 1;
    this.playerLives = saved.playerLives;
    this.dealerLives = saved.dealerLives;
    this.maxLives = saved.maxLives;
    this.shells = saved.shells || [];
    this.shellIndex = saved.shellIndex || 0;
    this.playerItems = saved.playerItems || [];
    this.dealerItems = saved.dealerItems || [];
    this.isPlayerTurn = saved.isPlayerTurn !== false;
    this.gameOver = false;
    this.sawedOff = false;
    this.knownShell = null;
    this._cuffed = false;

    this.els.gameScreen.classList.remove('hidden');
    this.els.gameOver.classList.add('hidden');
    this.els.actions.classList.add('hidden');

    GameScene.init();
    GameAudio.init();
    GameScene.onShoot = (target) => this.playerShoot(target);
    GameScene.onGunPickedUp = () => this._showMessage('AIM & CLICK TO FIRE');
    document.addEventListener('click', () => GameAudio.resume(), { once: true });

    this.updateUI();

    if (this.shells.length === 0 || this.shellIndex >= this.shells.length) {
      this._loadNewShells();
    } else {
      this.startTurn();
    }

    SaveSystem.start(() => this.getSaveState());
  },

  // ── Round & Shell Management ─────────────────────────────

  /** Begin a new round: reset HP, load shells, deal items. */
  _startRound() {
    this.sawedOff = false;
    this.knownShell = null;
    this._cuffed = false;

    // Set charges for this round
    this.maxLives = this.roundCharges[this.round - 1] || 6;
    this.playerLives = this.maxLives;
    this.dealerLives = this.maxLives;
    this._useExtraLife();
    // ⚡ Lucky Charge (arcade ability "tough"): chance of a gold bonus charge; never stacks past +1.
    const tough = this._abilityRoll('tough') && this.playerLives <= this.maxLives;
    if (tough) this.playerLives = this.maxLives + 1;

    this._showMessage('ROUND ' + this.round + (tough ? ' · 🍀 Lucky Charge: bonus charge!' : ''));

    setTimeout(() => {
      this._loadNewShells();
    }, 1500);
  },

  /** Shuffle new shells into the gun and deal items. */
  _loadNewShells() {
    this.sawedOff = false;
    this.knownShell = null;

    // Always at least 1 live and 1 blank; rest are random
    const shellCount = 2 + Math.floor(Math.random() * (this.round === 1 ? 3 : 5)); // 2-4 round 1, 2-6 round 2+
    this.shells = [];

    this.shells.push('live');
    this.shells.push('blank');

    for (let i = 2; i < shellCount; i++) {
      this.shells.push(Math.random() < 0.5 ? 'live' : 'blank');
    }

    // Shuffle
    for (let i = this.shells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shells[i], this.shells[j]] = [this.shells[j], this.shells[i]];
    }

    this.shellIndex = 0;

    // Deal items (none in round 1)
    const itemCount = this.maxItemsPerRound[this.round - 1] ?? 4;
    this.playerItems = this._generateItems(itemCount);
    this._addBonusItems();
    this.dealerItems = this._generateItems(itemCount);

    // Announce shell count
    const liveCount = this.shells.filter(s => s === 'live').length;
    const blankCount = this.shells.filter(s => s === 'blank').length;

    GameAudio.playPump();
    this.updateUI();

    this._animateShellLoad().then(async () => {
      this._showMessage(liveCount + ' LIVE, ' + blankCount + ' BLANK');

      // Open item box, place items, then close
      if (this.playerItems.length > 0 || this.dealerItems.length > 0) {
        await this._delay(1200);
        if (GameScene.openItemBox) await GameScene.openItemBox();
        await this._delay(400);
        if (GameScene.placeItems) GameScene.placeItems(this.playerItems, this.dealerItems);
        this._showMessage('ITEMS DEALT');
        await this._delay(1000);
        if (GameScene.closeItemBox) await GameScene.closeItemBox();
        await this._delay(500);
      } else {
        await this._delay(1800);
      }

      this.startTurn();
    });
  },

  /**
   * Bonus items bought with arcade play coins (🛒 Shop → 🎁 Bonus Items) are stockpiled in
   * localStorage. Each offline round adds up to 2 of them, never past the table's 4 slots.
   */
  /** ⚡ Arcade ability chance (percent, 0-100) for this game. Offline only; read live each call. */
  _abilityChance(id) {
    if (this.mode === 'online' || !window.ArcadeShop || !window.ArcadeShop.abilityValue) return 0;
    try { return Number(window.ArcadeShop.abilityValue(id)) || 0; } catch (e) { return 0; }
  },

  /** Roll an ability at the moment of the event. Never touches Math.random when not learned. */
  _abilityRoll(id) {
    const v = this._abilityChance(id);
    return v > 0 && Math.random() * 100 < v;
  },

  /** Extra lives bought with arcade play coins: one per offline round, as a bonus heart. */
  _useExtraLife() {
    if (this.mode === 'online') return;
    let stock = 0;
    try { stock = parseInt(localStorage.getItem(EXTRA_LIVES_KEY), 10) || 0; } catch (e) {}
    if (stock <= 0) return;
    this.playerLives = this.maxLives + 1;
    try { localStorage.setItem(EXTRA_LIVES_KEY, String(stock - 1)); } catch (e) {}
  },

  _addBonusItems() {
    let stock = 0;
    try { stock = parseInt(localStorage.getItem(BONUS_ITEMS_KEY), 10) || 0; } catch (e) {}
    const add = Math.min(stock, 2, 4 - this.playerItems.length);
    if (add <= 0) return;
    this.playerItems.push(...this._generateItems(add));
    try { localStorage.setItem(BONUS_ITEMS_KEY, String(stock - add)); } catch (e) {}
  },

  _generateItems(count) {
    if (count === 0) return [];
    // Buckshot Roulette items
    const itemTypes = ['magnifying_glass', 'cigarettes', 'beer', 'handsaw', 'handcuffs', 'sticky_fingers'];
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(itemTypes[Math.floor(Math.random() * itemTypes.length)]);
    }
    return items;
  },

  // ── Turn Logic ───────────────────────────────────────────

  /** Begin the current player's or dealer's turn. */
  startTurn() {
    if (this.gameOver) return;
    this.turnActive = true;
    this.sawedOff = false;
    this.knownShell = null;

    if (this.isPlayerTurn) {
      this.els.turnText.textContent = 'YOUR TURN';
      this.els.turnIndicator.classList.remove('hidden');
      this._renderItems();

      GameScene.enableGunPickup();

      // ⚡ Sharp Eyes (arcade ability "insight"): chance to see the current shell, like the magnifying glass.
      let insight = null;
      if (this.shellIndex < this.shells.length && this._abilityRoll('insight')) {
        this.knownShell = this.shells[this.shellIndex];
        insight = this.knownShell;
        this.updateUI();
      }

      setTimeout(() => {
        this.els.turnIndicator.classList.add('hidden');
        this._showMessage(insight ? '👁️ Sharp Eyes: ' + insight.toUpperCase() + ' · PICK UP THE SHOTGUN' : 'PICK UP THE SHOTGUN');
      }, 1000);
    } else {
      this.els.turnText.textContent = "DEALER'S TURN";
      this.els.turnIndicator.classList.remove('hidden');
      this.els.itemButtons.classList.add('hidden');

      GameScene.disableInteraction();

      setTimeout(() => {
        this.els.turnIndicator.classList.add('hidden');
        this._dealerTurn();
      }, 1500);
    }
  },

  /** Player fires at 'opponent' or 'self'. Called by scene click. */
  async playerShoot(target) {
    if (!this.turnActive || !this.isPlayerTurn) return;
    this.turnActive = false;
    this.els.itemButtons.classList.add('hidden');

    const shell = this.shells[this.shellIndex];
    this.shellIndex++;

    if (shell === 'live') {
      GameAudio.playGunshot();
      await GameScene.fireEffect(true);
      let damage = this.sawedOff ? 2 : 1;
      // ⚡ Hot Shell (arcade ability "power"): chance of +1 damage on a live shot at the dealer.
      const power = target === 'opponent' && this._abilityRoll('power');
      if (power) damage += 1;

      await this._delay(200);
      GameScene.putGunDown();

      if (target === 'opponent') {
        this.dealerLives = Math.max(0, this.dealerLives - damage);
        await GameScene.opponentHitReaction();
        this._showMessage('LIVE ROUND! -' + damage + (power ? ' · 🔥 Hot Shell +1!' : ''));

        if (this.dealerLives <= 0) {
          this._roundWon();
          return;
        }
      } else {
        this.playerLives = Math.max(0, this.playerLives - damage);
        await GameScene.cameraShake();
        this._showMessage('LIVE ROUND! -' + damage);

        if (this.playerLives <= 0) {
          this._endGame(false);
          return;
        }
      }

      this.sawedOff = false;
      this.updateUI();
      this._checkShellsEmpty() || this._nextTurn(true);

    } else {
      GameAudio.playClick();
      await GameScene.fireEffect(false);
      await this._delay(200);
      GameScene.putGunDown();
      // ⚡ Second Wind (arcade ability "regen"): chance to heal 1 on a blank at yourself (normal max only).
      const regen = target === 'self' && this._abilityRoll('regen') && this.playerLives < this.maxLives;
      if (regen) this.playerLives = Math.min(this.maxLives, this.playerLives + 1);
      this._showMessage('*click* ... blank' + (regen ? ' · 🩹 Second Wind +1' : ''));

      this.sawedOff = false;
      this.updateUI();

      if (target === 'self') {
        // Blank on self = extra turn
        this._checkShellsEmpty() || this._nextTurn(false);
      } else {
        this._checkShellsEmpty() || this._nextTurn(true);
      }
    }

    if (this.mode === 'online') {
      Network.sendShoot({ target, shell });
    }
  },

  // ── Dealer AI ────────────────────────────────────────────

  /** Dealer (bot) takes their turn: use items, then shoot. */
  async _dealerTurn() {
    if (this.gameOver) return;

    // Dealer uses items
    await this._dealerUseItems();

    // Dealer decision
    let target;
    if (this.knownShell === 'blank') {
      target = 'self';
    } else if (this.knownShell === 'live') {
      target = 'opponent';
    } else {
      const remaining = this.shells.slice(this.shellIndex);
      const livesLeft = remaining.filter(s => s === 'live').length;
      const blanksLeft = remaining.length - livesLeft;

      if (remaining.length === 1) {
        target = remaining[0] === 'live' ? 'opponent' : 'self';
      } else if (blanksLeft > livesLeft) {
        target = 'self';
      } else {
        target = 'opponent';
      }
    }

    // Dealer animation
    await GameScene.opponentShootAnimation(target);

    this._showMessage(target === 'opponent' ? 'DEALER AIMS AT YOU...' : 'DEALER AIMS AT SELF...');
    await this._delay(800);

    const shell = this.shells[this.shellIndex];
    this.shellIndex++;

    if (shell === 'live') {
      GameAudio.playGunshot();
      await GameScene.opponentFireEffect(true);
      const damage = this.sawedOff ? 2 : 1;

      await this._delay(200);
      GameScene.opponentPutGunDown();

      if (target === 'opponent') {
        this.playerLives = Math.max(0, this.playerLives - damage);
        await GameScene.cameraShake();
        this._showMessage('LIVE ROUND! -' + damage);

        if (this.playerLives <= 0) {
          this._endGame(false);
          return;
        }
      } else {
        this.dealerLives = Math.max(0, this.dealerLives - damage);
        await GameScene.opponentHitReaction();
        this._showMessage('LIVE ROUND! -' + damage);

        if (this.dealerLives <= 0) {
          this._roundWon();
          return;
        }
      }

      this.sawedOff = false;
      this.updateUI();
      this._checkShellsEmpty() || this._nextTurn(true);

    } else {
      GameAudio.playClick();
      await GameScene.opponentFireEffect(false);
      await this._delay(200);
      GameScene.opponentPutGunDown();
      this._showMessage('*click* ... blank');

      this.sawedOff = false;
      this.updateUI();

      if (target === 'self') {
        this._checkShellsEmpty() || this._nextTurn(false);
      } else {
        this._checkShellsEmpty() || this._nextTurn(true);
      }
    }
  },

  /** Dealer AI uses items from their inventory before shooting. */
  async _dealerUseItems() {
    for (let i = this.dealerItems.length - 1; i >= 0; i--) {
      const item = this.dealerItems[i];

      if (item === 'magnifying_glass') {
        this.dealerItems.splice(i, 1);
        if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
        this.knownShell = this.shells[this.shellIndex];
        this._showMessage('DEALER USES MAGNIFYING GLASS');
        GameAudio.playItem();
        await this._delay(1200);

      } else if (item === 'handsaw') {
        this.dealerItems.splice(i, 1);
        if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
        this.sawedOff = true;
        this._showMessage('DEALER SAWS THE BARREL');
        GameAudio.playItem();
        await this._delay(1200);
        break;

      } else if (item === 'beer') {
        const remaining = this.shells.length - this.shellIndex;
        if (remaining > 1) {
          const ejected = this.shells[this.shellIndex];
          this.shellIndex++;
          this.dealerItems.splice(i, 1);
          if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
          this._showMessage('DEALER RACKS SHELL: ' + ejected.toUpperCase());
          GameAudio.playPump();
          await this._delay(1200);
          this.updateUI();
          if (this.shellIndex >= this.shells.length) return;
        }

      } else if (item === 'handcuffs') {
        this.dealerItems.splice(i, 1);
        if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
        this._cuffed = true;
        this._showMessage('DEALER USES HANDCUFFS');
        GameAudio.playItem();
        await this._delay(1200);

      } else if (item === 'cigarettes') {
        if (this.dealerLives < this.maxLives) {
          this.dealerItems.splice(i, 1);
          if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
          this.dealerLives = Math.min(this.maxLives, this.dealerLives + 1);
          this._showMessage('DEALER SMOKES A CIGARETTE (+1)');
          GameAudio.playItem();
          this.updateUI();
          await this._delay(1200);
        }

      } else if (item === 'sticky_fingers') {
        if (this.playerItems.length > 0) {
          const stealIdx = Math.floor(Math.random() * this.playerItems.length);
          const stolen = this.playerItems.splice(stealIdx, 1)[0];
          if (GameScene.removePlayerItem) GameScene.removePlayerItem(stealIdx);
          this.dealerItems.splice(i, 1, stolen); // replace sticky_fingers with stolen item
          if (GameScene.removeDealerItem) GameScene.removeDealerItem(i);
          this._showMessage('DEALER STOLE YOUR ' + stolen.toUpperCase().replace('_', ' '));
          GameAudio.playItem();
          await this._delay(1200);
        }
      }
    }
  },

  // ── Player Item Usage ────────────────────────────────────

  /** Player uses an item from their inventory by index. */
  useItem(index) {
    if (!this.turnActive || !this.isPlayerTurn) return;
    const item = this.playerItems[index];
    if (!item) return;

    this.playerItems.splice(index, 1);
    if (GameScene.playerItemBurst) GameScene.playerItemBurst(index); // arcade ability skin (cosmetic)
    if (GameScene.removePlayerItem) GameScene.removePlayerItem(index);
    GameAudio.playItem();

    switch (item) {
      case 'magnifying_glass':
        this.knownShell = this.shells[this.shellIndex];
        this._showMessage('CURRENT SHELL: ' + this.knownShell.toUpperCase());
        this.updateUI();
        break;

      case 'beer':
        if (this.shellIndex < this.shells.length) {
          const ejected = this.shells[this.shellIndex];
          this.shellIndex++;
          this._showMessage('RACKED: ' + ejected.toUpperCase());
          this.knownShell = null;
          this.updateUI();
          if (this._checkShellsEmpty()) return;
        }
        break;

      case 'handsaw':
        this.sawedOff = true;
        this._showMessage('BARREL SAWED OFF (2x DAMAGE)');
        break;

      case 'handcuffs':
        this._showMessage('DEALER HANDCUFFED (SKIPS TURN)');
        this._cuffed = true;
        break;

      case 'cigarettes':
        if (this.playerLives < this.maxLives) {
          this.playerLives = Math.min(this.maxLives, this.playerLives + 1);
          this._showMessage('SMOKED CIGARETTE (+1 LIFE)');
          this.updateUI();
        } else {
          this._showMessage('ALREADY FULL HEALTH');
          // Give the item back since it wasn't used
          this.playerItems.splice(index, 0, item);
        }
        break;

      case 'sticky_fingers':
        if (this.dealerItems.length > 0) {
          const stealIdx = Math.floor(Math.random() * this.dealerItems.length);
          const stolen = this.dealerItems.splice(stealIdx, 1)[0];
          if (GameScene.removeDealerItem) GameScene.removeDealerItem(stealIdx);
          this.playerItems.push(stolen);
          this._showMessage('STOLE: ' + stolen.toUpperCase().replace('_', ' '));
        } else {
          this._showMessage('NOTHING TO STEAL');
          this.playerItems.splice(index, 0, item);
        }
        break;
    }

    this._renderItems();
  },

  // ── Turn Transitions ─────────────────────────────────────

  /** Advance to the next turn. If switchTurn=true, swap player/dealer. */
  _nextTurn(switchTurn) {
    setTimeout(() => {
      if (switchTurn) {
        if (this._cuffed && this.isPlayerTurn) {
          this._cuffed = false;
          this._showMessage('DEALER IS CUFFED - SKIP');
          setTimeout(() => this.startTurn(), 1200);
          return;
        } else if (this._cuffed && !this.isPlayerTurn) {
          this._cuffed = false;
          this._showMessage('YOU ARE CUFFED - SKIP');
          setTimeout(() => this.startTurn(), 1200);
          return;
        }
        this.isPlayerTurn = !this.isPlayerTurn;
      }
      this.knownShell = null;
      this.startTurn();
    }, 1500);
  },

  _checkShellsEmpty() {
    if (this.shellIndex >= this.shells.length) {
      // Reload new shells (same round continues)
      this._showMessage('RELOADING...');
      setTimeout(() => this._loadNewShells(), 1500);
      return true;
    }
    return false;
  },

  // ── Win/Lose Conditions ──────────────────────────────────

  /** Called when the dealer's HP hits 0. Advance round or win game. */
  _roundWon() {
    this.updateUI();

    if (this.round >= this.maxRounds) {
      // Won the whole game
      this._endGame(true);
    } else {
      this._showMessage('ROUND ' + this.round + ' COMPLETE');
      GameAudio.playWin();
      GameScene.opponentDeath();

      setTimeout(() => {
        GameScene.resetOpponent();
        this.round++;
        this._startRound();
      }, 2500);
    }
  },

  _endGame(playerWon) {
    this.gameOver = true;
    this.turnActive = false;
    SaveSystem.stop();
    SaveSystem.clear();

    this.els.itemButtons.classList.add('hidden');
    this.els.turnIndicator.classList.add('hidden');

    GameScene.disableInteraction();

    if (playerWon) {
      GameAudio.playWin();
      this.els.gameOverText.textContent = 'YOU WIN';
      this.els.gameOverText.style.color = '#44ff44';
      GameScene.opponentDeath();
    } else {
      GameAudio.playLose();
      this.els.gameOverText.textContent = 'YOU LOSE';
      this.els.gameOverText.style.color = '#ff4444';
      GameScene.cameraShake();
    }

    setTimeout(() => {
      this.els.gameOver.classList.remove('hidden');
    }, 2000);
  },

  // ── UI Updates ───────────────────────────────────────────

  /** Refresh all HUD elements: shell display, lives, round info. */
  updateUI() {
    // Shell display
    this.els.shellDisplay.innerHTML = '';
    for (let i = 0; i < this.shells.length; i++) {
      const div = document.createElement('div');
      div.className = 'shell';
      if (i < this.shellIndex) {
        div.classList.add('used');
        div.classList.add(this.shells[i]);
      } else if (i === this.shellIndex && this.knownShell) {
        div.classList.add(this.knownShell);
      } else {
        div.classList.add('unknown');
      }
      this.els.shellDisplay.appendChild(div);
    }

    const remainingShells = this.shells.slice(this.shellIndex);
    const liveCount = remainingShells.filter(s => s === 'live').length;
    const blankCount = remainingShells.filter(s => s === 'blank').length;
    this.els.roundNumber.textContent = 'ROUND ' + this.round +
      ' \u00B7 ' + liveCount + ' LIVE \u00B7 ' + blankCount + ' BLANK';

    // Player lives (charges)
    this.els.playerLives.innerHTML = '';
    // An extra life bought in the arcade shop shows as a gold charge past the normal max.
    for (let i = 0; i < Math.max(this.maxLives, this.playerLives); i++) {
      const div = document.createElement('div');
      div.className = 'life' + (i >= this.playerLives ? ' lost' : '') + (i >= this.maxLives ? ' bonus' : '');
      this.els.playerLives.appendChild(div);
    }

    // Dealer lives
    this.els.opponentLives.innerHTML = '';
    for (let i = 0; i < this.maxLives; i++) {
      const div = document.createElement('div');
      div.className = 'life' + (i >= this.dealerLives ? ' lost' : '');
      this.els.opponentLives.appendChild(div);
    }
  },

  /** Render clickable item buttons for the player's inventory. */
  _renderItems() {
    const container = this.els.itemButtons;
    container.innerHTML = '';

    if (!this.isPlayerTurn || this.playerItems.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    const icons = {
      magnifying_glass: '\uD83D\uDD0D',
      cigarettes: '\uD83D\uDEAC',
      beer: '\uD83C\uDF7A',
      handsaw: '\uD83E\uDE93',
      handcuffs: '\u26D3\uFE0F',
      sticky_fingers: '\uD83E\uDD1E'
    };

    const labels = {
      magnifying_glass: 'Peek at current shell',
      cigarettes: 'Restore 1 life',
      beer: 'Rack (eject) current shell',
      handsaw: 'Double damage next shot',
      handcuffs: 'Dealer skips next turn',
      sticky_fingers: 'Steal a random item from dealer'
    };

    this.playerItems.forEach((item, i) => {
      const btn = document.createElement('div');
      btn.className = 'item';
      btn.textContent = icons[item] || '?';
      btn.title = labels[item] || item;
      btn.addEventListener('click', () => this.useItem(i));
      container.appendChild(btn);
    });

    this.els.playerItems.innerHTML = '';
    this.playerItems.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.textContent = icons[item] || '?';
      div.title = labels[item] || item;
      div.addEventListener('click', () => this.useItem(i));
      this.els.playerItems.appendChild(div);
    });
  },

  // ── Helpers ──────────────────────────────────────────────

  /** Show a floating message that auto-fades after 2 seconds. */
  _showMessage(text) {
    this.els.messageText.textContent = text;
    this.els.messageDisplay.classList.remove('hidden');
    const clone = this.els.messageText.cloneNode(true);
    this.els.messageText.parentNode.replaceChild(clone, this.els.messageText);
    this.els.messageText = clone;
    setTimeout(() => { this.els.messageDisplay.classList.add('hidden'); }, 2000);
  },

  async _animateShellLoad() {
    for (let i = 0; i < this.shells.length; i++) {
      GameAudio.playLoad();
      await this._delay(250);
    }
    GameAudio.playPump();
  },

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // ── Save & Pause ─────────────────────────────────────────

  /** Return current state for auto-save (null if game is over). */
  getSaveState() {
    if (this.gameOver) return null;
    return {
      mode: this.mode, round: this.round,
      playerLives: this.playerLives, dealerLives: this.dealerLives,
      maxLives: this.maxLives,
      shells: this.shells, shellIndex: this.shellIndex,
      playerItems: this.playerItems, dealerItems: this.dealerItems,
      isPlayerTurn: this.isPlayerTurn
    };
  },

  togglePause() {
    if (this.gameOver) return;
    if (!this.paused) {
      this.pause();
    } else {
      this.resume();
    }
  },

  pause() {
    this.paused = true;
    document.getElementById('pause-menu').classList.remove('hidden');
    // Disable gun interaction while paused
    if (GameScene.canInteract) {
      this._wasInteractable = true;
      GameScene.canInteract = false;
    }
  },

  resume() {
    this.paused = false;
    document.getElementById('pause-menu').classList.add('hidden');
    if (this._wasInteractable) {
      GameScene.canInteract = true;
      this._wasInteractable = false;
    }
  },

  quit() {
    this.paused = false;
    this.gameOver = true;
    SaveSystem.stop();
    document.getElementById('pause-menu').classList.add('hidden');
    location.reload();
  }
};
