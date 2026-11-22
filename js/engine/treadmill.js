// Treadmill coaching maths: pace ↔ speed conversion, practical rounding,
// per-segment speed recommendations and distance from user-entered speeds.
// Pure functions — unit-tested in Node.

import { zonePace } from './workout-utils.js';

export const M_PER_MI = 1609.344;
export const SPEED_LIMITS = { mph: { min: 0.5, max: 12.5 }, kmh: { min: 0.8, max: 20 } };
const WALK_SPEED = { mph: 3.5, kmh: 5.6 };

/** sec/km → speed in mph or km/h (unrounded). */
export function paceToSpeed(secPerKm, unit = 'mph') {
  if (!secPerKm || secPerKm <= 0) return null;
  const kmh = 3600 / secPerKm;
  return unit === 'mph' ? (kmh * 1000) / M_PER_MI : kmh;
}

/** speed (mph | km/h) → sec/km */
export function speedToPace(speed, unit = 'mph') {
  if (!speed || speed <= 0) return null;
  const kmh = unit === 'mph' ? (speed * M_PER_MI) / 1000 : speed;
  return 3600 / kmh;
}

/** speed → metres per second */
export function speedToMps(speed, unit = 'mph') {
  if (!speed || speed <= 0) return 0;
  return unit === 'mph' ? (speed * M_PER_MI) / 3600 : (speed * 1000) / 3600;
}
export function mpsToSpeed(mps, unit = 'mph') {
  return unit === 'mph' ? (mps * 3600) / M_PER_MI : (mps * 3600) / 1000;
}

/** Round to a practical treadmill increment (default 0.1). */
export function roundSpeed(v, inc = 0.1) {
  if (v == null || !isFinite(v)) return null;
  return Math.round(Math.round(v / inc) * inc * 10) / 10;
}

export function convertSpeed(v, from, to) {
  if (from === to || v == null) return v;
  return from === 'mph' ? (v * M_PER_MI) / 1000 : (v * 1000) / M_PER_MI;
}

/**
 * Recommended treadmill speed for one workout step.
 * Returns { target, low, high, unit, estimated, incline, capped } or null for non-running steps.
 * - A pace range [fast, slow] becomes a speed range [low = slow pace, high = fast pace].
 * - target = midpoint pace converted and rounded.
 * - estimated = true when no personalised pace exists (effort-based plans).
 */
export function stepSpeed(step, { paces = null, assumedEasy = 420, unit = 'mph', inc = 0.1 } = {}) {
  if (!step || ['exercise', 'rest'].includes(step.kind) || !step.zone) return null;
  const lim = SPEED_LIMITS[unit];
  if (step.zone === 'walk') {
    const w = WALK_SPEED[unit];
    return { target: w, low: roundSpeed(w - (unit === 'mph' ? 0.5 : 0.8), inc), high: roundSpeed(w + (unit === 'mph' ? 0.3 : 0.5), inc), unit, estimated: false, incline: 0, walk: true };
  }
  const range = step.targetPace || (paces && paces[step.zone]) || null;
  let fast, slow, estimated = false;
  if (range) { [fast, slow] = range; }
  else { const mid = zonePace(step.zone, paces, assumedEasy); fast = mid * 0.97; slow = mid * 1.03; estimated = true; }
  const mid = (fast + slow) / 2;
  let target = roundSpeed(paceToSpeed(mid, unit), inc);
  let low = roundSpeed(paceToSpeed(slow, unit), inc);
  let high = roundSpeed(paceToSpeed(fast, unit), inc);
  let capped = false;
  if (high > lim.max) { capped = true; high = lim.max; target = Math.min(target, lim.max); low = Math.min(low, lim.max); }
  if (low < lim.min) low = lim.min;
  const incline = step.zone === 'hill' ? 6 : 1; // 1 % approximates outdoor effort; hills use 6 %
  return { target, low, high, unit, estimated, incline, capped };
}

/** Distance (m) covered from a speed log [{at: elapsedMs, mps}] up to elapsed time endMs. */
export function distanceFromLog(log = [], endMs, startMs = 0) {
  let d = 0;
  for (let i = 0; i < log.length; i++) {
    const a = Math.max(log[i].at, startMs);
    const b = Math.min(i + 1 < log.length ? log[i + 1].at : endMs, endMs);
    if (b > a) d += (log[i].mps * (b - a)) / 1000;
  }
  return d;
}

/** Time-weighted average speed (m/s) over [startMs, endMs]. */
export function avgMpsFromLog(log = [], startMs, endMs) {
  const dur = endMs - startMs;
  if (dur <= 0) return 0;
  return distanceFromLog(log, endMs, startMs) / (dur / 1000);
}

export function speedLabel(unit) { return unit === 'mph' ? 'mph' : 'km/h'; }
export function speedWords(unit) { return unit === 'mph' ? 'miles per hour' : 'kilometres per hour'; }
export function fmtSpeed(v) { return v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1); }
export function fmtSpeedRange(s) {
  if (!s) return '';
  return s.low === s.high || Math.abs(s.high - s.low) < 0.15 ? `${fmtSpeed(s.target)} ${speedLabel(s.unit)}` : `${fmtSpeed(s.low)}–${fmtSpeed(s.high)} ${speedLabel(s.unit)}`;
}

/** Is the selected speed within the target band (with a small tolerance)? */
export function speedStatus(selected, rec, tol = 0.05) {
  if (selected == null || !rec) return null;
  if (selected < rec.low - tol) return 'slow';
  if (selected > rec.high + tol) return 'fast';
  return 'on';
}
