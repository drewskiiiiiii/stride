// Workout builders. Each returns a structured workout (steps with repeat blocks).
// Pure and deterministic: same ctx in → same workout out.

import { zonePace } from './workout-utils.js';

const MI = 1609.344;

export function roundDist(m, unit = 'km', min = 1) {
  const stepM = unit === 'mi' ? MI / 2 : 500;
  return Math.max(min * stepM, Math.round(m / stepM) * stepM);
}
export function roundMin(sec, to = 5) {
  const m = sec / 60;
  const r = m < 20 ? Math.max(5, Math.round(m)) : Math.round(m / to) * to;
  return r * 60;
}

const runStep = (ctx, kind, label, zone, dist, timeSec) => {
  if (ctx.pref === 'time' || dist == null) {
    const t = timeSec ?? roundMin((dist / 1000) * zonePace(zone, ctx.paces, ctx.assumedEasy));
    return { kind, label, measure: 'time', value: t, zone };
  }
  return { kind, label, measure: 'distance', value: roundDist(dist, ctx.unit), zone };
};

const warmup = (ctx, min) => ({
  kind: 'warmup', label: 'Warm-up', measure: 'time', value: (min ?? (['beginner', 'returning'].includes(ctx.experience) ? 8 : 10)) * 60, zone: 'easy',
  cue: 'Start very easy and let your breathing settle.',
});
const cooldown = (ctx, min) => ({ kind: 'cooldown', label: 'Cool-down', measure: 'time', value: (min ?? 10) * 60, zone: 'easy', cue: 'Easy jog, then walk to finish.' });
const stridesBlock = (n = 4) => ({
  repeat: n, dropLastRecovery: true,
  steps: [
    { kind: 'work', label: 'Stride', measure: 'time', value: 20, zone: 'stride', cue: 'Accelerate smoothly to fast, relaxed form.' },
    { kind: 'recover', label: 'Walk / jog back', measure: 'time', value: 60, zone: 'walk' },
  ],
});

export function easyRun(ctx, dist, { strides = 0 } = {}) {
  const steps = [runStep(ctx, 'steady', 'Easy running', 'easy', dist)];
  if (strides) steps.push(stridesBlock(strides));
  return {
    type: 'easy',
    title: strides ? 'Easy Run + Strides' : 'Easy Run',
    purpose: 'Builds your aerobic engine, capillaries and durability at low stress. Most of your running lives here.',
    steps,
    tips: [
      'Keep it conversational — if you cannot speak in full sentences, slow down.',
      strides ? 'Strides are short, smooth accelerations — not sprints. Full recovery between each.' : 'Walking breaks are fine if your heart rate drifts up on hills.',
      'Easy days make hard days possible. Resist the urge to push the pace.',
    ],
  };
}

export function recoveryRun(ctx, dist) {
  return {
    type: 'recovery', title: 'Recovery Run',
    purpose: 'Promotes blood flow and recovery after a demanding session while adding gentle volume.',
    steps: [runStep(ctx, 'steady', 'Recovery jog', 'recovery', dist)],
    tips: ['Slower than feels natural — this run should leave you fresher than when you started.', 'Skip it and rest if your legs feel heavy or sore.'],
  };
}

export function longRun(ctx, dist, variant = 'easy') {
  const tips = ['Practise your race-day fuelling and hydration on runs over 75 minutes.', 'Start slower than you think — the second half should feel controlled.'];
  let steps, title = 'Long Run', purpose = 'Extends endurance, strengthens muscles and connective tissue, and builds mental confidence for the distance.';
  let quality = false;
  if (variant === 'progressive' && dist > 8000) {
    const fast = dist * 0.2;
    steps = [runStep(ctx, 'steady', 'Long run — easy', 'long', dist - fast), runStep(ctx, 'work', 'Progress to steady', 'steady', fast)];
    title = 'Progression Long Run';
    purpose += ' The steady finish teaches you to run strong on tired legs.';
  } else if (variant === 'marathon' && dist > 16000) {
    const mp = Math.min(dist * 0.4, 16000);
    steps = [runStep(ctx, 'steady', 'Long run — easy', 'long', dist - mp), runStep(ctx, 'work', 'Marathon-pace segment', 'marathon', mp)];
    title = 'Long Run with Marathon Pace';
    purpose = 'Race-specific endurance: rehearses goal pace, fuelling and focus on fatigued legs.';
    tips.unshift('Hold goal pace with discipline — do not run the marathon-pace segment faster than planned.');
    quality = true;
  } else if (variant === 'half' && dist > 12000) {
    const hp = Math.min(dist * 0.3, 8000);
    steps = [runStep(ctx, 'steady', 'Long run — easy', 'long', dist - hp), runStep(ctx, 'work', 'Half-marathon-pace finish', 'half', hp)];
    title = 'Long Run with Fast Finish';
    purpose = 'Race-specific endurance: finishing at goal half-marathon pace on tired legs.';
    quality = true;
  } else {
    steps = [runStep(ctx, 'steady', 'Long run', 'long', dist)];
  }
  return { type: 'long', title, purpose, steps, tips, key: true, quality };
}

