// Re-renders the screenshots used by the README and the download page from
// the mock game server (test/e2e/mock-game.js) with the extension loaded:
//
//   control-bar       docs/control-bar.png       floating control bar, bot stopped
//   settings-window   docs/settings-window.png   settings window on the Repair tab
//   docked-bar        docs/docked-bar.png        control bar docked to the top of the page
//   popup             docs/popup.png             toolbar popup
//   statistics        site/img/statistics.png    Statistics tab, a week of example numbers
//
//   npm run screenshots                  all of them
//   npm run screenshots -- statistics    only the ones named
//
// Needs a Chromium binary: CHROMIUM_PATH, or Playwright's browsers.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { MockGame, ORIGIN, GAME, SH } = require(join(root, 'test', 'e2e', 'mock-game.js'));
const { sanitizeSettings } = require(join(root, 'src', 'shared', 'settings.js'));
require(join(root, 'src', 'content', 'util.js'));
const brain = require(join(root, 'src', 'content', 'brain.js'));

const HOST = new URL(ORIGIN).host;
const SHOTS = ['control-bar', 'settings-window', 'docked-bar', 'popup', 'statistics'];
const asked = process.argv.slice(2);
const unknown = asked.filter((name) => !SHOTS.includes(name));
if (unknown.length) {
  console.error(`Unknown screenshot: ${unknown.join(', ')}. Choose from: ${SHOTS.join(', ')}`);
  process.exit(1);
}
const wanted = (name) => !asked.length || asked.includes(name);

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache/ms-playwright')].filter(Boolean);
  for (const dir of roots.filter(existsSync)) {
    for (const sub of readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const bin of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        if (existsSync(join(dir, sub, bin))) return join(dir, sub, bin);
      }
    }
  }
  throw new Error('No Chromium found: set CHROMIUM_PATH');
}

// The bot is stopped in every picture; these activities show as switched on.
const SHOWN = sanitizeSettings({
  enabled: false,
  expedition: { enabled: true },
  dungeon: { enabled: true },
  arena: { enabled: true },
  circus: { enabled: false },
  quests: { enabled: true },
  training: { enabled: true },
  repair: { enabled: true },
  smelting: { enabled: true },
});

// Adds the numbers of `from` into `into`, nested objects too.
function addInto(into, from) {
  for (const [key, value] of Object.entries(from)) {
    if (typeof value === 'number') into[key] = (into[key] || 0) + value;
    else if (value && typeof value === 'object') addInto((into[key] = into[key] || {}), value);
  }
  return into;
}

// One day of play on one server; `f` scales it a little from day to day.
function exampleDay(f) {
  const n = (v) => Math.round(v * f);
  const fights = { expedition: n(24), dungeon: n(14), arena: n(18), circus: n(16) };
  const lost = { expedition: 1, dungeon: n(2), arena: n(4), circus: n(5) };
  const results = {};
  for (const [type, count] of Object.entries(fights)) results[type] = { won: count - lost[type], lost: lost[type] };
  return {
    ...fights,
    heal: n(4),
    quests: n(9),
    training: n(2),
    repairs: n(1),
    smelted: n(5),
    sold: n(6),
    results,
    loot: { gold: n(132400), xp: n(610), honour: n(1450), fame: n(1180) },
    soldGold: n(21800),
    goldCollected: n(9600),
    goldSpent: n(88300),
  };
}

// Fights per place since the statistics were reset.
function exampleAreas(days) {
  const sum = (type) => days.reduce((total, d) => total + d[type], 0);
  const won = (type) => days.reduce((total, d) => total + d.results[type].won, 0);
  const place = (fights, wins, goldEach, xpEach, renownEach) => ({
    fights,
    won: wins,
    gold: fights * goldEach,
    xp: fights * xpEach,
    honour: renownEach[0] * fights,
    fame: renownEach[1] * fights,
  });
  const exp = sum('expedition');
  const deathHill = Math.round(exp * 0.7);
  return {
    'expedition:2': place(deathHill, Math.round(won('expedition') * 0.7), 2140, 9, [24, 0]),
    'expedition:1': place(exp - deathHill, won('expedition') - Math.round(won('expedition') * 0.7), 1680, 7, [19, 0]),
    'dungeon:2': place(sum('dungeon'), won('dungeon'), 3920, 16, [0, 61]),
    'arena:provinciarum': place(sum('arena'), won('arena'), 1310, 4, [52, 0]),
    'circus:provinciarum': place(sum('circus'), won('circus'), 1150, 4, [0, 38]),
  };
}

