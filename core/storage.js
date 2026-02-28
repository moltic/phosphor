// ── core/storage.js ──────────────────────────────────────────────────────────
// All chrome.storage read/write helpers.
//
// Speed-dial storage model (v1)
// ─────────────────────────────
// chrome.storage.sync key: "dialStore"
//
// {
//   version: 1,
//   categories: [
//     {
//       id:        string,   // stable alias — used as key in dialGroupCollapsed
//       label:     string,   // "" for the implicit default section
//       collapsed: boolean,
//       items: [
//         { id, type:"link"|"weather", alias, label, url, icon? }
//         ...
//       ]
//     }, ...
//   ]
// }
//
// Backward-compat shims (loadDials / saveDials) flatten the store back to the
// legacy flat-array representation so that all existing UI and command code
// continues to work unmodified — group-header entries are re-emitted for named
// categories, weather items are re-emitted with type:"weather", dividers are
// not represented in the new model.

import { DEFAULT_PREFS } from './config.js';

// ── DialStore version ─────────────────────────────────────────────────────────
export const DIAL_STORE_VERSION = 1;

// ── DialStore ↔ flat-array conversion ────────────────────────────────────────

/**
 * Convert the legacy flat dials array to a versioned DialStore.
 *
 *   – group-header entries  → new named category
 *   – divider entries       → dropped
 *   – weather / link items  → items inside the current category
 *
 * Items that appear before the first group-header land in an implicit
 * default category whose label is "".
 *
 * @param {Array} flatDials  Legacy flat dials array.
 * @returns {{ version:1, categories:Array }}
 */
export function flatArrayToDialStore(flatDials) {
  /** @type {Array<{id:string,label:string,collapsed:boolean,items:Array}>} */
  const categories = [];
  let currentCat = { id: 'cat_default', label: '', collapsed: false, items: [] };
  categories.push(currentCat);

  for (const d of flatDials) {
    // ── dividers are not represented in the new model
    if (d.type === 'divider') continue;

    // ── group-header → new category
    if (d.type === 'group-header') {
      currentCat = {
        id:        d.alias,
        label:     d.label || '',
        collapsed: false,
        items:     [],
      };
      categories.push(currentCat);
      continue;
    }

    // ── link / weather → item
    /** @type {{ id:string, type:string, alias:string, label:string, url:string, icon?:string }} */
    const item = {
      id:    d.alias,
      type:  d.type === 'weather' ? 'weather' : 'link',
      alias: d.alias,
      label: d.label || d.alias || '',
      url:   d.url   || '',
    };
    if (d.icon) item.icon = d.icon;
    currentCat.items.push(item);
  }

  // Prune a leading default category that is empty when named categories follow it.
  if (
    categories.length > 1 &&
    categories[0].label === '' &&
    categories[0].items.length === 0
  ) {
    categories.shift();
  }

  // Guard: always have at least one category.
  if (categories.length === 0) {
    categories.push({ id: 'cat_default', label: '', collapsed: false, items: [] });
  }

  return { version: DIAL_STORE_VERSION, categories };
}

/**
 * Flatten a versioned DialStore back to the legacy flat dials array.
 *
 *   – named categories     → group-header entry followed by their items
 *   – unnamed categories   → items only (no header emitted)
 *   – weather items        → { type:'weather', alias, label, url }
 *   – link items           → { alias, label, url, icon? }
 *
 * @param {{ version:number, categories:Array }} store
 * @returns {Array}
 */
export function dialStoreToFlatArray(store) {
  const flat = [];
  for (const cat of store.categories) {
    // Emit a synthetic group-header for every named category.
    if (cat.label) {
      flat.push({ type: 'group-header', alias: cat.id, label: cat.label });
    }
    for (const item of cat.items) {
      if (item.type === 'weather') {
        flat.push({ type: 'weather', alias: item.alias, label: item.label, url: item.url });
      } else {
        const d = { alias: item.alias, label: item.label, url: item.url };
        if (item.icon) d.icon = item.icon;
        flat.push(d);
      }
    }
  }
  return flat;
}

// ── DialStore CRUD ────────────────────────────────────────────────────────────

/**
 * Load the versioned DialStore from chrome.storage.sync.
 * Returns a default empty store when nothing has been saved yet.
 *
 * @returns {Promise<{ version:1, categories:Array }>}
 */
export async function loadDialStore() {
  const data = await chrome.storage.sync.get({ dialStore: null });
  if (data.dialStore?.version === DIAL_STORE_VERSION) return data.dialStore;
  // Nothing in new format yet — return a minimal default store.
  return { version: DIAL_STORE_VERSION, categories: [{ id: 'cat_default', label: '', collapsed: false, items: [] }] };
}

/**
 * Persist a versioned DialStore to chrome.storage.sync.
 *
 * @param {{ version:1, categories:Array }} store
 */
export function saveDialStore(store) {
  return chrome.storage.sync.set({ dialStore: store });
}

// ── Flat-array shims (backward-compat for all existing UI / command code) ─────

/**
 * Load speed-dial entries as a flat array.
 *
 * Reads from dialStore (v1) when present, otherwise falls back to the legacy
 * `dials` key so that first-run on an unmigrayed profile still works.
 *
 * @returns {Promise<Array>}
 */
export async function loadDials() {
  const data = await chrome.storage.sync.get({ dialStore: null, dials: [] });
  if (data.dialStore?.version === DIAL_STORE_VERSION) {
    return dialStoreToFlatArray(data.dialStore);
  }
  // Legacy fallback (pre-migration profile or fresh install with no data).
  return data.dials;
}

