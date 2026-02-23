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
  small:  '1.05rem',
  medium: '1.25rem',
  large:  '1.5rem',
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
  theme:      'amber',
  fontSize:   'medium',
  scanlines:  true,
  bannerText: DEFAULT_BANNER,
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
  const probeW = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  if (!probeW) return;

  // Leave a little room for the layered banner offsets so it doesn't clip.
  const available  = Math.max(0, el.parentElement.clientWidth - 18);
  const currentPx  = parseFloat(getComputedStyle(el).fontSize);
  const idealPx    = (available * BANNER_FIT_SCALE / probeW) * currentPx;
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
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
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
 * @returns {Promise<Array<{alias:string, label:string, url:string}>>}
 */
function loadDials() {
  return new Promise(resolve => {
    chrome.storage.local.get({ dials: [] }, data => resolve(data.dials));
  });
}

/**
 * Persist speed-dial entries back to chrome.storage.local.
 * @param {Array<{alias:string, label:string, url:string}>} dials
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
 * @returns {Promise<{theme:string, heading:string, fontSize:string, scanlines:boolean}>}
 */
function loadPrefs() {
  return new Promise(resolve => {
    chrome.storage.local.get({ prefs: {} }, data => {
      resolve({ ...DEFAULT_PREFS, ...data.prefs });
    });
  });
}

/**
 * Persist user preferences to chrome.storage.local.
 * @param {{theme:string, heading:string, fontSize:string, scanlines:boolean}} prefs
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
 * @param {{theme:string, heading:string, fontSize:string, scanlines:boolean}} prefs
 */
async function applyPrefs(prefs) {
  const root    = document.documentElement;
  const palette = THEMES[prefs.theme] || THEMES.amber;
  Object.entries(palette).forEach(([prop, val]) => root.style.setProperty(prop, val));

  root.style.setProperty('--font-size', FONT_SIZES[prefs.fontSize] || FONT_SIZES.medium);

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

/** Return Google's favicon service URL for a given destination URL. */
function getFaviconUrl(url) {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return '';
  }
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
    const tile = document.createElement('a');
    tile.className = 'dial-tile';
    tile.dataset.alias = dial.alias;
    tile.title = dial.url;
    tile.href = dial.url;
    tile.rel = 'noopener noreferrer';
    tile.draggable = true;

    const img = document.createElement('img');
    img.className = 'dial-favicon';
    img.src = getFaviconUrl(dial.url);
    img.alt = '';
    img.addEventListener('error', () => img.setAttribute('data-broken', ''));

    const labelEl = document.createElement('span');
    labelEl.className = 'dial-label';
    labelEl.textContent = dial.label || dial.alias;

    tile.appendChild(img);
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
      tile.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dial.alias);
      } catch {
        // Some environments may restrict dataTransfer; reordering will just no-op.
      }
    });

    tile.addEventListener('dragend', () => {
      tile.classList.remove('is-dragging');
      // Delay reset so the subsequent click (if any) can be suppressed.
      setTimeout(() => { isDraggingDial = false; }, 0);
    });

    tile.addEventListener('dragover', e => {
      // Required to allow dropping.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    tile.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();

      const fromAlias = e.dataTransfer?.getData('text/plain');
      const toAlias = dial.alias;
      if (!fromAlias || fromAlias === toAlias) return;

      const current = await loadDials();
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      const toIndex = current.findIndex(d => d.alias === toAlias);
      if (fromIndex === -1 || toIndex === -1) return;

      const rect = tile.getBoundingClientRect();
      const before = e.clientX < (rect.left + rect.width / 2);

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
    });

    dialGridEl.addEventListener('drop', async e => {
      const tile = e.target.closest('.dial-tile');
      if (tile) return; // handled by tile drop

      e.preventDefault();
      e.stopPropagation();

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
  menu.setAttribute('aria-hidden', 'true');

  const editBtn = document.createElement('button');
  editBtn.className = 'ctx-menu-item';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    showDialEditDialog(alias);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ctx-menu-item';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    await removeDial(alias);
  });

  menu.appendChild(editBtn);
  menu.appendChild(removeBtn);
  document.body.appendChild(menu);
  return menu;
})();

function showDialCtxMenu(x, y, alias) {
  ctxMenuEl.dataset.target = alias;
  ctxMenuEl.style.left = `${x}px`;
  ctxMenuEl.style.top  = `${y}px`;
  ctxMenuEl.classList.add('visible');

  // Nudge inside viewport if the menu clips an edge
  requestAnimationFrame(() => {
    const r = ctxMenuEl.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctxMenuEl.style.left = `${x - r.width}px`;
    if (r.bottom > window.innerHeight) ctxMenuEl.style.top  = `${y - r.height}px`;
  });
}

function hideDialCtxMenu() {
  ctxMenuEl.classList.remove('visible');
  delete ctxMenuEl.dataset.target;
}

