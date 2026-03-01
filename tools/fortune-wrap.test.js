#!/usr/bin/env node
// ── tools/fortune-wrap.test.js ─────────────────────────────────────────────
// Smoke tests for the fortune quote wrapping logic.
//
// Run with:  node tools/fortune-wrap.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// Mock DOM environment since core/render.js (imported by fun.js) expects document
globalThis.window = { AudioContext: class {}, webkitAudioContext: class {} };
globalThis.document = {
  getElementById: (id) => {
    return {
      id: id,
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {},
      setAttribute: () => {},
      removeAttribute: () => {},
      querySelector: () => ({ addEventListener: () => {}, checked: false, value: '', style: {} }),
      querySelectorAll: () => [],
      style: {},
      dataset: {}
    };
  },
  createElement: () => ({
    style: {},
    appendChild: () => {},
    classList: { add: () => {}, remove: () => {} },
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
  }),
  body: {
    appendChild: () => {},
  }
};

// Also mock navigator for module imports
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: '', userAgentData: { brands: [] }, platform: '', language: 'en-US' },
  configurable: true
});

// Also mock chrome for module imports
globalThis.chrome = {
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  bookmarks: {},
  topSites: {}
};

const { wrapQuote } = await import('../commands/fun.js');

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Happy path: Short quote that doesn't need wrapping.
{
  const quote = "Hello world";
  const result = wrapQuote(quote, 20);
  assert.deepEqual(result, ["Hello world"], 'Short quote should remain on one line');
}

// 2. Happy path: Longer quote that gets wrapped.
{
  const quote = "This is a longer quote that needs to be wrapped properly.";
  const result = wrapQuote(quote, 20);
  assert.deepEqual(result, [
    "This is a longer",
    "quote that needs to",
    "be wrapped properly."
  ], 'Quote should be wrapped within the specified width');
}

// 3. Edge case: Single word longer than innerWidth.
{
  const quote = "Supercalifragilisticexpialidocious";
  const result = wrapQuote(quote, 10);
  assert.deepEqual(result, ["Supercalifragilisticexpialidocious"], 'Words longer than width should not be split mid-word');
}

// 4. Edge case: Empty string.
{
  const quote = "";
  const result = wrapQuote(quote, 10);
  assert.deepEqual(result, [], 'Empty string should return empty array');
}

// 5. Mixed: Short and long words.
{
  const quote = "A very longwordthatshouldnotbesplit in the middle of a sentence.";
  const result = wrapQuote(quote, 15);
  assert.deepEqual(result, [
    "A very",
    "longwordthatshouldnotbesplit",
    "in the middle",
    "of a sentence."
  ], 'Mixed text should be handled properly, long words kept intact');
}

// 6. Edge case: Exact width match.
{
  const quote = "Exactly ten";
  const result = wrapQuote(quote, 11);
  assert.deepEqual(result, ["Exactly ten"], 'Quotes matching width exactly should stay on one line');
}


console.log('fortune-wrap.test.js: OK');
