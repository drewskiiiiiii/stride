// Progress & analytics.

import { esc, icon, openSheet, toast, opts, confirmDialog } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, startOfWeek, addDays, fmtDate, MONTHS, parseISO } from '../core/dates.js';
import { fmtDist, fmtDuration, fmtPace, toDisplayDist, distLabel, paceLabel, parseClock } from '../core/units.js';
import { predictTime } from '../engine/vdot.js';
import { BENCHMARK_LABEL } from '../engine/assessment.js';
import { isRun } from '../engine/workout-utils.js';
import { barChart, lineChart } from './charts.js';

export const prog = { range: 12 };

export function renderProgress() {
  const { activities, workouts, plan, meta } = store.state;
  const today = todayISO();
  const runs = activities.filter((a) => a.type !== 'strength' && a.type !== 'mobility' && a.distance > 0);
  const totalDist = runs.reduce((s, a) => s + a.distance, 0);
  const totalTime = runs.reduce((s, a) => s + a.duration, 0);
  const avgPace = totalDist > 0 ? totalTime / (totalDist / 1000) : null;
  const plannedPast = workouts.filter((w) => isRun(w) && w.date < today && w.status !== 'replaced' && w.status !== 'skipped');
  const completion = plannedPast.length ? Math.round((plannedPast.filter((w) => w.status === 'completed').length / plannedPast.length) * 100) : null;
  const pr = store.personalRecords();

  // weekly series
  const N = prog.range;
  const thisWeek = startOfWeek(today);
  const weeks = Array.from({ length: N }, (_, i) => addDays(thisWeek, (i - N + 1) * 7));
  const wDone = weeks.map((ws) => runs.filter((a) => a.date >= ws && a.date <= addDays(ws, 6)).reduce((s, a) => s + a.distance, 0));
  const wPlan = weeks.map((ws) => workouts.filter((w) => w.date >= ws && w.date <= addDays(ws, 6) && isRun(w) && w.status !== 'replaced' && w.status !== 'skipped').reduce((s, w) => s + (w.estDistance || 0), 0));
  const wLabels = weeks.map((ws) => fmtDate(ws, { month: 'numeric', day: 'numeric' }));
  const consistencyWeeks = weeks.filter((ws, i) => wDone[i] > 0).length;
  // streak of consecutive weeks with ≥1 run (ending this or last week)
  let streak = 0;
  for (let i = N - 1; i >= 0; i--) { if (wDone[i] > 0) streak++; else if (i === N - 1) continue; else break; }

  // monthly
  const months = Array.from({ length: 12 }, (_, i) => { const d = parseISO(today); d.setDate(1); d.setMonth(d.getMonth() - 11 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const mDone = months.map((m) => runs.filter((a) => a.date.startsWith(m)).reduce((s, a) => s + a.distance, 0));

  // pace trend (weekly average pace)
  const wPace = weeks.map((ws) => {
    const r = runs.filter((a) => a.date >= ws && a.date <= addDays(ws, 6) && !a.distanceEstimated);
    const d = r.reduce((s, a) => s + a.distance, 0), t = r.reduce((s, a) => s + a.duration, 0);
    return d > 500 ? t / (d / 1000) : null;
  });
  // longest run per week
  const wLong = weeks.map((ws) => Math.max(0, ...runs.filter((a) => a.date >= ws && a.date <= addDays(ws, 6)).map((a) => a.distance)));
  // completion per week
  const wComp = weeks.map((ws) => {
    const r = workouts.filter((w) => w.date >= ws && w.date <= addDays(ws, 6) && w.date < today && isRun(w) && w.status !== 'replaced' && w.status !== 'skipped');
    return r.length ? Math.round((r.filter((w) => w.status === 'completed').length / r.length) * 100) : 0;
  });
  // estimated race performance
  const goalDist = plan?.goal?.distanceM || 5000;
  const vh = meta.vdotHistory || [];
  const raceLabels = vh.map((h) => fmtDate(h.date, { month: 'short', day: 'numeric' }));
  const raceVals = vh.map((h) => predictTime(h.vdot, goalDist));
  const goalName = goalDist === 5000 ? '5K' : goalDist === 10000 ? '10K' : Math.abs(goalDist - 21097.5) < 1 ? 'half marathon' : Math.abs(goalDist - 42195) < 1 ? 'marathon' : fmtDist(goalDist);

  const prCard = (key) => {
    const r = pr.races[key];
    return `<div class="stat"><div class="l">${esc(BENCHMARK_LABEL[key])}</div><div class="v">${r ? fmtDuration(r.timeSec) : '—'}</div><div class="tiny muted">${r ? esc(fmtDate(r.date || today, { month: 'short', day: 'numeric', year: '2-digit' })) : 'No result yet'}</div></div>`;
  };

  const history = activities.slice(0, 60);
  return `<div class="page-head"><div><div class="sub">All-time · history kept across plans</div><h1>Progress</h1></div><button class="icon-btn" data-action="log-run" aria-label="Log run">${icon('plus')}</button></div>
  <div class="stat-grid four fade-in">
    <div class="stat"><div class="v">${fmtDist(totalDist, { withUnit: false, decimals: totalDist > 100000 ? 0 : 1 })}<small>${distLabel()}</small></div><div class="l">Total distance</div></div>
    <div class="stat"><div class="v">${Math.floor(totalTime / 3600)}<small>h</small> ${Math.round((totalTime % 3600) / 60)}<small>m</small></div><div class="l">Total running time</div></div>
    <div class="stat"><div class="v">${runs.length}</div><div class="l">Runs logged</div></div>
    <div class="stat"><div class="v">${completion != null ? completion + '<small>%</small>' : '—'}</div><div class="l">Workout completion</div></div>
    <div class="stat"><div class="v">${avgPace ? fmtPace(avgPace) : '—'}<small>${paceLabel()}</small></div><div class="l">Average pace</div></div>
    <div class="stat"><div class="v">${pr.longest ? fmtDist(pr.longest.distance, { withUnit: false }) : '—'}<small>${distLabel()}</small></div><div class="l">Longest run</div></div>
    <div class="stat"><div class="v">${consistencyWeeks}<small>/ ${N}</small></div><div class="l">Weeks with a run</div></div>
    <div class="stat"><div class="v">${streak}<small>wk</small></div><div class="l">Current streak</div></div>
  </div>

  <div class="grid-2"><div class="col">
    <div class="section-title"><h2>Weekly distance</h2><div style="width:150px"><div class="seg">${[[8, '8w'], [12, '12w'], [26, '26w']].map(([v, l]) => `<button data-action="prog-range" data-range="${v}" class="${prog.range === v ? 'sel' : ''}">${l}</button>`).join('')}</div></div></div>
    <div class="card">${barChart({ labels: wLabels, values: wDone.map((v) => toDisplayDist(v)), planned: wPlan.map((v) => toDisplayDist(v)), tips: weeks.map((ws, i) => `Wk of ${fmtDate(ws, { month: 'short', day: 'numeric' })}: ${fmtDist(wDone[i])} of ${fmtDist(wPlan[i])}`), yFmt: (v) => Math.round(v), highlight: N - 1 })}<div class="legend-row"><span><i class="dot" style="background:var(--accent)"></i>Completed</span><span><i class="dot" style="background:var(--surface-3)"></i>Planned</span></div></div>
    <div class="section-title"><h2>Monthly distance</h2></div>
    <div class="card">${barChart({ labels: months.map((m) => MONTHS[Number(m.slice(5)) - 1].slice(0, 3)), values: mDone.map((v) => toDisplayDist(v)), tips: months.map((m, i) => `${MONTHS[Number(m.slice(5)) - 1]}: ${fmtDist(mDone[i])}`), yFmt: (v) => Math.round(v), highlight: 11 })}</div>
    <div class="section-title"><h2>Pace trend</h2><span class="small muted">weekly average ${paceLabel()}</span></div>
    <div class="card">${lineChart({ labels: wLabels, values: wPace, tips: wPace.map((p, i) => (p ? `${wLabels[i]}: ${fmtPace(p, { withUnit: true })}` : '')), yFmt: (v) => fmtPace(v), invert: true })}</div>
    <div class="section-title"><h2>Long-run progression</h2></div>
    <div class="card">${lineChart({ labels: wLabels, values: wLong.map((v) => (v ? toDisplayDist(v) : null)), tips: wLong.map((v, i) => (v ? `${wLabels[i]}: ${fmtDist(v)}` : '')), yFmt: (v) => v.toFixed(1) })}</div>
  </div>
  <div class="col">
    <div class="section-title"><h2>Personal records</h2><button class="link-btn" data-action="add-race">${icon('plus', 'xs')} Add result</button></div>
    <div class="pr-grid">${['mile', '5k', '10k', 'half', 'marathon'].map(prCard).join('')}
      <div class="stat"><div class="l">Longest run</div><div class="v">${pr.longest ? fmtDist(pr.longest.distance) : '—'}</div><div class="tiny muted">${pr.longest ? esc(fmtDate(pr.longest.date, { month: 'short', day: 'numeric' })) : ''}</div></div>
      <div class="stat"><div class="l">Fastest avg pace</div><div class="v">${pr.fastest ? fmtPace(pr.fastest.avgPace) : '—'}</div><div class="tiny muted">${pr.fastest ? esc(fmtDist(pr.fastest.distance)) + ' · ' + esc(fmtDate(pr.fastest.date, { month: 'short', day: 'numeric' })) : ''}</div></div>
    </div>
    <div class="section-title"><h2>Estimated ${esc(goalName)} time</h2></div>
    <div class="card">${raceVals.length >= 2 ? lineChart({ labels: raceLabels, values: raceVals, tips: raceVals.map((v, i) => `${raceLabels[i]}: ${fmtDuration(v)} (VDOT ${vh[i].vdot.toFixed(1)})`), yFmt: (v) => fmtDuration(v), invert: true }) : raceVals.length === 1 ? `<div class="center" style="padding:10px"><div style="font-size:30px;font-weight:780" class="num">${fmtDuration(raceVals[0])}</div><div class="small muted">Based on VDOT ${vh[0].vdot.toFixed(1)}. Complete time trials to track changes.</div></div>` : '<div class="empty small">Log a time trial or race to estimate race performance.</div>'}</div>
    <div class="section-title"><h2>Workout completion</h2></div>
    <div class="card">${barChart({ labels: wLabels, values: wComp, tips: wComp.map((v, i) => `${wLabels[i]}: ${v}%`), yFmt: (v) => `${Math.round(v)}%` })}</div>
    <div class="section-title"><h2>History</h2><span class="small muted">${activities.length} activities</span></div>
    ${history.length ? `<div class="list">${history.map((a) => `<button class="list-item" data-action="view-activity" data-id="${a.id}">
      <div class="status-ic completed" style="background:var(--surface-2);color:var(--text)">${icon(a.type === 'strength' ? 'strength' : a.type === 'mobility' ? 'mobility' : 'easy', 'sm')}</div>
      <div class="grow"><div class="t">${esc(a.title || 'Run')}</div><div class="s">${esc(fmtDate(a.date))}${a.distance ? ' · ' + fmtDist(a.distance) : ''} · ${fmtDuration(a.duration)}${a.avgPace && a.distance ? ' · ' + fmtPace(a.avgPace, { withUnit: true }) : ''}</div></div>${icon('chevR', 'sm chev')}</button>`).join('')}</div>` : `<div class="card empty">${icon('progress')}<p>No workouts logged yet. Complete your first run and it will appear here.</p></div>`}
  </div></div>`;
}

export function openAddRace() {
  const races = store.state.meta.races || [];
  const s = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Personal records</div><h2>Add a race result</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <label class="field"><span class="lbl">Distance</span><select class="input" data-r="dist">${opts(['mile', '5k', '10k', 'half', 'marathon'].map((k) => ({ value: k, label: BENCHMARK_LABEL[k] })), '5k')}</select></label>
    <div class="input-group"><label class="field grow"><span class="lbl">Time</span><input class="input" data-r="time" placeholder="h:mm:ss"></label><label class="field grow"><span class="lbl">Date</span><input class="input" type="date" data-r="date" max="${todayISO()}" value="${todayISO()}"></label></div>
    <label class="field"><span class="lbl">Race name <span class="muted small">(optional)</span></span><input class="input" data-r="name" placeholder="e.g. City Half"></label>
    <label class="setting" style="padding:6px 2px"><div class="grow"><div class="t">Update training paces from this result</div></div><span class="toggle"><input type="checkbox" data-r="upd" ${store.state.plan ? 'checked' : 'disabled'}><span></span></span></label>
    <button class="btn primary lg block" data-r-save style="margin-top:10px">Save result</button>
    ${races.length ? `<div class="section-title"><h2>Saved results</h2></div><div class="list">${races.map((r, i) => `<div class="list-item"><div class="grow"><div class="t">${esc(BENCHMARK_LABEL[r.dist])} · ${fmtDuration(r.timeSec)}</div><div class="s">${esc(r.name || '')} ${esc(fmtDate(r.date))}</div></div><button class="icon-btn plain" data-r-del="${i}">${icon('trash', 'sm')}</button></div>`).join('')}</div>` : ''}`, {
    onMount: (el) => {
      el.querySelector('[data-r-save]').onclick = async () => {
        const g = (k) => el.querySelector(`[data-r="${k}"]`);
        const t = parseClock(g('time').value);
        if (!t) { toast('Enter a time like 23:45'); return; }
        const r = { dist: g('dist').value, timeSec: t, date: g('date').value, name: g('name').value };
        await store.saveRaces([...(store.state.meta.races || []), r]);
        if (g('upd').checked && store.state.plan) {
          const { vdotFromRace } = await import('../engine/vdot.js');
          const { BENCHMARK_DIST } = await import('../engine/assessment.js');
          await store.setVdot(Math.round(vdotFromRace(BENCHMARK_DIST[r.dist], t) * 10) / 10, 'race');
        }
        s.close(); toast('Result saved');
      };
      el.querySelectorAll('[data-r-del]').forEach((b) => b.onclick = async () => {
        const list = (store.state.meta.races || []).slice(); list.splice(Number(b.dataset.rDel), 1);
        await store.saveRaces(list); s.close(); toast('Removed');
      });
    },
  });
}
