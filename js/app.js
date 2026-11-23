// Stride — application bootstrap, shell, router and global action dispatch.

import { store } from './core/store.js';
import { prefs, sessionStore } from './core/storage.js';
import { db } from './core/db.js';
import { esc, icon, toast, closeAllSheets, topSheet } from './ui/dom.js';
import { applyPrefs, mountProfileInfo, exportData, resetData, openBenchmark, deleteBenchmark, openInjuryStatus, viewArchived, renderProfile } from './ui/profile.js';
import { renderToday } from './ui/today.js';
import { renderPlan, toggleWeek, expandAll } from './ui/plan.js';
import { renderCalendar, cal, calNav } from './ui/calendar.js';
import { renderProgress, prog, openAddRace } from './ui/progress.js';
import { renderOnboarding } from './ui/onboarding.js';
import { bindCharts } from './ui/charts.js';
import * as A from './ui/actions.js';
import * as ADJ from './ui/adjust.js';
import { startLive, resumeLive, checkRecovery, liveDebug } from './ui/live.js';
import { audio, applyBaseSession } from './services/audio-coach.js';
import * as COACH from './ui/coach.js';
import { initDragDrop } from './ui/dragdrop.js';

const app = document.getElementById('app');
const NAV = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'progress', label: 'Progress', icon: 'progress' },
  { id: 'profile', label: 'Profile', icon: 'profile' },
];

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  return { name: name || 'today', arg };
}

function shell(content, active) {
  const links = (cls) => NAV.map((n) => `<a href="#/${n.id}" class="${active === n.id ? 'active' : ''}" ${active === n.id ? 'aria-current="page"' : ''}>${icon(n.icon)}<span>${n.label}</span></a>`).join('');
  return `<div class="shell">
    <nav class="side-nav" aria-label="Main"><div class="brand"><span class="brand-mark">${icon('bolt')}</span>Stride</div>${links()}</nav>
    <main class="main" id="view">${content}</main>
    <nav class="bottom-nav" aria-label="Main">${links()}</nav>
  </div>${navigator.onLine ? '' : `<span class="chip offline-pill">${icon('wifiOff', 'xs')} Offline</span>`}`;
}

let lastRoute = null;
function render() {
  if (!store.state.loaded) return;
  const r = route();
  const hasProfile = !!store.state.profile?.inputs;
  if (!hasProfile || r.name === 'onboarding') {
    if (lastRoute === 'onboarding') return; // onboarding manages its own re-renders
    lastRoute = 'onboarding';
    renderOnboarding(app, { onDone: () => { lastRoute = null; render(); } });
    return;
  }
  if (r.name === 'edit-profile' || r.name === 'new-plan') {
    if (lastRoute === r.name) return;
    lastRoute = r.name;
    renderOnboarding(app, { editing: true, startAt: r.name === 'new-plan' ? 'goal' : null, onDone: () => { lastRoute = null; location.hash = '#/today'; render(); } });
    return;
  }
  if (r.name === 'live') { lastRoute = 'live'; if (!resumeLive(() => { location.hash = '#/today'; })) location.hash = '#/today'; return; }
  const views = { today: renderToday, plan: renderPlan, calendar: renderCalendar, progress: renderProgress, profile: renderProfile };
  const view = views[r.name] || renderToday;
  const scroll = lastRoute === r.name ? window.scrollY : 0;
  app.innerHTML = shell(view(), views[r.name] ? r.name : 'today');
  bindCharts(app);
  if (r.name === 'calendar') initDragDrop(app);
  if (r.name === 'profile') mountProfileInfo(app);
  if (lastRoute !== r.name) window.scrollTo(0, 0); else window.scrollTo(0, scroll);
  lastRoute = r.name;
}

