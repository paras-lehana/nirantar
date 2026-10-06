// App shell: top bar (sim clock, data menu, palette, theme), rail (8 tour steps + tools), phone tab bar,
// hash router with lazy page modules, welcome dialog, command palette, toasts, keyboard shortcuts.
import { store, boot, loadScenario, clearData, advance, savePrefs, openAlerts, SCENARIOS } from './core/store.js';
import * as S from './core/store.js';
import { html, raw, icon, logo, delegate, $, esc } from './ui/dom.js';
import { TOUR, TOOLS, TOOL_GROUPS, PAGES, APP_VERSION } from './routes.js';
import { noData, stateChip, aiChip, humanChip } from './ui/components.js';
import { clock, dateTime, weekday, day, inr, ago } from './core/format.js';

const app = document.getElementById('app');
const SPEEDS = [[1, 'Real time'], [900, '15 min / s'], [3600, '1 h / s'], [21600, '6 h / s']];
let current = { page: null, params: [], cleanup: null, mod: null };

// ---------- theme ----------
function applyTheme() {
  const t = store.prefs.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function isDark() { return document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); }

// ---------- shell ----------
function shell() {
  app.innerHTML = String(html`
  <a class="skip" href="#main">Skip to content</a>
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#/" aria-label="Nirantar home">${logo}<span class="b-name">Nirantar <span class="deva" lang="hi">निरंतर</span></span></a>
      <span class="pill site-pill" id="sitePill" hidden></span>
      <span class="spacer"></span>
      <div class="simclock" id="simclock" aria-live="off"></div>
      <button class="icon-btn" data-action="palette" aria-label="Search and jump (Ctrl K)" title="Search and jump (Ctrl K)">${icon('search')}</button>
      <button class="btn sm data-btn" data-action="data-menu" aria-haspopup="dialog">${icon('data')}<span class="hide-sm">Data</span></button>
      <button class="icon-btn bell-btn" id="bellBtn" data-action="inbox" aria-label="What Nirantar did (inbox)" title="What Nirantar did">${icon('bell')}<span class="bell-count" id="bellCount" hidden></span></button>
      <button class="icon-btn" data-action="theme" aria-label="Switch light or dark theme" title="Light / dark">${icon('moon')}</button>
      <a class="icon-btn hide-sm" href="#/help" aria-label="Help and glossary" title="Help">${icon('help')}</a>
    </header>
    <nav class="rail" id="rail" aria-label="Main"></nav>
    <main class="main" id="main" tabindex="-1"></main>
  </div>
  <nav class="tabbar" id="tabbar" aria-label="Main (phone)" data-layered></nav>
  <div class="toasts" id="toasts" role="status" aria-live="polite"></div>
  <dialog id="dlg"></dialog>`);
  delegate(document.body, globalActions);
  document.body.addEventListener('change', ev => { const el = ev.target.closest('[data-action="speed"]'); if (el) setSpeed(+el.value); });
}

const NO_DATA_OK = ['data', 'help', 'home', 'built', 'roi', 'judges'];   // pages that work without sample data

function railHtml() {
  const page = current.page;
  const visited = new Set(store.prefs.visited || []);
  const nextStep = TOUR.find(s => !visited.has(s.n));
  const nOpen = store.loaded ? openAlerts().length : 0;
  const link = (p, n) => {
    const cur = p.page === page;
    const done = n && visited.has(n) && !cur;
    return html`<a href="${p.route}" ${cur ? raw('aria-current="page"') : ''}>${n ? html`<span class="stepnum ${done ? 'done' : ''}">${done ? icon('check') : n}</span>` : icon(p.icon)}${p.title}${p.page === 'triage' && nOpen ? html`<span class="count" aria-label="${nOpen} open alerts">${nOpen}</span>` : ''}${n && nextStep && nextStep.n === n && !cur ? html`<span class="tag-next">next</span>` : ''}</a>`;
  };
  const prog = visited.size;
  return html`
    ${link(PAGES.home)}
    <h2>The 3-minute tour</h2>
    ${TOUR.map(s => link(s, s.n))}
    ${TOOL_GROUPS.map(g => html`<h2>${g}</h2>${TOOLS.filter(t => t.group === g).map(t => link(t))}`)}
    <div class="rail-foot">
      <div>Tour progress: <b>${prog} of 8</b></div>
      <div class="progress"><span style="width:${prog / 8 * 100}%"></span></div>
      ${store.loaded ? html`<div>Scenario: ${store.world.scenario.name}</div>` : html`<div>No data loaded</div>`}
      <div style="margin-top:6px">All data is synthetic. Nothing leaves your browser.</div>
      <div style="margin-top:6px">Nirantar demo v${APP_VERSION}${navigator.serviceWorker && navigator.serviceWorker.controller ? ' · works offline' : ''}</div>
      ${installEvt ? html`<button class="btn sm" style="margin-top:8px" data-action="install">${icon('download')} Install as an app</button>` : ''}
    </div>`;
}

