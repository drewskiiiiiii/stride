// Today dashboard.

import { esc, icon } from './dom.js';
import { store } from '../core/store.js';
import { sessionStore, prefs } from '../core/storage.js';
import { todayISO, startOfWeek, addDays, fmtDate, fmtLongDate, DAY_SHORT, diffDays } from '../core/dates.js';
import { fmtDist, fmtMinutes, fmtDuration, fmtPace, distLabel, toDisplayDist } from '../core/units.js';
import { effectiveStatus } from '../engine/adjustments.js';
import { isRun } from '../engine/workout-utils.js';
import { workoutLine, typeColor, typeLabel, typeIcon, mainTarget, structureBar, relDay } from './format.js';
import { buildInsights, weekStats, raceCountdown } from './insights.js';
import { pendingMissed, checkinNeeded, currentTrends, currentAssessmentDue } from './coach.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function renderToday() {
  const { plan, workouts, activities, profile } = store.state;
  const today = todayISO();
  const active = sessionStore.load();
  const head = `<div class="page-head"><div><div class="sub">${esc(fmtLongDate(today))}</div><h1>${greeting()}</h1></div>
    <div class="row" style="gap:8px"><button class="icon-btn" data-action="checkin" aria-label="Daily check-in">${icon('heart')}</button><button class="icon-btn" data-action="log-run" aria-label="Log a run">${icon('plus')}</button></div></div>`;
  const resume = active && active.status !== 'finished' ? `<div class="notice accent fade-in" style="margin-bottom:12px;align-items:center">${icon('timer', 'sm')}<div class="grow"><b>Workout in progress</b><div class="small">${esc(active.title)}</div></div><button class="btn primary sm" data-action="resume-live">Resume</button></div>` : '';

  if (!plan) {
    return `${head}${resume}<div class="hero fade-in"><div class="eyebrow">${icon('flag', 'sm')} No active plan</div><h2>Ready for your next goal?</h2><p>Your history is saved. Create a new plan whenever you are ready.</p><a class="btn primary" href="#/new-plan">${icon('plus', 'sm')} Create a plan</a></div>`;
  }

  const todays = workouts.filter((w) => w.date === today && w.status !== 'replaced');
  const runToday = todays.find((w) => isRun(w));
  const supp = todays.filter((w) => w.type === 'strength' || w.type === 'mobility');
  const week = plan.weeks.find((w) => w.start <= today && w.end >= today);
  const ws = startOfWeek(today);
  const stats = weekStats(workouts, activities, ws, today);
  const countdown = raceCountdown(plan, today);
  const insights = buildInsights({ plan, workouts, activities, today, checkins: store.state.meta.checkins || {} });
  const upcoming = workouts.filter((w) => w.date > today && w.date <= addDays(today, 6) && w.type !== 'rest' && w.status === 'planned').slice(0, 5);
  const nextLong = workouts.find((w) => w.date >= today && w.type === 'long' && w.status === 'planned');
  const keyUpcoming = workouts.filter((w) => w.date > today && w.key && w.type !== 'long' && w.status === 'planned').slice(0, 3);
  const beforeStart = today < plan.startDate;

  let hero;
  if (beforeStart) {
    const first = workouts.find((w) => w.type !== 'rest');
    hero = `<div class="hero fade-in"><div class="eyebrow">${icon('calendar', 'sm')} Plan starts ${fmtDate(plan.startDate)}</div><h2>${esc(plan.name || plan.goal.label)}</h2><p>Your first session: <b>${esc(first?.title || '')}</b> on ${esc(fmtDate(first?.date || plan.startDate, { weekday: 'long' }))}.</p>${first ? `<button class="btn" data-action="open-workout" data-id="${first.id}">View workout</button>` : ''}</div>`;
  } else if (runToday) {
    const st = effectiveStatus(runToday, today);
    const act = runToday.activityId ? activities.find((a) => a.id === runToday.activityId) : null;
    if (st === 'completed') {
      hero = `<div class="hero fade-in" data-z="${typeColor(runToday.type)}"><div class="eyebrow"><span class="status-ic completed" style="width:20px;height:20px">${icon('check', 'xs')}</span> Completed today</div>
        <h2>${esc(runToday.title)}</h2>
        ${act ? `<div class="metrics"><div class="metric"><div class="v">${fmtDist(act.distance)}</div><div class="l">Distance</div></div><div class="metric"><div class="v">${fmtDuration(act.duration)}</div><div class="l">Time</div></div><div class="metric"><div class="v">${act.avgPace ? fmtPace(act.avgPace) : '—'}</div><div class="l">Avg pace</div></div></div>` : ''}
        <p>Nice work. ${upcoming[0] ? `Next up: <b>${esc(upcoming[0].title)}</b> ${esc(relDay(upcoming[0].date, today) || fmtDate(upcoming[0].date, { weekday: 'long' }))}.` : 'Recover well.'}</p>
        <button class="btn" data-action="open-workout" data-id="${runToday.id}">View details</button></div>`;
    } else {
      hero = `<div class="hero fade-in" data-z="${typeColor(runToday.type)}">
        <div class="eyebrow"><span class="dot"></span> Today · ${esc(typeLabel(runToday.type))}${week ? ` · Week ${week.index}` : ''}${st === 'skipped' ? ' · <span style="color:var(--danger)">Skipped</span>' : ''}</div>
        <h2>${esc(runToday.title)}</h2>
        <p>${esc(runToday.purpose || '')}</p>
        ${structureBar(runToday, plan)}
        <div class="metrics">
          ${runToday.estDuration ? `<div class="metric"><div class="v">${fmtMinutes(runToday.estDuration)}</div><div class="l">Duration</div></div>` : ''}
          ${runToday.estDistance ? `<div class="metric"><div class="v">${fmtDist(runToday.estDistance)}</div><div class="l">Distance</div></div>` : ''}
          <div class="metric"><div class="v" style="font-size:16px;padding-top:4px">${esc(mainTarget(runToday, plan, profile) || '—')}</div><div class="l">Target</div></div>
        </div>
        <div class="btn-row"><button class="btn primary lg" data-action="start-workout" data-id="${runToday.id}">${icon('play', 'sm')} Start workout</button><button class="btn lg" data-action="open-workout" data-id="${runToday.id}" aria-label="Details">${icon('info', 'sm')}</button></div>
      </div>`;
    }
  } else {
    const nextRun = workouts.find((w) => w.date > today && isRun(w) && w.status === 'planned');
    const rest = todays.find((w) => w.type === 'rest');
    hero = `<div class="hero fade-in" data-z="rest"><div class="eyebrow">${icon('rest', 'sm')} Rest day</div>
      <h2>Recover and recharge</h2>
      <p>${esc(rest?.purpose || 'Adaptation happens during recovery. Rest lets your muscles, tendons and energy systems absorb the training so you come back stronger.')}</p>
      ${nextRun ? `<div class="card flat click" data-action="open-workout" data-id="${nextRun.id}" style="margin-top:6px"><div class="row"><span class="zbar" data-z="${typeColor(nextRun.type)}"></span><div class="grow"><div class="small muted">Next · ${esc(relDay(nextRun.date, today) || fmtDate(nextRun.date, { weekday: 'long' }))}</div><div style="font-weight:680">${esc(nextRun.title)}</div><div class="small muted">${esc(workoutLine(nextRun, plan))}</div></div>${icon('chevR', 'sm')}</div></div>` : ''}
    </div>`;
  }

  const suppCards = supp.map((w) => `<div class="card click tight fade-in" data-action="open-workout" data-id="${w.id}" style="margin-top:10px"><div class="row"><span class="status-ic ${w.status === 'completed' ? 'completed' : ''}" style="background:${w.status === 'completed' ? '' : 'var(--surface-2)'}">${icon(w.status === 'completed' ? 'check' : typeIcon(w.type), 'sm')}</span><div class="grow"><div style="font-weight:650">${esc(w.title)}</div><div class="small muted">${fmtMinutes(w.estDuration)} · ${esc(typeLabel(w.type))}</div></div>${w.status !== 'completed' ? `<button class="btn sm" data-action="start-workout" data-id="${w.id}">${icon('play', 'xs')} Start</button>` : ''}</div></div>`).join('');

  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(ws, i);
    const ws2 = workouts.filter((w) => w.date === d && isRun(w) && w.status !== 'replaced' && w.status !== 'skipped');
    const st = ws2.length ? effectiveStatus(ws2[0], today) : null;
    return `<div class="wd" data-action="${ws2[0] ? 'open-workout' : ''}" data-id="${ws2[0]?.id || ''}"><div class="l">${DAY_SHORT[(i + 1) % 7][0]}</div><div class="c ${ws2.length ? 'run' : ''} ${st === 'completed' ? 'completed' : st === 'missed' ? 'missed' : ''} ${d === today ? 'today' : ''}" data-z="${ws2[0] ? typeColor(ws2[0].type) : ''}">${st === 'completed' ? icon('check', 'xs') : st === 'missed' ? icon('x', 'xs') : ''}</div></div>`;
  }).join('');

  const weekCard = `<div class="card fade-in">
    <div class="card-head"><h3>This week</h3>${week ? `<span class="chip">${esc(week.phaseLabel)}${week.recovery ? ' · Recovery' : ''}</span>` : ''}</div>
    <div class="row" style="gap:18px">
      <div class="ring" style="--p:${stats.pct}"><span>${stats.pct}%</span></div>
      <div class="grow">
        <dl class="kv">
          <dt>Runs completed</dt><dd>${stats.completed.length} / ${stats.runs.length}</dd>
          <dt>Remaining</dt><dd>${stats.remaining.length}</dd>
          <dt>Distance</dt><dd>${fmtDist(stats.doneDist, { withUnit: false })} / ${fmtDist(stats.targetDist)}</dd>
        </dl>
      </div>
    </div>
    <div class="bar" style="margin-top:14px"><i style="width:${Math.min(100, stats.targetDist ? (stats.doneDist / stats.targetDist) * 100 : 0)}%"></i></div>
    <div class="week-dots">${days}</div>
  </div>`;

  const weeksLeft = Math.max(0, plan.totalWeeks - (week?.index || 0));
  const progressCard = `<div class="card fade-in">
    <div class="card-head"><h3>Training progress</h3><a class="link-btn" href="#/plan">View plan</a></div>
    <div class="row between"><div><div style="font-size:26px;font-weight:760" class="num">Week ${week?.index || (today < plan.startDate ? 0 : plan.totalWeeks)}<span class="muted" style="font-size:16px"> / ${plan.totalWeeks}</span></div><div class="small muted">${weeksLeft} week${weeksLeft === 1 ? '' : 's'} remaining</div></div>
    ${countdown != null ? `<div class="center"><div style="font-size:26px;font-weight:780;color:var(--accent-text)" class="num">${countdown}</div><div class="tiny muted upper">days to ${plan.goal.distanceM ? 'race' : 'goal'}</div></div>` : ''}</div>
    <div class="bar" style="margin:12px 0 14px"><i style="width:${Math.round(((week?.index || 0) / plan.totalWeeks) * 100)}%"></i></div>
    ${nextLong ? `<button class="list-item" style="padding:10px 0" data-action="open-workout" data-id="${nextLong.id}">${icon('long', 'sm')}<div class="grow"><div class="t">Next long run</div><div class="s">${esc(fmtDate(nextLong.date))} · ${esc(workoutLine(nextLong, plan))}</div></div>${icon('chevR', 'sm chev')}</button>` : ''}
    ${keyUpcoming.map((w) => `<button class="list-item" style="padding:10px 0" data-action="open-workout" data-id="${w.id}">${icon(typeIcon(w.type), 'sm')}<div class="grow"><div class="t">${esc(w.title)}</div><div class="s">${esc(fmtDate(w.date))} · Key workout</div></div>${icon('chevR', 'sm chev')}</button>`).join('')}
  </div>`;

  const insightCards = insights.length ? `<div class="section-title"><h2>Coach insights</h2></div>${insights.map((x) => `<div class="notice ${x.kind === 'info' ? '' : x.kind} fade-in">${icon(x.icon, 'sm')}<div class="grow"><b>${esc(x.title)}</b><div>${esc(x.body)}</div>${x.action ? `<button class="btn sm" style="margin-top:10px" data-action="insight" data-insight="${x.action.id}" data-value="${x.action.value ?? ''}">${esc(x.action.label)}</button>` : ''}</div></div>`).join('')}` : '';

  const upcomingList = upcoming.length ? `<div class="section-title"><h2>Coming up</h2><a class="link-btn" href="#/calendar">Calendar</a></div>${upcoming.map((w) => `
    <button class="workout-row fade-in" data-z="${typeColor(w.type)}" data-action="open-workout" data-id="${w.id}"><span class="zbar"></span>
      <div class="date"><div class="d">${fmtDate(w.date, { day: 'numeric' })}</div><div class="w">${fmtDate(w.date, { weekday: 'short' })}</div></div>
      <div class="body"><div class="t">${esc(w.title)}${w.movedFrom ? ' <span class="chip" style="padding:2px 7px;font-size:10.5px">↪ rescheduled</span>' : ''}</div><div class="s">${esc(workoutLine(w, plan))}</div></div>${icon('chevR', 'sm chev')}</button>`).join('')}` : '';

  // ---- adaptive coach cards ----
  const coachCards = [];
  for (const m of pendingMissed().slice(0, 2)) {
    coachCards.push(`<div class="notice warn fade-in" style="align-items:center">${icon('calendar', 'sm')}<div class="grow"><b>Missed: ${esc(m.title)}</b><div class="small">${esc(fmtDate(m.date, { weekday: 'long' }))} · Let the coach adjust your week</div></div><button class="btn sm" data-action="missed" data-id="${m.id}">Review</button></div>`);
  }
  const ci = store.state.meta.checkins?.[today];
  if (checkinNeeded()) coachCards.push(`<div class="notice accent fade-in" style="align-items:center">${icon('heart', 'sm')}<div class="grow"><b>Quick recovery check-in</b><div class="small">30 seconds before today’s key session — legs, energy, sleep, pain.</div></div><button class="btn sm primary" data-action="checkin">Check in</button></div>`);
  else if (ci) coachCards.push(`<div class="notice ${ci.rec === 'go' ? 'ok' : 'warn'} fade-in" style="align-items:center">${icon('heart', 'sm')}<div class="grow"><b>Checked in today</b><div class="small">${esc({ go: 'Recovered — proceed as planned.', reduce: 'Recommendation: reduce today’s workload.', easy: 'Recommendation: keep today easy.', rest: 'Recommendation: rest today.' }[ci.rec] || '')}</div></div><button class="btn sm" data-action="checkin">Update</button></div>`);
  let trends = null;
  try { trends = currentTrends(); } catch (e) { console.warn(e); }
  if (trends?.suggestion) coachCards.push(`<div class="notice accent fade-in">${icon('bolt', 'sm')}<div class="grow"><b>${trends.suggestion.type === 'vdot' ? 'Your fitness has changed' : 'Pace targets ready for an update'}</b><div class="small">${esc(trends.suggestion.explanation.split('. ')[0])}.</div><button class="btn sm primary" style="margin-top:10px" data-action="pace-suggestion">See old vs new paces</button></div></div>`);
  const due = currentAssessmentDue();
  if (due) coachCards.push(`<div class="notice fade-in">${icon('trophy', 'sm')}<div class="grow"><b>Time for a fitness check</b><div class="small">${esc(due.reason)}</div><button class="btn sm" style="margin-top:10px" data-action="assessment">Schedule assessment</button></div></div>`);
  const lb = prefs.get().lastBackupAt;
  if (activities.length >= 3 && (!lb || Date.now() - new Date(lb) > 21 * 86400000)) coachCards.push(`<div class="notice fade-in" style="align-items:center">${icon('download', 'sm')}<div class="grow"><b>Back up your training data</b><div class="small">${lb ? 'Your last backup was over 3 weeks ago.' : 'You haven’t exported a backup yet.'} It stays on this device only.</div></div><button class="btn sm" data-action="export-data">Back up</button></div>`);
  const coach = coachCards.length ? `<div class="section-title"><h2>Your coach</h2></div>${coachCards.join('')}` : '';

  return `${head}${resume}
    <div class="grid-2"><div class="col">${hero}${suppCards}${coach}${insightCards}${upcomingList}</div>
    <div class="col"><div class="section-title"><h2>Overview</h2></div>${weekCard}${progressCard}</div></div>`;
}
