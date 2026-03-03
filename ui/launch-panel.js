// ── ui/launch-panel.js ────────────────────────────────────────────────────────
// Launch-sets + recent-activity overlay panel.
//
// Renders a full-screen overlay (within #speed-dial-wrap) that shows:
//   • RECENT — last 5 distinct dials opened (clickable, records usage)
//   • MOST USED — top 5 by all-time count (clickable)
//   • LAUNCH SETS — named multi-dial groups with [RUN] and inline edit
//
// Opened by:
//   • [LAUNCH] button in the dial overlay header
//   • `launch-panel` terminal command (opens the dial overlay first)

import {
  loadLaunchSets, saveLaunchSet, editLaunchSet, renameLaunchSet,
  removeLaunchSet, openLaunchSetUrls, LAUNCH_WARN_THRESHOLD,
} from '../core/launch-sets.js';
import { getRecentDials, getMostUsedDials, loadUsageStats } from '../core/usage-stats.js';
import { loadDials }                                         from '../core/storage.js';
import { openDialOverlay }                                   from './dials.js';

// ── Panel DOM (built once, reused) ────────────────────────────────────────────
let _panelEl = null;

function _ensurePanel() {
  if (_panelEl) return _panelEl;

  const wrap = document.createElement('div');
  wrap.id            = 'launch-panel';
  wrap.className     = 'launch-panel';
  wrap.setAttribute('role',        'dialog');
  wrap.setAttribute('aria-modal',  'true');
  wrap.setAttribute('aria-label',  'Launch sets and recent activity');
  wrap.style.display = 'none';

  // Backdrop (closes panel when clicked)
  const backdrop = document.createElement('div');
  backdrop.className = 'launch-panel__backdrop';
  backdrop.addEventListener('click', closeLaunchPanel);
  wrap.appendChild(backdrop);

  // Inner card
  const card = document.createElement('div');
  card.className = 'launch-panel__card';
  wrap.appendChild(card);

  // Header
  const header = document.createElement('div');
  header.className = 'launch-panel__header';
  const titleEl = document.createElement('span');
  titleEl.className   = 'launch-panel__title';
  titleEl.textContent = '■ LAUNCH SETS';
  const closeBtn = document.createElement('button');
  closeBtn.className   = 'launch-panel__close';
  closeBtn.textContent = '[×]';
  closeBtn.setAttribute('aria-label', 'Close launch panel');
  closeBtn.addEventListener('click', closeLaunchPanel);
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Body (scrollable)
  const body = document.createElement('div');
  body.className   = 'launch-panel__body';
  body.id          = 'launch-panel-body';
  card.appendChild(body);

  // Footer hint
  const footer = document.createElement('div');
  footer.className = 'launch-panel__footer';
  footer.innerHTML  = 'Terminal: <kbd>launch save "name" alias1 alias2…</kbd>';
  card.appendChild(footer);

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _panelEl?.style.display !== 'none') {
      e.preventDefault();
      closeLaunchPanel();
    }
  });

  document.body.appendChild(wrap);
  _panelEl = wrap;
  return wrap;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Open the launch panel (also opens the dial overlay if not already open). */
export async function openLaunchPanel() {
  openDialOverlay();
  const panel = _ensurePanel();
  panel.style.display = '';
  requestAnimationFrame(() => panel.classList.add('is-open'));
  await _renderPanelBody();
}

/** Close the launch panel. */
export function closeLaunchPanel() {
  if (!_panelEl) return;
  _panelEl.classList.remove('is-open');
  // Wait for CSS transition
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (!_panelEl?.classList.contains('is-open')) {
      if (_panelEl) _panelEl.style.display = 'none';
    }
  };
  _panelEl?.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 350);
}

// ── Body renderer ─────────────────────────────────────────────────────────────

