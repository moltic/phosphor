// ── ui/dials.js ──────────────────────────────────────────────────────────────
// Speed-dial grid: rendering, DnD, context menu, edit dialog.

import { CONFIG }                   from '../core/config.js';
import { loadDials, saveDials, loadDialStore, saveDialStore } from '../core/storage.js';
import { printLine, inputEl }       from '../core/render.js';
import {
  _createWeatherTileEl, _patchWeatherTileEl,
  _refreshWeatherTile, _weatherIntervals,
} from './weather.js';
import { getDialFilter }            from '../core/state.js';
import {
  initDialToolbar,
  setDialToolbarDeps,
  refreshToolbarChips,
  syncManageBtnExternal,
} from './dial-toolbar.js';
import {
  openComposer,
  setComposerDeps,
} from './dial-composer.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const dialGridEl    = document.getElementById('speed-dial');
const _editToggle   = document.getElementById('dial-edit-toggle');
const _undoToastEl  = document.getElementById('dial-undo-toast');
const _undoToastMsg = _undoToastEl?.querySelector('.dial-undo-toast-msg');
const _undoToastBtn = _undoToastEl?.querySelector('.dial-undo-toast-btn');

// ── Edit mode ─────────────────────────────────────────────────────────────────
function _isEditMode()   { return dialGridEl.classList.contains('is-edit-mode'); }

function _enterEditMode() {
  dialGridEl.classList.add('is-edit-mode');
  if (_editToggle) { _editToggle.textContent = '[DONE]'; _editToggle.classList.add('is-active'); }
  dialGridEl.setAttribute('aria-label', 'Speed dial shortcuts — Edit mode');
  syncManageBtnExternal();
}

function _exitEditMode() {
  dialGridEl.classList.remove('is-edit-mode');
  if (_editToggle) { _editToggle.textContent = '[EDIT]'; _editToggle.classList.remove('is-active'); }
  dialGridEl.setAttribute('aria-label', 'Speed dial shortcuts');
  syncManageBtnExternal();
}

/** Toggle edit mode from external callers (toolbar [MANAGE] button). */
export function toggleDialEditMode() {
  if (_isEditMode()) _exitEditMode(); else _enterEditMode();
}

/** Return whether the grid is currently in edit mode. */
export function isDialEditMode() { return _isEditMode(); }

if (_editToggle) {
  _editToggle.addEventListener('click', () => _isEditMode() ? _exitEditMode() : _enterEditMode());
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && _isEditMode()) { e.preventDefault(); _exitEditMode(); }
});

// ── Letter-icon helpers ───────────────────────────────────────────────────────
const _LETTER_ICON_COLORS = [
  '#1a5276', '#1a7a40', '#7a5c1a', '#1a6b7a',
  '#5c1a7a', '#7a1a1a', '#7b1a4e', '#2e7a1a',
];

function _letterIconColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return _LETTER_ICON_COLORS[h % _LETTER_ICON_COLORS.length];
}

function buildLetterIcon(dial) {
  const label  = String(dial?.label || dial?.alias || dial?.url || '?');
  const letter = ([...label][0] ?? '?').toUpperCase();
  const span   = document.createElement('span');
  span.className = 'dial-letter-icon';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = letter;
  span.style.backgroundColor = _letterIconColor(label.toLowerCase());
  return span;
}

function isLikelyUrl(val) {
  return /^[a-z][a-z0-9+\-.]*:\/\//i.test(val);
}

export function normalizeDialIcon(val) {
  const trimmed = String(val ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'none') return 'none';
  return trimmed;
}

function isShortTextIcon(val) {
  const s = String(val ?? '').trim();
  if (!s || isLikelyUrl(s) || s.toLowerCase() === 'none') return false;
  return [...s].length <= 3;
}

export function getFaviconUrl(dial) {
  if ('_faviconUrl' in (dial ?? {})) return dial._faviconUrl;
  const icon = normalizeDialIcon(dial?.icon);
  if (!icon || icon === 'none' || !isLikelyUrl(icon)) return null;
  return icon;
}

function buildDialIconElement(dial) {
  const icon = normalizeDialIcon(dial?.icon);
  if (icon === 'none') return null;

  if (!icon) {
    // Auto-favicon: derive from the dial URL; fall back to letter icon on error.
    let hostname = null;
    try { hostname = new URL(dial?.url || '').hostname; } catch (_) {}
    if (hostname) {
      const img = document.createElement('img');
      img.className = 'dial-favicon';
      img.src = `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
      img.alt = '';
      img.addEventListener('error', () => img.replaceWith(buildLetterIcon(dial)));
      return img;
    }
    return buildLetterIcon(dial);
  }

  if (isShortTextIcon(icon)) {
    const span = document.createElement('span');
    span.className = 'dial-icon-text';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = icon;
    return span;
  }

  const faviconUrl = getFaviconUrl(dial);
  if (faviconUrl) {
    const img = document.createElement('img');
    img.className = 'dial-favicon';
    img.src = faviconUrl;
    img.alt = '';
    let _ddgTried = false;
    img.addEventListener('error', () => {
      if (!_ddgTried) {
        let hostname = null;
        try { hostname = new URL(dial.url).hostname; } catch (_) {}
        if (hostname) {
          _ddgTried = true;
          img.src = `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
          return;
        }
      }
      img.replaceWith(buildLetterIcon(dial));
    });
    return img;
  }

  const span = document.createElement('span');
  span.className = 'dial-icon-text';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = [...icon].slice(0, 3).join('');
  return span;
}

// ── Drop-position indicator ────────────────────────────────────────────────────
let _dropIndicator = null;
let _dropPreview   = null;

// ── Add-tile (persistent "+" at end of grid) ─────────────────────────────────
let _addTileEl = null;

function _ensureAddTile() {
  if (_addTileEl) return _addTileEl;
  _addTileEl = document.createElement('div');
  _addTileEl.className = 'dial-add-tile';
  _addTileEl.setAttribute('role', 'button');
  _addTileEl.setAttribute('tabindex', '0');
  _addTileEl.setAttribute('aria-label', 'Add new speed-dial tile');
  const plus = document.createElement('span');
  plus.className = 'dial-add-tile__plus';
  plus.setAttribute('aria-hidden', 'true');
  plus.textContent = '+';
  _addTileEl.appendChild(plus);
  _addTileEl.addEventListener('click', () => openComposer({}));
  _addTileEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openComposer({}); }
  });
  return _addTileEl;
}

// ── Empty-state panel (first-run / zero dials) ────────────────────────────────
let _emptyStateEl = null;

function _ensureEmptyState() {
  if (_emptyStateEl) return _emptyStateEl;

  _emptyStateEl = document.createElement('div');
  _emptyStateEl.className = 'dial-empty-state';
  _emptyStateEl.setAttribute('role', 'status');

  const heading = document.createElement('p');
  heading.className = 'dial-empty-state__heading';
  heading.textContent = 'NO SHORTCUTS YET';
  _emptyStateEl.appendChild(heading);

  const addBtn = document.createElement('button');
  addBtn.className = 'dial-empty-state__btn';
  addBtn.setAttribute('type', 'button');
  addBtn.textContent = '[ + ADD LINK ]';
  addBtn.addEventListener('click', () => openComposer({}));
  _emptyStateEl.appendChild(addBtn);

  const orEl = document.createElement('span');
  orEl.className = 'dial-empty-state__or';
  orEl.setAttribute('aria-hidden', 'true');
  orEl.textContent = '── or ──';
  _emptyStateEl.appendChild(orEl);

  const kbdEl = document.createElement('p');
  kbdEl.className = 'dial-empty-state__kbd';
  const isMac = navigator.platform?.startsWith('Mac') ||
                navigator.userAgentData?.platform === 'macOS';
  const shortcut = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';
  kbdEl.innerHTML = `press <kbd>${shortcut}</kbd> on any tab to capture it here`;
  _emptyStateEl.appendChild(kbdEl);

  return _emptyStateEl;
}

function ensureDropIndicator() {
  if (_dropIndicator) return _dropIndicator;
  _dropIndicator = document.createElement('div');
  _dropIndicator.className = 'dial-drop-indicator';
  _dropIndicator.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_dropIndicator);
  return _dropIndicator;
}

function showDropIndicatorAt(x, top, height) {
  const el = ensureDropIndicator();
  el.style.left   = `${Math.round(x)}px`;
  el.style.top    = `${Math.round(top)}px`;
  el.style.height = `${Math.max(10, Math.round(height))}px`;
  el.classList.add('visible');
}

function hideDropIndicator() {
  _dropPreview = null;
  _dropIndicator?.classList.remove('visible');
}

function chooseBeforeWithDeadzone(rect, clientX, priorBefore) {
  const mid = rect.left + rect.width / 2;
  const lo  = rect.left + rect.width * 0.45;
  const hi  = rect.left + rect.width * 0.55;
  if (clientX < lo) return true;
  if (clientX > hi) return false;
  return typeof priorBefore === 'boolean' ? priorBefore : (clientX < mid);
}

function previewDropNearElement(toAlias, rect, clientX) {
  const prior  = _dropPreview?.toAlias === toAlias && !_dropPreview.end ? _dropPreview.before : undefined;
  const before = chooseBeforeWithDeadzone(rect, clientX, prior);
  _dropPreview = { toAlias, before, end: false };
  return before; // used by callers for live DOM rearrange
}

// ── Drag placeholder (live-reorder preview) ──────────────────────────────────
// We move a *placeholder* element around the DOM instead of the dragged tile
// itself.  Moving the drag source during an HTML5 drag causes Chrome to fire
// dragend immediately, cancelling the drag.  The placeholder is a styled
// empty slot; surrounding tiles animate to fill the gap via FLIP.

let _dragPlaceholder = null;

