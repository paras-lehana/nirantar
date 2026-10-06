// Tool · Business case (Analyse): what is predictive maintenance worth for a plant like yours?
// An honest, illustrative calculator. Three ways to maintain (run to failure, calendar preventive = today, predictive
// with Nirantar) priced per year from 17 inputs, with saving, payback, return, availability points, a ±20 % tornado
// and the real savings from the repairs done in this session. Works with or without sample data.
// Inputs live in module scope (clock ticks, theme switches and data loads never wipe what the person typed) and the
// results update in place, so focus is never lost while typing or sliding.
import { html, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, kpi, humanChip, nextBack } from '../ui/components.js';
import { inr, num, int, hours, dateTime } from '../core/format.js';

const PLANNED_WINDOW_H = 4;   // the demo books a planned repair as one 4 h low-impact window (store.complete, OEE page)
const BREAK_FACTOR = 2;       // sample: breakdown repair = 2 × planned repair (secondary damage; typically 2 to 5 ×)
const SWING = 0.2;            // sensitivity: each input 20 % down and up on its own

// Conservative, clearly labelled defaults for a mid-size plant (used without sample data or on "Reset").
const TYPICAL = { machines: 50, failures: 60, costPerH: 25000, plannedH: 36000, downBreakH: 12, downPlanH: 6, repairBreak: 80000,
  repairPlan: 40000, premium: 25, caught: 60, falseAlarms: 50, checkCost: 5000, progCost: 100000, pmPrevents: 30, pmJobs: 4, pmJobH: 1, pmJobCost: 6000 };
const TYPICAL_PQ = 0.82;      // performance × quality used to turn availability points into OEE points
const TYPICAL_WHY = {
  machines: 'Assumed: a mid-size plant with about 50 machines worth monitoring.',
  failures: 'Assumed: about 1.2 breakdowns per machine a year with calendar maintenance in place.',
  costPerH: 'Assumed for a mid-size plant. Change it first: it moves the result most.',
  plannedH: 'Assumed: six lines × about 6,000 planned hours a year.',
  downBreakH: 'Assumed: half a day of waiting for the part and the crew, plus the repair.',
  downPlanH: 'Assumed: one low-impact window, sometimes a short wait for the part.',
  repairBreak: 'Assumed: twice the planned repair. Breakdowns damage more parts (typically 2 to 5 times).',
  repairPlan: 'Assumed: parts and two technicians for a bearing, seal or coupling job.',
  premium: 'Assumed: express freight, overtime and call-out charges on a breakdown.',
  caught: 'Conservative: predictive programmes are often quoted at 70 % or more.',
  falseAlarms: 'Assumed: about one wasted check per machine a year.',
  checkCost: 'Assumed: a technician visit with a handheld meter, about two hours.',
  progCost: 'Assumed: wireless sensors spread over 3 years, connectivity and software, per machine.',
  pmPrevents: 'Assumed: calendar jobs mainly stop wear-out failures; most failures are random in time.',
  pmJobs: 'Assumed: about one routine job a quarter per machine.',
  pmJobH: 'Assumed: most routine jobs fit planned stops; about 1 h of output lost each.',
  pmJobCost: 'Assumed: labour and consumables per job.',
};

const GROUPS = [
  { id: 'plant', title: 'Your plant', sub: 'How big the operation is and what an hour of lost output costs.' },
  { id: 'fail', title: 'One failure: breakdown or planned repair', sub: 'What the same failure costs when it breaks and when it is repaired on your schedule.' },
  { id: 'pdm', title: 'Predictive maintenance with Nirantar', sub: 'How well the warnings work and what the programme costs.' },
  { id: 'pm', title: 'Calendar preventive maintenance (today)', sub: 'Your routine jobs. Nirantar keeps them, so they cost the same with or without it; they matter for the run-to-failure comparison.' },
];
// k, group, label, unit, kind (inr shows a lakh/crore readout), hard limits, slider [min, max, step], meaning line
const FIELDS = [
  { k: 'machines', g: 'plant', label: 'Machines monitored', unit: 'machines', min: 1, max: 100000, s: [1, 300, 1], mean: 'Machines that get sensors and are scored every 15 minutes.' },
  { k: 'failures', g: 'plant', label: 'Unplanned failures a year', unit: 'a year, all machines', min: 0, max: 100000, s: [0, 600, 1], mean: 'Breakdowns that still happen with your current routine maintenance.' },
  { k: 'costPerH', g: 'plant', label: 'Downtime cost per hour', unit: 'Rs per hour', kind: 'inr', min: 0, max: 1e8, s: [0, 150000, 500], mean: 'Output lost for each hour a line stands still (contribution, not the sales price).' },
  { k: 'plannedH', g: 'plant', label: 'Planned production hours a year', unit: 'h, all lines added', min: 1, max: 1e7, s: [1000, 120000, 100], mean: 'Hours the lines are meant to run. Only used for the availability and OEE points.' },
  { k: 'downBreakH', g: 'fail', label: 'Downtime if it breaks', unit: 'h per failure', min: 0, max: 5000, s: [0, 96, 0.5], mean: 'Waiting for the part and the crew, plus the repair itself.' },
  { k: 'downPlanH', g: 'fail', label: 'Downtime if the repair is planned', unit: 'h per failure', min: 0, max: 5000, s: [0, 48, 0.5], mean: 'Part and crew are ready, so the job fits a low-impact window.' },
  { k: 'repairBreak', g: 'fail', label: 'Repair cost if it breaks', unit: 'Rs per failure', kind: 'inr', min: 0, max: 1e9, s: [0, 500000, 1000], mean: 'Parts and labour. A breakdown usually damages more (shaft, housing, tooling).' },
  { k: 'repairPlan', g: 'fail', label: 'Repair cost if planned', unit: 'Rs per failure', kind: 'inr', min: 0, max: 1e9, s: [0, 300000, 1000], mean: 'Parts and labour for the same job done on your schedule.' },
  { k: 'premium', g: 'fail', label: 'Emergency premium on breakdowns', unit: '% of the repair cost', min: 0, max: 500, s: [0, 150, 5], mean: 'Express freight, overtime and call-out charges when it breaks.' },
  { k: 'caught', g: 'pdm', label: 'Failures caught early', unit: '% of failures', min: 0, max: 100, s: [0, 100, 1], mean: 'Share of the failures Nirantar warns about in time to plan the repair.' },
  { k: 'falseAlarms', g: 'pdm', label: 'False alarms a year', unit: 'a year', min: 0, max: 100000, s: [0, 400, 1], mean: 'Warnings where the machine turns out to be fine.' },
  { k: 'checkCost', g: 'pdm', label: 'Cost of checking one false alarm', unit: 'Rs per check', kind: 'inr', min: 0, max: 1e7, s: [0, 30000, 500], mean: 'A technician visit with a handheld meter; the machine keeps running.' },
  { k: 'progCost', g: 'pdm', label: 'Programme cost per machine', unit: 'Rs per machine a year', kind: 'inr', min: 0, max: 1e8, s: [0, 300000, 1000], mean: 'Sensors spread over their life, connectivity and software.' },
  { k: 'pmPrevents', g: 'pm', label: 'Failures the calendar jobs prevent', unit: '% of failures', min: 0, max: 90, s: [0, 90, 1], mean: 'Of the failures you would have with no routine jobs, the share they prevent. Only used for run to failure.' },
  { k: 'pmJobs', g: 'pm', label: 'Routine jobs per machine', unit: 'a year', min: 0, max: 365, s: [0, 24, 0.5], mean: 'Lubrication, inspections and part swaps on a fixed calendar.' },
  { k: 'pmJobH', g: 'pm', label: 'Output hours lost per routine job', unit: 'h per job', min: 0, max: 500, s: [0, 12, 0.5], mean: 'Set 0 if every job fits into a planned stop.' },
  { k: 'pmJobCost', g: 'pm', label: 'Cost per routine job', unit: 'Rs per job', kind: 'inr', min: 0, max: 1e7, s: [0, 50000, 500], mean: 'Labour and consumables.' },
];
const FBY = Object.fromEntries(FIELDS.map(f => [f.k, f]));
const SRC_TEXT = { sample: 'Sample plant', ratio: '2 × sample', typical: 'Typical', you: 'Your number' };

