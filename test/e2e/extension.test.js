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
const { sanitizeSettings } = require('../../src/shared/settings.js');

const EXTENSION = path.resolve(__dirname, '../..');
const HOST = new URL(ORIGIN).host;
// The mock server's own settings.
const SETTINGS = `settings:${HOST}`;

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
const pageErrors = [];

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
  const settings = sanitizeSettings({
    ...FAST,
    ...overrides,
    arena: { enabled: false, ...(overrides.arena || {}) },
    circus: { enabled: false, ...(overrides.circus || {}) },
  });
  await worker.evaluate(async ([key, s]) => chrome.storage.local.set({ [key]: s }), [SETTINGS, settings]);
  return settings;
}

// Stops the bot, resets the mock game and the bot's memory, then starts the
// bot with `settings` on the overview page.
async function scenario(gameState, settings) {
  await configure({ enabled: false });
  game.reset(gameState);
  await worker.evaluate(async (host) => chrome.storage.local.remove(`memory:${host}`), HOST);
  await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
  await page.waitForSelector('#lanista-root', { state: 'attached' });
  await configure({ ...settings, enabled: true });
}

test.describe('Lanista against a mock Gladiatus server', { skip: !executablePath && 'no Chromium binary found' }, () => {
  test.before(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lanista-e2e-'));
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
    page.on('pageerror', (e) => pageErrors.push(e.message));
  });

  test.after(async () => {
    if (context) await context.close();
  });

  test.afterEach(() => {
    assert.deepEqual(pageErrors.splice(0), [], 'no uncaught errors on game pages');
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
      const root = document.querySelector('#lanista-root').shadowRoot;
      return /Waiting/.test(root.querySelector('.gb-status').textContent);
    }, null, { timeout: 15000 });
  });

  test('skip boss: fights the others, then cancels the dungeon and starts a new one', { timeout: 90000 }, async () => {
    const cooldownMs = { expedition: 60000, dungeon: 2000, arena: 60000, circus: 60000 };
    await scenario(
      { expPoints: 0, dunPoints: 5, cooldownMs, dungeonEnemies: ['13', '11'], dungeonBoss: '13' },
      { expedition: { enabled: false }, dungeon: { enabled: true, skipBoss: true } }
    );
    await waitUntil(() => game.events('dungeonStart').length && game.events('dungeon').length >= 2, 75000, 'a new dungeon after the cancel');
    const order = game.events().filter((e) => /^dungeon/.test(e.type)).map((e) => (e.type === 'dungeon' ? `fight ${e.enemy}` : e.type));
    assert.deepEqual(order.slice(0, 4), ['fight 11', 'dungeonCancel', 'dungeonStart', 'fight 11'], 'the boss (13) is never fought');
    const memory = await storageGet(`memory:${HOST}`);
    assert.ok(memory.log.some((l) => /only the boss is left, cancelling it/.test(l.message)));
  });

  test('eats food (searching other bags) by dragging it onto the avatar', { timeout: 60000 }, async () => {
    await scenario({ hp: 100, expPoints: 0, dunPoints: 0 }, { expedition: { enabled: true }, heal: { enabled: true, minHpPercent: 25 } });
    const [heal] = await waitUntil(() => game.events('heal').length && game.events('heal'), 45000, 'heal');
    assert.equal(heal.source, 'drag', 'healed through jQuery UI drag & drop, not the fallback request');
    assert.equal(heal.heal, 300);
    assert.equal(game.state.hp, 400);
  });

  test('out of food: food put in a bag later ends the 30-minute wait', { timeout: 90000 }, async () => {
    await scenario(
      { hp: 100, expPoints: 5, dunPoints: 0, bags: { 512: [], 513: [] } },
      { expedition: { enabled: true }, heal: { enabled: true, eatBelowPercent: 50, minHpPercent: 25 } }
    );
    await waitUntil(async () => {
      const m = await storageGet(`memory:${HOST}`);
      return m && m.noFoodUntil > Date.now();
    }, 45000, 'the no-food wait');
    assert.equal(game.events('heal').length, 0);

    // The player drops some food into bag II; the next page shows it.
    game.state.bags[513] = [{ x: 1, y: 1, heal: 300 }];
    await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
    await waitUntil(() => game.events('heal').length, 30000, 'eating the new food');
    const memory = await storageGet(`memory:${HOST}`);
    assert.ok(memory.log.some((l) => /Found food in the food bags again/.test(l.message)));
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

  test('control bar: start/stop button and activity tiles', { timeout: 30000 }, async () => {
    await configure({ enabled: false });
    game.reset({ expPoints: 0, dunPoints: 0 });
    await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
    const bar = page.locator('#lanista-root .gb-panel');
    await bar.waitFor();

    await bar.locator('[data-activity="arena"]').click();
    await waitUntil(async () => (await storageGet(SETTINGS)).arena.enabled === true, 5000, 'arena on');
    await page.waitForFunction(() => document.querySelector('#lanista-root').shadowRoot.querySelector('[data-activity="arena"]').classList.contains('on'));
    await bar.locator('[data-activity="arena"]').click();
    await waitUntil(async () => (await storageGet(SETTINGS)).arena.enabled === false, 5000, 'arena off');

    await bar.locator('.gb-play').click();
    await waitUntil(async () => (await storageGet(SETTINGS)).enabled === true, 5000, 'bot started');
    assert.match(await bar.locator('.gb-play').textContent(), /Stop/);
    await bar.locator('.gb-play').click();
    await waitUntil(async () => (await storageGet(SETTINGS)).enabled === false, 5000, 'bot stopped');

    // Docked layout pushes the page down instead of covering it.
    await configure({ enabled: false, ui: { panel: true, layout: 'bar' } });
    await page.waitForFunction(() => document.querySelector('#lanista-root').shadowRoot.querySelector('.gb-panel').classList.contains('bar'));
    assert.ok(parseInt(await page.evaluate(() => document.documentElement.style.paddingTop), 10) > 20);
    await configure({ enabled: false, ui: { panel: false } });
    await page.waitForFunction(() => document.querySelector('#lanista-root').shadowRoot.querySelector('.gb-panel').style.display === 'none');
    assert.equal(await page.evaluate(() => document.documentElement.style.paddingTop), '');
  });

  test('in-game settings window: arena filters are saved and respected', { timeout: 90000 }, async () => {
    await configure({ enabled: false, expedition: { enabled: false }, dungeon: { enabled: false } });
    game.reset({ expPoints: 0, dunPoints: 0 });
    await worker.evaluate(async (host) => chrome.storage.local.remove(`memory:${host}`), HOST);
    await page.goto(`${GAME}index.php?mod=overview&sh=${SH}`);
    const root = page.locator('#lanista-root');
    await root.locator('[data-settings="arena"]').click({ force: true });
    const dialog = root.locator('.gb-modal');
    await dialog.waitFor();
    assert.equal(await dialog.locator('.gb-pane h2').textContent(), 'Arena');

    await dialog.locator('[data-path="arena.enabled"]').check();
    await dialog.locator('[data-path="arena.ignorePlayers"]').fill('Player1');
    await dialog.locator('[data-path="arena.ignorePlayers"]').press('Tab');
    await dialog.locator('[data-path="arena.limitLevels"]').check();
    await dialog.locator('[data-path="arena.maxAbove"]').fill('5');
    await dialog.locator('[data-path="arena.maxAbove"]').press('Tab');
    const saved = await waitUntil(async () => {
      const s = await storageGet(SETTINGS);
      return s.arena.enabled && s.arena.limitLevels && s.arena.ignorePlayers === 'Player1' && s.arena.maxAbove === 5 ? s : null;
    }, 5000, 'arena settings saved');
    assert.equal(saved.arena.maxBelow, 20);
    assert.equal(await dialog.locator('.gb-saved').textContent(), 'Saved');

    // Location dropdown lists the locations read from the game menu.
    await dialog.locator('[data-tab="expedition"]').click();
    // (The list fills in live once the bot has read the game menu.)
    const location = dialog.locator('[data-path="expedition.location"] option');
    await waitUntil(async () => (await location.count()) === 5, 10000, 'location list');
    assert.deepEqual(await location.allTextContents(), ['Last visited (auto)', 'Grimwood (#1)', 'Pirate Harbour (#2)', 'Misty Mountains (#3)', 'Other location id…']);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await root.locator('.gb-play').click();
    // Levels 40, 22, 31, 35, 28 at player level 25: Player1 (22) is ignored and
    // everything above 30 is filtered out, which leaves level 28.
    await waitUntil(() => game.events('arena').length, 60000, 'arena fight');
    assert.equal(game.events('arena')[0].level, 28);
  });

  test('popup: compact settings, start/stop and editing', { timeout: 30000 }, async () => {
    await configure({ enabled: false });
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/pages/popup.html`);
    await popup.waitForSelector('#toggle');
    assert.match(await popup.textContent('#toggle'), /Start/);

    await popup.click('#toggle');
    await waitUntil(async () => (await storageGet(SETTINGS)).enabled === true, 5000, 'enabled');

    await popup.click('[data-tab="work"]');
    assert.equal(await popup.inputValue('[data-path="work.job"]'), '1', 'job index is shown 1-based');
    await popup.click('[data-tab="expedition"]');
    await popup.selectOption('[data-path="expedition.enemy"]', '3');
    await popup.click('[data-tab="dungeon"]');
    await popup.selectOption('[data-path="dungeon.location"]', 'custom');
    await popup.fill('[data-path="dungeon.location#custom"]', '7');
    await popup.press('[data-path="dungeon.location#custom"]', 'Tab');
    await waitUntil(async () => {
      const s = await storageGet(SETTINGS);
      return s.expedition.enemy === 3 && s.dungeon.location === '7';
    }, 5000, 'settings saved');

    // Priority: move Arena to the top.
    await popup.click('[data-tab="general"]');
    for (let i = 0; i < 3; i++) await popup.click('[data-item="arena"] button[title="Move Arena up"]');
    await waitUntil(async () => (await storageGet(SETTINGS)).general.order[0] === 'arena', 5000, 'arena first');

    await popup.click('#toggle');
    await waitUntil(async () => (await storageGet(SETTINGS)).enabled === false, 5000, 'disabled');
    await popup.close();
  });

  test('options page: statistics, log, import and reset', { timeout: 30000 }, async () => {
    await configure({ enabled: false });
    const extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/pages/options.html`);
    await options.waitForSelector('.gb-settings');
    const keys = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
    assert.match(await options.textContent('#status-host'), /Server 1 \(EN\)/, `stored keys: ${keys}`);

    await options.click('[data-tab="stats"]');
    const cards = await options.locator('.gb-card-label').allTextContents();
    assert.ok(cards.includes('Arena fights'));
    await options.click('[data-tab="log"]');
    assert.ok((await options.locator('.gb-log-line').count()) > 0, 'log entries from earlier scenarios');

    await options.click('[data-tab="profile"]');
    const exported = JSON.stringify({ enabled: true, expedition: { enemy: 4, keepPoints: 6 }, heal: { eatBelowPercent: 55 } });
    await options.fill('.gb-pane textarea', exported);
    await options.click('text=Import pasted settings');
    const imported = await waitUntil(async () => {
      const s = await storageGet(SETTINGS);
      return s.expedition.enemy === 4 ? s : null;
    }, 5000, 'import');
    assert.equal(imported.expedition.keepPoints, 6);
    assert.equal(imported.heal.eatBelowPercent, 55);
    assert.equal(imported.enabled, false, 'importing never starts the bot');

    await options.fill('.gb-pane textarea', '{not json');
    await options.click('text=Import pasted settings');
    assert.match(await options.textContent('.gb-import-status'), /not valid JSON/);

    const reset = options.locator('text=Reset all settings');
    await reset.click();
    await options.click('text=Click again to confirm');
    await waitUntil(async () => (await storageGet(SETTINGS)).expedition.enemy === 1, 5000, 'reset');
    await options.close();
  });

  test('settings are kept per server and can be copied from another one', { timeout: 30000 }, async () => {
    const OTHER = 's99-de.gladiatus.gameforge.com';
    await configure({ enabled: false, expedition: { enemy: 1 } });
    await worker.evaluate(async (key) => chrome.storage.local.set({ [key]: { enabled: true, expedition: { enemy: 3 }, heal: { eatBelowPercent: 40 } } }), `settings:${OTHER}`);
    const extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/pages/options.html`);
    await options.waitForSelector('.gb-settings');
    assert.match(await options.textContent('#status-host'), /Server 1 \(EN\)/);

    await options.click('[data-tab="profile"]');
    const from = options.locator('select[aria-label="Server to copy from"]');
    await from.waitFor();
    assert.deepEqual(await from.locator('option').allTextContents(), ['Server 99 (DE)']);
    const copy = options.getByRole('button', { name: 'Copy settings' });
    await copy.click();
    await options.getByRole('button', { name: 'Click again to confirm' }).click();
    const copied = await waitUntil(async () => {
      const s = await storageGet(SETTINGS);
      return s.expedition.enemy === 3 ? s : null;
    }, 5000, 'settings copied');
    assert.equal(copied.heal.eatBelowPercent, 40);
    assert.equal(copied.enabled, false, 'copying never starts the bot');
    assert.equal((await storageGet(`settings:${OTHER}`)).enabled, true, 'the other server is left alone');

    // The server list switches the settings shown, start/stop included.
    await options.selectOption('.gb-server', OTHER);
    await options.waitForFunction(() => /Server 99 \(DE\)/.test(document.querySelector('#status-host').textContent));
    assert.match(await options.textContent('#toggle'), /Stop/);
    await options.click('#toggle');
    await waitUntil(async () => (await storageGet(`settings:${OTHER}`)).enabled === false, 5000, 'other server stopped');
    assert.equal((await storageGet(SETTINGS)).enabled, false);
    await options.close();
    await worker.evaluate(async (key) => chrome.storage.local.remove(key), `settings:${OTHER}`);
  });
});
