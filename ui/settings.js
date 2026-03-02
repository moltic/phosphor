// ── ui/settings.js ───────────────────────────────────────────────────────────
// applyPrefs, settings panel UI, greeting helpers.

import { APP_TITLE, THEMES, MODES, FONT_SIZES, DEFAULT_PREFS, getAutoSkin } from '../core/config.js';
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
  const root = document.documentElement;

  // ── Theme palette (auto-skin may override stored theme) ──────────────────
  const effectiveTheme = (prefs.autoSkin) ? getAutoSkin() : (prefs.theme || 'amber');
  const palette = THEMES[effectiveTheme] || THEMES.amber;
  Object.entries(palette).forEach(([prop, val]) => root.style.setProperty(prop, val));

  // ── Display mode (hardware retro presets) ─────────────────────────────────
  // Strip all existing mode-- classes, then apply the selected one so the
  // cascade is clean regardless of the previous state.
  const displayMode = prefs.displayMode || 'classic';
  [...root.classList]
    .filter(c => c.startsWith('mode--'))
    .forEach(c => root.classList.remove(c));
  root.classList.add(`mode--${displayMode}`);
  // When a hardware mode is active its palette variables must win over the
  // standard theme palette applied above.
  if (displayMode !== 'classic') {
    const mode = MODES[displayMode];
    if (mode) {
      Object.entries(mode.palette).forEach(([prop, val]) => root.style.setProperty(prop, val));
    }
  }

  // ── CRT intensity ─────────────────────────────────────────────────────────
  // Classes on <html> drive the CSS in style.css.
  const intensity = prefs.crtIntensity || 'medium';
  ['off', 'low', 'medium', 'high'].forEach(lvl =>
    root.classList.toggle(`crt--${lvl}`, intensity === lvl)
  );

  // Remove the default fallback class when a named level is active so that
  // the cascade is unambiguous (medium needs no overrides, so it's a no-op
  // in CSS, but the class is set for consistency / JS introspection).

  // ── Reduced-motion (user preference, independent of OS setting) ──────────
  root.classList.toggle('reduced-motion--on', prefs.reducedMotion === true);

  const terminalSize = prefs.terminalSize || prefs.fontSize || DEFAULT_PREFS.terminalSize;
  const dialSize     = prefs.dialSize     || prefs.fontSize || DEFAULT_PREFS.dialSize;
  root.style.setProperty('--font-size',      FONT_SIZES[terminalSize] || FONT_SIZES.medium);
  root.style.setProperty('--dial-font-size', FONT_SIZES[dialSize]     || FONT_SIZES.medium);

  const _dialTileWidths = { small: '3.2em', medium: '4.8em', large: '6.2em' };
  root.style.setProperty('--dial-tile-width', _dialTileWidths[dialSize] || '4.8em');
  root.classList.toggle('dial-size--large', dialSize === 'large');

  const dialLayout = prefs.dialLayout || 'auto';
  ['auto', 'comfortable', 'compact'].forEach(m =>
    root.classList.toggle(`dial-layout--${m}`, dialLayout === m)
  );

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
    ['amber',   'AMBER'],
    ['green',   'GREEN'],
    ['blue',    'BLUE'],
    ['white',   'WHITE'],
    ['crimson', 'CRIMSON'],
    ['matrix',  'MATRIX'],
    ['ice',     'ICE'],
    ['warm',    'WARM'],
  ]);
  const terminalSizeSelect = makeSelect('s-terminalsize', [
    ['small', 'SMALL'], ['medium', 'MEDIUM'], ['large', 'LARGE'],
  ]);
  const dialLayoutSelect = makeSelect('s-diallayout', [
    ['auto', 'AUTO'], ['comfortable', 'COMFORTABLE'], ['compact', 'COMPACT'],
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
  const dialOnLoadSel      = makeSelect('s-dialonload',    [['off', 'OFF'], ['on', 'ON']]);
  // ── Atmospheric polish ──────────────────────────────────────────────────
  const crtIntensitySel    = makeSelect('s-crtintensity',  [
    ['off', 'OFF'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'],
  ]);
  const soundsSel          = makeSelect('s-sounds',        [['off', 'OFF'], ['on', 'ON']]);
  const bootSoundSel        = makeSelect('s-bootsound',      [['always', 'ALWAYS'], ['daily', 'FIRST RUN DAILY']]);
  const reducedMotionSel   = makeSelect('s-reducedmotion', [['off', 'OFF'], ['on', 'ON']]);
  const autoSkinSel        = makeSelect('s-autoskin',      [['off', 'OFF'], ['on', 'ON']]);
  const dialClickTargetSel = makeSelect('s-dialclicktarget', [
    ['new-tab',    'NEW TAB'],
    ['same-tab',   'SAME TAB'],
    ['new-window', 'NEW WINDOW'],
  ]);

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
  inner.appendChild(makeRow('DIAL LAYOUT',      dialLayoutSelect));
  inner.appendChild(makeRow('DIAL SIZE',        dialSizeSelect));
  inner.appendChild(makeRow('BANNER',           bannerInput));
  inner.appendChild(makeRow('GREETING',         greetingSelect));
  inner.appendChild(makeRow('NAME',             greetingNameInput));
  inner.appendChild(makeRow('SCANLINES',        scanSelect));
  inner.appendChild(makeRow('CLOCK FORMAT',     clockFormatSelect));
  inner.appendChild(makeRow('TEMPERATURE UNIT', tempUnitSelect));
  inner.appendChild(makeRow('CURSOR SPEED',     cursorSpeedSelect));
  inner.appendChild(makeRow('HISTORY PERSIST',  historyPersistSel));
  inner.appendChild(makeRow('DIALS ON LOAD',    dialOnLoadSel));
  // ── Atmospheric polish section ─────────────────────────────────────────
  inner.appendChild(makeRow('CRT INTENSITY',    crtIntensitySel));
  inner.appendChild(makeRow('SOUNDS',           soundsSel));
  inner.appendChild(makeRow('OPEN SOUND',        bootSoundSel));
  inner.appendChild(makeRow('REDUCE MOTION',    reducedMotionSel));
  inner.appendChild(makeRow('AUTO SKIN',        autoSkinSel));
  inner.appendChild(makeRow('DIAL CLICK OPENS', dialClickTargetSel));

  // ── Contextual onboarding hint ────────────────────────────────────
  const hintEl = document.createElement('div');
  hintEl.className = 'settings-onboarding-hint';
  hintEl.setAttribute('aria-label', 'Terminal shortcut hints');
  hintEl.innerHTML = [
    '<span class="settings-onboarding-hint__label">TERMINAL SHORTCUTS</span>',
    '<span>theme [name]  ─  change theme  (amber green blue white crimson matrix ice warm)</span>',
    '<span>Ctrl+,  /  ⌘,  ─  open or close this panel from anywhere</span>',
    '<span>tour  ─  replay the getting-started guide any time</span>',
    '<span>AUTO SKIN on  ─  palette auto-selects by season &amp; time of day</span>',
  ].join('');
  inner.appendChild(hintEl);

  inner.appendChild(actionsEl);

  // ── Live preview: apply changes instantly as the user adjusts controls ────
  const livePreviewFields = [
    themeSelect, terminalSizeSelect, dialLayoutSelect, dialSizeSelect,
    scanSelect, cursorSpeedSelect, greetingSelect,
    crtIntensitySel, reducedMotionSel, autoSkinSel,
  ];
  function _livePreview() {
    const previewPrefs = {
      dialClickTarget:  dialClickTargetSel.value,
      theme:            themeSelect.value,
      terminalSize:     terminalSizeSelect.value,
      dialLayout:       dialLayoutSelect.value,
      dialSize:         dialSizeSelect.value,
      bannerText:       bannerInput.value.trim(),
      greetingMode:     greetingSelect.value === 'on',
      greetingName:     greetingNameInput.value.trim(),
      scanlines:        scanSelect.value === 'on',
      clockFormat:      clockFormatSelect.value,
      tempUnit:         tempUnitSelect.value,
      cursorBlinkSpeed: cursorSpeedSelect.value,
      historyPersist:   historyPersistSel.value === 'on',
      crtIntensity:     crtIntensitySel.value,
      sounds:           soundsSel.value === 'on',
      bootSoundMode:    bootSoundSel.value,
      reducedMotion:    reducedMotionSel.value === 'on',
      autoSkin:         autoSkinSel.value === 'on',
    };
    applyPrefs(previewPrefs);
  }
  livePreviewFields.forEach(el => el.addEventListener('change', _livePreview));
  // Text inputs use a debounced 'input' event for live banner preview
  let _bannerPreviewTimer = null;
  [bannerInput, greetingNameInput].forEach(el => el.addEventListener('input', () => {
    clearTimeout(_bannerPreviewTimer);
    _bannerPreviewTimer = setTimeout(_livePreview, 300);
  }));

  inner.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSettingsPanel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT') {
      e.preventDefault(); commitSettings();
    }
    // Focus trap — cycle Tab / Shift+Tab within the panel
    if (e.key === 'Tab') {
      const focusable = [...inner.querySelectorAll(
        'select, input, button, [tabindex]:not([tabindex="-1"])'
      )].filter(el => !el.disabled && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  });
  panel.addEventListener('click', e => {
    if (e.target === panel) { e.stopPropagation(); closeSettingsPanel(); }
  });

  panel.appendChild(inner);
  document.body.appendChild(panel);
  return panel;
})();

