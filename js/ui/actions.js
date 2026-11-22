// Workout-level actions: details sheet, move/reschedule, complete, skip, missed,
// manual logging, personal workouts, extra rest days and assessments.

import { esc, icon, openSheet, toast, confirmDialog, opts, closeAllSheets } from './dom.js';
import { store } from '../core/store.js';
import { fmtDist, fmtDuration, fmtPace, parseClock, fromDisplayDist, toDisplayDist, distLabel, fmtMinutes } from '../core/units.js';
import { fmtLongDate, fmtDate, addDays, todayISO, startOfWeek } from '../core/dates.js';
import { effectiveStatus, validateMove, moveWorkout } from '../engine/adjustments.js';
import { estimateWorkout, isRun, TYPE_META } from '../engine/workout-utils.js';
import { assessmentWorkout, easyRun } from '../engine/workouts.js';
import { vdotFromRace } from '../engine/vdot.js';
import { renderSteps, structureBar, workoutLine, typeColor, typeLabel, mainTarget, statusLabel, showSpeeds, speedUnit } from './format.js';
import { prefs } from '../core/storage.js';
import { showSummary, openMissed, showEvaluation } from './coach.js';

const today = () => todayISO();

export function openWorkout(id) {
  const w = store.workout(id);
  if (!w) return;
  const plan = store.state.plan;
  const profile = store.state.profile;
  const st = effectiveStatus(w, today());
  const act = w.activityId ? store.state.activities.find((a) => a.id === w.activityId) : null;
  const canStart = w.type !== 'rest' && st !== 'completed';
  const html = `
    <div class="sheet-head">
      <div>
        <div class="row small muted" style="gap:8px"><span class="dot" data-z="${typeColor(w.type)}"></span>${esc(typeLabel(w.type))} · ${esc(fmtLongDate(w.date))}</div>
        <h2 style="margin-top:6px">${esc(w.title)}</h2>
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 'sm')}</button>
    </div>
    <div class="row wrap" style="gap:6px;margin-bottom:12px">
      ${st !== 'planned' ? `<span class="chip ${st === 'completed' ? 'accent' : st === 'missed' ? 'danger' : ''}">${esc(statusLabel(st))}</span>` : ''}
      ${w.key ? '<span class="chip">Key session</span>' : ''}
      ${w.movedFrom ? `<span class="chip">Moved from ${fmtDate(w.movedFrom, { weekday: 'short', day: 'numeric' })}</span>` : ''}
      ${w.phase ? `<span class="chip">Week ${w.week}${plan ? ' · ' + esc(plan.weeks[w.week - 1]?.phaseLabel || '') : ''}</span>` : ''}
    </div>
    ${w.type !== 'rest' ? `<div class="metrics" style="margin-top:4px">
      ${w.estDuration ? `<div class="metric"><div class="v">${fmtMinutes(w.estDuration)}</div><div class="l">Est. time</div></div>` : ''}
      ${w.estDistance ? `<div class="metric"><div class="v">${fmtDist(w.estDistance)}</div><div class="l">Distance</div></div>` : ''}
      ${isRun(w) ? `<div class="metric"><div class="v" style="font-size:16px;padding-top:5px">${esc(mainTarget(w, plan, profile) || '—')}</div><div class="l">Target</div></div>` : ''}
    </div>` : ''}
    ${structureBar(w, plan)}
    <p style="color:var(--text-2);margin:14px 0">${esc(w.purpose || '')}</p>
    ${act ? `<div class="card flat" style="margin-bottom:14px"><div class="row between"><b>Your result</b><button class="link-btn" data-view-activity="${act.id}">Details</button></div>
      <div class="metrics" style="margin:10px 0 0"><div class="metric sm"><div class="v">${fmtDist(act.distance)}</div><div class="l">Distance</div></div><div class="metric sm"><div class="v">${fmtDuration(act.duration)}</div><div class="l">Time</div></div><div class="metric sm"><div class="v">${act.avgPace ? fmtPace(act.avgPace) : '—'}</div><div class="l">Avg pace</div></div>${act.rpe ? `<div class="metric sm"><div class="v">${act.rpe}</div><div class="l">RPE</div></div>` : ''}</div></div>` : ''}
    ${w.steps?.length ? `<div class="row between" style="margin:6px 0 8px"><div class="upper muted">Workout structure</div>${isRun(w) ? `<div style="width:220px"><div class="seg"><button data-speedview="off" class="${showSpeeds(plan) ? '' : 'sel'}">Pace</button><button data-speedview="on" class="${showSpeeds(plan) ? 'sel' : ''}">+ Treadmill ${speedUnit() === 'mph' ? 'mph' : 'km/h'}</button></div></div>` : ''}</div>${renderSteps(w.steps, plan, profile)}` : ''}
    ${w.tips?.length ? `<div class="upper muted" style="margin:18px 0 8px">Coaching tips</div><ul class="tips">${w.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <div style="height:18px"></div>
    ${canStart ? `<button class="btn primary lg block" data-start-workout="${w.id}">${icon('play', 'sm')} ${w.type === 'strength' || w.type === 'mobility' ? 'Start session' : 'Start workout'}</button>` : ''}
    <div class="btn-row" style="margin-top:10px">
      ${w.type !== 'rest' && st !== 'completed' ? `<button class="btn ghost sm" data-log-workout="${w.id}">${icon('check', 'sm')} Log as done</button>` : ''}
      ${st !== 'completed' && w.date >= addDays(today(), -7) ? `<button class="btn ghost sm" data-move-workout="${w.id}">${icon('move', 'sm')} Move</button>` : ''}
    </div>
    <div class="btn-row" style="margin-top:10px">
      ${w.type !== 'rest' && st === 'planned' ? `<button class="btn ghost sm" data-skip-workout="${w.id}">Skip</button>` : ''}
      ${w.type !== 'rest' && st === 'planned' && w.date <= today() ? `<button class="btn ghost sm" data-missed-workout="${w.id}">Mark missed</button>` : ''}
      ${st === 'missed' && !w.missedHandled ? `<button class="btn primary sm" data-action="missed" data-id="${w.id}">${icon('sparkle', 'sm')} Adjust my week</button>` : ''}
      ${['skipped', 'missed'].includes(st) ? `<button class="btn ghost sm" data-restore-workout="${w.id}">${icon('refresh', 'sm')} Restore</button>` : ''}
      ${st === 'completed' && act ? `<button class="btn ghost sm" data-unlog-workout="${w.id}">Undo completion</button>` : ''}
      ${w.type !== 'rest' && st === 'planned' && w.source !== 'user' ? `<button class="btn ghost sm" data-rest-instead="${w.id}">${icon('rest', 'sm')} Rest instead</button>` : ''}
      ${w.source === 'user' ? `<button class="btn danger sm" data-delete-workout="${w.id}">${icon('trash', 'sm')} Delete</button>` : ''}
    </div>`;
  closeAllSheets();
  openSheet(html, { onMount: (el) => el.querySelectorAll('[data-speedview]').forEach((b) => b.onclick = () => { prefs.set({ showSpeeds: b.dataset.speedview }); openWorkout(id); }) });
}

export async function setStatus(id, status) {
  const w = store.workout(id);
  if (!w) return;
  if (status === 'missed') { closeAllSheets(); await store.putWorkouts([{ ...w, status: 'missed' }]); setTimeout(() => openMissed(id), 250); return; }
  await store.putWorkouts([{ ...w, status }]);
  closeAllSheets();
  toast(status === 'skipped' ? 'Workout skipped — your plan continues as normal.' : status === 'missed' ? 'Marked as missed. No need to make it up.' : 'Workout restored');
}

export async function restInstead(id) {
  const w = store.workout(id);
  const ok = await confirmDialog({ title: 'Take a rest day instead?', body: w.key ? 'This is a key session. If you have the energy later this week, consider moving it instead.' : 'This workout will be skipped and the day becomes a rest day.', confirm: 'Rest today' });
  if (!ok) return;
  const changed = [{ ...w, status: 'skipped', skipReason: 'rest' }];
  const restId = `${w.planId}-${w.date}-rest`;
  if (!store.workout(restId)) changed.push({ id: restId, planId: w.planId, date: w.date, week: w.week, phase: w.phase, slot: 'rest', type: 'rest', title: 'Extra Rest Day', purpose: 'You chose to rest — listening to your body is part of training.', steps: [], tips: [], status: 'planned', source: 'user', estDistance: 0, estDuration: 0 });
  await store.putWorkouts(changed);
  closeAllSheets();
  toast('Rest day added');
}

export function openMove(id) {
  const w = store.workout(id);
  if (!w) return;
  const ws = startOfWeek(w.date);
  const days = [];
  for (let i = -7; i < 14; i++) { const d = addDays(ws, i); if (d >= today() && d !== w.date) days.push(d); }
  const sheet = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Move workout</div><h2>${esc(w.title)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <label class="field"><span class="lbl">New date</span><select class="input" data-mv-date>${opts(days.map((d) => ({ value: d, label: `${fmtDate(d)}${store.workoutsOn(d).filter(isRun).length ? ' — ' + store.workoutsOn(d).filter(isRun).map((x) => x.title).join(', ') : ''}` })), days.find((d) => d > w.date) || days[0])}</select></label>
    <div data-mv-warn></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-mv-swap hidden>${icon('swap', 'sm')} Swap</button><button class="btn primary" data-mv-go>Continue</button></div>
    <p class="tiny muted" style="margin-top:12px">Moving a single workout does not change the rest of your plan. For travel, illness or schedule changes use <b>Plan Adjustment</b> on the Plan tab.</p>`, {
    onMount: (el) => {
      const sel = el.querySelector('[data-mv-date]');
      const warnBox = el.querySelector('[data-mv-warn]');
      const swapBtn = el.querySelector('[data-mv-swap]');
      const update = () => {
        const v = validateMove(store.state.workouts, w, sel.value, today(), { plan: store.state.plan });
        warnBox.innerHTML = v.warnings.map((x) => `<div class="notice ${v.serious ? 'danger' : 'warn'}">${icon('alert', 'sm')}<div>${esc(x)}</div></div>`).join('') || `<div class="notice ok">${icon('check', 'sm')}<div>No conflicts — recovery, long run, taper and weekly mileage all check out.</div></div>`;
        el.querySelector('[data-mv-go]').textContent = 'Continue';
        swapBtn.hidden = !v.canSwap;
      };
      sel.onchange = update; update();
      const go = async (swap) => {
        sheet.close();
        if (swap) { const summary = await moveWithSummary(w, sel.value, true); setTimeout(() => showSummary(summary), 250); return; }
        const { requestReschedule } = await import('./reschedule.js');
        setTimeout(() => requestReschedule(w, sel.value), 220);
      };
      el.querySelector('[data-mv-go]').onclick = () => go(false);
      swapBtn.onclick = () => go(true);
    },
  });
}

