// ── core/c64-vm.js ────────────────────────────────────────────────────────────
// C64 emulator sandbox hosted in a sandboxed iframe.
//
// The emulator runs inside c64-sandbox.html, a sandboxed extension page with a
// relaxed CSP.  This module creates the iframe, loads user-supplied ROM blobs
// from IndexedDB, and communicates with the sandbox via postMessage.
//
// ROMs are not bundled. Users supply them via `c64 rom <base-url>`.
//
// Message protocol (parent → sandbox):
//   { type: 'init',    roms: { kernal, basic, chargen } } — boot emulator (ArrayBuffers transferred)
//   { type: 'keydown', key: string, code: string }        — key pressed
//   { type: 'keyup',   key: string, code: string }        — key released
//   { type: 'loadPrg', bytes: ArrayBuffer }               — inject a .prg file
//   { type: 'kill' }                                       — shut down emulator
//
// Message protocol (sandbox → parent):
//   { type: 'ready' }   — emulator initialised and ready
//   { type: 'stopped' } — emulator halted (user quit from inside the VM)

import { setActiveGame, clearActiveGame } from './state.js';
import { loadAllRoms } from './c64-roms.js';

// ── Module-level state ────────────────────────────────────────────────────────
let _iframe      = null;   // sandboxed iframe element (null until initC64VM called)
let _initPromise = null;   // cached single-init promise (idempotent)
let _initResolve = null;   // pending resolve for _initPromise
let _initReject  = null;   // pending reject  for _initPromise
let _killed      = false;  // guard against stale messages after killC64()
let _modalEl     = null;   // #c64-modal
let _frameEl     = null;   // #c64-crt-frame

/** Stored so bootC64 and killC64 share the same listener reference. */
let _keyUpListener = null;

// ── Internal cleanup ──────────────────────────────────────────────────────────
function _cleanupC64() {
  clearActiveGame();
  _killed = true;
}

// ── Global message router ─────────────────────────────────────────────────────
// Single persistent listener; handles all messages from the C64 sandbox iframe.
window.addEventListener('message', event => {
  if (!_iframe?.contentWindow || event.source !== _iframe.contentWindow) return;

  const { type } = event.data ?? {};

  switch (type) {
    case 'ready':
      // WASM runtime is up — load ROMs from IndexedDB then tell sandbox to boot.
      loadAllRoms()
        .then(roms => {
          _iframe.contentWindow.postMessage(
            { type: 'boot', roms },
            '*',
            [roms.kernal.buffer, roms.basic.buffer, roms.chargen.buffer],
          );
        })
        .catch(() => {
          // Boot without ROMs — VICE will show a missing-ROM error in its UI.
          _iframe.contentWindow.postMessage({ type: 'boot', roms: null }, '*');
        })
        .finally(() => {
          _initResolve?.();
          _initResolve = _initReject = null;
        });
      break;

    case 'stopped':
      _cleanupC64();
      break;
  }
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the C64 VM (idempotent — safe to call multiple times).
 * Creates the sandboxed iframe, appends it to #c64-crt-frame, and resolves
 * once the sandbox sends back { type: 'ready' }.
 * @returns {Promise<void>}
 */
export function initC64VM() {
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    _initResolve = resolve;
    _initReject  = reject;
  });

  _modalEl = document.getElementById('c64-modal');
  _frameEl = document.getElementById('c64-crt-frame');

  const iframe = document.createElement('iframe');
  iframe.src   = chrome.runtime.getURL('c64-sandbox.html');
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
  iframe.setAttribute('sandbox', 'allow-scripts');

  _frameEl.appendChild(iframe);
  _iframe = iframe;

  return _initPromise;
}

/**
 * Boot (or resume) the C64 emulator.
 * Ensures the VM is initialised, shows the modal overlay, and wires up
 * keyboard input so keydown/keyup events are forwarded to the sandbox.
 * @returns {Promise<void>}
 */
export async function bootC64() {
  await initC64VM();

  _killed = false;
  _modalEl.classList.remove('hidden');

  // Install a document-level keyup forwarder (stored for removal in killC64).
  _keyUpListener = e => {
    _iframe?.contentWindow?.postMessage({ type: 'keyup', key: e.key, code: e.code }, '*');
  };
  document.addEventListener('keyup', _keyUpListener);

  // Register with the active-game system so keydown events are captured.
  setActiveGame({
    onKey(e) {
      _iframe?.contentWindow?.postMessage({ type: 'keydown', key: e.key, code: e.code }, '*');
    },
  });
}

/**
 * Shut down the C64 emulator immediately.
 * Hides the modal, sends a kill signal to the sandbox, and tears down
 * keyboard capture.
 */
export function killC64() {
  if (_killed) return;
  _killed = true;

  _iframe?.contentWindow?.postMessage({ type: 'kill' }, '*');
  _modalEl?.classList.add('hidden');

  if (_keyUpListener) {
    document.removeEventListener('keyup', _keyUpListener);
    _keyUpListener = null;
  }

  clearActiveGame();
}

/**
 * Inject a .prg file into the running emulator.
 * The ArrayBuffer is transferred (zero-copy) to the sandbox.
 * @param {ArrayBuffer} bytes
 */
export function loadPrg(bytes) {
  _iframe?.contentWindow?.postMessage({ type: 'loadPrg', bytes }, '*', [bytes]);
}
