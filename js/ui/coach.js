// Coaching UI: missed-workout adjustments, change summaries, recovery check-ins,
// adaptive pace suggestions, assessments, post-workout evaluation and change history.

import { esc, icon, openSheet, toast, closeAllSheets } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, addDays, fmtDate, fmtLongDate, startOfWeek } from '../core/dates.js';
import { fmtDist, fmtPaceRange, fmtDuration } from '../core/units.js';
import { analyzeMissed, summaryToText } from '../engine/scheduler.js';
import { effectiveStatus } from '../engine/adjustments.js';
import { analyzeTrends, recommendFromCheckin, reduceWorkout, assessmentDue, evaluateWorkout, PACE_GROUPS } from '../engine/performance.js';
import { assessmentWorkout, easyRun } from '../engine/workouts.js';
import { isRun, isHard, estimateWorkout } from '../engine/workout-utils.js';
import { ZONE_INFO } from '../engine/vdot.js';

const today = () => todayISO();

// ---------------------------------------------------------------- change summary
export function showSummary(s, { title } = {}) {
  if (!s) return;
  const lines = summaryToText(s);
  const mileage = s.mileage.map((m) => `<tr><td>Week of ${esc(fmtDate(m.week, { month: 'short', day: 'numeric' }))}</td><td class="r muted">${fmtDist(m.before)}</td><td class="r">→ <b>${fmtDist(m.after)}</b></td></tr>`).join('');
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Plan adjustment summary</div><h2>${esc(title || s.title || 'Plan updated')}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${s.reason ? `<div class="notice accent">${icon('sparkle', 'sm')}<div><b>Why</b><div>${esc(s.reason)}</div></div></div>` : ''}
    <div class="upper muted" style="margin:16px 0 8px">What changed</div>
    ${s.note ? `<p class="small muted" style="margin:0 0 8px">${esc(s.note)}</p>` : ''}
    ${lines.length ? `<div class="list">${lines.map((l) => `<div class="list-item">${icon(l.startsWith('Moved') ? 'move' : l.startsWith('Removed') ? 'x' : l.startsWith('Added') ? 'plus' : 'edit', 'sm')}<div class="grow small">${esc(l)}</div></div>`).join('')}${s.total > lines.length ? `<div class="list-item small muted">…and ${s.total - lines.length} more</div>` : ''}</div>` : '<p class="muted small">No workouts needed to change — your schedule stays as it was.</p>'}
    <div class="upper muted" style="margin:16px 0 8px">Weekly mileage</div>
    ${mileage ? `<table class="lap-table">${mileage}</table>` : '<p class="muted small">Weekly mileage is unchanged.</p>'}
    ${s.race ? `<div class="notice ${s.race.ok ? 'ok' : 'warn'}" style="margin-top:14px">${icon(s.race.ok ? 'flag' : 'alert', 'sm')}<div><b>Race target</b><div>${esc(s.race.text)}</div></div></div>` : ''}
    <p class="tiny muted" style="margin-top:12px">Completed workouts and history are never changed. See all changes under Plan → Change history.</p>
    <div class="btn-row" style="margin-top:6px">${store.canUndo() && !/^Undone/.test(s.title || '') ? `<button class="btn ghost" data-undo>${icon('refresh', 'sm')} Undo</button>` : ''}<button class="btn primary" data-close>Got it</button></div>`, {
    onMount: (el, api) => { const u = el.querySelector('[data-undo]'); if (u) u.onclick = async () => { api.close(); const r = await store.undoLast(); if (!r.ok) toast(r.reason); else setTimeout(() => showSummary(r.summary), 250); }; },
  });
}

// ---------------------------------------------------------------- missed workouts
export function pendingMissed() {
  const t = today();
  return store.state.workouts.filter((w) => (isRun(w) || w.type === 'strength') && !w.missedHandled && w.date >= addDays(t, -7) && effectiveStatus(w, t) === 'missed')
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function openMissed(id) {
  const w = store.workout(id);
  if (!w) return;
  const r = analyzeMissed(store.state.workouts, w, { plan: store.state.plan, today: today() });
  let choice = r.options.findIndex((o) => o.primary);
  if (choice < 0) choice = 0;
  const render = () => `
    <div class="sheet-head"><div><div class="small muted">Missed ${esc(fmtDate(w.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</div><h2>${esc(w.title)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="card flat"><div class="upper muted" style="margin-bottom:8px">Coach’s analysis</div><ul class="tips" style="font-size:13.5px">${r.analysis.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
    <div class="upper muted" style="margin:16px 0 8px">Options</div>
    <div class="options">${r.options.map((o, i) => `<button class="opt ${i === choice ? 'sel' : ''}" data-ch="${i}"><span class="radio"></span><span class="grow"><div class="ot">${esc(o.label)}${o.primary ? ' <span class="chip accent" style="margin-left:4px">Recommended</span>' : ''}</div><div class="os">${esc(o.desc)}</div></span></button>`).join('')}</div>
    <p class="tiny muted" style="margin-top:10px">Missed sessions are never crammed into the following days.</p>
    <button class="btn primary lg block" data-apply style="margin-top:6px">${icon('check', 'sm')} Apply</button>`;
  const sh = openSheet(render(), { onMount: bind });
  function bind(el) {
    el.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => { choice = Number(b.dataset.ch); sh.set(render()); });
    el.querySelector('[data-apply]').onclick = async () => {
      const o = r.options[choice];
      el.querySelector('[data-apply]').disabled = true;
      const summary = await store.applyChange({ updates: o.updates, adjustments: o.adjustments, title: `Missed: ${w.title}`, reason: o.desc });
      sh.close();
      setTimeout(() => showSummary(summary, { title: o.label }), 250);
    };
  }
}

// ---------------------------------------------------------------- recovery check-in
const SCALE = {
  legs: ['Fresh', 'Good', 'A bit heavy', 'Sore', 'Very sore'],
  fatigue: ['Energised', 'Normal', 'Slightly tired', 'Tired', 'Exhausted'],
  sleep: ['Great', 'Good', 'Average', 'Poor', 'Very poor'],
};

export function checkinNeeded() {
  const t = today();
  if (store.state.meta.checkins?.[t]) return false;
  return store.workoutsOn(t).some((w) => (isHard(w) || w.type === 'long') && w.status === 'planned');
}

export function openCheckin() {
  const t = today();
  const c = { legs: 2, fatigue: 2, sleep: 2, pain: 'none', ...(store.state.meta.checkins?.[t] || {}) };
  const q = (k, title) => `<div class="field"><span class="lbl">${title}</span><div class="seg" style="flex-wrap:wrap">${SCALE[k].map((l, i) => `<button type="button" data-k="${k}" data-v="${i + 1}" class="${c[k] === i + 1 ? 'sel' : ''}" style="font-size:12px;padding:8px 4px">${l}</button>`).join('')}</div></div>`;
  const render = () => `
    <div class="sheet-head"><div><div class="small muted">Daily check-in · ${esc(fmtDate(t))}</div><h2>How are you feeling?</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${q('legs', 'How do your legs feel?')}${q('fatigue', 'How fatigued are you?')}${q('sleep', 'How well did you sleep?')}
    <div class="field"><span class="lbl">Any pain?</span><div class="seg">${[['none', 'None'], ['mild', 'Mild / niggle'], ['significant', 'Significant']].map(([v, l]) => `<button type="button" data-k="pain" data-v="${v}" class="${c.pain === v ? 'sel' : ''}">${l}</button>`).join('')}</div></div>
    <button class="btn primary lg block" data-go>Get recommendation</button>`;
  const sh = openSheet(render(), { onMount: bind });
  function bind(el) {
    el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { c[b.dataset.k] = b.dataset.k === 'pain' ? b.dataset.v : Number(b.dataset.v); sh.set(render()); });
    el.querySelector('[data-go]').onclick = async () => {
      const w = store.workoutsOn(t).find((x) => isRun(x) && x.status === 'planned');
      const recentHard = store.state.workouts.some((x) => x.date === addDays(t, -1) && x.status === 'completed' && (isHard(x) || x.type === 'long'));
      const rec = recommendFromCheckin(c, w, { recentHard });
      await store.saveCheckin(t, { ...c, rec: rec.level, at: Date.now() });
      sh.close();
      setTimeout(() => showCheckinResult(rec, w), 200);
    };
  }
}

function showCheckinResult(rec, w) {
  const labels = { easy: 'Replace with an easy run', reduce: 'Reduce today’s workout', rest: 'Take a rest day instead' };
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Recovery check-in</div><h2>${esc(rec.title)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="notice ${rec.medical ? 'danger' : rec.level === 'go' ? 'ok' : 'warn'}">${icon(rec.medical ? 'alert' : rec.level === 'go' ? 'check' : 'heart', 'sm')}<div>${esc(rec.body)}</div></div>
    ${w ? `<p class="small muted" style="margin:14px 0 8px">Today: <b style="color:var(--text)">${esc(w.title)}</b></p>` : ''}
    <div class="stack" style="margin-top:8px">${(rec.options || []).map((o, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'} block" data-opt="${o}">${esc(labels[o])}</button>`).join('')}
    <button class="btn ${rec.options?.length ? 'ghost' : 'primary'} block" data-close>${rec.level === 'go' ? 'Let’s go' : 'Proceed as planned'}</button></div>
    ${rec.flagInjury ? '<p class="tiny muted" style="margin-top:10px">Tip: set “I currently have pain” under Profile → Injury status so the plan stays conservative until you are cleared.</p>' : ''}`, {
    onMount: (el, api) => el.querySelectorAll('[data-opt]').forEach((b) => b.onclick = async () => {
      const summary = await applyCheckinOption(b.dataset.opt, w);
      api.close();
      setTimeout(() => showSummary(summary, { title: labels[b.dataset.opt] }), 250);
    }),
  });
}

async function applyCheckinOption(opt, w) {
  const plan = store.state.plan;
  if (!w) return null;
  const reason = { easy: 'Your check-in showed you are not fully recovered, so today’s hard session became an easy run. The rest of the week is unchanged.', reduce: 'Based on your check-in, today’s workout was shortened (about two-thirds of the work at the same paces).', rest: 'Based on your check-in, today is now a rest day. Nothing is moved later in the week — no catching up.' }[opt];
  let updates;
  if (opt === 'rest') {
    updates = [{ ...w, status: 'skipped', skipReason: 'check-in rest' }, { id: `${w.planId}-${w.date}-rest`, planId: w.planId, date: w.date, week: w.week, phase: w.phase, slot: 'rest', type: 'rest', title: 'Recovery Rest Day', purpose: 'Rest day chosen after your recovery check-in.', steps: [], tips: [], status: 'planned', source: 'user', estDistance: 0, estDuration: 0 }];
  } else {
    const ctx = { paces: plan?.paces, assumedEasy: plan?.assumedEasy || 420, pref: plan?.inputs?.prefs?.mode || 'distance', unit: plan?.inputs?.unit, experience: plan?.inputs?.fitness?.experience };
    const built = opt === 'easy' ? { ...easyRun(ctx, Math.max(3000, (w.estDistance || 6000) * 0.7)), title: 'Easy Run (adjusted)' } : (isHard(w) || w.type === 'long' ? reduceWorkout(w, w.type === 'long' ? 0.75 : 0.67) : reduceWorkout(w, 0.67));
    const est = estimateWorkout(built.steps, plan?.paces, plan?.assumedEasy || 420);
    updates = [{ ...w, type: opt === 'easy' ? 'easy' : w.type, title: built.title, purpose: opt === 'easy' ? 'Adjusted after your check-in: easy aerobic running instead of the planned hard session.' : w.purpose, steps: built.steps, tips: built.tips || w.tips, quality: false, original: w.original || { title: w.title, type: w.type, steps: w.steps, purpose: w.purpose }, estDistance: est.distance, estDuration: est.duration, adjustedReason: 'Recovery check-in' }];
  }
  return store.applyChange({ updates, title: 'Recovery check-in', reason });
}

// ---------------------------------------------------------------- adaptive pace suggestion
export function currentTrends() {
  const { plan, activities, workouts, meta } = store.state;
  return analyzeTrends({ activities, workouts, plan, today: today(), decisions: meta.paceDecisions || {} });
}

export function openPaceSuggestion() {
  const sug = currentTrends().suggestion;
  if (!sug) { toast('No pace change recommended right now'); return; }
  const zones = ['recovery', 'easy', 'long', 'steady', 'marathon', 'tempo', 'threshold', 'interval', 'rep'].filter((z) => sug.newPaces[z] && sug.oldPaces?.[z]);
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Adaptive coaching</div><h2>${sug.type === 'vdot' ? 'Update your fitness level' : 'Adjust pace targets'}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="notice accent">${icon('sparkle', 'sm')}<div>${esc(sug.explanation)}</div></div>
    <table class="lap-table" style="margin-top:14px"><tr><th>Zone</th><th class="r">Current</th><th class="r">New</th></tr>
      ${zones.map((z) => { const ch = sug.changedZones.includes(z); return `<tr style="${ch ? '' : 'opacity:.5'}"><td>${esc(ZONE_INFO[z].name)}</td><td class="r muted">${fmtPaceRange(sug.oldPaces[z])}</td><td class="r">${ch ? `<b>${fmtPaceRange(sug.newPaces[z])}</b>` : 'unchanged'}</td></tr>`; }).join('')}
    </table>
    <p class="tiny muted" style="margin-top:10px">Applies to upcoming workouts only. Based on several sessions, never a single run. A time trial will recalibrate everything again.</p>
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-no>Keep current paces</button><button class="btn primary" data-yes>${icon('check', 'sm')} Apply</button></div>`, {
    onMount: (el, api) => {
      el.querySelector('[data-yes]').onclick = async () => { await store.applyPaceSuggestion(sug); await store.logChange({ title: 'Pace targets updated', reason: sug.explanation, moved: [], removed: [], added: [], modified: [], mileage: [], race: null, total: 0, at: new Date().toISOString() }); api.close(); toast('Pace targets updated for upcoming workouts'); };
      el.querySelector('[data-no]').onclick = async () => { await store.recordPaceDecision(sug.key, false); api.close(); toast('Keeping your current paces'); store.emit(); };
    },
  });
}

// ---------------------------------------------------------------- assessments
export function currentAssessmentDue() {
  const { plan, workouts, activities, meta } = store.state;
  return assessmentDue({ plan, workouts, activities, vdotHistory: meta.vdotHistory, today: today() });
}

export function openAssessmentPicker() {
  const due = currentAssessmentDue();
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Fitness assessment</div><h2>Schedule a fitness check</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${due ? `<p class="muted">${esc(due.reason)} A benchmark keeps your race estimate and pace zones accurate.</p>` : '<p class="muted">Assessments are best every 6–8 weeks, never in a taper.</p>'}
    <div class="options">
      <button class="opt" data-k="threshold"><span class="radio"></span><span class="grow"><div class="ot">Controlled threshold assessment</div><div class="os">30 min at hard-but-steady effort. Least taxing, fits mid-block.</div></span></button>
      <button class="opt" data-k="mile"><span class="radio"></span><span class="grow"><div class="ot">1-mile time trial</div><div class="os">Short and sharp. Good for 5K goals.</div></span></button>
      <button class="opt" data-k="5k"><span class="radio"></span><span class="grow"><div class="ot">5K time trial</div><div class="os">Most accurate for 10K–marathon goals.</div></span></button>
    </div>
    <p class="tiny muted" style="margin-top:10px">It replaces your next quality session this week, so total load stays the same.</p>`, {
    onMount: (el, api) => el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
      const s = await scheduleAssessmentSmart(b.dataset.k);
      api.close();
      if (s) setTimeout(() => showSummary(s, { title: 'Fitness check scheduled' }), 250);
    }),
  });
}

export async function scheduleAssessmentSmart(kind) {
  const plan = store.state.plan;
  if (!plan) return null;
  const t = today();
  const ws = store.state.workouts.filter((w) => w.date >= t && w.date <= addDays(t, 8) && w.status === 'planned');
  const target = ws.find((w) => isHard(w) && w.type !== 'long' && w.type !== 'race') || ws.find((w) => isRun(w) && w.type !== 'long');
  if (!target) { toast('No suitable day in the next week — try again later'); return null; }
  const ctx = { paces: plan.paces, assumedEasy: plan.assumedEasy, pref: plan.inputs?.prefs?.mode || 'distance', unit: plan.inputs?.unit, experience: plan.inputs?.fitness?.experience };
  const built = assessmentWorkout(kind, ctx);
  const est = estimateWorkout(built.steps, plan.paces, plan.assumedEasy);
  const w = { id: `user-assess-${Date.now().toString(36)}`, planId: plan.id, date: target.date, week: target.week, phase: target.phase, slot: 'user', status: 'planned', source: 'user', ...built, estDistance: est.distance, estDuration: est.duration };
  return store.applyChange({ updates: [w, { ...target, status: 'replaced', replacedBy: w.id }], title: 'Fitness check scheduled', reason: `${built.title} replaces ${target.title} on ${fmtDate(target.date, { weekday: 'long' })}. Your result will update race estimates, pace zones and future workout prescriptions.` });
}

// ---------------------------------------------------------------- post-workout evaluation
export function showEvaluation(act) {
  const w = act.workoutId ? store.workout(act.workoutId) : null;
  const e = evaluateWorkout(act, w);
  const trends = currentTrends();
  const sug = trends.suggestion;
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Coach’s take</div><h2>${esc(act.title || 'Workout')}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="notice ${e.tone === 'warn' ? 'warn' : e.tone === 'accent' ? 'accent' : 'ok'}">${icon('sparkle', 'sm')}<div><b>${esc(e.headline)}</b>${e.notes.map((n) => `<div style="margin-top:6px">${esc(n)}</div>`).join('')}</div></div>
    ${e.laps.length ? `<table class="lap-table" style="margin-top:12px"><tr><th>Effort</th><th class="r">Target</th><th class="r">Actual</th><th class="r"></th></tr>${e.laps.map((l) => `<tr><td>${esc(l.label)}${l.rep ? ' ' + l.rep : ''}</td><td class="r muted">${fmtPaceRange(l.targetPace)}</td><td class="r"><b>${fmtPaceRange([l.avgPace, l.avgPace])}</b></td><td class="r"><span class="chip ${l.verdict === 'on' ? 'ok' : l.verdict === 'fast' ? 'accent' : 'warn'}">${l.verdict === 'on' ? 'On' : l.verdict === 'fast' ? 'Fast' : 'Slow'}</span></td></tr>`).join('')}</table>` : ''}
    ${trends.trends.length ? `<div class="upper muted" style="margin:16px 0 8px">Trends</div>${trends.trends.slice(0, 3).map((x) => `<div class="notice">${icon(x.kind === 'up' ? 'bolt' : 'info', 'sm')}<div><b>${esc(x.title)}</b><div>${esc(x.body)}</div></div></div>`).join('')}` : ''}
    ${sug ? `<button class="btn primary block" data-pace style="margin-top:14px">${icon('tempo', 'sm')} Review suggested pace update</button>` : `<p class="tiny muted" style="margin-top:12px">${e.n ? 'Pace analysis needs at least three similar sessions before changing targets — one run never changes your plan.' : ''}</p>`}
    <button class="btn ${sug ? 'ghost' : 'primary'} block" data-close style="margin-top:8px">Done</button>`, {
    onMount: (el, api) => { const b = el.querySelector('[data-pace]'); if (b) b.onclick = () => { api.close(); setTimeout(openPaceSuggestion, 250); }; },
  });
}

// ---------------------------------------------------------------- change history
export function openHistory() {
  const log = store.state.meta.changeLog || [];
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Plan</div><h2>Change history</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${log.length ? log.map((s) => `<div class="card flat" style="margin-bottom:8px"><div class="row between"><b>${esc(s.title || 'Change')}</b><span class="tiny muted">${esc(fmtDate((s.at || '').slice(0, 10) || today(), { month: 'short', day: 'numeric' }))}</span></div>
      ${s.reason ? `<div class="small muted" style="margin-top:4px">${esc(s.reason)}</div>` : ''}
      <div class="small" style="margin-top:6px">${[s.moved.length && `${s.moved.length} moved`, s.removed.length && `${s.removed.length} removed`, s.added.length && `${s.added.length} added`, s.modified.length && `${s.modified.length} changed`].filter(Boolean).join(' · ') || 'No workout changes'}</div>
      ${s.moved.slice(0, 3).map((m) => `<div class="tiny muted">${esc(m.title)}: ${esc(fmtDate(m.from, { weekday: 'short', day: 'numeric' }))} → ${esc(fmtDate(m.to, { weekday: 'short', day: 'numeric' }))}</div>`).join('')}
      ${s.race && !s.race.ok ? `<div class="tiny" style="color:var(--warn);margin-top:4px">${esc(s.race.text)}</div>` : ''}</div>`).join('') : '<div class="empty small">No changes yet. Adjustments, moves and pace updates will appear here.</div>'}`);
}
