// ============================================================
// fps-game.js -- 3D First-Person Shooter arena mode
//
// A simple FPS with WASD movement, mouse aim, and a bot
// opponent. Uses Three.js for rendering and PointerLock
// for mouse capture. The bot has 3 states: patrol, chase,
// and attack. Both player and bot respawn after 3 seconds.
// ============================================================

const FPSGame = {
  // ── Three.js Core ───────────────────────────────────────
  scene: null,
  camera: null,
  renderer: null,
  controls: null,   // PointerLockControls
  running: false,
  lastTime: 0,

  // ── Player State ────────────────────────────────────────
  health: 100,
  kills: 0,
  deaths: 0,
  alive: true,
  speed: 12,
  eyeHeight: 1.7,
  position: new THREE.Vector3(),
  keys: { w: false, a: false, s: false, d: false },
  shooting: false,
  lastShotTime: 0,
  shotCooldown: 200, // ms between shots

  // ── Bot State ───────────────────────────────────────────
  botMesh: null,
  botHealth: 100,
  botAlive: true,
  botPosition: new THREE.Vector3(),
  botState: 'patrol',  // 'patrol' | 'chase' | 'attack'
  botWaypoint: new THREE.Vector3(),
  botShootTimer: 0,
  botRespawnTimer: 0,

  // ── Arena & Effects ─────────────────────────────────────
  collidables: [],   // walls & obstacles for collision
  raycaster: null,
  tracers: [],       // bullet tracer lines (auto-removed)
  footstepTimer: 0,

  // ── Setup ────────────────────────────────────────────────

  /** Initialize the FPS scene, controls, arena, and start the game loop. */
  init() {
    // Clean up any previous canvas/overlays
    const oldCanvas = document.querySelector('canvas');
    if (oldCanvas) oldCanvas.remove();
    ['post-fx', 'scanlines', 'film-grain', 'chroma-ab'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111122);
    this.scene.fog = new THREE.Fog(0x111122, 20, 60);
    if (window.ArcadeSkins) { // arcade background skin (cosmetic)
      ArcadeSkins.paint(this.scene.background, 'bg', 'sky');
      ArcadeSkins.paint(this.scene.fog.color, 'bg', 'fog');
    }

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

    // Controls
    this.controls = new THREE.PointerLockControls(this.camera, this.renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0x556677, 0.8);
    if (window.ArcadeSkins) ArcadeSkins.paint(ambient.color, 'bg', 'light'); // arcade bg skin
    this._ambientLight = ambient; // kept for live skin changes (_applyBgSkin)
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
    sun.position.set(10, 20, 10); sun.castShadow = true;
    this.scene.add(sun);

    // HUD
    this._createHUD();

    // Build arena
    this._buildArena();

    // Build bot
    this._buildBot();

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 100;

    // Spawn player
    this.position.set(-25, this.eyeHeight, -25);
    this.camera.position.copy(this.position);

    // Input
    this._setupInput();

    // Resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Audio
    GameAudio.init();

    this.running = true;
    this.alive = true;
    this.health = 100;
    this.kills = 0;
    this.deaths = 0;
    this.lastTime = performance.now();

    // Show click to play
    this.hud.overlay.style.display = 'flex';

    this._loop();
  },

  // ── HUD ──────────────────────────────────────────────────

  /** Build the FPS HUD overlay (health bar, score, crosshair, death screen). */
  _createHUD() {
    const old = document.getElementById('fps-hud');
    if (old) old.remove();

    const hud = document.createElement('div');
    hud.id = 'fps-hud';
    hud.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;font-family:Courier New,monospace;color:#fff;';

    // Crosshair
    hud.innerHTML = `
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);">
        <div style="position:absolute;width:2px;height:16px;background:rgba(255,255,255,0.7);left:-1px;top:-20px;"></div>
        <div style="position:absolute;width:2px;height:16px;background:rgba(255,255,255,0.7);left:-1px;top:4px;"></div>
        <div style="position:absolute;width:16px;height:2px;background:rgba(255,255,255,0.7);top:-1px;left:-20px;"></div>
        <div style="position:absolute;width:16px;height:2px;background:rgba(255,255,255,0.7);top:-1px;left:4px;"></div>
      </div>
      <div id="fps-health" style="position:absolute;bottom:30px;left:30px;">
        <div style="width:200px;height:20px;background:rgba(0,0,0,0.5);border:1px solid #555;border-radius:3px;overflow:hidden;">
          <div id="fps-health-bar" style="width:100%;height:100%;background:linear-gradient(90deg,#44ff44,#22cc22);transition:width 0.2s;"></div>
        </div>
        <div id="fps-health-text" style="font-size:14px;margin-top:4px;">HP: 100</div>
      </div>
      <div id="fps-score" style="position:absolute;top:15px;left:50%;transform:translateX(-50%);font-size:18px;background:rgba(0,0,0,0.5);padding:6px 16px;border-radius:4px;">
        Kills: 0 | Deaths: 0
      </div>
      <div id="fps-killfeed" style="position:absolute;top:60px;right:20px;text-align:right;font-size:13px;"></div>
      <div id="fps-damage-flash" style="position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;background:radial-gradient(ellipse at center,transparent 50%,rgba(255,0,0,0.4) 100%);opacity:0;transition:opacity 0.15s;"></div>
      <div id="fps-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:100;">
        <div style="text-align:center;">
          <h2 style="font-size:28px;letter-spacing:4px;margin-bottom:10px;">CLICK TO PLAY</h2>
          <p style="color:#888;">WASD move | Mouse look | Left-click shoot | ESC menu</p>
        </div>
      </div>
      <div id="fps-death" style="position:fixed;top:0;left:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);z-index:100;">
        <div style="text-align:center;">
          <h2 style="font-size:32px;color:#ff2222;letter-spacing:4px;">YOU DIED</h2>
          <p id="fps-respawn-text" style="color:#888;margin-top:10px;">Respawning in 3...</p>
        </div>
      </div>
      <div id="fps-back-btn" style="position:absolute;top:15px;left:15px;pointer-events:auto;cursor:pointer;background:rgba(0,0,0,0.6);padding:6px 12px;border:1px solid #555;border-radius:4px;font-size:12px;letter-spacing:2px;">← MENU</div>
    `;
    document.body.appendChild(hud);

    this.hud = {
      healthBar: null, healthText: null, score: null, killfeed: null,
      damageFlash: null, overlay: null, death: null, respawnText: null
    };

    // Will be set after DOM is ready
    setTimeout(() => {
      this.hud.healthBar = document.getElementById('fps-health-bar');
      this.hud.healthText = document.getElementById('fps-health-text');
      this.hud.score = document.getElementById('fps-score');
      this.hud.killfeed = document.getElementById('fps-killfeed');
      this.hud.damageFlash = document.getElementById('fps-damage-flash');
      this.hud.overlay = document.getElementById('fps-overlay');
      this.hud.death = document.getElementById('fps-death');
      this.hud.respawnText = document.getElementById('fps-respawn-text');

      document.getElementById('fps-back-btn').addEventListener('click', () => {
        this.stop();
        location.reload();
      });
    }, 0);
  },

  // ── Input ────────────────────────────────────────────────

  /** Bind keyboard (WASD), mouse (shoot), and pointer lock events. */
  _setupInput() {
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = true;
    });
    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = false;
    });
    document.addEventListener('mousedown', (e) => { if (e.button === 0) this.shooting = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.shooting = false; });

    this.renderer.domElement.addEventListener('click', () => {
      if (!this.controls.isLocked) {
        this.controls.lock();
        GameAudio.resume();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.hud.overlay) {
        this.hud.overlay.style.display = this.controls.isLocked ? 'none' : (this.running ? 'flex' : 'none');
      }
    });
  },

  /** Live re-apply of the arcade background skin; empty slot -> the arena's default colors. */
  _applyBgSkin() {
    if (!window.ArcadeSkins || !ArcadeSkins.repaint || !this.scene) return;
    if (this.scene.background && this.scene.background.isColor) ArcadeSkins.repaint(this.scene.background, 'bg', 'sky', null, 0x111122);
    if (this.scene.fog) ArcadeSkins.repaint(this.scene.fog.color, 'bg', 'fog', null, 0x111122);
    if (this._ambientLight) ArcadeSkins.repaint(this._ambientLight.color, 'bg', 'light', null, 0x556677);
    if (this._floorMat) ArcadeSkins.repaint(this._floorMat.color, 'bg', 'ground', null, 0x334433);
  },

  // ── Arena Construction ───────────────────────────────────

  /** Build the 64x64 arena: floor, walls, and obstacle crates. */
  _buildArena() {
    const s = this.scene;
    this.collidables = [];

    // Floor
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x334433 });
    if (window.ArcadeSkins) ArcadeSkins.paint(floorMat.color, 'bg', 'ground'); // arcade bg skin
    this._floorMat = floorMat; // kept for live skin changes (_applyBgSkin)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    s.add(floor);

    // Grid
    s.add(new THREE.GridHelper(64, 32, 0x223322, 0x223322));

    // Walls
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
    const wallH = 6, sz = 32;
    this._addWall(s, wallMat, 64, wallH, 1, 0, wallH/2, -sz);
    this._addWall(s, wallMat, 64, wallH, 1, 0, wallH/2, sz);
    this._addWall(s, wallMat, 1, wallH, 64, sz, wallH/2, 0);
    this._addWall(s, wallMat, 1, wallH, 64, -sz, wallH/2, 0);

    // Obstacles
    const obsMat = new THREE.MeshLambertMaterial({ color: 0x666677 });
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x887755 });
    [
      { w:6,h:3,d:1.5,x:0,z:0,m:obsMat }, { w:4,h:2.5,d:1.5,x:-18,z:-18,m:crateMat },
      { w:1.5,h:2.5,d:4,x:-10,z:-8,m:obsMat }, { w:3,h:2,d:3,x:-22,z:-5,m:crateMat },
      { w:4,h:2.5,d:1.5,x:18,z:18,m:crateMat }, { w:1.5,h:2.5,d:4,x:10,z:8,m:obsMat },
      { w:3,h:2,d:3,x:22,z:5,m:crateMat }, { w:5,h:2.5,d:1,x:-8,z:15,m:obsMat },
      { w:5,h:2.5,d:1,x:8,z:-15,m:obsMat }, { w:1,h:2.5,d:5,x:15,z:-5,m:obsMat },
      { w:1,h:2.5,d:5,x:-15,z:5,m:obsMat }, { w:2,h:2,d:2,x:5,z:10,m:crateMat },
      { w:2,h:2,d:2,x:-5,z:-10,m:crateMat },
    ].forEach(o => {
      this._addWall(s, o.m, o.w, o.h, o.d, o.x, o.h/2, o.z);
    });
  },

  /** Helper: add a collidable box to the scene. */
  _addWall(scene, mat, w, h, d, x, y, z) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    this.collidables.push(mesh);
  },

  /** Build the enemy bot mesh (body, head, eyes, floating health bar). */
  _buildBot() {
    const group = new THREE.Group();
    // Body
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xcc3333 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), bodyMat);
    body.position.y = 1.1; group.add(body);
    // Head
    const headMat = new THREE.MeshLambertMaterial({ color: 0xddaa88 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), headMat);
    head.position.y = 1.85; group.add(head);
    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    [-0.08, 0.08].forEach(x => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), eyeMat);
      eye.position.set(x, 1.88, 0.18); group.add(eye);
    });
    // Health bar
    const hbBg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide }));
    hbBg.position.y = 2.2; group.add(hbBg);
    this.botHealthBarFg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x44ff44, side: THREE.DoubleSide }));
    this.botHealthBarFg.position.set(0, 2.2, 0.001); group.add(this.botHealthBarFg);

    group.position.set(25, 0, 25);
    this.botMesh = group;
    this.botPosition.set(25, this.eyeHeight, 25);
    this.botWaypoint.set(Math.random() * 40 - 20, this.eyeHeight, Math.random() * 40 - 20);
    this.scene.add(group);
  },

  // ── Physics ──────────────────────────────────────────────

  /** Slide collision: push the player out of any overlapping obstacle. */
  _resolveCollision(current, proposed) {
    const adjusted = proposed.clone();
    const r = 0.4;
    for (const obj of this.collidables) {
      if (!obj.geometry.boundingBox) continue;
      const box = obj.geometry.boundingBox.clone();
      box.min.add(obj.position); box.max.add(obj.position);
      box.min.x -= r; box.min.z -= r; box.max.x += r; box.max.z += r;
      if (adjusted.x > box.min.x && adjusted.x < box.max.x && adjusted.z > box.min.z && adjusted.z < box.max.z) {
        const dists = [
          { a:'x', v: box.max.x - adjusted.x, d:1 }, { a:'x', v: adjusted.x - box.min.x, d:-1 },
          { a:'z', v: box.max.z - adjusted.z, d:1 }, { a:'z', v: adjusted.z - box.min.z, d:-1 }
        ].sort((a,b) => a.v - b.v);
        const n = dists[0];
        adjusted[n.a] = n.d === 1 ? box.max[n.a] : box.min[n.a];
      }
    }
    return adjusted;
  },

  // ── Game Loop ────────────────────────────────────────────

  /** Main render/update loop (called via requestAnimationFrame). */
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Remove old tracers
    this.tracers = this.tracers.filter(t => {
      if (now - t.created > 80) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); return false; }
      return true;
    });

    if (!this.alive) {
      this.botRespawnTimer += dt;
      const remaining = Math.ceil(3 - this.botRespawnTimer);
      if (this.hud.respawnText) this.hud.respawnText.textContent = 'Respawning in ' + Math.max(0, remaining) + '...';
      if (this.botRespawnTimer >= 3) {
        this.botRespawnTimer = 0;
        this.alive = true;
        this.health = 100;
        this.position.set(-25, this.eyeHeight, -25);
        this.camera.position.copy(this.position);
        if (this.hud.death) this.hud.death.style.display = 'none';
        if (this.hud.overlay) this.hud.overlay.style.display = 'flex';
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!this.botAlive) {
      this.botRespawnTimer += dt;
      if (this.botRespawnTimer >= 3) {
        this.botRespawnTimer = 0;
        this.botAlive = true;
        this.botHealth = 100;
        this.botPosition.set(25, this.eyeHeight, 25);
        this.botMesh.position.set(25, 0, 25);
        this.botMesh.visible = true;
        this._updateBotHealthBar();
      }
    }

    if (this.controls.isLocked && this.alive) {
      this._updatePlayer(dt);
      this._updateBot(dt);
    }

    // Make bot health bar face player
    if (this.botMesh.visible) {
      this.botMesh.lookAt(this.camera.position.x, this.botMesh.position.y, this.camera.position.z);
    }

    this._updateHUD();
    this.renderer.render(this.scene, this.camera);
  },

  /** Move the player based on WASD keys and handle shooting. */
  _updatePlayer(dt) {
    const dir = new THREE.Vector3();
    if (this.keys.w) dir.z -= 1;
    if (this.keys.s) dir.z += 1;
    if (this.keys.a) dir.x -= 1;
    if (this.keys.d) dir.x += 1;

    if (dir.length() > 0) {
      dir.normalize();
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0; forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
      const moveDir = new THREE.Vector3().addScaledVector(forward, -dir.z).addScaledVector(right, dir.x).normalize();

      const proposed = this.position.clone().addScaledVector(moveDir, this.speed * dt);
      proposed.y = this.eyeHeight;
      const resolved = this._resolveCollision(this.position, proposed);
      resolved.y = this.eyeHeight;
      this.position.copy(resolved);
      this.camera.position.copy(resolved);

      this.footstepTimer += dt;
      if (this.footstepTimer >= 0.35) { this.footstepTimer = 0; GameAudio.playFootstep(); }
    }

    // Shoot
    if (this.shooting && performance.now() >= this.lastShotTime + this.shotCooldown) {
      this.lastShotTime = performance.now();
      GameAudio.playShoot();

      this.raycaster.setFromCamera(new THREE.Vector2(0,0), this.camera);
      const botParts = this.botMesh.children;
      const hits = this.raycaster.intersectObjects(botParts, true);

      let endpoint;
      if (hits.length > 0 && this.botAlive) {
        endpoint = hits[0].point;
        this.botHealth = Math.max(0, this.botHealth - 15);
        this._updateBotHealthBar();
        // Flash bot red
        const head = this.botMesh.children[1];
        const oc = head.material.color.getHex();
        head.material.color.setHex(0xff0000);
        setTimeout(() => head.material.color.setHex(oc), 100);

        if (this.botHealth <= 0) {
          this.botAlive = false;
          this.botMesh.visible = false;
          this.botRespawnTimer = 0;
          this.kills++;
          this._addKillMsg('You killed Bot');
          GameAudio.playKill();
        }
      } else {
        const wallHits = this.raycaster.intersectObjects(this.collidables);
        endpoint = wallHits.length > 0 ? wallHits[0].point : this.raycaster.ray.at(100, new THREE.Vector3());
      }

      // Tracer
      const points = [this.camera.position.clone(), endpoint];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      // Player tracer color comes from the arcade gun skin (trail), default yellow
      const tracerColor = window.ArcadeSkins ? ArcadeSkins.hex('gun', 'trail', 0xffff66) : 0xffff66;
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: tracerColor, transparent: true, opacity: 0.6 }));
      this.scene.add(line);
      this.tracers.push({ line, created: performance.now() });
    }
  },

  // ── Bot AI ───────────────────────────────────────────────

  /** Update bot behavior: patrol -> chase -> attack based on distance. */
  _updateBot(dt) {
    if (!this.botAlive) return;

    const toPlayer = new THREE.Vector3().subVectors(this.position, this.botPosition);
    const dist = toPlayer.length();
    toPlayer.normalize();

    // State transitions based on distance to player
    if (dist < 30) {
      this.botState = 'chase';
      if (dist < 25) this.botState = 'attack';
    } else {
      this.botState = 'patrol';
    }

    const botSpeed = 6;

    if (this.botState === 'patrol') {
      const toWp = new THREE.Vector3().subVectors(this.botWaypoint, this.botPosition);
      if (toWp.length() < 2) {
        this.botWaypoint.set(Math.random() * 50 - 25, this.eyeHeight, Math.random() * 50 - 25);
      }
      toWp.y = 0; toWp.normalize();
      const proposed = this.botPosition.clone().addScaledVector(toWp, botSpeed * dt);
      proposed.y = this.eyeHeight;
      this.botPosition.copy(this._resolveCollision(this.botPosition, proposed));
    } else if (this.botState === 'chase') {
      const moveDir = toPlayer.clone(); moveDir.y = 0; moveDir.normalize();
      const proposed = this.botPosition.clone().addScaledVector(moveDir, botSpeed * dt);
      proposed.y = this.eyeHeight;
      this.botPosition.copy(this._resolveCollision(this.botPosition, proposed));
    } else if (this.botState === 'attack') {
      // Shoot at player
      this.botShootTimer += dt;
      if (this.botShootTimer >= 0.5) {
        this.botShootTimer = 0;
        // Inaccuracy
        const spread = 0.08;
        const dir = toPlayer.clone();
        dir.x += (Math.random() - 0.5) * spread * 2;
        dir.y += (Math.random() - 0.5) * spread * 2;
        dir.normalize();
        const angle = dir.angleTo(toPlayer);
        GameAudio.playShoot();

        // Tracer from bot
        const from = this.botPosition.clone(); from.y += 0.3;
        const to = from.clone().add(dir.clone().multiplyScalar(15));
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.5 }));
        this.scene.add(line);
        this.tracers.push({ line, created: performance.now() });

        if (angle < 0.12) {
          this.health = Math.max(0, this.health - 15);
          if (this.hud.damageFlash) {
            this.hud.damageFlash.style.opacity = '1';
            setTimeout(() => this.hud.damageFlash.style.opacity = '0', 200);
          }
          GameAudio.playDamage();
          if (this.health <= 0) {
            this.alive = false;
            this.deaths++;
            this.botRespawnTimer = 0;
            this._addKillMsg('Bot killed you');
            if (this.hud.death) this.hud.death.style.display = 'flex';
          }
        }
      }
    }

    this.botMesh.position.set(this.botPosition.x, 0, this.botPosition.z);
  },

  // ── HUD Updates ─────────────────────────────────────────

  /** Update the floating health bar above the bot's head. */
  _updateBotHealthBar() {
    if (this.botHealthBarFg) {
      const scale = this.botHealth / 100;
      this.botHealthBarFg.scale.x = scale;
      this.botHealthBarFg.position.x = -(1 - scale) * 0.4;
      this.botHealthBarFg.material.color.setHex(this.botHealth > 60 ? 0x44ff44 : this.botHealth > 30 ? 0xffcc00 : 0xff4444);
    }
  },

  _updateHUD() {
    if (!this.hud.healthBar) return;
    const pct = Math.max(0, this.health);
    this.hud.healthBar.style.width = pct + '%';
    this.hud.healthText.textContent = 'HP: ' + Math.round(pct);
    this.hud.healthBar.style.background = pct > 60 ? 'linear-gradient(90deg,#44ff44,#22cc22)' :
      pct > 30 ? 'linear-gradient(90deg,#ffcc00,#cc9900)' : 'linear-gradient(90deg,#ff4444,#cc2222)';
    this.hud.score.textContent = 'Kills: ' + this.kills + ' | Deaths: ' + this.deaths;
  },

  _addKillMsg(msg) {
    if (!this.hud.killfeed) return;
    const div = document.createElement('div');
    div.style.cssText = 'background:rgba(0,0,0,0.6);padding:4px 10px;margin-bottom:3px;border-radius:3px;animation:fadeOut 3s forwards;';
    div.textContent = msg;
    this.hud.killfeed.appendChild(div);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3500);
  },

  // ── Cleanup ─────────────────────────────────────────────

  /** Stop the game loop and remove all FPS DOM elements. */
  stop() {
    this.running = false;
    if (this.controls && this.controls.isLocked) this.controls.unlock();
    const hud = document.getElementById('fps-hud');
    if (hud) hud.remove();
    const canvas = this.renderer ? this.renderer.domElement : null;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
};
