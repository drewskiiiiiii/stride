// Minimal promise-based IndexedDB layer.
// Stores: profile (key), plans (id), workouts (id; idx planId, date), activities (id; idx date), meta (key)

const DB_NAME = 'stride-coach';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('workouts')) {
        const s = db.createObjectStore('workouts', { keyPath: 'id' });
        s.createIndex('planId', 'planId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('activities')) {
        const s = db.createObjectStore('activities', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab (or a newer app version) wants to upgrade/delete: release our connection
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onblocked = () => console.warn('IndexedDB open blocked by another tab');
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => reqP(s.get(key))),
  put: (store, value, key) => tx(store, 'readwrite', (s) => { key !== undefined ? s.put(value, key) : s.put(value); }),
  putMany: (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
  delete: (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }),
  deleteMany: (store, keys) => tx(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); }),
  all: (store) => tx(store, 'readonly', (s) => reqP(s.getAll())),
  allKeys: (store) => tx(store, 'readonly', (s) => reqP(s.getAllKeys())),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => reqP(s.index(index).getAll(value))),
  clear: (store) => tx(store, 'readwrite', (s) => { s.clear(); }),
  async clearAll() { for (const s of ['profile', 'plans', 'workouts', 'activities', 'meta']) await db.clear(s); },
  async exportAll() {
    const out = { app: 'stride-running-coach', schema: DB_VERSION, exportedAt: new Date().toISOString(), stores: {} };
    for (const s of ['plans', 'workouts', 'activities']) out.stores[s] = await db.all(s);
    for (const s of ['profile', 'meta']) {
      const keys = await db.allKeys(s);
      out.stores[s] = {};
      for (const k of keys) out.stores[s][k] = await db.get(s, k);
    }
    return out;
  },
  async importAll(data) {
    if (!data || data.app !== 'stride-running-coach' || !data.stores) throw new Error('This file is not a Stride backup.');
    await db.clearAll();
    for (const s of ['plans', 'workouts', 'activities']) if (Array.isArray(data.stores[s])) await db.putMany(s, data.stores[s]);
    for (const s of ['profile', 'meta']) {
      const obj = data.stores[s] || {};
      for (const k of Object.keys(obj)) await db.put(s, obj[k], k);
    }
  },
  async persist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
    return false;
  },
};
