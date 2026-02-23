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

'use strict';

// ── 1. DOM refs ────────────────────────────────────────────────────

const outputEl  = document.getElementById('output');
const inputEl   = document.getElementById('cmd-input');   // hidden real <input>
const displayEl = document.getElementById('input-display'); // visible mirror
const cursorEl  = document.getElementById('cursor');
const timeEl    = document.getElementById('status-time');

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

  // ── ls — list notes + aliases ───────────────────────────────────
  ls: {
    description: 'List saved notes (latest 20) and speed-dial aliases.',
    usage: 'ls',
    async run(_args) {
      const notes = await loadNotes();

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

      // ── Speed-dial section
      printBlank();
      printRule('─');
      printLine('  SPEED DIAL', 'line-head');
      printRule('─');
      Object.entries(ALIASES).forEach(([alias, url]) => {
        printLine(`  ${alias.padEnd(12)} →  ${url}`, 'line-info');
      });
      printBlank();
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

// ── Re-focus the input whenever the user clicks anywhere on the page
document.addEventListener('click', () => inputEl.focus());

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
