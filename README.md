# GBot: Gladiatus Autopilot

A browser extension for **Chrome** (and Edge, Brave, Opera) and **Firefox** that plays
[Gladiatus](https://gladiatus.gameforge.com) for you. It runs in your normal game tab and clicks
through the game the way a player would. 

> **Read this first.** Gameforge's terms of service forbid bots. Using this extension can get your
> account suspended or banned. You use it at your own risk.

![In-game control bar](docs/control-bar.png) ![Settings window](docs/settings-window.png)

## Features

| Activity | What the bot does |
| --- | --- |
| **Expeditions** | Attacks the enemy you choose (1-4) at a location you pick from the game's own list, or at your last visited one, whenever the cooldown is ready. It can keep some points in reserve. With the boss selected, it can first fight the location's other enemies until all their bonuses are learned, so the boss gets them too (see below). |
| **Dungeons** | Starts a Normal or Advanced dungeon when none is running (Normal where Advanced is not unlocked yet), then fights the enemies one by one. Optionally it never fights the boss: the other enemies go first, then the dungeon is cancelled and a new one started. It can also start over after a number of lost fights in a row. The ruby button that skips the cooldown is never used. |
| **Underworld** | Optional. From level 100: fights the Underworld's enemies with its own expedition points, always the newest area and enemy, and waits for HP to regenerate since food cannot be eaten there. It can also enter the Underworld for you (Normal, Middle or Hard) whenever it is allowed again. It never leaves, never turns back or shortens the journey, and never attacks without points (that would cost rubies). |
| **Arena Provinciarum** | Attacks the lowest-level, highest-level or a random opponent. It can stick to opponents near your level and skip names on a never-attack list. Opponents who beat you are skipped for a while (24 hours by default). If the game refuses a fight, it tries another opponent. |
| **Circus Turma Provinciarum** | Same options as the arena. |
| **Enemy nests** | After some wins the game offers to search the enemy's nest for extra loot. The bot does a quick search, a thorough search, or returns to safety, as you choose. |
| **Healing** | Eats food below one HP threshold and stops fighting below another. It searches every bag and picks the food that best fills the missing HP; when the bags are empty it takes food from the packages. |
| **Training** | Optional. Spends gold above a reserve you set on stat points, always on the cheapest of the stats you pick, which keeps them balanced. Gold you spend cannot be stolen in the arena. |
| **Repair** | Optional. When an item you wear drops below a conditioning threshold, the bot takes it off, repairs it at the workbench with materials from the Horreum, and puts it back on (see below). |
| **Stable work** | Optional. Once you are out of expedition and dungeon points, it starts the job and number of hours you chose. |
| **Pantheon quests** | Optional. Collects finished quests and accepts the best-paying new one of the types you pick. It skips quests for places you do not fight at and for activities that are switched off, and stops when all quest slots are taken. |
| **Pop-ups** | Collects the daily login bonus and closes notification dialogs. |
| **Packages** | A **Store all resources in the Horreum** button on the packages page moves every resource from all your packages into the Horreum in one go. Optionally, every 30 minutes the bot also tidies the packages: it takes the gold out of gold packages, stores resources in the Horreum, sells weapons, armour and jewellery up to a quality you choose to a merchant, and moves packages that are about to expire into your bags (or sells them). |
| **Smelting** | Tick weapons, armour and jewellery on the packages page (one by one, or **Tick all on this page**) to queue them for smelting, or let rules pick them by quality and kind. While running, the bot fills free smelter slots from the queue, pays the rent in gold and puts the resources of finished smelts in the Horreum (or in a package). |
| **Auction house** | Optional. Bids on food and healing potions that heal at least the HP per gold you set, late in the auction round, once per lot, within a gold reserve, a budget per round and a limit on how much food you hold. Won items arrive as packages. |

**The bot never spends rubies.** Workbench and smelter rent is paid in gold, expedition bonuses are
only learned by fighting, auction Buyout (which costs rubies) is never used, and neither are the
buttons that skip a dungeon cooldown, shorten the journey to the Underworld, or attack there without
expedition points.

### The Underworld

The Hermit sends characters of level 100 and above to the Underworld for 8,000 gold: four areas of
three enemies and a boss each, ending with Dīs Pater. Inside, the Underworld has its own 18
expedition points, there are no dungeons, and food cannot be eaten.

With *Underworld* switched on, the bot fights there whenever the expedition cooldown is ready: the
newest unlocked area and its newest open enemy, with the stakes slider left at its default. It
waits for HP to regenerate above your limit (60% by default), because falling to 0 HP only offers to
leave, and leaving locks the Underworld for days. For the same reason it never follows *Leave the
Underworld*, and closes the game's dialogs there instead of answering them. When the points run
out it stops: further attacks would cost rubies.

*Enter automatically* takes the Hermit's offer on the difficulty you choose whenever it is allowed
again. The journey (about 30 minutes, less on speed servers) is waited out.

**Careful with the auction house:** the game keeps your gold if someone outbids you. That is why the
bot bids only when the round is ending (by default) and never twice on the same lot.

### Expedition bonuses before the boss

Every expedition enemy has four bonuses (more gold, experience, item chance and honour). Each win
against an enemy has a chance to teach you one of its missing bonuses. The chance is shown in the
bonus tooltip and depends on your character and the enemy. Once enemies 1-3 of a location have
learned a bonus, the game switches it on for the boss as well.

With the boss selected and *Before the boss, learn the other enemies' bonuses* on, the bot fights
enemies 1-3 in turn, always the first one with bonuses still to learn, and moves on to the boss when
they are done. The log shows the progress, e.g. *Skeleton Berserker has 4 bonuses left to learn
(25% per win), fighting it before the boss*. Bonuses you gave up (deactivated for rubies) cannot be
learned in combat and are not waited for.

### Repairing gear at the workbench

When an item on your character drops below the *Repair below* threshold (50% conditioning by
default), the bot:

1. takes the item off into a free spot in your bags;
2. checks the Horreum for the materials the workbench asks for, using the lowest quality first and
   stopping at the best quality you allow (Neptun, blue, by default);
3. rents a workbench slot for gold, fills in the materials and starts the repair;
4. collects the repaired item from the packages and puts it back on.

Fights wait while an item is off your character. If the Horreum has no suitable materials, the item
goes straight back on and is tried again in 6 hours. If a step keeps failing, the bot puts the item
back on, or logs where it is (on the workbench or in the packages).

### Tidying the packages

Under *Smelting* and *Packages* you set rules by quality (Standard, Ceres, Neptun, ...) and kind
(weapons, armour, rings and amulets). Every 30 minutes while the bot runs, it goes through all your
packages:

1. gold packages are opened, so the gold goes to your character;
2. resources go to the Horreum, if you want;
3. gear matching a smelting rule joins the smelting queue, as if you had ticked it;
4. gear matching a selling rule is sold to a merchant for its value, through a free spot in your
   bags (like dragging it onto the merchant);
5. packages about to expire (less than 24 hours left by default) are moved into your bags, or sold.

Items you ticked for smelting are never sold. Smelting rules go before selling rules, and anything
that matches no rule stays where it is. All of it is off until you switch it on.

The overview page also gets a **Repair all** button under your character. It repairs every item at
or below a cutoff (60% by default, changeable under *Repair*), worst first, one at a time. It works
even while the bot is stopped.

You can also tailor how the bot behaves:

* **Priority.** Choose which activity goes first when several are ready at once.
* **Schedule.** Play only between set hours (overnight ranges work, e.g. 22:00 → 06:00), and take
  random breaks, e.g. about 15 minutes every 2 hours. Both vary by ±30%.
* **Human-like timing.** Every click waits a random delay in a range you set. Between actions the
  bot sleeps until the next cooldown ends instead of polling.
* **Loop protection.** An activity that keeps failing, for example after a game update, is paused
  for a while instead of reloading the page forever. The reason appears in the log.
* **Fight results.** Every combat report is read. The log shows each fight as won or lost with the
  gold, experience and honour or fame it brought, and *Statistics* shows win rates and totals.
* **Notifications.** Desktop alerts when you are logged out, when an activity gets paused, or when
  HP is low and there is no food left. Each one can be turned off.
* **One tab per server, with a watchdog.** Only one game tab runs the bot. If that tab hangs, it is
  reloaded.
* **Settings per server.** Each server you play on has its own settings and its own Start/Stop,
  so two accounts never overwrite each other's locations or budgets. A server GBot has not seen
  before starts with a copy of the settings you saved last, with the bot stopped.
* **Backup.** Copy the settings of another server, export them to a file, import them in another
  browser, or reset them.

## The interface

### Control bar (on every game page)

* **Start / Stop** turns the bot on and off.
* **Check now** re-checks the game immediately. **Minimise** folds the bar down to its title.
* **Status** shows what the bot is doing, what comes next and when, plus your HP, expedition and
  dungeon points, and gold. It is filled in as soon as the page loads.
* **Activity tiles** (Expedition, Dungeon, Arena, Circus, Heal, Work, Quests):
  * Click a tile to switch that activity on or off.
  * Each tile shows its live state: *ready*, a cooldown countdown, *no points*, *low HP*, *paused*,
    or *off*.
  * Hover a tile and click its small gear to open that activity's settings.
* **Last log line**, then a **footer** with statistics for the session and shortcuts to the stats
  and log.

The bar floats and can be dragged anywhere; its position is remembered. Under *Interface* you can
instead dock it along the top of the page, where it pushes the game (and Gameforge's own top strip)
down rather than covering it. In a narrow window its tiles wrap onto a second row:

![Docked bar](docs/docked-bar.png)

### Settings window

Open it with the gear in the bar, the *Settings* tile, or a tile's own gear. It has one tab per
feature. Activity tabs have an on/off switch in their title, and the green dots in the sidebar show
what is enabled. Changes save as you make them and take effect immediately.

| Tab | Options |
| --- | --- |
| General | Bot on/off, activity priority order, enemy nest search (quick / thorough / return to safety / leave it to me) |
| Expedition | Location (last visited, one from the game's list, or any id), enemy 1-4, learn the other enemies' bonuses before the boss, points to keep in reserve |
| Dungeon | Location, Normal/Advanced, points to keep in reserve, never fight the boss, start a new dungeon after lost fights |
| Underworld | Fighting on/off, minimum HP to fight, enter automatically (off, Normal, Middle, Hard) |
| Arena / Circus Turma | Lowest / highest / random opponent, level range around yours, never-attack list, how long to skip opponents who beat you |
| Health | Eat food on/off, eat below X% HP, stop fighting below Y% HP |
| Stable work | Job number, hours |
| Training | Gold to always keep, stats to train |
| Repair | Repair below X% conditioning, cutoff for the *Repair all* button, best material quality to use |
| Smelting | Smelting on/off, put the resources in the Horreum or in a package, smelt package items automatically by quality and kind |
| Packages | Tidying on/off, take gold out of gold packages, store resources in the Horreum, sell gear by quality and kind, what to do with packages about to expire |
| Auction house | Bidding on/off, minimum HP per gold, how late in the round to bid, gold per round, gold to keep, food limit |
| Quests | Quest types to accept (combat, arena, circus, expedition, dungeon, items, work), only quests for my location and dungeon, only quests for activities that are on |
| Schedule | Active hours, random breaks |
| Timing & safety | Click delay range, longest idle time, failed attempts before pausing, pause length |
| Notifications | Which desktop notifications to show |
| Interface | Show the bar, floating or docked |
| Statistics | Fights per activity with wins, losses and win rate; meals, nests, quests, work shifts, stats trained, items repaired, items smelted, items sold, auction bids; gold looted, experience, honour and fame; gold from sales and gold packages; gold change; per-hour rates; reset |
| Log | Recent activity, filter to warnings only, clear |
| Backup | Copy from another server, export to a file or the clipboard, import, reset to defaults |

### Toolbar popup and options page

The toolbar button opens a compact version of the same settings, with icon-only tabs, a Start/Stop
button and the server's status. The *open in tab* button, or the browser's extension options,
shows the full-size settings page. If you play on several servers, it also has a server selector:
the settings, Start/Stop, statistics and log shown are those of the selected server.

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

After changing or updating the files, reload the extension (the ↻ button on its card in
`chrome://extensions`) and refresh the game tab.

### Packaged zips

```sh
npm install
npm run build        # -> dist/gbot-chrome.zip and dist/gbot-firefox.zip
```

## Usage

1. Log in to your Gladiatus server as usual. The GBot bar appears on the game page.
2. Switch the activities you want on in the tiles. Fine-tune them in the settings window. Training
   and Repair are off until you switch them on in their tabs.
3. Press **Start**.

Keep the game tab open (it can be in the background). The bot never logs in for you: if the session
expires, log in again and it carries on. Settings saved by version 1.0 are migrated automatically.

## How it works

```
manifest.json                 MV3 manifest, valid for Chrome and Firefox
src/shared/settings.js        defaults, validation rules, migration, storage
src/content/selectors.js      ALL knowledge of the game's HTML (IDs, classes, URLs)
src/content/state.js          reads HP, points, cooldowns, locations, dialogs, combat reports
                              and expedition bonuses from the DOM
src/content/brain.js          pure decision engine: priority, schedule, retries, tile status,
                              quest choice, training, repair planning
src/content/actions.js        performs decisions: navigate, click, drag food, fill forms; dungeon
                              choices and the Underworld
src/content/workbench.js      gear repair through the game's own AJAX requests
src/content/smelter.js        smelting queue: packages → smelter → Horreum, the same way
src/content/packages.js       package rules: gold, resources, smelting, selling, expiring
src/content/main.js           runner: show the bar, then read state → decide → act, once per
                              page load; also the overview page's "Repair all" button
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

Anything that must survive a page load, such as attempt counters, work end time, a repair in
progress, stats and the log, is kept per server in extension storage, next to that server's
settings.

The bar is filled in from storage and the page as soon as the page is parsed. The first action
waits 0.8-2 seconds so the game's own scripts are ready, and every click waits the human-like
delay from *Timing & safety*.

The workbench repair does not click through pages: like the game's own workbench, packages and
inventory pages, it sends the game's AJAX requests (with its CSRF token), so the bot stays on the
current page while an item is repaired.

To add a setting, add a default in `settings.js`, optionally a validation rule, and a field in
`schema.js`. The settings window, popup and options page pick it up automatically.


## License

GPL-3.0, see [LICENSE](LICENSE).
