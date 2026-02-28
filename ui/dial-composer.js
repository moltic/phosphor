// ── ui/dial-composer.js ────────────────────────────────────────────────────────
// Inline composer card that replaces the modal add-dial dialog.
//
// Opens as an inline card:
//   • below the toolbar  (triggered by [+ LINK] toolbar button)
//   • inside a category  (triggered by [+] on a named-category header)
//
// Features
//   – URL auto-normalizes on blur  (prepends https://)
//   – Label auto-fills from hostname when left blank
//   – Live icon preview  (auto-favicon → DuckDuckGo fallback → letter box)
//   – Category <select> pre-selected to active filter / target cat
//   – Saves directly into the versioned DialStore (no legacy flat-array shim)
//   – Enter saves  |  Escape closes  |  clicking same entry-point toggles

import { loadDialStore, saveDialStore } from '../core/storage.js';
import { getDialFilter }                from '../core/state.js';

// ── Dependency injection ───────────────────────────────────────────────────────
/** @type {(() => Promise<void>) | null} */
let _renderDials = null;

/**
 * Called once from dials.js (after renderDials is defined) to avoid a
 * circular module dependency.
 * @param {{ renderDials: Function }} deps
 */
export function setComposerDeps({ renderDials }) {
  _renderDials = renderDials;
}

// ── Module state ───────────────────────────────────────────────────────────────
/** @type {HTMLElement | null} */
let _composerEl   = null;
/** @type {string} stableId: catId or '__default__' */
let _currentCatId = null;

// ── URL helpers ────────────────────────────────────────────────────────────────
function _isLikelyUrl(val) {
  return /^[a-z][a-z0-9+\-.]*:\/\//i.test(val || '');
}

function _normalizeUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (_isLikelyUrl(s)) return s;
  return `https://${s}`;
}

