// ============================================================
// arcade-skins.js -- Cosmetic skins from Daniel's Arcade hub
//
// Reads skins from the `arcadeSkins` URL query param (JSON,
// URI-encoded) or, as a fallback, localStorage key
// "daniels-arcade-skins". Shape:
//   { gun:     { bullet, glow, trail, rainbow },
//     ability: { primary, secondary, rainbow },
//     bg:      { sky, fog, ground, light } }
// Any slot/field may be missing -> the game's original colors.
// Purely cosmetic: never touches game rules or networking.
// ============================================================

(function () {
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var FIELDS = {
    gun: ['bullet', 'glow', 'trail'],
    ability: ['primary', 'secondary'],
    bg: ['sky', 'fog', 'ground', 'light']
  };
  // Hue offsets so rainbow fields are not all the same color
  var HUE_OFFSET = { bullet: 0, glow: 0.33, trail: 0.66, primary: 0, secondary: 0.5 };

  function parse(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch (e) {}
    try { return JSON.parse(decodeURIComponent(str)); } catch (e) {}
    return null;
  }

  // Sanitize: keep only valid #rrggbb colors
  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') obj = {};
    var out = { gun: null, ability: null, bg: null };
    Object.keys(FIELDS).forEach(function (slot) {
      var s = obj[slot];
      if (!s || typeof s !== 'object') return;
      var clean = { id: s.id || null, name: s.name || null, rainbow: s.rainbow === true };
      var any = clean.rainbow;
      FIELDS[slot].forEach(function (k) {
        if (typeof s[k] === 'string' && HEX_RE.test(s[k])) { clean[k] = s[k].toLowerCase(); any = true; }
      });
      if (any) out[slot] = clean;
    });
    return out;
  }

  function read() {
    var obj = null;
    try {
      var p = new URLSearchParams(window.location.search).get('arcadeSkins');
      obj = parse(p);
    } catch (e) {}
    if (!obj || typeof obj !== 'object') {
      try { obj = parse(window.localStorage.getItem('daniels-arcade-skins')); } catch (e) { obj = null; }
    }
    return sanitize(obj);
  }

  var skins = read();
  window.ARCADE_SKINS = skins;

  function hslToHex(h, s, l) {
    h = ((h % 1) + 1) % 1;
    function f(n) {
      var k = (n + h * 12) % 12;
      var a = s * Math.min(l, 1 - l);
      var c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255);
    }
    return (f(0) << 16) | (f(8) << 8) | f(4);
  }

  function isRainbow(slot) {
    return !!(skins[slot] && skins[slot].rainbow && slot !== 'bg');
  }

  /** Does the skin define this field (or is it a rainbow slot)? */
  function has(slot, key) {
    var s = skins[slot];
    if (!s) return false;
    if (!key) return true;
    return isRainbow(slot) || !!s[key];
  }

  /** Current color as a number (0xrrggbb), rainbow-aware. */
  function hex(slot, key, fallback) {
    var s = skins[slot];
    if (!s) return fallback;
    if (isRainbow(slot)) {
      var t = performance.now() * 0.00025; // one full cycle every 4 seconds
      return hslToHex(t + (HUE_OFFSET[key] || 0), 1, 0.55);
    }
    if (s[key]) return parseInt(s[key].slice(1), 16);
    return fallback;
  }

  function css(slot, key, fallback) {
    var n = hex(slot, key, null);
    if (n === null || n === undefined) return fallback;
    return '#' + ('000000' + n.toString(16)).slice(-6);
  }

  // Colors that must keep cycling in rainbow mode. Keyed by tag so
  // re-initialising a scene replaces entries instead of piling up.
  var live = {};

  /**
   * Paint a THREE.Color (e.g. material.color / material.emissive)
   * from a skin field. Returns true if a skin was applied.
   * `tag` identifies the entry for per-frame rainbow updates.
   */
  function paint(color, slot, key, tag) {
    if (!color || !has(slot, key)) return false;
    color.setHex(hex(slot, key, 0xffffff));
    if (isRainbow(slot) && tag) live[tag] = { color: color, slot: slot, key: key };
    return true;
  }

  /** Called from render loops; only does work in rainbow mode. */
  function tick() {
    for (var tag in live) {
      var e = live[tag];
      e.color.setHex(hex(e.slot, e.key, 0xffffff));
    }
  }

  /**
   * Like paint(), but re-runnable: drops the old rainbow entry for `tag`
   * and, when the slot/field has no skin, restores `fallback` (0xrrggbb).
   */
  function repaint(color, slot, key, tag, fallback) {
    if (tag) delete live[tag];
    if (paint(color, slot, key, tag)) return true;
    if (color && typeof fallback === 'number') color.setHex(fallback);
    return false;
  }

  // ── Ability skin for the 2D item buttons (CSS) ──────────────
  // Re-runnable: one <style> element, one rainbow timer.
  var itemStyle = null, itemTimer = null;
  function applyItemCss() {
    var root = document.documentElement;
    if (itemTimer) { clearInterval(itemTimer); itemTimer = null; }
    if (!skins.ability) {
      if (itemStyle && itemStyle.parentNode) itemStyle.parentNode.removeChild(itemStyle);
      itemStyle = null;
      root.style.removeProperty('--arcade-ability-primary');
      root.style.removeProperty('--arcade-ability-secondary');
      return;
    }
    function setVars() {
      root.style.setProperty('--arcade-ability-primary', css('ability', 'primary', '#cc2222'));
      root.style.setProperty('--arcade-ability-secondary', css('ability', 'secondary', '#cc2222'));
    }
    setVars();
    if (!itemStyle) {
      itemStyle = document.createElement('style');
      itemStyle.textContent =
        '.item{border-color:var(--arcade-ability-primary)!important;' +
        'box-shadow:0 0 6px var(--arcade-ability-secondary);}' +
        '.item:hover{border-color:var(--arcade-ability-secondary)!important;' +
        'box-shadow:0 0 14px var(--arcade-ability-primary);}';
      (document.head || root).appendChild(itemStyle);
    }
    if (isRainbow('ability')) itemTimer = setInterval(setVars, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyItemCss);
  else applyItemCss();

  /**
   * Replace the skins at runtime (e.g. from the in-game shop). Uses the
   * same validation as the initial read. Clears all rainbow entries, so
   * callers should re-apply their scene skins afterwards.
   */
  function set(obj) {
    skins = sanitize(obj);
    live = {};
    window.ARCADE_SKINS = skins;
    api.skins = skins;
    applyItemCss();
    // The shop saved the new skins to localStorage; drop a stale
    // ?arcadeSkins= param so a reload doesn't bring the old ones back.
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.has('arcadeSkins')) {
        url.searchParams.delete('arcadeSkins');
        window.history.replaceState(window.history.state, '', url.toString());
      }
    } catch (e) {}
    return skins;
  }

  var api = window.ArcadeSkins = {
    skins: skins,
    set: set,
    repaint: repaint,
    has: has,
    isRainbow: isRainbow,
    hex: hex,
    css: css,
    paint: paint,
    tick: tick
  };
})();
