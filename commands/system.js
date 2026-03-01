// ── commands/system.js ────────────────────────────────────────────────────────
// clr, clear, history, theme, banner, settings, boot, motd, uptime, whoami,
// sysinfo, syncstatus, shutdown.
// Also exports printBootSequence() for use by main.js.

import { THEMES }                           from '../core/config.js';
import { loadPrefs, savePrefs, loadNotes }  from '../core/storage.js';
import {
  clearScreen, printLine, printBlank, printRule,
  printBannerHtml, renderBanner,
  inputEl, cursorEl,
  beginBatch, endBatch,
} from '../core/render.js';
import { cmdHistory, sessionStart, setPendingConfirm } from '../core/state.js';
import { formatTimestamp }                  from '../core/clock.js';
import { applyPrefs, openSettingsPanel } from '../ui/settings.js';
import { printFirstRunTutorial, pickTryHint } from './onboarding.js';
import { loadProfile, getRankForXp,
         awardAchievement }               from '../core/progression.js';
import { notifyAchievement }              from './profile.js';

// ── BBS handle generator ──────────────────────────────────────────────────────
const _HANDLE_ADJ = [
  'Binary',  'Chaos',   'Cipher',  'Cobalt',  'Cosmic',  'Cyber',
  'Dark',    'Delta',   'Digital', 'Ghost',   'Hex',     'Hyper',
  'Infra',   'Ion',     'Iron',    'Laser',   'Logic',   'Macro',
  'Neural',  'Neon',    'Null',    'Omega',   'Phantom', 'Pixel',
  'Quantum', 'Razor',   'Rogue',   'Shadow',  'Signal',  'Sonic',
  'Static',  'Storm',   'Toxic',   'Turbo',   'Ultra',   'Vector',
  'Void',    'Wired',   'Xenon',   'Zero',
];
const _HANDLE_NOUN = [
  'Blade',   'Byte',    'Cobra',   'Crypt',   'Dragon',  'Eagle',
  'Falcon',  'Gate',    'Ghost',   'Hawk',    'Lynx',    'Node',
  'Omega',   'Phoenix', 'Pulse',   'Raven',   'Script',  'Specter',
  'Stack',   'Synth',   'Tiger',   'Trace',   'Viper',   'Virus',
  'Wolf',    'Wraith',  'Xero',    'Zero',    'Cobra',   'Worm',
];

function generateBBSHandle() {
  const adj  = _HANDLE_ADJ [Math.floor(Math.random() * _HANDLE_ADJ.length)];
  const noun = _HANDLE_NOUN[Math.floor(Math.random() * _HANDLE_NOUN.length)];
  return `${adj}${noun}`;
}

// ── Shared boot-sequence printer (also used by the `boot` command) ────────────
export async function printBootSequence() {
  const prefs = await loadPrefs();
  printRule('═');
  printLine('  SYSTEM READY.', 'line-head');
  printLine('  Type  help  for a list of commands.', 'line-info');
  if (prefs.motd) {
    printRule('─');
    printLine(`  ${prefs.motd}`, 'line-info');
  }
  printRule('═');
  printBlank();

  const notes = await loadNotes();
  if (notes.length > 0) {
    const plural = notes.length === 1 ? 'note' : 'notes';
    printLine(`  ${notes.length} ${plural} stored.  Type  ls  to view.`, 'line-info');
    printBlank();
  }

  // ── First-run tutorial ───────────────────────────────────────────
  // Show the page-1 tour on every boot until the user types skip-tour.
  if (!prefs.onboardingDone) {
    printFirstRunTutorial();
  } else {
    // ── Rotating "try this next" hint ────────────────────────────
    // One short tip per session, cycles through the full hint list.
    const hint = pickTryHint(prefs.sessionCount || 1);
    printLine(`  TRY  ─  ${hint}`, 'line-info');
    printBlank();
  }
}

