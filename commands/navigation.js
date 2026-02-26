// ── commands/navigation.js ────────────────────────────────────────────────────
// g (Google search) and l (open alias / URL).

import { ALIASES }           from '../core/config.js';
import { loadDials }         from '../core/storage.js';
import { printLine, printBlank } from '../core/render.js';

export const navigationCommands = {

  // ── g — Google search ────────────────────────────────────────────
  g: {
    description: 'Search Google.  e.g. g javascript promises',
    usage: 'g [query ...]',
    run(args) {
      if (args.length === 0) {
        printLine('Usage:   g [query ...]', 'line-info');
        printLine('Example: g site:github.com chrome extension mv3', 'line-info');
        return;
      }
      const query = args.join(' ');
      printLine(`Searching Google: "${query}"`, 'line-ok');
      window.location.href =
        `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    },
  },

  // ── l — navigate (alias / domain / full URL) ─────────────────────
  l: {
    description: 'Open a speed-dial alias or any URL.  e.g. l gh',
    usage: 'l [alias | url]',
    async run(args) {
      const storedDials = (await loadDials()).filter(d => !d.type && d.alias && d.url);

      if (args.length === 0) {
        printLine('Usage:   l [alias | url]', 'line-info');
        printLine('Example: l gh     or     l example.com', 'line-info');
        printBlank();

        if (storedDials.length > 0) {
          printLine('Saved dials:', 'line-info');
          storedDials.forEach(({ alias, label, url }) => {
            const desc = label && label !== alias ? `${url}  (${label})` : url;
            printLine(`  ${alias.padEnd(12)} →  ${desc}`, 'line-info');
          });
          printBlank();
        }

        printLine('Built-in aliases:', 'line-info');
        Object.entries(ALIASES).forEach(([alias, url]) => {
          printLine(`  ${alias.padEnd(12)} →  ${url}`, 'line-info');
        });
        return;
      }

      const raw   = args.join(' ').trim();
      const lower = raw.toLowerCase();

      // 1) Stored dial alias
      const storedMatch = storedDials.find(d => d.alias.toLowerCase() === lower);
      if (storedMatch) {
        printLine(`Opening ${storedMatch.url}`, 'line-ok');
        window.location.href = storedMatch.url;
        return;
      }

      // 2) Built-in alias
      if (Object.prototype.hasOwnProperty.call(ALIASES, lower)) {
        printLine(`Opening ${ALIASES[lower]}`, 'line-ok');
        window.location.href = ALIASES[lower];
        return;
      }

      // 3) Already has a scheme
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)) {
        printLine(`Opening ${raw}`, 'line-ok');
        window.location.href = raw;
        return;
      }

      // 4) Bare domain
      if (/^[^\s]+\.[^\s]+$/.test(raw)) {
        const url = `https://${raw}`;
        printLine(`Opening ${url}`, 'line-ok');
        window.location.href = url;
        return;
      }

      // 5) Unrecognised
      printLine(`Unknown alias or unrecognised URL: "${raw}"`, 'line-err');
      printLine('Type  l  with no arguments to list aliases.', 'line-info');
    },
  },

};
