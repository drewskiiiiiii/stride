// Interactive monthly / weekly calendar with daily detail.

import { esc, icon } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, addDays, startOfWeek, startOfMonth, addMonths, fmtDate, MONTHS, DAY_SHORT, parseISO, fmtLongDate } from '../core/dates.js';
import { fmtDist, fmtMinutes, fmtDuration } from '../core/units.js';
import { effectiveStatus } from '../engine/adjustments.js';
import { isRun, TYPE_META } from '../engine/workout-utils.js';
import { typeColor, workoutLine, typeLabel, statusLabel } from './format.js';

export const cal = { mode: 'month', anchor: null, selected: null };

function dayItems(date) {
  const { workouts, activities } = store.state;
  const ws = workouts.filter((w) => w.date === date && w.status !== 'replaced');
  const linked = new Set(ws.map((w) => w.activityId).filter(Boolean));
  const extra = activities.filter((a) => a.date === date && !linked.has(a.id));
  return { ws, extra };
}

const canDrag = (w, today) => w.status === 'planned' && w.type !== 'rest' && w.type !== 'race' && w.date >= addDays(today, -7);

function pill(w, today) {
  const st = effectiveStatus(w, today);
  if (w.type === 'rest') return w.source === 'user' ? `<span class="cal-pill rest">Rest</span>` : '';
  const short = { easy: 'Easy', long: 'Long', recovery: 'Recov', tempo: 'Tempo', threshold: 'Thresh', intervals: 'Intvl', reps: 'Speed', fartlek: 'Fartlek', hills: 'Hills', timetrial: 'TT', assessment: 'Test', race: 'RACE', runwalk: 'R/W', strength: 'Str', mobility: 'Mob', custom: 'Run' }[w.type] || 'Run';
  const dist = w.estDistance && isRun(w) && w.type !== 'race' ? fmtDist(w.estDistance, { withUnit: false, decimals: w.estDistance > 15000 ? 0 : 1 }) : '';
  const drag = canDrag(w, today) ? `data-drag-id="${w.id}"` : '';
  return `<span class="cal-pill ${st} ${dist ? 'has-num' : ''}" data-z="${typeColor(w.type)}" ${drag}>${st === 'completed' ? '✓' : ''}<span class="pl">${esc(short)}</span>${dist ? `<span class="pn">${esc(dist)}</span>` : ''}</span>`;
}

