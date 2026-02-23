// ============================================================
//  BBTAB — script.js
//  Retro BBS / terminal New Tab override  (Chrome MV3)
// ============================================================
//
//  Storage schema  (chrome.storage.local):
//    {
//      notes: [
//        { id: string, text: string, ts: number }   // ts = Date.now()
//      ]
//    }
//
//  Architecture:
//    1.  DOM refs & constants
//    2.  Render helpers   (printLine, printBlock, clearScreen …)
//    3.  Storage helpers  (loadNotes, saveNotes)
//    4.  Command registry (commands object — add new commands here)
//    5.  Parser / dispatcher
//    6.  Input event wiring
//    7.  Clock
//    8.  init()
// ============================================================

// (Banner rendering uses the in-code legacy font; FIGlet is not used.)

// ── 1. DOM refs ────────────────────────────────────────────────────

const outputEl  = document.getElementById('output');
const inputEl   = document.getElementById('cmd-input');   // hidden real <input>

// Active batch container — printLine writes here while a command is running;
// the whole block is appended to outputEl in one shot so aria-live fires once.
let _batchEl = null;
const displayEl = document.getElementById('input-display'); // visible mirror
const cursorEl  = document.getElementById('cursor');
const timeEl    = document.getElementById('status-time');
const dialGridEl = document.getElementById('speed-dial');

// ── Speed-dial alias map.
//    Add / remove entries freely; both `l` and `ls` read this object.
const ALIASES = {
  reddit : 'https://www.reddit.com',
  yt     : 'https://www.youtube.com',
  gh     : 'https://github.com',
  tw     : 'https://x.com',
  wiki   : 'https://en.wikipedia.org',
  hn     : 'https://news.ycombinator.com',
  mail   : 'https://mail.google.com',
  maps   : 'https://maps.google.com',
};

// ── Theme palettes — applied as CSS custom-property overrides on :root ──────
const THEMES = {
  amber: {
    '--bg':          '#0a0800',
    '--fg':          '#ffb000',
    '--fg-dim':      '#a06800',
    '--fg-bright':   '#ffd050',
    '--glow':        'rgba(255, 176, 0, 0.60)',
    '--glow-soft':   'rgba(255, 176, 0, 0.22)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  green: {
    '--bg':          '#001408',
    '--fg':          '#33ff77',
    '--fg-dim':      '#1a7a40',
    '--fg-bright':   '#80ffaa',
    '--glow':        'rgba(51, 255, 119, 0.55)',
    '--glow-soft':   'rgba(51, 255, 119, 0.20)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  blue: {
    '--bg':          '#000a1a',
    '--fg':          '#40b4ff',
    '--fg-dim':      '#206080',
    '--fg-bright':   '#80d4ff',
    '--glow':        'rgba(64, 180, 255, 0.55)',
    '--glow-soft':   'rgba(64, 180, 255, 0.20)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  white: {
    '--bg':          '#0a0a0a',
    '--fg':          '#cccccc',
    '--fg-dim':      '#666666',
    '--fg-bright':   '#eeeeee',
    '--glow':        'rgba(200, 200, 200, 0.30)',
    '--glow-soft':   'rgba(200, 200, 200, 0.12)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.15)',
  },
};

const FONT_SIZES = {
  // Use px (not rem) so terminal and dial sizes can be independent.
  // rem would scale with the root font-size, re-coupling the two.
  small:  '16.8px',
  medium: '20px',
  large:  '24px',
};

const DEFAULT_BANNER = 'BBTAB';

// Original BBTAB banner (verbatim). Used when bannerText is "BBTAB" so the
// output matches the legacy header exactly.
const ORIGINAL_BBTAB_BANNER = [
  '██████╗ ██████╗ ████████╗ █████╗ ██████╗',
  '██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗',
  '██████╔╝██████╔╝   ██║   ███████║██████╔╝',
  '██╔══██╗██╔══██╗   ██║   ██╔══██║██╔══██╗',
  '██████╔╝██████╔╝   ██║   ██║  ██║██████╔╝',
  '╚═════╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═════╝',
].join('\n');

