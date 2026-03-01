// ── core/missions.js ─────────────────────────────────────────────────────────
// Daily missions engine.
//
// chrome.storage.sync key: "missionState"
// {
//   date:            string,           // 'YYYY-MM-DD' — the day these missions apply
//   missions:        MissionInstance[] // today's active missions (3-5)
//   earnedCosmetics: string[]          // all-time cosmetics earned across all days
// }
//
// MissionInstance: {
//   trigger:   string,       // matches a trigger id emitted by command hooks
//   label:     string,       // short display name (e.g. 'Signal Log')
//   desc:      string,       // one-line description shown in the missions panel
//   xp:        number,       // XP rewarded on first completion today
//   cosmetic:  string|null,  // optional cosmetic badge label (null for none)
//   completed: boolean,
// }
//
// Design guarantees
// ─────────────────
//   • Missions roll over exactly once per local calendar day.
//   • A mission can only be completed (XP awarded) once per day — idempotent.
//   • The daily set is deterministically seeded from the date string, so it is
//     consistent across browser restarts within the same day.
//   • triggerMission() returns { completed: false } when no matching incomplete
//     mission exists; callers should not guard the call.
//   • earnedCosmetics accumulates across days; cosmetics are never duplicated.

import { loadProfile, saveProfile, getRankForXp } from './progression.js';

// ── Seeded RNG ────────────────────────────────────────────────────────────────

