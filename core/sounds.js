// ── core/sounds.js ────────────────────────────────────────────────────────────
// Optional retro sound effects — all synthesised via the Web Audio API.
// No external audio files.  Every public function is opt-in; sounds only play
// when prefs.sounds === true.  All calls are fire-and-forget (never throw).
//
// Waveform guide:
//   square   → hard 8-bit / NES / C64 feel
//   triangle → soft warm blip (mellower than square)
//   sine     → clean pure tone (boot chime tail note)

import { loadPrefs } from './storage.js';

// ── AudioContext singleton (lazy) ─────────────────────────────────────────────
let _ctx = null;

function _getCtx() {
  if (!_ctx) {
    try {
      // eslint-disable-next-line no-undef
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      // Browser may refuse before a user gesture; return null gracefully.
    }
  }
  return _ctx;
}

// ── Low-level synth helper ────────────────────────────────────────────────────
/**
 * Schedule a single tone blip.
 *
 * @param {AudioContext} ctx
 * @param {object}  opt
 * @param {number}  opt.freq        Frequency in Hz
 * @param {number}  opt.at          Start time (AudioContext time)
 * @param {number}  opt.dur         Duration in seconds
 * @param {number}  [opt.vol=0.09]  Peak gain (linear 0–1)
 * @param {string}  [opt.wave]      OscillatorType (default 'square')
 * @param {number}  [opt.attack]    Attack ramp (seconds, default 0.008)
 * @param {number}  [opt.release]   Release ramp (seconds, default 0.03)
 */
function _blip(ctx, {
  freq,
  at,
  dur,
  vol    = 0.09,
  wave   = 'square',
  attack = 0.008,
  release = 0.03,
}) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type            = wave;
  osc.frequency.value = freq;

  const end = at + dur;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(vol, at + attack);
  gain.gain.setValueAtTime(vol, Math.max(at + attack, end - release));
  gain.gain.linearRampToValueAtTime(0.0001, end);

  osc.start(at);
  osc.stop(end + 0.01);   // tiny buffer so Chrome doesn't click
}

// ── Sound definitions ─────────────────────────────────────────────────────────

/**
 * Boot chime — four-note ascending sequence.
 * Light and brisk; finishes before boot text scrolls.
 */
function _soundBoot(ctx) {
  const t  = ctx.currentTime;
  _blip(ctx, { freq: 220,  at: t,        dur: 0.10, vol: 0.07, wave: 'square'   });
  _blip(ctx, { freq: 330,  at: t + 0.11, dur: 0.10, vol: 0.08, wave: 'square'   });
  _blip(ctx, { freq: 440,  at: t + 0.22, dur: 0.10, vol: 0.09, wave: 'triangle' });
  _blip(ctx, { freq: 660,  at: t + 0.33, dur: 0.18, vol: 0.09, wave: 'sine',
               release: 0.12 });
}

/**
 * Countdown tick — single short pulse (plays for each second ≤ 10).
 */
function _soundCountdownTick(ctx) {
  _blip(ctx, { freq: 880, at: ctx.currentTime, dur: 0.07, vol: 0.06, wave: 'square' });
}

/**
 * Countdown end — three sharp insistent pulses.
 */
function _soundCountdownEnd(ctx) {
  const t = ctx.currentTime;
  _blip(ctx, { freq: 1320, at: t,        dur: 0.11, vol: 0.11, wave: 'square' });
  _blip(ctx, { freq: 1320, at: t + 0.15, dur: 0.11, vol: 0.11, wave: 'square' });
  _blip(ctx, { freq: 1760, at: t + 0.30, dur: 0.24, vol: 0.13, wave: 'square',
               release: 0.18 });
}

/**
 * Game reward / win — quick ascending arpeggio (happy fanfare feel).
 */
function _soundReward(ctx) {
  const notes = [330, 440, 554, 659, 880];
  notes.forEach((f, i) => {
    _blip(ctx, {
      freq: f,
      at:   ctx.currentTime + i * 0.09,
      dur:  0.14,
      vol:  0.09,
      wave: 'square',
      release: i === notes.length - 1 ? 0.10 : 0.04,
    });
  });
}

/**
 * Game fail / lose — descending two-note drop.
 */
function _soundFail(ctx) {
  const t = ctx.currentTime;
  _blip(ctx, { freq: 440, at: t,        dur: 0.15, vol: 0.09, wave: 'square' });
  _blip(ctx, { freq: 220, at: t + 0.17, dur: 0.32, vol: 0.09, wave: 'square',
               release: 0.22 });
}

/**
 * Keyboard click — default light tick played on each keystroke.
 * Very short and quiet; just enough tactile feedback without intruding.
 */
function _soundKeyClick(ctx) {
  _blip(ctx, {
    freq:    1380,
    at:      ctx.currentTime,
    dur:     0.012,
    vol:     0.035,
    wave:    'square',
    attack:  0.001,
    release: 0.008,
  });
}

/**
 * Keyboard thunk — heavier mechanical key press for C64 mode.
 * Two layers: a low resonant body + a sharp top-end transient.
 */
