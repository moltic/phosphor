// ── commands/profile.js ───────────────────────────────────────────────────────
// profile, ach / achievements, rank commands.
//
// Also exports notifyAchievement() — a lightweight toast helper that any other
// command module can import after calling awardAchievement() from
// core/progression.js.  Keeping the notification logic here avoids coupling
// the pure-data progression module to the DOM render layer.

import {
  loadProfile, ACHIEVEMENTS, RANKS,
  getRankForXp, getNextRank,
} from '../core/progression.js';
import {
  printLine, printBlank, printRule,
} from '../core/render.js';
import { formatTimestamp } from '../core/clock.js';

// ── Achievement notification (shared by all command hooks) ────────────────────

/**
 * Print a compact achievement-unlocked toast after a command completes.
 *
 * Completely safe to call with a result that has `unlocked: false` — it is a
 * strict no-op in that case, so callers never need to guard the call.
 *
 * @param {{
 *   unlocked:  boolean,
 *   label:     string,
 *   xpGained:  number,
 *   rankUp:    boolean,
 *   newRank:   string | null,
 *   newBadge:  string | null,
 * }} result  The object returned by awardAchievement().
 */
export function notifyAchievement(result) {
  if (!result.unlocked) return;
  printBlank();
  printLine(`  ✦ ACHIEVEMENT UNLOCKED  ─  ${result.label}  (+${result.xpGained} XP)`, 'line-ok');
  if (result.rankUp) {
    printLine(`  ★ RANK UP  →  ${result.newRank}  ${result.newBadge}`, 'line-head');
  }
  printBlank();
}

// ── Internal: XP progress bar ─────────────────────────────────────────────────

/**
 * Build a text progress bar and metadata for the given XP total.
 *
 * @param {number}  xp
 * @param {number} [BAR=20]  Bar width in characters.
 * @returns {{ bar: string, pct: number, label: string }}
 */
function _xpBar(xp, BAR = 20) {
  const next = getNextRank(xp);
  if (!next) {
    return { bar: '█'.repeat(BAR), pct: 100, label: 'MAX RANK' };
  }
  const prev   = getRankForXp(xp);
  const span   = next.minXp - prev.minXp;
  const done   = xp - prev.minXp;
  const filled = Math.min(BAR, Math.round((done / span) * BAR));
  return {
    bar:   '█'.repeat(filled) + '░'.repeat(BAR - filled),
    pct:   Math.round((done / span) * 100),
    label: `${xp} / ${next.minXp} XP`,
  };
}

// ── Commands ──────────────────────────────────────────────────────────────────