/** Return a deterministic pseudo-random number generator seeded by `seed`. */
function _makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Hash a date string ('YYYY-MM-DD') to a 32-bit unsigned integer seed. */
function _dateToSeed(dateStr) {
  let h = 0xdeadbeef;
  for (let i = 0; i < dateStr.length; i++) {
    h = (Math.imul(h ^ dateStr.charCodeAt(i), 0x9e3779b9) >>> 0);
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return h;
}

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'missionState';

// ── Mission catalogue ─────────────────────────────────────────────────────────
// The full pool from which each day's 3-5 missions are sampled.
// Triggers must match the string passed to triggerMission() in command hooks.

/**
 * @type {Array<{
 *   trigger:  string,
 *   label:    string,
 *   desc:     string,
 *   xp:       number,
 *   cosmetic: string|null
 * }>}
 */
export const MISSION_POOL = [
  { trigger: 'save_note',      label: 'Signal Log',       desc: 'Save a note to the terminal log',                  xp: 15, cosmetic: null              },
  { trigger: 'launch_dial',    label: 'Speed Run',        desc: 'Navigate via a speed-dial alias or  l  command',   xp: 10, cosmetic: null              },
  { trigger: 'use_theme',      label: 'Colour Shift',     desc: 'Switch the terminal colour theme',                 xp: 15, cosmetic: '▸ CHROMATIC'    },
  { trigger: 'run_fortune',    label: 'Fortune Cookie',   desc: 'Consult the oracle with  fortune',                 xp: 10, cosmetic: null              },
  { trigger: 'run_hack',       label: 'Access Attempt',   desc: 'Complete the hack intrusion sequence',             xp: 20, cosmetic: '▸ CRACKED'      },
  { trigger: 'run_maze',       label: 'Lost in Stack',    desc: 'Generate a recursive ASCII maze with  maze',       xp: 15, cosmetic: null              },
  { trigger: 'run_matrix',     label: 'Cascade Protocol', desc: 'Activate the matrix screensaver',                  xp: 15, cosmetic: '▸ MATRIX GHOST' },
  { trigger: 'run_countdown',  label: 'On the Clock',     desc: 'Let a countdown timer reach zero',                 xp: 20, cosmetic: null              },
  { trigger: 'run_scan',       label: 'Sector Sweep',     desc: 'Run a port scan on the sector with  scan',         xp: 10, cosmetic: null              },
  { trigger: 'view_profile',   label: 'Status Check',     desc: 'View your operator profile',                       xp:  5, cosmetic: null              },
  { trigger: 'run_typewriter', label: 'Ghost Signal',     desc: 'Transmit a message with  typewriter',              xp: 10, cosmetic: null              },
  { trigger: 'run_banner',     label: 'Broadcast',        desc: 'Render a neon banner with  banner',                xp: 10, cosmetic: null              },
  { trigger: 'run_cowsay',     label: 'Sector Mascot',    desc: 'Print a cowsay message with  cow',                 xp:  5, cosmetic: null              },
  { trigger: 'run_noise',      label: 'Static Dump',      desc: 'Generate CRT static noise with  noise',            xp:  5, cosmetic: null              },
  { trigger: 'run_cal',        label: 'Date Check',       desc: 'Display the calendar with  cal',                   xp:  5, cosmetic: null              },
];

// ── BBS Events ────────────────────────────────────────────────────────────────
// One rotating narrative event per day — purely cosmetic, no game-play effect.

/**
 * @type {Array<{ label: string, desc: string }>}
 */
export const BBS_EVENTS = [
  { label: 'GHOST PACKET STORM',     desc: 'Anomalous traffic on sector grid.  All operators on alert.'        },
  { label: 'MIDNIGHT BBS CRAWL',     desc: 'Nodes broadcasting on all frequencies.  Log your intel.'          },
  { label: 'SECTOR BLACKOUT',        desc: 'Partial uplink degradation detected.  Maintain your log.'         },
  { label: 'OPERATOR ASSEMBLY',      desc: 'All hands on deck.  Check your profile and status feeds.'         },
  { label: 'PHANTOM SIGNAL',         desc: 'Unknown carrier wave on channel 7.  Run your diagnostics.'        },
  { label: 'DATA FLOOD INCOMING',    desc: 'High-volume packet burst from upstream.  Brace for noise.'        },
  { label: 'ROGUE NODE SIGHTED',     desc: 'Unknown operator detected in the sector.  Stay vigilant.'         },
  { label: 'SYSTEM INTEGRITY CHECK', desc: 'Automated sweep in progress.  Verify your dials and notes.'      },
  { label: 'DEEP SCAN ACTIVE',       desc: 'Long-range sweep running.  All ports monitored.'                  },
  { label: 'FREQUENCY SHIFT',        desc: 'Carrier frequency updated.  Recalibrate your terminal theme.'    },
  { label: 'UPLINK RESTORED',        desc: 'Primary relay back online.  Resume normal operations.'            },
  { label: 'SILENT RUNNING',         desc: 'Reduced emissions protocol active.  Keep comms minimal.'         },
  { label: 'NEW INTEL PACKET',       desc: 'Classified data burst received.  Consult the fortune oracle.'    },
  { label: 'SECTOR REBOOT',          desc: 'Rolling restart in progress.  Document your sessions.'            },
];

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Return today's local date as 'YYYY-MM-DD'.
 * @returns {string}
 */
export function getTodayDateStr() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return today's rotating BBS sector event (deterministic for the calendar day).
 * @returns {{ label: string, desc: string }}
 */
export function getTodayBBSEvent() {
  const dateStr = getTodayDateStr();
  const rng     = _makeRng((_dateToSeed(dateStr) ^ 0xcafebabe) >>> 0);
  return BBS_EVENTS[Math.floor(rng() * BBS_EVENTS.length)];
}

// ── Mission generation ────────────────────────────────────────────────────────

/**
 * Deterministically generate 3-5 missions for a given date string.
 * @param {string} dateStr  'YYYY-MM-DD'
 * @returns {Array}
 */
function _generateMissions(dateStr) {
  const rng   = _makeRng(_dateToSeed(dateStr));
  const count = 3 + Math.floor(rng() * 3); // 3, 4, or 5

  // Fisher-Yates shuffle with the seeded RNG
  const pool = MISSION_POOL.map(m => ({ ...m, completed: false }));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/**
 * Load (or generate) today's mission state from chrome.storage.sync.
 * Rolls over missions automatically when the date string changes.
 * @returns {Promise<{ date: string, missions: Array, earnedCosmetics: string[] }>}
 */
async function _loadMissionState() {
  const data  = await chrome.storage.sync.get({ [STORAGE_KEY]: null });
  const raw   = data[STORAGE_KEY];
  const today = getTodayDateStr();

  // Still the same calendar day — return persisted state.
  if (raw && typeof raw === 'object' && raw.date === today && Array.isArray(raw.missions)) {
    return {
      date:            raw.date,
      missions:        raw.missions,
      earnedCosmetics: Array.isArray(raw.earnedCosmetics) ? raw.earnedCosmetics : [],
    };
  }

  // New day (or first-ever run) — generate fresh missions.
  const state = {
    date:            today,
    missions:        _generateMissions(today),
    earnedCosmetics: Array.isArray(raw?.earnedCosmetics) ? raw.earnedCosmetics : [],
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: state });
  return state;
}

/** Persist the full mission state. */
async function _saveMissionState(state) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return today's mission state.  Generates a fresh set when the day rolls over.
 *
 * @returns {Promise<{ date: string, missions: Array, earnedCosmetics: string[] }>}
 */
export async function getTodayMissions() {
  return _loadMissionState();
}

/**
 * Mark the first incomplete mission that matches `trigger` as completed,
 * add its XP to the operator profile, and optionally record a cosmetic.
 *
 * Idempotent: returns `{ completed: false }` when no matching incomplete
 * mission exists (already done today, or not in today's set).
 *
 * @param {string} trigger
 * @returns {Promise<{
 *   completed: boolean,
 *   label?:    string,
 *   xpGained?: number,
 *   cosmetic?: string|null,
 *   rankUp?:   boolean,
 *   newRank?:  string|null,
 *   newBadge?: string|null,
 * }>}
 */
export async function triggerMission(trigger) {
  const state   = await _loadMissionState();
  const mission = state.missions.find(m => m.trigger === trigger && !m.completed);

  if (!mission) return { completed: false };

  mission.completed = true;

  // Award XP directly to the operator profile.
  // Missions are daily-repeating, so they bypass the one-time achievement system.
  const profile  = await loadProfile();
  const prevXp   = profile.xp;
  const prevRank = getRankForXp(prevXp);
  profile.xp     = prevXp + mission.xp;
  const curRank  = getRankForXp(profile.xp);
  await saveProfile(profile);

  // Record cosmetic if it is new.
  if (mission.cosmetic && !state.earnedCosmetics.includes(mission.cosmetic)) {
    state.earnedCosmetics.push(mission.cosmetic);
  }

  await _saveMissionState(state);

  const rankUp = curRank.rank !== prevRank.rank;
  return {
    completed: true,
    label:     mission.label,
    xpGained:  mission.xp,
    cosmetic:  mission.cosmetic,
    rankUp,
    newRank:   rankUp ? curRank.rank  : null,
    newBadge:  rankUp ? curRank.badge : null,
  };
}
