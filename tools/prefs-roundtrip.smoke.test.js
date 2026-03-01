#!/usr/bin/env node
// ── tools/prefs-roundtrip.smoke.test.js ──────────────────────────────────────
// Smoke tests for the prefs load / save helpers in core/storage.js.
//
// Pure logic and the chrome.storage mock are inlined so this file has zero
// runtime dependencies on browser APIs.
//
// Run with:  node tools/prefs-roundtrip.smoke.test.js
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

// ── Minimal chrome.storage mock ───────────────────────────────────────────────
function makeMockStorage(syncInit = {}) {
  const db = { ...syncInit };
  const chrome = {
    storage: {
      sync: {
        async get(defaults) {
          const result = {};
          for (const [k, def] of Object.entries(defaults)) {
            result[k] = k in db ? db[k] : def;
          }
          return result;
        },
        async set(obj) { Object.assign(db, obj); },
        /** Expose the raw DB so tests can inspect it directly. */
        _db: db,
      },
    },
  };
  return chrome;
}

// ── Inlined from core/storage.js — Keep in sync ──────────────────────────────

function makePrefsHelpers(chrome) {
  let _cachedPrefs = null;
  let _prefsPromise = null;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.prefs) {
        const stored = changes.prefs.newValue || {};
        const merged = { ...DEFAULT_PREFS, ...stored };
        if (!('terminalSize' in stored) && ('fontSize' in stored)) merged.terminalSize = stored.fontSize;
        if (!('dialSize'     in stored) && ('fontSize' in stored)) merged.dialSize     = stored.fontSize;
        _cachedPrefs = merged;
      }
    });
  }

  /** Load user preferences; falls back to DEFAULT_PREFS for any missing key. */
  async function loadPrefs() {
    if (_cachedPrefs) return _cachedPrefs;
    if (_prefsPromise) return _prefsPromise;

    _prefsPromise = (async () => {
      const data   = await chrome.storage.sync.get({ prefs: {} });
      const stored = data.prefs || {};
      const merged = { ...DEFAULT_PREFS, ...stored };

      // Legacy migration: older versions stored a single `fontSize`.
      if (!('terminalSize' in stored) && ('fontSize' in stored)) merged.terminalSize = stored.fontSize;
      if (!('dialSize'     in stored) && ('fontSize' in stored)) merged.dialSize     = stored.fontSize;

      _cachedPrefs = merged;
      _prefsPromise = null;
      return merged;
    })();

    return _prefsPromise;
  }

  /** Persist user preferences to chrome.storage.sync. */
  async function savePrefs(prefs) {
    _cachedPrefs = prefs;
    await chrome.storage.sync.set({ prefs });
  }

  return { loadPrefs, savePrefs };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Empty storage → full DEFAULT_PREFS returned
{
  const chrome = makeMockStorage();
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  for (const [k, v] of Object.entries(DEFAULT_PREFS)) {
    assert.deepEqual(prefs[k], v, `Default prefs: key "${k}" wrong`);
  }
}

// 2. Stored partial prefs are merged with defaults
{
  const chrome = makeMockStorage({ prefs: { theme: 'green', scanlines: false } });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs.theme,        'green');
  assert.equal(prefs.scanlines,    false);
  assert.equal(prefs.terminalSize, 'medium', 'unset key falls back to default');
  assert.equal(prefs.dialSize,     'medium', 'unset key falls back to default');
}

// 3. savePrefs + loadPrefs round-trip — all written values survive
{
  const chrome = makeMockStorage();
  const { loadPrefs, savePrefs } = makePrefsHelpers(chrome);
  const toSave = {
    ...DEFAULT_PREFS,
    theme:        'blue',
    bannerText:   'HELLO',
    sessionCount: 7,
    motd:         'stay determined',
    dialLayout:   'grid',
  };
  await savePrefs(toSave);
  const loaded = await loadPrefs();
  assert.equal(loaded.theme,        'blue');
  assert.equal(loaded.bannerText,   'HELLO');
  assert.equal(loaded.sessionCount, 7);
  assert.equal(loaded.motd,         'stay determined');
  assert.equal(loaded.dialLayout,   'grid');
}

// 4. Legacy fontSize migration: fontSize → terminalSize AND dialSize
{
  const chrome = makeMockStorage({ prefs: { fontSize: 'large' } });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs.terminalSize, 'large', 'fontSize→terminalSize migration');
  assert.equal(prefs.dialSize,     'large', 'fontSize→dialSize migration');
}

// 5. Explicit terminalSize is NOT overridden by legacy fontSize
{
  const chrome = makeMockStorage({ prefs: { terminalSize: 'small', fontSize: 'large' } });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs.terminalSize, 'small',
    'explicit terminalSize must not be overridden by legacy fontSize');
}

// 6. Explicit dialSize is NOT overridden by legacy fontSize
{
  const chrome = makeMockStorage({ prefs: { dialSize: 'small', fontSize: 'large' } });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs.dialSize, 'small',
    'explicit dialSize must not be overridden by legacy fontSize');
}

// 7. sessionCount increment pattern (mirrors main.js init())
{
  const chrome = makeMockStorage();
  const { loadPrefs, savePrefs } = makePrefsHelpers(chrome);
  for (let i = 1; i <= 5; i++) {
    const prefs = await loadPrefs();
    prefs.sessionCount = (prefs.sessionCount || 0) + 1;
    await savePrefs(prefs);
    const reloaded = await loadPrefs();
    assert.equal(reloaded.sessionCount, i, `sessionCount after ${i} increments`);
  }
}

// 8. savePrefs writes to the correct storage key
{
  const chrome = makeMockStorage();
  const { savePrefs } = makePrefsHelpers(chrome);
  await savePrefs({ ...DEFAULT_PREFS, theme: 'white' });
  assert.ok('prefs' in chrome.storage.sync._db, 'prefs key must exist in storage after save');
  assert.equal(chrome.storage.sync._db.prefs.theme, 'white');
}

// 9. Unknown keys in stored prefs are preserved (forward compat)
{
  const chrome = makeMockStorage({ prefs: { _futureKey: 42 } });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs._futureKey, 42, 'unknown stored key should be kept as-is');
}

// 10. Boolean prefs are not coerced to their default when explicitly stored
{
  const chrome = makeMockStorage({
    prefs: { scanlines: false, historyPersist: false, dialOpenOnLoad: true },
  });
  const { loadPrefs } = makePrefsHelpers(chrome);
  const prefs = await loadPrefs();
  assert.equal(prefs.scanlines,      false);
  assert.equal(prefs.historyPersist, false);
  assert.equal(prefs.dialOpenOnLoad, true);
}

console.log('prefs-roundtrip.smoke.test.js: OK');
