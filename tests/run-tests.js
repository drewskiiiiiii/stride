// Engine + timer unit tests. Run: node tests/run-tests.js  (no dependencies)
import { generatePlan } from '../js/engine/training-engine.js';
import { vdotFromRace, predictTime, trainingPaces } from '../js/engine/vdot.js';
import { checkGoal, evaluateFitness } from '../js/engine/assessment.js';
import { moveWorkout, validateMove, mergeRegenerated, analyzePerformance, effectiveStatus } from '../js/engine/adjustments.js';
import { isHard, isRun, flattenSteps } from '../js/engine/workout-utils.js';
import { addDays, diffDays, weekday, startOfWeek as startOfWeekT } from '../js/core/dates.js';
import * as WS from '../js/services/workout-session.js';
import { analyzeMissed, summarizeChanges, safeDays } from '../js/engine/scheduler.js';
import { analyzeTrends, effectivePaces, recommendFromCheckin, assessmentDue, evaluateWorkout, vdotFromThreshold, reduceWorkout } from '../js/engine/performance.js';
import { validateBackup } from '../js/core/migrate.js';
import { paceToSpeed, speedToPace, roundSpeed, stepSpeed, distanceFromLog, speedStatus, convertSpeed } from '../js/engine/treadmill.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m || ''} expected ${b}±${tol}, got ${a}`);

const TODAY = '2026-11-23';
const base = (over = {}) => ({
  profile: { age: 35 }, unit: 'km', startDate: TODAY,
  fitness: { experience: 'intermediate', frequency: 4, weeklyDist: 35000, longestRun: 14000, longestContinuousMin: 90, benchmarks: [{ dist: '5k', timeSec: 22 * 60, date: '2026-10-20' }] },
  goal: { type: 'half-improve', raceDate: '2027-03-07', targetTimeSec: 6300 },
  availability: { daysPerWeek: 5, days: [1, 2, 3, 4, 6, 0], longRunDay: 0, weekdayMin: 75, weekendMin: 150 },
  prefs: { mode: 'distance', progression: 'moderate', strength: { on: true, sessions: 2, minutes: 25, equipment: ['none'] }, mobility: { on: true, sessions: 1, minutes: 15 } },
  injury: {}, adjustments: [], ...over,
});
const gen = (inp) => generatePlan(inp, { planId: 'p', today: TODAY });

function invariants(plan, workouts, inp) {
  const runs = workouts.filter(isRun);
  // no workouts before start
  ok(workouts.every((w) => w.date >= inp.startDate), 'workout before start date');
  // only on available days (race/assessment excepted)
  const avail = new Set(inp.availability.days);
  ok(runs.filter((w) => w.type !== 'race').every((w) => avail.has(weekday(w.date))), 'run on unavailable day');
  // no consecutive hard days
  const hard = runs.filter((w) => isHard(w) || w.type === 'long').map((w) => w.date).sort();
  for (let i = 1; i < hard.length; i++) {
    const race = runs.find((w) => w.type === 'race');
    if (race && (hard[i] === race.date || hard[i - 1] === race.date)) continue;
    ok(diffDays(hard[i - 1], hard[i]) >= 2, `consecutive hard days ${hard[i - 1]} ${hard[i]}`);
  }
  // weekly volume: no non-recovery jump > 12 % (plus 1 km slack) between standard weeks
  const vols = plan.summary.weekVols;
  plan.weeks.forEach((wk, i) => {
    if (i === 0 || wk.type !== 'standard' || plan.weeks[i - 1].type !== 'standard' || plan.weeks[i - 1].recovery || wk.recovery || i === 1) return;
    ok(vols[i] <= vols[i - 1] * 1.13 + 1500, `week ${i + 1} jump ${vols[i - 1]} → ${vols[i]}`);
  });
  // max one run per day
  const byDate = {};
  runs.forEach((w) => { byDate[w.date] = (byDate[w.date] || 0) + 1; });
  ok(Object.values(byDate).every((n) => n === 1), 'two runs on one day');
  // every workout has steps & sane estimates
  runs.forEach((w) => { ok(w.steps.length > 0, 'run without steps'); ok(w.estDuration > 0 && w.estDuration < 5 * 3600, 'bad duration ' + w.estDuration); });
}

console.log('VDOT model');
t('25:00 5K ≈ VDOT 38.3', () => near(vdotFromRace(5000, 1500), 38.3, 0.2));
t('predictTime inverts vdotFromRace', () => near(predictTime(vdotFromRace(10000, 2700), 10000), 2700, 1));
t('zones ordered fast→slow', () => { const p = trainingPaces(45); ok(p.rep[0] < p.interval[0] && p.interval[0] < p.threshold[0] && p.threshold[0] < p.marathon[0] && p.marathon[0] < p.easy[0]); });

