// Plan Adjustment wizard (missed sessions, illness, travel, conflicts, recovery weeks),
// plan settings editor, pace editor and calendar export.

import { esc, icon, openSheet, toast, opts, confirmDialog, downloadFile, closeAllSheets } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, addDays, fmtDate, startOfWeek, DAY_NAMES, DAY_SHORT } from '../core/dates.js';
import { fmtDist, fmtPaceRange, fmtDuration, parseClock, fromDisplayDist, toDisplayDist, distLabel } from '../core/units.js';
import { trainingPaces, predictTime } from '../engine/vdot.js';
import { completionStats } from '../engine/adjustments.js';
import { flattenSteps } from '../engine/workout-utils.js';
import { stepValue } from './format.js';
import { showSummary } from './coach.js';

const newId = () => `adj-${Date.now().toString(36)}`;

const WHY = {
  travel: (a) => a.mode === 'light' ? 'While travelling you keep short easy runs on your usual days. Hard sessions pause, and the week after resumes at a slightly reduced load rather than trying to catch up.' : 'No running while away. Afterwards volume resumes at about 80 % and rebuilds — the plan never crams missed work.',
  illness: () => 'Rest days cover the illness period. You return with easy-only running for a few days, then volume resumes at a reduced level.',
  hold: () => 'This week repeats the current load instead of increasing it, giving your body time to catch up.',
  recovery: () => 'Volume drops about 25 % with one light session; progression continues from where it was afterwards.',
  unavailable: () => 'Runs on your unavailable days were reorganised onto your other available days, keeping hard sessions 48 hours apart.',
  rest: () => 'Your extra rest day was added and the week was reorganised around it.',
  restrict: (a) => a.mode === 'easy' ? 'During this period every run is easy — no intervals, tempo or hills, and long runs stay conversational.' : 'During this period weekly volume is reduced by about 25 % with at most one quality session per week.',
  volume: (a) => `Weekly volume ${a.factor > 1 ? 'increased' : 'reduced'} by ${Math.round(Math.abs(a.factor - 1) * 100)} % from today.`,
};

async function applyAdjustment(adj, extraMutate, title) {
  const summary = await store.regenerateWithSummary((inputs) => {
    inputs.adjustments = [...(inputs.adjustments || []), adj];
    extraMutate && extraMutate(inputs);
  }, { title: title || 'Plan adjusted', reason: (WHY[adj.type] || (() => ''))(adj) });
  setTimeout(() => showSummary(summary), 250);
  return summary;
}

