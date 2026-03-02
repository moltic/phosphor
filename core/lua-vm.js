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
//   { type: 'init', wasmUrl: string }          — boot the Lua engine
//   { type: 'run',  id: number, code: string } — execute a Lua snippet
//   { type: 'key',  key: string }              — keypress for phos.read_key()
//   { type: 'store-done', id: number }         — phos.store() completed
//   { type: 'store-error', id, message }       — phos.store() failed
//   { type: 'fetch-done', id, value }          — phos.fetch() result
//   { type: 'fetch-error', id, message }       — phos.fetch() failed
//
// Message protocol (sandbox → parent):
//   { type: 'ready' }                          — engine initialised OK
//   { type: 'init-error', message: string }    — engine failed to init
//   { type: 'print', text: string }            — Lua print() output
//   { type: 'done',  id: number }              — run completed OK
//   { type: 'error', id: number, message }     — run threw an error
//   { type: 'cls' }                            — phos.cls(): clear terminal
//   { type: 'draw', text: string }             — phos.draw(): render frame
//   { type: 'key-request' }                    — phos.read_key(): want a key
//   { type: 'store-request', id, key, value }  — phos.store(): write storage
//   { type: 'fetch-request', id, key }         — phos.fetch(): read storage

import { printLine, clearScreen, outputEl } from './render.js';
import { setActiveGame, clearActiveGame }    from './state.js';

// ── Virtual Monitor elements ──────────────────────────────────────────────────
const modalEl   = document.getElementById('lua-modal');
const luaOutput = document.getElementById('lua-output');

// ── State ─────────────────────────────────────────────────────────────────────
let _iframe      = null;   // hidden sandbox iframe
let _initPromise = null;   // cached init promise
let _initResolve = null;   // pending resolve for the init promise
let _initReject  = null;   // pending reject  for the init promise

const _pendingRuns = new Map(); // id → { resolve, reject }
let   _nextId      = 0;

/** Persistent <pre> element written by phos.draw(). Nulled after each run. */
let _gameCanvas = null;

/**
 * Convert a string containing ANSI SGR escape codes into safe HTML.
 * Supports foreground colours (30-37, 90-97) and reset (0).
 * All HTML-special characters are escaped before injection.
 */