const SEGS = [
  { k: 'down', label: 'Lost output (downtime)', cls: 'sg-down' },
  { k: 'repair', label: 'Repairs and routine jobs', cls: 'sg-rep' },
  { k: 'premium', label: 'Emergency premium', cls: 'sg-prem' },
  { k: 'checks', label: 'False-alarm checks', cls: 'sg-chk' },
  { k: 'prog', label: 'Nirantar programme', cls: 'sg-prog' },
];
const STRATS = [
  { k: 'rtf', name: 'Run to failure', short: 'Run to failure', sub: 'fix only what breaks; no routine jobs' },
  { k: 'pm', name: 'Calendar preventive (today)', short: 'Calendar (today)', sub: 'routine jobs on a fixed calendar; the rest still break' },
  { k: 'pdm', name: 'Predictive with Nirantar', short: 'With Nirantar', sub: 'same routine jobs; most failures repaired in a planned window' },
];

// ui survives re-renders: values, where each came from, which ones the person typed
let ui = { v: null, src: {}, why: {}, facts: {}, edited: new Set(), basis: null, auto: false, sampleKey: null, wantSample: false, howOpen: false };
let live = null;   // { root, ctx } of the mounted page, for onStore

const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
const mean = (arr, f = x => x) => (arr.length ? sum(arr, f) / arr.length : 0);
const r1 = v => Math.round(v * 10) / 10;
const r100 = v => Math.round(v / 100) * 100;
const clampF = (f, x) => Math.min(f.max, Math.max(f.min, x));
const money = v => (v < 0 ? '−' + inr(-v) : inr(v));
// rounded for sentences ("about Rs 17.4 Cr", not "Rs 17.43 Cr")
const about = v => { const a = Math.abs(v); const t = (a >= 1e7 ? 'Rs ' + (a / 1e7).toFixed(1).replace(/\.0$/, '') + ' Cr' : inr(a)).replace(/ /g, '\u00a0'); return v < 0 ? '−' + t : t; };
const mult = x => (!isFinite(x) ? 'no cost' : x >= 10 ? `${Math.round(x)}×` : `${num(x, 1)}×`);
function payTxt(m) {
  if (!isFinite(m)) return 'never';
  if (m <= 0) return 'at once';
  if (m < 1) return `under a month (about ${Math.max(1, Math.round(m * 30.4))} days)`;
  if (m >= 24) return `${num(m / 12, 1)} years`;
  return `${num(m, 1)} months`;
}
const andList = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
const showVal = v => String(r1(v) === Math.round(v) ? Math.round(v) : r1(v));

// ---------- where the numbers come from ----------
function sampleKey(store) {
  return store.loaded ? [store.state.scenarioId, store.state.seed, store.state.anchor, store.state.threshold].join('|') : null;
}

function sampleBasis(store, S) {
  const W = store.world, M = store.model, B = W.backtest;
  const th = store.state.threshold ?? B.defaultThreshold;
  const bt = M.backtestAt(th);
  const perYear = 365 / B.windowDays;
  const prod = W.lines.filter(l => !l.utility);
  const eps = B.episodes;
  const ex = eps.map(e => M.exposure(M.assetById(e.assetId), e.mode));
  const pc = eps.map(e => M.plannedCost(M.assetById(e.assetId), e.mode));
  const pmRows = W.history.filter(h => h.type === 'PM');
  const PMI = S.PM_INTERVAL || {};
  const intervals = W.assets.map(a => PMI[a.cls]).filter(Boolean);
  const plannedRepair = mean(pc, p => p.total);
  const extraWait = mean(ex, x => Math.max(0, (x.plan ? x.plan.etaH : 0) - bt.medianLead));
  const costs = prod.map(l => l.costPerH);
  const values = {
    machines: W.assets.length,
    failures: Math.round(eps.length * perYear),
    costPerH: Math.round(mean(costs)),
    plannedH: Math.round(sum(prod, l => l.plannedHoursMonth) * 12),
    downBreakH: r1(mean(ex, x => x.downH)),
    downPlanH: r1(PLANNED_WINDOW_H + extraWait),
    repairBreak: r100(BREAK_FACTOR * plannedRepair),
    repairPlan: r100(plannedRepair),
    premium: TYPICAL.premium,
    caught: Math.round(bt.recall * 100),
    falseAlarms: Math.round(bt.falseAlarms * perYear),
    checkCost: TYPICAL.checkCost,
    progCost: TYPICAL.progCost,
    pmPrevents: TYPICAL.pmPrevents,
    pmJobs: r1(mean(intervals, d => 365 / d)),
    pmJobH: r1(mean(pmRows, h => h.durationH)),
    pmJobCost: r100(mean(pmRows, h => h.costInr)),
  };
  const src = {};
  for (const f of FIELDS) src[f.k] = 'sample';
  for (const k of ['premium', 'checkCost', 'progCost', 'pmPrevents']) src[k] = 'typical';
  src.repairBreak = 'ratio';
  const why = {
    ...TYPICAL_WHY,
    machines: `${W.assets.length} machines across the ${W.sites.length} sample plants.`,
    failures: `${eps.length} failures in the ${B.windowDays}-day back-test × 365 ÷ ${B.windowDays}.`,
    costPerH: `Average output value per hour of the ${prod.length} production lines (${inr(Math.min(...costs))} to ${inr(Math.max(...costs))}).`,
    plannedH: `${prod.length} production lines × their planned hours a month × 12.`,
    downBreakH: `Average over the ${eps.length} back-test failures: waiting for the part (local stock or another plant) plus the repair.`,
    downPlanH: `One ${PLANNED_WINDOW_H} h low-impact window plus ${num(extraWait, 1)} h on average waiting for parts that are further away than the ${hours(bt.medianLead)} median warning.`,
    repairPlan: `Average planned repair (part + two technicians) over the ${eps.length} back-test failures.`,
    repairBreak: `${BREAK_FACTOR} × the sample's planned repair: breakdowns damage more parts (typically 2 to 5 times).`,
    caught: `${bt.detected} of ${bt.total} back-test failures caught at the alert threshold ${th.toFixed(2)}.`,
    falseAlarms: `${bt.falseAlarms} false alarms in the ${B.windowDays}-day back-test × 365 ÷ ${B.windowDays}.`,
    pmJobs: `The sample plant's calendar: every ${Math.min(...intervals)} to ${Math.max(...intervals)} days by machine type.`,
    pmJobH: `Average length of the ${pmRows.length} preventive jobs in the maintenance history.`,
    pmJobCost: `Average cost of the ${pmRows.length} preventive jobs in the maintenance history.`,
  };
  const facts = { leadH: bt.medianLead, pq: mean(W.oee, r => r.performance * r.quality), pqSrc: 'the sample plant, last 30 days' };
  return { values, src, why, facts };
}

