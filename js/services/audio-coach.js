// Voice Coach, beeps and haptics — designed to coexist with Spotify (or any music app).
//
// Principles:
//  • Stride never plays media elements, never registers Media Session handlers and never
//    requests an exclusive ("playback") audio session, so it cannot take over the music app.
//  • Where the Audio Session API exists (Safari 16.4+), the page is set to "ambient" (mix with
//    other audio). Ducking ("transient") and pausing ("transient-solo") are applied only for the
//    duration of an announcement and only if the user enables them; support is experimental.
//  • Announcements go through a priority queue: never two at once, urgent messages first,
//    and stale messages are dropped instead of being read out late.

import { prefs } from '../core/storage.js';

let ctx = null;
let ctxIdleTimer = null;
let primed = false;
let voice = null;

const hasWindow = typeof window !== 'undefined';
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);

function pickVoice() {
  if (!hasWindow || !('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en/i.test(v.lang));
  return en.find((v) => /samantha|daniel|google us|karen|serena|aria|jenny/i.test(v.name)) || en.find((v) => v.localService) || en[0] || voices[0] || null;
}
if (hasWindow && 'speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };

// ---------------------------------------------------------------- capabilities
export function audioCapabilities() {
  const speech = hasWindow && 'speechSynthesis' in window;
  const session = typeof navigator !== 'undefined' && 'audioSession' in navigator;
  const standalone = hasWindow && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  return {
    speech, session, webAudio: hasWindow && !!(window.AudioContext || window.webkitAudioContext),
    vibrate: typeof navigator !== 'undefined' && 'vibrate' in navigator,
    platform: isIOS ? 'ios' : isAndroid ? 'android' : 'other', standalone,
    // What each music mode can actually do on this device
    over: speech ? 'yes' : 'no',
    duck: session ? 'experimental' : isAndroid && speech ? 'system' : 'no',
    pause: session ? 'experimental' : 'no',
  };
}

// ---------------------------------------------------------------- audio session (mixing policy)
let currentSession = null;
export function setSessionType(type) {
  try {
    if (!('audioSession' in navigator)) return false;
    if (currentSession === type) return true;
    navigator.audioSession.type = type;
    currentSession = type;
    return true;
  } catch { return false; }
}
/** Default: mix with other apps. Called at boot and after every announcement. */
export function applyBaseSession() {
  const p = prefs.get();
  if (p.spotifyCompat !== false) setSessionType('ambient');
  else setSessionType('auto');
}
function sessionForAnnouncement() {
  const p = prefs.get();
  const caps = audioCapabilities();
  if (p.musicMode === 'duck' && caps.duck === 'experimental') return 'transient';
  if (p.musicMode === 'pause' && caps.pause === 'experimental') return 'transient-solo';
  return null; // "over music" (or unsupported) — keep ambient
}

// ---------------------------------------------------------------- announcement queue
const CAT_PREF = { transitions: 'voiceTransitions', cues: 'voiceCues', pace: 'voicePace', motivation: 'voiceMotivation' };
const state = { speaking: null, pending: [], token: 0, guard: null, log: [] };

function categoryEnabled(cat) {
  if (!cat || cat === 'safety') return true;
  const k = CAT_PREF[cat];
  return k ? prefs.get()[k] !== false : true;
}

function finishCurrent(tok) {
  if (tok !== state.token) return;
  clearTimeout(state.guard);
  state.speaking = null;
  // drop anything that has gone stale while we were talking
  const now = Date.now();
  state.pending = state.pending.filter((i) => now - i.at <= i.ttl);
  const next = state.pending.shift();
  if (next) speakNow(next);
  else setTimeout(() => { if (!state.speaking) applyBaseSession(); }, 300); // restore music volume / resume
}

function speakNow(item) {
  const p = prefs.get();
  const tok = ++state.token;
  state.speaking = item;
  state.log.push({ text: item.text, prio: item.prio, cat: item.cat, at: Date.now() });
  if (state.log.length > 50) state.log.shift();
  const sess = sessionForAnnouncement();
  if (sess) setSessionType(sess);
  try {
    // the browser's own queue must be empty so nothing is ever read late or on top of this
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(item.text);
    if (voice) u.voice = voice;
    u.rate = p.voiceRate || 1; u.volume = p.volume ?? 0.9; u.pitch = 1;
    u.onend = () => finishCurrent(tok);
    u.onerror = () => finishCurrent(tok);
    speechSynthesis.speak(u);
  } catch { finishCurrent(tok); return; }
  // Some mobile browsers never fire onend — assume it finished after a generous estimate.
  state.guard = setTimeout(() => finishCurrent(tok), 2500 + item.text.length * 90 / (p.voiceRate || 1));
}

export const audio = {
  get speechSupported() { return hasWindow && 'speechSynthesis' in window; },
  get vibrateSupported() { return typeof navigator !== 'undefined' && 'vibrate' in navigator; },
  get isSpeaking() { return !!state.speaking; },
  get log() { return state.log; },

  /**
   * Must be called from a user gesture (iOS requires it before speech/audio can play).
   * Uses an ambient session so it never interrupts music that is already playing.
   */
  unlock() {
    applyBaseSession();
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      scheduleCtxIdle();
    } catch { /* no web audio */ }
    if (this.speechSupported && !primed && prefs.get().voice) {
      // prime speech inside the gesture with a silent, empty utterance
      try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
      voice = pickVoice();
      primed = true;
    }
  },

  /**
   * Queue an announcement.
   * opts.cat: 'transitions' | 'cues' | 'pace' | 'motivation' | 'safety'
   * opts.prio: 4 safety · 3 interval transitions · 2 corrections & key cues · 1 updates · 0 motivation
   */
  say(text, { cat = 'cues', prio = 2, force = false, ttl } = {}) {
    const p = prefs.get();
    if (!text || !text.trim()) return false;
    if (!force && (!p.voice || !categoryEnabled(cat))) return false;
    if (!this.speechSupported) return false;
    const item = { text: text.replace(/\s+/g, ' ').trim(), cat, prio, at: Date.now(), ttl: ttl ?? (prio >= 3 ? 15000 : prio === 0 ? 4000 : 8000) };
    if (!state.speaking) { speakNow(item); return true; }
    if (item.prio > state.speaking.prio) {
      // a more important message interrupts (e.g. a new interval starting over a pace update)
      state.token++; clearTimeout(state.guard);
      try { speechSynthesis.cancel(); } catch { /* ignore */ }
      state.speaking = null;
      speakNow(item);
      return true;
    }
    if (item.prio === 0) return false; // motivation is skipped when the coach is busy
    state.pending = state.pending.filter((i) => i.cat !== item.cat || i.prio > item.prio); // newest of a kind wins
    state.pending.push(item);
    state.pending.sort((a, b) => b.prio - a.prio || a.at - b.at);
    if (state.pending.length > 3) state.pending.length = 3;
    return true;
  },

  /** Stop speaking immediately and drop anything queued (used when pausing/discarding). Never touches other apps' audio. */
  stop() {
    state.pending = [];
    state.token++;
    clearTimeout(state.guard);
    state.speaking = null;
    try { if (this.speechSupported) speechSynthesis.cancel(); } catch { /* ignore */ }
    applyBaseSession();
  },

  beep({ freq = 880, dur = 0.15, times = 1, gap = 0.12, force = false } = {}) {
    const p = prefs.get();
    if (!force && !p.beeps) return;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      for (let i = 0; i < times; i++) {
        const t0 = ctx.currentTime + i * (dur + gap);
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime((p.volume ?? 0.9) * 0.6, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
      }
      scheduleCtxIdle((times * (dur + gap)) * 1000);
    } catch { /* ignore */ }
  },

  vibrate(pattern = [200]) {
    if (!prefs.get().vibration || !this.vibrateSupported) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  },

  /** Release Web Audio so the page holds no active audio stream between cues. */
  release() { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch { /* ignore */ } },
  get contextState() { return ctx ? ctx.state : 'none'; },
};

function scheduleCtxIdle(extraMs = 0) {
  clearTimeout(ctxIdleTimer);
  ctxIdleTimer = setTimeout(() => audio.release(), 1500 + extraMs);
}

// ---- Screen wake lock (keeps the display on during workouts where supported) ----
let wakeLock = null;
export const wake = {
  supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  async acquire() {
    if (!this.supported || !prefs.get().keepAwake) return false;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    } catch { return false; }
  },
  async release() { try { await wakeLock?.release(); } catch { /* ignore */ } wakeLock = null; },
  get active() { return !!wakeLock; },
};

// ---- Local notifications (used when the page is hidden during a workout) ----
export const notify = {
  supported: typeof window !== 'undefined' && 'Notification' in window,
  async request() {
    if (!this.supported) return 'unsupported';
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  },
  get permission() { return this.supported ? Notification.permission : 'unsupported'; },
  async show(title, body) {
    if (!this.supported || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      // silent: a notification must never start a sound that could interrupt music
      if (reg) reg.showNotification(title, { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: 'stride-workout', renotify: true, silent: true });
      else new Notification(title, { body, silent: true });
    } catch { /* ignore */ }
  },
};