// ── Alias generator ────────────────────────────────────────────────────────────
function _generateAlias(label, existingAliases) {
  const base = (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || `dial-${Date.now()}`;
  let alias = base;
  let n = 2;
  while (existingAliases.has(alias)) alias = `${base}-${n++}`;
  return alias;
}

// ── Letter-icon color (same palette as dials.js) ──────────────────────────────
const _COLORS = [
  '#1a5276', '#1a7a40', '#7a5c1a', '#1a6b7a',
  '#5c1a7a', '#7a1a1a', '#7b1a4e', '#2e7a1a',
];

function _letterColor(key) {
  let h = 0;
  for (let i = 0; i < (key || '').length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return _COLORS[h % _COLORS.length];
}

// ── Live icon preview ──────────────────────────────────────────────────────────
/**
 * Rebuild the icon preview inside previewWrap based on current input values.
 * Mirrors the rendering logic in dials.js buildDialIconElement().
 *
 * @param {HTMLElement} previewWrap
 * @param {string} urlVal
 * @param {string} iconVal
 * @param {string} labelVal
 */
function _refreshPreview(previewWrap, urlVal, iconVal, labelVal) {
  previewWrap.innerHTML = '';
  const url   = _normalizeUrl(urlVal);
  const icon  = (iconVal || '').trim();
  const label = (labelVal || '').trim();

  // Helper: build a letter-icon span
  function _letterEl(text) {
    const span = document.createElement('span');
    span.className = 'dial-letter-icon';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = ([...(text || '?')][0] ?? '?').toUpperCase();
    span.style.backgroundColor = _letterColor((text || '').toLowerCase());
    return span;
  }

  // Helper: hostname for letter / favicon
  function _hostname() {
    if (!url) return '';
    try { return new URL(url).hostname; } catch (_) { return ''; }
  }

  let el;

  if (icon && icon.toLowerCase() !== 'none' && _isLikelyUrl(icon)) {
    // Explicit favicon/image URL
    const img = document.createElement('img');
    img.className = 'dial-favicon';
    img.src = icon;
    img.alt = '';
    let _tried = false;
    img.addEventListener('error', () => {
      if (!_tried) {
        _tried = true;
        const h = _hostname();
        if (h) { img.src = `https://icons.duckduckgo.com/ip3/${h}.ico`; return; }
      }
      img.replaceWith(_letterEl(label || _hostname()));
    });
    el = img;

  } else if (icon && icon.toLowerCase() !== 'none' && [...icon].length <= 3) {
    // Short text / emoji
    const span = document.createElement('span');
    span.className = 'dial-icon-text';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = [...icon].slice(0, 3).join('');
    el = span;

  } else if (icon.toLowerCase() === 'none') {
    // Explicitly hidden icon
    const span = document.createElement('span');
    span.className = 'dial-composer-preview__none';
    span.textContent = '—';
    el = span;

  } else if (!icon && _isLikelyUrl(url)) {
    // Auto-favicon from the URL
    const img = document.createElement('img');
    img.className = 'dial-favicon';
    img.src = url;
    img.alt = '';
    let _tried = false;
    img.addEventListener('error', () => {
      if (!_tried) {
        _tried = true;
        const h = _hostname();
        if (h) { img.src = `https://icons.duckduckgo.com/ip3/${h}.ico`; return; }
      }
      img.replaceWith(_letterEl(label || _hostname()));
    });
    el = img;

  } else {
    // Letter box — use label, then URL text, then '?'
    el = _letterEl(label || urlVal || '?');
  }

  previewWrap.appendChild(el);
}

// ── Build the card ─────────────────────────────────────────────────────────────
/**
 * Synchronously build the composer card DOM.
 *
 * @param {{ categories: Array }} store
 * @param {string | null} targetCatId
 * @param {{ url?: string, label?: string }} [initial]
 * @returns {HTMLElement}
 */
function _buildCard(store, targetCatId, { url: initUrl = '', label: initLabel = '' } = {}) {
  const card = document.createElement('div');
  card.className = 'dial-composer';
  card.setAttribute('role', 'form');
  card.setAttribute('aria-label', 'Add new dial');

  // ── Left: icon preview ──────────────────────────────────────────────────────
  const previewWrap = document.createElement('div');
  previewWrap.className = 'dial-composer-preview';

  // ── Right: input column ─────────────────────────────────────────────────────
  const inputCol = document.createElement('div');
  inputCol.className = 'dial-composer-inputs';

  // Row 1: URL + Label
  const urlInput = document.createElement('input');
  urlInput.type        = 'url';
  urlInput.className   = 'dial-composer-url';
  urlInput.placeholder = 'URL';
  urlInput.autocomplete = 'off';
  urlInput.spellcheck  = false;
  if (initUrl) urlInput.value = initUrl;

  const labelInput = document.createElement('input');
  labelInput.type        = 'text';
  labelInput.className   = 'dial-composer-label';
  labelInput.placeholder = 'Label';
  labelInput.autocomplete = 'off';
  labelInput.spellcheck  = false;
  if (initLabel) labelInput.value = initLabel;

  const row1 = document.createElement('div');
  row1.className = 'dial-composer-row';
  row1.appendChild(urlInput);
  row1.appendChild(labelInput);

  // Row 2: Icon + Category
  const iconInput = document.createElement('input');
  iconInput.type        = 'text';
  iconInput.className   = 'dial-composer-icon';
  iconInput.placeholder = 'Icon (emoji · text · URL — blank = auto)';
  iconInput.autocomplete = 'off';
  iconInput.spellcheck  = false;

  const catSelect = document.createElement('select');
  catSelect.className = 'dial-composer-cat';
  catSelect.setAttribute('aria-label', 'Target category');

  // Resolve default category selection:
  // passed categoryId > active filter > first category
  const filterCat = getDialFilter().category;
  const defaultId = targetCatId ?? filterCat ?? (store.categories[0]?.id ?? null);

  store.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.label || '(default)';
    if (cat.id === defaultId) opt.selected = true;
    catSelect.appendChild(opt);
  });

  const row2 = document.createElement('div');
  row2.className = 'dial-composer-row';
  row2.appendChild(iconInput);
  if (store.categories.length > 1) row2.appendChild(catSelect);

  // Row 3: Error + Save + Cancel
  const errorEl = document.createElement('div');
  errorEl.className = 'dial-composer-error';
  errorEl.setAttribute('aria-live', 'assertive');

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'dial-composer-btn dial-composer-btn--save';
  saveBtn.textContent = '[SAVE]';
  saveBtn.type        = 'button';

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'dial-composer-btn';
  cancelBtn.textContent = '[×]';
  cancelBtn.type        = 'button';
  cancelBtn.setAttribute('aria-label', 'Close composer');

  const actionsRow = document.createElement('div');
  actionsRow.className = 'dial-composer-row dial-composer-actions';
  actionsRow.appendChild(errorEl);
  actionsRow.appendChild(saveBtn);
  actionsRow.appendChild(cancelBtn);

  inputCol.appendChild(row1);
  inputCol.appendChild(row2);
  inputCol.appendChild(actionsRow);

  card.appendChild(previewWrap);
  card.appendChild(inputCol);

  // ── Live preview wiring ─────────────────────────────────────────────────────
  function _updatePreview() {
    _refreshPreview(previewWrap, urlInput.value, iconInput.value, labelInput.value);
  }

  urlInput.addEventListener('input', _updatePreview);
  labelInput.addEventListener('input', _updatePreview);
  iconInput.addEventListener('input', _updatePreview);

  // URL: normalize on blur + auto-fill label from hostname
  urlInput.addEventListener('blur', () => {
    const norm = _normalizeUrl(urlInput.value);
    if (norm && norm !== urlInput.value) urlInput.value = norm;
    if (!labelInput.value.trim() && _isLikelyUrl(norm)) {
      try {
        const { hostname } = new URL(norm);
        labelInput.value = hostname.replace(/^www\./, '');
      } catch (_) {}
    }
    _updatePreview();
  });

  // ── Save logic ──────────────────────────────────────────────────────────────
  async function _save() {
    errorEl.textContent = '';

    const rawUrl = urlInput.value.trim();
    if (!rawUrl) { errorEl.textContent = 'URL is required.'; urlInput.focus(); return; }

    const url = _normalizeUrl(rawUrl);
    if (/^(javascript|data):/i.test(url)) {
      errorEl.textContent = 'URL scheme not allowed.'; return;
    }

    let label = labelInput.value.trim();
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { label = url; }
    }

    const rawIcon = iconInput.value.trim();
    const catId   = catSelect.value || store.categories[0]?.id;

    const currentStore = await loadDialStore();
    const cat = currentStore.categories.find(c => c.id === catId)
             ?? currentStore.categories[0];
    if (!cat) { errorEl.textContent = 'Target category not found.'; return; }

    const existingAliases = new Set(
      currentStore.categories.flatMap(c => c.items.map(i => i.alias))
    );
    const alias = _generateAlias(label, existingAliases);

    /** @type {{ id:string, type:'link', alias:string, label:string, url:string, icon?:string }} */
    const item = { id: alias, type: 'link', alias, label, url };
    if (rawIcon) item.icon = rawIcon;

    cat.items.push(item);
    await saveDialStore(currentStore);
    await _renderDials?.();
    closeComposer();
  }

  saveBtn.addEventListener('click', _save);
  cancelBtn.addEventListener('click', closeComposer);

  // Enter = save, Escape = close (anywhere inside the card)
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); _save(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeComposer(); }
  });

  // Prevent search/cmd-input events from bleeding out of the card
  card.addEventListener('keydown', e => e.stopPropagation(), true);

  // Initial preview
  _refreshPreview(previewWrap, initUrl, '', initLabel);

  return card;
}