function tabbarHtml() {
  const page = current.page;
  const nOpen = store.loaded ? openAlerts().length : 0;
  const tabs = [['home', 'Home', 'home', '#/'], ['map', 'Map', 'map', '#/map'], ['triage', 'Alerts', 'alert', '#/triage'], ['orders', 'Orders', 'orders', '#/orders'], ['more', 'More', 'menu', '#/more']];
  return html`${tabs.map(([p, label, ic, href]) => html`<a href="${href}" ${p === page ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span>${p === 'triage' && nOpen ? html`<span class="badge-dot">${nOpen}</span>` : ''}</a>`)}`;
}

function clockHtml() {
  if (!store.loaded) return html`<span class="pill">No data</span>`;
  const t = store.state.simNow;
  const playing = store.prefs.playing;
  return html`<span class="live-dot ${playing ? 'on' : 'paused'}" aria-hidden="true"></span>
    <span class="sc-time num" title="Plant time (simulation clock)"><span class="sc-date">${weekday(t)} ${day(t)} </span><b>${clock(t)}</b> IST</span>
    <button class="icon-btn sm-btn" data-action="toggle-play" aria-label="${playing ? 'Pause the simulation' : 'Play the simulation'}" title="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'pause' : 'play')}</button>
    <label class="visually-hidden" for="speedSel">Simulation speed</label>
    <select id="speedSel" class="input speed" data-action="speed">${SPEEDS.map(([v, l]) => html`<option value="${v}" ${v === store.prefs.speed ? raw('selected') : ''}>${l}</option>`)}</select>`;
}

function renderChrome() {
  $('#rail').innerHTML = String(railHtml());
  $('#tabbar').innerHTML = String(tabbarHtml());
  $('#simclock').innerHTML = String(clockHtml());
  const n = unreadCount(), bc = $('#bellCount'), bb = $('#bellBtn');
  if (bc) { bc.hidden = !n; bc.textContent = n > 9 ? '9+' : String(n); }
  if (bb) bb.setAttribute('aria-label', n ? `What Nirantar did: ${n} new` : 'What Nirantar did (inbox)');
  const pill = $('#sitePill');
  if (store.loaded) { pill.hidden = false; pill.textContent = store.model.siteById(store.world.scenario.site).name; } else pill.hidden = true;
}
function updateClock() {
  const el = $('#simclock .sc-time');
  if (el && store.loaded) { const t = store.state.simNow; el.innerHTML = `<span class="sc-date">${weekday(t)} ${day(t)} </span><b>${clock(t)}</b> IST`; }
  else $('#simclock').innerHTML = String(clockHtml());
}

// ---------- router ----------
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page = '', ...params] = h.split('/').map(decodeURIComponent);
  return { page: page || 'home', params };
}

