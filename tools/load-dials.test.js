#!/usr/bin/env node
// ── tools/load-dials.test.js ──────────────────────────────────────────────────
// Self-contained unit tests for the loadDials() function in core/storage.js.
//
// Run with:  node tools/load-dials.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Minimal chrome.storage mock ───────────────────────────────────────────────

function setupMockStorage(syncInit = {}) {
  const db = { ...syncInit };
  globalThis.chrome = {
    storage: {
      sync: {
        async get(defaults) {
          const result = {};
          for (const [k, def] of Object.entries(defaults)) {
            result[k] = k in db ? db[k] : def;
          }
          return result;
        },
      },
    },
  };
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// Ensure the real storage module is loaded
const { loadDials } = await import('../core/storage.js');

console.log('\nloadDials()');

await asyncTest('returns empty array when storage is empty', async () => {
  setupMockStorage();
  const dials = await loadDials();
  assert.deepEqual(dials, []);
});

await asyncTest('returns legacy dials array when dialStore is absent', async () => {
  const legacyDials = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' }
  ];
  setupMockStorage({ dials: legacyDials });
  const dials = await loadDials();
  assert.deepEqual(dials, legacyDials);
});

await asyncTest('returns flattened array from v1 dialStore, ignoring legacy dials', async () => {
  const dialStore = {
    version: 1,
    categories: [{
      id: 'cat_default',
      label: '',
      collapsed: false,
      items: [
        { id: 'hn', type: 'link', alias: 'hn', label: 'Hacker News', url: 'https://news.ycombinator.com' }
      ]
    }]
  };
  const legacyDials = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' } // Should be ignored
  ];
  setupMockStorage({ dialStore, dials: legacyDials });
  const dials = await loadDials();

  // We expect it to be derived from dialStore, ignoring legacyDials
  assert.equal(dials.length, 1);
  assert.equal(dials[0].alias, 'hn');
  assert.equal(dials[0].label, 'Hacker News');
});

await asyncTest('returns legacy dials when dialStore has unknown version', async () => {
  const dialStore = { version: 999 }; // Unknown version
  const legacyDials = [
    { alias: 'gh', label: 'GitHub', url: 'https://github.com' }
  ];
  setupMockStorage({ dialStore, dials: legacyDials });
  const dials = await loadDials();

  // Should fall back to legacy dials
  assert.deepEqual(dials, legacyDials);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${'─'.repeat(52)}\n`);

if (failed > 0) process.exit(1);
