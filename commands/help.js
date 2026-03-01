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
    description: 'Show help for all commands, or usage for a specific command.  help [command]',
    usage: 'help [command]',
    run(_args) {
      // Per-command help: "help theme", "help n", etc.
      if (_args.length > 0) {
        const target = _args[0].toLowerCase();
        const cmd = _commandsRef[target];
        if (cmd) {
          printBlank();
          printLine(`  ${cmd.usage}`, 'line-head');
          printLine(`  ${cmd.description}`, 'line-info');
          printBlank();
          return;
        }
        printLine(`Unknown command: "${target}".  Showing full help.`, 'line-err');
      }
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

      // Group commands by category for easier scanning
      const CATEGORIES = [
        { label: 'GETTING STARTED', keys: ['tour', 'skip-tour'] },
        { label: 'NAVIGATION',  keys: ['g', 'l'] },
        { label: 'NOTES & TASKS', keys: ['n', 'ls', 'today', 'focus', 'nuke'] },
        { label: 'SPEED DIAL',  keys: ['dial'] },
        { label: 'SYSTEM',      keys: ['clr', 'clear', 'history', 'theme', 'banner', 'settings', 'boot', 'motd', 'uptime', 'whoami', 'sysinfo', 'syncstatus', 'shutdown'] },
        { label: 'DATA',        keys: ['export', 'import'] },
        { label: 'FUN',         keys: ['fortune', 'cal', 'ping', 'scan', 'typewriter', 'beep', 'cow', 'noise', 'matrix', 'hack', 'countdown', 'maze'] },
        { label: 'HELP',        keys: ['help', 'keys'] },
      ];

      function printCmd(key) {
        const cmd = _commandsRef[key];
        if (!cmd) return;
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
      }

      const categorised = new Set();
      for (const { label, keys } of CATEGORIES) {
        const validKeys = keys.filter(k => _commandsRef[k]);
        if (validKeys.length === 0) continue;
        printLine(`  ── ${label} ──`, 'line-head');
        validKeys.forEach(k => { printCmd(k); categorised.add(k); });
        printBlank();
      }

      // Print any uncategorised commands (future-proof)
      const uncategorised = Object.keys(_commandsRef).filter(k => !categorised.has(k));
      if (uncategorised.length > 0) {
        printLine('  ── OTHER ──', 'line-head');
        uncategorised.forEach(k => printCmd(k));
        printBlank();
      }

      printBlank();
      printLine('  Keyboard shortcuts', 'line-head');
      printRule('─', 38);
      printLine('  ↑ / ↓          Navigate command history', 'line-info');
      printLine('  Tab            Open speed-dial overlay (empty input)', 'line-info');
      printLine('  Tab            Auto-complete command name (partial input)', 'line-info');
      printLine('  Ctrl+D / ⌘D    Toggle speed-dial overlay', 'line-info');
      printLine('  Ctrl+L / ⌘L    Clear the terminal screen', 'line-info');
      printLine('  Ctrl+, / ⌘,    Open / close Settings panel', 'line-info');
      printLine('  Escape         Clear current input line', 'line-info');
      printLine('  Ctrl+Shift+S   Add current tab as a speed-dial tile', 'line-info');
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
        ['↑ / ↓',         'Navigate command history'],
        ['Tab (empty)',    'Open the speed-dial overlay'],
        ['Tab (partial)',  'Auto-complete command name'],
        ['Ctrl+D / ⌘D',   'Toggle speed-dial overlay'],
        ['Ctrl+L / ⌘L',   'Clear the terminal screen'],
        ['Ctrl+, / ⌘,',   'Open / close Settings panel'],
        ['Escape',         'Clear / cancel current input'],
        ['Ctrl+Shift+S',   'Add current tab as a speed-dial tile'],
        ['Right-click',    'Paste or open browser context menu'],
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
