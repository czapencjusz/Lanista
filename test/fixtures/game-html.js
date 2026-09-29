// Renders HTML that mimics the structure of Gladiatus pages (header bars,
// cooldowns, expedition/dungeon/arena/work/quest content). Used by the unit
// tests (jsdom) and by the end-to-end mock game server.
'use strict';

const DEFAULT_HEADER = {
  sh: 'abc123',
  hp: 800,
  hpMax: 1000,
  regen: 600,
  level: 25,
  gold: 12345,
  expPoints: 10,
  expMax: 24,
  dunPoints: 5,
  dunMax: 12,
  cooldowns: { expedition: 0, dungeon: 0, arena: 0, circus: 0 }, // seconds left
  lastLoc: 3,
};

function fmt(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function cooldownBar(id, textId, seconds, href, readyText) {
  const ready = seconds <= 0;
  return `
    <div id="cooldown_bar_${id}" class="cooldown_bar">
      <a href="${href}" class="cooldown_bar_link"></a>
      <div id="cooldown_bar_fill_${id}" class="cooldown_bar_fill cooldown_bar_fill_${ready ? 'ready' : 'progress'}" style="width:${ready ? 100 : 40}%"></div>
      <div id="cooldown_bar_text_${textId}" class="cooldown_bar_text">${ready ? readyText : fmt(seconds)}</div>
    </div>`;
}

function header(opts = {}) {
  const o = { ...DEFAULT_HEADER, ...opts, cooldowns: { ...DEFAULT_HEADER.cooldowns, ...(opts.cooldowns || {}) } };
  const sh = o.sh;
  const pct = Math.round((o.hp / o.hpMax) * 100);
  const tooltip = JSON.stringify([[[['Life:', `${o.hp} / ${o.hpMax}`], '#fff']]]).replace(/"/g, '&quot;');
  return `
  <div id="header_game">
    <div id="header_values_hp">
      <div id="header_values_hp_bar" class="header_values_bar" data-max-value="${o.hpMax}" data-value="${o.hp}" data-regen-per-hour="${o.regen}" data-tooltip="${tooltip}">
        <div id="header_values_hp_bar_fill" style="width:${pct}%"></div>
      </div>
      <div id="header_values_hp_percent">${pct}%</div>
    </div>
    <div id="header_values_level">${o.level}</div>
    <div class="headervalue_small" id="sstat_gold_val">${o.gold.toLocaleString('de-DE')}</div>
    <div id="expeditionpoints_value" class="headervalue_small"><span id="expeditionpoints_value_point">${o.expPoints}</span> / <span id="expeditionpoints_value_pointmax">${o.expMax}</span></div>
    <div id="dungeonpoints_value" class="headervalue_small"><span id="dungeonpoints_value_point">${o.dunPoints}</span> / <span id="dungeonpoints_value_pointmax">${o.dunMax}</span></div>
    <div id="cooldown_bars">
      ${cooldownBar('expedition', 'expedition', o.cooldowns.expedition, `index.php?mod=location&loc=${o.lastLoc}&sh=${sh}`, 'Go to expedition')}
      ${cooldownBar('dungeon', 'dungeon', o.cooldowns.dungeon, `index.php?mod=dungeon&loc=${o.lastLoc}&sh=${sh}`, 'Go to dungeon')}
      ${cooldownBar('arena', 'arena', o.cooldowns.arena, `index.php?mod=arena&sh=${sh}`, 'Go to arena')}
      ${cooldownBar('ct', 'ct', o.cooldowns.circus, `index.php?mod=arena&submod=grouparena&sh=${sh}`, 'Go to circus turma')}
    </div>
  </div>
  <div id="mainmenu"><a class="menuitem" href="index.php?mod=overview&sh=${sh}">Overview</a></div>
  <div id="submenu2">
    <a class="menuitem" href="index.php?mod=location&loc=1&sh=${sh}">Grimwood</a>
    <a class="menuitem" href="index.php?mod=location&loc=2&sh=${sh}">Pirate Harbour</a>
    <a class="menuitem" href="index.php?mod=location&loc=3&sh=${sh}">Misty Mountains</a>
  </div>`;
}

function page({ bodyId = 'overviewPage', head = '', content = '', headerOpts = {}, extra = '' } = {}) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Gladiatus</title>${head}</head>
<body id="${bodyId}">
  <div id="wrapper_game">
    ${header(headerOpts)}
    <div id="content">${content}</div>
  </div>
  ${extra}
</body></html>`;
}

function expeditionContent(disabled = false) {
  return [1, 2, 3, 4]
    .map(
      (i) => `<div class="expedition_box">
        <div class="expedition_picture"><img src="img/expedition/enemy${i}.png"></div>
        <button class="expedition_button awesome-button${disabled ? ' disabled' : ''}" onclick="attack(null, '3', ${i}, 0, '')">Attack</button>
      </div>`
    )
    .join('');
}

function dungeonStartContent(sh) {
  return `<form method="post" action="index.php?mod=dungeon&loc=3&sh=${sh}">
      <input type="submit" class="button1" name="dif1" value="Normal">
      <input type="submit" class="button1" name="dif2" value="Advanced">
    </form>`;
}

// A running dungeon as on s303-en: image-map areas, and a map label "Boss"
// over the boss once it can be attacked; plus the "Cancel dungeon" form.
function dungeonMapContent(enemies, boss, sh) {
  return `<img src="img/dungeon/map.jpg" usemap="#dmap"><map name="dmap">${enemies
    .map((id) => `<area shape="circle" coords="10,10,10" onclick="startFight('${id}', '40')">`)
    .join('')}</map>${enemies.includes(boss) ? `<div class="map_label" style="cursor:pointer;left:320px;top:240px;" onclick="startFight('${boss}', '40')">Boss</div>` : ''}
    <form method="post" action="index.php?mod=dungeon&loc=3&action=cancelDungeon&sh=${sh}">
      <input type="hidden" name="dungeonId" value="40"><input type="submit" class="button1" value="Cancel dungeon">
    </form>`;
}

function arenaContent(type, levels) {
  const tableId = type === 'arena' ? 'own2' : 'own3';
  const aType = type === 'arena' ? 2 : 3;
  const rows = levels
    .map(
      (lvl, i) => `<tr>
        <td><a href="https://s1-en.gladiatus.gameforge.com/game/index.php?mod=player&p=${100 + i}">Player${i}</a></td>
        <td>${lvl}</td><td>Server 1</td>
        <td><span class="attack" onclick="startProvinciarumFight(this, ${aType}, '1', '${100 + i}', 'en')">Attack</span></td>
      </tr>`
    )
    .join('');
  return `<div id="errorRow" style="display:none"><div id="errorText"></div></div>
    <table id="${tableId}"><tr><th>Name</th><th>Level</th><th>Server</th><th></th></tr>${rows}</table>`;
}

module.exports = {
  DEFAULT_HEADER,
  header,
  page,
  expeditionContent,
  dungeonStartContent,
  dungeonMapContent,
  arenaContent,
};