// A week of play on one server, for the Statistics tab: six finished days
// and today so far.
function exampleMemory() {
  const now = Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const days = [0.95, 1.08, 0.9, 1.12, 1.0, 1.05].map((f, i) => ({ day: dayKey(midnight - (6 - i) * 86400000 + 12 * 3600000), ...exampleDay(f) }));
  const today = exampleDay(0.55);
  const before = days.reduce((total, d) => addInto(total, { ...d, day: undefined }), {});

  const m = brain.createMemory(midnight - 6 * 86400000 + 9 * 3600000);
  addInto(m.stats, before);
  addInto(m.stats, today);
  m.stats.areas = exampleAreas([...days, today]);
  m.stats.goldStart = 1204500;
  m.stats.goldNow = 1873300;
  m.areaNames = {
    'expedition:2': 'Death Hill',
    'expedition:1': 'Cursed Village',
    'dungeon:2': 'Dungeon: Death Hill',
    'arena:provinciarum': 'Arena Provinciarum',
    'circus:provinciarum': 'Circus Provinciarum',
  };
  m.today = { day: dayKey(now), base: before };
  m.history = days.reverse();
  m.gameInfo.updatedAt = now;
  return m;
}

const game = new MockGame();
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lanista-shots-')), {
  executablePath: findChromium(),
  headless: true,
  viewport: { width: 1280, height: 760 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-sandbox'],
});
const written = [];
try {
  await context.route(`${ORIGIN}/**`, (route) => game.handle(route));
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const store = (key, value) => worker.evaluate(async ([k, v]) => chrome.storage.local.set({ [k]: v }), [key, value]);
  const extensionId = new URL(worker.url()).host;
  await store(`settings:${HOST}`, SHOWN);

  if (wanted('control-bar') || wanted('settings-window') || wanted('docked-bar')) {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
    const bar = page.locator('#lanista-root .gb-panel');
    await bar.waitFor();
    await page.waitForTimeout(2500); // first paint and first (idle) check
    if (wanted('control-bar')) {
      await bar.screenshot({ path: join(root, 'docs', 'control-bar.png') });
      written.push('docs/control-bar.png');
    }

    if (wanted('settings-window')) {
      await page.locator('#lanista-root [data-action="settings"]').click();
      await page.locator('#lanista-root .gb-modal [data-tab="repair"]').click();
      await page.waitForTimeout(300);
      await page.locator('#lanista-root .gb-modal').screenshot({ path: join(root, 'docs', 'settings-window.png') });
      written.push('docs/settings-window.png');
      await page.keyboard.press('Escape');
    }

    if (wanted('docked-bar')) {
      await store(`settings:${HOST}`, sanitizeSettings({ ...SHOWN, ui: { panel: true, layout: 'bar' } }));
      await page.waitForFunction(() => document.querySelector('#lanista-root').shadowRoot.querySelector('.gb-panel').classList.contains('bar'));
      await page.waitForTimeout(500);
      await bar.screenshot({ path: join(root, 'docs', 'docked-bar.png') });
      written.push('docs/docked-bar.png');
      await store(`settings:${HOST}`, SHOWN);
    }
    await page.close();
  }

  if (wanted('popup')) {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 440, height: 580 });
    await popup.goto(`chrome-extension://${extensionId}/src/pages/popup.html`);
    await popup.waitForSelector('.gb-settings');
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: join(root, 'docs', 'popup.png') });
    written.push('docs/popup.png');
    await popup.close();
  }

  if (wanted('statistics')) {
    await store(`memory:${HOST}`, exampleMemory());
    const options = await context.newPage();
    await options.setViewportSize({ width: 1000, height: 700 });
    await options.goto(`chrome-extension://${extensionId}/src/pages/options.html`);
    await options.waitForSelector('.gb-settings');
    await options.click('[data-tab="stats"]');
    await options.waitForSelector('.gb-days');
    // The tables per day and per place: scroll the pane down to them, and
    // the tab list to the Statistics tab.
    await options.evaluate(() => {
      const pane = document.querySelector('.gb-pane');
      const perDay = [...pane.querySelectorAll('h3')].find((h) => h.textContent === 'Per day');
      pane.scrollTop += perDay.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
      document.querySelector('.gb-tab.active').scrollIntoView({ block: 'center' });
    });
    await options.waitForTimeout(300);
    await options.locator('.gb-page-main').screenshot({ path: join(root, 'site', 'img', 'statistics.png') });
    written.push('site/img/statistics.png');
  }

  console.log(`Written: ${written.join(', ')}`);
} finally {
  await context.close();
}
