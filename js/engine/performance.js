// Adaptive coaching engine: per-workout evaluation, multi-workout trends,
// per-zone pace offsets, assessment scheduling and recovery check-ins.
// Pure and deterministic — tested in Node.

import { trainingPaces, vdotFromRace, velocityForVo2, vo2AtVelocity, predictTime } from './vdot.js';
import { addDays, diffDays, startOfWeek } from '../core/dates.js';
import { isHard, isRun, flattenSteps } from './workout-utils.js';

// ---------------------------------------------------------------- pace model
/** Zone groups that can be adjusted independently. */
export const PACE_GROUPS = {
  easy: { label: 'Easy & long runs', zones: ['recovery', 'easy', 'long'] },
  steady: { label: 'Steady & marathon pace', zones: ['steady', 'marathon'] },
  threshold: { label: 'Tempo & threshold', zones: ['tempo', 'threshold', 'half', '10k'] },
  interval: { label: 'Intervals', zones: ['interval', '5k'] },
  rep: { label: 'Repetitions', zones: ['rep'] },
};
export const ZONE_GROUP = Object.fromEntries(Object.entries(PACE_GROUPS).flatMap(([g, v]) => v.zones.map((z) => [z, g])));

/** Effective paces: VDOT model plus per-group offsets (sec/km, negative = faster). */
export function effectivePaces(vdot, offsets = {}, basePaces = null) {
  const base = basePaces || (vdot ? trainingPaces(vdot) : null);
  if (!base) return null;
  const out = {};
  for (const [z, r] of Object.entries(base)) {
    const off = offsets[ZONE_GROUP[z]] || 0;
    out[z] = [r[0] + off, r[1] + off];
  }
  return out;
}

// ---------------------------------------------------------------- single workout evaluation
const QUALITY_KINDS = ['work', 'steady'];

/** Compare one activity against its prescription. */
export function evaluateWorkout(activity, workout) {
  const laps = (activity.laps || []).filter((l) => QUALITY_KINDS.includes(l.kind) && l.targetPace && l.avgPace && l.duration >= 45 && !l.estimated);
  const verdicts = laps.map((l) => {
    const [fast, slow] = l.targetPace;
    const mid = (fast + slow) / 2;
    const dev = (l.avgPace - mid) / mid; // + slower, − faster
    const v = l.avgPace < fast * 0.98 ? 'fast' : l.avgPace > slow * 1.03 ? 'slow' : 'on';
    return { ...l, dev, verdict: v, group: ZONE_GROUP[l.zone] || null };
  });
  const n = verdicts.length;
  const count = (v) => verdicts.filter((x) => x.verdict === v).length;
  const planned = workout ? flattenSteps(workout.steps || []).length : null;
  const skipped = (activity.laps || []).filter((l) => l.skipped).length;
  const completion = activity.completionPct ?? (planned ? Math.round(((planned - skipped) / planned) * 100) : 100);
  let headline, tone = 'ok';
  if (completion < 70) { headline = `You completed about ${completion}% of the session.`; tone = 'warn'; }
  else if (!n) headline = activity.distanceEstimated ? 'Session logged. Paces were not measured (no GPS), so this one counts toward consistency but not pace analysis.' : 'Session complete.';
  else if (count('on') >= n * 0.6) headline = `${count('on')} of ${n} efforts landed in the target range — well controlled.`;
  else if (count('fast') >= n * 0.6) { headline = `${count('fast')} of ${n} efforts were faster than prescribed.`; tone = 'accent'; }
  else if (count('slow') >= n * 0.5) { headline = `${count('slow')} of ${n} efforts were slower than prescribed.`; tone = 'warn'; }
  else headline = 'Mixed pacing — some efforts on target, some off.';
  const notes = [];
  if (activity.rpe) {
    const hard = workout && (isHard(workout) || workout.type === 'long');
    if (!hard && activity.rpe >= 7) notes.push('This was meant to be easy but felt hard. Fatigue, heat or poor sleep are common causes — keep the next run very relaxed.');
    if (hard && activity.rpe <= 5 && count('fast') + count('on') === n && n) notes.push('Target paces felt comfortable. If this repeats, your paces will be nudged up.');
    if (hard && activity.rpe >= 9) notes.push('A maximal-feeling session. Prioritise recovery over the next 48 hours.');
  }
  if (activity.feel === 'very-tired' || activity.feel === 'tired') notes.push('You reported tired legs — the next easy days matter. Consider a daily check-in tomorrow.');
  const work = verdicts.filter((v) => v.kind === 'work');
  if (work.length >= 3) {
    const first = work[0].avgPace, last = work[work.length - 1].avgPace;
    if (last > first * 1.04) notes.push('Your final reps faded noticeably — start the first rep a touch more conservatively next time.');
    else if (last < first * 0.99) notes.push('Negative split across the reps — excellent pacing discipline.');
  }
  return { laps: verdicts, n, fast: count('fast'), slow: count('slow'), on: count('on'), completion, headline, notes, tone };
}

