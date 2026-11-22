// Live workout mode: ready screen, guided execution, summary, activity details and crash recovery.

import { esc, icon, toast, confirmDialog, openSheet, closeAllSheets } from './dom.js';
import { store } from '../core/store.js';
import { prefs, sessionStore } from '../core/storage.js';
import { todayISO, fmtLongDate, fmtDate } from '../core/dates.js';
import { fmtDist, fmtDuration, fmtPace, fmtPaceRange, toDisplayDist, distLabel, paceLabel, fromDisplayDist, M_PER_MI } from '../core/units.js';
import * as WS from '../services/workout-session.js';
import { gps } from '../services/gps.js';
import { audio, wake, notify } from '../services/audio-coach.js';
import { zoneColorKey, stepTarget, typeLabel, speedUnit } from './format.js';
import { fmtSpeed, fmtSpeedRange, speedLabel, speedWords, speedStatus, speedToPace, SPEED_LIMITS, roundSpeed } from '../engine/treadmill.js';
import { ZONE_INFO } from '../engine/vdot.js';
import { isRun } from '../engine/workout-utils.js';
import { offerVdotUpdate } from './actions.js';
import { showEvaluation } from './coach.js';

let S = null;          // active session
let root = null;       // overlay element
let loop = null;
let lastPersist = 0;
let lastPaceAlert = 0;
let onExit = null;

const now = () => Date.now();

function persist(force = false) {
  if (!S) return;
  if (force || now() - lastPersist > 1000) { sessionStore.save(S); lastPersist = now(); }
}

function applyCuePrefs(s) {
  const p = prefs.get();
  const periodic = s.mode === 'treadmill' ? p.tmPeriodic : p.cueLevel === 'detailed';
  s.updateEverySec = periodic && !s.supp ? (p.updateEvery || 5) * 60 : 0;
}

// ---------------------------------------------------------------- treadmill helpers
const TM = () => S && S.mode === 'treadmill' && S.tm;
function setSpeed(v, { silent = false } = {}) {
  if (!TM()) return;
  const lim = SPEED_LIMITS[S.tm.unit];
  v = Math.max(0, Math.min(lim.max + 2, roundSpeed(v)));
  handle(WS.setTreadmillSpeed(S, now(), v));
  if (!silent) S.tm.compareFor = null; // schedule a spoken comparison after the user settles
  persist(true); update();
}
function speedPanel() {
  return `<div class="tm-panel" data-u="tmpanel">
    <button class="tm-step" data-tm="-">−</button>
    <button class="tm-val" data-tm="edit"><span class="tl">Your treadmill speed</span><span class="v num" data-u="tmsel">—</span><span class="tl" data-u="tmunit">${speedLabel(S.tm.unit)}</span></button>
    <button class="tm-step" data-tm="+">+</button>
  </div>
  <div class="tm-actions"><button data-tm="match" data-u="tmmatch">Set to target</button><button data-tm="view" data-u="tmview">${prefs.get().tmDisplay === 'pace' ? 'Show speed' : 'Show pace'}</button></div>`;
}
function bindSpeedPanel(scope) {
  scope.querySelectorAll('[data-tm]').forEach((b) => b.onclick = () => {
    const k = b.dataset.tm;
    const cur = S.tm.selected ?? (WS.currentStep(S)?.speed?.target || 0);
    if (k === '+') setSpeed(cur + 0.1);
    if (k === '-') setSpeed(Math.max(0, cur - 0.1));
    if (k === 'match') { const st = WS.currentStep(S); if (st?.speed) setSpeed(st.speed.target); }
    if (k === 'view') { prefs.set({ tmDisplay: prefs.get().tmDisplay === 'pace' ? 'speed' : 'pace' }); b.textContent = prefs.get().tmDisplay === 'pace' ? 'Show speed' : 'Show pace'; update(); }
    if (k === 'edit') {
      const v = prompt(`Enter the speed shown on your treadmill (${speedLabel(S.tm.unit)})`, fmtSpeed(cur));
      if (v != null && v.trim() !== '' && !isNaN(Number(v))) setSpeed(Number(v));
    }
  });
}
function speedSay(v) { return `${fmtSpeed(v)} ${speedWords(S.tm.unit)}`; }
const stepNoun = (st) => ({ warmup: 'your warm-up', cooldown: 'your cool-down', recover: 'recovery', walk: 'this walk', steady: 'this run' }[st.kind] || (st.zone === 'tempo' || st.zone === 'threshold' ? 'this tempo interval' : st.zone === 'hill' ? 'this hill repeat' : 'this interval'));
function tmInstruction(st, { first = false } = {}) {
  if (!st?.speed) return '';
  const tgt = st.speed.target, sel = S.tm.selected;
  const incl = st.speed.incline >= 5 ? ` and set the incline to ${st.speed.incline} percent` : '';
  if (first || sel == null) return st.kind === 'warmup' ? `Your warm-up pace is ${speedSay(tgt)}.` : `Target speed is ${speedSay(tgt)}${incl}.`;
  if (tgt > sel + 0.05) return `Increase the treadmill to ${speedSay(tgt)} for ${stepNoun(st)}${incl}.`;
  if (tgt < sel - 0.05) return `Reduce your speed to ${speedSay(tgt)} for ${stepNoun(st)}${incl}.`;
  return `Hold ${speedSay(tgt)}${incl}.`;
}
function remainingWorkoutDistance(t) {
  let d = 0;
  const st = WS.currentStep(S);
  if (!st) return 0;
  const selMps = S.tm.selected ? (S.tm.selected * (S.tm.unit === 'mph' ? M_PER_MI : 1000)) / 3600 : 0;
  if (st.measure === 'distance') d += Math.max(0, st.value - WS.stepDistance(S));
  else if (st.measure === 'time') d += Math.max(0, st.value - WS.stepElapsedMs(S, t) / 1000) * (selMps || 0);
  for (let i = S.stepIndex + 1; i < S.steps.length; i++) {
    const x = S.steps[i];
    if (x.measure === 'distance') d += x.value;
    else if (x.measure === 'time' && x.speed) d += x.value * (x.speed.target * (S.tm.unit === 'mph' ? M_PER_MI : 1000)) / 3600;
  }
  return d;
}
let lastTap = 0;
const debounced = (fn) => () => { const t = now(); if (t - lastTap < 650) return; lastTap = t; fn(); };