function _ensureDragPlaceholder(w, h) {
  if (!_dragPlaceholder) {
    _dragPlaceholder = document.createElement('div');
    _dragPlaceholder.className = 'dial-drag-placeholder';
    _dragPlaceholder.setAttribute('aria-hidden', 'true');
    _dragPlaceholder.style.pointerEvents = 'auto';

    // Accept drops that land directly on the placeholder (the most common case
    // when the user releases the mouse over the highlighted slot).
    _dragPlaceholder.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    _dragPlaceholder.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      _dragDropCommitted = true; // must be set before dragend fires
      dialGridEl.classList.remove('is-dragging-dial');
      const fromAlias = e.dataTransfer?.getData('text/plain');
      if (!fromAlias) return;
      await _commitPlaceholderDrop(fromAlias);
      await renderDials();
    });
  }
  if (w) _dragPlaceholder.style.width  = `${w}px`;
  if (h) _dragPlaceholder.style.height = `${h}px`;
  return _dragPlaceholder;
}

function _removeDragPlaceholder() {
  if (_dragPlaceholder) { _dragPlaceholder.remove(); }
}

/** Cancel all in-progress FLIP transitions on tile/header nodes. */
function _cancelAllFlips() {
  dialGridEl.querySelectorAll('.dial-tile, .dial-group-header').forEach(t => {
    if (t._flipCancel) { t._flipCancel(); delete t._flipCancel; }
  });
}

/**
 * Move the drag placeholder to a position near overEl, animating surrounding
 * tiles into their new spots using the FLIP technique.
 *
 * @param {Element} overEl  Tile the pointer is over.
 * @param {boolean} before  Insert placeholder before (true) or after (false) overEl.
 */
function _movePlaceholderNear(overEl, before) {
  const src = _dragSourceEl;
  if (!overEl || overEl === src) return;

  const targetBody = overEl.closest('.dial-section-body');
  if (!targetBody) return;

  const ph       = _ensureDragPlaceholder(src?.offsetWidth, src?.offsetHeight);
  const insertRef = before ? overEl : (overEl.nextSibling ?? null);

  // No-op: placeholder is already in the right spot.
  if (ph.parentNode === targetBody && ph.nextSibling === insertRef) return;
  // Also no-op when placeholder would go right next to the source.
  if (insertRef === src) return;

  // ── FLIP – record First positions (skip source and placeholder) ───────────
  const srcBody  = src?.parentNode;
  const bodies   = srcBody && srcBody !== targetBody ? [srcBody, targetBody] : [targetBody];
  const animated = [];
  for (const body of bodies) {
    for (const tile of body.querySelectorAll('.dial-tile, .dial-group-header')) {
      if (tile === src || tile === ph) continue;
      if (tile._flipCancel) { tile._flipCancel(); delete tile._flipCancel; }
      animated.push({ tile, first: tile.getBoundingClientRect() });
    }
  }

  // ── Move placeholder ──────────────────────────────────────────────────────
  if (insertRef) targetBody.insertBefore(ph, insertRef);
  else           targetBody.appendChild(ph);

  // ── FLIP – compute delta and schedule Play ────────────────────────────────
  for (const { tile, first } of animated) {
    const last = tile.getBoundingClientRect();
    const dx   = first.left - last.left;
    const dy   = first.top  - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    tile.style.transition = 'none';
    tile.style.transform  = `translate(${dx}px,${dy}px)`;

    let rafId;
    const cancel = () => {
      cancelAnimationFrame(rafId);
      tile.style.transition = '';
      tile.style.transform  = '';
    };
    tile._flipCancel = cancel;
    rafId = requestAnimationFrame(() => {
      tile.style.transition = 'transform 0.14s ease';
      tile.style.transform  = '';
      tile.addEventListener('transitionend', () => {
        if (tile._flipCancel === cancel) {
          tile.style.transition = '';
          delete tile._flipCancel;
        }
      }, { once: true });
    });
  }
}

/**
 * Snapshot the visible section/body DOM order while a drag placeholder is
 * present. The placeholder position is replaced with `fromAlias`, and the
 * dragged source tile is skipped at its original location.
 *
 * Returns null when no live placeholder exists.
 */
function _getSectionAliasPlanFromPlaceholder(fromAlias) {
  const ph = _dragPlaceholder;
  if (!ph?.parentNode) return null;

  const plan = [];
  for (const sectionEl of dialGridEl.querySelectorAll('.dial-section')) {
    const catId = sectionEl.dataset.catId;
    const body  = sectionEl.querySelector(':scope > .dial-section-body');
    if (!catId || !body) continue;

    const aliases = [];
    for (const child of body.children) {
      if (child === ph) {
        aliases.push(fromAlias);
        continue;
      }

      if (!child.classList.contains('dial-tile')) continue;
      const alias = child.dataset?.alias;
      if (alias && alias !== fromAlias) aliases.push(alias);
    }

    plan.push({ catId, aliases });
  }

  return plan;
}

/**
 * Persist the current placeholder DOM position back into DialStore so the
 * drop result exactly matches the live preview the user saw.
 */
async function _commitPlaceholderDrop(fromAlias) {
  const plan = _getSectionAliasPlanFromPlaceholder(fromAlias);
  if (!plan?.length) return false;

  const store     = await loadDialStore();
  const itemByAlias = new Map();
  const catByAlias  = new Map();
  for (const cat of store.categories) {
    for (const item of cat.items) {
      itemByAlias.set(item.alias, item);
      catByAlias.set(item.alias, cat.id);
    }
  }

  if (!itemByAlias.has(fromAlias)) return false;

  const seen = new Set();
  const aliasesByCat = new Map(plan.map(({ catId, aliases }) => [catId, aliases]));
  const nextCategories = store.categories.map(cat => {
    const plannedAliases = aliasesByCat.get(cat.id);
    if (!plannedAliases) return { ...cat, items: [...cat.items] };

    const items = plannedAliases
      .map(alias => itemByAlias.get(alias))
      .filter(Boolean);

    for (const item of items) seen.add(item.alias);
    return { ...cat, items };
  });

  // Preserve any unplanned items in their original categories rather than
  // dropping data if the DOM snapshot missed a hidden node.
  for (const item of itemByAlias.values()) {
    if (seen.has(item.alias)) continue;
    const catId = catByAlias.get(item.alias);
    const cat   = nextCategories.find(c => c.id === catId);
    if (cat) cat.items.push(item);
  }

  await saveDialStore({ ...store, categories: nextCategories });
  return true;
}

function previewDropAtEnd() {
  const items = dialGridEl.querySelectorAll('.dial-tile, .dial-group-header');
  const last  = items.length ? items[items.length - 1] : null;
  if (!last) return;
  const rect = last.getBoundingClientRect();
  _dropPreview = { toAlias: null, before: false, end: true };
  showDropIndicatorAt(rect.right, rect.top, rect.height);
}

function getPreviewBeforeFor(toAlias, fallbackRect, clientX) {
  if (_dropPreview && !_dropPreview.end && _dropPreview.toAlias === toAlias) return _dropPreview.before;
  return clientX < (fallbackRect.left + fallbackRect.width / 2);
}

// ── Shared drag-and-drop / touch helper ──────────────────────────────────────
let _isDraggingDial    = false;
let _dragSourceEl      = null;   // the tile element currently being dragged
let _dragDropCommitted = false;  // true once drop has been handled (prevents double-render)

// Hover-to-expand: when dragging a tile over a collapsed category header,
// expand it automatically after a short delay (mouse & touch).
let _hoverExpandTimer = null;
let _hoverExpandCatId = null;

/** Pure helper — returns a new array with item moved from fromIndex to toIndex. */
function _arrayMove(arr, fromIndex, toIndex) {
  const next      = [...arr];
  if (fromIndex < 0 || fromIndex >= next.length) return next;
  const clampedTo = Math.max(0, Math.min(toIndex, next.length - 1));
  const [item]    = next.splice(fromIndex, 1);
  next.splice(clampedTo, 0, item);
  return next;
}

async function _moveDialAliasToIndex(dials, alias, toIndex) {
  const fromIndex = dials.findIndex(d => d.alias === alias);
  if (fromIndex === -1) return;
  const next = _arrayMove(dials, fromIndex, toIndex);
  await saveDials(next);
  await renderDials();
}

/**
 * Move a dial (by alias) to a different category, appending at the end.
 * Operates directly on the versioned DialStore to avoid flat-array ambiguity
 * when multiple named categories are involved.
 *
 * @param {string} fromAlias  Alias of the dial to move.
 * @param {string} toCatId    Target category id.
 */
async function _moveDialToCategory(fromAlias, toCatId) {
  const store = await loadDialStore();
  let movedItem = null;
  for (const cat of store.categories) {
    const idx = cat.items.findIndex(i => i.alias === fromAlias);
    if (idx !== -1) { [movedItem] = cat.items.splice(idx, 1); break; }
  }
  if (!movedItem) return;
  const targetCat = store.categories.find(c => c.id === toCatId);
  if (!targetCat) return;
  targetCat.items.push(movedItem);
  await saveDialStore(store);
  await renderDials();
}

// ── Hover-expand helpers ──────────────────────────────────────────────────────

/** Cancel any pending hover-expand timer and remove the visual cue from the header. */
function _cancelHoverExpand() {
  if (_hoverExpandTimer !== null) { clearTimeout(_hoverExpandTimer); _hoverExpandTimer = null; }
  if (_hoverExpandCatId !== null) {
    _sectionNodeCache.get(_hoverExpandCatId)
      ?.querySelector('.dial-group-header')
      ?.classList.remove('is-drag-hover');
    _hoverExpandCatId = null;
  }
}

/** Expand a collapsed category by removing it from the persisted collapse state. */
async function _triggerHoverExpand(catId) {
  const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
  if (!stored.dialGroupCollapsed[catId]) return; // already expanded
  stored.dialGroupCollapsed[catId] = false;
  await chrome.storage.local.set({ dialGroupCollapsed: stored.dialGroupCollapsed });
  _applyGroupCollapse(stored.dialGroupCollapsed);
}

// ── Move-to-category picker ───────────────────────────────────────────────────
// A small popup listing all other categories, opened via the ⇄ tile button
// (edit mode) so cross-category moves never require right-click.

/** @type {HTMLElement|null} */
let _movePickerEl     = null;
/** @type {HTMLElement|null} */
let _movePickerAnchor = null;

