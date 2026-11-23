// "What does this RPE mean?" — explanation sheet with the 1–10 scale, how it should feel,
// and how fast to start running.

import { esc, icon, openSheet } from './dom.js';
import { store } from '../core/store.js';
import { fmtPaceRange, paceLabel } from '../core/units.js';
import { effortGuide, RPE_SCALE } from '../engine/effort.js';
import { stepSpeed, fmtSpeedRange } from '../engine/treadmill.js';
import { speedUnit, showSpeeds } from './format.js';

/** Short inline hint, e.g. "start ~10:15–11:05/mi". */
export function startHint(zone, plan = store.state.plan) {
  const g = effortGuide(zone, plan);
  if (!g.startPace || g.startPace.basis === 'zones') return '';
  return `start ~${fmtPaceRange(g.startPace.range)}`;
}

export function openEffortSheet(zone, { treadmill = false } = {}) {
  const plan = store.state.plan;
  const g = effortGuide(zone, plan);
  const [lo, hi] = g.range || [0, 0];
  const sp = g.startPace;
  const tm = sp && (treadmill || showSpeeds(plan)) ? stepSpeed({ kind: 'steady', zone, targetPace: sp.range }, { unit: speedUnit() }) : null;
  const basisNote = !sp ? '' : sp.basis === 'zones'
    ? 'This is your personal pace zone, calculated from your race or time-trial results.'
    : sp.basis === 'easyPace'
      ? 'Estimated from the easy pace you entered. Effort comes first — if it feels harder than described, slow down.'
      : 'This is only an estimate based on your experience level. Let the effort guide you, not the number. A time trial will give you personal pace zones.';
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Effort target</div><h2>RPE ${esc(g.rpe || '')} · ${esc(g.name)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <p style="color:var(--text-2);margin-top:-4px"><b style="color:var(--text)">RPE</b> means <i>Rate of Perceived Exertion</i> — how hard the running feels to you on a scale of 1 to 10, where 1 is resting and 10 is an all-out sprint. It adapts to heat, hills, tiredness and terrain in a way a fixed pace can’t.</p>
    <div class="rpe-bar">${RPE_SCALE.map((s) => `<span class="${s.n >= lo && s.n <= hi ? 'on' : ''}">${s.n}</span>`).join('')}</div>
    <div class="row between tiny muted" style="margin:4px 2px 14px"><span>Resting</span><span>Moderate</span><span>Maximal</span></div>

    <div class="card flat">
      <div class="upper muted" style="margin-bottom:8px">How it should feel</div>
      ${g.scale.map((s) => `<div class="small" style="margin-bottom:6px"><b>${s.n} · ${esc(s.name)}</b> — ${esc(s.feel)}</div>`).join('')}
      <dl class="kv" style="margin-top:10px"><dt>Talk test</dt><dd style="text-align:right;font-weight:600">${esc(g.talk)}</dd><dt>Breathing</dt><dd style="text-align:right;font-weight:600">${esc(g.breathing)}</dd></dl>
    </div>

    <div class="card" style="margin-top:12px;border-color:color-mix(in srgb, var(--accent) 40%, transparent)">
      <div class="upper muted" style="margin-bottom:8px">How fast to start</div>
      ${sp ? `<div style="font-size:24px;font-weight:780" class="num">${fmtPaceRange(sp.range)}</div>
        ${tm ? `<div class="small muted" style="margin-top:2px">On a treadmill: <b style="color:var(--text)">${esc(fmtSpeedRange(tm))}</b></div>` : ''}` : ''}
      <p class="small" style="margin:10px 0 6px">${esc(g.start)}</p>
      <p class="small muted" style="margin:0">${esc(g.check)}</p>
      ${basisNote ? `<p class="tiny muted" style="margin:10px 0 0">${esc(basisNote)}</p>` : ''}
    </div>
    ${sp && sp.basis !== 'zones' ? `<button class="btn ghost block" data-action="assessment" style="margin-top:12px">${icon('trophy', 'sm')} Get personal pace zones (fitness check)</button>` : ''}
    <button class="btn primary block" data-close style="margin-top:10px">Got it</button>`);
}

export { paceLabel };