console.log('Plan generation');
t('intermediate half marathon with race date', () => {
  const inp = base(); const { plan, workouts } = gen(inp);
  invariants(plan, workouts, inp);
  ok(plan.raceDate === '2027-03-07'); ok(workouts.some((w) => w.type === 'race' && w.date === '2027-03-07'), 'race scheduled');
  ok(plan.phases.map((p) => p.phase).includes('taper'), 'has taper');
  ok(plan.summary.longestRun >= 16000, 'long run reaches ≥16 km: ' + plan.summary.longestRun);
  ok(plan.weeks.some((w) => w.recovery), 'has recovery weeks');
  ok(workouts.some((w) => w.type === 'strength') && workouts.some((w) => w.type === 'mobility'), 'supplemental scheduled');
});
t('complete beginner gets run-walk progression and no intervals early', () => {
  const inp = base({ fitness: { experience: 'beginner', frequency: 0, weeklyDist: 0, longestRun: 0, longestContinuousMin: 1, benchmarks: [] }, goal: { type: '5k-complete' }, availability: { daysPerWeek: 3, days: [1, 3, 6], longRunDay: 6, weekdayMin: 45, weekendMin: 60 } });
  const { plan, workouts } = gen(inp);
  invariants(plan, workouts, inp);
  ok(plan.phases[0].phase === 'ladder', 'starts with run-walk');
  ok(workouts.filter((w) => w.week <= 3).every((w) => !['intervals', 'tempo', 'threshold'].includes(w.type)), 'no hard work early');
  ok(plan.paces === null, 'no invented paces without data');
  ok(workouts.some((w) => w.type === 'race'), 'ends with goal 5K');
});
t('advanced marathon performance plan', () => {
  const inp = base({ fitness: { experience: 'advanced', frequency: 4, weeklyDist: 80000, longestRun: 26000, longestContinuousMin: 150, benchmarks: [{ dist: 'half', timeSec: 5040, date: '2026-10-01' }] }, goal: { type: 'marathon-improve', raceDate: '2027-04-18', targetTimeSec: 10500 }, availability: { daysPerWeek: 6, days: [0, 1, 2, 3, 4, 5, 6], longRunDay: 0, weekdayMin: 90, weekendMin: 210 } });
  const { plan, workouts } = gen(inp);
  invariants(plan, workouts, inp);
  ok(plan.summary.longestRun >= 29000, 'marathon long run ≥29 km');
  ok(workouts.some((w) => w.title.includes('Marathon Pace')), 'marathon-pace long runs');
  ok(workouts.some((w) => w.type === 'intervals') && workouts.some((w) => w.type === 'threshold'), 'speed + threshold');
  const taper = plan.weeks.filter((w) => w.phase === 'taper');
  ok(taper.length === 3, '3-week taper');
});
for (const [goal, d] of [['5k-improve', 5000], ['10k-improve', 10000], ['half-complete', 21097.5], ['marathon-complete', 42195]]) {
  t(`${goal} plan without date is valid`, () => {
    const inp = base({ goal: { type: goal } });
    const { plan, workouts } = gen(inp);
    invariants(plan, workouts, inp);
    const race = workouts.find((w) => w.type === 'race');
    ok(race && Math.abs(flattenSteps(race.steps).find((s) => s.kind === 'work').value - d) < 1, 'race distance');
  });
}
t('time-based preference produces time steps', () => {
  const { workouts } = gen(base({ prefs: { ...base().prefs, mode: 'time' } }));
  const easy = workouts.find((w) => w.type === 'easy');
  ok(easy.steps[0].measure === 'time');
});
t('current pain → no hard sessions, flat volume', () => {
  const inp = base({ injury: { has: true, painNow: true } });
  const { plan, workouts } = gen(inp);
  ok(!workouts.some((w) => ['intervals', 'tempo', 'threshold', 'hills', 'fartlek'].includes(w.type)), 'hard workouts present');
  ok(plan.warnings.some((w) => /medical/i.test(w.msg)), 'medical warning');
});
t('too-aggressive goal is flagged with a recommended date', () => {
  const inp = base({ fitness: { experience: 'recreational', frequency: 2, weeklyDist: 10000, longestRun: 5000, longestContinuousMin: 35, benchmarks: [] }, goal: { type: 'marathon-complete', raceDate: '2027-01-10' } });
  const c = checkGoal(inp, evaluateFitness(inp, TODAY), TODAY);
  ok(c.level === 'aggressive' && c.recommendedDate > '2027-01-10', JSON.stringify(c));
});
t('unrealistic target time is flagged', () => {
  const inp = base({ goal: { type: '5k-improve', raceDate: '2027-01-10', targetTimeSec: 17 * 60 } });
  const c = checkGoal(inp, evaluateFitness(inp, TODAY), TODAY);
  ok(c.targetTooFast && c.achievableTimeSec > 17 * 60);
});
t('deterministic: same inputs → identical plan', () => {
  ok(JSON.stringify(gen(base()).workouts) === JSON.stringify(gen(base()).workouts));
});
t('travel (no running) blocks days and reduces the following week', () => {
  const plain = gen(base());
  const adj = gen(base({ adjustments: [{ id: 'a', type: 'travel', start: '2026-12-14', end: '2026-12-20', mode: 'none' }] }));
  ok(!adj.workouts.some((w) => isRun(w) && w.date >= '2026-12-14' && w.date <= '2026-12-20'), 'runs during travel');
  const wk = (r) => r.plan.weeks.find((w) => w.start === '2026-12-21').targetDist;
  ok(wk(adj) < wk(plain), 'week after travel not reduced');
});
t('illness → rest + easy-only return', () => {
  const { workouts } = gen(base({ adjustments: [{ id: 'i', type: 'illness', start: '2026-12-01', end: '2026-12-05' }] }));
  ok(!workouts.some((w) => isRun(w) && w.date >= '2026-12-01' && w.date <= '2026-12-05'));
  ok(!workouts.some((w) => isHard(w) && w.date >= '2026-12-06' && w.date <= '2026-12-08'), 'hard right after illness');
});