export function tempoRun(ctx, workMin, zone = 'tempo') {
  const t = Math.max(10, Math.round(workMin)) * 60;
  return {
    type: 'tempo', title: `${Math.round(t / 60)}-min ${zone === 'threshold' ? 'Threshold' : 'Tempo'} Run`,
    purpose: 'Raises your lactate threshold — the pace you can sustain before fatigue rapidly accumulates.',
    steps: [warmup(ctx), { kind: 'work', label: zone === 'threshold' ? 'Threshold' : 'Tempo', measure: 'time', value: t, zone, cue: 'Comfortably hard and even. Settle into rhythm.' }, cooldown(ctx)],
    tips: ['Aim for even effort, not a fast start.', 'Breathing should be controlled — about three steps in, three out.', 'On hills, hold effort rather than pace.'],
    key: true,
  };
}

export function cruiseIntervals(ctx, reps, repMin, recSec = 60) {
  return {
    type: 'threshold', title: `${reps} × ${repMin} min Threshold`,
    purpose: 'Accumulates more time at threshold than a continuous tempo, with short jogs to keep quality high.',
    steps: [
      warmup(ctx, 12),
      { repeat: reps, dropLastRecovery: true, steps: [
        { kind: 'work', label: 'Threshold', measure: 'time', value: repMin * 60, zone: 'threshold', cue: 'Strong, steady and controlled.' },
        { kind: 'recover', label: 'Easy jog', measure: 'time', value: recSec, zone: 'recovery' },
      ] },
      cooldown(ctx),
    ],
    tips: ['Each rep should feel the same — the last should not be a sprint.', 'Keep jogging during recoveries.'],
    key: true,
  };
}

function repLabel(m) {
  if (Math.abs(m - MI) < 5) return '1 mi';
  if (m >= 1000 && m % 1000 === 0) return `${m / 1000} km`;
  return `${m}m`;
}

export function intervals(ctx, repDist, reps, zone = 'interval', recSec = 120) {
  const useDistance = ctx.track || ctx.pref === 'distance';
  const repSec = Math.round(((repDist / 1000) * zonePace(zone, ctx.paces, ctx.assumedEasy)) / 15) * 15;
  const work = useDistance
    ? { kind: 'work', label: `${repLabel(repDist)} rep`, measure: 'distance', value: repDist, zone, cue: 'Controlled and quick. Run the rep, do not race it.' }
    : { kind: 'work', label: `${Math.round(repSec / 60 * 10) / 10}-min rep`, measure: 'time', value: Math.max(60, repSec), zone, cue: 'Controlled and quick.' };
  const label = useDistance ? `${reps} × ${repLabel(repDist)}` : `${reps} × ${fmtShortMin(work.value)}`;
  return {
    type: 'intervals', title: `${label} Intervals`,
    purpose: zone === 'interval'
      ? 'Develops VO₂max — your maximum aerobic capacity — and running economy at speed.'
      : `Race-specific intervals at ${zone.toUpperCase()} pace to lock in goal rhythm and efficiency.`,
    steps: [
      warmup(ctx, 15),
      stridesBlock(3),
      { repeat: reps, dropLastRecovery: true, steps: [work, { kind: 'recover', label: 'Recovery jog', measure: 'time', value: recSec, zone: 'recovery', cue: 'Jog easily, let your breathing recover.' }] },
      cooldown(ctx),
    ],
    tips: ['Even splits beat a fast first rep.', 'If you cannot hit the pace by the final reps, stop early — quality over quantity.', ctx.track ? 'On a track, run in lane 1; 400m per lap.' : 'Use a flat, uninterrupted route for consistent reps.'],
    key: true,
  };
}

