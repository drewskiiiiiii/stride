// Profile, settings, data management and archived plans.

import { esc, icon, openSheet, toast, confirmDialog, downloadFile, opts } from './dom.js';
import { store } from '../core/store.js';
import { prefs } from '../core/storage.js';
import { setUnitPrefs, fmtDuration, fmtDist, parseClock } from '../core/units.js';
import { fmtDate, todayISO } from '../core/dates.js';
import { BENCHMARK_LABEL, BENCHMARK_DIST, GOALS } from '../engine/assessment.js';
import { vdotFromRace, maxHrEstimate } from '../engine/vdot.js';
import { audio, notify, wake, audioCapabilities } from '../services/audio-coach.js';
import { gps } from '../services/gps.js';

const EXP = { beginner: 'Complete beginner', returning: 'Returning runner', recreational: 'Recreational', intermediate: 'Intermediate', advanced: 'Advanced' };

const tog = (key, on, title, sub = '', disabled = false) => `<label class="setting"><div class="grow"><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div><span class="toggle"><input type="checkbox" data-pref="${key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></span></label>`;
const segRow = (key, list, val, title) => `<div class="setting"><div class="grow"><div class="t">${esc(title)}</div></div><div style="width:190px"><div class="seg">${list.map(([v, l]) => `<button data-action="set-pref" data-key="${key}" data-val="${v}" class="${val === v ? 'sel' : ''}">${l}</button>`).join('')}</div></div></div>`;

