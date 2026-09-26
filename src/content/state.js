// Reads the current game state from the DOM into a plain object that the
// decision engine (brain.js) can work with.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const { SEL } = GBot.selectors;
  const { parseDuration, parseNumber, isVisible } = GBot.util;

  const text = (doc, sel) => {
    const el = doc.querySelector(sel);
    return el ? el.textContent.trim() : null;
  };

  function readSessionHash(doc, loc) {
    const fromUrl = new URL(loc.href).searchParams.get('sh');
    if (fromUrl) return fromUrl;
    const link = doc.querySelector('a[href*="sh="]');
    if (!link) return null;
    try {
      return new URL(link.getAttribute('href'), loc.href).searchParams.get('sh');
    } catch (e) {
      return null;
    }
  }

  function readPage(doc, loc) {
    const params = new URL(loc.href).searchParams;
    return {
      mod: params.get('mod') || 'overview',
      submod: params.get('submod'),
      loc: params.get('loc'),
      aType: params.get('aType'),
      doll: params.get('doll'),
      bodyId: doc.body ? doc.body.id : '',
    };
  }

  function readHp(doc) {
    const bar = doc.querySelector(SEL.hpBar);
    let value = bar ? parseNumber(bar.getAttribute('data-value')) : null;
    let max = bar ? parseNumber(bar.getAttribute('data-max-value')) : null;
    const regenPerHour = bar ? parseNumber(bar.getAttribute('data-regen-per-hour')) : null;

    // Older layouts only expose "value / max" inside the tooltip.
    if ((value === null || !max) && bar && bar.getAttribute('data-tooltip')) {
      const m = bar.getAttribute('data-tooltip').match(/(\d[\d.,]*)\s*\\?\/\s*(\d[\d.,]*)/);
      if (m) {
        value = parseNumber(m[1]);
        max = parseNumber(m[2]);
      }
    }

    let percent = value !== null && max ? Math.round((value / max) * 100) : null;
    if (percent === null) percent = parseNumber(text(doc, SEL.hpPercent));
    return { value, max, percent, regenPerHour };
  }

  function readPoints(doc, sel) {
    let value = parseNumber(text(doc, sel.value));
    let max = parseNumber(text(doc, sel.max));
    if (value === null) {
      const box = text(doc, sel.box);
      const m = box && box.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        value = Number(m[1]);
        max = Number(m[2]);
      }
    }
    return { points: value, maxPoints: max };
  }

  function readCooldown(doc, loc, sel) {
    const bar = doc.querySelector(sel.bar);
    const fill = doc.querySelector(sel.fill);
    if (!bar && !fill) return { available: false, ready: false, remainingMs: null, link: null };

    const label = text(doc, sel.text);
    const remaining = parseDuration(label);
    const ready = fill ? fill.classList.contains(SEL.cooldownReadyClass) || remaining === 0 : remaining === null;
    const linkEl = bar ? bar.querySelector(SEL.cooldownLink) : null;
    const href = linkEl && linkEl.getAttribute('href');
    return {
      available: true,
      ready,
      remainingMs: ready ? 0 : remaining,
      link: href ? new URL(href, loc.href).href : null,
    };
  }

  function readDialogs(doc) {
    const visible = (sel) => {
      const el = doc.querySelector(sel);
      return !!el && isVisible(el);
    };
    return {
      loginBonus: visible(SEL.dialogs.loginBonus),
      notification: visible(SEL.dialogs.notification),
    };
  }

  function readState(doc, loc, now = Date.now()) {
    const inGame = !!doc.querySelector(SEL.gameHeader) || !!doc.querySelector(SEL.hpBar);
    const expedition = {
      ...readCooldown(doc, loc, SEL.cooldowns.expedition),
      ...readPoints(doc, SEL.points.expedition),
    };
    const dungeon = {
      ...readCooldown(doc, loc, SEL.cooldowns.dungeon),
      ...readPoints(doc, SEL.points.dungeon),
    };
    return {
      now,
      inGame,
      host: loc.host,
      sh: readSessionHash(doc, loc),
      page: readPage(doc, loc),
      hp: readHp(doc),
      level: parseNumber(text(doc, SEL.level)),
      gold: parseNumber(text(doc, SEL.gold)),
      expedition,
      dungeon,
      arena: readCooldown(doc, loc, SEL.cooldowns.arena),
      circus: readCooldown(doc, loc, SEL.cooldowns.circus),
      dialogs: readDialogs(doc),
    };
  }

  GBot.state = { readState, readHp, readCooldown, readPoints, readSessionHash };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.state;
})(typeof globalThis !== 'undefined' ? globalThis : this);
