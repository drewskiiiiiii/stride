// Fitness evaluation and goal realism. Pure functions.

import { vdotFromRace, trainingPaces, predictTime } from './vdot.js';
import { diffDays, startOfWeek, addDays } from '../core/dates.js';

const MI = 1609.344;

export const BENCHMARK_DIST = { mile: MI, '3k': 3000, '5k': 5000, '10k': 10000, half: 21097.5, marathon: 42195 };
export const BENCHMARK_LABEL = { mile: '1 mile', '3k': '3K', '5k': '5K', '10k': '10K', half: 'Half marathon', marathon: 'Marathon' };

export const GOALS = [
  { id: 'start', label: 'Start running consistently', family: 'base', distanceM: null, race: false },
  { id: 'run30', label: 'Run continuously for 30 minutes', family: 'base', distanceM: null, race: false },
  { id: '5k-complete', label: 'Complete a 5K', family: 'short', distanceM: 5000, race: true, orientation: 'complete' },
  { id: '5k-improve', label: 'Improve 5K time', family: 'short', distanceM: 5000, race: true, orientation: 'performance' },
  { id: '10k-complete', label: 'Complete a 10K', family: 'mid', distanceM: 10000, race: true, orientation: 'complete' },
  { id: '10k-improve', label: 'Improve 10K time', family: 'mid', distanceM: 10000, race: true, orientation: 'performance' },
  { id: 'half-complete', label: 'Complete a half marathon', family: 'long', distanceM: 21097.5, race: true, orientation: 'complete' },
  { id: 'half-improve', label: 'Improve half-marathon time', family: 'long', distanceM: 21097.5, race: true, orientation: 'performance' },
  { id: 'marathon-complete', label: 'Complete a marathon', family: 'mar', distanceM: 42195, race: true, orientation: 'complete' },
  { id: 'marathon-improve', label: 'Improve marathon time', family: 'mar', distanceM: 42195, race: true, orientation: 'performance' },
  { id: 'fitness', label: 'Improve general cardiovascular fitness', family: 'mid', distanceM: null, race: false },
  { id: 'mileage', label: 'Increase weekly running mileage', family: 'long', distanceM: null, race: false },
  { id: 'speed', label: 'Improve running speed', family: 'short', distanceM: 5000, race: false },
  { id: 'custom', label: 'Run a custom distance', family: null, distanceM: null, race: true },
];

export function goalInfo(goal) {
  const g = GOALS.find((x) => x.id === goal.type) || GOALS[0];
  const distanceM = goal.type === 'custom' ? goal.distanceM : g.distanceM ?? goal.distanceM ?? null;
  let family = g.family;
  if (goal.type === 'custom') {
    const d = distanceM || 5000;
    family = d <= 6000 ? 'short' : d <= 12000 ? 'mid' : d <= 30000 ? 'long' : 'mar';
  }
  const orientation = goal.orientation || g.orientation || (goal.targetTimeSec ? 'performance' : 'complete');
  return { ...g, distanceM, family, orientation };
}

export const DEFAULT_EASY = { beginner: 450, returning: 420, recreational: 400, intermediate: 345, advanced: 300 };

/** Best current VDOT from dated benchmarks with a recency penalty. */
export function bestVdot(benchmarks = [], today) {
  let best = null;
  for (const b of benchmarks) {
    const d = BENCHMARK_DIST[b.dist] || b.distanceM;
    if (!d || !b.timeSec) continue;
    let v = vdotFromRace(d, b.timeSec);
    if (!v || v < 15 || v > 90) continue;
    let ageDays = b.date && today ? Math.max(0, diffDays(b.date, today)) : 60;
    // performances older than ~2 months lose ~0.5 VDOT per month (capped)
    const penalty = Math.min(5, Math.max(0, (ageDays - 60) / 30) * 0.5);
    v -= penalty;
    if (!best || v > best.vdot) best = { vdot: v, source: b, ageDays };
  }
  return best;
}

