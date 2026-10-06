// Step 8 · Verify: can I trust the predictions and the actions?
// Back-test evidence in prognostics terms (detection, warning time, false alarms per machine-month, prognostic horizon,
// alpha-lambda accuracy cone), an auditable alert-policy slider, the guardrail log, the full audit trail with CSV export,
// a model card with its limits, and a copilot evaluation measured in the browser on the golden questions.
import { html, icon, delegate } from '../ui/dom.js';
import { lineChart, columns } from '../ui/charts.js';
import { pageHead, headline, doThis, marker, aiChip, humanChip, term, nextBack } from '../ui/components.js';
import { HEALTH_FORMULA, CONF_NOTE } from '../core/scoring.js';
import { FAILURE_MODES } from '../core/generator.js';
import { mulberry32, strHash } from '../core/rng.js';
import { dateTime, day, inr, int, isoDate, time } from '../core/format.js';
import * as S from '../core/store.js';

const ALPHA = 0.2;            // accuracy cone: predictions within ±20 % of the true time left
const BIN_H = 12, BINS = 7;   // lead-time histogram: 12-hour bins, the last one open-ended (72 h and more)
const MODEL_VERSION = 'Nirantar demo model v1 (synthetic)';
const CLASS_NAME = { cnc: 'CNC machines', rotating: 'Fans, drives, mills and conveyors', pump: 'Pumps', compressor: 'Compressors and chillers',
  press: 'Presses and hammers', thermal: 'Furnaces and heaters', aux: 'Washers, measuring and other auxiliary machines' };
const KIND = { ai: ['ai', 'AI', 'ai'], human: ['person', 'Person', 'user'], system: ['system', 'System', 'layers'], blocked: ['blocked', 'Blocked', 'shield'] };
const FILTERS = [['all', 'All'], ['ai', 'AI'], ['human', 'People'], ['system', 'System'], ['blocked', 'Blocked']];

let ui = { th: null, thKey: null, confirm: false, name: '', filter: 'all', q: '', limit: 40, ep: null, evalKey: null, evalRes: null, evalBusy: false, evalErr: null };

// ---------- back-test helpers (pure, exported for Node tests) ----------
const fmtTh = th => Number(th).toFixed(2);
const r2 = th => Math.round(th * 100) / 100;

/** Deterministic RUL predictions for one past failure, from the first warning to the failure, seeded by the episode id. */
export function trajectory(ep, lead) {
  const r = mulberry32(strHash(ep.id + ':' + ep.assetId));
  const n = 12, pts = [];
  const bias = (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.3);   // first estimates are 35-65 % off
  const k = 1.1 + r() * 0.9;                                  // how fast they converge
  for (let i = 0; i < n; i++) {
    const h = lead * (1 - i / n), frac = h / lead;
    const err = bias * Math.pow(frac, k) + (r() - 0.5) * 0.14 * frac;
    pts.push({ h, pred: Math.max(0, h * (1 + err)), err, inside: Math.abs(err) <= ALPHA });
  }
  let i0 = pts.length;                                        // first prediction from which every later one stays inside
  for (let i = pts.length - 1; i >= 0 && pts[i].inside; i--) i0 = i;
  const ph = i0 < pts.length ? pts[i0].h : 0;
  const half = pts[Math.round(n / 2)];                        // alpha-lambda check at lambda = 50 %
  return { pts, ph, i0, halfPass: half.inside, half, lead };
}

const leadScale = (B, th) => Math.pow((1 - th) / (1 - B.defaultThreshold), 0.7);
export function caughtEpisodes(W, th) {
  const B = W.backtest, s = leadScale(B, th);
  return B.episodes.filter(e => e.score >= th).map(e => ({ ...e, lead: e.baseLead * s })).sort((x, y) => x.lead - y.lead);
}
export function medianPH(W, th) {
  const phs = caughtEpisodes(W, th).map(e => trajectory(e, e.lead).ph).sort((x, y) => x - y);
  return phs.length ? phs[Math.floor(phs.length / 2)] : 0;
}
export function histogram(leads) {
  const counts = Array(BINS).fill(0);
  for (const l of leads) counts[Math.min(BINS - 1, Math.floor(l / BIN_H))]++;
  return counts.map((n, i) => ({ lo: i * BIN_H, hi: i === BINS - 1 ? null : (i + 1) * BIN_H, n }));
}
const missedCost = (W, th) => W.backtest.episodes.filter(e => e.score < th).reduce((s, e) => s + e.costInr, 0);

/** Plain-English consequence of moving the threshold from the applied policy `a` to `th`. */
export function tradeOff(M, W, a, th) {
  if (Math.abs(th - a) < 0.005) return { same: true, text: `This is the policy in use (alert at ${fmtTh(a)}). Move the slider to see what you would gain and lose.` };
  const A = M.backtestAt(a), T = M.backtestAt(th);
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const lead = T.medianLead - A.medianLead;
  const leadTxt = Math.abs(lead) >= 1 ? `, and the median warning comes ${Math.round(Math.abs(lead))} h ${lead > 0 ? 'earlier' : 'later'}` : '';
  if (th > a) {
    const more = T.missed - A.missed, fewer = A.falseAlarms - T.falseAlarms, cost = missedCost(W, th) - missedCost(W, a);
    const body = more && fewer ? `misses ${pl(more, 'more failure')} but avoids ${pl(fewer, 'false alarm')}`
      : more ? `misses ${pl(more, 'more failure')} and avoids no false alarms` : fewer ? `avoids ${pl(fewer, 'false alarm')} without missing any more failures` : 'changes nothing in the back-test';
    return { same: false, text: `Raising the threshold to ${fmtTh(th)} ${body}${leadTxt}.`, cost: more ? `In the back-test those ${pl(more, 'missed failure')} cost ${inr(cost)} in unplanned stops.` : '' };
  }
  const more = A.missed - T.missed, added = T.falseAlarms - A.falseAlarms;
  const body = more && added ? `catches ${pl(more, 'more failure')} but adds ${pl(added, 'false alarm')}`
    : more ? `catches ${pl(more, 'more failure')} with no extra false alarms` : added ? `adds ${pl(added, 'false alarm')} without catching any more failures` : 'changes nothing in the back-test';
  return { same: false, text: `Lowering the threshold to ${fmtTh(th)} ${body}${leadTxt}.`, cost: added ? `Each false alarm costs a technician visit and some trust in the alerts.` : '' };
}

