// ── commands/dials-cmd.js ─────────────────────────────────────────────────────
// dial command — add/remove/divider/group/weather/import speed-dial entries.

import { loadDials, saveDials }                    from '../core/storage.js';
import {
  printLine, printBlank, printRule, endBatch,
} from '../core/render.js';
import { setPendingConfirm }                       from '../core/state.js';
import { renderDials, removeDial }                 from '../ui/dials.js';

export const dialsCommands = {

  // ── dial ──────────────────────────────────────────────────────────
  dial: {
    description: 'Manage speed-dial tiles.  dial add [alias ...] [url] | dial rm [alias ...] | dial group [label ...] | dial weather [url] | dial divider [row|col] | dial import',
    usage: 'dial add [alias ...] [url]  |  dial rm [alias ...]  |  dial group [label ...]  |  dial weather [url]  |  dial divider [row|col]  |  dial import',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      // ── dial add ─────────────────────────────────────────────────
      if (sub === 'add') {
        const rawUrl = args.length >= 3 ? args[args.length - 1] : '';
        const alias  = args.slice(1, -1).join(' ').trim();

        if (!alias || !rawUrl) {
          printLine('Usage:   dial add [alias ...] [url]', 'line-info');
          printLine('Example: dial add hn https://news.ycombinator.com', 'line-info');
          printLine('Example: dial add Amazon Prime Video https://www.amazon.com/Amazon-Video/b?ie=UTF8', 'line-info');
          return;
        }

        const url = /^[a-z][a-z0-9+\-.]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

        if (/^(javascript|data):/i.test(url)) {
          printLine('Error: URL scheme not allowed.', 'line-err');
          return;
        }

        const dials      = await loadDials();
        const aliasLower = alias.toLowerCase();
        const collision  = dials.find(d => d.alias != null && d.alias.toLowerCase() === aliasLower);
        if (collision) {
          if (collision.type === 'divider') {
            printLine(`"${alias}" clashes with an existing divider entry. Remove it first (right-click the divider tile).`, 'line-err');
          } else {
            printLine(`Alias "${collision.alias}" already exists. Use  dial rm ${collision.alias}  first.`, 'line-err');
          }
          return;
        }

        dials.push({ alias, label: alias, url });
        await saveDials(dials);
        await renderDials();
        printLine(`✓ Dial "${alias}"  →  ${url}`, 'line-ok');

      // ── dial rm ──────────────────────────────────────────────────
      } else if (sub === 'rm') {
        const alias = args.slice(1).join(' ').trim();
        if (!alias) { printLine('Usage:   dial rm [alias ...]', 'line-info'); return; }

        const dials = await loadDials();
        if (!dials.some(d => d.alias === alias)) {
          printLine(`Alias "${alias}" not found.`, 'line-err');
          return;
        }
        await removeDial(alias);

      // ── dial divider ─────────────────────────────────────────────
      } else if (sub === 'divider') {
        const variant = (args[1] || 'row').toLowerCase();
        if (variant !== 'row' && variant !== 'col') {
          printLine('Usage:   dial divider [row|col]', 'line-info');
          printLine('  row  — forces a new row (default)', 'line-info');
          printLine('  col  — vertical spacer between tiles', 'line-info');
          return;
        }
        const dials = await loadDials();
        const alias = `__div_${Date.now()}__`;
        const entry = { type: 'divider', alias };
        if (variant === 'col') entry.col = true;
        dials.push(entry);
        await saveDials(dials);
        await renderDials();
        const label = variant === 'col' ? 'Column divider' : 'Row divider';
        printLine(`✓ ${label} added. Drag to reorder, right-click to remove.`, 'line-ok');

      // ── dial group ───────────────────────────────────────────────
      } else if (sub === 'group') {
        const groupLabel = args.slice(1).join(' ').trim();
        if (!groupLabel) {
          printLine('Usage:   dial group [label ...]', 'line-info');
          printLine('Example: dial group Work', 'line-info');
          printLine('Example: dial group Social Media', 'line-info');
          return;
        }
        const dials = await loadDials();
        const alias = `__grp_${Date.now()}__`;
        dials.push({ type: 'group-header', alias, label: groupLabel });
        await saveDials(dials);
        await renderDials();
        printLine(`✓ Group "${groupLabel}" added. Click to collapse, drag to reorder, right-click to rename/remove.`, 'line-ok');

      // ── dial weather ─────────────────────────────────────────────
      } else if (sub === 'weather') {
        const dials    = await loadDials();
        const existing = dials.find(d => d.type === 'weather');
        if (existing) {
          printLine(`Weather dial already present (alias: "${existing.alias}"). Right-click it to edit the destination URL or remove it.`, 'line-info');
          return;
        }
        const url = args[1] ? args[1] : 'https://weather.com';
        dials.push({ type: 'weather', alias: 'weather', label: 'WEATHER', url });
        await saveDials(dials);
        await renderDials();
        printLine('✓ Weather dial added.  It will show live conditions using your browser location.', 'line-ok');
        printLine('  Click the tile to open the weather site.  Right-click to change URL or remove.', 'line-info');

      // ── dial import ──────────────────────────────────────────────
      } else if (sub === 'import') {
        if (!chrome.bookmarks) {
          printLine('Error: Bookmarks API not available. Check manifest permissions.', 'line-err');
          return;
        }

        const tree = await chrome.bookmarks.getTree();

        const entries = [];
        function traverseBookmarks(node, depth) {
          if (node.id === '0') { (node.children || []).forEach(c => traverseBookmarks(c, 0)); return; }
          const isFolder = Array.isArray(node.children);
          entries.push({ node, depth, isFolder });
          if (isFolder) node.children.forEach(c => traverseBookmarks(c, depth + 1));
        }
        tree.forEach(root => traverseBookmarks(root, 0));

        if (entries.length === 0) { printLine('No bookmarks found in your browser.', 'line-info'); return; }

        printBlank();
        printRule('─');
        printLine('  BROWSER BOOKMARKS', 'line-head');
        printRule('─');
        entries.forEach((e, i) => {
          const num    = String(i + 1).padStart(4, ' ');
          const indent = '  '.repeat(e.depth);
          if (e.isFolder) {
            printLine(`${num}  ${indent}▸ ${e.node.title || '(Untitled Folder)'}`, 'line-head');
          } else {
            const title = (e.node.title || e.node.url || '').substring(0, 45);
            printLine(`${num}  ${indent}  ${title.padEnd(46)}${e.node.url}`, 'line-out');
          }
        });
        printBlank();
        printLine('  Enter a NUMBER to import that bookmark, or a FOLDER number to', 'line-info');
        printLine('  import ALL bookmarks inside it.  Press Enter to cancel.', 'line-info');
        printBlank();
        endBatch();

        const answer  = await new Promise(resolve => { setPendingConfirm(resolve); });
        printLine(`> ${answer}`, 'line-cmd');

        const trimmed = answer.trim();
        if (!trimmed) { printLine('Import cancelled.', 'line-info'); return; }

        const sel = parseInt(trimmed, 10);
        if (isNaN(sel) || sel < 1 || sel > entries.length) {
          printLine(`Invalid selection "${trimmed}". Enter a number between 1 and ${entries.length}.`, 'line-err');
          return;
        }

        const selected = entries[sel - 1];
        const dials    = await loadDials();

        function collectBookmarks(node) {
          const out = [];
          if (node.url) { out.push(node); return out; }
          for (const child of (node.children || [])) out.push(...collectBookmarks(child));
          return out;
        }

        const toImport = selected.isFolder ? collectBookmarks(selected.node) : [selected.node];

        let added = 0, skipped = 0;
        for (const bm of toImport) {
          if (!bm.url || /^(javascript|data):/i.test(bm.url)) { skipped++; continue; }
          const alias = (bm.title || bm.url).trim();
          const alL   = alias.toLowerCase();
          if (dials.find(d => d.alias != null && d.alias.toLowerCase() === alL)) { skipped++; continue; }
          dials.push({ alias, label: alias, url: bm.url });
          added++;
        }

        if (added > 0) {
          await saveDials(dials);
          await renderDials();
          const src = selected.isFolder
            ? `folder "${selected.node.title}"`
            : `"${selected.node.title || selected.node.url}"`;
          printLine(
            `✓ Imported ${added} bookmark${added !== 1 ? 's' : ''} from ${src}.` +
            (skipped ? `  (${skipped} skipped — duplicates or invalid URLs)` : ''),
            'line-ok',
          );
        } else {
          printLine(
            `Nothing imported. ${skipped} item${skipped !== 1 ? 's' : ''} skipped (duplicates or invalid URLs).`,
            'line-info',
          );
        }

      // ── dial (no sub-command) ────────────────────────────────────
      } else {
        const dials = await loadDials();
        printBlank();
        printRule('─');
        printLine('  SPEED DIAL', 'line-head');
        printRule('─');
        if (dials.length === 0) {
          printLine('  (no dials — use:  dial add [alias ...] [url])', 'line-info');
        } else {
          dials.forEach(d => {
            if (d.type === 'divider') {
              const kind = d.col ? '[col divider]' : '[row divider]';
              printLine(`  ─── ${kind} ───`, 'line-info');
              return;
            }
            if (d.type === 'group-header') { printLine(`  ── ${d.label || d.alias} ──`, 'line-head'); return; }
            if (d.type === 'weather')      { printLine(`  [weather]       →  ${d.url}`, 'line-info'); return; }
            const labelCol = (d.label || d.alias).padEnd(14);
            printLine(`  ${labelCol}  →  ${d.url}`, 'line-info');
          });
        }
        printBlank();
        printLine('  dial add     [alias ...] [url]  — add a new tile', 'line-info');
        printLine('  dial rm      [alias ...]        — remove a tile', 'line-info');
        printLine('  dial group   [label ...]        — add a collapsible section header', 'line-info');
        printLine('  dial weather [url]          — add a live weather tile', 'line-info');
        printLine('  dial divider [row|col]      — add a row or column divider', 'line-info');
        printLine('  dial import                 — import from browser bookmarks', 'line-info');
        printLine('  Right-click any tile        — Edit / Refresh / Remove', 'line-info');
        printBlank();
      }
    },
  },

};
