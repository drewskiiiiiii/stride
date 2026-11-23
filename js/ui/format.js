// Presentation helpers for workouts, steps, paces and targets.

import { esc, icon } from './dom.js';
import { fmtDist, fmtDuration, fmtMinutes, fmtPace, fmtPaceRange, fmtRepDist, paceLabel } from '../core/units.js';
import { ZONE_INFO, hrRange, maxHrEstimate } from '../engine/vdot.js';
import { TYPE_META, flattenSteps, zonePace } from '../engine/workout-utils.js';
import { prefs } from '../core/storage.js';
import { stepSpeed, fmtSpeedRange, speedLabel } from '../engine/treadmill.js';
import { startingPace } from '../engine/effort.js';

/** Treadmill speed unit: user choice, or follows the distance unit. */
export function speedUnit() {
  const p = prefs.get();
  if (p.speedUnit === 'mph' || p.speedUnit === 'kmh') return p.speedUnit;
  return p.distance === 'km' ? 'kmh' : 'mph';
}
/** Whether to show treadmill speeds alongside paces on workout segments. */
export function showSpeeds(plan) {
  const v = prefs.get().showSpeeds;
  if (v === 'on') return true;
  if (v === 'off') return false;
  return !!plan?.inputs?.prefs?.treadmill;
}
export function stepSpeedText(step, plan) {
  const r = stepSpeed(step, { paces: plan?.paces, assumedEasy: plan?.assumedEasy || 420, unit: speedUnit() });
  if (!r) return '';
  return `${r.estimated ? '≈ ' : ''}${fmtSpeedRange(r)}${r.incline >= 5 ? ` @ ${r.incline}% incline` : ''}${r.capped ? ' (treadmill max)' : ''}`;
}

export function zoneColorKey(zone) {
  const map = { walk: 'walk', recovery: 'recovery', easy: 'easy', long: 'long', steady: 'steady', marathon: 'steady', half: 'tempo', tempo: 'tempo', threshold: 'threshold', '10k': 'threshold', '5k': 'interval', interval: 'interval', rep: 'rep', hill: 'interval', stride: 'rep', fartlekOn: 'tempo', race: 'rep' };
  return map[zone] || 'easy';
}
export function typeColor(type) { return TYPE_META[type]?.color || 'easy'; }
export function typeLabel(type) { return TYPE_META[type]?.label || 'Workout'; }
export function typeIcon(type) { return TYPE_META[type]?.icon || 'easy'; }

export function athleteMaxHr(profile) {
  return profile?.inputs?.profile?.maxHr || maxHrEstimate(profile?.inputs?.profile?.age);
}

/** Target text for a step: pace range, HR range and/or effort. */
export function stepTarget(step, plan, profile, { short = false } = {}) {
  if (!step.zone) return '';
  const info = ZONE_INFO[step.zone] || {};
  const p = prefs.get();
  const byHr = profile?.inputs?.prefs?.intensityBy === 'hr';
  const paces = plan?.paces;
  const parts = [];
  const pr = paces && paces[step.zone] ? fmtPaceRange(paces[step.zone]) : null;
  const hr = hrRange(step.zone, athleteMaxHr(profile));
  const hrText = hr ? (p.hr === 'pct' ? `${info.hr[0]}–${info.hr[1]}% max HR` : `${hr[0]}–${hr[1]} bpm`) : null;
  if (step.zone === 'race' && step.targetPace) parts.push(fmtPace(step.targetPace, { withUnit: true }));
  if (byHr && hrText) { parts.push(hrText); if (pr && !short) parts.push(pr); }
  else if (pr) { parts.push(pr); if (hrText && !short && byHr) parts.push(hrText); }
  if (!pr && !(byHr && hrText)) {
    parts.push(short ? `RPE ${info.rpe}` : `${info.effort || ''} · RPE ${info.rpe}`);
    const sp = !short && step.zone !== 'walk' ? startingPace(step.zone, plan) : null;
    if (sp && sp.basis !== 'zones') parts.push(`start ~${fmtPaceRange(sp.range)}`);
  }
  if (!short && showSpeeds(plan)) { const sp = stepSpeedText(step, plan); if (sp) parts.push(`Treadmill ${sp}`); }
  return parts.join(' · ');
}