export const systemCommands = {

  // ── clr ───────────────────────────────────────────────────────────
  clr: {
    description: 'Clear the terminal output (notes in storage are kept).',
    usage: 'clr',
    run(_args) { clearScreen(); },
  },

  // ── clear ─────────────────────────────────────────────────────────
  clear: {
    description: 'Clear the terminal output (alias for clr).',
    usage: 'clear',
    run(_args) { clearScreen(); },
  },

  // ── history ───────────────────────────────────────────────────────
  history: {
    description: "Print the current session's command history.",
    usage: 'history',
    run(_args) {
      if (cmdHistory.length === 0) { printLine('No command history yet.', 'line-info'); return; }
      printBlank();
      [...cmdHistory].reverse().forEach((cmd, i) => {
        printLine(`${String(i + 1).padStart(4, ' ')}  ${cmd}`, 'line-out');
      });
      printBlank();
    },
  },

  // ── theme ─────────────────────────────────────────────────────────
  theme: {
    description: 'Switch colour theme.  theme [name]  |  theme next',
    usage: 'theme [name | next]',
    async run(args) {
      const THEME_ORDER = Object.keys(THEMES);
      const sub = (args[0] || '').toLowerCase();

      if (!sub) {
        const prefs = await loadPrefs();
        printLine(`Current theme: ${prefs.theme.toUpperCase()}`, 'line-info');
        printLine(`Available:     ${THEME_ORDER.join('  ').toUpperCase()}`, 'line-info');
        printLine('Usage:  theme [name]   e.g. theme green', 'line-info');
        printLine('        theme next     cycle to the next theme', 'line-info');
        return;
      }

      const prefs = await loadPrefs();
      let next;
      if (sub === 'next') {
        const idx = THEME_ORDER.indexOf(prefs.theme);
        next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      } else if (THEME_ORDER.includes(sub)) {
        next = sub;
      } else {
        printLine(`Unknown theme: "${sub}".  Available: ${THEME_ORDER.join(', ')}`, 'line-err');
        return;
      }

      prefs.theme = next;
      await savePrefs(prefs);
      await applyPrefs(prefs);
      printLine(`✓ Theme set to ${next.toUpperCase()}.`, 'line-ok');
      notifyAchievement(await awardAchievement('theme_change'));
    },
  },

  // ── banner ────────────────────────────────────────────────────────
  banner: {
    description: 'Render text as a neon banner in the output.  e.g. banner HELLO',
    usage: 'banner [text ...]',
    async run(args) {
      if (args.length === 0) {
        printLine('Usage:   banner [text ...]', 'line-info');
        printLine('Example: banner HELLO WORLD', 'line-info');
        return;
      }
      const text   = args.join(' ');
      const result = await renderBanner(text);
      printBannerHtml(result.value);
    },
  },

  // ── settings ──────────────────────────────────────────────────────
  settings: {
    description: 'Open settings panel (theme, terminal size, dial size, banner, scanlines).',
    usage: 'settings',
    async run(_args) { await openSettingsPanel(); },
  },

  // ── boot ──────────────────────────────────────────────────────────
  boot: {
    description: 'Replay the startup sequence (separator, system-ready, date, note count).',
    usage: 'boot',
    async run(_args) { await printBootSequence(); },
  },

  // ── motd ──────────────────────────────────────────────────────────
  motd: {
    description: 'Manage the message of the day shown on every new tab.',
    usage: 'motd set [text ...]  |  motd clear  |  motd',
    async run(args) {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'set') {
        const text = args.slice(1).join(' ').trim();
        if (!text) { printLine('Usage: motd set [text ...]', 'line-info'); printLine('Provide the message text after  set.', 'line-info'); return; }
        const prefs = await loadPrefs();
        prefs.motd = text;
        await savePrefs(prefs);
        printLine(`✓ MOTD saved: "${text}"`, 'line-ok');
        return;
      }

      if (sub === 'clear') {
        const prefs = await loadPrefs();
        prefs.motd = '';
        await savePrefs(prefs);
        printLine('✓ MOTD cleared.', 'line-ok');
        return;
      }

      const prefs = await loadPrefs();
      if (prefs.motd) {
        printLine(`Current MOTD: "${prefs.motd}"`, 'line-info');
      } else {
        printLine('No MOTD set.  Use  motd set [text]  to add one.', 'line-info');
      }
    },
  },

  // ── uptime ────────────────────────────────────────────────────────
  uptime: {
    description: 'Show elapsed time since the terminal session started.',
    usage: 'uptime',
    run(_args) {
      const now      = Date.now();
      const start    = sessionStart ?? now;
      const total    = Math.floor((now - start) / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;

      printBlank();
      printLine('  TERMINAL UPTIME', 'line-head');
      printRule('─', 36);
      printLine(`  Session started : ${new Date(start).toLocaleString()}`, 'line-info');
      printLine(`  Elapsed         : ${h}h ${m}m ${s}s`, 'line-ok');
      printBlank();
    },
  },

  // ── whoami ────────────────────────────────────────────────────────
  whoami: {
    description: 'Show your BBS user info: handle, rank, XP, session number, and login time.',
    usage: 'whoami',
    async run(_args) {
      const prefs = await loadPrefs();

      const isNew = !prefs.handle;
      if (isNew) { prefs.handle = generateBBSHandle(); await savePrefs(prefs); }

      const handle  = prefs.handle;
      const session = String(prefs.sessionCount || 1).padStart(4, '0');
      const login   = formatTimestamp(sessionStart);

      // Load rank / XP from the progression profile.
      const profile = await loadProfile();
      const rank    = getRankForXp(profile.xp);

      const INNER  = 54;
      const top    = '╔' + '═'.repeat(INNER + 2) + '╗';
      const bottom = '╚' + '═'.repeat(INNER + 2) + '╝';
      const sep    = '╠' + '═'.repeat(INNER + 2) + '╣';

      function row(label, value) {
        const content = `  ${label.padEnd(14)}${value}`;
        return '║' + content.padEnd(INNER + 2) + '║';
      }

      printBlank();
      printLine(top,   'line-sep');
      printLine('║  ░▒▓  USER IDENTIFICATION  ▓▒░' + ' '.repeat(INNER - 29) + '  ║', 'line-head');
      printLine(sep,   'line-sep');
      printLine(row('HANDLE:', handle),                        'line-head');
      printLine(row('RANK:',   `${rank.rank}  ${rank.badge}`), 'line-head');
      printLine(row('XP:',     `${profile.xp}`),               'line-ok');
      printLine(row('SESSION:', `#${session}`),                 'line-out');
      printLine(row('LOGIN:', login),                           'line-out');
      printLine(bottom, 'line-sep');
      printBlank();

      if (isNew) { printLine('  ✦ New handle assigned.  It is stored in your preferences.', 'line-ok'); printBlank(); }
    },
  },

  // ── sysinfo ───────────────────────────────────────────────────────
  sysinfo: {
    description: 'Show browser version, platform, screen resolution, CPU cores, and device memory.',
    usage: 'sysinfo',
    run(_args) {
      const nav = navigator;

      let browserName = 'Unknown', browserVer = '';
      const ua = nav.userAgent || '';

      if (nav.userAgentData?.brands) {
        const real = nav.userAgentData.brands.find(b => !/not.a.brand|chromium/i.test(b.brand))
          || nav.userAgentData.brands[0];
        if (real) { browserName = real.brand; browserVer = real.version; }
      } else {
        const pairs = [
          [/Edg\/([0-9.]+)/,     'Edge'],
          [/OPR\/([0-9.]+)/,     'Opera'],
          [/Firefox\/([0-9.]+)/, 'Firefox'],
          [/Chrome\/([0-9.]+)/,  'Chrome'],
          [/Safari\/([0-9.]+)/,  'Safari'],
        ];
        for (const [re, name] of pairs) {
          const m = ua.match(re);
          if (m) { browserName = name; browserVer = m[1]; break; }
        }
      }
      const browserStr = browserVer ? `${browserName} ${browserVer}` : browserName;

      let platform = 'Unknown';
      if (nav.userAgentData?.platform) platform = nav.userAgentData.platform;
      else if (nav.platform) platform = nav.platform;
      const arch = nav.userAgentData?.architecture || '';

      const resPx    = `${screen.width} × ${screen.height}`;
      const resAvail = `${screen.availWidth} × ${screen.availHeight}  (usable)`;
      const dpr      = window.devicePixelRatio ? `${window.devicePixelRatio}× DPR` : '';
      const depth    = `${screen.colorDepth}-bit colour`;

      const cores = nav.hardwareConcurrency
        ? `${nav.hardwareConcurrency} logical core${nav.hardwareConcurrency !== 1 ? 's' : ''}`
        : 'Unavailable';
      const memGB = nav.deviceMemory ? `≥ ${nav.deviceMemory} GB  (reported)` : 'Unavailable';
      const online = nav.onLine ? 'Online' : 'Offline';

      const INNER  = 54;
      const top    = '╔' + '═'.repeat(INNER + 2) + '╗';
      const bottom = '╚' + '═'.repeat(INNER + 2) + '╝';
      const sep    = '╠' + '═'.repeat(INNER + 2) + '╣';

      function row(label, value, cls = 'line-out') {
        const content = `  ${label.padEnd(16)}${value}`;
        return { text: '║' + content.padEnd(INNER + 2) + '║', cls };
      }

      const rows = [
        row('BROWSER:',    browserStr,  'line-head'),
        row('PLATFORM:',   arch ? `${platform}  (${arch})` : platform),
        { text: '║' + ' '.repeat(INNER + 2) + '║', cls: 'line-sep' },
        row('RESOLUTION:', resPx),
        row('',            resAvail,   'line-info'),
        row('COLOR DEPTH:', `${depth}${dpr ? '  ·  ' + dpr : ''}`),
        { text: '║' + ' '.repeat(INNER + 2) + '║', cls: 'line-sep' },
        row('CPU CORES:',  cores),
        row('DEVICE RAM:', memGB),
        { text: '║' + ' '.repeat(INNER + 2) + '║', cls: 'line-sep' },
        row('NETWORK:',    online, nav.onLine ? 'line-ok' : 'line-err'),
      ];

      printBlank();
      printLine(top, 'line-sep');
      printLine('║  ░▒▓  SYSTEM INFORMATION  ▓▒░' + ' '.repeat(INNER - 28) + '  ║', 'line-head');
      printLine(sep, 'line-sep');
      rows.forEach(({ text, cls }) => printLine(text, cls));
      printLine(bottom, 'line-sep');
      printBlank();
    },
  },

  // ── syncstatus ────────────────────────────────────────────────────
  syncstatus: {
    description: 'Show the current contents of chrome.storage.sync (dials, notes, prefs).',
    usage: 'syncstatus',
    async run(_args) {
      const data  = await chrome.storage.sync.get(null);
      const notes = data.notes || [];
      const prefs = data.prefs || {};

      // Read dials from the v1 dialStore if available, falling back to legacy flat array
      let dialCount = 0;
      let dialEntries = [];
      if (data.dialStore?.version) {
        for (const cat of (data.dialStore.categories || [])) {
          for (const item of (cat.items || [])) {
            dialCount++;
            dialEntries.push({ alias: item.alias, url: item.url, category: cat.label || '(default)' });
          }
        }
      } else {
        const dials = data.dials || [];
        dialCount = dials.length;
        dialEntries = dials.map(d => ({ alias: d.alias, url: d.url }));
      }

      printBlank();
      printLine('  chrome.storage.sync contents:', 'line-head');
      printRule('─', 38);
      printLine(`  Dials : ${dialCount} item(s)`, 'line-info');
      dialEntries.forEach(d => {
        const cat = d.category ? `  [${d.category}]` : '';
        printLine(`    • ${d.alias}  →  ${d.url}${cat}`, 'line-out');
      });
      printLine(`  Notes : ${notes.length} item(s)`, 'line-info');
      printLine(`  Prefs : ${Object.keys(prefs).length > 0 ? JSON.stringify(prefs) : '(none)'}`, 'line-info');

      const flag = await chrome.storage.local.get({ _syncMigrated: false });
      printLine(`  Migration flag (_syncMigrated): ${flag._syncMigrated}`, 'line-info');
      printBlank();
    },
  },

  // ── shutdown ──────────────────────────────────────────────────────
  shutdown: {
    description: 'Power off the terminal with a CRT shutdown animation. Reload the tab to restart.',
    usage: 'shutdown',
    async run(_args) {
      printLine('Shut down the terminal? Reload the tab to restart.', 'line-err');
      printLine('Type  CONFIRM  to proceed, or anything else to abort:', 'line-info');
      endBatch();

      const answer = await new Promise(resolve => setPendingConfirm(resolve));
      beginBatch();
      printLine(`> ${answer}`, 'line-cmd');

      if (answer.trim().toUpperCase() !== 'CONFIRM') {
        printLine('Shutdown aborted.', 'line-info');
        return;
      }

      printLine('SYSTEM HALTED.', 'line-err');
      printLine('Powering down...', 'line-out');

      inputEl.disabled         = true;
      cursorEl.style.visibility = 'hidden';

      setTimeout(() => {
        const termEl = document.getElementById('terminal');
        const scanEl = document.getElementById('scanlines');
        termEl.classList.add('crt-poweroff');
        termEl.addEventListener('animationend', () => {
          termEl.style.display = 'none';
          if (scanEl) scanEl.style.display = 'none';
          document.body.style.background = '#000';
        }, { once: true });
      }, 520);
    },
  },

};