export function openAdjust() {
  const today = todayISO();
  const ws = startOfWeek(today);
  const stats = completionStats(store.state.workouts, addDays(ws, -14), addDays(today, -1), today);
  const sheet = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Plan adjustment</div><h2>What’s changed?</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <p class="muted small" style="margin-top:-6px">Your plan adapts from today forward. Completed workouts and history are never changed, and missed sessions are never crammed into later days.</p>
    <div class="list">
      <button class="list-item" data-adj="missed">${icon('calendar', 'sm')}<div class="grow"><div class="t">I missed some sessions</div><div class="s">${stats.planned ? `${stats.done} of ${stats.planned} runs done in the last 2 weeks` : 'Get back on track sensibly'}</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="illness">${icon('thermometer', 'sm')}<div class="grow"><div class="t">I’m ill or injured</div><div class="s">Rest days and a gentle return</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="travel">${icon('plane', 'sm')}<div class="grow"><div class="t">Travel or vacation</div><div class="s">Light running or a complete break</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="conflict">${icon('swap', 'sm')}<div class="grow"><div class="t">My schedule changed</div><div class="s">Different running days or time available</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="unavailable">${icon('calendar', 'sm')}<div class="grow"><div class="t">Unavailable days</div><div class="s">Specific dates you can’t run — the week reorganises</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="rest">${icon('rest', 'sm')}<div class="grow"><div class="t">Add a rest day</div><div class="s">An extra day off — runs shift to keep the week balanced</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="restrict">${icon('alert', 'sm')}<div class="grow"><div class="t">Temporary restriction</div><div class="s">Easy running only, or reduced volume, for a period</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-adj="recovery">${icon('recovery', 'sm')}<div class="grow"><div class="t">I need a recovery week</div><div class="s">Lower volume, lighter sessions</div></div>${icon('chevR', 'sm chev')}</button>
    </div>`, {
    onMount: (el) => {
      el.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => { sheet.close(); setTimeout(() => FLOWS[b.dataset.adj](), 150); });
    },
  });
}

const dateRange = (start, end) => `<div class="input-group"><label class="field grow"><span class="lbl">From</span><input class="input" type="date" data-f="start" value="${start}"></label><label class="field grow"><span class="lbl">To</span><input class="input" type="date" data-f="end" value="${end}"></label></div>`;

const FLOWS = {
  missed() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Missed sessions</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <p class="muted">Missing a few runs is normal and costs very little fitness. Do not try to make them up — choose how to continue:</p>
      <div class="options">
        <button class="opt" data-m="continue"><span class="radio"></span><span class="grow"><div class="ot">Continue as planned</div><div class="os">Best if you missed 1–2 runs and feel fine</div></span></button>
        <button class="opt" data-m="hold"><span class="radio"></span><span class="grow"><div class="ot">Hold volume this week</div><div class="os">Repeat the current load instead of increasing it</div></span></button>
        <button class="opt" data-m="recovery"><span class="radio"></span><span class="grow"><div class="ot">Make this a recovery week</div><div class="os">If you missed a week or more, or feel run-down</div></span></button>
      </div>`, {
      onMount: (el) => el.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => {
        const m = b.dataset.m;
        if (m === 'continue') { s.close(); toast('No changes — just pick up with the next scheduled run.'); return; }
        s.close();
        await applyAdjustment({ id: newId(), type: m === 'hold' ? 'hold' : 'recovery', start: today, note: 'Missed sessions' }, null, m === 'hold' ? 'Volume held' : 'Recovery week');
      }),
    });
  },
  illness() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Illness or injury</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <div class="notice warn" style="margin-bottom:14px">${icon('alert', 'sm')}<div>This app cannot diagnose or treat injuries. If you have pain, chest symptoms, fever or anything concerning, please see a medical professional before running.</div></div>
      ${dateRange(today, addDays(today, 3))}
      <label class="setting" style="padding:8px 2px"><div class="grow"><div class="t">I have pain when running</div><div class="s">Holds volume and removes hard sessions until you clear it in Profile</div></div><span class="toggle"><input type="checkbox" data-f="pain"><span></span></span></label>
      <p class="small muted">All runs in this period become rest days. Afterwards you return with easy running only for a few days, and volume resumes at a reduced level — the plan does not try to catch up.</p>
      <button class="btn primary lg block" data-go>Apply</button>`, {
      onMount: (el) => el.querySelector('[data-go]').onclick = async () => {
        const start = el.querySelector('[data-f=start]').value, end = el.querySelector('[data-f=end]').value;
        if (!start || !end || end < start) { toast('Check the dates'); return; }
        const pain = el.querySelector('[data-f=pain]').checked;
        s.close();
        await applyAdjustment({ id: newId(), type: 'illness', start, end }, (inputs) => { if (pain) inputs.injury = { ...(inputs.injury || {}), has: true, painNow: true }; });
        if (pain && store.state.profile) await store.saveProfile({ ...store.state.profile, inputs: { ...store.state.profile.inputs, injury: { ...(store.state.profile.inputs.injury || {}), has: true, painNow: true } } });
      },
    });
  },
  travel() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Travel or vacation</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      ${dateRange(addDays(today, 1), addDays(today, 7))}
      <div class="field"><span class="lbl">While away</span><div class="options">
        <button class="opt sel" data-mode="light"><span class="radio"></span><span class="grow"><div class="ot">I can run a little</div><div class="os">Short easy runs on your usual days</div></span></button>
        <button class="opt" data-mode="none"><span class="radio"></span><span class="grow"><div class="ot">No running</div><div class="os">Full break — rest days only</div></span></button>
      </div></div>
      <button class="btn primary lg block" data-go>Apply</button>`, {
      onMount: (el) => {
        let mode = 'light';
        el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('sel', x === b)); });
        el.querySelector('[data-go]').onclick = async () => {
          const start = el.querySelector('[data-f=start]').value, end = el.querySelector('[data-f=end]').value;
          if (!start || !end || end < start) { toast('Check the dates'); return; }
          s.close();
          await applyAdjustment({ id: newId(), type: 'travel', start, end, mode }, null, mode === 'light' ? 'Travel — light running' : 'Travel — no running');
        };
      },
    });
  },
  conflict() { openPlanSettings({ focus: 'days' }); },
  unavailable() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Unavailable days</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <p class="muted small">Business travel, work shifts, family commitments… Runs scheduled on these dates move to your other available days in the same week where it is safe to do so.</p>
      ${dateRange(addDays(today, 1), addDays(today, 1))}
      <button class="btn primary lg block" data-go>Reorganise my week</button>`, {
      onMount: (el) => el.querySelector('[data-go]').onclick = async () => {
        const start = el.querySelector('[data-f=start]').value, end = el.querySelector('[data-f=end]').value;
        if (!start || !end || end < start) { toast('Check the dates'); return; }
        s.close(); await applyAdjustment({ id: newId(), type: 'unavailable', start, end }, null, 'Unavailable days added');
      },
    });
  },
  rest() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Add a rest day</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <label class="field"><span class="lbl">Date</span><input class="input" type="date" data-f="start" min="${today}" value="${today}"></label>
      <p class="muted small">If a run was scheduled, the week is rebalanced onto your other available days.</p>
      <button class="btn primary lg block" data-go>Add rest day</button>`, {
      onMount: (el) => el.querySelector('[data-go]').onclick = async () => {
        const d = el.querySelector('[data-f=start]').value;
        if (!d) return;
        s.close(); await applyAdjustment({ id: newId(), type: 'rest', start: d, end: d }, null, 'Extra rest day');
      },
    });
  },
  restrict() {
    const today = todayISO();
    const s = openSheet(`
      <div class="sheet-head"><h2>Temporary restriction</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      ${dateRange(today, addDays(today, 13))}
      <div class="field"><span class="lbl">Restriction</span><div class="options">
        <button class="opt sel" data-mode="easy"><span class="radio"></span><span class="grow"><div class="ot">Easy running only</div><div class="os">No intervals, tempo or hills — e.g. coming back from a niggle</div></span></button>
        <button class="opt" data-mode="reduced"><span class="radio"></span><span class="grow"><div class="ot">Reduced volume</div><div class="os">About 25 % less, max one quality session per week</div></span></button>
      </div></div>
      <p class="tiny muted">Stride doesn’t prescribe rehab. If a clinician gave you specific limits, follow their advice.</p>
      <button class="btn primary lg block" data-go>Apply</button>`, {
      onMount: (el) => {
        let mode = 'easy';
        el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('sel', x === b)); });
        el.querySelector('[data-go]').onclick = async () => {
          const start = el.querySelector('[data-f=start]').value, end = el.querySelector('[data-f=end]').value;
          if (!start || !end || end < start) { toast('Check the dates'); return; }
          s.close(); await applyAdjustment({ id: newId(), type: 'restrict', mode, start, end }, null, 'Training restriction');
        };
      },
    });
  },
  recovery() {
    const plan = store.state.plan;
    const today = todayISO();
    const weeks = plan.weeks.filter((w) => w.end >= today && w.phase !== 'taper' && w.phase !== 'recovery');
    const s = openSheet(`
      <div class="sheet-head"><h2>Recovery week</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <label class="field"><span class="lbl">Which week?</span><select class="input" data-f="wk">${opts(weeks.map((w) => ({ value: w.start, label: `Week ${w.index} · ${fmtDate(w.start, { month: 'short', day: 'numeric' })}${w.recovery ? ' (already recovery)' : ''}` })), weeks[0]?.start)}</select></label>
      <p class="small muted">Volume drops ~25 % with one light session. Progression then continues from where it was — no catching up.</p>
      <button class="btn primary lg block" data-go>Apply</button>`, {
      onMount: (el) => el.querySelector('[data-go]').onclick = async () => {
        const start = el.querySelector('[data-f=wk]').value;
        s.close();
        await applyAdjustment({ id: newId(), type: 'recovery', start: start < today ? today : start }, null, 'Recovery week scheduled');
      },
    });
  },
};