export function evaluateFitness(inputs, today) {
  const f = inputs.fitness || {};
  const exp = f.experience || 'beginner';
  const best = bestVdot(f.benchmarks, today);
  let vdot = inputs.vdotOverride || best?.vdot || null;
  let confidence = 'none';
  if (inputs.vdotOverride) confidence = 'high';
  else if (best) confidence = best.ageDays <= 120 ? 'high' : 'medium';

  let paces = vdot ? trainingPaces(vdot) : null;
  if (!paces && f.easyPace) {
    // Only an easy pace is known: give easy-type ranges, everything else stays effort-based.
    const e = f.easyPace;
    paces = { easy: [e - 10, e + 20], long: [e - 5, e + 25], recovery: [e + 20, e + 45] };
    confidence = 'low';
  }
  const assumedEasy = paces?.easy ? (paces.easy[0] + paces.easy[1]) / 2 : DEFAULT_EASY[exp] || 420;
  const weeklyDist = f.frequency === 0 ? 0 : f.weeklyDist || 0;
  const continuousMin = f.longestContinuousMin ?? (f.longestRun ? (f.longestRun / 1000) * assumedEasy / 60 : 0);
  const newRunner = (exp === 'beginner' || f.frequency === 0 || weeklyDist < 3000) && continuousMin < 20;
  return { vdot, confidence, paces, assumedEasy, weeklyDist, longestRun: f.longestRun || 0, continuousMin, newRunner, experience: exp, benchmark: best?.source || null };
}

const MAX_GAIN_PER_WEEK = { beginner: 0.35, returning: 0.35, recreational: 0.25, intermediate: 0.18, advanced: 0.12 };
export const PEAK_LONG = { short: 10000, mid: 16000, long: 21000, mar: 32000, base: 6000 };
export const NEEDED_LONG = { short: 6000, mid: 12000, long: 18000, mar: 29000, base: 4000 };
export const MIN_WEEKS = { short: 4, mid: 6, long: 8, mar: 12, base: 6 };
export const TAPER_WEEKS = { short: 1, mid: 1, long: 2, mar: 3, base: 0 };

export function longRunIncrement(progression, newRunner) {
  const inc = { gradual: 1000, moderate: 1600, aggressive: 2400 }[progression || 'moderate'];
  return newRunner ? inc * 0.75 : inc;
}

/** Number of run-walk ladder weeks needed to reach 30 min continuous. */
export function ladderWeeksNeeded(continuousMin, progression) {
  const lvl = ladderStartLevel(continuousMin);
  const levels = LADDER.length - lvl;
  return progression === 'gradual' ? Math.ceil(levels * 1.5) : levels;
}

export const LADDER = [
  { run: 60, walk: 90, reps: 8 },
  { run: 90, walk: 120, reps: 6 },
  { run: 120, walk: 90, reps: 6 },
  { run: 180, walk: 90, reps: 5 },
  { run: 300, walk: 150, reps: 3 },
  { run: 480, walk: 180, reps: 2 },
  { run: 600, walk: 120, reps: 2 },
  { run: 1200, walk: 0, reps: 1 },
  { run: 1500, walk: 0, reps: 1 },
  { run: 1800, walk: 0, reps: 1 },
];

export function ladderStartLevel(continuousMin = 0) {
  let lvl = 0;
  LADDER.forEach((l, i) => { if (l.run / 60 <= continuousMin) lvl = i; });
  return lvl;
}

/** Minimum sensible plan length (weeks) for this athlete and goal. */
export function recommendedWeeks(inputs, fitness) {
  const g = goalInfo(inputs.goal);
  const fam = g.family;
  const prog = inputs.prefs?.progression || 'moderate';
  let weeks = 0;
  if (fitness.newRunner) weeks += ladderWeeksNeeded(fitness.continuousMin, prog);
  if (fam === 'base') return Math.max(weeks, MIN_WEEKS.base);
  const startLong = fitness.newRunner ? 5000 : Math.max(fitness.longestRun, 3000);
  const need = Math.max(0, NEEDED_LONG[fam] - startLong);
  const inc = longRunIncrement(prog, fitness.newRunner);
  weeks += Math.ceil((need / inc) * (4 / 3));
  weeks += TAPER_WEEKS[fam];
  return Math.max(weeks, MIN_WEEKS[fam] + (fitness.newRunner ? 2 : 0));
}

/**
 * Goal realism check. Returns { level: 'ok'|'caution'|'aggressive', messages[], recommendedWeeks, recommendedDate, achievableTimeSec, predictedTimeSec }
 */