export function renderProfile() {
  const { profile, plan, plans } = store.state;
  const p = prefs.get();
  const inp = profile?.inputs || {};
  const age = inp.profile?.age;
  const maxHr = inp.profile?.maxHr || maxHrEstimate(age);
  const bench = inp.fitness?.benchmarks || [];
  const archived = plans.filter((x) => x.status === 'archived').sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
  const goal = GOALS.find((g) => g.id === inp.goal?.type);
  const pain = !!plan?.inputs?.injury?.painNow;
  return `<div class="page-head"><div><div class="sub">Settings & data</div><h1>Profile</h1></div></div>
  <div class="grid-2"><div class="col">
    <div class="card fade-in">
      <div class="row" style="gap:14px"><div class="brand-mark" style="width:52px;height:52px;border-radius:16px">${icon('profile', 'lg')}</div>
        <div class="grow"><div style="font-weight:720;font-size:17px">${esc(EXP[inp.fitness?.experience] || 'Runner')}</div><div class="small muted">${age ? `${age} yrs · ` : ''}${inp.profile?.heightCm ? `${inp.profile.heightCm} cm · ` : ''}Max HR ${maxHr}${inp.profile?.maxHr ? '' : ' (est.)'}</div></div></div>
      <div class="divider"></div>
      <dl class="kv"><dt>Goal</dt><dd>${esc(goal?.label || '—')}</dd><dt>Running days</dt><dd>${inp.availability?.daysPerWeek || '—'} / week</dd><dt>Injury status</dt><dd>${pain ? '<span style="color:var(--danger)">Pain reported</span>' : inp.injury?.has ? esc(inp.injury.status === 'previous' ? 'Previous injury' : 'Limitation') : 'None'}</dd></dl>
      <div class="btn-row" style="margin-top:14px"><a class="btn sm" href="#/edit-profile">${icon('edit', 'sm')} Edit profile & goal</a><button class="btn sm ghost" data-action="injury-status">${icon('heart', 'sm')} Injury status</button></div>
    </div>

    <div class="section-title"><h2>Fitness benchmarks</h2><button class="link-btn" data-action="add-benchmark">${icon('plus', 'xs')} Add</button></div>
    <div class="list">${bench.length ? bench.map((b, i) => `<div class="list-item">${icon('trophy', 'sm')}<div class="grow"><div class="t">${esc(BENCHMARK_LABEL[b.dist])} · ${fmtDuration(b.timeSec)}</div><div class="s">${b.date ? esc(fmtDate(b.date, { month: 'short', day: 'numeric', year: 'numeric' })) : 'No date'} · VDOT ${vdotFromRace(BENCHMARK_DIST[b.dist], b.timeSec).toFixed(1)}</div></div><button class="icon-btn plain" data-action="del-benchmark" data-i="${i}" aria-label="Remove">${icon('trash', 'sm')}</button></div>`).join('') : `<div class="list-item"><div class="grow muted small">No benchmarks yet. Add a recent race or time trial for accurate pace zones.</div></div>`}</div>

    <div class="section-title"><h2>Training</h2></div>
    <div class="list">
      <button class="list-item" data-action="plan-settings" ${plan ? '' : 'disabled'}>${icon('settings', 'sm')}<div class="grow"><div class="t">Training preferences</div><div class="s">Days, volume, intensity, strength & mobility, race date</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-action="edit-paces" ${plan ? '' : 'disabled'}>${icon('tempo', 'sm')}<div class="grow"><div class="t">Pace targets</div><div class="s">${plan?.vdot ? `VDOT ${plan.vdot.toFixed(1)}` : 'Effort-based until a benchmark is added'}</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-action="adjust-plan" ${plan ? '' : 'disabled'}>${icon('plane', 'sm')}<div class="grow"><div class="t">Travel, illness & recovery weeks</div></div>${icon('chevR', 'sm chev')}</button>
      <a class="list-item" href="#/new-plan">${icon('plus', 'sm')}<div class="grow"><div class="t">Create a new plan</div><div class="s">Previous plans are archived, never deleted</div></div>${icon('chevR', 'sm chev')}</a>
    </div>

    <div class="section-title"><h2>Archived plans</h2></div>
    <div class="list">${archived.length ? archived.map((a) => `<button class="list-item" data-action="view-archived" data-id="${a.id}">${icon('archive', 'sm')}<div class="grow"><div class="t">${esc(a.name || a.goal?.label)}</div><div class="s">${esc(fmtDate(a.startDate, { month: 'short', day: 'numeric', year: 'numeric' }))} · ${a.totalWeeks} weeks · archived ${esc(fmtDate((a.archivedAt || '').slice(0, 10) || todayISO(), { month: 'short', day: 'numeric' }))}</div></div>${icon('chevR', 'sm chev')}</button>`).join('') : '<div class="list-item"><div class="grow muted small">No archived plans.</div></div>'}</div>
  </div>
  <div class="col">
    <div class="section-title"><h2>Units</h2></div>
    <div class="list">
      ${segRow('distance', [['mi', 'Miles'], ['km', 'Km']], p.distance, 'Distance')}
      ${segRow('pace', [['mi', 'min/mi'], ['km', 'min/km']], p.pace, 'Pace')}
      ${segRow('hr', [['bpm', 'BPM'], ['pct', '% max']], p.hr, 'Heart rate')}
    </div>

    <div class="section-title"><h2>Music & Voice Coach</h2><button class="link-btn" data-action="test-audio">${icon('volume', 'xs')} Test voice</button></div>
    ${(() => { const c = audioCapabilities(); const lab = { yes: 'Supported', experimental: 'Experimental', system: 'Handled by Android', no: 'Not supported here' };
      const modeBtn = (v, l, st) => `<button data-action="set-pref" data-key="musicMode" data-val="${v}" class="${p.musicMode === v ? 'sel' : ''}" ${st === 'no' ? 'disabled style="opacity:.4"' : ''}>${l}</button>`;
      return `<div class="list">
      ${tog('spotifyCompat', p.spotifyCompat !== false, 'Spotify & music compatibility', 'Stride never plays media, never takes over device audio and never controls Spotify. Your music app stays in charge.')}
      ${tog('voice', p.voice, 'Voice Coach', c.speech ? 'Spoken coaching during workouts' : 'Speech is not supported in this browser', !c.speech)}
      <button class="setting" data-action="voice-help" style="width:100%;text-align:left;background:none;border:0;color:inherit;cursor:pointer"><div class="grow"><div class="t">Voice troubleshooting</div><div class="s">Can’t hear the coach? Run a check and see what was announced</div></div>${icon('info', 'xs')}</button>
      <div class="setting" style="flex-wrap:wrap"><div class="grow"><div class="t">During announcements</div><div class="s">${{ over: 'Speak over the music without changing it.', duck: 'Lower the music briefly, then restore it.', pause: 'Pause the music for the announcement, then resume it.' }[p.musicMode] || ''}</div></div>
        <div class="seg" style="width:100%;margin-top:8px">${modeBtn('over', 'Over music', c.over)}${modeBtn('duck', 'Duck music', c.duck)}${modeBtn('pause', 'Pause music', c.pause)}</div>
        <div class="tiny muted" style="margin-top:6px">On this device — over music: ${lab[c.over]} · ducking: ${lab[c.duck]} · pausing: ${lab[c.pause]}.${c.duck === 'system' ? ' Android usually lowers music for spoken announcements on its own; the app can’t change that.' : ''}${c.session ? ' Ducking and pausing use the browser’s Audio Session API, which behaves inconsistently across iOS versions — try it with your music before relying on it.' : ''}</div></div>
      ${c.platform === 'ios' && c.session ? tog('mixAmbient', !!p.mixAmbient, 'Quiet mixing mode (iPhone)', 'Blends more politely with music, but iOS then mutes the coach whenever the Ring/Silent switch is on. Leave off unless your phone is never on silent.') : ''}
      ${segRow('cueLevel', [['minimal', 'Minimal'], ['standard', 'Standard'], ['detailed', 'Detailed']], p.cueLevel, 'Announcement frequency')}
      <div class="setting" style="padding-top:0"><div class="grow s small muted">${{ minimal: 'Only interval transitions, safety and workout complete.', standard: 'Transitions, 10-second warnings, distance remaining, halfway, pace corrections and a time/distance update every 10 minutes.', detailed: 'Everything in Standard plus time, distance and pace updates at your chosen interval.' }[p.cueLevel]}</div></div>
      ${tog('voiceTransitions', p.voiceTransitions !== false, 'Interval transitions', 'New interval, recovery, warm-up, cool-down, workout start and finish')}
      ${tog('voiceCues', p.voiceCues !== false, 'Workout cues', 'Countdowns, halfway, distance remaining, upcoming intervals')}
      ${tog('voicePace', p.voicePace !== false, 'Pace & speed updates', 'Pace corrections, treadmill speed comparisons, periodic updates')}
      ${tog('voiceMotivation', p.voiceMotivation !== false, 'Motivational coaching', 'Short encouragement at milestones — skipped whenever something more important is being said')}
      <div class="setting"><div class="grow s small muted">Announcements never overlap: interval transitions and safety messages (like “GPS signal lost”) go first, and anything that is out of date is dropped rather than read late. ${c.platform === 'ios' ? 'On iPhone, speech and beeps only play while Stride is on screen; when the screen locks iOS suspends the page (your music keeps playing, and timing catches up when you return).' : c.platform === 'android' ? 'On Android, announcements may pause while the screen is off depending on battery settings; timing always catches up.' : ''}</div></div>
    </div>`; })()}

    <div class="section-title"><h2>Treadmill</h2></div>
    <div class="list">
      ${segRow('speedUnit', [['auto', 'Auto'], ['mph', 'mph'], ['kmh', 'km/h']], p.speedUnit, 'Speed unit')}
      ${segRow('showSpeeds', [['auto', 'Auto'], ['on', 'Always'], ['off', 'Never']], p.showSpeeds, 'Show treadmill speeds on workouts')}
      ${segRow('tmDisplay', [['speed', 'Speed'], ['pace', 'Pace']], p.tmDisplay, 'Live treadmill display')}
      ${tog('tmSpeakTarget', p.tmSpeakTarget, 'Speak target speed', '“Increase the treadmill to 7.2 miles per hour for this tempo interval.”')}
      ${tog('tmReminders', p.tmReminders, 'Speed-change reminders', '“Your next interval begins in 30 seconds. Target speed is 7.5.”')}
      ${tog('tmCompare', p.tmCompare, 'Compare my speed with the target', '“You’re currently running at 6.0. Your target is 6.8.”')}
      ${tog('tmPeriodic', p.tmPeriodic, 'Periodic speed & distance updates', `Every ${p.updateEvery || 5} min: speed, distance covered and distance to go`)}
      <div class="setting"><div class="grow s small muted">Speeds round to 0.1 increments. Stride never changes your treadmill — you adjust the belt and confirm the speed in the app.</div></div>
    </div>

    <div class="section-title"><h2>Workout audio & feedback</h2><button class="link-btn" data-action="test-audio">${icon('volume', 'xs')} Test</button></div>
    <div class="list">
      ${p.cueLevel === 'detailed' || p.tmPeriodic ? `<div class="setting"><div class="grow"><div class="t">Update every</div></div><select class="input" data-pref-select="updateEvery" style="max-width:140px">${opts([1, 2, 5, 10].map((v) => ({ value: v, label: `${v} min` })), p.updateEvery || 5)}</select></div>` : ''}
      ${segRow('startCountdown', [['3', '3 s'], ['10', '10 s']], String(p.startCountdown), 'Start countdown')}
      ${tog('distanceCues', p.distanceCues, 'Distance remaining', '“You have 200 metres remaining” on distance intervals')}
      ${tog('beeps', p.beeps, 'Beeps', 'Countdown beeps before each change')}
      ${tog('countdown', p.countdown, '10-second warnings', '“Your interval begins in 10 seconds”')}
      ${tog('halfway', p.halfway, 'Halfway announcements')}
      ${tog('paceAlerts', p.paceAlerts, 'Pace alerts', 'Speak up when you drift outside your target (GPS)')}
      ${tog('vibration', p.vibration, 'Vibration', audio.vibrateSupported ? 'Haptic feedback on phase changes' : 'Not supported on this device (iPhone Safari has no web vibration)', !audio.vibrateSupported)}
      ${tog('keepAwake', p.keepAwake, 'Keep screen on during workouts', wake.supported ? 'Recommended — browsers pause timers and GPS when the screen locks' : 'Wake Lock not supported in this browser')}
      <div class="setting"><div class="grow"><div class="t">Voice speed</div></div><input type="range" min="0.7" max="1.3" step="0.05" value="${p.voiceRate}" data-pref-range="voiceRate" style="width:150px"></div>
      <div class="setting"><div class="grow"><div class="t">Cue volume</div></div><input type="range" min="0.2" max="1" step="0.05" value="${p.volume}" data-pref-range="volume" style="width:150px"></div>
    </div>

    <div class="section-title"><h2>Appearance & notifications</h2></div>
    <div class="list">
      ${segRow('theme', [['dark', 'Dark'], ['light', 'Light']], p.theme, 'Theme')}
      ${tog('stepNotifications', p.stepNotifications && notify.permission === 'granted', 'Workout notifications', notify.supported ? `Show phase changes as notifications while the app is in the background${notify.permission === 'denied' ? ' (blocked in browser settings)' : ''}` : 'Notifications not supported here (on iPhone, install to Home Screen first)', !notify.supported)}
      <button class="list-item" data-action="export-ics" ${plan ? '' : 'disabled'}>${icon('calendar', 'sm')}<div class="grow"><div class="t">Workout reminders</div><div class="s">Browsers can’t schedule reminders offline — export your plan to your phone’s calendar for reliable alerts</div></div>${icon('chevR', 'sm chev')}</button>
    </div>

    <div class="section-title"><h2>Your data</h2></div>
    <div class="list">
      <button class="list-item" data-action="export-data">${icon('download', 'sm')}<div class="grow"><div class="t">Export backup</div><div class="s">${p.lastBackupAt ? `Last backup ${Math.round((Date.now() - new Date(p.lastBackupAt)) / 86400000)} day(s) ago` : '<span style="color:var(--warn)">Never backed up</span>'} · profile, plans, history, GPS routes, settings</div></div></button>
      <button class="list-item" data-action="import-data">${icon('upload', 'sm')}<div class="grow"><div class="t">Import backup</div><div class="s">Replaces all data on this device</div></div></button>
      <button class="list-item" data-action="reset-data" style="color:var(--danger)">${icon('trash', 'sm')}<div class="grow"><div class="t">Reset all data</div><div class="s">Permanently delete everything on this device</div></div></button>
    </div>
    <input type="file" accept="application/json,.json" data-import-file hidden>

    <div class="section-title"><h2>About this device</h2></div>
    <div class="card small" data-device-info>
      <dl class="kv">
        <dt>Offline ready</dt><dd data-di="sw">Checking…</dd>
        <dt>Installed as app</dt><dd>${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'Yes' : 'No'}</dd>
        <dt>GPS</dt><dd>${gps.supported ? (gps.secure ? 'Available' : 'Needs HTTPS') : 'Unavailable'}</dd>
        <dt>Storage</dt><dd data-di="storage">—</dd>
        <dt>Version</dt><dd>2.5.1 · data v2</dd>
      </dl>
      ${!(matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? `<div class="notice" style="margin-top:12px">${icon('download', 'sm')}<div><b>Install Stride:</b> on iPhone tap <b>Share → Add to Home Screen</b> in Safari. On Android tap <b>⋮ → Install app</b> in Chrome.${window.__installPrompt ? ' <button class="btn sm" data-action="install">Install now</button>' : ''}</div></div>` : ''}
    </div>
  </div></div>`;
}

