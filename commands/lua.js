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

// ── Space Invaders script ──────────────────────────────────────────────────
// NES-style arcade shooter using the full phos API.
// Controls: A/D or Arrow keys to move   SPACE to fire   Q = quit
// Hi-score: persisted via phos.store / phos.fetch.
const INVADERS_SCRIPT = String.raw`
local c      = phos.color
local W, H   = 44, 20        -- inner play-field dimensions
local TICK   = 80            -- ms per game frame

-- Alien type table  { color, frame-A, frame-B, points }
local ALIEN = {
  { c.bcyan,   '/^\\', '\\^/', 30 },   -- row 1  (top)
  { c.bgreen,  '(o)',  '[o]', 20 },    -- row 2  (mid)
  { c.byellow, 'v^v',  'V^V', 10 },   -- row 3  (bottom)
}

local NC, NR = 8, 3   -- alien columns / rows
local SP     = 5      -- horizontal cells per alien slot  (3 sprite + 2 gap)

-- ── Helpers ──────────────────────────────────────────────────────────────────
local function new_grid()
  local g = {}
  for y = 1, H do
    g[y] = {}
    for x = 1, W do g[y][x] = { ' ', '' } end
  end
  return g
end

local function gput(g, x, y, ch, co)
  if x >= 1 and x <= W and y >= 1 and y <= H then g[y][x] = { ch, co } end
end

local function gputs(g, x, y, s, co)
  for i = 1, #s do gput(g, x + i - 1, y, s:sub(i, i), co) end
end

local function nalive(aliens)
  local n = 0
  for r = 1, NR do for col = 1, NC do if aliens[r][col] then n = n + 1 end end end
  return n
end

-- Leftmost and rightmost alive alien columns
local function hbounds(aliens)
  local l, r = NC + 1, 0
  for col = 1, NC do
    for row = 1, NR do
      if aliens[row][col] then
        if col < l then l = col end
        if col > r then r = col end
      end
    end
  end
  return l, r
end

-- Row index of deepest alive alien (or 0)
local function deepest(aliens)
  for row = NR, 1, -1 do
    for col = 1, NC do if aliens[row][col] then return row end end
  end
  return 0
end

-- Ticks between alien steps; shrinks as aliens die
local function movspeed(alive, lvl)
  return math.max(2, 20 - math.floor((NC * NR - alive) * 0.65) - (lvl - 1) * 3)
end

-- ── Renderer ─────────────────────────────────────────────────────────────────
local function render(px, aliens, ax, ay, afr, bullet, bombs,
                      shields, ufo, score, hi, lives, lvl, tick, state, msg)
  local g = new_grid()

  -- aliens
  for row = 1, NR do
    local al = ALIEN[row]
    local sp = (afr == 1) and al[2] or al[3]
    local gy = ay + (row - 1) * 2
    for col = 1, NC do
      if aliens[row][col] then
        gputs(g, ax + (col - 1) * SP, gy, sp, al[1])
      end
    end
  end

  -- UFO
  if ufo.active then gputs(g, ufo.x, 1, '<===>', c.bmagenta) end

  -- shields  (top row = ###  bottom row = # #, degrade to #.# / gaps)
  for _, sh in ipairs(shields) do
    if sh.hp > 0 then
      local co = (sh.hp >= 5) and c.bgreen or (sh.hp >= 3) and c.byellow or c.bred
      gputs(g, sh.x, sh.y,     sh.hp >= 4 and '###' or '#.#', co)
      gputs(g, sh.x, sh.y + 1, sh.hp >= 2 and '# #' or '   ', co)
    end
  end

  -- player bullet
  if bullet then gput(g, bullet.x, bullet.y, '|', c.bwhite) end

  -- enemy bombs
  for _, b in ipairs(bombs) do gput(g, b.x, b.y, '*', c.bred) end

  -- player ship (blinks during hit-flash)
  if state ~= 'dead' or (tick % 6 < 3) then
    gputs(g, px, H, '/|\\', c.bwhite)
  end

  -- assemble output
  local out = {}

  -- HUD line (lives as ship icons)
  local lv_str = ''
  for i = 1, lives do lv_str = lv_str .. c.bwhite .. '/|\\ ' end
  out[#out + 1] = ' ' .. c.byellow .. 'SCORE ' .. c.bwhite .. string.format('%05d', score)
               .. c.byellow .. '  HI ' .. c.bwhite .. string.format('%05d', hi)
               .. c.byellow .. '  LV'  .. c.bwhite .. lvl
               .. '  ' .. c.byellow .. 'LIVES ' .. lv_str .. c.reset

  -- top border
  out[#out + 1] = c.cyan .. '+' .. string.rep('-', W) .. '+' .. c.reset

  -- grid rows
  for y = 1, H do
    local ln  = c.cyan .. '|'
    local lco = ''
    for x = 1, W do
      local cell = g[y][x]
      if cell[2] ~= lco then ln = ln .. cell[2]; lco = cell[2] end
      ln = ln .. cell[1]
    end
    out[#out + 1] = ln .. c.reset .. c.cyan .. '|' .. c.reset
  end

  -- bottom border + hint
  out[#out + 1] = c.cyan .. '+' .. string.rep('-', W) .. '+' .. c.reset
  if msg then
    out[#out + 1] = '  ' .. msg .. c.reset
  else
    out[#out + 1] = c.white .. '  A/D:MOVE   SPACE:FIRE   Q:QUIT' .. c.reset
  end

  phos.draw(table.concat(out, '\n'))
end

-- ── Title screen (blinking loop) ─────────────────────────────────────────────
local function title(hi)
  local blink = 0
  while true do
    blink = blink + 1
    local flash = (blink % 8 < 4) and c.byellow or c.bwhite
    local out   = {}
    out[#out + 1] = ''
    out[#out + 1] = c.bcyan  .. '  +------------------------------------------+' .. c.reset
    out[#out + 1] = c.bcyan  .. '  |                                          |' .. c.reset
    out[#out + 1] = c.bwhite .. '  |    ####  ####   ##    ####  ####         |' .. c.reset
    out[#out + 1] = c.bwhite .. '  |   ##    ##  ## ####  ##    ##            |' .. c.reset
    out[#out + 1] = c.bwhite .. '  |    ###  ####  ##  ## ##    ####          |' .. c.reset
    out[#out + 1] = c.bwhite .. '  |      ## ##    ###### ##    ##            |' .. c.reset
    out[#out + 1] = c.bwhite .. '  |   ####  ##    ##  ##  ####  ####         |' .. c.reset
    out[#out + 1] = c.bcyan  .. '  |                                          |' .. c.reset
    out[#out + 1] = c.bgreen .. '  |   INVADERS   NES-STYLE ARCADE SHOOTER    |' .. c.reset
    out[#out + 1] = c.bcyan  .. '  +------------------------------------------+' .. c.reset
    out[#out + 1] = ''
    out[#out + 1] = flash    .. '       >>>  PRESS SPACE TO START  <<<        ' .. c.reset
    out[#out + 1] = ''
    out[#out + 1] = c.bcyan  .. '   /^\\  ' .. c.bwhite .. '30 pts    '
                 .. c.bgreen  .. '(o)  '     .. c.bwhite .. '20 pts    '
                 .. c.byellow .. 'v^v  '     .. c.bwhite .. '10 pts    '
                 .. c.bmagenta.. '<===>  '   .. c.bwhite .. '?? pts' .. c.reset
    out[#out + 1] = ''
    out[#out + 1] = c.white  .. '   HI-SCORE: '
                 .. c.bwhite .. string.format('%05d', hi) .. c.reset
    out[#out + 1] = ''
    out[#out + 1] = c.white  .. '   A/D:MOVE   SPACE:FIRE   Q:QUIT' .. c.reset
    phos.draw(table.concat(out, '\n'))
    phos.sleep(150)
    local k = phos.get_key()
    if k == 'q' or k == 'Q' then return false end
    if k == ' ' or k == 'Space' or k == 'Enter' then return true end
  end
end

-- ── One full game  (returns when lives run out or player quits) ──────────────
local function play(hi)
  local score = 0
  local lives = 3
  local lvl   = 1
  local quit  = false

  -- level-scoped state
  local aliens, ax, ay, adx, afr
  local bullet, bombs, shields, ufo
  local tick, movtimer

  local function init_level()
    aliens = {}
    for r = 1, NR do
      aliens[r] = {}
      for col = 1, NC do aliens[r][col] = true end
    end
    ax = 3; ay = 2; adx = 1; afr = 1
    bullet   = nil
    bombs    = {}
    shields  = {
      { x =  5, y = H - 3, hp = 6 },
      { x = 16, y = H - 3, hp = 6 },
      { x = 27, y = H - 3, hp = 6 },
      { x = 38, y = H - 3, hp = 6 },
    }
    ufo      = { x = 0, dir = 1, active = false, pts = 0,
                 timer = math.random(200, 400) }
    tick     = 0
    movtimer = movspeed(NC * NR, lvl)
  end

  init_level()
  local px = math.floor(W / 2) - 1

  -- resolves bullet collisions, mutates state in place
  local function check_bullet()
    if not bullet then return end
    -- vs aliens
    for r = 1, NR do
      for col = 1, NC do
        if aliens[r][col] then
          local gx = ax + (col - 1) * SP
          local gy = ay + (r   - 1) * 2
          if bullet.y == gy and bullet.x >= gx and bullet.x <= gx + 2 then
            aliens[r][col] = false
            score = score + ALIEN[r][4]
            if score > hi then hi = score end
            bullet = nil; return
          end
        end
      end
    end
    -- vs UFO
    if ufo.active and bullet.y == 1
       and bullet.x >= ufo.x and bullet.x <= ufo.x + 4 then
      score = score + ufo.pts
      if score > hi then hi = score end
      ufo.active = false; ufo.timer = math.random(200, 400)
      bullet = nil; return
    end
    -- vs shields
    for _, sh in ipairs(shields) do
      if sh.hp > 0 and (bullet.y == sh.y or bullet.y == sh.y + 1)
         and bullet.x >= sh.x and bullet.x <= sh.x + 2 then
        sh.hp = sh.hp - 1; bullet = nil; return
      end
    end
  end

  -- ── main loop ──────────────────────────────────────────────────────────────
  while lives > 0 and not quit do
    tick = tick + 1

    -- render current state first, then poll for input during the tick window
    render(px, aliens, ax, ay, afr, bullet, bombs, shields, ufo,
           score, hi, lives, lvl, tick, 'play', nil)

    local key    = ''
    local waited = 0
    while waited < TICK do
      phos.sleep(16)
      waited = waited + 16
      local k = phos.get_key()
      if k ~= '' then key = k; break end
    end

    if key == 'q' or key == 'Q' then quit = true; break end

    -- player movement
    if (key == 'a' or key == 'ArrowLeft')  and px > 1     then px = px - 1 end
    if (key == 'd' or key == 'ArrowRight') and px < W - 2 then px = px + 1 end

    -- fire
    if (key == ' ' or key == 'Space') and not bullet then
      bullet = { x = px + 1, y = H - 1 }
    end

    -- advance bullet
    if bullet then
      bullet.y = bullet.y - 1
      if bullet.y < 1 then bullet = nil end
    end

    -- advance bombs
    local nb = {}
    for _, b in ipairs(bombs) do
      b.y = b.y + 1
      if b.y <= H then nb[#nb + 1] = b end
    end
    bombs = nb

    -- random bomb drop (max 4 active; 1-in-28 chance each tick)
    if math.random(28) == 1 and #bombs < 4 then
      local pool = {}
      for col = 1, NC do
        for r = NR, 1, -1 do
          if aliens[r][col] then pool[#pool + 1] = { r, col }; break end
        end
      end
      if #pool > 0 then
        local s = pool[math.random(#pool)]
        bombs[#bombs + 1] = { x = ax + (s[2] - 1) * SP + 1,
                               y = ay + (s[1] - 1) * 2  + 1 }
      end
    end

    -- UFO logic
    ufo.timer = ufo.timer - 1
    if ufo.active then
      ufo.x = ufo.x + ufo.dir
      if ufo.x < -4 or ufo.x > W + 1 then
        ufo.active = false; ufo.timer = math.random(200, 400)
      end
    elseif ufo.timer <= 0 then
      local fl = math.random(2) == 1
      ufo = { x     = fl and -4 or W + 1,
              dir   = fl and  1 or -1,
              active= true,
              pts   = (math.random(4) + 1) * 50,
              timer = math.random(200, 400) }
    end

    -- move alien grid
    movtimer = movtimer - 1
    if movtimer <= 0 then
      movtimer = movspeed(nalive(aliens), lvl)
      afr = (afr == 1) and 2 or 1            -- toggle animation frame
      local lc, rc = hbounds(aliens)
      local left   = ax + (lc - 1) * SP
      local right  = ax + (rc - 1) * SP + 2
      if adx == 1 and right >= W then
        adx = -1; ay = ay + 1
      elseif adx == -1 and left <= 1 then
        adx = 1; ay = ay + 1
      else
        ax = ax + adx
      end
    end

    -- collisions
    check_bullet()

    for _, b in ipairs(bombs) do        -- bombs erode shields
      for _, sh in ipairs(shields) do
        if sh.hp > 0 and (b.y == sh.y or b.y == sh.y + 1)
           and b.x >= sh.x and b.x <= sh.x + 2 then
          sh.hp = sh.hp - 1; b.y = H + 1
        end
      end
    end

    -- check if player was hit by a bomb
    local player_hit = false
    for _, b in ipairs(bombs) do
      if b.y >= H and b.x >= px and b.x <= px + 2 then
        player_hit = true; break
      end
    end

    -- check if aliens reached the bottom
    local dr = deepest(aliens)
    if dr > 0 and ay + (dr - 1) * 2 >= H - 1 then player_hit = true end

    if player_hit then
      lives = lives - 1
      bullet = nil; bombs = {}
      -- flash the death frame
      for i = 1, 24 do
        tick = tick + 1
        render(px, aliens, ax, ay, afr, nil, {}, shields, ufo,
               score, hi, lives, lvl, tick, 'dead',
               c.bred .. '  *** YOU WERE HIT ***   LIVES: ' .. lives .. '  ' .. c.reset)
        phos.sleep(80)
      end
      if lives > 0 then px = math.floor(W / 2) - 1 end

    elseif nalive(aliens) == 0 then
      -- wave cleared — brief celebration then next level
      for i = 1, 30 do
        tick = tick + 1
        render(px, aliens, ax, ay, afr, nil, {}, shields, ufo,
               score, hi, lives, lvl, tick, 'win',
               c.bgreen .. '  *** WAVE ' .. lvl .. ' CLEARED! ***  ' .. c.reset)
        phos.sleep(80)
      end
      lvl   = lvl + 1
      init_level()
      px = math.floor(W / 2) - 1
    end
  end

  phos.store('inv_hi', tostring(hi))

  -- game-over flash
  for i = 1, 40 do
    tick = tick + 1
    render(px, aliens, ax, ay, afr, nil, {}, shields, ufo,
           score, hi, 0, lvl, tick, 'gameover',
           c.bred .. '  *** GAME  OVER ***   SCORE: '
           .. string.format('%05d', score) .. '   ' .. c.reset)
    phos.sleep(80)
  end

  return score, hi
end

-- ── Entry point ───────────────────────────────────────────────────────────────
local hi = tonumber(phos.fetch('inv_hi') or '0') or 0

while true do
  if not title(hi) then break end          -- title screen; Q exits

  local _, new_hi = play(hi)
  hi = new_hi

  -- replay prompt
  phos.draw(c.bwhite .. '  PRESS SPACE TO PLAY AGAIN   Q TO QUIT  ' .. c.reset)
  local again = false
  while true do
    local k = phos.read_key()
    if k == 'q' or k == 'Q' then break end
    if k == ' ' or k == 'Space' or k == 'Enter' then again = true; break end
  end
  if not again then break end
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

  'lua-invaders': {
    description: 'Play Space Invaders — NES-style shooter.  Defend Earth, earn points, survive waves.  Hi-score saved between sessions.',
    usage: 'lua-invaders',
    run: async () => {
      try {
        await initLuaVM();
      } catch (err) {
        printLine(`Lua VM failed to initialize: ${err.message}`, 'line-err');
        return;
      }
      try {
        await runLua(INVADERS_SCRIPT);
      } catch (err) {
        const msg = String(err.message).replace(LUA_PREFIX_RE, '');
        printLine(`Lua error: ${msg}`, 'line-err');
      }
    },
  },
};
