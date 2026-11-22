// Timestamp-based workout session state machine.
// The session is a plain serialisable object; every function takes `now` (ms) so the
// clock never depends on setInterval accuracy and the state can be restored after a crash.

import { flattenSteps, zonePace } from '../engine/workout-utils.js';

const EARTH_R = 6371000;
export function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/**
 * Create a session from a workout.
 * opts: { mode: 'gps'|'timer'|'treadmill', paces, assumedEasy, now }
 */
export function createSession(workout, opts) {
  const { mode = 'gps', paces, assumedEasy = 420, now = Date.now() } = opts;
  const flat = flattenSteps(workout.steps && workout.steps.length ? workout.steps : [{ kind: 'steady', label: 'Run', measure: 'time', value: 1800, zone: 'easy' }]);
  const steps = flat.map((s) => {
    const targetPace = s.zone && paces && paces[s.zone] ? paces[s.zone] : null;
    const estPace = zonePace(s.zone, paces, assumedEasy);
    const out = { ...s, targetPace, estPace };
    if (s.measure === 'distance') {
      out.estSec = Math.round((s.value / 1000) * estPace);
      if (mode !== 'gps') { out.measure = 'time'; out.value = out.estSec; out.converted = s.value; }
    }
    return out;
  });
  // number the main efforts ("Interval 3 of 5"); strides are counted separately via rep/reps
  const isMain = (x) => x.kind === 'work' && x.zone !== 'stride';
  const workTotal = steps.filter(isMain).length;
  let wi = 0;
  steps.forEach((x) => { if (isMain(x)) { wi++; x.workIndex = wi; x.workTotal = workTotal; } });
  const totalEst = steps.reduce((a, s) => a + (s.measure === 'time' ? s.value : s.measure === 'distance' ? s.estSec : 45), 0);
  return {
    v: 1, id: `act-${now}`, workoutId: workout.id || null, planId: workout.planId || null, title: workout.title, type: workout.type,
    mode, steps, totalEst, status: 'ready', createdAt: now, startedAt: null, pausedMs: 0, pauseStart: null,
    stepIndex: 0, stepStartElapsed: 0, stepStartDist: 0, distance: 0, lastPoint: null, route: [], laps: [],
    fired: {}, halfwayFired: false, lastSaved: now, gpsStatus: mode === 'gps' ? 'searching' : 'off', paceSamples: [],
  };
}

export const elapsedMs = (s, now) => (s.startedAt == null ? 0 : (s.pauseStart ?? (s.status === 'finished' ? s.finishedAt : now)) - s.startedAt - s.pausedMs);
export const currentStep = (s) => s.steps[s.stepIndex] || null;
export const stepElapsedMs = (s, now) => elapsedMs(s, now) - s.stepStartElapsed;
export const stepDistance = (s) => s.distance - s.stepStartDist;

export function stepRemaining(s, now) {
  const st = currentStep(s);
  if (!st) return null;
  if (st.measure === 'time') return { kind: 'time', value: Math.max(0, st.value - stepElapsedMs(s, now) / 1000), total: st.value };
  if (st.measure === 'distance') return { kind: 'distance', value: Math.max(0, st.value - stepDistance(s)), total: st.value };
  return { kind: 'manual' };
}

export function start(s, now) {
  if (s.status !== 'ready') return [];
  s.status = 'running'; s.startedAt = now;
  return [{ type: 'start', step: currentStep(s) }];
}

export function pause(s, now) {
  if (s.status !== 'running') return [];
  s.status = 'paused'; s.pauseStart = now;
  return [{ type: 'pause' }];
}

export function resume(s, now) {
  if (s.status !== 'paused') return [];
  s.pausedMs += now - s.pauseStart; s.pauseStart = null; s.status = 'running';
  s.lastPoint = null; // do not bridge GPS distance across a pause
  return [{ type: 'resume' }];
}

function closeLap(s, now, { skipped = false, exactMs = null, partial = false } = {}) {
  const st = currentStep(s);
  if (!st) return;
  const durMs = exactMs ?? stepElapsedMs(s, now);
  const dist = stepDistance(s);
  s.laps.push({
    idx: st.idx, label: st.label, kind: st.kind, zone: st.zone, targetPace: st.targetPace, measure: st.measure, value: st.value,
    rep: st.rep, reps: st.reps, duration: Math.round(durMs / 1000), distance: Math.round(dist),
    avgPace: dist > 30 ? (durMs / 1000) / (dist / 1000) : null, skipped, partial, startElapsed: s.stepStartElapsed,
  });
}