export function renderCalendar() {
  const today = todayISO();
  if (!cal.anchor) cal.anchor = today;
  if (!cal.selected) cal.selected = today;
  const { plan } = store.state;
  const toolbar = `<div class="cal-toolbar">
    <button class="icon-btn" data-action="cal-prev" aria-label="Previous">${icon('chevL', 'sm')}</button>
    <div class="title">${cal.mode === 'month' ? `${MONTHS[parseISO(cal.anchor).getMonth()]} ${parseISO(cal.anchor).getFullYear()}` : `${fmtDate(startOfWeek(cal.anchor), { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(startOfWeek(cal.anchor), 6), { month: 'short', day: 'numeric' })}`}</div>
    <button class="icon-btn" data-action="cal-next" aria-label="Next">${icon('chevR', 'sm')}</button>
  </div>`;
  const head = `<div class="page-head"><div><div class="sub">${plan ? esc(plan.name || plan.goal.label) : 'No active plan'}</div><h1>Calendar</h1></div>
    <div style="width:170px"><div class="seg"><button data-action="cal-mode" data-mode="month" class="${cal.mode === 'month' ? 'sel' : ''}">Month</button><button data-action="cal-mode" data-mode="week" class="${cal.mode === 'week' ? 'sel' : ''}">Week</button></div></div></div>`;
  const body = cal.mode === 'month' ? monthView(today) : weekView(today);
  const legend = `<div class="tiny muted" style="margin-top:10px">${icon('move', 'xs')} Drag a workout to reschedule — long-press on touch screens. Every move is checked for recovery, long-run, taper and mileage conflicts.</div><div class="legend-row"><span><i class="dot" data-z="easy"></i>Easy</span><span><i class="dot" data-z="long"></i>Long</span><span><i class="dot" data-z="tempo"></i>Tempo</span><span><i class="dot" data-z="interval"></i>Intervals</span><span><i class="dot" data-z="strength"></i>Strength</span><span><i class="dot" data-z="mobility"></i>Mobility</span><span><i class="dot" style="background:var(--accent)"></i>Done</span><span><i class="dot" style="background:var(--danger)"></i>Missed</span></div>`;
  return `${head}<div class="grid-2"><div class="col"><div class="card" style="padding:14px">${toolbar}${body}${legend}</div></div>
    <div class="col">${cal.mode === 'month' ? dayPanel(cal.selected, today) : ''}</div></div>`;
}

function weekTotal(ws) {
  const { workouts, activities } = store.state;
  const end = addDays(ws, 6);
  const runs = workouts.filter((w) => w.date >= ws && w.date <= end && isRun(w) && w.status !== 'replaced' && w.status !== 'skipped');
  const planned = runs.reduce((s, w) => s + (w.estDistance || 0), 0);
  const done = activities.filter((a) => a.date >= ws && a.date <= end).reduce((s, a) => s + (a.distance || 0), 0);
  return { planned, done };
}

function monthView(today) {
  const first = startOfMonth(cal.anchor);
  const gridStart = startOfWeek(first);
  const month = parseISO(first).getMonth();
  let html = `<div class="cal-grid with-total">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="cal-dow">${DAY_SHORT[d].slice(0, 2)}</div>`).join('')}<div class="cal-dow">${icon('progress', 'xs')}</div>`;
  for (let wk = 0; wk < 6; wk++) {
    const ws = addDays(gridStart, wk * 7);
    if (wk > 0 && parseISO(ws).getMonth() !== month) break;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const { ws: items, extra } = dayItems(d);
      const pills = items.map((w) => pill(w, today)).join('') + extra.map((a) => `<span class="cal-pill completed">✓ ${esc(fmtDist(a.distance, { withUnit: false, decimals: 1 }))}</span>`).join('');
      html += `<button class="cal-cell ${parseISO(d).getMonth() !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${d === cal.selected ? 'sel' : ''}" data-action="cal-select" data-date="${d}" data-drop-date="${d}"><span class="dn">${parseISO(d).getDate()}</span>${pills}</button>`;
    }
    const t = weekTotal(ws);
    html += `<div class="cal-total"><b>${t.planned ? fmtDist(t.planned, { withUnit: false, decimals: 0 }) : '–'}</b>${t.done ? `<span style="color:var(--accent-text)">${fmtDist(t.done, { withUnit: false, decimals: 0 })}</span>` : ''}</div>`;
  }
  return html + '</div>';
}

function itemRow(w, today, plan) {
  const st = effectiveStatus(w, today);
  return `<button class="workout-row ${st === 'completed' ? 'done' : ''}" data-z="${typeColor(w.type)}" data-action="open-workout" data-id="${w.id}" ${canDrag(w, today) ? `data-drag-id="${w.id}"` : ''}><span class="zbar"></span>
    <div class="body"><div class="t">${esc(w.title)}</div><div class="s">${esc(typeLabel(w.type))}${w.type !== 'rest' ? ' · ' + esc(workoutLine(w, plan)) : ''}${st !== 'planned' && w.type !== 'rest' ? ' · ' + esc(statusLabel(st)) : ''}</div></div>
    ${st === 'completed' ? `<span class="status-ic completed">${icon('check', 'xs')}</span>` : st === 'missed' ? `<span class="status-ic missed">${icon('x', 'xs')}</span>` : icon('chevR', 'sm chev')}</button>`;
}

function activityRow(a) {
  return `<button class="workout-row done" data-z="easy" data-action="view-activity" data-id="${a.id}"><span class="zbar" style="background:var(--accent)"></span><div class="body"><div class="t">${esc(a.title || 'Run')}</div><div class="s">${fmtDist(a.distance)} · ${fmtDuration(a.duration)} · logged</div></div><span class="status-ic completed">${icon('check', 'xs')}</span></button>`;
}

function dayPanel(date, today) {
  const { plan } = store.state;
  const { ws, extra } = dayItems(date);
  const visible = ws.filter((w) => w.type !== 'rest' || w.source === 'user');
  const isRest = !visible.filter((w) => w.type !== 'rest').length && !extra.length;
  return `<div class="section-title"><h2>${esc(fmtLongDate(date))}</h2>${date >= today ? `<button class="link-btn" data-action="add-workout" data-date="${date}">${icon('plus', 'xs')} Add</button>` : `<button class="link-btn" data-action="log-run" data-date="${date}">${icon('plus', 'xs')} Log run</button>`}</div>
    ${isRest ? `<div class="card flat"><div class="row">${icon('rest', 'sm')}<div><b>Rest day</b><div class="small muted">Recovery is where adaptation happens.</div></div></div></div>` : ''}
    ${visible.filter((w) => w.type !== 'rest').map((w) => itemRow(w, today, plan)).join('')}
    ${extra.map(activityRow).join('')}`;
}

function weekView(today) {
  const ws = startOfWeek(cal.anchor);
  const { plan } = store.state;
  const t = weekTotal(ws);
  const wk = plan?.weeks.find((w) => w.start === ws);
  let html = `<div class="row between small" style="margin-bottom:6px"><span class="muted">${wk ? `Week ${wk.index} · ${esc(wk.phaseLabel)}${wk.recovery ? ' · Recovery' : ''}` : ''}</span><span><b class="num">${fmtDist(t.done, { withUnit: false })}</b> <span class="muted">/ ${fmtDist(t.planned)}</span></span></div>`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const { ws: items, extra } = dayItems(d);
    const real = items.filter((w) => w.type !== 'rest');
    const dur = real.reduce((s, w) => s + (w.estDuration || 0), 0);
    html += `<div class="wk-day ${d === today ? 'today' : ''}" data-drop-date="${d}"><div class="dcol"><div class="d">${parseISO(d).getDate()}</div><div class="w">${DAY_SHORT[parseISO(d).getDay()]}</div>${dur ? `<div class="tiny muted" style="margin-top:4px">${fmtMinutes(dur)}</div>` : ''}</div>
      <div class="items">${real.map((w) => itemRow(w, today, plan)).join('')}${extra.map(activityRow).join('')}
      ${!real.length && !extra.length ? `<div class="rest-line">${icon('rest', 'xs')} Rest day${d >= today ? ` · <button class="link-btn" data-action="add-workout" data-date="${d}">Add workout</button>` : ''}</div>` : ''}</div></div>`;
  }
  return html;
}

export function calNav(dir) {
  cal.anchor = cal.mode === 'month' ? addMonths(cal.anchor || todayISO(), dir) : addDays(cal.anchor || todayISO(), dir * 7);
  if (cal.mode === 'month') cal.selected = cal.anchor.slice(0, 7) === todayISO().slice(0, 7) ? todayISO() : cal.anchor;
}
