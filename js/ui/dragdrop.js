// Calendar drag-and-drop: mouse drag on desktop, long-press-and-drag on touch.
// Every drop is validated (recovery, long run, taper, weekly mileage) before applying.

import { esc, icon, openSheet } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, fmtDate, addDays } from '../core/dates.js';
import { validateMove } from '../engine/adjustments.js';
import { moveWithSummary } from './actions.js';
import { showSummary } from './coach.js';

let state = null;
let suppressClick = false;
let docBound = false;

export function initDragDrop(root) {
  root.querySelectorAll('[data-drag-id]').forEach((el) => el.addEventListener('pointerdown', onDown));
  if (!docBound) {
    docBound = true;
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('touchmove', (e) => { if (state?.active) e.preventDefault(); }, { passive: false });
    document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
    document.addEventListener('contextmenu', (e) => { if (state) e.preventDefault(); });
  }
}

function onDown(e) {
  if (e.button && e.button !== 0) return;
  const el = e.currentTarget;
  const w = store.workout(el.dataset.dragId);
  if (!w) return;
  state = { el, w, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', active: false, timer: null };
  if (state.touch) {
    state.timer = setTimeout(() => { if (state && !state.moved) begin(e.clientX, e.clientY); }, 380);
  }
}

function begin(x, y) {
  state.active = true;
  navigator.vibrate?.(30);
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.innerHTML = `${icon('move', 'xs')} ${esc(state.w.title)}`;
  document.body.appendChild(g);
  state.ghost = g;
  state.el.classList.add('drag-src');
  position(x, y);
}

function position(x, y) {
  if (!state?.ghost) return;
  state.ghost.style.transform = `translate(${x + 12}px, ${y - 28}px)`;
  const under = document.elementFromPoint(x, y)?.closest('[data-drop-date]');
  if (state.over && state.over !== under) state.over.classList.remove('drop-target', 'drop-bad');
  if (under) {
    const d = under.dataset.dropDate;
    const v = d !== state.w.date ? validateMove(store.state.workouts, state.w, d, todayISO(), { plan: store.state.plan }) : { warnings: [] };
    under.classList.add('drop-target');
    under.classList.toggle('drop-bad', !!v.serious);
    state.ghost.dataset.warn = v.serious ? '1' : '';
  }
  state.over = under;
}

function onMove(e) {
  if (!state) return;
  const dx = Math.abs(e.clientX - state.x), dy = Math.abs(e.clientY - state.y);
  if (!state.active) {
    if (state.touch) { if (dx > 8 || dy > 8) { clearTimeout(state.timer); state.moved = true; state = null; } return; }
    if (dx > 6 || dy > 6) begin(e.clientX, e.clientY); else return;
  }
  e.preventDefault();
  position(e.clientX, e.clientY);
}

async function onUp(e) {
  if (!state) return;
  clearTimeout(state.timer);
  if (!state.active) { state = null; return; }
  const { w, over } = state;
  cleanup();
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 400);
  const date = over?.dataset.dropDate;
  if (!date || date === w.date) return;
  await attemptMove(w, date);
}

export async function attemptMove(w, date) {
  const today = todayISO();
  if (date < today) { openSheet(`<div class="sheet-head"><h2>Can’t move into the past</h2><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div><p class="muted">Pick today or a later date.</p>`); return; }
  const v = validateMove(store.state.workouts, w, date, today, { plan: store.state.plan });
  if (!v.warnings.length) { showSummary(await moveWithSummary(w, date)); return; }
  openSheet(`
    <div class="sheet-head"><div><div class="small muted">Move ${esc(w.title)} → ${esc(fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</div><h2>${v.serious ? 'This creates a risky schedule' : 'Check before moving'}</h2></div><button class="icon-btn" data-close>${icon('x', 'sm')}</button></div>
    ${v.warnings.map((x) => `<div class="notice ${v.serious ? 'danger' : 'warn'}">${icon('alert', 'sm')}<div>${esc(x)}</div></div>`).join('')}
    <div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-close>Cancel</button>${v.canSwap ? `<button class="btn" data-swap>${icon('swap', 'sm')} Swap</button>` : ''}<button class="btn ${v.serious ? 'danger' : 'primary'}" data-go>Move anyway</button></div>`, {
    onMount: (el, api) => {
      el.querySelector('[data-go]').onclick = async () => { api.close(); showSummary(await moveWithSummary(w, date, false)); };
      const sw = el.querySelector('[data-swap]');
      if (sw) sw.onclick = async () => { api.close(); showSummary(await moveWithSummary(w, date, true)); };
    },
  });
}

function cleanup() {
  state?.ghost?.remove();
  state?.el?.classList.remove('drag-src');
  state?.over?.classList.remove('drop-target', 'drop-bad');
  state = null;
}
function cancel() { if (state) { clearTimeout(state.timer); cleanup(); } }

export { addDays };
