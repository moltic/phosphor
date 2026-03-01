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
};

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
};
