#!/usr/bin/env node
// ============================================================
// tools/test-arcade.js -- automated test of the Daniel's Arcade
// integration in Buckshot Roulette (abilities, currencies, skins, shop).
//
//   node tools/test-arcade.js          (from shooting-game/)
//   npm run test:arcade
//
// The RUNNING code is inline in public/index.html; public/js/*.js are
// copies kept in step. Both are loaded into their own jsdom window with
// the real three@0.160.0 and the real public/arcade-shop.js:
//   [inline]  public/index.html's inline <script> (all of it, incl. wiring)
//   [js]      js/arcade-skins.js, audio, save, network, buckshot-scene,
//             buckshot, fps-game, main.js (same order as the page)
// and the same checks run against each. Math.random is forced to 0 and
// 0.999 to prove each ability chance fires and doesn't.
//
// Ends with "ARCADE TEST PASS" or "ARCADE TEST FAIL (n)"; exit 1 on failure.
// ============================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const THREE = require('three');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const HTML = read('index.html');
const SAVE_KEY = 'daniels-arcade-v1';
const BONUS_KEY = 'buckshot_bonus_items';
const LIVES_KEY = 'buckshot_extra_lives';

// ---------------------------------------------------------------- reporting
let passed = 0;
const failures = [];
let label = '';
function check(name, cond, detail) {
  if (cond) { passed++; return true; }
  const msg = `[${label}] ${name}` + (detail !== undefined ? ` -- got ${JSON.stringify(detail)}` : '');
  failures.push(msg);
  console.log('  FAIL ' + msg);
  return false;
}
// A known issue outside the game code (e.g. in arcade-shop.js, which this repo only copies):
// printed as WARN so it stays visible, but not counted as a failure.
const warnings = [];
function known(name, cond, detail) {
  if (cond) { passed++; return; }
  const msg = `[${label}] ${name} -- got ${JSON.stringify(detail)}`;
  warnings.push(msg);
  console.log('  WARN ' + msg);
}
const eq = (name, got, want) => check(`${name} (want ${JSON.stringify(want)})`, got === want, got);
function section(name) { console.log(`[${label}] ${name}`); }

// ---------------------------------------------------------------- environments
function makeWindow(scripts, envErrors) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) envErrors.push(e.message); });
  vc.on('error', (...a) => envErrors.push(a.join(' ')));
  const dom = new JSDOM(HTML, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  win.THREE = THREE;
  win.io = () => ({ on() {}, emit() {}, disconnect() {} });
  win.confirm = () => false;
  win.alert = () => {};
  win.HTMLCanvasElement.prototype.getContext = () => null;
  win.__currencies = [];
  // Run as classic scripts (vm.Script), so top-level const Game/GameScene are shared like on the page.
  const ctx = dom.getInternalVMContext();
  win.__run = (src, name) => vm.runInContext(src, ctx, { filename: name });
  for (const [name, src] of scripts) {
    try { win.__run(src, name); } catch (e) { envErrors.push(`${name}: ${e.stack || e}`); }
    // Record what the game registers with the shop (the shop keeps them private).
    if (name === 'arcade-shop.js' && win.ArcadeShop) {
      const reg = win.ArcadeShop.registerCurrency;
      win.ArcadeShop.registerCurrency = (c) => { win.__currencies.push(c); return reg(c); };
    }
  }
  return win;
}

function inlineScripts() {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(HTML))) {
    const attrs = m[1] || '';
    const src = /\ssrc="([^"]+)"/.exec(attrs);
    if (src) {
      // Local scripts the page loads by src: arcade-skins.js and arcade-shop.js (not three/socket.io/widget).
      if (/arcade-skins\.js$/.test(src[1])) out.push(['js/arcade-skins.js', read('js/arcade-skins.js')]);
      else if (/arcade-shop\.js$/.test(src[1])) out.push(['arcade-shop.js', read('arcade-shop.js')]);
      continue;
    }
    if (/document\.write/.test(m[2]) && m[2].length < 300) continue; // relative-path fallbacks
    out.push(['index.html inline', m[2]]);
  }
  return out;
}

const JS_FILES = ['js/arcade-skins.js', 'arcade-shop.js', 'js/audio.js', 'js/save.js', 'js/network.js',
  'js/buckshot-scene.js', 'js/buckshot.js', 'js/fps-game.js', 'js/main.js'];

// ---------------------------------------------------------------- helpers per window
function tools(win) {
  const ls = win.localStorage;
  const M = win.__run('Math');
  const rnd = { value: 0.5, calls: 0 };
  M.random = () => { rnd.calls++; return rnd.value; };
  return {
    win, ls, rnd,
    Game: win.__run('Game'), GameScene: win.__run('GameScene'), GameAudio: win.__run('GameAudio'),
    Network: win.__run('Network'), Shop: win.ArcadeShop,
    setSave(obj) { ls.setItem(SAVE_KEY, JSON.stringify(obj)); },
    getSave() { return JSON.parse(ls.getItem(SAVE_KEY) || '{}'); },
    stock(key) { return parseInt(ls.getItem(key), 10) || 0; },
    setStock(key, n) { ls.setItem(key, String(n)); },
    vals() { const o = {}; for (const k of ['tough', 'power', 'regen', 'insight']) o[k] = win.ArcadeShop.abilityValue(k); return o; },
  };
}
const lv = (o) => { const a = {}; for (const k in o) a['buckshot:' + k] = o[k]; return a; };
const ids = (...ks) => ks.map((k) => 'buckshot:' + k);

