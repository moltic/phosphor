// ── ui/dials.js ──────────────────────────────────────────────────────────────
// Speed-dial grid: rendering, DnD, context menu, edit dialog.

import { CONFIG }                   from '../core/config.js';
import { loadDials, saveDials }     from '../core/storage.js';
import { printLine, inputEl }       from '../core/render.js';
import {
  _createWeatherTileEl, _patchWeatherTileEl,
  _refreshWeatherTile, _weatherIntervals,
} from './weather.js';

// ── DOM ref ───────────────────────────────────────────────────────────────────
const dialGridEl = document.getElementById('speed-dial');

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
  if (!icon) return buildLetterIcon(dial);

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
    img.addEventListener('error', () => { img.replaceWith(buildLetterIcon(dial)); });
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
  showDropIndicatorAt(before ? rect.left : rect.right, rect.top, rect.height);
}

function previewDropAtEnd() {
  const items = dialGridEl.querySelectorAll('.dial-tile, .dial-divider, .dial-group-header');
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
let _isDraggingDial = false;

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
 * Bind all drag-and-drop (mouse) and touch (drag + long-press) events to a
 * dial element.
 */
export function bindDragEvents(el, dial, opts = {}) {
  const { isDivider = false, isWeather = false, suppressClick = false, isGroupHeader = false } = opts;

  if (suppressClick) {
    el.addEventListener('click', e => {
      if (_isDraggingDial) { e.preventDefault(); e.stopPropagation(); return; }
      e.stopPropagation();
    });
  }

  // ── Native HTML5 DnD ──────────────────────────────────────────────────────
  el.addEventListener('dragstart', e => {
    _isDraggingDial = true;
    hideDropIndicator();
    el.classList.add('is-dragging');
    dialGridEl.classList.add('is-dragging-dial');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dial.alias);
    } catch { /* ignore */ }
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    setTimeout(() => { _isDraggingDial = false; }, 0);
  });

  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (el.classList.contains('is-dragging')) return;
    previewDropNearElement(dial.alias, el.getBoundingClientRect(), e.clientX);
  });

  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    hideDropIndicator();
    dialGridEl.classList.remove('is-dragging-dial');
    const fromAlias = e.dataTransfer?.getData('text/plain');
    const toAlias   = dial.alias;
    if (!fromAlias || fromAlias === toAlias) return;
    const current   = await loadDials();
    const fromIndex = current.findIndex(d => d.alias === fromAlias);
    const toIndex   = current.findIndex(d => d.alias === toAlias);
    if (fromIndex === -1 || toIndex === -1) return;
    const rect   = el.getBoundingClientRect();
    const before = getPreviewBeforeFor(toAlias, rect, e.clientX);
    let insertIndex = toIndex + (before ? 0 : 1);
    if (fromIndex < insertIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, current.length - 1));
    await saveDials(_arrayMove(current, fromIndex, insertIndex));
    await renderDials();
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
      el.classList.add('is-dragging');
      dialGridEl.classList.add('is-dragging-dial');
      _ghostEl = _createGhost(el, _touchStartX, _touchStartY);
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
        previewDropNearElement(targetEl.dataset.alias, targetEl.getBoundingClientRect(), t.clientX);
      } else {
        hideDropIndicator();
      }
    }
  }, { passive: false });

  async function _finishTouchDrag(changedTouch) {
    if (_ghostEl) { _ghostEl.remove(); _ghostEl = null; }
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    const below    = document.elementFromPoint(changedTouch.clientX, changedTouch.clientY);
    const targetEl = below?.closest('[data-alias]');
    _touchDragging = false;
    setTimeout(() => { _isDraggingDial = false; }, 0);
    if (!targetEl || targetEl === el) return;
    const fromAlias = dial.alias, toAlias = targetEl.dataset.alias;
    if (!fromAlias || fromAlias === toAlias) return;
    const current   = await loadDials();
    const fromIndex = current.findIndex(d => d.alias === fromAlias);
    const toIndex   = current.findIndex(d => d.alias === toAlias);
    if (fromIndex === -1 || toIndex === -1) return;
    const rect   = targetEl.getBoundingClientRect();
    const before = getPreviewBeforeFor(toAlias, rect, changedTouch.clientX);
    let insertIndex = toIndex + (before ? 0 : 1);
    if (fromIndex < insertIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(insertIndex, current.length - 1));
    await saveDials(_arrayMove(current, fromIndex, insertIndex));
    await renderDials();
  }

  el.addEventListener('touchend', e => {
    _cancelLongPress();
    if (!_touchDragging) return;
    _finishTouchDrag(e.changedTouches[0]);
  });

  el.addEventListener('touchcancel', () => {
    _cancelLongPress();
    if (_ghostEl) { _ghostEl.remove(); _ghostEl = null; }
    el.classList.remove('is-dragging');
    dialGridEl.classList.remove('is-dragging-dial');
    hideDropIndicator();
    _touchDragging = false;
    setTimeout(() => { _isDraggingDial = false; }, 0);
  });
}

