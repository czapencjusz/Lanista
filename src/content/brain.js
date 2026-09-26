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
      questSteps: { since: 0, count: 0 },
      stats: { since: now, expedition: 0, dungeon: 0, arena: 0, circus: 0, heal: 0, work: 0, quests: 0 },
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
      stats: { ...base.stats, ...(memory.stats || {}) },
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

  function decide(state, settings, memory, now) {
    if (!settings.enabled) return { type: 'idle', reason: 'Paused' };
    if (!state.inGame) return { type: 'idle', reason: 'Not on an in-game page' };

    if (!isBlocked(memory, 'dialog', now)) {
      if (state.dialogs.loginBonus) return { type: 'dialog', dialog: 'loginBonus', reason: 'Collect daily login bonus' };
      if (state.dialogs.notification) return { type: 'dialog', dialog: 'notification', reason: 'Close notification' };
    }

    if (memory.workUntil > now) {
      return { type: 'wait', until: memory.workUntil, reason: 'Working in the stable' };
    }

    const wakeTimes = [];
    const hp = state.hp || {};
    const minHp = settings.heal.minHpPercent;
    const hpOk = hp.percent === null || hp.percent === undefined || hp.percent >= minHp;
    const wantsHp = FIGHTS.some((t) => NEEDS_HP[t] && settings[t].enabled);

    if (!hpOk && wantsHp && settings.heal.enabled && settings.heal.useFood) {
      if (!isBlocked(memory, 'heal', now) && (memory.noFoodUntil || 0) <= now) {
        return { type: 'heal', reason: `HP ${hp.percent}% is below ${minHp}%` };
      }
    }

    if (settings.quests.enabled && !isBlocked(memory, 'quests', now)) {
      if ((memory.nextQuestCheck || 0) <= now) return { type: 'quests', reason: 'Check pantheon quests' };
      wakeTimes.push(memory.nextQuestCheck);
    }

    for (const type of FIGHTS) {
      const cfg = settings[type];
      const cd = state[type];
      if (!cfg.enabled || !cd || !cd.available) continue;
      if (isBlocked(memory, type, now)) {
        wakeTimes.push(memory.blockedUntil[type]);
        continue;
      }
      if (NEEDS_HP[type] && !hpOk) {
        const eta = hpRegenEta(hp, minHp);
        if (eta !== null) wakeTimes.push(now + eta);
        continue;
      }
      if (USES_POINTS[type] && cd.points === 0) continue;
      if (cd.ready) return { type, reason: `${type} is ready` };
      if (cd.remainingMs !== null && cd.remainingMs !== undefined) wakeTimes.push(now + cd.remainingMs);
    }

    if (settings.work.enabled && !isBlocked(memory, 'work', now) && shouldWork(state, settings)) {
      return { type: 'work', reason: 'Out of expedition/dungeon points' };
    }

    const maxIdleMs = settings.timing.maxIdle * 1000;
    const next = Math.min(now + maxIdleMs, ...wakeTimes.filter((t) => t > now));
    // A few seconds of slack after a cooldown ends, like a human would take.
    const until = Math.max(now + MIN_WAIT_MS, next + 2000 + Math.floor(Math.random() * 8000));
    return { type: 'wait', until, reason: 'Waiting for cooldowns' };
  }

  // Work when every enabled point-based activity has run out of points.
  function shouldWork(state, settings) {
    const pointTypes = ['expedition', 'dungeon'].filter((t) => settings[t].enabled && state[t] && state[t].available);
    if (pointTypes.length === 0) {
      // Nothing uses points: only work if nothing else is enabled either.
      return !settings.arena.enabled && !settings.circus.enabled;
    }
    return pointTypes.every((t) => state[t].points === 0);
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

    if (FIGHTS.includes(type)) {
      const cd = state[type];
      if (cd && cd.available && !cd.ready) {
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
    } else if (type === 'dialog') {
      if (!state.dialogs.loginBonus && !state.dialogs.notification) success = true;
    }

    if (!success) return [];
    memory.pending = null;
    delete memory.blockedUntil[type];
    if (type in memory.stats) memory.stats[type] += 1;
    return message ? [{ level: 'info', message }] : [];
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

  GBot.brain = {
    FIGHTS,
    createMemory,
    normalizeMemory,
    decide,
    shouldWork,
    beginAttempt,
    resolvePending,
    questStep,
    markNoFood,
    pickOpponents,
    pickFood,
    hpRegenEta,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.brain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
