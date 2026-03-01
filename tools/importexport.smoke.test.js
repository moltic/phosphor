#!/usr/bin/env node
// ── tools/importexport.smoke.test.js ─────────────────────────────────────────
// Smoke tests for the backup export / import pipeline (commands/data.js) and
// the DialStore ↔ flat-array serialisation layer (core/storage.js).
//
// Pure logic and chrome.storage are inlined / mocked so the file has zero
// runtime dependencies on browser APIs.
//
// Run with:  node tools/importexport.smoke.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Inlined from core/config.js — Keep in sync with DEFAULT_PREFS ────────────
const DEFAULT_PREFS = {
  theme:            'amber',
  terminalSize:     'medium',
  dialSize:         'medium',
  dialLayout:       'auto',
  scanlines:        true,
  bannerText:       '',
  greetingMode:     false,
  greetingName:     '',
  motd:             '',
  handle:           '',
  sessionCount:     0,
  clockFormat:      'auto',
  tempUnit:         'auto',
  cursorBlinkSpeed: 'normal',
  historyPersist:   true,
  dialOpenOnLoad:   false,
};

// ── Inlined from core/storage.js — Keep in sync ──────────────────────────────
const DIAL_STORE_VERSION = 1;

function flatArrayToDialStore(flatDials) {
  const categories = [];
  let currentCat = { id: 'cat_default', label: '', collapsed: false, items: [] };
  categories.push(currentCat);

  for (const d of flatDials) {
    if (d.type === 'divider') {
      const item = { id: d.alias, type: 'divider', alias: d.alias };
      if (d.col) item.col = true;
      currentCat.items.push(item);
      continue;
    }
    if (d.type === 'group-header') {
      currentCat = { id: d.alias, label: d.label || '', collapsed: false, items: [] };
      categories.push(currentCat);
      continue;
    }
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

  if (
    categories.length > 1 &&
    categories[0].label === '' &&
    categories[0].items.length === 0
  ) {
    categories.shift();
  }

  if (categories.length === 0) {
    categories.push({ id: 'cat_default', label: '', collapsed: false, items: [] });
  }

  return { version: DIAL_STORE_VERSION, categories };
}

function dialStoreToFlatArray(store) {
  const flat = [];
  for (const cat of store.categories) {
    if (cat.label) {
      flat.push({ type: 'group-header', alias: cat.id, label: cat.label });
    }
    for (const item of cat.items) {
      if (item.type === 'divider') {
        const d = { type: 'divider', alias: item.alias };
        if (item.col) d.col = true;
        flat.push(d);
      } else if (item.type === 'weather') {
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

// ── Inlined from commands/data.js — Keep in sync ─────────────────────────────
// Validates and parses an import payload (without touching DOM or storage).

function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'not an object' };
  if (!payload._phosphor)                       return { ok: false, reason: 'missing _phosphor flag' };
  return { ok: true };
}

/** Build the merged-prefs used when restoring an import. */
function mergeImportPrefs(rawPrefs) {
  return { ...DEFAULT_PREFS, ...(rawPrefs || {}) };
}

// ── Minimal chrome.storage mock ───────────────────────────────────────────────
function makeMockStorage(syncInit = {}, localInit = {}) {
  const syncDb  = { ...syncInit };
  const localDb = { ...localInit };

  function makeArea(db) {
    return {
      async get(defaults) {
        const result = {};
        for (const [k, def] of Object.entries(defaults)) {
          result[k] = k in db ? db[k] : def;
        }
        return result;
      },
      async set(obj) { Object.assign(db, obj); },
      _db: db,
    };
  }

  return { storage: { sync: makeArea(syncDb), local: makeArea(localDb) } };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  1. Export payload structure
// ═══════════════════════════════════════════════════════════════════════════════

// 1a. A well-formed export payload has the required envelope keys
{
  const dials = [{ alias: 'gh', label: 'GitHub', url: 'https://github.com' }];
  const notes = [{ id: '1', text: 'hello', ts: 1700000000000 }];
  const prefs = { ...DEFAULT_PREFS, theme: 'green' };

  const payload = {
    _phosphor: true,
    _version:  1,
    _exported: new Date().toISOString(),
    dials,
    notes,
    prefs,
  };

  assert.ok(payload._phosphor,              'payload must have _phosphor flag');
  assert.equal(payload._version, 1,         'payload must have _version = 1');
  assert.ok(typeof payload._exported === 'string', '_exported must be a string');
  assert.ok(Array.isArray(payload.dials),   'dials must be an array');
  assert.ok(Array.isArray(payload.notes),   'notes must be an array');
  assert.ok(payload.prefs && typeof payload.prefs === 'object', 'prefs must be an object');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2. Import payload validation
// ═══════════════════════════════════════════════════════════════════════════════

// 2a. Valid payload is accepted
{
  const r = validateImportPayload({ _phosphor: true, _version: 1 });
  assert.ok(r.ok, 'valid payload should pass validation');
}

// 2b. Missing _phosphor flag is rejected
{
  const r = validateImportPayload({ _version: 1, dials: [] });
  assert.ok(!r.ok, 'payload without _phosphor should be rejected');
  assert.ok(r.reason.includes('_phosphor'), `reason should mention _phosphor, got: ${r.reason}`);
}

// 2c. Null / undefined payloads are rejected safely
{
  assert.ok(!validateImportPayload(null).ok,      'null payload rejected');
  assert.ok(!validateImportPayload(undefined).ok, 'undefined payload rejected');
  assert.ok(!validateImportPayload('string').ok,  'string payload rejected');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  3. Import prefs merge
// ═══════════════════════════════════════════════════════════════════════════════

// 3a. Full prefs object imports cleanly with all keys preserved
{
  const incoming = { theme: 'blue', motd: 'hello', sessionCount: 12 };
  const merged   = mergeImportPrefs(incoming);
  assert.equal(merged.theme,        'blue',   'imported theme preserved');
  assert.equal(merged.motd,         'hello',  'imported motd preserved');
  assert.equal(merged.sessionCount, 12,        'imported sessionCount preserved');
  // Default values must fill in any missing keys
  assert.equal(merged.terminalSize, 'medium', 'default terminalSize applied');
  assert.equal(merged.scanlines,    true,      'default scanlines applied');
}

// 3b. Null prefs → full DEFAULT_PREFS (import command's fallback path)
{
  const merged = mergeImportPrefs(null);
  assert.deepEqual(merged, DEFAULT_PREFS, 'null prefs should produce DEFAULT_PREFS');
}

// 3c. Unknown future keys in the backup are preserved (forward compat)
{
  const merged = mergeImportPrefs({ _futureKey: 'yes' });
  assert.equal(merged._futureKey, 'yes', 'unknown keys in backup must survive import');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  4. DialStore ↔ flat-array round-trip  (export ↔ import serialisation)
// ═══════════════════════════════════════════════════════════════════════════════

// 4a. Link items survive a full round-trip unchanged
{
  const original = [
    { alias: 'gh',  label: 'GitHub',   url: 'https://github.com' },
    { alias: 'yt',  label: 'YouTube',  url: 'https://youtube.com', icon: 'yt.png' },
  ];
  const store     = flatArrayToDialStore(original);
  const recovered = dialStoreToFlatArray(store);
  assert.deepEqual(recovered, original, 'link items must round-trip without change');
}

// 4b. Group-header entries survive round-trip as category headers
{
  const original = [
    { type: 'group-header', alias: 'work', label: 'Work' },
    { alias: 'jira', label: 'Jira', url: 'https://jira.example.com' },
  ];
  const store     = flatArrayToDialStore(original);
  const recovered = dialStoreToFlatArray(store);
  assert.deepEqual(recovered, original, 'group-header + items must round-trip');
}

// 4c. Divider items survive round-trip (both row and col variants)
{
  const original = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' },
    { type: 'divider', alias: 'div1' },
    { type: 'divider', alias: 'div2', col: true },
  ];
  const store     = flatArrayToDialStore(original);
  const recovered = dialStoreToFlatArray(store);
  assert.deepEqual(recovered, original, 'dividers must round-trip intact');
}

// 4d. Weather items survive round-trip
{
  const original = [
    { type: 'weather', alias: 'wx', label: 'London', url: 'https://open-meteo.com/…' },
  ];
  const store     = flatArrayToDialStore(original);
  const recovered = dialStoreToFlatArray(store);
  assert.deepEqual(recovered, original, 'weather items must round-trip intact');
}

// 4e. Mixed complex payload (real-world layout) survives round-trip
{
  const original = [
    { alias: 'hn',   label: 'HN',     url: 'https://news.ycombinator.com' },
    { type: 'divider', alias: 'd1' },
    { type: 'group-header', alias: 'social', label: 'Social' },
    { alias: 'tw',   label: 'X/Twitter', url: 'https://x.com' },
    { type: 'weather', alias: 'wx1', label: 'Here', url: 'https://open-meteo.com' },
    { type: 'group-header', alias: 'dev', label: 'Dev' },
    { alias: 'gh',   label: 'GitHub', url: 'https://github.com', icon: 'gh.png' },
  ];
  const recovered = dialStoreToFlatArray(flatArrayToDialStore(original));
  assert.deepEqual(recovered, original, 'complex mixed payload must round-trip intact');
}

// 4f. Empty dials array → minimal default store → empty flat array
{
  const store     = flatArrayToDialStore([]);
  const recovered = dialStoreToFlatArray(store);
  assert.deepEqual(recovered, [], 'empty dials array should round-trip to empty array');
  assert.equal(store.version, DIAL_STORE_VERSION, 'empty store must still have correct version');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  5. Import confirmation gate (mirrors commands/data.js logic)
// ═══════════════════════════════════════════════════════════════════════════════

// 5a. Confirmation check mirrors `answer.trim().toUpperCase() === 'CONFIRM'`
//     (see commands/data.js) — leading/trailing whitespace is stripped first.
{
  const confirmWord = 'CONFIRM';
  // All of these should be ACCEPTED (trimmed then uppercased === 'CONFIRM')
  const accepted = ['CONFIRM', 'confirm', 'Confirm', ' CONFIRM', 'CONFIRM '];

  // All of these should be REJECTED after trim+uppercase
  const rejected = ['yes', '', 'CONF', 'confiRM_extra', 'CONFIRMED'];

  for (const ans of accepted) {
    assert.ok(
      ans.trim().toUpperCase() === confirmWord,
      `"${ans}" should be accepted as confirmation`,
    );
  }
  for (const ans of rejected) {
    assert.ok(
      ans.trim().toUpperCase() !== confirmWord,
      `"${ans}" should NOT be accepted as confirmation`,
    );
  }
}

console.log('importexport.smoke.test.js: OK');
