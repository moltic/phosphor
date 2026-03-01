// ── core/progression.js ───────────────────────────────────────────────────────
// Operator profile and XP / achievement progression system.
//
// chrome.storage.sync key: "profile"
// {
//   handle:      string,                         // BBS handle
//   xp:          number,                         // cumulative XP total
//   achievedAt:  { [achievementId]: timestampMs } // epoch ms of each unlock
// }
//
// Design guarantees
// ─────────────────
//   • awardAchievement() is fully idempotent: calling it multiple times for the
//     same achievement id is a no-op after the first unlock (no storage write,
//     returns { unlocked: false }).
//   • XP is cumulative and never decremented.
//   • loadProfile() creates the profile on first call, seeding the handle from
//     prefs.handle (backward-compat) or generating a fresh one.
//   • This module imports only from core/storage. It does not touch the DOM,
//     so it can be safely imported in any context.

// ── Rank table ────────────────────────────────────────────────────────────────
// Ordered ascending by minXp.  getRankForXp() depends on this ordering.

/** @type {Array<{ minXp: number, rank: string, badge: string }>} */
export const RANKS = [
  { minXp:    0, rank: 'RECRUIT',    badge: '▪' },
  { minXp:   50, rank: 'OPERATOR',   badge: '◆' },
  { minXp:  150, rank: 'SPECIALIST', badge: '◈' },
  { minXp:  300, rank: 'TECHNICIAN', badge: '◉' },
  { minXp:  500, rank: 'HACKER',     badge: '✦' },
  { minXp:  800, rank: 'ELITE',      badge: '⬡' },
  { minXp: 1200, rank: 'GHOST',      badge: '◎' },
  { minXp: 2000, rank: 'PHANTOM',    badge: '⊕' },
  { minXp: 5000, rank: 'LEGEND',     badge: '★' },
];

// ── Achievement catalogue ─────────────────────────────────────────────────────
// Each entry is immutable runtime metadata; earned state lives in the profile.

/**
 * @type {Array<{ id: string, label: string, desc: string, xp: number }>}
 */
export const ACHIEVEMENTS = [
  { id: 'first_note',         label: 'First Contact',    desc: 'Save your first note',                xp:  25 },
  { id: 'five_notes',         label: 'Notetaker',        desc: 'Save 5 or more notes',                xp:  40 },
  { id: 'first_dial',         label: 'Speed Demon',      desc: 'Add your first speed dial',           xp:  25 },
  { id: 'theme_change',       label: 'Colour Shift',     desc: 'Change the terminal theme',           xp:  15 },
  { id: 'countdown_complete', label: 'On Time',          desc: 'Let a countdown reach zero',          xp:  30 },
  { id: 'fortune_read',       label: 'Fortune Cookie',   desc: 'Run the fortune command',             xp:  10 },
  { id: 'matrix_run',         label: 'In the Matrix',    desc: 'Activate the matrix screensaver',     xp:  20 },
  { id: 'hack_complete',      label: 'Access Granted',   desc: 'Complete the hack sequence',          xp:  20 },
  { id: 'maze_generated',     label: 'No Way Out',       desc: 'Generate a maze',                     xp:  10 },
  { id: 'export_done',        label: 'Backed Up',        desc: 'Export a data backup',                xp:  20 },
  { id: 'ten_sessions',       label: 'Regular',          desc: 'Open the terminal 10 times',          xp:  50 },
  { id: 'fifty_sessions',     label: 'Veteran',          desc: 'Open the terminal 50 times',          xp: 100 },
  // ── Door Games ────────────────────────────────────────────────────────────
  { id: 'hangman_win',        label: 'Word Warden',      desc: 'Win a game of Hangman',               xp:  30 },
  { id: 'bullscows_solved',   label: 'Code Cracker',     desc: 'Solve Bulls & Cows',                  xp:  30 },
  { id: 'bullscows_perfect',  label: 'Mind Reader',      desc: 'Crack Bulls & Cows in ≤3 guesses',    xp:  50 },
  { id: 'chasemaze_escape',   label: 'Ghost Runner',     desc: 'Escape the Chase Maze',               xp:  35 },
  { id: 'doorgames_played',   label: 'Door Jockey',      desc: 'Set a high score in 5 door games',    xp:  40 },
];

// ── Rank utilities ────────────────────────────────────────────────────────────

/**
 * Return the highest rank whose minXp is ≤ xp.
 * Always returns at least RANKS[0] (RECRUIT).
 *
 * @param {number} xp
 * @returns {{ minXp: number, rank: string, badge: string }}
 */
export function getRankForXp(xp) {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.minXp) current = r;
    else break;
  }
  return current;
}

/**
 * Return the next rank above the current XP, or null when at maximum.
 *
 * @param {number} xp
 * @returns {{ minXp: number, rank: string, badge: string } | null}
 */
export function getNextRank(xp) {
  for (const r of RANKS) {
    if (r.minXp > xp) return r;
  }
  return null;
}

// ── Handle generator ──────────────────────────────────────────────────────────
// Same vocabulary as the BBS handle generator in commands/system.js so handles
// produced by both code paths look consistent.

