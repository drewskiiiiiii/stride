// Step-by-step onboarding questionnaire (sections A–F) and plan preview.

import { esc, icon, toast, opts } from './dom.js';
import { store } from '../core/store.js';
import { prefs } from '../core/storage.js';
import { setUnitPrefs, fmtDist, fmtDuration, parseClock, parsePace, fmtPace, fromDisplayDist, toDisplayDist, M_PER_MI } from '../core/units.js';
import { GOALS, BENCHMARK_LABEL, evaluateFitness, checkGoal, goalInfo } from '../engine/assessment.js';
import { DAY_SHORT, DAY_NAMES, todayISO, fmtLongDate, fmtDate, addDays } from '../core/dates.js';
import { EQUIPMENT_OPTIONS } from '../engine/strength.js';
import { renderPreview, bindPreview } from './preview.js';

const DRAFT_KEY = 'stride.onboardingDraft';

export function defaultAnswers() {
  const p = prefs.get();
  return {
    age: '', sex: '', heightCm: '', weightKg: '', heightUnit: p.distance === 'mi' ? 'imperial' : 'metric', ft: '', inch: '', lb: '',
    distance: p.distance, pace: p.pace, hr: p.hr, maxHr: '',
    experience: '', frequency: null, weekly: '', longest: '', continuousMin: '', easyPace: '', easyUnknown: false,
    benchmarks: [], assessment: 'none',
    goal: '', customDist: '', targetTime: '', raceDate: '', desiredWeekly: '', orientation: '',
    daysPerWeek: 4, days: [1, 3, 5, 6], longRunDay: 6, weekdayMin: 60, weekendMin: 120, timeOfDay: 'morning',
    mode: 'distance', treadmill: false, outdoors: true, track: false,
    strength: false, strengthSessions: 2, strengthMinutes: 25, equipment: ['none'],
    mobility: true, mobilitySessions: 2, mobilityMinutes: 15,
    intensityBy: 'pace', progression: 'moderate',
    injuryStatus: 'none', painNow: false, injuryNotes: '',
    startDate: todayISO(),
  };
}

function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function saveDraft(a, step) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ a, step })); } catch { /* ignore */ } }
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

const isRaceGoal = (g) => GOALS.find((x) => x.id === g)?.race;
const du = (a) => (a.distance === 'mi' ? 'mi' : 'km');

/** Convert answers to engine inputs. */
export function answersToInputs(a) {
  const dist = (v) => (v === '' || v == null ? 0 : fromDisplayDist(Number(v), a.distance));
  let heightCm = Number(a.heightCm) || null;
  if (a.heightUnit === 'imperial' && (a.ft || a.inch)) heightCm = Math.round(((Number(a.ft) || 0) * 12 + (Number(a.inch) || 0)) * 2.54);
  let weightKg = Number(a.weightKg) || null;
  if (a.heightUnit === 'imperial' && a.lb) weightKg = Math.round(Number(a.lb) * 0.4536 * 10) / 10;
  const benchmarks = (a.benchmarks || []).filter((b) => b.timeSec).map((b) => ({ dist: b.dist, timeSec: b.timeSec, date: b.date || null }));
  const goalDef = GOALS.find((g) => g.id === a.goal) || GOALS[0];
  return {
    profile: { age: Number(a.age) || null, sex: a.sex || null, heightCm, weightKg, maxHr: Number(a.maxHr) || null },
    unit: a.distance,
    fitness: {
      experience: a.experience || 'beginner', frequency: a.frequency ?? 0,
      weeklyDist: dist(a.weekly), longestRun: dist(a.longest), longestContinuousMin: a.continuousMin === '' ? null : Number(a.continuousMin),
      easyPace: a.easyUnknown ? null : parsePace(a.easyPace, a.pace), benchmarks,
    },
    goal: {
      type: goalDef.id, distanceM: a.goal === 'custom' ? dist(a.customDist) : goalDef.distanceM,
      targetTimeSec: parseClock(a.targetTime) || null, raceDate: a.raceDate || null,
      desiredWeeklyM: a.desiredWeekly ? dist(a.desiredWeekly) : null, orientation: a.orientation || goalDef.orientation || null,
    },
    availability: { daysPerWeek: Math.min(a.daysPerWeek, a.days.length), days: a.days.slice().sort(), longRunDay: a.longRunDay, weekdayMin: Number(a.weekdayMin) || 60, weekendMin: Number(a.weekendMin) || 120, timeOfDay: a.timeOfDay },
    prefs: {
      mode: a.mode, treadmill: a.treadmill, outdoors: a.outdoors, track: a.track,
      strength: { on: a.strength, sessions: a.strengthSessions, minutes: a.strengthMinutes, equipment: a.equipment },
      mobility: { on: a.mobility, sessions: a.mobilitySessions, minutes: a.mobilityMinutes },
      intensityBy: a.intensityBy, progression: a.progression,
    },
    injury: { has: a.injuryStatus !== 'none', status: a.injuryStatus, painNow: !!a.painNow, notes: a.injuryNotes || '' },
    startDate: a.startDate && a.startDate >= todayISO() ? a.startDate : todayISO(),
    assessment: a.assessment,
    adjustments: [],
  };
}