// Legacy 6-row banner font (Unicode) inspired by the original header style.
// Goal: keep the same look for any user-entered banner text.
const LEGACY_BANNER_FONT = {
  ' ': ['   ', '   ', '   ', '   ', '   ', '   '],
  '?': ['█████╗ ', '╚═══██╗', '  ██╔╝ ', ' ██╔╝  ', ' ██║   ', ' ╚═╝   '],
  '-': ['      ', '      ', '█████╗', '╚════╝', '      ', '      '],
  ',': ['    ', '    ', '    ', '    ', '██╗ ', '╚██║'],
  '.': ['   ', '   ', '   ', '   ', '██╗', '╚═╝'],
  ':': ['   ', '██╗', '╚═╝', '██╗', '╚═╝', '   '],
  // Lowercase variants (only where we want clearer differentiation).
  // These are 6-row glyphs with an intentionally blank top row so they
  // read as "lowercase" under the legacy banner style.
  'a': ['        ', ' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '╚█████╔╝'],
  'e': ['        ', ' █████╗ ', '██╔═══╝ ', '█████╗  ', '██╔══╝  ', '╚█████╗ '],
  '0': [' ██████╗', '██╔═████╗', '██║██╔██║', '████╔╝██║', '╚██████╔╝', ' ╚═════╝ '],
  '1': [' ██╗', '███║', '╚██║', ' ██║', ' ██║', ' ╚═╝'],
  '2': ['██████╗ ', '╚════██╗', ' █████╔╝', '██╔═══╝ ', '███████╗', '╚══════╝'],
  '3': ['██████╗ ', '╚════██╗', ' █████╔╝', ' ╚═══██╗', '██████╔╝', '╚═════╝ '],
  '4': ['██╗  ██╗', '██║  ██║', '███████║', '╚════██║', '     ██║', '     ╚═╝'],
  '5': ['███████╗', '██╔════╝', '██████╗ ', '╚════██╗', '██████╔╝', '╚═════╝ '],
  '6': [' ██████╗', '██╔════╝', '██████╗ ', '██╔══██╗', '╚██████╔╝', ' ╚═════╝ '],
  '7': ['███████╗', '╚════██║', '    ██╔╝', '   ██╔╝ ', '   ██║  ', '   ╚═╝  '],
  '8': [' █████╗ ', '██╔══██╗', '╚█████╔╝', '██╔══██╗', '╚█████╔╝', ' ╚════╝ '],
  '9': [' █████╗ ', '██╔══██╗', '╚██████║', ' ╚═══██║', ' █████╔╝', ' ╚════╝ '],
  'A': [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  'B': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██████╔╝', '╚═════╝ '],
  'C': [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  'D': ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  'E': ['███████╗', '██╔════╝', '██████╗ ', '██╔═══╝ ', '███████╗', '╚══════╝'],
  'F': ['███████╗', '██╔════╝', '██████╗ ', '██╔═══╝ ', '██║     ', '╚═╝     '],
  'G': [' ██████╗', '██╔════╝', '██║  ███╗', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  'H': ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  'I': ['██████╗', '╚══██╔╝', '   ██║ ', '   ██║ ', '██████╗', '╚═════╝'],
  'J': ['     ██╗', '     ██║', '     ██║', '██   ██║', '╚█████╔╝', ' ╚════╝ '],
  'K': ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
  'L': ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  'M': ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  'N': ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  'O': [' ██████╗', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  'P': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  'Q': [' ██████╗', '██╔═══██╗', '██║   ██║', '██║▄▄ ██║', '╚██████╔╝', ' ╚══▀▀═╝ '],
  'R': ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  'S': [' ██████╗', '██╔════╝', '╚█████╗ ', ' ╚═══██╗', '██████╔╝', '╚═════╝ '],
  'T': ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  'U': ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  'V': ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
  'W': ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  'X': ['██╗  ██╗', '╚██╗██╔╝', ' ╚███╔╝ ', ' ██╔██╗ ', '██╔╝ ██╗', '╚═╝  ╚═╝'],
  'Y': ['██╗   ██╗', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚██╔╝  ', '   ██║   ', '   ╚═╝   '],
  'Z': ['███████╗', '╚══███╔╝', '  ███╔╝ ', ' ███╔╝  ', '███████╗', '╚══════╝'],
};

function renderLegacyBannerText(text) {
  const normalized = String(text || DEFAULT_BANNER).replace(/\r/g, '').trim();
  if (!normalized) return ORIGINAL_BBTAB_BANNER;

  const chars = [...normalized];
  const rows = 6;
  const out = [];

  // Ascenders keep the top row so they read as tall letters.
  // Exclude h/l so those lowercase letters don't look identical to H/L.
  const LOWER_ASCENDERS = new Set(['b', 'd', 'f', 'k', 't']);

  function glyphRowsForChar(ch) {
    const isLower = ch >= 'a' && ch <= 'z';
    const upper = isLower ? ch.toUpperCase() : ch;
    const key = (isLower && LEGACY_BANNER_FONT[ch])
      ? ch
      : (LEGACY_BANNER_FONT[upper] ? upper : (LEGACY_BANNER_FONT[ch] ? ch : '?'));
    const glyph = LEGACY_BANNER_FONT[key];
    const width = Math.max(0, ...glyph.map(r => r.length));

    // Lowercase with explicit glyphs: use as-is (already designed to be shorter).
    if (isLower && key === ch) {
      return glyph.map(r => String(r || '').padEnd(width, ' '));
    }

    if (!isLower) {
      return glyph.map(r => String(r || '').padEnd(width, ' '));
    }

    // Lowercase: keep the same block fill for readability, but make it shorter
    // by dropping the top row. Preserve ascenders for letters that should have
    // them (b/d/f/h/k/l/t).
    const keepAscender = LOWER_ASCENDERS.has(ch);
    const row0 = keepAscender
      ? String(glyph[0] || '').padEnd(width, ' ')
      : ' '.repeat(width);

    const body = glyph
      .slice(1)
      .map(r => String(r || '').padEnd(width, ' '));

    return [row0, ...body].slice(0, rows);
  }

  for (let y = 0; y < rows; y += 1) {
    const line = chars.map((ch) => {
      const glyphRows = glyphRowsForChar(ch);
      return glyphRows[y] || '';
    }).join(' ');
    out.push(line.replace(/\s+$/g, ''));
  }

  return out.join('\n');
}

/** Render banner text using the legacy neon block style. */
async function renderBanner(text) {
  const normalized = String(text || DEFAULT_BANNER).replace(/\r/g, '').trim();
  const bannerText = normalized || DEFAULT_BANNER;

  // Preserve the exact original header look for the default title.
  if (bannerText === 'BBTAB') {
    return { kind: 'html', value: buildBannerHtml(ORIGINAL_BBTAB_BANNER) };
  }

  const raw = renderLegacyBannerText(bannerText);
  return { kind: 'html', value: buildBannerHtml(raw) };
}

const DEFAULT_PREFS = {
  theme:        'amber',
  terminalSize: 'medium',
  dialSize:     'medium',
  scanlines:    true,
  bannerText:   DEFAULT_BANNER,
};

function setAsciiArt(el, text) {
  const val = text || '';
  // Content is generated by renderBanner (not user input). Default to HTML mode
  // for the neon banner renderer, but allow plain text for exact legacy art.
  const asHtml = arguments.length >= 3 ? Boolean(arguments[2]?.asHtml) : true;
  if (asHtml) el.innerHTML = val;
  else el.textContent = val;
}

// Visual scale for the header banner after auto-fit measurement.
// 0.94 ≈ ~25% larger than the previous 0.75 scaling, while still leaving a
// little room so the banner doesn't clip.
const BANNER_FIT_SCALE = 0.94;
// Cap the auto-fit measurement length so extremely wide banners don't force the
// entire header to shrink into illegibility. Most typical phrases still fit.
const BANNER_FIT_MAX_CHARS = 140;

function computeDistanceFromEmpty(lines) {
  const height = lines.length;
  const width = Math.max(0, ...lines.map(line => line.length));
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (lines[y][x] || ' ') !== ' ')
  );

  if (!height || !width) return { grid, dist: [] };

  const padH = height + 2;
  const padW = width + 2;
  const occ = Array.from({ length: padH }, () => Array(padW).fill(false));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      occ[y + 1][x + 1] = grid[y][x];
    }
  }

  const distPad = Array.from({ length: padH }, () => Array(padW).fill(Infinity));
  const q = [];
  let qHead = 0;
  for (let y = 0; y < padH; y += 1) {
    for (let x = 0; x < padW; x += 1) {
      if (!occ[y][x]) {
        distPad[y][x] = 0;
        q.push([x, y]);
      }
    }
  }

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qHead < q.length) {
    const [x, y] = q[qHead++];
    const nextDist = distPad[y][x] + 1;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= padW || ny >= padH) continue;
      if (nextDist < distPad[ny][nx]) {
        distPad[ny][nx] = nextDist;
        q.push([nx, ny]);
      }
    }
  }

  const dist = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => distPad[y + 1][x + 1])
  );

  return { grid, dist };
}

function bannerCellClass(distance, x, y) {
  if (distance <= 1) return 'b-rim';
  if (distance === 2) return 'b-edge';
  if (distance === 3) return 'b-mid';
  if (distance >= 5 && (x + y) % 7 === 0) return 'b-node';
  return 'b-core';
}

function escapeHtmlChar(ch) {
  switch (ch) {
    case '&': return '&amp;';
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '"': return '&quot;';
    default: return ch;
  }
}

function buildBannerHtml(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return '';

  const { grid, dist } = computeDistanceFromEmpty(lines);
  const height = grid.length;
  const width = Math.max(0, ...lines.map(line => line.length));

  const lineHtml = lines.map((line, y) => {
    let out = '';
    for (let x = 0; x < width; x += 1) {
      if (!(grid[y]?.[x])) {
        out += ' ';
        continue;
      }

      const cls = `b-cell ${bannerCellClass(dist[y][x], x, y)}`;
      out += `<span class="${cls}">█</span>`;
    }
    return out;
  });

  return lineHtml.join('\n');
}

function buildBannerHtmlPreserveGlyphs(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return '';

  const { grid, dist } = computeDistanceFromEmpty(lines);
  const height = grid.length;
  const width = Math.max(0, ...lines.map(line => line.length));

  const traceMask = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => Boolean(grid[y]?.[x]) && dist[y][x] <= 2)
  );

  const lineHtml = lines.map((line, y) => {
    let out = '';
    for (let x = 0; x < width; x += 1) {
      if (!(grid[y]?.[x])) {
        out += ' ';
        continue;
      }

      const tn = y > 0 && traceMask[y - 1][x] ? 1 : 0;
      const te = x + 1 < width && traceMask[y][x + 1] ? 1 : 0;
      const ts = y + 1 < height && traceMask[y + 1][x] ? 1 : 0;
      const tw = x > 0 && traceMask[y][x - 1] ? 1 : 0;
      const traceCount = tn + te + ts + tw;
      const hasTrace = traceMask[y][x] && traceCount > 0;
      const cls = `b-cell ${bannerCellClass(dist[y][x], x, y)}${hasTrace ? ' has-trace' : ''}`;
      const style = hasTrace
        ? ` style="--tn:${tn};--te:${te};--ts:${ts};--tw:${tw};"`
        : '';
      const traceAttr = hasTrace ? ` data-j="${traceCount >= 3 ? '1' : '0'}"` : '';

      const ch = line[x] || '█';
      out += `<span class="${cls}"${style}${traceAttr}>${escapeHtmlChar(ch)}</span>`;
    }
    return out;
  });

  return lineHtml.join('\n');
}

/**
 * Scale #ascii-art font-size so the longest line fills ~95% of its container.
 * Uses a probe element for accurate measurement with the actual loaded font.
 */
async function fitBanner(el) {
  await document.fonts.ready;
  const lines = el.textContent.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));
  if (!maxLen) return;

  const fitLen = Math.min(maxLen, BANNER_FIT_MAX_CHARS);

  // Measure character width at the current computed font-size
  const probe = document.createElement('pre');
  probe.style.cssText =
    'position:absolute;top:-9999px;left:-9999px;visibility:hidden;' +
    'margin:0;padding:0;border:0;font:inherit';
  probe.textContent = '█'.repeat(fitLen);
  document.body.appendChild(probe);
  const probeW  = probe.getBoundingClientRect().width;
  // Use the probe's own computed font-size as the reference so the result is
  // always derived from the base/inherited size — not from el's previously
  // scaled inline style, which would compound on every applyPrefs() call.
  const refPx   = parseFloat(getComputedStyle(probe).fontSize);
  document.body.removeChild(probe);
  if (!probeW || !refPx) return;

  // Leave a little room for the layered banner offsets so it doesn't clip.
  const available  = Math.max(0, el.parentElement.clientWidth - 18);
  const idealPx    = (available * BANNER_FIT_SCALE / probeW) * refPx;
  el.style.fontSize = Math.min(Math.max(Math.round(idealPx), 6), 40) + 'px';
}

