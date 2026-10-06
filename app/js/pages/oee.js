// Step 7 · Measure: what does this mean for plant output?
// OEE = Availability × Performance × Quality per line, the daily trend against the 85\u00a0% world-class mark, where the
// planned hours went (the six big losses, planned maintenance shown apart), shifts, MTBF / MTTR from the CMMS history
// and what repairing the current case in a planned window is worth in hours, OEE points and rupees.
import { html, raw, esc, delegate } from '../ui/dom.js';
import { lineChart, barsH, heatmap, ring } from '../ui/charts.js';
import { pageHead, caseStrip, headline, doThis, marker, kpi, term, aiChip, humanChip, nextBack, table } from '../ui/components.js';
import { inr, num, hours, day, DAY } from '../core/format.js';
import { FAILURE_MODES } from '../core/generator.js';

let ui = { site: null, days: 30, line: null };

// Common world-class benchmarks (Nakajima): OEE 85 % = 90 % × 95 % × 99.9 %.
const WC = { oee: 0.85, availability: 0.9, performance: 0.95, quality: 0.999 };
const FACTORS = [
  { key: 'availability', label: 'Availability', q: 'was it running?', tip: 'Run time ÷ planned production time. Lost to breakdowns and to setup and changeovers. World class is 90\u00a0%.' },
  { key: 'performance', label: 'Performance', q: 'was it fast enough?', tip: '(Ideal cycle time × parts made) ÷ run time. Lost to small stops and running below the ideal speed. World class is 95\u00a0%.' },
  { key: 'quality', label: 'Quality', q: 'were the parts good?', tip: 'Good parts ÷ all parts made. Lost to scrap and rework at start-up and during production. World class is 99.9\u00a0%.' },
];
const LOSSES = [
  { key: 'breakdown', label: 'Breakdowns' },
  { key: 'setup', label: 'Setup and changeovers' },
  { key: 'smallStops', label: 'Small stops' },
  { key: 'speed', label: 'Reduced speed' },
  { key: 'startupRejects', label: 'Start-up rejects' },
  { key: 'prodRejects', label: 'Production rejects' },
];
const PLANNED_WINDOW_H = 4;          // a planned repair takes a 4 h low-impact window (same rule as the savings in store.complete)
const STYLE = [{ tone: 'ink', css: 'var(--ink)' }, { tone: 'ai', css: 'var(--ai-fill)' }, { tone: 'normal', css: 'var(--normal)', dash: '6 4' }];
const SHIFT_TIME = { A: '06:00–14:00', B: '14:00–22:00', C: '22:00–06:00' };
const SHIFT_NAME = { A: 'morning', B: 'afternoon', C: 'night' };

const p1 = v => (v * 100).toFixed(1) + '\u00a0%';
const p0 = v => Math.round(v * 100) + '\u00a0%';
const lineWord = l => `${l.short} line`;     // "Cylinder Head line", never "Cylinder Head Line line"
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
const lc = s => s.replace(/^([A-Z])(?![A-Z])/, c => c.toLowerCase());   // "Kiln ID fan" → "kiln ID fan", "CNC lathe" stays

