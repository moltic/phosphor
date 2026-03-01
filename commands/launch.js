// ── commands/launch.js ────────────────────────────────────────────────────────
// launch — manage and fire named launch sets (multi-dial open).
//
//   launch                            — list all saved sets + show recent/most-used
//   launch save <name> <alias …>      — create / overwrite a set
//   launch edit <name> <alias …>      — replace aliases of an existing set
//   launch rename <name> <new-name>   — rename a set
//   launch rm <name>                  — remove a set
//   launch <name>                     — fire a set (warn if > LAUNCH_WARN_THRESHOLD tabs)
//   launch stats                      — show usage statistics
//   launch clear-stats                — wipe usage tracking data

import {
  loadLaunchSets, saveLaunchSet, editLaunchSet, renameLaunchSet,
  removeLaunchSet, findLaunchSet, openLaunchSetUrls, LAUNCH_WARN_THRESHOLD,
} from '../core/launch-sets.js';
import {
  getRecentDials, getMostUsedDials, loadUsageStats, clearUsageStats,
} from '../core/usage-stats.js';
import { loadDials }                       from '../core/storage.js';
import { printLine, printBlank, printRule, endBatch, beginBatch } from '../core/render.js';
import { setPendingConfirm }               from '../core/state.js';
import { openLaunchPanel }                 from '../ui/launch-panel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Print a divider + section heading */
function _head(label) {
  printRule('─');
  printLine(`  ${label}`, 'line-head');
  printRule('─');
}

/**
 * Check whether all aliases in `aliases` exist in the current dial store.
 * Returns { valid: string[], missing: string[] }.
 */
async function _validateAliases(aliases) {
  const dials = await loadDials();
  const known = new Set(
    dials.filter(d => d.alias && !d.type).map(d => d.alias.toLowerCase()),
  );
  const valid   = aliases.filter(a => known.has(a.toLowerCase()));
  const missing = aliases.filter(a => !known.has(a.toLowerCase()));
  return { valid, missing };
}

// ── Command export ────────────────────────────────────────────────────────────