// ── Element factories ─────────────────────────────────────────────────────────

function _createDividerEl(dial) {
  const isCol    = dial.col === true;
  const dividerEl = document.createElement('div');
  dividerEl.className  = isCol ? 'dial-divider col-divider' : 'dial-divider row-divider';
  dividerEl.dataset.alias = dial.alias;
  dividerEl.draggable  = true;
  dividerEl.title      = isCol
    ? 'Column Divider — drag to reorder, right-click to remove'
    : 'Row Divider — drag to reorder, right-click to remove';
  bindDragEvents(dividerEl, dial, { isDivider: true });
  dividerEl._dialData = { ...dial };
  return dividerEl;
}

function _patchDividerEl(dividerEl, dial) {
  const isCol  = dial.col === true;
  const wasCol = dividerEl.classList.contains('col-divider');
  if (isCol !== wasCol) {
    dividerEl.className = isCol ? 'dial-divider col-divider' : 'dial-divider row-divider';
    dividerEl.title     = isCol
      ? 'Column Divider — drag to reorder, right-click to remove'
      : 'Row Divider — drag to reorder, right-click to remove';
  }
  dividerEl._dialData = { ...dial };
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
  tile.appendChild(labelEl);

  bindDragEvents(tile, dial, { suppressClick: true });
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

// ── Group-header element factories ────────────────────────────────────────────

function _createGroupHeaderEl(dial) {
  const el = document.createElement('div');
  el.className = 'dial-group-header';
  el.dataset.alias = dial.alias;
  el.draggable = true;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', 'true');
  el.setAttribute('tabindex', '0');
  el.title = 'Click to collapse/expand — drag to reorder, right-click to rename/remove';

  const chevron   = document.createElement('span');
  chevron.className = 'dial-group-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▼';

  const labelEl   = document.createElement('span');
  labelEl.className   = 'dial-group-label';
  labelEl.textContent = dial.label || dial.alias;

  el.appendChild(chevron);
  el.appendChild(labelEl);

  el.addEventListener('click', e => {
    if (_isDraggingDial) return;
    e.stopPropagation();
    _toggleGroupCollapse(dial.alias);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _toggleGroupCollapse(dial.alias); }
  });

  bindDragEvents(el, dial, { isGroupHeader: true });
  el._dialData = { ...dial };
  return el;
}

function _patchGroupHeaderEl(el, dial) {
  const prev = el._dialData ?? {};
  if (prev.label !== dial.label) {
    const labelEl = el.querySelector('.dial-group-label');
    if (labelEl) labelEl.textContent = dial.label || dial.alias;
  }
  el._dialData = { ...dial };
}

// ── Group collapse ────────────────────────────────────────────────────────────

async function _toggleGroupCollapse(alias) {
  const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
  const state  = stored.dialGroupCollapsed;
  state[alias] = !state[alias];
  await chrome.storage.local.set({ dialGroupCollapsed: state });
  _applyGroupCollapse(state);
}

async function _applyGroupCollapse(collapseState) {
  if (!collapseState) {
    const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
    collapseState = stored.dialGroupCollapsed;
  }
  let collapsed = false;
  for (const child of dialGridEl.children) {
    if (child.classList.contains('dial-group-header')) {
      const alias   = child.dataset.alias;
      collapsed     = collapseState[alias] === true;
      const chevron = child.querySelector('.dial-group-chevron');
      if (chevron) chevron.textContent = collapsed ? '▶' : '▼';
      child.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      child.dataset.collapsed = collapsed ? '1' : '';
    } else {
      child.style.display = collapsed ? 'none' : '';
    }
  }
}

// ── Keyed node cache ──────────────────────────────────────────────────────────
const _dialNodeCache = new Map();

// ── renderDials (incremental / diffing) ──────────────────────────────────────

/**
 * Sync #speed-dial to the current storage state without wiping the grid.
 */