export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, t = store.t;
    if (params[0] && W.sites.find(s => s.id === params[0])) ui.site = params[0];
    if (!ui.site || !W.sites.find(s => s.id === ui.site)) ui.site = W.scenario.site;
    const site = M.siteById(ui.site);
    const days = ui.days;
    const plant = M.siteOee(ui.site, days, t);
    const lines = W.lines.filter(l => l.siteId === ui.site && !l.utility).map(l => ({ l, o: M.lineOee(l.id, days, t) })).filter(x => x.o);
    if (!plant || !lines.length) {
      root.innerHTML = String(html`<div class="page oee">${pageHead('oee')}<section class="empty"><h2>No OEE records for ${site.name}</h2><p>OEE needs production counts per line. Load the sample plant from the Data menu to fill this page.</p></section>${nextBack('oee')}</div>`);
      return delegate(root, {});
    }

    // case machine: the scenario hero, else the first open failure alert
    const openFail = S.openAlerts().filter(al => al.type === 'FAILURE');
    const caseId = W.scenario.hero || openFail[0]?.assetId || null;
    const caseA = caseId ? M.assetById(caseId) : null;
    const caseLine = caseA ? M.lineById(caseA.lineId) : null;

    const weakest = lines.reduce((m, x) => (x.o.oee < m.o.oee ? x : m));
    if (!ui.line || !lines.find(x => x.l.id === ui.line)) {
      const heroLine = caseA && caseA.siteId === ui.site && lines.find(x => x.l.id === caseA.lineId);
      ui.line = (heroLine || weakest).l.id;
    }
    const sel = lines.find(x => x.l.id === ui.line);

    const lossRows = LOSSES.map(L => ({ ...L, h: plant.losses[L.key] || 0 })).sort((a, b) => b.h - a.h);
    const biggest = lossRows[0];
    const plannedProdH = sum(lines, x => x.l.plannedHoursMonth / 30 * x.o.rows.length);

    // ---------- headline ----------
    const below = plant.oee < WC.oee;
    const change = changeModel(store, S, M, openFail, caseId);
    const saved = sessionSavings(store, M);
    let heroSentence = '';
    if (caseA && caseA.siteId === ui.site) {
      if (caseLine.utility) heroSentence = html` <b>${caseA.id}</b> (${lc(caseA.name)}) is a utility machine that serves all ${lines.length} lines here.`;
      else {
        const hl = lines.find(x => x.l.id === caseLine.id);
        heroSentence = hl === weakest && lines.length > 1
          ? html` <b>${caseA.id}</b> runs on the ${lineWord(caseLine)}, the weakest line at <b>${p1(hl.o.oee)}</b>.`
          : html` <b>${caseA.id}</b> runs on the ${lineWord(caseLine)} (${p1(hl.o.oee)} OEE).`;
      }
    }
    const weakSentence = lines.length > 1 && !(caseA && caseA.siteId === ui.site && caseLine.id === weakest.l.id)
      ? html` The weakest line is <b>${weakest.l.short} at ${p1(weakest.o.oee)}</b>.` : '';
    const head = headline(html`<b>${site.city} plant ${term('OEE', 'Overall Equipment Effectiveness: the share of planned production time that made good parts at full speed. OEE = Availability × Performance × Quality.')} is ${p1(plant.oee)}</b>, ${below ? 'below' : 'above'} the 85\u00a0% world-class mark.${heroSentence}${weakSentence} The biggest loss in the last ${days} days was <b>${biggest.label.toLowerCase()} at ${Math.round(biggest.h)} hours</b>.${saved ? html` Your planned repair${saved.n > 1 ? 's' : ''} of ${saved.ids.join(', ')} saved <b>${hours(saved.h)}</b> and <b>${inr(saved.inr)}</b> this session.` : ''}`, below ? 'watch' : 'ok');

    // ---------- sizes: draw charts at their real pixel width so chart text stays 11 px on a phone ----------
    const cs = getComputedStyle(root);
    const inner = Math.max(300, root.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
    const cardW = Math.floor(inner - 30);
    const halfW = window.innerWidth >= 720 ? Math.floor((inner - 16) / 2 - 30) : cardW;
    const narrow = cardW < 560;

    const rel = reliability(W, M, ui.site, t);

    root.innerHTML = String(html`<div class="page oee">
      ${pageHead('oee')}
      ${caseId ? caseStrip(caseId) : ''}
      <div class="oee-controls" role="group" aria-label="What to show">
        <div class="ctl"><span class="ctl-label">Plant</span><div class="seg" role="group" aria-label="Plant">${W.sites.map(s => html`<button data-action="site" data-id="${s.id}" aria-pressed="${s.id === ui.site}">${s.city}</button>`)}</div></div>
        <div class="ctl"><span class="ctl-label">Period</span><div class="seg" role="group" aria-label="Period">${[7, 30].map(d => html`<button data-action="days" data-id="${d}" aria-pressed="${d === days}">Last ${d} days</button>`)}</div></div>
      </div>
      ${head}
      ${doThis([
        html`Read the OEE equation ${marker(1)}. Pick a line: the amber factor is the one furthest from world class.`,
        html`See where the hours went ${marker(2)}. The red bar is the biggest loss; grey planned maintenance is not a loss.`,
        change ? html`See what Nirantar changes ${marker(3)}: the hours, OEE points and rupees saved by repairing ${change.a.id} in a planned window.`
          : saved ? html`See what Nirantar changed ${marker(3)}: the hours, OEE points and rupees your planned repair saved.`
          : html`See what Nirantar changes ${marker(3)}: the hours and rupees saved by repairs done in planned windows.`,
      ])}

      ${equationCard(sel, lines, days)}

      <section class="card" aria-label="OEE trend">
        <div class="card-head"><h2>OEE by day, last ${days} days</h2><span class="sub">one line per production line; dashed = 85\u00a0% world class</span></div>
        <div class="oee-legend" aria-hidden="true">${lines.map((x, i) => html`<span class="${x.l.id === ui.line ? 'on' : ''}"><svg viewBox="0 0 22 6" width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="${STYLE[i % 3].css}" stroke-width="${x.l.id === ui.line ? 3 : 2}" ${raw(STYLE[i % 3].dash ? `stroke-dasharray="${STYLE[i % 3].dash}"` : '')}/></svg>${x.l.short}</span>`)}</div>
        ${trendChart(lines, days, cardW, narrow)}
        <p class="chart-caption">${lowCaption(lines)}</p>
      </section>

      <div class="cols-2">
        <section class="card" aria-label="Where the hours went">
          <div class="card-head">${marker(2)}<h2>Where the hours went</h2><span class="sub">${site.city}, last ${days} days</span></div>
          ${barsH({ title: `Lost hours by cause at ${site.city}, last ${days} days`, w: halfW, labelW: halfW < 400 ? 138 : 200, items: [
            ...lossRows.map((L, i) => ({ label: L.label, value: L.h, tone: i === 0 ? 'act' : 'watch', strong: i === 0 })),
            { label: halfW < 400 ? 'Planned (not a loss)' : 'Planned maintenance (not a loss)', value: plant.losses.planned || 0, tone: 'normal' },
          ], fmt: v => Math.round(v) + ' h' })}
          <p class="chart-caption"><b>${biggest.label}</b> cost ${Math.round(biggest.h)} h of ${num(plannedProdH, 0)} planned production hours (${p1(biggest.h / plannedProdH)}). Red = the biggest of the ${term('six big losses', 'The standard OEE loss categories: breakdowns and setup cut availability; small stops and reduced speed cut performance; start-up and production rejects cut quality.')}, amber = the other five. Grey planned maintenance is scheduled work, so it is not counted as a loss.</p>
        </section>
        ${shiftCard(lines, plant, halfW)}
      </div>

      <section aria-label="Maintenance reliability">
        <h2 class="sec-title">Maintenance reliability at ${site.city}</h2>
        <div class="cols-4">
          ${kpi({ label: 'MTBF', value: rel.mtbf ? hours(rel.mtbf) : 'None', mean: rel.mtbf ? `between breakdowns, on the ${rel.machines} machine${rel.machines === 1 ? '' : 's'} that broke down` : `no breakdown repairs in ${rel.windowDays} days`, tip: `Mean time between failures: ${rel.windowDays} days × 24 h ÷ breakdown repairs on each machine, averaged over the machines that had one. Higher is better.` })}
          ${kpi({ label: 'MTTR', value: rel.mttr ? hours(rel.mttr) : '–', mean: rel.mttr ? 'average time to repair a breakdown' : 'nothing to average yet', tip: 'Mean time to repair: the average duration of the breakdown (corrective) work orders in the maintenance history. Lower is better.' })}
          ${kpi({ label: 'Breakdown repairs', value: rel.cm, mean: `in the last ${rel.windowDays} days, from the maintenance history`, tip: 'Corrective work orders (unplanned repairs after a failure) recorded in the CMMS for this plant.' })}
          ${kpi({ label: 'Planned work share', value: rel.total ? p0(rel.pm / rel.total) : '–', tone: rel.total && rel.pm / rel.total < 0.8 ? 'watch' : '', mean: `${rel.pm} planned of ${rel.total} work orders (good plants plan 80\u00a0%+)`, tip: 'Planned (preventive and predictive) work orders ÷ all work orders. A high share means fewer surprises.' })}
        </div>
      </section>

      ${changeCard(change, store, M)}

      <section class="card" aria-label="Line comparison">
        <div class="card-head"><h2>Line comparison</h2><span class="sub">${site.city}, last ${days} days · tap a row to open its equation</span></div>
        ${table({ caption: 'OEE by line', onRow: 'line', cols: [
          { label: 'Line', get: r => html`<b class="nowrap">${r.l.short}</b>${r.l.id === ui.line ? html`<br><span class="xs dim nowrap">in the equation</span>` : ''}` },
          { label: 'Availability', n: 1, get: r => p1(r.o.availability) },
          { label: 'Performance', n: 1, get: r => p1(r.o.performance) },
          { label: 'Quality', n: 1, get: r => p1(r.o.quality) },
          { label: 'OEE', n: 1, get: r => html`<b>${p1(r.o.oee)}</b>` },
          { label: 'Breakdown hours', n: 1, get: r => Math.round(r.o.losses.breakdown) + ' h' },
          { label: 'vs 85\u00a0%', n: 1, get: r => html`<span class="${r.o.oee < WC.oee ? 'gap' : 'gap ok'}">${r.o.oee < WC.oee ? '−' : '+'}${num(Math.abs(r.o.oee - WC.oee) * 100, 1)} pts</span>` },
        ], rows: lines.map(x => ({ ...x, _id: x.l.id })) })}
        <p class="chart-caption">pts = percentage points of OEE. ${lines.length > 1 ? html`Closing the gap on the ${lineWord(weakest.l)} alone is worth ${num((WC.oee - weakest.o.oee) * weakest.l.plannedHoursMonth, 0)} productive hours a month.` : ''}</p>
      </section>

      ${nextBack('oee')}
    </div>`);

    // re-draw charts at the new width when the window is resized (the clock only re-renders every 15 model minutes)
    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { if (Math.abs(root.clientWidth - lastW) > 30) ctx.rerender(); }, 200); };
    lastW = root.clientWidth;
    window.addEventListener('resize', onResize);
    const off = delegate(root, {
      site: el => { ui.site = el.dataset.id; ui.line = null; ctx.rerender(); },
      days: el => { ui.days = +el.dataset.id; ctx.rerender(); },
      line: el => { ui.line = el.dataset.id; ctx.rerender(); if (el.tagName === 'TR') document.getElementById('oee-eq')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    });
    return () => { off(); window.removeEventListener('resize', onResize); clearTimeout(timer); };
  },
};
let lastW = 0;

