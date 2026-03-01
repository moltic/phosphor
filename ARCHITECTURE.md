# Phosphor — Architecture

## Quick orientation

| What you want to do | Where to look |
|---|---|
| Change startup behaviour | `main.js` |
| Add or edit a command | `commands/<topic>.js` + register in `commands/index.js` |
| Change how the terminal renders text | `core/render.js` |
| Add a UI widget or tweak styles | `ui/` + `style.css` |
| Touch storage / prefs | `core/storage.js` · `core/config.js` |
| Write a test | `tools/*.test.js` |

---

## Canonical source tree

```
index.html          ← only HTML file; loads main.js as an ES module
main.js             ← entry point (event wiring + init)
background.js       ← MV3 service worker (Ctrl+Shift+S handler only)
manifest.json       ← extension manifest
style.css           ← all CSS (custom properties, themes, animations)

core/
  config.js         ← pure constants: CONFIG, DEFAULT_PREFS, THEMES, ALIASES …
  state.js          ← shared mutable runtime state (history, clock IDs, …)
  render.js         ← DOM print helpers, batch system, banner pipeline
  storage.js        ← chrome.storage CRUD: dials, notes, prefs, migrations
  clock.js          ← tickClock() + formatTimestamp()

ui/
  settings.js       ← applyPrefs(), settings panel, greeting helpers
  dials.js          ← speed-dial grid (render, DnD, context menu, edit dialog)
  dial-toolbar.js   ← toolbar chips (search + category filter)
  dial-composer.js  ← add/edit dial composer sheet
  weather.js        ← weather tile rendering + auto-refresh

commands/
  index.js          ← assembles full registry; exports commands + dispatch()
  help.js           ← help / ? commands
  navigation.js     ← g (Google search), l (navigate)
  notes.js          ← n, ls, rm, nuke (note CRUD)
  dials-cmd.js      ← dial subcommands (add/rm/move/rename/category/import …)
  system.js         ← clr, theme, banner, boot, uptime, whoami, settings …
  fun.js            ← fortune, cal, ping, scan, matrix, countdown, maze …
  data.js           ← export (JSON download) and import (JSON restore)

tools/
  dial-migration.test.js       ← DialStore v1 migration round-trip tests
  dial-dnd-contract.test.js    ← drag-and-drop DOM contract assertions
  dispatch-parse.smoke.test.js ← command parser / Levenshtein smoke tests
  prefs-roundtrip.smoke.test.js← prefs load/save round-trip smoke tests
  importexport.smoke.test.js   ← backup payload validation smoke tests

fonts/              ← self-hosted VT323 font files (referenced in style.css)

_archive/
  script.legacy.js  ← original pre-modular monolith; NOT loaded by the extension
```

> **`script.js`** (root) is a tombstone stub.  The full legacy source lives in
> `_archive/script.legacy.js` for historical reference only.  It must never be
> `import`-ed or added to `index.html`.

---

## Module dependency graph

Arrows point from **importer → imported**.
`core/*` modules are leaves that never import from `ui/` or `commands/`.

```
index.html
  └─ main.js (type="module")
       ├─ core/render.js      ← core/config.js
       ├─ core/state.js       (no deps)
       ├─ core/config.js      (no deps)
       ├─ core/storage.js     ← core/config.js
       ├─ core/clock.js       ← ui/settings.js          ⚠ see note (1)
       ├─ ui/settings.js      ← core/config.js
       │                      ← core/storage.js
       │                      ← core/state.js
       │                      ← core/render.js
       ├─ ui/dials.js         ← core/config.js
       │                      ← core/storage.js
       │                      ← core/render.js
       │                      ← core/state.js
       │                      ← ui/weather.js
       │                      ← ui/dial-toolbar.js
       │                      ← ui/dial-composer.js
       ├─ commands/index.js   ← commands/help.js
       │                      ← commands/navigation.js
       │                      ← commands/notes.js
       │                      ← commands/dials-cmd.js
       │                      ← commands/system.js
       │                      ← commands/fun.js
       │                      ← commands/data.js
       │                      ← core/render.js
       └─ commands/system.js  (shared import — printBootSequence)

background.js  ← (service worker, no shared imports)
```