// ── Command-history state (session-only, not persisted)
let cmdHistory   = [];   // [0] = most-recently-executed command
let historyIndex = -1;   // -1 means "not navigating history"
let pendingInput = '';   // draft the user had before pressing ↑

// ============================================================
//  2. Render helpers
// ============================================================

/**
 * Append one line of text to the output area.
 *
 * @param {string} text - displayed text (plain; HTML is escaped automatically)
 * @param {string} [cls='line-out'] – one of:
 *   'line-cmd'  user-echoed command
 *   'line-out'  normal output
 *   'line-err'  error  (red)
 *   'line-info' hint / dim text
 *   'line-ok'   success (green)
 *   'line-sep'  decorative / separator
 *   'line-head' bold heading line
 */
function printLine(text, cls = 'line-out') {
  const span = document.createElement('span');
  span.className = `line ${cls}`;
  span.textContent = text;          // textContent → safe, no XSS
  if (_batchEl) {
    _batchEl.appendChild(span);
  } else {
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }
}

/**
 * Append multiple lines at once, all with the same CSS class.
 * @param {string[]} lines
 * @param {string}   [cls='line-out']
 */
function printBlock(lines, cls = 'line-out') {
  lines.forEach(l => printLine(l, cls));
}

/** Insert one blank line. */
function printBlank() {
  printLine('');
}

/** Insert a full-width horizontal rule made from a repeated character. */
function printRule(char = '─', length = 58) {
  printLine(char.repeat(length), 'line-sep');
}

/** Wipe the terminal output area.  Storage is untouched. */
function clearScreen() {
  outputEl.innerHTML = '';
}

/**
 * Start collecting printLine output into a single off-DOM container.
 * Call before running a command so all its lines are batched together.
 */
function beginBatch() {
  _batchEl = document.createElement('div');
  _batchEl.className = 'cmd-output-block';
}

/**
 * Flush the current batch to #output in one DOM insertion so the
 * aria-live="polite" region announces the full response once.
 */
function endBatch() {
  if (_batchEl) {
    if (_batchEl.hasChildNodes()) {
      outputEl.appendChild(_batchEl);
      outputEl.scrollTop = outputEl.scrollHeight;
    }
    _batchEl = null;
  }
}

// ── Input mirror helpers ─────────────────────────────────────────

/**
 * Set the hidden <input> value and immediately sync the visible display.
 * Always use this instead of writing inputEl.value directly.
 * @param {string} val
 */
function setInput(val) {
  inputEl.value = val;
  syncDisplay();
}

/**
 * Copy the real <input> value into the visible #input-display span.
 * Called on every keystroke so the two stay in lockstep.
 */
function syncDisplay() {
  // textContent handles all special chars safely (no HTML injection)
  displayEl.textContent = inputEl.value;
}

// ============================================================
//  3. Storage helpers
// ============================================================

/**
 * Load notes array from chrome.storage.local.
 * @returns {Promise<Array<{id:string, text:string, ts:number}>>}
 */
function loadNotes() {
  return new Promise(resolve => {
    chrome.storage.local.get({ notes: [] }, data => resolve(data.notes));
  });
}

/**
 * Persist the notes array back to chrome.storage.local.
 * @param {Array<{id:string, text:string, ts:number}>} notes
 * @returns {Promise<void>}
 */
function saveNotes(notes) {
  return new Promise(resolve => {
    chrome.storage.local.set({ notes }, resolve);
  });
}

/**
 * Load speed-dial entries from chrome.storage.local.
 * @returns {Promise<Array<{alias:string, label:string, url:string, icon?:string}>>}
 */
function loadDials() {
  return new Promise(resolve => {
    chrome.storage.local.get({ dials: [] }, data => resolve(data.dials));
  });
}

/**
 * Persist speed-dial entries back to chrome.storage.local.
 * @param {Array<{alias:string, label:string, url:string, icon?:string}>} dials
 * @returns {Promise<void>}
 */
function saveDials(dials) {
  return new Promise(resolve => {
    chrome.storage.local.set({ dials }, resolve);
  });
}

/**
 * Load user preferences from chrome.storage.local.
 * Falls back to DEFAULT_PREFS for any missing key.
 * @returns {Promise<{theme:string, terminalSize:string, dialSize:string, scanlines:boolean, bannerText:string}>}
 */
function loadPrefs() {
  return new Promise(resolve => {
    chrome.storage.local.get({ prefs: {} }, data => {
      const stored = data.prefs || {};
      const merged = { ...DEFAULT_PREFS, ...stored };

      // Legacy migration: older versions stored a single `fontSize`.
      // If new keys are missing, derive them from the legacy value.
      if (!('terminalSize' in stored) && ('fontSize' in stored)) merged.terminalSize = stored.fontSize;
      if (!('dialSize' in stored) && ('fontSize' in stored)) merged.dialSize = stored.fontSize;

      resolve(merged);
    });
  });
}

/**
 * Persist user preferences to chrome.storage.local.
 * @param {{theme:string, terminalSize:string, dialSize:string, scanlines:boolean, bannerText:string}} prefs
 * @returns {Promise<void>}
 */
function savePrefs(prefs) {
  return new Promise(resolve => {
    chrome.storage.local.set({ prefs }, resolve);
  });
}

/**
 * Apply a prefs object immediately by setting CSS custom properties on :root
 * and updating the heading text / scanline visibility.
 * @param {{theme:string, terminalSize:string, dialSize:string, scanlines:boolean, bannerText:string}} prefs
 */
async function applyPrefs(prefs) {
  const root    = document.documentElement;
  const palette = THEMES[prefs.theme] || THEMES.amber;
  Object.entries(palette).forEach(([prop, val]) => root.style.setProperty(prop, val));

  const terminalSize = prefs.terminalSize || prefs.fontSize || DEFAULT_PREFS.terminalSize;
  const dialSize = prefs.dialSize || prefs.fontSize || DEFAULT_PREFS.dialSize;

  root.style.setProperty('--font-size', FONT_SIZES[terminalSize] || FONT_SIZES.medium);
  root.style.setProperty('--dial-font-size', FONT_SIZES[dialSize] || FONT_SIZES.medium);

  const statusLabel = document.getElementById('status-label');
  if (statusLabel) statusLabel.textContent = 'BBTab HOME TERMINAL V0.1';

  const asciiArtEl = document.getElementById('ascii-art');
  if (asciiArtEl) {
    try {
      const rendered = await renderBanner(prefs.bannerText || DEFAULT_BANNER);
      setAsciiArt(asciiArtEl, rendered.value, { asHtml: rendered.kind === 'html' });
      await fitBanner(asciiArtEl);
    } catch {
      setAsciiArt(asciiArtEl, prefs.bannerText || DEFAULT_BANNER, { asHtml: false });
    }
  }

  const scanlinesEl = document.getElementById('scanlines');
  if (scanlinesEl) scanlinesEl.style.display = prefs.scanlines === false ? 'none' : '';
}

// ============================================================
//  Speed-dial UI  (grid + context menu + edit dialog)
// ============================================================

/**
 * Build a coloured letter-box icon element for a dial — no external requests.
 * The background colour is derived deterministically from the label/alias string.
 */
const _LETTER_ICON_COLORS = [
  '#1a5276', // deep blue
  '#1a7a40', // deep green
  '#7a5c1a', // amber
  '#1a6b7a', // teal
  '#5c1a7a', // purple
  '#7a1a1a', // crimson
  '#7b1a4e', // magenta
  '#2e7a1a', // olive
];

function _letterIconColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return _LETTER_ICON_COLORS[h % _LETTER_ICON_COLORS.length];
}

function buildLetterIcon(dial) {
  const label = String(dial?.label || dial?.alias || dial?.url || '?');
  const letter = ([...label][0] ?? '?').toUpperCase();
  const span = document.createElement('span');
  span.className = 'dial-letter-icon';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = letter;
  span.style.backgroundColor = _letterIconColor(label.toLowerCase());
  return span;
}

function isLikelyUrl(val) {
  return /^[a-z][a-z0-9+\-.]*:\/\//i.test(val);
}

function normalizeDialIcon(val) {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'none') return 'none';
  return trimmed;
}

function isShortTextIcon(val) {
  const s = String(val ?? '').trim();
  if (!s || isLikelyUrl(s) || s.toLowerCase() === 'none') return false;
  // Count code points (good enough for emoji + short labels like GH).
  return [...s].length <= 3;
}