// ---------------------------------------------------------------- entry points
export function startLive(workoutId, exitCb) {
  const existing = sessionStore.load();
  if (existing && existing.status !== 'finished' && existing.workoutId !== workoutId) {
    confirmDialog({ title: 'Another workout is in progress', body: `“${esc(existing.title)}” is still active. Discard it and start this one?`, confirm: 'Discard & start', danger: true }).then((ok) => {
      if (ok) { sessionStore.clear(); startLive(workoutId, exitCb); }
    });
    return;
  }
  if (existing && existing.workoutId === workoutId && existing.status !== 'finished') { resumeLive(exitCb); return; }
  const w = store.workout(workoutId);
  if (!w) { toast('Workout not found'); return; }
  const plan = store.state.plan;
  const supp = w.type === 'strength' || w.type === 'mobility';
  const outdoors = plan?.inputs?.prefs?.outdoors !== false;
  const tmPref = plan?.inputs?.prefs?.treadmill && !outdoors;
  const mode = supp ? 'timer' : tmPref ? 'treadmill' : gps.supported && gps.secure && outdoors ? 'gps' : 'timer';
  S = WS.createSession(w, { mode, paces: plan?.paces, assumedEasy: plan?.assumedEasy || 420, now: now(), speedUnit: speedUnit() });
  S.date = todayISO();
  S.supp = supp;
  applyCuePrefs(S);
  onExit = exitCb;
  persist(true);
  mount();
}

export function resumeLive(exitCb) {
  S = sessionStore.load();
  if (!S) return false;
  onExit = exitCb || onExit;
  mount();
  return true;
}

