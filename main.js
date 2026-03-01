// ── main.js ───────────────────────────────────────────────────────────────────
// Entry point: event wiring, init(), Konami easter egg.

import {
  inputEl, cursorEl, outputEl,
  syncDisplay, setInput, updateScrollHint,
  printLine, printBlank, printRule,
  beginBatch, endBatch,
  fitBanner, updateBannerMetrics,
  clearScreen,
} from './core/render.js';

import {
  cmdHistory, setCmdHistory,
  historyIndex, updateHistoryIndex,
  pendingInput, setPendingInput,
  _pendingConfirm, clearPendingConfirm,
  _activeGame,
  clockInterval, setClockInterval, clearClockInterval,
  _countdownInterval,
  setSessionStart,
} from './core/state.js';

import { CONFIG, DEFAULT_PREFS }      from './core/config.js';
import { migrateLocalToSync, migrateDialsToV1,
         loadPrefs,
         savePrefs }                  from './core/storage.js';
import {
  getCachedPrefs, applyPrefs,
  openSettingsPanel, closeSettingsPanel, settingsPanelEl,
} from './ui/settings.js';
import { renderDials,
         ctxMenuEl, hideDialCtxMenu,
         openCurrentTabDial,
         openDialOverlay, closeDialOverlay, isDialOverlayOpen,
         updateDialOverlayTop } from './ui/dials.js';
import { tickClock }                  from './core/clock.js';
import { commands, dispatch }         from './commands/index.js';
import { printBootSequence }          from './commands/system.js';
import { awardAchievement }           from './core/progression.js';
import { notifyAchievement }          from './commands/profile.js';

// ============================================================
//  init
// ============================================================

async function init() {
  setSessionStart(Date.now());

  // Migrate flat dials → versioned dialStore (no-op after first run)
  await migrateDialsToV1();

  // Migrate local → sync (no-op after first run)
  await migrateLocalToSync();

  // Parallel: load prefs, render dials, restore cmd history
  const [prefs,, histResult] = await Promise.all([
    loadPrefs(),
    renderDials(),
    chrome.storage.local.get({ cmdHistory: [] }),
  ]);

  if (prefs.historyPersist !== false) {
    setCmdHistory(histResult.cmdHistory);
  }

  // Bump session counter
  prefs.sessionCount = (prefs.sessionCount || 0) + 1;
  await savePrefs(prefs);

  // Check session-milestone achievements.
  // awardAchievement is idempotent so these are safe to call every boot;
  // they only fire (store + notify) once, the first time the threshold is met.
  const _sessionMilestones = [];
  if (prefs.sessionCount >= 10)  _sessionMilestones.push(awardAchievement('ten_sessions'));
  if (prefs.sessionCount >= 50)  _sessionMilestones.push(awardAchievement('fifty_sessions'));

  await applyPrefs(prefs);
  updateDialOverlayTop();

  // Re-fit banner on window resize (debounced)
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const el = document.getElementById('ascii-art');
      if (el) fitBanner(el);
      updateBannerMetrics();
      updateDialOverlayTop();
    }, 120);
  });

  // Start clock
  tickClock();
  setClockInterval(setInterval(tickClock, 1_000));

  // Boot sequence
  await printBootSequence();

  // Flush any newly-earned session-milestone achievement toasts.
  // These are resolved here (after boot output) so the toasts appear at the
  // end of the startup text rather than interrupting it.
  if (_sessionMilestones.length > 0) {
    const results = await Promise.all(_sessionMilestones);
    for (const r of results) notifyAchievement(r);
  }

  // Open dial overlay on load if configured
  if (prefs.dialOpenOnLoad) openDialOverlay();

  // Check for pending "add current tab" dial (queued by the background SW
  // when the user pressed Ctrl+Shift+D on another tab).
  const { _pendingTabDial } = await chrome.storage.local.get('_pendingTabDial');
  if (_pendingTabDial) {
    await chrome.storage.local.remove('_pendingTabDial');
    openCurrentTabDial(_pendingTabDial);
  }

  inputEl.focus();
}

// ============================================================
//  Event wiring
// ============================================================