// ---------------------------------------------------------------- trends
/**
 * Analyse recent structured sessions per pace group.
 * activities: newest-first or any order; each with laps (zone, targetPace, avgPace, duration, kind), rpe, date.
 * Returns { groups: {g: {...}}, suggestion, trends: [...] }
 */
export function analyzeTrends({ activities = [], workouts = [], plan = null, today, decisions = {} }) {
  const acts = activities.filter((a) => a.date <= today).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const groups = {};
  for (const g of Object.keys(PACE_GROUPS)) {
    const sessions = [];
    for (const a of acts) {
      if (a.distanceEstimated) continue;
      const laps = (a.laps || []).filter((l) => ZONE_GROUP[l.zone] === g && QUALITY_KINDS.includes(l.kind) && l.targetPace && l.avgPace && l.duration >= (g === 'rep' ? 30 : 90) && !l.estimated);
      if (!laps.length) continue;
      const tot = laps.reduce((s, l) => s + l.duration, 0);
      const avgPace = laps.reduce((s, l) => s + l.avgPace * l.duration, 0) / tot;
      const fast = laps[0].targetPace[0], slow = laps[0].targetPace[1];
      const mid = (fast + slow) / 2;
      const dev = (avgPace - mid) / mid;
      const verdict = avgPace < fast * 0.98 ? 'fast' : avgPace > slow * 1.03 ? 'slow' : 'on';
      sessions.push({ id: a.id, date: a.date, avgPace, dev, verdict, rpe: a.rpe || null, outlier: dev < -0.08 && !['timetrial', 'race', 'assessment'].includes(a.type), title: a.title });
      if (sessions.length >= 6) break;
    }
    groups[g] = analyzeGroup(g, sessions);
  }
  const trends = describeTrends({ acts, workouts, today, groups });
  const suggestion = buildSuggestion({ groups, plan, decisions, acts });
  return { groups, trends, suggestion };
}

