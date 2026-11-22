// Local-date helpers. All plan dates are stored as 'YYYY-MM-DD' strings in local time
// so a workout never shifts a day because of time-zone conversion.

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // noon avoids DST edge cases
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a, b) {
  // b - a in whole days
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

export function weekday(iso) {
  return parseISO(iso).getDay();
}

/** Monday of the week containing iso. */
export function startOfWeek(iso) {
  const wd = weekday(iso);
  const offset = (wd + 6) % 7;
  return addDays(iso, -offset);
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

export function daysInMonth(iso) {
  const d = parseISO(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function addMonths(iso, n) {
  const d = parseISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return toISO(d);
}

export function isBetween(iso, start, end) {
  return iso >= start && iso <= end;
}

export function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseISO(iso).toLocaleDateString(undefined, opts);
}

export function fmtLongDate(iso) {
  return fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function rangeDays(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
