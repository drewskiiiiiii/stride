// Post-workout treadmill speed corrections — pure, DOM-free, unit-tested in Node.
//
// Each lap of a treadmill activity can be given a corrected speed. Only the edited lap's
// distance is recalculated (Distance = Speed × Duration); every other lap keeps its recorded
// speed and distance, and totals change by exactly the edited laps' difference. The original
// recorded values are kept on the lap (`orig`) so they can be shown and restored.

import { speedToMps, mpsToSpeed, speedToPace, roundSpeed, convertSpeed } from './treadmill.js';

const NON_RUN = new Set(['exercise', 'rest']);

/** Laps that can be edited (running/walking segments that took time). */
export function isEditableLap(l) { return !!l && !NON_RUN.has(l.kind) && (l.duration || 0) > 0; }

/** Is this a treadmill activity whose laps can be corrected? */
export function canEditSpeeds(act) {
  return !!act && (act.source === 'treadmill' || !!act.treadmill || act.mode === 'treadmill') && (act.laps || []).some(isEditableLap);
}

/** Original (as recorded) values of a lap. */
export function lapOriginal(l) {
  return l.orig || { tmAvgSpeed: l.tmAvgSpeed ?? null, speedUnit: l.speedUnit || 'mph', distance: l.distance || 0, avgPace: l.avgPace ?? null };
}

/** Recorded speed of a lap expressed in `unit` (null if no speed was recorded). */
export function recordedSpeed(l, unit) {
  const o = lapOriginal(l);
  if (o.tmAvgSpeed == null || !(o.tmAvgSpeed > 0)) return null;
  return roundSpeed(convertSpeed(o.tmAvgSpeed, o.speedUnit || 'mph', unit));
}

/** Speed currently used for this lap (edited or recorded), in `unit`. */
export function currentSpeed(l, unit) {
  if (l.tmEdit) return roundSpeed(convertSpeed(l.tmEdit.speed, l.tmEdit.unit, unit));
  return recordedSpeed(l, unit);
}

/** Distance (m) for a duration (s) at a speed — Distance = Speed × (minutes ÷ 60). */
export function distanceAt(speed, unit, durationSec) {
  return speedToMps(speed, unit) * durationSec;
}

/** Current edits as { lapIndex: { speed, unit } }. */
export function currentEdits(act) {
  const out = {};
  (act.laps || []).forEach((l, i) => { if (l.tmEdit) out[i] = { ...l.tmEdit }; });
  return out;
}

/** The activity exactly as originally recorded (all corrections removed). */
export function originalActivity(act) {
  const a = { ...act, laps: (act.laps || []).map((l) => {
    if (!l.orig) return { ...l };
    const { orig, tmEdit, corrected, ...rest } = l;
    return { ...rest, tmAvgSpeed: orig.tmAvgSpeed, speedUnit: orig.speedUnit, distance: orig.distance, avgPace: orig.avgPace };
  }) };
  if (act.tmEdits) {
    a.distance = act.tmEdits.origDistance;
    a.avgPace = act.tmEdits.origAvgPace;
    if (a.treadmill) a.treadmill = { ...a.treadmill, avgSpeed: act.tmEdits.origAvgSpeed ?? a.treadmill.avgSpeed };
    a.fastestLap = act.tmEdits.origFastestLap ?? a.fastestLap;
    delete a.tmEdits;
  }
  return a;
}

function fastestOf(laps) {
  const work = laps.filter((l) => l.kind === 'work' && l.avgPace && l.distance >= 150);
  if (!work.length) return null;
  const f = work.reduce((a, l) => (l.avgPace < a.avgPace ? l : a));
  return { label: f.label, rep: f.rep, avgPace: f.avgPace };
}

/**
 * Apply a full set of per-lap corrections to an activity.
 * edits: { lapIndex: { speed, unit } } — a lap absent from `edits` (or whose speed equals the
 * recorded one) keeps its original values. Idempotent: always starts from the original record.
 */
export function withSpeedEdits(act, edits = {}, { now = Date.now() } = {}) {
  const base = originalActivity(act);
  const laps = base.laps;
  let delta = 0, count = 0;
  for (const [k, e] of Object.entries(edits)) {
    const i = Number(k), l = laps[i];
    if (!e || !isEditableLap(l) || !(e.speed > 0)) continue;
    const rec = recordedSpeed(l, e.unit);
    const speed = roundSpeed(e.speed);
    if (rec != null && Math.abs(rec - speed) < 0.05) continue; // same as recorded → nothing to change
    const orig = lapOriginal(l);
    const dist = distanceAt(speed, e.unit, l.duration);
    delta += dist - (orig.distance || 0);
    laps[i] = { ...l, orig, tmEdit: { speed, unit: e.unit }, tmAvgSpeed: speed, speedUnit: e.unit, distance: Math.round(dist), avgPace: dist > 30 ? l.duration / (dist / 1000) : null, corrected: true };
    count++;
  }
  if (!count) return base;
  const distance = Math.max(0, Math.round((base.distance || 0) + delta));
  const out = {
    ...base, laps, distance,
    avgPace: distance > 50 && base.duration ? base.duration / (distance / 1000) : null,
    fastestLap: fastestOf(laps),
    tmEdits: { origDistance: base.distance, origAvgPace: base.avgPace, origAvgSpeed: base.treadmill?.avgSpeed ?? null, origFastestLap: base.fastestLap ?? null, count, editedAt: now },
  };
  if (out.treadmill) out.treadmill = { ...out.treadmill, avgSpeed: base.duration ? roundSpeed(mpsToSpeed(distance / base.duration, out.treadmill.unit || 'mph')) : null };
  return out;
}

/** Average treadmill speed of an activity in `unit` (from distance ÷ duration). */
export function averageSpeed(act, unit) {
  if (!act?.duration || !act.distance) return null;
  return roundSpeed(mpsToSpeed(act.distance / act.duration, unit));
}

/** Pace (sec/km) for a speed — convenience re-export for the UI. */
export function paceForSpeed(speed, unit) { return speedToPace(speed, unit); }
