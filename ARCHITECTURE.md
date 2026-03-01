# Phosphor — Architecture

## Quick orientation

| What you want to do | Where to look |
|---|---|
| Change startup behaviour | `main.js` |
| Add or edit a command | `commands/<topic>.js` + register in `commands/index.js` |
| Change how the terminal renders text | `core/render.js` |
| Add a UI widget or tweak styles | `ui/` + `style.css` |
| Touch storage / prefs | `core/storage.js` · `core/config.js` |
| Add or edit an achievement | `core/progression.js` (ACHIEVEMENTS table) |
| Touch profile / rank / XP commands | `commands/profile.js` |
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
  progression.js    ← operator profile, XP/rank, achievements (pure data + chrome.storage)

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
  fun.js            ← fortune, cal, ping, scan, matrix, hack, countdown, maze …
  data.js           ← export (JSON download) and import (JSON restore)
  onboarding.js     ← tour, skip-tour first-run commands
  profile.js        ← profile, achievements / ach, rank; exports notifyAchievement()

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

> The full legacy source lives in
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

**(4) `commands/profile.js` → `core/render.js`**
`notifyAchievement()` is the sole function exported by `commands/profile.js`
that other command modules import.  It prints the achievement-unlocked toast
using `core/render.js` after an `awardAchievement()` call returns
`{ unlocked: true }`.  Keeping the notification here decouples the pure-data
`core/progression.js` from DOM output.

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
  "prefs":  { /* see DEFAULT_PREFS in core/config.js */ },
  "profile": {
    "handle":      "CipherBlade",           // auto-generated BBS handle
    "xp":          175,                      // cumulative XP total
    "achievedAt": {
      "first_note":   1700000001000,          // epoch ms of each unlock
      "theme_change": 1700000005000
    }
  }
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
  "dials":   [ /* flat dials array (legacy format for portability) */ ],
  "notes":   [ /* notes array */ ],
  "prefs":   { /* prefs object */ },
  "profile": { /* operator profile — handle, xp, achievedAt */ }
}
```

On import, `prefs` is merged with `DEFAULT_PREFS` so any new keys added since
the backup was made are guaranteed to be present.  `profile` is restored as-is
(no merge — the backup value fully replaces the stored one).  Payloads
generated before the `profile` key existed are fully forward-compatible:
the import command silently skips restoration when `profile` is absent.

---

## Progression system

### Overview

The operator profile (`chrome.storage.sync` key `"profile"`) persists the
BBS handle, cumulative XP, and timestamps of every earned achievement.  Rank
and badge are derived at runtime from the XP total using `getRankForXp()` in
`core/progression.js`.

### Achievement IDs and hooks

| Achievement id        | Label            | XP  | Hook location                          |
|-----------------------|------------------|-----|----------------------------------------|
| `first_note`          | First Contact    | +25 | `commands/notes.js` — first `n` save   |
| `five_notes`          | Notetaker        | +40 | `commands/notes.js` — 5th+ `n` save   |
| `first_dial`          | Speed Demon      | +25 | `commands/dials-cmd.js` — `dial add`  |
| `theme_change`        | Colour Shift     | +15 | `commands/system.js` — `theme`        |
| `countdown_complete`  | On Time          | +30 | `commands/fun.js` — `countdown` zero  |
| `fortune_read`        | Fortune Cookie   | +10 | `commands/fun.js` — `fortune`         |
| `matrix_run`          | In the Matrix    | +20 | `commands/fun.js` — `matrix`          |
| `hack_complete`       | Access Granted   | +20 | `commands/fun.js` — `hack`            |
| `maze_generated`      | No Way Out       | +10 | `commands/fun.js` — `maze`            |
| `export_done`         | Backed Up        | +20 | `commands/data.js` — `export`         |
| `ten_sessions`        | Regular          | +50 | `main.js` — init() session bump ≥ 10  |
| `fifty_sessions`      | Veteran          | +100| `main.js` — init() session bump ≥ 50  |

### Idempotency guarantee

`awardAchievement(id)` checks `profile.achievedAt[id]` before every write.
If the key already exists it returns `{ unlocked: false }` immediately without
touching storage.  This means all hook call-sites are safe to call on every
relevant action — duplicate awards are impossible.

### Rank table

| Rank       | Badge | Min XP |
|------------|-------|--------|
| RECRUIT    | ▪     | 0      |
| OPERATOR   | ◆     | 50     |
| SPECIALIST | ◈     | 150    |
| TECHNICIAN | ◉     | 300    |
| HACKER     | ✦     | 500    |
| ELITE      | ⬡     | 800    |
| GHOST      | ◎     | 1200   |
| PHANTOM    | ⊕     | 2000   |
| LEGEND     | ★     | 5000   |

### Terminal commands

| Command         | Description                                              |
|-----------------|----------------------------------------------------------|
| `profile`       | Full operator card: handle, rank, XP bar, summary        |
| `whoami`        | User ID card (now includes rank + XP)                    |
| `rank`          | Rank, XP progress bar, and full rank table               |
| `achievements`  | All achievements with earned/pending status              |
| `ach`           | Alias for `achievements`                                 |

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