// ── Edit dialog ───────────────────────────────────────────────────

const editDialogEl = (() => {
  const overlay = document.createElement('div');
  overlay.id = 'dial-edit-dialog';

  const inner = document.createElement('div');
  inner.className = 'dial-edit-inner';

  const title = document.createElement('div');
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

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  inner.appendChild(title);
  inner.appendChild(labelInput);
  inner.appendChild(urlInput);
  inner.appendChild(actions);
  overlay.appendChild(inner);

  // Click outside the inner box → dismiss
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { e.stopPropagation(); hideDialEditDialog(); }
  });

  // Keyboard shortcuts inside dialog
  inner.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commitDialEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); hideDialEditDialog(); }
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
  editDialogEl.classList.add('visible');
  document.getElementById('dial-edit-label').focus();
}

function hideDialEditDialog() {
  editDialogEl.classList.remove('visible');
  delete editDialogEl.dataset.target;
  inputEl.focus();
}

async function commitDialEdit() {
  const alias    = editDialogEl.dataset.target;
  const newLabel = document.getElementById('dial-edit-label').value.trim();
  let   newUrl   = document.getElementById('dial-edit-url').value.trim();

  if (!alias || !newLabel || !newUrl) return;

  // Auto-prefix scheme if missing
  if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(newUrl)) newUrl = `https://${newUrl}`;

  const dials = await loadDials();
  const idx   = dials.findIndex(d => d.alias === alias);
  if (idx !== -1) {
    dials[idx] = { alias, label: newLabel, url: newUrl };
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
  panel.setAttribute('aria-label', 'Settings');

  const titleEl = document.createElement('div');
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

  const fontSelect = makeSelect('s-fontsize', [
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

  panel.appendChild(titleEl);
  panel.appendChild(makeRow('THEME',     themeSelect));
  panel.appendChild(makeRow('FONT SIZE', fontSelect));
  panel.appendChild(bannerRow);
  panel.appendChild(makeRow('SCANLINES', scanSelect));
  panel.appendChild(actionsEl);

  // Keyboard shortcuts inside the panel
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSettingsPanel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      commitSettings();
    }
  });

  // Insert inline — between #speed-dial and #output
  outputEl.before(panel);
  return panel;
})();