async function _renderPanelBody() {
  const body = document.getElementById('launch-panel-body');
  if (!body) return;
  body.innerHTML = '';

  const [sets, recent, topAliases, stats, dials] = await Promise.all([
    loadLaunchSets(),
    getRecentDials(6),
    getMostUsedDials(6),
    loadUsageStats(),
    loadDials(),
  ]);

  // Build a quick lookup: alias → dial data
  const dialMap = new Map(
    dials.filter(d => d.alias && !d.type).map(d => [d.alias.toLowerCase(), d]),
  );

  // ── Section: Recent ────────────────────────────────────────────────────────
  if (recent.length > 0) {
    body.appendChild(_buildSection('RECENT', recent, dialMap, stats, false));
  }

  // ── Section: Most Used ────────────────────────────────────────────────────
  // Show only if counts are non-trivial and not fully overlapping with recent
  const topFiltered = topAliases.filter(a => a && dialMap.has(a.toLowerCase()));
  if (topFiltered.length > 0) {
    body.appendChild(_buildSection('MOST USED', topFiltered, dialMap, stats, true));
  }

  // ── Section: Launch Sets ───────────────────────────────────────────────────
  const setsSection = _buildSetsSection(sets, dialMap, dials);
  body.appendChild(setsSection);
}

// ── Section: recent / most-used dials ────────────────────────────────────────

/**
 * @param {string}  title
 * @param {string[]} aliases
 * @param {Map}     dialMap
 * @param {object}  stats
 * @param {boolean} showCount
 */
function _buildSection(title, aliases, dialMap, stats, showCount) {
  const section = document.createElement('div');
  section.className = 'launch-panel__section';

  const heading = document.createElement('div');
  heading.className   = 'launch-panel__section-title';
  heading.textContent = title;
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'launch-panel__quick-list';

  for (const alias of aliases) {
    const dial = dialMap.get(alias.toLowerCase());
    if (!dial) continue;

    const btn = document.createElement('button');
    btn.className = 'launch-panel__quick-item';
    btn.setAttribute('title', dial.url || alias);

    // Icon
    const iconEl = _buildMiniIcon(dial);
    btn.appendChild(iconEl);

    // Label
    const labelEl = document.createElement('span');
    labelEl.className   = 'launch-panel__quick-label';
    labelEl.textContent = dial.label || alias;
    btn.appendChild(labelEl);

    // Count badge
    if (showCount && stats.counts[alias]) {
      const badge = document.createElement('span');
      badge.className   = 'launch-panel__count-badge';
      badge.textContent = `${stats.counts[alias]}×`;
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => {
      if (dial.url) {
        import('../core/usage-stats.js').then(m => m.recordDialOpen(alias));
        window.open(dial.url, '_blank', 'noopener,noreferrer');
      }
    });

    list.appendChild(btn);
  }

  section.appendChild(list);
  return section;
}

// ── Section: Launch Sets ──────────────────────────────────────────────────────

