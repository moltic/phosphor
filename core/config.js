// ── core/config.js ──────────────────────────────────────────────────────────
// Pure constants shared across the whole extension.

export const APP_TITLE = 'PHOSPHOR TERMINAL V0.1';

export const CONFIG = {
  /** Maximum entries stored in the command-history ring. */
  HISTORY_MAX:         200,

  /** Notes listed per page in the `ls` command. */
  NOTES_PAGE_SIZE:     20,

  /** Geolocation API hard timeout (ms). */
  GEO_TIMEOUT_MS:      12_000,

  /** Geolocation API maximum cached-position age (ms). */
  GEO_MAX_AGE_MS:      5 * 60 * 1000,

  /** Auto-refresh interval for weather tiles (ms). */
  WEATHER_REFRESH_MS:  10 * 60 * 1000,

  /** Tick interval for the "updated X min ago" label on weather tiles (ms). */
  WEATHER_AGO_TICK_MS: 60_000,

  /** Duration of the CRT-wipe animation used by `clear` (ms). */
  CRT_WIPE_MS:         300,

  /** Touch long-press duration to open the dial context menu (ms). */
  DIAL_LONGPRESS_MS:   500,

  /** Delay between characters in the `typewriter` command (ms). */
  TYPEWRITER_CHAR_MS:  40,
};

// ── Speed-dial alias map ─────────────────────────────────────────────────────
export const ALIASES = {
  reddit : 'https://www.reddit.com',
  yt     : 'https://www.youtube.com',
  gh     : 'https://github.com',
  tw     : 'https://x.com',
  wiki   : 'https://en.wikipedia.org',
  hn     : 'https://news.ycombinator.com',
  mail   : 'https://mail.google.com',
  maps   : 'https://maps.google.com',
};

// ── Theme palettes ────────────────────────────────────────────────────────────
export const THEMES = {
  // ── Original four ──────────────────────────────────────────────────────────
  amber: {
    '--bg':          '#0a0800',
    '--fg':          '#ffb000',
    '--fg-dim':      '#c08000',
    '--fg-bright':   '#ffd050',
    '--glow':        'rgba(255, 176, 0, 0.60)',
    '--glow-soft':   'rgba(255, 176, 0, 0.22)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  green: {
    '--bg':          '#001408',
    '--fg':          '#33ff77',
    '--fg-dim':      '#28a050',
    '--fg-bright':   '#80ffaa',
    '--glow':        'rgba(51, 255, 119, 0.55)',
    '--glow-soft':   'rgba(51, 255, 119, 0.20)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  blue: {
    '--bg':          '#000a1a',
    '--fg':          '#40b4ff',
    '--fg-dim':      '#2880a0',
    '--fg-bright':   '#80d4ff',
    '--glow':        'rgba(64, 180, 255, 0.55)',
    '--glow-soft':   'rgba(64, 180, 255, 0.20)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  white: {
    '--bg':          '#0a0a0a',
    '--fg':          '#cccccc',
    '--fg-dim':      '#808080',
    '--fg-bright':   '#eeeeee',
    '--glow':        'rgba(200, 200, 200, 0.30)',
    '--glow-soft':   'rgba(200, 200, 200, 0.12)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.15)',
  },
  // ── New phosphor packs ─────────────────────────────────────────────────────
  /** Crimson — blood-red phosphor; autumn / night mood. */
  crimson: {
    '--bg':          '#0d0002',
    '--fg':          '#ff3030',
    '--fg-dim':      '#aa1818',
    '--fg-bright':   '#ff7060',
    '--glow':        'rgba(255, 48, 48, 0.60)',
    '--glow-soft':   'rgba(255, 48, 48, 0.22)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.12)',
  },
  /** Matrix — deep saturated green; spring growth / "the grid" feel. */
  matrix: {
    '--bg':          '#000d00',
    '--fg':          '#00e040',
    '--fg-dim':      '#007828',
    '--fg-bright':   '#66ff99',
    '--glow':        'rgba(0, 224, 64, 0.62)',
    '--glow-soft':   'rgba(0, 224, 64, 0.22)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.14)',
  },
  /** Ice — pale blue-grey; winter / cold-clock feel. */
  ice: {
    '--bg':          '#01080f',
    '--fg':          '#8ecfea',
    '--fg-dim':      '#4a849e',
    '--fg-bright':   '#c8eeff',
    '--glow':        'rgba(142, 207, 234, 0.50)',
    '--glow-soft':   'rgba(142, 207, 234, 0.18)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.10)',
  },
  /** Phosphor-warm — brighter, hotter amber; summer noon heat. */
  warm: {
    '--bg':          '#0b0700',
    '--fg':          '#ffc840',
    '--fg-dim':      '#cc8800',
    '--fg-bright':   '#ffe88a',
    '--glow':        'rgba(255, 200, 64, 0.65)',
    '--glow-soft':   'rgba(255, 200, 64, 0.26)',
    '--scanline-bg': 'rgba(0, 0, 0, 0.09)',
  },
};

// ── Seasonal / time-based auto-skin ─────────────────────────────────────────
/**
 * Return the theme name that best fits the current season + time of day.
 * Only called when prefs.autoSkin === true; the returned name is used in
 * place of prefs.theme (the stored theme is left untouched).
 *
 * Mapping (northern-hemisphere seasons, approximate):
 *   Winter (Dec–Feb)   night → blue,   day  → ice
 *   Spring (Mar–May)   any   → matrix        (growth, fresh green)
 *   Summer (Jun–Aug)   day   → warm,   dusk  → amber
 *   Autumn (Sep–Nov)   eve   → crimson, rest → amber
 */
export function getAutoSkin() {
  const now  = new Date();
  const m    = now.getMonth() + 1;  // 1-12
  const h    = now.getHours();      // 0-23

  if (m === 12 || m <= 2) {
    // Winter
    return (h >= 20 || h < 6) ? 'blue' : 'ice';
  }
  if (m >= 3 && m <= 5) {
    // Spring — matrix all day, warmer at evening
    return h >= 18 ? 'amber' : 'matrix';
  }
  if (m >= 6 && m <= 8) {
    // Summer — bright warm tones
    return (h >= 9 && h < 19) ? 'warm' : 'amber';
  }
  // Autumn — red evening, amber by day
  return (h >= 16 && h < 22) ? 'crimson' : 'amber';
}

export const FONT_SIZES = {
  small:  '16.8px',
  medium: '20px',
  large:  '24px',
};

export const DEFAULT_BANNER = 'PHOSPHOR';

export const DEFAULT_PREFS = {
  theme:            'amber',
  terminalSize:     'medium',
  dialSize:         'medium',
  dialLayout:       'auto',
  scanlines:        true,
  bannerText:       '',
  greetingMode:     false,
  greetingName:     '',
  motd:             '',
  handle:           '',
  sessionCount:     0,
  clockFormat:      'auto',
  tempUnit:         'auto',
  cursorBlinkSpeed: 'normal',
  historyPersist:   true,
  dialOpenOnLoad:   false,
  onboardingDone:   false,
  // ── Atmospheric polish (all opt-in / restrained defaults) ───────────────
  /** CRT effect intensity: 'off' | 'low' | 'medium' | 'high' */
  crtIntensity:     'medium',
  /** Retro sound effects via Web Audio API (no external files). */
  sounds:           false,
  /** Honour reduced-motion even without OS setting (user preference). */
  reducedMotion:    false,
  /** Auto-choose a palette based on current season + time of day. */
  autoSkin:         false,
};
