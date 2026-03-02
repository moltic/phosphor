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

/** Last key buffered by 'key-async' for phos.get_key() (non-blocking). */
let _asyncKeyBuffer = '';

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

    /**
     * Non-blocking key poll.  Returns the last key pressed since the
     * previous get_key() call, or an empty string if no key is buffered.
     * Unlike read_key(), this never yields/blocks.
     * @returns {string}
     */
    get_key: () => {
      const key = _asyncKeyBuffer;
      _asyncKeyBuffer = '';
      return key;
    },

    /**
     * ANSI SGR colour constants for use with phos.draw().
     * e.g.  phos.color.red .. "#" .. phos.color.reset
     */
    color: {
      reset:   '\x1b[0m',
      black:   '\x1b[30m', red:     '\x1b[31m', green:   '\x1b[32m',
      yellow:  '\x1b[33m', blue:    '\x1b[34m', magenta: '\x1b[35m',
      cyan:    '\x1b[36m', white:   '\x1b[37m',
      // bright variants
      bred:    '\x1b[91m', bgreen:  '\x1b[92m', byellow: '\x1b[93m',
      bblue:   '\x1b[94m', bmagenta:'\x1b[95m', bcyan:   '\x1b[96m',
      bwhite:  '\x1b[97m',
    },
  });

  // Nil-out dangerous stdlib tables (belt-and-suspenders).
  await _engine.doString('io = nil; os = nil');

  // Replace the JS-proxy 'phos' userdata with a plain Lua table whose
  // methods are native Lua closures.  This is critical: if we leave phos as
  // a JS proxy, reading phos.sleep back via __index wraps the stored Lua
  // closure in a JS function that uses lua_pcallk with no continuation,
  // which blocks coroutine.yield ("attempt to yield across a C-call
  // boundary").  With a real Lua table there is no C wrapper in the call
  // chain, so coroutine.yield works correctly from the user's script.
  //
  // _p is the original JS proxy; calling _p.sleep / _p.fetch etc. through
  // functionWrapper is fine because those JS functions return Promises
  // synchronously — the C wrapper returns before coroutine.yield is called.
  await _engine.doString(`
    local _p = phos
    phos = {
      cls      = function()      _p.cls()                               end,
      draw     = function(t)     _p.draw(t)                             end,
      sleep    = function(ms)    coroutine.yield(_p.sleep(ms))          end,
      store    = function(k, v)  coroutine.yield(_p.store(k, v))        end,
      fetch    = function(k)     return coroutine.yield(_p.fetch(k))    end,
      read_key = function()      return coroutine.yield(_p.read_key())  end,
      get_key  = function()      return _p.get_key()                    end,
      color    = _p.color,
    }
  `);

  parent.postMessage({ type: 'ready' }, '*');
}

// ── Custom async code runner ──────────────────────────────────────────────────
// Runs a Lua string in a fresh coroutine thread and drives it via a manual
// resume loop.  When Lua yields a Promise (via coroutine.yield(promise)), we
// await the Promise in JS and pass the resolved value back with resume(1),
// so phos.fetch / phos.read_key can return values to the caller.
async function _runCode(code) {
  const { LuaReturn } = globalThis.wasmoon;
  const global = _engine.global;

  const thread  = global.newThread();
  const threadStackIndex = global.getTop();

  try {
    thread.loadString(code);
    let res = thread.resume(0);

    while (res.result === LuaReturn.Yield) {
      let passback = 0;

      if (res.resultCount > 0) {
        const yieldedVal = thread.getValue(-1);
        thread.pop(res.resultCount);

        if (yieldedVal != null && typeof yieldedVal.then === 'function') {
          // Lua yielded a Promise — await it in JS.
          const resolved = await yieldedVal;
          // Pass the resolved value back to Lua (e.g. for phos.fetch / read_key).
          if (resolved != null) {
            thread.pushValue(resolved);
            passback = 1;
          }
        } else {
          // Non-Promise yield — just give the event loop a turn.
          await new Promise(r => setTimeout(r, 0));
        }
      } else {
        await new Promise(r => setTimeout(r, 0));
      }

      res = thread.resume(passback);
    }

    if (res.result !== LuaReturn.Ok) {
      const msg = res.resultCount > 0
        ? String(thread.getValue(-1))
        : 'unknown Lua error';
      throw new Error(msg);
    }
  } finally {
    global.remove(threadStackIndex);
  }
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
      await _runCode(code);
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

  if (msg.type === 'key-async') {
    // Non-blocking key buffer for phos.get_key().
    _asyncKeyBuffer = msg.key ?? '';
    return;
  }

  if (msg.type === 'kill') {
    // Unblock any pending phos.read_key() so the coroutine resume chain
    // can settle rather than hanging forever.
    if (_pendingKeyResolve) {
      const resolve = _pendingKeyResolve;
      _pendingKeyResolve = null;
      resolve('Escape');
    }
    _asyncKeyBuffer = '';
    _pendingAsyncOps.clear();
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
