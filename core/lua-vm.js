// ── core/lua-vm.js ────────────────────────────────────────────────────────────
// Lua 5.4 sandbox via Wasmoon (WebAssembly), hosted in a sandboxed iframe.
//
// Why an iframe?
//   Chrome MV3 disallows 'unsafe-eval' in extension-page CSP, and while
//   'wasm-unsafe-eval' is spec-valid it is silently ignored in practice.
//   Pages listed under manifest.json "sandbox.pages" receive a relaxed CSP
//   that permits WebAssembly — so we run the VM there and communicate via
//   postMessage.
//
// Message protocol (parent → sandbox):
//   { type: 'init', wasmUrl: string }        — boot the Lua engine
//   { type: 'run',  id: number, code: string } — execute a Lua snippet
//
// Message protocol (sandbox → parent):
//   { type: 'ready' }                         — engine initialised OK
//   { type: 'init-error', message: string }   — engine failed to init
//   { type: 'print', text: string }           — Lua print() output
//   { type: 'done',  id: number }             — run completed OK
//   { type: 'error', id: number, message: string } — run threw an error

import { printLine } from './render.js';

// ── State ─────────────────────────────────────────────────────────────────────
let _iframe      = null;   // hidden sandbox iframe
let _initPromise = null;   // cached init promise
let _initResolve = null;   // pending resolve for the init promise
let _initReject  = null;   // pending reject  for the init promise

const _pendingRuns = new Map(); // id → { resolve, reject }
let   _nextId      = 0;

// ── Global message router ─────────────────────────────────────────────────────
// Single listener handles all messages from the sandbox so there are no
// dangling listeners even after many runLua() calls.
window.addEventListener('message', event => {
  // Ignore anything that didn't come from our sandbox iframe.
  if (!_iframe?.contentWindow || event.source !== _iframe.contentWindow) return;

  const { type, text, id, message } = event.data ?? {};

  switch (type) {
    case 'print':
      // Lua print() output — printLine is batch-aware so this lands in the
      // correct cmd-output-block while the lua command is executing.
      printLine(text ?? '');
      break;

    case 'ready':
      _initResolve?.();
      _initResolve = _initReject = null;
      break;

    case 'init-error':
      _initPromise = null;   // allow retry on next initLuaVM() call
      _initReject?.(new Error(message));
      _initResolve = _initReject = null;
      break;

    case 'done': {
      const run = _pendingRuns.get(id);
      _pendingRuns.delete(id);
      run?.resolve();
      break;
    }

    case 'error': {
      const run = _pendingRuns.get(id);
      _pendingRuns.delete(id);
      run?.reject(new Error(message));
      break;
    }
  }
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create the sandbox iframe and initialise the Lua engine inside it.
 * Idempotent — returns the same promise on every call after the first.
 * On failure the promise is reset so the next call will retry.
 */
export function initLuaVM() {
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    _initResolve = resolve;
    _initReject  = reject;

    // Create the hidden sandbox iframe.  Its src is the extension's
    // lua-sandbox.html page, which Chrome loads with a relaxed CSP.
    _iframe = document.createElement('iframe');
    _iframe.src = chrome.runtime.getURL('lua-sandbox.html');
    _iframe.style.cssText =
      'display:none;position:absolute;width:0;height:0;border:0;';

    // Once the iframe document (and vendor/wasmoon.js) has fully loaded,
    // send the 'init' message with the WASM binary URL.
    _iframe.addEventListener('load', () => {
      _iframe.contentWindow.postMessage(
        { type: 'init', wasmUrl: chrome.runtime.getURL('vendor/glue.wasm') },
        '*',
      );
    }, { once: true });

    document.body.appendChild(_iframe);
  });

  return _initPromise;
}

/**
 * Execute a Lua string in the sandbox.
 * Rejects if the code throws a Lua error or exceeds timeoutMs.
 *
 * @param {string} code
 * @param {number} [timeoutMs=5000]
 */
export async function runLua(code, timeoutMs = 5_000) {
  const id = _nextId++;

  return new Promise((resolve, reject) => {
    _pendingRuns.set(id, { resolve, reject });

    _iframe.contentWindow.postMessage({ type: 'run', id, code }, '*');

    setTimeout(() => {
      if (_pendingRuns.has(id)) {
        _pendingRuns.delete(id);
        reject(new Error(`Lua execution timed out after ${timeoutMs} ms`));
      }
    }, timeoutMs);
  });
}
