// ── ui/dial-toolbar.js ────────────────────────────────────────────────────────
// Toolbar rendered above the speed-dial grid:
//   [MANAGE]  [+ LINK]   [SEARCH___________]   [−] MEDIUM [+]
//   [ALL] [Category A] [Category B] …

import { getDialFilter, setDialFilter } from '../core/state.js';
import { loadPrefs, savePrefs }          from '../core/storage.js';
import { applyPrefs, getCachedPrefs }    from './settings.js';

// ── Dependency injection ──────────────────────────────────────────────────────
// dials.js calls setDialToolbarDeps() during its own module init so we can
// reference renderDials / showDialEditDialog without a circular import.

/** @type {(() => Promise<void>) | null} */
let _renderDials        = null;
/** @type {((alias: string | null) => Promise<void>) | null} */
let _showDialEditDialog = null;
/** @type {(() => void) | null} */
let _toggleDialEditMode = null;
/** @type {(() => boolean) | null} */
let _isDialEditMode     = null;
/** @type {((opts?: { categoryId?: string | null }) => Promise<void>) | null} */
let _openComposer       = null;

/**
 * Must be called once from dials.js after all functions are defined.
 * @param {{ renderDials: Function, showDialEditDialog: Function,
 *           toggleDialEditMode: Function, isDialEditMode: Function }} deps
 */
export function setDialToolbarDeps({ renderDials, showDialEditDialog, toggleDialEditMode, isDialEditMode, openComposer }) {
  _renderDials        = renderDials;
  _showDialEditDialog = showDialEditDialog;
  _toggleDialEditMode = toggleDialEditMode;
  _isDialEditMode     = isDialEditMode;
  _openComposer       = openComposer ?? null;
}

// ── Layout-mode helpers ──────────────────────────────────────────────────────
// Cycles through: compact → auto → comfortable (and back)
const LAYOUT_CYCLE = ['compact', 'auto', 'comfortable'];

function _getLayout() {
  return getCachedPrefs()?.dialLayout || 'auto';
}