function median(a) { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function analyzeGroup(g, sessions) {
  const usable = sessions.filter((s) => !s.outlier);
  const last = usable.slice(0, 4);
  const res = { group: g, sessions: sessions.length, usable: usable.length, outliers: sessions.filter((s) => s.outlier).length, status: 'insufficient', delta: 0, latestIds: last.map((s) => s.id) };
  if (last.length < 3) return res;
  const fastN = last.filter((s) => s.verdict === 'fast').length;
  const slowN = last.filter((s) => s.verdict === 'slow').length;
  const rpes = last.map((s) => s.rpe).filter(Boolean);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const medDev = median(last.map((s) => s.dev));
  res.fastN = fastN; res.slowN = slowN; res.avgRpe = avgRpe; res.medDev = medDev; res.n = last.length;
  const easyish = g === 'easy' || g === 'steady';
  if (fastN >= 3 && (avgRpe == null || avgRpe <= (easyish ? 5 : 7))) res.status = 'faster';
  else if (slowN >= 3 || (avgRpe != null && avgRpe >= (easyish ? 7 : 8.5) && slowN >= 2)) res.status = 'slower';
  else res.status = 'on';
  // proposed offset: half the observed median deviation, capped at 3 % of pace per adjustment
  if (res.status !== 'on') res.delta = Math.max(-0.03, Math.min(0.03, medDev * 0.5));
  return res;
}

function describeTrends({ acts, workouts, today, groups }) {
  const out = [];
  // interval improvement: same group, normalised deviation older vs newer
  const runs = acts.filter((a) => a.distance > 0);
  const intervals = acts.filter((a) => (a.laps || []).some((l) => l.kind === 'work' && ZONE_GROUP[l.zone] === 'interval' && l.avgPace && !l.estimated));
  if (intervals.length >= 4) {
    const pace = (a) => { const l = a.laps.filter((x) => x.kind === 'work' && x.avgPace && ZONE_GROUP[x.zone] === 'interval'); return l.reduce((s, x) => s + x.avgPace, 0) / l.length; };
    const recent = intervals.slice(0, 2).map(pace), older = intervals.slice(-2).map(pace);
    const r = recent.reduce((a, b) => a + b) / recent.length, o = older.reduce((a, b) => a + b) / older.length;
    if (r < o * 0.98) out.push({ kind: 'up', title: 'Interval pace improving', body: `Your recent interval reps average ${Math.round(o - r)} s/km faster than a few sessions ago.` });
  }
  // long-run endurance: longest completed long run in last 3 weeks vs 3–6 weeks ago
  const long = acts.filter((a) => a.type === 'long');
  const recentLong = Math.max(0, ...long.filter((a) => a.date >= addDays(today, -21)).map((a) => a.distance));
  const olderLong = Math.max(0, ...long.filter((a) => a.date < addDays(today, -21) && a.date >= addDays(today, -42)).map((a) => a.distance));
  if (recentLong && olderLong && recentLong > olderLong * 1.1) out.push({ kind: 'up', title: 'Endurance building', body: `Your long run has grown from ${(olderLong / 1000).toFixed(1)} km to ${(recentLong / 1000).toFixed(1)} km over the last six weeks.` });
  // consistency trend
  const comp = (from, to) => { const r = workouts.filter((w) => isRun(w) && w.date >= from && w.date <= to && w.date < today && w.status !== 'skipped' && w.status !== 'replaced'); return r.length ? r.filter((w) => w.status === 'completed').length / r.length : null; };
  const ws = startOfWeek(today);
  const now4 = comp(addDays(ws, -28), addDays(today, -1)), prev4 = comp(addDays(ws, -56), addDays(ws, -29));
  if (now4 != null && prev4 != null) {
    if (now4 > prev4 + 0.15) out.push({ kind: 'up', title: 'Consistency rising', body: `You completed ${Math.round(now4 * 100)}% of runs in the last 4 weeks, up from ${Math.round(prev4 * 100)}%.` });
    if (now4 < prev4 - 0.15) out.push({ kind: 'down', title: 'Consistency slipping', body: `Completion dropped to ${Math.round(now4 * 100)}% from ${Math.round(prev4 * 100)}%. If the plan no longer fits your life, reduce running days rather than skipping sessions.` });
  }
  // difficulty completing workouts
  const recentPlanned = workouts.filter((w) => w.status === 'completed' && w.activityId && w.date >= addDays(today, -21));
  const partial = recentPlanned.map((w) => acts.find((a) => a.id === w.activityId)).filter((a) => a && a.completionPct != null && a.completionPct < 80);
  if (partial.length >= 2) out.push({ kind: 'down', title: 'Some sessions cut short', body: `${partial.length} recent workouts ended before the prescribed work was done. Workouts may be too long or too hard right now.` });
  for (const [g, r] of Object.entries(groups)) {
    if (r.status === 'faster') out.push({ kind: 'up', title: `${PACE_GROUPS[g].label}: consistently faster`, body: `${r.fastN} of your last ${r.n} sessions beat the target range${r.avgRpe ? ` at an average effort of ${r.avgRpe.toFixed(1)}/10` : ''}.` });
    if (r.status === 'slower') out.push({ kind: 'down', title: `${PACE_GROUPS[g].label}: below target`, body: `${r.slowN} of your last ${r.n} sessions were slower than prescribed${r.avgRpe ? ` with effort averaging ${r.avgRpe.toFixed(1)}/10` : ''}.` });
  }
  return out;
}

const GROUP_WORKOUT_NAME = { easy: 'easy and long runs', steady: 'steady runs', threshold: 'tempo and threshold workouts', interval: 'interval sessions', rep: 'speed rep sessions' };

function buildSuggestion({ groups, plan, decisions, acts }) {
  if (!plan || !plan.vdot) return null;
  const changing = Object.entries(groups).filter(([, r]) => r.status === 'faster' || r.status === 'slower');
  if (!changing.length) return null;
  // skip if the user already decided on this exact evidence
  const key = changing.map(([g, r]) => `${g}:${r.status}:${r.latestIds.join(',')}`).join('|');
  if (decisions[key]) return null;
  const qualityFaster = ['threshold', 'interval', 'rep'].filter((g) => groups[g].status === 'faster');
  const qualitySlower = ['threshold', 'interval', 'rep'].filter((g) => groups[g].status === 'slower');
  const offsets = { ...(plan.paceOffsets || {}) };
  let explanation, type, newVdot = null, newOffsets = null;
  if (qualityFaster.length >= 2 || qualitySlower.length >= 2) {
    // broad change across workout types → shift the whole fitness model
    const up = qualityFaster.length >= 2;
    newVdot = Math.round((plan.vdot + (up ? 1 : -1)) * 10) / 10;
    type = 'vdot';
    explanation = up
      ? `Your ${qualityFaster.map((g) => GROUP_WORKOUT_NAME[g]).join(' and ')} have both been consistently faster than prescribed while effort stayed controlled. That points to a real fitness gain, so your overall fitness score moves from ${plan.vdot.toFixed(1)} to ${newVdot.toFixed(1)} and every zone updates.`
      : `Several types of workout have been slower than prescribed, or have felt very hard. Easing your overall fitness score from ${plan.vdot.toFixed(1)} to ${newVdot.toFixed(1)} keeps sessions productive instead of exhausting.`;
    newOffsets = {};
  } else {
    type = 'zones';
    newOffsets = { ...offsets };
    const parts = [];
    for (const [g, r] of changing) {
      const base = trainingPaces(plan.vdot)[PACE_GROUPS[g].zones[0]];
      const mid = (base[0] + base[1]) / 2;
      const change = Math.round(r.delta * mid);
      if (!change) continue;
      newOffsets[g] = Math.max(-25, Math.min(25, (offsets[g] || 0) + change));
      parts.push(r.status === 'faster'
        ? `Your last ${r.n} ${GROUP_WORKOUT_NAME[g]} were consistently faster than prescribed${r.avgRpe ? ` and your reported effort stayed moderate (avg ${r.avgRpe.toFixed(1)}/10)` : ''}. Your ${PACE_GROUPS[g].label.toLowerCase()} pace has been adjusted slightly faster.`
        : `Your last ${r.n} ${GROUP_WORKOUT_NAME[g]} were slower than prescribed${r.avgRpe ? ` while effort averaged ${r.avgRpe.toFixed(1)}/10` : ''}. Easing ${PACE_GROUPS[g].label.toLowerCase()} pace slightly keeps these sessions in the right training zone.`);
    }
    if (!parts.length) return null;
    explanation = parts.join(' ');
  }
  const outlierNote = Object.values(groups).some((r) => r.outliers) ? ' One unusually fast session was ignored (possibly GPS error or a downhill route) so it could not skew the result.' : '';
  const oldPaces = plan.paces;
  const nextPaces = type === 'vdot' ? effectivePaces(newVdot, {}) : effectivePaces(plan.vdot, newOffsets);
  const changedZones = Object.keys(nextPaces).filter((z) => oldPaces?.[z] && Math.abs(oldPaces[z][0] - nextPaces[z][0]) >= 1);
  return { key, type, newVdot, newOffsets, explanation: explanation + outlierNote, oldPaces, newPaces: nextPaces, changedZones, groups: changing.map(([g]) => g) };
}

// ---------------------------------------------------------------- assessments
/** Recommend a fitness assessment when it's been a while — never every week. */
export function assessmentDue({ plan, workouts, activities, vdotHistory = [], today }) {
  if (!plan) return null;
  const week = plan.weeks.find((w) => w.start <= today && w.end >= today);
  if (!week || week.phase === 'taper' || week.phase === 'recovery' || week.phase === 'ladder') return null;
  if (plan.raceDate && diffDays(today, plan.raceDate) < 21) return null;
  const upcoming = workouts.some((w) => ['timetrial', 'assessment'].includes(w.type) && w.status === 'planned' && w.date >= today && w.date <= addDays(today, 14));
  if (upcoming) return null;
  const lastAssess = [
    ...activities.filter((a) => ['timetrial', 'assessment', 'race'].includes(a.type)).map((a) => a.date),
    ...vdotHistory.filter((h) => ['time trial', 'race', 'benchmark', 'assessment'].includes(h.source)).map((h) => h.date),
  ].sort().pop();
  const since = lastAssess ? diffDays(lastAssess, today) : diffDays(plan.startDate, today) + 28;
  if (since < 42) return null;
  return { since, reason: lastAssess ? `It has been ${Math.round(since / 7)} weeks since your last fitness check.` : 'You have no recent benchmark, so your pace zones are based on older data or effort only.' };
}

/** VDOT from a controlled 30-minute threshold assessment (avg pace ≈ threshold, ~88 % VO2max). */
export function vdotFromThreshold(avgPaceSecPerKm) {
  const v = 60000 / avgPaceSecPerKm;
  return vo2AtVelocity(v) / 0.88;
}

// ---------------------------------------------------------------- recovery check-in
/**
 * checkin: { legs 1–5, fatigue 1–5, sleep 1–5 (1 = best), pain: 'none'|'mild'|'significant' }
 * Returns { level: 'go'|'reduce'|'easy'|'rest', title, body, options: [...] }
 */
export function recommendFromCheckin(checkin, todayWorkout, { recentHard = false } = {}) {
  const score = (checkin.legs || 3) + (checkin.fatigue || 3) + (checkin.sleep || 3);
  const worst = Math.max(checkin.legs || 0, checkin.fatigue || 0, checkin.sleep || 0);
  const hard = todayWorkout && (isHard(todayWorkout) || todayWorkout.type === 'long');
  const run = todayWorkout && isRun(todayWorkout);
  const med = 'Stride can’t diagnose injuries. Pain that changes how you move, gets worse during a run, or persists should be evaluated by a doctor or physiotherapist.';
  if (checkin.pain === 'significant') {
    return { level: 'rest', title: 'Rest today and get it checked', body: `You reported significant pain. Running through it risks turning a niggle into an injury. ${med}`, medical: true, options: run ? ['rest'] : [], flagInjury: true };
  }
  if (checkin.pain === 'mild') {
    return { level: hard ? 'easy' : 'reduce', title: hard ? 'Swap today’s session for an easy run' : 'Keep it short and gentle', body: `With mild pain, avoid intensity and long efforts. Stop if it worsens while running. ${med}`, medical: true, options: run ? (hard ? ['easy', 'rest'] : ['reduce', 'rest']) : [] };
  }
  if (score >= 12 || worst === 5) {
    return { level: 'rest', title: 'Take an extra rest day', body: 'Your legs, energy and sleep all point to accumulated fatigue. One rest day now protects the next week of training far better than pushing through.', options: run ? ['rest', 'easy'] : [] };
  }
  if (score >= 9 || (recentHard && score >= 8)) {
    return { level: hard ? 'easy' : 'reduce', title: hard ? 'Replace the hard session with an easy run' : 'Reduce today’s workout', body: hard ? 'You are not fully recovered. An easy run keeps the aerobic benefit without digging a deeper hole; the plan moves on as normal.' : 'Run it shorter and slower today — about two-thirds of the planned duration.', options: run ? (hard ? ['easy', 'reduce', 'rest'] : ['reduce', 'rest']) : [] };
  }
  if (hard && score >= 7) {
    return { level: 'reduce', title: 'Proceed, but trim the volume', body: 'You are mostly recovered. Do the session with one fewer rep (or a shorter tempo) and keep the paces as written.', options: ['reduce'] };
  }
  return { level: 'go', title: 'Proceed as planned', body: hard ? 'You are recovered and ready. Warm up well and hit your targets.' : 'Good to go — enjoy the run.', options: [] };
}

/** Build a reduced version of a workout: fewer reps / shorter main set, same paces. */
export function reduceWorkout(w, factor = 0.67) {
  const steps = (w.steps || []).map((s) => {
    if (s.repeat) return { ...s, repeat: Math.max(1, Math.round(s.repeat * factor)) };
    if (['work', 'steady'].includes(s.kind)) return { ...s, value: Math.round((s.value * factor) / (s.measure === 'time' ? 60 : 100)) * (s.measure === 'time' ? 60 : 100) || s.value };
    return s;
  });
  return { ...w, steps, title: `${w.title} (reduced)` };
}

export { predictTime, vdotFromRace, velocityForVo2 };