async function openSettingsPanel() {
  const prefs = await loadPrefs();
  document.getElementById('s-theme').value    = prefs.theme    || 'amber';
  document.getElementById('s-fontsize').value = prefs.fontSize || 'medium';
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
    fontSize:   document.getElementById('s-fontsize').value,
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
      Object.entries(commands).forEach(([, cmd]) => {
        const usageCol = cmd.usage.padEnd(26);
        printLine(`  ${usageCol} ${cmd.description}`, 'line-out');
      });

      printBlank();
      printLine('  Keyboard shortcuts', 'line-head');
      printRule('─', 38);
      printLine('  ↑ / ↓          Navigate command history', 'line-info');
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
    run(args) {
      if (args.length === 0) {
        printLine('Usage:   l [alias | url]', 'line-info');
        printLine('Example: l gh     or     l example.com', 'line-info');
        printBlank();
        printLine('Speed-dial aliases:', 'line-info');
        Object.entries(ALIASES).forEach(([alias, url]) => {
          printLine(`  ${alias.padEnd(12)} →  ${url}`, 'line-info');
        });
        return;
      }

      // Use only the first token — extra words are silently ignored
      const raw   = args[0].trim();
      const lower = raw.toLowerCase();

      // 1) Known alias (case-insensitive match)
      if (Object.prototype.hasOwnProperty.call(ALIASES, lower)) {
        printLine(`Opening ${ALIASES[lower]}`, 'line-ok');
        window.location.href = ALIASES[lower];
        return;
      }

      // 2) Already has a scheme  (http://, https://, ftp://, etc.)
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)) {
        printLine(`Opening ${raw}`, 'line-ok');
        window.location.href = raw;
        return;
      }

      // 3) Looks like a bare domain  (contains a dot, no whitespace)
      if (/^[^\s]+\.[^\s]+$/.test(raw)) {
        const url = `https://${raw}`;
        printLine(`Opening ${url}`, 'line-ok');
        window.location.href = url;
        return;
      }

      // 4) Unrecognised
      printLine(`Unknown alias or unrecognised URL: "${raw}"`, 'line-err');
      printLine('Type  l  with no arguments to list aliases.', 'line-info');
    },
  },

  // ── n — save a note ─────────────────────────────────────────────
  n: {
    description: 'Save a timestamped note.  e.g. n call dentist',
    usage: 'n [text ...]',
    async run(args) {
      if (args.length === 0) {
        printLine('Usage:   n [text ...]', 'line-info');
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
    description: 'List saved notes (latest 20) and speed-dial tiles.',
    usage: 'ls',
    async run(_args) {
      const [notes, dials] = await Promise.all([loadNotes(), loadDials()]);

      // ── Notes section
      printBlank();
      printRule('─');
      printLine('  NOTES', 'line-head');
      printRule('─');

      if (notes.length === 0) {
        printLine('  (no notes yet — use:  n [text])', 'line-info');
      } else {
        const recent = [...notes].reverse().slice(0, 20);
        recent.forEach((note, i) => {
          const idx  = String(i + 1).padStart(3, ' ');
          const time = formatTimestamp(note.ts);
          printLine(`  ${idx}.  [${time}]  ${note.text}`, 'line-out');
        });
        if (notes.length > 20) {
          printLine(
            `  … and ${notes.length - 20} older note(s) not shown.`,
            'line-info',
          );
        }
      }

      // ── Speed-dial section (stored dials)
      printBlank();
      printRule('─');
      printLine('  SPEED DIAL', 'line-head');
      printRule('─');
      if (dials.length === 0) {
        printLine('  (no dials — use:  dial add [alias] [url])', 'line-info');
      } else {
        dials.forEach(d => {
          const labelCol = (d.label || d.alias).padEnd(14);
          printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
        });
      }
      printBlank();
    },
  },

  // ── dial — manage speed-dial tiles ─────────────────────────────
  dial: {
    description: 'Manage speed-dial tiles.  dial add [alias] [url] | dial rm [alias]',
    usage: 'dial add [alias] [url]  |  dial rm [alias]',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'add') {
        const alias  = args[1];
        const rawUrl = args[2];

        if (!alias || !rawUrl) {
          printLine('Usage:   dial add [alias] [url]', 'line-info');
          printLine('Example: dial add hn https://news.ycombinator.com', 'line-info');
          return;
        }

        // Auto-prefix scheme if the user omitted it
        const url = /^[a-z][a-z0-9+\-.]*:\/\//i.test(rawUrl)
          ? rawUrl
          : `https://${rawUrl}`;

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
        const alias = args[1];

        if (!alias) {
          printLine('Usage:   dial rm [alias]', 'line-info');
          return;
        }

        const dials = await loadDials();
        if (!dials.some(d => d.alias === alias)) {
          printLine(`Alias "${alias}" not found.`, 'line-err');
          return;
        }

        await removeDial(alias);

      } else {
        // No subcommand: list current dials
        const dials = await loadDials();
        printBlank();
        printRule('─');
        printLine('  SPEED DIAL', 'line-head');
        printRule('─');
        if (dials.length === 0) {
          printLine('  (no dials — use:  dial add [alias] [url])', 'line-info');
        } else {
          dials.forEach(d => {
            const labelCol = (d.label || d.alias).padEnd(14);
            printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
          });
        }
        printBlank();
        printLine('  dial add [alias] [url]  — add a new tile', 'line-info');
        printLine('  dial rm  [alias]        — remove a tile', 'line-info');
        printLine('  Right-click any tile    — Edit / Remove', 'line-info');
        printBlank();
      }
    },
  },

  // ── clr — clear screen ──────────────────────────────────────────
  clr: {
    description: 'Clear the terminal output (notes in storage are kept).',
    usage: 'clr',
    run(_args) {
      clearScreen();
    },
  },

  // ── settings — open the settings panel ──────────────────────────
  settings: {
    description: 'Open settings panel (theme, font size, heading, scanlines).',
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
 * Parse a raw input string and route it to the correct command handler.
 * @param {string} raw  – the full text string from the input field
 */
function dispatch(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return;

  // Echo what the user typed
  printLine(`> ${trimmed}`, 'line-cmd');

  // Split into [commandName, ...args]
  const [cmdName, ...args] = trimmed.split(/\s+/);
  const key = cmdName.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(commands, key)) {
    // run() may return a Promise (async commands); catch any errors
    Promise.resolve(commands[key].run(args)).catch(err => {
      printLine(`Error: ${err.message}`, 'line-err');
      console.error('[BBTAB]', err);
    });
  } else {
    printLine(`Unknown command: "${cmdName}"`, 'line-err');
    printLine('Type  help  to see available commands.', 'line-info');
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

    default:
      break;
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cursorEl.style.animationPlayState = 'paused';
  } else {
    cursorEl.style.animationPlayState = 'running';
    inputEl.focus();
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
  const d  = new Date();
  const hh = String(d.getHours()  ).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const YY = d.getFullYear();
  const MO = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()     ).padStart(2, '0');
  timeEl.textContent = `${YY}-${MO}-${DD}  ${hh}:${mm}:${ss}`;
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
  setInterval(tickClock, 1_000);

  // ── MOTD / welcome banner
  printRule('═');
  printLine('  SYSTEM READY.  BBTAB HOME TERMINAL.', 'line-head');
  printLine(`  ${new Date().toDateString()}`, 'line-info');
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

  // Always focus the command input on load
  inputEl.focus();
}

init();
