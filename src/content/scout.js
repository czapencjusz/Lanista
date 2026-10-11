// Sizes up arena and Circus Turma opponents before an attack: reads their
// profile (for the Circus Turma, every doll of their team) from the page
// anyone can open, and plays the fight in sim.js.
//
//   ours     the gladiator (doll 1) for the arena, the team (dolls 2-6) for
//            the Circus Turma, from your overview
//   theirs   the same from the opponent's profile; another server's
//            profile is fetched by the background, without your cookies
//   rank     opponents with at least the wanted chance first (in your
//            "Opponent choice" order), then the rest, best chance first
//
// Fighters are kept in storage (simCache:<host>): your own for 30 minutes,
// opponents for 6 hours.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const sim = GBot.sim;

  const OURS_MS = 30 * 60 * 1000;
  const THEIRS_MS = 6 * 3600 * 1000;
  // Opponents regenerate: after an hour they are taken at full HP.
  const HP_FRESH_MS = 3600 * 1000;
  const CACHE_MAX = 150;
  const RUNS = { arena: 500, circus: 200 };

  const cacheKey = () => `simCache:${location.host}`;

  async function loadCache(ctx) {
    if (!ctx.simCache) ctx.simCache = (ctx.storeGet && (await ctx.storeGet(cacheKey()))) || {};
    return ctx.simCache;
  }

  async function saveCache(ctx) {
    const cache = ctx.simCache;
    const now = ctx.now();
    for (const [k, v] of Object.entries(cache)) if (!v || now - v.at > THEIRS_MS) delete cache[k];
    const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
    for (const k of keys.slice(CACHE_MAX)) delete cache[k];
    if (ctx.storeSet) await ctx.storeSet(cacheKey(), cache);
  }

  // The profile behind an opponent's name ({ host, p, language }), or null.
  function profileOf(opponent) {
    const link = opponent.row && opponent.row.querySelector('a[href*="mod=player"]');
    if (!link) return null;
    try {
      const url = new URL(link.getAttribute('href'), location.href);
      const p = url.searchParams.get('p');
      if (!/^\d+$/.test(p || '')) return null;
      return { host: url.host, p, language: url.searchParams.get('language') };
    } catch (e) {
      return null;
    }
  }

  function profileUrl(profile, doll) {
    const url = new URL(`https://${profile.host}/game/index.php`);
    url.searchParams.set('mod', 'player');
    url.searchParams.set('p', profile.p);
    if (profile.language) url.searchParams.set('language', profile.language);
    if (doll > 1) url.searchParams.set('doll', String(doll));
    return url.href;
  }

  async function profileDoc(ctx, profile, doll) {
    const reply = await ctx.fetchProfile(profileUrl(profile, doll));
    if (!reply || !reply.html) throw new Error((reply && reply.error) || 'no answer');
    return new DOMParser().parseFromString(reply.html, 'text/html');
  }

  // One page per doll; the first one read tells which other dolls there
  // are, and those are read together.
  async function readTeam(load, dolls) {
    const first = await load(dolls[0]);
    const present = sim.dollsOn(first);
    const others = dolls.slice(1).filter((d) => present.includes(d));
    const docs = [first, ...(await Promise.all(others.map(load)))];
    return [dolls[0], ...others].map((doll, i) => {
      const f = sim.readFighter(docs[i], doll);
      if (!f) throw new Error(`no stats on doll ${doll}`);
      return f;
    });
  }

  const dollsFor = (type) => (type === 'arena' ? [1] : [2, 3, 4, 5, 6]);

  async function ours(ctx, type) {
    const cache = await loadCache(ctx);
    const key = `ours:${type}`;
    const hit = cache[key];
    let team = hit && ctx.now() - hit.at < OURS_MS ? hit.team : null;
    if (!team) {
      team = await readTeam(async (doll) => (await GBot.forge.getDoc(ctx.state.sh, doll > 1 ? { mod: 'overview', doll } : { mod: 'overview' })).doc, dollsFor(type));
      cache[key] = { at: ctx.now(), team };
    }
    // The arena is fought with the HP you have now.
    const hp = ctx.state.hp;
    if (type === 'arena' && hp && hp.value !== null && hp.value !== undefined) return [{ ...team[0], hp: hp.value }];
    return team;
  }

  async function theirs(ctx, type, profile) {
    const cache = await loadCache(ctx);
    const key = `${type}:${profile.host}:${profile.p}`;
    const hit = cache[key];
    let entry = hit && ctx.now() - hit.at < THEIRS_MS ? hit : null;
    if (!entry) {
      entry = { at: ctx.now(), team: await readTeam((doll) => profileDoc(ctx, profile, doll), dollsFor(type)) };
      cache[key] = entry;
    }
    const fresh = ctx.now() - entry.at < HP_FRESH_MS;
    return entry.team.map((f) => ({ ...f, hp: fresh && f.hp ? f.hp : f.hpMax }));
  }

  // Each opponent's chance to be beaten (0..1, null when it could not be
  // worked out), keyed by the opponent object.
  async function chances(ctx, type, opponents) {
    const result = new Map();
    let mine;
    try {
      mine = await ours(ctx, type);
    } catch (e) {
      ctx.log('warn', `${type}: could not read your own stats to simulate the fights (${e.message})`);
      return result;
    }
    for (const o of opponents) {
      const profile = profileOf(o);
      if (!profile) continue;
      try {
        const team = await theirs(ctx, type, profile);
        const runs = RUNS[type];
        result.set(o, type === 'arena' ? sim.arenaChance(mine[0], team[0], { runs }) : sim.circusChance(mine, team, { runs }));
      } catch (e) {
        ctx.log('debug', `${type}: no simulation against ${o.name || '?'} (${e.message})`);
      }
    }
    await saveCache(ctx);
    return result;
  }

  // The opponents in the order to try them, each with its chance, or
  // { wait: true } when none is good enough and the settings say to wait.
  // `opponents` comes in the "Opponent choice" order.
  async function rank(ctx, type, opponents) {
    const cfg = ctx.settings[type];
    const found = await chances(ctx, type, opponents);
    if (!found.size) return { order: opponents, chances: found };
    const min = cfg.minChance / 100;
    const good = opponents.filter((o) => found.has(o) && found.get(o) >= min);
    const unknown = opponents.filter((o) => !found.has(o));
    const weak = opponents.filter((o) => found.has(o) && found.get(o) < min).sort((a, b) => found.get(b) - found.get(a));
    const pct = (o) => `${o.name || '?'} ${Math.round(found.get(o) * 100)}%`;
    ctx.log('debug', `${type}: chances to win: ${opponents.filter((o) => found.has(o)).map(pct).join(', ')}`);
    if (!good.length && cfg.ifNone === 'wait') return { wait: true, best: weak[0] ? found.get(weak[0]) : null, chances: found };
    return { order: good.concat(unknown, cfg.ifNone === 'wait' ? [] : weak), chances: found };
  }

  GBot.scout = { rank, profileOf, profileUrl, _internal: { readTeam, chances } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