console.log('Adjustments');
t('moving a long run next to intervals warns', () => {
  const { workouts } = gen(base());
  const long = workouts.find((w) => w.type === 'long' && w.date > '2026-12-01');
  const q = workouts.find((w) => isHard(w) && w.type !== 'long' && w.date > long.date);
  const v = validateMove(workouts, long, addDays(q.date, -1), TODAY);
  ok(v.serious && v.warnings.some((x) => /hard|recovery/i.test(x)), v.warnings.join("|"));
});
t('moveWorkout swaps and leaves rest marker', () => {
  const { workouts } = gen(base());
  const w = workouts.find((x) => x.type === 'easy' && x.date > TODAY);
  const changed = moveWorkout(workouts, w, addDays(w.date, 1));
  ok(changed[0].date === addDays(w.date, 1) && changed[0].movedFrom === w.date);
});
t('regeneration preserves history and user workouts', () => {
  const { workouts } = gen(base());
  const past = workouts.filter((w) => w.date < '2026-12-10').map((w) => ({ ...w, status: isRun(w) ? 'completed' : w.status }));
  const user = { id: 'user-1', date: '2026-12-20', source: 'user', status: 'planned', type: 'custom', steps: [] };
  const old = [...past, ...workouts.filter((w) => w.date >= '2026-12-10'), user];
  const regen = gen(base({ availability: { ...base().availability, daysPerWeek: 4 } }));
  const m = mergeRegenerated(old, regen.workouts, '2026-12-10');
  ok(m.workouts.filter((w) => w.status === 'completed').length === past.filter((w) => w.status === 'completed').length, 'history lost');
  ok(m.workouts.some((w) => w.id === 'user-1'), 'user workout lost');
});
t('past planned runs show as missed (never auto-rescheduled)', () => {
  ok(effectiveStatus({ status: 'planned', type: 'easy', date: '2026-11-01' }, TODAY) === 'missed');
});
t('performance analysis suggests faster paces after consistent beats', () => {
  const lap = (avg) => ({ kind: 'work', duration: 240, targetPace: [270, 280], avgPace: avg });
  const acts = [1, 2, 3, 4].map((i) => ({ date: `2026-11-0${i}`, rpe: 6, laps: [lap(255), lap(258)] }));
  const r = analyzePerformance(acts, 45);
  ok(r.status === 'exceeding' && r.suggestion.newVdot === 46);
  ok(analyzePerformance(acts.slice(0, 2), 45).status === 'insufficient', 'single workouts must not trigger changes');
});

console.log('Workout timer');
const workout = { id: 'w', title: '5 × 800m', type: 'intervals', steps: [
  { kind: 'warmup', label: 'Warm-up', measure: 'time', value: 600, zone: 'easy' },
  { repeat: 5, dropLastRecovery: true, steps: [{ kind: 'work', label: '800m', measure: 'distance', value: 800, zone: 'interval' }, { kind: 'recover', label: 'Jog', measure: 'time', value: 120, zone: 'recovery' }] },
  { kind: 'cooldown', label: 'Cool-down', measure: 'time', value: 600, zone: 'easy' }] };