// ---------- 1 · the equation ----------
function equationCard(sel, lines, days) {
  const o = sel.o;
  // the factor furthest from its world-class value pulls OEE down the most
  const gaps = FACTORS.map(f => ({ ...f, v: o[f.key], ratio: o[f.key] / WC[f.key] }));
  const worst = gaps.reduce((m, g) => (g.ratio < m.ratio ? g : m));
  return html`<section class="card" id="oee-eq" aria-label="OEE equation">
    <div class="card-head">${marker(1)}<h2>OEE equation: ${sel.l.name}</h2><span class="sub">average of the last ${days} days</span>
      ${lines.length > 1 ? html`<div class="right"><div class="seg" role="group" aria-label="Line">${lines.map(x => html`<button data-action="line" data-id="${x.l.id}" aria-pressed="${x.l.id === sel.l.id}">${x.l.short}</button>`)}</div></div>` : ''}</div>
    <div class="oee-eq">
      <div class="eq-total">
        ${ring({ value: o.oee * 100, tone: 'ink', label: `OEE ${p1(o.oee)}`, size: 84 })}
        <div><div class="eq-name">${term('OEE', 'Overall Equipment Effectiveness = Availability × Performance × Quality. 85\u00a0% is the common world-class mark.')}</div><div class="eq-v">${p1(o.oee)}</div><div class="eq-q">${o.oee < WC.oee ? `${num((WC.oee - o.oee) * 100, 1)} points below 85\u00a0%` : 'at or above world class'}</div></div>
      </div>
      ${gaps.map((g, i) => html`<div class="eq-term ${g === worst ? 'worst' : ''}">
        <span class="eq-op" aria-hidden="true">${i === 0 ? '=' : '×'}</span>
        <div class="eq-body">
          <div class="eq-name">${term(g.label, g.tip)}${g === worst ? html` <span class="state watch">biggest gap</span>` : ''}</div>
          <div class="eq-v">${p0(g.v)}</div>
          <div class="eq-q">${g.q}</div>
          <div class="eq-bar ${g === worst ? 'watch' : ''}" role="img" aria-label="${g.label} ${p0(g.v)} against world class ${p1(WC[g.key]).replace('.0\u00a0', '\u00a0')}"><span style="width:${(g.v * 100).toFixed(1)}%"></span><i style="left:${(WC[g.key] * 100).toFixed(1)}%"></i></div>
          <div class="eq-wc">world class ${WC[g.key] === 0.999 ? '99.9\u00a0%' : p0(WC[g.key])}</div>
        </div>
      </div>`)}
    </div>
    <p class="chart-caption">In words: the ${lineWord(sel.l)} made good parts at full speed for <b>${p1(o.oee)}</b> of its planned time. <b>${worst.label}</b> is furthest from world class (${p0(worst.v)} vs ${WC[worst.key] === 0.999 ? '99.9\u00a0%' : p0(WC[worst.key])})${worst.key === 'availability' ? ': the time goes to breakdowns and changeovers, which is what predictive maintenance attacks' : worst.key === 'performance' ? ': small stops and slow running' : ': scrap and rework'}.</p>
  </section>`;
}