// Store original prefs to revert on cancel
let _originalPrefs = null;

export async function openSettingsPanel() {
  const prefs = await loadPrefs();
  _originalPrefs = { ...prefs };
  document.getElementById('s-theme').value         = prefs.theme || 'amber';
  document.getElementById('s-terminalsize').value  = prefs.terminalSize || prefs.fontSize || 'medium';
  document.getElementById('s-diallayout').value    = prefs.dialLayout   || 'auto';
  document.getElementById('s-dialsize').value      = prefs.dialSize     || prefs.fontSize || 'medium';
  document.getElementById('s-banner').value        = prefs.bannerText   || '';
  document.getElementById('s-greeting').value      = prefs.greetingMode ? 'on' : 'off';
  document.getElementById('s-greetingname').value  = prefs.greetingName || '';
  document.getElementById('s-scanlines').value     = prefs.scanlines === false ? 'off' : 'on';
  document.getElementById('s-clockformat').value   = prefs.clockFormat  || 'auto';
  document.getElementById('s-tempunit').value      = prefs.tempUnit     || 'auto';
  document.getElementById('s-cursorspeed').value   = prefs.cursorBlinkSpeed || 'normal';
  document.getElementById('s-historypersist').value = prefs.historyPersist === false ? 'off' : 'on';
  document.getElementById('s-dialonload').value      = prefs.dialOpenOnLoad  === true  ? 'on'  : 'off';
  document.getElementById('s-crtintensity').value   = prefs.crtIntensity  || 'medium';
  document.getElementById('s-sounds').value          = prefs.sounds         === true  ? 'on'  : 'off';
  document.getElementById('s-bootsound').value        = prefs.bootSoundMode  || 'always';
  document.getElementById('s-reducedmotion').value   = prefs.reducedMotion  === true  ? 'on'  : 'off';
  document.getElementById('s-autoskin').value        = prefs.autoSkin       === true  ? 'on'  : 'off';
  document.getElementById('s-dialclicktarget').value = prefs.dialClickTarget || 'new-tab';
  settingsPanelEl.classList.add('visible');
  document.getElementById('s-theme').focus();
}

