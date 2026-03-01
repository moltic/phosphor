// ── ui/weather.js ────────────────────────────────────────────────────────────
// Weather dial tile: Open-Meteo + browser geolocation.

import { CONFIG }        from '../core/config.js';
import { getCachedPrefs } from './settings.js';

// ── WMO weather interpretation codes ─────────────────────────────────────────
export const WMO_WEATHER = {
  0:  { icon: '☀',  label: 'Clear'        },
  1:  { icon: '🌤', label: 'Mostly Clear'  },
  2:  { icon: '⛅', label: 'Partly Cloudy' },
  3:  { icon: '☁',  label: 'Overcast'     },
  45: { icon: '🌫', label: 'Fog'          },
  48: { icon: '🌫', label: 'Icy Fog'      },
  51: { icon: '🌦', label: 'Lt Drizzle'   },
  53: { icon: '🌦', label: 'Drizzle'      },
  55: { icon: '🌧', label: 'Hvy Drizzle'  },
  61: { icon: '🌧', label: 'Lt Rain'      },
  63: { icon: '🌧', label: 'Rain'         },
  65: { icon: '🌧', label: 'Hvy Rain'     },
  71: { icon: '🌨', label: 'Lt Snow'      },
  73: { icon: '🌨', label: 'Snow'         },
  75: { icon: '❄',  label: 'Hvy Snow'     },
  77: { icon: '🌨', label: 'Snow Grains'  },
  80: { icon: '🌦', label: 'Showers'      },
  81: { icon: '🌦', label: 'Showers'      },
  82: { icon: '⛈',  label: 'Hvy Showers'  },
  85: { icon: '🌨', label: 'Snow Shower'  },
  86: { icon: '❄',  label: 'Hvy Snow Shw' },
  95: { icon: '⛈',  label: 'Thunderstorm' },
  96: { icon: '⛈',  label: 'T-storm/Hail' },
  99: { icon: '⛈',  label: 'Severe Storm' },
};
export const WMO_FALLBACK = { icon: '☁', label: 'Unknown' };

/** Returns true when the user's locale typically uses Fahrenheit. */
function _useFahrenheit() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return ['US', 'LR', 'MM'].includes(region);
  } catch {
    return /^en(-US)?$/i.test(navigator.language ?? '');
  }
}

/** alias → intervalId — tracks auto-refresh timers for weather tiles. */
export const _weatherIntervals = new Map();

/**
 * Format a timestamp as a compact "updated Xm ago" string.
 * @param {number} ts  - Date.now() value from last successful fetch.
 */
function _formatAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1)  return 'updated just now';
  if (mins < 60) return `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `updated ${hrs}h ago`;
}

/** Resolve browser geolocation to {lat, lon}. */
function _getGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { timeout: CONFIG.GEO_TIMEOUT_MS, maximumAge: CONFIG.GEO_MAX_AGE_MS }
    );
  });
}

/** Fetch current weather from Open-Meteo. */
async function _fetchWeatherData(lat, lon) {
  const prefs    = getCachedPrefs();
  const prefUnit = prefs?.tempUnit || 'auto';
  const useFahr  = prefUnit === 'f' ? true : prefUnit === 'c' ? false : _useFahrenheit();
  const unitParam = useFahr ? 'fahrenheit' : 'celsius';
  const symbol    = useFahr ? '°F' : '°C';
  const resp = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true&temperature_unit=${unitParam}`
  );
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const data = await resp.json();
  const cw   = data?.current_weather;
  if (!cw) throw new Error('No current_weather in response');
  const code         = cw.weathercode ?? 0;
  const { icon, label } = WMO_WEATHER[code] ?? WMO_FALLBACK;
  return { temp: Math.round(cw.temperature), symbol, code, condition: label, icon };
}

/** Reverse-geocode lat/lon to a city name using Nominatim (cached). */
async function _getCityName(lat, lon) {
  const key    = `weatherCity_${Math.round(lat * 10)}_${Math.round(lon * 10)}`;
  const cached = await chrome.storage.local.get({ [key]: null });
  if (cached[key]) return cached[key];
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) throw new Error('Geocode failed');
    const data = await resp.json();
    const city =
      data?.address?.city    ||
      data?.address?.town    ||
      data?.address?.village ||
      data?.address?.county  ||
      `${lat.toFixed(1)},${lon.toFixed(1)}`;
    await chrome.storage.local.set({ [key]: city });
    return city;
  } catch {
    return `${lat.toFixed(1)},${lon.toFixed(1)}`;
  }
}

/** Push weather values into the tile's display elements. */
function _setWeatherTileContent(tile, { icon, temp, symbol, city, lat, lon, ts }) {
  const iconEl    = tile.querySelector('.dial-weather-icon');
  const tempEl    = tile.querySelector('.dial-weather-temp');
  const labelEl   = tile.querySelector('.dial-label');
  const updatedEl = tile.querySelector('.dial-weather-updated');
  if (iconEl)    iconEl.textContent  = icon ?? '☁';
  if (tempEl)    tempEl.textContent  = (temp !== null && temp !== undefined) ? `${temp}${symbol}` : '--';
  if (labelEl && city) labelEl.textContent = city;
  if (updatedEl) updatedEl.textContent = _formatAgo(ts);
  if (ts) tile.dataset.weatherTs = String(ts);
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
    const locUrl = `https://weather.com/weather/today/l/${lat.toFixed(4)},${lon.toFixed(4)}`;
    tile.href = locUrl;
    tile.setAttribute('aria-label', `Weather — ${city ?? 'local'}`);
  }
}

