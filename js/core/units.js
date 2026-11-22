// Unit conversion and formatting. Internally: metres, seconds, seconds-per-km.

export const M_PER_MI = 1609.344;

let unitPrefs = { distance: 'mi', pace: 'mi' };

export function setUnitPrefs(p) {
  unitPrefs = { ...unitPrefs, ...p };
}
export function getUnitPrefs() {
  return unitPrefs;
}

export const distUnit = () => unitPrefs.distance;
export const distLabel = () => (unitPrefs.distance === 'mi' ? 'mi' : 'km');
export const paceLabel = () => (unitPrefs.pace === 'mi' ? '/mi' : '/km');

export function toDisplayDist(m, unit = unitPrefs.distance) {
  return unit === 'mi' ? m / M_PER_MI : m / 1000;
}
export function fromDisplayDist(v, unit = unitPrefs.distance) {
  return unit === 'mi' ? v * M_PER_MI : v * 1000;
}

export function fmtDist(m, { decimals, unit = unitPrefs.distance, withUnit = true } = {}) {
  if (m == null || isNaN(m)) return '—';
  const v = toDisplayDist(m, unit);
  const d = decimals ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2);
  const s = v.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return withUnit ? `${s} ${unit}` : s;
}

/** Short distance for intervals: 400m, 800m, 1 km, 1 mi */
export function fmtRepDist(m) {
  if (Math.abs(m - M_PER_MI) < 5) return '1 mi';
  if (Math.abs(m - 2 * M_PER_MI) < 5) return '2 mi';
  if (m < 1000 || m % 1000 !== 0) return m < 3000 ? `${Math.round(m)}m` : fmtDist(m);
  return `${m / 1000} km`;
}

export function fmtDuration(sec, { long = false } = {}) {
  if (sec == null || isNaN(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (long) {
    if (h) return `${h} h ${m} min`;
    if (m && s) return `${m} min ${s} s`;
    if (m) return `${m} min`;
    return `${s} s`;
  }
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtMinutes(sec) {
  if (sec == null) return '—';
  const min = Math.round(sec / 60);
  if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60 ? (min % 60) + 'm' : ''}`.trim();
  return `${min} min`;
}

/** secPerKm → "7:15" in current pace unit */
export function fmtPace(secPerKm, { unit = unitPrefs.pace, withUnit = false } = {}) {
  if (!secPerKm || !isFinite(secPerKm)) return '—';
  const s = unit === 'mi' ? secPerKm * (M_PER_MI / 1000) : secPerKm;
  const r = Math.round(s);
  const out = `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  return withUnit ? out + (unit === 'mi' ? '/mi' : '/km') : out;
}

export function fmtPaceRange(range, opts = {}) {
  if (!range) return null;
  const [fast, slow] = range;
  if (!fast) return null;
  if (!slow || Math.abs(slow - fast) < 2) return fmtPace(fast, { ...opts, withUnit: true });
  return `${fmtPace(fast)}–${fmtPace(slow, { ...opts, withUnit: true })}`;
}

/** parse "7:30" (pace in given unit) → sec/km */
export function parsePace(str, unit = unitPrefs.pace) {
  const sec = parseClock(str);
  if (!sec) return null;
  return unit === 'mi' ? sec / (M_PER_MI / 1000) : sec;
}

/** parse "1:45:30" / "25:10" / "45" (minutes) → seconds */
export function parseClock(str) {
  if (str == null) return null;
  str = String(str).trim();
  if (!str) return null;
  const parts = str.split(':').map((p) => p.trim());
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0] * 60;
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}

export function fmtClockInput(sec) {
  if (!sec) return '';
  return fmtDuration(sec);
}

export const RACE_DISTANCES = {
  mile: { m: M_PER_MI, label: '1 mile' },
  '5k': { m: 5000, label: '5K' },
  '10k': { m: 10000, label: '10K' },
  half: { m: 21097.5, label: 'Half marathon' },
  marathon: { m: 42195, label: 'Marathon' },
};