const _ADJ = [
  'Binary',  'Chaos',   'Cipher',  'Cobalt',  'Cosmic',  'Cyber',
  'Dark',    'Delta',   'Digital', 'Ghost',   'Hex',     'Hyper',
  'Infra',   'Ion',     'Iron',    'Laser',   'Logic',   'Macro',
  'Neural',  'Neon',    'Null',    'Omega',   'Phantom', 'Pixel',
  'Quantum', 'Razor',   'Rogue',   'Shadow',  'Signal',  'Sonic',
  'Static',  'Storm',   'Toxic',   'Turbo',   'Ultra',   'Vector',
  'Void',    'Wired',   'Xenon',   'Zero',
];
const _NOUN = [
  'Blade',   'Byte',    'Cobra',   'Crypt',   'Dragon',  'Eagle',
  'Falcon',  'Gate',    'Ghost',   'Hawk',    'Lynx',    'Node',
  'Omega',   'Phoenix', 'Pulse',   'Raven',   'Script',  'Specter',
  'Stack',   'Synth',   'Tiger',   'Trace',   'Viper',   'Virus',
  'Wolf',    'Wraith',  'Xero',    'Zero',    'Worm',
];

function _genHandle() {
  const adj  = _ADJ [Math.floor(Math.random() * _ADJ.length)];
  const noun = _NOUN[Math.floor(Math.random() * _NOUN.length)];
  return `${adj}${noun}`;
}

// ── Storage key ───────────────────────────────────────────────────────────────

const PROFILE_KEY = 'profile';

// ── Profile CRUD ──────────────────────────────────────────────────────────────

/**
 * Load the operator profile from chrome.storage.sync.
 *
 * On first call (no stored profile) a fresh profile is created and persisted:
 *   – handle is seeded from prefs.handle if it exists (backward-compat), otherwise generated.
 *   – xp starts at 0.
 *   – achievedAt starts empty.
 *
 * Defensive defaults are applied to any field that is missing, so future
 * schema additions do not break existing stored profiles.
 *
 * @returns {Promise<{ handle: string, xp: number, achievedAt: Object }>}
 */
export async function loadProfile() {
  const data = await chrome.storage.sync.get({ [PROFILE_KEY]: null });

  if (data[PROFILE_KEY] && typeof data[PROFILE_KEY] === 'object') {
    const p = data[PROFILE_KEY];
    // Apply defensive defaults for any missing fields.
    if (!p.handle || typeof p.handle !== 'string')   p.handle      = _genHandle();
    if (typeof p.xp !== 'number' || p.xp < 0)        p.xp          = 0;
    if (!p.achievedAt || typeof p.achievedAt !== 'object') p.achievedAt = {};
    return p;
  }

  // First-ever run: seed handle from legacy prefs.handle if available.
  const prefData = await chrome.storage.sync.get({ prefs: {} });
  const handle   = prefData.prefs?.handle || _genHandle();
  const profile  = { handle, xp: 0, achievedAt: {} };
  await chrome.storage.sync.set({ [PROFILE_KEY]: profile });
  return profile;
}

/**
 * Persist the operator profile to chrome.storage.sync.
 *
 * @param {{ handle: string, xp: number, achievedAt: Object }} profile
 */
export async function saveProfile(profile) {
  await chrome.storage.sync.set({ [PROFILE_KEY]: profile });
}

/**
 * Award an achievement to the current operator.
 *
 * Idempotent: if the achievement was already earned the function returns
 * immediately with `{ unlocked: false }` and makes no storage write.
 *
 * @param {string} id  Achievement id (must be a key in ACHIEVEMENTS).
 * @returns {Promise<{
 *   unlocked:  boolean,
 *   id:        string,
 *   label:     string,
 *   xpGained:  number,
 *   prevXp:    number,
 *   newXp:     number,
 *   rankUp:    boolean,
 *   newRank:   string | null,
 *   newBadge:  string | null,
 * }>}
 */
export async function awardAchievement(id) {
  const def = ACHIEVEMENTS.find(a => a.id === id);

  // Unknown id — no-op, no throw (defensive).
  if (!def) {
    return {
      unlocked: false, id, label: '', xpGained: 0,
      prevXp: 0, newXp: 0, rankUp: false, newRank: null, newBadge: null,
    };
  }

  const profile = await loadProfile();

  // Already earned — idempotent, no storage write.
  if (profile.achievedAt[id]) {
    return {
      unlocked: false, id, label: def.label, xpGained: 0,
      prevXp: profile.xp, newXp: profile.xp,
      rankUp: false, newRank: null, newBadge: null,
    };
  }

  const prevXp   = profile.xp;
  const prevRank = getRankForXp(prevXp);

  profile.achievedAt[id] = Date.now();
  profile.xp             = prevXp + def.xp;

  const curRank = getRankForXp(profile.xp);
  const rankUp  = curRank.rank !== prevRank.rank;

  await saveProfile(profile);

  return {
    unlocked:  true,
    id,
    label:     def.label,
    xpGained:  def.xp,
    prevXp,
    newXp:     profile.xp,
    rankUp,
    newRank:   rankUp ? curRank.rank  : null,
    newBadge:  rankUp ? curRank.badge : null,
  };
}
