#!/usr/bin/env node
// ── tools/storage-notes.smoke.test.js ────────────────────────────────────────
// Smoke tests for the notes load / save helpers in core/storage.js.
//
// The chrome.storage mock is injected globally so we can test the real module.
//
// Run with:  node tools/storage-notes.smoke.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Minimal chrome.storage mock ───────────────────────────────────────────────
// We must set this up globally BEFORE importing the module that uses it.
global.chrome = {
  storage: {
    sync: {
      _db: {},
      async get(defaults) {
        const result = {};
        for (const [k, def] of Object.entries(defaults)) {
          result[k] = k in this._db ? this._db[k] : def;
        }
        return result;
      },
      async set(obj) {
        Object.assign(this._db, obj);
      },
      // Helper to reset the DB between tests
      _reset(init = {}) {
        this._db = { ...init };
      }
    },
  },
};

// Now import the actual module we want to test
import { loadNotes, saveNotes } from '../core/storage.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    // Silence console.error for tests that expect it
    const originalError = console.error;
    console.error = () => {};

    await fn();

    // Restore console.error
    console.error = originalError;

    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log('\nstorage-notes.smoke.test.js');

// 1. Empty storage → empty array returned
await asyncTest('Empty storage → empty array returned', async () => {
  global.chrome.storage.sync._reset();
  const notes = await loadNotes();
  assert.deepEqual(notes, [], 'Empty storage should return an empty array');
});

// 2. loadNotes returns stored notes correctly
await asyncTest('loadNotes returns stored notes correctly', async () => {
  const storedNotes = [
    { id: '1', text: 'Hello, world!', ts: 1000 },
    { id: '2', text: 'Second note', ts: 2000 },
  ];
  global.chrome.storage.sync._reset({ notes: storedNotes });
  const notes = await loadNotes();
  assert.deepEqual(notes, storedNotes, 'loadNotes should return the stored array of notes');
});

// 3. saveNotes persists notes to storage
await asyncTest('saveNotes persists notes to storage', async () => {
  global.chrome.storage.sync._reset();
  const notesToSave = [
    { id: '3', text: 'New note', ts: 3000 },
  ];

  await saveNotes(notesToSave);

  assert.ok('notes' in global.chrome.storage.sync._db, 'notes key must exist in storage after save');
  assert.deepEqual(global.chrome.storage.sync._db.notes, notesToSave, 'notes should be saved correctly');
});

// 4. saveNotes round-trips with loadNotes
await asyncTest('saveNotes round-trips with loadNotes', async () => {
  global.chrome.storage.sync._reset();
  const notesToSave = [
    { id: '4', text: 'Round trip note', ts: 4000 },
  ];

  await saveNotes(notesToSave);
  const loadedNotes = await loadNotes();

  assert.deepEqual(loadedNotes, notesToSave, 'Loaded notes should match saved notes');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(52)}\n`);

if (failed > 0) process.exit(1);