t('flatten: 1 + 5×2 − 1 + 1 = 11 steps', () => ok(flattenSteps(workout.steps).length === 11));
t('auto-advances time steps using timestamps, even after a long gap', () => {
  const s = WS.createSession(workout, { mode: 'timer', paces: trainingPaces(45), now: 0 });
  WS.start(s, 1000);
  WS.tick(s, 1000 + 599_000); ok(s.stepIndex === 0, 'advanced early');
  const ev = WS.tick(s, 1000 + 600_500); ok(s.stepIndex === 1, 'did not advance'); ok(ev.some((e) => e.type === 'step'));
  // jump far ahead as if the phone was locked: catches up several steps at once
  WS.tick(s, 1000 + 600_000 + 3 * (s.steps[1].value + 120) * 1000 + 500);
  ok(s.stepIndex >= 7, 'catch-up failed: ' + s.stepIndex);
});
t('pause/resume preserves elapsed time exactly', () => {
  const s = WS.createSession(workout, { mode: 'timer', now: 0 });
  WS.start(s, 0); WS.pause(s, 100_000); WS.resume(s, 400_000);
  ok(WS.elapsedMs(s, 450_000) === 150_000, String(WS.elapsedMs(s, 450_000)));
  ok(s.stepIndex === 0);
});
t('state survives JSON round-trip (crash recovery)', () => {
  const s = WS.createSession(workout, { mode: 'timer', now: 0 });
  WS.start(s, 0); WS.tick(s, 700_000);
  const r = JSON.parse(JSON.stringify(s));
  ok(WS.elapsedMs(r, 700_000) === 700_000 && r.stepIndex === s.stepIndex);
});
t('distance steps advance on GPS distance', () => {
  const s = WS.createSession(workout, { mode: 'gps', paces: trainingPaces(45), now: 0 });
  WS.start(s, 0); WS.tick(s, 601_000); ok(s.stepIndex === 1);
  let lat = 40, tm = 601_000;
  for (let i = 0; i < 90; i++) { lat += 0.00009; tm += 2000; WS.addGpsPoint(s, { lat, lng: -75, acc: 5, t: tm }); WS.tick(s, tm); }
  ok(s.stepIndex >= 2, 'did not advance after ~900 m: dist ' + Math.round(s.distance));
  ok(s.laps[1].distance >= 790, 'lap distance ' + s.laps[1].distance);
});
t('GPS jumps are rejected', () => {
  const s = WS.createSession(workout, { mode: 'gps', now: 0 });
  WS.start(s, 0);
  WS.addGpsPoint(s, { lat: 40, lng: -75, acc: 5, t: 1000 });
  WS.addGpsPoint(s, { lat: 40.01, lng: -75, acc: 5, t: 2000 }); // 1.1 km in 1 s
  ok(s.distance === 0);
});
t('skip / previous interval', () => {
  const s = WS.createSession(workout, { mode: 'timer', now: 0 });
  WS.start(s, 0); WS.next(s, 5000); ok(s.stepIndex === 1 && s.laps[0].skipped);
  WS.prev(s, 6000); ok(s.stepIndex === 0 && s.laps.length === 0);
});
t('finish produces an activity with completion %', () => {
  const s = WS.createSession(workout, { mode: 'timer', paces: trainingPaces(45), now: 0 });
  WS.start(s, 0); WS.tick(s, 30 * 60_000); WS.finish(s, 30 * 60_000 + 1);
  const a = WS.toActivity(s, { date: TODAY, rpe: 7 });
  ok(a.duration === 1800 && a.completionPct > 50 && a.distance > 0 && a.distanceEstimated);
});