function typicalBasis() {
  const src = {};
  for (const f of FIELDS) src[f.k] = 'typical';
  return { values: { ...TYPICAL }, src, why: { ...TYPICAL_WHY }, facts: { leadH: null, pq: TYPICAL_PQ, pqSrc: 'a typical plant (assumed)' } };
}

function applyBasis(basis, ctx, { auto = false, keep = false } = {}) {
  const { store, S } = ctx;
  const b = basis === 'sample' && store.loaded ? sampleBasis(store, S) : typicalBasis();
  const v = { ...b.values };
  if (keep && ui.v) for (const k of ui.edited) v[k] = ui.v[k];
  else ui.edited = new Set();
  Object.assign(ui, { v, src: b.src, why: b.why, facts: b.facts, basis: basis === 'sample' && store.loaded ? 'sample' : 'typical', auto });
  ui.sampleKey = ui.basis === 'sample' ? sampleKey(store) : null;
}

function ensure(ctx) {
  const { store } = ctx;
  // Start cautious: industry-typical numbers. The sample plant is failure-heavy by design (to make the demo eventful),
  // so its saving is shown only when someone asks for it with "Use the sample plant's numbers".
  if (!ui.v) return applyBasis('typical', ctx);
  if (store.loaded && ui.wantSample) { ui.wantSample = false; return applyBasis('sample', ctx); }
  // new scenario or a new alert threshold: refresh the sample-derived numbers, keep what the person typed
  if (store.loaded && sampleKey(store) !== ui.sampleKey && (ui.basis === 'sample' || ui.auto)) applyBasis('sample', ctx, { keep: true });
}

const srcOf = k => (ui.edited.has(k) ? 'you' : ui.src[k] || 'typical');
const basisNow = () => (ui.edited.size ? 'mixed' : ui.basis);

// ---------- the model ----------
export function calc(v) {
  const F = Math.max(0, v.failures), r = Math.min(1, Math.max(0, v.caught / 100));
  const s = Math.min(0.9, Math.max(0, v.pmPrevents / 100)), prem = Math.max(0, v.premium / 100), C = v.costPerH;
  const breakDown = v.downBreakH * C, planDown = v.downPlanH * C;
  const perBreak = breakDown + v.repairBreak * (1 + prem);        // one failure that breaks
  const perPlanned = planDown + v.repairPlan;                      // the same failure repaired in a planned window
  const jobs = v.machines * v.pmJobs;
  const routineDown = jobs * v.pmJobH * C, routineCost = jobs * v.pmJobCost;
  const Frtf = F / (1 - s);                                        // without routine jobs, more failures
  const caught = F * r, missed = F - caught;
  const mk = o => ({ ...o, total: o.down + o.repair + o.premium + o.checks + o.prog });
  const rtf = mk({ fails: Frtf, planned: 0, down: Frtf * breakDown, repair: Frtf * v.repairBreak, premium: Frtf * v.repairBreak * prem, checks: 0, prog: 0 });
  const pm = mk({ fails: F, planned: 0, down: F * breakDown + routineDown, repair: F * v.repairBreak + routineCost, premium: F * v.repairBreak * prem, checks: 0, prog: 0 });
  const pdm = mk({ fails: missed, planned: caught, down: missed * breakDown + caught * planDown + routineDown,
    repair: missed * v.repairBreak + caught * v.repairPlan + routineCost, premium: missed * v.repairBreak * prem,
    checks: v.falseAlarms * v.checkCost, prog: v.machines * v.progCost });
  const perCaught = perBreak - perPlanned;
  const benefit = caught * perCaught - pdm.checks;                 // what the programme earns before its own cost
  const savePm = pm.total - pdm.total, saveRtf = rtf.total - pdm.total;
  const payback = pdm.prog > 0 ? (benefit > 0 ? 12 * pdm.prog / benefit : Infinity) : 0;
  const roi = pdm.prog > 0 ? benefit / pdm.prog : Infinity;
  const hAvoided = caught * (v.downBreakH - v.downPlanH);
  const avail = v.plannedH > 0 ? hAvoided / v.plannedH * 100 : 0;
  return { F, Frtf, caught, missed, r, s, prem, perBreak, perPlanned, perCaught, jobs, routineDown, routineCost, rtf, pm, pdm, benefit, savePm, saveRtf, payback, roi, hAvoided, avail };
}