function _ensureMovePicker() {
  if (_movePickerEl) return _movePickerEl;
  const el = document.createElement('div');
  el.id = 'dial-move-picker';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', 'Move dial to category');
  el.style.display = 'none';
  document.body.appendChild(el);
  // Close on click outside
  document.addEventListener('click', e => {
    if (_movePickerEl?.style.display !== 'none' &&
        !_movePickerEl.contains(e.target) &&
        e.target !== _movePickerAnchor) {
      _hideMovePicker();
    }
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _movePickerEl?.style.display !== 'none') {
      _hideMovePicker();
      _movePickerAnchor?.focus();
    }
  });
  _movePickerEl = el;
  return el;
}

function _hideMovePicker() {
  if (_movePickerEl) _movePickerEl.style.display = 'none';
  _movePickerAnchor = null;
}

async function _showMovePicker(alias, anchorEl) {
  const picker = _ensureMovePicker();
  _movePickerAnchor = anchorEl;
  const store = await loadDialStore();

  // Find current category
  let currentCatId = null;
  for (const cat of store.categories) {
    if (cat.items.some(i => i.alias === alias)) { currentCatId = cat.id; break; }
  }
  const targets = store.categories.filter(c => c.id !== currentCatId);
  if (!targets.length) { _hideMovePicker(); return; }

  picker.innerHTML = '';
  const titleEl = document.createElement('div');
  titleEl.className = 'dial-move-picker__title';
  titleEl.textContent = 'MOVE TO';
  picker.appendChild(titleEl);

  for (const cat of targets) {
    const btn = document.createElement('button');
    btn.className = 'dial-move-picker__item';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = cat.label || '(default)';
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      _hideMovePicker();
      await _moveDialToCategory(alias, cat.id);
    });
    picker.appendChild(btn);
  }

  picker.style.display = 'flex';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top  = `${rect.bottom + 4}px`;
  requestAnimationFrame(() => {
    const pr = picker.getBoundingClientRect();
    if (pr.right  > window.innerWidth)  picker.style.left = `${rect.right - pr.width}px`;
    if (pr.bottom > window.innerHeight) picker.style.top  = `${rect.top - pr.height - 4}px`;
    picker.querySelector('.dial-move-picker__item')?.focus();
  });
}

/**
 * Bind all drag-and-drop (mouse) and touch (drag + long-press) events to a
 * dial element.
 */
export function bindDragEvents(el, dial, opts = {}) {
  const { isDivider = false, isWeather = false, suppressClick = false, isGroupHeader = false } = opts;

  if (suppressClick) {
    el.addEventListener('click', e => {
      if (_isDraggingDial) { e.preventDefault(); e.stopPropagation(); return; }
      // Always prevent the default <a> navigation so the current tab is never
      // redirected (weather tiles use <a href> for semantic reasons but should
      // open in a new tab — consistent with regular dial tiles).
      e.preventDefault();
      e.stopPropagation();
      // In normal (non-edit) mode open the URL in a new tab.
      if (!_isEditMode() && !isDivider && !isGroupHeader) {
        const href = (el instanceof HTMLAnchorElement ? el.href : '') || dial.url;
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      }
    });
  }

  // ── Native HTML5 DnD ──────────────────────────────────────────────────────
  el.addEventListener('dragstart', e => {
    _isDraggingDial    = true;
    _dragSourceEl      = el;
    _dragDropCommitted = false;
    hideDropIndicator();
    el.classList.add('is-dragging');
    dialGridEl.classList.add('is-dragging-dial');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dial.alias);
    } catch { /* ignore */ }
    // Insert placeholder at the source position *after* the browser has taken
    // its DnD snapshot — placing it synchronously would alter the element
    // before the snapshot and can produce a blank drag ghost in some browsers.
    setTimeout(() => {
      if (!_dragSourceEl) return; // drag already ended
      const body = el.parentNode;
      if (!body) return;
      const ph = _ensureDragPlaceholder(el.offsetWidth, el.offsetHeight);
      const next = el.nextSibling;
      if (next) body.insertBefore(ph, next); else body.appendChild(ph);
    }, 0);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    _cancelAllFlips();
    _removeDragPlaceholder();
    // Clean up any lingering drop-target highlights on section bodies.
    document.querySelectorAll('.dial-section-body.is-drop-target, .dial-section-empty-slot.is-over')
      .forEach(b => b.classList.remove('is-drop-target', 'is-over'));
    _cancelHoverExpand();
    // If the drop was cancelled (no valid target), restore the grid.
    if (!_dragDropCommitted) renderDials();
    _dragSourceEl      = null;
    _dragDropCommitted = false;
    setTimeout(() => { _isDraggingDial = false; }, 0);
  });

  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (el.classList.contains('is-dragging')) return;
    const before = previewDropNearElement(dial.alias, el.getBoundingClientRect(), e.clientX);
    _movePlaceholderNear(el, before);
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    _dragDropCommitted = true;  // sync — must be set before dragend fires
    hideDropIndicator();
    dialGridEl.classList.remove('is-dragging-dial');
    const fromAlias = e.dataTransfer?.getData('text/plain');
    if (!fromAlias) return;
    if (await _commitPlaceholderDrop(fromAlias)) {
      await renderDials();
    } else {
      // Fallback: placeholder not in DOM yet (drop fired before first dragover).
      const current   = await loadDials();
      const toAlias   = dial.alias;
      if (!toAlias || fromAlias === toAlias) return;
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      const toIndex   = current.findIndex(d => d.alias === toAlias);
      if (fromIndex === -1 || toIndex === -1) return;
      const rect        = el.getBoundingClientRect();
      const before      = getPreviewBeforeFor(toAlias, rect, e.clientX);
      let insertIndex   = toIndex + (before ? 0 : 1);
      if (fromIndex < insertIndex) insertIndex -= 1;
      insertIndex = Math.max(0, Math.min(insertIndex, current.length - 1));
      await saveDials(_arrayMove(current, fromIndex, insertIndex));
      await renderDials();
    }
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    showDialCtxMenu(e.clientX, e.clientY, dial.alias, isDivider, isWeather, isGroupHeader);
  });

  // ── Touch ──────────────────────────────────────────────────────────────────
  let _lpTimer = null, _touchStartX = 0, _touchStartY = 0;
  let _touchDragging = false, _ghostEl = null, _ghostOffX = 0, _ghostOffY = 0;

  function _cancelLongPress() {
    if (_lpTimer !== null) { clearTimeout(_lpTimer); _lpTimer = null; }
  }

  function _createGhost(sourceEl, touchX, touchY) {
    const ghost = sourceEl.cloneNode(true);
    const rect  = sourceEl.getBoundingClientRect();
    ghost.style.cssText = [
      'position:fixed', `width:${rect.width}px`, `height:${rect.height}px`,
      `left:${rect.left}px`, `top:${rect.top}px`,
      'opacity:0.75', 'pointer-events:none', 'z-index:9999', 'transition:none',
    ].join(';');
    document.body.appendChild(ghost);
    _ghostOffX = touchX - rect.left;
    _ghostOffY = touchY - rect.top;
    return ghost;
  }

  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    _touchStartX = t.clientX; _touchStartY = t.clientY; _touchDragging = false;
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      if (navigator.vibrate) navigator.vibrate(30);
      showDialCtxMenu(_touchStartX, _touchStartY, dial.alias, isDivider, isWeather, isGroupHeader);
    }, CONFIG.DIAL_LONGPRESS_MS);
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) { _cancelLongPress(); return; }
    const t  = e.touches[0];
    const dx = t.clientX - _touchStartX;
    const dy = t.clientY - _touchStartY;

    if (!_touchDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      _cancelLongPress();
      _touchDragging  = true;
      _isDraggingDial = true;
      _dragSourceEl   = el;
      el.classList.add('is-dragging');
      dialGridEl.classList.add('is-dragging-dial');
      _ghostEl = _createGhost(el, _touchStartX, _touchStartY);
      // Place placeholder next to source so the gap is visible immediately.
      const body = el.parentNode;
      if (body) {
        const ph = _ensureDragPlaceholder(el.offsetWidth, el.offsetHeight);
        const next = el.nextSibling;
        if (next) body.insertBefore(ph, next); else body.appendChild(ph);
      }
    }

    if (_touchDragging) {
      e.preventDefault();
      _ghostEl.style.left = `${t.clientX - _ghostOffX}px`;
      _ghostEl.style.top  = `${t.clientY - _ghostOffY}px`;
      _ghostEl.style.visibility = 'hidden';
      const below = document.elementFromPoint(t.clientX, t.clientY);
      _ghostEl.style.visibility = '';
      const targetEl = below?.closest('[data-alias]');
      if (targetEl && targetEl !== el) {
        const tBefore = previewDropNearElement(targetEl.dataset.alias, targetEl.getBoundingClientRect(), t.clientX);
        _movePlaceholderNear(targetEl, tBefore);
        // Tile takes priority — clear section-body highlights and any hover timer.
        document.querySelectorAll('.dial-section-body.is-drop-target')
          .forEach(b => b.classList.remove('is-drop-target'));
        _cancelHoverExpand();
      } else {
        hideDropIndicator();
        // Highlight the section body the finger is over.
        const bodyEl = below?.closest('.dial-section-body');
        document.querySelectorAll('.dial-section-body.is-drop-target')
          .forEach(b => { if (b !== bodyEl) b.classList.remove('is-drop-target'); });
        if (bodyEl) bodyEl.classList.add('is-drop-target');
        // Hover-to-expand collapsed category under the touch pointer.
        const sectionEl   = below?.closest('.dial-section');
        const hovCatId    = sectionEl?.dataset.catId ?? null;
        const headerEl    = sectionEl?.querySelector(':scope > .dial-group-header');
        const hovBodyEl   = sectionEl?.querySelector(':scope > .dial-section-body');
        const isCollapsed = hovBodyEl && hovBodyEl.style.display === 'none';
        if (hovCatId && isCollapsed && hovCatId !== _hoverExpandCatId) {
          _cancelHoverExpand();
          _hoverExpandCatId = hovCatId;
          headerEl?.classList.add('is-drag-hover');
          _hoverExpandTimer = setTimeout(() => {
            _hoverExpandTimer = null;
            headerEl?.classList.remove('is-drag-hover');
            _triggerHoverExpand(hovCatId);
          }, 600);
        } else if (!isCollapsed) {
          _cancelHoverExpand();
        }
      }
    }
  }, { passive: false });

  async function _finishTouchDrag(changedTouch) {
    if (_ghostEl) { _ghostEl.remove(); _ghostEl = null; }
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    _cancelAllFlips();
    document.querySelectorAll('.dial-section-body.is-drop-target, .dial-section-empty-slot.is-over')
      .forEach(b => b.classList.remove('is-drop-target', 'is-over'));
    _cancelHoverExpand();
    const fromAlias = dial.alias;
    _dragSourceEl = null;
    const below        = document.elementFromPoint(changedTouch.clientX, changedTouch.clientY);
    const targetBodyEl = below?.closest('.dial-section-body');
    _touchDragging = false;
    setTimeout(() => { _isDraggingDial = false; }, 0);

    if (await _commitPlaceholderDrop(fromAlias)) {
      _removeDragPlaceholder();
      await renderDials();
    } else if (targetBodyEl) {
      _removeDragPlaceholder();
      // No placeholder (finger lifted over empty section body) — move to that category.
      const catId = targetBodyEl.closest('.dial-section')?.dataset.catId;
      if (catId) await _moveDialToCategory(fromAlias, catId);
      else await renderDials();
    } else {
      _removeDragPlaceholder();
      // No valid target — restore.
      await renderDials();
    }
  }

  el.addEventListener('touchend', e => {
    _cancelLongPress();
    if (!_touchDragging) return;
    _finishTouchDrag(e.changedTouches[0]);
  });

  el.addEventListener('touchcancel', () => {
    _cancelLongPress();
    _cancelHoverExpand();
    document.querySelectorAll('.dial-section-body.is-drop-target')
      .forEach(b => b.classList.remove('is-drop-target'));
    if (_ghostEl) { _ghostEl.remove(); _ghostEl = null; }
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    _cancelAllFlips();
    _removeDragPlaceholder();
    _touchDragging = false;
    _dragSourceEl  = null;
    renderDials(); // restore DOM order
    setTimeout(() => { _isDraggingDial = false; }, 0);
  });
}