export function checkGoal(inputs, fitness, today) {
  const g = goalInfo(inputs.goal);
  const out = { level: 'ok', messages: [], recommendedWeeks: recommendedWeeks(inputs, fitness), recommendedDate: null, achievableTimeSec: null, predictedTimeSec: null };
  const start = inputs.startDate || today;
  const raceDate = inputs.goal.raceDate;
  const weeks = raceDate ? Math.floor(diffDays(startOfWeek(start), raceDate) / 7) + 1 : out.recommendedWeeks;
  out.weeks = weeks;
  const days = inputs.availability?.daysPerWeek || 3;
  const flag = (level, msg) => {
    out.messages.push({ level, msg });
    if (level === 'aggressive' || (level === 'caution' && out.level === 'ok')) out.level = level;
  };

  if (raceDate && diffDays(start, raceDate) < 7) flag('aggressive', 'Your race date is less than a week away — there is not enough time to build fitness. The plan will focus on staying fresh.');
  else if (raceDate && weeks < out.recommendedWeeks) {
    const short = out.recommendedWeeks - weeks;
    const sev = short >= Math.max(3, out.recommendedWeeks * 0.25) ? 'aggressive' : 'caution';
    out.recommendedDate = addDays(startOfWeek(start), out.recommendedWeeks * 7 - 1);
    flag(sev, `Based on your current long run (${fitness.longestRun ? (fitness.longestRun / 1000).toFixed(1) + ' km' : 'none yet'}) and weekly volume, about ${out.recommendedWeeks} weeks is recommended to prepare safely for ${g.label.toLowerCase().replace('complete a ', 'a ').replace('improve ', '')}. You have ${weeks}. ` +
      (sev === 'aggressive' ? 'Ramping faster than this raises injury risk — consider a later race or a shorter distance first.' : 'The plan will be compressed; expect a slightly lower peak long run.'));
  }

  if (g.family === 'mar' && days < 4) flag('caution', 'Marathon training on fewer than 4 days per week is possible for completion, but 4–5 days gives a much better result.');
  if (g.family === 'long' && days < 3) flag('caution', 'Half-marathon plans work best with at least 3 runs per week.');
  if (fitness.newRunner && (g.family === 'mar' || g.family === 'long')) flag('aggressive', 'You are starting from little or no running. Build to a 5K or 10K first — most coaches recommend a year of consistent running before a marathon.');

  const weekendMin = inputs.availability?.weekendMin || 90;
  const longMin = (PEAK_LONG[g.family] || 8000) / 1000 * fitness.assumedEasy / 60;
  if (g.family && g.family !== 'base' && longMin > weekendMin * 1.1 && g.family !== 'short') {
    flag('caution', `Your long runs may need ~${Math.round(Math.min(longMin, 210))} minutes at peak, but you have ${weekendMin} minutes on long-run days. Long runs will be capped to fit, which limits peak endurance.`);
  }

  if (g.distanceM && fitness.vdot) {
    out.predictedTimeSec = predictTime(fitness.vdot, g.distanceM);
    if (inputs.goal.targetTimeSec) {
      const target = vdotFromRace(g.distanceM, inputs.goal.targetTimeSec);
      const gap = target - fitness.vdot;
      const perWeek = MAX_GAIN_PER_WEEK[fitness.experience] || 0.2;
      const maxGain = Math.min(6, perWeek * Math.max(1, weeks - TAPER_WEEKS[g.family]));
      out.achievableTimeSec = predictTime(fitness.vdot + maxGain, g.distanceM);
      if (gap > maxGain) {
        const needWeeks = Math.ceil(gap / perWeek) + TAPER_WEEKS[g.family];
        flag('aggressive', `Your target needs a fitness jump of about ${gap.toFixed(1)} VDOT points. In ${weeks} weeks a realistic improvement is about ${maxGain.toFixed(1)}. ` +
          (needWeeks <= 40 && gap <= 6 ? `Allow roughly ${needWeeks} weeks, or aim for the achievable time shown.` : 'Consider a staged goal — this target is likely a multi-season project.'));
        out.targetTooFast = true;
      } else if (gap > maxGain * 0.7) flag('caution', 'Your target time is ambitious but possible with consistent training.');
      else if (gap < -1) flag('ok', 'Your target time looks conservative compared with your current fitness — consider a faster goal.');
    }
  } else if (inputs.goal.targetTimeSec && !fitness.vdot) {
    flag('caution', 'Without a recent race or time trial, the target time cannot be checked yet. The plan includes an early time trial to set accurate paces.');
  }

  if (inputs.injury?.painNow) flag('aggressive', 'You reported current pain. Please get it evaluated by a medical professional before increasing training. The plan holds volume steady and removes hard sessions until you update this.');
  return out;
}
