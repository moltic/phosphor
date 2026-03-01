// ── commands/fun.js ───────────────────────────────────────────────────────────
// fortune, cal, ping, scan, typewriter, beep, cow, noise, matrix, hack,
// countdown, maze.

import { CONFIG }               from '../core/config.js';
import {
  printLine, printBlank, printRule,
  outputEl, endBatch, getBatchEl,
} from '../core/render.js';
import {
  _countdownInterval, setCountdownInterval, clearCountdownIntervalState,
  clockInterval,      setClockInterval,      clearClockInterval,
} from '../core/state.js';
import { tickClock }            from '../core/clock.js';
import { awardAchievement }     from '../core/progression.js';
import { notifyAchievement }    from './profile.js';
import { triggerMission }       from '../core/missions.js';
import { notifyMission }        from './missions.js';

// ── Fortune quotes ────────────────────────────────────────────────────────────
const FORTUNES = [
  // ── hacker culture ──────────────────────────────────────────────
  'rm -rf / --no-preserve-root — the only command with an honesty flag.',
  "There are only 10 types of people in the world: those who understand binary, and those who don't.",
  'The root password is like a toothbrush: never share it, and change it often.',
  'In UNIX, "almost" means "not at all".',
  'Premature optimisation is the root of all evil.  — Donald Knuth',
  'Any fool can write code a computer can understand. Good programmers write code humans can understand.  — Martin Fowler',
  'First, solve the problem. Then, write the code.  — John Johnson',
  "It's not a bug — it's an undocumented feature.",
  'The best way to accelerate a Windows machine is at 9.8 m/s².',
  "There's no place like 127.0.0.1.",
  'Real programmers count from zero.',
  'sudo make me a sandwich.  — xkcd #149',
  '"Works on my machine" is not a deployment strategy.',
  'To understand recursion, one must first understand recursion.',
  'Always code as if the person maintaining your code is a violent psychopath who knows where you live.',
  'Talk is cheap. Show me the code.  — Linus Torvalds',
  'Inside every large program is a small program struggling to get out.  — C. A. R. Hoare',
  'If debugging is removing bugs, then programming must be putting them in.  — Edsger W. Dijkstra',
  'The three virtues of a programmer: laziness, impatience, and hubris.  — Larry Wall',
  'UNIX was not designed to stop you from doing stupid things — that would also stop clever things.',
  // ── BBS era ──────────────────────────────────────────────────────
  'BBS: where 1200 baud felt like drinking from a fire hose.',
  'You have new mail.  (Nobody sends mail any more.)',
  'ANSI art: proof that beauty is achievable with 16 colours and a 9600-baud modem.',
  'SysOps never sleep — they just go into low-power standby.',
  'Leave the modem on and the door unlocked. The BBS never closes.',
  'FidoNet: stitching the planet together at 2 AM, one noisy handshake at a time.',
  'Door games built more character than any console title ever shipped.',
  'The longest download of your life was just a single ISO at 14.4k.',
  'G-Phile (n): sacred text, distributed only under cover of night.',
  'Call back later — the line is busy.',
  'Ten seconds of ANSI animation took three hours and a borrowed compiler.',
  'Elite status: achieved by knowing which BBS to call and when.',
  // ── computing lore ───────────────────────────────────────────────
  '640K ought to be enough for anybody.  (Misattributed to Bill Gates, 1981)',
  'Hardware: the parts of a computer system that can be kicked.',
  'A computer is a bicycle for the mind.  — Steve Jobs',
  'Computers are useless. They can only give you answers.  — Pablo Picasso',
  "Never trust a computer you can't throw out a window.  — Steve Wozniak",
  'The internet: a series of tubes.  — Ted Stevens, 2006',
  "Software never works on the first try. That's what the second try is for.",
  "pwd: the command you type when you've completely forgotten where you are.",
];

