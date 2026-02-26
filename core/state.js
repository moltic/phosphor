// ── core/state.js ────────────────────────────────────────────────────────────
// Shared mutable runtime state.  Modules import specific getters/setters
// so they never need to import main.js (which would create circular deps).

// ── Session ──────────────────────────────────────────────────────────────────
export let sessionStart = null;
export function setSessionStart(t) { sessionStart = t; }

// ── Command history ──────────────────────────────────────────────────────────
export let cmdHistory   = [];
export let historyIndex = -1;
export let pendingInput = '';

export function setCmdHistory(h)      { cmdHistory = h; }
export function updateHistoryIndex(i) { historyIndex = i; }
export function setPendingInput(v)    { pendingInput = v; }

// ── Pending confirmation (nuke / dial import) ─────────────────────────────────
/** Resolve-function set while a command awaits typed user confirmation. */
export let _pendingConfirm = null;
export function setPendingConfirm(fn) { _pendingConfirm = fn; }
export function clearPendingConfirm() { _pendingConfirm = null; }

// ── Clock intervals ───────────────────────────────────────────────────────────
/** Handle for the wall-clock setInterval (null when paused). */
export let clockInterval = null;
export function setClockInterval(id) { clockInterval = id; }
export function clearClockInterval() {
  if (clockInterval !== null) { clearInterval(clockInterval); clockInterval = null; }
}

/** Handle for an active countdown setInterval (null when idle). */
export let _countdownInterval = null;
export function setCountdownInterval(id) { _countdownInterval = id; }
export function clearCountdownIntervalState() {
  if (_countdownInterval !== null) { clearInterval(_countdownInterval); _countdownInterval = null; }
}