function buildDialIconElement(dial) {
  const icon = normalizeDialIcon(dial?.icon);
  if (icon === 'none') return null;

  // Default: letter-box icon (no external requests)
  if (!icon) {
    return buildLetterIcon(dial);
  }

  // Emoji / short text
  if (isShortTextIcon(icon)) {
    const span = document.createElement('span');
    span.className = 'dial-icon-text';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = icon;
    return span;
  }

  // Custom image URL (fallback to letter-box if it fails — no external requests)
  if (isLikelyUrl(icon)) {
    const img = document.createElement('img');
    img.className = 'dial-favicon';
    img.src = icon;
    img.alt = '';
    img.addEventListener('error', () => {
      const letter = buildLetterIcon(dial);
      img.replaceWith(letter);
    });
    return img;
  }

  // Any other value: treat as short text if possible, else first 3 code points.
  const span = document.createElement('span');
  span.className = 'dial-icon-text';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = [...icon].slice(0, 3).join('');
  return span;
}

// ── Drop-position indicator (fixed overlay so it never reflows the grid) ──
let _dropIndicator = null;
let _dropPreview = null; // { toAlias: string|null, before: boolean, end: boolean }

function ensureDropIndicator() {
  if (_dropIndicator) return _dropIndicator;
  _dropIndicator = document.createElement('div');
  _dropIndicator.className = 'dial-drop-indicator';
  _dropIndicator.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_dropIndicator);
  return _dropIndicator;
}

function showDropIndicatorAt(x, top, height) {
  const el = ensureDropIndicator();
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.height = `${Math.max(10, Math.round(height))}px`;
  el.classList.add('visible');
}

function hideDropIndicator() {
  _dropPreview = null;
  _dropIndicator?.classList.remove('visible');
}

function chooseBeforeWithDeadzone(rect, clientX, priorBefore) {
  const mid = rect.left + rect.width / 2;
  const lo = rect.left + rect.width * 0.45;
  const hi = rect.left + rect.width * 0.55;
  if (clientX < lo) return true;
  if (clientX > hi) return false;
  return typeof priorBefore === 'boolean' ? priorBefore : (clientX < mid);
}

function previewDropNearElement(toAlias, rect, clientX) {
  const prior = _dropPreview?.toAlias === toAlias && !_dropPreview.end ? _dropPreview.before : undefined;
  const before = chooseBeforeWithDeadzone(rect, clientX, prior);
  _dropPreview = { toAlias, before, end: false };
  const x = before ? rect.left : rect.right;
  showDropIndicatorAt(x, rect.top, rect.height);
}

function previewDropAtEnd() {
  const items = dialGridEl.querySelectorAll('.dial-tile, .dial-divider');
  const last = items.length ? items[items.length - 1] : null;
  if (!last) return;
  const rect = last.getBoundingClientRect();
  _dropPreview = { toAlias: null, before: false, end: true };
  showDropIndicatorAt(rect.right, rect.top, rect.height);
}

function getPreviewBeforeFor(toAlias, fallbackRect, clientX) {
  if (_dropPreview && !_dropPreview.end && _dropPreview.toAlias === toAlias) return _dropPreview.before;
  return clientX < (fallbackRect.left + fallbackRect.width / 2);
}

/** (Re)render all dial tiles into #speed-dial from storage. */
async function renderDials() {
  const dials = await loadDials();
  dialGridEl.innerHTML = '';

  function arrayMove(arr, fromIndex, toIndex) {
    const next = [...arr];
    if (fromIndex < 0 || fromIndex >= next.length) return next;
    const clampedTo = Math.max(0, Math.min(toIndex, next.length - 1));
    const [item] = next.splice(fromIndex, 1);
    next.splice(clampedTo, 0, item);
    return next;
  }

  async function moveDialAliasToIndex(alias, toIndex) {
    const current = await loadDials();
    const fromIndex = current.findIndex(d => d.alias === alias);
    if (fromIndex === -1) return;
    const next = arrayMove(current, fromIndex, toIndex);
    await saveDials(next);
    await renderDials();
  }

  let isDraggingDial = false;

  dials.forEach(dial => {
    // ── Divider spacer ──────────────────────────────────────────
    if (dial.type === 'divider') {
      const isCol = dial.col === true;
      const dividerEl = document.createElement('div');
      dividerEl.className = isCol ? 'dial-divider col-divider' : 'dial-divider row-divider';
      dividerEl.dataset.alias = dial.alias;
      dividerEl.draggable = true;
      dividerEl.title = isCol
        ? 'Column Divider — drag to reorder, right-click to remove'
        : 'Row Divider — drag to reorder, right-click to remove';

      dividerEl.addEventListener('dragstart', e => {
        isDraggingDial = true;
        hideDropIndicator();
        dividerEl.classList.add('is-dragging');
        dialGridEl.classList.add('is-dragging-dial');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dial.alias);
        } catch { /* ignore */ }
      });

      dividerEl.addEventListener('dragend', () => {
        dividerEl.classList.remove('is-dragging');
        dialGridEl.classList.remove('is-dragging-dial');
        hideDropIndicator();
        setTimeout(() => { isDraggingDial = false; }, 0);
      });

      dividerEl.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dividerEl.classList.contains('is-dragging')) return;
        previewDropNearElement(dial.alias, dividerEl.getBoundingClientRect(), e.clientX);
      });

      dividerEl.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        hideDropIndicator();
        dialGridEl.classList.remove('is-dragging-dial');
        const fromAlias = e.dataTransfer?.getData('text/plain');
        const toAlias   = dial.alias;
        if (!fromAlias || fromAlias === toAlias) return;
        const current = await loadDials();
        const fromIndex = current.findIndex(d => d.alias === fromAlias);
        const toIndex   = current.findIndex(d => d.alias === toAlias);
        if (fromIndex === -1 || toIndex === -1) return;
        const rect   = dividerEl.getBoundingClientRect();
        const before = getPreviewBeforeFor(toAlias, rect, e.clientX);
        let insertIndex = toIndex + (before ? 0 : 1);
        if (fromIndex < insertIndex) insertIndex -= 1;
        insertIndex = Math.max(0, Math.min(insertIndex, current.length - 1));
        const next = arrayMove(current, fromIndex, insertIndex);
        await saveDials(next);
        await renderDials();
      });

      dividerEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        showDialCtxMenu(e.clientX, e.clientY, dial.alias, true);
      });

      dialGridEl.appendChild(dividerEl);
      return;
    }
    // ────────────────────────────────────────────────────────────

    const tile = document.createElement('a');
    tile.className = 'dial-tile';
    tile.dataset.alias = dial.alias;
    tile.title = dial.url;
    tile.href = dial.url;
    tile.rel = 'noopener noreferrer';
    tile.draggable = true;
    tile.setAttribute('aria-label', `${dial.label || dial.alias}: ${dial.url}`);

    const iconEl = buildDialIconElement(dial);

    const labelEl = document.createElement('span');
    labelEl.className = 'dial-label';
    labelEl.textContent = dial.label || dial.alias;

    if (iconEl) tile.appendChild(iconEl);
    tile.appendChild(labelEl);

    // Allow native link behavior (middle-click, ctrl-click, etc). We only stop
    // propagation so the document focus handler doesn't steal focus.
    tile.addEventListener('click', e => {
      // Prevent accidental navigation when the user just finished dragging.
      if (isDraggingDial) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
    });

    tile.addEventListener('dragstart', e => {
      isDraggingDial = true;
      hideDropIndicator();
      tile.classList.add('is-dragging');
      dialGridEl.classList.add('is-dragging-dial');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dial.alias);
      } catch {
        // Some environments may restrict dataTransfer; reordering will just no-op.
      }
    });

    tile.addEventListener('dragend', () => {
      tile.classList.remove('is-dragging');
      dialGridEl.classList.remove('is-dragging-dial');
      hideDropIndicator();
      // Delay reset so the subsequent click (if any) can be suppressed.
      setTimeout(() => { isDraggingDial = false; }, 0);
    });

    tile.addEventListener('dragover', e => {
      // Required to allow dropping.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (tile.classList.contains('is-dragging')) return;
      previewDropNearElement(dial.alias, tile.getBoundingClientRect(), e.clientX);
    });

    tile.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      hideDropIndicator();
      dialGridEl.classList.remove('is-dragging-dial');

      const fromAlias = e.dataTransfer?.getData('text/plain');
      const toAlias = dial.alias;
      if (!fromAlias || fromAlias === toAlias) return;

      const current = await loadDials();
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      const toIndex = current.findIndex(d => d.alias === toAlias);
      if (fromIndex === -1 || toIndex === -1) return;

      const rect = tile.getBoundingClientRect();
      const before = getPreviewBeforeFor(toAlias, rect, e.clientX);

      // Compute insertion index (before/after), then adjust for removal shift.
      let insertIndex = toIndex + (before ? 0 : 1);
      if (fromIndex < insertIndex) insertIndex -= 1;
      insertIndex = Math.max(0, Math.min(insertIndex, current.length - 1));

      const next = arrayMove(current, fromIndex, insertIndex);
      await saveDials(next);
      await renderDials();
    });

    // Right-click → context menu
    tile.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showDialCtxMenu(e.clientX, e.clientY, dial.alias);
    });

    dialGridEl.appendChild(tile);
  });

  // Drop on empty space in the grid → move dragged tile to the end.
  if (!dialGridEl.dataset.dndBound) {
    dialGridEl.dataset.dndBound = '1';

    dialGridEl.addEventListener('dragover', e => {
      // Allow drop; if we're over a tile, that tile's handler will run.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Show indicator at end when hovering empty grid space.
      if (!e.target.closest('.dial-tile, .dial-divider')) {
        previewDropAtEnd();
      }
    });

    dialGridEl.addEventListener('drop', async e => {
      const tile = e.target.closest('.dial-tile, .dial-divider');
      if (tile) return; // handled by tile/divider drop

      e.preventDefault();
      e.stopPropagation();
      hideDropIndicator();
      dialGridEl.classList.remove('is-dragging-dial');

      const fromAlias = e.dataTransfer?.getData('text/plain');
      if (!fromAlias) return;
      const current = await loadDials();
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      if (fromIndex === -1) return;

      await moveDialAliasToIndex(fromAlias, current.length - 1);
    });
  }
}

