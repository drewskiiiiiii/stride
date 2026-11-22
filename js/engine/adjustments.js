// Plan adjustment logic: moves, merges after regeneration, missed-workout handling and
// performance-based pace suggestions. Pure functions over plain data.

import { addDays, diffDays, startOfWeek } from '../core/dates.js';
import { isHard, isRun } from './workout-utils.js';
import { vdotFromRace } from './vdot.js';
import { vdotFromThreshold } from './performance.js';

/** Status shown to the user. Past planned runs become "missed" automatically (never rescheduled). */
export function effectiveStatus(w, today) {
  if (w.status !== 'planned') return w.status;
  if (w.type === 'rest') return w.date < today ? 'done' : 'planned';
  if (w.date < today) return 'missed';
  return 'planned';
}

/**
 * Check the consequences of moving workout w to newDate.
 * opts.plan enables weekly-mileage, long-run and taper checks.
 * Returns { warnings: string[], serious: bool, sameDay, canSwap }
 */
export function validateMove(workouts, w, newDate, today, opts = {}) {
  const plan = opts.plan || null;
  const warnings = [];
  let serious = false;
  const live = (x) => x.id !== w.id && x.status !== 'skipped' && x.status !== 'replaced';
  const demanding = (x) => isHard(x) || x.type === 'long';
  if (newDate < today) { warnings.push('That date is in the past.'); serious = true; }
  const sameDay = workouts.filter((x) => x.date === newDate && live(x) && x.type !== 'rest');
  const prev = workouts.filter((x) => x.date === addDays(newDate, -1) && live(x));
  const next = workouts.filter((x) => x.date === addDays(newDate, 1) && live(x));
  const wHard = demanding(w);
  if (wHard) {
    const p = prev.find(demanding), n = next.find(demanding);
    if (p) { warnings.push(`Back-to-back hard days: ${p.title} is the day before. Hard sessions need ~48 h between them.`); serious = true; }
    if (n) { warnings.push(`Insufficient recovery: ${n.title} is the day after. Consider swapping instead.`); serious = true; }
  } else if (isRun(w)) {
    const n = next.find(demanding);
    if (n && n.type === 'long' && sameDay.length === 0 && workouts.filter((x) => x.date === newDate && live(x) && isRun(x)).length === 0 && prev.some(demanding)) warnings.push('This squeezes a run between two demanding days — keep it very easy.');
  }
  const sameRun = sameDay.find((x) => isRun(x));
  if (sameRun && isRun(w)) warnings.push(`${sameRun.title} is already scheduled that day. Two runs in one day is not recommended — swap them instead.`);
  const sameLong = sameDay.find((x) => x.type === 'long');
  if (sameLong && w.type !== 'long' && isRun(w)) serious = true;
  if (w.type === 'long') {
    const otherLong = workouts.find((x) => live(x) && x.type === 'long' && Math.abs(diffDays(x.date, newDate)) <= 3);
    if (otherLong) { warnings.push(`Long-run conflict: another long run is ${Math.abs(diffDays(otherLong.date, newDate))} day(s) away (${otherLong.title}).`); serious = true; }
  }
  if (Math.abs(diffDays(w.date, newDate)) > 6) warnings.push('Moving a workout more than a week changes your training progression. Use Plan Adjustment for longer changes.');
  if (plan) {
    // taper & race-day conflicts
    if (plan.raceDate) {
      if (newDate > plan.raceDate && isRun(w) && w.type !== 'recovery') { warnings.push('That is after your race — this workout would no longer help race preparation.'); }
      const toRace = diffDays(newDate, plan.raceDate);
      if (wHard && w.type !== 'race' && toRace >= 0 && toRace <= 3) { warnings.push(`Taper conflict: a demanding session ${toRace} day(s) before your race will leave you tired on race day.`); serious = true; }
      if (w.type === 'race') { warnings.push('This is your race day workout — change the race date in Plan settings instead.'); serious = true; }
    }
    const wk = (d) => plan.weeks.find((x) => x.start <= d && x.end >= d);
    const from = wk(w.date), to = wk(newDate);
    if (to && to.phase === 'taper' && wHard && from && from.phase !== 'taper') { warnings.push('Taper conflict: moving a hard session into your taper adds fatigue when volume should be dropping.'); serious = true; }
    // weekly mileage
    if (to && from && to.index !== from.index && isRun(w)) {
      const planned = to.targetDist || 0;
      const current = workouts.filter((x) => live(x) && isRun(x) && x.date >= to.start && x.date <= to.end).reduce((a, x) => a + (x.estDistance || 0), 0);
      const after = current + (w.estDistance || 0);
      if (planned && after > planned * 1.1) warnings.push(`Weekly mileage: week ${to.index} would rise to ${(after / 1000).toFixed(1)} km vs ${(planned / 1000).toFixed(1)} km planned (+${Math.round((after / planned - 1) * 100)}%).`);
    }
  }
  const canSwap = sameDay.some((x) => isRun(x) || x.type === 'strength' || x.type === 'mobility') && isRun(w) && w.type !== 'race';
  return { warnings, serious, sameDay, canSwap };
}

