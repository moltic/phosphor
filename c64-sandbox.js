// ── c64-sandbox.js ────────────────────────────────────────────────────────────
// Runs inside c64-sandbox.html (the extension's sandboxed page).
// Receives messages from the extension via postMessage and drives the
// Emscripten-compiled VICE x64sc emulator.
//
// Message types accepted  (parent → sandbox):
//   'init'     — { roms: { kernal, basic, chargen } }  boot the emulator
//   'keydown'  — { key, code }                          inject a key-press
//   'keyup'    — { key, code }                          inject a key-release
//   'loadPrg'  — { bytes: Uint8Array }                  autostart a .prg file
//   'kill'     — reset the machine and post 'stopped'
//
// Message types posted    (sandbox → parent):
//   'ready'    — emulator runtime is initialised and waiting for 'init'
//   'stopped'  — emitted after 'kill' is processed
//
// This file deliberately has no ES-module syntax: it is a plain script loaded
// from c64-sandbox.html, a sandboxed extension page — no bundler involved.
'use strict';

let _module = null;
let _ready  = false;

// ── Emscripten Module pre-configuration ──────────────────────────────────────
// Must be assigned to window.Module before vendor/x64sc.js executes (the glue
// script merges its own defaults with whatever properties are already present).
window.Module = {
  canvas: document.getElementById('c64-screen'),

  // Prevent VICE from calling main() on its own; we fire it via callMain()
  // once the ROMs have been written to the virtual FS.
  noInitialRun: true,

  onRuntimeInitialized: function () {
    _module = window.Module;
    _ready  = true;
    parent.postMessage({ type: 'ready' }, '*');
  },
};

// ── Message router ────────────────────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  if (!data || !data.type) return;

  switch (data.type) {

    // ── init ─────────────────────────────────────────────────────────────────
    // Receive ROM blobs from the parent, write them into the Emscripten
    // virtual filesystem, then boot the emulator via callMain().
    case 'init': {
      if (!_ready) return; // guard: runtime must be initialised first

      const { kernal, basic, chargen } = data.roms ?? {};

      try {
        _module.FS.mkdir('/c64roms');
      } catch (_) {
        // Directory may already exist if init is called more than once.
      }

      if (kernal)  _module.FS.writeFile('/c64roms/kernal',  kernal);
      if (basic)   _module.FS.writeFile('/c64roms/basic',   basic);
      if (chargen) _module.FS.writeFile('/c64roms/chargen', chargen);

      _module.callMain([
        '-kernal',  '/c64roms/kernal',
        '-basic',   '/c64roms/basic',
        '-chargen', '/c64roms/chargen',
      ]);
      break;
    }

    // ── keydown ──────────────────────────────────────────────────────────────
    case 'keydown': {
      if (!_ready) return;
      const ev = new KeyboardEvent('keydown', {
        key:     data.key,
        code:    data.code,
        bubbles: true,
      });
      document.getElementById('c64-screen').dispatchEvent(ev);
      break;
    }

    // ── keyup ────────────────────────────────────────────────────────────────
    case 'keyup': {
      if (!_ready) return;
      const ev = new KeyboardEvent('keyup', {
        key:     data.key,
        code:    data.code,
        bubbles: true,
      });
      document.getElementById('c64-screen').dispatchEvent(ev);
      break;
    }

    // ── loadPrg ──────────────────────────────────────────────────────────────
    // Write a .prg file to the virtual FS and autostart it.
    case 'loadPrg': {
      if (!_ready) return;

      _module.FS.writeFile('/tmp/autostart.prg', data.bytes);
      _module.ccall(
        'autostart_prg',
        null,
        ['string', 'number'],
        ['/tmp/autostart.prg', 0],
      );
      break;
    }

    // ── kill ─────────────────────────────────────────────────────────────────
    // Trigger a hard reset.  Errors are silenced so a partially-initialised
    // module (or a VICE build that lacks the symbol) won't crash the sandbox.
    case 'kill': {
      if (_ready) {
        try {
          _module.ccall('machine_trigger_reset', null, ['number'], [0]);
        } catch (_) {
          // Silently ignore — VICE may not expose this symbol in all builds.
        }
      }
      parent.postMessage({ type: 'stopped' }, '*');
      break;
    }

    default:
      break;
  }
});