/** Called at app start: detect an interrupted workout. */
export async function checkRecovery(exitCb) {
  const s = sessionStore.load();
  if (!s) return;
  if (s.status === 'finished') { S = s; onExit = exitCb; mountSummary(); return; }
  if (s.status === 'ready') { sessionStore.clear(); return; }
  const gapMin = (now() - (s.lastSaved || now())) / 60000;
  if (gapMin < 2) { S = s; onExit = exitCb; mount(); return; }
  const elapsedAtSave = WS.elapsedMs(s, s.lastSaved) / 1000;
  const sh = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Workout interrupted</div><h2>${esc(s.title)}</h2></div></div>
    <p class="muted">The app was closed ${gapMin < 90 ? Math.round(gapMin) + ' minutes' : Math.round(gapMin / 60) + ' hours'} ago, ${fmtDuration(elapsedAtSave)} into this workout${s.distance ? ` (${fmtDist(s.distance)})` : ''}.</p>
    <div class="options">
      <button class="opt" data-r="resume-pause"><span class="radio"></span><span class="grow"><div class="ot">Resume — exclude the gap</div><div class="os">Time while closed is treated as paused</div></span></button>
      <button class="opt" data-r="resume-keep"><span class="radio"></span><span class="grow"><div class="ot">Resume — I kept running</div><div class="os">Count the time while the app was closed</div></span></button>
      <button class="opt" data-r="finish"><span class="radio"></span><span class="grow"><div class="ot">Finish & save</div><div class="os">Save what was recorded up to the interruption</div></span></button>
      <button class="opt" data-r="discard"><span class="radio"></span><span class="grow"><div class="ot" style="color:var(--danger)">Discard workout</div></span></button>
    </div>`, {
    onMount: (el) => el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => {
      const r = b.dataset.r; sh.close();
      S = s; onExit = exitCb;
      if (r === 'discard') { sessionStore.clear(); S = null; return; }
      if (r === 'resume-pause') {
        if (S.status === 'running') { S.pausedMs += now() - S.lastSaved; }
        else if (S.status === 'paused') { /* already paused, gap is part of the pause */ }
        S.lastPoint = null; persist(true); mount();
      } else if (r === 'resume-keep') { S.lastPoint = null; persist(true); mount(); }
      else { // finish at time of interruption
        if (S.status === 'running') { S.pausedMs += now() - S.lastSaved; }
        WS.finish(S, now()); persist(true); mountSummary();
      }
    }),
  });
}

// ---------------------------------------------------------------- mounting
function mount() {
  unmount(false);
  root = document.createElement('div');
  root.className = 'live';
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  if (S.status === 'ready') renderReady(); else { renderRunning(); startLoop(); }
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
}

function unmount(clear = true) {
  stopLoop();
  gps.stop();
  wake.release();
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('pagehide', onHide);
  if (root) { root.remove(); root = null; }
  document.body.style.overflow = '';
  if (clear) S = null;
}

function onHide() { persist(true); }
async function onVis() {
  if (!S) return;
  if (document.visibilityState === 'hidden') { persist(true); return; }
  // visible again: catch up instantly from timestamps
  if (S.status === 'running' || S.status === 'paused') { handle(WS.tick(S, now()), { quietCatchUp: true }); await wake.acquire(); update(); }
}

function startLoop() {
  stopLoop();
  if (S.mode === 'gps') startGps();
  wake.acquire();
  loop = setInterval(() => {
    if (!S) return;
    const ev = WS.tick(S, now());
    if (ev.length) handle(ev);
    paceAlert();
    tmCompare();
    update();
    persist();
  }, 250);
}
function stopLoop() { if (loop) clearInterval(loop); loop = null; }

function startGps() {
  gps.start((fix) => { if (S && WS.addGpsPoint(S, fix)) persist(); updateGpsPill(); }, (err) => {
    if (!S) return;
    if (err.code === 1 || err.code === 'insecure' || err.code === 'unsupported') {
      S.gpsStatus = 'off'; S.gpsError = err.message; updateGpsPill();
    } else { S.gpsStatus = 'poor'; updateGpsPill(); }
  });
}

// ---------------------------------------------------------------- ready screen
function renderReady() {
  const w = store.workout(S.workoutId) || {};
  const plan = store.state.plan;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const totalMin = Math.round(S.totalEst / 60);
  const zc = S.steps.find((s) => s.kind === 'work')?.zone || S.steps[0]?.zone;
  root.dataset.z = zoneColorKey(zc);
  root.innerHTML = `
    <div class="live-top"><button class="icon-btn" data-l="close" style="background:rgba(255,255,255,.1);color:#fff" aria-label="Close">${icon('x', 'sm')}</button><span class="ttl">${esc(typeLabel(S.type))}</span><span style="width:42px"></span></div>
    <div class="live-ready">
      <div class="live-phase"><div class="k">Ready</div></div>
      <h2 style="margin-top:8px">${esc(S.title)}</h2>
      <div style="color:#c3c8d1;margin-bottom:20px">${S.steps.length} steps · about ${totalMin} min</div>
      ${S.supp ? '' : `<div class="field"><span class="lbl" style="color:#c3c8d1">Tracking</span><div class="seg">
        <button data-mode="gps" class="${S.mode === 'gps' ? 'sel' : ''}">${icon('pin', 'xs')} Outdoor GPS</button>
        <button data-mode="treadmill" class="${S.mode === 'treadmill' ? 'sel' : ''}">Treadmill</button>
        <button data-mode="timer" class="${S.mode === 'timer' ? 'sel' : ''}">Timer only</button></div></div>`}
      <div data-gps-note>${modeNote()}</div>
      ${S.mode === 'treadmill' ? `<div class="card" style="background:rgba(255,255,255,.06);border:0;margin-top:12px">
        <div class="small" style="color:#c3c8d1">First segment: <b style="color:#fff">${esc(S.steps[0]?.label || '')}</b> · target <b style="color:#fff">${esc(fmtSpeedRange(S.steps[0]?.speed))}</b>${S.steps[0]?.speed?.estimated ? ' (estimated — no pace data yet)' : ''}</div>
        <div class="tm-panel" style="margin-top:10px"><button class="tm-step" data-rs="-">−</button><div class="tm-val"><span class="tl">Starting treadmill speed</span><span class="v num" data-rs-val>${fmtSpeed(S.steps[0]?.speed?.target ?? 0)}</span><span class="tl">${speedLabel(S.tm.unit)}</span></div><button class="tm-step" data-rs="+">+</button></div>
        <div class="tiny" style="color:#8c93a0;margin-top:8px">Stride never changes your treadmill. Set the belt yourself, then keep the speed here matched so distance stays accurate.</div>
      </div>` : ''}
      ${isIOS ? `<div class="notice" style="margin-top:10px">${icon('info', 'sm')}<div>On iPhone, keep the screen on and the app open for voice cues and GPS. If the screen locks, your time stays accurate and the workout catches up when you return.</div></div>` : `<div class="notice" style="margin-top:10px">${icon('info', 'sm')}<div>For best results keep the screen on (${wake.supported ? 'Stride will request this automatically' : 'set your screen timeout longer'}). Timing is always recalculated from timestamps, so it stays correct even if the browser is backgrounded.</div></div>`}
    </div>
    <button class="btn primary lg block" data-l="go" style="min-height:76px;font-size:20px;border-radius:24px">${icon('play')} Start</button>`;
  root.querySelector('[data-l="close"]').onclick = () => { sessionStore.clear(); unmount(); onExit && onExit(); };
  root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    const w2 = store.workout(S.workoutId);
    S = WS.createSession(w2, { mode: b.dataset.mode, paces: plan?.paces, assumedEasy: plan?.assumedEasy || 420, now: now(), speedUnit: speedUnit() });
    S.date = todayISO(); S.supp = w2.type === 'strength' || w2.type === 'mobility'; applyCuePrefs(S); persist(true); renderReady();
  });
  if (S.mode === 'gps') { startGps(); }
  let startSpeed = S.steps[0]?.speed?.target ?? 0;
  root.querySelectorAll('[data-rs]').forEach((b) => b.onclick = () => { startSpeed = Math.max(0, roundSpeed(startSpeed + (b.dataset.rs === '+' ? 0.1 : -0.1))); root.querySelector('[data-rs-val]').textContent = fmtSpeed(startSpeed); });
  root.querySelector('[data-l="go"]').onclick = () => {
    if (TM()) WS.setTreadmillSpeed(S, now(), startSpeed);
    audio.unlock();
    wake.acquire();
    const ov = document.createElement('div'); ov.className = 'countdown-overlay'; root.appendChild(ov);
    const total = Number(prefs.get().startCountdown) || 3;
    if (total >= 10) audio.say('Workout starting in 10 seconds.');
    const t0 = now();
    ov.innerHTML = `<div class="center"><div data-cd>${total}</div><div style="font-size:15px;font-weight:700;color:#8c93a0;letter-spacing:.1em">STARTING · TAP TO SKIP</div></div>`;
    let done = false, lastN = total + 1;
    const finish = () => { if (done) return; done = true; clearInterval(iv); ov.remove(); handle(WS.start(S, now())); persist(true); renderRunning(); startLoop(); };
    ov.onclick = finish;
    const iv = setInterval(() => {
      const n = Math.ceil(total - (now() - t0) / 1000);
      if (n <= 0) { finish(); return; }
      if (n !== lastN) { lastN = n; ov.querySelector('[data-cd]').textContent = n; if (n <= 3) { audio.beep({ freq: 660, dur: 0.12 }); audio.vibrate([60]); } }
    }, 100);
  };
}

function modeNote() {
  if (S.mode === 'gps') {
    if (!gps.secure) return `<div class="notice">${icon('alert', 'sm')}<div>GPS needs the app to be opened over HTTPS. Use Timer mode or open the installed app.</div></div>`;
    return `<div class="row small" style="color:#c3c8d1">${icon('pin', 'sm')} <span data-gps-pill>${gpsLabel()}</span></div>`;
  }
  if (S.mode === 'treadmill') return `<div class="small" style="color:#c3c8d1">Every segment shows a recommended treadmill speed. Distance is calculated from the speeds you enter, so distance intervals end exactly when you have covered them.</div>`;
  return S.supp ? '' : `<div class="small" style="color:#c3c8d1">No GPS. Distance steps become timed steps at your target pace; distance is estimated.</div>`;
}
function gpsLabel() {
  if (!S) return '';
  if (S.gpsError) return S.gpsError;
  return { searching: 'Searching for GPS…', good: 'GPS ready', weak: 'GPS signal weak', poor: 'GPS signal poor', off: 'GPS off' }[S.gpsStatus] || '';
}
function updateGpsPill() {
  if (!root) return;
  root.querySelectorAll('[data-gps-pill]').forEach((el) => { el.textContent = gpsLabel(); el.className = `pill ${S.gpsStatus}`; });
}

// ---------------------------------------------------------------- running screen
function renderRunning() {
  root.innerHTML = `
    <div class="live-top">
      <span class="ttl">${esc(S.title)}</span>
      ${S.mode === 'gps' ? `<span class="pill ${S.gpsStatus}" data-gps-pill>${gpsLabel()}</span>` : `<span class="pill off">${S.mode === 'treadmill' ? 'Treadmill' : S.supp ? 'Session' : 'Timer'}</span>`}
    </div>
    <div class="live-seg" data-u="seg"></div>
    <div class="live-phase"><div class="k" data-u="kind"></div><div class="lbl" data-u="label"></div><div class="rep" data-u="rep"></div></div>
    <div class="live-main">
      <div class="live-big" data-u="big">0:00</div>
      <div class="live-big-l" data-u="bigl"></div>
      <div class="live-target" data-u="target"></div>
      <div class="live-cue" data-u="cue"></div>
    </div>
    ${TM() ? speedPanel() : ''}
    <div class="live-stats" ${S.supp ? 'style="grid-template-columns:1fr 1fr"' : ''}>
      <div><div class="v" data-u="elapsed">0:00</div><div class="l">Elapsed</div></div>
      ${S.supp ? `<div><div class="v" data-u="setsdone">0</div><div class="l">Sets done</div></div>` : `<div><div class="v" data-u="dist">0.00</div><div class="l">${distLabel()}</div></div>
      <div><div class="v" data-u="pace">—</div><div class="l" data-u="pacel">Pace ${paceLabel()}</div></div>`}
    </div>
    ${S.supp ? '' : '<div class="live-sub-stats" data-u="substats"></div>'}
    <div class="live-next" data-u="next"></div>
    <div class="live-controls">
      <button class="side" data-l="prev" aria-label="Previous interval">${icon('prev')}</button>
      <button class="main-btn" data-l="main"></button>
      <button class="side" data-l="next" aria-label="Next interval">${icon('next')}</button>
    </div>
    <div class="live-sub">
      <button data-l="pause2" hidden>${icon('pause', 'sm')} Pause</button>
      <button data-l="lock">${icon('timer', 'sm')} Lock screen</button>
      <button class="end" data-l="end">${icon('stop', 'sm')} End</button>
    </div>
    <div class="live-warn" data-u="warn"></div>`;
  if (TM()) bindSpeedPanel(root);
  root.querySelector('[data-l="prev"]').onclick = debounced(() => { handle(WS.prev(S, now())); persist(true); update(); });
  root.querySelector('[data-l="next"]').onclick = debounced(() => { handle(WS.next(S, now())); persist(true); update(); });
  root.querySelector('[data-l="main"]').onclick = debounced(() => {
    const st = WS.currentStep(S);
    if (st?.measure === 'manual' && S.status === 'running') handle(WS.completeManual(S, now()));
    else if (S.status === 'running') { handle(WS.pause(S, now())); audio.say('Paused'); }
    else if (S.status === 'paused') { handle(WS.resume(S, now())); audio.say('Resuming'); }
    persist(true); update();
  });
  root.querySelector('[data-l="pause2"]').onclick = () => {
    if (S.status === 'running') { handle(WS.pause(S, now())); } else if (S.status === 'paused') { handle(WS.resume(S, now())); }
    persist(true); update();
  };
  root.querySelector('[data-l="end"]').onclick = async () => {
    const ok = await confirmDialog({ title: 'End workout?', body: `You are ${Math.round(WS.progress(S, now()) * 100)}% through. Your progress so far will be saved.`, confirm: 'End & save', cancel: 'Keep going' });
    if (ok) { handle(WS.finish(S, now())); }
  };
  // "Lock screen" = UI lock to prevent accidental taps in a pocket
  const lockBtn = root.querySelector('[data-l="lock"]');
  lockBtn.onclick = () => {
    const locked = root.classList.toggle('ui-locked');
    root.querySelectorAll('.live-controls button, .live-sub button:not([data-l="lock"])').forEach((b) => { b.disabled = locked; });
    lockBtn.innerHTML = locked ? `${icon('timer', 'sm')} Tap & hold to unlock` : `${icon('timer', 'sm')} Lock screen`;
    if (locked) { lockBtn.onclick = null; let t; lockBtn.onpointerdown = () => { t = setTimeout(() => { root.classList.remove('ui-locked'); renderRunning(); update(); }, 800); }; lockBtn.onpointerup = () => clearTimeout(t); }
  };
  update();
}

function bigValue(st, rem) {
  if (!st) return ['Done', ''];
  if (rem.kind === 'time') return [fmtDuration(Math.ceil(rem.value)), st.converted ? `≈ ${fmtDist(st.converted)} · remaining` : 'Remaining'];
  if (rem.kind === 'distance') {
    const v = toDisplayDist(rem.value);
    const small = rem.value < 1000;
    return [small && distLabel() === 'km' ? `${Math.round(rem.value)}m` : small && distLabel() === 'mi' && rem.value < 400 ? `${Math.round(rem.value)}m` : v.toFixed(2), small && (distLabel() === 'km' || rem.value < 400) ? 'Remaining' : `${distLabel()} remaining`];
  }
  return ['Go', st.detail || 'Tap Done when finished'];
}

function update() {
  if (!root || !S || !root.querySelector('[data-u="big"]')) return;
  const t = now();
  const st = WS.currentStep(S);
  const rem = WS.stepRemaining(S, t) || {};
  const plan = store.state.plan, profile = store.state.profile;
  root.dataset.z = zoneColorKey(st?.zone || 'easy');
  root.style.setProperty('--zc', `var(--z-${zoneColorKey(st?.zone || 'easy')})`);
  root.classList.toggle('paused-state', S.status === 'paused');
  const $ = (k) => root.querySelector(`[data-u="${k}"]`);
  // segmented bar
  const segEl = $('seg');
  if (segEl && segEl.childElementCount !== S.steps.length) {
    segEl.innerHTML = S.steps.map((s) => `<i style="--w:${Math.max(1, s.measure === 'time' ? s.value : s.measure === 'distance' ? s.estSec : 45)};--zc:var(--z-${zoneColorKey(s.zone)})"></i>`).join('');
  }
  if (segEl) [...segEl.children].forEach((el, i) => {
    el.className = i < S.stepIndex ? 'done' : i === S.stepIndex ? 'cur' : '';
    if (i === S.stepIndex && rem.total) el.style.setProperty('--p', `${Math.min(100, (1 - rem.value / rem.total) * 100)}%`);
  });
  const sub = $('substats');
  if (sub) {
    const avgP = WS.averagePace(S, t);
    const spd = avgP ? (3600 / avgP) * (distLabel() === 'mi' ? 1000 / M_PER_MI : 1) : null;
    if (TM()) {
      const left = remainingWorkoutDistance(t);
      const stLeft = st?.measure === 'distance' ? Math.max(0, st.value - WS.stepDistance(S)) : null;
      sub.innerHTML = `<span>${stLeft != null ? `${toDisplayDist(stLeft).toFixed(2)} ${distLabel()} left in step` : `Avg ${avgP ? fmtPace(avgP) + paceLabel() : '—'}`}</span><span>≈ ${toDisplayDist(left).toFixed(2)} ${distLabel()} to go</span><span>${Math.round(WS.progress(S, t) * 100)}%</span>`;
    } else sub.innerHTML = S.mode === 'gps' ? `<span>Avg ${avgP ? fmtPace(avgP) + paceLabel() : '—'}</span><span>Speed ${spd ? spd.toFixed(1) : '—'} ${distLabel() === 'mi' ? 'mph' : 'km/h'}</span><span>${Math.round(WS.progress(S, t) * 100)}% done</span>` : `<span>${Math.round(WS.progress(S, t) * 100)}% of workout done</span><span>Step ${S.stepIndex + 1}/${S.steps.length}</span>`;
  }
  const kindName = { warmup: 'Warm-up', cooldown: 'Cool-down', work: 'Work', recover: 'Recovery', steady: 'Run', walk: 'Walk', exercise: 'Exercise', rest: 'Rest' }[st?.kind] || '';
  $('kind').innerHTML = `<span class="dot" style="background:var(--zc)"></span>${esc(S.status === 'paused' ? 'Paused' : kindName)}`;
  $('label').textContent = st?.label || 'Complete';
  $('rep').textContent = st?.zone === 'stride' && st.reps ? `Stride ${st.rep} of ${st.reps}` : st?.kind === 'work' && st.workTotal > 1 ? `Interval ${st.workIndex} of ${st.workTotal}` : st?.kind === 'recover' && st.reps ? `Recovery ${st.rep} of ${st.reps - 1 || st.reps}` : st?.reps ? `Rep ${st.rep} of ${st.reps}` : st?.detail || `Step ${S.stepIndex + 1} of ${S.steps.length}`;
  const [bv, bl] = bigValue(st, rem);
  $('big').textContent = bv; $('bigl').textContent = bl;
  // target & current pace
  const cur = WS.currentPace(S, t);
  const targetEl = $('target');
  if (TM() && st) {
    const rec = st.speed;
    const sel = S.tm.selected;
    const showPace = prefs.get().tmDisplay === 'pace';
    const stat = speedStatus(sel, rec);
    targetEl.hidden = !rec;
    if (rec) {
      targetEl.className = `live-target ${stat === 'slow' ? 'slow' : stat === 'fast' ? 'fast' : stat === 'on' ? 'on' : ''}`;
      const tgtTxt = showPace ? fmtPaceRange([speedToPace(rec.high, rec.unit), speedToPace(rec.low, rec.unit)]) : `${fmtSpeed(rec.target)} ${speedLabel(rec.unit)}`;
      const rangeTxt = !showPace && rec.high - rec.low >= 0.15 ? `<span class="tl">${fmtSpeed(rec.low)}–${fmtSpeed(rec.high)}</span>` : '';
      targetEl.innerHTML = `<span class="tl">Target</span> ${esc(tgtTxt)} ${rangeTxt}${rec.incline >= 5 ? ` <span class="tl">${rec.incline}% incline</span>` : ''}${stat ? ` <span class="tl">${stat === 'slow' ? '▲ Speed up' : stat === 'fast' ? '▼ Slow down' : '✓ On target'}</span>` : ''}`;
    }
    $('tmsel').textContent = sel == null ? '—' : showPace ? fmtPace(speedToPace(sel, S.tm.unit)) : fmtSpeed(sel);
    $('tmunit').textContent = showPace ? paceLabel() : speedLabel(S.tm.unit);
    const mb = $('tmmatch');
    if (mb) { const show = rec && sel != null && Math.abs(sel - rec.target) >= 0.05; mb.hidden = !show; if (show) mb.textContent = `Set to target ${fmtSpeed(rec.target)}`; }
  } else if (st && st.zone && !S.supp) {
    const tgt = st.targetPace ? fmtPaceRange(st.targetPace) : null;
    const hrTxt = profile?.inputs?.prefs?.intensityBy === 'hr' ? stepTarget(st, plan, profile, { short: true }) : null;
    let cls = '';
    if (st.targetPace && cur && S.mode === 'gps') cls = cur > st.targetPace[1] * 1.03 ? 'slow' : cur < st.targetPace[0] * 0.97 ? 'fast' : 'on';
    targetEl.className = `live-target ${cls}`;
    targetEl.innerHTML = `<span class="tl">Target</span> ${esc(hrTxt || tgt || `RPE ${ZONE_INFO[st.zone]?.rpe || ''}`)}${cls ? ` <span class="tl">${cls === 'slow' ? 'Speed up' : cls === 'fast' ? 'Ease off' : 'On pace'}</span>` : ''}`;
    targetEl.hidden = false;
  } else targetEl.hidden = true;
  $('cue').textContent = st?.cue || (st?.zone ? ZONE_INFO[st.zone]?.effort || '' : '');
  $('elapsed').textContent = fmtDuration(WS.elapsedMs(S, t) / 1000);
  if (S.supp) $('setsdone').textContent = S.laps.filter((l) => l.kind === 'exercise' && !l.skipped).length;
  else {
    $('dist').textContent = S.mode === 'gps' || TM() ? toDisplayDist(S.distance).toFixed(2) : '—';
    const avg = WS.averagePace(S, t);
    if (TM()) { $('pace').textContent = S.tm.selected ? fmtPace(speedToPace(S.tm.selected, S.tm.unit)) : '—'; $('pacel').textContent = `Pace ${paceLabel()}`; }
    else {
      $('pace').textContent = S.mode === 'gps' ? (cur ? fmtPace(cur) : avg ? fmtPace(avg) : '—') : '—';
      $('pacel').textContent = cur ? `Pace ${paceLabel()}` : `Avg ${paceLabel()}`;
    }
  }
  const nx = S.steps[S.stepIndex + 1];
  $('next').innerHTML = nx ? `<span class="dot" style="background:var(--z-${zoneColorKey(nx.zone)})"></span><span class="grow">Next: <b>${esc(nx.label)}</b>${nx.reps ? ` (${nx.rep}/${nx.reps})` : ''}${TM() && nx.speed ? ` · <b style="color:var(--zc)">${fmtSpeed(nx.speed.target)} ${speedLabel(nx.speed.unit)}</b>` : ''}</span><span class="num">${esc(nx.measure === 'time' ? fmtDuration(nx.value) : nx.measure === 'distance' ? (nx.value < 3000 ? Math.round(nx.value) + 'm' : fmtDist(nx.value)) : nx.detail?.split('·').pop() || '')}</span>` : `<span class="grow">Last step — finish strong</span>`;
  const main = root.querySelector('[data-l="main"]');
  const manual = st?.measure === 'manual' && S.status === 'running';
  main.className = `main-btn ${S.status === 'paused' ? 'paused' : ''}`;
  main.innerHTML = manual ? `${icon('check')} Done` : S.status === 'paused' ? `${icon('play')} Resume` : `${icon('pause')} Pause`;
  root.querySelector('[data-l="pause2"]').hidden = !(st?.measure === 'manual' || S.status === 'paused' && st?.measure === 'manual');
  root.querySelector('[data-l="prev"]').disabled = S.stepIndex === 0 || root.classList.contains('ui-locked');
  $('warn').textContent = S.mode === 'gps' && S.gpsStatus === 'off' ? (S.gpsError || 'GPS unavailable — time-based steps continue; tap ▶| to advance distance steps.') : document.visibilityState === 'hidden' ? '' : '';
}

// ---------------------------------------------------------------- cues
function speakPace(range) {
  if (!range) return '';
  const unit = paceLabel() === '/mi' ? 'per mile' : 'per kilometre';
  const f = fmtPace(range[0]).split(':'), s = fmtPace(range[1]).split(':');
  return `Target ${Number(f[0])} ${f[1]} to ${Number(s[0])} ${s[1]} ${unit}.`;
}
function speakValue(st) {
  if (st.measure === 'time') { const m = Math.floor(st.value / 60), s = st.value % 60; return m ? `${m} minute${m > 1 ? 's' : ''}${s ? ` ${s} seconds` : ''}` : `${s} seconds`; }
  if (st.measure === 'distance') return st.value < 1500 ? `${Math.round(st.value)} metres` : `${toDisplayDist(st.value).toFixed(1)} ${distLabel() === 'mi' ? 'miles' : 'kilometres'}`;
  return '';
}
function stepSpeech(st, prevStep) {
  const target = st.targetPace ? speakPace(st.targetPace) : st.zone ? (ZONE_INFO[st.zone]?.effort || '') + '.' : '';
  switch (st.kind) {
    case 'warmup': return `Begin your warm-up. ${speakValue(st)} easy. ${target}`;
    case 'cooldown': return `Begin your cooldown. ${speakValue(st)}, nice and easy.`;
    case 'work': if (st.zone === 'stride') return `Stride ${st.rep} of ${st.reps}. 20 seconds, smooth and fast.`;
      return `${st.workTotal > 1 ? `Interval ${st.workIndex} of ${st.workTotal}.` : st.label + '.'} ${speakValue(st)}. ${prevStep && ['recover', 'walk', 'warmup'].includes(prevStep.kind) ? 'Increase your pace.' : ''} ${target}`;
    case 'recover': return `Recovery period begins. ${speakValue(st)}. ${st.zone === 'walk' ? 'Walk.' : 'Easy jog.'}`;
    case 'walk': return `Walk. ${speakValue(st)}.`;
    case 'steady': return `${st.label}. ${speakValue(st)}. ${target}`;
    case 'exercise': return `${st.label}. ${st.detail ? st.detail.split('·').pop() : speakValue(st)}.`;
    case 'rest': return `Rest. ${speakValue(st)}.`;
    default: return st.label;
  }
}

function handle(events, { quietCatchUp = false } = {}) {
  const p = prefs.get();
  const hidden = document.visibilityState === 'hidden';
  const steps = events.filter((e) => e.type === 'step');
  for (const e of events) {
    if (e.type === 'start') { audio.beep({ freq: 990, dur: 0.35 }); audio.vibrate([300]); audio.say(TM() ? `${stepSpeech(e.step).split('.')[0]}. ${p.tmSpeakTarget ? tmInstruction(e.step, { first: true }) : ''}` : stepSpeech(e.step)); }
    if (e.type === 'step' && e === steps[steps.length - 1]) {
      // Only announce the latest step if several were skipped while backgrounded
      audio.beep({ freq: 990, dur: 0.3 }); audio.vibrate([200, 80, 200]);
      const base = stepSpeech(e.step, e.prev);
      const speech = TM() ? `${base.replace(/Increase your pace\.\s*/, '').replace(/Target \d.*?per (mile|kilometre)\./, '').trim()} ${p.tmSpeakTarget ? tmInstruction(e.step) : ''}` : base;
      audio.say((quietCatchUp && steps.length > 1 ? 'Catching up. ' : '') + speech);
      if (hidden && p.stepNotifications) notify.show(e.step.label, stepSpeech(e.step, e.prev));
    }
    const minimal = p.cueLevel === 'minimal';
    if (e.type === 'tmPre' && p.tmReminders && !minimal && !quietCatchUp && e.next?.speed) {
      const n = e.next;
      audio.say(n.zone === 'stride' ? `Strides begin in ${e.seconds} seconds. Target speed is about ${speedSay(n.speed.target)}.` : n.kind === 'work' ? `Your next interval begins in ${e.seconds} seconds. Target speed is ${speedSay(n.speed.target)}.` : `In ${e.seconds} seconds, ${n.label.toLowerCase()} at ${speedSay(n.speed.target)}.`);
    }
    if (e.type === 'tmReminder' && p.tmReminders && !minimal && !quietCatchUp) {
      audio.say(`You're at ${speedSay(e.selected)}. ${e.selected < e.step.speed.low ? 'Increase' : 'Reduce'} to ${fmtSpeed(e.step.speed.target)} for ${stepNoun(e.step)}.`);
    }
    const tmPreFired = TM() && (S.fired[String(S.stepIndex)] || []).includes('tm30');
    if (e.type === 'countdown' && p.countdown && !minimal && !quietCatchUp && !tmPreFired) {
      const k = e.next?.kind;
      audio.say(k === 'work' ? 'Your interval begins in 10 seconds.' : k === 'recover' ? 'Recovery in 10 seconds.' : k === 'cooldown' ? 'Cooldown in 10 seconds.' : e.next ? `${e.next.label} in 10 seconds.` : 'Finishing in 10 seconds.');
    }
    if (e.type === 'beeps' && !quietCatchUp) audio.beep({ freq: 760, dur: 0.12, times: 3, gap: 0.82 });
    if (e.type === 'halfway' && p.halfway && !minimal) audio.say('Halfway through your workout. Keep it up.');
    if (e.type === 'stephalf' && p.halfway && !minimal && !quietCatchUp) audio.say(`Halfway through this ${e.step.kind === 'work' ? 'effort' : 'section'}.`);
    if (e.type === 'distwarn' && p.distanceCues && !minimal && !quietCatchUp) { audio.say(`You have ${e.meters} metres remaining.`); if (e.meters === 100) audio.vibrate([80]); }
    if (e.type === 'update' && !quietCatchUp && TM()) {
      const t = now();
      audio.say(`Speed ${speedSay(S.tm.selected || 0)}. Distance ${toDisplayDist(S.distance).toFixed(1)} ${distLabel() === 'mi' ? 'miles' : 'kilometres'}. About ${toDisplayDist(remainingWorkoutDistance(t)).toFixed(1)} to go.`);
    } else if (e.type === 'update' && !quietCatchUp) {
      const t = now(); const el = Math.round(WS.elapsedMs(S, t) / 60000); const avg = WS.averagePace(S, t);
      audio.say(`Time ${el} minutes.${S.mode === 'gps' && S.distance > 100 ? ` Distance ${toDisplayDist(S.distance).toFixed(1)} ${distLabel() === 'mi' ? 'miles' : 'kilometres'}. Average pace ${speakClock(avg)}.` : ''}`);
    }
    if (e.type === 'finish') {
      audio.beep({ freq: 1180, dur: 0.25, times: 2 }); audio.vibrate([300, 100, 300]); audio.say('Workout complete. Great job!');
      stopLoop(); gps.stop(); wake.release(); persist(true);
      setTimeout(mountSummary, 400);
    }
  }
}

