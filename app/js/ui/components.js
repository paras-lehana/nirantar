// Guidance components shared by every page. Colour = meaning (grey normal, amber watch, red act now,
// blue = made by the AI, green = a human decision that is done). Status always pairs colour with a word and an icon.
import { html, raw, icon, esc } from './dom.js';
import { TOUR, PAGES } from '../routes.js';
import { store } from '../core/store.js';
import { dateTime, shortDT, inr, hours, HOUR } from '../core/format.js';
import { FAILURE_MODES } from '../core/generator.js';

export const STATE_TEXT = { normal: 'Normal', watch: 'Watch', act: 'Act now', sensor: 'Check sensor', ok: 'Done', ai: 'AI draft' };
const STATE_ICON = { normal: 'check', watch: 'info', act: 'alert', sensor: 'sensor', ok: 'check', ai: 'ai' };
export const toneOf = s => (s === 'sensor' ? 'watch' : s);

export function stateChip(state, text) {
  const t = toneOf(state);
  return html`<span class="state ${t}">${icon(STATE_ICON[state] || 'info')}${text || STATE_TEXT[state] || state}</span>`;
}
export const aiChip = (text = 'Done by Nirantar') => html`<span class="chip ai">${icon('ai')}${text}</span>`;
export const humanChip = (text = 'Your decision') => html`<span class="chip human">${icon('user')}${text}</span>`;
export const term = (word, tip) => html`<span class="term" tabindex="0" data-tip="${tip}">${word}</span>`;
export const why = text => html`<p class="why"><b>Why it matters:</b> ${text}</p>`;
export const confPct = c => (c >= 0.99 ? '99' : c < 0.01 ? '< 1' : String(Math.floor(c * 100))) + ' %';

export function headline(content, tone = '') { return html`<p class="headline ${tone}">${content}</p>`; }

export function doThis(items, title = 'Do this now') {
  return html`<section class="dothis" aria-label="${title}"><h3>${title}</h3><ol>${items.map((it, i) => html`<li><span class="marker">${i + 1}</span><span>${it}</span></li>`)}</ol></section>`;
}
export const marker = n => html`<span class="marker" aria-hidden="true">${n}</span>`;

export function kpi({ label, value, unit = '', mean = '', tone = '', tip = '' }) {
  return html`<div class="card kpi ${tone}"><div class="k-label">${tip ? term(label, tip) : label}</div><div class="k-value">${value}${unit ? html`<small>${unit}</small>` : ''}</div>${mean ? html`<div class="k-mean">${mean}</div>` : ''}</div>`;
}

export function stepBar(current) {
  const visited = new Set(store.prefs.visited || []);
  return html`<nav class="stepbar" aria-label="Tour steps">${TOUR.map(s => {
    const done = visited.has(s.n) && s.n !== current;
    return html`<a href="${s.route}" class="${done ? 'done' : ''}" ${s.n === current ? raw('aria-current="step"') : ''}><span class="stepnum">${done ? icon('check') : s.n}</span>${s.verb}</a>`;
  })}</nav>`;
}

// Page header: eyebrow (step n of 8), title, the page's question, the step bar and a Next button.
export function pageHead(page, extra = '') {
  const p = PAGES[page];
  const step = TOUR.find(s => s.page === page);
  const next = step ? TOUR.find(s => s.n === step.n + 1) : TOUR[0];
  return html`<header class="stack">
    <div class="row between">
      <div class="stack" style="gap:2px">
        <span class="eyebrow">${step ? `Step ${step.n} of 8 · ${step.verb}` : 'Tool'}</span>
        <h1>${p.title}</h1>
        <p class="muted" style="font-size:var(--fs-lg)">${p.q}</p>
      </div>
      <div class="row">${extra}${next ? html`<a class="btn primary" href="${next.route}">${step ? 'Next' : 'Start the tour'}: ${next.n} · ${next.title} ${icon('arrowR')}</a>` : html`<a class="btn primary" href="#/">${icon('home')} Back to Home</a>`}</div>
    </div>
    ${step ? stepBar(step.n) : ''}
  </header>`;
}

export function nextBack(page) {
  const step = TOUR.find(s => s.page === page);
  if (!step) return html`<div class="nextback"><a class="btn" href="#/">${icon('arrowL')} Home</a><a class="btn primary" href="#/map">Start the 3-minute tour ${icon('arrowR')}</a></div>`;
  const prev = TOUR.find(s => s.n === step.n - 1), next = TOUR.find(s => s.n === step.n + 1);
  return html`<div class="nextback">
    ${prev ? html`<a class="btn ghost" href="${prev.route}">${icon('arrowL')} Back to ${prev.n} · ${prev.title}</a>` : html`<a class="btn ghost" href="#/">${icon('arrowL')} Home</a>`}
    ${next ? html`<a class="btn primary lg" href="${next.route}"><span>Next: ${next.n} · ${next.title}. ${next.q}</span>${icon('arrowR')}</a>`
      : html`<a class="btn primary lg" href="#/"><span>Tour complete. Back to Home for the summary</span>${icon('home')}</a>`}
  </div>`;
}

