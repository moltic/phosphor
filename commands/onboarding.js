// ── commands/onboarding.js ────────────────────────────────────────────────────
// First-run boot tutorial, replayable tour command, and rotating "try this
// next" hints.  All output is keyboard-first and in-universe with the BBS /
// terminal theme.

import { loadPrefs, savePrefs } from '../core/storage.js';
import {
  printLine, printBlank, printRule,
} from '../core/render.js';

// ── Rotating one-liner hints ──────────────────────────────────────────────────
// One is shown at the bottom of every boot sequence.
// The index is derived from sessionCount so each visit surfaces a different tip.
const _TRY_HINTS = [
  'type  help      to see every available command',
  'press  Tab      on an empty input to open your speed dials',
  'use   ↑ / ↓     to scroll through command history',
  'type  n [text]  to drop a quick note before you forget it',
  'type  ls        to view your saved notes and speed dials',
  'type  dial add [alias] [url]  to bookmark a site in one line',
  'press  Ctrl+D  ( ⌘D )  to toggle the speed-dial overlay',
  'type  theme next  to cycle AMBER → GREEN → BLUE → WHITE → CRIMSON → MATRIX → ICE → WARM',
  'type  tour       to replay the getting-started guide any time',
  'press  Ctrl+,  ( ⌘, )  to open the settings panel instantly',
  'type  fortune    for a communiqué from the BBS underground',
  'type  whoami     to check your handle and session count',
  'type  n find [query]  to search notes by keyword',
  'type  motd set [text]  to pin a message on every boot screen',
  'type  help [command]  for detailed usage — e.g.  help dial',
  'type  scan        for a dramatic network sweep animation',
  'type  matrix      for a brief trip down the green rabbit hole',
  'type  countdown [N]  to set a timer right here in the terminal',
];

/**
 * Return the hint string for this session.
 * sessionCount is deterministic so each visit cycles through a new tip.
 * @param {number} sessionCount
 * @returns {string}
 */
export function pickTryHint(sessionCount) {
  const idx = Math.max(0, (sessionCount - 1)) % _TRY_HINTS.length;
  return _TRY_HINTS[idx];
}

// ── Tour pages ────────────────────────────────────────────────────────────────
// Four thematic pages; call with  tour [1-4].

export const TOUR_PAGE_COUNT = 4;

