// Remote control: commands sent from the phone, through the Telegram bot
// among the phone alert addresses (only from its chat) or an ntfy topic, and
// the answers. Pure functions; background.js reads the commands, carries
// them out and sends the answers.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const S = GBot.settings;

  const COMMANDS = {
    status: 'what each server is doing',
    stop: 'pause Lanista',
    start: 'start Lanista again',
    check: 'look at the game right away',
    stats: "today's numbers",
    log: 'the last 10 log lines',
    help: 'this list',
  };
  // A game tab that has not reported for this long is not playing.
  const STALE_MS = 4 * 60 * 1000;
  // Commands older than this (sent while the browser was closed) are old news.
  const MAX_AGE_MS = 10 * 60 * 1000;

  const fmt = (n) => Number(n).toLocaleString('en-US');
  const clock = (t) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // "/stop@MyBot 303" -> { command: 'stop', server: '303' }; anything that
  // is not one word plus an optional server -> null (not a command).
  function parseCommand(text) {
    const m = String(text || '').trim().match(/^\/?([a-z]+)(?:@\S+)?(?:\s+(\S+))?$/i);
    if (!m) return null;
    const command = m[1].toLowerCase();
    if (!COMMANDS[command]) return { command: 'unknown', word: m[1] };
    return { command, server: m[2] ? m[2].toLowerCase() : null };
  }

  const helpText = () =>
    `Lanista commands (add a server number to pick one, e.g. "stop 303"):\n${Object.entries(COMMANDS)
      .map(([c, what]) => `${c}: ${what}`)
      .join('\n')}`;

  // The servers a command is for: all that listen on the channel, or the
  // one named by its number ("303") or host.
  function targetHosts(hosts, server) {
    if (!server || server === 'all') return hosts;
    return hosts.filter((h) => h === server || h.startsWith(`s${server}-`) || h.startsWith(`${server}.`));
  }

  // The Telegram bot among the phone addresses: { token, chatId }, or null.
  function telegramOf(notifications) {
    for (const url of S.pushUrls(notifications)) {
      const m = url.match(/^https:\/\/api\.telegram\.org\/bot([^/?#]+)\/sendMessage\?(?:[^#]*&)?chat_id=(-?\d+)/i);
      if (m) return { token: m[1], chatId: m[2] };
    }
    return null;
  }

  // Where commands come from, each with the servers that listen there:
  // [{ kind: 'telegram', key, token, chatId, hosts }, { kind: 'ntfy', key,
  // url, hosts }]. `all` is a snapshot of the extension's storage.
  function channels(all) {
    const out = new Map();
    const add = (key, channel, host) => {
      if (!out.has(key)) out.set(key, { key, ...channel, hosts: [] });
      out.get(key).hosts.push(host);
    };
    for (const host of S.serversIn(all)) {
      const s = S.pickSettings(all, host);
      if (!s.remote.enabled) continue;
      const tg = telegramOf(s.notifications);
      if (tg) add(`telegram:${tg.token}:${tg.chatId}`, { kind: 'telegram', ...tg }, host);
      if (s.remote.ntfyTopic) add(`ntfy:${s.remote.ntfyTopic}`, { kind: 'ntfy', url: s.remote.ntfyTopic }, host);
    }
    return Array.from(out.values());
  }

  const tabPlaying = (owner, now) => !!owner && now - Math.max(owner.at || 0, owner.nextAt || 0) < STALE_MS;

  // "Server 303 (EN): running · HP 55% · 1,234,567 gold · level 110 · Arena is
  // ready", from the snapshot the game tab saves on every look.
  function statusLine(host, settings, memory, owner, now) {
    const name = S.serverName(host);
    if (!settings.enabled) return `${name}: paused`;
    const parts = [tabPlaying(owner, now) ? 'running' : 'switched on, but no game tab is playing'];
    const snap = memory && memory.snapshot;
    if (snap) {
      if (typeof snap.hp === 'number') parts.push(`HP ${snap.hp}%`);
      if (typeof snap.gold === 'number') parts.push(`${fmt(snap.gold)} gold`);
      if (snap.level) parts.push(`level ${snap.level}`);
      if (snap.underworld) parts.push('in the Underworld');
      if (snap.doing) parts.push(snap.doing);
      if (snap.next && snap.next.at > now) parts.push(`next: ${snap.next.label} at ${clock(snap.next.at)}`);
      parts.push(`(seen ${clock(snap.at)})`);
    }
    return `${name}: ${parts.join(' · ')}`;
  }

  // Today's numbers, as in the daily summary.
  function statsLine(host, memory) {
    const brain = GBot.brain;
    const today = memory && brain ? brain.statsDays(memory)[0] : null;
    return today ? brain.daySummary(today, S.serverName(host), 'today') : `${S.serverName(host)}: nothing yet today`;
  }

  function logLines(host, memory, count = 10) {
    const lines = ((memory && memory.log) || []).filter((l) => l.level !== 'debug').slice(-count);
    if (!lines.length) return `${S.serverName(host)}: the log is empty`;
    return [`${S.serverName(host)}:`, ...lines.map((l) => `${clock(l.t)} ${l.message}`)].join('\n');
  }

  GBot.remote = { COMMANDS, STALE_MS, MAX_AGE_MS, parseCommand, helpText, targetHosts, telegramOf, channels, tabPlaying, statusLine, statsLine, logLines };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.remote;
})(typeof globalThis !== 'undefined' ? globalThis : this);
