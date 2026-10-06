// Tiny templating: html`...` escapes every interpolation unless it is raw() or another html`` result.
// Pages render strings into a root element and use data-action attributes for events (see delegate()).
export class Raw { constructor(s) { this.__html = s; } toString() { return this.__html; } }
export const raw = s => new Raw(String(s ?? ''));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function val(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.__html;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}
const BOOL_ATTR = /\baria-[a-z]+="$/;   // aria-pressed="${false}" must say "false", not ""
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    const v = values[i];
    out += s + (i < values.length ? (typeof v === 'boolean' && BOOL_ATTR.test(s) ? String(v) : val(v)) : '');
  });
  return new Raw(out);
}

// Event delegation: <button data-action="ack" data-id="AL-1">…  →  delegate(root, { ack: (el, ev) => … })
export function delegate(root, handlers, types = ['click']) {
  const fn = ev => {
    const el = ev.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.action];
    if (h && (ev.type === 'click' || el.matches('input,select,textarea'))) h(el, ev);
  };
  types.forEach(t => root.addEventListener(t, fn));
  return () => types.forEach(t => root.removeEventListener(t, fn));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Icons: 24px stroke icons (hand-drawn paths, no icon font).
const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  map: 'M9 4l6 2 6-2v16l-6 2-6-2-6 2V6zM9 4v16M15 6v16',
  machine: 'M4 7h16v10H4zM8 17v3M16 17v3M7 10h4M7 13h2M15 12a2 2 0 1 0 0 .01',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  decide: 'M4 20h16M6 16l4-6 4 3 5-8',
  orders: 'M8 3h8v3H8zM6 5H4v16h16V5h-2M8 11h8M8 15h5',
  chat: 'M4 5h16v11H9l-5 4z',
  gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  forward: 'M4 5l8 7-8 7zM12 5l8 7-8 7z',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 15A8 8 0 1 1 9 4a7 7 0 0 0 11 11z',
  check: 'M4 12l5 5L20 6',
  x: 'M5 5l14 14M19 5L5 19',
  arrowR: 'M4 12h15M13 6l6 6-6 6',
  arrowL: 'M20 12H5M11 6l-6 6 6 6',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.01',
  ai: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  user: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1-4 4-6 8-6s7 2 8 6',
  truck: 'M2 6h11v10H2zM13 10h4l4 4v2h-8M6 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01',
  wrench: 'M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  rupee: 'M7 5h10M7 9h10M7 5c5 0 7 1 7 4s-3 4-7 4l7 6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  thumbUp: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7',
  thumbDown: 'M7 13V4H4v9zM7 13l4 7a2 2 0 0 0 3-2l-1-4h5a2 2 0 0 0 2-2l-2-7a2 2 0 0 0-2-1H7',
  sensor: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  help: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17v.01',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3v3H8z',
  compare: 'M5 20V10M10 20V4M15 20v-7M20 20v-12M3 20h18',
  pareto: 'M4 20V8h4v12M10 20v-8h4v8M16 20v-4h4v4M4 6l6 2 6 3 4 3',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 10a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  plug: 'M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4',
  award: 'M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM8.5 12L7 21l5-3 5 3-1.5-9',
  timeline: 'M3 6h18M3 12h18M3 18h18M7 4v4M14 10v4M10 16v4',
};
export function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.info}"/></svg>`);
}

// Logo: one continuous trace (निरंतर = uninterrupted) that dips like a P-F curve and recovers.
export const logo = raw(`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--ink)"/><path d="M4 12h6l2-5 3 13 3-10 2 4h8" fill="none" stroke="var(--panel)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="23.5" cy="14" r="2.2" fill="var(--act-fill)"/></svg>`);