// ── Element factories ─────────────────────────────────────────────────────────
// (Divider factories removed — dividers are not representable in DialStore v1.)

// ── Inline label rename ─────────────────────────────────────────────────────
/**
 * Replace labelEl's text with a focused <input> so the user can rename the
 * dial in place.  Works for both regular tiles (.dial-label) and group
 * headers (.dial-group-label).  Call only when edit-mode is active.
 */
function _startInlineLabelEdit(labelEl, dial, anchorEl = null) {
  if (labelEl.dataset.editing === '1') return;
  labelEl.dataset.editing = '1';
  const currentText = labelEl.textContent;
  const tileEl      = anchorEl ?? labelEl.closest('.dial-tile, .dial-group-header');

  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'dial-label-input';
  input.value     = currentText;
  if (tileEl) input.style.width = `${tileEl.offsetWidth - 8}px`;

  labelEl.textContent = '';
  labelEl.appendChild(input);

  // Prevent clicks inside the input from bubbling to the tile / group header.
  input.addEventListener('click',     e => e.stopPropagation());
  input.addEventListener('mousedown', e => e.stopPropagation());

  input.focus();
  input.select();

  let _done = false;

  async function _commit(refocus = false) {
    if (_done) return;
    _done = true;
    delete labelEl.dataset.editing;
    const newLabel = input.value.trim();
    // Always tear down the input immediately — don't leave it in the DOM
    // while async storage operations are in flight.
    labelEl.textContent = newLabel || currentText;
    if (!newLabel) {
      if (refocus) anchorEl?.focus();
      return;
    }
    const dials = await loadDials();
    const idx   = dials.findIndex(d => d.alias === dial.alias);
    if (idx !== -1) {
      dials[idx].label = newLabel;
      await saveDials(dials);
    }
    await renderDials();
    // Restore keyboard focus to the tile / header after the grid re-syncs.
    if (refocus) {
      const selector = dial.type === 'group-header'
        ? `.dial-group-header[data-alias="${dial.alias}"]`
        : `.dial-tile[data-alias="${dial.alias}"]`;
      (dialGridEl.querySelector(selector) ?? anchorEl)?.focus();
    }
  }

  function _cancel() {
    if (_done) return;
    _done = true;
    delete labelEl.dataset.editing;
    labelEl.textContent = currentText;
    anchorEl?.focus();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); _commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _cancel(); }
  });

  // Blur commits (no refocus — user clicked elsewhere intentionally).
  input.addEventListener('blur', () => setTimeout(() => _commit(false), 80));
}

function _createTileEl(dial) {
  const tile = document.createElement('a');
  tile.className     = 'dial-tile';
  tile.dataset.alias = dial.alias;
  tile.title         = dial.url;
  tile.dataset.url   = dial.url;
  tile.href          = dial.url;
  tile.rel           = 'noopener noreferrer';
  tile.draggable     = true;
  tile.setAttribute('aria-label', `${dial.label || dial.alias}: ${dial.url}`);

  const iconEl = buildDialIconElement(dial);
  if (iconEl) tile.appendChild(iconEl);

  const labelEl = document.createElement('span');
  labelEl.className   = 'dial-label';
  labelEl.textContent = dial.label || dial.alias;
  labelEl.addEventListener('click', e => {
    if (!_isEditMode()) return;
    e.preventDefault();
    e.stopPropagation();
    _startInlineLabelEdit(labelEl, dial, tile);
  });
  tile.appendChild(labelEl);

  // ✕ remove button (visible only when #speed-dial.is-edit-mode is active)
  const removeBtn = document.createElement('button');
  removeBtn.className = 'dial-tile-remove';
  removeBtn.setAttribute('aria-label', `Remove ${dial.label || dial.alias}`);
  removeBtn.setAttribute('tabindex', '0');
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (!_isEditMode()) return;
    await removeDial(dial.alias);
  });
  tile.appendChild(removeBtn);

  // ⇄ move-to-category button (edit mode only, when multiple categories exist)
  const moveBtn = document.createElement('button');
  moveBtn.className = 'dial-tile-move';
  moveBtn.setAttribute('aria-label', `Move ${dial.label || dial.alias} to another category`);
  moveBtn.setAttribute('tabindex', '0');
  moveBtn.textContent = '⇄';
  moveBtn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (!_isEditMode()) return;
    if (_movePickerEl?.style.display !== 'none' && _movePickerAnchor === moveBtn) {
      _hideMovePicker();
      return;
    }
    await _showMovePicker(dial.alias, moveBtn);
  });
  tile.appendChild(moveBtn);

  // [···] advanced button (edit mode only) — opens side sheet for icon/URL/delete
  const advBtn = document.createElement('button');
  advBtn.className = 'dial-tile-advanced';
  advBtn.setAttribute('aria-label', `Advanced options for ${dial.label || dial.alias}`);
  advBtn.setAttribute('tabindex', '0');
  advBtn.textContent = '[···]';
  advBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (!_isEditMode()) return;
    showDialSideSheet(dial.alias);
  });
  tile.appendChild(advBtn);

  bindDragEvents(tile, dial);
  let _clickTimer = null;
  tile.addEventListener('click', e => {
    if (_isDraggingDial) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (_isEditMode()) {
      // Inline-first rename: single click anywhere on the tile in manage mode.
      _startInlineLabelEdit(labelEl, dial, tile);
      return;
    }
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; return; }
    _clickTimer = setTimeout(() => {
      _clickTimer = null;
      if (dial.url) window.open(dial.url, '_blank', 'noopener,noreferrer');
    }, 120);
  });
  tile.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    if (_isEditMode()) return; // inline-first: single click already triggered rename
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    showDialSideSheet(dial.alias);
  });

  // ── Keyboard reordering: Shift+Alt+← / Shift+Alt+→ ──────────
  tile.addEventListener('keydown', async e => {
    // Escape from tile grid → return focus to cmd-input
    if (e.key === 'Escape' && !_isEditMode()) {
      e.preventDefault();
      document.getElementById('cmd-input')?.focus();
      return;
    }
    // Block keyboard link-navigation in manage mode.
    // Enter triggers inline rename; Space is suppressed entirely so it
    // cannot activate the <a> href while the grid is being organised.
    if (_isEditMode() && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') _startInlineLabelEdit(labelEl, dial, tile);
      return;
    }
    if (!e.altKey || !e.shiftKey) return;
    const isLeft  = e.key === 'ArrowLeft';
    const isRight = e.key === 'ArrowRight';
    const isUp    = e.key === 'ArrowUp';
    const isDown  = e.key === 'ArrowDown';
    if (!isLeft && !isRight && !isUp && !isDown) return;
    e.preventDefault();
    e.stopPropagation();
    if (isUp || isDown) {
      // Move to previous / next category (Shift+Alt+↑ / Shift+Alt+↓)
      const store   = await loadDialStore();
      const cats    = store.categories;
      const currIdx = cats.findIndex(c => c.items.some(i => i.alias === dial.alias));
      if (currIdx === -1) return;
      const nextIdx = isUp ? currIdx - 1 : currIdx + 1;
      if (nextIdx < 0 || nextIdx >= cats.length) return;
      await _moveDialToCategory(dial.alias, cats[nextIdx].id);
    } else {
      // Move within flat array (reorder position, Shift+Alt+← / Shift+Alt+→)
      const dials    = await loadDials();
      const fromIdx  = dials.findIndex(d => d.alias === dial.alias);
      if (fromIdx === -1) return;
      const toIdx    = isLeft ? fromIdx - 1 : fromIdx + 1;
      if (toIdx < 0 || toIdx >= dials.length) return;
      await saveDials(_arrayMove(dials, fromIdx, toIdx));
      await renderDials();
    }
    // Restore focus and show movement flash on the relocated tile
    const movedEl = dialGridEl.querySelector(`.dial-tile[data-alias="${dial.alias}"]`);
    if (movedEl) {
      movedEl.focus();
      movedEl.classList.remove('dial-tile--moved'); // reset if already animating
      void movedEl.offsetWidth;                     // force reflow to restart animation
      movedEl.classList.add('dial-tile--moved');
      movedEl.addEventListener('animationend', () => movedEl.classList.remove('dial-tile--moved'), { once: true });
    }
  });

  tile._dialData = { ...dial };
  return tile;
}

