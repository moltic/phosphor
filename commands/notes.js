// ── commands/notes.js ─────────────────────────────────────────────────────────
// n, ls, nuke commands.

import { CONFIG }                               from '../core/config.js';
import { loadNotes, saveNotes, loadDials }      from '../core/storage.js';
import {
  printLine, printBlank, printRule,
  beginBatch, endBatch,
} from '../core/render.js';
import { setPendingConfirm }                    from '../core/state.js';
import { formatTimestamp }                      from '../core/clock.js';
import { awardAchievement }                     from '../core/progression.js';
import { notifyAchievement }                    from './profile.js';
import { triggerMission }                       from '../core/missions.js';
import { notifyMission }                        from './missions.js';

// ── Task helpers ────────────────────────────────────────────────────────────

/** @returns {string}  Today's date as YYYY-MM-DD (local time). */
function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * True when a task's due date is today or in the past (overdue).
 * @param {string|undefined} due  YYYY-MM-DD string or falsy.
 */
function _isTodayOrOverdue(due) {
  return !!due && due <= _todayISO();
}

/**
 * Returns a short inline tag prepended to the note text in list output.
 *   '[!] ' — pinned, high priority, open
 *   '[*] ' — pinned, normal priority, open
 *   '[x] ' — pinned, done
 *   ''      — plain note (no tag)
 * @param {{ pin?: boolean, done?: boolean, priority?: string }} note
 * @returns {string}
 */
function _taskFlag(note) {
  if (!note.pin) return '';
  if (note.done)               return '[x] ';
  if (note.priority === 'high') return '[!] ';
  return '[*] ';
}

