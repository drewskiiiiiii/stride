// Intelligent scheduling: missed-workout analysis with ranked options, and
// human-readable change summaries. Pure functions; options are declarative
// change-sets ({ updates: [workout], adjustments: [adj] }) that the store applies.

import { addDays, diffDays, startOfWeek, weekday, fmtDate } from '../core/dates.js';
import { isHard, isRun, flattenSteps, estimateWorkout } from './workout-utils.js';
import { NEEDED_LONG } from './assessment.js';
import { reduceWorkout } from './performance.js';
import { fmtDist } from '../core/units.js';

const demanding = (w) => w && w.status !== 'skipped' && w.status !== 'replaced' && (isHard(w) || w.type === 'long');
const live = (w) => w.status !== 'skipped' && w.status !== 'replaced';
const km = (m) => fmtDist(m, { decimals: 1 });

export function importance(w) {
  if (w.type === 'race') return { level: 4, label: 'Race' };
  if (w.type === 'long') return { level: 3, label: 'Key session — long run' };
  if (isHard(w)) return { level: 3, label: 'Key session — quality workout' };
  if (['easy', 'recovery', 'runwalk', 'custom'].includes(w.type)) return { level: 1, label: 'Supporting run' };
  if (['strength', 'mobility'].includes(w.type)) return { level: 0, label: 'Supplemental session' };
  return { level: 1, label: 'Workout' };
}

/** Days this week where a missed workout could safely go. */
export function safeDays(workouts, w, plan, today) {
  const ws = startOfWeek(w.date);
  const we = addDays(ws, 6);
  const avail = new Set(plan?.inputs?.availability?.days || [0, 1, 2, 3, 4, 5, 6]);
  const out = [];
  for (let d = today > w.date ? today : addDays(w.date, 1); d <= we; d = addDays(d, 1)) {
    if (!avail.has(weekday(d))) continue;
    const day = workouts.filter((x) => x.date === d && x.id !== w.id && live(x));
    const runs = day.filter(isRun);
    if (runs.some((x) => demanding(x) || x.status === 'completed')) continue;
    const prevHard = workouts.some((x) => x.date === addDays(d, -1) && x.id !== w.id && demanding(x));
    const nextHard = workouts.some((x) => x.date === addDays(d, 1) && x.id !== w.id && demanding(x));
    if (demanding(w) && (prevHard || nextHard)) continue;
    if (plan?.raceDate && demanding(w) && diffDays(d, plan.raceDate) >= 0 && diffDays(d, plan.raceDate) <= 3) continue;
    out.push({ date: d, replaces: runs[0] || null, free: !runs.length });
  }
  return out;
}

/**
 * Analyse a missed workout and propose ranked options.
 * Never crams: at most one relocation, only onto a safe day within the same week.
 */
