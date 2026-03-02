// ── commands/lua.js ───────────────────────────────────────────────────────────
// `lua` — execute a Lua 5.4 snippet in the Wasmoon WebAssembly sandbox.
// `lua-demo` — built-in phos API showcase / theme colour test.

import { printLine }      from '../core/render.js';
import { initLuaVM, runLua } from '../core/lua-vm.js';

// Strips Lua's verbose source prefix, e.g. [string "..."]:1: → ""
const LUA_PREFIX_RE = /^\[string ".*?"\]:\d+:\s*/;

// ── Demo script ───────────────────────────────────────────────────────────────
// Exercises every phos API: cls, draw, sleep, color, get_key, store, fetch.
// The monitor uses CSS variables so every panel is painted in the active theme.
const DEMO_SCRIPT = String.raw`
local c  = phos.color
local W  = 52   -- frame width (characters)

-- ── helpers ──────────────────────────────────────────────────────────────────
local function rule(ch)  return string.rep(ch or '-', W) end
local function centre(s, w)
  w = w or W
  local pad = math.max(0, w - #s)
  return string.rep(' ', math.floor(pad/2)) .. s .. string.rep(' ', math.ceil(pad/2))
end
local function hdr(title)
  return rule('=') .. '\n' .. centre(title) .. '\n' .. rule('=')
end

-- ── 1. colour palette ────────────────────────────────────────────────────────
local function palette_screen()
  local names = {
    'black','red','green','yellow','blue','magenta','cyan','white',
  }
  local bright = { 'bblack','bred','bgreen','byellow','bblue','bmagenta','bcyan','bwhite' }
  -- bblack isn't defined, substitute reset for spacing
  local function swatch(name)
    local col = c[name] or c.reset
    return col .. string.format(' %-9s', name) .. c.reset
  end

  local lines  = {}
  lines[#lines+1] = hdr(' PHOS-MONITOR  v2.0 ')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('[ 1/4 ]  COLOUR PALETTE')
  lines[#lines+1] = rule()
  lines[#lines+1] = ''
  lines[#lines+1] = '  NORMAL :'
  local row = '  '
  for _, n in ipairs(names) do row = row .. swatch(n) end
  lines[#lines+1] = row
  lines[#lines+1] = ''
  lines[#lines+1] = '  BRIGHT :'
  row = '  '
  for _, n in ipairs({'bred','bgreen','byellow','bblue','bmagenta','bcyan','bwhite'}) do
    row = row .. swatch(n)
  end
  lines[#lines+1] = row
  lines[#lines+1] = ''
  lines[#lines+1] = rule()
  lines[#lines+1] = centre('(press any key)')
  return table.concat(lines, '\n')
end

-- ── 2. animation demo ────────────────────────────────────────────────────────
local SPINNER = { '|', '/', '-', '\\' }
local BAR_W   = 30

local function anim_screen(tick)
  local spin  = SPINNER[(tick % 4) + 1]
  local pct   = (tick % (BAR_W + 1))
  local bar   = string.rep('#', pct) .. string.rep('.', BAR_W - pct)
  local bline = c.green .. '[' .. bar .. ']' .. c.reset
            .. string.format('  %3d%%', math.floor(pct / BAR_W * 100))

  local lines = {}
  lines[#lines+1] = hdr(' PHOS-MONITOR  v2.0 ')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('[ 2/4 ]  ANIMATION')
  lines[#lines+1] = rule()
  lines[#lines+1] = ''
  lines[#lines+1] = centre(c.byellow .. spin .. '  Loading…' .. c.reset)
  lines[#lines+1] = ''
  lines[#lines+1] = '  ' .. bline
  lines[#lines+1] = ''

  -- Mini bouncing ball
  local ball_x = tick % (W - 2)
  lines[#lines+1] = '  ' .. string.rep(' ', ball_x) .. c.bred .. 'O' .. c.reset
  lines[#lines+1] = ''
  lines[#lines+1] = rule()
  lines[#lines+1] = centre('(runs for ~2 s then continues)')
  return table.concat(lines, '\n')
end

-- ── 3. key-input test ────────────────────────────────────────────────────────
local function key_screen(last)
  local disp = last ~= '' and (c.byellow .. last .. c.reset) or (c.cyan .. '[waiting…]' .. c.reset)
  local lines = {}
  lines[#lines+1] = hdr(' PHOS-MONITOR  v2.0 ')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('[ 3/4 ]  KEY INPUT')
  lines[#lines+1] = rule()
  lines[#lines+1] = ''
  lines[#lines+1] = centre('Press  Q  to continue,  any other key to test.')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('Last key received:')
  lines[#lines+1] = centre(disp)
  lines[#lines+1] = ''
  lines[#lines+1] = rule()
  return table.concat(lines, '\n')
end

-- ── 4. store / fetch ─────────────────────────────────────────────────────────
local function storage_screen(stored, loaded)
  local sv = stored and (c.bgreen  .. tostring(stored) .. c.reset) or (c.cyan .. '[pending]' .. c.reset)
  local lv = loaded  and (c.byellow .. tostring(loaded)  .. c.reset) or (c.cyan .. '[pending]' .. c.reset)
  local match = (stored and loaded)
    and (stored == loaded
           and (c.bgreen  .. '  PASS — values match!' .. c.reset)
           or  (c.bred    .. '  FAIL — mismatch!'     .. c.reset))
    or ''
  local lines = {}
  lines[#lines+1] = hdr(' PHOS-MONITOR  v2.0 ')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('[ 4/4 ]  STORAGE')
  lines[#lines+1] = rule()
  lines[#lines+1] = ''
  lines[#lines+1] = '  Stored  : ' .. sv
  lines[#lines+1] = '  Fetched : ' .. lv
  lines[#lines+1] = ''
  lines[#lines+1] = match
  lines[#lines+1] = ''
  lines[#lines+1] = rule()
  lines[#lines+1] = centre('(press any key to exit)')
  return table.concat(lines, '\n')
end

-- ═══════════════════════════════════════════════════════════════════════════
--  MAIN
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Colour palette
phos.cls()
phos.draw(palette_screen())
phos.read_key()

-- 2. Animation (~2 s, non-blocking key poll so user can skip)
for tick = 0, 39 do
  phos.cls()
  phos.draw(anim_screen(tick))
  phos.sleep(50)
  local k = phos.get_key()
  if k ~= '' then break end
end

-- 3. Key-input loop (exit on Q)
local last_key = ''
while true do
  phos.cls()
  phos.draw(key_screen(last_key))
  local k = phos.read_key()
  if k == 'q' or k == 'Q' then break end
  last_key = k
end

-- 4. Store / fetch round-trip
local magic = 'phosphor-' .. math.random(1000, 9999)
phos.cls()
phos.draw(storage_screen(nil, nil))

phos.store('demo_val', magic)
phos.cls()
phos.draw(storage_screen(magic, nil))

local got = phos.fetch('demo_val')
phos.cls()
phos.draw(storage_screen(magic, got))
phos.read_key()

phos.cls()
`;

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

  'lua-demo': {
    description: 'Run the built-in phos API demo (colours, animation, keys, storage)',
    usage: 'lua-demo',
    run: async () => {
      try {
        await initLuaVM();
      } catch (err) {
        printLine(`Lua VM failed to initialize: ${err.message}`, 'line-err');
        return;
      }
      try {
        await runLua(DEMO_SCRIPT);
      } catch (err) {
        const msg = String(err.message).replace(LUA_PREFIX_RE, '');
        printLine(`Lua error: ${msg}`, 'line-err');
      }
    },
  },
};
