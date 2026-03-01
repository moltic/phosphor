// ── lua-sandbox.js ────────────────────────────────────────────────────────────
// Runs inside lua-sandbox.html (the extension's sandboxed page).
// Receives 'init' and 'run' messages from core/lua-vm.js via postMessage,
// replies with 'ready', 'print', 'done', and 'error' messages.
//
// This file deliberately has no ES-module syntax: it's a plain script loaded
// from lua-sandbox.html, which is a sandboxed extension page — no bundler.
'use strict';

let _engine = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function _boot(wasmUrl) {
  const { LuaFactory } = globalThis.wasmoon ?? {};
  if (!LuaFactory) throw new Error('wasmoon UMD bundle not loaded in sandbox');

  const factory = new LuaFactory(wasmUrl);
  _engine = await factory.createEngine();

  // Bridge Lua's print() to a postMessage so the terminal can display it.
  _engine.global.set('print', (...args) => {
    parent.postMessage(
      { type: 'print', text: args.map(a => (a == null ? 'nil' : String(a))).join('\t') },
      '*',
    );
  });

  // Nil-out dangerous stdlib tables (belt-and-suspenders).
  _engine.global.set('io', null);
  _engine.global.set('os', null);

  parent.postMessage({ type: 'ready' }, '*');
}

// ── Message router ────────────────────────────────────────────────────────────
window.addEventListener('message', async event => {
  const msg = event.data ?? {};

  if (msg.type === 'init') {
    _boot(msg.wasmUrl).catch(err => {
      parent.postMessage({ type: 'init-error', message: String(err?.message ?? err) }, '*');
    });
    return;
  }

  if (msg.type === 'run') {
    const { id, code } = msg;
    if (!_engine) {
      parent.postMessage({ type: 'error', id, message: 'Lua engine not ready' }, '*');
      return;
    }
    try {
      await _engine.doString(code);
      parent.postMessage({ type: 'done', id }, '*');
    } catch (err) {
      parent.postMessage({ type: 'error', id, message: String(err?.message ?? err) }, '*');
    }
  }
});
