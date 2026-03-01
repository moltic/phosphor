#!/usr/bin/env node
// ── tools/notes-storage.smoke.test.js ────────────────────────────────────────
// Smoke tests for the notes load helper in core/storage.js.
//
// We mock the global `chrome` object before importing the module under test.
//
// Run with:  node tools/notes-storage.smoke.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Minimal chrome.storage mock ───────────────────────────────────────────────
function setupMockStorage(syncInit = {}) {
  const db = { ...syncInit };
  global.chrome = {
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
}

// Ensure mock is set up before importing the file, just in case it runs at import time.
// (In storage.js, the actual access is inside the functions, so we can mock dynamically).
setupMockStorage();

// Import the actual implementation
import { loadNotes } from '../core/storage.js';

async function runTests() {
  // ═══════════════════════════════════════════════════════════════════════════════
  //  Tests
  // ═══════════════════════════════════════════════════════════════════════════════

  // 1. Empty storage → empty array returned
  {
    setupMockStorage();
    const notes = await loadNotes();
    assert.deepEqual(notes, [], 'Empty storage should return an empty array');
  }

  // 2. Stored notes are returned correctly
  {
    const testNotes = [
      { id: '1', text: 'First note', ts: 1234567890 },
      { id: '2', text: 'Second note', ts: 1234567891 },
    ];
    setupMockStorage({ notes: testNotes });
    const notes = await loadNotes();
    assert.deepEqual(notes, testNotes, 'loadNotes should return the stored notes array');
  }

  console.log('notes-storage.smoke.test.js: OK');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