function _patchTileEl(tile, dial) {
  const prev = tile._dialData ?? {};
  if (prev.url !== dial.url) { tile.href = dial.url; tile.title = dial.url; tile.dataset.url = dial.url; }
  const label     = dial.label  || dial.alias;
  const prevLabel = prev.label  || prev.alias;
  if (prevLabel !== label) {
    const labelEl = tile.querySelector('.dial-label');
    if (labelEl) labelEl.textContent = label;
  }
  if (prev.url !== dial.url || prevLabel !== label)
    tile.setAttribute('aria-label', `${label}: ${dial.url}`);

  const prevIconVal  = normalizeDialIcon(prev.icon);
  const newIconVal   = normalizeDialIcon(dial.icon);
  const iconKeyChanged = prevIconVal !== newIconVal || prevLabel !== label || prev.url !== dial.url;
  if (iconKeyChanged) {
    const oldIconEl = tile.querySelector('.dial-favicon, .dial-icon-text, .dial-letter-icon');
    const newIconEl = buildDialIconElement(dial);
    if (oldIconEl && newIconEl) oldIconEl.replaceWith(newIconEl);
    else if (oldIconEl) oldIconEl.remove();
    else if (newIconEl) tile.prepend(newIconEl);
  }
  tile._dialData = { ...dial };
}

// ── Section element factories ────────────────────────────────────────────────
// Each DialStore category maps to a .dial-section wrapper containing an
// optional .dial-group-header (named categories only) and a .dial-section-body
// flex grid.  Collapse state is toggled directly on the body — no positional
// DOM-walking needed.

const _sectionNodeCache = new Map(); // catId → .dial-section element

function _createSectionEl(cat) {
  const sectionEl        = document.createElement('div');
  sectionEl.className    = 'dial-section';
  sectionEl.dataset.catId = cat.id;
  if (cat.label) sectionEl.appendChild(_createSectionHeaderEl(cat));

  const bodyEl       = document.createElement('div');
  bodyEl.className   = 'dial-section-body';

  // ── Empty-category drop slot ──────────────────────────────────────────────
  // Shown (via CSS) only for named sections with no items while manage mode
  // is active.  Acts as a large-target drop zone for cross-category moves.
  if (cat.label) {
    const emptySlot = document.createElement('div');
    emptySlot.className = 'dial-section-empty-slot';
    emptySlot.setAttribute('aria-hidden', 'true');
    emptySlot.textContent = '[ DROP HERE ]';
    emptySlot.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      emptySlot.classList.add('is-over');
      bodyEl.classList.add('is-drop-target');
    });
    emptySlot.addEventListener('dragleave', e => {
      if (!bodyEl.contains(e.relatedTarget)) {
        emptySlot.classList.remove('is-over');
        bodyEl.classList.remove('is-drop-target');
      }
    });
    emptySlot.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      emptySlot.classList.remove('is-over');
      bodyEl.classList.remove('is-drop-target');
      const fromAlias = e.dataTransfer?.getData('text/plain');
      if (fromAlias) await _moveDialToCategory(fromAlias, cat.id);
    });
    bodyEl.appendChild(emptySlot);
  }

  // ── Section-body category drop target ─────────────────────────────────────
  // Accepts a tile dropped directly on the body (not on a child tile) and
  // moves it to the end of this category.  Tile-to-tile drops are handled by
  // the individual tile drop handler (which calls stopPropagation).
  bodyEl.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    bodyEl.classList.add('is-drop-target');
  });
  bodyEl.addEventListener('dragleave', e => {
    if (!bodyEl.contains(e.relatedTarget)) bodyEl.classList.remove('is-drop-target');
  });
  bodyEl.addEventListener('drop', async e => {
    bodyEl.classList.remove('is-drop-target');
    // Tile-level handlers use stopPropagation, so this fires only for
    // drops that land on the body itself (between tiles or on cleared space).
    if (e.target.closest('.dial-tile, .dial-group-header')) return;
    e.preventDefault();
    e.stopPropagation();
    hideDropIndicator();
    dialGridEl.classList.remove('is-dragging-dial');
    const fromAlias = e.dataTransfer?.getData('text/plain');
    if (!fromAlias) return;
    if (await _commitPlaceholderDrop(fromAlias)) {
      await renderDials();
      return;
    }
    if (cat.label) await _moveDialToCategory(fromAlias, cat.id);
  });

  sectionEl.appendChild(bodyEl);

  sectionEl._catData   = { id: cat.id, label: cat.label };
  sectionEl._itemCount = 0;
  return sectionEl;
}

/** Build the .dial-group-header element for a named category. */
function _createSectionHeaderEl(cat) {
  const _fakeDial = { alias: cat.id, label: cat.label, type: 'group-header' };

  const el         = document.createElement('div');
  el.className     = 'dial-group-header';
  el.dataset.alias = cat.id;
  el.draggable     = true;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'true');
  el.setAttribute('tabindex', '0');
  el.title = 'Click to collapse/expand — right-click to rename/remove';

  const chevron = document.createElement('span');
  chevron.className = 'dial-group-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▼';

  const labelEl = document.createElement('span');
  labelEl.className   = 'dial-group-label';
  labelEl.textContent = cat.label;
  labelEl.addEventListener('click', e => {
    if (!_isEditMode()) return;
    e.preventDefault();
    e.stopPropagation();
    _startInlineLabelEdit(labelEl, _fakeDial, el);
  });

  const countEl = document.createElement('span');
  countEl.className = 'dial-group-count';
  countEl.setAttribute('aria-hidden', 'true');

  // [+] button: open composer pre-targeted to this category
  const addBtn = document.createElement('button');
  addBtn.className = 'dial-group-add dial-toolbar-btn';
  addBtn.textContent = '[+]';
  addBtn.setAttribute('aria-label', `Add link to ${cat.label}`);
  addBtn.setAttribute('title', `Add link to ${cat.label}`);
  addBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openComposer({ categoryId: cat.id });
  });

  el.appendChild(chevron);
  el.appendChild(labelEl);
  el.appendChild(countEl);
  el.appendChild(addBtn);

  // [···] advanced button (edit mode only) — opens side sheet for category danger actions
  const catAdvBtn = document.createElement('button');
  catAdvBtn.className = 'dial-group-advanced';
  catAdvBtn.setAttribute('aria-label', `Advanced options for category ${cat.label}`);
  catAdvBtn.setAttribute('tabindex', '-1');
  catAdvBtn.textContent = '[···]';
  catAdvBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    showDialSideSheet(cat.id);
  });
  el.appendChild(catAdvBtn);

  el.addEventListener('click', e => {
    if (_isDraggingDial) return;
    e.stopPropagation();
    if (_isEditMode()) {
      // Inline-first rename: single click on the header in manage mode.
      _startInlineLabelEdit(labelEl, _fakeDial, el);
      return;
    }
    _toggleGroupCollapse(cat.id);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // In manage mode, keyboard activation renames rather than
      // toggling collapse, matching the click behaviour.
      if (_isEditMode()) _startInlineLabelEdit(labelEl, _fakeDial, el);
      else _toggleGroupCollapse(cat.id);
    }
  });
  el.addEventListener('dblclick', e => {
    if (_isDraggingDial) return;
    e.stopPropagation();
    if (_isEditMode()) return; // inline-first: single click already triggered rename
    showDialSideSheet(cat.id);
  });

  bindDragEvents(el, _fakeDial, { isGroupHeader: true });

  // Hover-to-expand: when a tile is dragged over this (collapsed) header
  // during a mouse drag, expand the section after 600 ms so the user can
  // drop into it — saves the round-trip of manually uncollapsing first.
  el.addEventListener('dragenter', e => {
    if (!e.dataTransfer?.types.includes('text/plain')) return;
    const bodyEl = el.closest('.dial-section')?.querySelector('.dial-section-body');
    if (!bodyEl || bodyEl.style.display !== 'none') return; // already expanded
    if (_hoverExpandCatId === cat.id) return;               // timer already running
    _cancelHoverExpand();
    _hoverExpandCatId = cat.id;
    el.classList.add('is-drag-hover');
    _hoverExpandTimer = setTimeout(() => {
      _hoverExpandTimer = null;
      el.classList.remove('is-drag-hover');
      _triggerHoverExpand(cat.id);
    }, 600);
  });
  el.addEventListener('dragleave', e => {
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    _cancelHoverExpand();
  });

  el._dialData = { ..._fakeDial };
  return el;
}

/** Patch an existing .dial-section when its category metadata changes. */
function _patchSectionEl(sectionEl, cat) {
  if (sectionEl._catData?.label === cat.label) return;
  if (cat.label) {
    let headerEl = sectionEl.querySelector(':scope > .dial-group-header');
    if (!headerEl) {
      // Unnamed category just gained a label — insert a fresh header.
      headerEl = _createSectionHeaderEl(cat);
      sectionEl.insertBefore(headerEl, sectionEl.querySelector('.dial-section-body'));
    } else if (headerEl.querySelector('.dial-group-label')?.dataset.editing !== '1') {
      const labelEl = headerEl.querySelector('.dial-group-label');
      if (labelEl) labelEl.textContent = cat.label;
      headerEl._dialData = { alias: cat.id, label: cat.label, type: 'group-header' };
    }
  } else {
    // Named category lost its label — drop the header row.
    sectionEl.querySelector(':scope > .dial-group-header')?.remove();
  }
  sectionEl._catData = { id: cat.id, label: cat.label };
}

// ── Group collapse ────────────────────────────────────────────────────────────

async function _toggleGroupCollapse(catId) {
  const stored  = await chrome.storage.local.get({ dialGroupCollapsed: {} });
  const state   = stored.dialGroupCollapsed;
  state[catId]  = !state[catId];
  await chrome.storage.local.set({ dialGroupCollapsed: state });
  _applyGroupCollapse(state);
}

/**
 * Apply collapse state to every named section.
 * Count is sourced from sectionEl._itemCount — always fresh after renderDials.
 * @param {Record<string,boolean>} [collapseState]
 */