// ---------- global click dispatch ----------
const ACTIONS = {
  'open-workout': (el) => A.openWorkout(el.dataset.id),
  'start-workout': (el) => { closeAllSheets(); startLive(el.dataset.id, () => render()); },
  'resume-live': () => resumeLive(() => render()),
  'log-run': (el) => A.openLogRun(null, { date: el.dataset.date }),
  'add-workout': (el) => A.openAddWorkout(el.dataset.date),
  'toggle-week': (el) => { toggleWeek(Number(el.dataset.week)); render(); },
  'expand-all': () => { expandAll(); render(); },
  'adjust-plan': () => ADJ.openAdjust(),
  'plan-settings': () => ADJ.openPlanSettings(),
  'edit-paces': () => ADJ.openEditPaces(),
  'remove-adjustment': (el) => ADJ.removeAdjustment(el.dataset.id),
  'export-ics': () => ADJ.exportIcs(),
  'cal-prev': () => { calNav(-1); render(); },
  'cal-next': () => { calNav(1); render(); },
  'cal-mode': (el) => { cal.mode = el.dataset.mode; cal.anchor = cal.selected || cal.anchor; render(); },
  'cal-select': (el) => {
    const d = el.dataset.date;
    if (cal.selected === d && window.innerWidth < 960) {
      const items = store.workoutsOn(d).filter((w) => w.type !== 'rest');
      if (items.length === 1) { A.openWorkout(items[0].id); return; }
    }
    cal.selected = d; render();
    if (window.innerWidth < 960) document.querySelector('.grid-2 .col:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'view-activity': (el) => A.viewActivity(el.dataset.id),
  missed: (el) => { closeAllSheets(); setTimeout(() => COACH.openMissed(el.dataset.id), 150); },
  checkin: () => COACH.openCheckin(),
  'pace-suggestion': () => COACH.openPaceSuggestion(),
  assessment: () => COACH.openAssessmentPicker(),
  'change-history': () => COACH.openHistory(),
  'undo-last': async () => { const r = await store.undoLast(); if (!r.ok) toast(r.reason); else COACH.showSummary(r.summary); },
  'prog-range': (el) => { prog.range = Number(el.dataset.range); render(); },
  'add-race': () => openAddRace(),
  'set-pref': (el) => { prefs.set({ [el.dataset.key]: el.dataset.val }); applyPrefs(); applyBaseSession(); render(); },
  'test-audio': () => { audio.unlock(); audio.beep({ times: 2, force: true }); audio.vibrate([150]); audio.say('Interval 1 of 5. 800 metres. Increase your pace.', { force: true, cat: 'transitions', prio: 3 }); },
  'export-data': () => exportData(),
  'import-data': () => document.querySelector('[data-import-file]')?.click(),
  'reset-data': () => resetData(),
  'add-benchmark': () => openBenchmark(),
  'del-benchmark': (el) => deleteBenchmark(Number(el.dataset.i)),
  'injury-status': () => openInjuryStatus(),
  'view-archived': (el) => viewArchived(el.dataset.id),
  'install': async () => { const p = window.__installPrompt; if (p) { p.prompt(); await p.userChoice; window.__installPrompt = null; render(); } },
  insight: async (el) => {
    if (el.dataset.insight === 'hold-volume') await ADJ.holdVolume();
    if (el.dataset.insight === 'vdot') { await store.setVdot(Number(el.dataset.value), 'performance'); toast('Paces updated'); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && el.dataset.action && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el); return; }
  const sel = (attr, fn) => { const b = e.target.closest(`[${attr}]`); if (b) { fn(b.getAttribute(attr)); return true; } return false; };
  if (sel('data-start-workout', (id) => { closeAllSheets(); startLive(id, () => render()); })) return;
  if (sel('data-log-workout', (id) => { closeAllSheets(); A.openLogRun(id); })) return;
  if (sel('data-move-workout', (id) => { closeAllSheets(); A.openMove(id); })) return;
  if (sel('data-skip-workout', (id) => A.setStatus(id, 'skipped'))) return;
  if (sel('data-missed-workout', (id) => A.setStatus(id, 'missed'))) return;
  if (sel('data-restore-workout', (id) => A.setStatus(id, 'planned'))) return;
  if (sel('data-unlog-workout', (id) => A.unlog(id))) return;
  if (sel('data-rest-instead', (id) => A.restInstead(id))) return;
  if (sel('data-delete-workout', (id) => A.deleteWorkout(id))) return;
  if (sel('data-view-activity', (id) => { closeAllSheets(); A.viewActivity(id); })) return;
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') topSheet()?.close(); });
window.addEventListener('hashchange', () => { closeAllSheets(); render(); });
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
store.subscribe(() => { if (!['onboarding', 'edit-profile', 'new-plan', 'live'].includes(lastRoute)) render(); });

// ---------- boot ----------
async function boot() {
  applyPrefs();
  applyBaseSession(); // mix with Spotify/other music rather than taking over the audio session
  try {
    await store.load();
  } catch (err) {
    app.innerHTML = `<div class="ob"><h1>Storage unavailable</h1><p class="lead">Stride needs IndexedDB to save your training. Private browsing modes can block it. (${esc(err.message || err)})</p></div>`;
    return;
  }
  db.persist(); // ask the browser not to evict our data
  // preferences live in localStorage for instant access and are mirrored to IndexedDB
  prefs.onChange = (p) => { db.put('meta', p, 'prefs').catch(() => {}); };
  try {
    const saved = await db.get('meta', 'prefs');
    if (saved && !localStorage.getItem('stride.prefs')) { prefs.replace(saved); applyPrefs(); }
    else db.put('meta', prefs.get(), 'prefs');
  } catch { /* ignore */ }
  render();
  if (store.state.profile) checkRecovery(() => { location.hash = '#/today'; render(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready — it applies next time you open Stride.', 4000); });
      });
    } catch (e) { console.warn('Service worker registration failed', e); }
  }
}
boot();

// expose for debugging / tests
window.__stride = { store, sessionStore, prefs, live: liveDebug };