const _TOUR_PAGES = [
  // ── Page 1 — Welcome + essential navigation ──────────────────────
  {
    title: 'WELCOME  ─  GETTING STARTED  [1/4]',
    lines: [
      '',
      '  Everything is driven by the command line at the bottom.',
      '  Type a command and press  Enter  — that\'s all there is to it.',
      '',
      '  ESSENTIALS',
      '  ─────────────────────────────────────────────────────',
      '  help              list every command with descriptions',
      '  help [command]    detailed usage — e.g.  help dial',
      '  ↑ / ↓             scroll through command history',
      '  Tab               open the speed-dial overlay',
      '  Escape            clear what you\'ve typed',
      '  Ctrl+L  /  ⌘L     wipe the screen (notes stay safe)',
      '',
      '  Type  tour 2  to continue the guide.',
      '  Type  skip-tour  to stop seeing this on boot.',
    ],
  },

  // ── Page 2 — Notes ───────────────────────────────────────────────
  {
    title: 'TOUR  [2/4]  ──  NOTES & SCRATCH PAD',
    lines: [
      '',
      '  Capture anything without leaving the tab:',
      '',
      '  n [text]               save a note instantly',
      '  ls                     list notes + speed dials',
      '  n find [query]         search notes by keyword',
      '  n rm [N]               delete note by its list number',
      '  n edit [N] [text]      rewrite a note in place',
      '  n clear                wipe all notes (asks for confirmation)',
      '',
      '  Example:  n ship PR #42 before standup',
      '',
      '  Notes sync across your Chrome profile via chrome.storage.sync.',
      '',
      '  Type  tour 3  to continue  ─  type  tour 1  to go back.',
    ],
  },

  // ── Page 3 — Speed dials ─────────────────────────────────────────
  {
    title: 'TOUR  [3/4]  ──  SPEED DIAL SHORTCUTS',
    lines: [
      '',
      '  A visual bookmark grid — fully keyboard-accessible:',
      '',
      '  Tab  /  Ctrl+D  /  ⌘D      open or close the overlay',
      '  dial add [alias] [url]      add a bookmark',
      '  dial rm [alias]             remove a bookmark',
      '  dial rename [alias] [label] give a tile a new label',
      '  dial category [name]        create a category group',
      '  dial add [alias] [url] --category [name]',
      '                              add directly into a category',
      '',
      '  Inside the overlay, press  [EDIT]  to drag-and-drop reorder.',
      '  Right-click (or long-press) any tile for a context menu.',
      '',
      '  Type  tour 4  to continue  ─  or  dial  to see full syntax.',
    ],
  },

  // ── Page 4 — Themes & personalisation ───────────────────────────
  {
    title: 'TOUR  [4/4]  ──  THEMES & PERSONALISE',
    lines: [
      '',
      '  Make the terminal yours:',
      '',
      '  theme [name]          switch theme: amber  green  blue  white  crimson  matrix  ice  warm',
      '  theme next            cycle to the next theme',
      '  Ctrl+,  /  ⌘,         open the full settings panel',
      '  settings              same as the keyboard shortcut',
      '  banner [text]         render your own neon ASCII header',
      '  motd set [text]       pin a message on every boot screen',
      '  whoami                reveal your BBS handle + session count',
      '  fortune               receive a communiqué from the void',
      '',
      '  ✦  End of tour.  You are now fully initialised, operator.',
      '',
      '  Type  tour  any time to replay from page 1.',
      '  Type  skip-tour  to stop showing the boot guide.',
    ],
  },
];

// ── Internal print helper ─────────────────────────────────────────────────────
function _printTourPage(page) {
  printRule('─');
  printLine(`  ░▒▓  ${page.title}  ▓▒░`, 'line-head');
  printRule('─');
  for (const l of page.lines) {
    if (l === '') {
      printBlank();
    } else if (l.startsWith('  ─')) {
      printLine(l, 'line-sep');
    } else if (l.startsWith('  ✦') || l.startsWith('  ╔') || l.startsWith('  ║') || l.startsWith('  ╚')) {
      printLine(l, 'line-ok');
    } else {
      printLine(l, 'line-info');
    }
  }
  printRule('─');
}

// ── printFirstRunTutorial ─────────────────────────────────────────────────────

/**
 * Print page 1 of the tour as part of the boot sequence.
 * Called when prefs.onboardingDone is falsy.
 * Does NOT open/close a batch — caller manages that.
 */
export function printFirstRunTutorial() {
  _printTourPage(_TOUR_PAGES[0]);
  printBlank();
}

// ── Exported commands ─────────────────────────────────────────────────────────

export const onboardingCommands = {

  // ── tour ──────────────────────────────────────────────────────────
  tour: {
    description: 'Replay the getting-started guide.  tour [1-4] for a specific page.',
    usage: 'tour [page]',
    run(args) {
      const n    = parseInt(args[0] ?? '1', 10);
      const idx  = (isNaN(n) || n < 1) ? 0 : Math.min(n - 1, _TOUR_PAGES.length - 1);
      printBlank();
      _printTourPage(_TOUR_PAGES[idx]);
      printBlank();
    },
  },

  // ── skip-tour ─────────────────────────────────────────────────────
  'skip-tour': {
    description: 'Stop showing the getting-started guide on boot.  Type  tour  to replay it any time.',
    usage: 'skip-tour',
    async run() {
      const prefs = await loadPrefs();
      if (prefs.onboardingDone) {
        printLine('  Boot guide is already suppressed.', 'line-info');
        printLine('  Type  tour  to replay it any time.', 'line-info');
        return;
      }
      prefs.onboardingDone = true;
      await savePrefs(prefs);
      printLine('  ✓ Boot guide suppressed.  Type  tour  to replay it any time.', 'line-ok');
    },
  },

};