// ---------------------------------------------------------------- 1. abilities via ArcadeShop.abilityValue
function testAbilityValues(t) {
  section('ability values (abilityValue after setGame)');
  const { Shop } = t;
  t.Shop.setGame('buckshot');
  const same = (name, want) => { const got = t.vals(); check(`${name} ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), got); };

  const ABS = Shop.ABILITIES.filter((a) => a.game === 'buckshot' && !a.secret);
  const steps = {}; ABS.forEach((a) => { steps[a.key] = a.step; });
  check('buckshot abilities are tough/power/regen/insight', JSON.stringify(ABS.map((a) => a.key)) === '["tough","power","regen","insight"]', ABS.map((a) => a.key));
  check('steps 15/10/10/8', JSON.stringify(steps) === '{"tough":15,"power":10,"regen":10,"insight":8}', steps);

  t.ls.removeItem(SAVE_KEY);
  same('no save -> all 0', { tough: 0, power: 0, regen: 0, insight: 0 });

  // level x step, each ability alone, levels 1..5
  for (const a of ABS) {
    for (let L = 1; L <= 5; L++) {
      t.setSave({ abilities: lv({ [a.key]: L }) });
      const want = { tough: 0, power: 0, regen: 0, insight: 0 }; want[a.key] = L * a.step;
      same(`${a.key} lv${L}`, want);
    }
  }
  t.setSave({ abilities: lv({ tough: 9 }) });
  eq('level clamps at 5', Shop.abilityValue('tough'), 75);

  // 3-slot rule
  t.setSave({ abilities: lv({ tough: 1, power: 1, regen: 1, insight: 1 }) });
  same('no active list -> first 3 learned on', { tough: 15, power: 10, regen: 10, insight: 0 });
  t.setSave({ abilities: lv({ tough: 2, regen: 3, insight: 4 }) });
  same('no active list, power unlearned -> tough/regen/insight', { tough: 30, power: 0, regen: 30, insight: 32 });
  t.setSave({ abilities: lv({ tough: 2, power: 1, regen: 3, insight: 4 }), active: { buckshot: ids('insight', 'power') } });
  same('active [insight,power] only', { tough: 0, power: 10, regen: 0, insight: 32 });
  t.setSave({ abilities: lv({ tough: 2, power: 1, regen: 3, insight: 4 }), active: { buckshot: ids('insight', 'regen', 'power', 'tough') } });
  same('active of 4 -> first 3 count', { tough: 0, power: 10, regen: 30, insight: 32 });
  t.setSave({ abilities: lv({ tough: 2, power: 1, regen: 3, insight: 4 }), active: { buckshot: [] } });
  same('active [] -> nothing on', { tough: 0, power: 0, regen: 0, insight: 0 });
  t.setSave({ abilities: lv({ tough: 2 }), active: { buckshot: ids('power', 'tough') } });
  same('unlearned active id ignored', { tough: 30, power: 0, regen: 0, insight: 0 });
  t.setSave({ abilities: { 'monster-city:tough': 5, 'rebuild:power': 5 }, active: { 'monster-city': ['monster-city:tough'] } });
  same('other games\' abilities do not count', { tough: 0, power: 0, regen: 0, insight: 0 });
  t.setSave({ abilities: lv({ tough: 1, power: 1, regen: 1, insight: 1 }) });
  eq('abilityValue for another game is separate', Shop.abilityValue('tough', 'monster-city'), 0);

  // secret agent ability
  const agent = Shop.ABILITIES.find((a) => a.id === 'buckshot:agent');
  check('buckshot:agent exists', !!agent);
  check('agent bonus {insight:25,tough:25,power:15}', agent && JSON.stringify(agent.bonus) === '{"insight":25,"tough":25,"power":15}', agent && agent.bonus);
  t.setSave({ abilities: lv({ agent: 1 }) });
  same('agent alone (auto-on)', { tough: 25, power: 15, regen: 0, insight: 25 });
  t.setSave({ abilities: lv({ agent: 1, tough: 2, insight: 1 }), active: { buckshot: ids('agent', 'tough', 'insight') } });
  same('agent + tough lv2 + insight lv1', { tough: 55, power: 15, regen: 0, insight: 33 });
  t.setSave({ abilities: lv({ tough: 1, power: 1, regen: 1, agent: 1 }) });
  same('agent learned 4th -> off by 3-slot rule', { tough: 15, power: 10, regen: 10, insight: 0 });
  t.setSave({ abilities: lv({ tough: 1, agent: 1 }), active: { buckshot: ids('tough') } });
  same('agent switched off', { tough: 15, power: 0, regen: 0, insight: 0 });

  // Admin Super Mode
  t.setSave({ admin: { super: true } });
  const sup = t.vals();
  eq('super: tough +50', sup.tough, 50);
  eq('super: power +50', sup.power, 50);
  eq('super: insight +50', sup.insight, 50);
  // arcade-shop.js SUPER_BONUS.regen is 3 (sized for monster-city/rebuild, where regen = % HP per 2 s);
  // for Buckshot regen is a % chance, so Super Mode only adds 3% to Second Wind.
  known('super: regen +50 (shop SUPER_BONUS.regen)', sup.regen === 50, sup.regen);
  check('super: regen gets some bonus', sup.regen > 0, sup.regen);
  t.setSave({ admin: { super: true }, abilities: lv({ tough: 1, power: 2, insight: 3 }) });
  const sup2 = t.vals();
  check('super stacks on levels (tough 65, power 70, insight 74)', sup2.tough === 65 && sup2.power === 70 && sup2.insight === 74, sup2);
  t.setSave({ admin: { super: false } });
  same('super off -> 0', { tough: 0, power: 0, regen: 0, insight: 0 });
}

// ---------------------------------------------------------------- 2. ability effects in Game
function stubGame(t) {
  const { Game, GameScene, GameAudio, Network, win } = t;
  const noop = () => {};
  const done = () => Promise.resolve();
  for (const k of Object.keys(GameAudio)) if (typeof GameAudio[k] === 'function') GameAudio[k] = noop;
  Object.assign(GameScene, {
    enableGunPickup: noop, disableInteraction: noop, fireEffect: done, putGunDown: noop,
    opponentHitReaction: done, cameraShake: done, openItemBox: done, closeItemBox: done, placeItems: noop,
  });
  Network.seatIndex = 0;
  Network.sendShoot = noop; Network.sendRoundState = noop;
  win.setTimeout = () => 0; // round/turn timers are not needed here
  t.msgs = [];
  Object.assign(Game, {
    _delay: done, _animateShellLoad: () => new Promise(() => {}), _nextTurn: noop, _checkShellsEmpty: () => false,
    _roundWon: noop, _endGame: noop, _showMessage: (m) => t.msgs.push(m),
  });
}

async function testEffects(t) {
  const { Game } = t;
  const R = t.rnd;
  const lastMsg = () => t.msgs[t.msgs.length - 1] || '';

  section('tough: Lucky Charge (bonus gold charge at round start)');
  const startRound = (mode, r, stock) => {
    Game.mode = mode; Game.round = 1; R.value = r; R.calls = 0; t.msgs.length = 0;
    t.setStock(LIVES_KEY, stock);
    Game._startRound();
    return Game.playerLives;
  };
  t.setSave({ abilities: lv({ tough: 1 }) }); // 15%
  eq('15%, random 0 -> maxLives+1', startRound('offline', 0, 0), 6);
  check('message names Lucky Charge', /Lucky Charge/.test(lastMsg()), lastMsg());
  eq('15%, random 0.999 -> maxLives', startRound('offline', 0.999, 0), 5);
  check('no Lucky message when it misses', !/Lucky/.test(lastMsg()), lastMsg());
  eq('15%, random 0.149 -> fires', startRound('offline', 0.149, 0), 6);
  eq('15%, random 0.15 -> misses', startRound('offline', 0.15, 0), 5);
  eq('dealer unaffected', Game.dealerLives, 5);
  t.setSave({});
  startRound('offline', 0, 0);
  eq('not learned: Math.random untouched', R.calls, 0);
  eq('not learned: no bonus', Game.playerLives, 5);
  t.setSave({ abilities: lv({ tough: 1 }) });
  eq('extra life + tough fire -> still maxLives+1', startRound('offline', 0, 2), 6);
  eq('extra life stock still consumed', t.stock(LIVES_KEY), 1);
  t.setSave({});
  eq('extra life alone -> maxLives+1', startRound('offline', 0, 1), 6);
  eq('extra life alone consumes stock', t.stock(LIVES_KEY), 0);
  t.setSave({ admin: { super: true }, abilities: lv({ tough: 5, agent: 1 }) }); // 150%
  eq('150% tough never above maxLives+1', startRound('offline', 0.999, 3), 6);
  Game.roundCharges = [4, 5, 6]; Game.round = 3; Game.mode = 'offline'; R.value = 0; Game._startRound();
  eq('round 3 (max 6) -> 7', Game.playerLives, 7);
  Game.roundCharges = [5, 5, 5];
  eq('online: no tough even at 150%', startRound('online', 0, 3), 5);
  eq('online: extra life stock untouched', t.stock(LIVES_KEY), 3);
  t.setStock(LIVES_KEY, 0);

  section('power: Hot Shell (+1 damage, live shot at dealer)');
  const shoot = async (mode, r, shell, target, opts = {}) => {
    Object.assign(Game, { mode, shells: [shell], shellIndex: 0, turnActive: true, isPlayerTurn: true, gameOver: false,
      sawedOff: !!opts.saw, maxLives: 5, playerLives: opts.p ?? 5, dealerLives: opts.d ?? 5 });
    R.value = r; R.calls = 0; t.msgs.length = 0;
    await Game.playerShoot(target);
    return { p: Game.playerLives, d: Game.dealerLives, msg: t.msgs.join(' | ') };
  };
  t.setSave({ abilities: lv({ power: 1 }) }); // 10%
  let s = await shoot('offline', 0, 'live', 'opponent');
  eq('10%, random 0 -> dealer 5-2', s.d, 3);
  check('message names Hot Shell', /Hot Shell/.test(s.msg), s.msg);
  eq('10%, random 0.999 -> dealer 5-1', (await shoot('offline', 0.999, 'live', 'opponent')).d, 4);
  eq('with handsaw: 2+1', (await shoot('offline', 0, 'live', 'opponent', { saw: true })).d, 2);
  s = await shoot('offline', 0, 'live', 'self');
  eq('live at self: no bonus (player 5-1)', s.p, 4);
  eq('live at self: Math.random untouched', R.calls, 0);
  eq('blank at dealer: no damage', (await shoot('offline', 0, 'blank', 'opponent')).d, 5);
  eq('online: no Hot Shell', (await shoot('online', 0, 'live', 'opponent')).d, 4);
  t.setSave({});
  await shoot('offline', 0, 'live', 'opponent');
  eq('not learned: Math.random untouched', R.calls, 0);

  section('regen: Second Wind (heal 1 on self-shot blank)');
  t.setSave({ abilities: lv({ regen: 1 }) }); // 10%
  s = await shoot('offline', 0, 'blank', 'self', { p: 3 });
  eq('10%, random 0 -> 3+1', s.p, 4);
  check('message names Second Wind', /Second Wind/.test(s.msg), s.msg);
  eq('10%, random 0.999 -> stays 3', (await shoot('offline', 0.999, 'blank', 'self', { p: 3 })).p, 3);
  eq('capped at maxLives', (await shoot('offline', 0, 'blank', 'self', { p: 5 })).p, 5);
  eq('gold charge (6) not cut back', (await shoot('offline', 0, 'blank', 'self', { p: 6 })).p, 6);
  eq('blank at dealer: no heal', (await shoot('offline', 0, 'blank', 'opponent', { p: 3 })).p, 3);
  eq('online: no heal', (await shoot('online', 0, 'blank', 'self', { p: 3 })).p, 3);
  t.setSave({ abilities: lv({ regen: 5 }) }); // 50%
  eq('50%, random 0.499 -> heals', (await shoot('offline', 0.499, 'blank', 'self', { p: 2 })).p, 3);
  eq('50%, random 0.5 -> no heal', (await shoot('offline', 0.5, 'blank', 'self', { p: 2 })).p, 2);

  section('insight: Sharp Eyes (reveal shell at start of player turn)');
  const turn = (mode, r, isPlayer, idx = 0) => {
    Object.assign(Game, { mode, shells: ['live', 'blank'], shellIndex: idx, isPlayerTurn: isPlayer, gameOver: false, turnActive: false });
    R.value = r; R.calls = 0;
    Game.startTurn();
    return Game.knownShell;
  };
  t.setSave({ abilities: lv({ insight: 1 }) }); // 8%
  eq('8%, random 0 -> sees live', turn('offline', 0, true), 'live');
  eq('8%, random 0 -> sees blank (2nd shell)', turn('offline', 0, true, 1), 'blank');
  eq('8%, random 0.999 -> nothing', turn('offline', 0.999, true), null);
  eq('8%, random 0.079 -> fires', turn('offline', 0.079, true), 'live');
  eq('8%, random 0.08 -> misses', turn('offline', 0.08, true), null);
  eq('dealer turn -> nothing', turn('offline', 0, false), null);
  eq('dealer turn: Math.random untouched', R.calls, 0);
  eq('no shells left -> nothing', turn('offline', 0, true, 2), null);
  eq('online -> nothing', turn('online', 0, true), null);
  t.setSave({});
  eq('not learned -> nothing', turn('offline', 0, true), null);
  eq('not learned: Math.random untouched', R.calls, 0);

  section('online: Super Mode + agent change nothing');
  t.setSave({ admin: { super: true }, abilities: lv({ tough: 5, power: 5, regen: 5, insight: 5, agent: 1 }) });
  Game.mode = 'online';
  check('online: every _abilityChance is 0', ['tough', 'power', 'regen', 'insight'].every((k) => Game._abilityChance(k) === 0));
  Game.mode = 'offline';
  check('offline: chances read live from abilityValue', ['tough', 'power', 'regen', 'insight'].every((k) => Game._abilityChance(k) === t.Shop.abilityValue(k)));
  t.setSave({});
  eq('read live: save cleared -> 0', Game._abilityChance('tough'), 0);
}

// ---------------------------------------------------------------- 3. bonus items / extra lives in rounds
function testBonusItems(t, online) {
  section('bonus items dealt per round');
  const { Game } = t;
  const deal = (mode, round, stock) => {
    Object.assign(Game, { mode, round }); t.setStock(BONUS_KEY, stock); t.rnd.value = 0.3;
    Game._loadNewShells();
    return { p: Game.playerItems.length, d: Game.dealerItems.length, stock: t.stock(BONUS_KEY) };
  };
  let r = deal('offline', 1, 0);
  check('round 1 deals 0 items', r.p === 0 && r.d === 0, r);
  r = deal('offline', 1, 5);
  check('round 1 + stock 5 -> 2 bonus, stock 3', r.p === 2 && r.d === 0 && r.stock === 3, r);
  r = deal('offline', 1, 1);
  check('round 1 + stock 1 -> 1 bonus, stock 0', r.p === 1 && r.stock === 0, r);
  r = deal('offline', 2, 3);
  check('round 2 (2 items) + stock 3 -> 4, stock 1', r.p === 4 && r.d === 2 && r.stock === 1, r);
  r = deal('offline', 3, 5);
  check('round 3 (4 items) + stock 5 -> table full, stock 5', r.p === 4 && r.d === 4 && r.stock === 5, r);
  check('bonus items are real item types', Game.playerItems.every((i) => typeof i === 'string' && i.length > 0), Game.playerItems);
  if (online) {
    r = deal('online', 2, 5);
    check('online: no items, stock untouched', r.p === 0 && r.stock === 5, r);
  }
  t.setStock(BONUS_KEY, 0);
}

// ---------------------------------------------------------------- 4. currencies + shop
function testShop(t) {
  const { win, Shop } = t;
  const doc = win.document;
  section('currencies registered');
  const cur = win.__currencies;
  const bonus = cur.find((c) => c.name === 'Bonus Items');
  const lives = cur.find((c) => c.name === 'Extra Lives');
  eq('two currencies registered', cur.length, 2);
  check('Bonus Items rate 3', bonus && bonus.rate === 3, bonus && bonus.rate);
  check('Extra Lives rate 1', lives && lives.rate === 1, lives && lives.rate);
  t.setStock(BONUS_KEY, 0); t.setStock(LIVES_KEY, 0);
  eq('Bonus Items room() empty = 99', bonus.room(), 99);
  eq('Extra Lives room() empty = 20', lives.room(), 20);
  bonus.grant(30); eq('grant 30 -> stock 30', t.stock(BONUS_KEY), 30);
  eq('room() = 69', bonus.room(), 69);
  bonus.grant(500); eq('grant caps at 99', t.stock(BONUS_KEY), 99);
  lives.grant(7); eq('lives grant 7', t.stock(LIVES_KEY), 7);
  lives.grant(500); eq('lives grant caps at 20', t.stock(LIVES_KEY), 20);
  eq('trade cap is 20/day', Shop.CAPS.tradePerDay, 20);

  section('shop window (this game)');
  t.setStock(BONUS_KEY, 0); t.setStock(LIVES_KEY, 0);
  t.setSave({ coins: 100 });
  const veil = () => doc.querySelector('.as-veil');
  const click = (sel) => { const b = veil().querySelector(sel); if (!b) return false; b.click(); return true; };
  const tabs = () => [...veil().querySelectorAll('[data-tab]')].map((b) => b.dataset.tab);
  const maxBtn = () => { const b = [...veil().querySelectorAll('[data-q]')].pop(); return b ? +b.dataset.q : -1; };
  const tradeAll = () => { const m = maxBtn(); click(`[data-q="${m}"]`); click('[data-trade]'); return m; };

  Shop.open();
  check('shop opened', Shop.isOpen());
  const tl = tabs();
  check('tabs: Bonus Items, Extra Lives, Abilities, skins', tl[0] === '🎁 Bonus Items' && tl[1] === '❤️ Extra Lives' && tl[2] === Shop.ABILITY_TAB && Shop.SKIN_TABS.every((s) => tl.includes(s)), tl);
  check('no Codes tab', !tl.includes(Shop.CODES_TAB) && !tl.some((x) => /code/i.test(x)), tl);
  check('no secret corner', !doc.querySelector('.as-secret, [data-secret]'));
  check('Bonus Items rate shown', /1 play coin = 🎁 3 Bonus Items/.test(veil().textContent));
  Shop.close();
  Shop.open({ tab: Shop.CODES_TAB });
  check('open({tab: Codes}) does not show codes', !doc.querySelector('[data-code], [data-redeem], .as-secret'));
  check('...falls back to first tab', veil().querySelector('[data-tab].on').dataset.tab === '🎁 Bonus Items');

  section('trading + daily cap');
  eq('Bonus Items max = 20 (daily cap)', tradeAll(), 20);
  eq('stock 20 coins x 3 = 60', t.stock(BONUS_KEY), 60);
  let sv = t.getSave();
  eq('coins 100 -> 80', sv.coins, 80);
  eq('save.daily.trade.buckshot = 20', sv.daily && sv.daily.trade && sv.daily.trade.buckshot, 20);
  eq('cap reached: Bonus Items max 0', maxBtn(), 0);
  check('cap message', /Daily trade cap reached/.test(veil().textContent));
  click('[data-tab="❤️ Extra Lives"]');
  eq('cap shared: Extra Lives max 0', maxBtn(), 0);
  click('[data-trade]');
  eq('trade at cap does nothing', t.stock(LIVES_KEY), 0);
  Shop.close();

  // fresh day, room() limits
  const resetDay = (extra) => { const s = t.getSave(); s.daily.trade = {}; Object.assign(s, extra); t.setSave(s); };
  resetDay({ coins: 100 });
  t.setStock(BONUS_KEY, 98);
  Shop.open();
  eq('Bonus stock 98: room 1 < rate 3 -> max 0', maxBtn(), 0);
  Shop.close();
  t.setStock(BONUS_KEY, 90);
  Shop.open();
  eq('Bonus stock 90: room 9 -> max 3', tradeAll(), 3);
  eq('...stock 99', t.stock(BONUS_KEY), 99);
  click('[data-tab="❤️ Extra Lives"]');
  check('Extra Lives rate shown', /1 play coin = ❤️ 1 Extra Lives/.test(veil().textContent));
  t.setStock(LIVES_KEY, 18);
  click('[data-tab="❤️ Extra Lives"]');
  eq('Extra Lives stock 18 -> max 2', tradeAll(), 2);
  eq('...stock 20', t.stock(LIVES_KEY), 20);
  eq('daily.trade.buckshot = 5', t.getSave().daily.trade.buckshot, 5);
  eq('coins 100 -> 95', t.getSave().coins, 95);
  click('[data-tab="❤️ Extra Lives"]');
  eq('Extra Lives full -> max 0', maxBtn(), 0);
  Shop.close();
  resetDay({ coins: 3 });
  t.setStock(LIVES_KEY, 0);
  Shop.open();
  click('[data-tab="❤️ Extra Lives"]');
  eq('wallet limits max (3 coins)', tradeAll(), 3);
  Shop.close();
  t.setStock(BONUS_KEY, 0); t.setStock(LIVES_KEY, 0);
  t.setSave({});

  section('SKINS buttons');
  const start = doc.getElementById('btn-skins');
  const pause = doc.getElementById('btn-pause-skins');
  check('SKINS button on the start menu', start && start.closest('#menu') && !start.classList.contains('hidden'));
  check('SKINS button on the pause menu', pause && pause.closest('#pause-menu') && !pause.classList.contains('hidden'));
  if (start) { start.click(); check('start SKINS opens the shop', Shop.isOpen()); check('...without Codes', !tabs().includes(Shop.CODES_TAB)); Shop.close(); }
  if (pause) { pause.click(); check('pause SKINS opens the shop', Shop.isOpen()); Shop.close(); }
}

// ---------------------------------------------------------------- 5. skins (gun / ability / background)
function testSkins(t) {
  const { win, GameScene: G } = t;
  const AS = win.ArcadeSkins;
  const apply = (s) => win.applyArcadeSkins(s);
  check('applyArcadeSkins defined', typeof win.applyArcadeSkins === 'function');

  // Minimal scene: what GameScene.init builds that the skin code touches (no WebGL in node).
  apply(null);
  G._textures = { gunWood: new THREE.Texture() };
  G.scene = new THREE.Scene();
  G.scene.background = new THREE.Color(0x080810);
  G.scene.fog = new THREE.FogExp2(0x080810, 0.06);
  G._ambientLight = new THREE.AmbientLight(0x1a2233, 0.35);
  G._floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  G.camera = new THREE.PerspectiveCamera();
  G._tableGunMine = false;
  G._buildShotgunOnTable(); G._buildHeldGun();

  section('gun skin');
  const mats = (g) => { const by = {}; g.traverse((o) => { const m = o.material; if (m && m.userData.gunPart) by[m.userData.gunPart] = m; }); return by; };
  const snap = (g) => JSON.stringify(Object.entries(mats(g)).map(([k, m]) => [k, m.color.getHex(), m.emissive && m.emissive.getHex(), m.emissiveIntensity, m.metalness, m.roughness, !!m.map]));
  const origHeld = snap(G.heldGun), origTable = snap(G.shotgunOnTable);
  const flashOrig = G.muzzleFlash.material.color.getHex();
  check('gun parts tagged (metal/darkMetal/wood/darkWood/sight)', ['metal', 'darkMetal', 'wood', 'darkWood', 'sight'].every((k) => mats(G.heldGun)[k]), Object.keys(mats(G.heldGun)));

  apply({ gun: { bullet: '#ff0000', glow: '#00ff00', trail: '#0000ff' } });
  let h = mats(G.heldGun);
  eq('held metal = bullet', h.metal.color.getHex(), 0xff0000);
  eq('held metal emissive = glow', h.metal.emissive.getHex(), 0x00ff00);
  check('held metalness lowered', h.metal.metalness < 0.5, h.metal.metalness);
  eq('sight = glow', h.sight.color.getHex(), 0x00ff00);
  check('darkMetal = darkened bullet', (h.darkMetal.color.getHex() & 0xffff) === 0 && (h.darkMetal.color.getHex() >> 16) > 0, h.darkMetal.color.getHex());
  check('wood texture kept', !!h.wood.map);
  check('wood tinted with trail (blue)', h.wood.color.b > 1, h.wood.color.b);
  eq('muzzle flash = bullet', G.muzzleFlash.material.color.getHex(), 0xff0000);
  check('shot trail created', !!G._skinTrail);
  eq('table gun untouched off-turn', snap(G.shotgunOnTable), origTable);

  G.enableGunPickup();
  eq('player turn: table gun skinned', mats(G.shotgunOnTable).metal.color.getHex(), 0xff0000);
  G.disableInteraction();
  eq('dealer turn: table gun restored', snap(G.shotgunOnTable), origTable);
  G.enableGunPickup();

  apply({ gun: { bullet: '#ffff00', glow: '#00ffff', trail: '#ff00ff' } });
  eq('live re-apply: held', mats(G.heldGun).metal.color.getHex(), 0xffff00);
  eq('live re-apply on player turn: table', mats(G.shotgunOnTable).metal.color.getHex(), 0xffff00);
  apply({ gun: { glow: '#123456' } });
  eq('partial skin: body falls back to glow', mats(G.heldGun).metal.color.getHex(), 0x123456);
  check('no trail field -> no trail line', G._skinTrail === null);

  apply({ gun: { rainbow: true } });
  G.heldGun.visible = true;
  const c0 = mats(G.heldGun).metal.color.getHex();
  const realNow = win.performance.now.bind(win.performance);
  const realDate = win.Date.now;
  Object.defineProperty(win.performance, 'now', { configurable: true, value: () => realNow() + 1000 });
  win.Date.now = () => realDate() + 1000;
  G._tickGunSkin();
  const c1 = mats(G.heldGun).metal.color.getHex();
  check('rainbow animates via render-loop tick', c0 !== c1, [c0, c1]);
  delete win.performance.now;
  win.Date.now = realDate;

  apply(null);
  eq('null restores held gun', snap(G.heldGun), origHeld);
  eq('null restores table gun', snap(G.shotgunOnTable), origTable);
  eq('null restores muzzle flash', G.muzzleFlash.material.color.getHex(), flashOrig);
  check('null removes trail', G._skinTrail === null);
  G._tickGunSkin();
  eq('tick with no skin changes nothing', snap(G.heldGun), origHeld);
  G.disableInteraction();

  section('background skin');
  apply({ bg: { sky: '#112233', fog: '#445566', ground: '#778899', light: '#aabbcc' } });
  eq('sky', G.scene.background.getHex(), 0x112233);
  eq('fog', G.scene.fog.color.getHex(), 0x445566);
  eq('light', G._ambientLight.color.getHex(), 0xaabbcc);
  const want = new THREE.Color(0x778899).lerp(new THREE.Color(0xffffff), 0.35).getHex();
  eq('ground = tint lerped to white', G._floorMat.color.getHex(), want);
  apply(null);
  eq('null: sky restored', G.scene.background.getHex(), 0x080810);
  eq('null: fog restored', G.scene.fog.color.getHex(), 0x080810);
  eq('null: light restored', G._ambientLight.color.getHex(), 0x1a2233);
  eq('null: ground restored', G._floorMat.color.getHex(), 0xffffff);

  section('ability skin');
  G.itemMeshes = { player: [{ position: { x: 0.3, z: 0.4 } }], dealer: [] };
  G._abilityFx = null;
  G.playerItemBurst(0);
  check('no ability skin -> no burst', !G._abilityFx);
  apply({ ability: { primary: '#ff00ff', secondary: '#00ffff' } });
  check('ArcadeSkins has ability', AS.has('ability'));
  G.playerItemBurst(0);
  const fx = G._abilityFx;
  check('burst created + visible', fx && fx.group.visible);
  if (fx) {
    eq('orb = primary', fx.orb.material.color.getHex(), 0xff00ff);
    eq('ring = secondary', fx.ring.material.color.getHex(), 0x00ffff);
    check('burst at the used item', fx.group.position.x === 0.3 && fx.group.position.z === 0.4);
  }
  apply({ ability: { primary: '#00ff00', secondary: '#0000ff' } });
  G.playerItemBurst(0);
  eq('live re-apply: orb', fx && fx.orb.material.color.getHex(), 0x00ff00);
  apply(null);
  if (fx) fx.group.visible = false;
  G.playerItemBurst(0);
  check('null: no burst', !fx || !fx.group.visible);
  check('Game.useItem calls playerItemBurst', /GameScene\.playerItemBurst\(index\)/.test(t.Game.useItem.toString()));
  G.itemMeshes = null;
  // Leave GameScene.scene null so later tests don't re-apply into this fake scene.
  G.scene = null;
}

// ---------------------------------------------------------------- 6. copies kept in step
function extractMethod(src, obj, name) {
  const start = src.indexOf(`const ${obj} = {`);
  const re = new RegExp(`\\n  (\\/\\*\\*[^\\n]*\\*\\/\\n  )?${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\},?\\n`);
  const m = re.exec(src.slice(start));
  return m ? m[0].replace(/,\n$/, '\n').trim() : null;
}
function testInStep() {
  label = 'in-step';
  section('arcade code in index.html matches public/js copies');
  const js = { Game: read('js/buckshot.js'), GameScene: read('js/buckshot-scene.js') };
  const list = {
    Game: ['_abilityChance', '_abilityRoll', '_useExtraLife', '_addBonusItems', 'useItem'],
    GameScene: ['_buildHeldGun', '_applyGunSkin', '_gunSkinField', '_skinShotgun', '_paintShotgun', '_tickGunSkin', '_setTableGunOwner', '_applyBgSkin', 'playerItemBurst', 'enableGunPickup', 'disableInteraction'],
  };
  for (const obj in list) {
    for (const name of list[obj]) {
      const a = extractMethod(HTML, obj, name), b = extractMethod(js[obj], obj, name);
      check(`${obj}.${name} identical`, a && b && a === b, a && b ? 'differs' : 'not found');
    }
  }
  // Every ability/arcade line inside Game (startRound/startTurn/playerShoot differ elsewhere for online).
  const arcadeLines = (s) => {
    const at = s.indexOf('const Game = {');
    const g = s.slice(at, s.indexOf('\n};', at));
    return g.split('\n').filter((l) => /⚡|_abilityRoll|_useExtraLife\(\)|_addBonusItems\(\)|Lucky Charge|Hot Shell|Second Wind|Sharp Eyes|knownShell = this\.shells|insight|maxItemsPerRound/.test(l)).map((l) => l.trim());
  };
  const al = arcadeLines(HTML), bl = arcadeLines(read('js/buckshot.js'));
  check(`Game arcade lines identical (${al.length})`, al.length > 10 && JSON.stringify(al) === JSON.stringify(bl), al.filter((l) => !bl.includes(l)));
  const keysIn = (s) => /const BONUS_ITEMS_KEY = '([^']+)'/.exec(s)[1] + '|' + /const EXTRA_LIVES_KEY = '([^']+)'/.exec(s)[1];
  eq('stock keys', keysIn(read('js/buckshot.js')), keysIn(HTML));
  check('stock key names', keysIn(HTML) === `${BONUS_KEY}|${LIVES_KEY}`);
  const wire = (s) => s.slice(s.indexOf('window.applyArcadeSkins = function'), s.indexOf("['btn-skins', 'btn-pause-skins']"));
  check('main.js arcade wiring identical', wire(HTML).replace(/\s+/g, ' ') === wire(read('js/main.js')).replace(/\s+/g, ' '));
}

// ---------------------------------------------------------------- main
async function runEnv(name, scripts, opts) {
  label = name;
  console.log(`\n== ${name} ==`);
  const envErrors = [];
  const win = makeWindow(scripts, envErrors);
  check('page scripts load without errors', envErrors.length === 0, envErrors.slice(0, 3));
  if (!win.ArcadeShop || !win.ArcadeSkins) { check('ArcadeShop + ArcadeSkins loaded', false); return; }
  const t = tools(win);
  check('Game defined', !!t.Game && typeof t.Game._abilityRoll === 'function');
  win.localStorage.clear();
  testAbilityValues(t);
  testSkins(t);      // uses the real GameScene, before the Game tests stub it
  testShop(t);
  stubGame(t);
  await testEffects(t);
  testBonusItems(t, opts.online);
  check('no runtime errors during tests', envErrors.length === 0, envErrors.slice(0, 3));
  win.close();
}

(async () => {
  try {
    await runEnv('inline index.html', inlineScripts(), { online: true });
    // js/buckshot.js predates the online round-state code, so online item dealing is inline-only.
    await runEnv('js copies', JS_FILES.map((f) => [f, read(f)]), { online: false });
    testInStep();
  } catch (e) {
    failures.push(`[${label}] crashed: ${e.stack || e}`);
    console.log('  CRASH ' + (e.stack || e));
  }
  console.log(`\n${passed} checks passed, ${failures.length} failed, ${warnings.length} known issue(s)`);
  warnings.forEach((w) => console.log('  ~ ' + w));
  if (failures.length) failures.forEach((f) => console.log('  - ' + f));
  console.log(failures.length ? `ARCADE TEST FAIL (${failures.length})` : 'ARCADE TEST PASS');
  process.exit(failures.length ? 1 : 0);
})();
