#!/usr/bin/env node
// ── tools/clock-format.test.js ───────────────────────────────────────────────
// Unit tests for formatTimestamp in core/clock.js
//
// Run with: node tools/clock-format.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// Mock minimal DOM so imports from core/clock.js (and its deps) succeed
globalThis.document = {
  documentElement: {
    style: { setProperty: () => {} },
    classList: { toggle: () => {} }
  },
  getElementById: () => ({
    style: {},
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    appendChild: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
  }),
  createElement: () => ({
    style: {},
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    appendChild: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
  }),
  body: {
    appendChild: () => {}
  }
};
globalThis.window = {
  location: { search: '' },
  addEventListener: () => {}
};

// Dynamic import after mocking DOM
const { formatTimestamp } = await import('../core/clock.js');

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

// Note: Because toLocaleString output depends on the local timezone and locale
// of the machine running the tests, we must be careful with exact string asserts.
// To make these tests deterministic regardless of timezone, we can force a
// specific timezone and locale by slightly modifying the function under test
// for the purpose of validation, OR we can test properties of the output string.

// Helper to check if the string roughly looks like a date format
// (contains a 4 digit year, has components separated by spaces/punctuation)
function isValidFormat(str) {
  return typeof str === 'string' && str.length >= 10 && /\d{4}/.test(str);
}

// 1. Typical timestamps
{
  // Epoch: Jan 1, 1970 UTC
  const epoch = 0;
  const result = formatTimestamp(epoch);
  assert.ok(isValidFormat(result), `Epoch timestamp should be formatted correctly, got: ${result}`);
  // Should contain 1970 or 1969 depending on timezone
  assert.ok(result.includes('1970') || result.includes('1969'), 'Epoch timestamp should contain 1970 or 1969');
}

{
  // Known date: 2024-01-01T12:00:00.000Z
  const ms = 1704110400000;
  const result = formatTimestamp(ms);
  assert.ok(isValidFormat(result), `Standard date should be formatted correctly, got: ${result}`);
  // Should contain 2024
  assert.ok(result.includes('2024'), 'Standard timestamp should contain 2024');
}

// 2. Edge cases
{
  // Negative timestamp (before 1970)
  const ms = -10000000000;
  const result = formatTimestamp(ms);
  assert.ok(isValidFormat(result), `Negative timestamp should be formatted correctly, got: ${result}`);
  // Should contain 1969
  assert.ok(result.includes('1969'), 'Negative timestamp should contain 1969');
}

{
  // Far future date
  const ms = 8640000000000000; // Max date
  const result = formatTimestamp(ms);
  assert.ok(isValidFormat(result), `Far future timestamp should be formatted correctly, got: ${result}`);
  assert.ok(result.includes('275760'), 'Max date timestamp should contain year 275760');
}

// 3. Invalid / Error inputs
{
  // NaN
  const result = formatTimestamp(NaN);
  assert.equal(result, 'Invalid Date', 'NaN timestamp should return "Invalid Date"');
}

{
  // undefined -> Date(undefined) is Invalid Date
  const result = formatTimestamp(undefined);
  assert.equal(result, 'Invalid Date', 'undefined timestamp should return "Invalid Date"');
}

console.log('clock-format.test.js: OK');