console.log('Intelligent scheduling');
const doneBefore = (ws, d, except) => ws.map((x) => (x.date < d && x.id !== except && isRun(x) ? { ...x, status: 'completed' } : x));
const plan10 = () => { const inp = base({ goal: { type: '10k-improve', raceDate: '2027-02-21' }, availability: { daysPerWeek: 4, days: [1, 2, 3, 4, 5, 6, 0], longRunDay: 0, weekdayMin: 75, weekendMin: 150 }, prefs: { mode: 'distance', progression: 'moderate' } }); const r = gen(inp); r.plan.inputs = inp; return r; };
t('missed easy run → skip recommended (never crammed)', () => {
  const { plan, workouts } = plan10();
  const w = workouts.find((x) => x.type === 'easy' && x.date > '2026-12-01');
  const r = analyzeMissed(doneBefore(workouts, addDays(w.date, 1), w.id), w, { plan, today: addDays(w.date, 1) });
  ok(r.options[0].id === 'skip' && r.options[0].primary, r.options.map((o) => o.id).join());
  ok(r.analysis.length >= 4, 'analysis bullets');
});
t('missed quality → moved to a safe day with 48 h around hard sessions', () => {
  const { plan, workouts } = plan10();
  const w = workouts.find((x) => isHard(x) && x.date > '2026-12-07' && weekday(x.date) <= 3 && weekday(x.date) >= 1);
  const today = addDays(w.date, 1);
  const r = analyzeMissed(doneBefore(workouts, today, w.id), w, { plan, today });
  const mv = r.options.find((o) => o.id === 'move');
  if (mv) {
    const d = mv.movedTo;
    const others = workouts.filter((x) => x.id !== w.id && (isHard(x) || x.type === 'long') && x.status === 'planned');
    ok(!others.some((x) => Math.abs(diffDays(x.date, d)) < 2), 'adjacent hard ' + d);
    ok(d >= today && d <= addDays(w.date, 6 - ((weekday(w.date) + 6) % 7)), 'outside week');
  } else ok(r.options[0].id === 'skip', 'should skip when no safe day');
});
t('missed long run → move or cap next long run', () => {
  const { plan, workouts } = plan10();
  const w = workouts.find((x) => x.type === 'long' && x.date > '2026-12-10');
  const r = analyzeMissed(doneBefore(workouts, addDays(w.date, 1), w.id), w, { plan, today: addDays(w.date, 1) });
  ok(r.options.some((o) => o.id === 'adjust-long' || o.id === 'move' || o.id === 'skip'));
  const adj = r.options.find((o) => o.id === 'adjust-long');
  if (adj) ok(adj.updates[1].estDistance <= w.estDistance * 1.08, 'next long not capped');
});
t('several missed sessions → reduce upcoming mileage', () => {
  const { plan, workouts } = plan10();
  const today = '2026-12-17';
  const ws = workouts.map((x) => (isRun(x) && x.date >= '2026-12-08' && x.date < today ? { ...x, status: 'missed' } : x));
  const w = ws.find((x) => isHard(x) && x.date >= '2026-12-08' && x.date < today);
  const r = analyzeMissed(ws, w, { plan, today });
  ok(r.options[0].id === 'reduce' && r.options[0].adjustments[0].type === 'hold');
});
t('unavailable day reorganises the week onto another available day', () => {
  const inp = plan10().plan.inputs;
  const before = gen(inp);
  const d = before.workouts.find((x) => x.type === 'easy' && x.date > '2026-12-07').date;
  const after = gen({ ...inp, adjustments: [{ id: 'u', type: 'unavailable', start: d, end: d }] });
  ok(!after.workouts.some((x) => isRun(x) && x.date === d), 'still runs that day');
  const wk = (r) => r.workouts.filter((x) => isRun(x) && x.date >= startOfWeekT(d) && x.date <= addDays(startOfWeekT(d), 6)).length;
  ok(wk(after) === wk(before), `run count changed ${wk(before)}→${wk(after)}`);
});
t('restriction (easy only) removes hard sessions in range', () => {
  const inp = plan10().plan.inputs;
  const r = gen({ ...inp, adjustments: [{ id: 'r', type: 'restrict', mode: 'easy', start: '2026-12-14', end: '2026-12-27' }] });
  ok(!r.workouts.some((x) => isHard(x) && x.date >= '2026-12-14' && x.date <= '2026-12-27'));
});
t('change summary reports moved workouts and race realism', () => {
  const { plan, workouts } = plan10();
  const w = workouts.find((x) => x.type === 'easy' && x.date > '2026-12-01');
  const after = workouts.map((x) => (x.id === w.id ? { ...x, date: addDays(x.date, 1) } : x));
  const s = summarizeChanges(workouts, after, { beforePlan: plan, afterPlan: plan, today: TODAY, title: 't', reason: 'r' });
  ok(s.moved.length === 1 && s.race && typeof s.race.ok === 'boolean');
});
t('move validation flags taper conflicts and weekly mileage', () => {
  const { plan, workouts } = plan10();
  const q = workouts.find((x) => isHard(x) && x.type !== 'race' && x.date < '2027-02-01');
  const v = validateMove(workouts, q, addDays(plan.raceDate, -2), TODAY, { plan });
  ok(v.serious && v.warnings.some((x) => /taper/i.test(x)), v.warnings.join('|'));
});

