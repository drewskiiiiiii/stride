// Recovery-aware dynamic rescheduling.
// planReschedule(workouts, w, newDate, { plan, today }) → proposal (nothing is applied here).
//
// Rules (in priority order):
//  1. Recovery: demanding sessions (intervals, tempo, threshold, hills, fartlek, time trials,
//     long runs) never sit on adjacent days.
//  2. The long run keeps its day; it may shift ±1 day within its week if that restores spacing.
//  3. The number of quality sessions per week is kept where it can be done safely.
//  4. Weekly mileage is kept as close as practical — workouts stay inside their own week.
//  5. Only available training days are used; easy/recovery runs are the flexible filler.
//  6. When there is not enough room: drop easy runs first, then shorten a quality session
//     (a shortened session may sit next to one hard day, never between two), then skip it.
// Only dates change, except where a workout must be shortened or skipped — always explained.
// Completed, missed and past workouts are never touched.

import { addDays, diffDays, startOfWeek, weekday, fmtDate } from '../core/dates.js';
import { isHard, isRun, estimateWorkout } from './workout-utils.js';
import { reduceWorkout } from './performance.js';
import { fmtDist } from '../core/units.js';

const QUALITY = new Set(['tempo', 'intervals', 'threshold', 'hills', 'fartlek', 'reps', 'timetrial', 'assessment']);
const isDemanding = (w) => !!w && (QUALITY.has(w.type) || w.type === 'long' || w.type === 'race' || (isHard(w) && w.type !== 'custom'));
const live = (w) => w.status !== 'skipped' && w.status !== 'replaced';
const day = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

/** Count adjacent demanding pairs in a set of (date → demanding) entries within [from, to]. */
function spacingConflicts(byDate, from, to) {
  const out = [];
  for (let d = addDays(from, -1); d < to; d = addDays(d, 1)) {
    const a = byDate.get(d), b = byDate.get(addDays(d, 1));
    if (a?.hard && b?.hard) out.push({ a: d, b: addDays(d, 1), aw: a.w, bw: b.w });
  }
  return out;
}

function mapOf(list) {
  const m = new Map();
  for (const x of list) {
    if (!isRun(x) || !live(x)) continue;
    const cur = m.get(x.date);
    const hard = isDemanding(x) && !x._reduced;
    if (!cur || hard) m.set(x.date, { hard: hard || cur?.hard, w: hard ? x : cur?.w || x });
  }
  return m;
}

/** Simple "move only" analysis used for the No path and for conflict explanations. */
export function nextSuitableDay(workouts, w, fromDate, { plan, today }) {
  const avail = new Set(plan?.inputs?.availability?.days || [0, 1, 2, 3, 4, 5, 6]);
  const others = workouts.filter((x) => x.id !== w.id && live(x) && isRun(x));
  const end = addDays(startOfWeek(fromDate), 13);
  for (let d = fromDate < today ? today : fromDate; d <= end; d = addDays(d, 1)) {
    if (!avail.has(weekday(d))) continue;
    if (others.some((x) => x.date === d && (isDemanding(x) || x.status !== 'planned'))) continue; // an easy run there can be swapped
    if (isDemanding(w) && others.some((x) => isDemanding(x) && Math.abs(diffDays(x.date, d)) === 1)) continue;
    if (plan?.raceDate && isDemanding(w) && w.type !== 'race' && diffDays(d, plan.raceDate) >= 0 && diffDays(d, plan.raceDate) <= 3) continue;
    return d;
  }
  return null;
}