export const launchCommands = {

  launch: {
    description: 'Manage and fire launch sets — groups of dials opened together.',
    usage: 'launch [save|edit|rename|rm|stats|clear-stats|<name>] [args …]',

    async run(args) {
      const sub = (args[0] || '').trim();

      // ── launch (no args) ─────────────────────────────────────────
      if (!sub) {
        const sets = await loadLaunchSets();
        printBlank();
        _head('LAUNCH SETS');
        if (sets.length === 0) {
          printLine('  No launch sets saved yet.', 'line-info');
          printLine('  Create one:  launch save "Morning" gh hn mail', 'line-info');
        } else {
          sets.forEach((s, i) => {
            const aliases = s.aliases.join('  ');
            const num     = String(i + 1).padStart(2, ' ');
            printLine(`  ${num}.  ${s.name.padEnd(18)}  [${aliases}]`, 'line-out');
          });
        }
        printBlank();

        // Recent activity
        const recent = await getRecentDials(5);
        if (recent.length > 0) {
          printLine('  Recent:', 'line-head');
          recent.forEach(a => printLine(`    • ${a}`, 'line-info'));
          printBlank();
        }

        // Most used
        const top = await getMostUsedDials(5);
        if (top.length > 0) {
          const stats = await loadUsageStats();
          printLine('  Most used:', 'line-head');
          top.forEach(a => {
            const count = stats.counts[a] ?? 0;
            printLine(`    • ${a.padEnd(18)}  (${count}×)`, 'line-info');
          });
          printBlank();
        }

        printLine('  launch save <name> <alias …>  — save a new set', 'line-info');
        printLine('  launch edit <name> <alias …>  — update aliases', 'line-info');
        printLine('  launch rename <name> <new>    — rename a set', 'line-info');
        printLine('  launch rm <name>              — delete a set', 'line-info');
        printLine('  launch <name>                 — open all tabs in a set', 'line-info');
        printLine('  launch stats                  — full usage breakdown', 'line-info');
        printLine('  Or type  launch  in the overlay toolbar for the visual panel.', 'line-info');
        printBlank();
        return;
      }

      // ── launch save <name> <alias …> ─────────────────────────────
      if (sub === 'save') {
        const rest = args.slice(1);
        if (rest.length < 2) {
          printLine('Usage:   launch save <name> <alias1> [alias2 …]', 'line-info');
          printLine('Example: launch save "Morning" gh hn mail', 'line-info');
          return;
        }

        // First token is the name; rest are aliases.
        // Support quoted name: if rest[0] starts with a quote, collect until closing quote.
        let name;
        let aliasStart;
        if (rest[0].startsWith('"') || rest[0].startsWith("'")) {
          const q   = rest[0][0];
          const raw = rest.join(' ');
          const end = raw.indexOf(q, 1);
          if (end !== -1) {
            name       = raw.slice(1, end);
            aliasStart = raw.slice(end + 1).trim().split(/\s+/).filter(Boolean);
          } else {
            name       = rest[0].replace(/['"`]/g, '');
            aliasStart = rest.slice(1);
          }
        } else {
          name       = rest[0];
          aliasStart = rest.slice(1);
        }

        if (!aliasStart.length) {
          printLine(`Error: provide at least one alias after the set name.`, 'line-err');
          return;
        }

        const { valid, missing } = await _validateAliases(aliasStart);
        if (missing.length) {
          printLine(`Warning: unknown alias${missing.length > 1 ? 'es' : ''}: ${missing.join(', ')}`, 'line-warn');
          printLine('  They will be saved but will be skipped at launch time until you add those dials.', 'line-info');
        }

        const entry = await saveLaunchSet(name, aliasStart);
        printLine(`✓ Launch set "${entry.name}" saved with ${aliasStart.length} alias${aliasStart.length === 1 ? '' : 'es'}.`, 'line-ok');
        if (valid.length) printLine(`  Dials: ${valid.join('  ')}`, 'line-info');
        printLine(`  Fire it:  launch ${entry.name}`, 'line-info');
        return;
      }

      // ── launch edit <name> <alias …> ─────────────────────────────
      if (sub === 'edit') {
        const rest = args.slice(1);
        if (rest.length < 2) {
          printLine('Usage:   launch edit <name> <alias1> [alias2 …]', 'line-info');
          return;
        }
        const name    = rest[0];
        const aliases = rest.slice(1);

        const found = await findLaunchSet(name);
        if (!found) {
          printLine(`Launch set "${name}" not found.  Type  launch  to list sets.`, 'line-err');
          return;
        }

        const { missing } = await _validateAliases(aliases);
        if (missing.length) {
          printLine(`Warning: unknown aliases: ${missing.join(', ')}`, 'line-warn');
        }

        await editLaunchSet(name, aliases);
        printLine(`✓ Launch set "${found.name}" updated → [${aliases.join('  ')}]`, 'line-ok');
        return;
      }

      // ── launch rename <name> <new-name> ──────────────────────────
      if (sub === 'rename') {
        const [, oldName, ...rest] = args;
        const newName = rest.join(' ').trim();
        if (!oldName || !newName) {
          printLine('Usage:   launch rename <name> <new-name>', 'line-info');
          return;
        }
        const ok = await renameLaunchSet(oldName, newName);
        if (!ok) {
          printLine(`Launch set "${oldName}" not found.`, 'line-err');
          return;
        }
        printLine(`✓ Renamed "${oldName}"  →  "${newName}".`, 'line-ok');
        return;
      }

      // ── launch rm <name> ─────────────────────────────────────────
      if (sub === 'rm') {
        const name = args.slice(1).join(' ').trim();
        if (!name) {
          printLine('Usage:   launch rm <name>', 'line-info');
          return;
        }
        const ok = await removeLaunchSet(name);
        if (!ok) {
          printLine(`Launch set "${name}" not found.`, 'line-err');
          return;
        }
        printLine(`✓ Launch set "${name}" removed.`, 'line-ok');
        return;
      }

      // ── launch stats ─────────────────────────────────────────────
      if (sub === 'stats') {
        const stats = await loadUsageStats();
        const total = Object.values(stats.counts).reduce((s, n) => s + n, 0);
        printBlank();
        _head('DIAL USAGE STATS');
        if (total === 0) {
          printLine('  No usage data yet. Open some dials to start tracking.', 'line-info');
        } else {
          printLine(`  Total opens: ${total}`, 'line-out');
          printBlank();
          const sorted = Object.entries(stats.counts).sort((a, b) => b[1] - a[1]);
          sorted.forEach(([alias, count]) => {
            const bar = '█'.repeat(Math.min(20, Math.ceil((count / sorted[0][1]) * 20)));
            printLine(`  ${alias.padEnd(18)}  ${String(count).padStart(4)}  ${bar}`, 'line-out');
          });
          if (stats.recent.length) {
            printBlank();
            printLine('  Last opened:', 'line-head');
            // Show up to 5 most recent unique
            const seen = new Set();
            let shown  = 0;
            for (const e of stats.recent) {
              if (!seen.has(e.alias)) {
                seen.add(e.alias);
                const ago = _timeAgo(e.ts);
                printLine(`    • ${e.alias.padEnd(18)}  ${ago}`, 'line-info');
                if (++shown >= 5) break;
              }
            }
          }
        }
        printBlank();
        printLine('  launch clear-stats  — reset all tracking data', 'line-info');
        printBlank();
        return;
      }

      // ── launch clear-stats ────────────────────────────────────────
      if (sub === 'clear-stats') {
        printLine('Clear all dial usage statistics?', 'line-warn');
        printLine('Type  CONFIRM  to proceed, or anything else to cancel:', 'line-info');
        endBatch();
        const answer = await new Promise(r => setPendingConfirm(r));
        beginBatch();
        printLine(`> ${answer}`, 'line-cmd');
        if (answer.trim().toUpperCase() !== 'CONFIRM') {
          printLine('Cancelled.', 'line-info');
          return;
        }
        await clearUsageStats();
        printLine('✓ Usage stats cleared.', 'line-ok');
        return;
      }

      // ── launch <name> — fire a set ────────────────────────────────
      // Treat the entire remaining args as the set name.
      const setName = [sub, ...args.slice(1)].join(' ').trim();
      const found   = await findLaunchSet(setName);

      if (!found) {
        printLine(`Unknown sub-command or launch set: "${setName}"`, 'line-err');
        printLine('Type  launch  to list all sets and sub-commands.', 'line-info');
        return;
      }

      const dials = await loadDials();

      // Confirm if opening many tabs
      if (found.aliases.length > LAUNCH_WARN_THRESHOLD) {
        printLine(
          `Launch set "${found.name}" will open ${found.aliases.length} tabs.  Continue?`,
          'line-warn',
        );
        printLine('Type  yes  to proceed, or anything else to cancel:', 'line-info');
        endBatch();
        const answer = await new Promise(r => setPendingConfirm(r));
        beginBatch();
        printLine(`> ${answer}`, 'line-cmd');
        if (!answer.trim().toLowerCase().startsWith('y')) {
          printLine('Launch cancelled.', 'line-info');
          return;
        }
      }

      const { opened, skipped } = openLaunchSetUrls(found.aliases, dials);

      if (opened.length) {
        printLine(
          `✓ Launched "${found.name}" — opened ${opened.length} tab${opened.length === 1 ? '' : 's'}.`,
          'line-ok',
        );
      }
      if (skipped.length) {
        printLine(
          `  Skipped ${skipped.length} unknown alias${skipped.length === 1 ? '' : 'es'}: ${skipped.join(', ')}`,
          'line-warn',
        );
      }
    },
  },

  // ── ls-sets alias ────────────────────────────────────────────────
  'launch-panel': {
    description: 'Open the launch sets panel in the dial overlay.',
    usage: 'launch-panel',
    run() { openLaunchPanel(); },
  },
};

// ── Tiny time-ago helper ─────────────────────────────────────────────────────
function _timeAgo(ts) {
  const sec  = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60)   return 'just now';
  const min  = Math.floor(sec / 60);
  if (min < 60)   return `${min}m ago`;
  const hr   = Math.floor(min / 60);
  if (hr  < 24)   return `${hr}h ago`;
  const day  = Math.floor(hr / 24);
  return `${day}d ago`;
}
