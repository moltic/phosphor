// ── commands/missions.js ──────────────────────────────────────────────────────
// missions command — display today's daily missions and BBS sector event.
//
// Also exports notifyMission() — a compact toast helper that any other command
// module can import after calling triggerMission() from core/missions.js.
// Keeping notification logic here avoids coupling the pure-data missions module
// to the DOM render layer (mirrors the pattern used by commands/profile.js).

import {
  getTodayMissions,
  getTodayBBSEvent,
} from '../core/missions.js';
import {
  printLine, printBlank, printRule,
} from '../core/render.js';

// ── Mission completion toast ──────────────────────────────────────────────────

/**
 * Print a mission-complete toast to the terminal output.
 *
 * Safe to call unconditionally: a strict no-op when result.completed is false,
 * so callers do not need to guard the call.
 *
 * @param {{
 *   completed: boolean,
 *   label?:    string,
 *   xpGained?: number,
 *   cosmetic?: string|null,
 *   rankUp?:   boolean,
 *   newRank?:  string|null,
 *   newBadge?: string|null,
 * }} result  The object returned by triggerMission().
 */
export function notifyMission(result) {
  if (!result.completed) return;
  printBlank();
  printLine(`  ◆ MISSION COMPLETE  ─  ${result.label}  (+${result.xpGained} XP)`, 'line-ok');
  if (result.cosmetic) {
    printLine(`  ◈ COSMETIC EARNED  →  ${result.cosmetic}`, 'line-info');
  }
  if (result.rankUp) {
    printLine(`  ★ RANK UP  →  ${result.newRank}  ${result.newBadge}`, 'line-head');
  }
  printBlank();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _box(done) { return done ? '[✓]' : '[ ]'; }

// ── Command ───────────────────────────────────────────────────────────────────

export const missionsCommands = {

  // ── missions ──────────────────────────────────────────────────────
  missions: {
    description: "Show today's daily missions, today's BBS sector event, and earned cosmetics.",
    usage: 'missions',
    async run(_args) {
      const state = await getTodayMissions();
      const event = getTodayBBSEvent();

      const done  = state.missions.filter(m => m.completed).length;
      const total = state.missions.length;

      const INNER  = 54;
      const top    = '╔' + '═'.repeat(INNER + 2) + '╗';
      const bottom = '╚' + '═'.repeat(INNER + 2) + '╝';
      const sep    = '╠' + '═'.repeat(INNER + 2) + '╣';
      const blank  = '║' + ' '.repeat(INNER + 2) + '║';

      function row(text) {
        return '║' + text.padEnd(INNER + 2) + '║';
      }

      printBlank();
      printLine(top,    'line-sep');
      printLine(row('  ░▒▓  DAILY MISSIONS  ▓▒░'), 'line-head');
      printLine(sep,    'line-sep');
      printLine(row(`  DATE: ${state.date}   COMPLETED: ${done} / ${total}`), 'line-info');
      printLine(blank,  'line-sep');

      for (const m of state.missions) {
        const cls   = m.completed ? 'line-ok' : 'line-out';
        const check = _box(m.completed);
        printLine(row(`  ${check}  ${m.label}  (+${m.xp} XP)`), cls);
        printLine(row(`       ${m.desc}`), 'line-info');
        if (m.cosmetic) {
          const cosState = state.earnedCosmetics.includes(m.cosmetic) ? '✓ earned' : 'pending';
          printLine(row(`       Cosmetic: ${m.cosmetic}  [${cosState}]`), 'line-info');
        }
        printLine(blank, 'line-sep');
      }

      // ── Daily XP summary ──────────────────────────────────────────
      const totalXp  = state.missions.reduce((s, m) => s + m.xp, 0);
      const earnedXp = state.missions
        .filter(m => m.completed)
        .reduce((s, m) => s + m.xp, 0);
      printLine(row(`  XP TODAY:  ${earnedXp} / ${totalXp}`), done === total ? 'line-ok' : 'line-out');
      printLine(sep,   'line-sep');

      // ── BBS sector event ──────────────────────────────────────────
      printLine(row('  ▶ BBS SECTOR EVENT'), 'line-head');
      printLine(row(`  ${event.label}`), 'line-head');
      printLine(row(`  ${event.desc}`), 'line-info');

      // ── Earned cosmetics ──────────────────────────────────────────
      if (state.earnedCosmetics.length > 0) {
        printLine(sep,   'line-sep');
        printLine(row('  ■ EARNED COSMETICS'), 'line-head');
        // Wrap cosmetics across rows of INNER chars
        const cosStr = state.earnedCosmetics.join('   ');
        const words  = cosStr.split('   ');
        let   cur    = '';
        for (const word of words) {
          const next = cur ? cur + '   ' + word : word;
          if (next.length <= INNER - 2) { cur = next; }
          else { if (cur) printLine(row(`  ${cur}`), 'line-info'); cur = word; }
        }
        if (cur) printLine(row(`  ${cur}`), 'line-info');
      }

      printLine(sep,    'line-sep');
      printLine(row('  Missions reset at midnight  ─  new set tomorrow!'), 'line-info');
      printLine(bottom, 'line-sep');
      printBlank();
    },
  },

};
