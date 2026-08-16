/**
 * In-memory IndexedDB covering the sleep-capture operations the worker uses:
 * open/upgrade, put, delete, getAllKeys. Completions run as microtasks so
 * callers can assign `onsuccess` / `oncomplete` after the call, matching IDB.
 */
export function createIndexedDB() {
  const dbs = new Map();

  function wrapDb(rec) {
    return {
      get objectStoreNames() {
        return { contains: (name) => rec.stores.has(name) };
      },
      createObjectStore(name) {
        if (!rec.stores.has(name)) rec.stores.set(name, new Map());
      },
      transaction(storeName) {
        const store = rec.stores.get(storeName);
        if (!store) throw new Error(`no object store ${storeName}`);
        const tx = {
          error: null,
          oncomplete: null,
          onerror: null,
          objectStore() {
            return {
              put(value, key) {
                store.set(key, value);
              },
              delete(key) {
                store.delete(key);
              },
              getAllKeys() {
                const request = { result: [...store.keys()], onsuccess: null, onerror: null };
                queueMicrotask(() => request.onsuccess && request.onsuccess());
                return request;
              },
            };
          },
        };
        queueMicrotask(() => tx.oncomplete && tx.oncomplete());
        return tx;
      },
      close() {},
    };
  }

  return {
    open(name, version) {
      const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        let rec = dbs.get(name);
        const existed = !!rec;
        if (!rec) {
          rec = { version: 0, stores: new Map() };
          dbs.set(name, rec);
        }
        const oldVersion = rec.version;
        const newVersion = version ?? Math.max(oldVersion, 1);
        request.result = wrapDb(rec);
        if (!existed || newVersion > oldVersion) {
          rec.version = newVersion;
          if (request.onupgradeneeded) request.onupgradeneeded();
        } else if (newVersion > 0) {
          rec.version = newVersion;
        }
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    /** Test inspection: Map of keys → values for one store, or empty. */
    store(dbName, storeName) {
      const rec = dbs.get(dbName);
      return rec && rec.stores.get(storeName) ? rec.stores.get(storeName) : new Map();
    },
  };
}