function _soundKeyThunk(ctx) {
  const t = ctx.currentTime;
  // Low resonant body — the physical "thunk" weight
  _blip(ctx, { freq: 110, at: t, dur: 0.048, vol: 0.10, wave: 'square',
               attack: 0.002, release: 0.035 });
  // Sharp transient — mechanical click of keycap
  _blip(ctx, { freq: 820, at: t, dur: 0.011, vol: 0.07, wave: 'square',
               attack: 0.001, release: 0.007 });
}

/**
 * Disk drive whir — Apple II Disk II simulation.
 * A sawtooth motor hum with LFO tremolo (platter flutter) plus evenly-spaced
 * stepper-motor clicks (head seek pattern).  Total duration ≈ 0.85 s.
 */
function _soundDiskWhir(ctx) {
  const t   = ctx.currentTime;
  const dur = 0.85;

  // ── Motor hum ────────────────────────────────────────────────────────────
  const motorOsc  = ctx.createOscillator();
  const motorGain = ctx.createGain();
  motorOsc.type = 'sawtooth';
  motorOsc.frequency.setValueAtTime(158, t);
  motorOsc.frequency.linearRampToValueAtTime(172, t + 0.25);
  motorOsc.frequency.linearRampToValueAtTime(168, t + dur);
  motorGain.gain.setValueAtTime(0.0001, t);
  motorGain.gain.linearRampToValueAtTime(0.045, t + 0.10);
  motorGain.gain.setValueAtTime(0.045, t + dur - 0.18);
  motorGain.gain.linearRampToValueAtTime(0.0001, t + dur);
  motorOsc.connect(motorGain);
  motorGain.connect(ctx.destination);
  motorOsc.start(t);
  motorOsc.stop(t + dur + 0.01);

  // ── Tremolo LFO (platter flutter ~12 Hz) ─────────────────────────────────
  const lfo     = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type            = 'sine';
  lfo.frequency.value = 12;
  lfoGain.gain.value  = 0.022;   // depth — stays well above zero
  lfo.connect(lfoGain);
  lfoGain.connect(motorGain.gain);
  lfo.start(t);
  lfo.stop(t + dur + 0.01);

  // ── Stepper-motor clicks (head seek) ─────────────────────────────────────
  [0.05, 0.14, 0.23, 0.32, 0.41, 0.50, 0.59, 0.68, 0.76].forEach(offset => {
    _blip(ctx, { freq: 240, at: t + offset, dur: 0.018, vol: 0.028,
                 wave: 'square', attack: 0.001, release: 0.010 });
  });
}

// ── Registry ──────────────────────────────────────────────────────────────────
const _SOUNDS = {
  boot:           _soundBoot,
  countdownTick:  _soundCountdownTick,
  countdownEnd:   _soundCountdownEnd,
  reward:         _soundReward,
  fail:           _soundFail,
  keyClick:       _soundKeyClick,
  keyThunk:       _soundKeyThunk,
  diskWhir:       _soundDiskWhir,
};

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Play a named sound if sounds are enabled in prefs.
 * Fire-and-forget — safe to call without await; never throws to the caller.
 *
 * Hardware-profile routing:
 *   • 'keyClick' on C64 displayMode  → plays the heavier 'keyThunk' sample.
 *   • 'boot' / 'clearScreen' on an Apple II displayMode → plays 'diskWhir'.
 *     For 'boot' the standard boot chime also follows unless gated by daily mode.
 *     For 'clearScreen' the disk whir is the only sound (no chime).
 *
 * @param {'boot'|'clearScreen'|'countdownTick'|'countdownEnd'|'reward'|'fail'|'keyClick'} name
 */
export async function playSoundIfEnabled(name) {
  try {
    const prefs = await loadPrefs();
    if (!prefs.sounds) return;

    const displayMode = prefs.displayMode || 'classic';

    // Boot chime daily-gate: when mode is 'daily' only play once per calendar day.
    if (name === 'boot' && prefs.bootSoundMode === 'daily') {
      const today   = new Date().toISOString().slice(0, 10);  // 'YYYY-MM-DD'
      const stored  = await chrome.storage.local.get({ lastBootSoundDate: '' });
      if (stored.lastBootSoundDate === today) return;
      await chrome.storage.local.set({ lastBootSoundDate: today });
    }

    // ── C64: keyboard clicks → heavy mechanical thunk ──────────────────────
    if (name === 'keyClick' && displayMode === 'c64') {
      name = 'keyThunk';
    }

    const ctx = _getCtx();
    if (!ctx) return;

    // Chrome suspends AudioContext until a user gesture; resume if needed.
    if (ctx.state === 'suspended') await ctx.resume();

    // ── Apple II: disk drive whir on boot / clearScreen ────────────────────
    const isAppleII = (displayMode === 'appleIIGreen');
    if ((name === 'boot' || name === 'clearScreen') && isAppleII) {
      _soundDiskWhir(ctx);
      if (name === 'clearScreen') return;  // disk whir is the sole sound for clr/clear
      // 'boot' falls through to also play the standard chime after the whir.
    }

    const fn = _SOUNDS[name];
    if (!fn) return;

    fn(ctx);
  } catch {
    /* Swallow all errors — audio must never crash the caller. */
  }
}
