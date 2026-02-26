// ── commands/data.js ──────────────────────────────────────────────────────────
// export and import commands.

import { DEFAULT_PREFS }                             from '../core/config.js';
import { loadDials, loadNotes, loadPrefs,
         saveDials, saveNotes, savePrefs }           from '../core/storage.js';
import { printLine }                                 from '../core/render.js';
import { renderDials }                               from '../ui/dials.js';
import { applyPrefs }                                from '../ui/settings.js';

export const dataCommands = {

  // ── export ────────────────────────────────────────────────────────
  export: {
    description: 'Download a JSON backup of all dials, notes, and preferences.',
    usage: 'export',
    async run(_args) {
      const [dials, notes, prefs] = await Promise.all([loadDials(), loadNotes(), loadPrefs()]);

      const payload = {
        _phosphor: true,
        _version: 1,
        _exported: new Date().toISOString(),
        dials,
        notes,
        prefs,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `phosphor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      printLine(`✓ Exported ${dials.length} dial(s), ${notes.length} note(s).`, 'line-ok');
      printLine('  File saved to your Downloads folder.', 'line-info');
    },
  },

  // ── import ────────────────────────────────────────────────────────
  import: {
    description: 'Restore dials, notes, and preferences from a phosphor-backup.json file.  Existing data is replaced.',
    usage: 'import',
    run(_args) {
      return new Promise((resolve) => {
        const fileInput  = document.createElement('input');
        fileInput.type   = 'file';
        fileInput.accept = 'application/json,.json';

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files[0];
          if (!file) { printLine('No file selected.', 'line-err'); resolve(); return; }

          let payload;
          try {
            const text = await file.text();
            payload = JSON.parse(text);
          } catch {
            printLine('✗ Could not parse file — is it a valid JSON backup?', 'line-err');
            resolve(); return;
          }

          if (!payload._phosphor) {
            printLine('✗ File does not look like a Phosphor backup.', 'line-err');
            resolve(); return;
          }

          const saves = [];
          if (Array.isArray(payload.dials))                        saves.push(saveDials(payload.dials));
          if (Array.isArray(payload.notes))                        saves.push(saveNotes(payload.notes));
          if (payload.prefs && typeof payload.prefs === 'object')  saves.push(savePrefs({ ...DEFAULT_PREFS, ...payload.prefs }));

          await Promise.all(saves);

          if (Array.isArray(payload.dials)) await renderDials();
          if (payload.prefs)               await applyPrefs({ ...DEFAULT_PREFS, ...payload.prefs });

          const dc = Array.isArray(payload.dials) ? payload.dials.length : 0;
          const nc = Array.isArray(payload.notes) ? payload.notes.length : 0;
          printLine(`✓ Imported ${dc} dial(s), ${nc} note(s).`, 'line-ok');
          if (payload._exported) printLine(`  Backup dated: ${payload._exported.slice(0, 10)}`, 'line-info');
          printLine('  All data has been restored.', 'line-info');
          resolve();
        });

        fileInput.addEventListener('cancel', () => {
          printLine('Import cancelled.', 'line-info');
          resolve();
        });

        fileInput.click();
      });
    },
  },

};
