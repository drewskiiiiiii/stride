// Interactive rescheduling: decision prompt → (dynamic preview | move-only warning) → apply → summary with undo.

import { esc, icon, openSheet, toast } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, fmtDate } from '../core/dates.js';
import { fmtDist } from '../core/units.js';
import { validateMove, moveWorkout } from '../engine/adjustments.js';
import { planReschedule, proposalLines, nextSuitableDay } from '../engine/reschedule.js';
import { showSummary } from './coach.js';

const day = (d) => fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' });
const sday = (d) => fmtDate(d, { weekday: 'short', day: 'numeric' });

/** Entry point for every reschedule (Move button, drag-and-drop). */
export function requestReschedule(w, date) {
  const today = todayISO();
  if (!w || date === w.date) return;
  if (date < today) { toast('Pick today or a later date'); return; }
  if (w.status === 'completed') { toast('Completed workouts can’t be moved'); return; }
  const plan = store.state.plan;
  const v = validateMove(store.state.workouts, w, date, today, { plan });
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Reschedule</div><h2>${esc(w.title)}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <div class="row" style="gap:10px;margin-bottom:12px"><span class="chip">${esc(sday(w.date))}</span>${icon('chevR', 'sm')}<span class="chip accent">${esc(sday(date))}</span></div>
    ${v.warnings.length ? v.warnings.map((x) => `<div class="notice ${v.serious ? 'danger' : 'warn'}">${icon('alert', 'sm')}<div>${esc(x)}</div></div>`).join('') : `<div class="notice ok">${icon('check', 'sm')}<div>This date works on its own — no recovery, long-run, taper or mileage conflicts.</div></div>`}
    <p style="margin:16px 0 12px;font-weight:650">Would you like to dynamically reschedule your remaining workouts to maintain proper recovery time and training balance?</p>
    <div class="options">
      <button class="opt" data-rs="yes"><span class="radio"></span><span class="grow"><div class="ot">Yes — Dynamically reschedule</div><div class="os">Reorganise this week and next around the new date, keeping recovery and training priorities. You’ll see a preview first.</div></span></button>
      <button class="opt" data-rs="no"><span class="radio"></span><span class="grow"><div class="ot">No — Move this workout only</div><div class="os">Nothing else changes.${v.warnings.length ? ' You’ll be warned about the recovery issues above.' : ''}</div></span></button>
    </div>
    <p class="tiny muted" style="margin-top:10px">Other workouts are never moved without your confirmation.</p>`, {
    onMount: (el, api) => {
      el.querySelector('[data-rs="yes"]').onclick = () => { api.close(); setTimeout(() => showPreview(w, date), 220); };
      el.querySelector('[data-rs="no"]').onclick = () => { api.close(); setTimeout(() => moveOnly(w, date, v), 220); };
    },
  });
}

// ---------------------------------------------------------------- No: move this workout only
async function moveOnly(w, date, v) {
  const today = todayISO();
  const plan = store.state.plan;
  if (!v.serious) { await commitSingle(w, date, v, false); return; }
  const alt = nextSuitableDay(store.state.workouts, w, date, { plan, today });
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Recovery concern</div><h2>This leaves too little recovery</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${v.warnings.map((x) => `<div class="notice danger">${icon('alert', 'sm')}<div>${esc(x)}</div></div>`).join('')}
    <p class="small muted" style="margin:12px 0">Hard sessions need about 48 hours between them for your body to absorb the work. Stacking them raises injury risk and usually makes the second session worse.</p>
    ${alt ? `<button class="btn primary block" data-alt>${icon('calendar', 'sm')} Move to ${esc(day(alt))} instead (recommended)</button>` : '<p class="small muted">No safe day is available in the next two weeks.</p>'}
    <button class="btn danger block" data-override style="margin-top:8px">Move to ${esc(sday(date))} anyway — I accept the recovery risk</button>
    <button class="btn ghost block" data-close style="margin-top:8px">Cancel — keep the original schedule</button>`, {
    onMount: (el, api) => {
      const a = el.querySelector('[data-alt]');
      if (a) a.onclick = async () => { api.close(); const v2 = validateMove(store.state.workouts, w, alt, today, { plan }); await commitSingle(w, alt, v2, false); };
      el.querySelector('[data-override]').onclick = async () => { api.close(); await commitSingle(w, date, v, true); };
    },
  });
}

async function commitSingle(w, date, v, override) {
  const changed = moveWorkout(store.state.workouts, w, date, {}).map((x) => (x.id === w.id ? { ...x, movedFrom: x.movedFrom === date ? null : x.movedFrom, rescheduled: x.movedFrom !== date } : x));
  const reason = override
    ? `Moved at your request despite a recovery concern: ${v.warnings.join(' ')} Consider keeping the surrounding days easy.`
    : v.warnings.length ? `Moved only this workout. Note: ${v.warnings.join(' ')}` : `${w.title} moved to ${day(date)}. No other workouts were changed and no recovery conflicts were created.`;
  const s = await store.applyChange({ updates: changed, title: override ? 'Workout moved (recovery override)' : 'Workout moved', reason });
  setTimeout(() => showSummary(s), 250);
}

