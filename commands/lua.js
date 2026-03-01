// ── commands/lua.js ───────────────────────────────────────────────────────────
// `lua` — execute a Lua 5.4 snippet in the Wasmoon WebAssembly sandbox.

import { printLine }      from '../core/render.js';
import { initLuaVM, runLua } from '../core/lua-vm.js';

// Strips Lua's verbose source prefix, e.g. [string "..."]:1: → ""
const LUA_PREFIX_RE = /^\[string ".*?"\]:\d+:\s*/;

export const luaCommands = {
  lua: {
    description: 'Execute a Lua 5.4 snippet in the sandboxed WebAssembly VM',
    usage: 'lua <code>',
    run: async (args) => {
      if (!args.length) {
        printLine('Usage:   lua <code>', 'line-info');
        printLine('Example: lua print("Hello from Lua!")', 'line-info');
        printLine('Example: lua for i=1,5 do print(i*i) end', 'line-info');
        return;
      }

      // Await init directly — resolves instantly if already warm, waits if still
      // loading, or surfaces the real error message if something went wrong.
      try {
        await initLuaVM();
      } catch (err) {
        printLine(`Lua VM failed to initialize: ${err.message}`, 'line-err');
        return;
      }

      const code = args.join(' ');
      try {
        await runLua(code);
      } catch (err) {
        const msg = String(err.message).replace(LUA_PREFIX_RE, '');
        printLine(`Lua error: ${msg}`, 'line-err');
      }
    },
  },
};
