// "Edit interval speeds" — correct the treadmill speed used for each interval after a workout.
import { esc, icon, toast, openSheet, confirmDialog } from './dom.js';
import { fmtDuration, fmtPace, fmtPaceRange, toDisplayDist, distLabel, paceLabel } from '../core/units.js';
import { fmtSpeed, speedLabel, speedToPace, convertSpeed, roundSpeed, SPEED_LIMITS } from '../engine/treadmill.js';
import { isEditableLap, recordedSpeed, currentSpeed, currentEdits, withSpeedEdits, distanceAt, averageSpeed, lapOriginal } from '../engine/speed-edit.js';
import { speedUnit } from './format.js';

const PHASE = { warmup: 'Warm-up', cooldown: 'Cool-down', work: 'Interval', recover: 'Recovery', steady: 'Run', walk: 'Walk' };
const other = (u) => (u === 'mph' ? 'kmh' : 'mph');

function lapTitle(l, laps, i) {
  const upTo = laps.slice(0, i + 1);
  if (l.zone === 'stride') return `Stride ${upTo.filter((x) => x.zone === 'stride').length}`;
  if (l.kind === 'work') return `Interval ${upTo.filter((x) => x.kind === 'work' && x.zone !== 'stride').length}`;
  if (l.kind === 'recover') return `Recovery ${laps.slice(0, i + 1).filter((x) => x.kind === 'recover').length}`;
  return PHASE[l.kind] || l.label || 'Segment';
}

/**
 * Open the editor. `act` is the activity as it stands (may already contain edits).
 * onSave(newAct) receives the activity with the chosen corrections applied.
 */
