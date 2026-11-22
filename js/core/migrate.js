// Data versioning, migrations, backup validation and duplicate-aware merging.

export const SCHEMA_VERSION = 2;

/** Ordered migrations. Each receives the db wrapper and upgrades data in place. */
const MIGRATIONS = {
  // v1 → v2: per-zone pace offsets, coaching meta stores, normalised activity laps
  2: async (db) => {
    const plans = await db.all('plans');
    await db.putMany('plans', plans.map((p) => ({ ...p, paceOffsets: p.paceOffsets || {} })));
    const acts = await db.all('activities');
    await db.putMany('activities', acts.map((a) => ({ ...a, laps: Array.isArray(a.laps) ? a.laps : [], route: Array.isArray(a.route) ? a.route : [] })));
    for (const [k, def] of [['checkins', {}], ['changeLog', []], ['paceDecisions', {}]]) {
      if ((await db.get('meta', k)) == null) await db.put('meta', def, k);
    }
  },
};

export async function migrateState(db) {
  let v = await db.get('meta', 'schemaVersion');
  if (v == null) {
    const hasData = (await db.allKeys('plans')).length || (await db.get('profile', 'main'));
    v = hasData ? 1 : SCHEMA_VERSION;
    if (!hasData) { await db.put('meta', SCHEMA_VERSION, 'schemaVersion'); return { from: v, to: v }; }
  }
  const from = v;
  while (v < SCHEMA_VERSION) {
    v++;
    if (MIGRATIONS[v]) await MIGRATIONS[v](db);
    await db.put('meta', v, 'schemaVersion');
  }
  return { from, to: v };
}

const sig = (a) => `${a.date}|${a.startedAt || ''}|${Math.round((a.distance || 0) / 10)}|${a.duration}`;

/** Validate a parsed backup file and detect duplicates against current data. */
export function validateBackup(data, state) {
  const errors = [], warnings = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['The file is not valid JSON data.'], warnings, counts: {} };
  if (data.app !== 'stride-running-coach') errors.push('This file is not a Stride backup.');
  const st = data.stores || {};
  const arr = (k) => (Array.isArray(st[k]) ? st[k] : null);
  for (const k of ['plans', 'workouts', 'activities']) if (st[k] != null && !arr(k)) errors.push(`The “${k}” section is malformed.`);
  const plans = arr('plans') || [], workouts = arr('workouts') || [], activities = arr('activities') || [];
  const badPlans = plans.filter((p) => !p.id || !Array.isArray(p.weeks));
  const badW = workouts.filter((w) => !w.id || !/^\d{4}-\d{2}-\d{2}$/.test(w.date || ''));
  const badA = activities.filter((a) => !a.id || !/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') || typeof a.duration !== 'number');
  if (badPlans.length) errors.push(`${badPlans.length} plan record(s) are incomplete.`);
  if (badW.length) warnings.push(`${badW.length} workout record(s) are malformed and will be skipped.`);
  if (badA.length) warnings.push(`${badA.length} activity record(s) are malformed and will be skipped.`);
  const fileVersion = data.schemaVersion || st.meta?.schemaVersion || 1;
  if (fileVersion > SCHEMA_VERSION) errors.push('This backup was made by a newer version of Stride. Update the app first.');
  else if (fileVersion < SCHEMA_VERSION) warnings.push(`Backup is from an older version (data v${fileVersion}); it will be upgraded automatically.`);
  if (!st.profile?.main) warnings.push('The backup contains no profile — you may need to complete onboarding again.');
  const existingIds = new Set((state.activities || []).map((a) => a.id));
  const existingSigs = new Set((state.activities || []).map(sig));
  const dupActs = activities.filter((a) => existingIds.has(a.id) || existingSigs.has(sig(a))).length;
  const existingPlans = new Set((state.plans || []).map((p) => p.id));
  const dupPlans = plans.filter((p) => existingPlans.has(p.id)).length;
  return {
    ok: !errors.length, errors, warnings, fileVersion, exportedAt: data.exportedAt || null,
    counts: { plans: plans.length, workouts: workouts.length, activities: activities.length, races: (st.meta?.races || []).length },
    duplicates: { activities: dupActs, plans: dupPlans },
  };
}

/** Merge a backup into existing data, skipping duplicates. Existing profile and active plan win. */
export async function mergeBackup(db, data, state) {
  const st = data.stores || {};
  const existingIds = new Set((state.activities || []).map((a) => a.id));
  const existingSigs = new Set((state.activities || []).map(sig));
  const acts = (st.activities || []).filter((a) => a.id && a.date && typeof a.duration === 'number' && !existingIds.has(a.id) && !existingSigs.has(sig(a)));
  await db.putMany('activities', acts);
  const existingPlans = new Set((state.plans || []).map((p) => p.id));
  const newPlans = (st.plans || []).filter((p) => p.id && !existingPlans.has(p.id)).map((p) => (p.status === 'active' && state.plan ? { ...p, status: 'archived', archivedAt: data.exportedAt || new Date().toISOString() } : { ...p, paceOffsets: p.paceOffsets || {} }));
  await db.putMany('plans', newPlans);
  const ids = new Set(newPlans.map((p) => p.id));
  await db.putMany('workouts', (st.workouts || []).filter((w) => ids.has(w.planId) && w.id && w.date));
  if (!state.profile && st.profile?.main) await db.put('profile', st.profile.main, 'main');
  const races = [...(state.meta?.races || [])];
  for (const r of st.meta?.races || []) if (!races.some((x) => x.dist === r.dist && x.timeSec === r.timeSec && x.date === r.date)) races.push(r);
  await db.put('meta', races, 'races');
  const vh = [...(state.meta?.vdotHistory || [])];
  for (const h of st.meta?.vdotHistory || []) if (!vh.some((x) => x.date === h.date && x.vdot === h.vdot)) vh.push(h);
  vh.sort((a, b) => (a.date < b.date ? -1 : 1));
  await db.put('meta', vh, 'vdotHistory');
  return { activities: acts.length, plans: newPlans.length };
}