// ── Context menu ─────────────────────────────────────────────────

const ctxMenuEl = (() => {
  const menu = document.createElement('div');
  menu.id = 'dial-ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-hidden', 'true');

  const openTabBtn = document.createElement('button');
  openTabBtn.className = 'ctx-menu-item';
  openTabBtn.dataset.action = 'open-tab';
  openTabBtn.setAttribute('role', 'menuitem');
  openTabBtn.setAttribute('tabindex', '-1');
  openTabBtn.textContent = 'Open in new tab';
  openTabBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    const dials = await loadDials();
    const dial  = dials.find(d => d.alias === alias);
    if (dial?.url) window.open(dial.url, '_blank');
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'ctx-menu-item';
  editBtn.dataset.action = 'edit';
  editBtn.setAttribute('role', 'menuitem');
  editBtn.setAttribute('tabindex', '-1');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    showDialEditDialog(alias);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ctx-menu-item';
  removeBtn.setAttribute('role', 'menuitem');
  removeBtn.setAttribute('tabindex', '-1');
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    await removeDial(alias);
  });

  menu.appendChild(openTabBtn);
  menu.appendChild(editBtn);
  menu.appendChild(removeBtn);
  document.body.appendChild(menu);
  return menu;
})();

function showDialCtxMenu(x, y, alias, isDivider = false) {
  ctxMenuEl.dataset.target = alias;
  const ctxEditBtn    = ctxMenuEl.querySelector('[data-action="edit"]');
  const ctxOpenTabBtn = ctxMenuEl.querySelector('[data-action="open-tab"]');
  if (ctxEditBtn)    ctxEditBtn.style.display    = isDivider ? 'none' : '';
  if (ctxOpenTabBtn) ctxOpenTabBtn.style.display = isDivider ? 'none' : '';
  ctxMenuEl.style.left = `${x}px`;
  ctxMenuEl.style.top  = `${y}px`;
  ctxMenuEl.classList.add('visible');
  ctxMenuEl.setAttribute('aria-hidden', 'false');

  // Nudge inside viewport if the menu clips an edge, then focus first visible item
  requestAnimationFrame(() => {
    const r = ctxMenuEl.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctxMenuEl.style.left = `${x - r.width}px`;
    if (r.bottom > window.innerHeight) ctxMenuEl.style.top  = `${y - r.height}px`;
    const firstItem = ctxMenuEl.querySelector('.ctx-menu-item:not([style*="display: none"]):not([style*="display:none"])');
    if (firstItem) firstItem.focus();
  });
}

function hideDialCtxMenu() {
  ctxMenuEl.classList.remove('visible');
  ctxMenuEl.setAttribute('aria-hidden', 'true');
  delete ctxMenuEl.dataset.target;
}

// ── Edit dialog ───────────────────────────────────────────────────

const editDialogEl = (() => {
  const overlay = document.createElement('dialog');
  overlay.id = 'dial-edit-dialog';
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'dial-edit-title');

  const inner = document.createElement('div');
  inner.className = 'dial-edit-inner';

  const title = document.createElement('div');
  title.id        = 'dial-edit-title';
  title.className = 'dial-edit-title';
  title.textContent = 'EDIT DIAL';

  const labelInput = document.createElement('input');
  labelInput.id = 'dial-edit-label';
  labelInput.placeholder = 'Label';
  labelInput.autocomplete = 'off';
  labelInput.spellcheck   = false;

  const urlInput = document.createElement('input');
  urlInput.id = 'dial-edit-url';
  urlInput.placeholder = 'URL';
  urlInput.autocomplete = 'off';
  urlInput.spellcheck   = false;
  urlInput.type         = 'url';

  const iconInput = document.createElement('input');
  iconInput.id = 'dial-edit-icon';
  iconInput.placeholder = 'Icon (emoji/text or image URL — blank = letter box)';
  iconInput.autocomplete = 'off';
  iconInput.spellcheck   = false;

  const actions = document.createElement('div');
  actions.className = 'dial-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className  = 'dial-edit-btn';
  saveBtn.textContent = 'SAVE';
  saveBtn.addEventListener('click', e => {
    e.stopPropagation();
    commitDialEdit();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'dial-edit-btn';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', e => {
    e.stopPropagation();
    hideDialEditDialog();
  });

  const errorMsg = document.createElement('div');
  errorMsg.id = 'dial-edit-error';

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  inner.appendChild(title);
  inner.appendChild(labelInput);
  inner.appendChild(urlInput);
  inner.appendChild(iconInput);
  inner.appendChild(errorMsg);
  inner.appendChild(actions);
  overlay.appendChild(inner);

  // Click outside the inner box → dismiss
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { e.stopPropagation(); hideDialEditDialog(); }
  });

  // Keyboard shortcuts inside dialog
  inner.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitDialEdit(); }
  });

  // Focus trap — keep Tab cycling within the dialog
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  });

  // Native <dialog> fires 'cancel' on Escape — route through our cleanup function
  overlay.addEventListener('cancel', e => {
    e.preventDefault();
    hideDialEditDialog();
  });

  document.body.appendChild(overlay);
  return overlay;
})();

async function showDialEditDialog(alias) {
  const dials = await loadDials();
  const dial  = dials.find(d => d.alias === alias);
  if (!dial) return;

  editDialogEl.dataset.target = alias;
  document.getElementById('dial-edit-label').value = dial.label || dial.alias;
  document.getElementById('dial-edit-url').value   = dial.url;
  document.getElementById('dial-edit-icon').value  = dial.icon || '';
  editDialogEl.showModal();
  document.getElementById('dial-edit-label').focus();
}

function hideDialEditDialog() {
  editDialogEl.close();
  delete editDialogEl.dataset.target;
  document.getElementById('dial-edit-error').textContent = '';
  inputEl.focus();
}

async function commitDialEdit() {
  const alias    = editDialogEl.dataset.target;
  const newLabel = document.getElementById('dial-edit-label').value.trim();
  let   newUrl   = document.getElementById('dial-edit-url').value.trim();
  const newIconRaw = document.getElementById('dial-edit-icon').value;
  const newIcon = normalizeDialIcon(newIconRaw);

  const errorEl = document.getElementById('dial-edit-error');
  if (!newLabel && !newUrl) {
    errorEl.textContent = 'Label and URL are required.';
    return;
  }
  if (!newLabel) { errorEl.textContent = 'Label is required.'; return; }
  if (!newUrl)   { errorEl.textContent = 'URL is required.';   return; }
  errorEl.textContent = '';
  if (!alias) return;

  // Auto-prefix scheme if missing
  if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(newUrl)) newUrl = `https://${newUrl}`;

  // Reject dangerous schemes
  if (/^(javascript|data):/i.test(newUrl)) {
    errorEl.textContent = 'URL scheme not allowed.';
    return;
  }

  const dials = await loadDials();
  const idx   = dials.findIndex(d => d.alias === alias);
  if (idx !== -1) {
    const next = { ...dials[idx], alias, label: newLabel, url: newUrl };
    if (!newIcon) delete next.icon;
    else next.icon = newIcon;
    dials[idx] = next;
    await saveDials(dials);
    await renderDials();
  }

  hideDialEditDialog();
}