export function planReschedule(workouts, w, newDate, { plan, today }) {
  const avail = new Set(plan?.inputs?.availability?.days || [0, 1, 2, 3, 4, 5, 6]);
  const longDay = plan?.inputs?.availability?.longRunDay;
  const earliest = w.date < newDate ? w.date : newDate;
  const winStart = earliest < today ? today : earliest;
  const winEnd = addDays(startOfWeek(newDate > today ? newDate : today), 13);
  const inWin = (d) => d >= winStart && d <= winEnd && d >= today;
  const allowed = (d) => inWin(d) && avail.has(weekday(d));
  const raceGuard = (d) => plan?.raceDate && diffDays(d, plan.raceDate) >= 0 && diffDays(d, plan.raceDate) <= 3;

  const movable = (x) => x.id !== w.id && x.status === 'planned' && inWin(x.date) && x.type !== 'race' && x.type !== 'rest' && isRun(x);
  const runs = workouts.filter((x) => isRun(x) && live(x));
  const fixed = runs.filter((x) => x.id !== w.id && !movable(x)); // completed, outside window, race…
  const items = runs.filter(movable);

  const weekOf = (d) => startOfWeek(d);
  const daysOfWeek = (d) => { const st = weekOf(d); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(st, i)); };
  const byDistance = (orig) => (a, b) => Math.abs(diffDays(orig, a)) - Math.abs(diffDays(orig, b)) || (a < b ? 1 : -1);
  const longs = items.filter((x) => x.type === 'long').sort((a, b) => (a.date < b.date ? -1 : 1));
  const quals = items.filter((x) => isDemanding(x) && x.type !== 'long').sort((a, b) => (a.date < b.date ? -1 : 1));
  const easies = items.filter((x) => !isDemanding(x)).sort((a, b) => (a.date < b.date ? -1 : 1));

  function attempt(shifts) {
    const placed = new Map();
    const occupied = new Map();
    const occupy = (d, x, hard) => { const a = occupied.get(d) || []; a.push({ w: x, hard }); occupied.set(d, a); };
    fixed.forEach((x) => occupy(x.date, x, isDemanding(x)));
    occupy(newDate, w, isDemanding(w));
    placed.set(w.id, { date: newDate, w });
    const hasRun = (d) => (occupied.get(d) || []).length > 0;
    const hardOn = (d) => (occupied.get(d) || []).some((o) => o.hard);
    const hardNeighbours = (d) => (hardOn(addDays(d, -1)) ? 1 : 0) + (hardOn(addDays(d, 1)) ? 1 : 0);
    const shortened = [], skipped = [], notes = [], displaced = [];
    let cost = 0;

    // 1–2. long runs: original day, or ±1 day within the week (user setting)
    for (const L of longs) {
      const want = addDays(L.date, shifts[L.id] || 0);
      const valid = (d) => allowed(d) && weekOf(d) === weekOf(L.date) && !hasRun(d) && hardNeighbours(d) === 0 && !raceGuard(d);
      let d = valid(want) ? want : null;
      if (!d && !shifts[L.id]) d = null;
      if (!d) { if (shifts[L.id]) return null; d = L.date; notes.push({ conflict: true, text: `The long run on ${day(L.date)} keeps its day (it anchors the week), but it sits next to another hard session.` }); cost += 20; }
      if (d !== L.date) { notes.push({ text: `Long run shifted one day ${diffDays(L.date, d) > 0 ? 'later' : 'earlier'} (${day(L.date)} → ${day(d)}) to keep 48 hours around it.` }); cost += 1.5; }
      placed.set(L.id, { date: d, w: L });
      occupy(d, L, true);
    }
    // 3. quality sessions in their own week: nearest safe day, then an easy-run day, then shortened, then skipped
    for (const Q of quals) {
      const week = daysOfWeek(Q.date).filter(allowed).sort(byDistance(Q.date));
      let d = week.find((x) => !hasRun(x) && hardNeighbours(x) === 0 && !raceGuard(x));
      if (!d) {
        const easyDay = week.find((x) => hardNeighbours(x) === 0 && !raceGuard(x) && !hardOn(x) && items.some((e) => !isDemanding(e) && e.date === x && !placed.has(e.id)));
        if (easyDay) { d = easyDay; const e = items.find((y) => !isDemanding(y) && y.date === easyDay && !placed.has(y.id)); displaced.push(e); placed.set(e.id, { pending: true }); cost += 1; }
      }
      if (d) {
        placed.set(Q.id, { date: d, w: Q }); occupy(d, Q, true);
        if (d !== Q.date) cost += 0.6 + 0.35 * Math.abs(diffDays(Q.date, d)) + (d < Q.date ? 0.4 : 0) + (d === today ? 0.3 : 0);
        continue;
      }
      const sd = week.find((x) => !hasRun(x) && hardNeighbours(x) <= 1 && !raceGuard(x));
      if (sd) {
        placed.set(Q.id, { date: sd, w: Q, reduced: true });
        occupy(sd, { ...Q, _reduced: true }, false);
        shortened.push({ w: Q, date: sd, reason: `No day this week keeps 48 hours from other hard sessions, so ${Q.title} is shortened to about 60 % of the work at the same paces to limit fatigue.` });
        cost += 6;
        continue;
      }
      placed.set(Q.id, { date: null, w: Q });
      skipped.push({ w: Q, reason: `There is no safe day for ${Q.title} this week without stacking hard sessions. Skipping it protects recovery — the next quality session continues the progression.` });
      cost += 12;
    }
    // 5. easy / recovery runs fill remaining free days (original first, avoid sandwiches)
    for (const E of [...easies.filter((e) => !displaced.includes(e)), ...displaced]) {
      if (placed.get(E.id)?.date) continue;
      const week = daysOfWeek(E.date).filter(allowed).sort(byDistance(E.date));
      const sandwiched = (x) => hardOn(addDays(x, -1)) && hardOn(addDays(x, 1));
      // an easy run stays on its own day whenever that day is still free
      // recovery runs prefer the day after a hard session; all easy runs prefer the nearest free day
      const score = (x) => Math.abs(diffDays(E.date, x)) + (E.type === 'recovery' && !hardOn(addDays(x, -1)) ? 2 : 0) + (sandwiched(x) ? 0.5 : 0);
      const d = (allowed(E.date) && !hasRun(E.date) ? E.date : null) || week.filter((x) => !hasRun(x)).sort((a, b) => score(a) - score(b))[0];
      if (d) {
        placed.set(E.id, { date: d, w: E }); occupy(d, E, false);
        if (d !== E.date) cost += 0.3 + 0.15 * Math.abs(diffDays(E.date, d)) + (E.type === 'recovery' && !hardOn(addDays(d, -1)) ? 0.4 : 0);
      }
      else { placed.set(E.id, { date: null, w: E }); skipped.push({ w: E, reason: `${E.title} is dropped: no free training day remains this week, and easy runs are the most flexible part of the plan.` }); cost += 3; }
    }
    return { placed, shortened, skipped, notes, cost };
  }

  // try the long run on its own day and ±1 day; keep the safest, least disruptive schedule
  const shiftSets = [{}];
  for (const L of longs) {
    const more = [];
    for (const base of shiftSets) for (const sh of [-1, 1]) more.push({ ...base, [L.id]: sh });
    shiftSets.push(...more);
  }
  let best = null;
  for (const sh of shiftSets) { const r = attempt(sh); if (r && (!best || r.cost < best.cost)) best = r; }
  const { placed, shortened, skipped, notes } = best;

  // ---- build updates ----
  const updates = [];
  const moves = [], unchanged = [];
  const pushMove = (x, to, extra = {}) => {
    const mv = { ...x, date: to, status: 'planned', ...extra };
    if (to === (x.movedFrom || x.date) && !extra._keepMovedFrom) { /* moved back to its original day */ }
    mv.movedFrom = to === x.movedFrom ? null : x.movedFrom || x.date;
    mv.rescheduled = mv.movedFrom ? true : false;
    updates.push(mv);
  };
  for (const [id, p] of placed) {
    const x = p.w;
    if (!x || p.pending) continue;
    if (p.date == null) { updates.push({ ...x, status: 'skipped', skipReason: 'dynamic reschedule' }); continue; }
    if (p.reduced) {
      const red = reduceWorkout(x, 0.6);
      const est = estimateWorkout(red.steps, plan?.paces, plan?.assumedEasy || 420);
      pushMove(x, p.date, { steps: red.steps, title: red.title, estDistance: est.distance, estDuration: est.duration, adjustedReason: 'Shortened to preserve recovery', original: x.original || { title: x.title, steps: x.steps, type: x.type } });
      if (p.date !== x.date) moves.push({ w: x, from: x.date, to: p.date });
      continue;
    }
    if (p.date !== x.date) { pushMove(x, p.date); moves.push({ w: x, from: x.date, to: p.date }); }
    else if (id !== w.id) unchanged.push(x);
  }
  // supplemental sessions: avoid strength the day before a demanding run
  const finalMap = new Map();
  const after = applyUpdates(workouts, updates);
  after.filter((x) => isRun(x) && live(x)).forEach((x) => { if (isDemanding(x) && !x.adjustedReason) finalMap.set(x.date, true); });
  for (const S of workouts.filter((x) => x.type === 'strength' && x.status === 'planned' && inWin(x.date))) {
    if (!finalMap.get(addDays(S.date, 1))) continue;
    const opts = daysOfWeek(S.date).filter((d) => inWin(d) && !finalMap.get(addDays(d, 1)) && !after.some((y) => y.date === d && y.type === 'strength')).sort(byDistance(S.date));
    if (opts[0]) { updates.push({ ...S, date: opts[0], movedFrom: S.movedFrom || S.date, rescheduled: true }); moves.push({ w: S, from: S.date, to: opts[0] }); }
  }
  // rest markers: retire rest on days that gain a run, add rest on days left empty
  const after2 = applyUpdates(workouts, updates);
  for (let d = winStart; d <= winEnd; d = addDays(d, 1)) {
    const hasWork = after2.some((x) => x.date === d && live(x) && x.type !== 'rest');
    const rest = after2.find((x) => x.date === d && x.type === 'rest');
    if (hasWork && rest && live(rest)) updates.push({ ...rest, status: 'replaced' });
    if (!hasWork && !rest && d >= today) updates.push({ id: `${w.planId}-${d}-rest`, planId: w.planId, date: d, week: w.week, phase: w.phase, slot: 'rest', type: 'rest', title: 'Rest Day', purpose: 'Recovery day created by rescheduling.', steps: [], tips: [], status: 'planned', source: 'plan', estDistance: 0, estDuration: 0 });
    if (!hasWork && rest && rest.status === 'replaced') updates.push({ ...rest, status: 'planned' });
  }
  const finalList = applyUpdates(workouts, updates);

  // ---- metrics for the preview ----
  const beforeMove = workouts; // schedule as it was
  const naive = applyUpdates(workouts, [{ ...w, date: newDate }]);
  const restDays = (list) => { let n = 0; for (let d = winStart; d <= winEnd; d = addDays(d, 1)) if (d >= today && !list.some((x) => x.date === d && isRun(x) && live(x))) n++; return n; };
  const conflictsBefore = spacingConflicts(mapOf(naive), winStart, winEnd);
  const conflictsAfter = spacingConflicts(mapOf(finalList), winStart, winEnd);
  const weeks = [...new Set([weekOf(winStart), weekOf(winEnd)])];
  const weekStats = weeks.map((s) => {
    const sum = (list) => list.filter((x) => isRun(x) && live(x) && x.date >= s && x.date <= addDays(s, 6)).reduce((a, x) => a + (x.estDistance || 0), 0);
    const q = (list) => list.filter((x) => isRun(x) && live(x) && isDemanding(x) && x.type !== 'long' && !x.adjustedReason && x.date >= s && x.date <= addDays(s, 6)).length;
    return { week: s, before: sum(beforeMove), after: sum(finalList), qBefore: q(beforeMove), qAfter: q(finalList) };
  });
  const wConflict = conflictsAfter.filter((c) => c.aw?.id === w.id || c.bw?.id === w.id);
  const suggestion = wConflict.length ? nextSuitableDay(finalList, w, addDays(newDate, 1), { plan, today }) : null;
  return {
    workout: w, from: w.date, to: newDate, window: { from: winStart, to: winEnd },
    updates, moves, unchanged, shortened, skipped, notes,
    recovery: { restBefore: restDays(beforeMove), restAfter: restDays(finalList) },
    conflicts: { before: conflictsBefore.map(describeConflict), after: conflictsAfter.map(describeConflict), involvingMoved: wConflict.map(describeConflict) },
    weeks: weekStats, suggestion,
    preserved: 'Workout purpose, structure, paces and training phase are unchanged — only dates move unless noted.',
  };
}

function describeConflict(c) {
  return `${c.aw.title} (${day(c.a)}) and ${c.bw.title} (${day(c.b)}) are on consecutive days — less than 48 hours of recovery.`;
}

export function applyUpdates(list, updates) {
  const m = new Map(list.map((x) => [x.id, x]));
  updates.forEach((u) => m.set(u.id, u));
  return [...m.values()];
}

/** Text summary lines for the preview. */
export function proposalLines(p) {
  const lines = [];
  lines.push({ kind: 'move', text: `${p.workout.title}: ${day(p.from)} → ${day(p.to)} (your choice)` });
  p.moves.filter((m) => m.w.id !== p.workout.id).forEach((m) => lines.push({ kind: 'move', text: `${m.w.title}: ${day(m.from)} → ${day(m.to)}` }));
  p.shortened.forEach((s) => lines.push({ kind: 'short', text: `${s.w.title} shortened (${day(s.date)})`, why: s.reason }));
  p.skipped.forEach((s) => lines.push({ kind: 'skip', text: `${s.w.title} (${day(s.w.date)}) skipped`, why: s.reason }));
  return lines;
}

export { fmtDist, isDemanding };