async function route() {
  const { page, params } = parse();
  const known = PAGES[page] || page === 'more';
  const pg = known ? page : 'home';
  if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  current = { page: pg, params, cleanup: null, mod: null };
  const step = TOUR.find(s => s.page === pg);
  if (step && !(store.prefs.visited || []).includes(step.n)) { store.prefs.visited = [...(store.prefs.visited || []), step.n]; savePrefs(); }
  document.title = `${pg === 'home' ? 'Nirantar' : (PAGES[pg]?.title || 'More') + ' · Nirantar'}`;
  renderChrome();
  const main = $('#main');
  if (pg === 'more') { main.innerHTML = String(moreHtml()); return focusMain(); }
  if (!store.loaded && !NO_DATA_OK.includes(pg)) { main.innerHTML = String(noData(PAGES[pg]?.title || 'this page')); return focusMain(); }
  main.innerHTML = '<div class="page"><div class="skel" style="height:28px;width:40%"></div><div class="skel" style="height:120px"></div></div>';
  try {
    const mod = (await import(`./pages/${pg}.js`)).default;
    if (parse().page !== page && !(page === '' && pg === 'home')) return;   // navigated away while loading
    current.mod = mod;
    paint();
  } catch (e) {
    console.error(e);
    main.innerHTML = String(html`<section class="empty"><h2>This page could not load</h2><p>${e.message}</p><button class="btn" data-action="reload">Reload</button></section>`);
  }
  focusMain();
}
function focusMain() { const m = $('#main'); if (m && document.activeElement === document.body) m.focus({ preventScroll: true }); window.scrollTo(0, 0); }

function paint() {
  if (!current.mod) return;
  const main = $('#main');
  if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } current.cleanup = null; }
  if (!store.loaded && !NO_DATA_OK.includes(current.page)) { main.innerHTML = String(noData(PAGES[current.page]?.title || 'this page')); return; }
  const y = window.scrollY;
  const ctx = { params: current.params, store, S, M: store.model, navigate: h => { location.hash = h; }, rerender: paint, toast: S.toast };
  try {
    current.cleanup = current.mod.render(main, ctx) || null;
  } catch (e) {
    console.error(e);
    main.innerHTML = String(html`<section class="empty"><h2>Something went wrong on this page</h2><p class="mono small">${e.message}</p><button class="btn" data-action="reload">Reload</button></section>`);
  }
  window.scrollTo(0, y);
}

function moreHtml() {
  return html`<div class="page">
    <header class="stack"><span class="eyebrow">Menu</span><h1>Everything in Nirantar</h1><p class="muted">The tour in order, then the tools.</p></header>
    <section class="card"><h2>The 3-minute tour</h2><div class="more-list">${TOUR.map(s => html`<a class="more-item" href="${s.route}"><span class="stepnum">${s.n}</span><span><b>${s.verb}: ${s.title}</b><br><span class="dim small">${s.q}</span></span></a>`)}</div></section>
    ${TOOL_GROUPS.map(g => html`<section class="card"><h2>${g}</h2><div class="more-list">${TOOLS.filter(t => t.group === g).map(t => html`<a class="more-item" href="${t.route}">${icon(t.icon)}<span><b>${t.title}</b><br><span class="dim small">${t.q}</span></span></a>`)}</div></section>`)}
  </div>`;
}

// ---------- dialogs ----------
function openDialog(content, cls = '') {
  const d = $('#dlg');
  d.className = cls;
  d.innerHTML = String(content);
  if (!d.open) d.showModal();
  return d;
}
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }

function welcome() {
  const loaded = store.loaded;
  const sc = loaded ? store.world.scenario : null;
  let caseLine = '';
  if (loaded && sc.hero) {
    const a = store.model.assetById(sc.hero), ass = store.model.assess(a, store.t), ex = store.model.exposure(a, ass.mode);
    caseLine = html`<p><b>Today's case:</b> ${a.id} (${a.name.toLowerCase()}, ${store.model.lineById(a.lineId).name}, ${store.model.siteById(a.siteId).city}) shows ${ass.modeName ? ass.modeName.toLowerCase() : 'abnormal readings'}. It will probably fail in about <b>${Math.round(ass.rulH)} hours</b>, and <b>${inr(ex.inr)}</b> of production depends on it. The AI has drafted the repair; it needs a person to approve it.</p>`;
  } else if (loaded) caseLine = html`<p><b>Today:</b> ${sc.blurb}</p>`;
  openDialog(html`<div class="d-body">
    <div class="d-head">${logo}<h2>Welcome to Nirantar</h2><button class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <p><b>The problem:</b> one unplanned machine stop can hold up lakhs of rupees of customer orders, and maintenance teams usually find out too late.</p>
    ${caseLine}
    <p><b>How to follow:</b> 8 short steps, about 3 minutes. Every page answers one question in its first sentence and tells you what to press. Grey means normal; colour means act.</p>
    <p class="dim small">This is a public, interactive copy of the Nirantar app we built inside Snowflake, running on synthetic sample data in your browser. You can approve repairs, ask the copilot, inject faults and change scenarios; nothing is sent anywhere.</p>
  </div>
  <div class="d-foot">
    ${loaded ? '' : html`<button class="btn" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load sample data</button>`}
    <button class="btn ghost" data-action="close-dialog">I'll explore on my own</button>
    <button class="btn primary lg" data-action="start-tour">${icon('play')} Start the 3-minute tour</button>
  </div>`);
  store.prefs.welcomed = true; savePrefs();
}

