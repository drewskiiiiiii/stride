// Coaching insights for the Today dashboard — deterministic rules over plan + history.

import { addDays, diffDays, startOfWeek, fmtDate } from '../core/dates.js';
import { fmtDist } from '../core/units.js';
import { effectiveStatus, analyzePerformance, workloadCheck, completionStats } from '../engine/adjustments.js';
import { isRun, isHard } from '../engine/workout-utils.js';
import { analyzeTrends } from '../engine/performance.js';

export function weekStats(workouts, activities, weekStart, today) {
  const end = addDays(weekStart, 6);
  const ws = workouts.filter((w) => w.date >= weekStart && w.date <= end && w.status !== 'replaced');
  const runs = ws.filter((w) => isRun(w) && w.status !== 'skipped');
  const completed = runs.filter((w) => w.status === 'completed');
  const missed = runs.filter((w) => effectiveStatus(w, today) === 'missed');
  const remaining = runs.filter((w) => effectiveStatus(w, today) === 'planned');
  const acts = activities.filter((a) => a.date >= weekStart && a.date <= end && a.type !== 'strength' && a.type !== 'mobility');
  const doneDist = acts.reduce((s, a) => s + (a.distance || 0), 0);
  const targetDist = runs.reduce((s, w) => s + (w.estDistance || 0), 0);
  return { ws, runs, completed, missed, remaining, doneDist, targetDist, pct: runs.length ? Math.round((completed.length / runs.length) * 100) : 0 };
}

export function buildInsights({ plan, workouts, activities, today, checkins = {} }) {
  const out = [];
  if (!plan) return out;
  const ws = startOfWeek(today);
  const thisWeek = weekStats(workouts, activities, ws, today);
  const last4 = completionStats(workouts, addDays(ws, -28), addDays(ws, -1), today);

  // consistency
  if (last4.planned >= 4) {
    const pct = Math.round(last4.rate * 100);
    if (pct >= 85) out.push({ kind: 'ok', icon: 'sparkle', title: `${pct}% consistency over the last 4 weeks`, body: 'Consistency is the single biggest driver of improvement. You are doing the most important thing right.' });
    else if (pct >= 60) out.push({ kind: 'info', icon: 'calendar', title: `${pct}% of runs completed recently`, body: 'Solid. Prioritise the key sessions and long run when time is tight — easy runs are the first to drop.' });
    else out.push({ kind: 'warn', icon: 'calendar', title: `${pct}% of runs completed recently`, body: 'Life happens. If the plan feels like too much, reduce running days in Plan Adjustment so the training fits.' });
  } else if (thisWeek.completed.length >= 1) {
    out.push({ kind: 'ok', icon: 'sparkle', title: 'Great start', body: `${thisWeek.completed.length} run${thisWeek.completed.length > 1 ? 's' : ''} done this week. Small, repeatable wins build lasting fitness.` });
  }

  // recovery recommendation
  const yesterday = workouts.filter((w) => w.date === addDays(today, -1) && w.status === 'completed');
  const recentActs = activities.filter((a) => a.date >= addDays(today, -3));
  const highRpe = recentActs.filter((a) => a.rpe >= 8);
  if (yesterday.some((w) => isHard(w) || w.type === 'long')) out.push({ kind: 'info', icon: 'recovery', title: 'Recovery focus today', body: 'You completed a demanding session yesterday. Keep today genuinely easy — hydrate, eat well and sleep.' });
  else if (highRpe.length >= 2) out.push({ kind: 'warn', icon: 'heart', title: 'Recent sessions felt very hard', body: 'Two or more recent runs were rated 8+ effort. If you feel run-down, swap the next hard day for an easy run or rest.' });

  // explicitly submitted recovery feedback (daily check-in or after discarding a workout)
  const recentFb = [today, addDays(today, -1)].map((d) => checkins[d] && { ...checkins[d], d }).filter(Boolean).filter((c) => ['easy', 'rest', 'reduce'].includes(c.rec))[0];
  if (recentFb && !(recentFb.d === today && recentFb.source !== 'discard')) out.push({ kind: 'warn', icon: 'heart', title: recentFb.source === 'discard' ? 'You stopped a session to recover' : 'Recovery check-in flagged fatigue', body: 'You reported you weren’t fully recovered. Keep your next run conversational, and use the daily check-in before the next hard session — the plan itself is unchanged.' });

  // workload — struggling
  const wl = workloadCheck(workouts, activities, today);
  if (wl.struggling) out.push({ kind: 'warn', icon: 'alert', title: 'Hold the training load?', body: 'You have been missing sessions or rating effort high. Holding volume steady next week lets your body catch up without losing fitness.', action: { label: 'Hold volume next week', id: 'hold-volume' } });

  // multi-workout trends (pace suggestions themselves are shown as a coach card)
  try {
    const tr = analyzeTrends({ activities, workouts, plan, today });
    tr.trends.filter((x) => !/consistently faster|below target/.test(x.title)).slice(0, 2).forEach((x) => out.push({ kind: x.kind === 'up' ? 'ok' : 'warn', icon: x.kind === 'up' ? 'bolt' : 'info', title: x.title, body: x.body }));
  } catch (e) { /* analytics must never break the dashboard */ }

  // milestones
  const upcoming = workouts.filter((w) => w.date >= today && w.date <= addDays(today, 7) && w.status === 'planned');
  const pastLongest = activities.reduce((m, a) => Math.max(m, a.distance || 0), 0);
  const nextLong = upcoming.find((w) => w.type === 'long');
  if (nextLong && pastLongest > 0 && nextLong.estDistance > pastLongest * 1.02) out.push({ kind: 'accent', icon: 'flag', title: 'Milestone ahead', body: `${fmtDate(nextLong.date, { weekday: 'long' })}’s long run (${fmtDist(nextLong.estDistance)}) will be your longest logged run yet.` });
  const tt = upcoming.find((w) => w.type === 'timetrial' || w.type === 'assessment');
  if (tt) out.push({ kind: 'accent', icon: 'trophy', title: 'Fitness check this week', body: `${tt.title} on ${fmtDate(tt.date, { weekday: 'long' })}. Arrive rested — your result recalibrates every pace zone.` });
  const week = plan.weeks.find((w) => w.start <= today && w.end >= today);
  if (week?.recovery) out.push({ kind: 'info', icon: 'recovery', title: 'Recovery week', body: 'Volume is lower this week by design. This is when your body adapts to the last few weeks of work — resist adding extra.' });
  if (week && week.phase === 'taper') out.push({ kind: 'info', icon: 'sparkle', title: 'Taper time', body: 'Feeling restless or sluggish during a taper is normal. Trust the training — the hay is in the barn.' });

  if (plan.inputs?.injury?.painNow) out.unshift({ kind: 'danger', icon: 'alert', title: 'Pain reported', body: 'Your plan is holding volume and avoiding hard sessions. Please have it evaluated by a medical professional, then update your profile when you are cleared.' });
  return out.slice(0, 5);
}

export function raceCountdown(plan, today) {
  if (!plan?.raceDate) return null;
  const d = diffDays(today, plan.raceDate);
  return d >= 0 ? d : null;
}
