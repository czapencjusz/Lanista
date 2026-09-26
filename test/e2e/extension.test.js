// End-to-end test: loads the unpacked extension into Chromium and lets it play
// against the mock game server (test/e2e/mock-game.js).
//
// Requires a Chromium binary: set CHROMIUM_PATH, or have Playwright's browsers
// installed (PLAYWRIGHT_BROWSERS_PATH / ~/.cache/ms-playwright).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { MockGame, ORIGIN, GAME, SH } = require('./mock-game');
const { DEFAULT_SETTINGS, mergeSettings } = require('../../src/shared/settings.js');

const EXTENSION = path.resolve(__dirname, '../..');
const HOST = new URL(ORIGIN).host;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const bin of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const candidate = path.join(root, dir, bin);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const executablePath = findChromium();
const FAST = { timing: { minClickDelay: 0.05, maxClickDelay: 0.15, maxIdle: 30 } };

let context;
let worker;
let page;
const game = new MockGame();

async function waitUntil(fn, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}. Events: ${JSON.stringify(game.events())}`);
}

async function storageGet(key) {
  return worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
}

async function configure(overrides) {
  const settings = mergeSettings(DEFAULT_SETTINGS, {
    ...FAST,
    ...overrides,
    arena: { enabled: false, ...(overrides.arena || {}) },
    circus: { enabled: false, ...(overrides.circus || {}) },
  });
  await worker.evaluate(async (s) => chrome.storage.local.set({ settings: s }), settings);
  return settings;
}

// Stops the bot, resets the mock game and the bot's memory, then starts the
// bot with `settings` on the overview page.
async function scenario(gameState, settings) {
  await configure({ enabled: false });
  game.reset(gameState);
  await worker.evaluate(async (host) => chrome.storage.local.remove(`memory:${host}`), HOST);
  await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
  await page.waitForSelector('#gbot-overlay', { state: 'attached' });
  await configure({ ...settings, enabled: true });
}

test.describe('GBot extension against a mock Gladiatus server', { skip: !executablePath && 'no Chromium binary found' }, () => {
  test.before(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gbot-e2e-'));
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--no-sandbox'],
    });
    await context.route(`${ORIGIN}/**`, (route) => game.handle(route));
    worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    page = context.pages()[0] || (await context.newPage());
    page.on('console', (msg) => {
      if (process.env.E2E_DEBUG && msg.text().includes('[GBot]')) console.log('   page:', msg.text());
    });
  });

  test.after(async () => {
    if (context) await context.close();
  });

  test('attacks the chosen expedition enemy, then starts and fights a dungeon', { timeout: 90000 }, async () => {
    await scenario(
      { expPoints: 1, dunPoints: 1 },
      { expedition: { enabled: true, location: 'auto', enemy: 2 }, dungeon: { enabled: true, difficulty: 'advanced' } }
    );
    await waitUntil(() => game.events('dungeon').length, 60000, 'dungeon fight');

    const [expedition] = game.events('expedition');
    assert.equal(expedition.location, '3', 'uses the location from the cooldown bar');
    assert.equal(expedition.stage, '2', 'attacks enemy #2');
    assert.deepEqual(game.events('dungeonStart').map((e) => e.difficulty), ['advanced']);
    assert.equal(game.events('dungeon')[0].enemy, '11');

    const memory = await waitUntil(async () => {
      const m = await storageGet(`memory:${HOST}`);
      return m && m.stats.dungeon === 1 ? m : null;
    }, 15000, 'stats update');
    assert.equal(memory.stats.expedition, 1);
    await page.waitForFunction(() => {
      const root = document.querySelector('#gbot-overlay').shadowRoot;
      return /Waiting/.test(root.querySelector('.status').textContent);
    }, null, { timeout: 15000 });
  });

  test('eats food (searching other bags) by dragging it onto the avatar', { timeout: 60000 }, async () => {
    await scenario({ hp: 100, expPoints: 0, dunPoints: 0 }, { expedition: { enabled: true }, heal: { enabled: true, minHpPercent: 25 } });
    const [heal] = await waitUntil(() => game.events('heal').length && game.events('heal'), 45000, 'heal');
    assert.equal(heal.source, 'drag', 'healed through jQuery UI drag & drop, not the fallback request');
    assert.equal(heal.heal, 300);
    assert.equal(game.state.hp, 400);
  });

  test('attacks the lowest arena opponent and the highest circus opponent', { timeout: 90000 }, async () => {
    await scenario(
      { expPoints: 0, dunPoints: 0 },
      { expedition: { enabled: false }, dungeon: { enabled: false }, arena: { enabled: true, target: 'lowest' }, circus: { enabled: true, target: 'highest' } }
    );
    await waitUntil(() => game.events('arena').length && game.events('circus').length, 75000, 'arena and circus fights');
    assert.equal(game.events('arena')[0].level, 22);
    assert.equal(game.events('circus')[0].level, 45);
  });

  test('collects the daily login bonus', { timeout: 45000 }, async () => {
    await scenario({ loginBonus: true, expPoints: 0, dunPoints: 0 }, {});
    await waitUntil(() => game.events('loginBonus').length, 30000, 'login bonus');
  });

  test('goes to work when out of points', { timeout: 60000 }, async () => {
    await scenario({ expPoints: 0, dunPoints: 0 }, { work: { enabled: true, job: 1, hours: 3 } });
    const [work] = await waitUntil(() => game.events('work').length && game.events('work'), 45000, 'work');
    assert.equal(work.job, '1');
    assert.equal(work.hours, 2, 'picks the longest offered duration not above the setting');
    const memory = await waitUntil(async () => {
      const m = await storageGet(`memory:${HOST}`);
      return m && m.workUntil > Date.now() ? m : null;
    }, 20000, 'workUntil in memory');
    assert.ok(memory.workUntil - Date.now() > 1.9 * 3600 * 1000);
  });

  test('finishes quests and accepts only the enabled quest types', { timeout: 60000 }, async () => {
    const types = { combat: false, arena: false, circus: false, expedition: true, dungeon: false, items: false };
    await scenario({ questFinished: true, expPoints: 0, dunPoints: 0 }, { quests: { enabled: true, types } });
    await waitUntil(() => game.events('questAccept').length, 45000, 'quest accepted');
    assert.equal(game.events('questFinish').length, 1);
    assert.deepEqual(game.events('questAccept').map((e) => e.questType), ['expedition']);
  });

  test('pauses an activity that keeps failing instead of looping', { timeout: 90000 }, async () => {
    await scenario(
      { expeditionDisabled: true, expPoints: 5, dunPoints: 0 },
      { expedition: { enabled: true }, dungeon: { enabled: false }, safety: { maxAttempts: 1, backoffMinutes: 10 } }
    );
    const memory = await waitUntil(async () => {
      const m = await storageGet(`memory:${HOST}`);
      return m && m.blockedUntil && m.blockedUntil.expedition ? m : null;
    }, 75000, 'expedition to be paused');
    assert.ok(memory.blockedUntil.expedition > Date.now() + 9 * 60 * 1000);
    assert.equal(game.events('expedition').length, 0);
    assert.ok(memory.log.some((l) => /pausing it/.test(l.message)));
  });

  test('popup shows settings and toggles the bot', { timeout: 30000 }, async () => {
    await configure({ enabled: false });
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.waitForSelector('#toggle');
    assert.equal(await popup.textContent('#toggle'), 'Start');
    assert.equal(await popup.inputValue('[data-path="work.job"]'), '1', 'job index is shown 1-based');

    await popup.click('#toggle');
    await waitUntil(async () => (await storageGet('settings')).enabled === true, 5000, 'enabled');
    await popup.selectOption('[data-path="expedition.enemy"]', '3');
    await popup.fill('[data-path="dungeon.location"]', '7');
    await popup.press('[data-path="dungeon.location"]', 'Tab');
    await waitUntil(async () => {
      const s = await storageGet('settings');
      return s.expedition.enemy === 3 && s.dungeon.location === '7';
    }, 5000, 'settings saved');
    await popup.click('#toggle');
    await waitUntil(async () => (await storageGet('settings')).enabled === false, 5000, 'disabled');
    await popup.close();
  });
});