export function openSpeedEditor(act, { onSave } = {}) {
  const unit = speedUnit();
  const lim = SPEED_LIMITS[unit];
  const edits = {}; // working copy: lapIndex → { speed, unit }
  for (const [k, e] of Object.entries(currentEdits(act))) edits[k] = { speed: roundSpeed(convertSpeed(e.speed, e.unit, unit)), unit };
  const laps = act.laps || [];
  const idx = laps.map((l, i) => i).filter((i) => isEditableLap(laps[i]));
  const speedOf = (i) => edits[i]?.speed ?? recordedSpeed(laps[i], unit);
  const preview = () => withSpeedEdits(act, edits);

  const rowHtml = (i) => {
    const l = laps[i];
    const rec = recordedSpeed(l, unit);
    const sp = speedOf(i);
    const changed = edits[i] && rec != null ? Math.abs(edits[i].speed - rec) >= 0.05 : !!edits[i];
    const dist = sp ? distanceAt(sp, unit, l.duration) : lapOriginal(l).distance;
    const pace = sp ? speedToPace(sp, unit) : null;
    const target = l.targetPace ? fmtPaceRange(l.targetPace, { withUnit: true }) : l.targetSpeed ? `${fmtSpeed(l.targetSpeed.target)} ${speedLabel(l.targetSpeed.unit)}` : 'Effort';
    return `<div class="se-row ${changed ? 'changed' : ''}" data-row="${i}">
      <div class="se-head"><div><div class="se-t">${esc(lapTitle(l, laps, i))}</div><div class="tiny muted">${esc(l.label || '')} · ${fmtDuration(l.duration)}${l.skipped ? ' · skipped' : l.partial ? ' · ended early' : ''}</div></div>
        <button class="link-btn tiny" data-reset="${i}" ${changed ? '' : 'hidden'}>${icon('refresh', 'xs')} Reset to original</button></div>
      <div class="se-grid">
        <div><div class="k">Prescribed</div><div class="v">${esc(target)}</div></div>
        <div><div class="k">Recorded</div><div class="v">${rec != null ? `${fmtSpeed(rec)} ${speedLabel(unit)}` : '—'}</div></div>
        <label class="se-in"><span class="k">Actual speed</span><span class="row" style="gap:4px"><input class="input" type="number" inputmode="decimal" step="0.1" min="0" max="${lim.max + 2}" value="${sp != null ? fmtSpeed(sp) : ''}" placeholder="—" data-speed="${i}" aria-label="Actual speed for ${esc(lapTitle(l, laps, i))} in ${speedLabel(unit)}"><span class="tiny muted">${speedLabel(unit)}</span></span></label>
      </div>
      <div class="se-calc tiny" data-calc="${i}">${sp ? `= ${fmtSpeed(convertSpeed(sp, unit, other(unit)))} ${speedLabel(other(unit))} · pace <b>${fmtPace(pace, { withUnit: true })}</b> · est. <b>${toDisplayDist(dist).toFixed(2)} ${distLabel()}</b>${changed ? ` <span class="muted">(was ${toDisplayDist(lapOriginal(l).distance).toFixed(2)})</span>` : ''}` : 'Enter the speed you ran at to estimate distance.'}</div>
    </div>`;
  };
  const totalsHtml = () => {
    const p = preview();
    const avg = averageSpeed(p, unit);
    const changed = p.distance !== (act.tmEdits?.origDistance ?? act.distance) || !!p.tmEdits;
    return `<div class="stat"><div class="v">${toDisplayDist(p.distance || 0).toFixed(2)}<small>${distLabel()}</small></div><div class="l">Est. distance</div></div>
      <div class="stat"><div class="v">${avg ? fmtSpeed(avg) : '—'}<small>${speedLabel(unit)}</small></div><div class="l">Avg speed</div></div>
      <div class="stat"><div class="v">${p.avgPace ? fmtPace(p.avgPace) : '—'}<small>${paceLabel()}</small></div><div class="l">Avg pace</div></div>
      ${changed ? `<div class="tiny muted" style="grid-column:1/-1">Originally recorded: ${toDisplayDist(p.tmEdits?.origDistance ?? act.distance).toFixed(2)} ${distLabel()}${p.tmEdits ? ` · ${p.tmEdits.count} interval${p.tmEdits.count === 1 ? '' : 's'} corrected` : ''}</div>` : ''}`;
  };

  const sh = openSheet(`
    <div class="sheet-head"><div><div class="small muted">Treadmill · ${fmtDuration(act.duration)}</div><h2>Edit interval speeds</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    <p class="small muted" style="margin:0 0 10px">Correct the speed you actually ran for any interval. Only that interval’s distance is recalculated (speed × time); durations, the rest of the workout and your plan’s target paces don’t change.</p>
    <div class="stat-grid" data-se="totals" style="grid-template-columns:repeat(3,1fr)">${totalsHtml()}</div>
    <div class="se-list">${idx.map(rowHtml).join('')}</div>
    <p class="tiny muted">Treadmill distances are estimates from belt speed, not GPS measurements. Corrected speeds are used for your history and long-term treadmill trends; a single edited workout never changes your training paces.</p>
    <div class="btn-row se-foot"><button class="btn ghost" data-se="cancel">Cancel</button><button class="btn primary" data-se="save">${icon('check', 'sm')} Save changes</button></div>`, {
    cls: 'se-sheet',
    onMount: (el) => {
      const refresh = (i) => {
        const r = el.querySelector(`[data-row="${i}"]`);
        const fresh = document.createElement('div'); fresh.innerHTML = rowHtml(i);
        const nr = fresh.firstElementChild;
        r.className = nr.className;
        r.querySelector(`[data-calc="${i}"]`).innerHTML = nr.querySelector(`[data-calc="${i}"]`).innerHTML;
        r.querySelector(`[data-reset="${i}"]`).hidden = nr.querySelector(`[data-reset="${i}"]`).hidden;
        el.querySelector('[data-se="totals"]').innerHTML = totalsHtml();
      };
      el.querySelectorAll('[data-speed]').forEach((inp) => {
        inp.oninput = () => {
          const i = Number(inp.dataset.speed), v = Number(inp.value);
          if (inp.value.trim() === '' || !isFinite(v) || v <= 0) { delete edits[i]; }
          else edits[i] = { speed: roundSpeed(Math.min(v, lim.max + 2)), unit };
          refresh(i);
        };
        inp.onblur = () => { const i = Number(inp.dataset.speed); const sp = speedOf(i); inp.value = sp != null ? fmtSpeed(sp) : ''; };
      });
      el.querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.reset); delete edits[i];
        const sp = recordedSpeed(laps[i], unit);
        el.querySelector(`[data-speed="${i}"]`).value = sp != null ? fmtSpeed(sp) : '';
        refresh(i);
      });
      el.querySelector('[data-se="cancel"]').onclick = async () => {
        const dirty = JSON.stringify(currentEdits(preview())) !== JSON.stringify(currentEdits(act));
        if (dirty && !(await confirmDialog({ title: 'Discard speed changes?', body: 'Your edits to this workout won’t be saved.', confirm: 'Discard changes', danger: true }))) return;
        sh.close();
      };
      el.querySelector('[data-se="save"]').onclick = async (ev) => {
        ev.currentTarget.disabled = true;
        const out = preview();
        sh.close();
        await (onSave && onSave(out));
      };
    },
  });
  return sh;
}

/** Laps table for a treadmill activity, showing corrected speeds next to the originals. */
export function treadmillLapTable(act) {
  const unit = speedUnit();
  const laps = act.laps || [];
  const rows = laps.map((l, i) => [l, i]).filter(([l]) => isEditableLap(l)).map(([l, i]) => {
    const sp = currentSpeed(l, unit), rec = recordedSpeed(l, unit);
    return `<tr><td>${esc(lapTitle(l, laps, i))}</td><td class="r">${fmtDuration(l.duration)}</td><td class="r muted">${l.targetPace ? fmtPace((l.targetPace[0] + l.targetPace[1]) / 2) : '—'}</td><td class="r" style="font-weight:700">${sp != null ? fmtSpeed(sp) : '—'}${l.tmEdit && rec != null ? `<div class="tiny muted" style="font-weight:500">was ${fmtSpeed(rec)}</div>` : ''}</td><td class="r">${l.distance ? toDisplayDist(l.distance).toFixed(2) : '—'}</td></tr>`;
  }).join('');
  return `<table class="lap-table"><tr><th>Segment</th><th class="r">Time</th><th class="r">Target</th><th class="r">${speedLabel(unit)}</th><th class="r">${distLabel()}</th></tr>${rows}</table>`;
}
