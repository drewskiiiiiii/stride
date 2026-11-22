// Rule-based, deterministic training plan generator.
// generatePlan(inputs, { planId, today }) → { plan, workouts }
// No DOM, no storage, no randomness: identical inputs always produce the identical plan.

import { addDays, diffDays, startOfWeek, weekday, parseISO } from '../core/dates.js';
import { predictTime } from './vdot.js';
import {
  evaluateFitness, goalInfo, checkGoal, LADDER, ladderStartLevel, ladderWeeksNeeded,
  PEAK_LONG, TAPER_WEEKS, longRunIncrement,
} from './assessment.js';
import * as W from './workouts.js';
import { estimateWorkout, isHard, isRun, zonePace } from './workout-utils.js';
import { buildStrengthSession, buildMobilitySession } from './strength.js';

const MI = 1609.344;

export const PHASE_LABEL = {
  ladder: 'Run–walk foundation', base: 'Base building', aerobic: 'Aerobic development', speed: 'Speed & threshold',
  specific: 'Race-specific', peak: 'Peak training', taper: 'Taper', recovery: 'Recovery',
};
export const PHASE_FOCUS = {
  ladder: 'Building the habit and the ability to run continuously. Walk breaks shrink each week.',
  base: 'Easy aerobic volume, strides and gentle hills to build durability.',
  aerobic: 'Longer long runs and the first sustained tempo efforts.',
  speed: 'VO₂max intervals and threshold work to raise your ceiling.',
  specific: 'Workouts at goal race pace and race-specific long runs.',
  peak: 'Your hardest, most specific training block.',
  taper: 'Volume drops, intensity stays — arrive at race day fresh and sharp.',
  recovery: 'Easy running only while your body absorbs the race.',
};

