// Running performance model based on the Daniels–Gilbert oxygen-cost equations (VDOT).
// Pure functions — no DOM, no storage — so they can be unit-tested in Node.

/** Oxygen cost (ml/kg/min) of running at v metres/minute. */
export function vo2AtVelocity(v) {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max sustainable for a race lasting t minutes. */
export function fractionForDuration(tMin) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

/** VDOT from a race performance. */
export function vdotFromRace(distanceM, timeSec) {
  if (!distanceM || !timeSec) return null;
  const tMin = timeSec / 60;
  const v = distanceM / tMin;
  return vo2AtVelocity(v) / fractionForDuration(tMin);
}

/** Velocity (m/min) at which oxygen cost equals vo2. */
export function velocityForVo2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Predicted race time (s) for distance at a given VDOT, by bisection. */
export function predictTime(vdot, distanceM) {
  let lo = distanceM / 1000 * 120; // 2:00/km
  let hi = distanceM / 1000 * 1200; // 20:00/km
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = vdotFromRace(distanceM, mid);
    if (v > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** sec/km for a fraction of VDOT */
function paceAtFraction(vdot, f) {
  const v = velocityForVo2(vdot * f);
  return 60000 / v; // seconds per km
}

function racePace(vdot, distanceM) {
  return predictTime(vdot, distanceM) / (distanceM / 1000);
}

/**
 * Training pace zones. Each zone is [fast, slow] in sec/km.
 */
export function trainingPaces(vdot) {
  if (!vdot) return null;
  const M = racePace(vdot, 42195);
  const H = racePace(vdot, 21097.5);
  const T10 = racePace(vdot, 10000);
  const T5 = racePace(vdot, 5000);
  const mile = racePace(vdot, 1609.344);
  const I = paceAtFraction(vdot, 0.975);
  return {
    recovery: [paceAtFraction(vdot, 0.6), paceAtFraction(vdot, 0.55)],
    easy: [paceAtFraction(vdot, 0.7), paceAtFraction(vdot, 0.62)],
    long: [paceAtFraction(vdot, 0.71), paceAtFraction(vdot, 0.63)],
    steady: [M + 8, M + 25],
    marathon: [M - 3, M + 3],
    half: [H - 3, H + 3],
    tempo: [paceAtFraction(vdot, 0.86), paceAtFraction(vdot, 0.83)],
    threshold: [paceAtFraction(vdot, 0.89), paceAtFraction(vdot, 0.86)],
    '10k': [T10 - 3, T10 + 3],
    '5k': [T5 - 3, T5 + 3],
    interval: [I - 4, I + 4],
    rep: [Math.min(mile, I - 14) - 3, Math.min(mile, I - 14) + 3],
  };
}

export const ZONE_INFO = {
  walk: { name: 'Walk', rpe: '1–2', hr: [50, 60], effort: 'Brisk, relaxed walk' },
  recovery: { name: 'Recovery', rpe: '2–3', hr: [60, 68], effort: 'Very easy — slower than feels natural' },
  easy: { name: 'Easy', rpe: '3–4', hr: [65, 78], effort: 'Conversational — you can speak in full sentences' },
  long: { name: 'Long run', rpe: '3–5', hr: [65, 78], effort: 'Comfortable and sustainable, conversational' },
  steady: { name: 'Steady', rpe: '5–6', hr: [78, 84], effort: 'Comfortably firm — short sentences only' },
  marathon: { name: 'Marathon pace', rpe: '6', hr: [80, 86], effort: 'Goal marathon effort — controlled, rhythmic' },
  half: { name: 'Half-marathon pace', rpe: '7', hr: [84, 89], effort: 'Goal half-marathon effort — strong but controlled' },
  tempo: { name: 'Tempo', rpe: '6–7', hr: [84, 88], effort: 'Comfortably hard — a few words at a time' },
  threshold: { name: 'Threshold', rpe: '7–8', hr: [88, 92], effort: 'Hard but steady — you could hold it for about an hour in a race' },
  '10k': { name: '10K pace', rpe: '8', hr: [90, 95], effort: '10K race effort' },
  '5k': { name: '5K pace', rpe: '8–9', hr: [93, 98], effort: '5K race effort — hard, controlled breathing' },
  interval: { name: 'Interval', rpe: '8–9', hr: [95, 100], effort: 'Hard — about 3K–5K race effort' },
  rep: { name: 'Repetition', rpe: '9', hr: null, effort: 'Fast and relaxed — mile race effort with good form' },
  hill: { name: 'Hill effort', rpe: '8–9', hr: null, effort: 'Strong uphill drive, tall posture, quick arms' },
  stride: { name: 'Stride', rpe: '7–8', hr: null, effort: 'Smooth acceleration to fast, never a sprint' },
  race: { name: 'Race', rpe: '9–10', hr: null, effort: 'Race effort' },
  fartlekOn: { name: 'Surge', rpe: '7–8', hr: [85, 92], effort: 'Faster — around 10K effort' },
};

export function maxHrEstimate(age) {
  // Tanaka et al. (2001): 208 − 0.7 × age
  return Math.round(208 - 0.7 * (age || 35));
}

export function hrRange(zone, maxHr) {
  const z = ZONE_INFO[zone];
  if (!z || !z.hr || !maxHr) return null;
  return [Math.round((z.hr[0] / 100) * maxHr), Math.round((z.hr[1] / 100) * maxHr)];
}

/** VDOT from a typical *easy* pace (sec/km). Used only for estimates, flagged low confidence. */
export function vdotFromEasyPace(secPerKm) {
  // Easy pace ≈ midpoint of 62–70 % → ~66 % of VDOT
  const v = 60000 / secPerKm;
  return vo2AtVelocity(v) / 0.66;
}
