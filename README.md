# GBot: Gladiatus Autopilot

A browser extension for **Chrome** (and Edge, Brave, Opera) and **Firefox** that plays
[Gladiatus](https://gladiatus.gameforge.com) for you. It runs in your normal game tab and clicks
through the game the way a player would.

> **Read this first.** Gameforge's terms of service forbid bots. Using this extension can get your
> account suspended or banned. You use it at your own risk.

## Features

| Activity | What the bot does |
| --- | --- |
| **Expeditions** | Attacks the enemy you choose (1-4) at a fixed location, or at your last visited location (`auto`) whenever the cooldown is ready and you have expedition points. |
| **Dungeons** | Starts a Normal or Advanced dungeon when none is running, then fights the enemies one by one. |
| **Arena Provinciarum** | Attacks the lowest-level, highest-level or a random opponent from the list. If the game refuses the fight, it tries another opponent. |
| **Circus Turma Provinciarum** | Same as the arena, for the circus. |
| **Healing** | When HP drops below your threshold, it eats food. It searches every inventory bag and picks the food that best fills the missing HP. With no food it waits for HP to regenerate. |
| **Stable work** | Optional. Once you are out of expedition and dungeon points, it starts the job you chose for the number of hours you set. |
| **Pantheon quests** | Optional. Collects finished quests and accepts new ones of the types you pick. |
| **Pop-ups** | Collects the daily login bonus and closes notification dialogs. |

Safety and quality-of-life:

* **Human-like timing.** Every click waits a random delay (configurable). The bot sleeps until the
  next cooldown ends instead of polling.
* **Loop protection.** An activity that keeps failing (for example a changed page layout) is paused
  for a while instead of reloading the page forever. The reason appears in the log.
* **One tab per server.** If several game tabs are open, only one runs the bot.
* **Watchdog.** If the bot's tab hangs, the background script reloads it. If you get logged out,
  you get a desktop notification.
* **Status panel.** A small panel on the game page shows what the bot is doing, when it will check
  next, and your HP and points. It also has stats, a log, and **Start/Stop** and **Check now**
  buttons.

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

1. Log in to your Gladiatus server as usual.
2. Click the GBot toolbar icon and pick what the bot should do.
3. Press **Start**, either in the popup or on the in-game panel.

Keep the game tab open (it can be in the background). The bot stops when you press **Stop**. It
never logs in for you: if the session expires, log in again and it carries on.

### Settings

* **Location.** `auto` uses the location the game's expedition/dungeon cooldown bar points to
  (your last visited one). A number fixes the location id, the `loc=` value in the URL of the
  location page.
* **Enemy.** Which of the four expedition enemies to attack. #4 is the location boss.
* **Min HP %.** Expeditions, dungeons and the arena are skipped below this value. Circus fights do
  not use your HP, so they continue.
* **Job #.** The position of the job in the stable's job list (1 = first).
* **Hours.** The bot picks the longest duration the stable offers that does not exceed this value.
* **Timing & safety.** Click delay range, the longest sleep between checks, how many failed
  attempts pause an activity, and for how long.

## How it works

```
manifest.json               MV3 manifest, valid for Chrome and Firefox
src/shared/settings.js      default settings + validated storage helpers
src/content/selectors.js    ALL knowledge of the game's HTML (IDs, classes, URLs)
src/content/state.js        reads HP, points, cooldowns, page, dialogs from the DOM
src/content/brain.js        pure decision engine: what to do next, retries, backoff
src/content/actions.js      performs the decision: navigate, click, drag food, fill forms
src/content/main.js         runner: read state → decide → act, once per page load
src/content/overlay.js      in-page status panel (shadow DOM)
src/background/background.js  badge, tab lock, watchdog, notifications
src/popup/                  settings UI
```

Gladiatus reloads the page for almost every action, so the bot is a small state machine that runs
again on every page load:

1. Read the game state from the page.
2. Check whether the previous action worked, for example whether the cooldown started or HP went up.
3. Decide the next step.
4. Perform it.

Anything that must survive a page load, such as attempt counters, work end time, stats and the
log, is kept per server in extension storage.

### When Gameforge changes the game

All selectors live in [`src/content/selectors.js`](src/content/selectors.js). If a feature stops
working, the bot pauses that activity and logs what it could not find. Updating the matching
selector there is usually enough. The selectors follow the structure used by established
open-source Gladiatus tools (such as Gladiatus Crazy Addon and several userscripts), but the live
game can differ between servers and versions.

## Development

```sh
npm install
npm run lint        # syntax check + every file referenced by the manifest exists
npm test            # unit tests: decision engine, parsers, DOM state reader (jsdom)
npm run test:e2e    # loads the extension in Chromium and plays against a mock game server
npm run icons       # regenerate icons/*.png
npm run build       # dist/gbot-chrome.zip, dist/gbot-firefox.zip
```

The end-to-end tests (`test/e2e/`) serve a mock Gladiatus server through Playwright request
interception. It uses the same page structure as the real game, with real jQuery UI for the
inventory drag and drop. The tests cover expeditions, dungeons (start and fight), arena and
circus opponent choice, eating food from another bag, the login bonus, stable work, quests,
backoff on repeated failures, and the popup. They need a Chromium binary: set `CHROMIUM_PATH`,
or install Playwright's Chromium.

## License

GPL-3.0, see [LICENSE](LICENSE).