async function _applyGroupCollapse(collapseState) {
  if (!collapseState) {
    const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
    collapseState = stored.dialGroupCollapsed;
  }

  for (const [catId, sectionEl] of _sectionNodeCache) {
    const headerEl = sectionEl.querySelector(':scope > .dial-group-header');
    if (!headerEl) continue; // unnamed section — cannot collapse

    const collapsed = collapseState[catId] === true;
    const bodyEl    = sectionEl.querySelector('.dial-section-body');
    if (bodyEl) bodyEl.style.display = collapsed ? 'none' : '';

    const chevron = headerEl.querySelector('.dial-group-chevron');
    if (chevron) chevron.textContent = collapsed ? '▶' : '▼';
    headerEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    headerEl.dataset.collapsed = collapsed ? '1' : '';

    const countSpan = headerEl.querySelector('.dial-group-count');
    if (countSpan) countSpan.textContent = collapsed ? ` (${sectionEl._itemCount ?? 0})` : '';
  }
}

// ── Keyed node cache ──────────────────────────────────────────────────────────
const _dialNodeCache = new Map(); // alias → tile element

// ── Search no-results placeholder ────────────────────────────────────────────
let _noResultsEl = null;

function _ensureNoResults() {
  if (_noResultsEl) return _noResultsEl;
  _noResultsEl = document.createElement('div');
  _noResultsEl.className = 'dial-no-results';
  _noResultsEl.setAttribute('role', 'status');
  _noResultsEl.setAttribute('aria-live', 'polite');
  _noResultsEl.style.display = 'none';
  return _noResultsEl;
}

// ── renderDials (incremental / diffing) ──────────────────────────────────────

/**
 * Sync #speed-dial to the current DialStore without wiping the grid.
 *
 * Reads categories directly from the versioned DialStore so each section
 * header carries the real name, item count, and collapse state — no positional
 * group-header rows needed.
 */
export async function renderDials() {
  const store = await loadDialStore();
  const { dialGroupCollapsed: collapseState = {} } =
    await chrome.storage.local.get({ dialGroupCollapsed: {} });

  // ── Build / patch section elements in stable category order ───────────────
  const desiredAliases  = new Set();
  const desiredSections = store.categories.map(cat => {
    let sectionEl = _sectionNodeCache.get(cat.id);
    if (!sectionEl) {
      sectionEl = _createSectionEl(cat);
      _sectionNodeCache.set(cat.id, sectionEl);
    } else {
      _patchSectionEl(sectionEl, cat);
    }
    sectionEl._itemCount = cat.items.length;
    sectionEl.classList.toggle('dial-section--empty', cat.items.length === 0);

    const bodyEl = sectionEl.querySelector('.dial-section-body');

    // ── Build / patch tile elements for this category's body ─────────────
    const desiredTileEls = cat.items.map(item => {
      desiredAliases.add(item.alias);
      const dial = { alias: item.alias, label: item.label, url: item.url, type: item.type };
      if (item.icon) dial.icon = item.icon;
      dial._faviconUrl = getFaviconUrl(dial);

      const cached = _dialNodeCache.get(item.alias);
      if (cached) {
        if (item.type === 'weather') _patchWeatherTileEl(cached, dial);
        else                         _patchTileEl(cached, dial);
        return cached;
      }
      const el = item.type === 'weather'
        ? _createWeatherTileEl(dial, bindDragEvents)
        : _createTileEl(dial);
      _dialNodeCache.set(item.alias, el);
      return el;
    });

    // The "+" add-tile lives at the end of the first unnamed (default) section.
    if (!cat.label) desiredTileEls.push(_ensureAddTile());

    // Diff the body children in place.
    for (let i = 0; i < desiredTileEls.length; i++) {
      const cur = bodyEl.children[i];
      if (cur !== desiredTileEls[i]) bodyEl.insertBefore(desiredTileEls[i], cur ?? null);
    }
    while (bodyEl.children.length > desiredTileEls.length) bodyEl.removeChild(bodyEl.lastChild);

    return sectionEl;
  });

  // ── Evict removed tile elements ────────────────────────────────────────────
  for (const [alias, el] of _dialNodeCache) {
    if (!desiredAliases.has(alias)) {
      el.remove();
      _dialNodeCache.delete(alias);
      if (_weatherIntervals.has(alias)) {
        clearInterval(_weatherIntervals.get(alias));
        _weatherIntervals.delete(alias);
      }
    }
  }

  // ── Evict removed section elements ────────────────────────────────────────
  const desiredCatIds = new Set(desiredSections.map(s => s.dataset.catId));
  for (const [catId, el] of _sectionNodeCache) {
    if (!desiredCatIds.has(catId)) { el.remove(); _sectionNodeCache.delete(catId); }
  }

  // ── Diff section order in the grid ────────────────────────────────────────
  for (let i = 0; i < desiredSections.length; i++) {
    const cur = dialGridEl.children[i];
    if (cur !== desiredSections[i]) dialGridEl.insertBefore(desiredSections[i], cur ?? null);
  }
  while (dialGridEl.children.length > desiredSections.length) dialGridEl.removeChild(dialGridEl.lastChild);

  // If every category is named the add-tile has no unnamed body to live in;
  // append it standalone after all sections.
  if (store.categories.every(c => c.label)) dialGridEl.appendChild(_ensureAddTile());

  // ── Empty state ──────────────────────────────────────────────────────────
  const _totalItems = store.categories.reduce((n, c) => n + c.items.length, 0);
  const _emptyEl    = _ensureEmptyState();
  if (_totalItems === 0) {
    if (!_emptyEl.parentElement) dialGridEl.appendChild(_emptyEl);
    _emptyEl.style.display = '';
  } else {
    _emptyEl.style.display = 'none';
  }

  // ── Grid-level DnD (one-time bind) ────────────────────────────────────────
  if (!dialGridEl.dataset.dndBound) {
    dialGridEl.dataset.dndBound = '1';

    dialGridEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!e.target.closest('.dial-tile, .dial-group-header')) previewDropAtEnd();
    });

    dialGridEl.addEventListener('drop', async e => {
      const tile = e.target.closest('.dial-tile, .dial-group-header');
      if (tile) return;
      e.preventDefault();
      e.stopPropagation();
      hideDropIndicator();
      dialGridEl.classList.remove('is-dragging-dial');
      const fromAlias = e.dataTransfer?.getData('text/plain');
      if (!fromAlias) return;
      if (await _commitPlaceholderDrop(fromAlias)) {
        await renderDials();
        return;
      }
      const current   = await loadDials();
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      if (fromIndex === -1) return;
      await _moveDialAliasToIndex(current, fromAlias, current.length - 1);
    });
  }

  await _applyGroupCollapse(collapseState);

  // ── Toolbar: refresh chips + apply active filter ─────────────────────────
  refreshToolbarChips(store.categories);
  // Show the ⇄ move button only when multiple categories exist.
  dialGridEl.classList.toggle('has-multi-cats', store.categories.some(c => c.label));
  _applyDialFilter();
}

// ── Dial toolbar filter application ──────────────────────────────────────────

/**
 * Post-pass over the cached section / tile elements: apply category and
 * search filters by toggling inline display.  Runs after every renderDials.
 */