function _ansiToHtml(raw) {
  let s = (raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const FG = {
    '30':'#1a1a1a', '31':'#ff4444', '32':'#44ee88', '33':'#ffd050',
    '34':'#4499ff', '35':'#ff44ff', '36':'#44ffee', '37':'#e8e8e8',
    '90':'#666666', '91':'#ff6e6e', '92':'#66ffaa', '93':'#ffee66',
    '94':'#66aaff', '95':'#ff66ff', '96':'#66ffee', '97':'#ffffff',
  };

  let open = 0;   // count of open <span> tags
  s = s.replace(/\x1b\[([0-9;]*)m/g, (_m, codes) => {
    let out = '';
    for (let i = 0; i < open; i++) out += '</span>';
    open = 0;
    for (const code of codes.split(';')) {
      if (FG[code]) { out += `<span style="color:${FG[code]}">`;  open++; }
      else if (code === '1') { out += '<span style="filter:brightness(1.5)">'; open++; }
    }
    return out;
  });
  for (let i = 0; i < open; i++) s += '</span>';
  return s;
}

/**
 * Install (or re-install) a persistent _activeGame handler that forwards
 * every keypress to the sandbox as a 'key-async' message for phos.get_key().
 * The handler does NOT clear itself — it stays active until _cleanupGame()
 * calls clearActiveGame().
 */
function _installPersistentKeyCapture() {
  setActiveGame({
    onKey(e) {
      _iframe?.contentWindow?.postMessage({ type: 'key-async', key: e.key }, '*');
    },
  });
}

/**
 * Called when a Lua script finishes (done or error).
 * Clears any lingering _activeGame so the terminal is never locked,
 * and releases the canvas reference (the DOM node stays as static output).
 */
function _cleanupGame() {
  clearActiveGame();
  _gameCanvas = null;
}

// ── Global message router ─────────────────────────────────────────────────────
// Single listener handles all messages from the sandbox so there are no
// dangling listeners even after many runLua() calls.
window.addEventListener('message', event => {
  // Ignore anything that didn't come from our sandbox iframe.
  if (!_iframe?.contentWindow || event.source !== _iframe.contentWindow) return;

  const { type, text, id, message } = event.data ?? {};

  switch (type) {
    case 'print':
      // Lua runs without a batch (dispatch skips beginBatch/endBatch for 'lua'),
      // so printLine appends directly to outputEl and scrolls into view in
      // real time.  The call is still safe if a batch happens to be active.
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
      _cleanupGame();
      run?.resolve();
      break;
    }

    case 'error': {
      const run = _pendingRuns.get(id);
      _pendingRuns.delete(id);
      _cleanupGame();
      run?.reject(new Error(message));
      break;
    }

    // ── Graphics bridge ───────────────────────────────────────────────────────

    case 'cls':
      // Clear the Virtual Monitor output panel.
      luaOutput.innerHTML = '';
      break;

    case 'draw': {
      // Ensure the Virtual Monitor is visible, then render the frame into it.
      // We activate persistent key capture on the first draw so phos.get_key()
      // works without blocking; the handler stays active until _cleanupGame().
      if (!_gameCanvas) {
        _gameCanvas = luaOutput;   // use the modal panel as the canvas target
        modalEl.classList.remove('hidden');
        _installPersistentKeyCapture();
      }
      luaOutput.innerText = event.data.text;
      break;
    }

    // ── Input bridge ──────────────────────────────────────────────────────────

    case 'key-request':
      // Activate the real-time key-capture hook for ONE keystroke, then
      // forward it to the sandbox.  After the one-shot fires we restore the
      // persistent capture so phos.get_key() keeps working.
      setActiveGame({
        onKey(e) {
          _iframe.contentWindow.postMessage({ type: 'key', key: e.key }, '*');
          // Restore persistent capture (no-op if game has already ended).
          if (_gameCanvas) _installPersistentKeyCapture();
          else clearActiveGame();
        },
      });
      break;

    // ── Persistence bridge ────────────────────────────────────────────────────

    case 'store-request': {
      const { id: sid, key: sKey, value: sVal } = event.data;
      chrome.storage.local
        .set({ [`lua_${sKey}`]: sVal })
        .then(() =>
          _iframe.contentWindow.postMessage({ type: 'store-done', id: sid }, '*'),
        )
        .catch(err =>
          _iframe.contentWindow.postMessage(
            { type: 'store-error', id: sid, message: String(err?.message ?? err) },
            '*',
          ),
        );
      break;
    }

    case 'fetch-request': {
      const { id: fid, key: fKey } = event.data;
      const storageKey = `lua_${fKey}`;
      chrome.storage.local
        .get(storageKey)
        .then(result =>
          _iframe.contentWindow.postMessage(
            { type: 'fetch-done', id: fid, value: result[storageKey] ?? null },
            '*',
          ),
        )
        .catch(err =>
          _iframe.contentWindow.postMessage(
            { type: 'fetch-error', id: fid, message: String(err?.message ?? err) },
            '*',
          ),
        );
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
 * Immediately terminate any running Lua script.
 * Rejects all pending runs, cleans up game state, and notifies the sandbox
 * so any blocked phos.read_key() promise is resolved and the coroutine
 * resume chain can settle cleanly.
 * Safe to call when no script is running.
 */
export function killLua() {
  _iframe?.contentWindow?.postMessage({ type: 'kill' }, '*');
  for (const [id, { reject }] of _pendingRuns) {
    _pendingRuns.delete(id);
    reject(new Error('Lua execution killed by user'));
  }
  _cleanupGame();
}

/**
 * Execute a Lua string in the sandbox.
 * Rejects if the code throws a Lua error.
 *
 * @param {string} code
 * @param {number} [timeoutMs=0]  0 = no timeout (required for interactive
 *                                 scripts that block on phos.read_key()).
 *                                 Pass a positive value to hard-kill a run
 *                                 that takes longer than expected.
 */
export async function runLua(code, timeoutMs = 0) {
  const id = _nextId++;

  return new Promise((resolve, reject) => {
    _pendingRuns.set(id, { resolve, reject });

    _iframe.contentWindow.postMessage({ type: 'run', id, code }, '*');

    if (timeoutMs > 0) {
      setTimeout(() => {
        if (_pendingRuns.has(id)) {
          _pendingRuns.delete(id);
          _cleanupGame();
          reject(new Error(`Lua execution timed out after ${timeoutMs} ms`));
        }
      }, timeoutMs);
    }
  });
}
