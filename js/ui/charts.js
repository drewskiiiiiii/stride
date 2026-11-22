// Tiny dependency-free SVG charts with tap/hover tooltips.

import { esc } from './dom.js';

const W = 640, H = 220, PL = 40, PR = 10, PT = 14, PB = 28;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function labelEvery(n, maxLabels = 8) { return Math.max(1, Math.ceil(n / maxLabels)); }

/** values: number[]; planned?: number[]; tips: string[] */
export function barChart({ labels, values, planned = null, tips = [], yFmt = (v) => v, highlight = -1 }) {
  const n = values.length;
  if (!n) return '<div class="empty small">No data yet</div>';
  const max = niceMax(Math.max(...values, ...(planned || []), 0.0001));
  const iw = W - PL - PR, ih = H - PT - PB;
  const bw = iw / n;
  const y = (v) => PT + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const every = labelEvery(n);
  let bars = '';
  for (let i = 0; i < n; i++) {
    const x = PL + i * bw;
    const w = Math.max(2, bw * 0.62);
    const off = (bw - w) / 2;
    if (planned) bars += `<rect class="bar-rect plan" x="${x + off}" y="${y(planned[i] || 0)}" width="${w}" height="${Math.max(0, PT + ih - y(planned[i] || 0))}" rx="3"/>`;
    const vv = values[i] || 0;
    bars += `<rect class="bar-rect" x="${x + off + (planned ? w * 0.18 : 0)}" y="${y(vv)}" width="${planned ? w * 0.64 : w}" height="${Math.max(vv > 0 ? 1.5 : 0, PT + ih - y(vv))}" rx="3" ${i === highlight ? 'style="fill:var(--text)"' : ''}/>`;
    bars += `<rect x="${x}" y="${PT}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(tips[i] || '')}" data-tx="${x + bw / 2}" data-ty="${y(Math.max(vv, planned?.[i] || 0))}"/>`;
  }
  return wrap(`
    <g class="grid">${ticks.map((t) => `<line x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${PL - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(yFmt(t))}</text>`).join('')}
    ${labels.map((l, i) => (i % every === 0 ? `<text x="${PL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}</g>
    ${bars}`);
}

/** Line chart. invert=true draws lower values higher (for pace). */
export function lineChart({ labels, values, tips = [], yFmt = (v) => v, invert = false }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null && isFinite(p.v));
  if (pts.length < 2) return '<div class="empty small">Not enough data yet — keep logging workouts.</div>';
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const n = values.length;
  const iw = W - PL - PR, ih = H - PT - PB;
  const x = (i) => PL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => (invert ? PT + ((v - lo) / (hi - lo)) * ih : PT + ih - ((v - lo) / (hi - lo)) * ih);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts[pts.length - 1].i).toFixed(1)},${PT + ih} L${x(pts[0].i).toFixed(1)},${PT + ih} Z`;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const every = labelEvery(n);
  return wrap(`
    <g class="grid">${ticks.map((t) => `<line x1="${PL}" x2="${W - PR}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${PL - 6}" y="${y(t) + 3.5}" text-anchor="end">${esc(yFmt(t))}</text>`).join('')}
    ${labels.map((l, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}</g>
    ${invert ? '' : `<path class="area" d="${area}"/>`}
    <path class="line" d="${d}"/>
    ${pts.map((p) => `<circle class="pt" cx="${x(p.i)}" cy="${y(p.v)}" r="3.5"/><circle cx="${x(p.i)}" cy="${y(p.v)}" r="14" fill="transparent" data-tip="${esc(tips[p.i] || '')}" data-tx="${x(p.i)}" data-ty="${y(p.v)}"/>`).join('')}`);
}

function wrap(inner) {
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">${inner}</svg></div>`;
}

/** Attach tooltip behaviour to all charts in root. */
export function bindCharts(root) {
  root.querySelectorAll('.chart-wrap').forEach((wrapEl) => {
    const svg = wrapEl.querySelector('svg');
    let tip = null;
    const show = (t) => {
      if (!t.dataset.tip) return;
      if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; wrapEl.appendChild(tip); }
      const r = svg.getBoundingClientRect();
      tip.textContent = t.dataset.tip;
      tip.style.left = `${(Number(t.dataset.tx) / W) * r.width}px`;
      tip.style.top = `${(Number(t.dataset.ty) / H) * r.height}px`;
      tip.style.display = 'block';
    };
    svg.addEventListener('pointermove', (e) => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
    svg.addEventListener('pointerdown', (e) => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
    svg.addEventListener('pointerleave', () => { if (tip) tip.style.display = 'none'; });
  });
}