/**
 * Fetch fresh weather data and update the tile.
 * Silently no-ops if the tile has been removed from the DOM.
 */
export async function _refreshWeatherTile(tile) {
  if (!tile.isConnected) return;
  tile.classList.add('is-refreshing');

  if (!navigator.onLine) {
    tile.classList.remove('is-refreshing');
    const iconEl = tile.querySelector('.dial-weather-icon');
    const tempEl = tile.querySelector('.dial-weather-temp');
    if (iconEl) iconEl.textContent = '✕';
    if (tempEl) tempEl.textContent = 'OFFLINE';
    window.addEventListener('online', () => _refreshWeatherTile(tile), { once: true });
    return;
  }

  try {
    const { lat, lon } = await _getGeolocation();
    const [weather, city] = await Promise.all([_fetchWeatherData(lat, lon), _getCityName(lat, lon)]);
    const ts = Date.now();
    await chrome.storage.local.set({ weatherLast: { ...weather, city, lat, lon, ts } });
    _setWeatherTileContent(tile, { ...weather, city, lat, lon, ts });
  } catch (err) {
    console.warn('[Phosphor] Weather refresh failed:', err?.message ?? err);
    const iconEl    = tile.querySelector('.dial-weather-icon');
    const tempEl    = tile.querySelector('.dial-weather-temp');
    const updatedEl = tile.querySelector('.dial-weather-updated');
    if (iconEl) iconEl.textContent = '✕';
    if (err?.code === 1 || /denied|permission/i.test(err?.message ?? '')) {
      if (tempEl) tempEl.textContent = 'NO LOC';
      if (updatedEl) updatedEl.textContent = 'enable location access';
    } else if (!navigator.onLine) {
      if (tempEl) tempEl.textContent = 'OFFLINE';
      if (updatedEl) updatedEl.textContent = 'waiting for connection';
    } else {
      if (tempEl) tempEl.textContent = 'ERR';
      if (updatedEl) updatedEl.textContent = 'tap to retry';
    }
  } finally {
    tile.classList.remove('is-refreshing');
  }
}

/** Create the weather dial tile element. */
export function _createWeatherTileEl(dial, bindDragEventsFn) {
  const tile = document.createElement('a');
  tile.className     = 'dial-tile dial-tile--weather';
  tile.dataset.alias = dial.alias;
  tile.dataset.type  = 'weather';
  tile.href          = dial.url || 'https://weather.com';
  tile.rel           = 'noopener noreferrer';
  tile.draggable     = true;
  tile.setAttribute('aria-label', `Weather — ${dial.url || 'https://weather.com'}`);

  const row1El = document.createElement('div');
  row1El.className = 'dial-weather-row1';

  const iconEl = document.createElement('span');
  iconEl.className   = 'dial-weather-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = '⏳';

  const tempEl = document.createElement('span');
  tempEl.className   = 'dial-weather-temp';
  tempEl.textContent = '--';

  const labelEl = document.createElement('span');
  labelEl.className   = 'dial-label';
  labelEl.textContent = dial.label || 'WEATHER';

  const updatedEl = document.createElement('span');
  updatedEl.className = 'dial-weather-updated';
  updatedEl.setAttribute('aria-hidden', 'true');

  row1El.appendChild(iconEl);
  row1El.appendChild(tempEl);
  tile.appendChild(row1El);
  tile.appendChild(labelEl);
  tile.appendChild(updatedEl);

  bindDragEventsFn(tile, dial, { isWeather: true, suppressClick: true });

  tile._dialData = { ...dial };

  chrome.storage.local.get({ weatherLast: null }).then(({ weatherLast }) => {
    if (weatherLast && tile.isConnected) _setWeatherTileContent(tile, weatherLast);
    _refreshWeatherTile(tile);
  });

  const intervalId = setInterval(() => _refreshWeatherTile(tile), CONFIG.WEATHER_REFRESH_MS);
  _weatherIntervals.set(dial.alias, intervalId);

  const agoIntervalId = setInterval(() => {
    if (!tile.isConnected) { clearInterval(agoIntervalId); return; }
    const ts  = tile.dataset.weatherTs ? Number(tile.dataset.weatherTs) : null;
    const upd = tile.querySelector('.dial-weather-updated');
    if (upd && ts) upd.textContent = _formatAgo(ts);
  }, CONFIG.WEATHER_AGO_TICK_MS);

  return tile;
}

/** Patch a cached weather tile's URL; live content continues auto-updating. */
export function _patchWeatherTileEl(tile, dial) {
  const prev = tile._dialData ?? {};
  if (prev.url !== dial.url) {
    tile.href = dial.url || 'https://weather.com';
    tile.setAttribute('aria-label', `Weather — ${dial.url || 'https://weather.com'}`);
  }
  tile._dialData = { ...dial };
}
