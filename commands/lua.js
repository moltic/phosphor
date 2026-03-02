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
-- Measure visible length, ignoring ANSI SGR escape sequences.
local function ansi_len(s)
  return #(s:gsub('\27%[[%d;]*m', ''))
end
local function centre(s, w)
  w = w or W
  local pad = math.max(0, w - ansi_len(s))
  return string.rep(' ', math.floor(pad/2)) .. s .. string.rep(' ', math.ceil(pad/2))
end
local function hdr(title)
  return rule('=') .. '\n' .. centre(title) .. '\n' .. rule('=')
end

-- ── 1. colour palette ────────────────────────────────────────────────────────
local function palette_screen()
  -- each swatch: 12 visible chars; 4 per row → 2 + 4×12 = 50 ≤ W=52
  local function swatch(name)
    local col = c[name] or c.reset
    return col .. string.format('%-12s', name) .. c.reset
  end
  local function swatch_row(names)
    local row = '  '
    for _, n in ipairs(names) do row = row .. swatch(n) end
    return row
  end

  local lines  = {}
  lines[#lines+1] = hdr(' PHOS-MONITOR  v2.0 ')
  lines[#lines+1] = ''
  lines[#lines+1] = centre('[ 1/4 ]  COLOUR PALETTE')
  lines[#lines+1] = rule()
  lines[#lines+1] = ''
  lines[#lines+1] = centre('NORMAL')
  lines[#lines+1] = swatch_row({'black','red','green','yellow'})
  lines[#lines+1] = swatch_row({'blue','magenta','cyan','white'})
  lines[#lines+1] = ''
  lines[#lines+1] = centre('BRIGHT')
  lines[#lines+1] = swatch_row({'bred','bgreen','byellow','bblue'})
  lines[#lines+1] = swatch_row({'bmagenta','bcyan','bwhite'})
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

// ── Snake script ──────────────────────────────────────────────────────────────
// A real-time Snake game using the full phos API.
// Controls: W A S D  or  Arrow keys    Q = quit
// Scoring : +10 per apple eaten; speed increases as score grows.
// Hi-score: persisted via phos.store / phos.fetch.
const SNAKE_SCRIPT = String.raw`
local c  = phos.color
local W  = 30
local H  = 16

local function hbar(n)  return string.rep('-', n)  end
local function pad(n)   return string.rep(' ', n)  end

local SC = c.bgreen
local FC = c.bred
local WC = c.cyan
local XC = c.byellow
local IC = c.white

local EMPTY = 0
local SNAKE = 1
local FOOD  = 2

local function make_grid()
  local g = {}
  for r = 1, H do
    g[r] = {}
    for cc = 1, W do g[r][cc] = EMPTY end
  end
  return g
end

local function place_food(grid)
  local empty = {}
  for r = 1, H do
    for cc = 1, W do
      if grid[r][cc] == EMPTY then empty[#empty + 1] = {r, cc} end
    end
  end
  if #empty == 0 then return end
  local p = empty[math.random(#empty)]
  grid[p[1]][p[2]] = FOOD
end

local function render(grid, score, hi)
  local rows = {}
  rows[#rows + 1] = XC .. ' SCORE ' .. c.bwhite .. string.format('%-5d', score)
                 .. XC .. ' HI ' .. c.bwhite .. string.format('%-5d', hi) .. c.reset
  rows[#rows + 1] = WC .. '+' .. hbar(W) .. '+' .. c.reset
  for r = 1, H do
    local row = WC .. '|' .. c.reset
    for cc = 1, W do
      local v = grid[r][cc]
      if     v == SNAKE then row = row .. SC .. '#' .. c.reset
      elseif v == FOOD  then row = row .. FC .. '*' .. c.reset
      else                   row = row .. ' '
      end
    end
    rows[#rows + 1] = row .. WC .. '|' .. c.reset
  end
  rows[#rows + 1] = WC .. '+' .. hbar(W) .. '+' .. c.reset
  rows[#rows + 1] = IC .. ' W/A/S/D or arrows   Q = quit' .. c.reset
  return table.concat(rows, '\n')
end

local function title_screen(hi)
  local bar = WC .. '+' .. hbar(W) .. '+' .. c.reset
  local inner = '  >>> S  N  A  K  E <<<      '
  local rows = {}
  rows[#rows + 1] = bar
  rows[#rows + 1] = WC .. '|' .. c.reset .. c.bgreen .. inner .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = bar
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. c.reset .. IC
                 .. '  Eat ' .. FC .. '*' .. IC .. ' food to grow'
                 .. pad(W - 20) .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. c.reset .. IC
                 .. '  Avoid walls and your tail'
                 .. pad(W - 26) .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  if hi > 0 then
    local hs = string.format('  HIGH SCORE: %d', hi)
    rows[#rows + 1] = WC .. '|' .. c.reset .. XC .. hs .. pad(W - #hs) .. c.reset .. WC .. '|' .. c.reset
  else
    rows[#rows + 1] = WC .. '|' .. c.reset .. c.cyan
                   .. '  No high score yet!' .. pad(W - 20)
                   .. c.reset .. WC .. '|' .. c.reset
  end
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. c.reset .. c.byellow
                 .. '  Any key to start   Q = quit '
                 .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = bar
  return table.concat(rows, '\n')
end

local function gameover_screen(score, hi, reason, new_hi)
  local bar = WC .. '+' .. hbar(W) .. '+' .. c.reset
  local rows = {}
  rows[#rows + 1] = bar
  rows[#rows + 1] = WC .. '|' .. c.reset .. c.bred
                 .. '      ** GAME  OVER **       '
                 .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = bar
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  local rsn = '  ' .. reason
  rows[#rows + 1] = WC .. '|' .. c.reset .. IC .. rsn .. pad(W - #rsn) .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  local sl = string.format('  Score : %d', score)
  rows[#rows + 1] = WC .. '|' .. c.reset .. XC .. sl .. pad(W - #sl) .. c.reset .. WC .. '|' .. c.reset
  if new_hi then
    rows[#rows + 1] = WC .. '|' .. c.reset .. c.bgreen
                   .. '  ** NEW HIGH SCORE! **' .. pad(W - 22)
                   .. c.reset .. WC .. '|' .. c.reset
  else
    local hl = string.format('  Best  : %d', hi)
    rows[#rows + 1] = WC .. '|' .. c.reset .. XC .. hl .. pad(W - #hl) .. c.reset .. WC .. '|' .. c.reset
  end
  rows[#rows + 1] = WC .. '|' .. pad(W) .. '|' .. c.reset
  rows[#rows + 1] = WC .. '|' .. c.reset .. c.byellow
                 .. '  Enter = play again  Q = quit'
                 .. c.reset .. WC .. '|' .. c.reset
  rows[#rows + 1] = bar
  return table.concat(rows, '\n')
end

local hi = tonumber(phos.fetch('snake_hi') or '0') or 0

phos.cls()
phos.draw(title_screen(hi))
local k0 = phos.read_key()
if k0 == 'q' or k0 == 'Q' then phos.cls() return end

while true do
  local grid    = make_grid()
  local snake   = {}
  local dr, dc  = 0, 1
  local score   = 0
  local tick_ms = 150
  local running = true
  local death   = ''

  local sr = math.floor(H / 2) + 1
  for i = 3, 1, -1 do
    snake[#snake + 1] = {sr, i}
    grid[sr][i] = SNAKE
  end

  place_food(grid)

  while running do
    phos.cls()
    phos.draw(render(grid, score, hi))
    phos.sleep(0)

    local key    = ''
    local waited = 0
    while waited < tick_ms do
      phos.sleep(16)
      waited = waited + 16
      local k = phos.get_key()
      if k ~= '' then key = k ; break end
    end

    if key == 'q' or key == 'Q' then
      death = 'quit' ; running = false
    elseif (key == 'ArrowUp'    or key == 'w' or key == 'W') and dr ~= 1  then
      dr = -1 ; dc =  0
    elseif (key == 'ArrowDown'  or key == 's' or key == 'S') and dr ~= -1 then
      dr =  1 ; dc =  0
    elseif (key == 'ArrowLeft'  or key == 'a' or key == 'A') and dc ~= 1  then
      dr =  0 ; dc = -1
    elseif (key == 'ArrowRight' or key == 'd' or key == 'D') and dc ~= -1 then
      dr =  0 ; dc =  1
    end

    if not running then break end

    local nr = snake[1][1] + dr
    local nc = snake[1][2] + dc

    if nr < 1 or nr > H or nc < 1 or nc > W then
      death = 'wall' ; running = false ; break
    end

    if grid[nr][nc] == SNAKE then
      death = 'self' ; running = false ; break
    end

    local ate = grid[nr][nc] == FOOD

    table.insert(snake, 1, {nr, nc})
    grid[nr][nc] = SNAKE

    if ate then
      score   = score + 10
      if score > hi then hi = score end
      tick_ms = math.max(60, tick_ms - 3)
      place_food(grid)
    else
      local tail = snake[#snake]
      grid[tail[1]][tail[2]] = EMPTY
      snake[#snake] = nil
    end
  end

  if death == 'quit' then break end

  phos.store('snake_hi', tostring(hi))

  local reason = death == 'wall' and 'Hit the wall!' or 'Bit your own tail!'
  local new_hi = score > 0 and score >= hi
  phos.cls()
  phos.draw(gameover_screen(score, hi, reason, new_hi))
  local again = phos.read_key()
  if again == 'q' or again == 'Q' then break end

end

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

  'lua-snake': {
    description: 'Play Snake — eat the food, avoid the walls and your own tail.  Real-time, keyboard-driven, hi-score saved between sessions.',
    usage: 'lua-snake',
    run: async () => {
      try {
        await initLuaVM();
      } catch (err) {
        printLine(`Lua VM failed to initialize: ${err.message}`, 'line-err');
        return;
      }
      try {
        await runLua(SNAKE_SCRIPT);
      } catch (err) {
        const msg = String(err.message).replace(LUA_PREFIX_RE, '');
        printLine(`Lua error: ${msg}`, 'line-err');
      }
    },
  },
};
