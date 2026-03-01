// ── commands/index.js ─────────────────────────────────────────────────────────
// Assembles the full command registry and exports dispatch().

import { helpCommands, setCommandsRegistry } from './help.js';
import { navigationCommands }                from './navigation.js';
import { notesCommands }                     from './notes.js';
import { dialsCommands }                     from './dials-cmd.js';
import { systemCommands }                    from './system.js';
import { funCommands }                       from './fun.js';
import { dataCommands }                      from './data.js';
import { onboardingCommands }                from './onboarding.js';
import {
  beginBatch, endBatch, printLine,
} from '../core/render.js';

// ── Build registry ────────────────────────────────────────────────────────────
export const commands = {
  ...helpCommands,
  ...navigationCommands,
  ...notesCommands,
  ...dialsCommands,
  ...systemCommands,
  ...funCommands,
  ...dataCommands,
  ...onboardingCommands,
};

// Inject the full registry into help.js (avoids circular import).
setCommandsRegistry(commands);

// ── Levenshtein for typo suggestions ─────────────────────────────────────────
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

// ── dispatch ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw input string and route it to the correct command handler.
 * @param {string} raw  — the full text string from the input field
 */
export function dispatch(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return;

  // Open a batch so every printLine call during this command goes into a
  // single container that is appended to #output in one shot.
  beginBatch();

  // Echo what the user typed.
  printLine(`> ${trimmed}`, 'line-cmd');

  const [cmdName, ...args] = trimmed.split(/\s+/);
  const key = cmdName.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(commands, key)) {
    Promise.resolve(commands[key].run(args))
      .then(() => endBatch())
      .catch(err => {
        printLine(`Error: ${err.message}`, 'line-err');
        console.error('[Phosphor]', err);
        endBatch();
      });
  } else {
    printLine(`Unknown command: "${cmdName}"`, 'line-err');
    // Suggest close matches (distance ≤ 2)
    const scored = Object.keys(commands)
      .map(k => ({ k, d: levenshtein(key, k) }))
      .filter(({ d }) => d <= 2)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    if (scored.length > 0) {
      printLine(`Did you mean:  ${scored.map(s => s.k).join('  ')}`, 'line-info');
    }
    printLine('Type  help  to see available commands.', 'line-info');
    endBatch();
  }
}