export function analyzeMissed(workouts, w, { plan, today }) {
  const imp = importance(w);
  const ws = startOfWeek(w.date), we = addDays(ws, 6);
  const weekRuns = workouts.filter((x) => isRun(x) && x.date >= ws && x.date <= we && x.status !== 'replaced');
  const target = weekRuns.reduce((a, x) => a + (x.estDistance || 0), 0);
  const done = weekRuns.filter((x) => x.status === 'completed').reduce((a, x) => a + (x.estDistance || 0), 0);
  const remaining = weekRuns.filter((x) => x.date >= today && x.status === 'planned' && x.id !== w.id);
  const nextHard = workouts.filter((x) => x.date >= today && x.id !== w.id && demanding(x) && x.status === 'planned').sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const week = plan?.weeks.find((x) => x.start <= w.date && x.end >= w.date);
  const phase = week?.phaseLabel || '—';
  const taper = week?.phase === 'taper';
  const recentMissed = workouts.filter((x) => isRun(x) && (x.status === 'missed' || (x.status === 'planned' && x.date < today)) && x.date >= addDays(today, -10) && x.date < today);
  const recentKeyMissed = recentMissed.filter((x) => demanding(x));
  const days = safeDays(workouts, w, plan, today);
  const analysis = [
    `Importance: ${imp.label}.`,
    `This week: ${km(done)} completed of ${km(target)} planned · ${remaining.length} run${remaining.length === 1 ? '' : 's'} remaining.`,
    nextHard ? `Next demanding session: ${nextHard.title} ${nextHard.date === today ? 'today' : `in ${diffDays(today, nextHard.date)} day(s)`} (${fmtDate(nextHard.date, { weekday: 'short' })}).` : 'No demanding sessions left this week.',
    `Phase: ${phase}${week?.recovery ? ' (recovery week)' : ''}.`,
    days.length ? `Safe days available this week: ${days.map((d) => fmtDate(d.date, { weekday: 'short' })).join(', ')}.` : 'No safe day left this week without stacking hard sessions.',
  ];
  if (recentMissed.length > 1) analysis.push(`${recentMissed.length} runs missed in the last 10 days.`);

  const options = [];
  const skip = (why) => ({ id: 'skip', label: 'Skip it — leave the plan unchanged', desc: why, updates: [{ ...w, status: 'skipped', skipReason: 'missed', missedHandled: true }], adjustments: [] });
  const moveTo = (d, label, why, workout = w) => {
    const ups = [{ ...workout, id: w.id, date: d.date, movedFrom: w.date, status: 'planned', missedHandled: true }];
    if (d.replaces) ups.push({ ...d.replaces, status: 'replaced', replacedBy: w.id });
    return { id: 'move', label, desc: why, updates: ups, adjustments: [], movedTo: d.date };
  };
  // prefer the earliest safe day that is a free day, then one replacing an easy run
  const bestDay = days.find((d) => d.free) || days[0];

  if (imp.level === 0) {
    options.push({ ...skip('Strength and mobility sessions support your running, but missing one has a negligible effect. Simply pick up with the next one.'), primary: true });
    if (bestDay) options.push(moveTo(bestDay, `Move it to ${fmtDate(bestDay.date, { weekday: 'long' })}`, 'Fits without crowding a hard running day.'));
  } else if (w.type === 'race') {
    options.push({ ...skip('Races can’t be rescheduled by the app. If the event moved, change the race date in Plan settings.'), primary: true });
  } else if (recentKeyMissed.length >= 2 || (recentMissed.length >= 3)) {
    const hold = { id: 'reduce', label: 'Reduce upcoming mileage', desc: 'You have missed several sessions recently. Next week repeats the current load instead of increasing it, so you rebuild without a sudden jump.', updates: [{ ...w, status: 'skipped', skipReason: 'missed', missedHandled: true }], adjustments: [{ type: 'hold', start: addDays(startOfWeek(today), 7), note: 'Several missed sessions' }], primary: true };
    options.push(hold);
    options.push(skip('Continue exactly as planned. Fine if the missed runs were due to a one-off busy spell and you feel fresh.'));
  } else if (imp.level === 1) {
    options.push({ ...skip(`An easy run is the least important session of the week. Making it up would add fatigue before ${nextHard ? nextHard.title : 'your next key session'} for little benefit.`), primary: true });
    if (bestDay && bestDay.free && !taper) options.push(moveTo(bestDay, `Move it to ${fmtDate(bestDay.date, { weekday: 'long' })}`, 'There is a free, non-adjacent day this week — only worth it if you feel fresh.'));
  } else if (w.type === 'long') {
    const nextLong = workouts.find((x) => x.type === 'long' && x.date > we && x.status === 'planned');
    const weekendDay = days.find((d) => [0, 6].includes(weekday(d.date)) && (d.free || d.replaces)) || bestDay;
    if (weekendDay && !taper) options.push({ ...moveTo(weekendDay, `Move the long run to ${fmtDate(weekendDay.date, { weekday: 'long' })}`, `There is still room this week with at least 48 hours around it${weekendDay.replaces ? ` (replacing ${weekendDay.replaces.title})` : ''}.`), primary: true });
    if (nextLong && nextLong.estDistance > (w.estDistance || 0) * 1.03) {
      const factor = (w.estDistance || nextLong.estDistance) / nextLong.estDistance;
      const capped = scaleWorkout(nextLong, factor, plan);
      options.push({ id: 'adjust-long', label: 'Skip it and adjust next week’s long run', desc: `Next week’s long run is reduced from ${km(nextLong.estDistance)} to about ${km(capped.estDistance)} — repeating this week’s distance instead of jumping ahead.`, updates: [{ ...w, status: 'skipped', skipReason: 'missed', missedHandled: true }, { ...capped, adjustedReason: 'Previous long run missed' }], adjustments: [], primary: !options.length });
    }
    options.push({ ...skip(taper ? 'In a taper, missing one long run costs almost nothing. Rest is not the enemy right now.' : 'Long-run fitness builds over weeks — one missed long run will not set you back. Do not double up next week.'), primary: !options.length });
  } else {
    // quality session
    if (taper) {
      options.push({ ...skip('Fitness is already banked during a taper. Skipping is the safest choice — do not add intensity close to race day.'), primary: true });
    } else {
      if (bestDay) {
        options.push({ ...moveTo(bestDay, `Move it to ${fmtDate(bestDay.date, { weekday: 'long' })}`, `${bestDay.replaces ? `Replaces ${bestDay.replaces.title}; keeps` : 'Keeps'} 48 hours either side of hard sessions and the long run.`), primary: true });
        const easier = reduceWorkout(w, 0.6);
        const est = estimateWorkout(easier.steps, plan?.paces, plan?.assumedEasy || 420);
        options.push(moveTo(bestDay, `Do a shorter version on ${fmtDate(bestDay.date, { weekday: 'long' })}`, 'About 60 % of the work at the same paces — keeps the stimulus with less fatigue.', { ...easier, estDistance: est.distance, estDuration: est.duration }));
      }
      options.push({ ...skip(bestDay ? 'Also fine: the next quality session covers similar ground.' : 'There is no safe day left this week. The next quality session is unchanged — do not stack hard days to catch up.'), primary: !bestDay });
    }
  }
  return { workout: w, importance: imp, analysis, options };
}

