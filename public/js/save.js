// ============================================================
// save.js -- Auto-save system using localStorage
// Periodically snapshots game state so players can resume
// after closing the browser. Saves expire after 1 hour.
// ============================================================

const SaveSystem = {
  SAVE_KEY: 'fps_arena_save',
  INTERVAL: 4000,  // auto-save every 4 seconds
  timer: null,

  start(getStateFn) {
    this.stop();
    this.timer = setInterval(() => {
      const state = getStateFn();
      if (state) {
        localStorage.setItem(this.SAVE_KEY, JSON.stringify({
          ...state,
          timestamp: Date.now()
        }));
      }
    }, this.INTERVAL);
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  save(state) {
    localStorage.setItem(this.SAVE_KEY, JSON.stringify({
      ...state,
      timestamp: Date.now()
    }));
  },

  load() {
    const data = localStorage.getItem(this.SAVE_KEY);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      // Only restore saves less than 1 hour old
      if (Date.now() - parsed.timestamp > 3600000) {
        this.clear();
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  },

  clear() {
    localStorage.removeItem(this.SAVE_KEY);
  },

  hasSave() {
    return !!this.load();
  }
};