// ---------- 2 · daily trend with the lowest day of each line labelled ----------
export function trendChart(lines, days, w, narrow) {
  const h = narrow ? 236 : 280, L = narrow ? 40 : 46, R = 10, T = 14, B = 26;
  const series = lines.map((x, i) => ({ name: x.l.short, points: x.o.rows.map(r => [r.date, r.oee * 100]), tone: STYLE[i % 3].tone, dash: STYLE[i % 3].dash, width: x.l.id === ui.line ? 2.6 : 1.5 }));
  const xs = series.flatMap(s => s.points.map(p => p[0])), ys = series.flatMap(s => s.points.map(p => p[1]));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.max(0, Math.floor((Math.min(...ys) - 11) / 5) * 5);     // leave room under the lowest day for its label
  const yMax = Math.max(92, Math.ceil((Math.max(...ys) + 5) / 5) * 5);
  const X = x => L + (x - xMin) / ((xMax - xMin) || 1) * (w - L - R);
  const Y = y => T + (1 - (y - yMin) / (yMax - yMin)) * (h - T - B);
  const svg = String(lineChart({ title: `OEE by day for each line over the last ${days} days, with the 85\u00a0% world-class mark`, w, h, padL: L, padR: R, series, xType: 'time', xMin, xMax, yMin, yMax,
    yFmt: v => v + ' %', limits: [{ y: WC.oee * 100, label: '', tone: 'ink2' }], xTicks: narrow ? 3 : days <= 7 ? days - 1 : 5 }));

  const polys = series.map(s => s.points.map(p => [X(p[0]), Y(p[1])]));
  const wcText = 'World class 85\u00a0%';
  const wcBox = { x0: w - R - 2 - textW(wcText), x1: w - R - 2, y0: Y(85) - 18, y1: Y(85) - 4 };
  const lows = lines.map((x, i) => {
    const r = x.o.rows.reduce((m, q) => (q.oee < m.oee ? q : m));
    return { x: X(r.date), y: Y(r.oee * 100), text: `${x.l.short} ${p0(r.oee)}`, color: STYLE[i % 3].css, date: r.date, v: r.oee };
  });
  const boxes = placeLabels(lows, { x0: L + 2, x1: w - 2, y0: T, y1: h - B - 2 }, polys, [wcBox]);
  let g = `<text x="${wcBox.x1}" y="${wcBox.y1 - 3}" text-anchor="end" class="lbl-strong halo">${esc(wcText)}</text>`;
  lows.forEach((p, i) => {
    const b = boxes[i];
    g += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${p.color}" stroke="var(--panel)" stroke-width="2"><title>${esc(p.text)} on ${esc(day(p.date))}</title></circle>`;
    g += `<text x="${b.x0.toFixed(1)}" y="${(b.y0 + 10).toFixed(1)}" class="lbl-strong halo">${esc(p.text)}</text>`;
  });
  return raw(svg.replace('</svg>', g + '</svg>'));
}

