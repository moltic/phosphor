// ── core/storage.js ──────────────────────────────────────────────────────────
// All chrome.storage read/write helpers.

import { DEFAULT_PREFS } from './config.js';

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

/**
 * Load speed-dial entries from chrome.storage.sync.
 * @returns {Promise<Array<{alias:string,label:string,url:string,icon?:string}>>}
 */
export async function loadDials() {
  const data = await chrome.storage.sync.get({ dials: [] });
  return data.dials;
}

/**
 * Persist speed-dial entries back to chrome.storage.sync.
 * @param {Array<{alias:string,label:string,url:string,icon?:string}>} dials
 */
export function saveDials(dials) {
  return chrome.storage.sync.set({ dials });
}

/**
 * Load user preferences from chrome.storage.sync.
 * Falls back to DEFAULT_PREFS for any missing key.
 */
export async function loadPrefs() {
  const data = await chrome.storage.sync.get({ prefs: {} });
  const stored = data.prefs || {};
  const merged = { ...DEFAULT_PREFS, ...stored };

  // Legacy migration: older versions stored a single `fontSize`.
  if (!('terminalSize' in stored) && ('fontSize' in stored)) merged.terminalSize = stored.fontSize;
  if (!('dialSize' in stored)     && ('fontSize' in stored)) merged.dialSize     = stored.fontSize;

  return merged;
}

/**
 * Persist user preferences to chrome.storage.sync.
 */
export function savePrefs(prefs) {
  return chrome.storage.sync.set({ prefs });
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