// Scroll hint — clicking the hint scrolls to the bottom
outputEl.addEventListener('scroll', updateScrollHint);
document.getElementById('scroll-more')?.addEventListener('click', () => {
  outputEl.scrollTo({ top: outputEl.scrollHeight, behavior: 'smooth' });
});

// Keep visible display in sync with hidden input
inputEl.addEventListener('input', () => {
  updateHistoryIndex(-1);
  syncDisplay();
});

inputEl.addEventListener('keydown', e => {
  // Active game intercept: route ALL keys to the game handler while a
  // real-time game (e.g. Chase Maze) is running.  Prevents default so
  // arrow keys don't scroll and typed chars don't enter the input field.
  if (_activeGame) {
    e.preventDefault();
    _activeGame.onKey(e);
    return;
  }

  switch (e.key) {

    case 'Enter': {
      e.preventDefault();
      const val = inputEl.value;

      // Confirm-awaiting command intercept
      if (_pendingConfirm) {
        const resolve = _pendingConfirm;
        clearPendingConfirm();
        setInput('');
        resolve(val);
        break;
      }

      // Push into history
      if (val.trim() !== '') {
        const updated = [val, ...cmdHistory];
        if (updated.length > CONFIG.HISTORY_MAX) updated.pop();
        setCmdHistory(updated);
        if (getCachedPrefs()?.historyPersist !== false) {
          chrome.storage.local.set({ cmdHistory: updated });
        }
      }

      updateHistoryIndex(-1);
      setPendingInput('');
      setInput('');
      dispatch(val);
      break;
    }

    case 'ArrowUp': {
      e.preventDefault();
      if (cmdHistory.length === 0) break;
      if (historyIndex === -1) setPendingInput(inputEl.value);
      const nextIdx = Math.min(historyIndex + 1, cmdHistory.length - 1);
      updateHistoryIndex(nextIdx);
      setInput(cmdHistory[nextIdx]);
      break;
    }

    case 'ArrowDown': {
      e.preventDefault();
      if (historyIndex === -1) break;
      const prevIdx = historyIndex - 1;
      updateHistoryIndex(prevIdx);
      setInput(prevIdx === -1 ? pendingInput : cmdHistory[prevIdx]);
      break;
    }

    case 'Tab': {
      e.preventDefault();
      const raw   = inputEl.value;
      const parts = raw.trimStart().split(/\s+/);
      if (raw === '') {
        // Empty input: Tab opens the speed-dial overlay
        openDialOverlay();
        break;
      }
      if (parts.length === 1 && !raw.endsWith(' ')) {
        const prefix = parts[0];
        if (prefix !== '') {
          const keys    = Object.keys(commands);
          const matches = keys.filter(k => k.startsWith(prefix));
          if (matches.length === 1) {
            setInput(matches[0] + ' ');
            updateHistoryIndex(-1);
          } else if (matches.length > 1) {
            // Complete to longest common prefix first, then list matches
            let common = matches[0];
            for (let i = 1; i < matches.length; i++) {
              while (!matches[i].startsWith(common)) {
                common = common.slice(0, -1);
              }
            }
            if (common.length > prefix.length) {
              setInput(common);
              updateHistoryIndex(-1);
            } else {
              printBlank();
              printLine('  ' + matches.join('   '), 'line-info');
            }
          }
        }
      }
      break;
    }

    case 'l':
    case 'L': {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        clearScreen();
        setInput('');
        updateHistoryIndex(-1);
        setPendingInput('');
      }
      break;
    }

    case 'Escape': {
      // Clear current input (or cancel pending confirm)
      if (_pendingConfirm) break;  // let the confirm system handle it
      if (inputEl.value !== '') {
        e.preventDefault();
        setInput('');
        updateHistoryIndex(-1);
        setPendingInput('');
      }
      break;
    }

    default:
      break;
  }
});

// ── Global keyboard shortcuts (settings toggle, dial overlay, etc.) ──────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    if (settingsPanelEl.classList.contains('visible')) {
      closeSettingsPanel();
    } else {
      openSettingsPanel();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    isDialOverlayOpen() ? closeDialOverlay() : openDialOverlay();
    return;
  }
});

