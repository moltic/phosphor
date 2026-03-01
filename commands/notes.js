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

export const notesCommands = {

  // ── n — save / manage notes ──────────────────────────────────────
  n: {
    description: 'Save a note, or manage notes.  n [text]  |  n rm [N]  |  n clear  |  n find [query]  |  n edit [N] [text]',
    usage: 'n [text ...]  |  n rm [N]  |  n clear  |  n find [query]  |  n edit [N] [text]',
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

      if (args.length === 0) {
        printLine('Usage:   n [text ...]', 'line-info');
        printLine('         n rm [N]', 'line-info');
        printLine('         n clear', 'line-info');
        printLine('         n find [query]', 'line-info');
        printLine('         n edit [N] [new text]', 'line-info');
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
          printLine(`  ${globalIdx}.  [${time}]  ${note.text}`, 'line-out');
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

  // ── nuke — wipe all notes ────────────────────────────────────────
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
