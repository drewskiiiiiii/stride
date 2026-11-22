// Plan preview: summary, realism check, phases, volume curve and paces — before activation.

import { esc, icon } from './dom.js';
import { fmtDist, fmtDuration, fmtMinutes, fmtPaceRange } from '../core/units.js';
import { fmtDate, fmtLongDate } from '../core/dates.js';
import { ZONE_INFO } from '../engine/vdot.js';
import { workoutLine, typeColor, speedUnit, showSpeeds } from './format.js';
import { stepSpeed, fmtSpeedRange } from '../engine/treadmill.js';

export function phaseStrip(plan) {
  return `<div class="phase-strip">${plan.phases.map((p) => `<i class="ph-${p.phase}" style="flex:${p.to - p.from + 1}" title="${esc(p.label)}"></i>`).join('')}</div>
  <div class="phase-legend">${plan.phases.map((p) => `<span><i class="dot ph-${p.phase}"></i>${esc(p.label)} <span class="muted">wk ${p.from}${p.to > p.from ? '–' + p.to : ''}</span></span>`).join('')}</div>`;
}

export function volumeBars(plan, currentWeek = 0) {
  const vols = plan.summary.weekVols;
  const max = Math.max(...vols, 1);
  return `<div class="mini-bars">${vols.map((v, i) => `<i class="${i + 1 === currentWeek ? 'cur' : plan.weeks[i]?.recovery ? 'rec' : ''}" style="height:${Math.max(4, (v / max) * 100)}%" title="Week ${i + 1}: ${fmtDist(v)}"></i>`).join('')}</div>`;
}

export function pacesTable(plan) {
  if (!plan.paces) return `<div class="notice">${icon('info', 'sm')}<div>No recent race result yet, so workouts use <b>effort (RPE)</b> and breathing cues instead of invented paces. Complete the scheduled time trial — or add a result in Profile — to unlock pace zones.</div></div>`;
  const rows = ['recovery', 'easy', 'long', 'steady', 'marathon', 'tempo', 'threshold', 'interval', 'rep'].filter((z) => plan.paces[z]);
  const sp = showSpeeds(plan) || plan.inputs?.prefs?.treadmill;
  return `<table class="pace-table">${rows.map((z) => `<tr><td><span class="row"><span class="dot" data-z="${z === 'marathon' ? 'steady' : z}"></span>${esc(ZONE_INFO[z].name)}</span><div class="tiny muted">${esc(ZONE_INFO[z].effort)}</div></td><td>${fmtPaceRange(plan.paces[z])}${sp ? `<div class="tiny muted" style="font-weight:600">${fmtSpeedRange(stepSpeed({ kind: 'work', zone: z, targetPace: plan.paces[z] }, { unit: speedUnit() }))}</div>` : ''}</td></tr>`).join('')}</table>
  ${plan.paceConfidence === 'low' ? '<p class="tiny muted">Estimated from your easy pace only — harder zones use effort until you log a time trial.</p>' : ''}`;
}

