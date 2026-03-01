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

// ── Registry ──────────────────────────────────────────────────────────────────
const _SOUNDS = {
  boot:           _soundBoot,
  countdownTick:  _soundCountdownTick,
  countdownEnd:   _soundCountdownEnd,
  reward:         _soundReward,
  fail:           _soundFail,
};

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Play a named sound if sounds are enabled in prefs.
 * Fire-and-forget — safe to call without await; never throws to the caller.
 *
 * @param {'boot'|'countdownTick'|'countdownEnd'|'reward'|'fail'} name
 */
export async function playSoundIfEnabled(name) {
  try {
    const prefs = await loadPrefs();
    if (!prefs.sounds) return;

    const fn = _SOUNDS[name];
    if (!fn) return;

    const ctx = _getCtx();
    if (!ctx) return;

    // Chrome suspends AudioContext until a user gesture; resume if needed.
    if (ctx.state === 'suspended') await ctx.resume();

    fn(ctx);
  } catch {
    /* Swallow all errors — audio must never crash the caller. */
  }
}