function tornado(v) {
  const base = calc(v).savePm;
  const rows = [];
  for (const f of FIELDS) {
    if (f.k === 'plannedH') continue;   // only moves the points, not the rupees
    const lo = calc({ ...v, [f.k]: clampF(f, v[f.k] * (1 - SWING)) }).savePm;
    const hi = calc({ ...v, [f.k]: clampF(f, v[f.k] * (1 + SWING)) }).savePm;
    rows.push({ f, lo, hi, span: Math.abs(hi - lo) });
  }
  const tiny = Math.max(1, Math.abs(base) * 1e-6);
  return { base, rows: rows.filter(r => r.span > tiny).sort((a, b) => b.span - a.span), still: rows.filter(r => r.span <= tiny) };
}

// ---------- page ----------
export default {
  autoRerender: false,   // number inputs and sliders: the clock must never replace them mid-typing
  onStore(what) {
    if (!live) return;
    const { root, ctx } = live;
    if (what === 'threshold' || what === 'load') {
      if (ctx.store.loaded && (ui.basis === 'sample' || ui.auto)) { applyBasis('sample', ctx, { keep: true }); syncInputs(root); }
      refresh(root, ctx);
    } else if (what === 'wo' || what === 'clear') refresh(root, ctx);
  },
  render(root, ctx) {
    const { store } = ctx;
    ensure(ctx);
    live = { root, ctx };
    const R = calc(ui.v), T = tornado(ui.v);

    root.innerHTML = String(html`<div class="page roi">
      ${pageHead('roi')}
      <p class="roi-print-only">Nirantar business case · printed ${dateTime(Date.now())} · illustrative model, not a quote</p>
      <div data-slot="headline">${headlineHtml(R, T)}</div>
      <div class="roi-honest" data-slot="honest">${honestHtml(R)}</div>
      ${doThis([
        html`Start from the sample plant or typical numbers, then type your own; every result updates as you type ${marker(1)}`,
        html`Compare the yearly cost of the three ways to maintain ${marker(2)}`,
        html`See which input moves the saving most, and check that number twice ${marker(3)}`,
        html`Copy or print the business case for your finance team ${marker(4)}`,
      ])}

      <section class="card roi-inputs" aria-labelledby="roi-in-h">
        <div class="card-head">${marker(1)}<h2 id="roi-in-h">Your numbers</h2><span class="sub">type a value or drag its slider</span></div>
        <div class="roi-tools">
          ${store.loaded
            ? html`<button class="btn" data-action="basis-sample">${icon('data')}Use the sample plant's numbers</button>`
            : html`<button class="btn" data-action="load-sample" data-scenario="pune-bearing">${icon('data')}Load sample data to prefill from the demo plant</button>`}
          <button class="btn" data-action="basis-typical">${icon('sliders')}Reset to industry-typical defaults</button>
          <span class="roi-legend-src small dim">Where each number came from: <span class="roi-src s-sample">Sample plant</span> <span class="roi-src s-typical">Typical</span> <span class="roi-src s-you">Your number</span></span>
        </div>
        <div class="roi-live" data-slot="live" aria-live="polite">${liveHtml(R)}</div>
        ${GROUPS.map(g => html`<fieldset class="roi-group">
          <legend>${g.title}</legend>
          <p class="roi-gsub">${g.sub}</p>
          <div class="roi-fields">${FIELDS.filter(f => f.g === g.id).map(fieldHtml)}</div>
        </fieldset>`)}
      </section>

      <div class="roi-kpis" data-slot="kpis">${kpisHtml(R)}</div>

      <div class="roi-res">
        <section class="card" aria-labelledby="roi-st-h">
          <div class="card-head">${marker(2)}<h2 id="roi-st-h">Yearly cost of each way to maintain</h2></div>
          <div data-slot="strategies">${strategiesHtml(R)}</div>
        </section>
        <section class="card" aria-labelledby="roi-tor-h">
          <div class="card-head">${marker(3)}<h2 id="roi-tor-h">Which input matters most</h2></div>
          <div data-slot="tornado">${tornadoHtml(T)}</div>
        </section>
      </div>

      <section class="card roi-seen" aria-label="What you saw in this demo" data-slot="seen">${seenHtml(ctx, R)}</section>

      <section class="card roi-share" aria-labelledby="roi-sh-h">
        <div class="card-head">${marker(4)}<h2 id="roi-sh-h">Share the business case</h2></div>
        <p class="small muted">The copy is plain text with the result, every input and its source, and the formulas: ready for an email or a note. Print gives a clean page without the menus.</p>
        <div class="row roi-share-btns">
          <button class="btn primary" data-action="copy">${icon('doc')}Copy the business case</button>
          <button class="btn" data-action="print">${icon('print')}Print</button>
        </div>
        <div class="roi-copybox" data-slot="copybox" hidden></div>
      </section>

      <details class="card roi-how" id="roi-how">
        <summary>How this is calculated</summary>
        <div data-slot="how">${howHtml(R)}</div>
      </details>

      ${nextBack('roi')}
    </div>`);
    const det = root.querySelector('#roi-how');
    if (det) { det.open = !!ui.howOpen; det.addEventListener('toggle', () => { ui.howOpen = det.open; }); }

    // print: open the formulas so they are on paper, then restore
    let wasOpen = false;
    const beforePrint = () => { const d = root.querySelector('#roi-how'); if (d) { wasOpen = d.open; d.open = true; } };
    const afterPrint = () => { const d = root.querySelector('#roi-how'); if (d) d.open = wasOpen; };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);

    const off = delegate(root, {
      num: (el, ev) => {
        const f = FBY[el.dataset.k];
        if (!f) return;
        if (ev.type === 'input') {
          const x = parseFloat(String(el.value).replace(/,/g, ''));
          if (el.value.trim() === '' || !isFinite(x)) return;   // keep the last valid value while the field is half-typed
          setVal(root, ctx, f, clampF(f, x), el);
        } else if (ev.type === 'change' || ev.type === 'focusout') {
          if (String(el.value) !== showVal(ui.v[f.k])) el.value = showVal(ui.v[f.k]);
        }
      },
      rng: (el, ev) => {
        const f = FBY[el.dataset.k];
        if (f && ev.type === 'input') setVal(root, ctx, f, +el.value, el);
      },
      'basis-sample': () => { applyBasis('sample', ctx); ctx.rerender(); ctx.toast({ kind: 'ok', title: 'Sample plant numbers loaded', body: 'Every input now comes from the demo plant or a typical value. Type over any of them.' }); },
      'basis-typical': () => { applyBasis('typical', ctx); ctx.rerender(); ctx.toast({ kind: 'ok', title: 'Industry-typical defaults', body: 'Conservative values for a mid-size plant. Replace them with your own.' }); },
      'load-sample': () => { ui.wantSample = true; },   // main.js loads the data; ensure() then prefills from it
      copy: () => copyCase(root, ctx),
      'copy-close': () => { const box = root.querySelector('[data-slot="copybox"]'); if (box) { box.hidden = true; box.innerHTML = ''; } },
      print: () => { beforePrint(); window.print(); },
    }, ['click', 'input', 'change', 'focusout']);
    return () => {
      off();
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      if (live && live.root === root) live = null;
    };
  },
};

// ---------- live updates (outputs only; the inputs stay put) ----------
function setVal(root, ctx, f, x, from) {
  ui.v[f.k] = x;
  ui.edited.add(f.k);
  syncField(root, f, from);
  refresh(root, ctx);
}

function syncField(root, f, skip) {
  const box = root.querySelector(`.roi-field[data-k="${f.k}"]`);
  if (!box) return;
  const nEl = box.querySelector('input[type="number"]'), rEl = box.querySelector('input[type="range"]');
  const val = ui.v[f.k];
  if (nEl && nEl !== skip && nEl !== document.activeElement) nEl.value = showVal(val);
  if (rEl && rEl !== skip) rEl.value = String(val);
  const ro = box.querySelector('[data-ro]');
  if (ro) ro.textContent = inr(val);
  const tag = box.querySelector('.roi-src');
  if (tag) {
    const s = srcOf(f.k);
    tag.className = `roi-src s-${s === 'ratio' ? 'sample' : s}`;
    tag.textContent = SRC_TEXT[s];
    tag.dataset.tip = s === 'you' ? 'You typed this value.' : ui.why[f.k] || '';
  }
}
function syncInputs(root) { for (const f of FIELDS) syncField(root, f, null); }

function refresh(root, ctx) {
  const R = calc(ui.v), T = tornado(ui.v);
  const put = (k, v) => { const el = root.querySelector(`[data-slot="${k}"]`); if (el) el.innerHTML = String(v); };
  put('headline', headlineHtml(R, T));
  put('honest', honestHtml(R));
  put('live', liveHtml(R));
  put('kpis', kpisHtml(R));
  put('strategies', strategiesHtml(R));
  put('tornado', tornadoHtml(T));
  put('seen', seenHtml(ctx, R));
  put('how', howHtml(R));
}

// ---------- pieces ----------
function fieldHtml(f) {
  const v = ui.v[f.k], s = srcOf(f.k), id = `roi-${f.k}`;
  return html`<div class="roi-field" data-k="${f.k}">
    <div class="roi-flabel">
      <label for="${id}">${f.label}</label>
      <span class="roi-src s-${s === 'ratio' ? 'sample' : s}" tabindex="0" data-tip="${s === 'you' ? 'You typed this value.' : ui.why[f.k] || ''}">${SRC_TEXT[s]}</span>
    </div>
    <div class="roi-fin">
      <input id="${id}" class="input" type="number" inputmode="decimal" step="any" min="${f.min}" max="${f.max}" value="${showVal(v)}" data-action="num" data-k="${f.k}" aria-describedby="${id}-m">
      <span class="roi-unit">${f.unit}${f.kind === 'inr' ? html`<b data-ro="${f.k}">${inr(v)}</b>` : ''}</span>
    </div>
    <input type="range" min="${f.s[0]}" max="${f.s[1]}" step="${f.s[2]}" value="${v}" data-action="rng" data-k="${f.k}" aria-label="${f.label}, slider" aria-describedby="${id}-m">
    <p class="roi-mean" id="${id}-m">${f.mean}</p>
  </div>`;
}

function topLever(T) { return T.rows[0] ? T.rows[0].f.label.toLowerCase() : 'the downtime cost per hour'; }

function headlineHtml(R, T) {
  const b = basisNow();
  const who = b === 'sample' ? 'For a plant like the sample one' : b === 'typical' ? 'For a typical mid-size plant' : 'With your numbers';
  const lead = ui.facts.leadH && !ui.edited.has('caught') ? html` <b>${hours(ui.facts.leadH).replace(' ', '\u00a0')} early</b>` : ' early';
  if (R.savePm <= 0) {
    return headline(html`${who}, predictive maintenance does not pay yet: it costs <b>${about(-R.savePm)} a year more</b> than calendar maintenance. The input that moves this most is <b>${topLever(T)}</b>.`, 'watch');
  }
  return headline(html`${who}, catching <b>${Math.round(R.r * 100)}\u00a0%</b> of failures${lead} saves about <b>${about(R.savePm)} a year</b> against calendar maintenance; the programme pays back in <b>${payTxt(R.payback)}</b>.`, R.payback <= 12 ? 'ok' : 'watch');
}

function honestHtml(R) {
  const b = basisNow();
  const base = b === 'sample' ? "Illustrative model on the sample plant's numbers. Not a quote; replace the inputs with your own."
    : b === 'typical' ? 'Illustrative model on industry-typical numbers. Not a quote; replace the inputs with your own.'
    : `Illustrative model on your numbers (${ui.edited.size} typed, the rest from ${ui.basis === 'sample' ? 'the sample plant' : 'typical values'}). Not a quote.`;
  const perMachine = ui.v.machines > 0 ? ui.v.failures / ui.v.machines : 0;
  const heavy = ui.basis === 'sample' && perMachine >= 2
    ? ` The sample plant is failure-heavy (${num(perMachine, 1)} breakdowns per machine a year) and many spares sit in another plant, so its saving is large. For a cautious case, press "Reset to industry-typical defaults".` : '';
  return html`${icon('info')}<p><b>${base}</b>${heavy}</p>`;
}

function liveHtml(R) {
  const pos = R.savePm > 0;
  return html`<span class="roi-live-k">${pos ? 'Saving' : 'Extra cost'} <b>${about(Math.abs(R.savePm))}</b> a year</span>
    <span class="roi-live-k">payback <b>${pos ? payTxt(R.payback).replace(/ \(.*\)$/, '') : 'never'}</b></span>
    <span class="roi-live-k">return <b>${mult(R.roi)}</b></span>
    <span class="roi-live-sub">against calendar preventive maintenance (today)</span>`;
}

function kpisHtml(R) {
  const m = R.payback;
  const pay = !isFinite(m) ? { value: 'Never', unit: '', mean: 'the benefit does not cover the programme cost' }
    : m < 1 ? { value: '< 1', unit: ' month', mean: `about ${Math.max(1, Math.round(m * 30.4))} days of benefit pay for a year of the programme` }
    : { value: num(m, 1), unit: ' months', mean: 'of benefit pay for a year of the programme' };
  return html`
    ${kpi({ label: 'Saving a year', value: about(R.savePm), tone: R.savePm > 0 ? 'ok' : 'watch', mean: 'against calendar preventive (today), after the programme cost', tip: 'Yearly cost of calendar preventive maintenance minus the yearly cost with Nirantar, after paying for the programme.' })}
    ${kpi({ label: 'Saving vs run to failure', value: about(R.saveRtf), mean: 'against fixing only what breaks', tip: 'Yearly cost of running to failure (no routine jobs, more breakdowns) minus the yearly cost with Nirantar.' })}
    ${kpi({ label: 'Payback', value: pay.value, unit: pay.unit, mean: pay.mean, tip: 'Payback = 12 × programme cost a year ÷ benefit a year. The benefit is the saving before the programme cost.' })}
    ${kpi({ label: 'Return', value: mult(R.roi), mean: isFinite(R.roi) ? `Rs ${num(Math.max(0, R.roi), 1)} back for every Rs 1 spent on the programme` : 'the programme costs nothing', tip: 'Return = benefit a year ÷ programme cost a year.' })}
    ${kpi({ label: 'Availability gained', value: (R.avail >= 0 ? '+' : '−') + num(Math.abs(R.avail), 1), unit: ' pts', tone: R.avail > 0 ? 'ok' : '', mean: `about ${R.avail >= 0 ? '+' : '−'}${num(Math.abs(R.avail * ui.facts.pq), 1)} OEE points; ${int(R.hAvoided)} h less downtime a year`, tip: `Availability points = downtime avoided ÷ planned production hours × 100. OEE points = availability points × performance × quality (${num(ui.facts.pq * 100, 0)} %, from ${ui.facts.pqSrc}).` })}`;
}

function strategiesHtml(R) {
  const max = Math.max(R.rtf.total, R.pm.total, R.pdm.total, 1);
  const best = STRATS.reduce((m, s) => (R[s.k].total < R[m.k].total ? s : m), STRATS[0]);
  const rows = STRATS.map(s => {
    const o = R[s.k];
    const segs = SEGS.filter(g => o[g.k] > 0);
    const desc = segs.map(g => `${g.label} ${money(o[g.k])}`).join(', ');
    const counts = s.k === 'pdm' ? `${int(o.fails)} breakdowns and ${int(o.planned)} planned repairs a year` : `${int(o.fails)} breakdowns a year`;
    return html`<div class="roi-srow ${s.k === best.k ? 'best' : ''}">
      <div class="roi-sname"><b>${s.name}</b>${s.k === best.k ? html` <span class="state normal">${icon('check')}Lowest cost</span>` : ''}<span>${s.sub} · ${counts}</span></div>
      <div class="roi-stotal">${about(o.total)}</div>
      <div class="roi-sbar" role="img" aria-label="${s.name}: ${money(o.total)} a year. ${desc}.">
        <div class="roi-sfill" style="width:${(o.total / max * 100).toFixed(2)}%">${segs.map(g => html`<span class="sg ${g.cls}" style="flex-grow:${(o[g.k] / o.total * 1000).toFixed(1)}" title="${g.label}: ${money(o[g.k])}"></span>`)}</div>
      </div>
    </div>`;
  });
  const vsToday = R.pm.total - R.pdm.total;
  return html`<div class="legend roi-legend" aria-hidden="true">${SEGS.map(g => html`<span><span class="roi-sw ${g.cls}"></span>${g.label}</span>`)}</div>
    <div class="roi-strat">${rows}</div>
    <p class="small roi-verdict">${vsToday > 0
      ? html`Predictive with Nirantar costs <b>${about(vsToday)}</b> a year less than today's calendar maintenance, after paying <b>${about(R.pdm.prog)}</b> for the programme.`
      : html`With these inputs, predictive with Nirantar costs <b>${about(-vsToday)}</b> a year more than today's calendar maintenance.`}</p>
    <div class="table-wrap roi-table"><table class="table">
      <caption class="visually-hidden">Yearly cost by strategy and cost type</caption>
      <thead><tr><th scope="col">Per year</th>${STRATS.map(s => html`<th scope="col" class="n">${s.short}</th>`)}</tr></thead>
      <tbody>
        <tr><th scope="row">Breakdowns</th>${STRATS.map(s => html`<td class="n">${int(R[s.k].fails)}</td>`)}</tr>
        <tr><th scope="row">Repairs planned ahead</th>${STRATS.map(s => html`<td class="n">${int(R[s.k].planned)}</td>`)}</tr>
        ${SEGS.map(g => html`<tr><th scope="row"><span class="roi-sw ${g.cls}"></span>${g.label}</th>${STRATS.map(s => html`<td class="n">${R[s.k][g.k] ? about(R[s.k][g.k]) : '–'}</td>`)}</tr>`)}
        <tr class="roi-total"><th scope="row">Total</th>${STRATS.map(s => html`<td class="n"><b>${about(R[s.k].total)}</b></td>`)}</tr>
      </tbody></table></div>`;
}

function tornadoHtml(T) {
  if (!T.rows.length) return html`<p class="small muted">No input changes the saving with these numbers. Enter some failures and a downtime cost to see the levers.</p>`;
  const shown = T.rows.slice(0, 8), rest = T.rows.slice(8);
  const ends = shown.flatMap(r => [r.lo, r.hi]);
  const nearZero = T.base <= 0 || Math.min(...ends) < Math.abs(T.base) * 0.5;   // show break-even only when a swing gets near it
  const xs = [T.base, ...ends, ...(nearZero ? [0] : [])];
  let lo = Math.min(...xs), hi = Math.max(...xs);
  const pad = (hi - lo) * 0.03 || 1; lo -= pad; hi += pad;
  const p = x => ((x - lo) / (hi - lo) * 100).toFixed(2);
  const seg = (a, b, cls) => { const l = Math.min(a, b), r = Math.max(a, b); return r > l ? html`<span class="${cls}" style="left:${p(l)}%;width:${(+p(r) - +p(l)).toFixed(2)}%"></span>` : ''; };
  const zero = nearZero && lo <= 0 && hi >= 0;
  return html`<p class="small muted roi-tsub">Each input moved 20 % down and up on its own; the bar shows where the yearly saving lands. The line is today's estimate, <b>${about(T.base)}</b>.</p>
    <div class="legend roi-tlegend" aria-hidden="true"><span><span class="roi-sw t-lo"></span>Input 20 % lower</span><span><span class="roi-sw t-hi"></span>Input 20 % higher</span>${zero ? html`<span><span class="roi-sw t-zero"></span>Break-even</span>` : ''}</div>
    <ol class="roi-tor">${shown.map((r, i) => html`<li class="roi-trow">
      <span class="roi-tlabel">${i === 0 ? html`<b>${r.f.label}</b>` : r.f.label}</span>
      <span class="roi-ttrack" aria-hidden="true">
        ${zero ? html`<span class="t-zero" style="left:${p(0)}%"></span>` : ''}
        ${seg(T.base, r.lo, 't-lo')}${seg(T.base, r.hi, 't-hi')}
        <span class="t-base" style="left:${p(T.base)}%"></span>
      </span>
      <span class="roi-tval">${about(Math.min(r.lo, r.hi))} to ${about(Math.max(r.lo, r.hi))}</span>
      <span class="visually-hidden">: 20 % lower gives ${money(r.lo)}, 20 % higher gives ${money(r.hi)}.</span>
    </li>`)}</ol>
    <p class="small roi-tnote"><b>Check ${topLever(T)} first:</b> a 20 % error there moves the saving by about ${about(T.rows[0].span / 2)} either way.${rest.length ? ` Smaller levers: ${andList(rest.map(r => r.f.label.toLowerCase()))}.` : ''}${T.still.length ? ` The routine-job inputs (${andList(T.still.map(r => r.f.label.toLowerCase()))}) do not move it: they cost the same with or without Nirantar.` : ''}</p>`;
}

function seenHtml(ctx, R) {
  const { store } = ctx;
  const head = html`<div class="card-head"><h2>What you saw in this demo</h2></div>`;
  if (!store.loaded) {
    return html`${head}<p class="small muted">Run the tour on the sample plant: every repair your team completes in a planned window is counted here with its real numbers, next to the calculator's estimate.</p>
      <div class="row"><button class="btn" data-action="load-sample" data-scenario="pune-bearing">${icon('data')}Load sample data</button></div>`;
  }
  const sv = (store.state.savings || []);
  if (!sv.length) {
    return html`${head}<p class="small muted">Nothing repaired yet in this session. Approve the drafted repair on 5 · Work Orders, then mark it done (the Presenter page can jump time while the part travels). Its real saving appears here, next to the calculator's estimate of <b>${about(R.perCaught)}</b> per failure caught early.</p>
      <div class="row"><a class="btn" href="#/orders">${icon('orders')}5 · Work Orders</a><a class="btn ghost" href="#/presenter">${icon('play')}Presenter</a></div>`;
  }
  const avoided = sum(sv, x => x.avoidedInr), spent = sum(sv, x => x.plannedInr), h = sum(sv, x => x.hoursSaved);
  const ids = [...new Set(sv.map(x => x.assetId))];
  const net = avoided - spent;
  const ratio = R.perCaught > 0 ? net / R.perCaught : null;
  return html`<div class="card-head"><h2>What you saw in this demo</h2>${humanChip('Repairs completed by your team')}</div>
    <p class="small">Your team repaired <b>${ids.join(', ')}</b> in a planned window instead of waiting for the breakdown. These are the demo's own numbers, not the calculator's:</p>
    <div class="roi-seen-k">
      ${kpi({ label: 'Breakdown cost avoided', value: inr(avoided), mean: 'the money at stake if it had broken', tone: 'ok' })}
      ${kpi({ label: 'Planned repair spent', value: inr(spent), mean: 'parts and labour' })}
      ${kpi({ label: 'Net saving', value: money(net), mean: `from ${sv.length} repair${sv.length > 1 ? 's' : ''}`, tone: net > 0 ? 'ok' : '' })}
      ${kpi({ label: 'Downtime avoided', value: hours(h), mean: `against the breakdown, after the ${PLANNED_WINDOW_H} h window` })}
    </div>
    ${ratio != null ? html`<p class="small muted">The calculator values one failure caught early at <b>${about(R.perCaught)}</b>. ${sv.length > 1 ? 'These repairs' : 'This repair'} saved <b>${num(ratio, 1)} times</b> that: ${ratio >= 1.2 ? 'a waiting part on a busy line makes a single breakdown very expensive.' : ratio <= 0.8 ? 'the calculator is more generous than this case, so its average is not too optimistic here.' : 'close to the calculator\'s average.'}</p>` : ''}`;
}

function howHtml(R) {
  const v = ui.v, C = v.costPerH;
  const F = (name, formula, result) => html`<div class="roi-f"><b>${name}</b><span class="roi-fx">${formula}</span>${result ? html`<span class="roi-fr">${result}</span>` : ''}</div>`;
  const whyList = FIELDS.map(f => html`<li><b>${f.label}</b> (${f.kind === 'inr' ? inr(v[f.k]) : `${showVal(v[f.k])} ${f.unit}`}): ${srcOf(f.k) === 'you' ? 'typed by you.' : ui.why[f.k]}</li>`);
  return html`<div class="roi-how-body">
    <h3>Per failure</h3>
    ${F('Breakdown', 'downtime if it breaks × downtime cost per hour + repair cost if it breaks × (1 + emergency premium)', html`= ${num(v.downBreakH, 1)} h × ${inr(C)} + ${inr(v.repairBreak)} × ${num(1 + R.prem, 2)} = <b>${inr(R.perBreak)}</b>`)}
    ${F('Planned repair', 'downtime if planned × downtime cost per hour + repair cost if planned', html`= ${num(v.downPlanH, 1)} h × ${inr(C)} + ${inr(v.repairPlan)} = <b>${inr(R.perPlanned)}</b>`)}
    ${F('Saving per failure caught early', 'breakdown − planned repair', html`= <b>${money(R.perCaught)}</b>`)}
    <h3>Per year</h3>
    ${F('Routine jobs', 'machines × routine jobs per machine × (output hours lost per job × downtime cost per hour + cost per job)', html`= ${int(v.machines)} × ${num(v.pmJobs, 1)} × (${num(v.pmJobH, 1)} h × ${inr(C)} + ${inr(v.pmJobCost)}) = <b>${inr(R.routineDown + R.routineCost)}</b>`)}
    ${F('Calendar preventive (today)', 'failures × breakdown + routine jobs', html`= ${int(R.F)} × ${inr(R.perBreak)} + ${inr(R.routineDown + R.routineCost)} = <b>${inr(R.pm.total)}</b>`)}
    ${F('Run to failure', 'failures ÷ (1 − share the calendar jobs prevent) × breakdown; no routine jobs', html`= ${int(R.F)} ÷ ${num(1 - R.s, 2)} × ${inr(R.perBreak)} = <b>${inr(R.rtf.total)}</b>`)}
    ${F('Predictive with Nirantar', 'caught × planned repair + missed × breakdown + routine jobs + false alarms × check cost + machines × programme cost per machine', html`caught = ${int(R.F)} × ${Math.round(R.r * 100)} % = ${int(R.caught)}, missed = ${int(R.missed)}; total = <b>${inr(R.pdm.total)}</b>`)}
    ${F('Benefit', 'caught × saving per failure caught early − false alarms × check cost', html`= ${int(R.caught)} × ${money(R.perCaught)} − ${int(v.falseAlarms)} × ${inr(v.checkCost)} = <b>${money(R.benefit)}</b>`)}
    ${F('Saving a year', 'benefit − programme cost  (the same as calendar preventive − predictive)', html`= ${money(R.benefit)} − ${inr(R.pdm.prog)} = <b>${money(R.savePm)}</b>`)}
    ${F('Payback', '12 × programme cost ÷ benefit', html`= <b>${payTxt(R.payback)}</b>`)}
    ${F('Return', 'benefit ÷ programme cost', html`= <b>${mult(R.roi)}</b>`)}
    ${F('Downtime avoided', 'caught × (downtime if it breaks − downtime if planned)', html`= ${int(R.caught)} × ${num(v.downBreakH - v.downPlanH, 1)} h = <b>${int(R.hAvoided)} h</b>`)}
    ${F('Availability points', 'downtime avoided ÷ planned production hours × 100; OEE points ≈ availability points × performance × quality', html`= ${int(R.hAvoided)} ÷ ${int(v.plannedH)} × 100 = <b>${num(R.avail, 1)}</b>; × ${num(ui.facts.pq, 2)} = <b>${num(R.avail * ui.facts.pq, 1)} OEE points</b>`)}
    <h3>Assumptions, on the cautious side</h3>
    <ul class="roi-assume">
      <li>Your plant runs calendar preventive maintenance today, and Nirantar keeps every routine job. In practice condition-based work replaces some of them, which would add to the saving.</li>
      <li>A failure caught early is repaired in a planned window with its part ready. If parts often take longer than the warning time, raise "downtime if the repair is planned".</li>
      <li>Lost output is valued at the full downtime cost per hour. If you can make it up with overtime, lower that input.</li>
      <li>Sensitivity moves one input at a time by 20 %, with the others held still.</li>
    </ul>
    <h3>Where each number comes from</h3>
    <ul class="roi-sources">${whyList}</ul>
  </div>`;
}

// ---------- copy ----------
function caseText(R, T) {
  const v = ui.v, b = basisNow();
  const basis = b === 'sample' ? "the sample plant's numbers (fictional Indus Group, all data synthetic)" : b === 'typical' ? 'industry-typical defaults (conservative assumptions)' : `your numbers (${ui.edited.size} typed, the rest from ${ui.basis === 'sample' ? 'the sample plant' : 'typical values'})`;
  const fmtIn = f => (f.kind === 'inr' ? inr(v[f.k]) : `${Number.isInteger(v[f.k]) ? int(v[f.k]) : num(v[f.k], 1)} ${f.unit}`);
  const L = [
    'Nirantar business case: what predictive maintenance is worth',
    'Illustrative model, not a quote. Replace the inputs with your own.',
    `Basis: ${basis}.`,
    '',
    'Yearly cost of each way to maintain',
    ...STRATS.map(s => `- ${s.name}: ${money(R[s.k].total)} (${int(R[s.k].fails)} breakdowns${s.k === 'pdm' ? `, ${int(R.pdm.planned)} repairs planned ahead` : ''})`),
    '',
    'Result',
    `- Saving: ${money(R.savePm)} a year against calendar preventive (today), ${money(R.saveRtf)} against run to failure`,
    `- Programme cost: ${inr(R.pdm.prog)} a year (${int(v.machines)} machines × ${inr(v.progCost)})`,
    `- Payback: ${payTxt(R.payback)}`,
    `- Return: ${mult(R.roi)} (benefit ÷ programme cost)`,
    `- Downtime avoided: ${int(R.hAvoided)} h a year (${num(R.avail, 1)} availability points, about ${num(R.avail * ui.facts.pq, 1)} OEE points)`,
    T.rows[0] ? `- Biggest lever: ${T.rows[0].f.label.toLowerCase()} (20 % either way moves the saving between ${money(Math.min(T.rows[0].lo, T.rows[0].hi))} and ${money(Math.max(T.rows[0].lo, T.rows[0].hi))})` : '',
    '',
    'Inputs',
    ...FIELDS.map(f => `- ${f.label}: ${fmtIn(f)} [${SRC_TEXT[srcOf(f.k)]}]`),
    '',
    'How it is calculated',
    `- Breakdown = downtime if it breaks × downtime cost per hour + repair cost if it breaks × (1 + premium) = ${inr(R.perBreak)}`,
    `- Planned repair = downtime if planned × downtime cost per hour + repair cost if planned = ${inr(R.perPlanned)}`,
    `- Calendar preventive = failures × breakdown + routine jobs = ${inr(R.pm.total)}`,
    `- Run to failure = failures ÷ (1 − share the calendar jobs prevent) × breakdown = ${inr(R.rtf.total)}`,
    `- Predictive = caught × planned repair + missed × breakdown + routine jobs + false alarms × check cost + programme = ${inr(R.pdm.total)}`,
    '- Payback = 12 × programme cost ÷ benefit; return = benefit ÷ programme cost; benefit = caught × (breakdown − planned repair) − false-alarm checks',
    '- Assumes Nirantar keeps every routine job and a caught failure is repaired in a planned window with its part ready.',
    '',
    'Made with the Nirantar interactive demo. All data synthetic.',
  ];
  return L.filter((x, i) => x !== '' || L[i - 1] !== '').join('\n');
}

async function copyCase(root, ctx) {
  const text = caseText(calc(ui.v), tornado(ui.v));
  const box = root.querySelector('[data-slot="copybox"]');
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    if (box) { box.hidden = true; box.innerHTML = ''; }
    ctx.toast({ kind: 'ok', title: 'Business case copied', body: 'Paste it into an email, a note or a slide.' });
  } catch {
    if (!box) return;
    box.hidden = false;
    box.innerHTML = String(html`<p class="small"><b>Your browser did not allow copying.</b> The text is selected below: press Ctrl+C (or long-press and choose Copy).</p>
      <label class="visually-hidden" for="roi-copytext">Business case text</label>
      <textarea id="roi-copytext" class="input mono" rows="12" readonly>${text}</textarea>
      <div class="row"><button class="btn sm ghost" data-action="copy-close">${icon('x')}Close</button></div>`);
    const ta = box.querySelector('textarea');
    if (ta) { ta.focus(); ta.select(); }
  }
}