function advance(s, now, { skipped = false, exactMs = null } = {}) {
  closeLap(s, now, { skipped, exactMs });
  s.stepStartElapsed = exactMs != null ? s.stepStartElapsed + exactMs : elapsedMs(s, now);
  s.stepStartDist = s.distance;
  s.stepIndex++;
  if (s.stepIndex >= s.steps.length) return finish(s, now, { lapClosed: true });
  return [{ type: 'step', step: currentStep(s), prev: s.steps[s.stepIndex - 1] }];
}

/** Advance automatically when time/distance steps complete. Handles catch-up after backgrounding. */
export function tick(s, now) {
  if (s.status !== 'running') return [];
  const events = [];
  let guard = 0;
  while (s.status === 'running' && guard++ < 500) {
    const st = currentStep(s);
    if (!st) break;
    const se = stepElapsedMs(s, now);
    if (st.measure === 'time' && se >= st.value * 1000) {
      events.push(...advance(s, now, { exactMs: st.value * 1000 }));
      continue;
    }
    if (st.measure === 'distance' && stepDistance(s) >= st.value) {
      events.push(...advance(s, now));
      continue;
    }
    // cues for the current step
    const key = String(s.stepIndex);
    const fired = (s.fired[key] = s.fired[key] || []);
    const next = s.steps[s.stepIndex + 1];
    if (st.measure === 'time') {
      const rem = st.value - se / 1000;
      if (rem <= 10.5 && rem > 0 && st.value >= 25 && !fired.includes('10s')) { fired.push('10s'); events.push({ type: 'countdown', seconds: 10, next, step: st }); }
      if (rem <= 3.5 && rem > 0 && !fired.includes('3s')) { fired.push('3s'); events.push({ type: 'beeps', step: st }); }
      if (st.value >= 600 && se / 1000 >= st.value / 2 && !fired.includes('half')) { fired.push('half'); events.push({ type: 'stephalf', step: st }); }
    } else if (st.measure === 'distance') {
      const rem = st.value - stepDistance(s);
      if (rem <= 200 && rem > 100 && st.value >= 600 && !fired.includes('200m')) { fired.push('200m'); events.push({ type: 'distwarn', meters: 200, next, step: st }); }
      if (rem <= 100 && st.value >= 300 && !fired.includes('100m')) { fired.push('100m'); events.push({ type: 'distwarn', meters: 100, next, step: st }); }
      if (st.value >= 1500 && stepDistance(s) >= st.value / 2 && !fired.includes('half')) { fired.push('half'); events.push({ type: 'stephalf', step: st }); }
    }
    break;
  }
  if (s.status === 'running' && s.updateEverySec) {
    const k = Math.floor(elapsedMs(s, now) / 1000 / s.updateEverySec);
    if (k > (s.lastUpdateK || 0)) { s.lastUpdateK = k; events.push({ type: 'update' }); }
  }
  if (s.status === 'running' && !s.halfwayFired && s.totalEst > 600 && elapsedMs(s, now) / 1000 >= s.totalEst / 2) {
    s.halfwayFired = true; events.push({ type: 'halfway' });
  }
  return events;
}

export function next(s, now) {
  if (!['running', 'paused'].includes(s.status)) return [];
  return advance(s, now, { skipped: true });
}

export function prev(s, now) {
  if (!['running', 'paused'].includes(s.status) || s.stepIndex === 0) return [];
  const lap = s.laps.pop();
  s.stepIndex--;
  s.stepStartElapsed = lap ? lap.startElapsed : 0;
  s.stepStartDist = Math.max(0, s.stepStartDist - (lap ? lap.distance : 0));
  delete s.fired[String(s.stepIndex)];
  return [{ type: 'step', step: currentStep(s), back: true }];
}

/** Mark the current manual step (e.g. a strength set) as done. */
export function completeManual(s, now) {
  const st = currentStep(s);
  if (!st || s.status !== 'running') return [];
  return advance(s, now);
}

export function finish(s, now, { lapClosed = false } = {}) {
  if (s.status === 'finished') return [];
  if (!lapClosed && currentStep(s)) closeLap(s, now, { partial: true });
  if (s.pauseStart != null) { s.pausedMs += now - s.pauseStart; s.pauseStart = null; }
  s.status = 'finished';
  s.finishedAt = now;
  return [{ type: 'finish' }];
}

/**
 * Feed a GPS fix. Returns true if accepted.
 * p: {lat, lng, acc, t(ms), speed?}
 */
