// ── core/usage-stats.js ──────────────────────────────────────────────────────
// Lightweight dial usage tracking stored in chrome.storage.local.
//
// Storage key: "dialUsage"
// {
//   counts: { [alias]: number },          // all-time open count per alias
//   recent: [ { alias, ts }, … ]          // newest-first ring, max RECENT_MAX
// }
//
// This key lives in local (not sync) storage deliberately — usage patterns
// are device-specific and do not need to roam across machines.

const USAGE_KEY  = 'dialUsage';
const RECENT_MAX = 100; // entries kept in the recent ring

// ── Internal helpers ──────────────────────────────────────────────────────────

/** @returns {Promise<{ counts: Record<string,number>, recent: Array<{alias:string,ts:number}> }>} */
async function _load() {
  const data = await chrome.storage.local.get({ [USAGE_KEY]: null });
  const raw  = data[USAGE_KEY];
  if (raw && typeof raw === 'object') {
    return {
      counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {},
      recent: Array.isArray(raw.recent) ? raw.recent : [],
    };
  }
  return { counts: {}, recent: [] };
}

/** @param {{ counts: object, recent: Array }} stats */
async function _save(stats) {
  await chrome.storage.local.set({ [USAGE_KEY]: stats });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record one open event for a dial by alias.
 * Updates both the count and the recent ring.
 *
 * @param {string} alias
 */
export async function recordDialOpen(alias) {
  if (!alias) return;
  const stats = await _load();

  // Increment count
  stats.counts[alias] = (stats.counts[alias] ?? 0) + 1;

  // Prepend to recent ring, trim to RECENT_MAX
  stats.recent.unshift({ alias, ts: Date.now() });
  if (stats.recent.length > RECENT_MAX) stats.recent.length = RECENT_MAX;

  await _save(stats);
}

/**
 * Return the N most recently opened dial aliases (deduplicated, newest first).
 *
 * @param {number} [n=5]
 * @returns {Promise<string[]>}
 */
export async function getRecentDials(n = 5) {
  const stats = await _load();
  const seen  = new Set();
  const out   = [];
  for (const entry of stats.recent) {
    if (!seen.has(entry.alias)) {
      seen.add(entry.alias);
      out.push(entry.alias);
      if (out.length >= n) break;
    }
  }
  return out;
}

/**
 * Return the N most-used dial aliases (descending by count).
 *
 * @param {number} [n=5]
 * @returns {Promise<string[]>}
 */
export async function getMostUsedDials(n = 5) {
  const stats = await _load();
  return Object.entries(stats.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([alias]) => alias);
}

/**
 * Return the raw usage stats object for display.
 * @returns {Promise<{ counts: Record<string,number>, recent: Array }>}
 */
export async function loadUsageStats() {
  return _load();
}

/**
 * Remove all tracking data for a specific alias (e.g. after dial deletion).
 * @param {string} alias
 */
export async function forgetDialUsage(alias) {
  const stats = await _load();
  delete stats.counts[alias];
  stats.recent = stats.recent.filter(e => e.alias !== alias);
  await _save(stats);
}

/**
 * Wipe all usage data.
 */
export async function clearUsageStats() {
  await chrome.storage.local.remove(USAGE_KEY);
}