export async function renderDials() {
  const dials = await loadDials();

  for (const dial of dials) {
    dial._faviconUrl = getFaviconUrl(dial);
  }

  const desiredEls = dials.map(dial => {
    const cached = _dialNodeCache.get(dial.alias);
    if (cached) {
      if      (dial.type === 'divider')      _patchDividerEl(cached, dial);
      else if (dial.type === 'weather')      _patchWeatherTileEl(cached, dial);
      else if (dial.type === 'group-header') _patchGroupHeaderEl(cached, dial);
      else                                   _patchTileEl(cached, dial);
      return cached;
    }
    const el =
      dial.type === 'divider'      ? _createDividerEl(dial) :
      dial.type === 'weather'      ? _createWeatherTileEl(dial, bindDragEvents) :
      dial.type === 'group-header' ? _createGroupHeaderEl(dial) :
                                     _createTileEl(dial);
    _dialNodeCache.set(dial.alias, el);
    return el;
  });

  const desiredAliases = new Set(dials.map(d => d.alias));
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

  for (let i = 0; i < desiredEls.length; i++) {
    const current = dialGridEl.children[i];
    if (current !== desiredEls[i]) dialGridEl.insertBefore(desiredEls[i], current ?? null);
  }

  if (!dialGridEl.dataset.dndBound) {
    dialGridEl.dataset.dndBound = '1';

    dialGridEl.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!e.target.closest('.dial-tile, .dial-divider, .dial-group-header')) previewDropAtEnd();
    });

    dialGridEl.addEventListener('drop', async e => {
      const tile = e.target.closest('.dial-tile, .dial-divider, .dial-group-header');
      if (tile) return;
      e.preventDefault();
      e.stopPropagation();
      hideDropIndicator();
      dialGridEl.classList.remove('is-dragging-dial');
      const fromAlias = e.dataTransfer?.getData('text/plain');
      if (!fromAlias) return;
      const current   = await loadDials();
      const fromIndex = current.findIndex(d => d.alias === fromAlias);
      if (fromIndex === -1) return;
      await _moveDialAliasToIndex(current, fromAlias, current.length - 1);
    });
  }

  await _applyGroupCollapse();
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

  const editBtn = makeBtn('Edit', 'edit');
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const alias = menu.dataset.target;
    hideDialCtxMenu();
    showDialEditDialog(alias);
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

  menu.appendChild(openTabBtn);
  menu.appendChild(editBtn);
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
  if (ctxEditBtn)           ctxEditBtn.style.display           = isDivider ? 'none' : '';
  if (ctxOpenTabBtn)        ctxOpenTabBtn.style.display        = (isDivider || isGroupHeader) ? 'none' : '';
  if (ctxRefreshWeatherBtn) ctxRefreshWeatherBtn.style.display = isWeather ? '' : 'none';
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
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

export const editDialogEl = (() => {
  const overlay = document.createElement('dialog');
  overlay.id = 'dial-edit-dialog';
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'dial-edit-title');

  const inner = document.createElement('div');
  inner.className = 'dial-edit-inner';

  const title = document.createElement('div');
  title.id = 'dial-edit-title'; title.className = 'dial-edit-title'; title.textContent = 'EDIT DIAL';

  const labelInput = document.createElement('input');
  labelInput.id = 'dial-edit-label'; labelInput.placeholder = 'Label';
  labelInput.autocomplete = 'off'; labelInput.spellcheck = false;

  const urlInput = document.createElement('input');
  urlInput.id = 'dial-edit-url'; urlInput.placeholder = 'URL';
  urlInput.autocomplete = 'off'; urlInput.spellcheck = false; urlInput.type = 'url';

  const iconInput = document.createElement('input');
  iconInput.id = 'dial-edit-icon';
  iconInput.placeholder = 'Icon (emoji/text or image URL — blank = letter box)';
  iconInput.autocomplete = 'off'; iconInput.spellcheck = false;

  const actions   = document.createElement('div');
  actions.className = 'dial-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'dial-edit-btn'; saveBtn.textContent = 'SAVE';
  saveBtn.addEventListener('click', e => { e.stopPropagation(); commitDialEdit(); });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'dial-edit-btn'; cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); hideDialEditDialog(); });

  const errorMsg = document.createElement('div');
  errorMsg.id = 'dial-edit-error';

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  inner.appendChild(title); inner.appendChild(labelInput); inner.appendChild(urlInput);
  inner.appendChild(iconInput); inner.appendChild(errorMsg); inner.appendChild(actions);
  overlay.appendChild(inner);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { e.stopPropagation(); hideDialEditDialog(); }
  });
  inner.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitDialEdit(); }
  });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      overlay.querySelectorAll(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus();} }
  });
  overlay.addEventListener('cancel', e => { e.preventDefault(); hideDialEditDialog(); });

  document.body.appendChild(overlay);
  return overlay;
})();

