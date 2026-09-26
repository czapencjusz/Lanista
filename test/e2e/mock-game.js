// A tiny in-memory imitation of a Gladiatus server, served through
// Playwright request interception. It renders pages with the same structure
// as the real game (see test/fixtures/game-html.js) and implements just enough
// game logic (cooldowns, points, HP, dungeon, arena, food, work) to check that
// the extension drives the game correctly.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const html = require('../fixtures/game-html');

const ORIGIN = 'https://s1-en.gladiatus.gameforge.com';
const GAME = `${ORIGIN}/game/`;
const SH = 'abc123';

const JQUERY = fs.readFileSync(require.resolve('jquery/dist/jquery.min.js'), 'utf8');
const JQUERY_UI = fs.readFileSync(path.join(path.dirname(require.resolve('jquery-ui/package.json')), 'dist/jquery-ui.min.js'), 'utf8');

function defaultState() {
  return {
    hp: 900,
    hpMax: 1000,
    expPoints: 5,
    dunPoints: 5,
    cooldownUntil: { expedition: 0, dungeon: 0, arena: 0, circus: 0 },
    cooldownMs: { expedition: 60000, dungeon: 60000, arena: 60000, circus: 60000 },
    dungeonEnemies: null, // null = no dungeon running
    arenaLevels: [40, 22, 31, 35, 28],
    circusLevels: [19, 27, 45, 33, 30],
    // bag number -> [{ x, y, heal }]
    bags: { 512: [], 513: [{ x: 2, y: 1, heal: 300 }] },
    loginBonus: false,
    workUntil: 0,
    questFinished: false,
    expeditionDisabled: false,
    acceptedQuests: [],
    events: [],
  };
}

class MockGame {
  constructor() {
    this.state = defaultState();
  }

  reset(overrides = {}) {
    this.state = { ...defaultState(), ...overrides };
  }

  record(type, detail = {}) {
    this.state.events.push({ type, ...detail, at: Date.now() });
  }

  events(type) {
    return this.state.events.filter((e) => !type || e.type === type);
  }

  secondsLeft(kind) {
    return Math.max(0, Math.ceil((this.state.cooldownUntil[kind] - Date.now()) / 1000));
  }

  headerOpts() {
    const s = this.state;
    return {
      sh: SH,
      hp: s.hp,
      hpMax: s.hpMax,
      expPoints: s.expPoints,
      dunPoints: s.dunPoints,
      cooldowns: {
        expedition: this.secondsLeft('expedition'),
        dungeon: this.secondsLeft('dungeon'),
        arena: this.secondsLeft('arena'),
        circus: this.secondsLeft('circus'),
      },
    };
  }

  render(bodyId, content, extraScript = '') {
    const extra = [
      this.state.loginBonus
        ? `<div id="blackoutDialogLoginBonus"><div id="header_LoginBonus">Daily bonus</div>
             <input type="button" value="Collect" onclick="location.href='index.php?mod=overview&submod=fetchLoginBonus&sh=${SH}'"></div>`
        : '',
      `<script src="js/jquery.js"></script><script src="js/jquery-ui.js"></script>`,
      `<script>var secureHash = '${SH}';${extraScript}</script>`,
    ].join('');
    return html.page({ bodyId, content, headerOpts: this.headerOpts(), extra });
  }

  // Spend a fight: checks cooldown/points and starts the cooldown.
  fight(kind, detail) {
    const s = this.state;
    if (this.secondsLeft(kind) > 0) return { error: 'cooldown' };
    if (kind === 'expedition' || kind === 'dungeon') {
      const key = kind === 'expedition' ? 'expPoints' : 'dunPoints';
      if (s[key] <= 0) return { error: 'no points' };
      s[key] -= 1;
    }
    s.cooldownUntil[kind] = Date.now() + s.cooldownMs[kind];
    if (kind !== 'circus') s.hp = Math.max(1, s.hp - 50);
    this.record(kind, detail);
    return { redirect: `index.php?mod=reports&submod=showCombatReport&t=0&reportId=1&sh=${SH}` };
  }

  // ------------------------------------------------------------------ pages