console.log('Adaptive coaching');
const mkAct = (i, zone, target, avg, rpe, type = 'tempo') => ({ id: 'a' + zone + i, date: addDays('2026-11-01', i * 3), type, rpe, distance: 8000, duration: 2400, laps: [{ kind: 'work', zone, targetPace: target, avgPace: avg, duration: 1200, distance: 4000 }] });
t('per-zone suggestion after 3+ consistently fast tempo runs (with explanation & old/new paces)', () => {
  const plan = { vdot: 45, paces: effectivePaces(45, {}), paceOffsets: {} };
  const tp = plan.paces.threshold;
  const acts = [0, 1, 2, 3].map((i) => mkAct(i, 'threshold', tp, tp[0] * 0.96, 6));
  const r = analyzeTrends({ activities: acts, workouts: [], plan, today: '2026-12-01' });
  ok(r.suggestion && r.suggestion.type === 'zones' && r.suggestion.newOffsets.threshold < 0, JSON.stringify(r.suggestion?.newOffsets));
  ok(/tempo and threshold/i.test(r.suggestion.explanation));
  ok(r.suggestion.oldPaces.threshold[0] > r.suggestion.newPaces.threshold[0], 'new pace not faster');
  ok(r.suggestion.newOffsets.threshold >= -25, 'capped');
});
t('a single unusually fast workout never triggers a change', () => {
  const plan = { vdot: 45, paces: effectivePaces(45, {}), paceOffsets: {} };
  const tp = plan.paces.threshold;
  const acts = [mkAct(0, 'threshold', tp, tp[0] * 0.85, 5)];
  ok(!analyzeTrends({ activities: acts, workouts: [], plan, today: '2026-12-01' }).suggestion);
  const four = [0, 1, 2, 3].map((i) => mkAct(i, 'threshold', tp, i === 0 ? tp[0] * 0.85 : (tp[0] + tp[1]) / 2, 6));
  ok(!analyzeTrends({ activities: four, workouts: [], plan, today: '2026-12-01' }).suggestion, 'outlier skewed result');
});
t('broad improvement across quality types → overall VDOT suggestion', () => {
  const plan = { vdot: 45, paces: effectivePaces(45, {}), paceOffsets: {} };
  const acts = [0, 1, 2, 3].flatMap((i) => [mkAct(i, 'threshold', plan.paces.threshold, plan.paces.threshold[0] * 0.96, 6), { ...mkAct(i + 10, 'interval', plan.paces.interval, plan.paces.interval[0] * 0.96, 7, 'intervals'), id: 'i' + i }]);
  const r = analyzeTrends({ activities: acts, workouts: [], plan, today: '2026-12-30' });
  ok(r.suggestion?.type === 'vdot' && r.suggestion.newVdot === 46);
});
t('rejected suggestion is not repeated for the same evidence', () => {
  const plan = { vdot: 45, paces: effectivePaces(45, {}), paceOffsets: {} };
  const tp = plan.paces.threshold;
  const acts = [0, 1, 2, 3].map((i) => mkAct(i, 'threshold', tp, tp[0] * 0.96, 6));
  const s = analyzeTrends({ activities: acts, workouts: [], plan, today: '2026-12-01' }).suggestion;
  ok(!analyzeTrends({ activities: acts, workouts: [], plan, today: '2026-12-01', decisions: { [s.key]: { accepted: false } } }).suggestion);
});
t('check-in: significant pain → rest + medical evaluation', () => {
  const r = recommendFromCheckin({ legs: 2, fatigue: 2, sleep: 2, pain: 'significant' }, { type: 'intervals', steps: [] });
  ok(r.level === 'rest' && r.medical && r.flagInjury);
});
t('check-in: fatigued before a hard day → replace with easy', () => {
  const r = recommendFromCheckin({ legs: 4, fatigue: 3, sleep: 3, pain: 'none' }, { type: 'tempo', steps: [] });
  ok(r.level === 'easy' && r.options.includes('easy'));
  ok(recommendFromCheckin({ legs: 1, fatigue: 2, sleep: 1, pain: 'none' }, { type: 'tempo', steps: [] }).level === 'go');
});
t('assessment recommended only after ~6 weeks, never in taper', () => {
  const { plan, workouts } = plan10();
  const tt = workouts.filter((w) => ['timetrial', 'assessment'].includes(w.type));
  const clean = workouts.filter((w) => !tt.includes(w));
  ok(!assessmentDue({ plan, workouts: clean, activities: [{ type: 'timetrial', date: '2026-12-20' }], today: '2027-01-05' }), 'too soon');
  ok(assessmentDue({ plan, workouts: clean, activities: [{ type: 'timetrial', date: '2026-11-20' }], today: '2027-01-12' }), 'should be due');
  ok(!assessmentDue({ plan, workouts: clean, activities: [], today: addDays(plan.raceDate, -5) }), 'taper');
});
t('threshold assessment converts to sensible VDOT', () => near(vdotFromThreshold(trainingPaces(45).threshold[0] + 4), 45, 2.5));
t('workout evaluation explains pacing', () => {
  const e = evaluateWorkout({ rpe: 6, laps: [1, 2, 3, 4].map((i) => ({ kind: 'work', zone: 'interval', targetPace: [240, 248], avgPace: 244, duration: 190, rep: i })) }, null);
  ok(e.on === 4 && /target range/.test(e.headline));
});
t('reduced workout has fewer reps', () => {
  const r = reduceWorkout({ title: 'x', steps: workout.steps }, 0.6);
  ok(r.steps[1].repeat === 3);
});