function _buildSetsSection(sets, dialMap, dials) {
  const section = document.createElement('div');
  section.className = 'launch-panel__section';

  const headRow = document.createElement('div');
  headRow.className = 'launch-panel__sets-headrow';

  const heading = document.createElement('div');
  heading.className   = 'launch-panel__section-title';
  heading.textContent = 'LAUNCH SETS';
  headRow.appendChild(heading);

  const newBtn = document.createElement('button');
  newBtn.className   = 'launch-panel__new-btn';
  newBtn.textContent = '[+ NEW]';
  newBtn.addEventListener('click', () => _openSetEditor(null, dials));
  headRow.appendChild(newBtn);
  section.appendChild(headRow);

  if (sets.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'launch-panel__empty';
    empty.textContent = 'No launch sets yet. Create one to open multiple tabs at once.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'launch-panel__sets-list';
  list.id        = 'launch-sets-list';

  for (const set of sets) {
    list.appendChild(_buildSetRow(set, dialMap, dials));
  }

  section.appendChild(list);
  return section;
}

function _buildSetRow(set, dialMap, dials) {
  const row = document.createElement('div');
  row.className      = 'launch-panel__set-row';
  row.dataset.setId  = set.id;

  // Left: name + aliases
  const info = document.createElement('div');
  info.className = 'launch-panel__set-info';

  const nameEl = document.createElement('span');
  nameEl.className   = 'launch-panel__set-name';
  nameEl.textContent = set.name;
  info.appendChild(nameEl);

  const tagsEl = document.createElement('div');
  tagsEl.className = 'launch-panel__set-tags';
  (set.aliases || []).forEach(a => {
    const tag = document.createElement('span');
    tag.className = dialMap.has(a.toLowerCase())
      ? 'launch-panel__tag'
      : 'launch-panel__tag launch-panel__tag--missing';
    tag.textContent = a;
    tag.title       = dialMap.get(a.toLowerCase())?.url || '(dial not found)';
    tagsEl.appendChild(tag);
  });
  info.appendChild(tagsEl);
  row.appendChild(info);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'launch-panel__set-actions';

  const runBtn = document.createElement('button');
  runBtn.className   = 'launch-panel__set-btn launch-panel__set-btn--run';
  runBtn.textContent = '[RUN]';
  runBtn.title       = `Open ${set.aliases.length} tab(s)`;
  runBtn.addEventListener('click', () => _runSet(set, dials));
  actions.appendChild(runBtn);

  const editBtn = document.createElement('button');
  editBtn.className   = 'launch-panel__set-btn';
  editBtn.textContent = '[EDIT]';
  editBtn.addEventListener('click', () => _openSetEditor(set, dials));
  actions.appendChild(editBtn);

  const rmBtn = document.createElement('button');
  rmBtn.className   = 'launch-panel__set-btn launch-panel__set-btn--rm';
  rmBtn.textContent = '[×]';
  rmBtn.setAttribute('aria-label', `Remove "${set.name}"`);
  rmBtn.addEventListener('click', async () => {
    if (!confirm(`Remove launch set "${set.name}"?`)) return;
    await removeLaunchSet(set.id);
    await _renderPanelBody();
  });
  actions.appendChild(rmBtn);

  row.appendChild(actions);
  return row;
}

// ── Run a set ─────────────────────────────────────────────────────────────────

async function _runSet(set, dials) {
  if (!set.aliases.length) return;

  if (set.aliases.length > LAUNCH_WARN_THRESHOLD) {
    const ok = confirm(
      `Launch set "${set.name}" will open ${set.aliases.length} tabs.\n\nContinue?`,
    );
    if (!ok) return;
  }

  openLaunchSetUrls(set.aliases, dials);

  // Record usage for each alias opened
  for (const alias of opened) {
    import('../core/usage-stats.js').then(m => m.recordDialOpen(alias));
  }
}

// ── Inline set editor ─────────────────────────────────────────────────────────

/**
 * Open an inline editor card in the panel body to create or edit a set.
 * @param {{ id:string, name:string, aliases:string[] }|null} set  null = new set
 * @param {Array} dials  all dials for autocomplete hint
 */
function _openSetEditor(set, dials) {
  const body = document.getElementById('launch-panel-body');
  if (!body) return;

  // Remove any prior editor
  body.querySelector('.launch-panel__editor')?.remove();

  const card = document.createElement('div');
  card.className = 'launch-panel__editor';

  const edTitle = document.createElement('div');
  edTitle.className   = 'launch-panel__editor-title';
  edTitle.textContent = set ? `EDIT: ${set.name}` : 'NEW LAUNCH SET';
  card.appendChild(edTitle);

  // Name field
  const nameRow = document.createElement('div');
  nameRow.className = 'launch-panel__field';
  const nameLbl = document.createElement('label');
  nameLbl.className   = 'launch-panel__field-label';
  nameLbl.textContent = 'SET NAME';
  const nameInput = document.createElement('input');
  nameInput.type         = 'text';
  nameInput.className    = 'launch-panel__field-input';
  nameInput.placeholder  = 'e.g. Morning Routine';
  nameInput.value        = set?.name ?? '';
  nameInput.autocomplete = 'off';
  nameLbl.appendChild(nameInput);
  nameRow.appendChild(nameLbl);
  card.appendChild(nameRow);

  // Aliases field
  const aliasRow = document.createElement('div');
  aliasRow.className = 'launch-panel__field';
  const aliasLbl = document.createElement('label');
  aliasLbl.className   = 'launch-panel__field-label';
  aliasLbl.textContent = 'ALIASES  (space-separated)';
  const aliasInput = document.createElement('input');
  aliasInput.type         = 'text';
  aliasInput.className    = 'launch-panel__field-input';
  aliasInput.placeholder  = 'gh hn mail reddit';
  aliasInput.value        = (set?.aliases ?? []).join(' ');
  aliasInput.autocomplete = 'off';
  aliasLbl.appendChild(aliasInput);
  aliasRow.appendChild(aliasLbl);
  card.appendChild(aliasRow);

  // Hint: list known aliases
  const known = dials.filter(d => d.alias && !d.type).map(d => d.alias);
  if (known.length) {
    const hint = document.createElement('div');
    hint.className   = 'launch-panel__field-hint';
    hint.textContent = `Available: ${known.join('  ')}`;
    card.appendChild(hint);
  }

  // Error
  const errorEl = document.createElement('div');
  errorEl.className = 'launch-panel__editor-error';
  errorEl.setAttribute('aria-live', 'assertive');
  card.appendChild(errorEl);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'launch-panel__editor-btns';

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'launch-panel__set-btn launch-panel__set-btn--save';
  saveBtn.textContent = '[SAVE]';
  saveBtn.addEventListener('click', async () => {
    errorEl.textContent = '';
    const name    = nameInput.value.trim();
    const aliases = aliasInput.value.trim().split(/\s+/).filter(Boolean);
    if (!name)         { errorEl.textContent = 'Name is required.'; nameInput.focus(); return; }
    if (!aliases.length) { errorEl.textContent = 'Add at least one alias.'; aliasInput.focus(); return; }

    if (set && name !== set.name) {
      await renameLaunchSet(set.id, name);
    }

    if (set) {
      await editLaunchSet(set.id, aliases);
    } else {
      await saveLaunchSet(name, aliases);
    }

    await _renderPanelBody();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className   = 'launch-panel__set-btn';
  cancelBtn.textContent = '[CANCEL]';
  cancelBtn.addEventListener('click', () => {
    card.remove();
    nameInput.focus?.();
  });

  [nameInput, aliasInput].forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    });
  });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  card.appendChild(btnRow);

  // Insert at top of body (before the sections)
  body.insertBefore(card, body.firstChild);
  nameInput.focus();
}