async function _stepLayout(dir) {
  const cur   = _getLayout();
  const idx   = LAYOUT_CYCLE.indexOf(cur) === -1 ? 1 : LAYOUT_CYCLE.indexOf(cur);
  const next  = LAYOUT_CYCLE[(idx + dir + LAYOUT_CYCLE.length) % LAYOUT_CYCLE.length];
  if (_densityLabel) _densityLabel.textContent = next.toUpperCase();
  const prefs = await loadPrefs();
  prefs.dialLayout = next;
  await savePrefs(prefs);
  await applyPrefs(prefs);
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
let _toolbarEl    = null;
let _manageBtn    = null;
let _searchInput  = null;
let _densityLabel = null;
let _chipsArea    = null;
let _searchTimer  = null;

// ── Search helpers ────────────────────────────────────────────────────────────

function _clearSearch() {
  if (!_searchInput) return;
  _searchInput.value = '';
  const clearBtn = _searchInput.parentElement?.querySelector('.dial-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  setDialFilter({ search: '' });
  _renderDials?.();
}

// ── Manage-button sync ────────────────────────────────────────────────────────

/**
 * Update the [MANAGE] / [DONE] button text and active class to match the
 * current edit-mode state.  Safe to call before the toolbar is built.
 */
export function syncManageBtnExternal() {
  if (!_manageBtn || !_isDialEditMode) return;
  const active = _isDialEditMode();
  _manageBtn.textContent = active ? '[DONE]' : '[MANAGE]';
  _manageBtn.classList.toggle('is-active', active);
  _manageBtn.setAttribute('aria-pressed', String(active));
}

// ── Keys popover builder ────────────────────────────────────────────────────

function _buildKeysPopover() {
  const pop = document.createElement('div');
  pop.className = 'dial-keys-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Keyboard shortcuts reference');

  const title = document.createElement('div');
  title.className = 'dial-keys-popover__title';
  title.textContent = 'KEYBOARD SHORTCUTS';
  pop.appendChild(title);

  const shortcuts = [
    ['↑ / ↓',         'Navigate command history'],
    ['Tab',            'Auto-complete command'],
    ['Ctrl+L / ⌘L',   'Clear current input'],
    ['Ctrl+Shift+S',   'Capture current tab as dial'],
    ['Ctrl+, / ⌘,',   'Open / close settings panel'],
    ['Escape',         'Cancel / clear input'],
    ['Right-click',    'Paste or browser context menu'],
  ];

  const table = document.createElement('table');
  for (const [key, action] of shortcuts) {
    const tr      = document.createElement('tr');
    const tdKey   = document.createElement('td');
    tdKey.className = 'dial-keys-popover__key';
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    tdKey.appendChild(kbd);
    const tdAction = document.createElement('td');
    tdAction.className = 'dial-keys-popover__action';
    tdAction.textContent = action;
    tr.appendChild(tdKey);
    tr.appendChild(tdAction);
    table.appendChild(tr);
  }
  pop.appendChild(table);

  return pop;
}

// ── Toolbar builder ───────────────────────────────────────────────────────────

/** Build the toolbar element exactly once. */
function _buildToolbar() {
  if (_toolbarEl) return _toolbarEl;

  const bar = document.createElement('div');
  bar.id = 'dial-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Dial controls');

  // ── Left group: action buttons ──────────────────────────────────────────────
  const leftGroup = document.createElement('div');
  leftGroup.className = 'dial-toolbar-group';

  _manageBtn = document.createElement('button');
  _manageBtn.className = 'dial-toolbar-btn';
  _manageBtn.textContent = '[MANAGE]';
  _manageBtn.setAttribute('aria-label', 'Toggle edit mode');
  _manageBtn.setAttribute('aria-pressed', 'false');
  _manageBtn.addEventListener('click', () => {
    _toggleDialEditMode?.();
    syncManageBtnExternal();
  });

  const addLinkBtn = document.createElement('button');
  addLinkBtn.className = 'dial-toolbar-btn';
  addLinkBtn.textContent = '[+ LINK]';
  addLinkBtn.setAttribute('aria-label', 'Add new speed-dial link');
  addLinkBtn.addEventListener('click', () => {
    if (_openComposer) _openComposer();
    else _showDialEditDialog?.(null);
  });

  const keysBtn = document.createElement('button');
  keysBtn.className = 'dial-toolbar-btn dial-toolbar-btn--keys';
  keysBtn.textContent = '[?]';
  keysBtn.setAttribute('aria-label', 'Show keyboard shortcuts');
  keysBtn.setAttribute('aria-expanded', 'false');

  leftGroup.appendChild(_manageBtn);
  leftGroup.appendChild(addLinkBtn);
  leftGroup.appendChild(keysBtn);

  // ── Search input ─────────────────────────────────────────────────────────────
  const searchWrap = document.createElement('div');
  searchWrap.className = 'dial-toolbar-search';

  _searchInput = document.createElement('input');
  _searchInput.type        = 'text';
  _searchInput.id          = 'dial-search-input';
  _searchInput.placeholder = 'SEARCH\u2026';
  _searchInput.autocomplete = 'off';
  _searchInput.autocorrect  = 'off';
  _searchInput.spellcheck   = false;
  _searchInput.setAttribute('aria-label', 'Live-filter dials by name or URL');

  const clearBtn = document.createElement('button');
  clearBtn.className = 'dial-search-clear';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '\u2715';
  clearBtn.style.display = 'none';
  clearBtn.addEventListener('click', _clearSearch);

  _searchInput.addEventListener('input', () => {
    clearBtn.style.display = _searchInput.value ? '' : 'none';
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      setDialFilter({ search: _searchInput.value.trim() });
      _renderDials?.();
    }, 130);
  });

  _searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _clearSearch();
    }
  });

  // Prevent the search input from accidentally submitting commands to the
  // terminal's cmd-input handler (search is self-contained).
  _searchInput.addEventListener('focus', e => e.stopPropagation());

  searchWrap.appendChild(_searchInput);
  searchWrap.appendChild(clearBtn);

  // ── Density control ───────────────────────────────────────────────────────────
  const densityGroup = document.createElement('div');
  densityGroup.className = 'dial-toolbar-group dial-toolbar-group--density';

  const densityDown = document.createElement('button');
  densityDown.className = 'dial-toolbar-btn dial-toolbar-btn--icon';
  densityDown.textContent = '[\u2212]';
  densityDown.setAttribute('aria-label', 'Previous layout mode (compact / auto / comfortable)');
  densityDown.addEventListener('click', () => _stepLayout(-1));

  _densityLabel = document.createElement('span');
  _densityLabel.className = 'dial-toolbar-density-label';
  _densityLabel.setAttribute('aria-live', 'polite');
  _densityLabel.textContent = _getLayout().toUpperCase();

  const densityUp = document.createElement('button');
  densityUp.className = 'dial-toolbar-btn dial-toolbar-btn--icon';
  densityUp.textContent = '[+]';
  densityUp.setAttribute('aria-label', 'Next layout mode (compact / auto / comfortable)');
  densityUp.addEventListener('click', () => _stepLayout(1));

  densityGroup.appendChild(densityDown);
  densityGroup.appendChild(_densityLabel);
  densityGroup.appendChild(densityUp);

  // ── Category chips row ────────────────────────────────────────────────────────
  _chipsArea = document.createElement('div');
  _chipsArea.className = 'dial-toolbar-chips';
  _chipsArea.setAttribute('role', 'group');
  _chipsArea.setAttribute('aria-label', 'Filter by category');
  _chipsArea.style.display = 'none'; // hidden until categories exist

  // ── Keys popover wiring ────────────────────────────────────────────────────
  const keysPopover = _buildKeysPopover();
  keysBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = keysPopover.classList.toggle('is-open');
    keysBtn.setAttribute('aria-expanded', String(open));
    keysBtn.classList.toggle('is-active', open);
  });
  keysPopover.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && keysPopover.classList.contains('is-open')) {
      keysPopover.classList.remove('is-open');
      keysBtn.setAttribute('aria-expanded', 'false');
      keysBtn.classList.remove('is-active');
    }
  });
  document.addEventListener('click', () => {
    if (keysPopover.classList.contains('is-open')) {
      keysPopover.classList.remove('is-open');
      keysBtn.setAttribute('aria-expanded', 'false');
      keysBtn.classList.remove('is-active');
    }
  });

  // ── Persistent shortcut hint ──────────────────────────────────────────────
  const hintBar = document.createElement('div');
  hintBar.className = 'dial-toolbar-hint';
  hintBar.innerHTML =
    '<kbd>Ctrl+Shift+S</kbd> capture tab' +
    ' · ' +
    '<kbd>Ctrl+,</kbd> settings' +
    ' · ' +
    'type <span class="dial-toolbar-hint__cmd">keys</span> for all shortcuts';

  // Assemble
  bar.appendChild(leftGroup);
  bar.appendChild(searchWrap);
  bar.appendChild(densityGroup);
  bar.appendChild(_chipsArea);
  bar.appendChild(keysPopover);
  bar.appendChild(hintBar);

  _toolbarEl = bar;
  return bar;
}