// Shown on any page when sample data has been cleared.
export function noData(what = 'this page') {
  return html`<section class="empty" aria-live="polite">
    ${icon('data')}
    <h2>No plant data loaded</h2>
    <p>Nirantar needs sensor readings, orders and spares to fill ${what}. Load the sample plant (fictional Indus Group: 3 plants, 48 machines, 56 days of history) or pick a scenario.</p>
    <div class="row"><button class="btn primary lg" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load sample data</button><a class="btn" href="#/data">Choose a scenario</a></div>
  </section>`;
}

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
export const assetLabel = a => `${a.id} · ${a.name}`;
export function heroId() {
  const S = store.state, W = store.world;
  const hero = W.scenario.hero;
  if (hero) return hero;
  const open = (S.alerts || []).filter(a => a.status !== 'CLOSED');
  return open[0]?.assetId || W.assets[0].id;
}

// Case file: the story of the current case (hero machine), from first sign to repair.
export function caseStrip(assetId = heroId()) {
  const S = store.state, M = store.model;
  const a = M.assetById(assetId);
  if (!a) return '';
  const hasCase = store.world.scenario.hero === assetId || (S.alerts || []).some(x => x.assetId === assetId);
  if (!hasCase) return '';
  const ass = M.assess(a, store.t);
  const al = (S.alerts || []).filter(x => x.assetId === a.id).sort((x, y) => y.createdAt - x.createdAt)[0];
  const wo = al && al.woId ? S.workOrders.find(w => w.id === al.woId) : null;
  const f = S.faults.find(x => x.asset === a.id);
  const stages = [
    { label: f ? `${cap(FAILURE_MODES[f.mode]?.short || 'Change')} starts` : 'Readings drift', at: f ? f.onset : null, done: !!f },
    { label: 'Alert raised', at: al?.createdAt, done: !!al },
    { label: 'AI drafted the repair', at: wo?.createdAt, done: !!wo },
    { label: wo && wo.approvals.length ? `${wo.approvals[0].action} by ${wo.approvals[0].by}` : 'Waiting for your approval', at: wo?.approvals[0]?.at, done: !!(wo && wo.approvals.length), now: !!(wo && !wo.approvals.length) },
    { label: wo?.part && wo.part.kind !== 'local' ? `Part ${wo.partArrived ? 'arrived' : 'on the way'}` : 'Part ready', at: wo?.eta, done: !!wo?.partArrived || (wo?.part?.kind === 'local' && wo?.approvals.length > 0) },
    { label: wo?.status === 'DONE' ? 'Repaired' : wo?.window ? 'Repair planned' : 'Repaired', at: wo?.doneAt || wo?.window?.start, done: wo?.status === 'DONE' },
  ];
  return html`<section class="card casefile" aria-label="Case file">
    <div class="card-head"><h3>Case file: ${a.id} ${a.name.charAt(0).toLowerCase() + a.name.slice(1)}</h3><span class="right">${stateChip(ass.state)}</span></div>
    <ol class="case-steps">${stages.map(s => html`<li class="${s.done ? 'done' : s.now ? 'now' : ''}"><span class="dot">${s.done ? icon('check') : s.now ? icon('user') : ''}</span><span class="cs-label">${s.label}</span><span class="cs-time">${s.at ? (s.at > store.state.simNow ? 'planned ' : '') + shortDT(s.at) : s.now ? 'now' : 'later'}</span></li>`)}</ol>
  </section>`;
}

export function attentionBadge(att) {
  return html`<span class="state ${att.tone}" title="Attention score ${att.score.toFixed(2)}: ${att.why}">${icon(att.tone === 'act' ? 'alert' : att.tone === 'watch' ? 'info' : 'check')}${att.band} · ${att.score.toFixed(2)}</span>`;
}

export function legendStates() {
  return html`<div class="legend" aria-label="Colour legend"><span><span class="sw normal"></span>Grey = normal</span><span><span class="sw watch"></span>Amber = watch</span><span><span class="sw act"></span>Red = act now</span><span><span class="sw ai"></span>Blue = made by the AI</span><span><span class="sw ok"></span>Green = done by a person</span></div>`;
}

export function table({ cols, rows, caption = '', onRow = null }) {
  return html`<div class="table-wrap"><table class="table">${caption ? html`<caption class="visually-hidden">${caption}</caption>` : ''}<thead><tr>${cols.map(c => html`<th class="${c.n ? 'n' : ''}" scope="col">${c.label}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr class="${onRow ? 'clickable' : ''}" ${onRow ? raw(`data-action="${onRow}" data-id="${esc(r._id)}" tabindex="0"`) : ''}>${cols.map(c => html`<td class="${c.n ? 'n' : ''}">${typeof c.get === 'function' ? c.get(r) : r[c.key]}</td>`)}</tr>`)}</tbody></table></div>`;
}
export { inr, hours, dateTime, shortDT, HOUR };
