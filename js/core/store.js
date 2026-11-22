// Application state + persistence. UI modules read `store.state` and call store methods;
// every mutation is written to IndexedDB before the UI re-renders.

import { db } from './db.js';
import { todayISO, addDays } from './dates.js';
import { generatePlan } from '../engine/training-engine.js';
import { trainingPaces, vdotFromRace } from '../engine/vdot.js';
import { mergeRegenerated, benchmarkVdot } from '../engine/adjustments.js';
import { estimateWorkout, isRun } from '../engine/workout-utils.js';
import { BENCHMARK_DIST } from '../engine/assessment.js';
import { effectivePaces } from '../engine/performance.js';
import { summarizeChanges } from '../engine/scheduler.js';
import { migrateState, SCHEMA_VERSION, validateBackup, mergeBackup } from './migrate.js';

const listeners = new Set();
const clone = (o) => JSON.parse(JSON.stringify(o));

export const store = {
  state: { loaded: false, profile: null, plan: null, plans: [], workouts: [], activities: [], meta: { vdotHistory: [], races: [], checkins: {}, changeLog: [], paceDecisions: {} } },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit() { listeners.forEach((fn) => fn(this.state)); },
  today() { return todayISO(); },

  async load() {
    await migrateState(db);
    const [profile, plans, activities, vdotHistory, races, checkins, changeLog, paceDecisions] = await Promise.all([
      db.get('profile', 'main'), db.all('plans'), db.all('activities'), db.get('meta', 'vdotHistory'), db.get('meta', 'races'),
      db.get('meta', 'checkins'), db.get('meta', 'changeLog'), db.get('meta', 'paceDecisions'),
    ]);
    const plan = plans.find((p) => p.status === 'active') || null;
    const workouts = plan ? await db.byIndex('workouts', 'planId', plan.id) : [];
    workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    activities.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.startedAt || 0) - (a.startedAt || 0)));
    Object.assign(this.state, { loaded: true, profile: profile || null, plan, plans, workouts, activities, meta: { vdotHistory: vdotHistory || [], races: races || [], checkins: checkins || {}, changeLog: changeLog || [], paceDecisions: paceDecisions || {} } });
    this.emit();
  },

  async saveProfile(profile) {
    this.state.profile = profile;
    await db.put('profile', profile, 'main');
    this.emit();
  },

  /** Generate (without saving) a plan from profile inputs. */
  preview(inputs, planId) {
    const id = planId || `plan-${Date.now().toString(36)}`;
    const res = generatePlan(inputs, { planId: id, today: this.today() });
    res.plan.inputs = clone(inputs);
    return res;
  },

  async activate(preview, { name } = {}) {
    const now = new Date().toISOString();
    if (this.state.plan) {
      const old = { ...this.state.plan, status: 'archived', archivedAt: now };
      await db.put('plans', old);
      // Future, untouched workouts of the archived plan are removed; history is kept.
      const today = this.today();
      const drop = this.state.workouts.filter((w) => w.date >= today && w.status === 'planned' && w.source !== 'user').map((w) => w.id);
      await db.deleteMany('workouts', drop);
    }
    const plan = { ...preview.plan, status: 'active', createdAt: now, activatedAt: now, name: name || preview.plan.goal.label };
    await db.put('plans', plan);
    await db.putMany('workouts', preview.workouts);
    if (plan.vdot) await this.addVdotHistory(plan.vdot, 'plan', true);
    await this.load();
  },

  async archivePlan() {
    if (!this.state.plan) return;
    await db.put('plans', { ...this.state.plan, status: 'archived', archivedAt: new Date().toISOString() });
    await this.load();
  },

  async deleteArchived(planId) {
    const ws = await db.byIndex('workouts', 'planId', planId);
    await db.deleteMany('workouts', ws.map((w) => w.id));
    await db.delete('plans', planId);
    await this.load();
  },

  async archivedWorkouts(planId) { return db.byIndex('workouts', 'planId', planId); },

  workoutsOn(date) { return this.state.workouts.filter((w) => w.date === date && w.status !== 'replaced'); },
  workout(id) { return this.state.workouts.find((w) => w.id === id) || null; },

  async putWorkouts(list) {
    await db.putMany('workouts', list);
    const map = new Map(this.state.workouts.map((w) => [w.id, w]));
    list.forEach((w) => map.set(w.id, w));
    this.state.workouts = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    this.emit();
  },

  async removeWorkout(id) {
    await db.delete('workouts', id);
    this.state.workouts = this.state.workouts.filter((w) => w.id !== id);
    this.emit();
  },

  /**
   * Regenerate the active plan's future workouts after an inputs change.
   * mutate(inputs) edits a copy of the plan inputs. History and completed work are preserved.
   */
  async regenerate(mutate, { fromDate } = {}) {
    const plan = this.state.plan;
    if (!plan) return null;
    const inputs = clone(plan.inputs);
    mutate(inputs);
    const from = fromDate || this.today();
    const res = generatePlan(inputs, { planId: plan.id, today: this.today() });
    const merged = mergeRegenerated(this.state.workouts, res.workouts, from);
    const newPlan = { ...res.plan, inputs, status: 'active', createdAt: plan.createdAt, activatedAt: plan.activatedAt, name: plan.name, version: (plan.version || 1) + 1, updatedAt: new Date().toISOString(), paceOffsets: plan.paceOffsets || {} };
    if (newPlan.vdot && Object.keys(newPlan.paceOffsets).length) {
      newPlan.paces = effectivePaces(newPlan.vdot, newPlan.paceOffsets);
      merged.workouts = merged.workouts.map((w) => (w.date >= from && w.status === 'planned' && w.steps?.length && isRun(w) ? { ...w, ...pick(estimateWorkout(w.steps, newPlan.paces, newPlan.assumedEasy)) } : w));
    }
    const before = this.state.workouts;
    await db.put('plans', newPlan);
    await db.deleteMany('workouts', merged.removedIds);
    await db.putMany('workouts', merged.workouts.filter((w) => w.date >= from || w.status !== 'planned'));
    this.state.plan = newPlan;
    this.state.workouts = merged.workouts;
    this.lastSummary = summarizeChanges(before, merged.workouts, { beforePlan: plan, afterPlan: newPlan, today: this.today(), title: 'Plan updated', reason: '' });
    this.emit();
    return newPlan;
  },

  /**
   * Apply a change-set and record a summary of what changed and why.
   * change: { updates?: [workout], adjustments?: [adj], title, reason }
   */
  async applyChange(change) {
    const before = this.state.workouts.slice();
    const beforePlan = this.state.plan;
    if (change.updates?.length) await this.putWorkouts(change.updates);
    if (change.adjustments?.length) {
      await this.regenerate((inputs) => { inputs.adjustments = [...(inputs.adjustments || []), ...change.adjustments.map((a, i) => ({ id: a.id || `adj-${Date.now().toString(36)}${i}`, ...a }))]; });
    }
    const summary = summarizeChanges(before, this.state.workouts, { beforePlan, afterPlan: this.state.plan, today: this.today(), title: change.title, reason: change.reason, dropNote: !!change.adjustments?.length });
    await this.logChange(summary);
    return summary;
  },

  /** Regenerate with a mutation and log the result as a change. */
  async regenerateWithSummary(mutate, { title, reason }) {
    const before = this.state.workouts.slice();
    const beforePlan = this.state.plan;
    await this.regenerate(mutate);
    const summary = summarizeChanges(before, this.state.workouts, { beforePlan, afterPlan: this.state.plan, today: this.today(), title, reason, dropNote: true });
    await this.logChange(summary);
    return summary;
  },

  async logChange(summary) {
    const slim = { ...summary, moved: summary.moved.map((m) => ({ title: m.w.title, from: m.from, to: m.to })), removed: summary.removed.map((w) => ({ title: w.title, date: w.date })), added: summary.added.map((w) => ({ title: w.title, date: w.date })), modified: summary.modified.map((m) => ({ title: m.w.title, date: m.w.date })) };
    const log = [slim, ...(this.state.meta.changeLog || [])].slice(0, 60);
    this.state.meta.changeLog = log;
    await db.put('meta', log, 'changeLog');
  },

  async saveCheckin(date, checkin) {
    const c = { ...(this.state.meta.checkins || {}), [date]: checkin };
    this.state.meta.checkins = c;
    await db.put('meta', c, 'checkins');
    this.emit();
  },

  async recordPaceDecision(key, accepted) {
    const d = { ...(this.state.meta.paceDecisions || {}), [key]: { accepted, at: this.today() } };
    this.state.meta.paceDecisions = d;
    await db.put('meta', d, 'paceDecisions');
  },

  /** Accept an adaptive pace suggestion (overall VDOT or per-zone offsets). */
  async applyPaceSuggestion(sug) {
    if (sug.type === 'vdot') await this.setVdot(sug.newVdot, 'performance');
    else await this.setPaceOffsets(sug.newOffsets);
    await this.recordPaceDecision(sug.key, true);
  },

  async setPaceOffsets(offsets) {
    const plan = this.state.plan;
    if (!plan?.vdot) return;
    const paces = effectivePaces(plan.vdot, offsets);
    const newPlan = { ...plan, paces, paceOffsets: offsets, assumedEasy: (paces.easy[0] + paces.easy[1]) / 2 };
    await db.put('plans', newPlan);
    this.state.plan = newPlan;
    await this.refreshEstimates();
  },

  async refreshEstimates() {
    const plan = this.state.plan;
    const today = this.today();
    const updated = this.state.workouts.filter((w) => w.date >= today && w.status === 'planned' && w.steps?.length && isRun(w)).map((w) => ({ ...w, ...pick(estimateWorkout(w.steps, plan.paces, plan.assumedEasy)) }));
    await this.putWorkouts(updated);
  },

  /** Update training paces without restructuring the plan. A new fitness score resets per-zone offsets. */
  async setVdot(vdot, source = 'manual') {
    const plan = this.state.plan;
    if (!plan) return;
    const paces = trainingPaces(vdot);
    const inputs = { ...plan.inputs, vdotOverride: vdot };
    const newPlan = { ...plan, vdot, paces, paceOffsets: {}, paceConfidence: 'high', inputs, assumedEasy: (paces.easy[0] + paces.easy[1]) / 2 };
    await db.put('plans', newPlan);
    this.state.plan = newPlan;
    const today = this.today();
    const updated = this.state.workouts.filter((w) => w.date >= today && w.status === 'planned' && w.steps?.length && isRun(w)).map((w) => {
      const est = estimateWorkout(w.steps, paces, newPlan.assumedEasy);
      return { ...w, estDistance: est.distance, estDuration: est.duration };
    });
    await this.putWorkouts(updated);
    await this.addVdotHistory(vdot, source);
  },

  async addVdotHistory(vdot, source, quiet) {
    const h = this.state.meta.vdotHistory.slice();
    const date = this.today();
    const last = h[h.length - 1];
    if (last && last.date === date) h[h.length - 1] = { date, vdot, source };
    else h.push({ date, vdot, source });
    this.state.meta.vdotHistory = h;
    await db.put('meta', h, 'vdotHistory');
    if (!quiet) this.emit();
  },

  async saveActivity(act) {
    // duplicate guard: the same live session (same id) or an identical manual entry is saved once
    const dup = this.state.activities.find((a) => a.id !== act.id && a.date === act.date && a.startedAt === act.startedAt && Math.abs((a.distance || 0) - (act.distance || 0)) < 5 && a.duration === act.duration);
    if (dup) return { suggestion: null, duplicate: true };
    await db.put('activities', act);
    const i = this.state.activities.findIndex((a) => a.id === act.id);
    if (i >= 0) this.state.activities[i] = act; else this.state.activities.unshift(act);
    this.state.activities.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.startedAt || 0) - (a.startedAt || 0)));
    let suggestion = null;
    if (act.workoutId) {
      const w = this.workout(act.workoutId);
      if (w) {
        await this.putWorkouts([{ ...w, status: 'completed', activityId: act.id, completedAt: act.finishedAt || Date.now() }]);
        const b = benchmarkVdot(w, act);
        if (b && this.state.plan) suggestion = { ...b, current: this.state.plan.vdot };
      }
    }
    this.emit();
    return { suggestion };
  },

  async deleteActivity(id) {
    const act = this.state.activities.find((a) => a.id === id);
    await db.delete('activities', id);
    this.state.activities = this.state.activities.filter((a) => a.id !== id);
    if (act?.workoutId) {
      const w = this.workout(act.workoutId);
      if (w && w.activityId === id) await this.putWorkouts([{ ...w, status: 'planned', activityId: null }]);
    }
    this.emit();
  },

  async saveRaces(races) {
    this.state.meta.races = races;
    await db.put('meta', races, 'races');
    this.emit();
  },

  /** Personal records from activities, manual race results and onboarding benchmarks. */
  personalRecords() {
    const out = {};
    const consider = (key, timeSec, date, source) => {
      if (!timeSec) return;
      if (!out[key] || timeSec < out[key].timeSec) out[key] = { timeSec, date, source };
    };
    const bench = this.state.profile?.inputs?.fitness?.benchmarks || [];
    bench.forEach((b) => consider(b.dist, b.timeSec, b.date, 'Benchmark'));
    (this.state.meta.races || []).forEach((r) => consider(r.dist, r.timeSec, r.date, r.name || 'Race'));
    for (const a of this.state.activities) {
      if (a.distanceEstimated) continue;
      for (const [key, d] of Object.entries(BENCHMARK_DIST)) {
        if (key === '3k') continue;
        const lap = (a.laps || []).find((l) => l.kind === 'work' && l.distance >= d * 0.995 && l.distance <= d * 1.04);
        if (lap) consider(key, lap.duration * (d / lap.distance), a.date, a.title);
        else if (a.distance >= d * 0.995 && a.distance <= d * 1.03) consider(key, a.duration * (d / a.distance), a.date, a.title);
      }
    }
    const runs = this.state.activities.filter((a) => a.distance > 0 && a.type !== 'strength' && a.type !== 'mobility');
    const longest = runs.reduce((m, a) => (!m || a.distance > m.distance ? a : m), null);
    const fastest = runs.filter((a) => a.distance >= 1600 && a.avgPace && !a.distanceEstimated).reduce((m, a) => (!m || a.avgPace < m.avgPace ? a : m), null);
    return { races: out, longest, fastest };
  },

  async exportData() { const d = await db.exportAll(); d.schemaVersion = SCHEMA_VERSION; d.appVersion = '2.0.0'; return d; },
  validateBackup(data) { return validateBackup(data, this.state); },
  async importData(data, { mode = 'replace' } = {}) {
    if (mode === 'merge') await mergeBackup(db, data, this.state);
    else await db.importAll(data);
    await this.load();
  },
  async resetAll() { await db.clearAll(); await this.load(); },
};

function pick(e) { return { estDistance: e.distance, estDuration: e.duration }; }

export { vdotFromRace, addDays };