function tmCompare() {
  if (!TM() || S.status !== 'running' || !S.tm.lastChangeWall) return;
  if (S.tm.compareFor === S.tm.lastChangeWall || now() - S.tm.lastChangeWall < 2500) return;
  S.tm.compareFor = S.tm.lastChangeWall;
  const st = WS.currentStep(S); const p = prefs.get();
  if (!st?.speed || !p.tmCompare || p.cueLevel === 'minimal') return;
  const stat = speedStatus(S.tm.selected, st.speed);
  if (stat === 'on') audio.say(`${speedSay(S.tm.selected)}. Right on target.`);
  else if (stat) audio.say(`You're currently running at ${speedSay(S.tm.selected)}. Your target is ${fmtSpeed(st.speed.target)}.`);
}

function speakClock(secPerKm) {
  if (!secPerKm) return '';
  const [m, s2] = fmtPace(secPerKm).split(':');
  return `${Number(m)} ${s2} per ${paceLabel() === '/mi' ? 'mile' : 'kilometre'}`;
}

function paceAlert() {
  const p = prefs.get();
  if (!p.paceAlerts || p.cueLevel === 'minimal' || S.mode !== 'gps' || S.status !== 'running') return;
  const st = WS.currentStep(S);
  if (!st?.targetPace || !['work', 'steady'].includes(st.kind)) return;
  if (WS.stepElapsedMs(S, now()) < 45000 || now() - lastPaceAlert < 60000) return;
  const cur = WS.currentPace(S, now());
  if (!cur) return;
  if (cur > st.targetPace[1] * 1.04) { audio.say('Increase your pace.'); lastPaceAlert = now(); }
  else if (cur < st.targetPace[0] * 0.95) { audio.say('Ease off slightly — you are ahead of target.'); lastPaceAlert = now(); }
}