function lowCaption(lines) {
  const lows = lines.map(x => { const r = x.o.rows.reduce((m, q) => (q.oee < m.oee ? q : m)); return `${x.l.short} ${p0(r.oee)} on ${day(r.date)}`; });
  return html`Dots mark each line's lowest day: ${lows.join(', ')}. A sudden dip is usually a breakdown; the thicker line is the one in the equation above.`;
}

const textW = s => s.length * 6.5 + 2;
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
// how many sampled points of the chart lines fall inside a label box (labels should sit on empty paper)
function crossings(r, polys) {
  let n = 0;
  for (const pts of polys) for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    if (Math.max(x1, x2) < r.x0 || Math.min(x1, x2) > r.x1) continue;
    const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3));
    for (let k = 0; k <= steps; k++) { const x = x1 + (x2 - x1) * k / steps, y = y1 + (y2 - y1) * k / steps; if (x >= r.x0 && x <= r.x1 && y >= r.y0 - 1 && y <= r.y1 + 1) n++; }
  }
  return n;
}
// Label placement: every dot gets candidate spots (below, above, two rows each, several alignments, left, right).
// A spot costs more when it leaves the plot, hits another label or dot, or sits on a chart line. Every order of the
// (few) labels is tried greedily and the cheapest total layout wins, so labels never overlap while there is room.
export function placeLabels(items, box, polys, fixed = []) {
  const H = 13, FX = [0.5, 0.3, 0.7, 0.12, 0.88, 0, 1];
  const cands = it => {
    const tw = textW(it.text), out = [];
    [[it.y + 8, 0], [it.y - 8 - H, 1], [it.y + 21, 3], [it.y - 21 - H, 4]].forEach(([y, rp]) =>
      FX.forEach((f, fi) => out.push({ r: { x0: it.x - f * tw, x1: it.x - f * tw + tw, y0: y, y1: y + H }, pen: rp + fi * 0.3 })));
    out.push({ r: { x0: it.x + 9, x1: it.x + 9 + tw, y0: it.y - H / 2, y1: it.y + H / 2 }, pen: 1.5 });
    out.push({ r: { x0: it.x - 9 - tw, x1: it.x - 9, y0: it.y - H / 2, y1: it.y + H / 2 }, pen: 1.5 });
    return out;
  };
  const cost = (r, it, placed) => {
    let pen = 0;
    if (r.x0 < box.x0 || r.x1 > box.x1 || r.y0 < box.y0 || r.y1 > box.y1) pen += 1000;
    for (const p of placed) if (overlap(r, p)) pen += 500;
    for (const d of items) if (d !== it && overlap(r, { x0: d.x - 6, x1: d.x + 6, y0: d.y - 6, y1: d.y + 6 })) pen += 200;
    return pen + 4 * crossings(r, polys);
  };
  const perms = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])));
  const idx = items.map((_, i) => i);
  let best = null;
  for (const order of items.length <= 5 ? perms(idx) : [idx]) {
    const placed = [...fixed], out = new Array(items.length);
    let total = 0;
    for (const i of order) {
      let pick = null;
      for (const c of cands(items[i])) { const p = c.pen + cost(c.r, items[i], placed); if (!pick || p < pick.p) pick = { p, r: c.r }; }
      placed.push(pick.r); out[i] = pick.r; total += pick.p;
    }
    if (!best || total < best.total) best = { total, out };
  }
  return best.out;
}

