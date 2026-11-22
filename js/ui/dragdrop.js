// Calendar drag-and-drop: mouse drag on desktop, long-press-and-drag on touch.
// Every drop is validated (recovery, long run, taper, weekly mileage) before applying.

import { esc, icon, openSheet } from './dom.js';
import { store } from '../core/store.js';
import { todayISO, fmtDate, addDays } from '../core/dates.js';
import { validateMove } from '../engine/adjustments.js';
import { moveWithSummary } from './actions.js';
import { showSummary } from './coach.js';
import { requestReschedule } from './reschedule.js';

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
  requestReschedule(w, date);
}

function cleanup() {
  state?.ghost?.remove();
  state?.el?.classList.remove('drag-src');
  state?.over?.classList.remove('drop-target', 'drop-bad');
  state = null;
}
function cancel() { if (state) { clearTimeout(state.timer); cleanup(); } }

export { addDays };