// ---------- copilot evaluation (dynamic import of the copilot page module) ----------
function plainText(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res.replace(/<[^>]+>/g, ' ');
  const parts = [res.text, res.answer, res.a, res.html, res.markdown, res.body].filter(v => typeof v === 'string');
  if (parts.length) return parts.join(' ').replace(/<[^>]+>/g, ' ');
  try { return JSON.stringify(res); } catch { return String(res); }
}
function evalKey(store) { const s = store.state; return `${s.scenarioId}|${s.seed}|${s.anchor}`; }

async function runEval(store) {
  const key = evalKey(store);
  if (ui.evalBusy) return;
  ui.evalBusy = true; ui.evalErr = null;
  const st = store.state;
  const snap = { audit: st.audit.slice(), guardrail: st.guardrail.slice(), copilotLog: st.copilotLog.slice() };
  try {
    const mod = await import('./copilot.js');
    const GOLDEN = mod.GOLDEN || mod.default?.GOLDEN, answer = mod.answer || mod.default?.answer;
    if (!Array.isArray(GOLDEN) || typeof answer !== 'function') throw new Error('the copilot module does not export GOLDEN and answer()');
    const results = [];
    const refScenario = mod.GOLDEN_SCENARIO || 'pune-bearing';
    // Scored on a pristine copy of the reference scenario (fixed seed), not on the live demo: after a repair or a
    // scenario change the expected facts no longer hold. Synchronous, so the clock cannot tick mid-run.
    const answers = S.withReference(refScenario, 2391, ref => GOLDEN.map(g => {
      const q = g.q || g.question || g.text || '';
      try { return { g, q, res: answer(q, ref), err: null }; } catch (e) { return { g, q, res: null, err: e.message }; }
    }));
    for (const { g, q, res, err } of answers) {
      const text = plainText(res).toLowerCase(), bare = text.replace(/\*\*|__|`/g, '');
      const expect = (g.expect || g.keywords || []).map(String);
      const missing = err ? expect : expect.filter(k => !text.includes(k.toLowerCase()) && !bare.includes(k.toLowerCase()));
      const blocked = !!(res && typeof res === 'object' && res.blocked);
      const refuse = !!g.refuse;
      results.push({ q, expect, missing, blocked, refuse, err, pass: !err && !missing.length && blocked === refuse });
    }
    ui.evalRes = { key, results, passed: results.filter(r => r.pass).length, at: store.state.simNow, goldenScenario: refScenario, scenarioId: refScenario };
    ui.evalKey = key;
  } catch (e) {
    ui.evalErr = e.message || String(e);
    ui.evalKey = key;
  } finally {
    // the evaluation must not leave traces in the logs (answer() may log like the chat does)
    let restored = false;
    if (st.audit.length !== snap.audit.length || st.guardrail.length !== snap.guardrail.length || st.copilotLog.length !== snap.copilotLog.length) {
      st.audit = snap.audit; st.guardrail = snap.guardrail; st.copilotLog = snap.copilotLog; restored = true;
    }
    ui.evalBusy = false;
    if (restored && store.state === st) { ui.rerender?.(); return; }   // the page re-rendered mid-run with the extra rows: draw it again
  }
  fillEval();
}

function evalSummary() {
  if (ui.evalErr) return html`<div class="k-value dim">n/a</div><p class="ans-mean">Copilot evaluation not available right now.</p><p class="small dim">The copilot could not be loaded in this browser. The rest of this page is unaffected.</p>`;
  if (!ui.evalRes) return html`<div class="k-value"><span class="skel ev-skel" aria-hidden="true"></span></div><p class="ans-mean" role="status">Copilot evaluation loading…</p><p class="small dim">Running the golden questions through the copilot in your browser.</p>`;
  const { passed, results, goldenScenario, scenarioId } = ui.evalRes, pc = Math.round(passed / results.length * 100);
  const other = goldenScenario && goldenScenario !== scenarioId;
  const refusals = results.filter(r => r.refuse), refOk = refusals.filter(r => r.blocked).length;
  return html`<div class="k-value">${passed}<small>/ ${results.length}</small></div>
    <p class="ans-mean"><b>${pc} %</b> of the golden questions answered correctly, measured in your browser just now on the fixed reference case (Pune bearing).${other ? '' : ''}</p>
    <p class="small dim">Pass = every expected fact is in the answer, and unsafe requests are refused${refusals.length ? ` (${refOk} of ${refusals.length} refusals correct)` : ''}. <button type="button" class="linkbtn" data-action="goto-eval">See the questions</button></p>`;
}

function evalDetail() {
  if (ui.evalErr) return html`<p class="muted">Copilot evaluation not available. The golden questions live in the copilot module, which did not load in this browser. Open <a href="#/copilot">6 · Ask Copilot</a> to try the copilot directly.</p><p class="small dim ev-err">Reason: ${ui.evalErr}</p>`;
  if (!ui.evalRes) return html`<p class="muted" role="status">Copilot evaluation loading…</p><div class="skel" style="height:120px"></div>`;
  const { results, passed, at, goldenScenario, scenarioId } = ui.evalRes;
  const fails = results.filter(r => !r.pass);
  const other = goldenScenario && goldenScenario !== scenarioId;
  const row = (r, i) => html`<li class="${r.pass ? 'pass' : 'fail'}">
      <span class="ev-res">${r.pass ? html`<span class="state ok">${icon('check')}Pass</span>` : html`<span class="state act">${icon('x')}Fail</span>`}</span>
      <span class="ev-q"><b>${i + 1}.</b> ${r.q}</span>
      <span class="ev-meta small dim">${r.refuse ? html`Must refuse: ${r.blocked ? 'refused, correct' : 'answered instead of refusing'}. ` : r.blocked ? 'Refused, but should have answered. ' : ''}${r.expect.length ? html`Expected facts: ${r.expect.join(', ')}.` : ''}${r.missing.length && !r.err ? html` <span class="ev-miss">Missing: ${r.missing.join(', ')}.</span>` : ''}${r.err ? html` <span class="ev-miss">Error: ${r.err}</span>` : ''}</span>
    </li>`;
  return html`<p class="small muted"><b>${passed} of ${results.length} passed</b>, run at ${dateTime(at)} on a fresh copy of the reference case (Pune bearing, fixed seed), the way the live app runs its golden set; your demo is left untouched. Each answer is checked for the facts it must contain; questions marked “must refuse” pass only if the copilot blocks them.</p>
    ${other ? html`<p class="small ev-note">${icon('info')}<span>The golden questions are written for the Pune bearing scenario. On this scenario some answers are expected to differ; load the Pune scenario for the reference score.</span></p>` : ''}
    ${fails.length ? html`<h3 class="ev-h">Did not pass (${fails.length})</h3><ol class="ev-list">${fails.map(r => row(r, results.indexOf(r)))}</ol>` : html`<p><span class="state ok">${icon('check')}All ${results.length} passed</span></p>`}
    <details class="ev-all"><summary>Show all ${results.length} questions and results</summary><ol class="ev-list">${results.map(row)}</ol></details>
    <button class="btn sm" data-action="eval-rerun">${icon('play')} Run the evaluation again</button>`;
}

function fillEval() {
  const s = document.querySelector('.trustpage [data-eval="summary"]'), d = document.querySelector('.trustpage [data-eval="detail"]');
  if (s) s.innerHTML = String(evalSummary());
  if (d) d.innerHTML = String(evalDetail());
}

// ---------- audit log ----------
function auditRows(store) {
  const q = ui.q.trim().toLowerCase();
  return [...store.state.audit].sort((a, b) => b.ts - a.ts).filter(r => (ui.filter === 'all' || (r.kind || 'human') === ui.filter)
    && (!q || `${r.actor} ${r.action} ${r.target} ${r.detail}`.toLowerCase().includes(q)));
}
function actorChip(r) {
  const [cls, , ic] = KIND[r.kind] || KIND.human;
  return html`<span class="actor ${cls}">${icon(ic)}${r.actor}</span>`;
}
function auditList(store) {
  const rows = auditRows(store), shown = rows.slice(0, ui.limit), total = store.state.audit.length;
  if (!total) return html`<p class="muted">Nothing logged yet. Every AI action (alerts, drafts, refusals) and every human decision (acknowledge, approve, policy changes) appears here with who and when.</p>`;
  return html`<p class="small dim" aria-live="polite">Showing ${shown.length} of ${rows.length} matching rows (${total} in the log), newest first.</p>
    ${rows.length ? html`<ol class="au-list">${shown.map(r => html`<li class="au-row k-${r.kind || 'human'}">
      <span class="au-time mono">${dateTime(r.ts)}</span>${actorChip(r)}
      <span class="au-what"><b>${r.action}</b> · <span class="mono">${r.target}</span>${r.detail ? html`<span class="au-detail">${r.detail}</span>` : ''}</span>
    </li>`)}</ol>` : html`<p class="muted">No rows match. Clear the search or pick All.</p>`}
    ${rows.length > shown.length ? html`<button class="btn sm" data-action="more">Show ${Math.min(40, rows.length - shown.length)} more</button>` : ''}`;
}
function refreshAudit(root, store) {
  const box = root.querySelector('[data-live="audit"]');
  if (box) box.innerHTML = String(auditList(store));
}

// ---------- downloads ----------
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function toCsv(cols, rows) { return '﻿' + [cols.map(c => csvCell(c[0])).join(','), ...rows.map(r => cols.map(c => csvCell(c[1](r))).join(','))].join('\r\n'); }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const istStamp = ts => `${isoDate(ts)} ${time(ts)}`;

// ---------- policy (slider) ----------
function policyLive(M, W, applied, th, chartW) {
  const T = M.backtestAt(th), A = M.backtestAt(applied), same = Math.abs(th - applied) < 0.005;
  const to = tradeOff(M, W, applied, th);
  const delta = (v, base, good) => { const d = v - base; if (same || Math.abs(d) < 1e-9) return ''; const better = good === 'up' ? d > 0 : d < 0; return html`<span class="delta ${better ? 'better' : 'worse'}">${d > 0 ? '+' : '−'}${Math.abs(d) < 1 && !Number.isInteger(d) ? Math.abs(d).toFixed(2) : Math.round(Math.abs(d))}</span>`; };
  const pctD = (v, base, good) => { const d = Math.round(v * 100) - Math.round(base * 100); if (same || !d) return ''; return html`<span class="delta ${(good === 'up' ? d > 0 : d < 0) ? 'better' : 'worse'}">${d > 0 ? '+' : '−'}${Math.abs(d)} pts</span>`; };
  const bins = histogram(T.leads);
  const medBin = Math.min(BINS - 1, Math.floor(T.medianLead / BIN_H));
  const hist = T.leads.length ? columns({ title: `Hours of warning before each of the ${T.detected} caught failures at threshold ${fmtTh(th)}`, w: chartW, h: 190,
    items: bins.map((b, i) => ({ label: b.hi == null ? `${b.lo}+` : `${b.lo}–${b.hi}`, value: b.n, tone: i === medBin ? 'ai' : 'normal' })), fmt: v => `${v} failure${v === 1 ? '' : 's'}` }) : '';
  const quiet = W.backtest.falseAlarms.length - T.falseAlarms;
  return html`
    <div class="pstats" role="group" aria-label="Back-test at threshold ${fmtTh(th)}">
      <div class="ps"><span class="ps-l">Caught</span><span class="ps-v">${T.detected}<small>/ ${T.total}</small></span>${delta(T.detected, A.detected, 'up')}</div>
      <div class="ps"><span class="ps-l">Missed</span><span class="ps-v">${T.missed}</span>${delta(T.missed, A.missed, 'down')}</div>
      <div class="ps"><span class="ps-l">False alarms</span><span class="ps-v">${T.falseAlarms}</span>${delta(T.falseAlarms, A.falseAlarms, 'down')}</div>
      <div class="ps"><span class="ps-l">${term('Precision', 'Of all the alerts raised, the share that were real failures: caught ÷ (caught + false alarms).')}</span><span class="ps-v">${Math.round(T.precision * 100)}<small>%</small></span>${pctD(T.precision, A.precision, 'up')}</div>
      <div class="ps"><span class="ps-l">${term('Recall', 'Of all the real failures, the share Nirantar warned about: caught ÷ all failures.')}</span><span class="ps-v">${Math.round(T.recall * 100)}<small>%</small></span>${pctD(T.recall, A.recall, 'up')}</div>
      <div class="ps"><span class="ps-l">Median warning</span><span class="ps-v">${Math.round(T.medianLead)}<small>h</small></span>${delta(Math.round(T.medianLead), Math.round(A.medianLead), 'up')}</div>
    </div>
    <p class="tradeoff ${same ? '' : th > applied ? 'up' : 'down'}" aria-live="polite">${icon(same ? 'check' : 'info')}<span><b>${to.text}</b>${to.cost ? html` ${to.cost}` : ''}</span></p>
    <div class="apply-row">
      ${ui.confirm && !same ? html`<div class="confirm" role="group" aria-label="Confirm the policy change">
          <p><b>Change the alert policy from ${fmtTh(applied)} to ${fmtTh(th)}?</b> In the back-test that means ${T.detected} of ${T.total} failures caught and ${T.falseAlarms} false alarms (now ${A.detected} and ${A.falseAlarms}). The change is logged with your name.</p>
          <div class="row"><label class="visually-hidden" for="pol-name">Your name for the audit log</label><input id="pol-name" class="input" type="text" data-action="pol-name" placeholder="Your name (for the audit log)" value="${ui.name}" autocomplete="name">
          <button class="btn approve" data-action="apply-yes">${icon('check')} Yes, change the policy</button><button class="btn ghost" data-action="apply-no">Cancel</button></div>
        </div>`
        : same ? html`<span class="applied-pill">${icon('check')}Threshold ${fmtTh(applied)} is the applied policy</span>`
        : html`<button class="btn approve" data-action="apply">${icon('shield')} Apply ${fmtTh(th)} as the alert policy</button><button class="btn ghost" data-action="reset-th">Back to ${fmtTh(applied)}</button>`}
    </div>
    <div class="cols-2 policy-charts">
      <figure class="pfig">
        <figcaption><b>How early the warnings came</b> <span class="dim">at ${fmtTh(th)}: hours between the first alert and the breakdown, for the ${T.detected} caught failures</span></figcaption>
        ${hist || html`<p class="muted">No failure is caught at this threshold, so there is no warning time to show. Move the slider left.</p>`}
        <p class="chart-caption">Each bar covers 12 hours of warning (the last one: 72 h or more). <span class="sw-i ai"></span> Blue bar: the bin with the median (${Math.round(T.medianLead)} h). Lower thresholds warn earlier.</p>
      </figure>
      <figure class="pfig">
        <figcaption><b>Every outcome in the back-test</b> <span class="dim">at ${fmtTh(th)}</span></figcaption>
        <div class="cm" role="table" aria-label="Back-test outcomes">
          <div role="row" class="cm-row"><span role="columnheader" class="cm-h"></span><span role="columnheader" class="cm-h">A failure followed</span><span role="columnheader" class="cm-h">No failure followed</span></div>
          <div role="row" class="cm-row"><span role="rowheader" class="cm-r">Nirantar warned</span>
            <span role="cell" class="cm-c caught">${icon('check')}<b class="cm-n">${T.detected}</b><span class="cm-w">Caught</span><span class="cm-t">repaired before the breakdown</span></span>
            <span role="cell" class="cm-c fa">${icon('bell')}<b class="cm-n">${T.falseAlarms}</b><span class="cm-w">False alarm</span><span class="cm-t">a check found nothing wrong</span></span></div>
          <div role="row" class="cm-row"><span role="rowheader" class="cm-r">Stayed quiet</span>
            <span role="cell" class="cm-c missed">${icon('alert')}<b class="cm-n">${T.missed}</b><span class="cm-w">Missed</span><span class="cm-t">broke down without a warning</span></span>
            <span role="cell" class="cm-c quiet">${icon('check')}<b class="cm-n">${quiet}</b><span class="cm-w">Rightly quiet</span><span class="cm-t">near-misses that were harmless, plus all normal running</span></span></div>
        </div>
      </figure>
    </div>`;
}

// ---------- accuracy cone ----------
function coneCard(W, M, eps, chartW) {
  if (!eps.length) return html`<p class="muted">No past failure is caught at the applied policy, so there is no prediction history to show. Lower the threshold above.</p>`;
  if (ui.ep == null || ui.ep >= eps.length) ui.ep = Math.floor(eps.length / 2);
  const ep = eps[ui.ep], tr = trajectory(ep, ep.lead);
  const a = M.assetById(ep.assetId), line = a ? M.lineById(a.lineId) : null, site = a ? M.siteById(a.siteId) : null;
  const step = tr.lead <= 36 ? 6 : tr.lead <= 72 ? 12 : 24;
  const span = Math.ceil(tr.lead / step) * step;
  const pts = tr.pts.map(p => [-p.h, p.pred]);
  const ann = tr.pts.map((p, i) => ({ x: -p.h, y: p.pred, tone: p.inside ? 'ai' : 'watch', label: i === tr.i0 && tr.ph > 0 ? `Trustworthy from ${Math.round(tr.ph)} h` : '' }));
  const chart = lineChart({
    title: `Predicted versus true time left for ${ep.assetId} before its failure, with the ±20 % accuracy cone`, w: chartW, h: chartW < 520 ? 250 : 290, padR: 16, padL: 40,
    xMin: -span, xMax: 0, xTicks: span / step, xFmt: v => (Math.abs(v) < 1e-6 ? 'failure' : `${Math.round(-v)} h`), yMin: 0, unit: 'h left',
    vbands: tr.ph > 0 ? [{ x0: -tr.ph, x1: 0, tone: 'ai', opacity: 0.07 }] : [],
    forecast: { points: [], lo: [[-tr.lead, tr.lead * (1 - ALPHA)], [0, 0]], hi: [[-tr.lead, tr.lead * (1 + ALPHA)], [0, 0]], tone: 'normal' },
    series: [{ name: 'True time left', points: [[-tr.lead, tr.lead], [0, 0]], tone: 'ink', width: 1.6 }, { name: 'Nirantar prediction', points: pts, tone: 'ai', width: 1.4, dash: '3 3' }],
    annotations: ann,
  });
  const fm = FAILURE_MODES[ep.mode];
  return html`
    <div class="row between cone-pick">
      <p class="small"><b class="mono">${ep.id}</b>: ${fm ? fm.name.toLowerCase() : 'failure'} on <b class="mono">${ep.assetId}</b>${a ? html` (${/^[A-Z0-9]{2,}/.test(a.name) ? a.name : a.name.charAt(0).toLowerCase() + a.name.slice(1)}, ${line.name}, ${site.city})` : ''}, broke down on ${day(ep.at)}. First warning ${Math.round(tr.lead)} h before.</p>
      <div class="row"><button class="btn sm" data-action="ep" data-d="-1" ${ui.ep === 0 ? 'disabled' : ''} aria-label="Show a failure with a shorter warning">${icon('arrowL')} Shorter warning</button><button class="btn sm" data-action="ep" data-d="1" ${ui.ep === eps.length - 1 ? 'disabled' : ''} aria-label="Show a failure with a longer warning">Longer warning ${icon('arrowR')}</button></div>
    </div>
    ${chart}
    <ul class="cone-legend" aria-label="Chart legend">
      <li><span class="lg band"></span>Grey cone: allowed error, ±20 % of the true time left</li>
      <li><span class="lg truth"></span>Dark line: true time left (known after the failure)</li>
      <li><span class="lg dot ai"></span>Blue dots: Nirantar's predictions inside the cone</li>
      <li><span class="lg dot watch"></span>Amber dots: predictions still outside the cone</li>
    </ul>
    <div class="cone-facts">
      <div class="cf"><span class="cf-l">${term('Prognostic horizon', 'Time from the first prediction that enters the ±20 % cone and stays inside, until the failure. Longer is better: it is the time you have to plan the repair with an estimate you can trust.')}</span><span class="cf-v">${Math.round(tr.ph)}<small>h</small></span><span class="cf-m">before the failure, the estimate was within ±20 % and stayed there</span></div>
      <div class="cf"><span class="cf-l">${term('Halfway check (α-λ)', 'Alpha-lambda accuracy: at λ = 50 % of the way from first warning to failure, is the prediction within α = ±20 % of the true time left? Pass or fail.')}</span><span class="cf-v ${tr.halfPass ? 'ok' : 'watch'}">${tr.halfPass ? 'Pass' : 'Not yet'}</span><span class="cf-m">${Math.round(tr.half.h)} h before failure the estimate was ${Math.round(tr.half.pred)} h (${tr.half.err >= 0 ? '+' : '−'}${Math.round(Math.abs(tr.half.err) * 100)} %)</span></div>
      <div class="cf"><span class="cf-l">Cost avoided</span><span class="cf-v">${inr(ep.costInr)}</span><span class="cf-m">unplanned stop this warning made avoidable</span></div>
    </div>
    <p class="small">${tr.ph > 0 ? html`<b>In one sentence:</b> ${Math.round(tr.ph)} hours before ${ep.assetId} broke down, Nirantar's time-to-failure estimate was already within ±20 % of the truth and stayed there, so the planner could trust it to book a repair window.` : html`<b>In one sentence:</b> on this failure the estimate only became accurate at the very end, so the warning was useful but the timing was not; this is why the plan always uses the likely range, not one number.`}</p>`;
}

// ---------- model card ----------
function modelCard(W, M, store) {
  const B = W.backtest;
  const byCls = {};
  for (const a of W.assets) (byCls[a.cls] ||= { n: 0, tags: a.tags.map(t => t.label) }).n++;
  const lastRun = store.state.audit.find(r => r.action && r.action.startsWith('Scored'));
  return html`<div class="cols-2 mc">
    <div class="stack">
      <dl class="dl mc-dl">
        <dt>Version</dt><dd><b>${MODEL_VERSION}</b></dd>
        <dt>Trained on</dt><dd>${B.windowDays} days of history: ${B.episodes.length} failures on ${W.assets.length} machines in ${W.sites.length} plants (${B.machineMonths} machine-months of back-test)</dd>
        <dt>Scores</dt><dd>every machine every 15 minutes${lastRun ? html`; latest run logged ${dateTime(lastRun.ts)}` : ''}</dd>
        <dt>Alert rule</dt><dd>health below 50 or failure confidence 80 % or more; back-test policy threshold ${fmtTh(store.state.threshold ?? 0.6)}</dd>
        <dt>Failure modes</dt><dd>${Object.values(FAILURE_MODES).map(f => f.name.toLowerCase()).join(', ')}</dd>
      </dl>
      <div class="formula"><b>Health formula.</b> ${HEALTH_FORMULA}</div>
      <div class="formula"><b>Failure confidence.</b> ${CONF_NOTE.replace(/^Failure confidence:\s*/, '')}</div>
      <h3 class="mc-h">Inputs: sensors per machine class</h3>
      <ul class="mc-inputs">${Object.entries(byCls).map(([cls, v]) => html`<li><b>${CLASS_NAME[cls] || cls}</b> <span class="dim">(${v.n})</span>: ${v.tags.join(', ')}</li>`)}</ul>
    </div>
    <div class="stack">
      <h3 class="mc-h">What this model cannot see</h3>
      <ul class="limits">
        <li><b>Failures with no sensor signature:</b> a sudden crack, a crash, a wrong tool or an operator mistake can stop a machine without any warning in the readings.</li>
        <li><b>Anything it is not wired to:</b> only the sensors listed here. A machine without vibration sensing cannot show bearing wear early.</li>
        <li><b>New kinds of failure:</b> it learned from ${B.episodes.length} past failures; a failure mode or machine type it has never seen is scored on general drift only.</li>
        <li><b>Changes in how the machine is run:</b> time to failure assumes today's trend continues. A heavier job, higher speed or a new material can shorten it, so plans use the likely range.</li>
        <li><b>A sensor that fails slowly:</b> it catches frozen sensors by checking that related sensors agree, but a sensor drifting together with its neighbours could still look real.</li>
        <li><b>Root cause:</b> the contribution bars explain the score; they are not proof of the root cause. A technician confirms on site.</li>
        <li><b>Your plant:</b> these numbers come from synthetic data that shows the method. A real plant needs its own back-test on its own history before the numbers mean anything there.</li>
      </ul>
    </div>
  </div>`;
}

// ---------- page ----------
export default {
  render(root, ctx) {
    const { store, S, M } = ctx;
    const W = store.world, st = store.state;
    ui.rerender = ctx.rerender;
    const applied = r2(st.threshold ?? W.backtest.defaultThreshold);
    const key = `${st.scenarioId}|${st.anchor}|${applied}`;
    if (ui.thKey !== key) { ui.th = applied; ui.thKey = key; ui.confirm = false; ui.ep = null; }
    const th = ui.th;
    const bt = M.backtestAt(applied);
    const eps = caughtEpisodes(W, applied);
    const ph = medianPH(W, applied);
    const cs = getComputedStyle(root);
    const inner = (root.clientWidth || 390) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const full = Math.round(Math.max(280, Math.min(1000, inner - 30)));
    const wide = typeof matchMedia === 'function' && matchMedia('(min-width: 720px)').matches;
    const half = Math.round(wide ? Math.max(260, (inner - 30 - 16) / 2 - 24) : Math.max(260, inner - 30 - 24));
    const guard = st.guardrail || [];
    const lastPolicy = st.audit.find(r => r.action === 'Changed the alert policy');
    const faPerMachine = bt.faRate > 0 ? 1 / bt.faRate : null;
    const ekey = evalKey(store);
    if (ui.evalKey !== ekey && !ui.evalBusy) { ui.evalRes = null; ui.evalErr = null; queueMicrotask(() => runEval(store)); }
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? st.audit.length : st.audit.filter(r => (r.kind || 'human') === k).length]));

    root.innerHTML = String(html`<div class="page trustpage">
      ${pageHead('trust')}
      ${headline(html`In back-testing on <b>${bt.total} past failures</b> Nirantar caught <b>${bt.detected} (${Math.round(bt.recall * 100)} %)</b>, a median <b>${Math.round(bt.medianLead)} hours</b> before the breakdown, with <b>${bt.faRate.toFixed(2)} false alarms per machine-month</b>.`, 'ai')}
      ${doThis([
        html`Read the four answers ${marker(1)}: is it right, is it early, does it cry wolf, and does the copilot answer correctly?`,
        html`Drag the alert threshold ${marker(2)} to see what you would gain and lose. <b>Apply</b> makes it the policy; the change is logged with your name.`,
        html`Check the accuracy cone ${marker(3)}: Nirantar's predictions for a past failure close in on the truth well before the breakdown.`,
        html`Search the audit log ${marker(4)}: every AI action and every human decision, with who and when. Download it as CSV.`,
      ])}

      <section aria-label="Four answers" class="stack">
        <div class="row sec-row">${marker(1)}<h2 class="sec-title">Four answers</h2>${aiChip(`Measured on ${W.backtest.windowDays} days of history`)}</div>
        <div class="cols-4 answers">
          <article class="card answer">
            <h3>How often is it right?</h3>
            <div class="k-value">${Math.round(bt.recall * 100)}<small>%</small></div>
            <p class="ans-mean"><b>${bt.detected} of ${bt.total}</b> past failures caught; <b>${bt.missed}</b> missed.</p>
            <p class="small dim">When it alerts, it is a real failure ${Math.round(bt.precision * 100)} % of the time (${bt.detected} of ${bt.detected + bt.falseAlarms} alerts).</p>
          </article>
          <article class="card answer">
            <h3>How early does it warn?</h3>
            <div class="k-value">${Math.round(bt.medianLead)}<small>h</small></div>
            <p class="ans-mean">median warning before the breakdown (shortest ${eps.length ? Math.round(eps[0].lead) : 0} h, longest ${eps.length ? Math.round(eps[eps.length - 1].lead) : 0} h).</p>
            <p class="small dim">${term('Prognostic horizon', 'Time from the first prediction that stays within ±20 % of the true time left until the failure. See the accuracy cone below.')}: estimates were within ±20 % from a median <b>${Math.round(ph)} h</b> before failure.</p>
          </article>
          <article class="card answer">
            <h3>How often does it cry wolf?</h3>
            <div class="k-value">${bt.faRate.toFixed(2)}</div>
            <p class="ans-mean">${term('false alarms per machine-month', `False alarms ÷ machine-months = ${bt.falseAlarms} ÷ ${bt.machineMonths} = ${bt.faRate.toFixed(2)}. A machine-month is one machine watched for one month.`)}${faPerMachine ? `: about one per machine every ${faPerMachine.toFixed(1)} months.` : ': none at this policy.'}</p>
            <p class="small dim">${bt.falseAlarms} alerts in ${W.backtest.windowDays} days where a check found nothing wrong.</p>
          </article>
          <article class="card answer" aria-live="polite">
            <h3>Does the copilot answer correctly?</h3>
            <div data-eval="summary">${evalSummary()}</div>
          </article>
        </div>
      </section>

      <section class="card policy" aria-label="Maintenance-trigger policy">
        <div class="card-head">${marker(2)}<h2>Alert policy: when should Nirantar raise an alert?</h2>${humanChip('A person sets this')}</div>
        <p class="small muted">Every past failure got a warning score from 0 to 1. An alert fires when the score reaches the threshold. A lower threshold warns earlier and misses less, but raises more false alarms. Choosing it is a business decision, so it is a visible, logged policy, not a hidden setting.</p>
        <p class="applied">${icon('shield')}<span>Applied policy: alert at <b class="mono">${fmtTh(applied)}</b>${lastPolicy ? html`, set by <b>${lastPolicy.actor}</b> on ${dateTime(lastPolicy.ts)}` : ' (the default)'}. Every change is written to the audit log below.</span></p>
        <div class="slider">
          <div class="row between"><label for="th-range"><b>Alert threshold</b></label><output for="th-range" class="th-out mono" data-live="th-out">${fmtTh(th)}</output></div>
          <input id="th-range" type="range" min="0.30" max="0.90" step="0.01" value="${fmtTh(th)}" data-action="th" aria-describedby="th-ends">
          <div class="row between small dim" id="th-ends"><span>0.30 · warn earlier, more false alarms</span><span>0.90 · fewer alerts, more missed</span></div>
        </div>
        <div data-live="policy">${policyLive(M, W, applied, th, half)}</div>
        <p class="small dim">In the live Snowflake app this threshold decides when an alert is raised. In this demo it re-scores the 56-day back-test.</p>
      </section>

      <section class="card" aria-label="Accuracy cone">
        <div class="card-head">${marker(3)}<h2>Accuracy cone: did the time-to-failure estimate close in on the truth?</h2>${aiChip('Predictions by Nirantar')}</div>
        <p class="small muted">For a past failure we know the true time left at every moment. The grey cone is the allowed error (±20 %). Good predictions start rough and move inside the cone well before the breakdown. Shown: a failure caught at the applied policy, starting with the median warning time.</p>
        ${coneCard(W, M, eps, full)}
      </section>

      <div class="cols-2">
        <section class="card" aria-label="What the AI is not allowed to do">
          <div class="card-head"><h2>What the AI is not allowed to do</h2><span class="state act">${icon('shield')}Guardrails</span></div>
          <ul class="nots">
            <li>${icon('x')}<span><b>Approve, release or close a work order.</b> It drafts; a named person decides (policy POL-G8).</span></li>
            <li>${icon('x')}<span><b>Send a repair crew on a suspected sensor fault.</b> A frozen or disagreeing sensor gets an inspection, not a repair (SOP-50).</span></li>
            <li>${icon('x')}<span><b>Change production schedules or shift plans.</b> It proposes a window; people change the plan.</span></li>
          </ul>
          <p class="blocked-count"><b>${guard.length} blocked attempt${guard.length === 1 ? '' : 's'} so far</b> ${guard.some(g => g.sample) ? html`<span class="dim small">(including sample history)</span>` : ''}</p>
          ${guard.length ? html`<ol class="g-list">${guard.slice(0, 8).map(g => html`<li><span class="mono small dim">${dateTime(g.ts)}</span><span class="g-req">“${g.request}”</span><span class="state act">${icon('shield')}${g.verdict || 'Blocked'}</span><span class="small muted">${g.rule}</span></li>`)}</ol>` : html`<p class="muted">No attempts yet.</p>`}
          <a class="btn sm" href="#/copilot">${icon('chat')} Try it: ask the copilot to approve a repair</a>
        </section>
        <section class="card" id="trust-eval" aria-label="Copilot evaluation">
          <div class="card-head"><h2>Copilot evaluation: golden questions</h2>${aiChip('Answers by Nirantar')}</div>
          <div data-eval="detail">${evalDetail()}</div>
        </section>
      </div>

      <section class="card" aria-label="Audit log">
        <div class="card-head">${marker(4)}<h2>Audit log: who did what, and when</h2>
          <div class="right"><button class="btn sm" data-action="csv">${icon('download')} Download CSV</button></div></div>
        <div class="au-tools">
          <div class="seg" role="group" aria-label="Filter by who">${FILTERS.map(([k, l]) => html`<button data-action="filter" data-id="${k}" aria-pressed="${ui.filter === k}">${l} <span class="dim">${counts[k]}</span></button>`)}</div>
          <label class="visually-hidden" for="au-q">Search the audit log</label>
          <input id="au-q" class="input au-q" type="text" data-action="q" placeholder="Search: machine, person, action…" value="${ui.q}" autocomplete="off">
        </div>
        <ul class="au-legend small muted" aria-label="Who did it"><li><span class="actor ai">${icon('ai')}AI</span>made by Nirantar</li><li><span class="actor person">${icon('user')}Person</span>a human decision</li><li><span class="actor system">${icon('layers')}System</span>automatic step</li><li><span class="actor blocked">${icon('shield')}Blocked</span>refused by a guardrail</li></ul>
        <div data-live="audit">${auditList(store)}</div>
      </section>

      <section class="card" aria-label="Model card">
        <div class="card-head"><h2>Model card</h2><span class="sub">what the model uses, how it scores, and its limits</span></div>
        ${modelCard(W, M, store)}
      </section>

      <section class="card ok closing" aria-label="Tour complete">
        <h2>${icon('check')} Tour complete</h2>
        <p>You have seen the whole loop: <b>spot → understand → prioritise → decide → approve → ask why → measure → verify.</b></p>
        <p class="small muted">Every number on these pages came from the same synthetic plant and the same model, and every decision you made is in the audit log above.</p>
        <div class="row"><a class="btn primary" href="#/">${icon('home')} Back to Home</a><button class="btn" data-action="data-menu">${icon('data')} Try another scenario</button></div>
      </section>

      ${nextBack('trust')}
    </div>`);

    const policyBox = root.querySelector('[data-live="policy"]'), out = root.querySelector('[data-live="th-out"]');
    const repaint = () => { if (policyBox) policyBox.innerHTML = String(policyLive(M, W, applied, ui.th, half)); if (out) out.textContent = fmtTh(ui.th); };
    return delegate(root, {
      th: el => { const v = r2(+el.value); if (v === ui.th) return; ui.th = v; ui.confirm = false; repaint(); },
      'reset-th': () => { ui.th = applied; ui.confirm = false; const r = root.querySelector('#th-range'); if (r) r.value = fmtTh(applied); repaint(); },
      apply: () => { if (Math.abs(ui.th - applied) < 0.005) return; ui.confirm = true; ui.name = ui.name || store.prefs.name || ''; repaint(); root.querySelector('#pol-name')?.focus(); },
      'apply-no': () => { ui.confirm = false; repaint(); },
      'pol-name': el => { ui.name = el.value; },
      'apply-yes': () => {
        const name = (ui.name || '').trim() || store.prefs.name || 'You';
        if (ui.name.trim()) { store.prefs.name = ui.name.trim(); S.savePrefs(); }
        const from = applied, to = ui.th;
        ui.confirm = false;
        S.audit(name, 'Changed the alert policy', 'Model', `threshold ${fmtTh(from)} → ${fmtTh(to)}`, 'human');
        S.toast({ kind: 'ok', title: `Alert policy changed to ${fmtTh(to)}`, body: `Logged with your name (${name}) at ${dateTime(store.state.simNow)}.` });
        S.setThreshold(to);
        S.changed('policy');
      },
      ep: el => { ui.ep = Math.max(0, (ui.ep || 0) + +el.dataset.d); ctx.rerender(); },
      filter: el => { ui.filter = el.dataset.id; ui.limit = 40; ctx.rerender(); },
      q: (el, ev) => { if (ev.type === 'click') return; ui.q = el.value; ui.limit = 40; refreshAudit(root, store); },
      more: () => { ui.limit += 40; refreshAudit(root, store); },
      csv: () => {
        const rows = auditRows(store);
        download(`nirantar-audit-log-${isoDate(store.state.simNow)}.csv`, toCsv([['time_ist', r => istStamp(r.ts)], ['actor', r => r.actor], ['kind', r => r.kind || 'human'], ['action', r => r.action], ['target', r => r.target], ['detail', r => r.detail]], rows), 'text/csv;charset=utf-8');
        S.toast({ kind: 'ok', title: 'Audit log downloaded', body: `${int(rows.length)} rows as CSV${ui.filter !== 'all' || ui.q ? ' (with your filter)' : ''}.` });
      },
      'eval-rerun': () => { ui.evalRes = null; ui.evalErr = null; fillEval(); runEval(store); },
      'goto-eval': () => { document.getElementById('trust-eval')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    }, ['click', 'input']);
  },
};