function _applyDialFilter() {
  const { search, category } = getDialFilter();
  const q = search.toLowerCase();

  for (const [catId, sectionEl] of _sectionNodeCache) {
    const hidden = category !== null && catId !== category;
    sectionEl.style.display = hidden ? 'none' : '';
  }

  // Hide the persistent "+" add-tile during an active search so it doesn't
  // appear as a phantom result when every real tile is filtered out.
  if (_addTileEl) _addTileEl.style.display = q ? 'none' : '';

  const noResultsEl = _ensureNoResults();
  if (!noResultsEl.parentElement) dialGridEl.appendChild(noResultsEl);

  if (!q) {
    // Clear any search-hiding on all tiles
    for (const [, el] of _dialNodeCache) el.style.display = '';
    noResultsEl.style.display = 'none';
    return;
  }

  let visibleCount = 0;
  for (const [, el] of _dialNodeCache) {
    const d = el._dialData;
    if (!d) continue;
    // Respect the category filter: a tile whose section is hidden should not
    // count as "visible" even if it matches the search query.
    const sectionHidden = el.closest('.dial-section')?.style.display === 'none';
    const label = (d.label || d.alias || '').toLowerCase();
    const url   = (d.url   || '').toLowerCase();
    const matches = label.includes(q) || url.includes(q);
    el.style.display = (matches && !sectionHidden) ? '' : 'none';
    if (matches && !sectionHidden) visibleCount++;
  }

  if (visibleCount === 0) {
    noResultsEl.textContent = `NO MATCHES FOR \u201c${search.toUpperCase()}\u201d`;
    noResultsEl.style.display = '';
  } else {
    noResultsEl.style.display = 'none';
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────

export const ctxMenuEl = (() => {
  const menu = document.createElement('div');
  menu.id = 'dial-ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-hidden', 'true');

  function makeBtn(text, action) {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('tabindex', '-1');
    btn.textContent = text;
    if (action) btn.dataset.action = action;
    return btn;
  }

  const openTabBtn = makeBtn('Open in new tab', 'open-tab');
  openTabBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    const dials = await loadDials();
    const dial  = dials.find(d => d.alias === alias);
    if (dial?.url) window.open(dial.url, '_blank');
  });

  const editBtn = makeBtn('Advanced\u2026', 'edit');
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    showDialSideSheet(alias);
  });

  const removeBtn = makeBtn('Remove');
  removeBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    await removeDial(alias);
  });

  const refreshWeatherBtn = makeBtn('Refresh weather', 'refresh-weather');
  refreshWeatherBtn.style.display = 'none';
  refreshWeatherBtn.addEventListener('click', e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    const el = _dialNodeCache.get(alias);
    if (el) _refreshWeatherTile(el);
  });

  // ── "Move to group" submenu item ──────────────────────────────────────────
  const moveToGroupItem = document.createElement('div');
  moveToGroupItem.className = 'ctx-menu-item ctx-menu-item--has-sub';
  moveToGroupItem.setAttribute('role', 'menuitem');
  moveToGroupItem.setAttribute('aria-haspopup', 'true');
  moveToGroupItem.setAttribute('tabindex', '-1');
  moveToGroupItem.dataset.action = 'move-to-group';
  moveToGroupItem.style.display = 'none';

  const moveToGroupLabel = document.createElement('span');
  moveToGroupLabel.textContent = 'Move to group \u25B6';
  moveToGroupItem.appendChild(moveToGroupLabel);

  const groupSubmenu = document.createElement('div');
  groupSubmenu.id = 'dial-ctx-group-submenu';
  groupSubmenu.setAttribute('role', 'menu');
  moveToGroupItem.appendChild(groupSubmenu);

  let _subHideTimer = null;
  function _showGroupSub() {
    if (_subHideTimer) { clearTimeout(_subHideTimer); _subHideTimer = null; }
    groupSubmenu.classList.add('visible');
    requestAnimationFrame(() => {
      const r = groupSubmenu.getBoundingClientRect();
      if (r.right > window.innerWidth) {
        groupSubmenu.style.left  = 'auto';
        groupSubmenu.style.right = '100%';
      } else {
        groupSubmenu.style.left  = '100%';
        groupSubmenu.style.right = 'auto';
      }
    });
  }
  function _hideGroupSub() {
    _subHideTimer = setTimeout(() => groupSubmenu.classList.remove('visible'), 120);
  }

  moveToGroupItem.addEventListener('mouseenter', _showGroupSub);
  moveToGroupItem.addEventListener('mouseleave', _hideGroupSub);
  groupSubmenu.addEventListener('mouseenter', () => {
    if (_subHideTimer) { clearTimeout(_subHideTimer); _subHideTimer = null; }
  });
  groupSubmenu.addEventListener('mouseleave', _hideGroupSub);
  moveToGroupLabel.addEventListener('click', e => {
    e.stopPropagation();
    groupSubmenu.classList.contains('visible') ? _hideGroupSub() : _showGroupSub();
  });

  // ── "Ungroup" button ──────────────────────────────────────────────────
  const ungroupBtn = makeBtn('Ungroup', 'ungroup');
  ungroupBtn.style.display = 'none';
  ungroupBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    const dialsArr    = await loadDials();
    const dialIdx     = dialsArr.findIndex(d => d.alias === alias);
    if (dialIdx === -1) return;
    const firstGrpIdx = dialsArr.findIndex(d => d.type === 'group-header');
    if (firstGrpIdx === -1 || dialIdx < firstGrpIdx) return;
    const [moved] = dialsArr.splice(dialIdx, 1);
    // Insert just before the first group-header (re-find after splice)
    const insertAt = dialsArr.findIndex(d => d.type === 'group-header');
    if (insertAt === -1) dialsArr.push(moved);
    else dialsArr.splice(insertAt, 0, moved);
    await saveDials(dialsArr);
    await renderDials();
  });

  menu.appendChild(openTabBtn);
  menu.appendChild(editBtn);
  menu.appendChild(moveToGroupItem);
  menu.appendChild(ungroupBtn);
  menu.appendChild(refreshWeatherBtn);
  menu.appendChild(removeBtn);
  document.body.appendChild(menu);
  return menu;
})();

export function showDialCtxMenu(x, y, alias, isDivider = false, isWeather = false, isGroupHeader = false) {
  ctxMenuEl.dataset.target = alias;
  const ctxEditBtn           = ctxMenuEl.querySelector('[data-action="edit"]');
  const ctxOpenTabBtn        = ctxMenuEl.querySelector('[data-action="open-tab"]');
  const ctxRefreshWeatherBtn = ctxMenuEl.querySelector('[data-action="refresh-weather"]');
  const ctxMoveToGroupItem   = ctxMenuEl.querySelector('[data-action="move-to-group"]');
  const ctxUngroupBtn        = ctxMenuEl.querySelector('[data-action="ungroup"]');
  if (ctxEditBtn)           ctxEditBtn.style.display           = isDivider ? 'none' : '';
  if (ctxOpenTabBtn)        ctxOpenTabBtn.style.display        = (isDivider || isGroupHeader) ? 'none' : '';
  if (ctxRefreshWeatherBtn) ctxRefreshWeatherBtn.style.display = isWeather ? '' : 'none';
  if (ctxMoveToGroupItem)   _populateMoveToGroupSubmenu(alias, isDivider, isGroupHeader, ctxMoveToGroupItem);
  if (ctxUngroupBtn)        _updateUngroupBtn(alias, isDivider, isGroupHeader, ctxUngroupBtn);
  ctxMenuEl.style.left = `${x}px`;
  ctxMenuEl.style.top  = `${y}px`;
  ctxMenuEl.classList.add('visible');
  ctxMenuEl.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    const r = ctxMenuEl.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctxMenuEl.style.left = `${x - r.width}px`;
    if (r.bottom > window.innerHeight) ctxMenuEl.style.top  = `${y - r.height}px`;
    const firstItem = ctxMenuEl.querySelector(
      '.ctx-menu-item:not([style*="display: none"]):not([style*="display:none"])'
    );
    if (firstItem) firstItem.focus();
  });
}

export function hideDialCtxMenu() {
  ctxMenuEl.classList.remove('visible');
  ctxMenuEl.setAttribute('aria-hidden', 'true');
  delete ctxMenuEl.dataset.target;
  const sub = ctxMenuEl.querySelector('#dial-ctx-group-submenu');
  if (sub) sub.classList.remove('visible');
}

// ── Move-to-group submenu populate ───────────────────────────────────────────
async function _populateMoveToGroupSubmenu(alias, isDivider, isGroupHeader, itemEl) {
  // Never show for group headers or dividers
  if (isDivider || isGroupHeader) {
    itemEl.style.display = 'none';
    return;
  }
  const submenu = itemEl.querySelector('#dial-ctx-group-submenu');
  submenu.innerHTML = '';
  submenu.classList.remove('visible');

  const dials  = await loadDials();
  const groups = dials.filter(d => d.type === 'group-header');
  if (!groups.length) {
    itemEl.style.display = 'none';
    return;
  }
  itemEl.style.display = '';

  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'ctx-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('tabindex', '-1');
    btn.textContent = g.label || g.alias;
    btn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const targetAlias = ctxMenuEl.dataset.target;
      hideDialCtxMenu();
      const dialsArr = await loadDials();
      const dialIdx  = dialsArr.findIndex(d => d.alias === targetAlias);
      if (dialIdx === -1) return;
      const [moved]     = dialsArr.splice(dialIdx, 1);
      const groupIdx    = dialsArr.findIndex(d => d.alias === g.alias);
      if (groupIdx === -1) return;
      dialsArr.splice(groupIdx + 1, 0, moved);
      await saveDials(dialsArr);
      await renderDials();
    });
    submenu.appendChild(btn);
  });
}

// ── Ungroup button visibility ─────────────────────────────────────────────────
// A dial is "grouped" if it appears after the first group-header in the array.
async function _updateUngroupBtn(alias, isDivider, isGroupHeader, btnEl) {
  if (isDivider || isGroupHeader) { btnEl.style.display = 'none'; return; }
  const dials       = await loadDials();
  const dialIdx     = dials.findIndex(d => d.alias === alias);
  const firstGrpIdx = dials.findIndex(d => d.type === 'group-header');
  btnEl.style.display = (firstGrpIdx !== -1 && dialIdx > firstGrpIdx) ? '' : 'none';
}

// ── Advanced side-sheet ───────────────────────────────────────────────────────
// Lightweight right-side panel for non-primary fields:
//   link tile    → icon override, URL
//   weather tile → URL
//   category     → destructive delete-category action
// Primary flows (add, rename, move) remain fully inline.

const _sideSheetEl = (() => {
  const wrap = document.createElement('div');
  wrap.id        = 'dial-side-sheet';
  wrap.className = 'dial-side-sheet';
  wrap.setAttribute('role',         'dialog');
  wrap.setAttribute('aria-modal',   'true');
  wrap.setAttribute('aria-labelledby', 'dial-sheet-title-id');
  wrap.style.display = 'none';

  const backdrop = document.createElement('div');
  backdrop.className = 'dial-sheet-backdrop';
  backdrop.addEventListener('click', () => hideDialSideSheet());

  const panel = document.createElement('div');
  panel.className = 'dial-sheet-panel';

  const header = document.createElement('div');
  header.className = 'dial-sheet-header';

  const titleEl = document.createElement('span');
  titleEl.id          = 'dial-sheet-title-id';  // referenced by aria-labelledby
  titleEl.className   = 'dial-sheet-title';
  titleEl.textContent = '· · · ADVANCED';

  const closeBtn = document.createElement('button');
  closeBtn.className   = 'dial-sheet-close';
  closeBtn.textContent = '[×]';
  closeBtn.setAttribute('aria-label', 'Close advanced panel');
  closeBtn.addEventListener('click', () => hideDialSideSheet());

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'dial-sheet-body';

  panel.appendChild(header);
  panel.appendChild(body);
  wrap.appendChild(backdrop);
  wrap.appendChild(panel);

  // ── Focus trap: keep Tab/Shift+Tab inside the panel while it is open ──────
  panel.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab') return;
    const focusable = Array.from(panel.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (ev.shiftKey) {
      if (document.activeElement === first || !panel.contains(document.activeElement)) {
        ev.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !panel.contains(document.activeElement)) {
        ev.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && wrap.style.display !== 'none') {
      e.preventDefault();
      hideDialSideSheet();
    }
  });

  document.body.appendChild(wrap);
  return wrap;
})();

export function hideDialSideSheet() {
  _sideSheetEl.classList.remove('is-open');
  // Wait for the slide-out transition before hiding entirely.
  // Use a fallback timeout in case transitionend never fires
  // (e.g. prefers-reduced-motion or zero-duration transitions).
  let handled = false;
  const finish = () => {
    if (handled) return;
    handled = true;
    if (!_sideSheetEl.classList.contains('is-open')) _sideSheetEl.style.display = 'none';
  };
  _sideSheetEl.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 400);
  inputEl?.focus();
}

/** Backward-compat alias — nothing in the new code calls this but external
 *  callers (e.g. script.js) that import it will still get a safe no-op. */