function dataMenu() {
  const curId = store.loaded ? store.state.scenarioId : null;
  openDialog(html`<div class="d-body">
    <div class="d-head">${icon('data')}<h2>Sample data</h2><button class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <p class="muted">Pick a scenario. Each one rebuilds the plant from a fixed seed, so the numbers are the same every time.</p>
    <div class="scenario-list">${SCENARIOS.map(sc => html`<button class="scenario ${sc.id === curId ? 'current' : ''}" data-action="load-sample" data-scenario="${sc.id}">
      <span class="sc-name">${sc.name}${sc.id === curId ? html` <span class="state ok">${icon('check')}Loaded</span>` : ''}</span><span class="sc-blurb">${sc.blurb}</span></button>`)}</div>
  </div>
  <div class="d-foot">
    ${store.loaded ? html`<button class="btn" data-action="clear-data">${icon('x')} Clear data</button>` : ''}
    <a class="btn ghost" href="#/data" data-action="close-dialog">Exports and details</a>
  </div>`);
}

// ---------- inbox: what the AI and the system did, newest first ----------
const INBOX_KINDS = ['ai', 'system', 'blocked'];
function inboxRows() { return store.loaded ? store.state.audit.filter(r => INBOX_KINDS.includes(r.kind)) : []; }
function unreadCount() {
  if (!store.loaded) return 0;
  const seen = store.prefs.inboxSeen && store.prefs.inboxSeen.anchor === store.state.anchor ? store.prefs.inboxSeen.ts : -Infinity;
  return inboxRows().filter(r => r.ts > seen && r.ts <= store.state.simNow).length;
}
function inboxLink(target) {
  if (!store.loaded || !target) return null;
  if (store.world.assets.some(a => a.id === target)) return `#/machine/${target}`;
  if (/^WO-/.test(target)) return /^WO-PM-/.test(target) ? '#/schedule' : `#/orders/${target}`;
  if (target === 'Copilot') return '#/trust';
  if (/^SP-/.test(target)) return '#/spares';
  return null;
}
function inbox() {
  const rows = inboxRows().filter(r => r.ts <= (store.loaded ? store.state.simNow : 0)).slice(0, 25);
  const seen = store.loaded && store.prefs.inboxSeen && store.prefs.inboxSeen.anchor === store.state.anchor ? store.prefs.inboxSeen.ts : -Infinity;
  openDialog(html`<div class="d-body">
    <div class="d-head">${icon('bell')}<h2>What Nirantar did</h2><button class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x')}</button></div>
    <p class="muted">Everything the AI and the system did on their own, newest first. People's decisions are on 8 · Trust Audit.</p>
    ${rows.length ? html`<ol class="inbox">${rows.map(r => { const href = inboxLink(r.target); return html`<li class="${r.ts > seen ? 'new' : ''}">
      <span class="ib-who">${r.kind === 'ai' || r.kind === 'blocked' ? aiChip(r.kind === 'blocked' ? 'Guardrail' : 'Nirantar AI') : html`<span class="chip sys">${icon('layers')}${r.actor}</span>`}${r.ts > seen ? html`<span class="ib-new">new</span>` : ''}<span class="ib-time small dim">${store.state.simNow - r.ts < 60e3 ? 'just now' : ago(r.ts, store.state.simNow)}</span></span>
      <span class="ib-what"><b>${r.action}</b>${r.target ? html` · ${href ? html`<a href="${href}" data-action="close-dialog">${r.target}</a>` : r.target}` : ''}</span>
      ${r.detail ? html`<span class="small muted">${r.detail}</span>` : ''}</li>`; })}</ol>`
      : html`<p class="dim">${store.loaded ? 'Nothing yet. Nirantar scores every machine every 15 minutes and writes here when it raises an alert, drafts a repair or refuses a request.' : 'No data is loaded. Press Load sample data in the Data menu.'}</p>`}
  </div>
  <div class="d-foot"><a class="btn ghost" href="#/trust" data-action="close-dialog">Full audit trail</a></div>`, 'inbox-dlg');
  if (store.loaded) { store.prefs.inboxSeen = { anchor: store.state.anchor, ts: store.state.simNow }; savePrefs(); renderChrome(); }
}