// ── Mount position ─────────────────────────────────────────────────────────────
/**
 * Insert the composer card at the right place in the DOM.
 *
 * Named category: above that section's tile body.
 * Default / none:  prepend to #speed-dial.
 *
 * @param {string | null} categoryId
 */
function _mountComposer(categoryId) {
  if (!_composerEl) return;

  if (categoryId) {
    // CSS.escape guards against special characters in category ids.
    const sectionEl = document.querySelector(
      `.dial-section[data-cat-id="${CSS.escape(categoryId)}"]`
    );
    if (sectionEl) {
      const bodyEl = sectionEl.querySelector('.dial-section-body');
      sectionEl.insertBefore(_composerEl, bodyEl ?? null);
      _composerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
  }

  // Fallback: top of the dial grid
  const grid = document.getElementById('speed-dial');
  if (grid) grid.prepend(_composerEl);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Open (or toggle) the inline composer card.
 *
 * @param {{ categoryId?: string | null, url?: string, label?: string }} [opts]
 *   categoryId — pre-select this category and mount inside it.
 *                null / omitted → defaults to the active filter category
 *                or the first category in the store.
 *   url / label — pre-fill the corresponding fields (e.g. from openCurrentTabDial).
 */
export async function openComposer({ categoryId = null, url = '', label = '' } = {}) {
  // Resolve which category to target
  const filterCat  = getDialFilter().category;
  const resolvedId = categoryId ?? filterCat;  // null is fine (→ first/default cat)
  const stableId   = resolvedId ?? '__default__';

  // Toggle: a second click on the same entry-point closes the composer
  // (only when no initial data is provided — pre-fill always opens fresh).
  if (_composerEl && _currentCatId === stableId && !url && !label) {
    closeComposer();
    return;
  }

  // Re-opening for a different category or with fresh data: remove first.
  if (_composerEl) {
    _composerEl.remove();
    _composerEl = null;
  }

  const store = await loadDialStore();
  _currentCatId = stableId;

  _composerEl = _buildCard(store, resolvedId, { url, label });
  _mountComposer(resolvedId);

  // Focus URL field if empty; otherwise focus label (for pre-filled URL like openCurrentTabDial)
  const urlField   = _composerEl.querySelector('.dial-composer-url');
  const labelField = _composerEl.querySelector('.dial-composer-label');
  (url && !label ? labelField : urlField)?.focus();
}

/**
 * Close and remove the composer card.
 * Safe to call even when the composer is not open.
 */
export function closeComposer() {
  if (!_composerEl) return;
  _composerEl.remove();
  _composerEl = null;
  _currentCatId = null;
}