// ---------- step definitions ----------
const opt = (key, value, title, sub = '', multi = false, sel = false) => `
  <button type="button" class="opt ${multi ? 'check' : ''} ${sel ? 'sel' : ''}" data-opt="${key}" data-val="${esc(value)}" ${multi ? 'data-multi' : ''}>
    <span class="radio"></span><span class="grow"><div class="ot">${esc(title)}</div>${sub ? `<div class="os">${esc(sub)}</div>` : ''}</span>
  </button>`;
const seg = (key, list, val) => `<div class="seg">${list.map(([v, l]) => `<button type="button" data-seg="${key}" data-val="${esc(v)}" class="${String(val) === String(v) ? 'sel' : ''}">${esc(l)}</button>`).join('')}</div>`;
const toggle = (key, on, title, sub = '') => `<label class="setting" style="padding:12px 2px"><div class="grow"><div class="t">${esc(title)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div><span class="toggle"><input type="checkbox" data-tog="${key}" ${on ? 'checked' : ''}><span></span></span></label>`;
const input = (key, val, { type = 'text', ph = '', suffix = '', mode = 'decimal', min, max } = {}) => `<div class="${suffix ? 'unit-suffix' : ''}"><input class="input" data-in="${key}" type="${type}" inputmode="${mode}" placeholder="${esc(ph)}" value="${esc(val ?? '')}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}>${suffix ? `<span>${esc(suffix)}</span>` : ''}</div>`;

