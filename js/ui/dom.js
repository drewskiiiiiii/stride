// DOM utilities: escaping, icons, bottom sheets, dialogs and toasts.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  today: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  plan: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5v14l10-7z"/><path d="M19 5v14"/>',
  prev: '<path d="M19 5v14L9 12z"/><path d="M5 5v14"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevD: '<path d="m5 9 7 7 7-7"/>',
  move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 4h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  hills: '<path d="m2 20 7-11 4 6 3-4 6 9z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  vibrate: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M3 8v8M21 8v8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  mobility: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6l-4 7M12 13l4 7M5 10l7-1 7 1"/>',
  rest: '<path d="M3 18v-6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6M3 15h18M3 18v2M21 18v2"/><circle cx="8" cy="12" r="0.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
  easy: '<path d="M13 4.5a1.5 1.5 0 1 0 0-.01M10 21l2-6 3 2v4M7 12l3-4 4 1 3 3M10 8l-1 5"/>',
  long: '<path d="M3 17c3-6 6-6 9 0s6 6 9 0"/>',
  tempo: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 12 17 7M21 3v5h-5"/>',
  intervals: '<path d="M3 17h3V9h3v8h3V5h3v12h3v-6h3"/>',
  fartlek: '<path d="M2 12h3l3-6 4 12 3-8 2 2h5"/>',
  recovery: '<path d="M12 21c-5-3-8-6.5-8-10.5a8 8 0 0 1 16 0c0 4-3 7.5-8 10.5z"/><path d="M12 8v6M9 11h6"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  wifiOff: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18"/>',
  log: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6M9 9h2"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h13M17 12l4 4-4 4M21 16H8"/>',
  plane: '<path d="M10.5 13.5 3 12l1.5-2 6 .5 4-6h2l-1.5 6 5 .5 1.5-1.5h1l-1 3 1 3h-1L20 14l-5 .5 1.5 6h-2l-4-6z"/>',
  thermometer: '<path d="M14 14.5V4a2 2 0 1 0-4 0v10.5a4 4 0 1 0 4 0z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
};
export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;
}

// ---------- Toasts ----------
let toastWrap;
export function toast(msg, ms = 2600) {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; document.body.appendChild(toastWrap); }
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.innerHTML = esc(msg);
  toastWrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- Sheets ----------
const sheetStack = [];
export function openSheet(html, { onMount, onClose, cls = '' } = {}) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  const sh = document.createElement('div');
  sh.className = `sheet ${cls}`; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bd, sh);
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  const api = {
    el: sh,
    close: () => {
      bd.classList.remove('show'); sh.classList.remove('show');
      setTimeout(() => { bd.remove(); sh.remove(); }, 300);
      const i = sheetStack.indexOf(api); if (i >= 0) sheetStack.splice(i, 1);
      onClose && onClose();
    },
    set: (h) => { sh.innerHTML = `<div class="grab"></div>${h}`; onMount && onMount(sh, api); },
  };
  bd.addEventListener('click', api.close);
  sh.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  // drag-to-dismiss on touch
  let y0 = null;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0 && e.target.closest('.grab, .sheet-head')) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sh.addEventListener('touchend', (e) => { if (y0 != null) { const dy = e.changedTouches[0].clientY - y0; sh.style.transform = ''; if (dy > 110) api.close(); } y0 = null; });
  sheetStack.push(api);
  onMount && onMount(sh, api);
  return api;
}
export function closeAllSheets() { [...sheetStack].forEach((s) => s.close()); }
export function topSheet() { return sheetStack[sheetStack.length - 1]; }

export function confirmDialog({ title, body = '', confirm = 'Confirm', cancel = 'Cancel', danger = false, requireText = null }) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet(`
      <div class="sheet-head"><h2>${esc(title)}</h2></div>
      <div class="muted" style="margin-bottom:18px">${body}</div>
      ${requireText ? `<label class="field"><span class="lbl">Type <b>${esc(requireText)}</b> to confirm</span><input class="input" data-req autocomplete="off" autocapitalize="characters"></label>` : ''}
      <div class="btn-row"><button class="btn ghost" data-no>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes ${requireText ? 'disabled' : ''}>${esc(confirm)}</button></div>`,
    {
      onMount: (el) => {
        el.querySelector('[data-no]').onclick = () => { done = true; s.close(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { done = true; s.close(); resolve(true); };
        const req = el.querySelector('[data-req]');
        if (req) req.oninput = () => { el.querySelector('[data-yes]').disabled = req.value.trim().toUpperCase() !== requireText.toUpperCase(); };
      },
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function opts(list, value) {
  return list.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
