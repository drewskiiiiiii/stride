// Lightweight preferences in localStorage (synchronous, available before IndexedDB opens).

const KEY = 'stride.prefs';
const SESSION_KEY = 'stride.activeSession';

export const DEFAULT_PREFS = {
  distance: 'mi', pace: 'mi', hr: 'bpm', theme: 'dark',
  voice: true, beeps: true, vibration: true, countdown: true, halfway: true, paceAlerts: true,
  voiceRate: 1, volume: 0.9, keepAwake: true, stepNotifications: false, reminderTime: '06:30',
  cueLevel: 'standard', updateEvery: 0, startCountdown: 10, distanceCues: true, lastBackupAt: null,
};

let cache = null;

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

export const prefs = {
  get() {
    if (!cache) {
      try { cache = { ...DEFAULT_PREFS, ...(JSON.parse(safeGet(KEY) || '{}')) }; } catch { cache = { ...DEFAULT_PREFS }; }
    }
    return cache;
  },
  set(patch) {
    cache = { ...prefs.get(), ...patch };
    safeSet(KEY, JSON.stringify(cache));
    prefs.onChange && prefs.onChange(cache);
    return cache;
  },
  onChange: null,
  replace(all) { cache = { ...DEFAULT_PREFS, ...all }; safeSet(KEY, JSON.stringify(cache)); },
  reset() { cache = { ...DEFAULT_PREFS }; safeDel(KEY); },
};

// The active workout is mirrored synchronously to localStorage on every tick so that a
// crash, reload or device restart can restore it exactly.
export const sessionStore = {
  save(s) { s.lastSaved = Date.now(); return safeSet(SESSION_KEY, JSON.stringify(s)); },
  load() { try { return JSON.parse(safeGet(SESSION_KEY) || 'null'); } catch { return null; } },
  clear() { safeDel(SESSION_KEY); },
};