// ---------- 3 · shifts ----------
function shiftCard(lines, plant, w) {
  const shifts = ['A', 'B', 'C'];
  const values = lines.map(x => shifts.map((s, j) => sum(x.o.rows, r => r.shifts[j].oee) / x.o.rows.length));
  const avg = sum(values.flat()) / values.flat().length;
  const byShift = shifts.map((s, j) => ({ s, v: sum(values, row => row[j]) / values.length }));
  const weak = byShift.reduce((m, x) => (x.v < m.v ? x : m)), best = byShift.reduce((m, x) => (x.v > m.v ? x : m));
  let cell = { v: 2 };
  values.forEach((row, i) => row.forEach((v, j) => { if (v < cell.v) cell = { v, line: lines[i].l, s: shifts[j] }; }));
  const narrow = w < 400;
  const labelW = narrow ? 100 : 130, cellW = Math.min(110, Math.floor((Math.min(w, 520) - labelW) / 3));
  return html`<section class="card" aria-label="OEE by shift">
    <div class="card-head"><h2>OEE by shift</h2><span class="sub">average per line</span></div>
    <div class="heat">${heatmap({ title: 'Average OEE by line and shift', rows: lines.map(x => x.l.short), cols: shifts.map(s => `Shift ${s}`), values, fmt: v => p0(v), lo: avg - 0.1, hi: avg + 0.05, goodHigh: true, cellW, cellH: 34, labelW })}</div>
    <p class="chart-caption"><b>Shift ${weak.s}</b> (${SHIFT_NAME[weak.s]}, ${SHIFT_TIME[weak.s]} IST) is the weakest: ${p1(weak.v)} on average, ${num((best.v - weak.v) * 100, 1)} points below shift ${best.s}. The weakest cell is the ${lineWord(cell.line)} on shift ${cell.s} at ${p0(cell.v)}.
      Red = more than 5 points below the plant average (${p0(avg)}), amber = below average, grey = at or above.</p>
  </section>`;
}