export async function moveWithSummary(w, date, swap = false) {
  const v = validateMove(store.state.workouts, w, date, today(), { plan: store.state.plan });
  const changed = moveWorkout(store.state.workouts, w, date, { swap });
  return store.applyChange({ updates: changed, title: swap ? 'Workouts swapped' : 'Workout moved', reason: v.warnings.length ? `You chose this despite: ${v.warnings.join(' ')}` : `${w.title} moved to ${fmtDate(date, { weekday: 'long' })}. No recovery, long-run, taper or mileage conflicts.` });
}

/** Manual logging — for a planned workout (workoutId) or a standalone run. */
export function openLogRun(workoutId = null, { date } = {}) {
  const w = workoutId ? store.workout(workoutId) : null;
  const unit = distLabel();
  const thr = w?.benchmark?.kind === 'threshold';
  const bench = w?.benchmark?.distanceM || thr;
  const defDist = w?.benchmark?.distanceM ? toDisplayDist(w.benchmark.distanceM).toFixed(2) : thr ? '' : w?.estDistance ? toDisplayDist(w.estDistance).toFixed(2) : '';
  const defTime = thr ? '30:00' : bench ? '' : w?.estDuration ? fmtDuration(w.estDuration) : '';
  const isSupp = w && (w.type === 'strength' || w.type === 'mobility');
  const sheet = openSheet(`
    <div class="sheet-head"><div><div class="small muted">${w ? 'Log workout' : 'Log a run'}</div><h2>${esc(w ? w.title : 'Manual entry')}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <label class="field"><span class="lbl">Date</span><input class="input" type="date" data-lg="date" max="${today()}" value="${esc(w ? (w.date <= today() ? w.date : today()) : date || today())}"></label>
    ${bench ? `<div class="notice accent" style="margin-bottom:14px">${icon('trophy', 'sm')}<div>${thr ? 'Enter the <b>distance you covered in the 30-minute effort</b> (not the warm-up).' : 'Enter your <b>time-trial / race segment</b> only (not the warm-up).'} This result recalculates your training paces.</div></div>` : ''}
    ${isSupp ? '' : `<div class="input-group"><label class="field grow"><span class="lbl">Distance</span><div class="unit-suffix"><input class="input" data-lg="dist" inputmode="decimal" value="${esc(defDist)}"><span>${unit}</span></div></label>`}
    <label class="field grow"><span class="lbl">Duration</span><input class="input" data-lg="time" placeholder="h:mm:ss" value="${esc(defTime)}"></label>${isSupp ? '' : '</div>'}
    <div class="field"><span class="lbl">How hard did it feel? (RPE)</span><div class="rpe-scale">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-rpe="${i + 1}">${i + 1}</button>`).join('')}</div><span class="hint">1 = very easy · 5 = steady · 8 = hard · 10 = max effort</span></div>
    <label class="field"><span class="lbl">Notes</span><textarea class="input" data-lg="notes" placeholder="How did it go?"></textarea></label>
    <button class="btn primary lg block" data-lg-save>${icon('check', 'sm')} Save</button>`, {
    onMount: (el) => {
      let rpe = null;
      el.querySelectorAll('[data-rpe]').forEach((b) => b.onclick = () => { rpe = Number(b.dataset.rpe); el.querySelectorAll('[data-rpe]').forEach((x) => x.classList.toggle('sel', x === b)); });
      el.querySelector('[data-lg-save]').onclick = async () => {
        const g = (k) => el.querySelector(`[data-lg="${k}"]`)?.value;
        const duration = parseClock(g('time'));
        const distance = isSupp ? 0 : fromDisplayDist(Number(g('dist')) || 0);
        if (!duration) { toast('Enter a duration (e.g. 32:15)'); return; }
        if (!isSupp && !distance) { toast('Enter a distance'); return; }
        const act = {
          id: `act-${Date.now()}`, workoutId: w?.id || null, planId: w?.planId || store.state.plan?.id || null, title: w?.title || 'Run', type: w?.type || 'custom',
          date: g('date'), startedAt: Date.now(), finishedAt: Date.now(), duration, distance, avgPace: distance > 50 ? duration / (distance / 1000) : null,
          laps: w?.benchmark && distance ? [{ kind: 'work', label: w.title, distance, duration, avgPace: duration / (distance / 1000) }] : [],
          route: [], mode: 'manual', completionPct: 100, rpe, notes: g('notes') || '', source: 'manual',
        };
        const { suggestion, duplicate } = await store.saveActivity(act);
        sheet.close();
        if (duplicate) { toast('Already logged — duplicate skipped'); return; }
        toast('Saved');
        setTimeout(() => (suggestion ? offerVdotUpdate(suggestion) : showEvaluation(act)), 300);
      };
    },
  });
}

export async function offerVdotUpdate(s) {
  const { vdot, distanceM, timeSec, current } = s;
  const diff = current ? vdot - current : null;
  const body = `Your result of <b>${fmtDuration(timeSec)}</b> for ${fmtDist(distanceM)}${s.kind === 'threshold' ? ' (threshold effort)' : ''} implies a fitness score (VDOT) of <b>${vdot.toFixed(1)}</b>${current ? ` (currently ${current.toFixed(1)}).` : '.'} Updating will recalculate every pace zone for upcoming workouts.`;
  if (diff != null && Math.abs(diff) < 0.3) { toast('Time trial logged — your paces are already accurate.'); return; }
  const ok = await confirmDialog({ title: diff == null ? 'Set your training paces?' : diff > 0 ? 'You’re getting faster!' : 'Adjust your paces?', body, confirm: 'Update paces', cancel: 'Keep current' });
  if (ok) {
    const nv = Math.round(vdot * 10) / 10;
    await store.setVdot(nv, s.kind === 'threshold' ? 'assessment' : 'time trial');
    await store.logChange({ title: 'Fitness level updated', reason: `${s.kind === 'threshold' ? 'Threshold assessment' : 'Time-trial'} result set VDOT to ${nv.toFixed(1)}. Race estimates, all pace zones and upcoming workout targets were recalculated.`, moved: [], removed: [], added: [], modified: [], mileage: [], race: null, total: 0, at: new Date().toISOString() });
    toast('Pace zones updated');
  }
}

export async function unlog(id) {
  const w = store.workout(id);
  if (!w?.activityId) return;
  const ok = await confirmDialog({ title: 'Undo completion?', body: 'The logged activity will be deleted and the workout returns to planned.', confirm: 'Undo', danger: true });
  if (!ok) return;
  await store.deleteActivity(w.activityId);
  closeAllSheets();
}

/** Add a personal workout (custom run, strength, mobility or extra rest). */
export function openAddWorkout(date = today()) {
  const sheet = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Add to calendar</div><h2>Personal workout</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <label class="field"><span class="lbl">Date</span><input class="input" type="date" data-aw="date" min="${today()}" value="${esc(date >= today() ? date : today())}"></label>
    <label class="field"><span class="lbl">Type</span><select class="input" data-aw="type">${opts([
      { value: 'easy', label: 'Easy run' }, { value: 'intervals', label: 'Custom intervals' }, { value: 'strength', label: 'Strength (from your plan settings)' },
      { value: 'mobility', label: 'Mobility session' }, { value: 'rest', label: 'Extra rest day' }], 'easy')}</select></label>
    <div data-aw-extra></div>
    <button class="btn primary lg block" data-aw-save style="margin-top:8px">${icon('plus', 'sm')} Add workout</button>`, {
    onMount: (el) => {
      const typeSel = el.querySelector('[data-aw="type"]');
      const extra = el.querySelector('[data-aw-extra]');
      const unit = distLabel();
      const drawExtra = () => {
        const t = typeSel.value;
        extra.innerHTML = t === 'easy'
          ? `<div class="field"><span class="lbl">Measure</span><div class="input-group"><input class="input" data-aw="val" inputmode="decimal" value="30"><select class="input" data-aw="unit" style="max-width:120px">${opts([{ value: 'min', label: 'minutes' }, { value: 'dist', label: unit }], 'min')}</select></div></div>`
          : t === 'intervals'
          ? `<div class="input-group"><label class="field grow"><span class="lbl">Reps</span><input class="input" data-aw="reps" inputmode="numeric" value="6"></label><label class="field grow"><span class="lbl">Work (sec)</span><input class="input" data-aw="work" inputmode="numeric" value="90"></label><label class="field grow"><span class="lbl">Rest (sec)</span><input class="input" data-aw="rest" inputmode="numeric" value="90"></label></div>
             <label class="field"><span class="lbl">Work effort</span><select class="input" data-aw="zone">${opts([{ value: 'threshold', label: 'Threshold' }, { value: 'interval', label: 'Interval (5K effort)' }, { value: 'rep', label: 'Fast reps' }, { value: 'tempo', label: 'Tempo' }], 'interval')}</select></label>
             <div class="input-group"><label class="field grow"><span class="lbl">Warm-up (min)</span><input class="input" data-aw="wu" inputmode="numeric" value="10"></label><label class="field grow"><span class="lbl">Cool-down (min)</span><input class="input" data-aw="cd" inputmode="numeric" value="10"></label></div>`
          : t === 'strength' || t === 'mobility' ? `<label class="field"><span class="lbl">Length</span><select class="input" data-aw="mins">${opts([10, 15, 20, 25, 35, 45].map((v) => ({ value: v, label: `${v} minutes` })), t === 'strength' ? 25 : 15)}</select></label>` : '<p class="muted small">Adds a rest day marker. Existing workouts that day stay — skip or move them if needed.</p>';
      };
      typeSel.onchange = drawExtra; drawExtra();
      el.querySelector('[data-aw-save]').onclick = async () => {
        const v = (k) => el.querySelector(`[data-aw="${k}"]`)?.value;
        const date = v('date'); const t = v('type');
        const plan = store.state.plan;
        const base = { id: `user-${Date.now().toString(36)}`, planId: plan?.id || 'none', date, week: plan ? Math.floor((new Date(date) - new Date(plan.week1)) / (7 * 86400000)) + 1 : null, phase: null, slot: 'user', status: 'planned', source: 'user', tips: [], key: false };
        let w;
        if (t === 'easy') {
          const amount = Number(v('val')) || 30;
          const steps = v('unit') === 'min' ? [{ kind: 'steady', label: 'Easy running', measure: 'time', value: amount * 60, zone: 'easy' }] : [{ kind: 'steady', label: 'Easy running', measure: 'distance', value: fromDisplayDist(amount), zone: 'easy' }];
          w = { ...base, type: 'custom', title: 'Personal Easy Run', purpose: 'Extra easy running you added.', steps };
        } else if (t === 'intervals') {
          const reps = Math.max(1, Number(v('reps')) || 6);
          const steps = [
            { kind: 'warmup', label: 'Warm-up', measure: 'time', value: (Number(v('wu')) || 10) * 60, zone: 'easy' },
            { repeat: reps, dropLastRecovery: true, steps: [{ kind: 'work', label: 'Work', measure: 'time', value: Number(v('work')) || 90, zone: v('zone') }, { kind: 'recover', label: 'Recovery', measure: 'time', value: Number(v('rest')) || 90, zone: 'recovery' }] },
            { kind: 'cooldown', label: 'Cool-down', measure: 'time', value: (Number(v('cd')) || 10) * 60, zone: 'easy' },
          ];
          w = { ...base, type: 'intervals', title: `Custom ${reps} × ${v('work')}s`, purpose: 'A custom interval session you created.', steps };
        } else if (t === 'strength' || t === 'mobility') {
          const { buildStrengthSession, buildMobilitySession } = await import('../engine/strength.js');
          const sp = plan?.inputs?.prefs?.strength || {};
          const s = t === 'strength' ? buildStrengthSession({ equipment: sp.equipment, experience: plan?.inputs?.fitness?.experience, minutes: Number(v('mins')), index: Date.now() % 7 }) : buildMobilitySession({ minutes: Number(v('mins')), index: Date.now() % 5 });
          w = { ...base, type: t, title: t === 'strength' ? 'Runner Strength' : 'Mobility & Recovery', purpose: 'Supplemental session you added.', steps: s.steps, exercises: s.exercises, estDuration: s.estSec, estDistance: 0 };
        } else {
          w = { ...base, type: 'rest', title: 'Extra Rest Day', purpose: 'A rest day you added.', steps: [], estDistance: 0, estDuration: 0 };
        }
        if (w.steps?.length && !w.estDuration) { const e = estimateWorkout(w.steps, plan?.paces, plan?.assumedEasy || 420); w.estDistance = e.distance; w.estDuration = e.duration; }
        await store.putWorkouts([w]);
        sheet.close();
        toast('Added to your calendar');
      };
    },
  });
}