// ── Shared helper: remove a dial by alias and refresh the grid ────

async function removeDial(alias) {
  const dials    = await loadDials();
  const filtered = dials.filter(d => d.alias !== alias);
  await saveDials(filtered);
  await renderDials();
  printLine(`✓ Dial "${alias}" removed.`, 'line-ok');
}

// ── Settings panel ────────────────────────────────────────────────

const settingsPanelEl = (() => {
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'settings-panel-title');

  const inner = document.createElement('div');
  inner.className = 'settings-inner';
  inner.setAttribute('aria-label', 'Settings');

  const titleEl = document.createElement('div');
  titleEl.id = 'settings-panel-title';
  titleEl.className = 'settings-title';
  titleEl.textContent = '[ SETTINGS ]';

  /** Build a label + control row. */
  function makeRow(labelText, control) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lbl = document.createElement('label');
    lbl.className = 'settings-label';
    lbl.textContent = labelText;
    lbl.htmlFor = control.id;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  }

  /** Build a <select> with [value, label] pairs. */
  function makeSelect(id, pairs) {
    const sel = document.createElement('select');
    sel.id = id;
    sel.className = 'settings-select';
    pairs.forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      sel.appendChild(opt);
    });
    return sel;
  }

  const themeSelect = makeSelect('s-theme', [
    ['amber', 'AMBER'], ['green', 'GREEN'], ['blue', 'BLUE'], ['white', 'WHITE'],
  ]);

  const terminalSizeSelect = makeSelect('s-terminalsize', [
    ['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'],
  ]);

  const dialSizeSelect = makeSelect('s-dialsize', [
    ['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'],
  ]);

  const bannerInput = document.createElement('input');
  bannerInput.id          = 's-banner';
  bannerInput.className   = 'settings-input';
  bannerInput.type        = 'text';
  bannerInput.maxLength   = 24;
  bannerInput.autocomplete = 'off';
  bannerInput.spellcheck  = false;
  bannerInput.placeholder = 'e.g. BBTAB';

  const scanSelect = makeSelect('s-scanlines', [
    ['on', 'ON'], ['off', 'OFF'],
  ]);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'settings-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'settings-btn';
  saveBtn.textContent = 'SAVE';
  saveBtn.addEventListener('click', e => { e.stopPropagation(); commitSettings(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'settings-btn';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); closeSettingsPanel(); });

  actionsEl.appendChild(saveBtn);
  actionsEl.appendChild(cancelBtn);

  const bannerRow = makeRow('BANNER', bannerInput);

  inner.appendChild(titleEl);
  inner.appendChild(makeRow('THEME',     themeSelect));
  inner.appendChild(makeRow('TERMINAL SIZE', terminalSizeSelect));
  inner.appendChild(makeRow('DIAL SIZE', dialSizeSelect));
  inner.appendChild(bannerRow);
  inner.appendChild(makeRow('SCANLINES', scanSelect));
  inner.appendChild(actionsEl);

  // Keyboard shortcuts inside the panel
  inner.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSettingsPanel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      commitSettings();
    }
  });

  // Click outside the inner box → dismiss
  panel.addEventListener('click', e => {
    if (e.target === panel) { e.stopPropagation(); closeSettingsPanel(); }
  });

  panel.appendChild(inner);

  // Append to body as a modal overlay (does not affect the terminal flex layout)
  document.body.appendChild(panel);
  return panel;
})();

async function openSettingsPanel() {
  const prefs = await loadPrefs();
  document.getElementById('s-theme').value    = prefs.theme    || 'amber';
  document.getElementById('s-terminalsize').value = prefs.terminalSize || prefs.fontSize || 'medium';
  document.getElementById('s-dialsize').value = prefs.dialSize || prefs.fontSize || 'medium';
  document.getElementById('s-banner').value   = prefs.bannerText != null ? prefs.bannerText : DEFAULT_BANNER;
  document.getElementById('s-scanlines').value = prefs.scanlines === false ? 'off' : 'on';
  settingsPanelEl.classList.add('visible');
  document.getElementById('s-theme').focus();
}

function closeSettingsPanel() {
  settingsPanelEl.classList.remove('visible');
  inputEl.focus();
}

async function commitSettings() {
  const prefs = {
    theme:      document.getElementById('s-theme').value,
    terminalSize: document.getElementById('s-terminalsize').value,
    dialSize:     document.getElementById('s-dialsize').value,
    bannerText: document.getElementById('s-banner').value || DEFAULT_BANNER,
    scanlines:  document.getElementById('s-scanlines').value === 'on',
  };
  await savePrefs(prefs);
  await applyPrefs(prefs);
  closeSettingsPanel();
  printLine('✓ Settings saved.', 'line-ok');
}

// ============================================================
//  4. Command registry
//
//  To add a new command:
//    1.  Add a key to `commands` matching the command word.
//    2.  Provide { description, usage, run(args) }.
//        `args` is string[] of words that follow the command name.
//        `run` may be async.
//    3.  That's it — the dispatcher and `help` pick it up automatically.
// ============================================================

