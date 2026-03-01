// ── commands/games.js ─────────────────────────────────────────────────────────
// Door Games layer: hub command, Hangman, Bulls & Cows, Chase Maze.
//
// Every game is keyboard-only, exitable cleanly, and records scores.
// Line-input games (Hangman, Bulls & Cows) use the _pendingConfirm loop.
// Real-time games (Chase Maze) use the _activeGame key-capture hook.

import {
  printLine, printBlank, printRule, outputEl, endBatch,
} from '../core/render.js';
import { setPendingConfirm, setActiveGame, clearActiveGame } from '../core/state.js';
import { loadGameScores, saveGameScore }                     from '../core/storage.js';
import { awardAchievement, loadProfile }                     from '../core/progression.js';
import { notifyAchievement }                                 from './profile.js';
import { playSoundIfEnabled }                                from '../core/sounds.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show the prompt `msg`, flush the current batch so it's visible, then wait
 * for the user to type a line and press Enter via the _pendingConfirm hook.
 * The typed value is echoed back as a cmd-line before being returned.
 *
 * @param {string} msg
 * @returns {Promise<string>}
 */
function askLine(msg) {
  printLine(msg, 'line-info');
  endBatch();   // flush everything rendered so far to the screen
  return new Promise(resolve => {
    setPendingConfirm(val => {
      // Echo what the player typed (mirrors normal dispatch echo)
      if (val.trim() !== '') printLine(`  > ${val}`, 'line-cmd');
      resolve(val);
    });
  });
}

/** @returns {string} YYYY-MM-DD */
function fmtDate(d) { return d.toISOString().slice(0, 10); }

// ─────────────────────────────────────────────────────────────────────────────
//  High-score display (shared)
// ─────────────────────────────────────────────────────────────────────────────