// ── Context-menu keyboard navigation ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!ctxMenuEl.classList.contains('visible')) return;
  if (e.key === 'Escape') { e.preventDefault(); hideDialCtxMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...ctxMenuEl.querySelectorAll('.ctx-menu-item')]
      .filter(btn => btn.style.display !== 'none');
    if (!items.length) return;
    const idx  = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? items[(idx + 1) % items.length]
      : items[(idx - 1 + items.length) % items.length];
    next.focus();
  }
});

// ── [DIALS] trigger button ────────────────────────────────────────────────────
document.getElementById('dial-overlay-open')?.addEventListener('click', () => {
  isDialOverlayOpen() ? closeDialOverlay() : openDialOverlay();
});

// ── Dismiss context menu / overlay on click outside ───────────────────────────
document.addEventListener('click', e => {
  if (!e.target.closest('#dial-ctx-menu')) hideDialCtxMenu();
  // Close dial overlay when clicking outside of it (but not the open trigger)
  if (isDialOverlayOpen() && !e.target.closest('#speed-dial-wrap, #dial-overlay-open')) {
    closeDialOverlay();
    return;
  }
  if (!e.target.closest('#dial-ctx-menu, #dial-side-sheet, #settings-panel, #speed-dial-wrap, .dial-composer, #dial-move-picker, .dial-toolbar-search')) {
    // Don't steal focus when user is selecting text in the output area
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    inputEl.focus();
  }
});
document.addEventListener('contextmenu', e => {
  if (!e.target.closest('.dial-tile')) hideDialCtxMenu();
});

// ── Pause cursor & clock when tab is backgrounded ────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cursorEl.style.animationPlayState = 'paused';
    clearClockInterval();
  } else {
    cursorEl.style.animationPlayState = 'running';
    inputEl.focus();
    if (_countdownInterval === null) {
      tickClock();
      setClockInterval(setInterval(tickClock, 1_000));
    }
  }
});

// ── Sync change listener ──────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.dials) renderDials();
  if (changes.prefs) {
    const newPrefs = { ...DEFAULT_PREFS, ...(changes.prefs.newValue || {}) };
    applyPrefs(newPrefs);
  }
});

// ============================================================
//  Konami Code Easter Egg  ↑↑↓↓←→←→BA
// ============================================================
(function () {
  const SEQUENCE = [
    'ArrowUp', 'ArrowUp',
    'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight',
    'ArrowLeft', 'ArrowRight',
    'b', 'a',
  ];
  let pos = 0, triggered = false;

  document.addEventListener('keydown', (e) => {
    if (triggered) return;
    if (e.key === SEQUENCE[pos]) {
      pos++;
      if (pos === SEQUENCE.length) { triggered = true; _showKonamiMessage(); }
    } else {
      pos = (e.key === SEQUENCE[0]) ? 1 : 0;
    }
  });

  function _showKonamiMessage() {
    beginBatch();
    printRule('▄');
    printLine('', 'line-sep');
    printLine('  ██  ░░░  B B S   U N D E R G R O U N D   ░░░  ██', 'line-head');
    printLine('  ██       S E C R E T   S E C T O R              ██', 'line-head');
    printLine('', 'line-sep');
    printRule('─');
    printLine('  KONAMI ACCESS CODE ACCEPTED.', 'line-ok');
    printLine('  ELITE CLEARANCE GRANTED — NODE: 31337', 'line-ok');
    printRule('─');
    printBlank();
    printLine('  WELCOME BACK, TRAVELLER OF THE DIGITAL UNDERGROUND.', 'line-out');
    printBlank();
    printLine('  HANDLE ............: UNKNOWN OPERATOR', 'line-info');
    printLine('  SYSOP ..............: UNREACHABLE / OFFLINE', 'line-info');
    printLine('  ELITENESS ..........:', 'line-info');
    printLine('    [████████████████████]  L V L  M A X', 'line-head');
    printBlank();
    printLine('  > "In cyberspace, no one can hear you type..."', 'line-info');
    printBlank();
    printLine('  +10 ELITE POINTS AWARDED.  THIS INCIDENT HAS BEEN', 'line-out');
    printLine('  LOGGED.   (Just kidding.  Or have we?)', 'line-out');
    printBlank();
    printRule('▀');
    endBatch();
  }
}());

// ============================================================
//  Boot
// ============================================================
init();
