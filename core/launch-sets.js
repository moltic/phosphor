// ── core/launch-sets.js ──────────────────────────────────────────────────────
// Named launch sets: groups of dial aliases that can be opened together.
//
// Storage key in chrome.storage.local: "launchSets"
// {
//   version: 1,
//   sets: [
//     { id: string, name: string, aliases: string[], createdAt: number }
//   ]
// }
//
// Using local (not sync) storage because launch sets are a workflow tool
// that may differ per device and do not need the 100 kB sync quota.

const LAUNCH_SETS_KEY = 'launchSets';
const LAUNCH_SETS_VER = 1;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * @returns {Promise<{ version:1, sets: Array<{id:string,name:string,aliases:string[],createdAt:number}> }>}
 */
async function _load() {
  const data = await chrome.storage.local.get({ [LAUNCH_SETS_KEY]: null });
  const raw  = data[LAUNCH_SETS_KEY];
  if (raw?.version === LAUNCH_SETS_VER && Array.isArray(raw.sets)) {
    return raw;
  }
  return { version: LAUNCH_SETS_VER, sets: [] };
}

/** @param {{ version:1, sets:Array }} store */
async function _save(store) {
  await chrome.storage.local.set({ [LAUNCH_SETS_KEY]: store });
}

/** Generate a simple unique id. */
function _uid() {
  return `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load all launch sets.
 * @returns {Promise<Array<{id:string, name:string, aliases:string[], createdAt:number}>>}
 */
export async function loadLaunchSets() {
  const store = await _load();
  return store.sets;
}

/**
 * Save (create or overwrite) a launch set by name.
 * If a set with the same name already exists, its aliases are replaced.
 *
 * @param {string}   name     Display name (case-insensitive uniqueness check)
 * @param {string[]} aliases  Ordered list of dial aliases to open
 * @returns {Promise<{id:string, name:string, aliases:string[], createdAt:number}>}
 */
export async function saveLaunchSet(name, aliases) {
  const store  = await _load();
  const lower  = name.trim().toLowerCase();
  const idx    = store.sets.findIndex(s => s.name.toLowerCase() === lower);

  if (idx !== -1) {
    // Overwrite existing
    store.sets[idx].aliases  = aliases;
    await _save(store);
    return store.sets[idx];
  }

  const entry = { id: _uid(), name: name.trim(), aliases, createdAt: Date.now() };
  store.sets.push(entry);
  await _save(store);
  return entry;
}

/**
 * Update the aliases list of an existing set (by id or name).
 *
 * @param {string}   idOrName
 * @param {string[]} aliases
 * @returns {Promise<boolean>}  true when found and updated
 */
export async function editLaunchSet(idOrName, aliases) {
  const store = await _load();
  const lower = idOrName.trim().toLowerCase();
  const set   = store.sets.find(
    s => s.id === idOrName || s.name.toLowerCase() === lower,
  );
  if (!set) return false;
  set.aliases = aliases;
  await _save(store);
  return true;
}

/**
 * Rename an existing set.
 *
 * @param {string} idOrName
 * @param {string} newName
 * @returns {Promise<boolean>}
 */
export async function renameLaunchSet(idOrName, newName) {
  const store = await _load();
  const lower = idOrName.trim().toLowerCase();
  const set   = store.sets.find(
    s => s.id === idOrName || s.name.toLowerCase() === lower,
  );
  if (!set) return false;
  set.name = newName.trim();
  await _save(store);
  return true;
}

/**
 * Remove a launch set by id or name.
 *
 * @param {string} idOrName
 * @returns {Promise<boolean>}  true when found and removed
 */
export async function removeLaunchSet(idOrName) {
  const store  = await _load();
  const lower  = idOrName.trim().toLowerCase();
  const before = store.sets.length;
  store.sets   = store.sets.filter(
    s => s.id !== idOrName && s.name.toLowerCase() !== lower,
  );
  if (store.sets.length === before) return false;
  await _save(store);
  return true;
}

/**
 * Find a launch set by id or exact name (case-insensitive).
 *
 * @param {string} idOrName
 * @returns {Promise<{id:string, name:string, aliases:string[], createdAt:number}|null>}
 */
export async function findLaunchSet(idOrName) {
  const store = await _load();
  const lower = idOrName.trim().toLowerCase();
  return store.sets.find(
    s => s.id === idOrName || s.name.toLowerCase() === lower,
  ) ?? null;
}

/**
 * Open all URLs in a launch set in new tabs.
 * Resolves the current dial store to map aliases → URLs, skipping unknown aliases.
 *
 * @param {string[]} aliases
 * @param {Array}    dialItems  Flat array from loadDials() — pass in to avoid double load
 * @returns {{ opened: string[], skipped: string[] }}
 */
export function openLaunchSetUrls(aliases, dialItems) {
  const urlMap = new Map(
    dialItems
      .filter(d => d.alias && d.url && !d.type)
      .map(d => [d.alias.toLowerCase(), d.url]),
  );

  const opened  = [];
  const skipped = [];

  for (const alias of aliases) {
    const url = urlMap.get(alias.toLowerCase());
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      opened.push(alias);
    } else {
      skipped.push(alias);
    }
  }

  return { opened, skipped };
}

/** How many tabs to treat as "many" — show a confirmation above this count. */
export const LAUNCH_WARN_THRESHOLD = 3;