const PEAK_VOL_KM = {
  short: { beginner: 20, returning: 25, recreational: 30, intermediate: 42, advanced: 55 },
  mid: { beginner: 25, returning: 30, recreational: 35, intermediate: 48, advanced: 65 },
  long: { beginner: 32, returning: 35, recreational: 40, intermediate: 55, advanced: 75 },
  mar: { beginner: 45, returning: 50, recreational: 55, intermediate: 70, advanced: 90 },
};
const GROWTH = { gradual: 0.05, moderate: 0.08, aggressive: 0.1 };
const LONG_SHARE = { 1: 1, 2: 0.5, 3: 0.4, 4: 0.33, 5: 0.29, 6: 0.26, 7: 0.24 };
const DEFAULT_WEEKS = { short: 8, mid: 10, long: 12, mar: 16 };
const INTERVAL_REPS = { short: [400, 800, 1000], mid: [800, 1000, MI], long: [1000, MI, 2000], mar: [1000, MI, 2000], base: [400, 400, 800] };
const REP_LIMITS = { 200: [6, 12], 400: [6, 12], 800: [4, 8], 1000: [3, 6], [MI]: [3, 5], 2000: [2, 4] };
const REP_REC = { 400: 90, 800: 120, 1000: 150, [MI]: 180, 2000: 180 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const circDist = (a, b) => { const d = Math.abs(a - b) % 7; return Math.min(d, 7 - d); };

function combinations(arr, k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** Choose n run days from the available days, always including the long-run day, maximising spacing. */
export function pickRunDays(available, n, longDay) {
  const avail = [...new Set(available)].sort((a, b) => a - b);
  if (n >= avail.length) return avail;
  const must = avail.includes(longDay) ? [longDay] : [];
  const pool = avail.filter((d) => !must.includes(d));
  let best = null, bestScore = -1;
  for (const combo of combinations(pool, n - must.length)) {
    const days = [...must, ...combo].sort((a, b) => a - b);
    let minGap = 7, sumGap = 0;
    for (let i = 0; i < days.length; i++) for (let j = i + 1; j < days.length; j++) {
      const d = circDist(days[i], days[j]);
      minGap = Math.min(minGap, d); sumGap += d;
    }
    const score = minGap * 100 + sumGap;
    if (score > bestScore) { bestScore = score; best = days; }
  }
  return best || avail.slice(0, n);
}

/** Choose q quality days among candidates, ≥2 days from each other and from the long-run day (circular week). */
export function pickQualityDays(candidates, q, longDay) {
  for (let k = q; k > 0; k--) {
    let best = null, bestScore = -1;
    for (const combo of combinations(candidates, k)) {
      const hard = longDay != null ? [...combo, longDay] : combo;
      let minGap = 7, sum = 0;
      for (let i = 0; i < hard.length; i++) for (let j = i + 1; j < hard.length; j++) {
        const d = circDist(hard[i], hard[j]); minGap = Math.min(minGap, d); sum += d;
      }
      if (hard.length > 1 && minGap < 2) continue;
      // prefer mid-week quality and the day farthest from the long run
      const score = minGap * 100 + sum * 10 - combo.reduce((a, d) => a + Math.abs(((d + 6) % 7) - 2), 0);
      if (score > bestScore) { bestScore = score; best = combo; }
    }
    if (best) return best;
  }
  return [];
}

function allocatePhases(weights, S) {
  if (S <= 0) return [];
  const raw = weights.map(([p, w]) => ({ p, w, n: Math.floor(w * S), f: (w * S) % 1 }));
  let left = S - raw.reduce((a, r) => a + r.n, 0);
  [...raw].sort((a, b) => b.f - a.f).forEach((r) => { if (left > 0) { r.n++; left--; } });
  // make sure the final (most specific) phase exists when there is room
  if (S >= 2 && raw[raw.length - 1].n === 0) {
    const donor = raw.reduce((a, b) => (b.n > a.n ? b : a));
    donor.n--; raw[raw.length - 1].n++;
  }
  const out = [];
  raw.forEach((r) => { for (let i = 0; i < r.n; i++) out.push({ phase: r.p, i, n: r.n }); });
  return out;
}

function phaseWeights(g, fitness, orientation) {
  if (g.family === 'base') return [['aerobic', 1]];
  if (g.id === 'fitness') return [['base', 0.35], ['aerobic', 0.35], ['speed', 0.3]];
  if (g.id === 'mileage') return [['base', 0.4], ['aerobic', 0.6]];
  if (g.id === 'speed') return [['base', 0.25], ['speed', 0.45], ['peak', 0.3]];
  if (fitness.newRunner || fitness.experience === 'beginner') return [['base', 0.5], ['aerobic', 0.3], ['specific', 0.2]];
  if (orientation === 'complete') return [['base', 0.35], ['aerobic', 0.3], ['specific', 0.25], ['peak', 0.1]];
  return [['base', 0.25], ['aerobic', 0.15], ['speed', 0.25], ['specific', 0.2], ['peak', 0.15]];
}

function qualityCount(fitness, phase, prefs, injury, nRun) {
  if (injury?.painNow) return 0;
  let q = { beginner: 1, returning: 1, recreational: 1, intermediate: 2, advanced: 2 }[fitness.experience] ?? 1;
  if (phase === 'base') q = Math.min(q, 1);
  if (prefs.progression === 'gradual' && fitness.experience !== 'advanced') q = Math.min(q, 1);
  if (injury?.has) q = Math.min(q, 1);
  if (nRun <= 3) q = Math.min(q, 1);
  q = Math.min(q, Math.max(0, nRun - 2));
  return q;
}

function expandAdjustments(adjs = []) {
  const blocked = {};
  for (const a of adjs) {
    if (!['travel', 'illness', 'unavailable', 'rest'].includes(a.type) || !a.start) continue;
    for (let d = a.start; d <= (a.end || a.start); d = addDays(d, 1)) blocked[d] = { type: a.type, mode: a.mode || 'none' };
  }
  return blocked;
}

/** Main entry point. */
export function generatePlan(inputs, { planId = 'plan', today } = {}) {
  today = today || inputs.startDate;
  const fitness = evaluateFitness(inputs, today);
  const g = goalInfo(inputs.goal);
  const check = checkGoal(inputs, fitness, today);
  const prefs = { mode: 'distance', progression: 'moderate', ...(inputs.prefs || {}) };
  const avail = inputs.availability || {};
  const unit = inputs.unit || 'mi';
  const injury = inputs.injury || {};
  const prog = injury.painNow || injury.has ? 'gradual' : prefs.progression;
  const startDate = inputs.startDate || today;
  const week1 = startOfWeek(startDate);
  const availableDays = (avail.days && avail.days.length ? avail.days : [1, 3, 5, 6]).slice();
  const longDay = availableDays.includes(avail.longRunDay) ? avail.longRunDay : availableDays.includes(6) ? 6 : availableDays.includes(0) ? 0 : availableDays[availableDays.length - 1];
  const nRun = clamp(avail.daysPerWeek || availableDays.length, 1, availableDays.length);
  const runDays = pickRunDays(availableDays, nRun, longDay);
  const warnings = check.messages.slice();
  const adjustments = inputs.adjustments || [];
  const blocked = expandAdjustments(adjustments);
  // temporary restrictions: 'easy' = no hard sessions, 'reduced' = ~25 % less volume and ≤1 hard session
  const restrictOn = (date) => adjustments.find((a) => a.type === 'restrict' && a.start <= date && (a.end || a.start) >= date) || null;
  const RELOCATABLE = new Set(['unavailable', 'rest']);

  // ---- plan length ----
  let raceDate = g.race ? inputs.goal.raceDate || null : null;
  const ladderNeeded = fitness.newRunner ? ladderWeeksNeeded(fitness.continuousMin, prog) : 0;
  let totalWeeks;
  if (raceDate) totalWeeks = clamp(Math.floor(diffDays(week1, raceDate) / 7) + 1, 1, 52);
  else if (g.family === 'base') totalWeeks = Math.max(4, ladderNeeded + (g.id === 'start' ? 3 : fitness.newRunner ? 0 : 4));
  else if (g.race) totalWeeks = clamp(Math.max(DEFAULT_WEEKS[g.family] || 10, check.recommendedWeeks), 4, 30);
  else totalWeeks = g.id === 'mileage' ? 10 : 8;

  const taper = g.race ? Math.min(TAPER_WEEKS[g.family], Math.max(1, totalWeeks - 2)) : 0;
  const postRace = g.race && (g.family === 'long' || g.family === 'mar') && totalWeeks >= 8 ? 1 : 0;
  const ladderWeeks = Math.min(ladderNeeded, Math.max(0, totalWeeks - taper - (g.race ? 2 : 0)));
  const S = Math.max(0, totalWeeks - ladderWeeks - taper);
  const weightList = phaseWeights(g, fitness, g.orientation);
  const phaseSeq = allocatePhases(weightList, S);
  const allWeeks = totalWeeks + postRace;

  if (g.race && !raceDate) {
    // No date given: the final week's long-run day becomes the goal event.
    raceDate = addDays(week1, (totalWeeks - 1) * 7 + ((longDay + 6) % 7));
  }
  if (ladderNeeded > ladderWeeks && fitness.newRunner && g.family !== 'base') {
    warnings.push({ level: 'caution', msg: 'There is not enough time to complete the full run–walk progression before your goal. Walk breaks during the event are completely fine.' });
  }

  // ---- volume model ----
  const easyPace = fitness.assumedEasy;
  const distForMin = (min) => (min * 60 / easyPace) * 1000;
  const weekdayCapM = distForMin(avail.weekdayMin || 60);
  const weekendCapM = distForMin(avail.weekendMin || 120);
  const capFor = (wd) => (wd === 0 || wd === 6 ? weekendCapM : weekdayCapM);
  const maxVolByTime = runDays.reduce((a, d) => a + capFor(d), 0) * 0.95;

  let peakVol = g.family === 'base'
    ? nRun * distForMin(35)
    : (PEAK_VOL_KM[g.family]?.[fitness.experience] || 35) * 1000 * (g.orientation === 'complete' ? 0.9 : 1);
  if (g.id === 'mileage') peakVol *= 1.15;
  if (inputs.goal.desiredWeeklyM) peakVol = inputs.goal.desiredWeeklyM;
  const ladderEndVol = nRun * distForMin(30);
  let buildVol = fitness.newRunner ? Math.min(nRun, 4) * distForMin(30) : Math.max(fitness.weeklyDist * (fitness.experience === 'returning' ? 0.9 : 1), nRun * distForMin(20));
  if (fitness.newRunner && fitness.weeklyDist > buildVol) buildVol = fitness.weeklyDist;
  peakVol = Math.max(peakVol, buildVol);
  if (peakVol > maxVolByTime) {
    warnings.push({ level: 'caution', msg: 'Your available time limits weekly volume below the ideal for this goal. Peak volume has been capped to fit your schedule.' });
    peakVol = Math.max(buildVol, maxVolByTime);
  }
  let growth = injury.painNow ? 0 : GROWTH[prog] * (fitness.newRunner ? 0.8 : 1);
  const lrInc = longRunIncrement(prog, fitness.newRunner);
  const distFactor = { short: 2, mid: 1.5, long: 0.95, mar: 0.76 }[g.family];
  const expCap = ['beginner', 'returning'].includes(fitness.experience) || g.orientation === 'complete' ? 0.92 : 1;
  const lrCapFinal = Math.min((PEAK_LONG[g.family] || 12000) * expCap, g.distanceM && distFactor ? Math.max(g.distanceM * distFactor, 8000) : 99999, weekendCapM);
  let buildLR = fitness.newRunner ? distForMin(35) : Math.max(Math.min(fitness.longestRun || 0, buildVol * 0.5), distForMin(25));
  const recoveryEvery = (inputs.profile?.age || 0) >= 50 || fitness.newRunner ? 3 : 4;
  const volAdj = (date) => adjustments.filter((a) => a.type === 'volume' && a.start <= date).reduce((f, a) => f * (a.factor || 1), 1);

  // ---- assemble weeks ----
  const weeks = [];
  const workouts = [];
  const paces = fitness.paces;
  const ctxBase = { paces, assumedEasy: easyPace, pref: prefs.mode === 'time' ? 'time' : 'distance', unit, experience: fitness.experience, track: !!prefs.track, treadmill: !!prefs.treadmill, outdoors: prefs.outdoors !== false };
  let ladderLevel = ladderStartLevel(fitness.continuousMin);
  let peakLRReached = buildLR, peakVolReached = buildVol;
  let stdIndex = 0, recoveryCount = 0, carryReduction = null;
  let lastQualityWasTT = false;

  for (let w = 0; w < allWeeks; w++) {
    const wStart = addDays(week1, w * 7);
    const wEnd = addDays(wStart, 6);
    const dateOf = (wd) => addDays(wStart, (wd + 6) % 7);
    const blockedDays = Object.keys(blocked).filter((d) => d >= wStart && d <= wEnd);
    const illnessDays = blockedDays.filter((d) => blocked[d].type === 'illness').length;
    let type, phase, phaseProgress = 0, recovery = false;
    if (w < ladderWeeks) { type = 'ladder'; phase = 'ladder'; phaseProgress = w / Math.max(1, ladderWeeks - 1); }
    else if (w < ladderWeeks + S) {
      const ps = phaseSeq[w - ladderWeeks];
      type = 'standard'; phase = ps.phase; phaseProgress = ps.n > 1 ? ps.i / (ps.n - 1) : 1;
      const s = w - ladderWeeks;
      recovery = S >= 5 && (s + 1) % recoveryEvery === 0 && s < S - 1 && phase !== 'peak';
      if (adjustments.some((a) => a.type === 'recovery' && a.start >= wStart && a.start <= wEnd)) recovery = true;
    } else if (w < totalWeeks) { type = w === totalWeeks - 1 ? 'raceweek' : 'taper'; phase = 'taper'; }
    else { type = 'post'; phase = 'recovery'; }
    if (!g.race && w === totalWeeks - 1 && type === 'standard' && g.family !== 'base') recovery = true; // final assessment week

    const hold = adjustments.some((a) => a.type === 'hold' && a.start >= wStart && a.start <= wEnd) || injury.painNow;
    const progress = totalWeeks > 1 ? w / (totalWeeks - 1) : 1;
    const week = { index: w + 1, start: wStart, end: wEnd, phase, phaseLabel: PHASE_LABEL[phase], focus: PHASE_FOCUS[phase], recovery, type, targetDist: 0 };
    const add = (date, built, slot, extra = {}) => {
      if (date < startDate) return null;
      const est = built.estSec != null ? { duration: built.estSec, distance: 0 } : estimateWorkout(built.steps, paces, easyPace);
      const wk = {
        id: `${planId}-${date}-${slot}`, planId, date, week: w + 1, phase, slot, status: 'planned', source: 'plan',
        type: built.type, title: built.title, purpose: built.purpose, steps: built.steps, tips: built.tips || [],
        key: !!built.key, quality: !!built.quality, exercises: built.exercises || null, benchmark: built.benchmark || null,
        targetSec: built.targetSec || null, estDistance: est.distance, estDuration: est.duration, ...extra,
      };
      workouts.push(wk);
      return wk;
    };

    // --- days for this week ---
    const isBlockedHard = (date) => blocked[date] && !(blocked[date].type === 'travel' && blocked[date].mode === 'light');
    const isLight = (date) => blocked[date] && blocked[date].type === 'travel' && blocked[date].mode === 'light';
    // illness aftermath: 3 days easy-only after an illness block
    const postIllness = (date) => {
      for (let k = 1; k <= 3; k++) { const b = blocked[addDays(date, -k)]; if (b && b.type === 'illness' && !blocked[date]) return true; }
      return false;
    };

    if (type === 'ladder') {
      const sessions = Math.min(runDays.length, 3);
      const days = pickRunDays(runDays, sessions, longDay);
      const lvl = LADDER[Math.min(ladderLevel, LADDER.length - 1)];
      days.forEach((wd, k) => {
        const date = dateOf(wd);
        if (isBlockedHard(date)) return;
        let built = W.runWalk(ctxBase, lvl.run, lvl.walk, lvl.reps);
        // final session of the ladder for the run-30 goal celebrates the milestone
        if (w === ladderWeeks - 1 && k === days.length - 1 && ladderLevel >= LADDER.length - 1) built = { ...W.runWalk(ctxBase, 1800, 0, 1), key: true, title: '30-min Continuous Run — Milestone!' };
        add(date, built, 'run');
      });
      week.targetDur = days.length * (lvl.run * lvl.reps + 600);
      const advance = prog === 'gradual' ? (w % 3 !== 2) : true;
      const missedMuch = blockedDays.length >= 3;
      if (advance && !missedMuch) ladderLevel = Math.min(LADDER.length - 1, ladderLevel + 1);
      if (w === ladderWeeks - 1) { buildVol = Math.max(buildVol, Math.min(ladderEndVol, nRun * distForMin(30))); buildLR = distForMin(35); }
      addSupplemental(w, wStart, dateOf, days, null, phase, false);
      weeks.push(week);
      continue;
    }

    // --- volume target ---
    let vol, lr;
    if (type === 'standard') {
      if (carryReduction) { buildVol *= carryReduction; buildLR *= carryReduction; carryReduction = null; }
      const isFirst = stdIndex === 0;
      if (recovery) {
        vol = buildVol * 0.75; lr = buildLR * 0.7;
      } else {
        if (!isFirst && !hold) {
          const inc = Math.min(buildVol * growth, 8000);
          buildVol = Math.min(Math.max(peakVol, buildVol), buildVol + inc);
          const shareCap = buildVol * Math.max(LONG_SHARE[nRun] || 0.3, { mar: 0.3, long: 0.27 }[g.family] || 0) * 1.15;
          buildLR = Math.min(lrCapFinal, buildLR + lrInc, Math.max(buildLR, shareCap));
        }
        if (isFirst) buildLR = Math.min(buildLR, lrCapFinal, buildVol * 0.55);
        vol = buildVol; lr = buildLR;
      }
      vol *= volAdj(wStart); lr *= Math.min(1, volAdj(wStart));
      const weekDates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(wStart, i));
      if (weekDates.some((d) => restrictOn(d)?.mode === 'reduced')) { vol *= 0.75; lr *= 0.85; }
      peakVolReached = Math.max(peakVolReached, vol); peakLRReached = Math.max(peakLRReached, lr);
      stdIndex++;
    } else if (type === 'taper') {
      const k = w - ladderWeeks - S; // 0-based taper index
      const fVol = g.family === 'mar' ? [0.8, 0.65][k] ?? 0.65 : 0.75;
      const fLR = g.family === 'mar' ? [0.75, 0.55][k] ?? 0.55 : 0.65;
      vol = peakVolReached * fVol; lr = peakLRReached * fLR;
    } else if (type === 'raceweek') {
      vol = peakVolReached * ({ short: 0.5, mid: 0.5, long: 0.4, mar: 0.3 }[g.family] || 0.5); lr = 0;
    } else { vol = peakVolReached * 0.35; lr = 0; }
    const breakDays = blockedDays.length;
    if (breakDays >= 4 || illnessDays >= 3) {
      const anyNone = blockedDays.some((d) => blocked[d].mode !== 'light');
      carryReduction = illnessDays >= 3 ? 0.7 : anyNone ? 0.8 : 0.9;
    }

    // --- day roles ---
    let effective = runDays.filter((wd) => !isBlockedHard(dateOf(wd)));
    // Unavailable days / extra rest days: reorganise the week onto other available days
    const relocated = runDays.some((wd) => blocked[dateOf(wd)] && RELOCATABLE.has(blocked[dateOf(wd)].type));
    if (relocated) {
      const pool = availableDays.filter((wd) => !isBlockedHard(dateOf(wd)) && dateOf(wd) >= startDate);
      const want = Math.min(runDays.filter((wd) => !(blocked[dateOf(wd)] && !RELOCATABLE.has(blocked[dateOf(wd)].type))).length, pool.length);
      effective = pickRunDays(pool, want, pool.includes(longDay) ? longDay : pool[pool.length - 1]);
    }
    let lDay = null;
    if (lr > 0) {
      if (effective.includes(longDay) && !isLight(dateOf(longDay))) lDay = longDay;
      else {
        const alt = effective.filter((wd) => !isLight(dateOf(wd))).sort((a, b) => ((b + 6) % 7) - ((a + 6) % 7));
        lDay = alt[0] ?? null;
      }
    }
    let q = type === 'post' ? 0 : qualityCount(fitness, phase, prefs, injury, effective.length);
    const restrictedDays = effective.filter((wd) => restrictOn(dateOf(wd)));
    if (restrictedDays.some((wd) => restrictOn(dateOf(wd)).mode === 'reduced')) q = Math.min(q, 1);
    if (recovery) q = Math.min(q, 1);
    if (illnessDays >= 5) q = 0;
    if (type === 'standard' && fitness.newRunner && stdIndex <= 2) q = Math.min(q, phase === 'base' ? 0 : 1);
    const qCandidates = effective.filter((wd) => wd !== lDay && !isLight(dateOf(wd)) && !postIllness(dateOf(wd)) && restrictOn(dateOf(wd))?.mode !== 'easy');

    if (type === 'raceweek') {
      buildRaceWeek(w, wStart, dateOf, effective, vol);
      weeks.push({ ...week, targetDist: workouts.filter((x) => x.week === w + 1 && isRun(x)).reduce((a, x) => a + x.estDistance, 0) });
      continue;
    }

    const qDays = q ? pickQualityDays(qCandidates, q, lDay) : [];
    const ctx = { ...ctxBase };
    let used = 0;
    const roles = {};
    // quality sessions
    qDays.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).forEach((wd, slot) => {
      let built;
      const ttDue = type === 'standard' && slot === 0 && (
        (fitness.vdot == null && stdIndex === 2 && g.family !== 'base') ||
        (recovery && (g.orientation === 'performance' || fitness.vdot == null) && recoveryCount % 2 === 0 && !lastQualityWasTT && g.family !== 'base'));
      if (ttDue) {
        built = fitness.newRunner || fitness.experience === 'beginner' ? W.timeTrial(ctx, MI, '1-mile') : W.timeTrial(ctx, 5000, '5K');
        lastQualityWasTT = true;
      } else {
        built = chooseQuality(slot, phase, phaseProgress, recovery, type === 'taper', vol, stdIndex, ctx);
        lastQualityWasTT = false;
      }
      const wk = add(dateOf(wd), built, 'run');
      if (wk) used += wk.estDistance;
      roles[wd] = 'hard';
    });
    if (recovery) recoveryCount++;

    // long run
    if (lDay != null) {
      let variant = 'easy';
      if (!injury.painNow && type === 'standard' && !recovery) {
        if (['specific', 'peak'].includes(phase)) {
          if (g.family === 'mar') variant = g.orientation === 'performance' ? (stdIndex % 2 === 0 ? 'marathon' : 'progressive') : (stdIndex % 3 === 0 ? 'marathon' : 'easy');
          else if (g.family === 'long') variant = g.orientation === 'performance' ? (stdIndex % 2 === 0 ? 'half' : 'progressive') : 'easy';
          else variant = stdIndex % 3 === 0 ? 'progressive' : 'easy';
        } else if (phase === 'aerobic' && stdIndex % 3 === 0 && !fitness.newRunner) variant = 'progressive';
      }
      if (type === 'taper' && g.family === 'mar') variant = 'easy';
      if (restrictOn(dateOf(lDay))) variant = 'easy';
      const lrDist = Math.min(lr, capFor(lDay));
      if (lr > capFor(lDay) * 1.05 && !warnings.some((x) => x.code === 'lrcap')) warnings.push({ level: 'caution', code: 'lrcap', msg: 'Some long runs are shortened to fit the time you have available on long-run days.' });
      const built = W.longRun(ctx, lrDist, variant);
      const wk = add(dateOf(lDay), built, 'run');
      if (wk) used += wk.estDistance;
      roles[lDay] = 'long';
    }

    // easy / recovery runs fill remaining volume
    let easyDays = effective.filter((wd) => roles[wd] == null);
    if (type === 'post') {
      easyDays = easyDays.filter((wd) => raceDate && diffDays(raceDate, dateOf(wd)) > 2);
      easyDays = pickRunDays(easyDays, Math.min(3, easyDays.length), easyDays[easyDays.length - 1]);
    }
    const remaining = Math.max(0, vol - used);
    const minEasy = Math.max(3000, distForMin(20));
    const per = easyDays.length ? remaining / easyDays.length : 0;
    let stridesGiven = false;
    easyDays.forEach((wd) => {
      const date = dateOf(wd);
      const prevHard = roles[(wd + 6) % 7] === 'hard' || roles[(wd + 6) % 7] === 'long';
      let dist = clamp(per, minEasy, Math.max(minEasy, (lr || per) * 0.85));
      dist = Math.min(dist, capFor(wd));
      let built;
      if (isLight(date)) built = { ...W.easyRun(ctx, Math.min(dist * 0.6, distForMin(30))), title: 'Travel Easy Run', purpose: 'Short maintenance run while travelling — just keep the legs moving.' };
      else if (type === 'post') built = W.recoveryRun(ctx, Math.min(dist, distForMin(35)));
      else if (prevHard && effective.length >= 5) built = W.recoveryRun(ctx, dist * 0.75);
      else {
        const strides = !stridesGiven && !injury.painNow && ['base', 'aerobic', 'speed', 'specific', 'peak', 'taper'].includes(phase) && !roles[(wd + 1) % 7] ? (phase === 'base' ? 4 : 6) : 0;
        if (strides) stridesGiven = true;
        built = W.easyRun(ctx, dist, { strides });
      }
      add(date, built, 'run');
      roles[wd] = 'easy';
    });
    // light-travel days that are not regular run days get nothing (rest)

    addSupplemental(w, wStart, dateOf, effective, roles, phase, recovery || type === 'taper' || type === 'post');
    week.targetDist = workouts.filter((x) => x.week === w + 1 && isRun(x)).reduce((a, x) => a + x.estDistance, 0);
    weeks.push(week);
  }

  // rest-day entries for every empty day in the plan
  const byDate = new Set(workouts.map((x) => x.date));
  const planEnd = addDays(week1, allWeeks * 7 - 1);
  for (let d = startDate; d <= planEnd; d = addDays(d, 1)) {
    if (!byDate.has(d)) {
      const b = blocked[d];
      const reason = b ? ({ illness: 'Recovery from illness — rest fully until symptoms resolve.', travel: 'Travel / time away — rest day.', unavailable: 'You marked this day unavailable. Your runs were reorganised around it.', rest: 'Extra rest day you added. Your week was reorganised around it.' }[b.type] || 'Rest day.') : null;
      const built = W.restDay(reason);
      workouts.push({ id: `${planId}-${d}-rest`, planId, date: d, week: Math.floor(diffDays(week1, d) / 7) + 1, phase: weeks[Math.floor(diffDays(week1, d) / 7)]?.phase, slot: 'rest', status: 'planned', source: 'plan', ...built, estDistance: 0, estDuration: 0, key: false });
    }
  }
  workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : slotOrder(a.slot) - slotOrder(b.slot)));

  // ---- summary ----
  const runW = workouts.filter(isRun);
  const weekVols = weeks.map((wk) => runW.filter((x) => x.week === wk.index).reduce((a, x) => a + x.estDistance, 0));
  weeks.forEach((wk, i) => { wk.targetDist = weekVols[i]; wk.targetDur = runW.filter((x) => x.week === wk.index).reduce((a, x) => a + x.estDuration, 0); });
  const firstFull = weeks.find((wk) => wk.start >= startDate) || weeks[0];
  const longest = runW.filter((x) => x.type !== 'race').reduce((a, x) => (x.estDistance > a.estDistance ? x : a), { estDistance: 0 });
  const phases = [];
  weeks.forEach((wk) => {
    const last = phases[phases.length - 1];
    if (last && last.phase === wk.phase) last.to = wk.index; else phases.push({ phase: wk.phase, label: wk.phaseLabel, from: wk.index, to: wk.index });
  });
  let estimate = null;
  if (g.distanceM && fitness.vdot && fitness.confidence !== 'low') {
    const perWeek = { beginner: 0.35, returning: 0.35, recreational: 0.25, intermediate: 0.18, advanced: 0.12 }[fitness.experience] || 0.2;
    const gain = Math.min(5, perWeek * Math.max(0, S) * 0.6);
    estimate = { now: predictTime(fitness.vdot, g.distanceM), projected: predictTime(fitness.vdot + gain, g.distanceM), vdotProjected: fitness.vdot + gain };
  }
  const nonRestPerWeek = weeks.length ? workouts.filter((x) => x.type !== 'rest').length / weeks.length : 0;
  const plan = {
    id: planId, version: 1, generatedAt: today, startDate, week1, endDate: planEnd,
    raceDate, goal: { ...inputs.goal, label: g.label, family: g.family, orientation: g.orientation, distanceM: g.distanceM },
    totalWeeks: allWeeks, runDays, longDay, frequency: nRun,
    vdot: fitness.vdot, paceConfidence: fitness.confidence, paces, assumedEasy: easyPace,
    weeks, phases, warnings, check: { level: check.level, recommendedWeeks: check.recommendedWeeks, recommendedDate: check.recommendedDate, achievableTimeSec: check.achievableTimeSec, predictedTimeSec: check.predictedTimeSec },
    summary: {
      totalWeeks: allWeeks, frequency: nRun, startWeekly: firstFull ? weekVols[firstFull.index - 1] : weekVols[0], peakWeekly: Math.max(...weekVols, 0),
      longestRun: longest.estDistance, longestRunDuration: longest.estDuration || 0, workoutsPerWeek: Math.round(nonRestPerWeek * 10) / 10,
      runsPerWeek: Math.round((runW.length / Math.max(1, weeks.length)) * 10) / 10, estimate, completionDate: raceDate || planEnd, weekVols,
    },
  };
  return { plan, workouts };

  // ---------- helpers (closures) ----------
  function chooseQuality(slot, phase, p, recoveryWk, taperWk, vol, idx, ctx) {
    const fam = g.family === 'base' ? 'base' : g.family;
    const perf = g.orientation === 'performance';
    const gentle = fitness.newRunner || fitness.experience === 'beginner';
    if (recoveryWk) return W.fartlek(ctx, gentle ? 5 : 6, 60, 90);
    const pick = (list) => list[Math.min(list.length - 1, Math.floor(p * list.length * 0.999))];
    const repDist = pick(INTERVAL_REPS[fam] || INTERVAL_REPS.mid);
    const work = clamp(vol * 0.1, 3000, 8000) * (0.85 + 0.15 * p) * (taperWk ? 0.6 : 1);
    const lim = REP_LIMITS[repDist] || [3, 6];
    const reps = clamp(Math.round(work / repDist), lim[0], lim[1]);
    const tempoMin = clamp(Math.round((15 + 10 * p + (fam === 'mar' || fam === 'long' ? 5 : 0)) * (taperWk ? 0.65 : 1)), 12, 35);
    if (gentle) {
      if (phase === 'base') return W.fartlek(ctx, 5 + Math.round(p * 3), 60, 120);
      if (slot === 0) return idx % 2 ? W.hills(ctx, 5 + Math.round(p * 3), 45) : W.fartlek(ctx, 6 + Math.round(p * 2), 90, 90);
      return W.tempoRun(ctx, 12 + Math.round(p * 6));
    }
    switch (phase) {
      case 'base':
        return idx % 2 === 0 ? W.hills(ctx, 6 + Math.round(p * 4), 45 + Math.round(p * 15)) : W.fartlek(ctx, 6 + Math.round(p * 4), 60, 60);
      case 'aerobic':
        return slot === 0 ? W.tempoRun(ctx, tempoMin) : W.hills(ctx, 8 + Math.round(p * 2), 60);
      case 'speed':
        if (slot === 0) return perf ? W.intervals(ctx, repDist, reps, 'interval', REP_REC[repDist] || 120) : W.fartlek(ctx, 8, 120, 60);
        return W.cruiseIntervals(ctx, clamp(3 + Math.round(p * 2), 3, 5), fam === 'short' ? 6 : 8, 60);
      case 'specific':
      case 'peak': {
        const peakBoost = phase === 'peak' ? 1 : 0;
        if (slot === 0) {
          if (!perf) return fam === 'short' || fam === 'mid' ? W.fartlek(ctx, 6 + peakBoost * 2, 180, 90) : W.tempoRun(ctx, tempoMin);
          if (fam === 'short') return W.intervals(ctx, 1000, clamp(4 + Math.round(p * 2) + peakBoost, 4, 6), '5k', 150);
          if (fam === 'mid') return W.intervals(ctx, idx % 2 ? 2000 : MI, idx % 2 ? clamp(3 + peakBoost, 3, 4) : clamp(4 + peakBoost, 3, 5), '10k', 150);
          if (fam === 'long') return W.cruiseIntervals(ctx, clamp(3 + peakBoost, 3, 4), 10 + Math.round(p * 2) * 1, 90);
          return W.cruiseIntervals(ctx, clamp(3 + peakBoost, 3, 5), 10 + peakBoost * 2, 90);
        }
        if (fam === 'short') return W.cruiseIntervals(ctx, 3, 8, 60);
        if (fam === 'mid') return W.tempoRun(ctx, tempoMin, 'threshold');
        if (fam === 'long') return W.intervals(ctx, MI, clamp(3 + peakBoost, 3, 5), 'interval', 180);
        return W.intervals(ctx, 1000, clamp(5 + peakBoost, 4, 6), 'interval', 150);
      }
      case 'taper':
        if (fam === 'short') return W.intervals(ctx, 800, 4, '5k', 120);
        if (fam === 'mid') return W.intervals(ctx, 1000, 4, '10k', 120);
        if (fam === 'long') return W.cruiseIntervals(ctx, 3, 6, 90);
        return W.tempoRun(ctx, 15, 'marathon');
      default:
        return W.fartlek(ctx, 6, 60, 60);
    }
  }

  function buildRaceWeek(w, wStart, dateOf, effective, vol) {
    const ctx = { ...ctxBase };
    const raceWd = weekday(raceDate);
    const raceIsInWeek = raceDate >= wStart && raceDate <= addDays(wStart, 6);
    const add = (date, built, slot) => {
      if (date < startDate) return;
      const est = built.estSec != null ? { duration: built.estSec, distance: 0 } : estimateWorkout(built.steps, paces, easyPace);
      workouts.push({ id: `${planId}-${date}-${slot}`, planId, date, week: w + 1, phase: 'taper', slot, status: 'planned', source: 'plan', type: built.type, title: built.title, purpose: built.purpose, steps: built.steps, tips: built.tips || [], key: !!built.key, quality: false, benchmark: built.benchmark || null, targetSec: built.targetSec || null, estDistance: est.distance, estDuration: est.duration, exercises: built.exercises || null });
    };
    if (raceIsInWeek) {
      const label = g.distanceM === 5000 ? '5K' : g.distanceM === 10000 ? '10K' : Math.abs(g.distanceM - 21097.5) < 1 ? 'Half Marathon' : Math.abs(g.distanceM - 42195) < 1 ? 'Marathon' : `${(g.distanceM / 1000).toFixed(1)} km`;
      add(raceDate, W.race(ctx, g.distanceM, label, inputs.goal.targetTimeSec || null), 'run');
    }
    const before = effective.filter((wd) => { const d = dateOf(wd); return d < raceDate; }).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const daysBefore = (wd) => diffDays(dateOf(wd), raceDate);
    let sharpenerDone = false;
    const gentle = fitness.newRunner || fitness.experience === 'beginner';
    const sharpDay = before.filter((wd) => daysBefore(wd) >= 3).sort((a, b) => Math.abs(daysBefore(a) - 4) - Math.abs(daysBefore(b) - 4))[0];
    const easyDist = Math.max(3000, Math.min(distForMin(35), vol / Math.max(1, before.length)));
    before.forEach((wd) => {
      const d = dateOf(wd), db = daysBefore(wd);
      if (db === 1) add(d, { ...W.easyRun(ctx, distForMin(20), { strides: 4 }), title: 'Pre-race Shakeout', purpose: 'A short, easy jog with a few strides to stay loose. Keep it very relaxed.' }, 'run');
      else if (wd === sharpDay && !sharpenerDone && !injury.painNow && g.family !== 'base') {
        sharpenerDone = true;
        if (gentle) { add(d, { ...W.easyRun(ctx, distForMin(25), { strides: 4 }), title: 'Race-week Easy + Strides', purpose: 'A relaxed run with a few strides to feel sharp for race day.' }, 'run'); return; }
        const zone = g.family === 'short' ? '5k' : g.family === 'mid' ? '10k' : g.family === 'long' ? 'half' : 'marathon';
        const built = W.intervals(ctx, 1000, g.family === 'mar' ? 3 : 4, zone, 120);
        add(d, { ...built, title: 'Race-week Sharpener', purpose: 'A few short efforts at race pace to stay sharp without adding fatigue.' }, 'run');
      } else if (db >= 2) add(d, W.easyRun(ctx, easyDist), 'run');
    });
    // after the race in the same week: rest (handled by rest fill) + optional mobility
    if (prefs.mobility?.on) {
      const after = addDays(raceDate, 1);
      if (after <= addDays(wStart, 6)) {
        const m = buildMobilitySession({ minutes: prefs.mobility.minutes || 15, index: w });
        add(after, { type: 'mobility', title: 'Post-race Mobility', purpose: 'Gentle mobility to ease post-race stiffness.', steps: m.steps, exercises: m.exercises, estSec: m.estSec, tips: ['Keep everything gentle — no deep stretching while sore.'] }, 'mob');
      }
    }
  }

  function addSupplemental(w, wStart, dateOf, runWds, roles, phase, light) {
    const days = [0, 1, 2, 3, 4, 5, 6].map((wd) => ({ wd, date: dateOf(wd) })).filter((x) => x.date >= startDate && !(blocked[x.date] && blocked[x.date].type === 'illness') && !(blocked[x.date] && blocked[x.date].mode === 'none'));
    const role = (wd) => (roles ? roles[wd] : runWds.includes(wd) ? 'easy' : undefined);
    const hardTomorrow = (wd) => { const r = role((wd + 1) % 7); return r === 'hard' || r === 'long'; };
    const strengthDays = [];
    if (prefs.strength?.on) {
      let n = clamp(prefs.strength.sessions || 2, 1, 3);
      if (light) n = Math.min(n, 1);
      if (phase === 'taper' && w === totalWeeks - 1) n = 0;
      const scored = days.map((x) => {
        const r = role(x.wd);
        let s = r === 'easy' ? 3 : r == null ? 2 : r === 'hard' ? 1.5 : -5;
        if (hardTomorrow(x.wd)) s -= 10;
        return { ...x, s };
      }).sort((a, b) => b.s - a.s || a.wd - b.wd);
      for (const c of scored) {
        if (strengthDays.length >= n) break;
        if (c.s < -4) continue;
        if (strengthDays.some((d) => circDist(d.wd, c.wd) < 2)) continue;
        strengthDays.push(c);
      }
      strengthDays.forEach((c, k) => {
        const sess = buildStrengthSession({ equipment: prefs.strength.equipment, experience: fitness.experience, minutes: prefs.strength.minutes || 25, index: w * 2 + k, light });
        addRaw(c.date, w, phase, 'str', { type: 'strength', title: light ? 'Strength — Maintenance' : 'Runner Strength', purpose: 'Running-specific strength for power, stability and resilience against injury.', steps: sess.steps, exercises: sess.exercises, estSec: sess.estSec, tips: ['Quality reps over heavy weight — stop 2 reps short of failure.', 'On run days, do strength after your run.', 'Skip it if you feel unusual soreness or pain.'] });
      });
    }
    if (prefs.mobility?.on) {
      const n = clamp(prefs.mobility.sessions || 2, 1, 4);
      const cand = days.map((x) => {
        const r = role(x.wd);
        let s = r == null ? 3 : r === 'long' ? 2.5 : r === 'easy' ? 1 : 0.5;
        if (strengthDays.some((d) => d.wd === x.wd)) s -= 2;
        return { ...x, s };
      }).sort((a, b) => b.s - a.s || a.wd - b.wd);
      const chosen = [];
      for (const c of cand) { if (chosen.length >= n) break; if (chosen.some((d) => circDist(d.wd, c.wd) < 1)) continue; chosen.push(c); }
      chosen.forEach((c, k) => {
        const sess = buildMobilitySession({ minutes: prefs.mobility.minutes || 15, index: w * 2 + k });
        addRaw(c.date, w, phase, 'mob', { type: 'mobility', title: 'Mobility & Recovery', purpose: 'Guided mobility to maintain range of motion and help recovery.', steps: sess.steps, exercises: sess.exercises, estSec: sess.estSec, tips: ['Breathe slowly; never stretch into pain.', 'Great after a long run or on rest days.'] });
      });
    }
  }

  function addRaw(date, w, phase, slot, built) {
    if (date < startDate) return;
    workouts.push({ id: `${planId}-${date}-${slot}`, planId, date, week: w + 1, phase, slot, status: 'planned', source: 'plan', type: built.type, title: built.title, purpose: built.purpose, steps: built.steps, tips: built.tips, key: false, exercises: built.exercises, estDistance: 0, estDuration: built.estSec });
  }
}

function slotOrder(s) { return { run: 0, str: 1, mob: 2, rest: 3, user: 4 }[s] ?? 5; }

/** Training load helpers used by plan-adjustment validation. */
export function hardDaysAround(workouts, date) {
  const prev = workouts.filter((w) => w.date === addDays(date, -1) && isHard(w) && w.status !== 'skipped');
  const next = workouts.filter((w) => w.date === addDays(date, 1) && isHard(w) && w.status !== 'skipped');
  return { prev, next };
}

export { parseISO };