export const hideDialEditDialog = hideDialSideSheet;

export async function showDialSideSheet(alias) {
  if (!alias) return;
  const dials = await loadDials();
  const dial  = dials.find(d => d.alias === alias);
  if (!dial) return;

  const isWeather     = dial.type === 'weather';
  const isGroupHeader = dial.type === 'group-header';
  const isLink        = !isWeather && !isGroupHeader;

  // Set header title
  const titleEl = _sideSheetEl.querySelector('.dial-sheet-title');
  if (isGroupHeader) titleEl.textContent = '· CATEGORY';
  else if (isWeather) titleEl.textContent = '· WEATHER';
  else titleEl.textContent = '· · · ADVANCED';

  // Rebuild body
  const body = _sideSheetEl.querySelector('.dial-sheet-body');
  body.innerHTML = '';

  // ── Editable fields (link and weather tiles) ──────────────────────────────
  if (isLink || isWeather) {
    let errorEl;

    if (isLink) {
      // Icon override field
      const iconField = document.createElement('div');
      iconField.className = 'dial-sheet-field';
      const iconLbl = document.createElement('label');
      iconLbl.className = 'dial-sheet-label';
      iconLbl.htmlFor   = 'dial-sheet-icon';
      iconLbl.textContent = 'ICON OVERRIDE';
      const iconInput = document.createElement('input');
      iconInput.id          = 'dial-sheet-icon';
      iconInput.className   = 'dial-sheet-input';
      iconInput.placeholder = 'emoji · short text · image URL — blank = auto';
      iconInput.autocomplete = 'off';
      iconInput.spellcheck   = false;
      iconInput.value        = dial.icon || '';
      iconField.appendChild(iconLbl);
      iconField.appendChild(iconInput);
      body.appendChild(iconField);
    }

    // URL field
    const urlField = document.createElement('div');
    urlField.className = 'dial-sheet-field';
    const urlLbl = document.createElement('label');
    urlLbl.className    = 'dial-sheet-label';
    urlLbl.htmlFor      = 'dial-sheet-url';
    urlLbl.textContent  = 'URL';
    const urlInput = document.createElement('input');
    urlInput.id          = 'dial-sheet-url';
    urlInput.type        = 'url';
    urlInput.className   = 'dial-sheet-input';
    urlInput.placeholder = 'https://…';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck   = false;
    urlInput.value        = dial.url || '';
    urlField.appendChild(urlLbl);
    urlField.appendChild(urlInput);
    body.appendChild(urlField);

    errorEl = document.createElement('div');
    errorEl.className = 'dial-sheet-error';
    errorEl.setAttribute('aria-live', 'assertive');
    body.appendChild(errorEl);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'dial-sheet-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className   = 'dial-edit-btn';
    saveBtn.textContent = '[SAVE]';
    saveBtn.addEventListener('click', async () => {
      errorEl.textContent = '';
      let url = urlInput.value.trim();
      if (!url) { errorEl.textContent = 'URL is required.'; urlInput.focus(); return; }
      if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(url)) url = `https://${url}`;
      if (/^(javascript|data):/i.test(url)) {
        errorEl.textContent = 'URL scheme not allowed.'; return;
      }
      const currentDials = await loadDials();
      const idx = currentDials.findIndex(d => d.alias === alias);
      if (idx === -1) { errorEl.textContent = 'Dial not found.'; return; }
      currentDials[idx].url = url;
      if (isLink) {
        const iconInput = body.querySelector('#dial-sheet-icon');
        const rawIcon   = iconInput ? iconInput.value.trim() : '';
        if (!rawIcon) delete currentDials[idx].icon;
        else currentDials[idx].icon = normalizeDialIcon(rawIcon);
      }
      await saveDials(currentDials);
      await renderDials();
      hideDialSideSheet();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'dial-edit-btn';
    cancelBtn.textContent = '[CANCEL]';
    cancelBtn.addEventListener('click', () => hideDialSideSheet());

    // Enter in any input → save
    urlField.querySelector('input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });
    if (isLink) {
      body.querySelector('#dial-sheet-icon')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      });
    }

    actionsRow.appendChild(saveBtn);
    actionsRow.appendChild(cancelBtn);
    body.appendChild(actionsRow);
  }

  // ── Danger zone ────────────────────────────────────────────────────────────
  const danger = document.createElement('div');
  danger.className = 'dial-sheet-danger';

  if (isGroupHeader) {
    const store    = await loadDialStore();
    const cat      = store.categories.find(c => c.id === alias);
    const count    = cat ? cat.items.length : 0;
    const descEl   = document.createElement('div');
    descEl.className   = 'dial-sheet-danger-desc';
    descEl.textContent = count
      ? `Permanently removes this category and its ${count} dial${count === 1 ? '' : 's'}.`
      : 'Permanently removes this empty category.';

    const delBtn = document.createElement('button');
    delBtn.className   = 'dial-edit-btn dial-edit-btn--delete';
    delBtn.textContent = '[DELETE CATEGORY]';
    delBtn.addEventListener('click', async () => {
      if (count > 0) {
        const msg = `Delete category and its ${count} dial${count === 1 ? '' : 's'}? This cannot be undone.`;
        if (!confirm(msg)) return;
      }
      const s = await loadDialStore();
      s.categories = s.categories.filter(c => c.id !== alias);
      await saveDialStore(s);
      await renderDials();
      hideDialSideSheet();
    });

    danger.appendChild(descEl);
    danger.appendChild(delBtn);
  } else {
    const delBtn = document.createElement('button');
    delBtn.className   = 'dial-edit-btn dial-edit-btn--delete';
    delBtn.textContent = '[DELETE DIAL]';
    delBtn.addEventListener('click', async () => {
      hideDialSideSheet();
      await removeDial(alias);
    });
    danger.appendChild(delBtn);
  }

  body.appendChild(danger);

  // Open the sheet with animation
  _sideSheetEl.style.display = '';
  requestAnimationFrame(() => _sideSheetEl.classList.add('is-open'));

  // Focus first input, or the close button as fallback
  const firstInput = body.querySelector('input');
  requestAnimationFrame(() =>
    (firstInput || _sideSheetEl.querySelector('.dial-sheet-close'))?.focus()
  );
}

// ── Open-current-tab shortcut (Ctrl+Shift+S via background SW) ───────────────
// Called from main.js init() after the background service worker has stored
// the source tab's data in chrome.storage.local as _pendingTabDial.
// Routes through the inline composer (same flow as [+ LINK]).
export async function openCurrentTabDial({ url = '', title = '' } = {}) {
  if (!url) {
    printLine('  Error: no URL found for this tab.', 'line-err');
    return;
  }

  if (/^(chrome|chrome-extension|about|data|javascript):/i.test(url)) {
    printLine('  Cannot create a dial for a Chrome internal page.', 'line-err');
    return;
  }

  // Duplicate-URL check
  const dials = await loadDials();
  const dup   = dials.find(d => d.url && d.url === url);
  if (dup) {
    printLine(`  Dial \u201c${dup.label || dup.alias}\u201d already exists for this URL.`, 'line-info');
    return;
  }

  // Open the inline composer pre-filled with the captured tab's details
  await openComposer({ url, label: title || '' });
}

// ── Undo-delete state ────────────────────────────────────────────────────────
// Holds { dial, index, timer } for the most-recent deletion, or null.
let _undoState = null;


function _hideUndoToast() {
  if (_undoState?.timer) clearTimeout(_undoState.timer);
  _undoState = null;
  if (_undoToastEl) {
    // Animate out, then remove classes after animation ends
    _undoToastEl.classList.add('toast-hiding');
    _undoToastEl.classList.remove('visible');
    _undoToastEl.addEventListener('animationend', () => {
      _undoToastEl.classList.remove('toast-hiding');
    }, { once: true });
  }
}

function _showUndoToast(label) {
  if (!_undoToastEl) return;
  // Cancel any previous auto-dismiss timer before replacing the state.
  if (_undoState?.timer) clearTimeout(_undoState.timer);
  if (_undoToastMsg) _undoToastMsg.textContent = `Removed \u201c${label}\u201d \u2014\u00A0`;
  _undoToastEl.classList.add('visible');
  _undoState.timer = setTimeout(_hideUndoToast, 5000);
  // Move keyboard focus to [UNDO] so the user can act without reaching for a mouse.
  requestAnimationFrame(() => _undoToastBtn?.focus());
}

if (_undoToastBtn) {
  _undoToastBtn.addEventListener('click', async () => {
    if (!_undoState) return;
    const { dial, index } = _undoState;
    _hideUndoToast();
    const dials = await loadDials();
    const insertAt = Math.min(index, dials.length);
    dials.splice(insertAt, 0, dial);
    await saveDials(dials);
    await renderDials();
    // Return focus to the restored tile so keyboard users can continue editing.
    requestAnimationFrame(() => {
      dialGridEl.querySelector(`.dial-tile[data-alias="${dial.alias}"]`)?.focus();
    });
  });
}

// ── removeDial ────────────────────────────────────────────────────────────────

export async function removeDial(alias) {
  const dials    = await loadDials();
  const index    = dials.findIndex(d => d.alias === alias);
  const dial     = index !== -1 ? { ...dials[index] } : null;
  const filtered = dials.filter(d => d.alias !== alias);
  await saveDials(filtered);

  const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
  if (alias in stored.dialGroupCollapsed) {
    delete stored.dialGroupCollapsed[alias];
    await chrome.storage.local.set({ dialGroupCollapsed: stored.dialGroupCollapsed });
  }
  await renderDials();

  if (dial) {
    _undoState = { dial, index };
    _showUndoToast(dial.label || dial.alias);
  }
  printLine(`✓ Dial \u201c${alias}\u201d removed.`, 'line-ok');
}

// ── Toolbar wiring (module init) ──────────────────────────────────────────────
// Inject references after all function declarations so the toolbar can call
// back into this module without a circular import.
setDialToolbarDeps({
  renderDials,
  showDialEditDialog: showDialSideSheet,
  toggleDialEditMode,
  isDialEditMode,
  openComposer,
});
initDialToolbar();

// Inject renderDials into the composer so it can refresh the grid after saving.
setComposerDeps({ renderDials });