const STEPS = [
  {
    id: 'personal', section: 'A · About you', title: 'Let’s start with the basics',
    lead: 'This helps estimate heart-rate zones and recovery needs. Optional fields can be left blank.',
    body: (a) => `
      <label class="field"><span class="lbl">Age</span>${input('age', a.age, { mode: 'numeric', ph: 'e.g. 34', suffix: 'yrs' })}</label>
      <div class="field"><span class="lbl">Sex <span class="muted small">(optional)</span></span>${seg('sex', [['female', 'Female'], ['male', 'Male'], ['', 'Prefer not to say']], a.sex)}</div>
      <div class="field"><span class="lbl">Height &amp; weight</span>${seg('heightUnit', [['imperial', 'ft / lb'], ['metric', 'cm / kg']], a.heightUnit)}</div>
      ${a.heightUnit === 'imperial'
        ? `<div class="input-group field">${input('ft', a.ft, { mode: 'numeric', ph: '5', suffix: 'ft' })}${input('inch', a.inch, { mode: 'numeric', ph: '10', suffix: 'in' })}</div>
           <label class="field"><span class="lbl">Weight <span class="muted small">(optional)</span></span>${input('lb', a.lb, { ph: '170', suffix: 'lb' })}</label>`
        : `<label class="field">${input('heightCm', a.heightCm, { mode: 'numeric', ph: '178', suffix: 'cm' })}</label>
           <label class="field"><span class="lbl">Weight <span class="muted small">(optional)</span></span>${input('weightKg', a.weightKg, { ph: '75', suffix: 'kg' })}</label>`}`,
    valid: (a) => (!a.age || (a.age >= 10 && a.age <= 100)) || 'Please enter an age between 10 and 100.',
  },
  {
    id: 'units', section: 'A · About you', title: 'How do you like your numbers?',
    lead: 'You can change these any time in Settings.',
    body: (a) => `
      <div class="field"><span class="lbl">Distance</span>${seg('distance', [['mi', 'Miles'], ['km', 'Kilometres']], a.distance)}</div>
      <div class="field"><span class="lbl">Pace</span>${seg('pace', [['mi', 'min / mile'], ['km', 'min / km']], a.pace)}</div>
      <div class="field"><span class="lbl">Heart rate</span>${seg('hr', [['bpm', 'BPM'], ['pct', '% of max HR']], a.hr)}</div>
      <label class="field"><span class="lbl">Maximum heart rate <span class="muted small">(optional)</span></span>${input('maxHr', a.maxHr, { mode: 'numeric', ph: a.age ? `Estimated ${Math.round(208 - 0.7 * a.age)}` : 'e.g. 186', suffix: 'bpm' })}<span class="hint">Leave blank to estimate from age (208 − 0.7 × age).</span></label>`,
  },
  {
    id: 'experience', section: 'B · Current fitness', title: 'How would you describe your running experience?', lead: '',
    body: (a) => `<div class="options">${[
      ['beginner', 'Complete beginner', 'New to running or never run regularly'],
      ['returning', 'Returning after a long break', 'Used to run, been away for months or more'],
      ['recreational', 'Recreational runner', 'Run for fun a few times a week'],
      ['intermediate', 'Intermediate runner', 'Consistent training, done some races'],
      ['advanced', 'Advanced runner', 'Structured training, high weekly volume'],
    ].map(([v, t, s]) => opt('experience', v, t, s, false, a.experience === v)).join('')}</div>`,
    valid: (a) => !!a.experience || 'Choose the option that fits best.',
  },
  {
    id: 'frequency', section: 'B · Current fitness', title: 'How often are you running right now?', lead: '',
    body: (a) => `<div class="options">${[[0, 'Not currently running'], [1, '1 day per week'], [2, '2 days per week'], [3, '3 days per week'], [4, '4+ days per week']]
      .map(([v, t]) => opt('frequency', v, t, '', false, a.frequency === v)).join('')}</div>`,
    valid: (a) => a.frequency != null || 'Choose one option.',
  },
  {
    id: 'volume', section: 'B · Current fitness', title: 'Your recent running',
    lead: 'Rough numbers are fine. Enter 0 if you are not running yet.',
    skip: (a) => a.frequency === 0 && a.experience === 'beginner',
    body: (a) => `
      <label class="field"><span class="lbl">Average weekly distance</span>${input('weekly', a.weekly, { ph: '0', suffix: du(a) })}</label>
      <label class="field"><span class="lbl">Longest run in the last 30 days</span>${input('longest', a.longest, { ph: '0', suffix: du(a) })}</label>
      <label class="field"><span class="lbl">Longest you can currently run without stopping</span>${input('continuousMin', a.continuousMin, { mode: 'numeric', ph: 'e.g. 30', suffix: 'min' })}<span class="hint">Used to decide whether to start with run–walk intervals.</span></label>`,
  },
  {
    id: 'beginnerCont', section: 'B · Current fitness', title: 'How long can you run without stopping?',
    lead: 'No judgement — everyone starts somewhere. This sets your first workouts.',
    skip: (a) => !(a.frequency === 0 && a.experience === 'beginner'),
    body: (a) => `<div class="options">${[[0, 'I can’t run continuously yet'], [1, 'About 1 minute'], [3, '2–4 minutes'], [8, '5–10 minutes'], [15, '10–20 minutes'], [25, '20–30 minutes']]
      .map(([v, t]) => opt('continuousMin', v, t, '', false, Number(a.continuousMin) === v && a.continuousMin !== '')).join('')}</div>`,
    valid: (a) => a.continuousMin !== '' || 'Choose one option.',
  },
  {
    id: 'easyPace', section: 'B · Current fitness', title: 'What is your typical easy pace?',
    lead: 'The pace of a relaxed, conversational run. If you are not sure, that is completely fine.',
    skip: (a) => a.frequency === 0,
    body: (a) => `
      <label class="field"><span class="lbl">Easy pace</span>${input('easyPace', a.easyPace, { mode: 'text', ph: a.pace === 'mi' ? '10:30' : '6:30', suffix: a.pace === 'mi' ? 'min/mi' : 'min/km' })}<span class="hint">Format mm:ss</span></label>
      ${toggle('easyUnknown', a.easyUnknown, 'I don’t know my pace', 'We will use effort and breathing cues instead of inventing pace targets.')}`,
    valid: (a) => a.easyUnknown || !a.easyPace || parsePace(a.easyPace, a.pace) ? true : 'Enter pace as mm:ss, e.g. 9:45',
  },
  {
    id: 'benchmarks', section: 'B · Current fitness', title: 'Any recent race or time-trial results?',
    lead: 'Add as many as you have. Recent results produce the most accurate training paces.',
    body: (a) => `
      <div data-bench-list>${(a.benchmarks || []).map((b, i) => `
        <div class="bench-row">
          <select class="input" data-bench="${i}" data-k="dist">${opts(Object.entries(BENCHMARK_LABEL).filter(([k]) => k !== '3k').map(([value, label]) => ({ value, label })), b.dist)}</select>
          <input class="input" data-bench="${i}" data-k="time" inputmode="text" placeholder="mm:ss or h:mm:ss" value="${esc(b.timeText || '')}">
          <input class="input" data-bench="${i}" data-k="date" type="date" max="${todayISO()}" value="${esc(b.date || '')}">
          <button type="button" class="icon-btn plain" data-bench-del="${i}" aria-label="Remove">${icon('x', 'sm')}</button>
        </div>`).join('')}</div>
      <button type="button" class="btn ghost block" data-bench-add>${icon('plus', 'sm')} Add a result</button>
      <div class="divider"></div>
      <div class="field"><span class="lbl">Don’t know your current fitness?</span>
        <div class="options">
          ${opt('assessment', 'none', 'Skip for now', 'Start with effort-based targets', false, a.assessment === 'none')}
          ${opt('assessment', 'gentle', '20-minute run/walk assessment', 'Best for new or returning runners', false, a.assessment === 'gentle')}
          ${opt('assessment', 'mile', '1-mile time trial', 'Quick test after a warm-up', false, a.assessment === 'mile')}
          ${opt('assessment', '5k', '5K time trial', 'Most accurate for experienced runners', false, a.assessment === '5k')}
        </div><span class="hint">An assessment is added as your first workout. Its result sets your pace zones.</span></div>`,
    valid: (a) => {
      for (const b of a.benchmarks || []) if (b.timeText && !b.timeSec) return 'Check your result times (mm:ss or h:mm:ss).';
      return true;
    },
  },
  {
    id: 'goal', section: 'C · Your goal', title: 'What is your main goal?', lead: 'Pick one primary goal. You can start a new plan for the next goal later.',
    body: (a) => `<div class="options">${GOALS.map((g) => opt('goal', g.id, g.label, '', false, a.goal === g.id)).join('')}</div>`,
    valid: (a) => !!a.goal || 'Choose a goal.',
  },
  {
    id: 'goalDetail', section: 'C · Your goal', title: 'Goal details', lead: 'Everything here is optional — leave blank and we will choose sensible defaults.',
    body: (a) => {
      const race = isRaceGoal(a.goal) || a.goal === 'speed';
      return `
      ${a.goal === 'custom' ? `<label class="field"><span class="lbl">Target race distance</span>${input('customDist', a.customDist, { ph: a.distance === 'mi' ? '8' : '15', suffix: du(a) })}</label>` : ''}
      ${race ? `<label class="field"><span class="lbl">Target finishing time</span>${input('targetTime', a.targetTime, { mode: 'text', ph: 'h:mm:ss or mm:ss' })}<span class="hint">Leave blank to train for completion or to let the app estimate.</span></label>` : ''}
      ${isRaceGoal(a.goal) ? `<label class="field"><span class="lbl">Race date</span><input class="input" type="date" data-in="raceDate" min="${addDays(todayISO(), 7)}" value="${esc(a.raceDate)}"><span class="hint">Without a date, the plan length is chosen for you and ends with a goal-effort run.</span></label>` : ''}
      <label class="field"><span class="lbl">Desired peak weekly distance</span>${input('desiredWeekly', a.desiredWeekly, { ph: 'Let the coach decide', suffix: du(a) })}</label>
      ${isRaceGoal(a.goal) ? `<div class="field"><span class="lbl">Is this goal about finishing or performance?</span>${seg('orientation', [['complete', 'Finish comfortably'], ['performance', 'Run my best time']], a.orientation || (a.goal.endsWith('improve') ? 'performance' : 'complete'))}</div>` : ''}
      <label class="field"><span class="lbl">Plan start date</span><input class="input" type="date" data-in="startDate" min="${todayISO()}" value="${esc(a.startDate)}"></label>`;
    },
    valid: (a) => {
      if (a.goal === 'custom' && !(Number(a.customDist) > 0)) return 'Enter the custom race distance.';
      if (a.targetTime && !parseClock(a.targetTime)) return 'Enter target time as h:mm:ss or mm:ss.';
      if (a.raceDate && a.raceDate < addDays(todayISO(), 7)) return 'Race date should be at least a week away.';
      return true;
    },
  },
  {
    id: 'days', section: 'D · Availability', title: 'When can you run?',
    lead: 'Select every day you could run. Unselected days are treated as unavailable and stay workout-free.',
    body: (a) => `
      <div class="field"><span class="lbl">Available days</span><div class="day-picker">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-day="${d}" class="${a.days.includes(d) ? 'sel' : ''}">${DAY_SHORT[d]}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">How many days per week do you want to run?</span>${seg('daysPerWeek', [2, 3, 4, 5, 6, 7].filter((n) => n <= Math.max(2, a.days.length)).map((n) => [n, String(n)]), Math.min(a.daysPerWeek, a.days.length))}</div>
      <label class="field"><span class="lbl">Long-run day</span><select class="input" data-in="longRunDay">${opts(a.days.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map((d) => ({ value: d, label: DAY_NAMES[d] })), a.longRunDay)}</select></label>`,
    valid: (a) => (a.days.length >= 2 ? true : 'Select at least two days.'),
  },
  {
    id: 'time', section: 'D · Availability', title: 'How much time do you have?', lead: 'Workouts are sized to fit. Long runs use the weekend limit if your long-run day is Saturday or Sunday.',
    body: (a) => `
      <label class="field"><span class="lbl">Weekday runs — up to</span><select class="input" data-in="weekdayMin">${opts([30, 45, 60, 75, 90, 120].map((v) => ({ value: v, label: `${v} minutes` })), a.weekdayMin)}</select></label>
      <label class="field"><span class="lbl">Weekend runs — up to</span><select class="input" data-in="weekendMin">${opts([45, 60, 90, 120, 150, 180, 210, 240].map((v) => ({ value: v, label: v >= 60 ? `${Math.floor(v / 60)} h${v % 60 ? ' ' + (v % 60) + ' min' : ''}` : `${v} minutes` })), a.weekendMin)}</select></label>
      <div class="field"><span class="lbl">Preferred time of day</span>${seg('timeOfDay', [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']], a.timeOfDay)}</div>`,
  },
  {
    id: 'prefs', section: 'E · Preferences', title: 'Training preferences', lead: '',
    body: (a) => `
      <div class="field"><span class="lbl">Workout format</span>${seg('mode', [['distance', 'Distance-based'], ['time', 'Time-based']], a.mode)}</div>
      ${toggle('outdoors', a.outdoors, 'I mainly run outdoors')}
      ${toggle('treadmill', a.treadmill, 'I have access to a treadmill')}
      ${toggle('track', a.track, 'I have access to a running track', 'Intervals will use exact distances like 400m and 800m')}
      <div class="field" style="margin-top:14px"><span class="lbl">Intensity guidance</span>${seg('intensityBy', [['pace', 'Pace-based'], ['hr', 'Heart-rate-based']], a.intensityBy)}</div>
      <div class="field"><span class="lbl">Training progression</span><div class="options">
        ${opt('progression', 'gradual', 'Gradual', 'Smaller weekly increases, more conservative', false, a.progression === 'gradual')}
        ${opt('progression', 'moderate', 'Moderate', 'Balanced, recommended for most', false, a.progression === 'moderate')}
        ${opt('progression', 'aggressive', 'Aggressive', 'Faster build — for durable, experienced runners', false, a.progression === 'aggressive')}
      </div></div>`,
  },
  {
    id: 'supplemental', section: 'E · Preferences', title: 'Strength & mobility', lead: 'Running-specific strength reduces injury risk and improves economy. These appear on your calendar alongside runs.',
    body: (a) => `
      ${toggle('strength', a.strength, 'Include strength training')}
      ${a.strength ? `<div class="card flat" style="margin:6px 0 14px">
        <div class="field"><span class="lbl">Sessions per week</span>${seg('strengthSessions', [[1, '1'], [2, '2'], [3, '3']], a.strengthSessions)}</div>
        <div class="field"><span class="lbl">Session length</span>${seg('strengthMinutes', [[15, '15 min'], [25, '25 min'], [35, '35 min'], [45, '45 min']], a.strengthMinutes)}</div>
        <div class="field" style="margin:0"><span class="lbl">Equipment</span><div class="options cols-2">${EQUIPMENT_OPTIONS.map((e) => opt('equipment', e.id, e.label, '', true, a.equipment.includes(e.id))).join('')}</div></div>
      </div>` : ''}
      ${toggle('mobility', a.mobility, 'Include mobility & recovery sessions')}
      ${a.mobility ? `<div class="card flat" style="margin:6px 0">
        <div class="field"><span class="lbl">Sessions per week</span>${seg('mobilitySessions', [[1, '1'], [2, '2'], [3, '3']], a.mobilitySessions)}</div>
        <div class="field" style="margin:0"><span class="lbl">Session length</span>${seg('mobilityMinutes', [[10, '10 min'], [15, '15 min'], [20, '20 min']], a.mobilityMinutes)}</div>
      </div>` : ''}`,
  },
  {
    id: 'injury', section: 'F · Injury & recovery', title: 'Anything we should know about?',
    lead: 'This app does not diagnose injuries or prescribe rehabilitation, but it will train more conservatively when needed.',
    body: (a) => `
      <div class="options">
        ${opt('injuryStatus', 'none', 'No limitations', '', false, a.injuryStatus === 'none')}
        ${opt('injuryStatus', 'previous', 'Previous injury, fully recovered', 'We will progress more gradually', false, a.injuryStatus === 'previous')}
        ${opt('injuryStatus', 'current', 'Current limitation or restriction', 'e.g. a niggle, advice from a clinician', false, a.injuryStatus === 'current')}
      </div>
      ${a.injuryStatus !== 'none' ? `<div style="margin-top:14px">${toggle('painNow', a.painNow, 'I currently have pain when running')}</div>` : ''}
      ${a.painNow ? `<div class="notice danger" style="margin:10px 0">${icon('alert', 'sm')}<div><b>Please get this checked.</b> Pain while running should be evaluated by a doctor or physiotherapist. Your plan will hold volume steady and remove hard sessions until you update this in your profile.</div></div>` : ''}
      <label class="field" style="margin-top:14px"><span class="lbl">Additional information <span class="muted small">(optional)</span></span><textarea class="input" data-in="injuryNotes" placeholder="e.g. Recovering from a calf strain; physio said avoid hills for 4 weeks">${esc(a.injuryNotes)}</textarea></label>`,
  },
];