export const profileCommands = {

  // ── profile ───────────────────────────────────────────────────────
  profile: {
    description: 'Show your operator profile: handle, rank, XP, and achievement summary.',
    usage: 'profile',
    async run(_args) {
      const p    = await loadProfile();
      const rank = getRankForXp(p.xp);
      const next = getNextRank(p.xp);

      const earned = Object.keys(p.achievedAt).length;
      const total  = ACHIEVEMENTS.length;
      const { bar, pct, label: xpLabel } = _xpBar(p.xp);

      const INNER  = 54;
      const top    = '╔' + '═'.repeat(INNER + 2) + '╗';
      const bottom = '╚' + '═'.repeat(INNER + 2) + '╝';
      const sep    = '╠' + '═'.repeat(INNER + 2) + '╣';

      function row(lbl, val) {
        const content = `  ${lbl.padEnd(16)}${val}`;
        return '║' + content.padEnd(INNER + 2) + '║';
      }

      const nextLabel = next
        ? `→  ${next.rank} ${next.badge}  (${next.minXp - p.xp} XP to go)`
        : 'MAX RANK ACHIEVED';

      printBlank();
      printLine(top,    'line-sep');
      printLine('║  ░▒▓  OPERATOR PROFILE  ▓▒░' + ' '.repeat(INNER - 27) + '  ║', 'line-head');
      printLine(sep,    'line-sep');
      printLine(row('HANDLE:',       p.handle),                          'line-head');
      printLine(row('RANK:',         `${rank.rank}  ${rank.badge}`),     'line-head');
      printLine(row('XP:',           `${p.xp}`),                         'line-ok');
      printLine(row('PROGRESS:',     `[${bar}]  ${pct}%`),               'line-out');
      printLine(row('',              xpLabel),                           'line-info');
      printLine(row('NEXT RANK:',    nextLabel),                         'line-info');
      printLine('║' + ' '.repeat(INNER + 2) + '║',                      'line-sep');
      printLine(row('ACHIEVEMENTS:', `${earned} / ${total} unlocked`),  'line-info');
      printLine(bottom, 'line-sep');
      printBlank();
      printLine('  Type  achievements  to see the full list.', 'line-info');
      printBlank();
    },
  },

  // ── achievements / ach ────────────────────────────────────────────
  achievements: {
    description: 'Show all achievements with earned/pending status and XP rewards.',
    usage: 'achievements',
    async run(_args) {
      const p = await loadProfile();

      printBlank();
      printRule('─');
      printLine('  ACHIEVEMENTS', 'line-head');
      printRule('─');

      for (const def of ACHIEVEMENTS) {
        const earned = !!p.achievedAt[def.id];
        const prefix = earned ? '[✓]' : '[ ]';
        const xpStr  = `+${def.xp} XP`.padStart(7);
        const label  = def.label.padEnd(18);
        const cls    = earned ? 'line-ok' : 'line-info';
        printLine(`  ${prefix}  ${label}  ${xpStr}   ${def.desc}`, cls);
        if (earned) {
          const ts = formatTimestamp(p.achievedAt[def.id]);
          printLine(`           Earned ${ts}`, 'line-sep');
        }
      }

      printRule('─');

      const earned = Object.keys(p.achievedAt).length;
      const total  = ACHIEVEMENTS.length;
      const xpMax  = ACHIEVEMENTS.reduce((s, a) => s + a.xp, 0);
      printLine(
        `  ${earned} / ${total} unlocked  ·  ${p.xp} XP earned  ·  ${xpMax - p.xp} XP remaining`,
        'line-out',
      );
      printBlank();
    },
  },

  // ── rank ──────────────────────────────────────────────────────────
  rank: {
    description: 'Show your current rank, XP progress bar, and the full rank table.',
    usage: 'rank',
    async run(_args) {
      const p    = await loadProfile();
      const rank = getRankForXp(p.xp);
      const next = getNextRank(p.xp);
      const { bar, pct, label: xpLabel } = _xpBar(p.xp);

      printBlank();
      printRule('─');
      printLine('  RANK & PROGRESS', 'line-head');
      printRule('─');
      printLine(`  Handle   :  ${p.handle}`,                 'line-head');
      printLine(`  Rank     :  ${rank.rank}  ${rank.badge}`, 'line-head');
      printLine(`  XP       :  ${p.xp}`,                     'line-ok');
      if (next) {
        printLine(
          `  Next     :  ${next.rank} ${next.badge}  at ${next.minXp} XP  (${next.minXp - p.xp} to go)`,
          'line-info',
        );
      } else {
        printLine('  Next     :  — MAX RANK ACHIEVED —',     'line-ok');
      }
      printBlank();
      printLine(`  Progress :  [${bar}]  ${pct}%  (${xpLabel})`, 'line-out');
      printBlank();
      printRule('─');
      printLine('  RANK TABLE', 'line-head');
      printRule('─');

      for (const r of RANKS) {
        const isCurrent = r.rank === rank.rank;
        const marker    = isCurrent ? '►' : ' ';
        const cls       = isCurrent ? 'line-head' : (p.xp >= r.minXp ? 'line-ok' : 'line-info');
        printLine(
          `  ${marker}  ${r.badge}  ${r.rank.padEnd(12)}  ${String(r.minXp).padStart(5)} XP`,
          cls,
        );
      }
      printBlank();
    },
  },

};

// Alias: ach → achievements
profileCommands.ach = {
  description: 'Alias for  achievements  — show all achievements with status.',
  usage: 'ach',
  run: profileCommands.achievements.run,
};