// ---------- palette ----------
function paletteItems() {
  const items = [];
  for (const s of TOUR) items.push({ label: `${s.n} · ${s.title}`, sub: s.q, kind: 'Tour', href: s.route });
  for (const t of TOOLS) items.push({ label: t.title, sub: t.q, kind: 'Tool', href: t.route });
  if (store.loaded) for (const a of store.world.assets) {
    const ass = store.model.assess(a, store.t);
    items.push({ label: `${a.id} · ${a.name}`, sub: `${store.model.lineById(a.lineId).name}, ${store.model.siteById(a.siteId).city} · health ${ass.health}`, kind: 'Machine', href: `#/machine/${a.id}`, state: ass.state });
  }
  for (const sc of SCENARIOS) items.push({ label: `Load scenario: ${sc.name}`, sub: sc.blurb, kind: 'Data', action: () => loadScenario(sc.id) });
  items.push({ label: 'Jump 1 hour ahead', kind: 'Time', action: () => advance(3600e3) }, { label: 'Jump 6 hours ahead', kind: 'Time', action: () => advance(6 * 3600e3) }, { label: 'Jump 1 day ahead', kind: 'Time', action: () => advance(24 * 3600e3) });
  items.push({ label: 'Switch light / dark theme', kind: 'View', action: toggleTheme }, { label: 'Replay the welcome', kind: 'Help', action: welcome });
  return items;
}
function openPalette() {
  const d = openDialog(html`<input class="input p-input" id="pq" placeholder="Search machines, pages, scenarios…" aria-label="Search" autocomplete="off"><ul id="pl" role="listbox"></ul><div class="d-foot small dim" style="justify-content:space-between"><span><span class="kbd">↑</span> <span class="kbd">↓</span> move · <span class="kbd">Enter</span> open · <span class="kbd">Esc</span> close</span><span>Shortcuts: <span class="kbd">g</span> then <span class="kbd">m</span> map, <span class="kbd">t</span> triage, <span class="kbd">o</span> orders</span></div>`, 'palette');
  const all = paletteItems();
  let sel = 0, shown = all;
  const q = $('#pq', d), list = $('#pl', d);
  const draw = () => {
    list.innerHTML = String(html`${shown.slice(0, 40).map((it, i) => html`<li><button role="option" aria-selected="${i === sel}" data-i="${i}">${it.state ? stateChip(it.state) : ''}<span><b>${it.label}</b>${it.sub ? html`<br><span class="dim small">${it.sub}</span>` : ''}</span><span class="kind">${it.kind}</span></button></li>`)}`);
  };
  const go = it => { closeDialog(); if (it.href) location.hash = it.href; else it.action(); };
  q.addEventListener('input', () => { const s = q.value.toLowerCase().trim(); shown = s ? all.filter(it => (it.label + ' ' + (it.sub || '') + ' ' + it.kind).toLowerCase().includes(s)) : all; sel = 0; draw(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && shown[sel]) go(shown[sel]);
  });
  list.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) go(shown[+b.dataset.i]); });
  draw(); q.focus();
}