const commands = {

  // ── help ────────────────────────────────────────────────────────
  help: {
    description: 'Show help for all commands.',
    usage: 'help',
    run(_args) {
      printBlank();
      printRule('═');
      printLine('  BBTAB COMMAND REFERENCE', 'line-head');
      printRule('═');
      printBlank();

      // Build the table dynamically from the registry itself
      const COL = 26;
      Object.entries(commands).forEach(([, cmd]) => {
        if (cmd.usage.length <= COL) {
          printLine(`  ${cmd.usage.padEnd(COL)} ${cmd.description}`, 'line-out');
        } else {
          printLine(`  ${cmd.usage}`, 'line-out');
          printLine(`  ${' '.repeat(COL)} ${cmd.description}`, 'line-info');
        }
      });

      printBlank();
      printLine('  Keyboard shortcuts', 'line-head');
      printRule('─', 38);
      printLine('  ↑ / ↓          Navigate command history', 'line-info');
      printLine('  Tab            Auto-complete command name', 'line-info');
      printLine('  Ctrl+L / ⌘L    Clear current input (not the screen)', 'line-info');
      printBlank();
    },
  },

  // ── g — Google search ───────────────────────────────────────────
  g: {
    description: 'Search Google.  e.g. g javascript promises',
    usage: 'g [query ...]',
    run(args) {
      if (args.length === 0) {
        printLine('Usage:   g [query ...]', 'line-info');
        printLine('Example: g site:github.com chrome extension mv3', 'line-info');
        return;
      }
      const query = args.join(' ');
      printLine(`Searching Google: "${query}"`, 'line-ok');
      window.location.href =
        `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    },
  },

  // ── l — navigate (alias / domain / full URL) ────────────────────
  l: {
    description: 'Open a speed-dial alias or any URL.  e.g. l gh',
    usage: 'l [alias | url]',
    async run(args) {
      // Load stored dials; skip dividers and incomplete entries
      const storedDials = (await loadDials()).filter(d => !d.type && d.alias && d.url);

      if (args.length === 0) {
        printLine('Usage:   l [alias | url]', 'line-info');
        printLine('Example: l gh     or     l example.com', 'line-info');
        printBlank();

        if (storedDials.length > 0) {
          printLine('Saved dials:', 'line-info');
          storedDials.forEach(({ alias, label, url }) => {
            const desc = label && label !== alias ? `${url}  (${label})` : url;
            printLine(`  ${alias.padEnd(12)} →  ${desc}`, 'line-info');
          });
          printBlank();
        }

        printLine('Built-in aliases:', 'line-info');
        Object.entries(ALIASES).forEach(([alias, url]) => {
          printLine(`  ${alias.padEnd(12)} →  ${url}`, 'line-info');
        });
        return;
      }

      // Join all tokens back together so stored aliases can contain spaces.
      const raw   = args.join(' ').trim();
      const lower = raw.toLowerCase();

      // 1) Stored dial alias (case-insensitive, takes priority)
      const storedMatch = storedDials.find(d => d.alias.toLowerCase() === lower);
      if (storedMatch) {
        printLine(`Opening ${storedMatch.url}`, 'line-ok');
        window.location.href = storedMatch.url;
        return;
      }

      // 2) Known hardcoded alias (case-insensitive match)
      if (Object.prototype.hasOwnProperty.call(ALIASES, lower)) {
        printLine(`Opening ${ALIASES[lower]}`, 'line-ok');
        window.location.href = ALIASES[lower];
        return;
      }

      // 3) Already has a scheme  (http://, https://, ftp://, etc.)
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)) {
        printLine(`Opening ${raw}`, 'line-ok');
        window.location.href = raw;
        return;
      }

      // 4) Looks like a bare domain  (contains a dot, no whitespace)
      if (/^[^\s]+\.[^\s]+$/.test(raw)) {
        const url = `https://${raw}`;
        printLine(`Opening ${url}`, 'line-ok');
        window.location.href = url;
        return;
      }

      // 5) Unrecognised
      printLine(`Unknown alias or unrecognised URL: "${raw}"`, 'line-err');
      printLine('Type  l  with no arguments to list aliases.', 'line-info');
    },
  },

  // ── n — save a note ─────────────────────────────────────────────
  n: {
    description: 'Save a note, or manage notes.  n [text]  |  n rm [N]  |  n clear',
    usage: 'n [text ...]  |  n rm [N]  |  n clear',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      // ── n rm [N] — delete note by display index ──────────────────
      if (sub === 'rm') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n rm [N]  — delete note by display index (see ls)', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) {
          printLine(`No note at index ${N}.`, 'line-err');
          return;
        }
        const target = reversed[N - 1];
        notes.splice(notes.findIndex(note => note.id === target.id), 1);
        await saveNotes(notes);
        printLine(`✓ Note ${N} deleted.`, 'line-ok');
        return;
      }

      // ── n clear — wipe all notes ──────────────────────────────────
      if (sub === 'clear') {
        await saveNotes([]);
        printLine('✓ All notes cleared.', 'line-ok');
        return;
      }

      if (args.length === 0) {
        printLine('Usage:   n [text ...]', 'line-info');
        printLine('         n rm [N]', 'line-info');
        printLine('         n clear', 'line-info');
        printLine('Example: n review PR #42 before standup', 'line-info');
        return;
      }

      const text  = args.join(' ');
      const ts    = Date.now();
      const id    = ts.toString(36);  // compact base-36 unique-ish id

      const notes = await loadNotes();
      notes.push({ id, text, ts });
      await saveNotes(notes);

      printLine(`✓ Note saved  [${formatTimestamp(ts)}]`, 'line-ok');
    },
  },

  // ── ls — list notes + stored dials ─────────────────────────────
  ls: {
    description: 'List saved notes and speed-dial tiles.  Optionally paginate notes: ls [page] or ls notes [page].',
    usage: 'ls  |  ls [page]  |  ls notes [page]',
    async run(args) {
      const PAGE_SIZE = 20;

      // Parse optional page argument.
      // Accepted forms:  ls          → page 1, show dials
      //                  ls 3        → page 3, show dials
      //                  ls notes    → page 1, show dials
      //                  ls notes 3  → page 3, show dials
      let pageArg = null;
      if (args.length >= 1) {
        const first = args[0].toLowerCase();
        if (first === 'notes') {
          pageArg = args[1] ?? null;
        } else {
          pageArg = first;
        }
      }

      let page = 1;
      if (pageArg !== null) {
        const parsed = parseInt(pageArg, 10);
        if (isNaN(parsed) || parsed < 1) {
          printLine('Usage:  ls [page]  |  ls notes [page]', 'line-info');
          printLine('        page must be a positive integer.', 'line-info');
          return;
        }
        page = parsed;
      }

      const [notes, dials] = await Promise.all([loadNotes(), loadDials()]);
      const reversed = [...notes].reverse();
      const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE));

      if (page > totalPages) {
        printLine(
          `  Page ${page} does not exist — there are only ${totalPages} page(s) of notes.`,
          'line-err',
        );
        return;
      }

      const start = (page - 1) * PAGE_SIZE;
      const pageNotes = reversed.slice(start, start + PAGE_SIZE);

      // ── Notes section
      printBlank();
      printRule('─');
      const pageLabel = totalPages > 1 ? `  NOTES  (page ${page} / ${totalPages})` : '  NOTES';
      printLine(pageLabel, 'line-head');
      printRule('─');

      if (notes.length === 0) {
        printLine('  (no notes yet — use:  n [text])', 'line-info');
      } else {
        pageNotes.forEach((note, i) => {
          const globalIdx = String(start + i + 1).padStart(3, ' ');
          const time = formatTimestamp(note.ts);
          printLine(`  ${globalIdx}.  [${time}]  ${note.text}`, 'line-out');
        });
        if (totalPages > 1) {
          const prevHint = page > 1          ? `  ls ${page - 1}` : null;
          const nextHint = page < totalPages ? `  ls ${page + 1}` : null;
          const hints = [prevHint, nextHint].filter(Boolean).join('    ');
          printLine(`  ─  ${hints}`, 'line-info');
        }
      }

      // ── Speed-dial section (stored dials) — always shown
      printBlank();
      printRule('─');
      printLine('  SPEED DIAL', 'line-head');
      printRule('─');
      if (dials.length === 0) {
        printLine('  (no dials — use:  dial add [alias ...] [url])', 'line-info');
      } else {
        dials.forEach(d => {
          if (d.type === 'divider') { printLine('  ─── [divider] ───', 'line-info'); return; }
          const labelCol = (d.label || d.alias).padEnd(14);
          printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
        });
      }
      printBlank();
    },
  },

  // ── dial — manage speed-dial tiles ─────────────────────────────
  dial: {
    description: 'Manage speed-dial tiles.  dial add [alias ...] [url] | dial rm [alias ...] | dial divider [row|col]',
    usage: 'dial add [alias ...] [url]  |  dial rm [alias ...]  |  dial divider [row|col]',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'add') {
        // Allow multi-word aliases: take the last token as the URL and
        // everything in between as the alias.
        const rawUrl = args.length >= 3 ? args[args.length - 1] : '';
        const alias = args.slice(1, -1).join(' ').trim();

        if (!alias || !rawUrl) {
          printLine('Usage:   dial add [alias ...] [url]', 'line-info');
          printLine('Example: dial add hn https://news.ycombinator.com', 'line-info');
          printLine('Example: dial add Amazon Prime Video https://www.amazon.com/Amazon-Video/b?ie=UTF8', 'line-info');
          return;
        }

        // Auto-prefix scheme if the user omitted it
        const url = /^[a-z][a-z0-9+\-.]*:\/\//i.test(rawUrl)
          ? rawUrl
          : `https://${rawUrl}`;

        // Reject dangerous schemes
        if (/^(javascript|data):/i.test(url)) {
          printLine('Error: URL scheme not allowed.', 'line-err');
          return;
        }

        const dials = await loadDials();

        if (dials.some(d => d.alias === alias)) {
          printLine(`Alias "${alias}" already exists. Use  dial rm ${alias}  first.`, 'line-err');
          return;
        }

        dials.push({ alias, label: alias, url });
        await saveDials(dials);
        await renderDials();
        printLine(`✓ Dial "${alias}"  →  ${url}`, 'line-ok');

      } else if (sub === 'rm') {
        const alias = args.slice(1).join(' ').trim();

        if (!alias) {
          printLine('Usage:   dial rm [alias ...]', 'line-info');
          return;
        }

        const dials = await loadDials();
        if (!dials.some(d => d.alias === alias)) {
          printLine(`Alias "${alias}" not found.`, 'line-err');
          return;
        }

        await removeDial(alias);

      } else if (sub === 'divider') {
        const variant = (args[1] || 'row').toLowerCase();
        if (variant !== 'row' && variant !== 'col') {
          printLine('Usage:   dial divider [row|col]', 'line-info');
          printLine('  row  — forces a new row (default)', 'line-info');
          printLine('  col  — vertical spacer between tiles', 'line-info');
          return;
        }
        const dials = await loadDials();
        const alias  = `__div_${Date.now()}__`;
        const entry  = { type: 'divider', alias };
        if (variant === 'col') entry.col = true;
        dials.push(entry);
        await saveDials(dials);
        await renderDials();
        const label = variant === 'col' ? 'Column divider' : 'Row divider';
        printLine(`✓ ${label} added. Drag to reorder, right-click to remove.`, 'line-ok');

      } else {
        // No subcommand: list current dials
        const dials = await loadDials();
        printBlank();
        printRule('─');
        printLine('  SPEED DIAL', 'line-head');
        printRule('─');
        if (dials.length === 0) {
          printLine('  (no dials — use:  dial add [alias ...] [url])', 'line-info');
        } else {
          dials.forEach(d => {
            if (d.type === 'divider') {
              const kind = d.col ? '[col divider]' : '[row divider]';
              printLine(`  ─── ${kind} ───`, 'line-info');
              return;
            }
            const labelCol = (d.label || d.alias).padEnd(14);
            printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
          });
        }
        printBlank();
        printLine('  dial add     [alias ...] [url]  — add a new tile', 'line-info');
        printLine('  dial rm      [alias ...]        — remove a tile', 'line-info');
        printLine('  dial divider [row|col]      — add a row or column divider', 'line-info');
        printLine('  Right-click any tile        — Edit / Remove', 'line-info');
        printBlank();
      }
    },
  },

  // ── clr / clear — clear screen ──────────────────────────────────
  clr: {
    description: 'Clear the terminal output (notes in storage are kept).',
    usage: 'clr',
    run(_args) {
      clearScreen();
    },
  },

  clear: {
    description: 'Clear the terminal output (alias for clr).',
    usage: 'clear',
    run(_args) {
      clearScreen();
    },
  },

  // ── settings — open the settings panel ──────────────────────────
  settings: {
    description: 'Open settings panel (theme, terminal size, dial size, banner, scanlines).',
    usage: 'settings',
    async run(_args) {
      await openSettingsPanel();
    },
  },

};

