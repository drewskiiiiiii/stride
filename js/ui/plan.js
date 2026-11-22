// Plan tab — full program, phases, weekly breakdown, zones and adjustment entry points.

import { esc, icon } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, fmtDate, fmtLongDate } from '../core/dates.js';
import { fmtDist, fmtMinutes, fmtDuration } from '../core/units.js';
import { effectiveStatus } from '../engine/adjustments.js';
import { isRun } from '../engine/workout-utils.js';
import { workoutLine, typeColor } from './format.js';
import { phaseStrip, volumeBars, pacesTable } from './preview.js';

const expanded = new Set();

export function renderPlan() {
  const { plan, workouts } = store.state;
  const today = todayISO();
  if (!plan) return `<div class="page-head"><h1>Plan</h1></div><div class="card empty">${icon('plan')}<p>No active plan.</p><a class="btn primary" href="#/new-plan">Create a plan</a></div>`;
  const cur = plan.weeks.find((w) => w.start <= today && w.end >= today);
  if (cur && !expanded.size) expanded.add(cur.index);
  const s = plan.summary;
  const adjustments = (plan.inputs?.adjustments || []).filter((a) => !a.end || a.end >= today || a.type === 'volume');

  const weeksHtml = plan.weeks.map((wk) => {
    const ws = workouts.filter((w) => w.week === wk.index && w.status !== 'replaced' && (w.type !== 'rest' || w.source === 'user'));
    const runs = ws.filter(isRun);
    const done = runs.filter((w) => w.status === 'completed').length;
    const open = expanded.has(wk.index);
    const isCur = cur && cur.index === wk.index;
    const past = wk.end < today;
    return `<div class="card week-card ${isCur ? 'current' : ''}" style="margin-top:10px">
      <button class="wk-head" data-action="toggle-week" data-week="${wk.index}">
        <div style="width:44px" class="center"><div class="tiny muted upper">Wk</div><div style="font-size:20px;font-weight:780" class="num">${wk.index}</div></div>
        <div class="grow"><div style="font-weight:680">${esc(wk.phaseLabel)}${wk.recovery ? ' · <span class="muted">Recovery week</span>' : ''}${isCur ? ' <span class="chip accent" style="margin-left:4px">This week</span>' : ''}</div>
          <div class="small muted">${fmtDate(wk.start, { month: 'short', day: 'numeric' })} – ${fmtDate(wk.end, { month: 'short', day: 'numeric' })} · ${fmtDist(wk.targetDist)} · ${runs.length} runs${past || isCur ? ` · ${done}/${runs.length} done` : ''}</div></div>
        ${icon(open ? 'chevD' : 'chevR', 'sm')}
      </button>
      ${open ? `<div class="wk-body"><p class="small muted" style="margin:0 4px 10px">${esc(wk.focus || '')}</p>${ws.length ? ws.map((w) => {
        const st = effectiveStatus(w, today);
        return `<button class="workout-row ${st === 'completed' ? 'done' : ''} ${w.date === today ? 'today' : ''}" data-z="${typeColor(w.type)}" data-action="open-workout" data-id="${w.id}"><span class="zbar"></span>
          <div class="date"><div class="d">${fmtDate(w.date, { day: 'numeric' })}</div><div class="w">${fmtDate(w.date, { weekday: 'short' })}</div></div>
          <div class="body"><div class="t">${esc(w.title)}</div><div class="s">${esc(workoutLine(w, plan))}</div></div>
          ${st === 'completed' ? `<span class="status-ic completed">${icon('check', 'xs')}</span>` : st === 'missed' ? `<span class="status-ic missed">${icon('x', 'xs')}</span>` : st === 'skipped' ? `<span class="status-ic skipped">—</span>` : ''}
        </button>`;
      }).join('') : '<div class="muted small" style="padding:8px">No sessions</div>'}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="page-head"><div><div class="sub">${s.totalWeeks}-week plan · ends ${esc(fmtLongDate(s.completionDate))}</div><h1>${esc(plan.name || plan.goal.label)}</h1></div></div>
  <div class="grid-2"><div class="col">
    <div class="card fade-in">
      ${phaseStrip(plan)}
      <div style="margin-top:16px">${volumeBars(plan, cur?.index)}</div>
      <div class="row between tiny muted" style="margin-top:6px"><span>Week 1</span><span>Weekly distance</span><span>Week ${s.totalWeeks}</span></div>
      <div class="divider"></div>
      <div class="stat-grid">
        <div class="metric sm"><div class="v">${fmtDist(s.peakWeekly)}</div><div class="l">Peak week</div></div>
        <div class="metric sm"><div class="v">${fmtDist(s.longestRun)}</div><div class="l">Longest run</div></div>
        <div class="metric sm"><div class="v">${s.runsPerWeek}</div><div class="l">Runs / week</div></div>
        <div class="metric sm"><div class="v">${s.estimate ? fmtDuration(s.estimate.projected) : plan.raceDate ? fmtDate(plan.raceDate, { month: 'short', day: 'numeric' }) : '—'}</div><div class="l">${s.estimate ? 'Est. finish' : plan.raceDate ? 'Goal date' : ' '}</div></div>
      </div>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" data-action="adjust-plan">${icon('refresh', 'sm')} Plan adjustment</button>
      <button class="btn" data-action="add-workout">${icon('plus', 'sm')} Add workout</button>
    </div>
    ${adjustments.length ? `<div class="section-title"><h2>Active adjustments</h2></div><div class="list">${adjustments.map((a) => `<div class="list-item">${icon({ travel: 'plane', illness: 'thermometer', volume: 'progress', unavailable: 'calendar', rest: 'rest', restrict: 'alert' }[a.type] || 'recovery', 'sm')}<div class="grow"><div class="t">${esc(adjLabel(a))}</div><div class="s">${a.start ? esc(fmtDate(a.start)) : ''}${a.end && a.end !== a.start ? ' – ' + esc(fmtDate(a.end)) : ''}</div></div><button class="icon-btn plain" data-action="remove-adjustment" data-id="${a.id}" aria-label="Remove">${icon('x', 'sm')}</button></div>`).join('')}</div>` : ''}
    <div class="section-title"><h2>Weeks</h2><button class="link-btn" data-action="expand-all">${expanded.size > 1 ? 'Collapse' : 'Expand all'}</button></div>
    ${weeksHtml}
  </div>
  <div class="col">
    <div class="section-title"><h2>Training zones</h2><button class="link-btn" data-action="edit-paces">Adjust</button></div>
    <div class="card">${pacesTable(plan)}${plan.vdot ? `<div class="divider"></div><div class="row between small"><span class="muted">Fitness score (VDOT)</span><b class="num">${plan.vdot.toFixed(1)}</b></div>` : ''}</div>
    <div class="section-title"><h2>Plan settings</h2></div>
    <div class="list">
      <button class="list-item" data-action="plan-settings">${icon('settings', 'sm')}<div class="grow"><div class="t">Change training preferences</div><div class="s">Days, volume, intensity, strength, race date</div></div>${icon('chevR', 'sm chev')}</button>
      <a class="list-item" href="#/new-plan">${icon('plus', 'sm')}<div class="grow"><div class="t">Start a new plan</div><div class="s">Your current plan is archived, history kept</div></div>${icon('chevR', 'sm chev')}</a>
      <button class="list-item" data-action="change-history">${icon('log', 'sm')}<div class="grow"><div class="t">Change history</div><div class="s">${(store.state.meta.changeLog || []).length} adjustments with explanations</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-action="assessment">${icon('trophy', 'sm')}<div class="grow"><div class="t">Schedule a fitness assessment</div><div class="s">1 mile, 5K or 30-min threshold test</div></div>${icon('chevR', 'sm chev')}</button>
      <button class="list-item" data-action="export-ics">${icon('calendar', 'sm')}<div class="grow"><div class="t">Export to phone calendar</div><div class="s">.ics file with workout reminders</div></div>${icon('chevR', 'sm chev')}</button>
    </div>
    ${plan.warnings?.length ? `<div class="section-title"><h2>Coach notes</h2></div>${plan.warnings.map((w) => `<div class="notice ${w.level === 'aggressive' ? 'danger' : w.level === 'ok' ? 'ok' : 'warn'}">${icon('info', 'sm')}<div>${esc(w.msg)}</div></div>`).join('')}` : ''}
  </div></div>`;
}

export function adjLabel(a) {
  if (a.type === 'travel') return a.mode === 'light' ? 'Travel — light running' : 'Travel — no running';
  if (a.type === 'illness') return 'Illness / rest';
  if (a.type === 'hold') return 'Hold volume';
  if (a.type === 'recovery') return 'Extra recovery week';
  if (a.type === 'volume') return `Volume ${a.factor > 1 ? '+' : ''}${Math.round((a.factor - 1) * 100)}%`;
  if (a.type === 'unavailable') return 'Unavailable';
  if (a.type === 'rest') return 'Extra rest day';
  if (a.type === 'restrict') return a.mode === 'easy' ? 'Restriction — easy running only' : 'Restriction — reduced volume';
  return a.type;
}

export function toggleWeek(i) { expanded.has(i) ? expanded.delete(i) : expanded.add(i); }
export function expandAll() {
  const plan = store.state.plan; if (!plan) return;
  if (expanded.size > 1) expanded.clear(); else plan.weeks.forEach((w) => expanded.add(w.index));
}
