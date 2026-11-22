// Voice cues (speech synthesis), beeps (Web Audio) and vibration, with graceful fallbacks.

import { prefs } from '../core/storage.js';

let ctx = null;
let unlocked = false;
let voice = null;

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en/i.test(v.lang));
  return en.find((v) => /samantha|daniel|google us|karen|serena|aria|jenny/i.test(v.name)) || en.find((v) => v.localService) || en[0] || voices[0] || null;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
}

export const audio = {
  speechSupported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  vibrateSupported: typeof navigator !== 'undefined' && 'vibrate' in navigator,

  /** Must be called from a user gesture (iOS requires it before audio can play). */
  unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.02);
    } catch { /* no web audio */ }
    if (this.speechSupported && !unlocked) {
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
      voice = pickVoice();
    }
    unlocked = true;
  },

  say(text, { force = false } = {}) {
    const p = prefs.get();
    if (!force && !p.voice) return;
    if (!this.speechSupported) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = p.voiceRate || 1; u.volume = p.volume ?? 0.9; u.pitch = 1;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  },

  vibrate(pattern = [200]) {
    if (!prefs.get().vibration || !this.vibrateSupported) return;
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  },
};

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
      if (reg) reg.showNotification(title, { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: 'stride-workout', renotify: true, silent: false });
      else new Notification(title, { body });
    } catch { /* ignore */ }
  },
};