export async function mountProfileInfo(root) {
  const sw = root.querySelector('[data-di="sw"]');
  if (sw) {
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    sw.textContent = reg?.active ? 'Yes — works without internet' : navigator.serviceWorker ? 'Not yet (reload once online)' : 'Not supported';
  }
  const st = root.querySelector('[data-di="storage"]');
  if (st && navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    st.textContent = `${(e.usage / 1024 / 1024).toFixed(1)} MB used${persisted ? ' · persistent' : ''}`;
  }
  root.querySelectorAll('[data-pref]').forEach((el) => el.onchange = async () => {
    const k = el.dataset.pref;
    if (k === 'stepNotifications' && el.checked) {
      const r = await notify.request();
      if (r !== 'granted') { el.checked = false; toast('Notification permission was not granted'); return; }
    }
    prefs.set({ [k]: el.checked });
    if (k === 'spotifyCompat' || k === 'mixAmbient') (await import('../services/audio-coach.js')).applyBaseSession();
    if (k === 'voice' && !el.checked) audio.stop();
    toast('Saved');
  });
  root.querySelectorAll('[data-pref-range]').forEach((el) => el.onchange = () => { prefs.set({ [el.dataset.prefRange]: Number(el.value) }); });
  root.querySelectorAll('[data-pref-select]').forEach((el) => el.onchange = () => { prefs.set({ [el.dataset.prefSelect]: Number(el.value) }); toast('Saved'); });
  const file = root.querySelector('[data-import-file]');
  if (file) file.onchange = async () => {
    let data;
    try { data = JSON.parse(await file.files[0].text()); } catch { toast('That file is not valid JSON'); file.value = ''; return; }
    file.value = '';
    openImportPreview(data);
  };
}