  overviewPage() {
    const bag = 512;
    return this.render(
      'overviewPage',
      `<div id="char" style="display:flex;gap:20px">
         <div id="avatar" style="width:168px;height:194px;background:#bbb"></div>
         <div>
           <div id="inventory_nav">
             <a class="awesome-tabs current" data-bag-number="512">I</a>
             <a class="awesome-tabs" data-bag-number="513">II</a>
           </div>
           <div id="inv" style="position:relative;width:256px;height:160px;background:#eee">${this.bagItems(bag)}</div>
         </div>
       </div>`,
      `
      var currentBag = ${bag};
      function initItems() {
        $('#inv [data-content-type]').draggable({ revert: 'invalid', zIndex: 1000 });
      }
      $(function () {
        initItems();
        $('#avatar').droppable({
          drop: function (e, ui) {
            var el = ui.draggable[0];
            $.post('ajax.php?mod=inventory&submod=move&from=' + currentBag + '&fromX=' + el.dataset.positionX +
                   '&fromY=' + el.dataset.positionY + '&to=8&toX=1&toY=1&amount=1&source=drag',
                   { a: Date.now(), sh: secureHash }, function (r) {
              var bar = document.getElementById('header_values_hp_bar');
              bar.setAttribute('data-value', r.header.health.value);
              $(el).remove();
            }, 'json');
          }
        });
        $('#inventory_nav .awesome-tabs').on('click', function () {
          var tab = this;
          var inv = document.getElementById('inv');
          inv.classList.add('unavailable');
          $.get('ajax.php?mod=inventory&submod=loadBag&bag=' + tab.dataset.bagNumber + '&sh=' + secureHash, function (markup) {
            inv.innerHTML = markup;
            currentBag = Number(tab.dataset.bagNumber);
            $('#inventory_nav .awesome-tabs').removeClass('current');
            tab.classList.add('current');
            inv.classList.remove('unavailable');
            initItems();
          });
        });
      });`
    );
  }

  bagItems(bag) {
    return (this.state.bags[bag] || [])
      .map((f) => {
        const tooltip = JSON.stringify([[['Bread', 'white'], [`Using: Heals ${f.heal} of life`, 'white'], ['+5 Constitution', 'lime']]]);
        return `<div data-content-type="64" data-basis="7-1" data-position-x="${f.x}" data-position-y="${f.y}"
                  data-tooltip='${tooltip}' style="position:absolute;left:${(f.x - 1) * 32}px;top:${(f.y - 1) * 32}px;width:32px;height:32px;background:#8b5a2b"></div>`;
      })
      .join('');
  }

  locationPage(loc) {
    return this.render(
      'locationPage',
      html.expeditionContent(!!this.state.expeditionDisabled),
      `function attack(a, location, stage) {
         $.get('ajax.php?mod=location&submod=attack&location=' + location + '&stage=' + stage + '&sh=' + secureHash, function (r) {
           if (r.redirect) window.location.href = r.redirect;
         }, 'json');
       }`
    );
  }

  dungeonPage() {
    const content = this.state.dungeonEnemies ? html.dungeonMapContent(this.state.dungeonEnemies) : html.dungeonStartContent(SH);
    return this.render(
      'dungeonPage',
      content,
      `function startFight(id) {
         $.get('ajax.php?mod=dungeon&submod=attack&enemy=' + id + '&sh=' + secureHash, function (r) {
           if (r.redirect) window.location.href = r.redirect;
         }, 'json');
       }`
    );
  }

  arenaPage(aType) {
    const type = aType === '3' ? 'circus' : 'arena';
    const levels = type === 'arena' ? this.state.arenaLevels : this.state.circusLevels;
    return this.render(
      'arenaPage',
      html.arenaContent(type, levels),
      `function startProvinciarumFight(el, aType, server, id) {
         $.get('ajax.php?mod=arena&submod=confirmDoCombat&aType=' + aType + '&opponentId=' + id + '&sh=' + secureHash, function (r) {
           if (r.redirect) window.location.href = r.redirect;
           else { $('#errorText').text(r.error); $('#errorRow').show(); }
         }, 'json');
       }`
    );
  }

  workPage() {
    if (this.state.workUntil > Date.now()) {
      const left = this.state.workUntil - Date.now();
      return this.render('workPage', `<p>You are working.</p><span id="ticker1" data-ticker-time-left="${left}">1:00:00</span>`);
    }
    return this.render(
      'workPage',
      `<form method="post" action="index.php?mod=work&submod=start&sh=${SH}">
         <table>
           <tr id="job_row_0" onclick="document.getElementById('jobType').value = 0"><td>Stable boy</td></tr>
           <tr id="job_row_1" onclick="document.getElementById('jobType').value = 1"><td>Farmer</td></tr>
         </table>
         <input type="hidden" id="jobType" name="jobType" value="0">
         <select id="workTime" name="timeToWork">
           <option value="1">1 hour</option><option value="2">2 hours</option><option value="4">4 hours</option><option value="8">8 hours</option>
         </select>
         <input type="submit" id="doWork" class="awesome-button" value="Go!">
       </form>`
    );
  }

