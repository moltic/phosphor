# Phosphor — CRT Terminal New Tab

A retro phosphor terminal interface for your Chrome new tab page. Replaces the default new tab with an authentic CRT-style terminal — complete with speed dials, notes, games, Lua scripting, and a BBS-style progression system.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Themes & Display Modes](#themes--display-modes)
- [Commands](#commands)
  - [Navigation & Search](#navigation--search)
  - [Notes & Tasks](#notes--tasks)
  - [Speed Dials](#speed-dials)
  - [Launch Sets](#launch-sets)
  - [System](#system)
  - [Data Backup & Restore](#data-backup--restore)
  - [Fun & Games](#fun--games)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Settings](#settings)
- [Profile & Progression](#profile--progression)
- [Lua Scripting](#lua-scripting)
- [Architecture](#architecture)
- [Permissions](#permissions)
- [Privacy](#privacy)

---

## Features

- **CRT terminal aesthetic** with phosphor glow, scanlines, and authentic hardware display modes (Commodore 64, Apple II, NES, Game Boy)
- **Speed dials** — drag-and-drop bookmark tiles organized into named categories, with weather widgets
- **Notes & tasks** — inline task manager with pinning, priorities, due dates, and focus mode
- **Command-line interface** with tab-completion, history navigation, and typo suggestions
- **Lua 5.4 scripting** in a WebAssembly sandbox with a `phos` API for terminal I/O
- **Door games** — Hangman, Bulls & Cows, Chase Maze, Snake, Space Invaders
- **BBS progression system** — XP, ranks, achievements, and daily missions
- **Launch sets** — fire multiple tabs at once with a single command
- **Cross-device sync** via `chrome.storage.sync`
- **Web Audio sound effects** synthesized locally (no external files)
- **Seasonal auto-skin** — theme adjusts by time of year and time of day

---

## Installation

### From the Chrome Web Store

Search for **Phosphor — CRT Terminal New Tab** and click **Add to Chrome**.

### Manual / Developer Install

```bash
git clone https://github.com/moltic/bbtab.git
```

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the cloned directory
4. Open a new tab — the terminal will boot immediately

---

## Quick Start

On first launch, type `tour` to step through the onboarding guide, or `help` to see all available commands.

```
> help          — list all commands
> tour          — interactive onboarding (4 pages)
> theme amber   — switch color theme
> settings      — open the settings panel
> n Buy milk    — save a quick note
> dial add gh github.com  — add a speed dial
> Tab           — open the speed-dial overlay
```

---

## Themes & Display Modes

### Phosphor Palettes

Switch with `theme [name]` or `theme next` to cycle through all.

| Name      | Color           | Description                  |
|-----------|-----------------|------------------------------|
| `amber`   | #ffb000 (warm orange) | Classic amber CRT phosphor (default) |
| `green`   | #33ff77         | Monochrome green monitor     |
| `blue`    | #40b4ff         | Cyan/blue phosphor           |
| `white`   | #cccccc         | Grayscale                    |
| `crimson` | #ff3030         | Blood-red phosphor           |
| `matrix`  | #00e040         | Deep saturated green         |
| `ice`     | #8ecfea         | Pale blue-grey               |
| `warm`    | #ffc840         | Brighter amber               |

### Hardware Display Modes

Set via `settings → Display Mode`. Each applies an authentic font, palette, and size.

| Mode          | Hardware              | Font               | Background  |
|---------------|-----------------------|--------------------|-------------|
| `classic`     | Generic CRT           | VT323              | Black       |
| `c64`         | Commodore 64          | Press Start 2P     | Cobalt blue |
| `appleIIGreen`| Apple II green monitor| PR Number 3        | Dark green  |
| `nes`         | Nintendo Entertainment System | Press Start 2P | Navy blue |
| `gameBoy`     | Game Boy LCD          | Press Start 2P     | Pea green   |

### Auto-Skin

Enable in settings. Automatically selects a theme based on the current season and time of day.

| Season | Day | Night |
|--------|-----|-------|
| Winter (Dec–Feb) | ice | blue |
| Spring (Mar–May) | matrix | amber |
| Summer (Jun–Aug) | warm | amber |
| Autumn (Sep–Nov) | crimson (4pm–10pm) | amber |

---

## Commands

Type any command at the `>` prompt and press Enter. Tab completes partial command names. Use ↑/↓ to navigate history.

### Navigation & Search

| Command | Description |
|---------|-------------|
| `g [query]` | Google search |
| `l [alias \| url]` | Navigate to a saved dial alias or URL |

Built-in aliases for `l`: `reddit`, `yt`, `gh`, `tw`, `wiki`, `hn`, `mail`, `maps`

### Notes & Tasks

| Command | Description |
|---------|-------------|
| `n [text]` | Save a quick note |
| `n rm [N]` | Delete note by index |
| `n clear` | Delete all notes (requires `CONFIRM`) |
| `n find [query]` | Search notes (case-insensitive) |
| `n edit [N] [text]` | Replace note text |
| `n pin [N]` | Promote note to pinned task |
| `n unpin [N]` | Remove pin |
| `n done [N]` | Mark task complete |
| `n undone [N]` | Mark task incomplete |
| `n prio [N] high` | Set task priority to high |
| `n prio [N] normal` | Reset priority |
| `n due [N] [YYYY-MM-DD \| today]` | Set due date |
| `n due [N] clear` | Remove due date |
| `today` | Show tasks due today and overdue |
| `focus` | Show all open pinned tasks, sorted by priority |
| `ls` | List all notes and speed dials with timestamps |

### Speed Dials

Open the dial overlay with **Tab** or **Ctrl+D** / **⌘D**, or use commands to manage dials.

| Command | Description |
|---------|-------------|
| `dial add [alias] [url]` | Add a new speed dial |
| `dial add [alias] [url] --category [name]` | Add to a specific category |
| `dial rm [alias]` | Remove a dial |
| `dial move [alias] [category]` | Move dial to a different category |
| `dial rename [alias] [new-label]` | Rename a dial's display label |
| `dial category [label]` | Create a new category |
| `dial divider [alias]` | Insert a visual column-break divider |
| `dial weather [alias] [location]` | Add a live weather widget tile |
| `dial import` | Restore dials from a JSON backup (destructive) |

**Speed dial interactions:**
- **Drag and drop** to reorder within or between categories
- **Double-click** to edit label or URL inline
- **Right-click** for context menu (copy, edit, remove)
- **Long-press** (500 ms on touch) opens the context menu
- Deleted dials show an undo toast for 5 seconds

**Weather dials** pull from the free [Open-Meteo](https://open-meteo.com/) API. They auto-refresh every 10 minutes and show the current condition, temperature (°C or °F), and a weather icon. Location can be set manually or via browser geolocation.

### Launch Sets

Group multiple dials and open them all with one command.

| Command | Description |
|---------|-------------|
| `launch` | List saved launch sets and recent/most-used dials |
| `launch save [name] [alias …]` | Create a new launch set |
| `launch edit [name] [alias …]` | Update aliases in an existing set |
| `launch rename [name] [new]` | Rename a set |
| `launch rm [name]` | Delete a set |
| `launch [name]` | Open all dials in the set (warns if >5 tabs) |
| `launch stats` | Show per-dial usage statistics |
| `launch clear-stats` | Reset usage tracking |

### System

| Command | Description |
|---------|-------------|
| `help` | List all commands by category |
| `keys` | Show keyboard shortcuts table |
| `theme [name \| next]` | Switch color theme |
| `settings` | Open settings panel |
| `boot` | Replay startup sequence |
| `clr` / `clear` | Clear terminal output |
| `history` | Print session command history |
| `motd [text]` | Set a message of the day shown on every boot |
| `motd clear` | Clear the MOTD |
| `banner [text]` | Render text as ASCII banner art |
| `uptime` | Show session elapsed time |
| `whoami` | Display your BBS operator card |
| `sysinfo` | Browser, platform, and hardware info |
| `syncstatus` | Dump raw chrome.storage.sync contents |
| `shutdown` | CRT power-off animation (requires `CONFIRM`) |

### Data Backup & Restore

| Command | Description |
|---------|-------------|
| `export` | Download a full JSON backup (dials, notes, prefs, profile) |
| `import` | Restore from a JSON backup (destructive, requires `CONFIRM`) |

Backup filename format: `phosphor-backup-YYYY-MM-DD.json`

### Fun & Games

| Command | Description |
|---------|-------------|
| `fortune` | Random hacker/BBS quote |
| `cal` | Calendar for the current month |
| `ping [host]` | Simulated ICMP ping with RTT values |
| `scan` | Fake TCP port scan animation |
| `typewriter [text]` | Print text character by character |
| `beep` | Play a retro 800 Hz square-wave beep |
| `cow [text]` | Print text in a cowsay speech bubble |
| `noise [lines]` | Random ASCII static (default 8, max 24 lines) |
| `matrix` | Falling-character rain animation (~3 seconds) |
| `hack` | Multi-stage fake intrusion sequence |
| `countdown [N \| stop]` | Timer in minutes (default 5, max 1440) |

#### Door Games

| Command | Description |
|---------|-------------|
| `games` | Game hub with descriptions and controls |
| `hangman` | Guess tech-themed words (6 wrong guesses allowed) |
| `bullscows` | Code-breaking number game (Bulls & Cows) |
| `chasemaze` | Real-time maze escape with arrow-key controls |
| `lua-snake` | Classic Snake in Lua |
| `lua-invaders` | Space Invaders-style shooter in Lua |

High scores are persisted per game. `hangman` and `bullscows` track top scores by date and handle.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Navigate command history |
| `Tab` (empty input) | Open speed-dial overlay |
| `Tab` (partial input) | Auto-complete command name |
| `Ctrl+D` / `⌘D` | Toggle speed-dial overlay |
| `Ctrl+L` / `⌘L` | Clear terminal screen |
| `Ctrl+,` / `⌘,` | Open / close settings panel |
| `Escape` | Clear input / cancel |
| `Enter` | Submit command |
| `Ctrl+Shift+S` / `⌘⇧S` | Add current browser tab as a speed dial |

**In-game controls:**
- **Hangman / Bulls & Cows:** Type your guess, press Enter
- **Chase Maze:** Arrow keys to move, `Q` to quit
- **Snake / Invaders:** Arrow keys to move, `Space` to shoot (Invaders)

---

## Settings

Open with `settings` or **Ctrl+,** / **⌘,**. All preferences sync across devices via `chrome.storage.sync`.

| Setting | Options | Default |
|---------|---------|---------|
| Theme | amber, green, blue, white, crimson, matrix, ice, warm | amber |
| Display Mode | classic, c64, appleIIGreen, nes, gameBoy | classic |
| Terminal Size | small, medium, large | medium |
| Dial Size | small, medium, large | medium |
| Dial Layout | auto, comfortable, compact | auto |
| Scanlines | on / off | on |
| CRT Intensity | off, low, medium, high | medium |
| Cursor Blink Speed | slow, normal, fast | normal |
| Clock Format | auto, 12h, 24h | auto |
| Temperature Unit | auto, °C, °F | auto |
| Greeting Mode | time-of-day greeting | on |
| Greeting Name | custom name string | — |
| Banner Text | custom banner text | — |
| Auto-Skin | seasonal/time theme selection | off |
| Sounds | retro key clicks and boot chime | off |
| Boot Sound | always / daily (once per day) | always |
| Reduced Motion | disable all animations | off |
| Simulated Latency | typewriter character reveal | off |
| Dial Click Target | new-tab, same-tab, new-window | new-tab |
| Dial Open on Load | auto-open dial overlay on boot | off |
| History Persistence | save command history across sessions | on |

---

## Profile & Progression

Phosphor tracks your usage across sessions with a BBS-style operator profile.

### Ranks

Earn XP by completing achievements and daily missions.

| Rank | XP Required | Symbol |
|------|-------------|--------|
| RECRUIT | 0 | ▪ |
| OPERATOR | 50 | ◆ |
| SPECIALIST | 150 | ◈ |
| TECHNICIAN | 300 | ◉ |
| HACKER | 500 | ✦ |
| ELITE | 800 | ⬡ |
| GHOST | 1200 | ◎ |
| PHANTOM | 2000 | ⊕ |
| LEGEND | 5000 | ★ |

View your rank with `rank`, or your full card with `profile`.

### Achievements

| Achievement | XP | Trigger |
|-------------|----|---------|
| First Contact | +25 | Save your first note |
| Notetaker | +40 | Save 5 or more notes |
| Speed Demon | +25 | Add your first speed dial |
| Colour Shift | +15 | Change the theme |
| On Time | +30 | Let a countdown reach zero |
| Fortune Cookie | +10 | Run `fortune` |
| In the Matrix | +20 | Run `matrix` |
| Access Granted | +20 | Complete the `hack` sequence |
| No Way Out | +10 | Generate a maze |
| Backed Up | +20 | Export a backup |
| Regular | +50 | Open the terminal 10 times |
| Veteran | +100 | Open the terminal 50 times |
| Word Warden | +30 | Win Hangman |
| Code Cracker | +30 | Solve Bulls & Cows |
| Mind Reader | +50 | Solve Bulls & Cows in ≤3 guesses |
| Ghost Runner | +35 | Escape Chase Maze |
| Door Jockey | +40 | Set a high score in 5 door games |

View all with `achievements` or `ach`.

### Daily Missions

Five missions reset at midnight. Complete them to earn XP and unlock cosmetic rewards. View with `missions`.

---

## Lua Scripting

Phosphor embeds **Lua 5.4** via [Wasmoon](https://github.com/nicholasgasior/wasmoon) in a fully sandboxed WebAssembly environment.

```
> lua print("hello from Lua!")
> lua for i = 1, 5 do phos.draw(i .. "\n") end
```

Multiline scripts are supported — everything after the `lua` keyword is treated as a single script block.

### phos API

| Function | Description |
|----------|-------------|
| `phos.cls()` | Clear the terminal screen |
| `phos.draw(text)` | Write text (supports ANSI SGR color codes) |
| `phos.sleep(ms)` | Non-blocking delay in milliseconds |
| `phos.read_key()` | Block and wait for a single keypress |
| `phos.store(key, value)` | Persist a value to `chrome.storage.local` |
| `phos.fetch(key)` | Retrieve a persisted value |

### Color Table (`phos.color`)

`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white` — plus bright variants prefixed with `b` (e.g. `phos.color.bgreen`), and `reset`.

```lua
phos.draw(phos.color.bgreen .. "HELLO" .. phos.color.reset .. "\n")
```

### Built-in Lua Programs

| Command | Description |
|---------|-------------|
| `lua-demo` | Full `phos` API showcase — palette, animation, key input, storage |
| `lua-snake` | Classic Snake |
| `lua-invaders` | Space Invaders-style shooter |

---

## Architecture

```
bbtab/
├── manifest.json       Chrome Extension Manifest V3
├── index.html          New tab page entry point
├── main.js             Terminal core, event loop, command dispatch
├── background.js       Service worker (tab capture, keyboard shortcut)
├── style.css           All visual styles and theme variables
├── lua-sandbox.html    Isolated Lua execution context (sandboxed page)
├── lua-sandbox.js      Wasmoon WASM loader and phos API bridge
│
├── core/
│   ├── storage.js      chrome.storage.sync/local abstraction + sync
│   ├── render.js       Terminal output renderer (batch DOM, ANSI, typewriter)
│   ├── lua-vm.js       Lua VM controller, script runner, message bridge
│   └── config.js       Global constants (history max, speeds, etc.)
│
├── ui/
│   ├── dials.js        Speed-dial overlay, drag-drop, context menu
│   ├── dial-composer.js Dial tile rendering and favicon fetching
│   ├── weather.js      Open-Meteo weather widget integration
│   ├── settings.js     Settings panel UI and preference management
│   ├── launch-panel.js Launch set management UI
│   ├── profile.js      XP, ranks, achievements, missions, cosmetics
│   └── boot.js         Boot sequence, banner variants (classic/C64/NES)
│
├── commands/
│   ├── index.js        Command registry and dispatch
│   ├── notes.js        Note and task commands
│   ├── dials.js        Dial management commands
│   ├── system.js       System commands (theme, settings, export, etc.)
│   └── fun.js          Games, animations, and easter eggs
│
├── fonts/
│   └── VT323.woff2     Self-hosted terminal font
│
└── vendor/
    ├── wasmoon.js      Lua 5.4 WebAssembly runtime
    └── glue.wasm       WASM binary (~260 KB)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deeper technical overview.

---

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Save and sync dials, notes, preferences, and profile across devices |
| `bookmarks` | Access bookmarks for speed-dial integration |
| `tabs` | Capture the current tab's URL and title when adding a speed dial via keyboard shortcut |

**Host permissions:**
- `https://api.open-meteo.com/*` — free weather data for weather dials
- `https://nominatim.openstreetmap.org/*` — geocoding for weather location search
- `https://icons.duckduckgo.com/*` — favicon images for speed-dial tiles

No data is collected, stored remotely, or shared with third parties. All user data stays in `chrome.storage.sync` under your Google account.

---

## Privacy

Phosphor stores all user data locally in `chrome.storage.sync` (synced via your Google account, like bookmarks). No data is sent to any server operated by this extension.

**Third-party API calls are:**
- **Anonymous** — no user identifier is ever sent
- **Optional** — weather dials require explicit user setup; favicon fetching can be blocked by disabling network access
- **Transparent** — Open-Meteo, OpenStreetMap Nominatim, and DuckDuckGo Icons are all free, privacy-respecting services

**Geolocation** is only requested when you add a weather dial and choose to use your current location. The coordinate is used for a one-time weather query and is not stored.

To remove all extension data: open Settings → scroll to the bottom → **Reset All Data**, or uninstall the extension and clear extension storage from `chrome://settings/privacy`.