export async function deleteWorkout(id) {
  const ok = await confirmDialog({ title: 'Delete this workout?', body: 'This personal workout will be removed from your calendar.', confirm: 'Delete', danger: true });
  if (!ok) return;
  await store.removeWorkout(id);
  closeAllSheets();
}

/** Adds the chosen assessment as the first workout of the plan (replacing that day's run). */
export async function scheduleAssessment(kind) {
  const plan = store.state.plan;
  if (!plan) return;
  const first = store.state.workouts.find((w) => w.date >= today() && isRun(w) && w.status === 'planned' && w.type !== 'long');
  const date = first ? first.date : today();
  const ctx = { paces: plan.paces, assumedEasy: plan.assumedEasy, pref: plan.inputs?.prefs?.mode || 'distance', unit: plan.inputs?.unit, experience: plan.inputs?.fitness?.experience };
  const built = assessmentWorkout(kind, ctx);
  const est = estimateWorkout(built.steps, plan.paces, plan.assumedEasy);
  const w = { id: `user-assess-${Date.now().toString(36)}`, planId: plan.id, date, week: first?.week || 1, phase: first?.phase || null, slot: 'user', status: 'planned', source: 'user', ...built, estDistance: est.distance, estDuration: est.duration };
  const changes = [w];
  if (first) changes.push({ ...first, status: 'replaced' });
  await store.putWorkouts(changes);
}

export function viewActivity(id) {
  const a = store.state.activities.find((x) => x.id === id);
  if (!a) return;
  import('./live.js').then((m) => m.showActivitySheet(a));
}

export { vdotFromRace, easyRun, TYPE_META };
