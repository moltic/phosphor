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

// ── Retro display modes ──────────────────────────────────────────────────────
/**
 * Each mode defines:
 *   palette      – same CSS-variable keys as THEMES entries
 *   fontStack    – CSS font-family string for the mode's character style
 *   displayClass – class added to <body> so CSS can apply extra mode rules
 *
 * The synthetic 'classic' key is intentionally absent here; a displayMode
 * value of 'classic' means "use the normal THEMES + prefs.theme pipeline".
 */
export const MODES = {
  /** Commodore 64 — cobalt-blue screen, light-blue text. */
  c64: {
    palette: {
      '--bg':          '#0000AA',
      '--fg':          '#AAAAFF',
      '--fg-dim':      '#7C7CFF',
      '--fg-bright':   '#FFFFFF',
      '--glow':        'rgba(170, 170, 255, 0.42)',
      '--glow-soft':   'rgba(170, 170, 255, 0.14)',
      '--scanline-bg': 'rgba(0, 0, 0, 0.05)',
    },
    fontStack:    '"Press Start 2P", "Courier New", Courier, monospace',
    displayClass: 'mode-c64',
    /** Fixed hardware font-size; overrides the user's terminalSize pref. */
    fontSize:     '22px',
  },

  /** Apple II — classic monochrome green phosphor monitor. */
  appleIIGreen: {
    palette: {
      '--bg':          '#0d1a0d',
      '--fg':          '#33ff33',
      '--fg-dim':      '#1a8c1a',
      '--fg-bright':   '#99ff99',
      '--glow':        'rgba(51, 255, 51, 0.58)',
      '--glow-soft':   'rgba(51, 255, 51, 0.20)',
      '--scanline-bg': 'rgba(0, 0, 0, 0.12)',
    },
    fontStack:    '"PR Number 3", "Courier New", Courier, monospace',
    displayClass: 'mode-apple2-green',
    /** Fixed hardware font-size; overrides the user's terminalSize pref. */
    fontSize:     '18px',
  },

  /** NES — navy-blue backdrop with crisp white text, game-menu aesthetic. */
  nes: {
    palette: {
      '--bg':          '#000080',
      '--fg':          '#FFFFFF',
      '--fg-dim':      '#AAAAAA',
      '--fg-bright':   '#FFD700',
      '--glow':        'rgba(255, 255, 255, 0.40)',
      '--glow-soft':   'rgba(255, 255, 255, 0.14)',
      '--scanline-bg': 'rgba(0, 0, 0, 0.18)',
    },
    fontStack:    '"Press Start 2P", "Courier New", monospace',
    displayClass: 'mode-nes',
  },

  /** Game Boy — four-shade pea-green LCD palette, darkest shade as bg. */
  gameBoy: {
    palette: {
      '--bg':          '#0f380f',
      '--fg':          '#9bbc0f',
      '--fg-dim':      '#306230',
      '--fg-bright':   '#e0f0a0',
      '--glow':        'rgba(155, 188, 15, 0.55)',
      '--glow-soft':   'rgba(155, 188, 15, 0.20)',
      '--scanline-bg': 'rgba(0, 0, 0, 0.14)',
    },
    fontStack:    '"Press Start 2P", "Courier New", monospace',
    displayClass: 'mode-gameboy',
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
  /** When to play the open/boot chime: 'always' | 'daily' (once per day). */
  bootSoundMode:    'always',
  /** Honour reduced-motion even without OS setting (user preference). */
  reducedMotion:    false,
  /** Auto-choose a palette based on current season + time of day. */
  autoSkin:         false,
  /** Where dial tile clicks open: 'new-tab' | 'same-tab' | 'new-window' */
  dialClickTarget:  'new-tab',
  /** Retro display mode key from MODES, or 'classic' to use normal THEMES. */
  displayMode:      'classic',
};