export async function showDialEditDialog(alias) {
  const dials = await loadDials();
  const dial  = dials.find(d => d.alias === alias);
  if (!dial) return;

  const isWeather     = dial.type === 'weather';
  const isGroupHeader = dial.type === 'group-header';

  const titleEl    = editDialogEl.querySelector('.dial-edit-title');
  if (titleEl) titleEl.textContent =
    isWeather ? 'EDIT WEATHER DIAL' : isGroupHeader ? 'RENAME GROUP' : 'EDIT DIAL';

  const labelInput = document.getElementById('dial-edit-label');
  const urlInput   = document.getElementById('dial-edit-url');
  const iconInput  = document.getElementById('dial-edit-icon');
  labelInput.hidden = isWeather;
  urlInput.hidden   = isGroupHeader;
  iconInput.hidden  = isWeather || isGroupHeader;

  editDialogEl.dataset.target        = alias;
  editDialogEl.dataset.isWeather     = isWeather     ? '1' : '';
  editDialogEl.dataset.isGroupHeader = isGroupHeader ? '1' : '';
  labelInput.value = dial.label || dial.alias;
  document.getElementById('dial-edit-url').value  = dial.url  || '';
  iconInput.value = dial.icon || '';

  editDialogEl.showModal();
  labelInput.focus();
}

export function hideDialEditDialog() {
  editDialogEl.close();
  delete editDialogEl.dataset.target;
  delete editDialogEl.dataset.isWeather;
  delete editDialogEl.dataset.isGroupHeader;
  const labelInput = document.getElementById('dial-edit-label');
  const urlInput   = document.getElementById('dial-edit-url');
  const iconInput  = document.getElementById('dial-edit-icon');
  if (labelInput) labelInput.hidden = false;
  if (urlInput)   urlInput.hidden   = false;
  if (iconInput)  iconInput.hidden  = false;
  const titleEl = editDialogEl.querySelector('.dial-edit-title');
  if (titleEl) titleEl.textContent = 'EDIT DIAL';
  document.getElementById('dial-edit-error').textContent = '';
  inputEl.focus();
}

async function commitDialEdit() {
  const alias         = editDialogEl.dataset.target;
  const isWeather     = editDialogEl.dataset.isWeather     === '1';
  const isGroupHeader = editDialogEl.dataset.isGroupHeader === '1';
  if (!alias) return;

  const labelInput = document.getElementById('dial-edit-label');
  const urlInput   = document.getElementById('dial-edit-url');
  const newLabel   = labelInput.value.trim();
  let   newUrl     = urlInput.value.trim();
  const newIconRaw = (isWeather || isGroupHeader) ? '' : document.getElementById('dial-edit-icon').value;
  const newIcon    = normalizeDialIcon(newIconRaw);
  const errorEl    = document.getElementById('dial-edit-error');

  if (isGroupHeader) {
    if (!newLabel) { errorEl.textContent = 'Label is required.'; return; }
  } else if (!isWeather) {
    if (!newLabel && !newUrl) { errorEl.textContent = 'Label and URL are required.'; return; }
    if (!newLabel)            { errorEl.textContent = 'Label is required.'; return; }
  }
  if (!isGroupHeader && !newUrl) { errorEl.textContent = 'URL is required.'; return; }
  errorEl.textContent = '';

  if (!isGroupHeader) {
    if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(newUrl)) newUrl = `https://${newUrl}`;
    if (/^(javascript|data):/i.test(newUrl)) { errorEl.textContent = 'URL scheme not allowed.'; return; }
  }

  const dials = await loadDials();
  const idx   = dials.findIndex(d => d.alias === alias);
  if (idx !== -1) {
    let next;
    if (isGroupHeader) {
      next = { ...dials[idx], label: newLabel };
    } else {
      next = { ...dials[idx], alias, url: newUrl };
      if (!isWeather) {
        next.label = newLabel;
        if (!newIcon) delete next.icon;
        else next.icon = newIcon;
      }
    }
    dials[idx] = next;
    await saveDials(dials);
    await renderDials();
  }
  hideDialEditDialog();
}

// ── removeDial ────────────────────────────────────────────────────────────────

export async function removeDial(alias) {
  const dials    = await loadDials();
  const filtered = dials.filter(d => d.alias !== alias);
  await saveDials(filtered);

  const stored = await chrome.storage.local.get({ dialGroupCollapsed: {} });
  if (alias in stored.dialGroupCollapsed) {
    delete stored.dialGroupCollapsed[alias];
    await chrome.storage.local.set({ dialGroupCollapsed: stored.dialGroupCollapsed });
  }
  await renderDials();
  printLine(`✓ Dial "${alias}" removed.`, 'line-ok');
}