// ---------------------------------------------------------------- Yes: dynamic reschedule preview
function showPreview(w, date) {
  const today = todayISO();
  const plan = store.state.plan;
  const p = planReschedule(store.state.workouts, w, date, { plan, today });
  const lines = proposalLines(p);
  const ico = { move: 'move', short: 'edit', skip: 'x' };
  const unresolved = p.conflicts.involvingMoved;
  const wk = p.weeks.map((x) => `<tr><td>Week of ${esc(fmtDate(x.week, { month: 'short', day: 'numeric' }))}</td><td class="r">${fmtDist(x.before)} → <b>${fmtDist(x.after)}</b></td><td class="r">${x.qBefore} → <b>${x.qAfter}</b></td></tr>`).join('');
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Preview — nothing has changed yet</div><h2>Proposed schedule</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${unresolved.length ? `<div class="notice danger">${icon('alert', 'sm')}<div><b>A recovery conflict can’t be resolved</b>${unresolved.map((c) => `<div>${esc(c)}</div>`).join('')}<div style="margin-top:6px">The other workouts can’t move far enough within this week without breaking more recovery rules.${p.suggestion ? ` The safest option is to put ${esc(w.title)} on <b>${esc(day(p.suggestion))}</b>.` : ''}</div>${p.suggestion ? `<button class="btn sm primary" data-alt style="margin-top:10px">Preview ${esc(sday(p.suggestion))} instead</button>` : ''}</div></div>` : ''}
    <div class="upper muted" style="margin:14px 0 8px">Changes</div>
    <div class="list">${lines.map((l) => `<div class="list-item">${icon(ico[l.kind], 'sm')}<div class="grow"><div class="t small">${esc(l.text)}</div>${l.why ? `<div class="s">${esc(l.why)}</div>` : ''}</div></div>`).join('')}</div>
    ${p.notes.filter((n) => !n.conflict).map((n) => `<p class="small muted" style="margin:8px 2px">${esc(n.text)}</p>`).join('')}
    ${p.unchanged.length ? `<details style="margin-top:10px"><summary class="small muted">${p.unchanged.length} workout${p.unchanged.length === 1 ? '' : 's'} unchanged</summary><div class="small muted" style="margin-top:6px">${p.unchanged.map((u) => `${esc(u.title)} (${esc(sday(u.date))})`).join(' · ')}</div></details>` : ''}
    <div class="upper muted" style="margin:16px 0 8px">Recovery</div>
    <dl class="kv"><dt>Rest days (this week + next)</dt><dd>${p.recovery.restBefore} → ${p.recovery.restAfter}${p.recovery.restAfter > p.recovery.restBefore ? ' <span style="color:var(--ok)">gained</span>' : p.recovery.restAfter < p.recovery.restBefore ? ' <span style="color:var(--warn)">lost</span>' : ''}</dd>
      <dt>Back-to-back hard days</dt><dd>${p.conflicts.before.length} → <b style="color:${p.conflicts.after.length ? 'var(--danger)' : 'var(--ok)'}">${p.conflicts.after.length}</b></dd></dl>
    ${p.conflicts.after.length ? p.conflicts.after.map((c) => `<div class="notice warn" style="margin-top:8px">${icon('alert', 'sm')}<div>${esc(c)}</div></div>`).join('') : ''}
    <div class="upper muted" style="margin:16px 0 8px">Weekly mileage & quality sessions</div>
    <table class="lap-table"><tr><th></th><th class="r">Distance</th><th class="r">Quality</th></tr>${wk}</table>
    <p class="tiny muted" style="margin-top:10px">${esc(p.preserved)} Completed workouts are never moved.</p>
    <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-close>Cancel — keep original</button><button class="btn ${unresolved.length ? 'danger' : 'primary'}" data-apply>${icon('check', 'sm')} ${unresolved.length ? 'Apply anyway' : 'Apply schedule'}</button></div>`, {
    onMount: (el, api) => {
      const a = el.querySelector('[data-alt]');
      if (a) a.onclick = () => { api.close(); setTimeout(() => showPreview(w, p.suggestion), 220); };
      el.querySelector('[data-apply]').onclick = async () => {
        api.close();
        const why = [`You moved ${w.title} to ${day(date)}. Surrounding workouts were reorganised to keep about 48 hours between hard sessions while preserving weekly mileage and quality sessions.`];
        p.shortened.forEach((s) => why.push(s.reason));
        p.skipped.forEach((s) => why.push(s.reason));
        if (unresolved.length) why.push(`Applied despite a remaining recovery conflict: ${unresolved.join(' ')}`);
        const s = await store.applyChange({ updates: p.updates, title: 'Dynamic reschedule', reason: why.join(' ') });
        setTimeout(() => showSummary(s), 250);
      };
    },
  });
}

export async function undoLast() {
  const r = await store.undoLast();
  if (!r.ok) { toast(r.reason); return; }
  toast('Previous schedule restored');
}