export function openImportPreview(data) {
  const v = store.validateBackup(data);
  const c = v.counts || {};
  const sh = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Import backup</div><h2>${v.ok ? 'Review backup' : 'Can’t import this file'}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${v.errors.map((e) => `<div class="notice danger">${icon('alert', 'sm')}<div>${esc(e)}</div></div>`).join('')}
    ${v.ok ? `<dl class="kv"><dt>Exported</dt><dd>${esc((v.exportedAt || '—').slice(0, 10))}</dd><dt>Data version</dt><dd>v${v.fileVersion}</dd><dt>Plans</dt><dd>${c.plans}</dd><dt>Workouts</dt><dd>${c.workouts}</dd><dt>Activities</dt><dd>${c.activities}</dd><dt>Race results</dt><dd>${c.races}</dd></dl>
      <div class="divider"></div>
      ${v.duplicates.activities || v.duplicates.plans ? `<div class="notice">${icon('info', 'sm')}<div><b>Duplicates detected:</b> ${v.duplicates.activities} activit${v.duplicates.activities === 1 ? 'y' : 'ies'} and ${v.duplicates.plans} plan(s) already exist on this device. <b>Merge</b> skips them.</div></div>` : ''}
      ${v.warnings.map((w) => `<div class="notice warn">${icon('alert', 'sm')}<div>${esc(w)}</div></div>`).join('')}
      <div class="stack" style="margin-top:14px">
        <button class="btn primary block" data-merge>${icon('upload', 'sm')} Merge — add new history, keep my current plan</button>
        <button class="btn danger block" data-replace>Replace everything on this device</button>
      </div>` : ''}`, {
    onMount: (el) => {
      const m = el.querySelector('[data-merge]'), r = el.querySelector('[data-replace]');
      if (m) m.onclick = async () => { await store.importData(data, { mode: 'merge' }); sh.close(); toast('Backup merged — duplicates skipped'); };
      if (r) r.onclick = async () => {
        const ok = await confirmDialog({ title: 'Replace all data?', body: 'Everything currently on this device will be replaced by the backup.', confirm: 'Replace', danger: true, requireText: 'REPLACE' });
        if (!ok) return;
        await store.importData(data, { mode: 'replace' });
        if (data.prefs) prefs.replace(data.prefs);
        applyPrefs(); sh.close(); toast('Backup restored');
      };
    },
  });
}

export function applyPrefs() {
  const p = prefs.get();
  setUnitPrefs({ distance: p.distance, pace: p.pace });
  document.documentElement.dataset.theme = p.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.theme === 'light' ? '#f3f4f6' : '#0a0b0d');
}

export async function exportData() {
  const data = await store.exportData();
  data.prefs = prefs.get();
  downloadFile(`stride-backup-${todayISO()}.json`, JSON.stringify(data, null, 1));
  prefs.set({ lastBackupAt: new Date().toISOString() });
  const n = data.stores;
  openSheet(`<div class="sheet-head"><div><div class="small muted">Backup created</div><h2>Your data is saved</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="notice ok">${icon('check', 'sm')}<div>Downloaded <b>stride-backup-${todayISO()}.json</b> with ${n.plans.length} plan(s), ${n.workouts.length} workouts, ${n.activities.length} activities, your profile and settings.</div></div>
    <p class="small muted" style="margin-top:12px">Keep it somewhere safe (Files, iCloud Drive, Google Drive). Import it on any device under Profile → Import backup.</p>
    <button class="btn primary block" data-close>Done</button>`);
}

export async function resetData() {
  const ok = await confirmDialog({ title: 'Reset all data?', body: 'This permanently deletes your profile, plans, workout history and settings from this device. Export a backup first if you might need it.', confirm: 'Delete everything', danger: true, requireText: 'RESET' });
  if (!ok) return;
  await store.resetAll();
  prefs.reset();
  try { localStorage.clear(); } catch { /* ignore */ }
  location.hash = '#/';
  location.reload();
}

export function openBenchmark() {
  const s = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Fitness benchmark</div><h2>Add a result</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <label class="field"><span class="lbl">Distance</span><select class="input" data-b="dist">${opts(['mile', '5k', '10k', 'half', 'marathon'].map((k) => ({ value: k, label: BENCHMARK_LABEL[k] })), '5k')}</select></label>
    <div class="input-group"><label class="field grow"><span class="lbl">Time</span><input class="input" data-b="time" placeholder="mm:ss or h:mm:ss"></label><label class="field grow"><span class="lbl">Date</span><input class="input" type="date" data-b="date" max="${todayISO()}" value="${todayISO()}"></label></div>
    <button class="btn primary lg block" data-b-save>Save & update paces</button>`, {
    onMount: (el) => el.querySelector('[data-b-save]').onclick = async () => {
      const g = (k) => el.querySelector(`[data-b="${k}"]`).value;
      const t = parseClock(g('time'));
      if (!t) { toast('Enter a time'); return; }
      const b = { dist: g('dist'), timeSec: t, date: g('date') };
      const profile = store.state.profile || { inputs: { fitness: {} } };
      const inputs = { ...profile.inputs, fitness: { ...profile.inputs.fitness, benchmarks: [...(profile.inputs.fitness?.benchmarks || []), b] } };
      const answers = profile.answers ? { ...profile.answers, benchmarks: [...(profile.answers.benchmarks || []), { ...b, timeText: fmtDuration(t) }] } : profile.answers;
      await store.saveProfile({ ...profile, inputs, answers });
      if (store.state.plan) {
        const v = Math.round(vdotFromRace(BENCHMARK_DIST[b.dist], t) * 10) / 10;
        await store.setVdot(v, 'benchmark');
        await store.regenerate((pi) => { pi.fitness.benchmarks = inputs.fitness.benchmarks; pi.vdotOverride = v; });
      }
      s.close(); toast('Benchmark saved — paces updated');
    },
  });
}