export function renderPreview(res, { editing } = {}) {
  const { plan, workouts } = res;
  const s = plan.summary;
  const sev = plan.warnings.filter((w) => w.level === 'aggressive');
  const cautions = plan.warnings.filter((w) => w.level !== 'aggressive');
  const firstWeeks = workouts.filter((w) => w.week <= 2 && w.type !== 'rest');
  const est = s.estimate;
  return `<div class="ob fade-in" style="padding-bottom:160px">
    <div class="ob-top"><button class="icon-btn plain" data-pv-back aria-label="Back">${icon('chevL')}</button><div class="grow"></div></div>
    <div class="ob-section-label">Your plan</div>
    <h1>${esc(plan.goal.label)}</h1>
    <p class="lead">${s.totalWeeks} weeks · ${fmtDate(plan.startDate, { month: 'short', day: 'numeric' })} → ${fmtDate(s.completionDate, { month: 'short', day: 'numeric', year: 'numeric' })}</p>

    ${sev.map((w) => `<div class="notice danger">${icon('alert', 'sm')}<div>${esc(w.msg)}</div></div>`).join('')}
    ${cautions.map((w) => `<div class="notice ${w.level === 'ok' ? 'ok' : 'warn'}">${icon(w.level === 'ok' ? 'info' : 'alert', 'sm')}<div>${esc(w.msg)}</div></div>`).join('')}
    ${(plan.check.recommendedDate && plan.raceDate && plan.check.level !== 'ok') || plan.check.achievableTimeSec && sev.length ? `<div class="btn-row" style="margin:10px 0 4px">
      ${plan.check.recommendedDate && plan.goal.raceDate ? `<button class="btn sm ghost" data-pv-fix="date" data-val="${plan.check.recommendedDate}">Use ${fmtDate(plan.check.recommendedDate, { month: 'short', day: 'numeric' })} instead</button>` : ''}
      ${plan.check.achievableTimeSec && sev.length ? `<button class="btn sm ghost" data-pv-fix="time" data-val="${Math.round(plan.check.achievableTimeSec)}">Target ${fmtDuration(plan.check.achievableTimeSec)}</button>` : ''}
    </div>` : ''}

    <div class="card" style="margin-top:14px">
      <div class="stat-grid">
        <div><div class="metric"><div class="v">${s.totalWeeks}</div><div class="l">Weeks</div></div></div>
        <div><div class="metric"><div class="v">${s.runsPerWeek}</div><div class="l">Runs / week</div></div></div>
        <div><div class="metric"><div class="v">${fmtDist(s.startWeekly)}</div><div class="l">Starting week</div></div></div>
        <div><div class="metric"><div class="v">${fmtDist(s.peakWeekly)}</div><div class="l">Peak week</div></div></div>
        <div><div class="metric"><div class="v">${s.longestRun ? fmtDist(s.longestRun) : '—'}</div><div class="l">Longest run</div></div></div>
        <div><div class="metric"><div class="v">${s.workoutsPerWeek}</div><div class="l">Sessions / week</div></div></div>
      </div>
      ${est ? `<div class="divider"></div><div class="row between"><div><div class="upper muted">Estimated finish</div><div style="font-size:22px;font-weight:750" class="num">${fmtDuration(est.projected)}</div></div><div class="right small muted">Today’s fitness: <b class="num" style="color:var(--text)">${fmtDuration(est.now)}</b></div></div>` : ''}
      <div class="divider"></div>
      <div class="row between small"><span class="muted">Completion</span><b>${fmtLongDate(s.completionDate)}</b></div>
    </div>

    <div class="section-title"><h2>Training phases</h2></div>
    <div class="card">${phaseStrip(plan)}<div style="margin-top:16px">${volumeBars(plan)}</div><div class="row between tiny muted" style="margin-top:6px"><span>Week 1</span><span>Weekly distance</span><span>Week ${s.totalWeeks}</span></div></div>

    <div class="section-title"><h2>Your first two weeks</h2></div>
    <div>${firstWeeks.map((w) => `<div class="workout-row" data-z="${typeColor(w.type)}"><span class="zbar"></span><div class="date"><div class="d">${fmtDate(w.date, { day: 'numeric' })}</div><div class="w">${fmtDate(w.date, { weekday: 'short' })}</div></div><div class="body"><div class="t">${esc(w.title)}</div><div class="s">${esc(workoutLine(w, plan))}</div></div></div>`).join('')}</div>

    <div class="section-title"><h2>Training zones</h2></div>
    <div class="card">${pacesTable(plan)}</div>

    <div class="section-title"><h2>Fine-tune</h2></div>
    <div class="list">
      <button class="list-item" data-pv-edit="days">${icon('calendar', 'sm')}<div class="grow"><div class="t">Running days</div><div class="s">${plan.frequency} days · long run ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][plan.longDay]}</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-pv-edit="goalDetail">${icon('flag', 'sm')}<div class="grow"><div class="t">Goal, date & target time</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-pv-edit="prefs">${icon('tempo', 'sm')}<div class="grow"><div class="t">Progression & workout format</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-pv-edit="supplemental">${icon('strength', 'sm')}<div class="grow"><div class="t">Strength & mobility</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-pv-edit="benchmarks">${icon('trophy', 'sm')}<div class="grow"><div class="t">Benchmarks & assessment</div></div>${icon('chevR', 'sm chev')}</button>
    </div>
  </div>
  <div class="ob-foot"><div class="inner"><button class="btn primary lg" data-pv-activate>${icon('check', 'sm')} ${editing ? 'Activate new plan' : 'Start this plan'}</button></div></div>`;
}

export function bindPreview(root, res, { onEdit, onBack, onActivate, onRegenerate }) {
  root.querySelector('[data-pv-back]').onclick = onBack;
  root.querySelectorAll('[data-pv-edit]').forEach((b) => b.onclick = () => onEdit(b.dataset.pvEdit));
  root.querySelectorAll('[data-pv-fix]').forEach((b) => b.onclick = () => {
    if (b.dataset.pvFix === 'date') onRegenerate({ raceDate: b.dataset.val });
    else onRegenerate({ targetTime: fmtDuration(Number(b.dataset.val)) });
  });
  const act = root.querySelector('[data-pv-activate]');
  act.onclick = async () => { act.disabled = true; act.textContent = 'Saving…'; await onActivate(res); };
}

export { fmtMinutes };
