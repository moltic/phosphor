# Privacy Policy — Phosphor: CRT Terminal New Tab

_Last updated: March 2026_

---

## Overview

Phosphor is a Chrome extension that replaces the new tab page with a retro CRT terminal interface. This policy explains what data the extension accesses, how it is stored, and what — if anything — leaves your device.

**Short version:** your data stays on your device (and in your own Google account storage). Phosphor does not collect, transmit, or sell any personal information.

---

## Data We Store

All user data is stored exclusively in Chrome's built-in extension storage APIs under your own Google account. No data is sent to any server operated by this extension.

### `chrome.storage.sync`

The following data is saved and synced across your signed-in Chrome devices, exactly as Chrome bookmarks and settings are:

| Data | Description |
|------|-------------|
| Speed dials | URLs, labels, categories, and layout you have saved |
| Notes & tasks | Text, pin status, priority, and due dates you have entered |
| Preferences | Theme, font size, clock format, sound settings, and other UI options |
| Profile | Your BBS handle, cumulative XP, and achievement unlock timestamps |

This data never leaves the Chrome sync infrastructure (Google's servers). Phosphor has no backend and no access to your sync data outside of the extension itself.

### `chrome.storage.local`

| Data | Description |
|------|-------------|
| Command history | Your terminal command history (can be disabled in Settings) |
| Pending tab dial | A temporary queue entry used when adding the current tab as a speed dial via keyboard shortcut — cleared immediately after use |

---

## Permissions Used

| Permission | Purpose |
|------------|---------|
| `storage` | Save and sync your dials, notes, preferences, and profile |
| `bookmarks` | Read your browser bookmarks for speed-dial integration |
| `tabs` | Read the URL and title of the active tab when you press the "add current tab" keyboard shortcut (Ctrl+Shift+S / ⌘⇧S) |

The `tabs` permission is used only at the moment you explicitly trigger the shortcut. Tab data is not logged, stored in history, or transmitted anywhere.

---

## Third-Party Network Requests

Phosphor makes anonymous network requests to three external services, all of which are free and privacy-respecting. No user identifier, IP address (beyond what is inherent to any HTTP request), or personal data is included in these requests.

### Open-Meteo (`api.open-meteo.com`)

Used by weather speed-dial tiles to fetch current conditions and forecast data. Requests include only a latitude/longitude coordinate and your chosen temperature unit. No account or API key is required or used.

### OpenStreetMap Nominatim (`nominatim.openstreetmap.org`)

Used to convert a place name to coordinates when you set up a weather tile by typing a location. The query string (e.g. "London") is sent as a standard search request. No personal data is attached.

### DuckDuckGo Icons (`icons.duckduckgo.com`)

Used to fetch favicon images for speed-dial tiles. Requests include only the domain of the URL you have saved (e.g. `github.com`). This is the same service used by many popular new-tab extensions.

**All three services can be bypassed** by not adding weather tiles and by disabling favicon loading (the extension functions fully without them).

---

## Geolocation

Geolocation is **never requested automatically**. It is only triggered when you add a weather dial and explicitly choose "use my current location." The resulting latitude/longitude is sent to Open-Meteo for a weather query and is not stored by Phosphor.

---

## Data Sharing

Phosphor does not:

- Collect analytics or telemetry
- Share any data with advertisers or data brokers
- Send any user data to servers controlled by this extension
- Use cookies or tracking pixels

---

## Data Retention & Deletion

Your data persists until you remove it:

- **Individual items:** use `n rm [N]` (notes) or `dial rm [alias]` (dials) at the terminal prompt
- **All data:** open Settings and use **Reset All Data**, or uninstall the extension and clear its storage via `chrome://settings/privacy` → Site data
- **Command history only:** disable History Persistence in Settings, or run `history clear`

Uninstalling the extension removes all locally stored data. Synced data in `chrome.storage.sync` is removed by Chrome when you clear extension data from your Google account.

---

## Children's Privacy

Phosphor does not knowingly collect any information from children under 13. The extension contains no user accounts, no sign-up flow, and no data collection mechanism.

---

## Changes to This Policy

If this policy changes in a material way, the "Last updated" date above will be updated and a note will appear in the extension's release notes.

---

## Contact

Questions or concerns? Open an issue at [github.com/moltic/bbtab](https://github.com/moltic/bbtab).
