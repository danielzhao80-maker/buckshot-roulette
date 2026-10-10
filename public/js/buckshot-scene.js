// ============================================================
// scene.js -- Buckshot Roulette: 3D scene (Three.js)
//
// Builds the entire game environment procedurally:
//   - Dark basement room (brick walls, wood floor, ceiling)
//   - Table with shotgun, shells, items, drinks, ashtray
//   - Dealer character (suit, fedora, glowing red eyes)
//   - Atmospheric details (dust, flickering light, TV static,
//     blood stains, cobwebs, dripping pipe, creepy eyes)
//   - Post-processing overlays (vignette, scanlines, grain)
//
// All textures are generated on canvas -- no external assets.
// ============================================================

const GameScene = {
  scene: null,
  camera: null,
  renderer: null,
  shotgunOnTable: null,
  heldGun: null,
  _tableGunMine: false, // table shotgun shows the arcade gun skin only on the player's turn
  muzzleFlash: null,
  opponentMesh: null,
  raycaster: null,
  mouse: new THREE.Vector2(),
  flickerLight: null,
  clock: null,
  dustParticles: null,
  smokeParticles: [],
  itemBox: null,        // The box items come from
  itemBoxLid: null,     // Lid that opens

  gunPickedUp: false,
  aimYaw: 0,
  aimPitch: 0,
  onShoot: null,
  onGunPickedUp: null,
  canInteract: false,

  // ═══════════════════════════════════════════════════════
  // TEXTURE GENERATORS
  // All textures are drawn on <canvas> elements and
  // converted to Three.js CanvasTexture objects.
  // ═══════════════════════════════════════════════════════

  /** Generate a wood-grain texture with knots. */
  _makeWoodTexture(baseColor, grainColor, w, h) {
    const c = document.createElement('canvas');
    c.width = w || 256; c.height = h || 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = grainColor;
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.15 + Math.random() * 0.15;
      ctx.beginPath();
      const y = Math.random() * c.height;
      ctx.moveTo(0, y);
      for (let x = 0; x < c.width; x += 10) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (Math.random() - 0.5) * 2);
      }
      ctx.stroke();
    }
    // Knots
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * c.width, Math.random() * c.height, 5 + Math.random() * 8, 0, Math.PI * 2);
      ctx.fillStyle = grainColor;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /** Generate a brick wall texture with mortar lines. */
  _makeBrickTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3a3028';
    ctx.fillRect(0, 0, 512, 512);
    const brickH = 30, brickW = 60, gap = 3;
    const colors = ['#4a3828', '#3d2e20', '#453525', '#3a3020', '#4f3a28'];
    for (let row = 0; row < 512 / (brickH + gap); row++) {
      const offset = (row % 2) * (brickW / 2);
      for (let col = -1; col < 512 / (brickW + gap) + 1; col++) {
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        const x = col * (brickW + gap) + offset;
        const y = row * (brickH + gap);
        ctx.fillRect(x, y, brickW, brickH);
        // Slight noise on each brick
        for (let n = 0; n < 20; n++) {
          ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
          ctx.fillRect(x + Math.random() * brickW, y + Math.random() * brickH, 3, 2);
        }
      }
    }
    // Mortar cracks
    ctx.strokeStyle = '#2a2018';
    ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, Math.random() * 512);
      ctx.lineTo(Math.random() * 512, Math.random() * 512);
      ctx.globalAlpha = 0.3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /** Generate a concrete texture with stains. */
  _makeConcreteTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#353030';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // Stains
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 30, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(30,20,15,${0.05 + Math.random() * 0.1})`;
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /** Generate a fabric/weave texture. */
  _makeFabricTexture(color) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 128, 128);
    // Weave pattern
    for (let x = 0; x < 128; x += 2) {
      for (let y = 0; y < 128; y += 2) {
        if ((x + y) % 4 === 0) {
          ctx.fillStyle = `rgba(0,0,0,0.08)`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return new THREE.CanvasTexture(c);
  },

  // ═══════════════════════════════════════════════════════
  // SCENE INITIALIZATION
  // Sets up renderer, camera, and builds all scene objects.
  // ═══════════════════════════════════════════════════════

  init() {
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    this.gunPickedUp = false;
    this.canInteract = false;
    this.smokeParticles = [];
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080810);
    this.scene.fog = new THREE.FogExp2(0x080810, 0.06);
    if (window.ArcadeSkins) { // arcade background skin (cosmetic)
      ArcadeSkins.paint(this.scene.background, 'bg', 'sky');
      ArcadeSkins.paint(this.scene.fog.color, 'bg', 'fog');
    }

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 50);
    this.camera.position.set(0, 1.3, 2.2);
    this.camera.lookAt(0, 0.85, 0);

    this.raycaster = new THREE.Raycaster();

    // Pre-generate textures
    this._textures = {
      floor: this._makeWoodTexture('#3a2a18', '#2a1a0a', 512, 512),
      table: this._makeWoodTexture('#5a3520', '#3a2010', 512, 256),
      wall: this._makeBrickTexture(),
      ceiling: this._makeConcreteTexture(),
      gunWood: this._makeWoodTexture('#6a3a18', '#4a2810', 128, 128),
      fabric: this._makeFabricTexture('#2a1515'),
      greenFabric: this._makeFabricTexture('#1a2a15'),
    };

    this._buildLighting();
    this._buildRoom();
    this._buildTable();
    this._buildTableProps();
    this._buildShotgunOnTable();
    this._buildHeldGun();
    this._buildDealer();
    this._buildSelfTarget();
    this._buildRoomDecor();
    this._buildDustParticles();
    this._buildItemBox();
    this._buildPostProcessing();

    this._setupInput();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this._animate();
  },

  // ═══════════════════════════════════════════════════════
  // LIGHTING
  // Main hanging bulb with flicker, warm/cool fill lights,
  // red accent, and a chain-link lamp fixture.
  // ═══════════════════════════════════════════════════════

  _buildLighting() {
    const s = this.scene;

    const ambient = new THREE.AmbientLight(0x1a2233, 0.35);
    if (window.ArcadeSkins) ArcadeSkins.paint(ambient.color, 'bg', 'light'); // arcade bg skin
    this._ambientLight = ambient; // kept for live skin changes (_applyBgSkin)
    s.add(ambient);

    // Main hanging bulb
    this.flickerLight = new THREE.PointLight(0xffcc88, 3, 10, 1.8);
    this.flickerLight.position.set(0, 2.8, 0);
    this.flickerLight.castShadow = true;
    this.flickerLight.shadow.mapSize.set(1024, 1024);
    this.flickerLight.shadow.radius = 6;
    this.flickerLight.shadow.bias = -0.001;
    s.add(this.flickerLight);

    // Spot on table
    const spot = new THREE.SpotLight(0xffeedd, 2, 5, 0.6, 0.7, 2);
    spot.position.set(0, 2.8, 0);
    spot.target.position.set(0, 0.8, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(512, 512);
    s.add(spot); s.add(spot.target);

    // Warm back fill
    const backFill = new THREE.PointLight(0xff8844, 0.3, 6);
    backFill.position.set(0, 2, 3.5);
    s.add(backFill);

    // Cool side
    const side = new THREE.PointLight(0x3344aa, 0.25, 6);
    side.position.set(-3, 2, -1);
    s.add(side);

    // Red accent from corner
    const red = new THREE.PointLight(0x660000, 0.2, 5);
    red.position.set(3, 1, -3);
    s.add(red);

    // Bulb mesh
    const bulbGeo = new THREE.SphereGeometry(0.05, 12, 12);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffeedd });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(0, 2.8, 0);
    s.add(bulb);

    // Glow sprite around bulb
    const glowMat = new THREE.SpriteMaterial({
      color: 0xffddaa, transparent: true, opacity: 0.15,
      blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.5, 1.5, 1);
    glow.position.set(0, 2.8, 0);
    s.add(glow);

    // Shade
    const shadeGeo = new THREE.ConeGeometry(0.22, 0.12, 16, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0x221108, side: THREE.DoubleSide, roughness: 0.9 });
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(0, 2.88, 0);
    s.add(shade);

    // Chain links holding the lamp
    for (let y = 2.95; y < 3.9; y += 0.08) {
      const linkGeo = new THREE.TorusGeometry(0.012, 0.003, 4, 6);
      const linkMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.3 });
      const link = new THREE.Mesh(linkGeo, linkMat);
      link.position.set(0, y, 0);
      link.rotation.x = (y * 10 % 2 < 1) ? 0 : Math.PI / 2;
      s.add(link);
    }
  },

  // ═══════════════════════════════════════════════════════
  // ROOM GEOMETRY
  // 8x8 unit room with textured floor, walls, and ceiling.
  // Includes floor planks, baseboards, and crown molding.
  // ═══════════════════════════════════════════════════════

  _buildRoom() {
    const s = this.scene;

    // Floor with wood texture
    const floorMat = new THREE.MeshStandardMaterial({
      map: this._textures.floor, roughness: 0.75, metalness: 0.0
    });
    this._textures.floor.repeat.set(4, 4);
    // Arcade bg skin: tint the wood floor (lerp to white keeps the texture visible)
    if (window.ArcadeSkins && ArcadeSkins.paint(floorMat.color, 'bg', 'ground')) {
      floorMat.color.lerp(new THREE.Color(0xffffff), 0.35);
    }
    this._floorMat = floorMat; // kept for live skin changes (_applyBgSkin)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // Floor planks (subtle grooves)
    const grooveMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.9 });
    for (let x = -3.5; x <= 3.5; x += 0.55) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.001, 8), grooveMat);
      groove.position.set(x, 0.001, 0);
      s.add(groove);
    }

    // Ceiling with concrete texture
    const ceilMat = new THREE.MeshStandardMaterial({
      map: this._textures.ceiling, roughness: 0.95, color: 0x2a2525
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.95;
    s.add(ceil);

    // Ceiling stain
    const stainMat = new THREE.MeshBasicMaterial({ color: 0x1a1510, transparent: true, opacity: 0.3 });
    const stain = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), stainMat);
    stain.rotation.x = Math.PI / 2; stain.position.set(1.5, 3.94, -1);
    s.add(stain);

    // Walls with brick texture
    const wallMat = new THREE.MeshStandardMaterial({
      map: this._textures.wall, roughness: 0.9, metalness: 0.0
    });
    this._textures.wall.repeat.set(2, 1);
    [
      { pos: [0, 2, -4], rot: [0, 0, 0] },
      { pos: [0, 2, 4], rot: [0, Math.PI, 0] },
      { pos: [-4, 2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [4, 2, 0], rot: [0, -Math.PI / 2, 0] }
    ].forEach(w => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), wallMat);
      wall.position.set(...w.pos); wall.rotation.set(...w.rot);
      wall.receiveShadow = true;
      s.add(wall);
    });

    // Baseboard
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a0f05, roughness: 0.8 });
    [
      [0, 0.07, -3.97, 8, 0.14, 0.06],
      [0, 0.07, 3.97, 8, 0.14, 0.06],
      [-3.97, 0.07, 0, 0.06, 0.14, 8],
      [3.97, 0.07, 0, 0.06, 0.14, 8]
    ].forEach(([x, y, z, w, h, d]) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMat);
      t.position.set(x, y, z); s.add(t);
    });

    // Crown molding (top of walls)
    const moldMat = new THREE.MeshLambertMaterial({ color: 0x2a2020 });
    [
      [0, 3.9, -3.97, 8, 0.08, 0.06],
      [0, 3.9, 3.97, 8, 0.08, 0.06],
      [-3.97, 3.9, 0, 0.06, 0.08, 8],
      [3.97, 3.9, 0, 0.06, 0.08, 8]
    ].forEach(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), moldMat);
      m.position.set(x, y, z); s.add(m);
    });
  },

  // ═══════════════════════════════════════════════════════
  // TABLE
  // Card table with green felt, ornate turned legs,
  // metal trim, and cross stretchers.
  // ═══════════════════════════════════════════════════════

  _buildTable() {
    const s = this.scene;
    const tMat = new THREE.MeshStandardMaterial({
      map: this._textures.table, roughness: 0.55, metalness: 0.05
    });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.7 });
    const metalTrimMat = new THREE.MeshStandardMaterial({ color: 0x554433, metalness: 0.4, roughness: 0.5 });

    // Table top
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.07, 1.8), tMat);
    top.position.set(0, 0.76, 0);
    top.castShadow = true; top.receiveShadow = true;
    s.add(top);

    // Felt center (green baize like a card table)
    const feltMat = new THREE.MeshStandardMaterial({ map: this._textures.greenFabric, roughness: 0.95, color: 0x1a3a15 });
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.2), feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(0, 0.798, 0);
    s.add(felt);

    // Edge trim
    [
      [0, 0.73, 0.92, 2.7, 0.06, 0.05],
      [0, 0.73, -0.92, 2.7, 0.06, 0.05],
      [1.33, 0.73, 0, 0.05, 0.06, 1.84],
      [-1.33, 0.73, 0, 0.05, 0.06, 1.84]
    ].forEach(([x, y, z, w, h, d]) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metalTrimMat);
      e.position.set(x, y, z); s.add(e);
    });

    // Ornate legs with turnings
    [[-1.1, -0.72], [1.1, -0.72], [-1.1, 0.72], [1.1, 0.72]].forEach(([x, z]) => {
      // Main leg
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 8), legMat);
      leg.position.set(x, 0.35, z); leg.castShadow = true; s.add(leg);
      // Top bulge
      const bulge1 = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), legMat);
      bulge1.position.set(x, 0.65, z); s.add(bulge1);
      // Mid ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 8), legMat);
      ring.position.set(x, 0.4, z); ring.rotation.x = Math.PI / 2; s.add(ring);
      // Foot
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), legMat);
      foot.position.set(x, 0.03, z); foot.scale.y = 0.5; s.add(foot);
    });

    // Cross stretchers
    const stretchMat = new THREE.MeshLambertMaterial({ color: 0x2a1508 });
    const str1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 6), stretchMat);
    str1.rotation.x = Math.PI / 2; str1.position.set(-1.1, 0.22, 0); s.add(str1);
    const str2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 6), stretchMat);
    str2.rotation.x = Math.PI / 2; str2.position.set(1.1, 0.22, 0); s.add(str2);
    const str3 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.1, 6), stretchMat);
    str3.rotation.z = Math.PI / 2; str3.position.set(0, 0.22, -0.72); s.add(str3);
  },

  // ═══════════════════════════════════════════════════════
  // TABLE PROPS
  // Small objects on the table: ashtray with cigarettes,
  // shot glasses, whiskey bottle, shell box, item trays
  // (4 per player), loose shells, and poker chips.
  // ═══════════════════════════════════════════════════════

  _buildTableProps() {
    const s = this.scene;
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.6 });

    // ── Ashtray ──
    const ashGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.025, 16);
    const ashtray = new THREE.Mesh(ashGeo, metalMat);
    ashtray.position.set(-1.05, 0.81, 0.35);
    s.add(ashtray);
    // Inner depression
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.01, 16), innerMat);
    inner.position.set(-0.9, 0.825, 0.35); s.add(inner);
    // Ash
    const ashMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    for (let i = 0; i < 8; i++) {
      const ash = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 0.008), ashMat);
      ash.position.set(-1.05 + (Math.random() - 0.5) * 0.08, 0.826, 0.35 + (Math.random() - 0.5) * 0.08);
      s.add(ash);
    }
    // Cigarette butts
    for (let i = 0; i < 3; i++) {
      const buttMat = new THREE.MeshLambertMaterial({ color: 0xddccaa });
      const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 4), buttMat);
      butt.position.set(-1.05 + (Math.random() - 0.5) * 0.05, 0.828, 0.35 + (Math.random() - 0.5) * 0.05);
      butt.rotation.set(Math.random(), Math.random(), Math.random() * 0.5);
      s.add(butt);
      // Filter
      const filterMat = new THREE.MeshLambertMaterial({ color: 0xcc9955 });
      const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 4), filterMat);
      filter.position.copy(butt.position);
      filter.rotation.copy(butt.rotation);
      s.add(filter);
    }
    // Smoking cigarette with ember
    const smokeCig = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 4), new THREE.MeshLambertMaterial({ color: 0xeeeecc }));
    smokeCig.position.set(-1.02, 0.83, 0.35); smokeCig.rotation.z = 0.3;
    s.add(smokeCig);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), new THREE.MeshBasicMaterial({ color: 0xff4400 }));
    ember.position.set(-1.0, 0.835, 0.35); s.add(ember);
    // Ember glow
    const emberGlow = new THREE.PointLight(0xff4400, 0.1, 0.5);
    emberGlow.position.copy(ember.position); s.add(emberGlow);

    // ── Shot glasses ──
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xccddee, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1 });
    [0.65, 0.82, 0.95].forEach((x, i) => {
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.055, 10), glassMat);
      glass.position.set(x, 0.82, -0.45); s.add(glass);
      // Glass bottom (thicker)
      const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.005, 10), glassMat);
      bottom.position.set(x, 0.795, -0.45); s.add(bottom);
      // Liquid
      if (i < 2) {
        const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015 + Math.random() * 0.02, 8),
          new THREE.MeshStandardMaterial({ color: 0xcc8833, transparent: true, opacity: 0.7, roughness: 0.1 }));
        liq.position.set(x, 0.81, -0.45); s.add(liq);
      }
    });

    // ── Whiskey bottle ──
    const bottleMat = new THREE.MeshStandardMaterial({ color: 0x1a3311, transparent: true, opacity: 0.55, roughness: 0.05 });
    const bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.22, 10), bottleMat);
    bBody.position.set(1.0, 0.91, -0.6); s.add(bBody);
    const bShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.04, 10), bottleMat);
    bShoulder.position.set(1.0, 1.04, -0.6); s.add(bShoulder);
    const bNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.06, 8), bottleMat);
    bNeck.position.set(1.0, 1.09, -0.6); s.add(bNeck);
    // Label
    const lblMat = new THREE.MeshLambertMaterial({ color: 0xddcc88 });
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.08, 0.06), lblMat);
    label.position.set(1.04, 0.92, -0.6); s.add(label);
    // Liquid level
    const whiskey = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.038, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: 0xbb7722, transparent: true, opacity: 0.6, roughness: 0.05 }));
    whiskey.position.set(1.0, 0.84, -0.6); s.add(whiskey);

    // ── Shell box ──
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x882211, roughness: 0.75 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.12), boxMat);
    box.position.set(-1.0, 0.84, -0.5); box.rotation.y = 0.15; s.add(box);
    // Box label
    const boxLabel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.001),
      new THREE.MeshLambertMaterial({ color: 0xddaa33 }));
    boxLabel.position.set(-1.0, 0.87, -0.44); boxLabel.rotation.y = 0.15; s.add(boxLabel);
    // Box text stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.001),
      new THREE.MeshLambertMaterial({ color: 0x111111 }));
    stripe.position.set(-1.0, 0.865, -0.439); stripe.rotation.y = 0.15; s.add(stripe);

    // ── Item boxes (8 white trays: 4 player side, 4 dealer side) ──
    this.itemBoxes = { player: [], dealer: [] };
    const trayMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.05 });
    const trayInnerMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
    const traySize = 0.11;
    const trayH = 0.018;
    const trayWall = 0.006;

    // Player's 4 boxes (near side of table, closer to camera)
    for (let i = 0; i < 4; i++) {
      const x = -0.25 + i * 0.16;
      const z = 0.55;
      const trayGroup = new THREE.Group();

      // Bottom
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(traySize, 0.005, traySize), trayMat);
      bottom.position.y = 0;
      trayGroup.add(bottom);

      // 4 walls
      const wallF = new THREE.Mesh(new THREE.BoxGeometry(traySize, trayH, trayWall), trayMat);
      wallF.position.set(0, trayH / 2, traySize / 2 - trayWall / 2);
      trayGroup.add(wallF);
      const wallB = new THREE.Mesh(new THREE.BoxGeometry(traySize, trayH, trayWall), trayMat);
      wallB.position.set(0, trayH / 2, -traySize / 2 + trayWall / 2);
      trayGroup.add(wallB);
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(trayWall, trayH, traySize), trayMat);
      wallL.position.set(-traySize / 2 + trayWall / 2, trayH / 2, 0);
      trayGroup.add(wallL);
      const wallR = new THREE.Mesh(new THREE.BoxGeometry(trayWall, trayH, traySize), trayMat);
      wallR.position.set(traySize / 2 - trayWall / 2, trayH / 2, 0);
      trayGroup.add(wallR);

      // Inner floor (slightly darker)
      const innerFloor = new THREE.Mesh(new THREE.BoxGeometry(traySize - trayWall * 2, 0.001, traySize - trayWall * 2), trayInnerMat);
      innerFloor.position.y = 0.003;
      trayGroup.add(innerFloor);

      trayGroup.position.set(x, 0.80, z);
      s.add(trayGroup);
      this.itemBoxes.player.push({ group: trayGroup, x: x, z: z });
    }

    // Dealer's 4 boxes (far side of table, near dealer)
    for (let i = 0; i < 4; i++) {
      const x = -0.25 + i * 0.16;
      const z = -0.55;
      const trayGroup = new THREE.Group();

      const bottom = new THREE.Mesh(new THREE.BoxGeometry(traySize, 0.005, traySize), trayMat);
      bottom.position.y = 0;
      trayGroup.add(bottom);

      const wallF = new THREE.Mesh(new THREE.BoxGeometry(traySize, trayH, trayWall), trayMat);
      wallF.position.set(0, trayH / 2, traySize / 2 - trayWall / 2);
      trayGroup.add(wallF);
      const wallB = new THREE.Mesh(new THREE.BoxGeometry(traySize, trayH, trayWall), trayMat);
      wallB.position.set(0, trayH / 2, -traySize / 2 + trayWall / 2);
      trayGroup.add(wallB);
      const wallL = new THREE.Mesh(new THREE.BoxGeometry(trayWall, trayH, traySize), trayMat);
      wallL.position.set(-traySize / 2 + trayWall / 2, trayH / 2, 0);
      trayGroup.add(wallL);
      const wallR = new THREE.Mesh(new THREE.BoxGeometry(trayWall, trayH, traySize), trayMat);
      wallR.position.set(traySize / 2 - trayWall / 2, trayH / 2, 0);
      trayGroup.add(wallR);

      const innerFloor = new THREE.Mesh(new THREE.BoxGeometry(traySize - trayWall * 2, 0.001, traySize - trayWall * 2), trayInnerMat);
      innerFloor.position.y = 0.003;
      trayGroup.add(innerFloor);

      trayGroup.position.set(x, 0.80, z);
      s.add(trayGroup);
      this.itemBoxes.dealer.push({ group: trayGroup, x: x, z: z });
    }

    // ── Loose shells ──
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.2 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xccaa44, roughness: 0.2, metalness: 0.6 });
    [[-0.5, 0.28, 0.4], [-0.55, 0.32, 0.7], [-0.42, 0.36, 1.2], [-0.6, 0.2, 2.1], [-0.48, 0.4, 0.1]].forEach(([x, z, r]) => {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.055, 6), shellMat);
      shell.position.set(x, 0.82, z);
      shell.rotation.set(Math.PI / 2, 0, r);
      s.add(shell);
      const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 6), brassMat);
      brass.position.copy(shell.position); brass.rotation.copy(shell.rotation);
      s.add(brass);
    });

    // ── Stack of money/chips ──
    const chipColors = [0xcc2222, 0x2244cc, 0x22cc22, 0xdddddd];
    let chipY = 0.80;
    for (let i = 0; i < 8; i++) {
      const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.004, 12),
        new THREE.MeshStandardMaterial({ color: chipColors[i % 4], roughness: 0.5, metalness: 0.1 }));
      chip.position.set(0.5, chipY, 0.5);
      chipY += 0.005;
      s.add(chip);
    }

    // ── Folded money ──
    const moneyMat = new THREE.MeshLambertMaterial({ color: 0x448833 });
    for (let i = 0; i < 3; i++) {
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.001, 0.035), moneyMat);
      bill.position.set(0.45 + Math.random() * 0.15, 0.80, 0.52 + Math.random() * 0.08);
      bill.rotation.y = Math.random() * Math.PI;
      s.add(bill);
    }
  },

  // ═══════════════════════════════════════════════════════
  // SHOTGUN MODEL
  // Double-barrel shotgun built from box/cylinder meshes.
  // Used both as a table prop and as the held first-person gun.
  // ═══════════════════════════════════════════════════════

  /** Build a complete shotgun mesh (barrels, receiver, stock, pump). */
  _makeShotgunMesh() {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.2, metalness: 0.8 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ map: this._textures.gunWood, roughness: 0.5, metalness: 0.0 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x3a1a08, roughness: 0.7 });
    // Part tags for the arcade gun skin (_skinShotgun)
    metal.userData.gunPart = 'metal'; darkMetal.userData.gunPart = 'darkMetal';
    wood.userData.gunPart = 'wood'; darkWood.userData.gunPart = 'darkWood';

    // Double barrels
    [-0.013, 0.013].forEach(x => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.15, 10), metal);
      b.rotation.x = Math.PI / 2; b.position.set(x, 0.012, -0.15);
      group.add(b);
      // Bore (dark inside)
      const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), darkMetal);
      bore.rotation.x = Math.PI / 2; bore.position.set(x, 0.012, -0.73);
      group.add(bore);
    });

    // Barrel rib (top)
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.006, 0.9), metal);
    rib.position.set(0, 0.032, -0.2); group.add(rib);

    // Front sight bead
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    bead.material.userData.gunPart = 'sight';
    bead.position.set(0, 0.038, -0.66); group.add(bead);

    // Barrel bands
    [-0.45, -0.15, 0.1].forEach(z => {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.015, 10), darkMetal);
      band.rotation.x = Math.PI / 2; band.position.set(0, 0.012, z);
      group.add(band);
    });

    // Receiver
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.16), metal);
    recv.position.set(0, 0.005, 0.22); group.add(recv);
    // Receiver detail - loading port
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.06), darkMetal);
    port.position.set(0.028, 0, 0.22); group.add(port);

    // Trigger guard
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 10, Math.PI), metal);
    guard.position.set(0, -0.035, 0.2); guard.rotation.z = Math.PI;
    group.add(guard);
    // Trigger
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.018, 0.005), metal);
    trigger.position.set(0, -0.025, 0.2); group.add(trigger);

    // Pump forend
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.045, 0.2), wood);
    pump.position.set(0, -0.015, -0.12); group.add(pump);
    // Forend grooves
    for (let z = -0.19; z <= -0.05; z += 0.025) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.006), darkWood);
      g.position.set(0, -0.038, z); group.add(g);
    }

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.1, 0.32), wood);
    stock.position.set(0, -0.005, 0.46); group.add(stock);
    // Stock grip curve
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.08), wood);
    grip.position.set(0, -0.045, 0.32); grip.rotation.x = 0.3; group.add(grip);
    // Butt pad
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.11, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 }));
    butt.position.set(0, -0.005, 0.625); group.add(butt);
    // Checkering on grip
    for (let y = -0.06; y <= -0.03; y += 0.008) {
      for (let z = 0.44; z <= 0.52; z += 0.008) {
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.002, 0.002), darkWood);
        dot.position.set(0.028, y, z); group.add(dot);
      }
    }

    // Muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), flashMat);
    flash.position.set(0, 0.012, -0.78); flash.name = 'muzzleFlash';
    group.add(flash);

    return group;
  },

  _buildShotgunOnTable() {
    this.shotgunOnTable = this._makeShotgunMesh();
    this.shotgunOnTable.position.set(0, 0.84, 0.1);
    this.shotgunOnTable.rotation.y = Math.PI / 2;
    this.shotgunOnTable.name = 'shotgunOnTable';
    this.scene.add(this.shotgunOnTable);
  },

  _buildHeldGun() {
    this.heldGun = this._makeShotgunMesh();
    this.heldGun.position.set(0.22, -0.18, -0.5);
    this.heldGun.visible = false;
    this.muzzleFlash = this.heldGun.getObjectByName('muzzleFlash');
    this._applyGunSkin();
    this.camera.add(this.heldGun);
    this.scene.add(this.camera);
  },

  /**
   * Arcade gun skin: recolours the held shotgun itself (barrels/receiver = bullet,
   * stock/grip/pump = trail, glow emissive on metal + sight), plus flash + shot trail.
   * The table shotgun is skinned only while it is the player's turn (_setTableGunOwner).
   * Re-runnable (live shop changes): originals are cached in material.userData.gunOrig
   * and restored when the gun slot is empty; the old trail line is removed first.
   */
  _applyGunSkin() {
    if (this._skinTrail) {
      if (this._skinTrail.parent) this._skinTrail.parent.remove(this._skinTrail);
      this._skinTrail.geometry.dispose();
      this._skinTrail.material.dispose();
    }
    this._skinTrail = null;
    if (!window.ArcadeSkins || !this.heldGun) return;
    const on = ArcadeSkins.has('gun');
    this._skinShotgun(this.heldGun, on);
    this._skinShotgun(this.shotgunOnTable, on && this._tableGunMine);
    const fm = this.muzzleFlash.material;
    const fo = fm.userData.arcadeOrig || (fm.userData.arcadeOrig = { color: fm.color.getHex() });
    if (!(on && ArcadeSkins.paint(fm.color, 'gun', 'bullet', 'bs-gun-flash'))) fm.color.setHex(fo.color);
    // Shot trail: one reusable line, shown briefly on live shots
    if (on && ArcadeSkins.has('gun', 'trail')) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.012, -0.8), new THREE.Vector3(0, 0.012, -8)]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      ArcadeSkins.paint(mat.color, 'gun', 'trail', 'bs-gun-trail');
      this._skinTrail = new THREE.Line(geo, mat);
      this._skinTrail.visible = false;
      this.heldGun.add(this._skinTrail);
    }
  },

  // Gun part -> [colour field, colour scale, emissive field, emissive intensity].
  // Wood keeps its grain texture; scale > 1 lifts the dark map so the tint reads.
  // Parts not listed (butt pad, muzzle flash) keep their own colours.
  _GUN_SKIN_PARTS: {
    metal:     ['bullet', 1,    'glow',  0.3],  // barrels, receiver, rib, trigger
    darkMetal: ['bullet', 0.35, null,    0],    // bores, bands, loading port
    wood:      ['trail',  2.0,  'trail', 0.12], // stock, grip, pump
    darkWood:  ['trail',  0.45, null,    0],    // forend grooves, checkering
    sight:     ['glow',   1,    null,    0]     // front bead (MeshBasic)
  },
  _GUN_SKIN_KEYS: ['bullet', 'glow', 'trail'],

  /** Skin field to use for `key`, falling back to any field the skin defines. */
  _gunSkinField(key) {
    if (ArcadeSkins.has('gun', key)) return key;
    const keys = this._GUN_SKIN_KEYS;
    for (let i = 0; i < keys.length; i++) if (ArcadeSkins.has('gun', keys[i])) return keys[i];
    return null;
  },

  /** Restore a shotgun group's original materials, then paint the gun skin if `on`. */
  _skinShotgun(group, on) {
    if (!group || !window.ArcadeSkins) return;
    let mats = group.userData.skinMats;
    if (!mats) { // unique tagged materials, collected once per gun
      mats = group.userData.skinMats = [];
      group.traverse(obj => {
        const m = obj.material;
        if (m && m.userData.gunPart && mats.indexOf(m) < 0) mats.push(m);
      });
    }
    for (const m of mats) {
      const o = m.userData.gunOrig || (m.userData.gunOrig = {
        color: m.color.getHex(), map: m.map || null,
        emissive: m.emissive ? m.emissive.getHex() : 0, ei: m.emissiveIntensity,
        metalness: m.metalness, roughness: m.roughness });
      m.color.setHex(o.color);
      if ((m.map || null) !== o.map) { m.map = o.map; m.needsUpdate = true; }
      if (m.emissive) { m.emissive.setHex(o.emissive); m.emissiveIntensity = o.ei; }
      if (m.isMeshStandardMaterial) { m.metalness = o.metalness; m.roughness = o.roughness; }
    }
    group.userData.skinned = !!on;
    if (on) this._paintShotgun(group);
  },

  /** Paint the current skin colours onto a skinned gun. Allocation-free (runs per frame for rainbow). */
  _paintShotgun(group) {
    const mats = group.userData.skinMats;
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i], p = this._GUN_SKIN_PARTS[m.userData.gunPart];
      const key = p && this._gunSkinField(p[0]);
      if (!key) continue;
      m.color.setHex(ArcadeSkins.hex('gun', key, 0xffffff));
      if (p[1] !== 1) m.color.multiplyScalar(p[1]);
      if (!m.isMeshStandardMaterial) continue;
      // Less metalness so the colour shows without an env map; still shaded
      if (m.userData.gunOrig.metalness > 0.5) { m.metalness = 0.45; m.roughness = 0.3; }
      const ek = p[2] && this._gunSkinField(p[2]);
      if (ek) { m.emissive.setHex(ArcadeSkins.hex('gun', ek, 0)); m.emissiveIntensity = p[3]; }
    }
  },

  /** Rainbow gun skins: re-paint the visible skinned guns (called from the render loop). */
  _tickGunSkin() {
    if (!window.ArcadeSkins || !ArcadeSkins.isRainbow || !ArcadeSkins.isRainbow('gun')) return;
    const h = this.heldGun, t = this.shotgunOnTable;
    if (h && h.visible && h.userData.skinned) this._paintShotgun(h);
    if (t && t.visible && t.userData.skinned) this._paintShotgun(t);
  },

  /** The table shotgun wears the player's gun skin only while it is the player's turn. */
  _setTableGunOwner(mine) {
    this._tableGunMine = mine;
    if (window.ArcadeSkins) this._skinShotgun(this.shotgunOnTable, mine && ArcadeSkins.has('gun'));
  },

  /** Live re-apply of the arcade background skin; empty slot -> the room's default colors. */
  _applyBgSkin() {
    if (!window.ArcadeSkins || !ArcadeSkins.repaint || !this.scene) return;
    if (this.scene.background && this.scene.background.isColor) ArcadeSkins.repaint(this.scene.background, 'bg', 'sky', null, 0x080810);
    if (this.scene.fog) ArcadeSkins.repaint(this.scene.fog.color, 'bg', 'fog', null, 0x080810);
    if (this._ambientLight) ArcadeSkins.repaint(this._ambientLight.color, 'bg', 'light', null, 0x1a2233);
    if (this._floorMat && ArcadeSkins.repaint(this._floorMat.color, 'bg', 'ground', null, 0xffffff)) {
      this._floorMat.color.lerp(new THREE.Color(0xffffff), 0.35); // same tint as _buildRoom
    }
  },

  // ═══════════════════════════════════════════════════════
  // DEALER CHARACTER
  // Full upper-body model: head with deep-set glowing eyes,
  // fedora hat, suit with tie and lapels, arms resting on
  // the table with detailed hands and fingers.
  // ═══════════════════════════════════════════════════════

  _buildDealer() {
    const group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({ color: 0x998866, roughness: 0.85 });
    const darkSkin = new THREE.MeshStandardMaterial({ color: 0x776655, roughness: 0.85 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.7, metalness: 0.05 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x1a1a28, roughness: 0.6 });
    const hat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.5 });
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x551111, roughness: 0.4 });

    // ── Head ──
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.24), skin);
    head.position.y = 1.48; head.castShadow = true; head.name = 'opponentHead';
    group.add(head);

    // Cheekbones
    [-0.12, 0.12].forEach(x => {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.06), skin);
      cheek.position.set(x, 1.44, 0.08); group.add(cheek);
    });

    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.18), darkSkin);
    jaw.position.y = 1.33; group.add(jaw);
    // Chin
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.06), darkSkin);
    chin.position.set(0, 1.31, 0.1); group.add(chin);

    // Eye sockets (deep set)
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x1a1115, roughness: 0.9 });
    [-0.06, 0.06].forEach(x => {
      const socket = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.03), socketMat);
      socket.position.set(x, 1.5, 0.11); group.add(socket);
      // Iris (glowing)
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xcc1100 }));
      iris.position.set(x, 1.5, 0.125); group.add(iris);
      // Pupil
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x000000 }));
      pupil.position.set(x, 1.5, 0.13); group.add(pupil);
      // Eye glow
      const eyeGlow = new THREE.PointLight(0xcc0000, 0.05, 0.5);
      eyeGlow.position.set(x, 1.5, 0.14); group.add(eyeGlow);
    });

    // Brow ridge
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.06), darkSkin);
    brow.position.set(0, 1.52, 0.11); group.add(brow);

    // Nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.06), skin);
    nose.position.set(0, 1.44, 0.14); group.add(nose);
    const nostril = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.02), darkSkin);
    nostril.position.set(0, 1.41, 0.16); group.add(nostril);

    // Mouth
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.01),
      new THREE.MeshLambertMaterial({ color: 0x2a1111 }));
    mouth.position.set(0, 1.37, 0.125); group.add(mouth);

    // Ears
    [-0.13, 0.13].forEach(x => {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.035), skin);
      ear.position.set(x, 1.48, 0); group.add(ear);
    });

    // ── Hat (fedora) ──
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.015, 16), hat);
    brim.position.y = 1.635; brim.castShadow = true; group.add(brim);
    // Crown (slightly tapered, with crease)
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.13, 12), hat);
    crown.position.y = 1.71; group.add(crown);
    // Pinch at top
    const pinch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.12), hat);
    pinch.position.y = 1.78; group.add(pinch);
    // Hat band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0x771111, roughness: 0.3, metalness: 0.1 }));
    band.position.y = 1.65; group.add(band);

    // ── Neck ──
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 8), skin);
    neck.position.y = 1.28; group.add(neck);

    // ── Torso ──
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.26), suit);
    torso.position.y = 1.06; torso.castShadow = true; torso.name = 'opponentBody';
    group.add(torso);

    // Shirt front
    const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.005), shirt);
    shirtFront.position.set(0, 1.06, 0.133); group.add(shirtFront);

    // Tie
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.008), tieMat);
    tie.position.set(0, 1.02, 0.138); group.add(tie);
    // Tie knot
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.012), tieMat);
    knot.position.set(0, 1.2, 0.14); group.add(knot);

    // Lapels
    [-1, 1].forEach(side => {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.01), suit);
      lapel.position.set(side * 0.09, 1.14, 0.134);
      lapel.rotation.z = side * -0.12;
      group.add(lapel);
    });

    // Jacket buttons
    [1.0, 0.94].forEach(y => {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.005, 6),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.3 }));
      btn.position.set(0.06, y, 0.134); btn.rotation.x = Math.PI / 2;
      group.add(btn);
    });

    // ── Shoulders ──
    [-0.27, 0.27].forEach(x => {
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.24), suit);
      shoulder.position.set(x, 1.25, 0); group.add(shoulder);
    });

    // ── Upper arms ──
    [-0.3, 0.3].forEach(x => {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 0.09), suit);
      upper.position.set(x, 1.02, 0.04); group.add(upper);
    });

    // ── Forearms on table ──
    [-0.27, 0.27].forEach(x => {
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.07, 0.32), suit);
      forearm.position.set(x, 0.84, 0.2); forearm.name = 'opponentArm';
      group.add(forearm);
      // Shirt cuff
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.04), shirt);
      cuff.position.set(x, 0.84, 0.37); group.add(cuff);
    });

    // ── Hands ──
    [-0.27, 0.27].forEach(x => {
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.08), skin);
      palm.position.set(x, 0.84, 0.42); group.add(palm);
      // Fingers
      for (let f = -2; f <= 2; f++) {
        if (f === 0) continue; // skip gap
        const finger = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.016, 0.05), skin);
        finger.position.set(x + f * 0.015, 0.84, 0.47); group.add(finger);
        // Knuckle
        const kn = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), darkSkin);
        kn.position.set(x + f * 0.015, 0.85, 0.45); group.add(kn);
      }
      // Thumb
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.035), skin);
      thumb.position.set(x + (x > 0 ? -0.04 : 0.04), 0.845, 0.43);
      group.add(thumb);
    });

    group.position.set(0, 0, -2.2);
    group.name = 'opponent';
    this.opponentMesh = group;
    this.scene.add(group);
  },

  // ═══════════════════════════════════════════════════════
  // ROOM DECORATIONS & HORROR ELEMENTS
  // Shelves with bottles, framed paintings, clock, door,
  // pipes, chairs, rug, crate, bucket, cobwebs,
  // blood stains, scratch marks, boarded window, skull,
  // dripping pipe, old TV with static, meat hook,
  // creepy eyes behind the window, and eerie lights.
  // ═══════════════════════════════════════════════════════

  _buildRoomDecor() {
    const s = this.scene;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.7 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1008 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.6 });

    // ── BACK WALL ──

    // Shelf with bottles
    const shelf1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.035, 0.22), woodMat);
    shelf1.position.set(-1.2, 2.3, -3.94); shelf1.castShadow = true; s.add(shelf1);
    // Shelf brackets
    [-2.1, -1.2, -0.3].forEach(x => {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.18), woodMat);
      bracket.position.set(x, 2.24, -3.92); s.add(bracket);
    });
    // Second shelf
    const shelf2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.035, 0.2), woodMat);
    shelf2.position.set(-1.2, 1.7, -3.94); shelf2.castShadow = true; s.add(shelf2);
    [-2.1, -1.2, -0.3].forEach(x => {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.16), woodMat);
      bracket.position.set(x, 1.65, -3.92); s.add(bracket);
    });

    // Bottles on shelves (varied)
    const bottleData = [
      { x: -2.0, y: 2.32, h: 0.22, r: 0.035, c: 0x224422, o: 0.5 },
      { x: -1.6, y: 2.32, h: 0.18, r: 0.03, c: 0x553311, o: 0.6 },
      { x: -1.2, y: 2.32, h: 0.24, r: 0.032, c: 0x112244, o: 0.4 },
      { x: -0.8, y: 2.32, h: 0.2, r: 0.038, c: 0x441122, o: 0.5 },
      { x: -0.5, y: 2.32, h: 0.16, r: 0.028, c: 0x664422, o: 0.7 },
      { x: -2.0, y: 1.72, h: 0.2, r: 0.03, c: 0x333322, o: 0.5 },
      { x: -1.5, y: 1.72, h: 0.22, r: 0.035, c: 0x223311, o: 0.55 },
      { x: -0.9, y: 1.72, h: 0.18, r: 0.028, c: 0x442211, o: 0.6 },
    ];
    bottleData.forEach(b => {
      const mat = new THREE.MeshStandardMaterial({ color: b.c, transparent: true, opacity: b.o, roughness: 0.05 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, b.h, 8), mat);
      body.position.set(b.x, b.y + b.h / 2, -3.86); s.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.4, b.r * 0.7, 0.05, 6), mat);
      neck.position.set(b.x, b.y + b.h + 0.025, -3.86); s.add(neck);
    });

    // Large framed picture/mirror
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.5, metalness: 0.1 });
    [
      [1.8, 2.2, -3.96, 0.04, 1.0, 0.7], // Back wall frame
    ].forEach(([x, y, z, thick, h, w]) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, thick), frameMat);
      f.position.set(x, y, z); s.add(f);
      // Inner dark canvas
      const canvas = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.005),
        new THREE.MeshLambertMaterial({ color: 0x1a1815 }));
      canvas.position.set(x, y, z + 0.02); s.add(canvas);
      // Abstract marks on painting
      const paintMat = new THREE.MeshBasicMaterial({ color: 0x443322, transparent: true, opacity: 0.3 });
      for (let i = 0; i < 5; i++) {
        const stroke = new THREE.Mesh(new THREE.BoxGeometry(0.1 + Math.random() * 0.15, 0.008, 0.001), paintMat);
        stroke.position.set(x + (Math.random() - 0.5) * w * 0.8, y + (Math.random() - 0.5) * h * 0.6, z + 0.025);
        stroke.rotation.z = Math.random() * 0.3;
        s.add(stroke);
      }
    });

    // ── RIGHT WALL ──

    // Second picture
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.45), frameMat);
    f2.position.set(3.96, 2.0, -1.5); s.add(f2);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.5, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x1a1510 }));
    c2.position.set(3.955, 2.0, -1.5); s.add(c2);

    // Wall clock
    const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 20),
      new THREE.MeshStandardMaterial({ color: 0xeeddcc, roughness: 0.5 }));
    clockFace.position.set(3.96, 2.8, 1); clockFace.rotation.z = Math.PI / 2;
    s.add(clockFace);
    const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x554433, metalness: 0.5, roughness: 0.3 }));
    clockRim.position.set(3.95, 2.8, 1); clockRim.rotation.y = Math.PI / 2;
    s.add(clockRim);
    // Clock hands
    const handMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.08, 0.006), handMat);
    hourHand.position.set(3.95, 2.82, 1); hourHand.rotation.z = 0.7; s.add(hourHand);
    const minHand = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.11, 0.006), handMat);
    minHand.position.set(3.95, 2.84, 1); minHand.rotation.z = 2.1; s.add(minHand);

    // ── LEFT WALL ──

    // Door
    const doorFrame = new THREE.MeshStandardMaterial({ color: 0x2a1a08, roughness: 0.7 });
    const dfl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 0.08), doorFrame);
    dfl.position.set(-3.96, 1.1, -1.55); s.add(dfl);
    const dfr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.2, 0.08), doorFrame);
    dfr.position.set(-3.96, 1.1, -0.45); s.add(dfr);
    const dft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 1.18), doorFrame);
    dft.position.set(-3.96, 2.2, -1); s.add(dft);
    // Door itself with panels
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2d1810, roughness: 0.75 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.1, 1.02), doorMat);
    door.position.set(-3.97, 1.05, -1); s.add(door);
    // Door panels (inset)
    [[1.5, 0.35], [0.7, 0.35]].forEach(([y, h]) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.005, h, 0.38),
        new THREE.MeshStandardMaterial({ color: 0x251510, roughness: 0.8 }));
      panel.position.set(-3.96, y, -1); s.add(panel);
    });
    // Door handle
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xaa8844, metalness: 0.8, roughness: 0.2 }));
    handle.position.set(-3.94, 1.05, -0.55); s.add(handle);
    // Keyhole
    const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    keyhole.position.set(-3.94, 0.98, -0.55); keyhole.rotation.z = Math.PI / 2;
    s.add(keyhole);

    // Pipes
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.6 });
    const pipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 8), pipeMat);
    pipe1.position.set(-3.92, 2, 2.5); s.add(pipe1);
    const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 4, 8), pipeMat);
    pipe2.position.set(-3.92, 2, 2.7); s.add(pipe2);
    // Pipe joint
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), pipeMat);
    joint.position.set(-3.92, 1.5, 2.5); s.add(joint);

    // ── FLOOR OBJECTS ──

    // Old chair (behind dealer, left corner)
    this._buildChair(s, -2.5, -3, 0.3);
    // Second chair (right corner, behind player)
    this._buildChair(s, 2.8, 2.5, -0.5);

    // Rug under table
    const rugMat = new THREE.MeshStandardMaterial({ map: this._textures.fabric, color: 0x3a1515, roughness: 0.95 });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), rugMat);
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.003, 0);
    s.add(rug);
    // Rug fringe
    const fringeMat = new THREE.MeshLambertMaterial({ color: 0x4a2020 });
    [-1.6, 1.6].forEach(x => {
      for (let z = -1.1; z <= 1.1; z += 0.08) {
        const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.002, 0.04), fringeMat);
        fringe.position.set(x, 0.003, z); s.add(fringe);
      }
    });

    // Crate in corner
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a3518, roughness: 0.85 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), crateMat);
    crate.position.set(3.2, 0.2, -3.2); s.add(crate);
    // Crate slats
    for (let y = 0.05; y <= 0.35; y += 0.1) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.005),
        new THREE.MeshLambertMaterial({ color: 0x3a2510 }));
      slat.position.set(3.2, y, -3.0); s.add(slat);
    }

    // Bucket
    const bucketMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.4 });
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.25, 10, 1, true), bucketMat);
    bucket.position.set(3.0, 0.125, 2.5); s.add(bucket);
    const bucketBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.005, 10), bucketMat);
    bucketBottom.position.set(3.0, 0.005, 2.5); s.add(bucketBottom);

    // Cobwebs (top corners) - bigger, more visible
    const webMat = new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
    [[-3.95, 3.9, -3.95], [3.95, 3.9, -3.95], [-3.95, 3.9, 3.95], [3.95, 3.9, 3.95]].forEach(([x, y, z]) => {
      // Main web triangle
      const verts = new Float32Array([x, y, z, x + (x > 0 ? -1.2 : 1.2), y, z, x, y - 0.9, z]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      s.add(new THREE.Mesh(geo, webMat));
      // Extra strands
      for (let i = 0; i < 3; i++) {
        const strand = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.5, 0.001, 0.001),
          new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.06 }));
        strand.position.set(x + (x > 0 ? -0.3 : 0.3), y - 0.2 - i * 0.2, z);
        strand.rotation.z = (Math.random() - 0.5) * 0.5;
        s.add(strand);
      }
    });

    // ═══════════════ CREEPY ELEMENTS ═══════════════

    // ── Blood stains on floor ──
    const bloodMat = new THREE.MeshBasicMaterial({ color: 0x440000, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
    // Large dried blood pool near corner
    const bloodPool = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12), bloodMat);
    bloodPool.rotation.x = -Math.PI / 2; bloodPool.position.set(2.5, 0.003, -2.8);
    s.add(bloodPool);
    // Smaller splatter near pool
    for (let i = 0; i < 6; i++) {
      const splat = new THREE.Mesh(new THREE.CircleGeometry(0.04 + Math.random() * 0.08, 8),
        new THREE.MeshBasicMaterial({ color: 0x330000, transparent: true, opacity: 0.2 }));
      splat.rotation.x = -Math.PI / 2;
      splat.position.set(2.5 + (Math.random() - 0.5) * 1.2, 0.003, -2.8 + (Math.random() - 0.5) * 1);
      s.add(splat);
    }
    // Blood drip down back wall
    const dripMat = new THREE.MeshBasicMaterial({ color: 0x3a0000, transparent: true, opacity: 0.2 });
    for (let i = 0; i < 4; i++) {
      const drip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3 + Math.random() * 0.8, 0.005), dripMat);
      drip.position.set(2.8 + i * 0.12, 1.5 + Math.random() * 0.8, -3.97);
      s.add(drip);
    }
    // Blood smear on table edge
    const smear = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x440000, transparent: true, opacity: 0.15 }));
    smear.position.set(-1.2, 0.77, 0.9); s.add(smear);

    // ── Scratch marks on walls ──
    const scratchMat = new THREE.MeshBasicMaterial({ color: 0x2a2218, transparent: true, opacity: 0.3 });
    // Claw marks on right wall
    for (let i = 0; i < 5; i++) {
      const scratch = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.5 + Math.random() * 0.3, 0.005), scratchMat);
      scratch.position.set(3.96, 1.2 + Math.random() * 0.5, 1.5 + i * 0.06);
      scratch.rotation.z = 0.1 + Math.random() * 0.15;
      s.add(scratch);
    }
    // Scratch marks on left wall near door
    for (let i = 0; i < 4; i++) {
      const scratch = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.4 + Math.random() * 0.4, 0.003), scratchMat);
      scratch.position.set(-3.96, 1.0 + Math.random() * 0.4, -0.2 + i * 0.05);
      scratch.rotation.z = -0.1 + Math.random() * 0.2;
      s.add(scratch);
    }

    // ── Boarded up window on right wall ──
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 0.85 });
    // Window frame
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x2a1a08, roughness: 0.8 }));
    winFrame.position.set(3.96, 2.0, 0); s.add(winFrame);
    // Window glass (dark, barely visible)
    const winGlass = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.75, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x0a0a15, transparent: true, opacity: 0.7, roughness: 0.1 }));
    winGlass.position.set(3.95, 2.0, 0); s.add(winGlass);
    // Boards nailed across
    const nailMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.3 });
    [[-0.15, 2.15, -0.2], [0.05, 1.9, 0.15], [-0.08, 1.75, -0.1]].forEach(([bz, by, rot]) => {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.8), boardMat);
      board.position.set(3.93, by, bz); board.rotation.x = rot;
      s.add(board);
      // Nails
      [-0.3, 0.3].forEach(nz => {
        const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.015, 4), nailMat);
        nail.position.set(3.92, by, bz + nz); nail.rotation.z = Math.PI / 2;
        s.add(nail);
      });
    });
    // Eerie blue light leaking through cracks
    const windowLeakLight = new THREE.PointLight(0x2244aa, 0.15, 3);
    windowLeakLight.position.set(3.8, 2.0, 0);
    s.add(windowLeakLight);

    // ── Cracked mirror on back wall ──
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x4a3218, roughness: 0.6 }));
    mirrorFrame.position.set(-1.8, 2.2, -3.96); s.add(mirrorFrame);
    const mirrorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.05, metalness: 0.9 }));
    mirrorGlass.position.set(-1.8, 2.2, -3.94); s.add(mirrorGlass);
    // Crack lines across mirror
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.6 });
    [
      [-1.82, 2.35, -0.02, 0.005, 0.4], [-1.76, 2.15, 0.5, 0.004, 0.35],
      [-1.85, 2.1, -0.3, 0.003, 0.25], [-1.78, 2.3, 0.8, 0.004, 0.2],
      [-1.9, 2.25, -0.7, 0.003, 0.3]
    ].forEach(([cx, cy, rot, w, h]) => {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.002), crackMat);
      crack.position.set(cx, cy, -3.935); crack.rotation.z = rot;
      s.add(crack);
    });

    // ── Creepy writing on wall (scratched "GET OUT") ──
    // Simulated with thin box meshes spelling letters
    const writeMat = new THREE.MeshBasicMaterial({ color: 0x550000, transparent: true, opacity: 0.35 });
    const wx = -3.96, wy = 2.8, writeZ = 1.5;
    // G
    [
      [0, 0, 0.08, 0.005], [0, -0.05, 0.005, 0.1], [0, -0.1, 0.06, 0.005],
      [0.04, -0.075, 0.005, 0.055], [0.04, -0.1, 0.04, 0.005]
    ].forEach(([dz, dy, w, h]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, h, w), writeMat);
      l.position.set(wx, wy + dy, writeZ + dz); s.add(l);
    });
    // E
    const eOff = 0.12;
    [[0, 0, 0.06, 0.005], [0, -0.05, 0.005, 0.1], [0, -0.05, 0.04, 0.005], [0, -0.1, 0.06, 0.005]
    ].forEach(([dz, dy, w, h]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, h, w), writeMat);
      l.position.set(wx, wy + dy, writeZ + eOff + dz); s.add(l);
    });
    // T
    const tOff = 0.24;
    [[0, 0, 0.06, 0.005], [0.03, -0.05, 0.005, 0.1]].forEach(([dz, dy, w, h]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, h, w), writeMat);
      l.position.set(wx, wy + dy, writeZ + tOff + dz); s.add(l);
    });

    // ── Skull on shelf ──
    const skullMat2 = new THREE.MeshStandardMaterial({ color: 0xccbb99, roughness: 0.7 });
    // Cranium
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skullMat2);
    cranium.position.set(-0.5, 1.78, -3.86); cranium.scale.set(1, 0.9, 0.85);
    s.add(cranium);
    // Jaw
    const skullJaw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.04), skullMat2);
    skullJaw.position.set(-0.5, 1.71, -3.84); s.add(skullJaw);
    // Eye sockets
    const skullEyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    [-0.015, 0.015].forEach(x => {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.012, 6), skullEyeMat);
      eye.position.set(-0.5 + x, 1.79, -3.80);
      s.add(eye);
    });
    // Nose hole
    const noseHole = new THREE.Mesh(new THREE.CircleGeometry(0.006, 4), skullEyeMat);
    noseHole.position.set(-0.5, 1.76, -3.80); s.add(noseHole);

    // ── Dripping pipe with puddle ──
    // Water drip particles (small blue spheres that fall)
    this._dripParticles = [];
    const dripOrigin = new THREE.Vector3(-3.92, 1.5, 2.5);
    for (let i = 0; i < 3; i++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x4466aa, transparent: true, opacity: 0.5 }));
      drop.position.copy(dripOrigin);
      drop.position.y -= i * 0.5; // Stagger them
      drop.userData.vy = 0;
      s.add(drop);
      this._dripParticles.push(drop);
    }
    // Puddle on floor
    const puddleMat = new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.25, 12), puddleMat);
    puddle.rotation.x = -Math.PI / 2; puddle.position.set(-3.5, 0.003, 2.5);
    s.add(puddle);
    // Puddle reflection (shiny spot)
    const reflMat = new THREE.MeshBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.08 });
    const refl = new THREE.Mesh(new THREE.CircleGeometry(0.15, 10), reflMat);
    refl.rotation.x = -Math.PI / 2; refl.position.set(-3.5, 0.004, 2.5);
    s.add(refl);

    // ── Old TV with static (corner) ──
    const tvMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
    // TV body
    const tvBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.35), tvMat);
    tvBody.position.set(-3.2, 0.65, -3.2); tvBody.rotation.y = 0.4;
    s.add(tvBody);
    // Screen (static texture - animated)
    const tvScreenCanvas = document.createElement('canvas');
    tvScreenCanvas.width = 64; tvScreenCanvas.height = 48;
    this._tvCanvas = tvScreenCanvas;
    this._tvCtx = tvScreenCanvas.getContext('2d');
    const tvTex = new THREE.CanvasTexture(tvScreenCanvas);
    this._tvTexture = tvTex;
    const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.005),
      new THREE.MeshBasicMaterial({ map: tvTex }));
    tvScreen.position.set(-3.0, 0.67, -3.03);
    tvScreen.rotation.y = 0.4;
    s.add(tvScreen);
    // TV glow
    this._tvLight = new THREE.PointLight(0x4466aa, 0.2, 2);
    this._tvLight.position.set(-3.0, 0.7, -3.0);
    s.add(this._tvLight);
    // TV antenna
    const antMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    const ant1 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4), antMat);
    ant1.position.set(-3.15, 1.0, -3.25); ant1.rotation.z = -0.4;
    s.add(ant1);
    const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 4), antMat);
    ant2.position.set(-3.25, 0.98, -3.2); ant2.rotation.z = 0.3;
    s.add(ant2);

    // ── Meat hook hanging from ceiling ──
    const hookMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.2 });
    // Chain
    for (let y = 3.0; y < 3.9; y += 0.07) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.003, 4, 6), hookMat);
      link.position.set(3.0, y, 2.5);
      link.rotation.x = (Math.floor(y * 15) % 2 === 0) ? 0 : Math.PI / 2;
      s.add(link);
    }
    // Hook
    const hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 8, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.15 }));
    hookCurve.position.set(3.0, 2.95, 2.5); hookCurve.rotation.z = Math.PI;
    s.add(hookCurve);
    // Hook point
    const hookPt = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 4),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8 }));
    hookPt.position.set(3.04, 2.91, 2.5);
    s.add(hookPt);

    // ── Creepy eyes in the dark (behind boarded window) ──
    this._creepyEyes = [];
    [{ x: 3.85, y: 2.1, z: 0.1 }, { x: 3.85, y: 2.05, z: -0.15 }].forEach(pos => {
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0 }));
      eyeL.position.set(pos.x, pos.y, pos.z - 0.02);
      s.add(eyeL);
      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0 }));
      eyeR.position.set(pos.x, pos.y, pos.z + 0.02);
      s.add(eyeR);
      this._creepyEyes.push(eyeL, eyeR);
    });

    // ── Extra eerie lights ──
    // Pulsing red light from behind door
    this._doorLight = new THREE.PointLight(0x880000, 0, 3);
    this._doorLight.position.set(-3.8, 0.5, -1);
    s.add(this._doorLight);

    // Green sick light from TV corner
    const sickLight = new THREE.PointLight(0x225522, 0.1, 3);
    sickLight.position.set(-3.2, 0.3, -3.2);
    s.add(sickLight);
  },

  /** Build a wooden chair at the given position and rotation. */
  _buildChair(s, x, z, rotY) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2518, roughness: 0.8 });
    const group = new THREE.Group();
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.035, 0.45), mat);
    seat.position.set(0, 0.45, 0);
    group.add(seat);
    // Legs
    [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.45, 6), mat);
      leg.position.set(lx, 0.225, lz); group.add(leg);
    });
    // Back
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.035), mat);
    back.position.set(0, 0.7, -0.2); group.add(back);
    // Back slats
    [-0.12, 0, 0.12].forEach(sx => {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 0.015), mat);
      slat.position.set(sx, 0.7, -0.19); group.add(slat);
    });
    // Back posts
    [-0.21, 0.21].forEach(sx => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), mat);
      post.position.set(sx, 0.72, -0.2); group.add(post);
    });

    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    s.add(group);
  },

  // ═══════════════════════════════════════════════════════
  // ATMOSPHERIC PARTICLES
  // 200 floating dust motes that drift slowly upward.
  // ═══════════════════════════════════════════════════════

  _buildDustParticles() {
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = Math.random() * 3.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
      sizes[i] = 0.01 + Math.random() * 0.02;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xffddaa,
      size: 0.02,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.dustParticles = new THREE.Points(geo, mat);
    this.scene.add(this.dustParticles);
  },

  // ═══════════════════════════════════════════════════════
  // 3D ITEM MODELS (placed in table trays each round)
  // Each item is a small Group of meshes representing the
  // physical object: magnifying glass, cigarette pack,
  // beer can, handsaw, or handcuffs.
  // ═══════════════════════════════════════════════════════

  itemMeshes: { player: [], dealer: [] },

  /** Create a 3D mesh for the given item type. */
  _makeItemMesh(type) {
    const group = new THREE.Group();

    switch (type) {
      case 'magnifying_glass': {
        // Handle
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.04, 6),
          new THREE.MeshStandardMaterial({ color: 0x553311, roughness: 0.6 }));
        handle.position.y = 0.005; handle.rotation.z = 0.3;
        group.add(handle);
        // Ring
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 12),
          new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.2 }));
        ring.position.set(0.012, 0.028, 0);
        group.add(ring);
        // Glass lens
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 10),
          new THREE.MeshStandardMaterial({ color: 0xaaddff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
        lens.position.set(0.012, 0.028, 0);
        group.add(lens);
        break;
      }
      case 'cigarettes': {
        // Pack
        const pack = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.02),
          new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.7 }));
        pack.position.y = 0.025;
        group.add(pack);
        // Top flap
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.008, 0.018),
          new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }));
        flap.position.set(0, 0.052, 0);
        group.add(flap);
        // Cigarette sticking out
        const cig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 4),
          new THREE.MeshLambertMaterial({ color: 0xeeeecc }));
        cig.position.set(0, 0.06, 0);
        group.add(cig);
        break;
      }
      case 'beer': {
        // Can/bottle
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 8),
          new THREE.MeshStandardMaterial({ color: 0xccaa33, roughness: 0.3, metalness: 0.5 }));
        can.position.y = 0.025;
        group.add(can);
        // Label band
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.015, 8),
          new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4 }));
        band.position.y = 0.02;
        group.add(band);
        // Tab on top
        const tab = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 0.012),
          new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.6 }));
        tab.position.set(0, 0.052, 0);
        group.add(tab);
        break;
      }
      case 'handsaw': {
        // Blade
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 }));
        blade.position.set(0, 0.008, 0);
        group.add(blade);
        // Teeth (zigzag edge)
        for (let i = -0.025; i <= 0.025; i += 0.006) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.003),
            new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7 }));
          tooth.position.set(i, 0.005, 0.012);
          group.add(tooth);
        }
        // Handle
        const sawHandle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.025),
          new THREE.MeshStandardMaterial({ color: 0x884411, roughness: 0.7 }));
        sawHandle.position.set(-0.038, 0.01, 0);
        group.add(sawHandle);
        break;
      }
      case 'handcuffs': {
        // Two rings
        [-0.012, 0.012].forEach(x => {
          const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 10),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.2 }));
          cuff.position.set(x, 0.015, 0);
          cuff.rotation.x = Math.PI / 2;
          group.add(cuff);
        });
        // Chain links between
        for (let i = -1; i <= 1; i++) {
          const link = new THREE.Mesh(new THREE.TorusGeometry(0.004, 0.0015, 4, 6),
            new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 }));
          link.position.set(i * 0.005, 0.015, 0);
          link.rotation.y = Math.PI / 2;
          group.add(link);
        }
        break;
      }
      case 'sticky_fingers': {
        // Grabbing hand shape
        const palm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.025),
          new THREE.MeshStandardMaterial({ color: 0xddaa77, roughness: 0.8 }));
        palm.position.y = 0.01;
        group.add(palm);
        // Fingers (curled inward)
        for (let f = -1.5; f <= 1.5; f++) {
          const finger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.018),
            new THREE.MeshStandardMaterial({ color: 0xddaa77, roughness: 0.8 }));
          finger.position.set(f * 0.007, 0.012, 0.018);
          finger.rotation.x = -0.4;
          group.add(finger);
        }
        // Thumb
        const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.008, 0.014),
          new THREE.MeshStandardMaterial({ color: 0xddaa77, roughness: 0.8 }));
        thumb.position.set(-0.018, 0.012, 0.005);
        thumb.rotation.z = 0.4;
        group.add(thumb);
        break;
      }
      default: {
        // Unknown item -- generic white box
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
        box.position.y = 0.02;
        group.add(box);
      }
    }

    return group;
  },

  /** Place item meshes on the table trays (called by game.js each round). */
  placeItems(playerItems, dealerItems) {
    // Clear old item meshes
    this.itemMeshes.player.forEach(m => this.scene.remove(m));
    this.itemMeshes.dealer.forEach(m => this.scene.remove(m));
    this.itemMeshes.player = [];
    this.itemMeshes.dealer = [];

    // Place player items
    playerItems.forEach((type, i) => {
      if (i >= 4) return;
      const box = this.itemBoxes.player[i];
      const mesh = this._makeItemMesh(type);
      mesh.position.set(box.x, 0.805, box.z);
      this.scene.add(mesh);
      this.itemMeshes.player.push(mesh);
    });

    // Place dealer items
    dealerItems.forEach((type, i) => {
      if (i >= 4) return;
      const box = this.itemBoxes.dealer[i];
      const mesh = this._makeItemMesh(type);
      mesh.position.set(box.x, 0.805, box.z);
      this.scene.add(mesh);
      this.itemMeshes.dealer.push(mesh);
    });
  },

  // Remove a specific player item from its tray (called when used)
  removePlayerItem(index) {
    if (this.itemMeshes.player[index]) {
      this.scene.remove(this.itemMeshes.player[index]);
      this.itemMeshes.player[index] = null;
    }
  },

  /** Arcade ability skin: glow burst + ring where the player used an item. No skin = no effect. */
  playerItemBurst(index) {
    if (!window.ArcadeSkins || !ArcadeSkins.has('ability') || !this.itemMeshes) return;
    const used = this.itemMeshes.player[index] || (this.itemBoxes && this.itemBoxes.player[index]);
    if (!used) return;
    const pos = used.position ? used.position : { x: used.x, z: used.z };
    if (!this._abilityFx || this._abilityFx.scene !== this.scene) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const light = new THREE.PointLight(0xffffff, 0, 1.5);
      const group = new THREE.Group();
      group.add(orb, ring, light); group.visible = false;
      this.scene.add(group);
      this._abilityFx = { scene: this.scene, group, orb, ring, light, start: 0 };
    }
    const fx = this._abilityFx;
    ArcadeSkins.paint(fx.orb.material.color, 'ability', 'primary', 'bs-ab-orb');
    ArcadeSkins.paint(fx.ring.material.color, 'ability', 'secondary', 'bs-ab-ring');
    ArcadeSkins.paint(fx.light.color, 'ability', 'primary', 'bs-ab-light');
    fx.group.position.set(pos.x, 0.82, pos.z);
    fx.group.visible = true;
    fx.start = performance.now();
  },

  _updateAbilityBurst(time) {
    const fx = this._abilityFx;
    if (!fx || !fx.group.visible) return;
    const t = (time - fx.start) / 700;
    if (t >= 1) { fx.group.visible = false; fx.light.intensity = 0; return; }
    const k = 1 - t;
    fx.orb.scale.setScalar(1 + t * 1.5); fx.orb.material.opacity = 0.8 * k;
    fx.orb.position.y = t * 0.15;
    fx.ring.scale.setScalar(1 + t * 4); fx.ring.material.opacity = k;
    fx.light.intensity = 2.5 * k;
  },

  // Remove a specific dealer item from its tray
  removeDealerItem(index) {
    if (this.itemMeshes.dealer[index]) {
      this.scene.remove(this.itemMeshes.dealer[index]);
      this.itemMeshes.dealer[index] = null;
    }
  },

  // ═══════════════════════════════════════════════════════
  // ITEM BOX (opens/closes each round to deal items)
  // Black box with red velvet lining, brass corners,
  // latch, skull emblem, and a hinged lid that animates.
  // ═══════════════════════════════════════════════════════

  _buildItemBox() {
    const s = this.scene;
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.15 });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x882222, roughness: 0.8 }); // red velvet inside
    const hingeMat = new THREE.MeshStandardMaterial({ color: 0x777744, roughness: 0.3, metalness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x554422, roughness: 0.4, metalness: 0.4 });

    this.itemBox = new THREE.Group();

    const boxW = 0.4, boxD = 0.25, boxH = 0.08;

    // Bottom
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.008, boxD), boxMat);
    bottom.position.y = 0;
    this.itemBox.add(bottom);

    // Inner bottom (red velvet)
    const innerBottom = new THREE.Mesh(new THREE.BoxGeometry(boxW - 0.016, 0.003, boxD - 0.016), innerMat);
    innerBottom.position.y = 0.005;
    this.itemBox.add(innerBottom);

    // Walls
    const wallF = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, 0.008), boxMat);
    wallF.position.set(0, boxH / 2, boxD / 2 - 0.004); this.itemBox.add(wallF);
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(boxW, boxH, 0.008), boxMat);
    wallB.position.set(0, boxH / 2, -boxD / 2 + 0.004); this.itemBox.add(wallB);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.008, boxH, boxD), boxMat);
    wallL.position.set(-boxW / 2 + 0.004, boxH / 2, 0); this.itemBox.add(wallL);
    const wallR = new THREE.Mesh(new THREE.BoxGeometry(0.008, boxH, boxD), boxMat);
    wallR.position.set(boxW / 2 - 0.004, boxH / 2, 0); this.itemBox.add(wallR);

    // Inner walls (red velvet lining)
    const iWallF = new THREE.Mesh(new THREE.BoxGeometry(boxW - 0.02, boxH - 0.01, 0.003), innerMat);
    iWallF.position.set(0, boxH / 2, boxD / 2 - 0.01); this.itemBox.add(iWallF);
    const iWallB = new THREE.Mesh(new THREE.BoxGeometry(boxW - 0.02, boxH - 0.01, 0.003), innerMat);
    iWallB.position.set(0, boxH / 2, -boxD / 2 + 0.01); this.itemBox.add(iWallB);
    const iWallL = new THREE.Mesh(new THREE.BoxGeometry(0.003, boxH - 0.01, boxD - 0.02), innerMat);
    iWallL.position.set(-boxW / 2 + 0.01, boxH / 2, 0); this.itemBox.add(iWallL);
    const iWallR = new THREE.Mesh(new THREE.BoxGeometry(0.003, boxH - 0.01, boxD - 0.02), innerMat);
    iWallR.position.set(boxW / 2 - 0.01, boxH / 2, 0); this.itemBox.add(iWallR);

    // Corner trim (brass/gold corners)
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.02, boxH + 0.005, 0.02), trimMat);
      corner.position.set(sx * (boxW / 2 - 0.008), boxH / 2, sz * (boxD / 2 - 0.008));
      this.itemBox.add(corner);
    });

    // Latch on front
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.008), hingeMat);
    latch.position.set(0, boxH, boxD / 2 - 0.002);
    this.itemBox.add(latch);
    const latchHook = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.005), hingeMat);
    latchHook.position.set(0, boxH + 0.01, boxD / 2 + 0.002);
    this.itemBox.add(latchHook);

    // ── LID (separate group so it can rotate open) ──
    this.itemBoxLid = new THREE.Group();

    const lid = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.008, boxD), boxMat);
    lid.position.set(0, 0.004, boxD / 2);
    this.itemBoxLid.add(lid);

    // Lid inner (red velvet)
    const lidInner = new THREE.Mesh(new THREE.BoxGeometry(boxW - 0.016, 0.003, boxD - 0.016), innerMat);
    lidInner.position.set(0, 0.001, boxD / 2);
    this.itemBoxLid.add(lidInner);

    // Lid edge trim
    const lidTrimF = new THREE.Mesh(new THREE.BoxGeometry(boxW + 0.006, 0.012, 0.008), trimMat);
    lidTrimF.position.set(0, 0.004, boxD - 0.002);
    this.itemBoxLid.add(lidTrimF);

    // Lid emblem/plate (center decoration)
    const emblemMat = new THREE.MeshStandardMaterial({ color: 0x886633, roughness: 0.2, metalness: 0.7 });
    const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.003, 0.05), emblemMat);
    emblem.position.set(0, 0.007, boxD / 2);
    this.itemBoxLid.add(emblem);
    // Skull/crossbones hint on emblem
    const skullMat = new THREE.MeshStandardMaterial({ color: 0xaa9955, roughness: 0.3, metalness: 0.6 });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), skullMat);
    skull.position.set(0, 0.01, boxD / 2);
    skull.scale.y = 0.7;
    this.itemBoxLid.add(skull);

    // Hinges on back
    [-0.12, 0.12].forEach(x => {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.015, 6), hingeMat);
      hinge.rotation.z = Math.PI / 2;
      hinge.position.set(x, 0, 0);
      this.itemBoxLid.add(hinge);
    });

    // Position lid pivot at back edge of box
    this.itemBoxLid.position.set(0, boxH, -boxD / 2 + 0.004);
    // Start closed (lid rotated down to cover the box)
    this.itemBoxLid.rotation.x = 0;

    this.itemBox.add(this.itemBoxLid);

    // Position the whole box on the left side of the table
    this.itemBox.position.set(-0.55, 0.80, -0.05);
    s.add(this.itemBox);
  },

  /** Animate the item box lid opening (~120 degrees). */
  openItemBox() {
    return new Promise(resolve => {
      const startTime = performance.now();
      const startRot = this.itemBoxLid.rotation.x;
      const endRot = -Math.PI * 0.65; // open ~120 degrees
      const dur = 600;
      const anim = () => {
        const t = Math.min((performance.now() - startTime) / dur, 1);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        this.itemBoxLid.rotation.x = startRot + (endRot - startRot) * ease;
        if (t < 1) requestAnimationFrame(anim); else resolve();
      };
      anim();
    });
  },

  /** Animate the item box lid closing. */
  closeItemBox() {
    return new Promise(resolve => {
      const startTime = performance.now();
      const startRot = this.itemBoxLid.rotation.x;
      const endRot = 0;
      const dur = 400;
      const anim = () => {
        const t = Math.min((performance.now() - startTime) / dur, 1);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        this.itemBoxLid.rotation.x = startRot + (endRot - startRot) * ease;
        if (t < 1) requestAnimationFrame(anim); else resolve();
      };
      anim();
    });
  },

  // ═══════════════════════════════════════════════════════
  // POST-PROCESSING (CSS overlay effects)
  // Vignette, scanlines, film grain, and chromatic
  // aberration -- all done with CSS, no shaders needed.
  // ═══════════════════════════════════════════════════════

  _buildPostProcessing() {
    // Vignette + film grain + scanlines via a CSS overlay
    const overlay = document.createElement('div');
    overlay.id = 'post-fx';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 1;
      background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%);
    `;
    document.body.appendChild(overlay);

    // Scanlines
    const scanlines = document.createElement('div');
    scanlines.id = 'scanlines';
    scanlines.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 1; opacity: 0.04;
      background: repeating-linear-gradient(
        0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px
      );
    `;
    document.body.appendChild(scanlines);

    // Film grain (animated via CSS)
    const grain = document.createElement('canvas');
    grain.id = 'film-grain';
    grain.width = 256; grain.height = 256;
    grain.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 1; opacity: 0.06;
      mix-blend-mode: overlay;
    `;
    document.body.appendChild(grain);

    // Generate grain frames
    const gCtx = grain.getContext('2d');
    this._grainCanvas = grain;
    this._grainCtx = gCtx;

    // Chromatic aberration hint (subtle red/blue edge shift via box-shadow)
    const chroma = document.createElement('div');
    chroma.id = 'chroma-ab';
    chroma.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 1;
      box-shadow: inset 2px 0 8px rgba(255,0,0,0.03), inset -2px 0 8px rgba(0,0,255,0.03);
    `;
    document.body.appendChild(chroma);
  },

  _updateGrain() {
    if (!this._grainCtx) return;
    const ctx = this._grainCtx;
    const w = 256, h = 256;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  },

  _buildSelfTarget() {
    const geo = new THREE.PlaneGeometry(1.5, 1.5);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    this.selfTarget = new THREE.Mesh(geo, mat);
    this.selfTarget.position.set(0, 0.6, 1.8);
    this.selfTarget.rotation.x = -Math.PI / 4;
    this.selfTarget.name = 'selfTarget';
    this.scene.add(this.selfTarget);
  },

  // ═══════════════════════════════════════════════════════
  // INPUT HANDLING
  // Mouse move: aim gun (with pointer lock)
  // Click: pick up shotgun or fire at target
  // ═══════════════════════════════════════════════════════

  _setupInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      if (this.gunPickedUp && document.pointerLockElement) {
        this.aimYaw -= e.movementX * 0.003;
        this.aimPitch -= e.movementY * 0.003;
        this.aimPitch = Math.max(-0.5, Math.min(0.3, this.aimPitch));
        this.aimYaw = Math.max(-0.6, Math.min(0.6, this.aimYaw));
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.aimYaw;
        this.camera.rotation.x = this.aimPitch;
      }
    });
    canvas.addEventListener('click', () => {
      if (!this.canInteract) return;
      if (!this.gunPickedUp) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (this.raycaster.intersectObject(this.shotgunOnTable, true).length > 0) this._pickUpGun();
      } else if (document.pointerLockElement) {
        this._fireAtTarget();
      }
    });
    canvas.addEventListener('mousedown', () => {
      if (this.gunPickedUp && !document.pointerLockElement) canvas.requestPointerLock();
    });
  },

  _pickUpGun() {
    this.gunPickedUp = true;
    this.shotgunOnTable.visible = false;
    this.heldGun.visible = true;
    this.aimYaw = 0; this.aimPitch = 0;
    this.camera.rotation.set(0, 0, 0);
    this.renderer.domElement.requestPointerLock();
    GameAudio.playPump();
    document.getElementById('crosshair').classList.remove('hidden');
    if (this.onGunPickedUp) this.onGunPickedUp();
  },

  _fireAtTarget() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const opp = this.raycaster.intersectObject(this.opponentMesh, true);
    const self = this.raycaster.intersectObject(this.selfTarget, true);
    let target = null;
    if (opp.length && self.length) target = opp[0].distance < self[0].distance ? 'opponent' : 'self';
    else if (opp.length) target = 'opponent';
    else if (self.length) target = 'self';
    if (target && this.onShoot) { this.canInteract = false; this.onShoot(target); }
  },

  // ═══════════════════════════════════════════════════════
  // GAME STATE METHODS
  // Called by game.js to control scene interaction.
  // ═══════════════════════════════════════════════════════

  /** Allow the player to click on the shotgun to pick it up. */
  enableGunPickup() {
    this.canInteract = true; this.gunPickedUp = false;
    this._setTableGunOwner(true); // your turn: the gun on the table wears your skin
    this.shotgunOnTable.visible = true; this.heldGun.visible = false;
    this.aimYaw = 0; this.aimPitch = 0;
    this.camera.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.3, 2.2); this.camera.lookAt(0, 0.85, 0);
    if (document.pointerLockElement) document.exitPointerLock();
  },

  disableInteraction() {
    this.canInteract = false; this.gunPickedUp = false;
    this._setTableGunOwner(false); // dealer/opponent's gun: original look
    this.shotgunOnTable.visible = true; this.heldGun.visible = false;
    this.camera.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.3, 2.2); this.camera.lookAt(0, 0.85, 0);
    if (document.pointerLockElement) document.exitPointerLock();
  },

  /** Play the muzzle flash + recoil effect for the player's gun. */
  fireEffect(isLive) {
    return new Promise(resolve => {
      if (isLive) {
        this.muzzleFlash.material.opacity = 1;
        const fl = new THREE.PointLight(window.ArcadeSkins ? ArcadeSkins.hex('gun', 'glow', 0xffaa33) : 0xffaa33, 8, 5);
        fl.position.copy(this.camera.position); this.scene.add(fl);
        if (this._skinTrail) this._skinTrail.visible = true;
        const origPos = this.heldGun.position.clone();
        this.heldGun.position.z += 0.1; this.heldGun.rotation.x = -0.08;
        setTimeout(() => {
          this.muzzleFlash.material.opacity = 0;
          if (this._skinTrail) this._skinTrail.visible = false;
          this.heldGun.position.copy(origPos); this.heldGun.rotation.x = 0;
          this.scene.remove(fl); resolve();
        }, 150);
      } else {
        const origPos = this.heldGun.position.clone();
        this.heldGun.position.z += 0.03;
        setTimeout(() => { this.heldGun.position.copy(origPos); resolve(); }, 100);
      }
    });
  },

  putGunDown() {
    this.gunPickedUp = false; this.heldGun.visible = false; this.shotgunOnTable.visible = true;
    document.getElementById('crosshair').classList.add('hidden');
    this.camera.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.3, 2.2); this.camera.lookAt(0, 0.85, 0);
    if (document.pointerLockElement) document.exitPointerLock();
  },

  async opponentShootAnimation(target) {
    if (this._tableGunMine) this._setTableGunOwner(false);
    this.shotgunOnTable.visible = true;
    const sp = this.shotgunOnTable.position.clone();
    const sr = this.shotgunOnTable.rotation.clone();
    await this._animateGun(sp, new THREE.Vector3(0, 0.9, -1.8), sr.y, target === 'opponent' ? Math.PI : 0, 500);
    return new Promise(r => setTimeout(r, 300));
  },

  async opponentFireEffect(isLive) {
    const flash = this.shotgunOnTable.getObjectByName('muzzleFlash');
    if (isLive && flash) {
      flash.material.opacity = 1;
      const fl = new THREE.PointLight(0xffaa33, 8, 5);
      fl.position.set(0, 1, -1.8); this.scene.add(fl);
      setTimeout(() => { flash.material.opacity = 0; this.scene.remove(fl); }, 150);
    }
    const oz = this.shotgunOnTable.position.z;
    this.shotgunOnTable.position.z += 0.05;
    await new Promise(r => setTimeout(r, 150));
    this.shotgunOnTable.position.z = oz;
  },

  opponentPutGunDown() {
    this.shotgunOnTable.position.set(0, 0.84, 0.1);
    this.shotgunOnTable.rotation.y = Math.PI / 2;
    this.shotgunOnTable.visible = true;
  },

  _animateGun(from, to, fromR, toR, dur) {
    return new Promise(resolve => {
      const st = performance.now();
      const anim = () => {
        const t = Math.min((performance.now() - st) / dur, 1);
        const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        this.shotgunOnTable.position.lerpVectors(from, to, e);
        this.shotgunOnTable.rotation.y = fromR + (toR - fromR) * e;
        if (t < 1) requestAnimationFrame(anim); else resolve();
      };
      anim();
    });
  },

  opponentHitReaction() {
    return new Promise(resolve => {
      const head = this.opponentMesh.getObjectByName('opponentHead');
      if (!head) { resolve(); return; }
      const oc = head.material.color.getHex();
      head.material.color.setHex(0xff0000);
      this.opponentMesh.position.z -= 0.12;
      setTimeout(() => { head.material.color.setHex(oc); this.opponentMesh.position.z += 0.12; resolve(); }, 350);
    });
  },

  opponentDeath() {
    return new Promise(resolve => {
      const st = performance.now();
      const anim = () => {
        const t = Math.min((performance.now() - st) / 700, 1);
        this.opponentMesh.rotation.x = t * -0.5;
        this.opponentMesh.position.y = -t * 0.4;
        if (t < 1) requestAnimationFrame(anim); else resolve();
      };
      anim();
    });
  },

  resetOpponent() { this.opponentMesh.rotation.x = 0; this.opponentMesh.position.y = 0; },

  cameraShake() {
    return new Promise(resolve => {
      const op = this.camera.position.clone();
      let n = 0;
      const shake = () => {
        if (n >= 10) { this.camera.position.copy(op); resolve(); return; }
        const i = 0.1 * (1 - n / 10);
        this.camera.position.x = op.x + (Math.random() - 0.5) * i;
        this.camera.position.y = op.y + (Math.random() - 0.5) * i;
        n++; setTimeout(shake, 30);
      };
      shake();
    });
  },

  // ═══════════════════════════════════════════════════════
  // ANIMATION LOOP
  // Updates every frame: light flicker, dust drift, film
  // grain, TV static, water drips, creepy eyes, and the
  // pulsing red light behind the door.
  // ═══════════════════════════════════════════════════════

  _animate() {
    requestAnimationFrame(() => this._animate());
    const time = performance.now();

    // Light flicker
    if (this.flickerLight) {
      this.flickerLight.intensity = 3 + Math.sin(time * 0.004) * 0.2
        + Math.sin(time * 0.013) * 0.1 + (Math.random() < 0.02 ? -0.5 : 0);
    }

    // Dust drift
    if (this.dustParticles) {
      const pos = this.dustParticles.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3] += Math.sin(time * 0.0003 + i) * 0.0003;
        pos.array[i * 3 + 1] += 0.00015;
        pos.array[i * 3 + 2] += Math.cos(time * 0.0004 + i) * 0.0002;
        if (pos.array[i * 3 + 1] > 3.8) pos.array[i * 3 + 1] = 0.1;
      }
      pos.needsUpdate = true;
    }

    // Film grain update (every 3 frames)
    if (Math.floor(time / 50) % 3 === 0) this._updateGrain();

    // TV static
    if (this._tvCtx && Math.floor(time / 80) % 2 === 0) {
      const ctx = this._tvCtx;
      const img = ctx.createImageData(64, 48);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 100;
        img.data[i] = v * 0.7; img.data[i+1] = v * 0.8; img.data[i+2] = v;
        img.data[i+3] = 255;
      }
      // Random horizontal glitch lines
      if (Math.random() < 0.1) {
        const y = Math.floor(Math.random() * 48);
        for (let x = 0; x < 64; x++) {
          const idx = (y * 64 + x) * 4;
          img.data[idx] = 150; img.data[idx+1] = 180; img.data[idx+2] = 200;
        }
      }
      ctx.putImageData(img, 0, 0);
      this._tvTexture.needsUpdate = true;
    }
    // TV light flicker
    if (this._tvLight) {
      this._tvLight.intensity = 0.15 + Math.random() * 0.1;
    }

    // Dripping water
    if (this._dripParticles) {
      this._dripParticles.forEach(drop => {
        drop.userData.vy -= 0.0003; // gravity
        drop.position.y += drop.userData.vy;
        if (drop.position.y < 0.01) {
          // Reset to top
          drop.position.set(-3.92, 1.48, 2.5);
          drop.userData.vy = 0;
        }
      });
    }

    // Creepy eyes - randomly appear and disappear
    if (this._creepyEyes) {
      this._creepyEyes.forEach((eye, i) => {
        // Eyes appear in pairs for ~2 seconds every ~8 seconds
        const cycle = (time * 0.001 + i * 0.5) % 10;
        eye.material.opacity = (cycle > 7 && cycle < 9) ? 0.6 + Math.sin(time * 0.01) * 0.2 : 0;
      });
    }

    // Pulsing red light behind door
    if (this._doorLight) {
      const pulse = Math.sin(time * 0.002) * 0.5 + 0.5; // 0 to 1
      this._doorLight.intensity = pulse * 0.15;
    }

    // Arcade skins (cosmetic): rainbow cycling + item-use burst
    if (window.ArcadeSkins) ArcadeSkins.tick();
    this._tickGunSkin();
    this._updateAbilityBurst(time);

    this.renderer.render(this.scene, this.camera);
  }
};