export async function removeAdjustment(id) {
  const ok = await confirmDialog({ title: 'Remove this adjustment?', body: 'Future workouts will be regenerated without it.', confirm: 'Remove' });
  if (!ok) return;
  const summary = await store.regenerateWithSummary((inputs) => { inputs.adjustments = (inputs.adjustments || []).filter((a) => a.id !== id); }, { title: 'Adjustment removed', reason: 'Future workouts were regenerated without this adjustment.' });
  showSummary(summary);
}

export async function holdVolume() {
  await applyAdjustment({ id: newId(), type: 'hold', start: addDays(startOfWeek(todayISO()), 7), note: 'Coach suggestion' }, null, 'Volume held next week');
}

/** Edit training preferences for the active plan; regenerates future workouts only. */
export function openPlanSettings({ focus } = {}) {
  const plan = store.state.plan;
  if (!plan) return;
  const inp = JSON.parse(JSON.stringify(plan.inputs));
  const av = inp.availability; const pr = inp.prefs; const goal = inp.goal;
  const unit = distLabel();
  const render = () => `
    <div class="sheet-head"><div><div class="small muted">Plan settings</div><h2>Training preferences</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="field"><span class="lbl">Available days</span><div class="day-picker">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-ps-day="${d}" class="${av.days.includes(d) ? 'sel' : ''}">${DAY_SHORT[d]}</button>`).join('')}</div></div>
    <div class="input-group">
      <label class="field grow"><span class="lbl">Runs per week</span><select class="input" data-ps="daysPerWeek">${opts([1, 2, 3, 4, 5, 6, 7].filter((n) => n <= av.days.length).map((n) => ({ value: n, label: String(n) })), Math.min(av.daysPerWeek, av.days.length))}</select></label>
      <label class="field grow"><span class="lbl">Long-run day</span><select class="input" data-ps="longRunDay">${opts(av.days.map((d) => ({ value: d, label: DAY_NAMES[d] })), av.longRunDay)}</select></label>
    </div>
    <div class="input-group">
      <label class="field grow"><span class="lbl">Weekday time</span><select class="input" data-ps="weekdayMin">${opts([30, 45, 60, 75, 90, 120].map((v) => ({ value: v, label: `${v} min` })), av.weekdayMin)}</select></label>
      <label class="field grow"><span class="lbl">Weekend time</span><select class="input" data-ps="weekendMin">${opts([45, 60, 90, 120, 150, 180, 210, 240].map((v) => ({ value: v, label: `${v} min` })), av.weekendMin)}</select></label>
    </div>
    <div class="field"><span class="lbl">Training volume</span><div class="seg">${[[0.85, '−15%'], [0.92, '−8%'], [1, 'As planned'], [1.08, '+8%'], [1.15, '+15%']].map(([v, l]) => `<button type="button" data-ps-vol="${v}" class="${v === 1 ? 'sel' : ''}">${l}</button>`).join('')}</div><span class="hint">Applies from today. Changes are additive to earlier volume adjustments.</span></div>
    <div class="field"><span class="lbl">Progression / intensity</span><div class="seg">${[['gradual', 'Gradual'], ['moderate', 'Moderate'], ['aggressive', 'Aggressive']].map(([v, l]) => `<button type="button" data-ps-prog="${v}" class="${pr.progression === v ? 'sel' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Workout format</span><div class="seg">${[['distance', 'Distance'], ['time', 'Time']].map(([v, l]) => `<button type="button" data-ps-mode="${v}" class="${pr.mode === v ? 'sel' : ''}">${l}</button>`).join('')}</div></div>
    <label class="setting" style="padding:10px 2px"><div class="grow"><div class="t">Strength sessions</div></div><select class="input" data-ps="strength" style="max-width:150px">${opts([{ value: 0, label: 'Off' }, { value: 1, label: '1 / week' }, { value: 2, label: '2 / week' }, { value: 3, label: '3 / week' }], pr.strength?.on ? pr.strength.sessions : 0)}</select></label>
    <label class="setting" style="padding:10px 2px"><div class="grow"><div class="t">Mobility sessions</div></div><select class="input" data-ps="mobility" style="max-width:150px">${opts([{ value: 0, label: 'Off' }, { value: 1, label: '1 / week' }, { value: 2, label: '2 / week' }, { value: 3, label: '3 / week' }], pr.mobility?.on ? pr.mobility.sessions : 0)}</select></label>
    ${plan.goal.distanceM || goal.raceDate ? `<div class="divider"></div>
    <div class="input-group">
      <label class="field grow"><span class="lbl">Goal race date</span><input class="input" type="date" data-ps="raceDate" min="${addDays(todayISO(), 7)}" value="${esc(goal.raceDate || '')}"></label>
      <label class="field grow"><span class="lbl">Target time</span><input class="input" data-ps="targetTime" placeholder="h:mm:ss" value="${goal.targetTimeSec ? fmtDuration(goal.targetTimeSec) : ''}"></label>
    </div><span class="hint" style="display:block;margin:-8px 0 14px;color:var(--muted);font-size:12.5px">Changing the race date changes the plan length and phases from today forward.</span>` : ''}
    <div class="notice" style="margin-bottom:14px">${icon('info', 'sm')}<div>Only future workouts are regenerated. Completed workouts, history and personal workouts are preserved.</div></div>
    <button class="btn primary lg block" data-ps-save>${icon('refresh', 'sm')} Update plan</button>`;
  let vol = 1;
  const sheet = openSheet(render(), { onMount: bind });
  function bind(el) {
    el.querySelectorAll('[data-ps-day]').forEach((b) => b.onclick = () => {
      read(el); const d = Number(b.dataset.psDay);
      av.days = av.days.includes(d) ? av.days.filter((x) => x !== d) : [...av.days, d];
      if (av.days.length < 1) av.days = [d];
      if (!av.days.includes(av.longRunDay)) av.longRunDay = av.days[av.days.length - 1];
      av.daysPerWeek = Math.min(av.daysPerWeek, av.days.length);
      sheet.set(render());
    });
    el.querySelectorAll('[data-ps-vol]').forEach((b) => b.onclick = () => { vol = Number(b.dataset.psVol); el.querySelectorAll('[data-ps-vol]').forEach((x) => x.classList.toggle('sel', x === b)); });
    el.querySelectorAll('[data-ps-prog]').forEach((b) => b.onclick = () => { pr.progression = b.dataset.psProg; el.querySelectorAll('[data-ps-prog]').forEach((x) => x.classList.toggle('sel', x === b)); });
    el.querySelectorAll('[data-ps-mode]').forEach((b) => b.onclick = () => { pr.mode = b.dataset.psMode; el.querySelectorAll('[data-ps-mode]').forEach((x) => x.classList.toggle('sel', x === b)); });
    el.querySelector('[data-ps-save]').onclick = async () => {
      read(el);
      const tt = el.querySelector('[data-ps="targetTime"]');
      if (tt && tt.value && !parseClock(tt.value)) { toast('Target time format: h:mm:ss'); return; }
      const btn = el.querySelector('[data-ps-save]'); btn.disabled = true; btn.textContent = 'Updating…';
      const summary = await store.regenerateWithSummary((inputs) => {
        inputs.availability = av; inputs.prefs = pr; inputs.goal = goal;
        if (vol !== 1) inputs.adjustments = [...(inputs.adjustments || []), { id: newId(), type: 'volume', start: todayISO(), factor: vol }];
      }, { title: 'Training preferences updated', reason: 'You changed your training preferences. Only future workouts were regenerated; completed workouts and history are unchanged.' });
      sheet.close();
      setTimeout(() => showSummary(summary), 250);
    };
  }
  function read(el) {
    const g = (k) => el.querySelector(`[data-ps="${k}"]`);
    av.daysPerWeek = Number(g('daysPerWeek').value); av.longRunDay = Number(g('longRunDay').value);
    av.weekdayMin = Number(g('weekdayMin').value); av.weekendMin = Number(g('weekendMin').value);
    const st = Number(g('strength').value); pr.strength = { ...(pr.strength || {}), on: st > 0, sessions: st || pr.strength?.sessions || 2, minutes: pr.strength?.minutes || 25, equipment: pr.strength?.equipment || ['none'] };
    const mb = Number(g('mobility').value); pr.mobility = { ...(pr.mobility || {}), on: mb > 0, sessions: mb || 2, minutes: pr.mobility?.minutes || 15 };
    if (g('raceDate')) goal.raceDate = g('raceDate').value || null;
    if (g('targetTime')) goal.targetTimeSec = parseClock(g('targetTime').value) || null;
  }
}

/** Pace editor: nudge VDOT, or set from a recent result. */
export function openEditPaces() {
  const plan = store.state.plan;
  if (!plan) return;
  let v = plan.vdot || 40;
  const render = () => {
    const p = trainingPaces(v);
    return `<div class="sheet-head"><div><div class="small muted">Training zones</div><h2>Adjust pace targets</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
      <p class="muted small">Paces come from your fitness score (VDOT). Nudge it as you get fitter, or enter a recent result.</p>
      <div class="row between" style="margin:14px 0"><button class="icon-btn" data-ep="-0.5" aria-label="Slower">−</button><div class="center"><div style="font-size:34px;font-weight:780" class="num">${v.toFixed(1)}</div><div class="tiny muted upper">VDOT${plan.vdot ? ` · was ${plan.vdot.toFixed(1)}` : ''}</div></div><button class="icon-btn" data-ep="0.5" aria-label="Faster">+</button></div>
      <table class="pace-table">${[['easy', 'Easy'], ['long', 'Long run'], ['marathon', 'Marathon'], ['threshold', 'Threshold'], ['interval', 'Interval'], ['rep', 'Repetition']].map(([z, l]) => `<tr><td>${l}</td><td>${fmtPaceRange(p[z])}</td></tr>`).join('')}</table>
      <div class="small muted" style="margin-top:8px">Predicted: 5K ${fmtDuration(predictTime(v, 5000))} · 10K ${fmtDuration(predictTime(v, 10000))} · Half ${fmtDuration(predictTime(v, 21097.5))}</div>
      <div class="divider"></div>
      <div class="field"><span class="lbl">Or set from a recent result</span><div class="input-group"><select class="input" data-ep-dist style="max-width:140px">${opts([{ value: 1609.344, label: '1 mile' }, { value: 5000, label: '5K' }, { value: 10000, label: '10K' }, { value: 21097.5, label: 'Half' }, { value: 42195, label: 'Marathon' }], 5000)}</select><input class="input" data-ep-time placeholder="mm:ss"><button class="btn" data-ep-calc>Use</button></div></div>
      <button class="btn primary lg block" data-ep-save>Save paces</button>`;
  };
  const sheet = openSheet(render(), { onMount: bind });
  function bind(el) {
    el.querySelectorAll('[data-ep]').forEach((b) => b.onclick = () => { v = Math.max(20, Math.min(85, v + Number(b.dataset.ep))); sheet.set(render()); });
    el.querySelector('[data-ep-calc]').onclick = async () => {
      const t = parseClock(el.querySelector('[data-ep-time]').value);
      if (!t) { toast('Enter a time like 24:30'); return; }
      const { vdotFromRace } = await import('../engine/vdot.js');
      v = Math.round(vdotFromRace(Number(el.querySelector('[data-ep-dist]').value), t) * 10) / 10;
      sheet.set(render());
    };
    el.querySelector('[data-ep-save]').onclick = async () => { await store.setVdot(v, 'manual'); sheet.close(); toast('Paces updated for upcoming workouts'); };
  }
}

/** iCalendar export so phones can deliver reminders natively (browsers cannot schedule offline notifications reliably). */
export function exportIcs() {
  const plan = store.state.plan;
  if (!plan) return;
  const today = todayISO();
  const tod = plan.inputs?.availability?.timeOfDay || 'morning';
  const hour = tod === 'morning' ? '063000' : tod === 'afternoon' ? '123000' : '173000';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stride Running Coach//EN', 'CALSCALE:GREGORIAN'];
  const escIcs = (s) => String(s || '').replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  for (const w of store.state.workouts.filter((x) => x.date >= today && x.type !== 'rest' && x.status === 'planned')) {
    const d = w.date.replace(/-/g, '');
    const desc = [w.purpose, '', ...flattenSteps(w.steps || []).map((s) => `• ${s.label}: ${stepValue(s)}`)].join('\n');
    lines.push('BEGIN:VEVENT', `UID:${w.id}@stride`, `DTSTAMP:${d}T000000`, `DTSTART:${d}T${hour}`, `DURATION:PT${Math.max(10, Math.round((w.estDuration || 1800) / 60))}M`,
      `SUMMARY:${escIcs(w.title)}`, `DESCRIPTION:${escIcs(desc)}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(w.title)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  downloadFile(`stride-plan-${today}.ics`, lines.join('\r\n'), 'text/calendar');
  toast('Calendar file downloaded — open it to add reminders');
}
