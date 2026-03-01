// ── commands/dials-cmd.js ─────────────────────────────────────────────────────
// dial command — add/remove/divider/category/weather/import speed-dial entries.
//
// Sub-commands that target the versioned DialStore (v1) directly:
//   dial add      [alias ...] [url] [--category <name>]
//   dial move     <alias> <category>
//   dial rename   <alias> <new-label>
//   dial category [label ...]
//
// Compatibility shim (deprecated):
//   dial group    [label ...]  →  alias for "dial category" (prints a warning)
//
// Remaining sub-commands (rm / divider) continue to use the loadDials / saveDials
// shims; dial import and dial weather were also updated to use the store directly.

import { loadDialStore, saveDialStore,
         loadDials, saveDials }                    from '../core/storage.js';
import {
  printLine, printBlank, printRule, endBatch,
} from '../core/render.js';
import { setPendingConfirm }                       from '../core/state.js';
import { renderDials, removeDial }                 from '../ui/dials.js';

// ── DialStore helpers (used by add / move / rename / category) ────────────────

/** Find a category by label (case-insensitive). Returns the object or null. */
function _findCategoryByLabel(store, label) {
  const lo = label.toLowerCase();
  return store.categories.find(c => c.label.toLowerCase() === lo) ?? null;
}

/** Return the implicit default category (first unlabelled, or first overall). */
function _defaultCategory(store) {
  return store.categories.find(c => c.label === '') ?? store.categories[0];
}

/**
 * Generate a unique id not already used by any category id or item id.
 * @param {string} base
 * @param {{ categories: Array }} store
 */
function _uniqueId(base, store) {
  const existing = new Set([
    ...store.categories.map(c => c.id),
    ...store.categories.flatMap(c => c.items.map(it => it.id)),
  ]);
  let id = base; let n = 2;
  while (existing.has(id)) id = `${base}_${n++}`;
  return id;
}

/** Slugify a display string into a safe id/alias base. */
function _slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `item-${Date.now()}`;
}