export function addGpsPoint(s, p) {
  if (s.mode !== 'gps') return false;
  s.gpsStatus = p.acc <= 25 ? 'good' : p.acc <= 50 ? 'weak' : 'poor';
  if (s.status !== 'running') { s.lastPoint = p.acc <= 50 ? p : s.lastPoint; return false; }
  if (p.acc > 50) return false;
  const last = s.lastPoint;
  if (!last) { s.lastPoint = p; s.route.push([+p.lat.toFixed(6), +p.lng.toFixed(6), Math.round(elapsedMs(s, p.t) / 1000)]); return true; }
  const d = haversine(last, p);
  const dt = (p.t - last.t) / 1000;
  if (dt <= 0) return false;
  const speed = d / dt;
  if (speed > 12) return false; // > 12 m/s is not running — GPS jump
  if (d < Math.max(3, Math.min(p.acc, last.acc) * 0.4)) return false; // jitter while standing
  s.distance += d;
  s.lastPoint = p;
  s.route.push([+p.lat.toFixed(6), +p.lng.toFixed(6), Math.round(elapsedMs(s, p.t) / 1000)]);
  s.paceSamples.push({ t: p.t, d: s.distance });
  if (s.paceSamples.length > 60) s.paceSamples.shift();
  return true;
}

/** Rolling pace over the last ~30 s (sec/km) */
export function currentPace(s, now) {
  const samples = s.paceSamples.filter((x) => now - x.t <= 30000);
  if (samples.length < 2) return null;
  const a = samples[0], b = samples[samples.length - 1];
  const dd = b.d - a.d, dt = (b.t - a.t) / 1000;
  if (dd < 20 || dt < 8) return null;
  return dt / (dd / 1000);
}

export function averagePace(s, now) {
  if (s.distance < 50) return null;
  return (elapsedMs(s, now) / 1000) / (s.distance / 1000);
}

/** Estimated overall progress 0..1 */
export function progress(s, now) {
  if (!s.steps.length) return 0;
  const durOf = (st) => (st.measure === 'time' ? st.value : st.measure === 'distance' ? st.estSec : 45);
  let done = 0;
  for (let i = 0; i < s.stepIndex && i < s.steps.length; i++) done += durOf(s.steps[i]);
  const st = currentStep(s);
  if (st) {
    if (st.measure === 'time') done += Math.min(st.value, stepElapsedMs(s, now) / 1000);
    else if (st.measure === 'distance') done += (Math.min(1, stepDistance(s) / st.value)) * st.estSec;
  }
  return Math.min(1, done / Math.max(1, s.totalEst));
}

/** Convert a finished session into an activity record. */
export function toActivity(s, { date, rpe = null, notes = '', manualDistance = null } = {}) {
  const duration = Math.round(elapsedMs(s, s.finishedAt || Date.now()) / 1000);
  let distance = Math.round(s.distance);
  const laps = s.laps.map((l) => ({ ...l }));
  if (s.mode !== 'gps') {
    // timer/treadmill: estimate distance from target paces unless the user entered it
    if (manualDistance) distance = Math.round(manualDistance);
    else distance = Math.round(laps.reduce((a, l) => a + (l.kind === 'exercise' || l.kind === 'rest' ? 0 : (l.duration / (s.steps[l.idx]?.estPace || 420)) * 1000), 0));
    const lapEst = laps.map((l) => (l.kind === 'exercise' || l.kind === 'rest' ? 0 : (l.duration / (s.steps[l.idx]?.estPace || 420)) * 1000));
    const sumEst = lapEst.reduce((a, b) => a + b, 0) || 1;
    laps.forEach((l, i) => { l.distance = Math.round((lapEst[i] / sumEst) * distance); l.avgPace = l.distance > 30 ? l.duration / (l.distance / 1000) : null; l.estimated = true; });
  }
  const planned = s.steps.length;
  const completedSteps = laps.filter((l) => !l.skipped && !l.partial).length;
  const timeDone = laps.reduce((a, l) => a + l.duration, 0);
  const completionPct = Math.round(Math.min(1, Math.max(completedSteps / planned, timeDone / Math.max(1, s.totalEst))) * 100);
  const workLaps = laps.filter((l) => l.kind === 'work' && l.avgPace && l.distance >= 150);
  const fastest = workLaps.length ? workLaps.reduce((a, l) => (l.avgPace < a.avgPace ? l : a)) : null;
  return {
    id: s.id, workoutId: s.workoutId, planId: s.planId, title: s.title, type: s.type, date,
    startedAt: s.startedAt, finishedAt: s.finishedAt, duration, distance,
    avgPace: distance > 50 ? duration / (distance / 1000) : null, laps, route: s.route, mode: s.mode,
    completionPct, fastestLap: fastest ? { label: fastest.label, rep: fastest.rep, avgPace: fastest.avgPace } : null,
    rpe, notes, source: 'live', distanceEstimated: s.mode !== 'gps' && !manualDistance,
  };
}
