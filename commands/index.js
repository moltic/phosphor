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
import { profileCommands }                   from './profile.js';
import { missionsCommands }                  from './missions.js';
import { gamesCommands }                     from './games.js';
import { launchCommands }                    from './launch.js';
import { luaCommands }                       from './lua.js';
import { c64Commands }                       from './c64.js';
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
  ...profileCommands,
  ...missionsCommands,
  ...gamesCommands,
  ...launchCommands,
  ...luaCommands,
  ...c64Commands,
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

  // Split only on the first whitespace character so that multiline Lua scripts
  // (pasted via the paste interceptor) have their newlines preserved.
  // All other commands still receive a normally whitespace-split args array.
  const firstWsIdx = trimmed.search(/\s/);
  let cmdName, args;
  if (firstWsIdx === -1) {
    cmdName = trimmed;
    args = [];
  } else {
    cmdName = trimmed.slice(0, firstWsIdx);
    const rest = trimmed.slice(firstWsIdx).trim();
    if (cmdName.toLowerCase() === 'lua') {
      // Preserve newlines so that Lua -- comments don't consume subsequent lines.
      args = rest ? [rest] : [];
    } else {
      args = rest ? rest.split(/\s+/) : [];
    }
  }
  const key = cmdName.toLowerCase();

  // Skip batching for Lua to allow real-time animation.
  const isLua = (key === 'lua');

  // Open a batch so every printLine call during this command goes into a
  // single container that is appended to #output in one shot.
  if (!isLua) beginBatch();

  // Echo what the user typed.
  printLine(`> ${trimmed}`, 'line-cmd');

  if (Object.prototype.hasOwnProperty.call(commands, key)) {
    Promise.resolve(commands[key].run(args))
      .catch(err => {
        printLine(`Error: ${err.message}`, 'line-err');
        console.error('[Phosphor]', err);
      })
      .finally(() => {
        if (!isLua) endBatch();
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
    if (!isLua) endBatch();
  }
}