// ---------- 4 · reliability from the CMMS history ----------
function reliability(W, M, siteId, t) {
  const hist = W.history.filter(h => M.assetById(h.assetId)?.siteId === siteId && h.date <= t);
  const oldest = W.history.reduce((m, h) => Math.min(m, h.date), t);
  const windowDays = Math.max(1, Math.round((t - oldest) / DAY));
  const cm = hist.filter(h => h.type === 'CM'), pm = hist.filter(h => h.type === 'PM');
  const per = {};
  for (const h of cm) per[h.assetId] = (per[h.assetId] || 0) + 1;
  const ids = Object.keys(per);
  const mtbf = ids.length ? sum(ids, id => windowDays * 24 / per[id]) / ids.length : null;
  const mttr = cm.length ? sum(cm, h => h.durationH) / cm.length : null;
  return { windowDays, cm: cm.length, pm: pm.length, total: cm.length + pm.length, machines: ids.length, mtbf, mttr };
}

// ---------- 5 · what Nirantar changes ----------
// Repairs completed in this session (store.complete pushes one row each): hours, OEE points on the line(s), rupees.
function sessionSavings(store, M) {
  const sv = store.state.savings || [];
  if (!sv.length) return null;
  const pts = sum(sv, x => {
    const a = M.assetById(x.assetId), l = M.lineById(a.lineId);
    const pl = l.utility ? store.world.lines.find(q => q.siteId === a.siteId && !q.utility) : l;
    return x.hoursSaved / pl.plannedHoursMonth * 100;
  });
  return { n: sv.length, h: sum(sv, x => x.hoursSaved), inr: sum(sv, x => x.avoidedInr - x.plannedInr), pts, ids: [...new Set(sv.map(x => x.assetId))], last: sv[sv.length - 1] };
}

function changeModel(store, S, M, openFail, caseId) {
  const al = openFail.find(x => x.assetId === caseId) || openFail[0];
  if (!al) return null;
  const a = M.assetById(al.assetId);
  const mode = al.mode || M.assess(a, store.t).mode || 'FM-01';
  const fm = FAILURE_MODES[mode];
  const ex = M.exposure(a, mode);
  const wait = ex.plan ? ex.plan.etaH : 0;
  const unplannedH = wait + fm.repairH;
  const savedH = Math.max(0, unplannedH - PLANNED_WINDOW_H);
  const line = M.lineById(a.lineId);
  const affected = line.utility ? store.world.lines.filter(l => l.siteId === a.siteId && !l.utility) : [line];
  const points = savedH / affected[0].plannedHoursMonth * 100;
  const pc = M.plannedCost(a, mode);
  return { a, al, mode, fm, ex, wait, unplannedH, savedH, line, affected, points, pc, inrSaved: ex.inr - pc.total };
}

