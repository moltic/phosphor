// ── commands/help.js ──────────────────────────────────────────────────────────
// help + keys commands.  Uses dependency injection for the command registry
// to avoid a circular import with commands/index.js.

import { wrapWords, printLine, printBlank, printRule, outputEl } from '../core/render.js';

/** Injected reference to the full commands map — set by commands/index.js. */
let _commandsRef = {};

/** Called once from commands/index.js after the registry is built. */
export function setCommandsRegistry(cmds) {
  _commandsRef = cmds;
}

export const helpCommands = {

  // ── help ──────────────────────────────────────────────────────────
  help: {
    description: 'Show help for all commands.',
    usage: 'help',
    run(_args) {
      printBlank();
      printRule('═');
      printLine('  PHOSPHOR COMMAND REFERENCE', 'line-head');
      printRule('═');
      printBlank();

      const COL       = 26;
      const DESC_START = 2 + COL + 1;
      const _probe = document.createElement('span');
      _probe.className = 'line line-out';
      _probe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre';
      _probe.textContent = 'x'.repeat(80);
      outputEl.appendChild(_probe);
      const _charW = _probe.getBoundingClientRect().width / 80;
      outputEl.removeChild(_probe);
      const MAX_WIDTH  = _charW > 0 ? Math.floor(outputEl.clientWidth / _charW) - 1 : 90;
      const DESC_WIDTH = MAX_WIDTH - DESC_START;
      const indent     = ' '.repeat(DESC_START);

      Object.entries(_commandsRef).forEach(([, cmd]) => {
        const descLines = wrapWords(cmd.description, DESC_WIDTH);
        if (cmd.usage.length <= COL) {
          printLine(`  ${cmd.usage.padEnd(COL)} ${descLines[0]}`, 'line-out');
        } else {
          printLine(`  ${cmd.usage}`, 'line-out');
          printLine(`${indent}${descLines[0]}`, 'line-info');
        }
        for (let i = 1; i < descLines.length; i++) {
          printLine(`${indent}${descLines[i]}`, 'line-info');
        }
      });

      printBlank();
      printLine('  Keyboard shortcuts', 'line-head');
      printRule('─', 38);
      printLine('  ↑ / ↓          Navigate command history', 'line-info');
      printLine('  Tab            Auto-complete command name', 'line-info');
      printLine('  Ctrl+L / ⌘L    Clear current input (not the screen)', 'line-info');
      printLine('  Ctrl+D / ⌘D    Add current tab as a speed-dial tile', 'line-info');
      printLine('  (Run  keys  for a full shortcut reference)', 'line-info');
      printBlank();
    },
  },

  // ── keys ──────────────────────────────────────────────────────────
  keys: {
    description: 'Print a formatted table of all keyboard shortcuts.',
    usage: 'keys',
    run(_args) {
      const K = 16;
      const A = 38;
      const top = '╔' + '═'.repeat(K) + '╦' + '═'.repeat(A) + '╗';
      const mid = '╠' + '═'.repeat(K) + '╬' + '═'.repeat(A) + '╣';
      const bot = '╚' + '═'.repeat(K) + '╩' + '═'.repeat(A) + '╝';
      const row = (k, a) =>
        '║' + (' ' + k).padEnd(K) + '║' + (' ' + a).padEnd(A) + '║';

      const shortcuts = [
        ['↑ / ↓',        'Navigate command history'],
        ['Tab',           'Auto-complete command name'],
        ['Ctrl+L / ⌘L',   'Clear current input (not the screen)'],
        ['Ctrl+D / ⌘D',   'Add current tab as a speed-dial tile'],
        ['Ctrl+, / ⌘,',   'Open / close Settings panel'],
        ['Escape',        'Clear / cancel current input'],
        ['Right-click',   'Paste or open browser context menu'],
      ];

      printBlank();
      printLine(top, 'line-sep');
      printLine(row('Shortcut', 'Action'), 'line-head');
      printLine(mid, 'line-sep');
      for (const [k, a] of shortcuts) {
        printLine(row(k, a), 'line-out');
      }
      printLine(bot, 'line-sep');
      printBlank();
    },
  },

};