async function printHighScores(game, label) {
  const scores = await loadGameScores();
  const board  = (scores[game] || []);
  printLine(`  ── ${label} TOP SCORES ──────────────────────────────`, 'line-head');
  if (board.length === 0) {
    printLine('  (no scores yet — be the first!)', 'line-info');
  } else {
    board.forEach((e, i) => {
      const rank   = String(i + 1).padStart(2);
      const pts    = String(e.score).padStart(5);
      const handle = (e.handle || '???').padEnd(18);
      printLine(
        `  ${rank}.  ${pts} pts  ${handle}  ${e.date}`,
        i === 0 ? 'line-ok' : 'line-out',
      );
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Door Games achievement tracker
// ─────────────────────────────────────────────────────────────────────────────

async function _checkDoorGamesAch() {
  const scores = await loadGameScores();
  const total  =
    (scores.hangman   || []).length +
    (scores.bullscows || []).length +
    (scores.chasemaze || []).length;
  if (total >= 5) {
    const ach = await awardAchievement('doorgames_played');
    notifyAchievement(ach);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HANGMAN
// ─────────────────────────────────────────────────────────────────────────────

const HANGMAN_WORDS = [
  'algorithm', 'bandwidth', 'compiler', 'daemon', 'encrypt',
  'firewall', 'gateway', 'heuristic', 'interface', 'kernel',
  'latency', 'malloc', 'namespace', 'overflow', 'packet',
  'queue', 'recursion', 'socket', 'terminal', 'unicode',
  'vector', 'webhook', 'exploit', 'payload', 'rootkit',
  'botnet', 'checksum', 'deadlock', 'emulator', 'firmware',
  'hexadecimal', 'interrupt', 'jitter', 'keylogger', 'loopback',
  'mutex', 'netmask', 'opcode', 'pipeline', 'protocol',
  'register', 'semaphore', 'thread', 'uptime', 'variable',
  'watchdog', 'phishing', 'injection', 'sandbox', 'bytecode',
];

// 7 frames, indexed by wrong-guess count (0 = fresh gallows, 6 = dead).
const GALLOWS = [
  [ '  _____', '  |   |', '      |', '      |', '      |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', '      |', '      |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', '  |   |', '      |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', ' /|   |', '      |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', ' /|\\  |', '      |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', ' /|\\  |', ' /    |', '      |', '=========' ],
  [ '  _____', '  |   |', '  O   |', ' /|\\  |', ' / \\  |', '      |', '=========' ],
];

const HANGMAN_MAX_WRONG = 6;

function _printHangmanBoard(word, guessed, wrong) {
  const gallows   = GALLOWS[wrong];
  const wordDisp  = word.split('').map(ch => guessed.has(ch) ? ch : '_').join(' ');
  const guessDisp = [...guessed].sort().join(' ') || '—';
  const remaining = HANGMAN_MAX_WRONG - wrong;

  printBlank();
  gallows.forEach(l => printLine('  ' + l, 'line-out'));
  printBlank();
  printLine(`  WORD:     ${wordDisp}`, 'line-head');
  printLine(`  GUESSED:  ${guessDisp}`, 'line-info');
  printLine(
    `  WRONG:    ${wrong} / ${HANGMAN_MAX_WRONG}  (${remaining} remaining)`,
    wrong >= 4 ? 'line-err' : 'line-out',
  );
  printBlank();
}

async function runHangman() {
  const word    = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
  const guessed = new Set();
  let   wrong   = 0;
  let   won     = false;

  printBlank();
  printRule('═');
  printLine('  ░▒▓  HANGMAN  ▓▒░', 'line-head');
  printLine('  Guess the hidden tech word, one letter at a time.', 'line-info');
  printLine(`  You have ${HANGMAN_MAX_WRONG} wrong guesses before the operator is hanged.`, 'line-info');
  printLine('  Type  EXIT  at any prompt to quit.', 'line-info');
  printRule('═');
  _printHangmanBoard(word, guessed, wrong);

  while (wrong < HANGMAN_MAX_WRONG) {
    const raw = (await askLine('  Guess a letter ▶')).trim().toLowerCase();

    // Quit
    if (raw === 'exit' || raw === 'quit' || raw === 'q') {
      printLine(`  Abandoned.  The word was: ${word.toUpperCase()}`, 'line-info');
      printBlank();
      return;
    }

    // Validation
    if (!/^[a-z]$/.test(raw)) {
      printLine('  Please enter a single letter (a–z).', 'line-err');
      _printHangmanBoard(word, guessed, wrong);
      continue;
    }
    if (guessed.has(raw)) {
      printLine(`  You already guessed "${raw}" — try another letter.`, 'line-err');
      _printHangmanBoard(word, guessed, wrong);
      continue;
    }

    guessed.add(raw);

    if (!word.includes(raw)) {
      wrong++;
      printLine(`  ✗  "${raw.toUpperCase()}" is not in the word.`, 'line-err');
    } else {
      const count = word.split('').filter(ch => ch === raw).length;
      printLine(
        `  ✓  "${raw.toUpperCase()}" found! (${count} occurrence${count > 1 ? 's' : ''})`,
        'line-ok',
      );
    }

    _printHangmanBoard(word, guessed, wrong);

    if (word.split('').every(ch => guessed.has(ch))) {
      won = true;
      break;
    }
  }

  if (won) {
    const score   = word.length * 20 + (HANGMAN_MAX_WRONG - wrong) * 15;
    const profile = await loadProfile();

    printLine('  ╔══════════════════════════════════╗', 'line-ok');
    printLine('  ║  ★  YOU WIN!                    ║', 'line-ok');
    playSoundIfEnabled('reward');
    printLine(`  ║  Word:   ${word.toUpperCase().padEnd(24)} ║`, 'line-ok');
    printLine(`  ║  Wrong:  ${String(wrong).padEnd(24)} ║`, 'line-ok');
    printLine(`  ║  Score:  ${String(score).padEnd(24)} ║`, 'line-ok');
    printLine('  ╚══════════════════════════════════╝', 'line-ok');
    printBlank();

    await saveGameScore('hangman', {
      score, word, wrong,
      date: fmtDate(new Date()),
      handle: profile.handle,
    });
    await printHighScores('hangman', 'HANGMAN');
    printBlank();

    const ach = await awardAchievement('hangman_win');
    notifyAchievement(ach);
    await _checkDoorGamesAch();

  } else {
    printLine(`  ✗  HANGED.  The word was: ${word.toUpperCase()}`, 'line-err');
    playSoundIfEnabled('fail');
    printBlank();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BULLS & COWS
// ─────────────────────────────────────────────────────────────────────────────

function _generateSecret() {
  // Fisher-Yates on 0-9, take first 4 (guarantees no-repeat digits)
  const d = '0123456789'.split('');
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 4).join('');
}

function _scoreBullsCows(secret, guess) {
  let bulls = 0, cows = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i])         bulls++;
    else if (secret.includes(guess[i])) cows++;
  }
  return { bulls, cows };
}

async function runBullsCows() {
  const secret     = _generateSecret();
  const MAX_GUESS  = 10;
  let   guessNum   = 0;
  let   solved     = false;

  printBlank();
  printRule('═');
  printLine('  ░▒▓  BULLS & COWS  ▓▒░', 'line-head');
  printLine('  Crack the secret 4-digit number (no repeating digits).', 'line-info');
  printLine('  Bull = right digit, right position.', 'line-info');
  printLine('  Cow  = right digit, wrong position.', 'line-info');
  printLine(`  You have ${MAX_GUESS} guesses.  Type  EXIT  to quit.`, 'line-info');
  printRule('═');
  printBlank();

  while (guessNum < MAX_GUESS) {
    const remaining = MAX_GUESS - guessNum;
    const raw = (await askLine(
      `  Guess ${guessNum + 1} / ${MAX_GUESS}  (${remaining} left) ▶`,
    )).trim();

    if (raw.toLowerCase() === 'exit' || raw.toLowerCase() === 'quit') {
      printLine(`  Abandoned.  The number was: ${secret}`, 'line-info');
      printBlank();
      return;
    }

    if (!/^\d{4}$/.test(raw) || new Set(raw).size !== 4) {
      printLine('  Enter a 4-digit number with no repeating digits (e.g. 3057).', 'line-err');
      continue;
    }

    const { bulls, cows } = _scoreBullsCows(secret, raw);
    guessNum++;

    const bullStr = `${bulls}B`;
    const cowStr  = `${cows}C`;
    const verdict = bulls === 4 ? '  ★  CRACKED' : ` ${bullStr} ${cowStr}`;
    printLine(
      `  [${raw}]  ${verdict}`,
      bulls === 4 ? 'line-ok' : bulls + cows > 0 ? 'line-info' : 'line-out',
    );

    if (bulls === 4) {
      solved = true;
      break;
    }
    printBlank();
  }

  if (solved) {
    const score   = Math.max(100, 1000 - (guessNum - 1) * 100);
    const profile = await loadProfile();

    printBlank();
    printLine('  ╔══════════════════════════════════╗', 'line-ok');
    printLine('  ║  ★  CODE CRACKED!               ║', 'line-ok');
    playSoundIfEnabled('reward');
    printLine(`  ║  Number: ${secret.padEnd(25)} ║`, 'line-ok');
    printLine(`  ║  Guesses: ${String(guessNum).padEnd(24)} ║`, 'line-ok');
    printLine(`  ║  Score:   ${String(score).padEnd(24)} ║`, 'line-ok');
    printLine('  ╚══════════════════════════════════╝', 'line-ok');
    printBlank();

    await saveGameScore('bullscows', {
      score, answer: secret, guesses: guessNum,
      date: fmtDate(new Date()),
      handle: profile.handle,
    });
    await printHighScores('bullscows', 'BULLS & COWS');
    printBlank();

    if (guessNum <= 3) {
      const ach1 = await awardAchievement('bullscows_perfect');
      notifyAchievement(ach1);
    }
    const ach2 = await awardAchievement('bullscows_solved');
    notifyAchievement(ach2);
    await _checkDoorGamesAch();

  } else {
    printLine(`  ✗  Out of guesses!  The number was: ${secret}`, 'line-err');
    printBlank();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CHASE MAZE
// ─────────────────────────────────────────────────────────────────────────────

const CMAZE_ROWS = 7;
const CMAZE_COLS = 9;

/** Recursive-backtracking maze generator — same algorithm as `maze` command. */
function _buildMaze(rows, cols) {
  const grid    = Array.from({ length: rows }, () =>
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
  return grid;
}

/**
 * Render the maze to a single string for placement in a <pre>.
 * Cell legend:  @ = player  M = ghost  $ = goal  (empty) = passage  + - | = walls
 */
function _renderChaseMaze(grid, rows, cols, pr, pc, gr, gc, steps) {
  const lines = [];
  for (let r = 0; r < rows; r++) {
    // Horizontal wall row
    let hRow = '';
    for (let c = 0; c < cols; c++) {
      hRow += '+';
      hRow += grid[r][c].n ? '───' : '   ';
    }
    lines.push(hRow + '+');

    // Cell content row
    let vRow = '';
    for (let c = 0; c < cols; c++) {
      vRow += grid[r][c].w ? '│' : ' ';
      if      (r === pr && c === pc)              vRow += ' @ ';
      else if (r === gr && c === gc)              vRow += ' M ';
      else if (r === rows - 1 && c === cols - 1)  vRow += ' $ ';
      else                                        vRow += '   ';
    }
    lines.push(vRow + (grid[r][cols - 1].e ? '│' : ' '));
  }

  // Bottom border
  let botRow = '';
  for (let c = 0; c < cols; c++) {
    botRow += '+';
    botRow += grid[rows - 1][c].s ? '───' : '   ';
  }
  lines.push(botRow + '+');
  lines.push('');
  lines.push(`  @ You  │  M Ghost  │  $ Goal  │  Steps: ${steps}`);
  lines.push('  Move: WASD / Arrow keys    Quit: Q');
  return lines.join('\n');
}

/** BFS ghost pathfinding — returns the first step toward target, or stays. */
function _ghostBfs(grid, rows, cols, gr, gc, tr, tc) {
  if (gr === tr && gc === tc) return { r: gr, c: gc };

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const DIRS    = [
    { dr: -1, dc: 0, wall: 'n' },
    { dr:  1, dc: 0, wall: 's' },
    { dr:  0, dc: 1, wall: 'e' },
    { dr:  0, dc: -1, wall: 'w' },
  ];

  const queue = [{ r: gr, c: gc, first: null }];
  visited[gr][gc] = true;

  while (queue.length) {
    const node = queue.shift();

    for (const { dr, dc, wall } of DIRS) {
      const nr = node.r + dr, nc = node.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (visited[nr][nc]) continue;
      if (grid[node.r][node.c][wall]) continue; // wall — impassable

      visited[nr][nc] = true;
      // Track the first step taken away from ghost's origin
      const first = node.first ?? { r: nr, c: nc };
      if (nr === tr && nc === tc) return first;
      queue.push({ r: nr, c: nc, first });
    }
  }
  return { r: gr, c: gc }; // no path found — stay put
}

const CMAZE_WALL = {
  ArrowUp: 'n', ArrowDown: 's', ArrowRight: 'e', ArrowLeft: 'w',
  w: 'n', s: 's', d: 'e', a: 'w',
  W: 'n', S: 's', D: 'e', A: 'w',
};
const CMAZE_DELTA = {
  n: { dr: -1, dc: 0 }, s: { dr: 1, dc: 0 },
  e: { dr: 0, dc: 1 },  w: { dr: 0, dc: -1 },
};

function runChaseMaze() {
  const ROWS = CMAZE_ROWS, COLS = CMAZE_COLS;
  const grid = _buildMaze(ROWS, COLS);

  let pr = 0, pc = 0;                              // player position
  let gr = Math.floor(ROWS / 2), gc = Math.floor(COLS / 2); // ghost starts in middle
  // Make sure ghost doesn't start on player or goal
  if (gr === 0 && gc === 0)           { gr = Math.floor(ROWS * 0.75); gc = Math.floor(COLS * 0.75); }
  if (gr === ROWS - 1 && gc === COLS - 1) { gr = 0; gc = Math.floor(COLS / 2); }

  let steps    = 0;
  let finished = false;

  // Render header lines into the current batch, then flush
  printBlank();
  printRule('═');
  printLine('  ░▒▓  CHASE MAZE  ▓▒░', 'line-head');
  printLine('  Navigate from top-left (@) to the goal ($).', 'line-info');
  printLine('  The ghost (M) hunts you through the passages.', 'line-info');
  printLine('  WASD / Arrow keys to move.  Q to quit.', 'line-info');
  printRule('═');
  printBlank();
  endBatch(); // flush header to screen before going interactive

  // Attach interactive <pre> element directly to outputEl
  const pre = document.createElement('pre');
  pre.className = 'banner-output';
  pre.style.cssText = 'margin:0.4em 0; line-height:1.35; font-size:inherit; white-space:pre';
  pre.textContent = _renderChaseMaze(grid, ROWS, COLS, pr, pc, gr, gc, steps);
  outputEl.appendChild(pre);
  outputEl.scrollTop = outputEl.scrollHeight;

  return new Promise(resolve => {

    /** Clean up game state, remove the pre, print an outcome message. */
    function finish(msg, cls) {
      if (finished) return;
      finished = true;
      clearActiveGame();
      pre.remove();

      // Write outcome directly to outputEl (no open batch at this point)
      function _pl(text, c = 'line-out') {
        const span = document.createElement('span');
        span.className = `line ${c}`;
        span.textContent = text;
        outputEl.appendChild(span);
      }
      _pl('');
      _pl(msg, cls);
      _pl('');
      outputEl.scrollTop = outputEl.scrollHeight;

      resolve();
    }

    setActiveGame({
      onKey(e) {
        if (finished) return;

        const key = e.key;

        // ── Quit
        if (key === 'q' || key === 'Q' || key === 'Escape') {
          finish('  Abandoned the maze.', 'line-info');
          return;
        }

        // ── Movement
        const wall = CMAZE_WALL[key];
        if (!wall) return;

        const { dr, dc } = CMAZE_DELTA[wall];
        const nr = pr + dr, nc = pc + dc;

        // Boundary or wall check
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
        if (grid[pr][pc][wall]) return; // impassable wall

        pr = nr; pc = nc;
        steps++;

        // Ghost moves every OTHER player step
        if (steps % 2 === 0) {
          const next = _ghostBfs(grid, ROWS, COLS, gr, gc, pr, pc);
          gr = next.r; gc = next.c;
        }

        // ── Caught?
        if (pr === gr && pc === gc) {
          pre.textContent = _renderChaseMaze(grid, ROWS, COLS, pr, pc, gr, gc, steps);
          playSoundIfEnabled('fail');
          finish('  ✗  CAUGHT by the ghost!  Game over.', 'line-err');
          return;
        }

        // ── Win?
        if (pr === ROWS - 1 && pc === COLS - 1) {
          const score = Math.max(50, 500 - steps * 5);
          pre.textContent = _renderChaseMaze(grid, ROWS, COLS, pr, pc, gr, gc, steps);
          playSoundIfEnabled('reward');
          finish(`  ★  ESCAPED!  Steps: ${steps}  ─  Score: ${score}`, 'line-ok');

          // Fire-and-forget async: save score + achievements (we're in a sync keydown)
          (async () => {
            const profile = await loadProfile();
            await saveGameScore('chasemaze', {
              score, steps,
              date:   fmtDate(new Date()),
              handle: profile.handle,
            });
            // Print high-score board directly (no open batch)
            const _scores = await loadGameScores();
            const board   = _scores.chasemaze || [];
            if (board.length > 0) {
              const out = document.createElement('div');
              out.className = 'cmd-output-block';
              function _pl2(text, c = 'line-out') {
                const span = document.createElement('span');
                span.className = `line ${c}`;
                span.textContent = text;
                out.appendChild(span);
              }
              _pl2('  ── CHASE MAZE TOP SCORES ─────────────────────────', 'line-head');
              board.forEach((e, i) => {
                _pl2(
                  `  ${String(i + 1).padStart(2)}.  ${String(e.score).padStart(5)} pts  ` +
                  `${(e.handle || '???').padEnd(18)}  ${e.date}`,
                  i === 0 ? 'line-ok' : 'line-out',
                );
              });
              outputEl.appendChild(out);
              outputEl.scrollTop = outputEl.scrollHeight;
            }

            const ach = await awardAchievement('chasemaze_escape');
            notifyAchievement(ach);
            await _checkDoorGamesAch();
          })();
          return;
        }

        // Normal move — redraw
        pre.textContent = _renderChaseMaze(grid, ROWS, COLS, pr, pc, gr, gc, steps);
        outputEl.scrollTop = outputEl.scrollHeight;
      },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Command exports
// ─────────────────────────────────────────────────────────────────────────────

export const gamesCommands = {

  // ── games hub ────────────────────────────────────────────────────────────
  games: {
    description: 'Door Games hub — list playable games and view all-time top scores.',
    usage: 'games',
    async run(_args) {
      printBlank();
      printRule('═');
      printLine('  ░▒▓  DOOR GAMES  ▓▒░', 'line-head');
      printLine('  BBS-era mini-games.  Keyboard only.  High scores persist.', 'line-info');
      printRule('─');
      printBlank();
      printLine('  hangman    ─  Guess the hidden tech word  (letter-by-letter)', 'line-out');
      printLine('  bullscows  ─  Crack the secret 4-digit code (Bulls & Cows)', 'line-out');
      printLine('  chasemaze  ─  Escape the maze before the ghost catches you', 'line-out');
      printBlank();
      printRule('─');
      await printHighScores('hangman',   'HANGMAN');
      printBlank();
      await printHighScores('bullscows', 'BULLS & COWS');
      printBlank();
      await printHighScores('chasemaze', 'CHASE MAZE');
      printBlank();
      printRule('═');
    },
  },

  // ── hangman ──────────────────────────────────────────────────────────────
  hangman: {
    description: 'Play Hangman — guess the hidden tech/hacker word one letter at a time.',
    usage: 'hangman',
    run(_args) { return runHangman(); },
  },

  // ── bullscows ────────────────────────────────────────────────────────────
  bullscows: {
    description: 'Play Bulls & Cows — crack the secret 4-digit number in ≤10 guesses.',
    usage: 'bullscows',
    run(_args) { return runBullsCows(); },
  },

  // ── chasemaze ────────────────────────────────────────────────────────────
  chasemaze: {
    description: 'Play Chase Maze — navigate the ASCII maze and reach $ before M catches you.',
    usage: 'chasemaze',
    run(_args) { return runChaseMaze(); },
  },
};
