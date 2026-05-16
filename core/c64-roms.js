// ── core/c64-roms.js ──────────────────────────────────────────────────────────
// Persistent storage for user-supplied C64 ROMs using IndexedDB.
//
// ROMs are NOT bundled with the extension. Users must supply their own
// KERNAL, BASIC, and CHARGEN ROM files (legally sourced) via `c64 rom <url>`.
// ROM data is stored as ArrayBuffers in IndexedDB and survives browser restarts.

const ROM_NAMES = ['kernal', 'basic', 'chargen'];
const DB_NAME   = 'phosphor-c64';
const STORE     = 'roms';
const DB_VER    = 1;

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess       = e => resolve(e.target.result);
    req.onerror         = e => reject(e.target.error);
  });
}

async function _put(name, buffer) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(buffer, name);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function _get(name) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

/** Returns true only if all three ROMs are present in IndexedDB. */
export async function hasAllRoms() {
  const checks = await Promise.all(ROM_NAMES.map(n => _get(n)));
  return checks.every(Boolean);
}

/**
 * Load all three ROMs from IndexedDB.
 * @returns {Promise<{ kernal: Uint8Array, basic: Uint8Array, chargen: Uint8Array }>}
 * @throws if any ROM is missing
 */
export async function loadAllRoms() {
  const entries = await Promise.all(ROM_NAMES.map(async n => {
    const buf = await _get(n);
    if (!buf) throw new Error(`ROM missing: ${n}. Run: c64 rom <base-url>`);
    return [n, new Uint8Array(buf)];
  }));
  return Object.fromEntries(entries);
}

/**
 * Fetch ROMs from a base URL and store them in IndexedDB.
 * Expects three files at: <baseUrl>/kernal, <baseUrl>/basic, <baseUrl>/chargen
 * @param {string} baseUrl
 * @param {(msg: string) => void} onProgress
 */
export async function fetchAndSaveRoms(baseUrl, onProgress = () => {}) {
  const base = baseUrl.replace(/\/$/, '');
  for (const name of ROM_NAMES) {
    onProgress(`Fetching ${name}...`);
    const resp = await fetch(`${base}/${name}`);
    if (!resp.ok) throw new Error(`Failed to fetch ${name}: HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    await _put(name, buf);
  }
}

/** Remove all stored ROMs from IndexedDB. */
export async function clearRoms() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/** Return { name, sizeBytes } for each stored ROM, or null if missing. */
export async function romStatus() {
  return Promise.all(ROM_NAMES.map(async name => {
    const buf = await _get(name);
    return { name, sizeBytes: buf ? buf.byteLength : null };
  }));
}
