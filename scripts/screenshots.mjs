// Re-renders the screenshots used by the README and the download page from
// the mock game server (test/e2e/mock-game.js) with the extension loaded:
//
//   docs/control-bar.png       floating control bar, bot stopped
//   docs/settings-window.png   settings window on the Repair tab
//   docs/docked-bar.png        control bar docked to the top of the page
//   docs/popup.png             toolbar popup, General tab
//   site/img/statistics.png    Statistics tab with example numbers
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
const tier = require(join(root, 'src', 'shared', 'tier.js'));
require(join(root, 'src', 'content', 'util.js'));
const brain = require(join(root, 'src', 'content', 'brain.js'));

const HOST = new URL(ORIGIN).host;

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

// About a day of play on one server, for the Statistics tab.
function exampleMemory() {
  const now = Date.now();
  const m = brain.createMemory(now - 20 * 3600 * 1000);
  Object.assign(m.stats, {
    expedition: 96, dungeon: 58, arena: 71, circus: 70, heal: 14, nest: 22, training: 9, repairs: 6,
    smelted: 18, sold: 24, auctionBids: 5, quests: 31, work: 0,
    soldGold: 186400, goldCollected: 42700, goldStart: 1204500, goldNow: 1873300,
    results: { expedition: { won: 94, lost: 2 }, dungeon: { won: 55, lost: 3 }, arena: { won: 60, lost: 11 }, circus: { won: 52, lost: 18 } },
    loot: { gold: 912350, xp: 4210, honour: 3905, fame: 2760 },
  });
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
try {
  await context.route(`${ORIGIN}/**`, (route) => game.handle(route));
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const store = (key, value) => worker.evaluate(async ([k, v]) => chrome.storage.local.set({ [k]: v }), [key, value]);
  const extensionId = new URL(worker.url()).host;
  await store(`settings:${HOST}`, SHOWN);
  // Free tier, 45 minutes into today's bot time.
  await store(tier.USAGE_KEY, { day: tier.dayOf(Date.now()), ms: 45 * 60000 });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
  const bar = page.locator('#gbot-root .gb-panel');
  await bar.waitFor();
  await page.waitForTimeout(2500); // first paint and first (idle) check
  await bar.screenshot({ path: join(root, 'docs', 'control-bar.png') });

  await page.locator('#gbot-root [data-action="settings"]').click();
  await page.locator('#gbot-root .gb-modal [data-tab="repair"]').click();
  await page.waitForTimeout(300);
  await page.locator('#gbot-root .gb-modal').screenshot({ path: join(root, 'docs', 'settings-window.png') });
  await page.keyboard.press('Escape');

  await store(`settings:${HOST}`, sanitizeSettings({ ...SHOWN, ui: { panel: true, layout: 'bar' } }));
  await page.waitForFunction(() => document.querySelector('#gbot-root').shadowRoot.querySelector('.gb-panel').classList.contains('bar'));
  await page.waitForTimeout(500);
  await bar.screenshot({ path: join(root, 'docs', 'docked-bar.png') });
  await store(`settings:${HOST}`, SHOWN);
  await page.close();

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 440, height: 580 });
  await popup.goto(`chrome-extension://${extensionId}/src/pages/popup.html`);
  await popup.waitForSelector('.gb-settings');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: join(root, 'docs', 'popup.png') });
  await popup.close();

  await store(`memory:${HOST}`, exampleMemory());
  const options = await context.newPage();
  await options.setViewportSize({ width: 1000, height: 700 });
  await options.goto(`chrome-extension://${extensionId}/src/pages/options.html`);
  await options.waitForSelector('.gb-settings');
  await options.click('[data-tab="stats"]');
  await options.waitForTimeout(300);
  await options.locator('.gb-page-main').screenshot({ path: join(root, 'site', 'img', 'statistics.png') });

  console.log('Screenshots written to docs/ and site/img/.');
} finally {
  await context.close();
}