export function renderOnboarding(root, { editing = false, onDone, startAt = null } = {}) {
  const draft = !editing && loadDraft();
  let a = draft?.a || (editing && store.state.profile?.answers ? JSON.parse(JSON.stringify(store.state.profile.answers)) : defaultAnswers());
  let step = draft ? draft.step : editing ? 0 : -1; // -1 = welcome
  let errorMsg = '';

  const visible = () => STEPS.filter((s) => !(s.skip && s.skip(a)));
  if (editing) { a.startDate = todayISO(); if (startAt) step = Math.max(0, visible().findIndex((s) => s.id === startAt)); }

  function draw() {
    if (step === -1) { root.innerHTML = welcomeHtml(); bindWelcome(); return; }
    const vs = visible();
    if (step >= vs.length) { showPreview(); return; }
    const s = vs[step];
    const pct = Math.round(((step + 1) / (vs.length + 1)) * 100);
    root.innerHTML = `
      <div class="ob fade-in">
        <div class="ob-top">
          <button class="icon-btn plain" data-back aria-label="Back">${icon('chevL')}</button>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <span class="tiny muted num">${step + 1}/${vs.length}</span>
        </div>
        <div class="ob-section-label">${esc(s.section)}</div>
        <h1>${esc(s.title)}</h1>
        ${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : '<div style="height:12px"></div>'}
        <form data-form onsubmit="return false">${s.body(a)}</form>
        ${errorMsg ? `<div class="notice warn" style="margin-top:12px">${icon('alert', 'sm')}<div>${esc(errorMsg)}</div></div>` : ''}
      </div>
      <div class="ob-foot"><div class="inner">
        <button class="btn primary lg" data-next>${step === vs.length - 1 ? 'Build my plan' : 'Continue'} ${icon('chevR', 'sm')}</button>
      </div></div>`;
    bindStep();
  }

  function welcomeHtml() {
    return `<div class="welcome fade-in">
      <div class="welcome-art">${heroArt()}</div>
      <div class="brand"><span class="brand-mark">${icon('bolt')}</span> Stride</div>
      <h1>Your personal running coach.</h1>
      <p>A plan built around your fitness, schedule and goal — with guided workouts that work offline, anywhere you run.</p>
      <button class="btn primary lg block" data-start>Get started ${icon('chevR', 'sm')}</button>
      <p class="tiny muted center" style="margin-top:14px">About 3 minutes · All data stays on this device</p>
      <button class="link-btn" data-import style="display:block;margin:6px auto 0">Restore from a backup</button>
      <input type="file" accept="application/json,.json" data-import-file hidden>
    </div>`;
  }

  function bindWelcome() {
    root.querySelector('[data-start]').onclick = () => { step = 0; saveDraft(a, step); draw(); };
    const file = root.querySelector('[data-import-file]');
    root.querySelector('[data-import]').onclick = () => file.click();
    file.onchange = async () => {
      try { const data = JSON.parse(await file.files[0].text()); await store.importData(data); toast('Backup restored'); location.hash = '#/today'; onDone && onDone(); }
      catch (e) { toast(e.message || 'Could not read that file'); }
    };
  }

  function readInputs() {
    root.querySelectorAll('[data-in]').forEach((el) => {
      const k = el.dataset.in;
      let v = el.value;
      if (['longRunDay', 'weekdayMin', 'weekendMin'].includes(k)) v = Number(v);
      a[k] = v;
    });
    root.querySelectorAll('[data-tog]').forEach((el) => { a[el.dataset.tog] = el.checked; });
    root.querySelectorAll('[data-bench]').forEach((el) => {
      const b = a.benchmarks[Number(el.dataset.bench)];
      if (!b) return;
      if (el.dataset.k === 'dist') b.dist = el.value;
      if (el.dataset.k === 'time') { b.timeText = el.value; b.timeSec = parseClock(el.value); }
      if (el.dataset.k === 'date') b.date = el.value;
    });
  }

  function bindStep() {
    const NUMERIC = new Set(['frequency', 'continuousMin', 'daysPerWeek', 'strengthSessions', 'strengthMinutes', 'mobilitySessions', 'mobilityMinutes']);
    root.querySelector('[data-back]').onclick = () => { readInputs(); errorMsg = ''; if (step === 0) { if (editing) { onDone && onDone(); return; } step = -1; } else step--; saveDraft(a, step); draw(); };
    root.querySelectorAll('[data-opt]').forEach((b) => b.onclick = () => {
      readInputs();
      const k = b.dataset.opt; const v = NUMERIC.has(k) ? Number(b.dataset.val) : b.dataset.val;
      if (b.hasAttribute('data-multi')) {
        const set = new Set(a[k]); set.has(v) ? set.delete(v) : set.add(v); a[k] = [...set];
        if (k === 'equipment' && !a[k].length) a[k] = ['none'];
      } else a[k] = v;
      if (k === 'goal') { a.orientation = ''; if (!isRaceGoal(v)) a.raceDate = ''; }
      if (k === 'experience' && v === 'beginner' && a.frequency == null) a.frequency = 0;
      draw();
    });
    root.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => {
      readInputs(); const k = b.dataset.seg; a[k] = NUMERIC.has(k) ? Number(b.dataset.val) : b.dataset.val;
      if (k === 'distance') { a.pace = a.distance; }
      draw();
    });
    root.querySelectorAll('[data-tog]').forEach((t) => t.onchange = () => { readInputs(); if (t.dataset.tog === 'easyUnknown' && t.checked) a.easyPace = ''; if (t.dataset.tog === 'injuryStatus') {} draw(); });
    root.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => {
      readInputs(); const d = Number(b.dataset.day);
      a.days = a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d];
      if (!a.days.includes(a.longRunDay)) a.longRunDay = a.days.includes(6) ? 6 : a.days.includes(0) ? 0 : a.days[a.days.length - 1];
      a.daysPerWeek = Math.min(Math.max(a.daysPerWeek, 2), Math.max(2, a.days.length));
      draw();
    });
    const add = root.querySelector('[data-bench-add]');
    if (add) add.onclick = () => { readInputs(); a.benchmarks.push({ dist: '5k', timeText: '', timeSec: null, date: '' }); draw(); };
    root.querySelectorAll('[data-bench-del]').forEach((b) => b.onclick = () => { readInputs(); a.benchmarks.splice(Number(b.dataset.benchDel), 1); draw(); });
    root.querySelector('[data-next]').onclick = () => {
      readInputs();
      if (a.injuryStatus === 'none') a.painNow = false;
      const vs = visible(); const s = vs[step];
      const ok = s.valid ? s.valid(a) : true;
      if (ok !== true) { errorMsg = ok; draw(); return; }
      errorMsg = ''; step++; saveDraft(a, step);
      if (s.id === 'units') { prefs.set({ distance: a.distance, pace: a.pace, hr: a.hr }); setUnitPrefs({ distance: a.distance, pace: a.pace }); }
      draw(); window.scrollTo(0, 0);
    };
    root.querySelectorAll('.input[data-in]').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('[data-next]').click(); }));
  }

  function showPreview() {
    const inputs = answersToInputs(a);
    const res = store.preview(inputs, editing && store.state.plan ? null : null);
    root.innerHTML = renderPreview(res, { editing });
    bindPreview(root, res, {
      onEdit: (stepId) => { const vs = visible(); step = Math.max(0, vs.findIndex((s) => s.id === stepId)); draw(); },
      onBack: () => { step = visible().length - 1; draw(); },
      onActivate: async (preview) => {
        const profile = { ...(store.state.profile || {}), answers: a, inputs, onboardedAt: store.state.profile?.onboardedAt || new Date().toISOString() };
        await store.saveProfile(profile);
        await store.activate(preview);
        if (inputs.assessment && inputs.assessment !== 'none') await (await import('./actions.js')).scheduleAssessment(inputs.assessment);
        clearDraft();
        toast('Your plan is ready. Let’s go!');
        onDone && onDone();
        location.hash = '#/today';
      },
      onRegenerate: (patch) => { Object.assign(a, patch); saveDraft(a, step); showPreview(); },
    });
    window.scrollTo(0, 0);
  }

  draw();
}

