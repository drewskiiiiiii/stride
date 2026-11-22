// Helpers shared by the generator, the UI and the timer. Pure.

const ASSUMED_FACTOR = {
  walk: null, recovery: 1.08, easy: 1, long: 1, steady: 0.9, marathon: 0.87, half: 0.84,
  tempo: 0.84, threshold: 0.81, '10k': 0.8, '5k': 0.77, interval: 0.75, rep: 0.71,
  hill: 0.85, stride: 0.72, fartlekOn: 0.8, race: 0.8,
};
const WALK_PACE = 600; // 10:00 /km

/** Representative pace (sec/km) for a zone, using real paces if known, else an assumption. */
export function zonePace(zone, paces, assumedEasy = 420) {
  if (!zone) return assumedEasy;
  if (zone === 'walk') return WALK_PACE;
  if (paces && paces[zone]) return (paces[zone][0] + paces[zone][1]) / 2;
  if (paces && zone === 'hill') return paces.interval ? paces.interval[1] * 1.12 : assumedEasy * 0.85;
  if (paces && zone === 'stride') return paces.rep ? paces.rep[0] : assumedEasy * 0.72;
  if (paces && zone === 'fartlekOn') return paces['10k'] ? paces['10k'][1] : assumedEasy * 0.8;
  if (paces && paces.easy && ASSUMED_FACTOR[zone]) {
    const easyMid = (paces.easy[0] + paces.easy[1]) / 2;
    return easyMid * ASSUMED_FACTOR[zone];
  }
  return assumedEasy * (ASSUMED_FACTOR[zone] || 1);
}

/** Expand repeat blocks into a flat list of steps. */
export function flattenSteps(steps) {
  const out = [];
  for (const s of steps || []) {
    if (s.repeat) {
      for (let r = 1; r <= s.repeat; r++) {
        s.steps.forEach((inner, j) => {
          // the recovery after the final rep is dropped when flagged
          if (s.dropLastRecovery && r === s.repeat && j === s.steps.length - 1 && inner.kind === 'recover') return;
          out.push({ ...inner, rep: r, reps: s.repeat });
        });
      }
    } else out.push({ ...s });
  }
  return out.map((s, i) => ({ ...s, idx: i }));
}

export function stepDuration(step, paces, assumedEasy) {
  if (step.measure === 'time') return step.value || 0;
  if (step.measure === 'distance') return (step.value / 1000) * zonePace(step.zone, paces, assumedEasy);
  if (step.measure === 'manual') return 40;
  return 0;
}

export function stepDistance(step, paces, assumedEasy) {
  if (step.kind === 'exercise' || step.kind === 'rest') return 0;
  if (step.measure === 'distance') return step.value;
  if (step.measure === 'time') return (step.value / zonePace(step.zone, paces, assumedEasy)) * 1000;
  return 0;
}

export function estimateWorkout(steps, paces, assumedEasy) {
  const flat = flattenSteps(steps);
  let dur = 0, dist = 0;
  for (const s of flat) {
    dur += stepDuration(s, paces, assumedEasy);
    dist += stepDistance(s, paces, assumedEasy);
  }
  return { duration: Math.round(dur), distance: Math.round(dist) };
}

export const HARD_TYPES = new Set(['tempo', 'intervals', 'hills', 'fartlek', 'timetrial', 'race', 'threshold', 'reps', 'assessment']);
export const RUN_TYPES = new Set(['easy', 'long', 'recovery', 'tempo', 'intervals', 'hills', 'fartlek', 'timetrial', 'race', 'threshold', 'reps', 'runwalk', 'custom', 'assessment']);

export function isHard(w) {
  return w && (HARD_TYPES.has(w.type) || (w.type === 'long' && w.quality));
}
export function isRun(w) {
  return w && RUN_TYPES.has(w.type);
}

export const TYPE_META = {
  easy: { label: 'Easy Run', color: 'easy', icon: 'easy' },
  long: { label: 'Long Run', color: 'long', icon: 'long' },
  recovery: { label: 'Recovery Run', color: 'recovery', icon: 'recovery' },
  tempo: { label: 'Tempo Run', color: 'tempo', icon: 'tempo' },
  threshold: { label: 'Threshold', color: 'threshold', icon: 'tempo' },
  intervals: { label: 'Intervals', color: 'interval', icon: 'intervals' },
  reps: { label: 'Speed Reps', color: 'rep', icon: 'intervals' },
  fartlek: { label: 'Fartlek', color: 'tempo', icon: 'fartlek' },
  hills: { label: 'Hill Repeats', color: 'interval', icon: 'hills' },
  timetrial: { label: 'Time Trial', color: 'rep', icon: 'trophy' },
  assessment: { label: 'Fitness Assessment', color: 'rep', icon: 'trophy' },
  race: { label: 'Race Day', color: 'rep', icon: 'trophy' },
  runwalk: { label: 'Run / Walk', color: 'easy', icon: 'easy' },
  strength: { label: 'Strength', color: 'strength', icon: 'strength' },
  mobility: { label: 'Mobility', color: 'mobility', icon: 'mobility' },
  rest: { label: 'Rest Day', color: 'rest', icon: 'rest' },
  custom: { label: 'Custom Run', color: 'easy', icon: 'easy' },
};