/** True when a step is prescribed by effort (RPE) rather than a personal pace. */
export function isEffortBased(step, plan) {
  if (!step?.zone || step.zone === 'walk' || step.zone === 'race') return false;
  return !(plan?.paces && plan.paces[step.zone]) && !!ZONE_INFO[step.zone]?.rpe;
}
export function mainZone(w, plan) {
  const flat = flattenSteps(w.steps || []);
  const core = flat.filter((s) => !['warmup', 'cooldown', 'recover', 'walk', 'rest'].includes(s.kind) && s.zone !== 'stride');
  const dur = (s) => (s.measure === 'time' ? s.value : (s.value / 1000) * zonePace(s.zone, plan?.paces, plan?.assumedEasy));
  const totals = {};
  core.forEach((s) => { totals[s.zone] = (totals[s.zone] || 0) + dur(s); });
  return Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0] || flat[0]?.zone || null;
}

export function stepValue(step) {
  if (step.measure === 'time') return fmtDuration(step.value, { long: true }).replace(' 0 s', '');
  if (step.measure === 'distance') return step.value < 3000 ? fmtRepDist(step.value) : fmtDist(step.value);
  if (step.measure === 'manual') return step.detail ? step.detail.split('·').pop().trim() : 'Tap when done';
  return '';
}

export function workoutLine(w, plan) {
  if (w.type === 'rest') return 'Recovery day';
  const bits = [];
  if (w.estDuration) bits.push(fmtMinutes(w.estDuration));
  if (w.estDistance) bits.push((plan && plan.paceConfidence === 'none' ? '≈ ' : '') + fmtDist(w.estDistance));
  return bits.join(' · ');
}

export function mainTarget(w, plan, profile) {
  const flat = flattenSteps(w.steps || []);
  // the "main" step is the one with the most running time, ignoring warm-up/cool-down
  const core = flat.filter((s) => !['warmup', 'cooldown', 'recover', 'walk', 'rest'].includes(s.kind) && s.zone !== 'stride');
  const dur = (s) => (s.measure === 'time' ? s.value : (s.value / 1000) * zonePace(s.zone, plan?.paces, plan?.assumedEasy));
  const totals = {};
  core.forEach((s) => { totals[s.zone] = (totals[s.zone] || 0) + dur(s); });
  const zone = Object.keys(totals).sort((a, b) => totals[b] - totals[a])[0];
  const main = core.find((s) => s.zone === zone) || flat[0];
  if (!main) return '';
  return stepTarget(main, plan, profile, { short: true });
}

export function renderSteps(steps, plan, profile) {
  const one = (s) => `
    <div class="step" data-z="${zoneColorKey(s.zone)}">
      <span class="zbar"></span>
      <div class="grow"><div class="t">${esc(s.label)}</div>${s.zone || s.detail ? `<div class="s">${esc(s.detail || stepTarget(s, plan, profile))}</div>` : ''}${s.cue && s.kind === 'exercise' ? `<div class="s">${esc(s.cue)}</div>` : ''}${isEffortBased(s, plan) ? `<button class="link-btn tiny" data-action="effort" data-zone="${esc(s.zone)}" style="padding:2px 0">${icon('info', 'xs')} What does RPE ${esc(ZONE_INFO[s.zone]?.rpe || '')} mean?</button>` : ''}</div>
      <div class="v">${esc(stepValue(s))}</div>
    </div>`;
  return `<div class="steps">${(steps || []).map((s) => s.repeat
    ? `<div class="repeat-block"><div class="rb-head">${icon('refresh', 'xs')} Repeat ${s.repeat}×</div><div class="steps">${s.steps.map(one).join('')}</div></div>`
    : one(s)).join('')}</div>`;
}

/** Proportional coloured bar of the workout structure. */
export function structureBar(w, plan) {
  const flat = flattenSteps(w.steps || []);
  if (!flat.length || w.type === 'strength' || w.type === 'mobility') return '';
  const durs = flat.map((s) => (s.measure === 'time' ? s.value : (s.value / 1000) * zonePace(s.zone, plan?.paces, plan?.assumedEasy)));
  const total = durs.reduce((a, b) => a + b, 0) || 1;
  return `<div class="structure-bar">${flat.map((s, i) => `<i data-z="${zoneColorKey(s.zone)}" class="${['warmup', 'cooldown', 'recover', 'walk'].includes(s.kind) ? 'low' : ''}" style="flex:${(durs[i] / total).toFixed(4)}"></i>`).join('')}</div>`;
}

export function statusLabel(st) {
  return { completed: 'Completed', missed: 'Missed', skipped: 'Skipped', planned: 'Planned', done: 'Rest', replaced: 'Moved' }[st] || st;
}

export function paceUnit() { return paceLabel(); }

export function relDay(iso, today) {
  const d = Math.round((new Date(iso + 'T12:00') - new Date(today + 'T12:00')) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return null;
}