/** Returns the list of updated workout records. */
export function moveWorkout(workouts, w, newDate, { swap = false } = {}) {
  const changed = [];
  const oldDate = w.date;
  const moved = { ...w, date: newDate, movedFrom: w.movedFrom || oldDate, status: w.status === 'missed' ? 'planned' : w.status };
  changed.push(moved);
  const targetRest = workouts.filter((x) => x.date === newDate && x.type === 'rest');
  targetRest.forEach((r) => changed.push({ ...r, status: 'replaced' }));
  if (swap) {
    workouts.filter((x) => x.date === newDate && x.id !== w.id && isRun(x)).forEach((x) => changed.push({ ...x, date: oldDate, movedFrom: x.movedFrom || newDate }));
  }
  // leave a rest marker on the vacated day if nothing else remains there
  const remaining = workouts.filter((x) => x.date === oldDate && x.id !== w.id && x.type !== 'rest' && x.status !== 'replaced');
  if (!remaining.length && !swap) {
    const restOld = workouts.find((x) => x.date === oldDate && x.type === 'rest');
    if (restOld) changed.push({ ...restOld, status: 'planned' });
    else changed.push({ id: `${w.planId}-${oldDate}-rest`, planId: w.planId, date: oldDate, week: w.week, phase: w.phase, slot: 'rest', type: 'rest', title: 'Rest Day', purpose: 'Workout moved — this is now a rest day.', steps: [], tips: [], status: 'planned', source: 'plan', estDistance: 0, estDuration: 0 });
  }
  return changed;
}

/**
 * Merge a regenerated plan into existing workouts: everything before fromDate, every
 * completed/missed/skipped workout and every user-created workout is preserved.
 */
export function mergeRegenerated(oldWorkouts, newWorkouts, fromDate) {
  // keep: history, anything not plain-planned (completed/missed/skipped/replaced), user workouts,
  // and workouts the user or coach deliberately changed (moved or adjusted)
  const keep = oldWorkouts.filter((w) => w.date < fromDate || w.status !== 'planned' || w.source === 'user' || w.movedFrom || w.adjustedReason);
  const keepIds = new Set(keep.map((w) => w.id));
  const keptDatesWithRun = new Set(keep.filter((w) => w.date >= fromDate && isRun(w) && w.status === 'completed').map((w) => w.date));
  const fresh = newWorkouts.filter((w) => w.date >= fromDate && !keepIds.has(w.id) && !(keptDatesWithRun.has(w.date) && (isRun(w) || w.type === 'rest')));
  const removed = oldWorkouts.filter((w) => !keepIds.has(w.id));
  return { workouts: [...keep, ...fresh].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)), removedIds: removed.map((w) => w.id).filter((id) => !fresh.some((f) => f.id === id)) };
}