/** Scale a run's main steps by factor (used to cap long runs). */
export function scaleWorkout(w, factor, plan) {
  const steps = (w.steps || []).map((s) => (s.repeat ? s : ['steady', 'work'].includes(s.kind) ? { ...s, value: s.measure === 'distance' ? Math.round((s.value * factor) / 500) * 500 : Math.round((s.value * factor) / 300) * 300 } : s));
  const est = estimateWorkout(steps, plan?.paces, plan?.assumedEasy || 420);
  return { ...w, steps, estDistance: est.distance, estDuration: est.duration };
}

/**
 * Summarise what changed between two workout lists (and plans).
 * reason: short "why" text. Returns structured summary for the UI and change log.
 */
export function summarizeChanges(before, after, { beforePlan, afterPlan, today, reason, title, dropNote = false }) {
  const bMap = new Map(before.map((w) => [w.id, w]));
  const aMap = new Map(after.map((w) => [w.id, w]));
  const moved = [], removed = [], added = [], modified = [];
  for (const [id, a] of aMap) {
    const b = bMap.get(id);
    if (a.type === 'rest') continue;
    if (!b) { if (a.date >= today && a.status === 'planned') added.push(a); continue; }
    if (b.date !== a.date && a.status === 'planned') moved.push({ w: a, from: b.date, to: a.date });
    else if (live(b) && !live(a)) removed.push(a);
    else if (live(a) && a.date >= today && (Math.abs((a.estDistance || 0) - (b.estDistance || 0)) > Math.max(400, (b.estDistance || 0) * 0.05) || a.title !== b.title)) modified.push({ w: a, before: b });
  }
  for (const [id, b] of bMap) if (!aMap.has(id) && b.type !== 'rest' && b.date >= today && live(b)) removed.push(b);
  // weekly mileage for weeks touched
  const weeksTouched = new Set([...moved.flatMap((m) => [startOfWeek(m.from), startOfWeek(m.to)]), ...removed.map((w) => startOfWeek(w.date)), ...added.map((w) => startOfWeek(w.date)), ...modified.map((m) => startOfWeek(m.w.date))]);
  const vol = (list, s) => list.filter((w) => isRun(w) && live(w) && w.date >= s && w.date <= addDays(s, 6)).reduce((a, w) => a + (w.estDistance || 0), 0);
  const mileage = [...weeksTouched].sort().slice(0, 6).map((s) => ({ week: s, before: vol(before, s), after: vol(after, s) })).filter((m) => Math.abs(m.before - m.after) > 200);
  // race realism
  let race = null;
  if (afterPlan?.raceDate) {
    const fam = afterPlan.goal?.family;
    const need = NEEDED_LONG[fam] || 0;
    const peakLong = Math.max(0, ...after.filter((w) => w.type === 'long' && live(w)).map((w) => w.estDistance || 0));
    const serious = (afterPlan.warnings || []).filter((x) => x.level === 'aggressive' && !/pain/i.test(x.msg));
    const ok = peakLong >= need * 0.88 && !serious.length;
    race = { ok, text: ok ? `Your race on ${fmtDate(afterPlan.raceDate, { month: 'short', day: 'numeric' })} remains realistic — peak long run ${km(peakLong)}.` : `Race on ${fmtDate(afterPlan.raceDate, { month: 'short', day: 'numeric' })} is at risk: ${serious[0]?.msg || `the longest planned run is now ${km(peakLong)}, below the ~${km(need)} usually needed.`} Consider a later race or a completion goal.` };
  }
  const total = moved.length + removed.length + added.length + modified.length;
  const removedRuns = removed.filter(isRun).length, addedRuns = added.filter(isRun).length + moved.length;
  const note = dropNote && removedRuns > addedRuns ? 'Where no safe alternative day was available, sessions were dropped rather than crammed into the remaining days.' : null;
  return { title, reason, note, moved, removed, added, modified, mileage, race, total, at: new Date().toISOString() };
}

export function summaryToText(s) {
  const lines = [];
  s.moved.forEach((m) => lines.push(`Moved ${m.w.title}: ${fmtDate(m.from, { weekday: 'short', day: 'numeric' })} → ${fmtDate(m.to, { weekday: 'short', day: 'numeric' })}`));
  s.removed.slice(0, 8).forEach((w) => lines.push(`Removed ${w.title} (${fmtDate(w.date, { weekday: 'short', day: 'numeric' })})`));
  s.added.slice(0, 8).forEach((w) => lines.push(`Added ${w.title} (${fmtDate(w.date, { weekday: 'short', day: 'numeric' })})`));
  s.modified.slice(0, 8).forEach((m) => lines.push(`Changed ${m.w.title} (${fmtDate(m.w.date, { weekday: 'short', day: 'numeric' })})`));
  return lines;
}