// ---------------------------------------------------------------- summary
function mountSummary() {
  if (!root) { root = document.createElement('div'); document.body.appendChild(root); }
  root.className = '';
  root.style.cssText = 'position:fixed;inset:0;z-index:90;overflow-y:auto;background:var(--bg)';
  document.body.style.overflow = 'hidden';
  const act = WS.toActivity(S, { date: S.date || todayISO() });
  const workLaps = act.laps.filter((l) => l.kind === 'work' || l.kind === 'steady');
  const plan = store.state.plan;
  let rpe = null;
  root.innerHTML = `<div class="main" style="padding-bottom:40px">
    <div class="summary-hero"><div class="badge">${icon('check')}</div><h1>Workout complete</h1><div class="muted">${esc(S.title)} · ${esc(fmtLongDate(act.date))}</div></div>
    <div class="stat-grid four">
      <div class="stat"><div class="v">${act.distance ? toDisplayDist(act.distance).toFixed(2) : '—'}<small>${distLabel()}</small></div><div class="l">Distance${act.distanceEstimated ? ' (est.)' : ''}</div></div>
      <div class="stat"><div class="v">${fmtDuration(act.duration)}</div><div class="l">Duration</div></div>
      <div class="stat"><div class="v">${act.avgPace ? fmtPace(act.avgPace) : '—'}<small>${paceLabel()}</small></div><div class="l">Average pace</div></div>
      <div class="stat"><div class="v">${act.completionPct}<small>%</small></div><div class="l">Completed</div></div>
    </div>
    ${act.fastestLap ? `<div class="notice accent" style="margin-top:12px">${icon('bolt', 'sm')}<div>Fastest interval: <b>${esc(act.fastestLap.label)}${act.fastestLap.rep ? ' #' + act.fastestLap.rep : ''}</b> at <b>${fmtPace(act.fastestLap.avgPace, { withUnit: true })}</b></div></div>` : ''}
    ${S.mode !== 'gps' && !S.supp ? `<div class="card" style="margin-top:12px"><label class="field" style="margin:0"><span class="lbl">Actual distance <span class="muted small">(${TM() ? 'from the treadmill display — optional, corrects the calculated distance' : 'from treadmill or watch — optional'})</span></span><div class="unit-suffix"><input class="input" data-s="dist" inputmode="decimal" placeholder="${act.distance ? toDisplayDist(act.distance).toFixed(2) : ''}"><span>${distLabel()}</span></div></label></div>` : ''}
    ${act.route.length > 2 ? `<div class="section-title"><h2>Route</h2></div>${routeSvg(act.route)}` : ''}
    ${TM() && act.laps.length ? `<div class="section-title"><h2>Target vs your speed</h2></div><div class="card" style="padding:8px 10px"><table class="lap-table"><tr><th>Segment</th><th class="r">Time</th><th class="r">Target</th><th class="r">You</th><th class="r">Dist</th></tr>
      ${act.laps.filter((l) => l.targetSpeed).map((l) => { const stt = speedStatus(l.tmAvgSpeed, l.targetSpeed); return `<tr><td>${esc(l.label)}${l.rep ? ` ${l.rep}` : ''}</td><td class="r">${fmtDuration(l.duration)}</td><td class="r muted">${esc(fmtSpeedRange(l.targetSpeed))}</td><td class="r" style="font-weight:700;color:${stt === 'on' ? 'var(--ok)' : stt === 'slow' ? 'var(--warn)' : stt === 'fast' ? 'var(--z-easy)' : 'inherit'}">${fmtSpeed(l.tmAvgSpeed)}</td><td class="r">${fmtDist(l.distance, { withUnit: false })}</td></tr>`; }).join('')}
    </table><p class="tiny muted">Distance is calculated from the speeds you entered (${S.tm.changes.length} change${S.tm.changes.length === 1 ? '' : 's'}). Treadmill results are tracked separately from outdoor GPS runs.</p></div>` : ''}
    ${workLaps.length && !S.supp && !TM() ? `<div class="section-title"><h2>Target vs actual</h2></div><div class="card" style="padding:8px 10px"><table class="lap-table"><tr><th>Step</th><th class="r">Time</th><th class="r">Dist</th><th class="r">Pace</th><th class="r">Target</th></tr>
      ${workLaps.map((l) => { const tp = l.targetPace; const ok = tp && l.avgPace ? (l.avgPace <= tp[1] * 1.03 && l.avgPace >= tp[0] * 0.97 ? 'var(--ok)' : l.avgPace > tp[1] * 1.03 ? 'var(--warn)' : 'var(--z-easy)') : 'inherit';
        return `<tr><td>${esc(l.label)}${l.rep ? ` ${l.rep}` : ''}${l.skipped ? ' <span class="muted tiny">skipped</span>' : l.partial ? ' <span class="muted tiny">ended early</span>' : ''}</td><td class="r">${fmtDuration(l.duration)}</td><td class="r">${l.distance ? fmtDist(l.distance, { withUnit: false }) : '—'}</td><td class="r" style="color:${ok};font-weight:700">${l.avgPace ? fmtPace(l.avgPace) : '—'}</td><td class="r muted">${tp ? fmtPaceRange(tp) : esc(ZONE_INFO[l.zone]?.rpe ? 'RPE ' + ZONE_INFO[l.zone].rpe : '—')}</td></tr>`; }).join('')}
    </table>${act.distanceEstimated ? '<p class="tiny muted">Distances estimated from target paces (no GPS).</p>' : ''}</div>` : ''}
    <div class="section-title"><h2>How hard did that feel?</h2></div>
    <div class="card"><div class="rpe-scale">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-rpe="${i + 1}">${i + 1}</button>`).join('')}</div><div class="row between tiny muted" style="margin-top:8px"><span>Very easy</span><span>Moderate</span><span>Max effort</span></div></div>
    <div class="section-title"><h2>How do your legs feel now?</h2><span class="small muted">optional</span></div>
    <div class="seg">${[['fresh', 'Fresh'], ['ok', 'OK'], ['tired', 'Tired'], ['very-tired', 'Very tired']].map(([v, l]) => `<button type="button" data-feel="${v}">${l}</button>`).join('')}</div>
    <div class="section-title"><h2>Notes</h2></div>
    <textarea class="input" data-s="notes" placeholder="How did it feel? Weather, shoes, niggles…"></textarea>
    <div class="btn-row" style="margin-top:18px"><button class="btn ghost" data-s="discard">Discard</button><button class="btn primary lg" data-s="save">${icon('check', 'sm')} Save workout</button></div>
  </div>`;
  root.querySelectorAll('[data-rpe]').forEach((b) => b.onclick = () => { rpe = Number(b.dataset.rpe); root.querySelectorAll('[data-rpe]').forEach((x) => x.classList.toggle('sel', x === b)); });
  let feel = null;
  root.querySelectorAll('[data-feel]').forEach((b) => b.onclick = () => { feel = b.dataset.feel; root.querySelectorAll('[data-feel]').forEach((x) => x.classList.toggle('sel', x === b)); });
  root.querySelector('[data-s="discard"]').onclick = async () => {
    const ok = await confirmDialog({ title: 'Discard this workout?', body: 'Nothing will be saved.', confirm: 'Discard', danger: true });
    if (ok) { sessionStore.clear(); unmount(); onExit && onExit(); }
  };
  root.querySelector('[data-s="save"]').onclick = async (ev) => {
    if (ev.currentTarget.disabled) return;
    ev.currentTarget.disabled = true; // prevent duplicate saves
    const md = root.querySelector('[data-s="dist"]')?.value;
    const manualDistance = md ? fromDisplayDist(Number(md)) : null;
    const final = WS.toActivity(S, { date: S.date || todayISO(), rpe, notes: root.querySelector('[data-s="notes"]').value, manualDistance });
    if (S.supp) { final.distance = 0; final.avgPace = null; }
    final.feel = feel;
    const { suggestion } = await store.saveActivity(final);
    sessionStore.clear();
    unmount();
    toast('Workout saved');
    onExit && onExit();
    setTimeout(() => (suggestion ? offerVdotUpdate(suggestion) : showEvaluation(final)), 400);
  };
}

function routeSvg(route) {
  const lats = route.map((p) => p[0]), lngs = route.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const w = (maxLng - minLng) * k || 1e-6, h = maxLat - minLat || 1e-6;
  const sc = Math.min(300 / w, 180 / h);
  const ox = (320 - w * sc) / 2, oy = (200 - h * sc) / 2;
  const d = route.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] - minLng) * k * sc).toFixed(1)},${(oy + (maxLat - p[0]) * sc).toFixed(1)}`).join(' ');
  const s = route[0], e = route[route.length - 1];
  return `<svg class="route-svg" viewBox="0 0 320 200"><path d="${d}"/><circle cx="${ox + (s[1] - minLng) * k * sc}" cy="${oy + (maxLat - s[0]) * sc}" r="5" fill="var(--ok)"/><circle cx="${ox + (e[1] - minLng) * k * sc}" cy="${oy + (maxLat - e[0]) * sc}" r="5" fill="var(--danger)"/></svg>`;
}

