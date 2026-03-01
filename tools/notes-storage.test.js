#!/usr/bin/env node
// ── tools/notes-storage.test.js ──────────────────────────────────────────────
// Smoke tests for the notes load / save helpers in core/storage.js.
//
// The chrome.storage mock is injected globally so this file has zero
// runtime dependencies on browser APIs but tests the actual imported functions.
//
// Run with:  node tools/notes-storage.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Minimal chrome.storage mock ───────────────────────────────────────────────
function makeMockStorage(syncInit = {}, quotaExceeded = false) {
  const db = { ...syncInit };
  const chromeMock = {
    storage: {
      sync: {
        async get(defaults) {
          const result = {};
          for (const [k, def] of Object.entries(defaults)) {
            result[k] = k in db ? db[k] : def;
          }
          return result;
        },
        async set(obj) {
          if (quotaExceeded) {
            throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
          }
          Object.assign(db, obj);
        },
        /** Expose the raw DB so tests can inspect it directly. */
        _db: db,
      },
    },
  };
  return chromeMock;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

async function runTests() {
  // 1. Empty storage → empty notes array returned
  {
    global.chrome = makeMockStorage();
    const { loadNotes } = await import('../core/storage.js?t=1');
    const notes = await loadNotes();
    assert.deepEqual(notes, [], 'Empty storage should return an empty array for notes');
  }

  // 2. Stored notes are returned correctly
  {
    const mockNotes = [
      { id: '1', text: 'Hello World', ts: 1234567890 },
      { id: '2', text: 'Another note', ts: 1234567891 },
    ];
    global.chrome = makeMockStorage({ notes: mockNotes });
    const { loadNotes } = await import('../core/storage.js?t=2');
    const notes = await loadNotes();
    assert.deepEqual(notes, mockNotes, 'Stored notes should be returned correctly');
  }

  // 3. saveNotes writes to the correct storage key
  {
    global.chrome = makeMockStorage();
    const { saveNotes } = await import('../core/storage.js?t=3');
    const notesToSave = [{ id: '1', text: 'Test Note', ts: 1234567890 }];
    await saveNotes(notesToSave);
    assert.ok('notes' in global.chrome.storage.sync._db, 'notes key must exist in storage after save');
    assert.deepEqual(global.chrome.storage.sync._db.notes, notesToSave, 'notes should be saved correctly');
  }

  // 4. saveNotes + loadNotes round-trip
  {
    global.chrome = makeMockStorage();
    const { loadNotes, saveNotes } = await import('../core/storage.js?t=4');
    const mockNotes = [
      { id: 'n1', text: 'Note 1', ts: 1000 },
      { id: 'n2', text: 'Note 2', ts: 2000 },
    ];
    await saveNotes(mockNotes);
    const loaded = await loadNotes();
    assert.deepEqual(loaded, mockNotes, 'Notes should survive a save + load round-trip');
  }

  // 5. saveNotes handles QUOTA exceeded error gracefully
  {
    global.chrome = makeMockStorage({}, true); // Set quotaExceeded to true
    const { saveNotes } = await import('../core/storage.js?t=5');

    // Suppress console.error for this expected failure
    const originalConsoleError = console.error;
    let consoleErrorCalled = false;
    console.error = () => { consoleErrorCalled = true; };

    try {
      await assert.rejects(
        async () => {
          await saveNotes([{ id: '1', text: 'Too much data', ts: 123 }]);
        },
        (err) => {
          assert.equal(err.message, 'Storage quota exceeded. Try removing some notes.');
          return true;
        },
        'saveNotes should throw a user-friendly error on quota exceeded'
      );
      assert.ok(consoleErrorCalled, 'console.error should have been called');
    } finally {
      // Restore console.error
      console.error = originalConsoleError;
    }
  }

  // 6. saveNotes throws other errors normally
  {
    global.chrome = makeMockStorage();
    // Override set to throw a non-QUOTA error
    global.chrome.storage.sync.set = async () => { throw new Error('Some other error'); };
    const { saveNotes } = await import('../core/storage.js?t=6');

    await assert.rejects(
      async () => {
        await saveNotes([{ id: '1', text: 'Test', ts: 123 }]);
      },
      (err) => {
        assert.equal(err.message, 'Some other error');
        return true;
      },
      'saveNotes should propagate non-QUOTA errors'
    );
  }

  console.log('notes-storage.test.js: OK');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
