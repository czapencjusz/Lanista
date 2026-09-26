// Small helpers shared by the content scripts. Pure functions are exported for
// unit tests via module.exports.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const randomBetween = (min, max) => min + Math.random() * Math.max(0, max - min);

  // "1:02:03" -> 3723000, "02:03" -> 123000. Returns null when no time found.
  function parseDuration(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/);
    if (!m) return null;
    const parts = m.slice(1).filter((p) => p !== undefined).map(Number);
    const [h, mi, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    return ((h * 60 + mi) * 60 + s) * 1000;
  }

  // "1.234.567" / "1,234" / " 12 " -> number; null when there are no digits.
  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const digits = String(text).replace(/[^\d-]/g, '');
    if (!digits || digits === '-') return null;
    const n = parseInt(digits, 10);
    return Number.isNaN(n) ? null : n;
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '?';
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const win = el.ownerDocument.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  // Resolves with the result of `predicate` once it is truthy, or null on timeout.
  async function waitFor(predicate, timeoutMs = 10000, intervalMs = 200) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      let value = null;
      try {
        value = predicate();
      } catch (e) {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(intervalMs);
    }
  }

  // Error thrown by actions when the page does not look like expected. The
  // runner logs it and counts a failed attempt.
  class ActionError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ActionError';
    }
  }

  GBot.util = {
    sleep,
    randomBetween,
    parseDuration,
    parseNumber,
    formatDuration,
    isVisible,
    waitFor,
    ActionError,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GBot.util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
