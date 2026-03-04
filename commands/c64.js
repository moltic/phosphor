// ── commands/c64.js ───────────────────────────────────────────────────────────
// `c64`       — boot the Commodore 64 virtual machine.
// `c64 load`  — fetch a .prg from a URL and autostart it.

import { printLine, printBlank, printRule } from '../core/render.js';
import { initC64VM, bootC64, killC64, loadPrg } from '../core/c64-vm.js';

// ── Command registry ──────────────────────────────────────────────────────────
export const c64Commands = {
  'c64': {
    help: 'launch the C64 virtual machine  |  c64 load <url>',
    run: async function(args) {
      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'boot') {
        printLine('BOOTING COMMODORE 64...', 'line-info');
        printLine('Type ESC or press QUIT to return to terminal.', 'line-dim');
        await initC64VM();
        await bootC64();
        return;
      }

      if (sub === 'load') {
        const url = args[1];
        if (!url) { printLine('Usage: c64 load <url>', 'line-err'); return; }
        printLine(`Fetching ${url} ...`, 'line-info');
        let bytes;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          bytes = new Uint8Array(await resp.arrayBuffer());
        } catch(e) {
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
      printLine('Usage: c64  |  c64 load <url>', 'line-dim');
    },
  },
};
