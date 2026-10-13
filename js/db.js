(function (global) {
  'use strict';

  const DB_NAME = 'lifelog-db';
  const DB_VERSION = 2;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('byDate', 'dateKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('memos')) {
          const s = db.createObjectStore('memos', { keyPath: 'id' });
          s.createIndex('byDate', 'dateKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('reminders')) {
          const s = db.createObjectStore('reminders', { keyPath: 'id' });
          s.createIndex('byWhen', 'when', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // v2: timer sessions (additive; existing stores untouched)
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('byStart', 'start', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }

  async function put(store, value) {
    const db = await openDB();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
    return value;
  }

  async function get(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(store, key) {
    const db = await openDB();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }

  async function getAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getByIndex(store, indexName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const idx = db.transaction(store, 'readonly').objectStore(store).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getMeta(key, fallback) {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  }

  async function setMeta(key, value) {
    return put('meta', { key, value });
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  global.DB = {
    openDB, put, get, del, getAll, getByIndex, getMeta, setMeta, uid
  };
})(typeof window !== 'undefined' ? window : self);