  questsPage() {
    const finished = this.state.questFinished
      ? `<div class="contentboard_slot contentboard_slot_active"><a class="quest_slot_button_finish" href="index.php?mod=quests&submod=finishQuest&sh=${SH}">Finish</a></div>`
      : '';
    const offers = { expedition: '4e41ab43222200aa024ee177efef8f', items: '5a358e0a030d8551a5a65d284c8730' };
    const open = Object.entries(offers)
      .filter(([type]) => !this.state.acceptedQuests.includes(type))
      .map(
        ([type, icon]) => `<div class="contentboard_slot contentboard_slot_inactive">
          <div class="quest_slot_icon" style="background-image:url('img/ui/quest/icon_${icon}.jpg')"></div>
          <a class="quest_slot_button_accept" href="index.php?mod=quests&submod=startQuest&type=${type}&sh=${SH}">Accept</a>
        </div>`
      )
      .join('');
    return this.render('questsPage', finished + open);
  }

  // ---------------------------------------------------------------- routing

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const q = Object.fromEntries(url.searchParams);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const page = (body) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    const s = this.state;

    if (url.pathname === '/game/js/jquery.js') return route.fulfill({ contentType: 'text/javascript', body: JQUERY });
    if (url.pathname === '/game/js/jquery-ui.js') return route.fulfill({ contentType: 'text/javascript', body: JQUERY_UI });
    if (!url.pathname.startsWith('/game/')) return route.fulfill({ status: 404, body: '' });
    if (url.pathname === '/game/' || url.pathname === '/game/index.php') {
      if (q.sh !== SH) return page('<html><body><h1>Session expired</h1></body></html>');
    }

    if (url.pathname === '/game/ajax.php') {
      if (q.mod === 'location' && q.submod === 'attack') return json(this.fight('expedition', { location: q.location, stage: q.stage }));
      if (q.mod === 'dungeon' && q.submod === 'attack') {
        const result = this.fight('dungeon', { enemy: q.enemy });
        if (!result.error) {
          s.dungeonEnemies = s.dungeonEnemies.filter((e) => e !== q.enemy);
          if (!s.dungeonEnemies.length) s.dungeonEnemies = null;
        }
        return json(result);
      }
      if (q.mod === 'arena' && q.submod === 'confirmDoCombat') {
        const kind = q.aType === '3' ? 'circus' : 'arena';
        const levels = kind === 'arena' ? s.arenaLevels : s.circusLevels;
        return json(this.fight(kind, { opponent: q.opponentId, level: levels[Number(q.opponentId) - 100] }));
      }
      if (q.mod === 'inventory' && q.submod === 'loadBag') {
        return route.fulfill({ contentType: 'text/html', body: this.bagItems(Number(q.bag)) });
      }
      if (q.mod === 'inventory' && q.submod === 'move' && q.to === '8') {
        const bag = s.bags[q.from] || [];
        const food = bag.find((f) => String(f.x) === q.fromX && String(f.y) === q.fromY);
        if (food) {
          s.hp = Math.min(s.hpMax, s.hp + food.heal);
          s.bags[q.from] = bag.filter((f) => f !== food);
          this.record('heal', { source: q.source || 'request', heal: food.heal });
        }
        return json({ header: { health: { value: s.hp, maxValue: s.hpMax } } });
      }
      return json({ error: 'unknown ajax' });
    }

    if (q.mod === 'overview' && q.submod === 'fetchLoginBonus') {
      s.loginBonus = false;
      this.record('loginBonus');
    }
    if (q.mod === 'dungeon' && request.method() === 'POST') {
      const body = request.postData() || '';
      s.dungeonEnemies = ['11', '12', '13'];
      this.record('dungeonStart', { difficulty: body.includes('dif2') ? 'advanced' : 'normal' });
    }
    if (q.mod === 'work' && request.method() === 'POST') {
      const body = new URLSearchParams(request.postData() || '');
      const hours = Number(body.get('timeToWork'));
      s.workUntil = Date.now() + hours * 3600 * 1000;
      this.record('work', { hours, job: body.get('jobType') });
    }
    if (q.mod === 'quests' && q.submod === 'finishQuest') {
      s.questFinished = false;
      this.record('questFinish');
    }
    if (q.mod === 'quests' && q.submod === 'startQuest') {
      s.acceptedQuests.push(q.type);
      this.record('questAccept', { questType: q.type });
    }

    switch (q.mod || 'overview') {
      case 'location':
        return page(this.locationPage(q.loc));
      case 'dungeon':
        return page(this.dungeonPage());
      case 'arena':
        return page(this.arenaPage(q.aType));
      case 'work':
        return page(this.workPage());
      case 'quests':
        return page(this.questsPage());
      case 'reports':
        return page(this.render('reportsPage', '<h2>Combat report</h2><p>You won!</p>'));
      default:
        return page(this.overviewPage());
    }
  }
}

module.exports = { MockGame, ORIGIN, GAME, SH };
