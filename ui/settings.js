// ── ui/settings.js ───────────────────────────────────────────────────────────
// applyPrefs, settings panel UI, greeting helpers.

import { APP_TITLE, THEMES, FONT_SIZES, DEFAULT_PREFS } from '../core/config.js';
import { loadPrefs, savePrefs }                          from '../core/storage.js';
import { cmdHistory, setCmdHistory }                     from '../core/state.js';
import {
  fitBanner, updateBannerMetrics, renderHeaderBanner,
  setAsciiArt, printLine, inputEl,
} from '../core/render.js';

// ── Cached prefs (module-level) ───────────────────────────────────────────────
/** Current prefs — kept up-to-date by applyPrefs(). */
let _cachedPrefs = null;

/** Return the currently cached preferences object. */
export function getCachedPrefs() { return _cachedPrefs; }

// ── Greeting helpers ──────────────────────────────────────────────────────────

/** Returns a time-of-day greeting prefix based on the current hour. */
export function getGreetingPrefix() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'good morning';
  if (h >= 12 && h < 17) return 'good afternoon';
  if (h >= 17 && h < 21) return 'good evening';
  return 'good night';
}

/** Returns a numeric "bucket" (0-3) for the current greeting period. */
export function getGreetingBucket() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 0;
  if (h >= 12 && h < 17) return 1;
  if (h >= 17 && h < 21) return 2;
  return 3;
}

// ── applyPrefs ────────────────────────────────────────────────────────────────

/**
 * Apply a prefs object immediately — set CSS custom properties, update
 * the banner, toggle scanlines, etc.
 */
export async function applyPrefs(prefs) {
  _cachedPrefs = prefs;
  const root    = document.documentElement;
  const palette = THEMES[prefs.theme] || THEMES.amber;
  Object.entries(palette).forEach(([prop, val]) => root.style.setProperty(prop, val));

  const terminalSize = prefs.terminalSize || prefs.fontSize || DEFAULT_PREFS.terminalSize;
  const dialSize     = prefs.dialSize     || prefs.fontSize || DEFAULT_PREFS.dialSize;
  root.style.setProperty('--font-size',      FONT_SIZES[terminalSize] || FONT_SIZES.medium);
  root.style.setProperty('--dial-font-size', FONT_SIZES[dialSize]     || FONT_SIZES.medium);

  await updateBannerMetrics();

  const statusLabel = document.getElementById('status-label');
  if (statusLabel) statusLabel.textContent = APP_TITLE;

  const asciiArtEl = document.getElementById('ascii-art');
  if (asciiArtEl) {
    const bannerSource = prefs.bannerText
      ? prefs.bannerText
      : prefs.greetingMode
        ? (prefs.greetingName
            ? `${getGreetingPrefix()}, ${prefs.greetingName}`
            : getGreetingPrefix())
        : 'PHOSPHOR';
    try {
      const rendered = renderHeaderBanner(bannerSource);
      setAsciiArt(asciiArtEl, rendered.value, { asHtml: rendered.kind === 'html' });
      await fitBanner(asciiArtEl);
      await updateBannerMetrics();
    } catch {
      setAsciiArt(asciiArtEl, bannerSource, { asHtml: false });
    }
  }

  const scanlinesEl = document.getElementById('scanlines');
  if (scanlinesEl) scanlinesEl.style.display = prefs.scanlines === false ? 'none' : '';

  const _blinkSpeeds = { slow: '1.8s', normal: '1.1s', fast: '0.5s' };
  root.style.setProperty(
    '--cursor-blink-speed',
    _blinkSpeeds[prefs.cursorBlinkSpeed] || '1.1s'
  );

  if (prefs.historyPersist === false) {
    chrome.storage.local.remove('cmdHistory');
    setCmdHistory([]);
  }
}

// ── Settings panel ────────────────────────────────────────────────────────────

