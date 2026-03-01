// ── lua-sandbox.js ────────────────────────────────────────────────────────────
// Runs inside lua-sandbox.html (the extension's sandboxed page).
// Receives 'init' and 'run' messages from core/lua-vm.js via postMessage,
// replies with 'ready', 'print', 'done', 'error', and phos bridge messages.
//
// This file deliberately has no ES-module syntax: it's a plain script loaded
// from lua-sandbox.html, which is a sandboxed extension page — no bundler.
'use strict';

let _engine = null;

// ── phos bridge state ─────────────────────────────────────────────────────────
/** Resolve function waiting for the next 'key' message (phos.read_key). */
let _pendingKeyResolve = null;

/** Map of id → { resolve, reject } for async storage operations. */
const _pendingAsyncOps = new Map();
let   _nextAsyncId     = 0;

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

  // ── phos API — graphics / input / persistence ─────────────────────────────
  _engine.global.set('phos', {
    /**
     * Clear the terminal output and reset the draw canvas.
     * Synchronous fire-and-forget (messages are FIFO so ordering is safe).
     */
    cls() {
      parent.postMessage({ type: 'cls' }, '*');
    },

    /**
     * Render a character-art frame to a persistent <pre> in the terminal.
     * Calling draw() repeatedly updates the same element — no DOM thrashing.
     * @param {string} text
     */
    draw(text) {
      parent.postMessage({ type: 'draw', text: String(text ?? '') }, '*');
    },

    /**
     * Block Lua execution until the user presses a key, then return e.key.
     * Activates the _activeGame key-capture hook in the parent for ONE press.
     * @returns {Promise<string>}
     */
    read_key: async () => new Promise(resolve => {
      _pendingKeyResolve = resolve;
      parent.postMessage({ type: 'key-request' }, '*');
    }),

    /**
     * Persist a value to chrome.storage.local under the prefixed key
     * "lua_<key>".  Value must be JSON-serialisable.
     * @param {string} key
     * @param {*}      value
     * @returns {Promise<void>}
     */
    store: async (key, value) => {
      const id = _nextAsyncId++;
      return new Promise((resolve, reject) => {
        _pendingAsyncOps.set(id, { resolve, reject });
        parent.postMessage(
          { type: 'store-request', id, key: String(key), value },
          '*',
        );
      });
    },

    /**
     * Read a previously stored value from chrome.storage.local.
     * Returns nil (null) if the key has never been written.
     * @param {string} key
     * @returns {Promise<*>}
     */
    fetch: async (key) => {
      const id = _nextAsyncId++;
      return new Promise((resolve, reject) => {
        _pendingAsyncOps.set(id, { resolve, reject });
        parent.postMessage({ type: 'fetch-request', id, key: String(key) }, '*');
      });
    },

    /**
     * Pause Lua execution for the given number of milliseconds.
     * Useful for animation loops that don't need key input for pacing.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep: async (ms) => new Promise(resolve => setTimeout(resolve, Number(ms) || 0)),
  });

  // Nil-out dangerous stdlib tables (belt-and-suspenders).
  await _engine.doString('io = nil; os = nil');

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
    return;
  }

  // ── phos bridge responses (parent → sandbox) ──────────────────────────────

  if (msg.type === 'key') {
    // Parent forwarded a keypress in response to our 'key-request'.
    if (_pendingKeyResolve) {
      const resolve = _pendingKeyResolve;
      _pendingKeyResolve = null;
      resolve(msg.key ?? '');
    }
    return;
  }

  if (msg.type === 'store-done') {
    const op = _pendingAsyncOps.get(msg.id);
    _pendingAsyncOps.delete(msg.id);
    op?.resolve();
    return;
  }

  if (msg.type === 'store-error') {
    const op = _pendingAsyncOps.get(msg.id);
    _pendingAsyncOps.delete(msg.id);
    op?.reject(new Error(msg.message));
    return;
  }

  if (msg.type === 'fetch-done') {
    const op = _pendingAsyncOps.get(msg.id);
    _pendingAsyncOps.delete(msg.id);
    op?.resolve(msg.value);
    return;
  }

  if (msg.type === 'fetch-error') {
    const op = _pendingAsyncOps.get(msg.id);
    _pendingAsyncOps.delete(msg.id);
    op?.reject(new Error(msg.message));
    return;
  }
});