// ============================================================
//  5. Parser / Dispatcher
// ============================================================

/**
 * Compute the Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Parse a raw input string and route it to the correct command handler.
 * @param {string} raw  – the full text string from the input field
 */
function dispatch(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return;

  // Open a batch so every printLine call during this command goes into a
  // single container that is appended to #output in one shot, causing
  // aria-live="polite" to fire exactly one announcement per command.
  beginBatch();

  // Echo what the user typed
  printLine(`> ${trimmed}`, 'line-cmd');

  // Split into [commandName, ...args]
  const [cmdName, ...args] = trimmed.split(/\s+/);
  const key = cmdName.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(commands, key)) {
    // run() may return a Promise (async commands); flush the batch and
    // catch any errors only after the full response has been produced.
    Promise.resolve(commands[key].run(args))
      .then(() => endBatch())
      .catch(err => {
        printLine(`Error: ${err.message}`, 'line-err');
        console.error('[BBTAB]', err);
        endBatch();
      });
  } else {
    printLine(`Unknown command: "${cmdName}"`, 'line-err');
    const suggestion = Object.keys(commands).find(
      k => levenshtein(key, k) === 1
    );
    if (suggestion) {
      printLine(`Did you mean  ${suggestion}?`, 'line-info');
    } else {
      printLine('Type  help  to see available commands.', 'line-info');
    }
    endBatch();
  }
}

// ============================================================
//  6. Input event wiring
// ============================================================

// Keep visible display in sync with what's in the hidden input
inputEl.addEventListener('input', () => {
  historyIndex = -1;    // typing cancels history navigation
  syncDisplay();
});

inputEl.addEventListener('keydown', e => {
  switch (e.key) {

    case 'Enter': {
      e.preventDefault();
      const val = inputEl.value;

      // Push non-empty command into session history
      if (val.trim() !== '') {
        cmdHistory.unshift(val);
        if (cmdHistory.length > 200) cmdHistory.pop();
      }

      // Reset history navigation state
      historyIndex = -1;
      pendingInput = '';

      setInput('');
      dispatch(val);
      break;
    }

    case 'ArrowUp': {
      e.preventDefault();
      if (cmdHistory.length === 0) break;
      if (historyIndex === -1) {
        // Snapshot the draft before the user starts browsing history
        pendingInput = inputEl.value;
      }
      historyIndex = Math.min(historyIndex + 1, cmdHistory.length - 1);
      setInput(cmdHistory[historyIndex]);
      break;
    }

    case 'ArrowDown': {
      e.preventDefault();
      if (historyIndex === -1) break;
      historyIndex -= 1;
      setInput(historyIndex === -1 ? pendingInput : cmdHistory[historyIndex]);
      break;
    }

    case 'Tab': {
      e.preventDefault();
      const raw   = inputEl.value;
      const parts = raw.trimStart().split(/\s+/);
      // Only complete when the user is still typing the first token
      // (no trailing space, single word so far)
      if (parts.length === 1 && !raw.endsWith(' ')) {
        const prefix = parts[0];
        if (prefix !== '') {
          const keys    = Object.keys(commands);
          const matches = keys.filter(k => k.startsWith(prefix));
          if (matches.length === 1) {
            // Unique match → fill in and add a trailing space
            setInput(matches[0] + ' ');
            historyIndex = -1;
          } else if (matches.length > 1) {
            // Multiple matches → show candidates, leave input unchanged
            printBlank();
            printLine('  ' + matches.join('   '), 'line-info');
          }
        }
      }
      break;
    }

    case 'l':
    case 'L': {
      // Ctrl+L (Win/Linux) or Cmd+L (Mac) → clear current input only
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setInput('');
        historyIndex = -1;
        pendingInput = '';
      }
      break;
    }

    case ',': {
      // Ctrl+, (Win/Linux) or Cmd+, (Mac) → toggle settings panel
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (settingsPanelEl.classList.contains('visible')) {
          closeSettingsPanel();
        } else {
          openSettingsPanel();
        }
      }
      break;
    }

    default:
      break;
  }
});

// ── Context-menu keyboard: Escape closes; arrow keys navigate items
document.addEventListener('keydown', e => {
  if (!ctxMenuEl.classList.contains('visible')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    hideDialCtxMenu();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...ctxMenuEl.querySelectorAll('.ctx-menu-item')]
      .filter(btn => btn.style.display !== 'none');
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? items[(idx + 1) % items.length]
      : items[(idx - 1 + items.length) % items.length];
    next.focus();
  }
});

// ── Dismiss context menu on any click/right-click outside it
document.addEventListener('click', e => {
  if (!e.target.closest('#dial-ctx-menu')) hideDialCtxMenu();
  // Re-focus command input unless the user is interacting with dial overlays
  if (!e.target.closest('#dial-ctx-menu, #dial-edit-dialog, #settings-panel, .dial-tile')) {
    inputEl.focus();
  }
});
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('.dial-tile')) hideDialCtxMenu();
});

// ── Pause the blinking cursor while the tab is in the background;
//    re-focus when the user returns.
let clockInterval = null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cursorEl.style.animationPlayState = 'paused';
    clearInterval(clockInterval);
    clockInterval = null;
  } else {
    cursorEl.style.animationPlayState = 'running';
    inputEl.focus();
    tickClock();
    clockInterval = setInterval(tickClock, 1_000);
  }
});

// ============================================================
//  7. Clock  (status-line, ticks every second)
// ============================================================

/**
 * Format a Unix-ms timestamp into a human-readable locale string.
 * Used by the `n` and `ls` commands.
 * @param {number} ms
 * @returns {string}
 */
function formatTimestamp(ms) {
  return new Date(ms).toLocaleString(undefined, {
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function tickClock() {
  const d = new Date();
  const datePart = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  timeEl.textContent = `${datePart}  ${timePart}`;
}

// ============================================================
//  8. init — boot sequence, runs once on page load
// ============================================================

async function init() {
  // Load prefs and render speed-dial concurrently; apply prefs before any painting
  const [prefs] = await Promise.all([loadPrefs(), renderDials()]);
  await applyPrefs(prefs);

  // Re-fit banner on window resize (debounced)
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const el = document.getElementById('ascii-art');
      if (el) fitBanner(el);
    }, 120);
  });

  // Start the clock immediately and tick every second
  tickClock();
  clockInterval = setInterval(tickClock, 1_000);

  // ── MOTD / welcome banner
  printRule('═');
  printLine('  SYSTEM READY.', 'line-head');
  printLine('  Type  help  for a list of commands.', 'line-info');
  printRule('═');
  printBlank();

  // Show note count as a quick reminder
  const notes = await loadNotes();
  if (notes.length > 0) {
    const plural = notes.length === 1 ? 'note' : 'notes';
    printLine(
      `  ${notes.length} ${plural} stored.  Type  ls  to view.`,
      'line-info',
    );
    printBlank();
  }

  // Hint for new users who have no speed-dials yet
  const dials = await loadDials();
  if (dials.length === 0) {
    printLine(
      '  No speed-dials yet.  Type  dial add <alias> <url>  to add one.',
      'line-dim',
    );
    printBlank();
  }

  // Always focus the command input on load
  inputEl.focus();
}

init();
