// Effort coaching: what an RPE target means, how it should feel, and a sensible
// pace to *start* at when no measured pace zones exist yet. Pure — tested in Node.

import { ZONE_INFO } from './vdot.js';
import { zonePace } from './workout-utils.js';

/** The 1–10 Rate of Perceived Exertion scale used throughout Stride. */
export const RPE_SCALE = [
  { n: 1, name: 'Very light', feel: 'Walking around the house.' },
  { n: 2, name: 'Light', feel: 'Brisk walk — you could do this all day.' },
  { n: 3, name: 'Easy', feel: 'Gentle jog. Breathing barely changes; you can talk in full sentences.' },
  { n: 4, name: 'Comfortable', feel: 'Relaxed running. Still chatting easily, breathing a little deeper.' },
  { n: 5, name: 'Moderate', feel: 'Steady. You can talk, but you’d rather not tell long stories.' },
  { n: 6, name: 'Moderately hard', feel: 'Comfortably hard. Short sentences only.' },
  { n: 7, name: 'Hard', feel: 'A few words at a time. Breathing is deep and rhythmic.' },
  { n: 8, name: 'Very hard', feel: 'One or two words. You’re concentrating to hold it.' },
  { n: 9, name: 'Extremely hard', feel: 'Can’t talk. Only sustainable for a few minutes.' },
  { n: 10, name: 'Maximal', feel: 'All-out sprint finish. Seconds, not minutes.' },
];

/** Practical guidance per zone: talk test, breathing and how to start. */
const GUIDE = {
  walk: { talk: 'Easy conversation.', breathing: 'Normal breathing.', start: 'Walk briskly with relaxed arms.', check: 'You should feel your breathing settle completely before the next run.' },
  recovery: { talk: 'Full, easy conversation.', breathing: 'Through the nose is possible.', start: 'Start slower than feels natural — a shuffle is fine.', check: 'If you’re breathing harder after 5 minutes, slow down or walk for a minute.' },
  easy: { talk: 'You can speak in full sentences.', breathing: 'Relaxed, a little deeper than walking.', start: 'Start at the slowest jog that feels smooth, then settle into it.', check: 'After 5 minutes, try saying a full sentence out loud. If you can’t, slow down.' },
  long: { talk: 'Full sentences, comfortable conversation.', breathing: 'Relaxed and steady.', start: 'Start a touch slower than your easy runs — you need to save energy for the later miles.', check: 'The last 20 minutes should feel controlled, not like a struggle.' },
  steady: { talk: 'Short sentences.', breathing: 'Deeper, rhythmic breathing.', start: 'Start at your easy effort for a minute, then gradually press until talking becomes short sentences.', check: 'You should feel you could hold this for well over an hour.' },
  marathon: { talk: 'Short sentences.', breathing: 'Deep and controlled.', start: 'Settle in gradually over the first few minutes.', check: 'Controlled and rhythmic — not straining.' },
  tempo: { talk: 'A few words at a time.', breathing: 'Strong, rhythmic — about 3 steps in, 3 steps out.', start: 'Build up over the first minute; don’t sprint the opening.', check: 'Comfortably hard: you could keep going for 30–40 minutes if you had to.' },
  threshold: { talk: 'A few words only.', breathing: 'Hard but steady.', start: 'Ease into it over 30–60 seconds.', check: 'Hard but sustainable — the kind of effort you could race for about an hour.' },
  interval: { talk: 'One or two words.', breathing: 'Heavy breathing by the end of each rep.', start: 'Accelerate smoothly over the first 15 seconds — the first rep should feel controlled.', check: 'You should finish the last rep at the same speed as the first.' },
  rep: { talk: 'Not while running.', breathing: 'Fast, but form stays relaxed.', start: 'Accelerate quickly but stay smooth — it’s about form, not straining.', check: 'Full recovery between reps; quality over fatigue.' },
  hill: { talk: 'One or two words.', breathing: 'Hard by the top.', start: 'Drive with your arms and take short, quick steps.', check: 'Effort matters, not pace — you will naturally slow on the hill.' },
  stride: { talk: 'Not while striding.', breathing: 'Barely elevated — strides are short.', start: 'Build smoothly from jog to fast over 20 seconds, then ease off.', check: 'Fast and relaxed — never a flat-out sprint.' },
  fartlekOn: { talk: 'A few words.', breathing: 'Noticeably harder.', start: 'Pick up the pace smoothly — don’t sprint.', check: 'Around 10K race effort.' },
  race: { talk: 'Not really.', breathing: 'Hard throughout.', start: 'Start controlled — slightly slower than you think for the first part.', check: 'Finish strong.' },
};

export function parseRpe(rpe) {
  const m = String(rpe || '').match(/(\d+)(?:\D+(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || m[1])];
}

/**
 * Suggested starting pace range (sec/km) for an effort target.
 * basis: 'zones' (personal pace zones), 'easyPace' (from your typical easy pace),
 * 'experience' (estimated from experience level only — least certain).
 */
export function startingPace(zone, plan) {
  // strides and hills are short, effort-only efforts — a pace number would mislead
  if (!zone || ['race', 'stride', 'hill'].includes(zone)) return null;
  const paces = plan?.paces || null;
  const assumedEasy = plan?.assumedEasy || 420;
  if (paces && paces[zone]) return { range: [paces[zone][0], paces[zone][1]], basis: 'zones' };
  const mid = zonePace(zone, paces, assumedEasy);
  const basis = plan?.paceConfidence === 'low' ? 'easyPace' : 'experience';
  // a wider band when it's only an estimate; skew slower so the start is conservative
  const fast = mid * (basis === 'experience' ? 0.97 : 0.98);
  const slow = mid * (basis === 'experience' ? 1.08 : 1.05);
  return { range: [fast, slow], basis };
}

/** Everything the UI needs to explain an effort target. */
export function effortGuide(zone, plan) {
  const info = ZONE_INFO[zone] || {};
  const g = GUIDE[zone] || GUIDE.easy;
  const range = parseRpe(info.rpe);
  return {
    zone, name: info.name || 'Effort', rpe: info.rpe, range,
    scale: range ? RPE_SCALE.filter((s) => s.n >= range[0] && s.n <= range[1]) : [],
    effort: info.effort, ...g, start: g.start, startPace: startingPace(zone, plan),
  };
}