function heroArt() {
  return `<svg viewBox="0 0 320 220" width="300" aria-hidden="true">
    <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stop-color="#3ba7ff"/><stop offset="0.55" stop-color="#c8ff2e"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient></defs>
    <g opacity="0.18" stroke="#fff">${Array.from({ length: 7 }, (_, i) => `<line x1="0" x2="320" y1="${30 + i * 28}" y2="${30 + i * 28}"/>`).join('')}</g>
    <path d="M10 180 C 60 175, 70 120, 110 125 S 150 170, 185 140 S 230 60, 265 70 S 300 40, 312 30" fill="none" stroke="url(#g1)" stroke-width="7" stroke-linecap="round"/>
    <circle cx="312" cy="30" r="9" fill="#c8ff2e"/>
    ${[40, 80, 120, 160, 200, 240, 280].map((x, i) => `<rect x="${x - 9}" y="${200 - [22, 30, 26, 42, 36, 54, 48][i]}" width="18" height="${[22, 30, 26, 42, 36, 54, 48][i]}" rx="5" fill="${i === 6 ? '#c8ff2e' : 'rgba(255,255,255,0.14)'}"/>`).join('')}
  </svg>`;
}

export { fmtDist, fmtDuration, fmtPace, toDisplayDist, M_PER_MI, fmtLongDate, fmtDate, evaluateFitness, checkGoal, goalInfo };