export const notesCommands = {

  // ── n — save / manage notes ──────────────────────────────────────
  n: {
    description: 'Save a note, or manage notes / tasks.  n [text]  |  n rm [N]  |  n pin [N]  |  n done [N]  |  n prio [N] high  |  n due [N] today',
    usage: 'n [text]  |  n rm|clear|find|edit|pin|unpin|done|undone|prio|due ...',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      // ── n rm [N] ─────────────────────────────────────────────────
      if (sub === 'rm') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n rm [N]  — delete note by display index (see ls)', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        notes.splice(notes.findIndex(note => note.id === target.id), 1);
        await saveNotes(notes);
        printLine(`✓ Note ${N} deleted.`, 'line-ok');
        return;
      }

      // ── n clear ──────────────────────────────────────────────────
      if (sub === 'clear') {
        const notes = await loadNotes();
        if (notes.length === 0) {
          printLine('No notes to clear.', 'line-info');
          return;
        }
        printLine(`This will delete all ${notes.length} note${notes.length === 1 ? '' : 's'}. Type CONFIRM to proceed:`, 'line-err');
        endBatch();
        const answer = await new Promise(resolve => setPendingConfirm(resolve));
        beginBatch();
        if (answer.trim().toUpperCase() !== 'CONFIRM') {
          printLine('Cancelled.', 'line-info');
          return;
        }
        await saveNotes([]);
        printLine('✓ All notes cleared.', 'line-ok');
        return;
      }

      // ── n find [query] ───────────────────────────────────────────
      if (sub === 'find') {
        if (!args[1]) {
          printLine('Usage: n find [query]  — filter notes by substring (case-insensitive)', 'line-info');
          return;
        }
        const query = args.slice(1).join(' ').toLowerCase();
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        const matches = reversed
          .map((note, i) => ({ note, displayIndex: i + 1 }))
          .filter(({ note }) => note.text.toLowerCase().includes(query));
        if (matches.length === 0) {
          printLine(`No notes matching "${args.slice(1).join(' ')}".`, 'line-info');
          return;
        }
        printLine(`Notes matching "${args.slice(1).join(' ')}":`, 'line-info');
        for (const { note, displayIndex } of matches) {
          printLine(`  [${displayIndex}]  ${note.text}  (${formatTimestamp(note.ts)})`, 'line-out');
        }
        return;
      }

      // ── n edit [N] [new text] ────────────────────────────────────
      if (sub === 'edit') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1 || !args[2]) {
          printLine('Usage: n edit [N] [new text]  — replace text of note N in-place', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        notes[idx] = { ...notes[idx], text: args.slice(2).join(' ') };
        await saveNotes(notes);
        printLine(`✓ Note ${N} updated.`, 'line-ok');
        return;
      }

      // ── n pin [N] ─────────────────────────────────────────────────
      if (sub === 'pin') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n pin [N]  — promote note N to pinned task', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        notes[idx] = { ...notes[idx], pin: true };
        await saveNotes(notes);
        printLine(`✓ Note ${N} pinned as task.  ([*] open — type  n done ${N}  to complete)`, 'line-ok');
        return;
      }

      // ── n unpin [N] ───────────────────────────────────────────────
      if (sub === 'unpin') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n unpin [N]  — revert task N back to plain note', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        // eslint-disable-next-line no-unused-vars
        const { pin: _p, done: _d, priority: _r, due: _u, ...rest } = notes[idx];
        notes[idx] = rest;
        await saveNotes(notes);
        printLine(`✓ Note ${N} reverted to plain note.`, 'line-ok');
        return;
      }

      // ── n done [N] ────────────────────────────────────────────────
      if (sub === 'done') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n done [N]  — mark pinned task N as complete', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        notes[idx] = { ...notes[idx], pin: true, done: true };
        await saveNotes(notes);
        printLine(`✓ Task ${N} marked done.`, 'line-ok');
        return;
      }

      // ── n undone [N] ──────────────────────────────────────────────
      if (sub === 'undone') {
        const N = parseInt(args[1], 10);
        if (!args[1] || isNaN(N) || N < 1) {
          printLine('Usage: n undone [N]  — reopen a completed task', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        // eslint-disable-next-line no-unused-vars
        const { done: _d, ...rest } = notes[idx];
        notes[idx] = rest;
        await saveNotes(notes);
        printLine(`✓ Task ${N} reopened.`, 'line-ok');
        return;
      }

      // ── n prio [N] [high|normal] ──────────────────────────────────
      if (sub === 'prio') {
        const N = parseInt(args[1], 10);
        const level = (args[2] || '').toLowerCase();
        if (!args[1] || isNaN(N) || N < 1 || !['high', 'normal'].includes(level)) {
          printLine('Usage: n prio [N] [high|normal]  — set priority of a pinned task', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        const updated = { ...notes[idx], pin: true };
        if (level === 'high') updated.priority = 'high';
        else delete updated.priority;
        notes[idx] = updated;
        await saveNotes(notes);
        printLine(`✓ Task ${N} priority set to ${level}.`, 'line-ok');
        return;
      }

      // ── n due [N] [today|YYYY-MM-DD|off] ─────────────────────────
      if (sub === 'due') {
        const N = parseInt(args[1], 10);
        const raw = (args[2] || '').toLowerCase();
        if (!args[1] || isNaN(N) || N < 1 || !raw) {
          printLine('Usage: n due [N] [today|YYYY-MM-DD|off]  — set or clear due date', 'line-info');
          return;
        }
        const notes = await loadNotes();
        const reversed = [...notes].reverse();
        if (N > reversed.length) { printLine(`No note at index ${N}.`, 'line-err'); return; }
        const target = reversed[N - 1];
        const idx = notes.findIndex(note => note.id === target.id);
        let due;
        if (raw === 'off') {
          due = null;
        } else if (raw === 'today') {
          due = _todayISO();
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          due = raw;
        } else {
          printLine('✗ Invalid date.  Use: today  |  YYYY-MM-DD  |  off', 'line-err');
          return;
        }
        const updated = { ...notes[idx], pin: true };
        if (due) updated.due = due;
        else delete updated.due;
        notes[idx] = updated;
        await saveNotes(notes);
        printLine(
          due ? `✓ Task ${N} due date set to ${due}.` : `✓ Due date cleared for task ${N}.`,
          'line-ok',
        );
        return;
      }

      if (args.length === 0) {
        printLine('CAPTURE  n [text]                  save a note', 'line-info');
        printLine('MANAGE   n rm [N]                  delete note N', 'line-info');
        printLine('         n clear                   delete all notes', 'line-info');
        printLine('         n find [query]             search notes', 'line-info');
        printLine('         n edit [N] [text]          rewrite note N', 'line-info');
        printLine('TASKS    n pin [N]                 promote to pinned task', 'line-info');
        printLine('         n unpin [N]               revert to plain note', 'line-info');
        printLine('         n done [N]                mark task done', 'line-info');
        printLine('         n undone [N]              reopen task', 'line-info');
        printLine('         n prio [N] [high|normal]  set task priority', 'line-info');
        printLine('         n due [N] [today|DATE|off] set due date', 'line-info');
        printLine('VIEWS    today                     tasks due today + high-prio', 'line-info');
        printLine('         focus                     all open pinned tasks', 'line-info');
        printLine('Example: n review PR #42 before standup', 'line-info');
        return;
      }

      const text = args.join(' ');
      const ts   = Date.now();
      const id   = ts.toString(36);
      const notes = await loadNotes();
      notes.push({ id, text, ts });
      await saveNotes(notes);
      printLine(`✓ Note saved  [${formatTimestamp(ts)}]`, 'line-ok');

      // Achievement hooks — idempotent, safe to call on every save.
      notifyAchievement(await awardAchievement('first_note'));
      if (notes.length >= 5) notifyAchievement(await awardAchievement('five_notes'));
      notifyMission(await triggerMission('save_note'));
    },
  },

  // ── ls — list notes + stored dials ───────────────────────────────
  ls: {
    description: 'List saved notes and speed-dial tiles.  Optionally paginate notes: ls [page] or ls notes [page].',
    usage: 'ls  |  ls [page]  |  ls notes [page]',
    async run(args) {
      const PAGE_SIZE = CONFIG.NOTES_PAGE_SIZE;

      let pageArg = null;
      if (args.length >= 1) {
        const first = args[0].toLowerCase();
        if (first === 'notes') { pageArg = args[1] ?? null; }
        else { pageArg = first; }
      }

      let page = 1;
      if (pageArg !== null) {
        const parsed = parseInt(pageArg, 10);
        if (isNaN(parsed) || parsed < 1) {
          printLine('Usage:  ls [page]  |  ls notes [page]', 'line-info');
          printLine('        page must be a positive integer.', 'line-info');
          return;
        }
        page = parsed;
      }

      const [notes, dials] = await Promise.all([loadNotes(), loadDials()]);
      const reversed   = [...notes].reverse();
      const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE_SIZE));

      if (page > totalPages) {
        printLine(
          `  Page ${page} does not exist — there are only ${totalPages} page(s) of notes.`,
          'line-err',
        );
        return;
      }

      const start      = (page - 1) * PAGE_SIZE;
      const pageNotes  = reversed.slice(start, start + PAGE_SIZE);

      printBlank();
      printRule('─');
      const pageLabel = totalPages > 1 ? `  NOTES  (page ${page} / ${totalPages})` : '  NOTES';
      printLine(pageLabel, 'line-head');
      printRule('─');

      if (notes.length === 0) {
        printLine('  No notes yet.', 'line-info');
        printLine('  ▸  n [text]            save a note', 'line-info');
        printLine('  ▸  n hello world       try it right now', 'line-info');
        printLine('  ▸  tour 2              see the full notes guide', 'line-info');
      } else {
        pageNotes.forEach((note, i) => {
          const globalIdx = String(start + i + 1).padStart(3, ' ');
          const time = formatTimestamp(note.ts);
          const tag  = _taskFlag(note);
          const due  = (!note.done && _isTodayOrOverdue(note.due)) ? '  ◄ DUE' : '';
          printLine(`  ${globalIdx}.  [${time}]  ${tag}${note.text}${due}`, 'line-out');
        });
        if (totalPages > 1) {
          const prevHint = page > 1          ? `  ls ${page - 1}` : null;
          const nextHint = page < totalPages ? `  ls ${page + 1}` : null;
          const hints = [prevHint, nextHint].filter(Boolean).join('    ');
          printLine(`  ─  ${hints}`, 'line-info');
        }
      }

      printBlank();
      printRule('─');
      printLine('  SPEED DIAL', 'line-head');
      printRule('─');
      if (dials.length === 0) {
        printLine('  No speed dials yet.', 'line-info');
        printLine('  ▸  dial add gh https://github.com   add one now', 'line-info');
        printLine('  ▸  press  Tab  to open the overlay  and click  [ + ADD LINK ]', 'line-info');
        printLine('  ▸  tour 3                           see the full dials guide', 'line-info');
      } else {
        dials.forEach(d => {
          if (d.type === 'divider')      { printLine('  ─── [divider] ───', 'line-info'); return; }
          if (d.type === 'group-header') { printLine(`  ── ${d.label || d.alias} ──`, 'line-head'); return; }
          if (d.type === 'weather')      { printLine(`  [weather]       →  ${d.url}`, 'line-info'); return; }
          const labelCol = (d.label || d.alias).padEnd(14);
          printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
        });
      }
      printBlank();
    },
  },

  // ── today — tasks due today + high-priority open tasks ─────────
  today: {
    description: 'Show tasks due today (or overdue) and any open high-priority pinned tasks.',
    usage: 'today',
    async run() {
      const notes    = await loadNotes();
      const today    = _todayISO();
      const reversed = [...notes].reverse();

      const due     = reversed.filter(n => n.pin && !n.done && _isTodayOrOverdue(n.due));
      const highPri = reversed.filter(n => n.pin && !n.done && n.priority === 'high' && !_isTodayOrOverdue(n.due));

      if (due.length === 0 && highPri.length === 0) {
        printLine('  No tasks due today and no open high-priority tasks.', 'line-info');
        printLine('  ▸  n [text]        capture a note', 'line-info');
        printLine('  ▸  n pin [N]       pin a note as a task', 'line-info');
        return;
      }

      printBlank();
      printRule('─');
      printLine(`  TODAY  ─  ${today}`, 'line-head');
      printRule('─');

      if (due.length > 0) {
        printLine('  DUE TODAY / OVERDUE', 'line-head');
        due.forEach((note) => {
          const idx = String(reversed.findIndex(n => n.id === note.id) + 1).padStart(3, ' ');
          const overdue = note.due < today ? `  [OVERDUE: ${note.due}]` : '';
          printLine(`  ${idx}.  [!] ${note.text}${overdue}`, 'line-err');
        });
        printBlank();
      }

      if (highPri.length > 0) {
        printLine('  HIGH PRIORITY', 'line-head');
        highPri.forEach((note) => {
          const idx = String(reversed.findIndex(n => n.id === note.id) + 1).padStart(3, ' ');
          printLine(`  ${idx}.  [!] ${note.text}`, 'line-out');
        });
        printBlank();
      }

      printRule('─');
      printBlank();
    },
  },

  // ── focus — all open pinned tasks ────────────────────────────────
  focus: {
    description: 'Show all open pinned tasks, sorted by priority (high first).',
    usage: 'focus',
    async run() {
      const notes    = await loadNotes();
      const reversed = [...notes].reverse();
      const open     = reversed.filter(n => n.pin && !n.done);

      if (open.length === 0) {
        printLine('  No open pinned tasks.', 'line-info');
        printLine('  ▸  n pin [N]  to promote any note to a pinned task', 'line-info');
        return;
      }

      // Sort: high-priority first, then by original order (already reversed)
      const sorted = [
        ...open.filter(n => n.priority === 'high'),
        ...open.filter(n => n.priority !== 'high'),
      ];

      const today = _todayISO();
      printBlank();
      printRule('─');
      printLine('  FOCUS  ─  OPEN TASKS', 'line-head');
      printRule('─');
      sorted.forEach((note) => {
        const idx     = String(reversed.findIndex(n => n.id === note.id) + 1).padStart(3, ' ');
        const tag     = note.priority === 'high' ? '[!]' : '[*]';
        const dueTag  = _isTodayOrOverdue(note.due) ? (note.due < today ? `  [OVERDUE: ${note.due}]` : '  [DUE TODAY]') : '';
        const cls     = note.priority === 'high' ? 'line-err' : 'line-out';
        printLine(`  ${idx}.  ${tag} ${note.text}${dueTag}`, cls);
      });
      printRule('─');
      printBlank();
    },
  },

  // ── nuke — wipe all notes ────────────────────────────────────────────
  nuke: {
    usage: 'nuke',
    description: 'Permanently destroy ALL stored notes after typed confirmation.',
    async run() {
      printLine('!! WARNING: This will permanently destroy ALL stored notes !!', 'line-err');
      printLine('Type  CONFIRM  (all caps) to proceed, or anything else to abort:', 'line-info');

      endBatch();

      const answer = await new Promise(resolve => { setPendingConfirm(resolve); });

      const sleep = ms => new Promise(r => setTimeout(r, ms));

      printLine(`> ${answer}`, 'line-cmd');

      if (answer.trim() !== 'CONFIRM') {
        printLine('Aborted. No notes were deleted.', 'line-info');
        return;
      }

      for (const n of ['3', '2', '1']) {
        printLine(`NUKING IN ${n}...`, 'line-err');
        await sleep(1000);
      }

      await saveNotes([]);
      printLine('▓▓▓  ALL NOTES WIPED  ▓▓▓', 'line-err');
    },
  },

};
