// ── core/clock.js ────────────────────────────────────────────────────────────
// Wall-clock tick + formatTimestamp.
// Imported by main.js AND by commands/fun.js (countdown command).

import { getGreetingBucket, applyPrefs, getCachedPrefs } from '../ui/settings.js';

/** Tracks the last greeting bucket so we only re-render the banner on change. */
let _lastGreetingBucket = -1;

/** #status-time element. */
const timeEl = document.getElementById('status-time');

/**
 * Format a Unix-ms timestamp into a human-readable locale string.
 * Used by `n`, `ls`, `whoami`, and the boot sequence.
 * @param {number} ms
 * @returns {string}
 */
export function formatTimestamp(ms) {
  return new Date(ms).toLocaleString(undefined, {
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Update the #status-time element with the current date/time.
 * Called every second and on visibility restore.
 */
export function tickClock() {
  const d = new Date();
  const datePart = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  });
  const prefs       = getCachedPrefs();
  const clockFormat = prefs?.clockFormat || 'auto';
  const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  if (clockFormat === '12h') timeOptions.hour12 = true;
  else if (clockFormat === '24h') timeOptions.hour12 = false;
  const timePart = d.toLocaleTimeString(undefined, timeOptions);
  timeEl.textContent = `${datePart}  ${timePart}`;

  // Refresh greeting banner whenever the time-of-day period changes.
  if (prefs?.greetingMode) {
    const bucket = getGreetingBucket();
    if (_lastGreetingBucket !== bucket) {
      _lastGreetingBucket = bucket;
      applyPrefs(prefs);
    }
  }
}