function fmtShortMin(sec) {
  return sec % 60 === 0 ? `${sec / 60} min` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function speedReps(ctx, repDist, reps) {
  const useDistance = ctx.track || ctx.pref === 'distance';
  const repSec = Math.round(((repDist / 1000) * zonePace('rep', ctx.paces, ctx.assumedEasy)) / 5) * 5;
  const work = useDistance
    ? { kind: 'work', label: `${repDist}m fast`, measure: 'distance', value: repDist, zone: 'rep', cue: 'Fast, tall and relaxed.' }
    : { kind: 'work', label: `${repSec}s fast`, measure: 'time', value: repSec, zone: 'rep', cue: 'Fast, tall and relaxed.' };
  return {
    type: 'reps', title: `${reps} × ${useDistance ? repDist + 'm' : repSec + 's'} Speed Reps`,
    purpose: 'Improves leg speed, form and running economy with full recovery between fast efforts.',
    steps: [warmup(ctx, 15), { repeat: reps, dropLastRecovery: true, steps: [work, { kind: 'recover', label: 'Walk / jog', measure: 'time', value: Math.max(60, repSec * 2), zone: 'walk' }] }, cooldown(ctx)],
    tips: ['Full recovery — these are about speed and form, not fatigue.', 'Relax your face and shoulders at speed.'],
    key: true,
  };
}

export function fartlek(ctx, reps, onSec, offSec) {
  return {
    type: 'fartlek', title: `Fartlek ${reps} × ${fmtShortMin(onSec)} / ${fmtShortMin(offSec)}`,
    purpose: 'Unstructured speed play that builds comfort with changing paces and introduces faster running gently.',
    steps: [warmup(ctx), { repeat: reps, dropLastRecovery: false, steps: [
      { kind: 'work', label: 'Surge', measure: 'time', value: onSec, zone: 'fartlekOn', cue: 'Pick it up — strong but controlled.' },
      { kind: 'recover', label: 'Float', measure: 'time', value: offSec, zone: 'easy', cue: 'Ease back to easy running, keep moving.' },
    ] }, cooldown(ctx)],
    tips: ['Run surges by feel — around 10K effort.', 'Float recoveries are easy running, not walking.'],
    key: true,
  };
}

export function hills(ctx, reps, sec) {
  sec = Math.max(30, Math.round(sec / 15) * 15);
  return {
    type: 'hills', title: `${reps} × ${sec}s Hill Repeats`,
    purpose: 'Builds leg strength, power and form — speed work in disguise with lower impact.',
    steps: [warmup(ctx, 12), { repeat: reps, dropLastRecovery: true, steps: [
      { kind: 'work', label: 'Uphill', measure: 'time', value: sec, zone: 'hill', cue: 'Drive the knees, short quick steps, tall posture.' },
      { kind: 'recover', label: 'Jog down', measure: 'time', value: Math.round(sec * 1.6 / 15) * 15, zone: 'recovery', cue: 'Easy jog back down to the start.' },
    ] }, cooldown(ctx)],
    tips: [ctx.treadmill && !ctx.outdoors ? 'Treadmill: set 5–7 % incline for the reps and 1 % for recoveries.' : 'Pick a moderate hill (4–8 % gradient).', 'Effort matters more than pace on hills.', 'Jog down gently to protect your quads.'],
    key: true,
  };
}

export function timeTrial(ctx, distM, label) {
  return {
    type: 'timetrial', title: `${label} Time Trial`,
    purpose: 'Measures your current fitness so pace targets stay accurate. Results update your training paces.',
    steps: [
      warmup(ctx, 12), stridesBlock(4),
      { kind: 'work', label: `${label} — best effort`, measure: 'distance', value: distM, zone: 'race', cue: 'Even effort. Start controlled, finish strong.' },
      cooldown(ctx),
    ],
    tips: ['Choose a flat route or a track.', 'Run the first third slightly conservatively.', 'Log the exact time — the app recalculates your paces.'],
    key: true, benchmark: { distanceM: distM },
  };
}

export function race(ctx, distM, label, targetSec) {
  return {
    type: 'race', title: `Race Day — ${label}`,
    purpose: 'Goal race. Everything in the plan has been building to this. Trust the training.',
    steps: [
      { kind: 'warmup', label: 'Warm-up jog', measure: 'time', value: distM > 21000 ? 300 : 600, zone: 'easy' },
      { kind: 'work', label: label, measure: 'distance', value: distM, zone: 'race', cue: 'Start controlled. Settle in. Race the final third.' },
    ],
    tips: ['Nothing new on race day — shoes, food and kit should all be tested.', 'Start at or slightly slower than goal pace.', distM > 21000 ? 'Fuel early and regularly (every 30–45 min).' : 'Arrive early enough for a relaxed warm-up.'],
    key: true, targetSec, benchmark: { distanceM: distM },
  };
}

export function runWalk(ctx, runSec, walkSec, reps) {
  const continuous = walkSec === 0 || reps === 1;
  const steps = continuous
    ? [{ kind: 'walk', label: 'Brisk walk', measure: 'time', value: 300, zone: 'walk' },
      { kind: 'steady', label: 'Continuous easy run', measure: 'time', value: runSec * reps, zone: 'easy', cue: 'Slow and steady — this is your goal pace for now.' },
      { kind: 'cooldown', label: 'Walk', measure: 'time', value: 300, zone: 'walk' }]
    : [{ kind: 'walk', label: 'Brisk walk warm-up', measure: 'time', value: 300, zone: 'walk' },
      { repeat: reps, dropLastRecovery: true, steps: [
        { kind: 'work', label: 'Run', measure: 'time', value: runSec, zone: 'easy', cue: 'Gentle, conversational jog.' },
        { kind: 'recover', label: 'Walk', measure: 'time', value: walkSec, zone: 'walk', cue: 'Brisk walk, recover your breathing.' },
      ] },
      { kind: 'cooldown', label: 'Walk cool-down', measure: 'time', value: 300, zone: 'walk' }];
  return {
    type: 'runwalk',
    title: continuous ? `${Math.round((runSec * reps) / 60)}-min Continuous Run` : `Run ${fmtShortMin(runSec)} / Walk ${fmtShortMin(walkSec)} × ${reps}`,
    purpose: continuous ? 'Your goal: run without stopping. Go slow enough that you could chat.' : 'Run–walk intervals build running fitness while giving your body time to adapt. Consistency beats speed.',
    steps,
    tips: ['There is no pace that is too slow — finishing is the goal.', 'If a session felt very hard, repeat it before moving on.', 'Breathe through your mouth and nose; relax your shoulders.'],
  };
}

export function assessmentWorkout(kind, ctx) {
  if (kind === 'mile') return { ...timeTrial(ctx, MI, '1-mile'), type: 'assessment', title: 'Fitness Assessment — 1 Mile' };
  if (kind === '5k') return { ...timeTrial(ctx, 5000, '5K'), type: 'assessment', title: 'Fitness Assessment — 5K' };
  if (kind === 'threshold') {
    return {
      type: 'assessment', title: 'Threshold Assessment — 30 min',
      purpose: 'A controlled 30-minute effort at the hardest pace you could hold for about an hour. Your average pace estimates your lactate threshold and recalibrates every zone — less taxing than an all-out race.',
      steps: [warmup(ctx, 15), stridesBlock(3),
        { kind: 'work', label: '30-min threshold effort', measure: 'time', value: 1800, zone: 'threshold', cue: 'Strong and even. Do not race the first 10 minutes.' },
        cooldown(ctx)],
      tips: ['Flat route, GPS on (or a treadmill with the distance noted).', 'Aim for an effort you could sustain for 50–60 minutes — not a race.', 'Log the distance you covered in the 30 minutes.'],
      key: true, benchmark: { kind: 'threshold', durationSec: 1800 },
    };
  }
  // gentle test for new runners: 20 minutes, record how long you could run continuously
  return {
    type: 'assessment', title: 'Fitness Assessment — 20-min Run/Walk',
    purpose: 'A gentle test to find your starting point. Run at a conversational pace and walk whenever you need to.',
    steps: [{ kind: 'walk', label: 'Brisk walk', measure: 'time', value: 300, zone: 'walk' },
      { kind: 'steady', label: 'Run as long as comfortable — walk when needed', measure: 'time', value: 1200, zone: 'easy' },
      { kind: 'cooldown', label: 'Walk', measure: 'time', value: 300, zone: 'walk' }],
    tips: ['Note the longest stretch you ran without walking.', 'Keep the effort easy — this is not a race.'],
    key: true, benchmark: { kind: 'gentle' },
  };
}

export function restDay(reason) {
  return {
    type: 'rest', title: 'Rest Day',
    purpose: reason || 'Adaptation happens during recovery. Rest lets your muscles, tendons and energy systems absorb the training.',
    steps: [], tips: ['Light walking, stretching or mobility is fine.', 'Prioritise sleep and hydration.', 'Feeling great? Still rest — it protects the next hard session.'],
  };
}
