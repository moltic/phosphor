// ── c64-sandbox.js ────────────────────────────────────────────────────────────
// Runs inside c64-sandbox.html (the extension's sandboxed page).
// Drives the vice_x64sc_libretro Emscripten module (RetroArch platform).
//
// Message types accepted  (parent → sandbox):
//   'boot'     — { roms?: { kernal, basic, chargen } }  write ROMs + callMain
//   'keydown'  — { key, code }                          inject a key-press
//   'keyup'    — { key, code }                          inject a key-release
//   'loadPrg'  — { bytes: ArrayBuffer }                 autostart a .prg file
//   'kill'     — shut down the emulator
//
// Message types posted    (sandbox → parent):
//   'ready'    — WASM runtime is initialised (onRuntimeInitialized fired)
//   'stopped'  — emitted after 'kill' is processed
//
// This file is loaded as <script type="module"> from c64-sandbox.html.

import libretro_vice_x64sc from './vendor/vice_x64sc_libretro.js';

let _module = null;
let _ready  = false;

const _canvas = document.getElementById('c64-screen');

// ── Initialise libretro module ────────────────────────────────────────────────
// noInitialRun: we call callMain() ourselves after ROMs are in the virtual FS.
libretro_vice_x64sc({
  canvas:        _canvas,
  noInitialRun:  true,
  onRuntimeInitialized() {
    _module = this;
    _ready  = true;
    parent.postMessage({ type: 'ready' }, '*');
  },
}).catch(err => {
  console.error('[C64 sandbox] Module init failed:', err);
  parent.postMessage({ type: 'error', message: err.message }, '*');
});

// ── Message router ────────────────────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  if (!data || !data.type) return;

  switch (data.type) {

    // ── boot ─────────────────────────────────────────────────────────────────
    // Optionally write VICE ROMs into the virtual FS, then start RetroArch.
    // VICE libretro looks for system ROMs at {system_dir}/vice_x64sc/.
    // RetroArch's emscripten system_dir defaults to /home/web_user/.
    case 'boot': {
      if (!_ready) return;

      const { kernal, basic, chargen } = data.roms ?? {};

      if (kernal && basic && chargen) {
        // Write ROMs for VICE libretro. Try both the RetroArch system_dir
        // path (/home/web_user/vice_x64sc/) and a fallback /system/ path.
        for (const base of ['/home/web_user', '/system']) {
          try { _module.FS.mkdir(base); } catch (_) {}
          try { _module.FS.mkdir(`${base}/vice_x64sc`); } catch (_) {}
          try {
            // VICE libretro expects uppercase filenames on some builds, lowercase on others.
            _module.FS.writeFile(`${base}/vice_x64sc/KERNAL`,  new Uint8Array(kernal.buffer ?? kernal));
            _module.FS.writeFile(`${base}/vice_x64sc/BASIC`,   new Uint8Array(basic.buffer  ?? basic));
            _module.FS.writeFile(`${base}/vice_x64sc/CHARGEN`, new Uint8Array(chargen.buffer ?? chargen));
            _module.FS.writeFile(`${base}/vice_x64sc/kernal`,  new Uint8Array(kernal.buffer ?? kernal));
            _module.FS.writeFile(`${base}/vice_x64sc/basic`,   new Uint8Array(basic.buffer  ?? basic));
            _module.FS.writeFile(`${base}/vice_x64sc/chargen`, new Uint8Array(chargen.buffer ?? chargen));
          } catch (e) {
            console.warn('[C64 sandbox] ROM write to', base, 'failed:', e.message);
          }
        }
      }

      // Start RetroArch (entry point calls main() with argv[0] = thisProgram).
      try {
        _module.callMain([]);
      } catch (e) {
        console.error('[C64 sandbox] callMain failed:', e);
      }
      break;
    }

    // ── keydown ──────────────────────────────────────────────────────────────
    case 'keydown': {
      if (!_ready) return;
      const ev = new KeyboardEvent('keydown', {
        key: data.key, code: data.code, bubbles: true, cancelable: true,
      });
      (_canvas.ownerDocument || document).dispatchEvent(ev);
      break;
    }

    // ── keyup ────────────────────────────────────────────────────────────────
    case 'keyup': {
      if (!_ready) return;
      const ev = new KeyboardEvent('keyup', {
        key: data.key, code: data.code, bubbles: true, cancelable: true,
      });
      (_canvas.ownerDocument || document).dispatchEvent(ev);
      break;
    }

    // ── loadPrg ──────────────────────────────────────────────────────────────
    // Write a .prg into the virtual FS and ask RetroArch to load it.
    case 'loadPrg': {
      if (!_ready) return;
      try {
        _module.FS.mkdir('/home/web_user/content');
      } catch (_) {}
      const PRG_PATH = '/home/web_user/content/autostart.prg';
      _module.FS.writeFile(PRG_PATH, new Uint8Array(data.bytes));
      // EmscriptenSendCommand feeds the RetroArch platform command queue.
      _module.EmscriptenSendCommand(JSON.stringify({ load_content: PRG_PATH }));
      break;
    }

    // ── kill ─────────────────────────────────────────────────────────────────
    case 'kill': {
      if (_ready && _module) {
        try { _module._cmd_pause?.(); } catch (_) {}
      }
      parent.postMessage({ type: 'stopped' }, '*');
      break;
    }

    default:
      break;
  }
});