// ── [LAUNCH] button injection (called from main.js) ──────────────────────────

/**
 * Inject the [LAUNCH] trigger button into the dial overlay header actions bar.
 * Call once at startup from main.js.
 */
export function initLaunchPanel() {
  const actionsEl = document.getElementById('dial-overlay-actions');
  if (!actionsEl) return;

  // Avoid double-injection in HMR-like situations
  if (actionsEl.querySelector('#launch-panel-trigger')) return;

  const btn = document.createElement('button');
  btn.id          = 'launch-panel-trigger';
  btn.className   = 'dial-overlay-btn';
  btn.textContent = '[LAUNCH]';
  btn.setAttribute('aria-label', 'Open launch sets panel');
  btn.addEventListener('click', () => {
    // Toggle: close if already open, otherwise open
    if (_panelEl?.classList.contains('is-open')) {
      closeLaunchPanel();
    } else {
      openLaunchPanel();
    }
  });

  // Insert before the [CLOSE] button
  const closeBtn = document.getElementById('dial-overlay-close');
  if (closeBtn) {
    actionsEl.insertBefore(btn, closeBtn);
  } else {
    actionsEl.appendChild(btn);
  }
}

// ── Mini icon builder ─────────────────────────────────────────────────────────

function _buildMiniIcon(dial) {
  const wrap = document.createElement('span');
  wrap.className = 'launch-panel__mini-icon';
  wrap.setAttribute('aria-hidden', 'true');

  const icon = (dial?.icon ?? '').trim();

  // Short text / emoji
  if (icon && icon.toLowerCase() !== 'none' && [...icon].length <= 3 &&
      !/^[a-z][a-z0-9+\-.]*:\/\//i.test(icon)) {
    wrap.textContent = icon;
    return wrap;
  }

  // Favicon URL
  let hostname = '';
  try { hostname = new URL(dial?.url || '').hostname; } catch (_) {}

  // Use auto-favicon from DuckDuckGo
  if (hostname) {
    const img = document.createElement('img');
    img.src = `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
    img.alt = '';
    img.style.cssText = 'width:16px;height:16px;object-fit:contain;vertical-align:middle;';
    img.addEventListener('error', () => {
      img.replaceWith(_letterSpan(dial));
    });
    wrap.appendChild(img);
    return wrap;
  }

  wrap.appendChild(_letterSpan(dial));
  return wrap;
}

function _letterSpan(dial) {
  const span = document.createElement('span');
  const label = String(dial?.label || dial?.alias || '?');
  span.textContent = ([...label][0] ?? '?').toUpperCase();
  return span;
}
