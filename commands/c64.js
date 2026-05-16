// ── commands/c64.js ───────────────────────────────────────────────────────────
// `c64`              — boot the Commodore 64 virtual machine.
// `c64 load <url>`   — fetch a .prg from a URL and autostart it.
// `c64 rom <url>`    — fetch and store KERNAL/BASIC/CHARGEN ROMs from a base URL.
// `c64 rom status`   — show which ROMs are stored.
// `c64 rom clear`    — remove stored ROMs.

import { printLine, printBlank } from '../core/render.js';
import { initC64VM, bootC64, loadPrg } from '../core/c64-vm.js';
import { hasAllRoms, fetchAndSaveRoms, clearRoms, romStatus } from '../core/c64-roms.js';

const ROM_SETUP_HELP = [
  'C64 ROMs are required but not bundled (copyright).',
  'Source your own KERNAL, BASIC, and CHARGEN ROM files,',
  'host them at a URL, then run:',
  '',
  '  c64 rom <base-url>',
  '',
  'The command fetches <base-url>/kernal, <base-url>/basic,',
  'and <base-url>/chargen and stores them locally.',
  '',
  'ROMs persist across sessions until you run `c64 rom clear`.',
];

// ── Command registry ──────────────────────────────────────────────────────────
export const c64Commands = {
  'c64': {
    description: 'Launch the Commodore 64 VM.  Requires user-supplied ROMs — see `c64 rom`.',
    usage: 'c64 [load <url> | rom <base-url> | rom status | rom clear]',
    run: async function(args) {
      const sub = args[0]?.toLowerCase();

      // ── c64 rom ──────────────────────────────────────────────────────────
      if (sub === 'rom') {
        const action = args[1]?.toLowerCase();

        if (action === 'status') {
          const statuses = await romStatus();
          printLine('C64 ROM status:', 'line-info');
          for (const { name, sizeBytes } of statuses) {
            const label = name.padEnd(8);
            if (sizeBytes !== null) {
              printLine(`  ${label}  ${sizeBytes} bytes  ✓`, 'line-ok');
            } else {
              printLine(`  ${label}  missing`, 'line-err');
            }
          }
          return;
        }

        if (action === 'clear') {
          await clearRoms();
          printLine('Stored ROMs cleared.', 'line-ok');
          return;
        }

        // c64 rom <base-url>
        const baseUrl = args[1];
        if (!baseUrl) {
          ROM_SETUP_HELP.forEach(l => printLine(l, l === '' ? 'line-blank' : 'line-dim'));
          return;
        }

        printLine(`Fetching ROMs from ${baseUrl} ...`, 'line-info');
        try {
          await fetchAndSaveRoms(baseUrl, msg => printLine(msg, 'line-dim'));
          printLine('ROMs stored. Run `c64` to launch the emulator.', 'line-ok');
        } catch (e) {
          printLine(`Error: ${e.message}`, 'line-err');
        }
        return;
      }

      // ── c64 / c64 boot ───────────────────────────────────────────────────
      if (!sub || sub === 'boot') {
        if (!(await hasAllRoms())) {
          ROM_SETUP_HELP.forEach(l => printLine(l, l === '' ? 'line-blank' : 'line-dim'));
          return;
        }
        printLine('BOOTING COMMODORE 64...', 'line-info');
        try {
          await initC64VM();
        } catch (e) {
          printLine(`C64 unavailable: ${e.message}`, 'line-err');
          return;
        }
        printLine('Type ESC or press QUIT to return to terminal.', 'line-dim');
        await bootC64();
        return;
      }

      // ── c64 load <url> ───────────────────────────────────────────────────
      if (sub === 'load') {
        const url = args[1];
        if (!url) { printLine('Usage: c64 load <url>', 'line-err'); return; }

        if (!(await hasAllRoms())) {
          printLine('ROMs not configured. Run `c64 rom <base-url>` first.', 'line-err');
          return;
        }

        printLine(`Fetching ${url} ...`, 'line-info');
        let bytes;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          bytes = new Uint8Array(await resp.arrayBuffer());
        } catch (e) {
          printLine(`Error: ${e.message}`, 'line-err');
          return;
        }
        printLine(`Loaded ${bytes.length} bytes. Autostarting...`, 'line-ok');
        await initC64VM();
        await bootC64();
        loadPrg(bytes.buffer);
        return;
      }

      printLine(`Unknown subcommand: ${sub}`, 'line-err');
      printLine('Usage: c64  |  c64 load <url>  |  c64 rom <base-url>', 'line-dim');
    },
  },
};
