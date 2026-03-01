// ── core/lua-vm.js ────────────────────────────────────────────────────────────
// Lua 5.4 sandbox via Wasmoon (WebAssembly).
//
// Wasmoon ships a UMD bundle that is loaded as a classic <script> in index.html,
// which populates globalThis.wasmoon before any ES-module code runs.  This
// module wraps that global, wires Lua's print() to the terminal, and exposes a
// simple async API consumed by commands/lua.js.
//
// Security notes (Manifest V3):
//  • The manifest CSP must include 'wasm-unsafe-eval' in script-src so that
//    WebAssembly.instantiate() is permitted inside an extension page.
//  • Wasmoon's WASM sandbox has no access to the host file system or network.
//  • We additionally nil-out os / io table references as belt-and-suspenders.
//  • Runaway scripts are killed by a Promise.race() timeout (default 5 s).

import { printLine } from './render.js';

/** Resolved engine instance, or null before initLuaVM() completes. */
let _engine = null;

/** Cached init promise so repeated calls are safe (idempotent). */
let _initPromise = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Bootstrap the Lua VM.  Safe to call multiple times — returns the same
 * promise on every call after the first.  Should be awaited during app init
 * so the VM is warm before the user types their first `lua` command.
 */
export function initLuaVM() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { LuaFactory } = globalThis.wasmoon;
    if (!LuaFactory) throw new Error('wasmoon UMD bundle not loaded — check index.html');

    // Tell Wasmoon where to fetch the WASM binary.  chrome.runtime.getURL()
    // produces the extension-internal URL (chrome-extension://<id>/vendor/glue.wasm)
    // which satisfies the 'self' fetch-src directive.
    const wasmUrl = chrome.runtime.getURL('vendor/glue.wasm');
    const factory  = new LuaFactory(wasmUrl);
    _engine = await factory.createEngine();

    // ── Bridge Lua's print() → terminal printLine ─────────────────────────
    // Lua print() converts each arg with tostring() then joins with tabs.
    // We mirror that behaviour: nil → "nil", numbers/booleans → String().
    _engine.global.set('print', (...args) => {
      printLine(args.map(a => (a == null ? 'nil' : String(a))).join('\t'));
    });

    // ── Strip dangerous stdlib tables (belt-and-suspenders) ───────────────
    // Wasmoon's WASM environment already prevents real I/O, but nil-ing these
    // makes it explicit and prevents any accidental stub leakage.
    _engine.global.set('io', null);
    _engine.global.set('os', null);
  })();

  return _initPromise;
}

/** Returns true once the VM has finished initializing. */
export function isLuaReady() {
  return _engine !== null;
}

/**
 * Execute a Lua string in the sandbox.
 * Rejects if the VM is not yet ready, the code throws a Lua error,
 * or execution exceeds `timeoutMs` milliseconds.
 *
 * @param {string} code       - Lua source to execute
 * @param {number} timeoutMs  - Hard wall-clock limit (default 5 000 ms)
 */
export async function runLua(code, timeoutMs = 5_000) {
  if (!_engine) throw new Error('Lua VM not initialized — call initLuaVM() first');

  return Promise.race([
    _engine.doString(code),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Lua execution timed out after ${timeoutMs} ms`)),
        timeoutMs,
      )
    ),
  ]);
}