export const dialsCommands = {

  // ── dial ──────────────────────────────────────────────────────────
  dial: {
    description: 'Manage speed-dial tiles.  Subcommands: add, rm, move, rename, category, weather, divider, import',
    usage: 'dial <subcommand> [args]',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      // ── dial add ─────────────────────────────────────────────────
      // Targets the DialStore (v1) directly.
      // Optional flag:  --category <name>  or  -c <name>
      if (sub === 'add') {
        // Strip --category / -c flag from args
        let categoryArg = null;
        const rest = [];
        for (let i = 1; i < args.length; i++) {
          if ((args[i] === '--category' || args[i] === '-c') && i + 1 < args.length) {
            categoryArg = args[++i];
          } else {
            rest.push(args[i]);
          }
        }

        const rawUrl = rest.length >= 2 ? rest[rest.length - 1] : '';
        const alias  = rest.slice(0, -1).join(' ').trim();

        if (!alias || !rawUrl) {
          printLine('Usage:   dial add [alias ...] [url] [--category <name>]', 'line-info');
          printLine('Example: dial add hn https://news.ycombinator.com', 'line-info');
          printLine('Example: dial add Amazon Prime Video https://www.amazon.com/Amazon-Video/b?ie=UTF8', 'line-info');
          printLine('Example: dial add Work Notes https://example.com --category Work', 'line-info');
          return;
        }

        const url = /^[a-z][a-z0-9+\-.]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

        if (/^(javascript|data):/i.test(url)) {
          printLine('Error: URL scheme not allowed.', 'line-err');
          return;
        }

        const store      = await loadDialStore();
        const aliasLower = alias.toLowerCase();
        const collision  = store.categories
          .flatMap(c => c.items)
          .find(it => it.alias != null && it.alias.toLowerCase() === aliasLower);
        if (collision) {
          printLine(`Alias "${collision.alias}" already exists. Use  dial rm ${collision.alias}  first.`, 'line-err');
          return;
        }

        // Resolve target category
        let targetCat;
        if (categoryArg) {
          targetCat = _findCategoryByLabel(store, categoryArg);
          if (!targetCat) {
            printLine(`Category "${categoryArg}" not found. Use  dial category ${categoryArg}  to create it first.`, 'line-err');
            return;
          }
        } else {
          targetCat = _defaultCategory(store);
        }

        const id = _uniqueId(_slugify(alias), store);
        targetCat.items.push({ id, type: 'link', alias, label: alias, url });
        await saveDialStore(store);
        await renderDials();
        const catNote = targetCat.label ? `  [${targetCat.label}]` : '';
        printLine(`✓ Dial "${alias}"  →  ${url}${catNote}`, 'line-ok');

      // ── dial rm ──────────────────────────────────────────────────
      } else if (sub === 'rm') {
        const alias = args.slice(1).join(' ').trim();
        if (!alias) { printLine('Usage:   dial rm [alias ...]', 'line-info'); return; }

        const store = await loadDialStore();
        const found = store.categories.flatMap(c => c.items).find(it => it.alias === alias);
        if (!found) {
          printLine(`Alias "${alias}" not found.`, 'line-err');
          return;
        }
        await removeDial(alias);

      // ── dial move ────────────────────────────────────────────────
      // Targets the DialStore (v1) directly.
      // Usage: dial move <alias> <category>
      // Because both alias and category can be multi-word, the split point is
      // discovered by trying every left/right partition from right to left.
      } else if (sub === 'move') {
        const rest = args.slice(1);
        if (rest.length < 2) {
          printLine('Usage:   dial move <alias> <category>', 'line-info');
          printLine('Example: dial move hn Work', 'line-info');
          printLine('Example: dial move Hacker News Social Media', 'line-info');
          return;
        }

        const store = await loadDialStore();
        let resolvedItem = null;
        let resolvedSrcCat = null;
        let resolvedDstCat = null;
        let resolvedAlias  = null;

        // Try splits from right to left so multi-word alias is preferred.
        for (let split = rest.length - 1; split >= 1; split--) {
          const trialAlias = rest.slice(0, split).join(' ').trim();
          const trialCat   = rest.slice(split).join(' ').trim();
          const srcCat = store.categories.find(c => c.items.some(it => it.alias === trialAlias));
          const dstCat = _findCategoryByLabel(store, trialCat);
          if (srcCat && dstCat) {
            resolvedItem     = srcCat.items.find(it => it.alias === trialAlias);
            resolvedSrcCat   = srcCat;
            resolvedDstCat   = dstCat;
            resolvedAlias    = trialAlias;
            break;
          }
        }

        if (!resolvedItem) {
          // Best-effort: detect which part failed for a helpful message.
          const guessAlias = rest.slice(0, -1).join(' ').trim();
          const guessCat   = rest[rest.length - 1];
          const itemExists = store.categories.flatMap(c => c.items).find(it => it.alias === guessAlias);
          if (!itemExists) {
            printLine(`Dial "${guessAlias}" not found.`, 'line-err');
          } else {
            printLine(`Category "${guessCat}" not found. Use  dial category ${guessCat}  to create it first.`, 'line-err');
          }
          return;
        }

        if (resolvedSrcCat === resolvedDstCat) {
          const catLabel = resolvedDstCat.label || '(default)';
          printLine(`Dial "${resolvedAlias}" is already in category "${catLabel}".`, 'line-info');
          return;
        }

        // Move: splice out of source, append to destination.
        resolvedSrcCat.items = resolvedSrcCat.items.filter(it => it.alias !== resolvedAlias);
        resolvedDstCat.items.push(resolvedItem);
        await saveDialStore(store);
        await renderDials();
        printLine(`✓ Dial "${resolvedAlias}" moved to category "${resolvedDstCat.label || '(default)'}".`, 'line-ok');

      // ── dial rename ───────────────────────────────────────────────
      // Targets the DialStore (v1) directly.
      // Usage: dial rename <alias> <new-label>
      // Multi-word alias and label resolved by left–right partition scan.
      } else if (sub === 'rename') {
        const rest = args.slice(1);
        if (rest.length < 2) {
          printLine('Usage:   dial rename <alias> <new-label>', 'line-info');
          printLine('Example: dial rename hn Hacker News', 'line-info');
          return;
        }

        const store = await loadDialStore();
        let resolvedItem  = null;
        let resolvedAlias = null;
        let resolvedLabel = null;

        // Scan from left to right so the alias is matched as early (shortest) as possible.
        for (let split = 1; split < rest.length; split++) {
          const trialAlias = rest.slice(0, split).join(' ').trim();
          const trialLabel = rest.slice(split).join(' ').trim();
          const item = store.categories.flatMap(c => c.items).find(it => it.alias === trialAlias);
          if (item && trialLabel) {
            resolvedItem  = item;
            resolvedAlias = trialAlias;
            resolvedLabel = trialLabel;
            break;
          }
        }

        if (!resolvedItem) {
          printLine(`Dial "${rest[0]}" not found.`, 'line-err');
          return;
        }

        const oldLabel = resolvedItem.label;
        resolvedItem.label = resolvedLabel;
        await saveDialStore(store);
        await renderDials();
        printLine(`✓ Renamed "${oldLabel}"  →  "${resolvedLabel}".`, 'line-ok');

      // ── dial category ─────────────────────────────────────────────
      // Targets the DialStore (v1) directly.
      // Creates a new named category (collapsible section).
      } else if (sub === 'category') {
        const categoryLabel = args.slice(1).join(' ').trim();
        if (!categoryLabel) {
          printLine('Usage:   dial category [label ...]', 'line-info');
          printLine('Example: dial category Work', 'line-info');
          printLine('Example: dial category Social Media', 'line-info');
          return;
        }
        const store = await loadDialStore();
        if (_findCategoryByLabel(store, categoryLabel)) {
          printLine(`Category "${categoryLabel}" already exists.`, 'line-err');
          return;
        }
        const id = _uniqueId(`cat_${_slugify(categoryLabel)}`, store);
        store.categories.push({ id, label: categoryLabel, collapsed: false, items: [] });
        await saveDialStore(store);
        await renderDials();
        printLine(`✓ Category "${categoryLabel}" added.`, 'line-ok');
        printLine(`  Use  dial add [alias] [url] --category ${categoryLabel}  to add tiles to it.`, 'line-info');

      // ── dial group (deprecated) ───────────────────────────────────
      // Kept as a compatibility alias for "dial category".
      // @deprecated Use "dial category" instead.
      } else if (sub === 'group') {
        printLine('⚠ "dial group" is deprecated — use "dial category" instead.', 'line-warn');
        await dialsCommands.dial.run(['category', ...args.slice(1)]);

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
        printLine('  Note: dividers are a display hint only — use  dial category  for persistent grouping.', 'line-info');

      // ── dial weather ─────────────────────────────────────────────
      // Targets the DialStore (v1) directly.
      } else if (sub === 'weather') {
        const store    = await loadDialStore();
        const existing = store.categories.flatMap(c => c.items).find(it => it.type === 'weather');
        if (existing) {
          printLine(`Weather dial already present (alias: "${existing.alias}"). Right-click it to edit the destination URL or remove it.`, 'line-info');
          return;
        }
        const url        = args[1] ? args[1] : 'https://weather.com';
        const defaultCat = _defaultCategory(store);
        const id         = _uniqueId('weather', store);
        defaultCat.items.push({ id, type: 'weather', alias: 'weather', label: 'WEATHER', url });
        await saveDialStore(store);
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
        // Resolve deduplication against the live store.
        const store = await loadDialStore();
        const existingAliases = new Set(
          store.categories.flatMap(c => c.items).map(it => (it.alias ?? '').toLowerCase()),
        );

        function collectBookmarks(node) {
          const out = [];
          if (node.url) { out.push(node); return out; }
          for (const child of (node.children || [])) out.push(...collectBookmarks(child));
          return out;
        }

        const toImport    = selected.isFolder ? collectBookmarks(selected.node) : [selected.node];
        const targetCat   = _defaultCategory(store);
        let added = 0, skipped = 0;
        for (const bm of toImport) {
          if (!bm.url || /^(javascript|data):/i.test(bm.url)) { skipped++; continue; }
          const alias = (bm.title || bm.url).trim();
          const alL   = alias.toLowerCase();
          if (existingAliases.has(alL)) { skipped++; continue; }
          const id = _uniqueId(_slugify(alias), store);
          targetCat.items.push({ id, type: 'link', alias, label: alias, url: bm.url });
          existingAliases.add(alL);
          added++;
        }

        if (added > 0) {
          await saveDialStore(store);
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
        const store = await loadDialStore();
        const totalItems = store.categories.reduce((n, c) => n + c.items.length, 0);
        printBlank();
        printRule('─');
        printLine('  SPEED DIAL', 'line-head');
        printRule('─');
        if (totalItems === 0) {
          printLine('  (no dials — use:  dial add [alias ...] [url])', 'line-info');
        } else {
          for (const cat of store.categories) {
            if (cat.label) printLine(`  ── ${cat.label} ──`, 'line-head');
            for (const it of cat.items) {
              if (it.type === 'weather') { printLine(`  [weather]       →  ${it.url}`, 'line-info'); continue; }
              const labelCol = (it.label || it.alias).padEnd(14);
              printLine(`  ${labelCol}  →  ${it.url}`, 'line-info');
            }
          }
        }
        printBlank();
        printLine('  dial add      [alias ...] [url] [--category <name>]  — add a new tile', 'line-info');
        printLine('  dial rm       [alias ...]                            — remove a tile', 'line-info');
        printLine('  dial move     <alias> <category>                     — move a tile to another category', 'line-info');
        printLine('  dial rename   <alias> <new-label>                    — rename a tile', 'line-info');
        printLine('  dial category [label ...]                            — add a collapsible category', 'line-info');
        printLine('  dial weather  [url]                                  — add a live weather tile', 'line-info');
        printLine('  dial divider  [row|col]                              — add a display divider', 'line-info');
        printLine('  dial import                                          — import from browser bookmarks', 'line-info');
        printLine('  Right-click any tile                                 — Edit / Refresh / Remove', 'line-info');
        printBlank();
      }
    },
  },

};