export const funCommands = {

  // ── fortune ───────────────────────────────────────────────────────
  fortune: {
    description: 'Print a random hacker / BBS / computing witticism in a decorative box.',
    usage: 'fortune',
    run(_args) {
      const quote = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
      const INNER  = 54;

      const words   = quote.split(' ');
      const wrapped = [];
      let   cur     = '';
      for (const word of words) {
        if (cur.length === 0) { cur = word; }
        else if (cur.length + 1 + word.length <= INNER) { cur += ' ' + word; }
        else { wrapped.push(cur); cur = word; }
      }
      if (cur) wrapped.push(cur);

      const top    = '╔' + '═'.repeat(INNER + 2) + '╗';
      const bottom = '╚' + '═'.repeat(INNER + 2) + '╝';
      const blank  = '║' + ' '.repeat(INNER + 2) + '║';

      printBlank();
      printLine(top,    'line-sep');
      printLine(blank,  'line-sep');
      for (const line of wrapped) {
        printLine('║ ' + line.padEnd(INNER) + ' ║', 'line-head');
      }
      printLine(blank,  'line-sep');
      printLine(bottom, 'line-sep');
      printBlank();

      // Achievement — fire-and-forget (idempotent after first run).
      awardAchievement('fortune_read').then(r => notifyAchievement(r));
      triggerMission('run_fortune').then(r => notifyMission(r));
    },
  },

  // ── cal ───────────────────────────────────────────────────────────
  cal: {
    description: 'Show the current month as a monospaced calendar grid with today highlighted.',
    usage: 'cal',
    run(_args) {
      const now   = new Date();
      const year  = now.getFullYear();
      const month = now.getMonth();
      const today = now.getDate();

      const MONTH_NAMES = [
        'January', 'February', 'March',     'April',
        'May',     'June',     'July',      'August',
        'September','October', 'November',  'December',
      ];

      const firstDay    = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const slots = [];
      for (let i = 0; i < firstDay; i++)    slots.push('  ');
      for (let d = 1; d <= daysInMonth; d++) slots.push(String(d).padStart(2));
      while (slots.length % 7 !== 0)        slots.push('  ');

      const weeks = [];
      for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));

      function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

      const todaySlot  = String(today).padStart(2);
      const headerText = `${MONTH_NAMES[month]} ${year}`;
      const headerLine = headerText
        .padStart(Math.floor((20 + headerText.length) / 2))
        .padEnd(20);

      let html = '';
      html += `<span class="cal-header">${esc(headerLine)}</span>\n`;
      html += `<span class="cal-days">${esc('Su Mo Tu We Th Fr Sa')}</span>\n`;

      for (const week of weeks) {
        let row = '';
        week.forEach((slot, col) => {
          if (slot === todaySlot && slot.trim() !== '') {
            row += `<span class="cal-today">${esc(slot)}</span>`;
          } else {
            row += esc(slot);
          }
          if (col < 6) row += ' ';
        });
        html += row + '\n';
      }

      const pre = document.createElement('pre');
      pre.className = 'cal-output';
      pre.innerHTML = html;

      printBlank();
      const batchEl = getBatchEl();
      if (batchEl) {
        batchEl.appendChild(pre);
      } else {
        outputEl.appendChild(pre);
        outputEl.scrollTop = outputEl.scrollHeight;
      }
      printBlank();
      triggerMission('run_cal').then(r => notifyMission(r));
    },
  },

  // ── ping ──────────────────────────────────────────────────────────
  ping: {
    description: 'Fake-ping a host — 4 echo replies with randomised RTT values.',
    usage: 'ping [host]',
    run(args) {
      const host = args[0] || 'localhost';
      const rtts = Array.from({ length: 4 }, () =>
        parseFloat((Math.random() * 28 + 2).toFixed(3))
      );

      printBlank();
      printLine(`PING ${host}: 56 data bytes`, 'line-head');

      const BASE_MS = 350, STEP_MS = 600;
      rtts.forEach((rtt, i) => {
        setTimeout(() => {
          printLine(`64 bytes from ${host}: icmp_seq=${i} ttl=64 time=${rtt} ms`, 'line-ok');
        }, BASE_MS + i * STEP_MS);
      });

      setTimeout(() => {
        const sorted = [...rtts].sort((a, b) => a - b);
        const min = sorted[0].toFixed(3);
        const max = sorted[sorted.length - 1].toFixed(3);
        const avg = (rtts.reduce((s, v) => s + v, 0) / rtts.length).toFixed(3);
        printBlank();
        printLine(`--- ${host} ping statistics ---`, 'line-head');
        printLine(`4 packets transmitted, 4 received, 0.0% packet loss`, 'line-info');
        printLine(`round-trip min/avg/max = ${min}/${avg}/${max} ms`, 'line-info');
        printBlank();
      }, BASE_MS + rtts.length * STEP_MS + 200);
    },
  },

  // ── scan ──────────────────────────────────────────────────────────
  scan: {
    description: 'Animate a fake TCP/SYN port-scan across fabricated IPs. Ends with sector status.',
    usage: 'scan',
    run(_args) {
      function randomIp() {
        const prefixes = ['10', '172.16', '192.168'];
        const pfx   = prefixes[Math.floor(Math.random() * prefixes.length)];
        const parts = pfx.split('.').length;
        let ip = pfx;
        for (let i = parts; i < 4; i++) ip += '.' + (Math.floor(Math.random() * 253) + 1);
        return ip;
      }

      const PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3389, 8080, 8443];
      const IPS   = Array.from({ length: 6 }, randomIp);

      printBlank();
      printLine('INITIATING SECTOR SCAN …', 'line-head');
      printLine(`Targets: ${IPS.length} nodes  |  Ports: ${PORTS.length}  |  Protocol: TCP/SYN`, 'line-info');
      printBlank();

      let t = 120;
      for (const ip of IPS) {
        const ipPadded = ip.padEnd(16);
        for (const port of PORTS) {
          const portLabel = String(port).padStart(5);
          const delay = Math.floor(Math.random() * 80) + 40;
          const _ip = ipPadded, _port = portLabel;
          setTimeout(() => { printLine(`  ${_ip}  port ${_port}  ……  CLOSED`, 'line-out'); }, t);
          t += delay;
        }
        t += 200;
      }

      setTimeout(() => {
        printBlank();
        printRule('═');
        printLine('  ALL PORTS CLOSED — SECTOR SECURE.', 'line-ok');
        printRule('═');
        printBlank();
        triggerMission('run_scan').then(r => notifyMission(r));
      }, t + 120);
    },
  },

  // ── typewriter ────────────────────────────────────────────────────
  typewriter: {
    description: 'Print a message one character at a time (40 ms/char).',
    usage: 'typewriter [text ...]',
    run(args) {
      if (args.length === 0) {
        printLine('Usage:   typewriter [text ...]', 'line-info');
        printLine('Example: typewriter Hello, world!', 'line-info');
        return;
      }
      const message = args.join(' ');
      endBatch();

      const span = document.createElement('span');
      span.className = 'line line-out';
      outputEl.appendChild(span);
      outputEl.scrollTop = outputEl.scrollHeight;

      return new Promise(resolve => {
        let i = 0;
        function typeNext() {
          if (i < message.length) {
            span.textContent += message[i++];
            outputEl.scrollTop = outputEl.scrollHeight;
            setTimeout(typeNext, CONFIG.TYPEWRITER_CHAR_MS);
          } else {
            triggerMission('run_typewriter').then(r => notifyMission(r));
            resolve();
          }
        }
        setTimeout(typeNext, CONFIG.TYPEWRITER_CHAR_MS);
      });
    },
  },

  // ── beep ──────────────────────────────────────────────────────────
  beep: {
    description: 'Play a short retro PC-speaker beep (~800 Hz square wave, ~120 ms).',
    usage: 'beep',
    run(_args) {
      try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type            = 'square';
        osc.frequency.value = 800;
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
        osc.onended = () => ctx.close();
        printLine('*BEEP*', 'line-ok');
      } catch (err) {
        printLine('Beep failed: Web Audio API not available.', 'line-err');
        console.error('[Phosphor beep]', err);
      }
    },
  },

  // ── cow ───────────────────────────────────────────────────────────
  cow: {
    description: 'Print text in a cowsay-style ASCII speech bubble.',
    usage: 'cow [text ...]',
    run(args) {
      if (args.length === 0) {
        printLine('Usage:   cow [text ...]', 'line-info');
        printLine('Example: cow moo from the terminal', 'line-info');
        return;
      }
      const msg      = args.join(' ');
      const MAX_W    = 48;
      const lines    = [];

      if (msg.length <= MAX_W) {
        lines.push(msg);
      } else {
        // Word-wrap long messages
        const words = msg.split(' ');
        let cur = '';
        for (const word of words) {
          if (!cur) { cur = word; }
          else if (cur.length + 1 + word.length <= MAX_W) { cur += ' ' + word; }
          else { lines.push(cur); cur = word; }
        }
        if (cur) lines.push(cur);
      }

      const boxW  = Math.max(...lines.map(l => l.length));
      const top    = ' ' + '_'.repeat(boxW + 2);
      const bottom = ' ' + '-'.repeat(boxW + 2);

      printBlank();
      printLine(top, 'line-out');
      if (lines.length === 1) {
        printLine('< ' + lines[0].padEnd(boxW) + ' >', 'line-out');
      } else {
        printLine('/ ' + lines[0].padEnd(boxW) + ' \\', 'line-out');
        for (let i = 1; i < lines.length - 1; i++) {
          printLine('| ' + lines[i].padEnd(boxW) + ' |', 'line-out');
        }
        printLine('\\ ' + lines[lines.length - 1].padEnd(boxW) + ' /', 'line-out');
      }
      printLine(bottom, 'line-out');
      printLine('        \\   ^__^',           'line-out');
      printLine('         \\  (oo)\\_______',   'line-out');
      printLine('            (__)\\       )\\/\\', 'line-out');
      printLine('                ||----w |',    'line-out');
      printLine('                ||     ||',    'line-out');
      printBlank();
      triggerMission('run_cowsay').then(r => notifyMission(r));
    },
  },

  // ── noise ─────────────────────────────────────────────────────────
  noise: {
    description: 'Print a block of random ASCII static (CRT noise).',
    usage: 'noise [lines]',
    run(args) {
      const CHARS  = '█▓▒░ .:!|/\\#%&@*^~?+=-_,;\'"`<>[]{}()0O°';
      const WIDTH  = 60;
      const MAX_LINES = 24;
      const requestedLines = parseInt(args[0], 10);
      const lines  = (!isNaN(requestedLines) && requestedLines > 0)
        ? Math.min(requestedLines, MAX_LINES) : 8;

      if (!isNaN(requestedLines) && requestedLines > MAX_LINES) {
        printLine(`  (capped at ${MAX_LINES} lines)`, 'line-info');
      }

      printBlank();
      for (let i = 0; i < lines; i++) {
        let row = '';
        for (let c = 0; c < WIDTH; c++) row += CHARS[Math.floor(Math.random() * CHARS.length)];
        printLine(row, 'line-out');
      }
      printBlank();
      triggerMission('run_noise').then(r => notifyMission(r));
    },
  },

  // ── matrix ────────────────────────────────────────────────────────
  matrix: {
    description: 'Display a Matrix-style falling-character rain animation (~3 s).',
    usage: 'matrix',
    run() {
      const COLS        = 46;
      const ROWS        = 16;
      const DURATION_MS = 3000;
      const TICK_MS     = 80;
      const CHARS = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';

      function rndChar() { return CHARS[Math.floor(Math.random() * CHARS.length)]; }

      const cols = Array.from({ length: COLS }, () => ({
        head  : -Math.floor(Math.random() * ROWS),
        speed : Math.random() < 0.5 ? 1 : 2,
        trail : Math.floor(Math.random() * 6) + 4,
        glyphs: Array.from({ length: ROWS }, rndChar),
      }));

      printLine('INITIALIZING MATRIX PROTOCOL…', 'line-ok');
      endBatch();

      const pre = document.createElement('pre');
      pre.className = 'banner-output';
      pre.style.cssText = 'margin:0.2em 0; line-height:1.25; font-size:inherit';
      outputEl.appendChild(pre);
      outputEl.scrollTop = outputEl.scrollHeight;

      function render() {
        const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));

        for (let c = 0; c < COLS; c++) {
          const { head, trail, glyphs } = cols[c];
          if (head >= 0 && head < ROWS) grid[head][c] = 'H';
          for (let t = 1; t <= trail; t++) {
            const r = head - t;
            if (r >= 0 && r < ROWS) grid[r][c] = t <= 2 ? 'N' : 'F';
          }
        }

        let html = '';
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const tag = grid[r][c];
            const ch  = cols[c].glyphs[r];
            if (!tag) {
              html += ' ';
            } else if (tag === 'H') {
              html += `<span style="color:var(--fg-bright);text-shadow:0 0 8px var(--glow)">${ch}</span>`;
            } else if (tag === 'N') {
              html += `<span style="color:var(--fg)">${ch}</span>`;
            } else {
              html += `<span style="color:var(--fg-dim)">${ch}</span>`;
            }
          }
          html += '\n';
        }
        pre.innerHTML = html;
        outputEl.scrollTop = outputEl.scrollHeight;
      }

      render();
      const startTime = Date.now();

      const iv = setInterval(() => {
        for (let c = 0; c < COLS; c++) {
          const col = cols[c];
          col.head += col.speed;
          if (Math.random() < 0.35) col.glyphs[Math.floor(Math.random() * ROWS)] = rndChar();
          if (col.head - col.trail > ROWS) {
            col.head  = -Math.floor(Math.random() * 4);
            col.speed = Math.random() < 0.5 ? 1 : 2;
            col.trail = Math.floor(Math.random() * 6) + 4;
            col.glyphs = Array.from({ length: ROWS }, rndChar);
          }
        }
        render();
        if (Date.now() - startTime >= DURATION_MS) {
          clearInterval(iv);
          pre.remove();
          printLine('MATRIX PROTOCOL TERMINATED.', 'line-ok');
          printBlank();
          awardAchievement('matrix_run').then(r => notifyAchievement(r));
          triggerMission('run_matrix').then(r => notifyMission(r));
        }
      }, TICK_MS);

      return new Promise(resolve => { setTimeout(resolve, DURATION_MS + TICK_MS * 2); });
    },
  },

  // ── hack ──────────────────────────────────────────────────────────
  hack: {
    description: 'Run a fake multi-stage intrusion sequence for fun.',
    usage: 'hack',
    run() {
      const BAR_WIDTH = 20;
      const TICK_MS   = 55;

      const STAGES = [
        { label: 'LOCATING TARGET',       color: 'var(--fg-dim)',    ms: 600  },
        { label: 'BYPASSING FIREWALL',    color: 'var(--fg)',        ms: 900  },
        { label: 'CRACKING ENCRYPTION',   color: 'var(--fg)',        ms: 1100 },
        { label: 'ESCALATING PRIVILEGES', color: 'var(--fg-bright)', ms: 800  },
        { label: 'INJECTING PAYLOAD',     color: 'var(--fg-bright)', ms: 1000 },
        { label: 'COVERING TRACKS',       color: 'var(--fg-dim)',    ms: 650  },
      ];

      const PAD   = Math.max(...STAGES.map(s => s.label.length));
      const fills = new Array(STAGES.length).fill(0);

      printLine('INITIATING BREACH SEQUENCE…', 'line-head');
      endBatch();

      const pre = document.createElement('pre');
      pre.className = 'banner-output';
      pre.style.cssText = 'margin:0.4em 0; line-height:1.6; font-size:inherit';
      outputEl.appendChild(pre);
      outputEl.scrollTop = outputEl.scrollHeight;

      let activeStage = 0;

      function renderFrame() {
        let html = '';
        STAGES.forEach((stage, i) => {
          const pct   = Math.round((fills[i] / BAR_WIDTH) * 100);
          const done  = fills[i] >= BAR_WIDTH;
          const bar   = '█'.repeat(fills[i]) + '░'.repeat(BAR_WIDTH - fills[i]);
          const label = stage.label.padEnd(PAD, ' ');

          let barColor, labelColor, suffix;
          if (done) {
            barColor = labelColor = 'var(--fg-bright)';
            suffix   = '  <span style="color:var(--fg-bright)">✓ DONE</span>';
          } else if (i === activeStage) {
            barColor = labelColor = stage.color;
            suffix   = '';
          } else {
            barColor = labelColor = 'var(--fg-dim)';
            suffix   = '';
          }

          html += `<span style="color:${labelColor}">${label}</span>  ` +
                  `<span style="color:var(--fg-dim)">[</span>` +
                  `<span style="color:${barColor}">${bar}</span>` +
                  `<span style="color:var(--fg-dim)">]</span>` +
                  `  <span style="color:${labelColor}">${String(pct).padStart(3)}%</span>` +
                  suffix + '\n';
        });
        pre.innerHTML = html;
        outputEl.scrollTop = outputEl.scrollHeight;
      }

      renderFrame();

      return new Promise(resolve => {
        const stepsNeeded = () => Math.max(1, Math.ceil(STAGES[activeStage].ms / TICK_MS));

        const iv = setInterval(() => {
          if (activeStage >= STAGES.length) {
            clearInterval(iv);
            pre.remove();

            const grantedLines = [
              '╔═══════════════════════════════════════════════╗',
              '║                                               ║',
              '║    ░░░  A C C E S S   G R A N T E D  ░░░      ║',
              '║                                               ║',
              '╚═══════════════════════════════════════════════╝',
            ];
            const out = document.createElement('pre');
            out.className = 'banner-output';
            out.style.cssText =
              'margin:0.6em 0; color:var(--fg-bright); ' +
              'text-shadow:0 0 12px var(--glow); font-size:inherit';
            out.textContent = grantedLines.join('\n');
            outputEl.appendChild(out);
            outputEl.scrollTop = outputEl.scrollHeight;
            awardAchievement('hack_complete').then(r => notifyAchievement(r));
            triggerMission('run_hack').then(r => notifyMission(r));
            resolve();
            return;
          }

          const needed = stepsNeeded();
          const step   = BAR_WIDTH / needed;
          fills[activeStage] = Math.min(BAR_WIDTH, fills[activeStage] + step);
          if (fills[activeStage] >= BAR_WIDTH) { fills[activeStage] = BAR_WIDTH; activeStage++; }
          renderFrame();
        }, TICK_MS);
      });
    },
  },

  // ── countdown ─────────────────────────────────────────────────────
  countdown: {
    description: 'Start a countdown timer for N minutes (default 5).  countdown stop  cancels.',
    usage: 'countdown [N | stop]',
    run(args) {
      const timeEl = document.getElementById('status-time');

      function pad2(n) { return String(n).padStart(2, '0'); }
      function fmtMMSS(secs) { return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`; }

      function stopCountdown() {
        if (_countdownInterval !== null) {
          clearCountdownIntervalState();
        }
        timeEl.classList.remove('countdown-active');
        tickClock();
        clearClockInterval();
        setClockInterval(setInterval(tickClock, 1_000));
      }

      // ── countdown stop ──
      if (args[0] && args[0].toLowerCase() === 'stop') {
        if (_countdownInterval === null) {
          printLine('No countdown is running.', 'line-info');
        } else {
          stopCountdown();
          printLine('Countdown cancelled.', 'line-info');
        }
        return;
      }

      // ── parse N ──
      let totalSeconds;
      if (args.length === 0) {
        totalSeconds = 5 * 60;
      } else {
        const n = parseFloat(args[0]);
        if (!isFinite(n) || n <= 0 || n > 1440) {
          printLine('Usage:   countdown [N]       — N = minutes (0 < N ≤ 1440)', 'line-info');
          printLine('         countdown stop      — cancel a running timer', 'line-info');
          return;
        }
        totalSeconds = Math.max(1, Math.round(n * 60));
      }

      // Cancel any existing countdown
      if (_countdownInterval !== null) clearCountdownIntervalState();

      // Pause the wall clock
      clearClockInterval();

      let remaining = totalSeconds;

      function tick() {
        timeEl.textContent = `⏱ ${fmtMMSS(remaining)}`;
        timeEl.classList.add('countdown-active');

        if (remaining === 0) {
          clearCountdownIntervalState();
          timeEl.classList.remove('countdown-active');

          const termEl = document.getElementById('terminal');
          termEl.classList.remove('countdown-alert');
          void termEl.offsetWidth;
          termEl.classList.add('countdown-alert');
          termEl.addEventListener('animationend', () => {
            termEl.classList.remove('countdown-alert');
          }, { once: true });

          stopCountdown();
          printLine('⏱  COUNTDOWN REACHED ZERO!', 'line-err');
          awardAchievement('countdown_complete').then(r => notifyAchievement(r));
          triggerMission('run_countdown').then(r => notifyMission(r));
          return;
        }

        remaining--;
      }

      tick();
      setCountdownInterval(setInterval(tick, 1_000));

      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      const label = s === 0 ? `${m} min${m !== 1 ? 's' : ''}` : fmtMMSS(totalSeconds);
      printLine(`Countdown started: ${label}.  Type  countdown stop  to cancel.`, 'line-ok');
    },
  },

  // ── maze ──────────────────────────────────────────────────────────
  maze: {
    description: 'Generate a solvable ASCII maze (recursive backtracking).',
    usage: 'maze [cols] [rows]',
    run(args) {
      const MAX_COLS = 14, MAX_ROWS = 14;

      let cols = Math.max(3, Math.min(parseInt(args[0], 10) || MAX_COLS, MAX_COLS));
      let rows = Math.max(3, Math.min(parseInt(args[1], 10) || 8,         MAX_ROWS));

      const grid = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ n: true, s: true, e: true, w: true }))
      );
      const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

      const DIRS = [
        { dr: -1, dc:  0, wall: 'n', opp: 's' },
        { dr:  1, dc:  0, wall: 's', opp: 'n' },
        { dr:  0, dc:  1, wall: 'e', opp: 'w' },
        { dr:  0, dc: -1, wall: 'w', opp: 'e' },
      ];

      function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }

      const stack = [{ r: 0, c: 0 }];
      visited[0][0] = true;

      while (stack.length) {
        const { r, c } = stack[stack.length - 1];
        const neighbors = shuffle(
          DIRS
            .map(({ dr, dc, wall, opp }) => ({ nr: r + dr, nc: c + dc, wall, opp }))
            .filter(({ nr, nc }) => nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc])
        );
        if (neighbors.length === 0) {
          stack.pop();
        } else {
          const { nr, nc, wall, opp } = neighbors[0];
          grid[r][c][wall]  = false;
          grid[nr][nc][opp] = false;
          visited[nr][nc]   = true;
          stack.push({ r: nr, c: nc });
        }
      }

      grid[0][0].n               = false;
      grid[rows - 1][cols - 1].s = false;

      printBlank();
      for (let r = 0; r < rows; r++) {
        let hRow = '';
        for (let c = 0; c < cols; c++) { hRow += '+'; hRow += grid[r][c].n ? '---' : '   '; }
        hRow += '+';
        printLine(hRow, 'line-out');

        let vRow = '';
        for (let c = 0; c < cols; c++) { vRow += grid[r][c].w ? '|' : ' '; vRow += '   '; }
        vRow += grid[r][cols - 1].e ? '|' : ' ';
        printLine(vRow, 'line-out');
      }

      let botRow = '';
      for (let c = 0; c < cols; c++) { botRow += '+'; botRow += grid[rows - 1][c].s ? '---' : '   '; }
      botRow += '+';
      printLine(botRow, 'line-out');

      printBlank();
      printLine(`  ${cols}x${rows} maze  |  enter: top-left  |  exit: bottom-right`, 'line-info');
      printBlank();

      // Achievement — fire-and-forget (idempotent after first generation).
      awardAchievement('maze_generated').then(r => notifyAchievement(r));
      triggerMission('run_maze').then(r => notifyMission(r));
    },
  },

};