// ── Chip management ───────────────────────────────────────────────────────────

/**
 * Rebuild category filter chips from the current DialStore categories.
 * Called by renderDials() every time the store is read.
 *
 * Also syncs the density label (so it reflects prefs changes from the
 * settings panel without needing a separate call).
 *
 * @param {Array<{ id: string, label: string }>} categories
 */
export function refreshToolbarChips(categories) {
  // Always sync density label whenever renderDials fires.
  if (_densityLabel) _densityLabel.textContent = _getLayout().toUpperCase();

  if (!_chipsArea) return;

  const filter    = getDialFilter();
  const named     = categories.filter(c => c.label);

  if (named.length === 0) {
    // No named categories → hide chips row and clear any stale category filter.
    _chipsArea.innerHTML = '';
    _chipsArea.style.display = 'none';
    if (filter.category !== null) setDialFilter({ category: null });
    return;
  }

  _chipsArea.style.display = '';

  // [ALL] + one chip per named category
  const desired = [{ id: null, label: 'ALL' }, ...named];
  const kids    = Array.from(_chipsArea.children);

  desired.forEach((cat, i) => {
    const stableId  = cat.id ?? '__all__';
    const isActive  = filter.category === cat.id;
    const existing  = kids[i];

    if (existing && existing.dataset.catId === stableId) {
      // Patch in place
      existing.classList.toggle('is-active', isActive);
      existing.setAttribute('aria-pressed', String(isActive));
      existing.textContent = cat.label;
    } else {
      // Create new chip
      const chip = document.createElement('button');
      chip.className   = 'dial-chip';
      chip.textContent = cat.label;
      chip.dataset.catId = stableId;
      chip.setAttribute('aria-label', cat.id ? `Filter: ${cat.label}` : 'Show all categories');
      chip.setAttribute('aria-pressed', String(isActive));
      chip.classList.toggle('is-active', isActive);
      chip.addEventListener('click', () => {
        // Clicking the active chip deactivates it (toggle off).
        const current = getDialFilter().category;
        setDialFilter({ category: current === cat.id ? null : cat.id });
        _renderDials?.();
      });
      _chipsArea.insertBefore(chip, _chipsArea.children[i] ?? null);
    }
  });

  // Prune extra chips
  while (_chipsArea.children.length > desired.length) {
    _chipsArea.removeChild(_chipsArea.lastChild);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount the toolbar inside #speed-dial-wrap, before #speed-dial.
 * Idempotent — safe to call more than once.
 */
export function initDialToolbar() {
  if (document.getElementById('dial-toolbar')) return; // already mounted

  const wrap = document.getElementById('speed-dial-wrap');
  if (!wrap) return;

  const grid = document.getElementById('speed-dial');
  wrap.insertBefore(_buildToolbar(), grid ?? null);

  // Hide the legacy [EDIT] toggle — the toolbar's [MANAGE] button replaces it.
  const legacyToggle = document.getElementById('dial-edit-toggle');
  if (legacyToggle) legacyToggle.style.display = 'none';
}