/** Completion stats for a date window. */
export function completionStats(workouts, from, to, today) {
  const runs = workouts.filter((w) => isRun(w) && w.date >= from && w.date <= to && w.date < today && w.status !== 'skipped');
  const done = runs.filter((w) => w.status === 'completed').length;
  return { planned: runs.length, done, rate: runs.length ? done / runs.length : null };
}

/**
 * Compare actual paces against targets for recent structured workouts.
 * activities: [{ laps:[{zone, targetPace:[fast,slow], avgPace, duration}], rpe, date }]
 */
export function analyzePerformance(activities, currentVdot) {
  const relevant = activities
    .filter((a) => a.laps && a.laps.some((l) => l.targetPace && l.avgPace && ['work', 'steady'].includes(l.kind) && l.duration >= 60))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);
  if (relevant.length < 4) return { status: 'insufficient', count: relevant.length, needed: 4 };
  const verdicts = relevant.map((a) => {
    const laps = a.laps.filter((l) => l.targetPace && l.avgPace && ['work', 'steady'].includes(l.kind) && l.duration >= 60);
    let faster = 0, slower = 0, ok = 0;
    for (const l of laps) {
      const [fast, slow] = l.targetPace;
      if (l.avgPace < fast * 0.98) faster++;
      else if (l.avgPace > slow * 1.03) slower++;
      else ok++;
    }
    const n = laps.length;
    const v = faster / n >= 0.6 ? 'faster' : slower / n >= 0.5 ? 'slower' : 'on';
    return { v, rpe: a.rpe, date: a.date };
  });
  const last4 = verdicts.slice(0, 4);
  const fasterN = last4.filter((x) => x.v === 'faster').length;
  const slowerN = last4.filter((x) => x.v === 'slower').length;
  const rpes = last4.map((x) => x.rpe).filter(Boolean);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  let status = 'meeting', delta = 0;
  if (fasterN >= 3 && (avgRpe == null || avgRpe <= 7)) { status = 'exceeding'; delta = 1; }
  else if (slowerN >= 3 || (avgRpe != null && avgRpe >= 8.5)) { status = 'struggling'; delta = -1; }
  return {
    status, fasterN, slowerN, avgRpe, count: relevant.length,
    suggestion: delta && currentVdot ? { delta, newVdot: Math.round((currentVdot + delta) * 10) / 10 } : null,
  };
}

/** If a completed activity is a valid benchmark, return the implied VDOT. */
export function benchmarkVdot(workout, activity) {
  if (workout?.benchmark?.kind === 'threshold' && activity) {
    const lap = (activity.laps || []).find((l) => l.kind === 'work' && l.duration >= 1200 && l.distance > 2000 && !l.estimated);
    if (!lap) return null;
    const pace = lap.duration / (lap.distance / 1000);
    const v = vdotFromThreshold(pace);
    return v > 15 && v < 90 ? { vdot: v, distanceM: lap.distance, timeSec: lap.duration, kind: 'threshold' } : null;
  }
  if (!workout?.benchmark?.distanceM || !activity) return null;
  const target = workout.benchmark.distanceM;
  const lap = (activity.laps || []).find((l) => l.kind === 'work' && l.distance > 0);
  const dist = lap?.distance || activity.benchmarkDistance;
  const time = lap?.duration || activity.benchmarkTime;
  if (!dist || !time || dist < target * 0.95) return null;
  const v = vdotFromRace(dist, time);
  return v && v > 15 && v < 90 ? { vdot: v, distanceM: dist, timeSec: time } : null;
}

/** Build a 'hold' recommendation when the athlete is not completing the planned work. */
export function workloadCheck(workouts, activities, today) {
  const from = addDays(today, -14);
  const stats = completionStats(workouts, from, addDays(today, -1), today);
  const recent = activities.filter((a) => a.date >= from);
  const rpes = recent.map((a) => a.rpe).filter(Boolean);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const struggling = (stats.planned >= 4 && stats.rate < 0.6) || (avgRpe != null && rpes.length >= 3 && avgRpe >= 8);
  return { ...stats, avgRpe, struggling, weekStart: startOfWeek(today) };
}