console.log('Data');
t('backup validation detects duplicates and bad files', () => {
  const state = { activities: [{ id: 'a1', date: '2026-11-01', duration: 100, distance: 1000 }], plans: [{ id: 'p1' }] };
  const v = validateBackup({ app: 'stride-running-coach', schemaVersion: 1, stores: { plans: [{ id: 'p1', weeks: [] }], workouts: [], activities: [{ id: 'a1', date: '2026-11-01', duration: 100 }, { id: 'a2', date: '2026-11-02', duration: 50 }], profile: { main: {} } } }, state);
  ok(v.ok && v.duplicates.activities === 1 && v.duplicates.plans === 1 && v.warnings.some((w) => /older version/.test(w)));
  ok(!validateBackup({ hello: 1 }, state).ok);
  ok(!validateBackup({ app: 'stride-running-coach', schemaVersion: 99, stores: {} }, state).ok, 'newer version should fail');
});

console.log('Treadmill coaching');
t('pace → speed: 6:00/mi = 10.0 mph, 5:00/km = 12.0 km/h', () => {
  near(paceToSpeed(360 / 1.609344, 'mph'), 10, 0.001);
  near(paceToSpeed(300, 'kmh'), 12, 0.001);
  near(speedToPace(10, 'mph') * 1.609344, 360, 0.01);
  near(speedToPace(12, 'kmh'), 300, 0.01);
  near(convertSpeed(10, 'mph', 'kmh'), 16.09, 0.01);
});
t('speeds round to 0.1 increments', () => {
  ok(roundSpeed(7.249) === 7.2 && roundSpeed(7.25) === 7.3 && roundSpeed(6.96) === 7.0);
  const v = paceToSpeed(8.5 * 60 / 1.609344, 'mph'); ok(roundSpeed(v) === 7.1, String(roundSpeed(v)));
});
t('pace range → speed range (slow pace = low speed), target = midpoint', () => {
  const r = stepSpeed({ kind: 'work', zone: 'tempo', targetPace: [300, 330] }, { unit: 'kmh' });
  ok(r.low === 10.9 && r.high === 12.0 && r.target === 11.4, JSON.stringify(r));
});
t('every segment of a multi-target workout gets its own speed', () => {
  const p = trainingPaces(45);
  const s = WS.createSession(workout, { mode: 'treadmill', paces: p, now: 0, speedUnit: 'mph' });
  const speeds = s.steps.map((x) => x.speed?.target);
  ok(speeds.every((v) => v > 3 && v < 12.6), speeds.join());
  ok(s.steps[0].speed.target < s.steps[1].speed.target && s.steps[2].speed.target < s.steps[1].speed.target, 'warmup < interval > recovery');
  ok(s.steps[1].measure === 'distance', 'treadmill keeps distance steps');
});
t('walk & effort-only plans still get sensible speeds (flagged estimated)', () => {
  ok(stepSpeed({ kind: 'walk', zone: 'walk', measure: 'time', value: 60 }, { unit: 'mph' }).target === 3.5);
  ok(stepSpeed({ kind: 'steady', zone: 'easy' }, { paces: null, assumedEasy: 420, unit: 'kmh' }).estimated);
  ok(stepSpeed({ kind: 'exercise', zone: null }, {}) === null);
});
t('distance integrates user-entered speeds, including a mid-workout change', () => {
  const log = [{ at: 0, mps: 3 }, { at: 60000, mps: 4 }];
  ok(distanceFromLog(log, 120000) === 420, String(distanceFromLog(log, 120000)));
  const s = WS.createSession(workout, { mode: 'treadmill', paces: trainingPaces(45), now: 0, speedUnit: 'kmh' });
  WS.setTreadmillSpeed(s, 0, 10.8); WS.start(s, 0);
  WS.tick(s, 300_000); near(s.distance, 900, 1, '5 min @ 10.8 km/h');
  WS.setTreadmillSpeed(s, 300_000, 7.2);
  WS.tick(s, 600_000); near(s.distance, 1500, 1, '+5 min @ 7.2');
  ok(s.tm.selected === 7.2 && s.tm.changes.length === 2);
});
t('distance-based intervals advance from treadmill distance; laps record actual vs target speed', () => {
  const p = trainingPaces(45);
  const s = WS.createSession(workout, { mode: 'treadmill', paces: p, now: 0, speedUnit: 'kmh' });
  WS.setTreadmillSpeed(s, 0, s.steps[0].speed.target); WS.start(s, 0);
  WS.tick(s, 600_001); ok(s.stepIndex === 1, 'warm-up time step');
  WS.setTreadmillSpeed(s, 600_001, 16.0); // 4.444 m/s → 800 m in 180 s
  WS.tick(s, 600_001 + 179_000); ok(s.stepIndex === 1, 'advanced too early');
  WS.tick(s, 600_001 + 181_000); ok(s.stepIndex === 2, 'did not advance after 800 m');
  const lap = s.laps[1];
  ok(lap.treadmill && lap.tmAvgSpeed === 16 && lap.targetSpeed.target === s.steps[1].speed.target && Math.abs(lap.distance - 800) < 6, JSON.stringify(lap));
});
t('new interval never changes the selected speed (user must adjust)', () => {
  const s = WS.createSession(workout, { mode: 'treadmill', paces: trainingPaces(45), now: 0 });
  WS.setTreadmillSpeed(s, 0, 6.0); WS.start(s, 0); WS.tick(s, 601_000);
  ok(s.stepIndex === 1 && s.tm.selected === 6.0);
});
t('30-second next-interval notice and off-target reminder fire once', () => {
  const s = WS.createSession(workout, { mode: 'treadmill', paces: trainingPaces(45), now: 0 });
  WS.setTreadmillSpeed(s, 0, 5.5); WS.start(s, 0);
  const e1 = WS.tick(s, 571_000); ok(e1.some((e) => e.type === 'tmPre' && e.next.kind === 'work'), JSON.stringify(e1.map((e) => e.type)));
  ok(!WS.tick(s, 575_000).some((e) => e.type === 'tmPre'), 'repeated');
  WS.tick(s, 600_500); // now in interval at 5.5 (too slow)
  const e2 = WS.tick(s, 621_000); ok(e2.some((e) => e.type === 'tmReminder'), 'no reminder');
  ok(!WS.tick(s, 640_000).some((e) => e.type === 'tmReminder'), 'reminder repeated');
});
t('pause/resume keeps speed history and does not add distance while paused', () => {
  const s = WS.createSession(workout, { mode: 'treadmill', paces: trainingPaces(45), now: 0, speedUnit: 'kmh' });
  WS.setTreadmillSpeed(s, 0, 9); WS.start(s, 0); WS.tick(s, 120_000);
  WS.pause(s, 120_000); WS.tick(s, 400_000); WS.resume(s, 400_000);
  WS.setTreadmillSpeed(s, 400_000, 12); WS.tick(s, 460_000);
  near(s.distance, 300 + 200, 1, 'distance across pause');
  ok(s.tm.speedLog.length === 2 && s.tm.speedLog[1].at === 120_000, JSON.stringify(s.tm.speedLog));
  const a = WS.toActivity(s, { date: TODAY }); WS.finish(s, 460_000);
  ok(WS.toActivity(s, { date: TODAY }).treadmill.speedLog.length === 2);
});
t('speed status respects the prescribed range', () => {
  const r = { low: 6.6, high: 7.0 };
  ok(speedStatus(6.8, r) === 'on' && speedStatus(6.0, r) === 'slow' && speedStatus(7.3, r) === 'fast' && speedStatus(7.0, r) === 'on');
});
t('treadmill trends are analysed separately from outdoor GPS runs', () => {
  const plan = { vdot: 45, paces: effectivePaces(45, {}), paceOffsets: {} };
  const tp = plan.paces.threshold;
  const out = [0, 1].map((i) => mkAct(i, 'threshold', tp, (tp[0] + tp[1]) / 2, 6));
  const tm = [2, 3, 4].map((i) => ({ ...mkAct(i, 'threshold', tp, tp[0] * 0.96, 6), id: 'tm' + i, source: 'treadmill', laps: [{ kind: 'work', zone: 'threshold', targetPace: tp, avgPace: tp[0] * 0.96, duration: 1200, distance: 4000, treadmill: true }] }));
  const r = analyzeTrends({ activities: [...out, ...tm], workouts: [], plan, today: '2026-12-30' });
  ok(r.groups.threshold.source === 'treadmill' && r.suggestion && /treadmill/i.test(r.suggestion.explanation), JSON.stringify(r.groups.threshold));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