/**
 * Persist speed-dial entries.
 *
 * Converts the flat array to a DialStore and writes dialStore; the legacy
 * `dials` key is NOT updated so old backups are preserved.
 *
 * @param {Array} dials  Flat dials array (legacy format).
 */
export function saveDials(dials) {
  const store = flatArrayToDialStore(dials);
  return chrome.storage.sync.set({ dialStore: store });
}

// ── Notes CRUD ────────────────────────────────────────────────────────────────

/**
 * Load notes array from chrome.storage.sync.
 * @returns {Promise<Array<{id:string,text:string,ts:number}>>}
 */
export async function loadNotes() {
  const data = await chrome.storage.sync.get({ notes: [] });
  return data.notes;
}

/**
 * Persist the notes array back to chrome.storage.sync.
 * @param {Array<{id:string,text:string,ts:number}>} notes
 */
export function saveNotes(notes) {
  return chrome.storage.sync.set({ notes });
}

// ── Prefs CRUD ────────────────────────────────────────────────────────────────

/**
 * Load user preferences from chrome.storage.sync.
 * Falls back to DEFAULT_PREFS for any missing key.
 */
export async function loadPrefs() {
  const data   = await chrome.storage.sync.get({ prefs: {} });
  const stored = data.prefs || {};
  const merged = { ...DEFAULT_PREFS, ...stored };

  // Legacy migration: older versions stored a single `fontSize`.
  if (!('terminalSize' in stored) && ('fontSize' in stored)) merged.terminalSize = stored.fontSize;
  if (!('dialSize'     in stored) && ('fontSize' in stored)) merged.dialSize     = stored.fontSize;

  return merged;
}

/**
 * Persist user preferences to chrome.storage.sync.
 */
export function savePrefs(prefs) {
  return chrome.storage.sync.set({ prefs });
}

// ── One-time migrations ───────────────────────────────────────────────────────

/**
 * One-time migration: convert the legacy flat `dials` array to the versioned
 * dialStore format (v1).
 *
 * What it does
 * ────────────
 *   1. Checks the `_dialsMigratedV1` flag in local storage — exits immediately
 *      if the migration has already run.
 *   2. Skips if dialStore v1 is already present (profile was set up fresh on v1
 *      or a previous call completed before the flag was written).
 *   3. Reads the legacy `dials` array from sync storage.
 *   4. Stores a one-time JSON backup as `_dialBackupV0` in local storage.
 *   5. Converts via flatArrayToDialStore() and writes dialStore to sync.
 *   6. Sets the `_dialsMigratedV1` flag so this never runs again.
 *
 * Group-header entries → named categories.
 * Divider entries      → dropped (not representable in v1).
 * Weather items        → preserved as type:"weather" items.
 * Link items           → preserved as type:"link" items.
 */
export async function migrateDialsToV1() {
  const flag = await chrome.storage.local.get({ _dialsMigratedV1: false });
  if (flag._dialsMigratedV1) return;

  const data = await chrome.storage.sync.get({ dials: [], dialStore: null });

  // If a valid v1 store already exists just mark the flag and return.
  if (data.dialStore?.version === DIAL_STORE_VERSION) {
    await chrome.storage.local.set({ _dialsMigratedV1: true });
    return;
  }

  const legacyDials = Array.isArray(data.dials) ? data.dials : [];

  if (legacyDials.length > 0) {
    // Store a one-time backup of the raw legacy array in local storage.
    await chrome.storage.local.set({
      _dialBackupV0: JSON.stringify(legacyDials),
      _dialBackupV0ts: Date.now(),
    });

    const store = flatArrayToDialStore(legacyDials);
    await chrome.storage.sync.set({ dialStore: store });

    const totalItems = store.categories.reduce((n, c) => n + c.items.length, 0);
    const divDropped = legacyDials.filter(d => d.type === 'divider').length;
    console.info(
      `[Phosphor] dials → dialStore v1:`,
      `${store.categories.length} categor${store.categories.length === 1 ? 'y' : 'ies'},`,
      `${totalItems} item${totalItems === 1 ? '' : 's'}`,
      divDropped ? `(${divDropped} divider${divDropped === 1 ? '' : 's'} dropped)` : '',
    );
  }

  await chrome.storage.local.set({ _dialsMigratedV1: true });
}

/**
 * One-time migration: copy any existing chrome.storage.local data into
 * chrome.storage.sync so that users who already have dials/notes/prefs
 * don't lose them when switching to sync-backed storage.
 * Guarded by a `_syncMigrated` flag in local so it runs only once.
 */
export async function migrateLocalToSync() {
  const flag = await chrome.storage.local.get({ _syncMigrated: false });
  if (flag._syncMigrated) return;

  const local  = await chrome.storage.local.get({ dials: [], notes: [], prefs: {} });
  const synced = await chrome.storage.sync.get({ dials: [], notes: [] });

  const syncIsEmpty = synced.dials.length === 0 && synced.notes.length === 0;
  if (syncIsEmpty) {
    const toSync = {};
    if (local.dials.length > 0)              toSync.dials = local.dials;
    if (local.notes.length > 0)              toSync.notes = local.notes;
    if (Object.keys(local.prefs).length > 0) toSync.prefs = local.prefs;
    if (Object.keys(toSync).length > 0) {
      await chrome.storage.sync.set(toSync);
      console.info('[Phosphor] Migrated local storage → sync:', Object.keys(toSync));
    }
  }

  await chrome.storage.local.set({ _syncMigrated: true });
}
