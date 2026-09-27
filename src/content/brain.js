// The decision engine. Pure functions only (no DOM, no browser APIs), so the
// whole policy is unit-testable in Node.
//
//   decide(state, settings, memory, now)  -> the next action to take
//   beginAttempt(memory, type, now, ...)   -> counts attempts, applies backoff
//   resolvePending(state, memory, now)     -> detects whether the last action worked
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const FIGHTS = ['expedition', 'dungeon', 'arena', 'circus'];
  const NEEDS_HP = { expedition: true, dungeon: true, arena: true, circus: false };
  const USES_POINTS = { expedition: true, dungeon: true };

  const MIN_WAIT_MS = 5000;
  const NO_FOOD_RETRY_MS = 30 * 60 * 1000;
  const PENDING_STALE_MS = 10 * 60 * 1000;

  function createMemory(now) {
    return {
      pending: null, // { type, at, attempts, hpBefore }
      blockedUntil: {}, // activity -> timestamp
      workUntil: 0,
      workSubmittedAt: 0,
      workSubmittedHours: 0,
      noFoodUntil: 0,
      nextQuestCheck: 0,
      // Cost of the next stat point to train (null = look it up) and when to
      // look again when nothing was affordable.
      trainCost: null,
      nextTrainingCheck: 0,
      // Workbench repair in progress (see workbench.js), when to look at the
      // gear again, and items to leave alone for a while: id -> until.
      repair: null,
      nextRepairCheck: 0,
      repairSkip: {},
      questSteps: { since: 0, count: 0 },
      breakUntil: 0,
      nextBreakAt: 0,
      // Facts about the game read from pages, shown in the settings UI.
      gameInfo: { locations: [], level: null, updatedAt: 0 },
      stats: {
        since: now,
        expedition: 0,
        dungeon: 0,
        arena: 0,
        circus: 0,
        heal: 0,
        work: 0,
        quests: 0,
        nest: 0,
        training: 0,
        repairs: 0,
        goldSpent: 0,
        goldStart: null,
        goldNow: null,
        // From combat reports: per fight type { won, lost }, and totals.
        results: {},
        loot: { gold: 0, xp: 0, honour: 0, fame: 0 },
      },
      // Arena / circus opponents that beat us: type -> { name: until }.
      avoid: { arena: {}, circus: {} },
      log: [],
    };
  }

  // Fill in any fields missing from memory loaded from storage.
  function normalizeMemory(memory, now) {
    const base = createMemory(now);
    if (!memory || typeof memory !== 'object') return base;
    return {
      ...base,
      ...memory,
      blockedUntil: { ...(memory.blockedUntil || {}) },
      questSteps: { ...base.questSteps, ...(memory.questSteps || {}) },
      gameInfo: { ...base.gameInfo, ...(memory.gameInfo || {}) },
      stats: {
        ...base.stats,
        ...(memory.stats || {}),
        results: { ...((memory.stats && memory.stats.results) || {}) },
        loot: { ...base.stats.loot, ...((memory.stats && memory.stats.loot) || {}) },
      },
      avoid: { arena: { ...((memory.avoid && memory.avoid.arena) || {}) }, circus: { ...((memory.avoid && memory.avoid.circus) || {}) } },
      repairSkip: { ...(memory.repairSkip || {}) },
      log: Array.isArray(memory.log) ? memory.log : [],
    };
  }

  const isBlocked = (memory, type, now) => (memory.blockedUntil[type] || 0) > now;

  // Milliseconds until HP regenerates to `percent`, or null when unknown.
  function hpRegenEta(hp, percent) {
    if (!hp || !hp.max || hp.value === null || !hp.regenPerHour) return null;
    const needed = Math.ceil((percent / 100) * hp.max) - hp.value;
    if (needed <= 0) return 0;
    return Math.ceil((needed / hp.regenPerHour) * 3600 * 1000);
  }

  const LABELS = {
    expedition: 'Expedition',
    dungeon: 'Dungeon',
    arena: 'Arena',
    circus: 'Circus Turma',
    quests: 'Quests',
    heal: 'Healing',
    work: 'Work',
  };

  const hpKnown = (hp) => hp && hp.percent !== null && hp.percent !== undefined;

  // Local-time "HH:MM" -> minutes after midnight.
  const minutesOf = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  // Is `now` inside the configured active hours? When not, `until` is the
  // next start time.
  function scheduleWindow(schedule, now) {
    if (!schedule.activeHours) return { active: true };
    const start = minutesOf(schedule.start);
    const end = minutesOf(schedule.end);
    if (start === end) return { active: true };
    const d = new Date(now);
    const m = d.getHours() * 60 + d.getMinutes();
    const active = start < end ? m >= start && m < end : m >= start || m < end;
    if (active) return { active: true };
    const next = new Date(now);
    next.setHours(Math.floor(start / 60), start % 60, 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return { active: false, until: next.getTime() };
  }

  // Keeps memory.breakUntil / memory.nextBreakAt up to date. Break length and
  // spacing vary by +-30% so the pattern is not mechanical.
  function updateBreaks(schedule, memory, now, random = Math.random) {
    if (!schedule.breaks) {
      memory.breakUntil = 0;
      memory.nextBreakAt = 0;
      return;
    }
    const jitter = (minutes) => Math.round(minutes * 60000 * (0.7 + 0.6 * random()));
    if (memory.breakUntil > now) return;
    if (!memory.nextBreakAt) {
      memory.nextBreakAt = now + jitter(schedule.breakEvery);
    } else if (now >= memory.nextBreakAt) {
      memory.breakUntil = now + jitter(schedule.breakLength);
      memory.nextBreakAt = memory.breakUntil + jitter(schedule.breakEvery);
    }
  }

  const outOfPoints = (cd, cfg) => cd.points !== null && cd.points !== undefined && cd.points <= cfg.keepPoints;

  function decide(state, settings, memory, now) {
    if (!settings.enabled) return { type: 'idle', reason: 'Paused' };
    if (!state.inGame) return { type: 'idle', reason: 'Not on an in-game page' };

    const hours = scheduleWindow(settings.schedule, now);
    if (!hours.active) {
      return { type: 'wait', until: hours.until, reason: 'Outside active hours', next: { label: 'Active hours start', at: hours.until } };
    }
    if (memory.breakUntil > now) {
      return { type: 'wait', until: memory.breakUntil, reason: 'Taking a break', next: { label: 'Break ends', at: memory.breakUntil } };
    }

    if (!isBlocked(memory, 'dialog', now)) {
      if (state.dialogs.loginBonus) return { type: 'dialog', dialog: 'loginBonus', reason: 'Collect daily login bonus' };
      if (state.dialogs.notification) return { type: 'dialog', dialog: 'notification', reason: 'Close notification' };
    }
    const nest = settings.general.nestSearch;
    if (state.dialogs.nest && nest !== 'off' && !isBlocked(memory, 'nest', now)) {
      return { type: 'nest', mode: nest, reason: nest === 'return' ? 'Leave the enemy nest' : `Search the enemy nest (${nest})` };
    }

    if (memory.workUntil > now) {
      return { type: 'wait', until: memory.workUntil, reason: 'Working in the stable', next: { label: 'Work ends', at: memory.workUntil } };
    }

    const wake = [];
    const hp = state.hp || {};
    const minHp = settings.heal.minHpPercent;
    const hpOk = !hpKnown(hp) || hp.percent >= minHp;
    const wantsHp = FIGHTS.some((t) => NEEDS_HP[t] && settings[t].enabled);

    if (settings.heal.enabled && wantsHp && hpKnown(hp) && hp.percent < settings.heal.eatBelowPercent) {
      if (!isBlocked(memory, 'heal', now) && (memory.noFoodUntil || 0) <= now) {
        return { type: 'heal', reason: `HP ${hp.percent}% is below ${settings.heal.eatBelowPercent}%` };
      }
    }

    if (settings.repair.enabled || memory.repair) {
      const r = memory.repair;
      // Gear is off the character: hold every fight until it is back on.
      if (r && r.until > now) {
        return { type: 'wait', until: r.until, reason: `Repairing ${r.name}`, next: { label: 'Repair done', at: r.until } };
      }
      if (r || (memory.nextRepairCheck || 0) <= now) {
        return { type: 'repair', reason: r ? `Repair ${r.name}: ${r.stage}` : 'Check gear condition' };
      }
    }

    if (wantsTraining(state, settings, memory, now)) {
      return { type: 'training', reason: 'Train a stat with spare gold' };
    }

    for (const type of settings.general.order) {
      if (type === 'quests') {
        if (!settings.quests.enabled || isBlocked(memory, 'quests', now)) continue;
        if ((memory.nextQuestCheck || 0) <= now) return { type: 'quests', reason: 'Check pantheon quests' };
        wake.push({ label: LABELS.quests, at: memory.nextQuestCheck });
        continue;
      }
      const cfg = settings[type];
      const cd = state[type];
      if (!cfg.enabled || !cd || !cd.available) continue;
      if (isBlocked(memory, type, now)) {
        wake.push({ label: `${LABELS[type]} (paused)`, at: memory.blockedUntil[type] });
        continue;
      }
      if (NEEDS_HP[type] && !hpOk) {
        const eta = hpRegenEta(hp, minHp);
        if (eta !== null) wake.push({ label: `HP ${minHp}%`, at: now + eta });
        continue;
      }
      if (USES_POINTS[type] && outOfPoints(cd, cfg)) continue;
      if (cd.ready) return { type, reason: `${LABELS[type]} is ready` };
      if (cd.remainingMs !== null && cd.remainingMs !== undefined) wake.push({ label: LABELS[type], at: now + cd.remainingMs });
    }

    if (settings.work.enabled && !isBlocked(memory, 'work', now) && shouldWork(state, settings)) {
      return { type: 'work', reason: 'Out of expedition/dungeon points' };
    }

    const maxIdleMs = settings.timing.maxIdle * 1000;
    let next = { label: 'Re-check', at: now + maxIdleMs };
    for (const w of wake) if (w.at > now && w.at < next.at) next = w;
    // A few seconds of slack after a cooldown ends, like a human would take.
    const until = Math.max(now + MIN_WAIT_MS, next.at + 2000 + Math.floor(Math.random() * 8000));
    return { type: 'wait', until, reason: 'Waiting', next };
  }

  function wantsTraining(state, settings, memory, now) {
    const cfg = settings.training;
    if (!cfg.enabled || isBlocked(memory, 'training', now) || state.gold === null || state.gold === undefined) return false;
    if (!Object.values(cfg.stats).some(Boolean)) return false;
    if (memory.trainCost !== null && memory.trainCost !== undefined) return state.gold - cfg.keepGold >= memory.trainCost;
    return (memory.nextTrainingCheck || 0) <= now;
  }

  // ------------------------------------------------------------ repair

  // Conditioning from an item tooltip's lines. Item tooltips list
  // "Durability a/b (p%)" and then "Conditioning a/b (p%)"; the words are
  // localised, so the second "a/b (p%)" line is taken.
  function conditionOf(lines) {
    const found = [];
    for (const line of lines) {
      const m = String(line).match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)\s*\((\d+)\s*%\)/);
      if (m) found.push({ value: parseInt(m[1].replace(/[.,]/g, ''), 10), max: parseInt(m[2].replace(/[.,]/g, ''), 10), percent: Number(m[3]) });
    }
    return found.length >= 2 ? found[1] : null;
  }

  // The worn item most in need of repair: [{ id, condition, ... }] -> item.
  function pickRepair(items, belowPercent, skip, now) {
    const due = items.filter((i) => i.condition && i.condition.percent < belowPercent && !((skip || {})[i.id] > now));
    return due.length ? due.reduce((a, b) => (b.condition.percent < a.condition.percent ? b : a)) : null;
  }

  // First free w x h spot in the bags: [{ bag, cells: [{ x, y, w, h }] }]
  // (8 x 5 grid, 1-based) -> { bag, x, y } or null.
  function freeSpot(bags, w, h, cols = 8, rows = 5) {
    for (const { bag, cells } of bags) {
      const used = (x, y) => cells.some((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
      for (let y = 1; y + h - 1 <= rows; y++) {
        for (let x = 1; x + w - 1 <= cols; x++) {
          let ok = true;
          for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) if (used(x + dx, y + dy)) ok = false;
          if (ok) return { bag, x, y };
        }
      }
    }
    return null;
  }

  // Can the Horreum cover a repair? needed: { key: { amount } } with keys like
  // 18024 (class 18, type 24); stock: { type: { quality: amount } }.
  // -> 'full' | 'partial' | 'none', counting qualities up to maxQuality.
  function materialsAvailable(needed, stock, maxQuality) {
    let full = true;
    let any = false;
    for (const [key, need] of Object.entries(needed || {})) {
      if (!need || !need.amount) continue;
      const byQuality = (stock || {})[String(Number(key) % 1000)] || {};
      let have = 0;
      for (const [q, n] of Object.entries(byQuality)) if (Number(q) <= maxQuality) have += Number(n) || 0;
      if (have > 0) any = true;
      if (have < need.amount) full = false;
    }
    return full && any ? 'full' : any ? 'partial' : 'none';
  }

  // The cheapest selected stat from [{ stat, cost }], or null.
  function pickTraining(options, stats) {
    const allowed = options.filter((o) => stats[o.stat] && o.cost !== null);
    return allowed.length ? allowed.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
  }

  // Work when every enabled point-based activity has run out of points.
  function shouldWork(state, settings) {
    const pointTypes = ['expedition', 'dungeon'].filter((t) => settings[t].enabled && state[t] && state[t].available);
    if (pointTypes.length === 0) {
      // Nothing uses points: only work if nothing else is enabled either.
      return !settings.arena.enabled && !settings.circus.enabled;
    }
    return pointTypes.every((t) => outOfPoints(state[t], settings[t]));
  }

  // Per-activity summary for the control bar tiles.
  //   { enabled, text, until?, ready?, warn?, points? }
  function activityStatus(state, settings, memory, now) {
    const out = {};
    const hp = state.hp || {};
    const hpLow = hpKnown(hp) && hp.percent < settings.heal.minHpPercent;
    for (const type of FIGHTS) {
      const cfg = settings[type];
      const cd = state[type];
      const s = { enabled: cfg.enabled };
      if (cd && USES_POINTS[type] && cd.points !== null && cd.points !== undefined) {
        s.points = `${cd.points}/${cd.maxPoints ?? '?'}`;
      }
      if (!cfg.enabled) s.text = 'off';
      else if (!cd || !cd.available) s.text = 'n/a';
      else if (isBlocked(memory, type, now)) Object.assign(s, { text: 'paused', until: memory.blockedUntil[type], warn: true });
      else if (USES_POINTS[type] && outOfPoints(cd, cfg)) s.text = 'no points';
      else if (NEEDS_HP[type] && hpLow) Object.assign(s, { text: 'low HP', warn: true });
      else if (cd.ready) Object.assign(s, { text: 'ready', ready: true });
      else if (cd.remainingMs) Object.assign(s, { text: 'cooldown', until: now + cd.remainingMs });
      else s.text = 'waiting';
      out[type] = s;
    }
    const heal = { enabled: settings.heal.enabled, text: hpKnown(hp) ? `${hp.percent}%` : '?' };
    if (hpKnown(hp) && hp.percent < settings.heal.eatBelowPercent) heal.warn = true;
    if ((memory.noFoodUntil || 0) > now) Object.assign(heal, { text: 'no food', until: memory.noFoodUntil, warn: true });
    out.heal = heal;
    out.work = memory.workUntil > now
      ? { enabled: settings.work.enabled, text: 'working', until: memory.workUntil, ready: true }
      : { enabled: settings.work.enabled, text: settings.work.enabled ? `${settings.work.hours}h` : 'off' };
    const quests = { enabled: settings.quests.enabled, text: settings.quests.enabled ? 'ready' : 'off' };
    if (settings.quests.enabled && memory.nextQuestCheck > now) Object.assign(quests, { text: 'next', until: memory.nextQuestCheck });
    out.quests = quests;
    return out;
  }

  // Call before performing (or navigating towards) an action. Returns
  // { ok: false } when the activity just exceeded its attempt budget and got
  // paused.
  function beginAttempt(memory, type, now, settings, state) {
    const prev = memory.pending;
    const sameRun = prev && prev.type === type && now - prev.at < PENDING_STALE_MS;
    const attempts = sameRun ? prev.attempts + 1 : 1;
    // Fights need up to 3 steps (navigate, start dungeon, attack).
    const budget = settings.safety.maxAttempts + 2;
    if (attempts > budget) {
      const minutes = settings.safety.backoffMinutes;
      memory.blockedUntil[type] = now + minutes * 60 * 1000;
      memory.pending = null;
      return { ok: false, message: `${type}: ${attempts - 1} attempts without success, pausing it for ${minutes} min` };
    }
    memory.pending = {
      type,
      at: now,
      attempts,
      hpBefore: state && state.hp ? state.hp.value : null,
      goldBefore: state ? state.gold : null,
      firstAt: sameRun ? prev.firstAt : now,
    };
    return { ok: true, attempts };
  }

  // Looks at the freshly loaded page to decide whether the pending action
  // succeeded. Returns a list of { level, message } events and bumps stats.
  function resolvePending(state, memory, now) {
    const pending = memory.pending;
    if (!pending) return [];
    if (now - pending.at > PENDING_STALE_MS) {
      memory.pending = null;
      return [];
    }
    let success = false;
    let message = '';
    const type = pending.type;

    const events = [];
    if (FIGHTS.includes(type)) {
      const cd = state[type];
      if (state.report) {
        success = true;
        message = recordFight(memory, type, state.report, pending.opponent, now);
        if (!state.report.win && pending.opponent && memory.avoid[type] && pending.avoidHours > 0) {
          memory.avoid[type][pending.opponent.toLowerCase()] = now + pending.avoidHours * 3600 * 1000;
          events.push({ level: 'info', message: `${LABELS[type]}: avoiding ${pending.opponent} for ${pending.avoidHours}h after a loss` });
        }
      } else if (cd && cd.available && !cd.ready) {
        success = true;
        message = `${type} attack done`;
      }
    } else if (type === 'heal') {
      // Ignore the few HP that natural regeneration adds during a reload.
      const threshold = Math.max(3, Math.round(0.02 * ((state.hp && state.hp.max) || 0)));
      if (state.hp && state.hp.value !== null && pending.hpBefore !== null && state.hp.value - pending.hpBefore >= threshold) {
        success = true;
        message = `Healed ${pending.hpBefore} -> ${state.hp.value} HP`;
      }
    } else if (type === 'work') {
      if (memory.workUntil > now) {
        success = true;
        message = 'Started working';
      }
    } else if (type === 'training') {
      if (state.gold !== null && pending.goldBefore !== null && pending.goldBefore !== undefined && state.gold < pending.goldBefore) {
        success = true;
        memory.stats.goldSpent += pending.goldBefore - state.gold;
        message = `Trained ${pending.stat || 'a stat'} for ${fmt(pending.goldBefore - state.gold)} gold`;
      }
    } else if (type === 'nest') {
      if (!state.dialogs.nest) success = true;
    } else if (type === 'dialog') {
      if (!state.dialogs.loginBonus && !state.dialogs.notification) success = true;
    }

    if (!success) return [];
    memory.pending = null;
    delete memory.blockedUntil[type];
    if (type in memory.stats) memory.stats[type] += 1;
    return message ? [{ level: 'info', message }, ...events] : events;
  }

  const fmt = (n) => Number(n).toLocaleString('en-US');

  // Adds a combat report to the statistics; returns the log message.
  function recordFight(memory, type, report, opponent, now) {
    const results = memory.stats.results;
    const r = (results[type] = { won: 0, lost: 0, ...(results[type] || {}) });
    if (report.win) r.won += 1;
    else r.lost += 1;
    const loot = memory.stats.loot;
    loot.gold += report.gold || 0;
    loot.xp += report.xp || 0;
    // Expeditions and the arena give honour; dungeons and the circus give
    // fame (as the reports on s60-en say).
    const renownKind = type === 'dungeon' || type === 'circus' ? 'fame' : 'honour';
    loot[renownKind] = (loot[renownKind] || 0) + (report.renown || 0);
    memory.lastFight = { type, at: now, ...report };
    const gains = [];
    if (report.gold) gains.push(`+${fmt(report.gold)} gold`);
    if (report.xp) gains.push(`+${fmt(report.xp)} XP`);
    if (report.renown) gains.push(`+${fmt(report.renown)} ${renownKind}`);
    const vs = opponent ? ` vs ${opponent}` : '';
    return `${LABELS[type]}${vs}: ${report.win ? 'won' : 'lost'}${gains.length ? `, ${gains.join(', ')}` : ''}`;
  }

  // Drops expired entries from the avoid lists; returns the active names of `type`.
  function avoidedNames(memory, type, now) {
    const list = (memory.avoid && memory.avoid[type]) || {};
    for (const [name, until] of Object.entries(list)) if (until <= now) delete list[name];
    return Object.keys(list);
  }

  // Quests are a sequence of clicks (finish, accept, ...). Cap the number of
  // steps per 10 minutes so a broken button cannot cause a reload loop.
  function questStep(memory, now) {
    if (now - memory.questSteps.since > PENDING_STALE_MS) memory.questSteps = { since: now, count: 0 };
    memory.questSteps.count += 1;
    return memory.questSteps.count <= 12;
  }

  function markNoFood(memory, now) {
    memory.noFoodUntil = now + NO_FOOD_RETRY_MS;
    memory.pending = null;
  }

  // Opponent choice for arena / circus. `opponents` = [{ level, index }].
  function pickOpponents(opponents, strategy, random = Math.random) {
    const list = opponents.filter((o) => o.level !== null && !Number.isNaN(o.level));
    const rest = opponents.filter((o) => !list.includes(o));
    if (strategy === 'highest') list.sort((a, b) => b.level - a.level);
    else if (strategy === 'random') {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    } else list.sort((a, b) => a.level - b.level);
    return list.concat(rest);
  }

  // Splits a user-entered list ("a, b\nc") into lower-case names.
  const parseNameList = (text) =>
    String(text || '')
      .split(/[\n,;]+/)
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);

  // Removes opponents the user does not want to fight: ignored names and,
  // optionally, levels outside [myLevel - maxBelow, myLevel + maxAbove].
  function filterOpponents(opponents, cfg, myLevel, avoided = []) {
    const ignored = parseNameList(cfg.ignorePlayers).concat(avoided);
    return opponents.filter((o) => {
      if (o.name && ignored.includes(o.name.trim().toLowerCase())) return false;
      if (!cfg.limitLevels || myLevel === null || myLevel === undefined || o.level === null || o.level === undefined) return true;
      return o.level <= myLevel + cfg.maxAbove && o.level >= myLevel - cfg.maxBelow;
    });
  }

  // Choose the food whose heal amount best fills the missing HP: the largest
  // item that does not overheal, otherwise the smallest one.
  function pickFood(foods, missingHp) {
    if (!foods.length) return null;
    const known = foods.filter((f) => f.heal > 0);
    if (!known.length || missingHp === null) return foods[0];
    const fitting = known.filter((f) => f.heal <= missingHp).sort((a, b) => b.heal - a.heal);
    if (fitting.length) return fitting[0];
    return known.slice().sort((a, b) => a.heal - b.heal)[0];
  }

  // Picks the quest to accept from the open offers ({ type, title, reward }),
  // or null. Expedition quests are titled "<Location>: ..."; with
  // matchLocation they are only taken for `myLocation` (when it is known).
  // The best-paying acceptable quest wins.
  //
  // With onlyActive, quests for activities the bot does not do are skipped.
  // Dungeon quests are titled "<Dungeon>: ..." and matched like locations.
  function chooseQuest(offers, settings, places = {}) {
    const q = settings.quests;
    const norm = (s) => (s ? String(s).trim().toLowerCase() : null);
    const where = { expedition: norm(places.location), dungeon: norm(places.dungeon) };
    const doing = {
      expedition: settings.expedition.enabled,
      dungeon: settings.dungeon.enabled,
      arena: settings.arena.enabled,
      circus: settings.circus.enabled,
      work: settings.work.enabled,
      items: settings.expedition.enabled || settings.dungeon.enabled,
      combat: FIGHTS.some((t) => settings[t].enabled),
    };
    const ok = offers.filter((quest) => {
      if (!quest.type || !q.types[quest.type]) return false;
      if (q.onlyActive && doing[quest.type] === false) return false;
      const here = where[quest.type];
      if (!q.matchLocation || !here) return true;
      const m = String(quest.title || '').match(/^([^:]+):/);
      return !m || m[1].trim().toLowerCase() === here;
    });
    if (!ok.length) return null;
    return ok.slice().sort((a, b) => (b.reward || 0) - (a.reward || 0))[0];
  }

  GBot.brain = {
    FIGHTS,
    chooseQuest,
    pickTraining,
    wantsTraining,
    conditionOf,
    pickRepair,
    freeSpot,
    materialsAvailable,
    recordFight,
    avoidedNames,
    LABELS,
    createMemory,
    normalizeMemory,
    decide,
    scheduleWindow,
    updateBreaks,
    activityStatus,
    shouldWork,
    beginAttempt,
    resolvePending,
    questStep,
    markNoFood,
    pickOpponents,
    filterOpponents,
    parseNameList,
    pickFood,
    hpRegenEta,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.brain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
