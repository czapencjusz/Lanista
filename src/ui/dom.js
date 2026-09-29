// Tiny DOM helpers and the icon set used by the in-game control bar, the
// settings window, the popup and the options page. Elements are built with
// DOM APIs (no innerHTML), so nothing coming from the game or from settings
// can ever be interpreted as markup.
(function (root) {
  'use strict';
  const GBot = (root.GBot = root.GBot || {});
  const ui = (GBot.ui = GBot.ui || {});

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // h('div', { class: 'x', onclick: fn, dataset: { a: 1 } }, child, 'text', [more])
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    }
    return el;
  }

  // Icons: 24x24, drawn with strokes in currentColor. Each is a list of
  // [tag, attributes] shapes.
  const ICONS = {
    play: [['path', { d: 'M7 4.5v15l12-7.5z', fill: 'currentColor', stroke: 'none' }]],
    pause: [
      ['rect', { x: 6, y: 4.5, width: 4, height: 15, rx: 1, fill: 'currentColor', stroke: 'none' }],
      ['rect', { x: 14, y: 4.5, width: 4, height: 15, rx: 1, fill: 'currentColor', stroke: 'none' }],
    ],
    gear: [
      ['circle', { cx: 12, cy: 12, r: 3.2 }],
      ['path', { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1' }],
      ['circle', { cx: 12, cy: 12, r: 6.5 }],
    ],
    close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    minimize: [['path', { d: 'M5 12h14' }]],
    expand: [['path', { d: 'M5 9l7 7 7-7' }]],
    refresh: [['path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' }]],
    expedition: [
      ['path', { d: 'M14.5 3.5L20.5 3.5 20.5 9.5 9 21 3 15z' }],
      ['path', { d: 'M6 12l6 6M4 20l2.5-2.5' }],
    ],
    dungeon: [
      ['path', { d: 'M4 21V8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2v13z' }],
      ['path', { d: 'M9.5 21v-5a2.5 2.5 0 0 1 5 0v5' }],
    ],
    arena: [
      ['path', { d: 'M12 2.8l7.5 3v6.1c0 4.5-3.2 7.7-7.5 9.3-4.3-1.6-7.5-4.8-7.5-9.3V5.8z' }],
      ['path', { d: 'M9 9.5l6 6M15 9.5l-6 6' }],
    ],
    circus: [
      ['path', { d: 'M7 4h10v5a5 5 0 0 1-10 0z' }],
      ['path', { d: 'M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11M12 14v4M8 21h8M9.5 18h5' }],
    ],
    heal: [['path', { d: 'M12 20.5S3.5 15.3 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.1-8.5 11.3-8.5 11.3z' }], ['path', { d: 'M12 10v5M9.5 12.5h5' }]],
    work: [
      ['path', { d: 'M13.5 6.5l4 4M4 20l9.5-9.5' }],
      ['path', { d: 'M12 5l3-2.5 6.5 6.5-2.5 3z' }],
    ],
    repair: [
      ['path', { d: 'M14.5 5.5a4 4 0 0 0-5.3 5.3L3.5 16.5l4 4 5.7-5.7a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z' }],
    ],
    auction: [
      ['path', { d: 'M14 4l6 6M11.5 6.5l6 6M8 10l6 6M12.5 8l-6.5 6.5M4 20h9' }],
    ],
    smelting: [
      ['path', { d: 'M12 3c1.5 3 5 5 5 9a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.3-4.8.4 1.6 1.2 2.6 2.2 3 0-2.6.3-4.9.5-7.2z' }],
      ['path', { d: 'M5 21h14' }],
    ],
    packages: [
      ['path', { d: 'M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z' }],
      ['path', { d: 'M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5' }],
    ],
    training: [
      ['path', { d: 'M3 12h2M19 12h2M6 8v8M18 8v8M8.5 9.5v5M15.5 9.5v5M8.5 12h7' }],
    ],
    quests: [
      ['path', { d: 'M6 3.5h11a2.5 2.5 0 0 1 2.5 2.5v0H8.5M6 3.5A2.5 2.5 0 0 0 3.5 6v0H6M6 3.5v15a2.5 2.5 0 0 0 2.5 2.5H18a2 2 0 0 0 2-2V6' }],
      ['path', { d: 'M9.5 10h7M9.5 13.5h7M9.5 17h4' }],
    ],
    general: [
      ['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }],
      ['circle', { cx: 15, cy: 6, r: 2 }],
      ['circle', { cx: 9, cy: 12, r: 2 }],
      ['circle', { cx: 17, cy: 18, r: 2 }],
    ],
    schedule: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7v5l3.5 2' }]],
    safety: [['path', { d: 'M12 2.8l7.5 3v6.1c0 4.5-3.2 7.7-7.5 9.3-4.3-1.6-7.5-4.8-7.5-9.3V5.8z' }], ['path', { d: 'M8.5 12l2.5 2.5 4.5-5' }]],
    notifications: [['path', { d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0' }]],
    interface: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['path', { d: 'M3.5 9h17M9 9v10.5' }]],
    stats: [['path', { d: 'M4 20h16M7 20v-6M12 20V6M17 20v-9' }]],
    log: [['path', { d: 'M8 6h12M8 12h12M8 18h12' }], ['circle', { cx: 4.5, cy: 6, r: 1 }], ['circle', { cx: 4.5, cy: 12, r: 1 }], ['circle', { cx: 4.5, cy: 18, r: 1 }]],
    profile: [['path', { d: 'M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 16v3.5h15V16' }]],
    up: [['path', { d: 'M6 15l6-6 6 6' }]],
    down: [['path', { d: 'M6 9l6 6 6-6' }]],
    grip: [['path', { d: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', 'stroke-width': 3 }]],
  };

  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('gb-icon');
    for (const [tag, attrs] of ICONS[name] || []) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
      svg.appendChild(shape);
    }
    return svg;
  }

  // "1:02:03" / "4:05" countdown text; '' when not applicable.
  function countdown(until, now = Date.now()) {
    if (!until) return '';
    return GBot.util ? GBot.util.formatDuration(until - now) : '';
  }

  Object.assign(ui, { h, append, icon, ICONS, countdown });
})(typeof globalThis !== 'undefined' ? globalThis : this);