// ---------- actions ----------
function toggleTheme() { store.prefs.theme = isDark() ? 'light' : 'dark'; savePrefs(); applyTheme(); paint(); }
function setSpeed(v) { store.prefs.speed = v; savePrefs(); renderChrome(); }
const globalActions = {
  'load-sample': el => { closeDialog(); loadScenario(el.dataset.scenario || 'pune-bearing'); if (current.page === 'data' || !store.prefs.tourStarted) {} },
  'clear-data': () => { closeDialog(); clearData(); S.toast({ kind: 'watch', title: 'Data cleared', body: 'Every page now shows what it looks like with no data. Press "Load sample data" to bring the plant back.' }); },
  'data-menu': () => dataMenu(),
  'inbox': () => inbox(),
  'palette': () => openPalette(),
  'theme': () => toggleTheme(),
  'toggle-play': () => { store.prefs.playing = !store.prefs.playing; savePrefs(); renderChrome(); },
  'close-dialog': () => closeDialog(),
  'start-tour': () => { closeDialog(); store.prefs.tourStarted = true; savePrefs(); location.hash = '#/map'; },
  'welcome': () => welcome(),
  'reload': () => location.reload(),
  'install': () => { if (!installEvt) return; installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; renderChrome(); }); },
  'jump': el => advance(+el.dataset.ms),
};

// ---------- toasts ----------
function showToast(t) {
  const box = $('#toasts');
  if (!box) return;
  const key = t.title + t.body;
  if ([...box.children].some(c => c.dataset.key === key)) return;
  const el = document.createElement('div');
  el.className = `toast ${t.kind || ''}`;
  el.dataset.key = key;
  el.innerHTML = String(html`<div class="t-body"><b>${t.title}</b>${t.body ? html`<span>${t.body}</span>` : ''}${t.href ? html`<a href="${t.href}">Open ${icon('arrowR')}</a>` : ''}</div><button aria-label="Dismiss">${icon('x')}</button>`);
  el.querySelector('button').onclick = () => el.remove();
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), t.kind === 'act' ? 9000 : 5500);
}

// ---------- keyboard ----------
let gPending = false;
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.target.matches('input, textarea, select') || $('#dlg').open) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'g') { gPending = true; setTimeout(() => (gPending = false), 900); return; }
  if (gPending) {
    const map = { h: '#/', m: '#/map', d: '#/machine', t: '#/triage', w: '#/whatif', o: '#/orders', c: '#/copilot', e: '#/oee', a: '#/trust', s: '#/spares', p: '#/presenter' };
    if (map[e.key]) { location.hash = map[e.key]; gPending = false; }
  }
  if (e.key === ' ' && e.shiftKey) { e.preventDefault(); globalActions['toggle-play'](); }
}

// ---------- clock ----------
let lastTick = performance.now();
function loop() {
  const now = performance.now();
  const dt = now - lastTick; lastTick = now;
  if (store.loaded && store.prefs.playing && !document.hidden) advance(Math.min(dt, 2000) * (store.prefs.speed || 1));
}

// ---------- offline + install (PWA) ----------
let installEvt = null;   // Chrome/Edge/Android offer installation through this event
function pwa() {
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEvt = ev; renderChrome(); });
  window.addEventListener('appinstalled', () => { installEvt = null; renderChrome(); S.toast({ kind: 'ok', title: 'Installed', body: 'Nirantar now opens like an app and works offline.' }); });
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local) && !navigator.webdriver)
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('offline cache not available', e)));
}

// ---------- start ----------
function start() {
  pwa();
  applyTheme();
  boot();
  shell();
  store.on((kind, detail) => {
    if (kind === 'toast') return showToast(detail);
    if (kind === 'clock') return updateClock();
    const what = kind === 'change' ? detail : kind;      // changed(what) emits ('change', what)
    renderChrome();
    if (what === 'load' || what === 'clear') return route();
    if (!current.mod || current.mod.autoRerender === false) { if (current.mod && current.mod.onStore) current.mod.onStore(what, detail); return; }
    // re-render on actions and on each 15-min model step; keep typing and dragging undisturbed
    const a = document.activeElement;
    if (what === 'tick' && a && a.matches && a.matches('input[type=text], input[type=search], input[type=range], textarea') && $('#main').contains(a)) return;
    paint();
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', onKey);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => paint());
  setInterval(loop, 1000);
  // wait (briefly) for the web fonts so the first paint does not shift when they swap in
  Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 800))])
    .then(route).then(() => { if (!store.prefs.welcomed) welcome(); });
}
start();