export const settingsPanelEl = (() => {
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'settings-panel-title');

  const inner = document.createElement('div');
  inner.className = 'settings-inner';
  inner.setAttribute('aria-label', 'Settings');

  const titleEl = document.createElement('div');
  titleEl.id = 'settings-panel-title';
  titleEl.className = 'settings-title';
  titleEl.textContent = '[ SETTINGS ]';

  function makeRow(labelText, control) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lbl = document.createElement('label');
    lbl.className = 'settings-label';
    lbl.textContent = labelText;
    lbl.htmlFor = control.id;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  }

  function makeSelect(id, pairs) {
    const sel = document.createElement('select');
    sel.id = id;
    sel.className = 'settings-select';
    pairs.forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      sel.appendChild(opt);
    });
    return sel;
  }

  const themeSelect = makeSelect('s-theme', [
    ['amber', 'AMBER'], ['green', 'GREEN'], ['blue', 'BLUE'], ['white', 'WHITE'],
  ]);
  const terminalSizeSelect = makeSelect('s-terminalsize', [
    ['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'],
  ]);
  const dialSizeSelect = makeSelect('s-dialsize', [
    ['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'],
  ]);

  const bannerInput = document.createElement('input');
  bannerInput.id           = 's-banner';
  bannerInput.className    = 'settings-input';
  bannerInput.type         = 'text';
  bannerInput.maxLength    = 24;
  bannerInput.autocomplete = 'off';
  bannerInput.spellcheck   = false;
  bannerInput.placeholder  = 'overrides greeting if set';

  const greetingSelect = makeSelect('s-greeting', [['off', 'OFF'], ['on', 'ON']]);

  const greetingNameInput = document.createElement('input');
  greetingNameInput.id           = 's-greetingname';
  greetingNameInput.className    = 'settings-input';
  greetingNameInput.type         = 'text';
  greetingNameInput.maxLength    = 32;
  greetingNameInput.autocomplete = 'off';
  greetingNameInput.spellcheck   = false;
  greetingNameInput.placeholder  = 'e.g. DANIEL';

  const scanSelect         = makeSelect('s-scanlines',     [['on', 'ON'], ['off', 'OFF']]);
  const clockFormatSelect  = makeSelect('s-clockformat',   [['auto', 'AUTO (LOCALE)'], ['12h', '12H'], ['24h', '24H']]);
  const tempUnitSelect     = makeSelect('s-tempunit',      [['auto', 'AUTO (LOCALE)'], ['c', 'CELSIUS (°C)'], ['f', 'FAHRENHEIT (°F)']]);
  const cursorSpeedSelect  = makeSelect('s-cursorspeed',   [['slow', 'SLOW'], ['normal', 'NORMAL'], ['fast', 'FAST']]);
  const historyPersistSel  = makeSelect('s-historypersist',[['on', 'ON'], ['off', 'OFF']]);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'settings-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'settings-btn';
  saveBtn.textContent = 'SAVE';
  saveBtn.addEventListener('click', e => { e.stopPropagation(); commitSettings(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'settings-btn';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); closeSettingsPanel(); });

  actionsEl.appendChild(saveBtn);
  actionsEl.appendChild(cancelBtn);

  inner.appendChild(titleEl);
  inner.appendChild(makeRow('THEME',            themeSelect));
  inner.appendChild(makeRow('TERMINAL SIZE',    terminalSizeSelect));
  inner.appendChild(makeRow('DIAL SIZE',        dialSizeSelect));
  inner.appendChild(makeRow('BANNER',           bannerInput));
  inner.appendChild(makeRow('GREETING',         greetingSelect));
  inner.appendChild(makeRow('NAME',             greetingNameInput));
  inner.appendChild(makeRow('SCANLINES',        scanSelect));
  inner.appendChild(makeRow('CLOCK FORMAT',     clockFormatSelect));
  inner.appendChild(makeRow('TEMPERATURE UNIT', tempUnitSelect));
  inner.appendChild(makeRow('CURSOR SPEED',     cursorSpeedSelect));
  inner.appendChild(makeRow('HISTORY PERSIST',  historyPersistSel));
  inner.appendChild(actionsEl);

  inner.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSettingsPanel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault(); commitSettings();
    }
  });
  panel.addEventListener('click', e => {
    if (e.target === panel) { e.stopPropagation(); closeSettingsPanel(); }
  });

  panel.appendChild(inner);
  document.body.appendChild(panel);
  return panel;
})();

export async function openSettingsPanel() {
  const prefs = await loadPrefs();
  document.getElementById('s-theme').value         = prefs.theme || 'amber';
  document.getElementById('s-terminalsize').value  = prefs.terminalSize || prefs.fontSize || 'medium';
  document.getElementById('s-dialsize').value      = prefs.dialSize     || prefs.fontSize || 'medium';
  document.getElementById('s-banner').value        = prefs.bannerText   || '';
  document.getElementById('s-greeting').value      = prefs.greetingMode ? 'on' : 'off';
  document.getElementById('s-greetingname').value  = prefs.greetingName || '';
  document.getElementById('s-scanlines').value     = prefs.scanlines === false ? 'off' : 'on';
  document.getElementById('s-clockformat').value   = prefs.clockFormat  || 'auto';
  document.getElementById('s-tempunit').value      = prefs.tempUnit     || 'auto';
  document.getElementById('s-cursorspeed').value   = prefs.cursorBlinkSpeed || 'normal';
  document.getElementById('s-historypersist').value = prefs.historyPersist === false ? 'off' : 'on';
  settingsPanelEl.classList.add('visible');
  document.getElementById('s-theme').focus();
}

export function closeSettingsPanel() {
  settingsPanelEl.classList.remove('visible');
  inputEl.focus();
}

export async function commitSettings() {
  const prefs = {
    theme:            document.getElementById('s-theme').value,
    terminalSize:     document.getElementById('s-terminalsize').value,
    dialSize:         document.getElementById('s-dialsize').value,
    bannerText:       document.getElementById('s-banner').value.trim(),
    greetingMode:     document.getElementById('s-greeting').value === 'on',
    greetingName:     document.getElementById('s-greetingname').value.trim(),
    scanlines:        document.getElementById('s-scanlines').value === 'on',
    clockFormat:      document.getElementById('s-clockformat').value,
    tempUnit:         document.getElementById('s-tempunit').value,
    cursorBlinkSpeed: document.getElementById('s-cursorspeed').value,
    historyPersist:   document.getElementById('s-historypersist').value === 'on',
  };
  await savePrefs(prefs);
  await applyPrefs(prefs);
  closeSettingsPanel();
  printLine('✓ Settings saved.', 'line-ok');
}
