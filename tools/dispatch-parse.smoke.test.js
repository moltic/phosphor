#!/usr/bin/env node
// ── tools/dispatch-parse.smoke.test.js ───────────────────────────────────────
// Smoke tests for the command parsing and routing logic in commands/index.js.
//
// Tests in isolation — no DOM, no chrome.* APIs required.
// Pure functions are inlined from their source module and marked
// "Keep in sync with commands/index.js".
//
// Run with:  node tools/dispatch-parse.smoke.test.js
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';

// ── Inlined from commands/index.js — Keep in sync ────────────────────────────

/** @param {string} a @param {string} b @returns {number} */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Minimal mock of dispatch() for routing tests ──────────────────────────────
// Mirrors the logic in commands/index.js dispatch() exactly, but replaces
// printLine / beginBatch / endBatch with no-ops and returns a result object.

function makeDispatch(registry) {
  const calls = [];

  function dispatch(raw) {
    const trimmed = raw.trim();
    if (trimmed === '') return { action: 'empty' };

    const [cmdName, ...args] = trimmed.split(/\s+/);
    const key = cmdName.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(registry, key)) {
      registry[key].run(args);
      calls.push({ action: 'run', key, args });
      return { action: 'run', key, args };
    }

    // Mirror the "did you mean?" suggestion logic from commands/index.js
    const scored = Object.keys(registry)
      .map(k => ({ k, d: levenshtein(key, k) }))
      .filter(({ d }) => d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    calls.push({ action: 'unknown', key, suggestions: scored.map(s => s.k) });
    return { action: 'unknown', key, suggestions: scored.map(s => s.k) };
  }

  return { dispatch, calls };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Empty / whitespace-only input → no-op
{
  const { dispatch } = makeDispatch({});
  assert.equal(dispatch('').action,    'empty', 'empty string → no-op');
  assert.equal(dispatch('   ').action, 'empty', 'whitespace-only → no-op');
  assert.equal(dispatch('\t').action,  'empty', 'tab-only → no-op');
}

// 2. Known command — correct key and args forwarded
{
  const gotArgs = [];
  const reg = { g: { run(a) { gotArgs.push(a); } } };
  const { dispatch } = makeDispatch(reg);
  const r = dispatch('g foo bar');
  assert.equal(r.action, 'run');
  assert.equal(r.key,    'g');
  assert.deepEqual(r.args, ['foo', 'bar']);
  assert.deepEqual(gotArgs[0], ['foo', 'bar']);
}

// 3. Command name is case-folded before lookup
{
  let invoked = false;
  const reg = { help: { run() { invoked = true; } } };
  const { dispatch } = makeDispatch(reg);
  dispatch('HELP');
  assert.ok(invoked, 'HELP should route to help handler');
  invoked = false;
  dispatch('Help');
  assert.ok(invoked, 'Help should route to help handler');
}

// 4. Single-word command → empty args array
{
  const gotArgs = [];
  const reg = { clear: { run(a) { gotArgs.push(a); } } };
  const { dispatch } = makeDispatch(reg);
  dispatch('clear');
  assert.deepEqual(gotArgs[0], [], 'no args → empty array');
}

// 5. Leading / trailing whitespace is stripped
{
  let invoked = false;
  const reg = { ping: { run() { invoked = true; } } };
  const { dispatch } = makeDispatch(reg);
  dispatch('   ping   ');
  assert.ok(invoked, 'whitespace-padded command should still route');
}

// 6. Multi-word args are split on any run of whitespace
{
  const gotArgs = [];
  const reg = { n: { run(a) { gotArgs.push(a); } } };
  const { dispatch } = makeDispatch(reg);
  dispatch('n  hello   world  ');
  assert.deepEqual(gotArgs[0], ['hello', 'world']);
}

// 7. Unknown command → 'unknown' action (no crash)
{
  const reg = { help: { run() {} } };
  const { dispatch } = makeDispatch(reg);
  const r = dispatch('_no_such_command_xyzzy_');
  assert.equal(r.action, 'unknown');
  assert.equal(r.key,    '_no_such_command_xyzzy_');
}

// 8. Levenshtein suggestions — "hlp" should suggest "help"
{
  const reg = { help: { run() {} }, clear: { run() {} }, dial: { run() {} } };
  const { dispatch } = makeDispatch(reg);
  const r = dispatch('hlp');
  assert.equal(r.action, 'unknown');
  assert.ok(
    r.suggestions.includes('help'),
    `Expected "help" in suggestions for "hlp", got: ${JSON.stringify(r.suggestions)}`,
  );
}

// 9. Close match within distance 2 is suggested; distance > 2 is not
{
  const reg = { fortune: { run() {} } };
  const { dispatch } = makeDispatch(reg);

  // "fortun" → distance 1 → should suggest
  const near = dispatch('fortun');
  assert.ok(near.suggestions.includes('fortune'), '"fortun" should suggest "fortune"');

  // "xyz" → distance 6 → should NOT suggest
  const far = dispatch('xyz');
  assert.ok(!far.suggestions.includes('fortune'), '"xyz" should not suggest "fortune"');
}

// 10. At most 3 suggestions returned
{
  const reg = {
    g: { run() {} }, gh: { run() {} }, go: { run() {} },
    gl: { run() {} }, gx: { run() {} },
  };
  const { dispatch } = makeDispatch(reg);
  const r = dispatch('gz');
  assert.ok(r.suggestions.length <= 3, 'At most 3 suggestions should be returned');
}

// ── Levenshtein distance — unit checks ───────────────────────────────────────
assert.equal(levenshtein('',       ''),       0, 'empty vs empty');
assert.equal(levenshtein('a',      'a'),      0, 'same single char');
assert.equal(levenshtein('abc',    'abc'),    0, 'same string');
assert.equal(levenshtein('',       'abc'),    3, 'empty vs 3-char');
assert.equal(levenshtein('abc',    ''),       3, '3-char vs empty');
assert.equal(levenshtein('kitten', 'sitting'),3, 'classic kitten/sitting');
assert.equal(levenshtein('help',   'hlp'),    1, 'deletion');
assert.equal(levenshtein('dial',   'dail'),   2, 'transposition via sub+ins');
assert.equal(levenshtein('clear',  'cler'),   1, 'deletion');

// ── Tab-completion prefix matching (mirrors main.js Tab handler) ──────────────
{
  const reg = { dial: 0, data: 0, debug: 0, help: 0 };
  const prefix = 'd';
  const matches = Object.keys(reg).filter(k => k.startsWith(prefix));
  assert.ok(matches.includes('dial'),  '"d" should match "dial"');
  assert.ok(matches.includes('data'),  '"d" should match "data"');
  assert.ok(matches.includes('debug'), '"d" should match "debug"');
  assert.ok(!matches.includes('help'), '"d" should not match "help"');
}

// Longest-common-prefix calculation (mirrors main.js Tab multi-match logic)
{
  const matches = ['dial', 'data', 'debug'];
  let common = matches[0];
  for (let i = 1; i < matches.length; i++) {
    while (!matches[i].startsWith(common)) {
      common = common.slice(0, -1);
    }
  }
  assert.equal(common, 'd', 'LCP of dial/data/debug should be "d"');
}

{
  const matches = ['fortune', 'format'];
  let common = matches[0];
  for (let i = 1; i < matches.length; i++) {
    while (!matches[i].startsWith(common)) {
      common = common.slice(0, -1);
    }
  }
  assert.equal(common, 'for', 'LCP of fortune/format should be "for"');
}

console.log('dispatch-parse.smoke.test.js: OK');