### Notes

**(1) `core/clock.js` → `ui/settings.js`**
`tickClock()` calls `getCachedPrefs()` and `applyPrefs()` to re-render the
greeting banner when the time-of-day period changes.  This is a deliberate
upward dependency; keep it narrow (only those two helpers).

**(2) `commands/help.js` circular avoidance**
`commands/index.js` builds the full registry and then calls
`setCommandsRegistry(commands)` (an injector exported by `help.js`) so that
`help` can list all commands without creating a circular import chain.

**(3) `commands/data.js` → `ui/dials.js`**
The `import` command calls `renderDials()` after restoring a backup.  Keep
this the only place where a command module imports a UI widget directly.

---

## Storage schema  (`chrome.storage.sync`)

```jsonc
{
  "dialStore": {          // versioned DialStore (v1) — canonical since v1.0
    "version": 1,
    "categories": [
      {
        "id": "cat_default",
        "label": "",      // "" = implicit default section (no header rendered)
        "collapsed": false,
        "items": [
          { "id": "gh", "type": "link", "alias": "gh",
            "label": "GitHub", "url": "https://github.com", "icon"?: "…" },
          { "id": "div1", "type": "divider", "alias": "div1", "col"?: true },
          { "id": "wx1",  "type": "weather", "alias": "wx1",
            "label": "London", "url": "https://…" }
        ]
      }
    ]
  },
  "notes":  [ { "id": "…", "text": "…", "ts": 1700000000000 } ],
  "prefs":  { /* see DEFAULT_PREFS in core/config.js */ }
}
```

The legacy flat `dials` key is kept in sync as a one-way write for older
backup tooling but is not read once `dialStore` is present.
`migrateDialsToV1()` converts the flat array on first run.

---

## Backup / restore payload  (`export` / `import` commands)

```jsonc
{
  "_phosphor": true,
  "_version": 1,
  "_exported": "2026-02-28T12:00:00.000Z",
  "dials":  [ /* flat dials array (legacy format for portability) */ ],
  "notes":  [ /* notes array */ ],
  "prefs":  { /* prefs object */ }
}
```

On import, `prefs` is merged with `DEFAULT_PREFS` so any new keys added since
the backup was made are guaranteed to be present.

---

## Test infrastructure

All tests are plain Node.js scripts runnable with:

```
node tools/<name>.test.js
```

No test runner is required.  Each file exits with code 0 on success or throws
an unhandled error on failure (non-zero exit code).

**Isolation strategy**: because the live modules depend on browser globals
(`document`, `chrome.*`), tests either:

- copy the **pure functions** inline (clearly noted with a "Keep in sync" comment), or
- inject a **minimal mock** for `chrome.storage` using the `makeMockStorage()`
  pattern first established in `dial-migration.test.js`.

This keeps tests fast, hermetic, and dependency-free.

### Running all tests

```powershell
Get-ChildItem tools\*.test.js | ForEach-Object { node $_.FullName }
```

---

## Conventions for future contributors

1. **Add a command** → create or extend a file in `commands/`, export the
   handler map, and add it to the spread in `commands/index.js`.
2. **Shared constants** → `core/config.js` only.  Never scatter magic numbers.
3. **Mutable state** → `core/state.js` only.  Modules must never hold their
   own module-level mutable state that other modules need to observe.
4. **No `document.*` in `core/`** → keep `core/` pure; DOM work belongs in
   `ui/` or `core/render.js`.
5. **Write a test** → new pure logic should get a test in `tools/`.  Follow the
   inline-copy pattern or the chrome mock pattern — whichever is simpler.
6. **Legacy file** → `_archive/script.legacy.js` is read-only history.
   Do not edit it or re-introduce any of its code.