export async function deleteBenchmark(i) {
  const profile = store.state.profile; if (!profile) return;
  const list = (profile.inputs.fitness.benchmarks || []).slice(); list.splice(i, 1);
  const alist = (profile.answers?.benchmarks || []).slice(); alist.splice(i, 1);
  await store.saveProfile({ ...profile, inputs: { ...profile.inputs, fitness: { ...profile.inputs.fitness, benchmarks: list } }, answers: profile.answers ? { ...profile.answers, benchmarks: alist } : profile.answers });
  toast('Benchmark removed');
}

export function openInjuryStatus() {
  const plan = store.state.plan;
  const inj = plan?.inputs?.injury || store.state.profile?.inputs?.injury || {};
  const s = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Injury & recovery</div><h2>Current status</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="notice warn" style="margin-bottom:14px">${icon('alert', 'sm')}<div>Stride doesn’t diagnose injuries or prescribe rehab. If something hurts, please see a doctor or physiotherapist.</div></div>
    <label class="setting" style="padding:10px 2px"><div class="grow"><div class="t">I currently have pain when running</div><div class="s">Holds volume and removes hard sessions</div></div><span class="toggle"><input type="checkbox" data-i="pain" ${inj.painNow ? 'checked' : ''}><span></span></span></label>
    <label class="setting" style="padding:10px 2px"><div class="grow"><div class="t">I have a limitation or previous injury</div><div class="s">Uses gradual progression and at most one hard session per week</div></div><span class="toggle"><input type="checkbox" data-i="has" ${inj.has ? 'checked' : ''}><span></span></span></label>
    <label class="field" style="margin-top:12px"><span class="lbl">Notes</span><textarea class="input" data-i="notes">${esc(inj.notes || '')}</textarea></label>
    <button class="btn primary lg block" data-i-save>Save & update plan</button>`, {
    onMount: (el) => el.querySelector('[data-i-save]').onclick = async () => {
      const pain = el.querySelector('[data-i="pain"]').checked;
      const has = el.querySelector('[data-i="has"]').checked || pain;
      const injury = { ...inj, has, painNow: pain, status: has ? (inj.status && inj.status !== 'none' ? inj.status : 'current') : 'none', notes: el.querySelector('[data-i="notes"]').value };
      const profile = store.state.profile;
      if (profile) await store.saveProfile({ ...profile, inputs: { ...profile.inputs, injury }, answers: profile.answers ? { ...profile.answers, painNow: pain, injuryStatus: injury.status, injuryNotes: injury.notes } : profile.answers });
      if (plan) await store.regenerate((pi) => { pi.injury = injury; });
      s.close(); toast(pain ? 'Plan updated — volume held, no hard sessions' : 'Injury status updated');
    },
  });
}

export async function viewArchived(id) {
  const p = store.state.plans.find((x) => x.id === id);
  if (!p) return;
  const ws = await store.archivedWorkouts(id);
  const runs = ws.filter((w) => w.type !== 'rest' && w.type !== 'strength' && w.type !== 'mobility');
  const done = runs.filter((w) => w.status === 'completed').length;
  const s = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Archived plan</div><h2>${esc(p.name || p.goal?.label)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <dl class="kv"><dt>Started</dt><dd>${esc(fmtDate(p.startDate, { month: 'short', day: 'numeric', year: 'numeric' }))}</dd><dt>Length</dt><dd>${p.totalWeeks} weeks</dd><dt>Peak week</dt><dd>${fmtDist(p.summary?.peakWeekly)}</dd><dt>Workouts completed</dt><dd>${done} / ${runs.length}</dd>${p.vdot ? `<dt>VDOT</dt><dd>${p.vdot.toFixed(1)}</dd>` : ''}</dl>
    <p class="small muted" style="margin-top:14px">Completed workouts from this plan remain in your Progress history.</p>
    <button class="btn danger block" data-del style="margin-top:8px">${icon('trash', 'sm')} Delete archived plan</button>`, {
    onMount: (el) => el.querySelector('[data-del]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Delete this archived plan?', body: 'The plan and its scheduled workouts are removed. Logged activities stay in your history.', confirm: 'Delete', danger: true });
      if (!ok) return;
      await store.deleteArchived(id); s.close(); toast('Archived plan deleted');
    },
  });
}