export function closeSettingsPanel() {
  settingsPanelEl.classList.remove('visible');
  // Revert live preview to saved prefs
  if (_originalPrefs) { applyPrefs(_originalPrefs); _originalPrefs = null; }
  inputEl.focus();
}

export async function commitSettings() {
  const prefs = {
    theme:            document.getElementById('s-theme').value,
    terminalSize:     document.getElementById('s-terminalsize').value,
    dialLayout:       document.getElementById('s-diallayout').value,
    dialSize:         document.getElementById('s-dialsize').value,
    bannerText:       document.getElementById('s-banner').value.trim(),
    greetingMode:     document.getElementById('s-greeting').value === 'on',
    greetingName:     document.getElementById('s-greetingname').value.trim(),
    scanlines:        document.getElementById('s-scanlines').value === 'on',
    clockFormat:      document.getElementById('s-clockformat').value,
    tempUnit:         document.getElementById('s-tempunit').value,
    cursorBlinkSpeed: document.getElementById('s-cursorspeed').value,
    historyPersist:   document.getElementById('s-historypersist').value === 'on',
    dialOpenOnLoad:   document.getElementById('s-dialonload').value === 'on',
    crtIntensity:     document.getElementById('s-crtintensity').value,
    sounds:           document.getElementById('s-sounds').value === 'on',
    bootSoundMode:    document.getElementById('s-bootsound').value,
    reducedMotion:    document.getElementById('s-reducedmotion').value === 'on',
    autoSkin:         document.getElementById('s-autoskin').value === 'on',
    dialClickTarget:  document.getElementById('s-dialclicktarget').value,
  };
  await savePrefs(prefs);
  await applyPrefs(prefs);
  _originalPrefs = null;  // Prevent close from reverting the saved prefs
  closeSettingsPanel();
  printLine('✓ Settings saved.', 'line-ok');
}