/** Details sheet for a saved activity. */
export function showActivitySheet(a) {
  const s = openSheet(`
    <div class="sheet-head"><div><div class="small muted">${esc(fmtLongDate(a.date))}</div><h2>${esc(a.title || 'Run')}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="stat-grid">
      ${a.distance ? `<div class="stat"><div class="v">${fmtDist(a.distance)}</div><div class="l">Distance${a.distanceEstimated ? ' (est.)' : ''}</div></div>` : ''}
      <div class="stat"><div class="v">${fmtDuration(a.duration)}</div><div class="l">Duration</div></div>
      ${a.avgPace && a.distance ? `<div class="stat"><div class="v">${fmtPace(a.avgPace, { withUnit: true })}</div><div class="l">Avg pace</div></div>` : ''}
      ${a.rpe ? `<div class="stat"><div class="v">${a.rpe}/10</div><div class="l">Effort</div></div>` : ''}
      ${a.completionPct != null ? `<div class="stat"><div class="v">${a.completionPct}%</div><div class="l">Completed</div></div>` : ''}
    </div>
    ${a.route?.length > 2 ? `<div style="margin-top:12px">${routeSvg(a.route)}</div>` : ''}
    ${a.laps?.length ? `<div class="section-title"><h2>Laps</h2></div><table class="lap-table"><tr><th>Step</th><th class="r">Time</th><th class="r">Pace</th></tr>${a.laps.filter((l) => l.kind !== 'rest').map((l) => `<tr><td>${esc(l.label)}${l.rep ? ' ' + l.rep : ''}</td><td class="r">${fmtDuration(l.duration)}</td><td class="r">${l.avgPace ? fmtPace(l.avgPace) : '—'}</td></tr>`).join('')}</table>` : ''}
    ${a.notes ? `<div class="section-title"><h2>Notes</h2></div><p style="color:var(--text-2)">${esc(a.notes)}</p>` : ''}
    <button class="btn danger block" data-del style="margin-top:18px">${icon('trash', 'sm')} Delete activity</button>`, {
    onMount: (el) => el.querySelector('[data-del]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Delete this activity?', body: 'It will be removed from your history and statistics.', confirm: 'Delete', danger: true });
      if (ok) { await store.deleteActivity(a.id); s.close(); toast('Activity deleted'); }
    },
  });
}

export const liveDebug = { get session() { return S; }, shift(ms) { if (S && S.startedAt) { S.startedAt -= ms; S.stepStartElapsed = S.stepStartElapsed; } }, gps(fix) { if (S) { WS.addGpsPoint(S, fix); } } };