function changeCard(c, store, M) {
  const done = sessionSavings(store, M);
  const savedBlock = done
    ? html`<div class="saved done">${humanChip('Repair completed by your team')}<p><b>Already saved in this session:</b> ${done.n} repair${done.n > 1 ? 's' : ''} (${done.ids.join(', ')}) done in a planned window: <b>${hours(done.h)}</b> of unplanned downtime, <b>+${num(done.pts, 1)} OEE points</b> and <b>${inr(done.inr)}</b> avoided.</p></div>`
    : html`<div class="saved"><p><b>Already saved in this session:</b> nothing yet. When a repair is completed on <a href="#/orders">5 · Work Orders</a>, its saving is counted here.</p></div>`;
  if (!c && done) {
    const a = M.assetById(done.last.assetId), l = M.lineById(a.lineId);
    return html`<section class="card ok" aria-label="What Nirantar changed">
      <div class="card-head">${marker(3)}<h2>What Nirantar changed</h2>${humanChip('Repair completed by your team')}</div>
      <p>Your team repaired <b>${done.ids.join(', ')}</b> in a planned window instead of waiting for the breakdown. Compared with the unplanned stop:</p>
      <div class="cols-3 gains">
        ${kpi({ label: 'Production hours saved', value: hours(done.h), tone: 'ok', mean: `${done.n} unplanned stop${done.n > 1 ? 's' : ''} avoided` })}
        ${kpi({ label: 'OEE gained', value: '+' + num(done.pts, 1), unit: ' pts', tone: 'ok', mean: l.utility ? 'on each line it serves, this month' : `on the ${lineWord(l)} this month` })}
        ${kpi({ label: 'Money saved', value: inr(done.inr), tone: 'ok', mean: 'money at stake − planned repair cost' })}
      </div>
      <p class="small dim">No other machine has an open failure alert right now. The figures use the same formula as the estimate before the repair; every step is in the audit log on 8 · Trust Audit.</p>
    </section>`;
  }
  if (!c) {
    return html`<section class="card ai" aria-label="What Nirantar changes">
      <div class="card-head">${marker(3)}<h2>What Nirantar changes</h2>${aiChip('Estimated by Nirantar')}</div>
      <p>No machine has an open failure alert right now, so there is no breakdown to avoid. When one starts to wear, Nirantar estimates here how many hours, OEE points and rupees a planned repair saves compared with waiting for the breakdown.</p>
      ${savedBlock}
    </section>`;
  }
  const { a, ex, wait, unplannedH, savedH, line, affected, points, pc, inrSaved, fm } = c;
  const fromCity = ex.plan && ex.plan.kind !== 'local' ? (ex.plan.from === 'Supplier' ? 'the supplier' : M.siteById(ex.plan.from).city) : null;
  const scale = Math.max(unplannedH, PLANNED_WINDOW_H);
  const formula = `Unplanned stop = waiting for the part (${hours(wait)}) + typical repair (${hours(fm.repairH)}) = ${hours(unplannedH)}. Planned repair = one ${PLANNED_WINDOW_H} h low-impact window. Hours saved = ${hours(unplannedH)} − ${PLANNED_WINDOW_H} h. OEE points = hours saved ÷ ${affected[0].plannedHoursMonth} planned hours a month × 100. Rupees = money at stake if it breaks (${inr(ex.inr)} = ${hours(ex.downH)} × ${inr(ex.costPerH)}/h) − planned repair cost (${inr(pc.total)}: parts ${inr(pc.parts)} + labour ${inr(pc.labour)}).`;
  const lineText = line.utility ? `on each of the ${affected.length} lines it serves` : `on the ${lineWord(line)} this month`;
  return html`<section class="card ai" aria-label="What Nirantar changes">
    <div class="card-head">${marker(3)}<h2>What Nirantar changes: ${a.id}</h2>${aiChip('Estimated by Nirantar')}<span class="sub">${lc(a.name)}, ${FAILURE_MODES[c.mode].name.toLowerCase()}</span></div>
    <div class="compare">
      <div class="cmp-row">
        <div class="cmp-label"><b>If it breaks down</b><span>${wait ? `${hours(wait)} waiting for the part${fromCity ? ' from ' + fromCity : ''} + ${hours(fm.repairH)} repair` : `${hours(fm.repairH)} repair, part in stock`}</span></div>
        <div class="cmp-bar act"><span style="width:${(unplannedH / scale * 100).toFixed(1)}%"></span></div><div class="cmp-v">${hours(unplannedH)}</div>
      </div>
      <div class="cmp-row">
        <div class="cmp-label"><b>Planned with Nirantar</b><span>one ${PLANNED_WINDOW_H} h low-impact window, part ordered ahead</span></div>
        <div class="cmp-bar ai"><span style="width:${(PLANNED_WINDOW_H / scale * 100).toFixed(1)}%"></span></div><div class="cmp-v">${PLANNED_WINDOW_H} h</div>
      </div>
    </div>
    <div class="cols-3 gains">
      ${kpi({ label: 'Production hours saved', value: savedH ? hours(savedH) : '0 h', tone: savedH ? 'ai' : '', mean: savedH ? 'unplanned stop avoided' : 'the part is in stock, so a breakdown would be short too; the gain is choosing a low-impact time', tip: formula })}
      ${kpi({ label: 'OEE gained', value: savedH ? '+' + num(points, 1) : '0', unit: ' pts', tone: savedH ? 'ai' : '', mean: savedH ? lineText : 'no hours saved, so no OEE change', tip: formula })}
      ${kpi({ label: 'Money saved', value: inr(inrSaved), tone: 'ai', mean: `${inr(ex.inr)} at stake − ${inr(pc.total)} planned repair`, tip: formula })}
    </div>
    <p class="small dim">How it is worked out: ${term('see the formula', formula)}. Estimates from the model, not a guarantee.</p>
    ${savedBlock}
  </section>`;
}
