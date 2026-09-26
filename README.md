# GBot: Gladiatus Autopilot

A browser extension for **Chrome** (and Edge, Brave, Opera) and **Firefox** that plays
[Gladiatus](https://gladiatus.gameforge.com) for you. It runs in your normal game tab and clicks
through the game the way a player would. You control it from a bar inside the game, in the style
of Gladiatus Time Saver, and a settings window lets you tailor every activity.

> **Read this first.** Gameforge's terms of service forbid bots. Using this extension can get your
> account suspended or banned. You use it at your own risk.

![In-game control bar](docs/control-bar.png) ![Settings window](docs/settings-window.png)

## Features

| Activity | What the bot does |
| --- | --- |
| **Expeditions** | Attacks the enemy you choose (1-4) at a location you pick from the game's own list, or at your last visited one, whenever the cooldown is ready. It can keep some points in reserve. |
| **Dungeons** | Starts a Normal or Advanced dungeon when none is running, then fights the enemies one by one. |
| **Arena Provinciarum** | Attacks the lowest-level, highest-level or a random opponent. It can stick to opponents near your level and skip names on a never-attack list. If the game refuses a fight, it tries another opponent. |
| **Circus Turma Provinciarum** | Same options as the arena. |
| **Healing** | Eats food below one HP threshold and stops fighting below another. It searches every bag and picks the food that best fills the missing HP. |
| **Stable work** | Optional. Once you are out of expedition and dungeon points, it starts the job and number of hours you chose. |
| **Pantheon quests** | Optional. Collects finished quests and accepts new ones of the types you pick. |
| **Pop-ups** | Collects the daily login bonus and closes notification dialogs. |

You can also tailor how the bot behaves:

* **Priority.** Choose which activity goes first when several are ready at once.
* **Schedule.** Play only between set hours (overnight ranges work, e.g. 22:00 → 06:00), and take
  random breaks, e.g. about 15 minutes every 2 hours. Both vary by ±30%.
* **Human-like timing.** Every click waits a random delay in a range you set. Between actions the
  bot sleeps until the next cooldown ends instead of polling.
* **Loop protection.** An activity that keeps failing, for example after a game update, is paused
  for a while instead of reloading the page forever. The reason appears in the log.
* **Notifications.** Desktop alerts when you are logged out, when an activity gets paused, or when
  HP is low and there is no food left. Each one can be turned off.
* **One tab per server, with a watchdog.** Only one game tab runs the bot. If that tab hangs, it is
  reloaded.
* **Backup.** Export your settings to a file, import them in another browser, or reset them.

## The interface

### Control bar (on every game page)

* **Start / Stop** turns the bot on and off.
* **Check now** re-checks the game immediately. **Minimise** folds the bar down to its title.
* **Status** shows what the bot is doing, what comes next and when, plus your HP, expedition and
  dungeon points, and gold.
* **Activity tiles** (Expedition, Dungeon, Arena, Circus, Heal, Work, Quests):
  * Click a tile to switch that activity on or off.
  * Each tile shows its live state: *ready*, a cooldown countdown, *no points*, *low HP*, *paused*,
    or *off*.
  * Hover a tile and click its small gear to open that activity's settings.
* **Footer:** statistics for the session, and shortcuts to the stats and log.

The bar floats and can be dragged anywhere; its position is remembered. Under *Interface* you can
instead dock it along the top of the page, where it pushes the game down rather than covering it:

![Docked bar](docs/docked-bar.png)

### Settings window

Open it with the gear in the bar, the *Settings* tile, or a tile's own gear. It has one tab per
feature. Activity tabs have an on/off switch in their title, and the green dots in the sidebar show
what is enabled. Changes save as you make them and take effect immediately.

| Tab | Options |
| --- | --- |
| General | Bot on/off, activity priority order |
| Expedition | Location (last visited, one from the game's list, or any id), enemy 1-4, points to keep in reserve |
| Dungeon | Location, Normal/Advanced, points to keep in reserve |
| Arena / Circus Turma | Lowest / highest / random opponent, level range around yours, never-attack list |
| Health | Eat food below X% HP, stop fighting below Y% HP |
| Stable work | Job number, hours |
| Quests | Quest types to accept |
| Schedule | Active hours, random breaks |
| Timing & safety | Click delay range, longest idle time, failed attempts before pausing, pause length |
| Notifications | Which desktop notifications to show |
| Interface | Show the bar, floating or docked |
| Statistics | Fights per activity, per-hour rates, gold change, reset |
| Log | Recent activity, filter to warnings only, clear |
| Backup | Export to a file or the clipboard, import, reset to defaults |

### Toolbar popup and options page

The toolbar button opens a compact version of the same settings, with icon-only tabs, a Start/Stop
button and the server's status. The *open in tab* button, or the browser's extension options,
shows the full-size settings page. If you play on several servers, it also has a server selector
for statistics and logs.

<img src="docs/popup.png" alt="Popup" width="330">

## Installation

### From source (developer mode)

1. Download or clone this repository.
2. **Chrome / Edge / Brave / Opera:** open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked** and select the repository folder (the one containing `manifest.json`).
3. **Firefox (121+):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary
   Add-on...** and select `manifest.json`. Temporary add-ons are removed when Firefox restarts.
   For a permanent install, sign the package from `npm run build` on addons.mozilla.org.

In Firefox the extension may start without access to the game website. If the popup shows
**Grant access**, click it (or allow the site under *about:addons → GBot → Permissions*).

### Packaged zips

```sh
npm install
npm run build        # -> dist/gbot-chrome.zip and dist/gbot-firefox.zip
```

## Usage

1. Log in to your Gladiatus server as usual. The GBot bar appears on the game page.
2. Switch the activities you want on in the tiles. Fine-tune them in the settings window.
3. Press **Start**.

Keep the game tab open (it can be in the background). The bot never logs in for you: if the session
expires, log in again and it carries on. Settings saved by version 1.0 are migrated automatically.

## How it works

```
manifest.json                 MV3 manifest, valid for Chrome and Firefox
src/shared/settings.js        defaults, validation rules, migration, storage
src/content/selectors.js      ALL knowledge of the game's HTML (IDs, classes, URLs)
src/content/state.js          reads HP, points, cooldowns, locations, dialogs from the DOM
src/content/brain.js          pure decision engine: priority, schedule, retries, tile status
src/content/actions.js        performs decisions: navigate, click, drag food, fill forms
src/content/main.js           runner: read state → decide → act, once per page load
src/content/panel.js          in-game control bar + settings window (shadow DOM)
src/ui/schema.js              declarative list of every settings tab and field
src/ui/settings-ui.js         renders the schema; shared by game window, popup and options page
src/ui/dom.js, styles.js      DOM helpers, icons, Gladiatus-style theme
src/pages/                    toolbar popup and options page
src/background/background.js  badge, tab lock, watchdog, notifications
```

Gladiatus reloads the page for almost every action, so the bot is a small state machine that runs
again on every page load:

1. Read the game state from the page.
2. Check whether the previous action worked, for example whether the cooldown started or HP went up.
3. Decide the next step.
4. Perform it.

Anything that must survive a page load, such as attempt counters, work end time, stats and the
log, is kept per server in extension storage.

To add a setting, add a default in `settings.js`, optionally a validation rule, and a field in
`schema.js`. The settings window, popup and options page pick it up automatically.

### When Gameforge changes the game

All selectors live in [`src/content/selectors.js`](src/content/selectors.js). If a feature stops
working, the bot pauses that activity and logs what it could not find. Updating the matching
selector there is usually enough. The selectors follow the structure used by established
open-source Gladiatus tools (such as Gladiatus Crazy Addon and several userscripts), but the live
game can differ between servers and versions.

## Development

```sh
npm install
npm run lint        # syntax check; every file referenced by the manifest and pages exists
npm test            # unit tests: decision engine, settings, parsers, settings UI (jsdom)
npm run test:e2e    # loads the extension in Chromium and plays against a mock game server
npm run icons       # regenerate icons/*.png
npm run build       # dist/gbot-chrome.zip, dist/gbot-firefox.zip
```

The end-to-end tests (`test/e2e/`) serve a mock Gladiatus server through Playwright request
interception. It uses the same page structure as the real game, with real jQuery UI for the
inventory drag and drop. The tests cover:

* game play: expeditions, dungeons, arena and circus (including opponent filters), eating food,
  the login bonus, stable work, quests, and backoff on repeated failures;
* the interface: the control bar tiles and layouts, the in-game settings window, the popup, and
  the options page (statistics, log, import, reset).

They need a Chromium binary: set `CHROMIUM_PATH`, or install Playwright's Chromium.

## License

GPL-3.0, see [LICENSE](LICENSE).
