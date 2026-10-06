// Step 2 · Understand: what exactly is wrong, and how sure are we? A role switch re-orders the evidence cards.
// Charts are drawn at the measured card width so SVG text keeps its real size on a phone.
import { html, icon, delegate, raw, esc } from '../ui/dom.js';
import { lineChart, barsH, sparkline, pfCurve, zoneRuler, interval, ring, spectrum } from '../ui/charts.js';
import { pageHead, caseStrip, headline, doThis, marker, kpi, stateChip, aiChip, humanChip, term, confPct, nextBack, heroId, table, STATE_TEXT } from '../ui/components.js';
import { HEALTH_FORMULA, CONF_NOTE } from '../core/scoring.js';
import { FAILURE_MODES } from '../core/generator.js';
import { gauss } from '../core/rng.js';
import { inr, num, hours, day, weekday, time, dateTime, inHours, HOUR, MIN, DAY } from '../core/format.js';

let ui = { role: 'head', mode: null, modeFor: null, tlWin: 7 };

const ROLES = [['head', 'Plant head'], ['planner', 'Planner'], ['tech', 'Technician']];
// Card order per role: half cards pair up on desktop, FULL cards span the row. The IT + OT timeline sits high for
// every role, right after the role's first row.
const ORDER = {
  head: ['decision', 'pf', 'timeline', 'kpis', 'main', 'agree', 'spares', 'history', 'why', 'anomaly', 'modes', 'multi', 'spectrum', 'limits'],
  planner: ['kpis', 'pf', 'spares', 'timeline', 'history', 'decision', 'agree', 'main', 'modes', 'why', 'anomaly', 'multi', 'spectrum', 'limits'],
  tech: ['kpis', 'main', 'timeline', 'multi', 'agree', 'why', 'spectrum', 'anomaly', 'pf', 'modes', 'history', 'spares', 'decision', 'limits'],
};
const FULL = new Set(['kpis', 'timeline', 'main', 'multi', 'spectrum', 'modes', 'history', 'limits']);
const THIRD = { head: 'decision', planner: 'spares', tech: 'spectrum' };   // the role's own do-this target card
// ISO 10816-3 group 2 vibration severity zones (mm/s RMS): a published standard, not a model output.
const ISO_ZONES = [[0, 2.3, 'A', 'normal'], [2.3, 4.5, 'B', 'normal'], [4.5, 7.1, 'C', 'watch'], [7.1, 11.2, 'D', 'act']];
// Spectrum fingerprint each vibration failure mode leaves: [feature key, plain words].
const SPEC_SIG = { 'FM-01': ['bearing', 'bearing-defect peaks'], 'FM-04': ['misalign', 'high 2X'], 'FM-05': ['imbalance', 'high 1X'], 'FM-07': ['cavitation', 'raised noise floor'] };
const TH = 0.5;   // learned alert threshold on the anomaly score (= health below 50)

const fv = (tag, v) => `${num(v, Math.abs(v) >= 100 ? 0 : 1)} ${tag.unit}`;
const hz = f => `${num(f, f >= 100 ? 0 : 1)} Hz`;
const lc = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const r15 = ms => Math.round(ms / (15 * MIN)) * 15 * MIN;   // predicted times are estimates: keep them on the 15-min grid
const when = ms => `${weekday(r15(ms))} ${day(r15(ms))} ${time(r15(ms))}`;
const wt = x => `${weekday(x)} ${time(x)}`;
const toneOf = s => (s === 'act' || s === 'normal' ? s : 'watch');
const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const pct = s => `${Math.round(s * 100)} %`;
const likelyR = (x, sep = ' to ') => `likely ${hours(x.rulLo)}${sep}${hours(x.rulHi)}`;
const card = (head, body, cls = '') => html`<section class="card ${cls}"><div class="card-head">${head}</div>${body}</section>`;
const yes = (ok, y, n) => (ok ? html`<span class="state watch">${icon('check')}${y}</span>` : html`<span class="state normal">${icon('x')}${n}</span>`);

// Content width, so each chart is drawn 1:1 with its card (mirrors the 720 / 1100 px breakpoints in machine.css).
function dims(root) {
  const cs = getComputedStyle(root);
  const cw = Math.max(300, root.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  const vw = window.innerWidth, wide = vw >= 1100, mid = vw >= 720, full = Math.round(cw - 30), mc = wide ? 3 : mid ? 2 : 1;
  return { cw, full, phone: !mid, wide, half: wide ? Math.round((cw - 16) / 2 - 30) : full,
    kpiW: wide ? Math.round((cw - 48) * 1.25 / 4.2 - 30) : mid ? Math.round((cw - 16) / 2 - 30) : full,
    multi: Math.round((full - (mc - 1) * 12) / mc - 18) };
}

// One sensor: now vs 3 days ago (model trend, no noise), how far towards trip, and a verdict in plain words.
function tagInfo(M, a, tag, t, sf) {
  const now = M.trendAt(a, tag.key, t), past = M.trendAt(a, tag.key, t - 72 * HOUR);
  const low = tag.dir === 'low', dev = M.deviation(tag, now), frozen = !!(sf && sf.tag === tag.key);
  const beyond = !frozen && (low ? now < tag.alarm : now > tag.alarm);
  const worse = low ? past - now : now - past;
  const moving = !frozen && dev > 0.05 && worse > Math.abs(tag.trip - tag.normal) * 0.03;
  const bad = moving || beyond;
  const delta = tag.group === 'temp' ? `${worse >= 0 ? '+' : '−'}${num(Math.abs(now - past), 0)} ${tag.unit}` : low ? `down ${Math.round((past - now) / past * 100)} %` : `${(now / past).toFixed(1)}×`;
  const word = frozen ? 'Frozen' : bad ? (low ? 'Falling' : 'Rising') : 'Normal';
  const text = frozen ? `Frozen: no change for ${Math.round(sf.sinceH)} h (a sensor fault, not wear)`
    : moving ? `${word}: ${delta} in 3 days, ${beyond ? 'past the alarm line' : `still ${low ? 'above' : 'below'} the alarm line`}`
    : beyond ? 'Past the alarm line, but not getting worse' : 'Normal: steady, inside its normal band';
  return { tag, now, past, dev, frozen, beyond, moving, bad, delta, word, text, tone: frozen ? 'watch' : beyond ? 'act' : moving ? 'watch' : 'normal' };
}

// First time the trend crossed the alarm line in the current excursion (15-min steps, up to 96 h back).
function firstCross(M, a, tag, t) {
  const bad = v => (tag.dir === 'low' ? v < tag.alarm : v > tag.alarm);
  if (!bad(M.trendAt(a, tag.key, t))) return null;
  let first = t;
  for (let k = 1; k <= 384; k++) { const tt = t - k * 15 * MIN; if (bad(M.trendAt(a, tag.key, tt))) first = tt; else break; }
  return first;
}

// Spectrum features: peak heights at 1X, 2X, BPFO, BPFI against the median noise floor.
function specFeat(sp) {
  const bin = sp.fmax / 420 * 1.6;
  const amp = f => sp.pts.reduce((m, [x, y]) => (Math.abs(x - f) <= bin ? Math.max(m, y) : m), 0);
  const ys = sp.pts.map(p => p[1]).sort((x, y) => x - y), floor = ys[ys.length >> 1];
  const a1 = amp(sp.fr), a2 = amp(2 * sp.fr), bpfo = amp(sp.bf.BPFO), bpfi = amp(sp.bf.BPFI);
  return { a1, a2, bpfo, bpfi, floor, bearing: bpfo > Math.max(0.3, 5 * floor), imbalance: a1 > 1, misalign: a2 > 0.5 && a2 > 0.5 * a1, cavitation: floor > 0.1 };
}

// Failure modes that fit this machine's sensors, scored 60 % on how many signature signals move now and 40 % on
// whether the spectrum shows their fingerprint (only when the machine has a vibration sensor).
function modeCheck(infos, feat, ass) {
  const anyFeat = feat && ['bearing', 'misalign', 'imbalance', 'cavitation'].some(k => feat[k]);
  return Object.entries(FAILURE_MODES).filter(([id, fm]) => {
    const n = fm.signals.filter(k => infos[k]).length;
    return id === ass.mode || (n >= Math.max(1, fm.signals.length - 1) && n >= Math.min(2, fm.signals.length));
  }).map(([id, fm]) => {
    const sig = fm.signals.filter(k => infos[k]).map(k => infos[k]);
    const sigScore = sig.length ? sig.reduce((s, i) => s + (i.bad ? Math.min(1, 0.4 + 2 * i.dev) : 0), 0) / sig.length : 0;
    const spec = SPEC_SIG[id], specOk = feat && spec ? !!feat[spec[0]] : null;
    const specScore = !feat ? null : spec ? +specOk : anyFeat ? 0 : 0.5;
    return { id, fm, sig, spec, specOk, score: sigScore <= 0 ? 0 : specScore == null ? sigScore : 0.6 * sigScore + 0.4 * specScore };
  }).sort((x, y) => y.score - x.score || (x.id === ass.mode ? -1 : y.id === ass.mode ? 1 : 0));
}

export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, t = store.t;
    const a = M.assetById(params[0]) || M.assetById(heroId());
    if (ui.modeFor !== a.id) { ui.mode = null; ui.modeFor = a.id; }
    const d = dims(root), ass = M.assess(a, t), sf = ass.sensorFault;
    const site = M.siteById(a.siteId);
    const infos = Object.fromEntries(a.tags.map(tag => [tag.key, tagInfo(M, a, tag, t, sf)]));
    const abnormal = ass.state === 'act' || ass.state === 'watch';
    const main = infos[sf ? sf.tag : ass.worstKey], mt = main.tag;
    const sfStart = sf ? t - sf.sinceH * HOUR : null;
    const sp = a.tags.some(x => x.key === 'VIB_RMS') ? M.spectrum(a, sf && /VIB/.test(sf.tag) ? sfStart : t) : null;
    const feat = sp ? specFeat(sp) : null;
    const modes = ass.state === 'sensor' ? [] : modeCheck(infos, feat, ass);
    const likely = ass.mode ? modes.find(m => m.id === ass.mode) : modes[0] && modes[0].score >= 0.3 ? modes[0] : null;
    const byNew = (x, y) => y.createdAt - x.createdAt;
    const alerts = (store.state.alerts || []).filter(x => x.assetId === a.id).sort(byNew);
    const alert = alerts.find(x => x.status !== 'CLOSED') || alerts[0] || null;
    const wo = store.state.workOrders.filter(w => w.assetId === a.id && !['DONE', 'REJECTED'].includes(w.status)).sort(byNew)[0] || null;
    const trend = ass.rulKind === 'trend' && abnormal;
    const c = { S, M, W, ST: store.state, prefs: store.prefs, t, a, ass, sf, sfStart, d, site, infos, main, mt, sp, feat, modes, likely, alert, wo, trend,
      line: M.lineById(a.lineId), cross: abnormal ? firstCross(M, a, mt, t) : null, fault: M.activeFault(a, t),
      sel: modes.find(m => m.id === ui.mode) || likely || modes[0] || null, win: wo ? wo.window || wo.proposedWindow : null,
      F: trend ? t + ass.rulH * HOUR : null, conseq: alert && alert.status !== 'CLOSED' && alert.type === 'CONSEQUENCE' ? alert : null };

    // previous / next abnormal machine across the fleet, ranked by attention
    const ab = W.assets.map(x => [x, M.assess(x, t)]).filter(([, s]) => s.state !== 'normal').map(([x, s]) => [x.id, S.attention(x, s).score]).sort((p, q) => q[1] - p[1]).map(r => r[0]);
    const ix = ab.indexOf(a.id), cyc = ab.length && !(ab.length === 1 && ix === 0);
    c.rank = { ix, n: ab.length };
    const prevId = cyc ? ab[ix < 0 ? ab.length - 1 : (ix - 1 + ab.length) % ab.length] : null;
    const nextId = cyc ? ab[ix < 0 ? 0 : (ix + 1) % ab.length] : null;
    const navBtn = (id, label, next) => html`<button class="btn ${next ? 'next' : ''}" data-action="go" data-id="${id || ''}" ${id ? '' : raw('disabled')}>${next ? '' : icon('arrowL')}<span class="m-navt"><span>${label} abnormal</span><b class="mono">${id || 'none'}</b></span>${next ? icon('arrowR') : ''}</button>`;

    const third = ass.state === 'normal' ? null : THIRD[ui.role] === 'spectrum' && !sp ? 'why' : THIRD[ui.role];
    const cards = { kpis, decision, pf, timeline, main: mainCard, multi, spectrum: specCard, why: whyCard, anomaly, modes: modesCard, agree, history, spares, limits };
    const seq = ORDER[ui.role].filter(k => k === 'main' || k === 'agree' || k === 'timeline' || k === third);   // do-this targets in reading order
    c.mk = k => seq.indexOf(k) + 1;
    const body = ORDER[ui.role].map(k => { const h = cards[k](c, c.mk(k)); return h ? html`<div class="m-cell ${FULL.has(k) ? 'full' : ''}">${h}</div>` : ''; });

    root.innerHTML = String(html`<div class="page mpage">
  ${pageHead('machine')}
  ${caseStrip(a.id)}
  ${headLine(c)}
  <section class="card m-bar" aria-label="Choose a machine and a view">
  <div class="field m-pick"><label for="m-pick">Machine at ${site.name}</label>
  <select id="m-pick" class="input" data-action="pick">${W.lines.filter(l => l.siteId === a.siteId).map(l => html`<optgroup label="${l.name}">${W.assets.filter(x => x.lineId === l.id).map(x => { const st = M.assess(x, t).state; return html`<option value="${x.id}" ${x.id === a.id ? raw('selected') : ''}>${x.id}${st !== 'normal' ? ` (${STATE_TEXT[st]})` : ''} · ${x.name}</option>`; })}</optgroup>`)}</select></div>
  <div class="m-nav" role="group" aria-label="Abnormal machines across all plants">${navBtn(prevId, 'Previous')}${navBtn(nextId, 'Next', true)}</div>
  <div class="field m-role"><span class="m-lbl" id="m-role-l">Show it for</span>
  <div class="seg" role="group" aria-labelledby="m-role-l">${ROLES.map(([k, l]) => html`<button data-action="role" data-id="${k}" aria-pressed="${ui.role === k}">${l}</button>`)}</div></div>
  </section>
  ${doThis(todo(c))}
  <div class="m-grid">${body}</div>
  <div class="m-actions" aria-label="Next actions">
  <a class="btn primary" href="#/triage">${icon('alert')} Open 3 · Alert Triage</a>
  <a class="btn" href="#/whatif/${a.id}">${icon('decide')} What if we wait? (${a.id})</a>
  <a class="btn ai" href="#/copilot">${icon('chat')} Ask the copilot about ${a.id}</a>
  </div>
  ${nextBack('machine')}
  </div>`);

    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { const n = dims(root); if (Math.abs(n.cw - d.cw) > 24 || n.phone !== d.phone || n.wide !== d.wide) ctx.rerender(); }, 180); };
    window.addEventListener('resize', onResize);
    const off = delegate(root, {
      pick: (el, ev) => { if (ev.type === 'change' && el.value !== a.id) ctx.navigate('#/machine/' + el.value); },
      go: el => { if (el.dataset.id) ctx.navigate('#/machine/' + el.dataset.id); },
      role: el => { ui.role = el.dataset.id; ctx.rerender(); },
      mode: el => { ui.mode = el.dataset.id; ctx.rerender(); },
      tlwin: el => { ui.tlWin = +el.dataset.id; ctx.rerender(); },
    }, ['click', 'change']);
    // The live strip ticks every simulated minute on its own timer: the page itself only re-renders on 15-min model steps.
    const live = setInterval(() => tlLiveTick(root, c), 1000);
    const offTip = tlTips(root);
    return () => { off(); offTip(); clearInterval(live); window.removeEventListener('resize', onResize); clearTimeout(timer); };
  },
};

// ---------- headline + do this ----------
function headLine(c) {
  const { a, ass, sf, main, mt, cross, infos, conseq, M } = c;
  if (ass.state === 'sensor') return headline(html`<b>${a.id}</b>: the <b>${lc(sf.label)}</b> sensor looks <b>frozen</b>. ${sf.reason}. That is a sensor fault, not machine wear, so Nirantar asks for a sensor check (SOP-50) and sends <b>no repair crew</b>.`, 'watch');
  if (ass.state === 'normal') {
    const watched = list(a.tags.filter(x => ['vib', 'temp', 'elec'].includes(x.group)).slice(0, 3).map(x => lc(x.label)));
    return headline(html`<b>${a.id}</b> (${lc(a.name)}) is <b>healthy</b>: health ${ass.health} of 100 and all ${a.tags.length} sensors are inside their normal band. Nirantar keeps watching ${watched} every 15 minutes${ass.iso ? `; vibration sits in ISO zone ${ass.iso.zone} (${ass.iso.text})` : ''}.`, 'ok');
  }
  const change = mt.dir === 'low' ? html`has fallen <b>${Math.round((main.past - main.now) / main.past * 100)} %</b> in 3 days to <b>${fv(mt, main.now)}</b>` : html`is <b>${(main.now / main.past).toFixed(1)}×</b> its level 3 days ago (<b>${fv(mt, main.now)}</b>)`;
  const near = Math.abs(main.now - mt.alarm) < Math.abs(mt.trip - mt.normal) * 0.03;
  const crossed = cross ? html` and crossed its alarm line (${fv(mt, mt.alarm)}) on <b>${when(cross)} IST</b>` : html`, ${near ? 'right at' : 'heading for'} its alarm line (${fv(mt, mt.alarm)})`;
  const tp = Object.values(infos).find(i => i.tag.group === 'temp' && i.tag !== mt && Math.abs(i.now - i.past) >= 3);
  return headline(html`<b>${a.id}</b> shows <b>${ass.modeName ? lc(ass.modeName) : 'abnormal readings'}</b>: ${lc(mt.label)} ${change}${crossed}${tp ? html`; ${lc(tp.tag.label)} is ${tp.now > tp.past ? 'up' : 'down'} <b>${num(Math.abs(tp.now - tp.past), 0)} ${tp.tag.unit}</b>` : ''}. ${conseq ? html`The cause is upstream: <b>${conseq.rootCause}</b> (${lc(M.assetById(conseq.rootCause).name)}) is failing, so fix that first; ${a.id} itself is not wearing.` : html`Nirantar is <b>${confPct(ass.conf)}</b> sure a real failure is developing.`}`, ass.state === 'act' ? 'act' : 'watch');
}

function todo({ ass, mt, sf, trend, mk }) {
  const m = k => marker(mk(k)), N = ass.state === 'normal';
  const say = {
    timeline: ass.state === 'sensor' ? html`Read the IT + OT timeline ${m('timeline')}: the ${lc(sf.label)} line goes flat while the other sensors keep moving, and Nirantar asked for a sensor check, not a repair crew.`
      : N ? html`Read the IT + OT timeline ${m('timeline')}: sensors, maintenance records and orders on one time axis; the sentence under it says what lines up.`
      : html`Read the IT + OT timeline ${m('timeline')} top to bottom: sensors, maintenance and ERP records and Nirantar's actions on one time axis; the sentence under it says what lines up.`,
    main: N ? html`Read the main chart ${m('main')}: ${lc(mt.label)} stays flat, far below its alarm line.` : html`Read the main chart ${m('main')}: ${lc(mt.label)} over the last 72 hours against its alarm and trip lines${trend ? ", with Nirantar's forecast" : ''}.`,
    agree: N ? html`Compare with the other sensors ${m('agree')}: all of them are normal too.` : ass.state === 'sensor' ? html`Compare with the related sensors ${m('agree')}: they keep moving while this one is flat, so it is the sensor, not the machine.`
      : html`Compare with the healthy sensors ${m('agree')}: when the related sensors agree, it is real wear, not a sensor fault.`,
    decision: html`Check the money at stake and what needs deciding ${m('decision')}.`,
    spares: html`Check the spare part and the repair window ${m('spares')} before you plan the job.`,
    spectrum: html`Read the vibration spectrum ${m('spectrum')} to see which part is damaged.`,
    why: html`Read why health is ${ass.health} ${m('why')}: which sensors pull it down.`,
  };
  const items = ORDER[ui.role].filter(k => mk(k)).map(k => say[k]);
  return N ? [...items, html`Nothing to decide here. Press <b>Next abnormal</b> above to see a machine that needs attention.`] : items;
}

// ---------- cards ----------
function kpis({ W, t, ass, a, d }) {
  const tone = toneOf(ass.state), wear = ass.rulKind !== 'trend', iso = ass.iso;
  const u = ass.rulH >= 240 ? 24 : 1;   // same hours-to-days switch as hours()
  return html`<div class="m-kpis">
  <div class="card kpi m-health ${tone === 'normal' ? '' : tone}"><div class="k-label">${term('Health', HEALTH_FORMULA)}</div>
  <div class="m-ring">${ring({ value: ass.health, tone, label: `Health ${ass.health} out of 100` })}<div class="k-mean">0 failed,<br>100 new</div></div></div>
  ${kpi({ label: 'Failure confidence', value: confPct(ass.conf), tone: ass.conf >= 0.8 ? 'act' : ass.conf >= 0.15 ? 'watch' : '', mean: 'how sure Nirantar is that a real failure is developing (not noise or a sensor fault)', tip: CONF_NOTE })}
  <div class="card kpi wide ${wear ? '' : tone}"><div class="k-label">${term('Time to failure', 'When the worst sensor reaches its trip level at the current rate (80 % range). With no trend: an age-based wear estimate.')}</div>
  <div class="k-value">About ${hours(ass.rulH)}</div><div class="k-mean"><b>${likelyR(ass)}</b>${wear ? ' · normal wear, no trend' : ''}</div>
  ${interval({ lo: ass.rulLo / u, mid: ass.rulH / u, hi: ass.rulHi / u, max: ass.rulHi / u * 1.15, unit: u > 1 ? ' d' : ' h', w: d.kpiW, title: 'Time to failure range' })}
  <div class="xs dim">Last calculated ${dateTime(t)} · trained on ${W.backtest.windowDays} days and ${W.backtest.episodes.length} past failures</div></div>
  ${iso ? html`<div class="card kpi wide ${iso.zone === 'D' ? 'act' : iso.zone === 'C' ? 'watch' : ''}"><div class="k-label">${term('ISO vibration zone', 'ISO 10816-3 vibration zones: A new, B fine long-term, C plan a repair soon, D damage occurring.')}</div>
  <div class="k-value">Zone ${iso.zone}</div><div class="k-mean">${iso.text} (${num(iso.v, 1)} mm/s)</div>
  ${zoneRuler({ v: iso.v, unit: 'mm/s', zones: ISO_ZONES, w: d.kpiW, title: 'ISO vibration zone' })}</div>`
      : kpi({ label: 'Criticality', value: a.criticality, mean: { A: 'stops a whole line when it fails', B: 'slows a line when it fails', C: 'has a workaround' }[a.criticality], tip: 'No vibration sensor, so no ISO zone.' })}
  </div>`;
}

function decision(c, mk) {
  const { M, t, a, ass, wo, win, F, trend, line } = c;
  const head = html`${mk ? marker(mk) : ''}<h2>Money, time and the decision</h2>${humanChip('Your decision')}`;
  if (ass.state === 'normal') return card(head, html`<p>Nothing at stake and nothing to decide. For scale: when ${a.id} stands still the ${line.name.toLowerCase()} loses about <b>${inr(M.exposure(a, null).costPerH)}</b> per hour.</p>`);
  if (ass.state === 'sensor') return card(head, html`<p>No wear, so no production is at stake. ${wo ? html`The sensor check <b>${wo.id}</b> costs <b>${inr(wo.costs.total)}</b> and needs no stop.` : 'A sensor check needs no production stop.'}</p>${wo ? woLine(wo) : ''}`, 'watch');
  const mode = ass.mode || (c.likely && c.likely.id);
  const ex = M.exposure(a, mode), pc = mode ? M.plannedCost(a, mode) : null, op = M.orderPressure(a.lineId, t);
  return card(head, html`<dl class="m-dl">
  <dt>At stake if it breaks</dt><dd><b>${inr(ex.inr)}</b> (${hours(ex.downH)} down × ${inr(ex.costPerH)}/h${ex.plan && ex.plan.kind !== 'local' ? `, mostly waiting ${ex.plan.etaH} h for the part from ${ex.plan.from === 'Supplier' ? 'the supplier' : M.siteById(ex.plan.from).city}` : ''})</dd>
  ${pc ? html`<dt>Planned repair</dt><dd><b>${inr(pc.total)}</b> (part ${inr(pc.parts)} + labour ${inr(pc.labour)})${ex.inr >= 2 * pc.total ? `: about 1/${Math.round(ex.inr / pc.total)} of a breakdown` : ex.inr > pc.total ? `: ${inr(ex.inr - pc.total)} less than a breakdown, and no surprise stop` : ''}</dd>` : ''}
  <dt>Time left</dt><dd>${trend ? html`About <b>${hours(ass.rulH)}</b> (${likelyR(ass)}), so failure around ${when(F)} IST` : 'No clear trend yet'}</dd>
  ${op.order ? html`<dt>Order at risk</dt><dd>${op.order.customer} (${op.order.id}, ${inr(op.order.valueInr)}) due ${when(op.order.due)} IST on this line</dd>` : ''}
  ${win ? html`<dt>Repair window</dt><dd>${when(win.start)} IST, ${win.reason}${win.beforeFailure ? ', before the predicted failure' : ': after the predicted failure, expedite the part'}</dd>` : ''}
  </dl>${wo ? woLine(wo) : html`<p class="small">No work order yet: Nirantar drafts one when health drops below 50 or failure confidence reaches 80 %.</p>`}`, ass.state === 'act' ? 'act' : 'watch');
}
function woLine(wo) {
  const ap = wo.approvals[0], pend = wo.status === 'PENDING_APPROVAL';
  const txt = pend ? html`${aiChip('Drafted by Nirantar')} <b>${wo.id}</b> waits for a person to approve it.`
    : wo.status === 'IN_PROGRESS' ? html`<span class="state ok">${icon('wrench')}In progress</span> <b>${wo.id}</b> started ${when(wo.startedAt)} IST.`
    : html`<span class="state ok">${icon('check')}${ap ? `${ap.action} by ${ap.by}` : 'Approved'}</span> <b>${wo.id}</b>${wo.window ? ` planned ${when(wo.window.start)} IST` : ''}.`;
  return html`<div class="m-wo"><p>${txt}</p><a class="btn ${pend ? 'primary' : ''}" href="#/orders">${icon('orders')} ${pend ? 'Review and approve' : 'Open'} in 5 · Work Orders</a></div>`;
}

function pf({ M, t, a, ass, fault, alert, win, trend, F, d, wo }) {
  let P = fault ? fault.onset : alert ? alert.createdAt : null;
  if (!P && trend) for (let h = 1; h <= 96; h++) if (M.assess(a, t - h * HOUR).state === 'normal') { P = t - (h - 1) * HOUR; break; }
  const head = html`<h2>Where it is on the P-F curve</h2>${aiChip('Placed by Nirantar')}`;
  const cap = html`<p class="chart-caption">Condition stays flat, then falls ever faster from the first detectable sign (P) to failure (F). The earlier P is spotted, the more time to plan the repair.</p>`;
  if (!trend || !P || P >= F) return card(head, html`${pfCurve({ w: d.half, h: 190, now: 0.1, labels: { now: 'Now' }, title: 'P-F curve' })}
  <p><b>${a.id} sits on the flat part of the curve:</b> ${ass.state === 'sensor' ? 'the machine itself is not wearing; only a sensor is frozen.' : 'no sign of wear yet.'} ${ass.rulKind === 'wear' ? `Age-based wear estimate: about ${hours(ass.rulH)}.` : ''}</p>${cap}`);
  const X = ms => 0.2 + 0.72 * (ms - P) / (F - P);
  const wf = win && win.start < F ? [Math.max(X(t), X(win.start)), Math.min(0.95, X(win.end))] : null;
  return card(head, html`${pfCurve({ w: d.half, h: 200, detect: 0.2, now: X(t), window: wf, fail: 0.92, labels: { detect: 'P: first sign', now: 'Now', window: wf && 30 + wf[0] * (d.half - 48) + 90 > d.half ? 'Repair' : 'Repair window', fail: 'F: failure' }, title: 'P-F curve: first sign, now, repair window, failure' })}
  <ul class="m-pf-list">
  <li><span class="sw ai"></span><b>P, first sign:</b> ${when(P)} IST (${inHours(P, t)})</li>
  <li><span class="sw ink"></span><b>Now:</b> ${when(t)} IST, health ${ass.health}</li>
  ${wf ? html`<li><span class="sw ok"></span><b>${wo && wo.window ? 'Planned repair' : 'Proposed repair window'}:</b> ${when(win.start)} IST (${inHours(win.start, t)})</li>` : ''}
  <li><span class="sw act"></span><b>F, predicted failure:</b> about ${when(F)} IST (likely ${when(t + ass.rulLo * HOUR)} to ${when(t + ass.rulHi * HOUR)})</li>
  </ul>${cap}`, 'm-halo');
}

// Forecast from now to the trip level at today's rate; the cone runs between the fast (rulLo) and slow (rulHi) paths.
function forecast({ M, a, t, ass, mt, d }, H) {
  const v0 = M.trendAt(a, mt.key, t), sign = mt.dir === 'low' ? -1 : 1, dist = Math.abs(mt.trip - v0);
  const at = (h, r) => v0 + sign * dist * Math.min(1, h / r), lo = [], hi = [], end = Math.min(ass.rulH, H);
  for (let i = 0; i <= 16; i++) { const h = H * i / 16; hi.push([t + h * HOUR, at(h, ass.rulLo)]); lo.push([t + h * HOUR, at(h, ass.rulHi)]); }
  return { points: [[t, v0], [t + end * HOUR, at(end, ass.rulH)]], lo, hi,
    label: d.phone ? `Trip level in about ${hours(ass.rulH)}` : `Nirantar's estimate: trip level in about ${hours(ass.rulH)} (${likelyR(ass, '–')})` };
}

function mainCard(c, mk) {
  const { M, t, a, ass, main, mt, cross, trend, win, wo, sf, sfStart, d } = c;
  // span = 72 h history + forecast, in whole days so ticks land on the same clock time each day
  const fh = trend && mt.key === ass.worstKey ? (ass.rulHi <= 120 ? ass.rulHi : 72) : 0, k = d.phone ? 3 : 1;
  const days = Math.ceil((72 + fh) / 24 / k) * k, ahead = days * 24 - 72, xMax = t + ahead * HOUR;
  const fc = fh ? forecast(c, ahead) : null;
  const pts = M.series(a, mt.key, t - 72 * HOUR, t, 15);
  const limits = [{ y: mt.alarm, label: d.phone ? 'Alarm' : 'Alarm (watch)', tone: 'watch' }];
  if (ass.state !== 'normal') limits.push({ y: mt.trip, label: d.phone ? 'Trip' : 'Trip (act now)', tone: 'act' });
  const ann = [];
  if (cross && cross >= t - 72 * HOUR) ann.push({ x: cross, y: mt.alarm, label: `Alarm crossed ${day(cross)} ${time(cross)}`, tone: 'watch' });
  if (sf) ann.push({ x: Math.max(sfStart, t - 72 * HOUR), y: pts[pts.length - 1][1], label: `Frozen since ${day(sfStart)} ${time(sfStart)}`, tone: 'watch' });
  const planned = wo && wo.window, vb = fc && win && win.start < xMax ? [{ x0: win.start, x1: Math.min(win.end, xMax), tone: planned ? 'ok' : 'ai' }] : [];
  const chart = lineChart({ series: [{ name: mt.label, points: pts, tone: main.tone, width: 1.6 }], limits, now: t, forecast: fc, annotations: ann, vbands: vb,
    xType: 'time', xMin: t - 72 * HOUR, xMax, xTicks: d.phone ? Math.min(3, days) : days > 3 ? days : days * 2, xFmt: x => (d.phone && days > 3 ? `${weekday(x)} ${day(x)}` : wt(x)), unit: mt.unit,
    yMax: fc && mt.dir !== 'low' ? mt.trip + (mt.trip - Math.min(...pts.map(p => p[1]))) * 0.17 : undefined,
    w: d.full, h: d.phone ? 240 : 280, padL: 44, padR: d.phone ? 46 : 96, title: `${mt.label}, last 72 h` });
  const each = `Each point is a ${lc(mt.label)} reading taken every 15 minutes.`;
  const cap = sf ? html`${each} Since ${when(sfStart)} it is perfectly flat while the other sensors keep moving: real machines are never that still.`
    : ass.state === 'normal' ? html`${each} The line stays flat, far below the amber alarm line (${fv(mt, mt.alarm)}): nothing to forecast.`
    : html`${each} Amber dashed: alarm level (${fv(mt, mt.alarm)}); red: trip level, where it must stop (${fv(mt, mt.trip)}).${fc ? html` Blue dashed: Nirantar's forecast at today's rate, with its likely range shaded: trip level in about <b>${hours(ass.rulH)}</b> (${likelyR(ass)}).` : ''}${vb.length ? html` The ${planned ? 'green' : 'blue'} band is the ${planned ? 'planned' : 'proposed'} repair window, ${when(win.start)} IST.` : ''}`;
  return card(html`${marker(mk)}<h2>${mt.label}: ${sf ? 'the frozen sensor' : ass.state === 'normal' ? 'the main health signal' : 'the sensor that moved most'}</h2>${stateChip(main.tone, main.word)}${fc ? aiChip('Forecast by Nirantar') : ''}<span class="sub">last 72 h, every 15 min</span>`,
    html`${chart}<p class="chart-caption">${cap}</p>`, 'm-halo');
}

function multi({ M, t, a, infos, mt, d }) {
  const others = a.tags.filter(x => x !== mt);
  if (!others.length) return '';
  return card(html`<h2>Every other sensor on ${a.id}</h2><span class="sub">last 72 h · amber = moving towards its alarm line, grey = normal</span>`,
    html`<div class="m-multi">${others.map(tag => { const i = infos[tag.key]; return html`<figure class="m-sm"><figcaption><b>${tag.label}</b> ${stateChip(i.tone, i.word)}</figcaption>
  ${lineChart({ series: [{ name: tag.label, points: M.series(a, tag.key, t - 72 * HOUR, t, 30), tone: i.tone, width: 1.5 }], limits: [{ y: tag.alarm, label: 'Alarm', tone: 'watch' }], xType: 'time', xTicks: 2, xFmt: wt, unit: tag.unit, w: d.multi, h: 140, padL: 40, padR: 44, title: tag.label })}
  <p class="chart-caption">${i.text}. Now ${fv(tag, i.now)}.</p></figure>`; })}</div>`);
}

function specCard({ a, sp, feat, sf, sfStart, d, ass }, mk) {
  if (!sp) return '';
  const b = a.bearing, bf = sp.bf, frozen = sf && /VIB/.test(sf.tag);
  const shows = feat.bearing ? html`Bearing-defect peaks: BPFO (${hz(bf.BPFO)}) stands <b>${Math.round(feat.bpfo / feat.floor)}×</b> above the noise floor${feat.bpfi > 3 * feat.floor ? ', with BPFI and harmonics' : ''}, the fingerprint of a damaged bearing race.`
    : feat.imbalance ? html`1X (${hz(sp.fr)}) dominates at <b>${num(feat.a1, 1)} mm/s</b>, ${Math.round(feat.a1 / feat.a2)}× the 2X peak: the fingerprint of an unbalanced rotor (on a fan, usually build-up on the blades).`
    : feat.misalign ? html`2X (${hz(2 * sp.fr)}) is <b>${(feat.a2 / feat.a1).toFixed(1)}×</b> the 1X peak: the fingerprint of shaft misalignment (often after a motor change).`
    : feat.cavitation ? html`No single peak, but the whole noise floor is raised (<b>${num(feat.floor, 2)} mm/s</b>): typical of pump cavitation.`
    : html`Small 1X and 2X peaks over a flat floor, no defect peaks: <b>a healthy spectrum</b>.`;
  const freqs = [['1X', sp.fr, 'once per shaft turn; high = imbalance'], ['2X', 2 * sp.fr, 'twice per turn; high = misalignment or looseness'],
    ['BPFO', bf.BPFO, 'a ball rolling over an outer-ring defect'], ['BPFI', bf.BPFI, 'a ball rolling over an inner-ring defect'],
    ['BSF', bf.BSF, 'a damaged ball spinning against the rings'], ['FTF', bf.FTF, 'the cage that holds the balls (not drawn)']];
  return card(html`${mk ? marker(mk) : ''}<h2>${term('Vibration spectrum', 'Vibration split into frequencies (FFT). Each kind of damage shakes at its own frequency.')}: which part is shaking</h2><span class="sub">${frozen ? `last good capture, ${when(sfStart)}` : `now, 0 to ${num(sp.fmax, 0)} Hz`}</span>`,
    // fmax padded 12 % so the last tick label does not collide with the "Hz" unit label
    html`${spectrum({ pts: sp.pts, markers: sp.markers, fmax: sp.fmax * 1.12, w: d.full, h: d.phone ? 210 : 240, title: 'Vibration spectrum' })}
  <p class="chart-caption">Height = vibration at each frequency (mm/s). Blue dashed lines mark where each kind of damage would show.${frozen ? ' The sensor is frozen: this is its last good spectrum.' : ''}</p>
  <div class="m-spec-grid">
  <div class="stack"><p><b>What ${a.id}'s spectrum shows:</b> ${shows}${ass.modeName && feat[(SPEC_SIG[ass.mode] || [])[0]] ? html` It matches Nirantar's call, <b>${lc(ass.modeName)}</b>.` : ''}</p>
  <p class="small">Bearing <b>${b.model}</b>: ${b.n} balls of ${b.d} mm on a ${b.D} mm pitch circle, ${b.angle}° contact angle, shaft at ${num(a.rpm, 0)} rpm. Defect frequencies computed from this geometry:</p></div>
  <dl class="m-freq">${freqs.map(([k, f, txt]) => html`<dt><b>${k}</b> <span class="mono">${hz(f)}</span></dt><dd>${txt}</dd>`)}</dl>
  </div>`);
}

function whyCard({ ass, a, d, feat, infos }, mk) {
  const items = ass.contributions.map(x => ({ label: x.label, value: x.dev * 100, tone: x.dev > 0.3 ? 'act' : x.dev > 0.1 ? 'watch' : 'normal', strong: x.key === ass.worstKey && ass.worst > 0.05 }));
  const cross = [], n = Object.values(infos).filter(i => i.bad).length - 1;
  if (feat && ass.state !== 'normal' && ['bearing', 'imbalance', 'misalign', 'cavitation'].some(k => feat[k])) cross.push('the vibration spectrum');
  if (n > 0) cross.push(`${n} related sensor${n > 1 ? 's' : ''}`);
  return card(html`${mk ? marker(mk) : ''}<h2>Why is health ${ass.health}?</h2><span class="pill">model explanation, not proof of root cause</span>`,
    html`${barsH({ items, max: 100, fmt: v => `${Math.round(v)} %`, w: d.half, labelW: Math.min(170, Math.round(d.half * 0.42)), title: 'Health contributions' })}
  <p class="chart-caption">Each bar: how far a sensor has moved from normal towards trip (0 % normal, 100 % at trip).</p>
  <p class="small"><b>${HEALTH_FORMULA}</b></p>
  <p class="small mono m-calc">100 × (1 − ${ass.worst.toFixed(2)})^1.27 × (1 − ${ass.avg.toFixed(2)}) = ${ass.health}</p>
  <p class="small"><b>Cross-check:</b> ${ass.state === 'normal' ? 'nothing to explain, every sensor is at its normal level.' : ass.state === 'sensor' ? 'the frozen sensor is left out of the score, so it cannot raise a false alarm.' : cross.length ? `corroborated by ${list(cross)}.` : 'only one sensor so far, so treat it as an early warning.'}</p>`);
}

function anomaly({ M, t, a, ass, d }) {
  const pts = [];
  for (let k = 72; k >= 0; k--) pts.push([t - k * HOUR, 1 - M.assess(a, t - k * HOUR).health / 100]);
  let ci = -1;
  if (pts[72][1] > TH) { ci = 72; while (ci > 0 && pts[ci - 1][1] > TH) ci--; }
  const ann = ci > 0 ? [{ x: pts[ci][0], y: TH, label: d.phone ? 'Crossed' : `Crossed ${time(pts[ci][0])}`, tone: 'act' }] : [];
  return card(html`<h2>Anomaly score, last 72 h</h2>${aiChip('Scored by Nirantar')}`,
    html`${lineChart({ series: [{ name: 'Anomaly score', points: pts, tone: toneOf(ass.state), area: true, width: 1.8 }], limits: [{ y: TH, label: 'Threshold', tone: 'ai' }], annotations: ann, yMin: 0, yMax: 1, xType: 'time', xTicks: d.phone ? 2 : 3, xFmt: wt, yFmt: v => v.toFixed(2), w: d.half, h: 200, padL: 38, padR: 72, title: 'Anomaly score' })}
  <p class="chart-caption">Score = 1 − health ÷ 100, recomputed every hour (now <b>${pts[72][1].toFixed(2)}</b>). Blue dashed: the alert threshold learned from the back-test (${TH})${ci > 0 ? `; ${a.id} crossed it on ${when(pts[ci][0])} IST (${inHours(pts[ci][0], t)})` : ci === 0 ? `; ${a.id} has been above it for the whole 72 h` : `; ${a.id} stays below it`}.</p>`, 'm-halo');
}

function modesCard({ ass, modes, likely, sel, a, M, sf }) {
  const head = html`<h2>Failure-mode check</h2>${aiChip('Matched by Nirantar')}<span class="sub">which known patterns fit the evidence · press one to re-read it</span>`;
  if (ass.state === 'sensor') return card(head, html`<p>Not checked: the change comes from a frozen ${lc(sf.label)} sensor, not the machine. The other sensors show no failure pattern.</p>`);
  if (!modes.length) return '';
  const plan = sel ? M.partPlan(a, sel.id) : null;
  const verdict = !sel ? '' : sel.score >= 0.75 ? 'Matches strongly' : sel.score >= 0.4 ? 'Partly matches' : sel.score > 0 ? 'Weak match' : 'Does not match';
  return card(head, html`${likely ? '' : html`<p class="small">No failure mode matches yet: all signature signals are steady.</p>`}
  <div class="m-modes" role="group" aria-label="Failure modes: press one to re-read its evidence">
  <div class="m-mrow m-mhead" aria-hidden="true"><span>Failure mode</span><span>Signature signals now</span><span>Spectrum</span><span>Match</span></div>
  ${modes.map(m => html`<button class="m-mrow" data-action="mode" data-id="${m.id}" aria-pressed="${!!sel && sel.id === m.id}">
  <span class="m-mname"><b>${m.fm.name}</b>${likely && m.id === likely.id ? aiChip('Most likely') : ''}</span>
  <span class="m-sigs">${m.sig.map(i => html`<span class="state ${i.bad ? 'watch' : 'normal'}">${icon(i.bad ? 'arrowR' : 'check')}${i.tag.label}: ${i.bad ? lc(i.word) : 'steady'}</span>`)}</span>
  <span class="m-mspec">${m.specOk != null ? html`<span class="state ${m.specOk ? 'watch' : 'normal'}">Spectrum: ${m.specOk ? 'shows ' : 'no '}${m.spec[1]}</span>` : html`<span class="xs dim">spectrum not used</span>`}</span>
  <span class="m-match"><span class="bar ${m.score >= 0.4 ? 'ai' : ''}"><span style="width:${Math.round(m.score * 100)}%"></span></span><b class="mono">${pct(m.score)}</b></span>
  </button>`)}
  </div>
  ${sel ? html`<div class="m-evidence">
  <p><b>${sel.fm.name}</b>: ${verdict} (${pct(sel.score)}). Repair per ${sel.fm.sop}, about ${hours(sel.fm.repairH)}${plan ? `, part: ${plan.part.name}` : ''}.</p>
  <ul>${sel.sig.map(i => html`<li>${yes(i.bad, 'supports', 'no sign')} ${i.tag.label}: ${fv(i.tag, i.now)}, ${lc(i.text)}</li>`)}
  ${sel.specOk != null ? html`<li>${yes(sel.specOk, 'supports', 'no sign')} Spectrum: ${sel.specOk ? 'shows' : 'does not show'} ${sel.spec[1]}</li>` : ''}</ul>
  ${likely && sel.id !== likely.id ? html`<p class="small dim">Nirantar's call stays <b>${lc(likely.fm.name)}</b> (${pct(likely.score)}): it explains more evidence.</p>` : ''}
  </div>` : ''}`);
}

function agree({ M, t, a, ass, infos, sf, wo, likely }, mk) {
  const row = (i, ok) => html`<li><span><b>${i.tag.label}</b><br><span class="xs dim">${i.frozen ? 'frozen' : i.bad ? `${i.delta} in 3 days` : 'steady'}</span></span>${sparkline(M.series(a, i.tag.key, t - 72 * HOUR, t, 60), { tone: i.tone, w: 110, h: 30, title: i.tag.label })}${ok == null ? stateChip(i.tone, i.word) : yes(ok, 'agrees', 'not yet')}</li>`;
  const head = html`${marker(mk)}<h2>Sensor agreement</h2><span class="sub">real wear or a sensor fault?</span>`, all = Object.values(infos);
  const verdict = (ic, v) => html`<p class="m-verdict">${icon(ic)}<span>${v}</span></p>`;
  if (ass.state === 'sensor') return card(head, html`${verdict('sensor', html`<b>Sensor fault: the ${lc(sf.label)} sensor is frozen.</b> ${sf.reason}. <b>SOP-50:</b> check the cable and mounting, compare with a handheld meter, swap the sensor if needed. <b>Do not send a repair crew.</b>`)}
  <ul class="m-agree">${row(infos[sf.tag], null)}${all.filter(i => !i.frozen).map(i => row(i, null))}</ul>
  ${wo ? html`<p class="small">${aiChip('Drafted by Nirantar')} Sensor check <a href="#/orders">${wo.id}</a>, no production stop needed.</p>` : ''}`, 'watch');
  if (ass.state === 'normal') return card(head, html`${verdict('check', html`<b>All ${a.tags.length} sensors are in their normal band.</b> When one moves, Nirantar checks that the physically related sensors move with it.`)}
  <ul class="m-agree">${all.slice(0, 4).map(i => row(i, null))}</ul>`);
  const keys = new Set([...(likely ? likely.fm.signals : []).filter(k => infos[k]), ...all.filter(i => i.bad).map(i => i.tag.key)]);
  const rel = [...keys].map(k => infos[k]).sort((x, y) => y.dev - x.dev), ok = rel.filter(i => i.bad).length;
  const real = ok === rel.length && rel.length > 1, healthy = all.filter(i => !keys.has(i.tag.key));
  return card(head, html`${verdict(real ? 'check' : 'info', real ? html`<b>${rel.length === 2 ? 'Both' : `All ${rel.length}`} related sensors agree</b> → this is real wear, not a sensor fault.`
      : rel.length > 1 ? html`<b>${ok} of ${rel.length} related sensors agree</b> so far. Nirantar keeps watching until more confirm.`
      : html`<b>Only one sensor moves so far</b> (${lc(rel[0].tag.label)}). One sensor alone could be a sensor or process issue; Nirantar waits for a second.`)}
  <ul class="m-agree">${rel.map(i => row(i, i.bad))}</ul>
  ${healthy.length ? html`<p class="small dim">Unrelated sensors stay normal (${list(healthy.map(i => lc(i.tag.label)))}): the problem is local.</p>` : ''}`, real ? 'ai' : 'watch');
}

function history({ W, a, ass }) {
  const rows = W.history.filter(h => h.assetId === a.id), cms = rows.filter(h => h.type === 'CM');
  const names = [...new Set(cms.map(h => FAILURE_MODES[h.mode].short))], fm = FAILURE_MODES[ass.mode];
  let cap = !rows.length ? 'No maintenance on record for this machine.'
    : !cms.length ? `No breakdowns on record; ${rows.length} preventive service${rows.length > 1 ? 's' : ''}.`
    : `${cms.length} earlier breakdown${cms.length > 1 ? 's' : ''}, ${cms.length > 1 && names.length === 1 ? (cms.length === 2 ? 'both ' : 'all ') + names[0] : list(names)}`;
  if (cms.length && fm) {
    const same = cms.filter(h => h.mode === ass.mode).length;
    cap += same ? `; ${fm.short} has happened ${same === 1 ? 'once' : same + ' times'} before, so the same problem is back: look for the root cause` : `; this is the first ${fm.short} alert`;
  }
  if (cms.length) cap += '.';
  const tech = id => (W.technicians.find(x => x.id === id) || {}).name || '—';
  const kind = h => (h.type === 'CM' ? html`<span class="state watch">${icon('wrench')}Breakdown repair</span>` : html`<span class="state normal">${icon('check')}Preventive</span>`);
  return card(html`<h2>Maintenance history</h2><span class="sub">from the maintenance system (CMMS)</span>`,
    html`<p class="m-histcap"><b>${cap}</b></p>
  ${!rows.length ? '' : table({ caption: `Maintenance history of ${a.id}`, rows, cols: [{ label: 'Date', get: h => day(h.date) }, { label: 'Type', get: kind }, { label: 'Problem', key: 'title' },
        { label: 'Technician', get: h => tech(h.technician) }, { label: 'Duration', n: true, get: h => hours(h.durationH) }, { label: 'Cost', n: true, get: h => inr(h.costInr) }] })}`, 'm-hist');
}

function spares({ M, W, t, a, ass, site, F, sf, likely }, mk) {
  const head = html`${mk ? marker(mk) : ''}<h2>Spare part</h2>${aiChip('Checked by Nirantar')}`;
  const links = html`<div class="row"><a class="btn" href="#/spares">${icon('box')} Stock in all plants</a><a class="btn" href="#/orders">${icon('orders')} Work orders</a></div>`;
  if (sf) {
    const p = W.parts.find(x => x.for === 'SENSOR');
    return card(head, html`<p>${p ? html`If the sensor is faulty: <b>${p.name}</b>, ${p.stock[a.siteId] || 0} in stock here at ${site.city}.` : 'A replacement sensor is all that may be needed.'} No machine parts are needed.</p>${links}`);
  }
  const mode = ass.mode || (likely && likely.id), plan = mode ? M.partPlan(a, mode) : null;
  if (!plan) return card(head, html`<p>No part needed now. As soon as a failure mode is detected, Nirantar checks the right part in every plant and the transfer time.</p>${links}`);
  const p = plan.part, arr = t + plan.etaH * HOUR, what = html`<b>${p.name}</b> for ${lc(FAILURE_MODES[mode].name)}`;
  const txt = plan.kind === 'local' ? html`${what}: <b>${p.stock[a.siteId]} in stock here at ${site.city}</b>, ready now.`
    : plan.kind === 'transfer' ? html`${what}: <b>none at ${site.city}</b>; <b>${M.siteById(plan.from).city} has ${plan.qty}</b>, about <b>${plan.etaH} h</b> by road, so it arrives around ${when(arr)} IST${F ? (arr < F ? `, ${hours((F - arr) / HOUR)} before the predicted failure` : ', after the predicted failure: expedite it') : ''}.`
    : html`${what}: none in stock in any plant; the supplier needs about <b>${p.leadDays} days</b>.`;
  return card(head, html`<p>${txt} Unit cost ${inr(p.unitCost)}.</p>
  <ul class="m-stock" aria-label="Stock by plant">${W.sites.map(st => html`<li class="${st.id === a.siteId ? 'here' : ''}"><span>${st.city}${st.id === a.siteId ? ' (here)' : ''}</span><b class="mono">${p.stock[st.id] || 0}</b></li>`)}</ul>${links}`);
}

function limits({ a, ass, mt, W, sf }) {
  const note = W.docs.find(x => x.kind === 'Note' && x.text.includes(a.id));
  const rate = ass.slope > 0 && ass.state !== 'normal' && !sf ? `${num(ass.slope, 2)} ${mt.unit} per hour over the last 12 h` : null;
  const items = [
    ['Lubrication quality', 'No oil or grease analysis here: a dry bearing looks like a worn one until vibration rises.'],
    ['Operator reports not yet logged', note ? `Only written notes reach Nirantar (for ${a.id}: ${note.id}); a noise heard but not logged is invisible.` : 'A noise, smell or leak reaches Nirantar only when someone writes it down.'],
    ['Load changes outside the sensors', 'A harder material batch, a new program or a blunt tool can raise vibration and current without wear.'],
    ['The estimate assumes the current rate continues', rate ? `Today's rate is ${rate}. Wear often speeds up near the end, so the real time can be shorter than the middle estimate.` : 'With no trend, time to failure is an age-based average, not a prediction.'],
    ['Parts it has no sensor on', a.tags.length < 6 ? `${a.id} has only ${a.tags.length} sensors; unwatched parts fail without warning.` : 'Seals, belts and electrics without a sensor can fail without warning.'],
  ];
  return card(html`<h2>What this model cannot see</h2><span class="sub">read the estimate with these limits in mind</span>`,
    html`<ul class="m-limits">${items.map(([h, p]) => html`<li><b>${h}.</b> ${p}</li>`)}</ul>`);
}

// ---------- IT + OT on one timeline ----------
// OT (sensor lanes) and IT (CMMS work orders, ERP orders and spares) plus Nirantar's own actions share one IST time axis,
// so "what lines up" reads top to bottom. Series are computed once per model step (cached in tlCache); the live strip
// ticks every simulated minute from its own timer (tlLiveTick) without re-rendering the page.
const TL_WINS = [[7, '7 days'], [30, '30 days'], [120, '120 days']];
const TL_LANE = { sensor: 'Sensors', cmms: 'CMMS', erp: 'ERP', ai: 'Nirantar' };
const FILL = { normal: 'var(--normal)', watch: 'var(--watch-fill)', act: 'var(--act-fill)', ai: 'var(--ai-fill)', ok: 'var(--ok-fill)', ink: 'var(--ink-2)' };
const INK = { normal: 'var(--ink-2)', watch: 'var(--watch)', act: 'var(--act)', ai: 'var(--ai)', ok: 'var(--ok)', ink: 'var(--ink)' };
const GLYPH = { check: 'M-3.2 .2l2.2 2.3 4.3-4.6', x: 'M-2.6-2.6l5.2 5.2M2.6-2.6l-5.2 5.2', bang: 'M0-3.6v4M0 3.2v.2', arrow: 'M-3.6 0h6.4M.4-3l3 3-3 3', dot: 'M0 0h.01' };
const SPARK = 'M0-4.6l1.3 3.3 3.3 1.3-3.3 1.3L0 4.6l-1.3-3.3-3.3-1.3 3.3-1.3z';
const tlCache = new Map();
let c2d = null, tlFam = '';
const f1 = v => Math.round(v * 10) / 10;
const tw = ms => `${weekday(ms)} ${day(ms)} ${time(ms)}`;                         // exact event time
const agoH = h => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`);
const cap1 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const ordinal = n => ['first', 'second', 'third', 'fourth', 'fifth'][n] || `number ${n + 1}`;
const istDay0 = ms => Math.floor((ms + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;   // IST midnight at or before ms
const hlist = xs => (xs.length < 2 ? xs[0] || '' : html`${xs.slice(0, -1).map((x, i) => html`${i ? ', ' : ''}${x}`)} and ${xs[xs.length - 1]}`);
const tlName = (tag, role) => (role === 'speed' && tag.unit === 'rpm' ? `${tag.label} (RPM)` : tag.label);

// Width of a chart label (canvas, same font as the SVG text) so labels can be placed without overlapping.
function textW(s, size = 12, weight = 500) {
  if (c2d === null) { try { c2d = document.createElement('canvas').getContext('2d') || false; tlFam = getComputedStyle(document.body).fontFamily || 'sans-serif'; } catch { c2d = false; } }
  if (!c2d) return Math.ceil(String(s).length * size * 0.56);
  c2d.font = `${weight} ${size}px ${tlFam}`;
  return Math.ceil(c2d.measureText(String(s)).width * 1.04);
}
function tlMemo(key, fn) {
  if (tlCache.has(key)) return tlCache.get(key);
  const v = fn();
  tlCache.set(key, v);
  if (tlCache.size > 80) tlCache.delete(tlCache.keys().next().value);
  return v;
}

// Lanes: vibration, temperature and speed (the brief's three signals; power stands in when there is no speed sensor), plus
// the sensor that moved most when it is none of them (discharge or coolant pressure, for example).
function tlTags(a, story) {
  const by = k => a.tags.find(x => x.key === k), first = ks => ks.map(by).find(Boolean);
  const vib = by('VIB_RMS'), temp = first(['BEARING_TEMP', 'OIL_TEMP', 'OUTLET_TEMP', 'ZONE_TEMP']), spd = first(['SPINDLE_RPM', 'SPEED_RPM', 'STROKES']);
  const out = [];
  if (vib) out.push({ tag: vib, role: 'vib' });
  if (temp) out.push({ tag: temp, role: 'temp' });
  const pw = spd || by('POWER_KW');
  if (pw) out.push({ tag: pw, role: spd ? 'speed' : 'power' });
  for (const tag of a.tags) if (out.length < 3 && !out.some(l => l.tag.key === tag.key)) out.push({ tag, role: 'other' });
  if (story && !out.some(l => l.tag.key === story.key)) out.push({ tag: story, role: 'story' });
  return out;
}

// Last upward crossing into the alarm zone inside [from, t] (15-min steps, model trend without noise).
function tlCross(M, a, tag, from, t) {
  const bad = v => (tag.dir === 'low' ? v < tag.alarm : v > tag.alarm), st = 15 * MIN;
  let last = null, prev = bad(M.trendAt(a, tag.key, from));
  for (let x = from + st; x <= t; x += st) { const b = bad(M.trendAt(a, tag.key, x)); if (b && !prev) last = x; prev = b; }
  return last;
}
// When the trend started to move (hourly steps back from t while it keeps getting worse).
function tlRise(M, a, tag, t, from) {
  const sign = tag.dir === 'low' ? -1 : 1, eps = Math.abs(tag.trip - tag.normal) * 1e-4;
  let x = t;
  while (x - HOUR >= from && sign * (M.trendAt(a, tag.key, x) - M.trendAt(a, tag.key, x - HOUR)) > eps) x -= HOUR;
  return x < t ? x : null;
}
// First hour the trend is 10 % of its normal-to-trip range away from where it started (to compare which sensor moved first).
function tlMove(M, a, tag, from, t) {
  const sign = tag.dir === 'low' ? -1 : 1, base = M.trendAt(a, tag.key, from), thr = 0.1 * Math.abs(tag.trip - tag.normal);
  for (let x = from; x <= t; x += HOUR) if (sign * (M.trendAt(a, tag.key, x) - base) >= thr) return x;
  return null;
}
// Start of the abnormal stretch that contains `ref` (hourly, on the same minute grid as t).
function tlWatch(M, a, t, ref, from) {
  let x = t - Math.ceil((t - ref) / HOUR) * HOUR;
  if (M.assess(a, x).state === 'normal') return null;
  while (x - HOUR >= from && M.assess(a, x - HOUR).state !== 'normal') x -= HOUR;
  return x;
}

// Everything the card shows, computed once per render (the heavy parts once per model step).
function tlBuild(c) {
  const { M, S, W, ST, t, a, ass, sf, sfStart, d, infos, line, site } = c;
  const als = (ST.alerts || []).filter(x => x.assetId === a.id).sort((x, y) => x.createdAt - y.createdAt);
  const wos = (ST.workOrders || []).filter(w => w.assetId === a.id).sort((x, y) => x.createdAt - y.createdAt);
  const fal = [...als].reverse().find(x => x.type === 'FAILURE') || null;
  const cq = als.find(x => x.type === 'CONSEQUENCE' && x.status !== 'CLOSED') || null;
  const story = sf ? M.tagOf(a, sf.tag) : ass.state === 'normal' && fal ? M.tagOf(a, M.assess(a, fal.createdAt).worstKey) : c.mt;
  const rep = [...wos].reverse().find(w => w.kind !== 'PM' && w.status !== 'REJECTED') || null;
  const rwin = rep ? rep.window || rep.proposedWindow : null;
  let ahead = 96;
  if (c.trend) ahead = Math.max(ahead, ass.rulHi + 4);
  if (rwin && rwin.end > t && rep.status !== 'DONE') ahead = Math.max(ahead, (rwin.end - t) / HOUR + 4);
  ahead = Math.min(168, Math.ceil(ahead));
  const days = ui.tlWin, from = t - days * DAY, to = t + ahead * HOUR, inW = x => x != null && x >= from && x <= to;
  const step = days <= 7 ? (d.phone ? 60 : 30) : days <= 30 ? (d.phone ? 240 : 120) : (d.phone ? 720 : 360);
  const sig = [ST.anchor, JSON.stringify(ST.faults.map(f => [f.asset, f.onset, f.failAt, f.repairedAt])), JSON.stringify(ST.sensorFaults.filter(s => s.asset === a.id).map(s => [s.tag, s.start]))].join('|');
  const F = c.trend ? t + ass.rulH * HOUR : null;
  const mode = ass.mode || (c.likely && c.likely.id) || (rep && rep.mode) || null;
  const plan = sf || !mode ? null : M.partPlan(a, mode);
  const tech = id => (W.technicians.find(x => x.id === id) || {}).name || 'unassigned';
  const city = id => (M.siteById(id) || {}).city || id;

  // sensor lanes
  const fc = c.trend && story.key === ass.worstKey ? forecast(c, Math.min(ahead, ass.rulHi)) : null;
  const lanes = tlTags(a, story).map(l => {
    const pts = tlMemo(`s|${a.id}|${l.tag.key}|${from}|${t}|${step}|${sig}`, () => M.series(a, l.tag.key, from, t, step));
    const isStory = l.tag.key === story.key, info = infos[l.tag.key];
    const trip = isStory && (ass.state === 'act' || ass.state === 'watch') || pts.some(p => (l.tag.dir === 'low' ? p[1] < l.tag.alarm : p[1] > l.tag.alarm));
    const lf = isStory ? fc : null, ys = pts.map(p => p[1]);
    if (lf) ys.push(...lf.hi.map(p => p[1]), ...lf.lo.map(p => p[1]));
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const tg = l.tag, k = Math.abs(tg.alarm - tg.normal);
    if (l.role === 'speed') { lo = Math.min(lo, tg.normal - k); hi = Math.max(hi, tg.alarm + 0.1 * k); }
    else if (tg.dir === 'low') { lo = Math.min(lo, trip ? tg.trip : tg.alarm); hi = Math.max(hi, tg.normal); }
    else { hi = Math.max(hi, trip ? tg.trip : tg.alarm); lo = Math.min(lo, tg.normal); }
    const pad = (hi - lo) * 0.08 || 1;
    return { ...l, name: tlName(tg, l.role), info, pts, trip, fc: lf, dom: [lo - pad, hi + pad], frozen: sf && sf.tag === tg.key ? sfStart : null };
  });

  // timing of the story signal (crossing, first move, Nirantar's watch) and the lag of the temperature behind it
  const cross = sf ? null : tlMemo(`x|${a.id}|${story.key}|${from}|${t}|${sig}`, () => tlCross(M, a, story, from, t));
  const rise = sf || ass.state === 'normal' && !fal ? null : tlRise(M, a, story, fal && ass.state === 'normal' ? fal.createdAt : t, from);
  const watch = sf ? null : tlWatch(M, a, t, fal ? fal.createdAt : t, from);
  const tl = lanes.find(l => l.role === 'temp' && l.tag.key !== story.key);
  let lag = null;
  if (rise && tl) { const m0 = tlMove(M, a, story, rise - HOUR, t), m1 = tlMove(M, a, tl.tag, rise - HOUR, t); if (m0 && m1) lag = (m1 - m0) / HOUR; }
  const sl = lanes.find(l => l.role === 'speed');
  let speedDev = 0;
  if (sl) for (let x = rise || t - 72 * HOUR; x <= t; x += 2 * HOUR) speedDev = Math.max(speedDev, Math.abs(M.trendAt(a, sl.tag.key, x) - sl.tag.normal) / sl.tag.normal);

  // ---- events (lane, row, time, marker, label, tooltip) ----
  const E = [], notes = [], bars = [];
  const hist = W.history.filter(h => h.assetId === a.id), cms = hist.filter(h => h.type === 'CM');
  const pm = S.pmPlan(ST.simNow).find(r => r.assetId === a.id);
  const lastPm = hist.filter(h => h.type === 'PM').sort((x, y) => y.date - x.date)[0] || null;
  const pmLate = !!(pm && pm.last > 0 && pm.overdue && !pm.scheduled);
  for (const h of hist) if (inW(h.date)) {
    const cm = h.type === 'CM';
    E.push({ lane: 'cmms', row: 0, t: h.date, kind: cm ? 'cm' : 'pm', shape: cm ? 'diamond' : 'circle', tone: cm ? 'watch' : 'normal', glyph: cm ? 'bang' : 'check',
      label: cm ? `Breakdown: ${lc(h.title)}` : 'Preventive job', alt: cm ? 'Breakdown' : 'PM', prio: cm ? 3 : 1,
      tip: `${h.id}: ${h.title}${cm ? ' (breakdown repair)' : ''} · ${tech(h.technician)} · ${hours(h.durationH)} · ${inr(h.costInr)}` });
  }
  if (pm && pm.last > 0 && !pm.scheduled && inW(pm.due)) E.push({ lane: 'cmms', row: 0, t: pm.due, kind: 'pmdue', shape: 'circle', hollow: true, tone: pmLate ? 'watch' : 'normal', prio: 4,
    label: pmLate ? `Preventive job due: ${Math.round(-pm.daysToDue)} days overdue` : 'Next preventive job due', alt: pmLate ? 'PM overdue' : 'PM due',
    tip: pmLate ? `Preventive job was due ${day(pm.due)} (every ${pm.interval} days, last one ${day(pm.last)}); not done yet, ${Math.round(-pm.daysToDue)} days overdue` : `Next preventive job due ${day(pm.due)} (every ${pm.interval} days)` });
  { // what the CMMS holds before this window
    const before = [];
    if (lastPm && lastPm.date < from) before.push(`last preventive job ${day(lastPm.date)}`);
    if (pmLate && pm.due < from) before.push(`next one was due ${day(pm.due)}, ${Math.round(-pm.daysToDue)} days overdue`);
    const nb = cms.filter(h => h.date < from).length;
    if (nb) before.push(`${nb} breakdown${nb > 1 ? 's' : ''} before`);
    if (before.length) notes.push({ lane: 'cmms', row: 0, edge: 'l', long: `← ${cap1(before.join(' · '))}`, short: lastPm && lastPm.date < from ? `← Last PM ${day(lastPm.date)}${pmLate ? ', overdue' : ''}` : `← ${cap1(before[0])}` });
    if (!hist.length) notes.push({ lane: 'cmms', row: 0, edge: 'l', long: '← No work orders on record in 120 days', short: '← No records' });
  }
  for (const w of wos) {
    const ap = w.approvals[0], win = w.window || w.proposedWindow, pmw = w.kind === 'PM';
    if (pmw) {   // preventive job booked by a person (maintenance calendar)
      const at = w.doneAt || (win && win.start);
      if (inW(at)) E.push({ lane: 'cmms', row: 0, t: at, kind: 'pmbook', shape: 'circle', tone: 'ok', glyph: 'check', prio: 3, href: '#/schedule',
        label: w.doneAt ? 'Preventive job done' : `Preventive job booked ${wt(at)}`, alt: 'PM booked', tip: `${w.id}: ${w.title}, ${w.doneAt ? `done ${tw(w.doneAt)} IST` : `booked ${tw(win.start)} IST`}${ap ? ` by ${ap.by}` : ''}${w.bundleWith ? `, same stop as ${w.bundleWith}` : ''}` });
      continue;
    }
    const end = w.doneAt || (w.status === 'REJECTED' && ap ? ap.at : win ? win.end : w.createdAt);
    if (end < from || w.createdAt > to) continue;
    const status = w.status === 'PENDING_APPROVAL' ? 'waits for approval' : w.status === 'SCHEDULED' ? (w.kind === 'INSPECT' ? 'check booked' : 'repair booked') : w.status === 'IN_PROGRESS' ? 'in progress' : w.status === 'DONE' ? 'done' : 'rejected';
    const ok = ap && ap.action === 'Approved';
    bars.push({ lane: 'cmms', row: 1, segs: [{ t0: w.createdAt, t1: ok ? ap.at : end, tone: w.status === 'REJECTED' ? 'normal' : 'ai', dash: true }, ...(ok ? [{ t0: ap.at, t1: end, tone: 'ok' }] : [])] });
    E.push({ lane: 'cmms', row: 1, t: w.createdAt, kind: 'wo', shape: 'cap', tone: ok ? 'ok' : w.status === 'REJECTED' ? 'normal' : 'ai', prio: 5, href: `#/orders/${w.id}`,
      label: `${w.id} · ${status}`, alt: w.id, tip: `${w.id}: ${w.title} · ${status}${ap ? ` (${ap.action.toLowerCase()} by ${ap.by} ${tw(ap.at)} IST)` : ''}` });
    if (win && w.status !== 'REJECTED' && inW(win.start)) {
      const booked = !!w.window, what = w.kind === 'INSPECT' ? 'sensor check' : 'repair';
      E.push({ lane: 'cmms', row: 1, t: win.start, t1: win.end, kind: booked ? 'winok' : 'winai', shape: 'block', tone: booked ? 'ok' : 'ai', prio: 6, href: `#/orders/${w.id}`,
        label: `${booked ? cap1(what) + ' booked' : 'Proposed ' + what} ${wt(win.start)}`, alt: `${wt(win.start)}`,
        tip: `${booked ? cap1(what) + ' booked' : `Proposed ${what} window (needs approval)`}: ${tw(win.start)} to ${time(win.end)} IST, ${win.reason}${w.technician ? ` · ${w.technician.name}` : ''}` });
    }
    if (w.doneAt && inW(w.doneAt)) {
      const who = (ST.audit || []).find(r => r.target === a.id && /^Completed the repair|^Replaced the sensor/.test(r.action) && Math.abs(r.ts - w.doneAt) < MIN);
      E.push({ lane: 'cmms', row: 1, t: w.doneAt, kind: 'done', shape: 'circle', tone: 'ok', glyph: 'check', prio: 6, href: `#/orders/${w.id}`,
        label: `${w.kind === 'INSPECT' ? 'Sensor replaced' : 'Repaired'} ${wt(w.doneAt)}`, alt: 'Done', tip: `${w.id} done ${tw(w.doneAt)} IST${who ? ` by ${who.actor}` : ''}` });
    }
    // Nirantar lane: the AI's draft and the people's decisions on it
    if (w.createdBy === 'Nirantar AI' && inW(w.createdAt)) E.push({ lane: 'ai', row: 1, t: w.createdAt, kind: 'draft', shape: 'diamond', tone: 'ai', glyph: 'spark', prio: 4, href: `#/orders/${w.id}`,
      label: `Drafted ${w.id}`, alt: 'Drafted', tip: `Nirantar drafted ${w.id} at ${tw(w.createdAt)} IST: ${w.kind === 'INSPECT' ? 'a sensor check, no repair crew' : `part, window, technician and ${w.steps.length} steps from ${w.sop}`}` });
    for (const p of w.approvals) if (inW(p.at)) E.push({ lane: 'ai', row: 1, t: p.at, kind: p.action === 'Approved' ? 'approve' : 'reject', shape: 'circle', tone: p.action === 'Approved' ? 'ok' : 'normal', glyph: p.action === 'Approved' ? 'check' : 'x', prio: 6, href: '#/trust',
      label: `${p.action} by ${p.by}`, alt: p.action, guide: p.action === 'Approved' ? 'ok' : null, tip: `${p.action} ${w.id} by ${p.by} at ${tw(p.at)} IST${p.comment ? `: "${p.comment}"` : ''} (logged in the audit trail)` });
    // ERP lane: the stock transfer the approval released (or would release)
    if (w.part && w.part.kind !== 'local' && w.status !== 'REJECTED') {
      const route = `${city(w.part.from)} → ${city(a.siteId)}`;
      if (ok && w.eta) {
        bars.push({ lane: 'erp', row: 1, segs: [{ t0: ap.at, t1: w.eta, tone: w.partArrived ? 'ok' : 'normal', dash: !w.partArrived }] });
        if (inW(w.eta)) E.push({ lane: 'erp', row: 1, t: w.eta, kind: w.partArrived ? 'arrived' : 'xfer', shape: 'circle', tone: w.partArrived ? 'ok' : 'normal', glyph: w.partArrived ? 'check' : 'arrow', prio: 6,
          label: `Part ${w.partArrived ? 'arrived' : 'arrives'} ${wt(w.eta)}`, alt: wt(w.eta), guide: null, tip: `${w.part.name}: ${route}, ${w.part.etaH} h by road; ${w.partArrived ? 'arrived' : 'arrives'} ${tw(w.eta)} IST` });
        else if (w.eta > to) notes.push({ lane: 'erp', row: 1, edge: 'r', long: `Part arrives ${tw(w.eta)} →`, short: 'Part later →' });
      } else if (w.status === 'PENDING_APPROVAL') {
        const eta = ST.simNow + w.part.etaH * HOUR;
        bars.push({ lane: 'erp', row: 1, segs: [{ t0: t, t1: Math.min(eta, to), tone: 'ai', dash: true }] });
        if (inW(eta)) E.push({ lane: 'erp', row: 1, t: eta, kind: 'xferai', shape: 'circle', hollow: true, tone: 'ai', glyph: 'arrow', prio: 6,
          label: `If approved now: part here ${wt(eta)}`, alt: `Part ${wt(eta)}`, tip: `If approved now, ${w.part.name} comes ${route} (${w.part.etaH} h by road) and arrives ${tw(eta)} IST` });
        else notes.push({ lane: 'erp', row: 1, edge: 'r', long: `If approved now: part arrives ${tw(eta)} →`, short: 'Part later →' });
      }
    }
  }
  // ERP: customer orders due on this machine's line, and the spare-part stock right now
  const ords = W.salesOrders.filter(o => o.lineId === a.lineId).sort((x, y) => x.due - y.due);
  const riskFrom = c.trend ? t + ass.rulLo * HOUR : null;
  const risky = o => riskFrom != null && o.due > t && o.due >= riskFrom;
  const riskOrder = ords.find(risky) || null, nextOrder = ords.find(o => o.due > t) || null;
  for (const o of ords) if (inW(o.due)) {
    const r = risky(o);
    E.push({ lane: 'erp', row: 0, t: o.due, kind: r ? 'orisk' : 'order', shape: 'flag', tone: r ? 'watch' : 'normal', prio: o === riskOrder ? 7 : o.hero ? 6 : r ? 4 : 2, guide: o === riskOrder ? 'watch' : null,
      label: `${o.customer} · ${inr(o.valueInr)} · due ${wt(o.due)}`, alt: `${o.customer} · ${inr(o.valueInr)}`,
      tip: `${o.id}: ${o.customer}, ${inr(o.valueInr)}, due ${tw(o.due)} IST on ${line.name}${r ? '. At risk: the machine may fail before it is made' : ''}` });
  }
  const later = ords.filter(o => o.due > to).length, earlier = ords.filter(o => o.due < from).length;
  if (later) notes.push({ lane: 'erp', row: 0, edge: 'r', long: `${later} more order${later > 1 ? 's' : ''} due later →`, short: `+${later} →` });
  if (!ords.length) notes.push({ lane: 'erp', row: 0, edge: 'l', long: line.utility ? `← ${line.name}: no customer orders of their own (they serve the production lines)` : `← No customer orders on ${line.name}`, short: '← No customer orders' });
  else if (earlier && !ords.some(o => inW(o.due))) notes.push({ lane: 'erp', row: 0, edge: 'l', long: `← ${earlier} order${earlier > 1 ? 's' : ''} due earlier`, short: `← ${earlier}` });
  const part = sf ? W.parts.find(x => x.for === 'SENSOR') : plan ? plan.part : null;
  if (part && (ass.state !== 'normal' || (rep && rep.status !== 'DONE'))) {
    const here = part.stock[a.siteId] || 0, src = plan && plan.kind === 'transfer' ? plan.from : null;
    E.push({ lane: 'erp', row: 1, t, kind: 'stock', shape: 'square', tone: here ? 'normal' : 'watch', side: 'l', prio: 8,
      label: `${part.id} stock: ${W.sites.map(s => `${s.city} ${part.stock[s.id] || 0}`).join(' · ')}`, alt: `${part.id}: ${site.city} ${here}${src ? ` · ${city(src)} ${part.stock[src] || 0}` : ''}`,
      tip: `${part.name} (${part.id}) in stock now: ${W.sites.map(s => `${s.city} ${part.stock[s.id] || 0}`).join(', ')} · reorder level ${part.reorder}, supplier ${part.leadDays} days` });
  }
  // Nirantar: first sign (watch), alarm line crossed, alerts raised, predicted failure
  if (watch && inW(watch) && (!fal || fal.createdAt - watch >= HOUR)) E.push({ lane: 'ai', row: 0, t: watch, kind: 'watch', shape: 'circle', tone: 'watch', glyph: 'dot', prio: 4,
    label: 'Watch: first change', alt: 'Watch', guide: null, tip: `Nirantar moved ${a.id} from normal to watch (amber) at ${tw(watch)} IST: the first sign, before any alarm line` });
  if (cross && inW(cross)) E.push({ lane: 'ai', row: 0, t: cross, kind: 'cross', shape: 'tri', tone: 'watch', glyph: 'bang', prio: 5, guide: 'watch',
    label: 'Alarm line crossed', alt: 'Alarm', tip: `${story.label} crossed its alarm line (${fv(story, story.alarm)}) at ${tw(cross)} IST` });
  for (const al of als) {
    if (!inW(al.createdAt)) continue;
    const k = al.type === 'SENSOR' ? 'sensor' : al.type === 'CONSEQUENCE' ? 'conseq' : 'alert';
    E.push({ lane: 'ai', row: 0, t: al.createdAt, kind: k, shape: 'badge', tone: k === 'alert' ? 'act' : k === 'sensor' ? 'watch' : 'normal', glyph: 'bang', prio: 6, href: '#/triage', guide: k === 'alert' ? 'act' : null,
      label: k === 'sensor' ? 'Sensor fault flagged' : k === 'conseq' ? `Grouped under ${al.rootCause}` : `Alert raised (${al.priority})`, alt: k === 'conseq' ? al.rootCause : 'Alert',
      tip: `${al.id} at ${tw(al.createdAt)} IST: ${k === 'sensor' ? 'suspected sensor fault, no repair crew' : k === 'conseq' ? `caused upstream by ${al.rootCause}, grouped under that root cause` : `${al.mode ? FAILURE_MODES[al.mode].name : 'abnormal readings'}, priority ${al.priority}`}${al.status === 'CLOSED' ? ' (closed)' : ''}` });
    if (al.ackAt && al.ackBy && inW(al.ackAt) && !wos.some(w => w.approvals.some(p => Math.abs(p.at - al.ackAt) < 2 * MIN))) E.push({ lane: 'ai', row: 1, t: al.ackAt, kind: 'approve', shape: 'circle', tone: 'ok', glyph: 'check', prio: 3, href: '#/trust',
      label: `Acknowledged by ${al.ackBy}`, alt: 'Ack', tip: `${al.id} acknowledged by ${al.ackBy} at ${tw(al.ackAt)} IST` });
  }
  if (F && inW(F)) E.push({ lane: 'ai', row: 0, t: F, kind: 'fail', shape: 'circle', tone: 'act', glyph: 'x', prio: 7, side: 'l',
    label: `Predicted failure ~${wt(r15(F))}`, alt: `Failure ~${wt(r15(F))}`, tip: `Predicted failure about ${when(F)} IST (likely ${when(t + ass.rulLo * HOUR)} to ${when(t + ass.rulHi * HOUR)}), when ${lc(story.label)} reaches its trip level at today's rate` });
  for (const e of E) e.aria = `${e.kind === 'fail' ? 'About ' + when(e.t) : tw(e.t)} IST, ${TL_LANE[e.lane]}: ${e.tip}`;

  // chronological list (also what a screen reader or a phone user reads)
  const items = E.filter(e => e.kind !== 'stock').map(e => ({ t: e.t, kind: e.kind, lane: e.lane, tone: e.tone, text: e.tip, fut: e.t > t }));
  if (rise && inW(rise)) items.push({ t: rise, lane: 'sensor', tone: 'watch', text: `${story.label} began ${story.dir === 'low' ? 'falling' : 'rising'} (${fv(story, M.trendAt(a, story.key, rise))})` });
  if (cross && inW(cross)) items.push({ t: cross + 1, lane: 'sensor', tone: 'watch', text: `${story.label} passed its alarm line (${fv(story, story.alarm)})` });
  if (sf && inW(sfStart)) items.push({ t: sfStart, lane: 'sensor', tone: 'watch', text: `${sf.label} froze at ${fv(story, M.valueAt(a, sf.tag, t))}: a sensor fault, the machine keeps running` });
  const stock = E.find(e => e.kind === 'stock');
  if (stock) items.push({ t, lane: 'erp', tone: stock.tone, text: stock.tip, now: true });
  items.sort((x, y) => x.t - y.t);
  const pre = notes.filter(n => n.edge === 'l' && n.lane === 'cmms').map(n => n.long.replace(/^← /, ''));

  const D = { from, to, t, days, ahead, F, lo: c.trend ? t + ass.rulLo * HOUR : null, hi: c.trend ? t + ass.rulHi * HOUR : null, story, lanes, E, notes, bars, cross, rise, watch, lag, speedDev,
    rep, rwin, fal, cq, pm, lastPm, pmLate, cms, plan, part, riskOrder, nextOrder, ords, items, pre, als };
  D.live = [...lanes.map(l => ({ tag: l.tag, role: l.role })), ...a.tags.filter(x => x.key === 'MOTOR_CURRENT' && !lanes.some(l => l.tag.key === x.key)).map(tag => ({ tag, role: 'other' }))];
  D.read = tlRead(c, D);
  return D;
}

// "What lines up": the reading under the chart, computed from the same data for any machine.
function tlRead(c, D) {
  const { M, t, a, ass, sf, sfStart, infos, line, site, rank } = c;
  const { story, lanes, cross, rise, watch, fal, rep, plan, riskOrder, nextOrder, pm, lastPm, pmLate, cms } = D;
  const nm = tag => lc(tag.label), others = lanes.filter(l => l.tag.key !== story.key);
  const out = [];
  if (ass.state === 'sensor') {
    const al = D.als.find(x => x.type === 'SENSOR');
    out.push(html`The ${lc(sf.label)} sensor has read exactly <b>${fv(story, M.valueAt(a, sf.tag, t))}</b> since ${wt(sfStart)} (${agoH(sf.sinceH)}) while ${hlist(others.map(l => nm(l.tag)))} keep sending live readings: a frozen sensor, not wear.`);
    out.push(html`Nirantar flagged it${al ? ` at ${wt(al.createdAt)}` : ''} and ${rep ? html`drafted a sensor check (<b>${rep.id}</b>, SOP-50)` : 'asks for a sensor check (SOP-50)'}: no repair crew and no production stop${nextOrder ? `, so the ${nextOrder.customer} order due ${wt(nextOrder.due)} is not at risk` : ''}.`);
    return out;
  }
  if (D.cq) {
    const root = M.assetById(D.cq.rootCause), rf = root && M.activeFault(root, t);
    const n = (c.ST.alerts || []).filter(x => x.rootCause === D.cq.rootCause && x.status !== 'CLOSED').length;
    out.push(html`${story.label} began ${story.dir === 'low' ? 'falling' : 'rising'} ${rise ? `${agoH((t - rise) / HOUR)} ago (${wt(rise)})` : 'recently'}, when <b>${root.id}</b> (${lc(root.name)}) started ${rf ? FAILURE_MODES[rf.mode].short : 'failing'}; ${hlist(others.map(l => nm(l.tag)))} stayed flat, so ${a.id} itself is not wearing.`);
    out.push(html`Fixing ${root.id} clears this alarm${n > 1 ? ` and the ${n - 1} others it caused` : ''}.`);
    return out;
  }
  const cmmsBits = [];
  if (pmLate) cmmsBits.push(html`the preventive job has been overdue since ${day(pm.due)}`);
  else if (lastPm) cmmsBits.push(html`the last preventive job was ${day(lastPm.date)} (${Math.round((t - lastPm.date) / DAY)} days ago)${pm && pm.last > 0 && !pm.overdue ? `, the next is due ${day(pm.due)}` : ''}`);
  if (cms.length) {
    const same = ass.mode ? cms.filter(h => h.mode === ass.mode).length : 0, names = [...new Set(cms.map(h => FAILURE_MODES[h.mode].short))];
    cmmsBits.push(same ? html`the same fault was repaired ${same === 1 ? 'once' : same + ' times'} before` : html`${cms.length === 1 ? 'the earlier breakdown was' : cms.length === 2 ? 'both earlier breakdowns were' : `the ${cms.length} earlier breakdowns were`} ${list(names)}${ass.mode ? ', a different fault' : ''}`);
  } else cmmsBits.push(html`no breakdowns in 120 days`);
  const cmmsS = html`In the maintenance records, ${hlist(cmmsBits)}.`;

  if (ass.state === 'normal') {
    const done = D.rep && D.rep.status === 'DONE' ? D.rep : null, ap = done && done.approvals[0];
    const vals = lanes.map(l => html`${nm(l.tag)} ${num(c.M.trendAt(a, l.tag.key, t), l.tag.d > 1 ? 1 : l.tag.d)} ${l.tag.unit}`);
    out.push(done ? html`Repaired ${wt(done.doneAt)} (${done.id}${ap ? html`, approved by ${ap.by}` : ''}): ${nm(story)} is back to <b>${fv(story, c.infos[story.key].now)}</b> and all ${lanes.length} signals are flat.`
      : html`All ${lanes.length} signals are flat: ${hlist(vals)}.`);
    out.push(cmmsS);
    out.push(nextOrder ? html`Next order on this line: <b>${nextOrder.customer}</b> (${inr(nextOrder.valueInr)}) due ${wt(nextOrder.due)}.` : line.utility ? html`${line.name} have no customer orders of their own; they serve the production lines.` : html`No customer orders are due on ${line.name}.`);
    return out;
  }
  // abnormal: sensors first (OT), then maintenance records and ERP (IT)
  const dir = story.dir === 'low' ? 'falling' : 'rising', side = story.dir === 'low' ? 'above' : 'below';
  const began = html`${story.label} began ${dir} ${rise ? html`${agoH((t - rise) / HOUR)} ago (${wt(rise)})` : 'recently'}`;
  out.push(cross && fal && fal.createdAt < cross ? html`${began}; Nirantar raised its alert on <b>${wt(fal.createdAt)}</b>, ${agoH((cross - fal.createdAt) / HOUR)} before ${lc(story.label)} crossed the alarm line (${wt(cross)}).`
    : cross && watch && watch < cross ? html`${began} and crossed the alarm line on ${wt(cross)}; Nirantar had marked it "watch" ${agoH((cross - watch) / HOUR)} earlier (${wt(watch)}).`
    : cross ? html`${began} and crossed the alarm line on ${wt(cross)}${fal ? html`; Nirantar raised its alert on ${wt(fal.createdAt)}` : ''}.`
    : fal ? html`${began}; Nirantar raised its alert on <b>${wt(fal.createdAt)}</b>, while it is still ${side} its alarm line.`
    : html`${began}; it is still ${side} its alarm line, so Nirantar is watching it${watch ? ` (since ${wt(watch)})` : ''}.`);
  const tl = lanes.find(l => l.role === 'temp' && l.tag.key !== story.key), sl = lanes.find(l => l.role === 'speed' && l.tag.key !== story.key);
  const bits = [];
  if (tl) {
    const i = infos[tl.tag.key], lag = D.lag;
    bits.push(i.bad ? html`the ${nm(tl.tag)} ${lag != null && lag >= 1 ? `followed about ${agoH(lag)} later` : lag != null && lag <= -1 ? 'moved first' : 'rose with it'} (${i.delta} in 3 days)` : html`the ${nm(tl.tag)} stayed flat`);
  }
  if (sl) {
    const fm = ass.mode && FAILURE_MODES[ass.mode];
    bits.push(D.speedDev < 0.02 ? html`${nm(sl.tag)} stayed at ${num(sl.tag.normal, 0)} ${sl.tag.unit}, so ${fm && ass.mode !== 'FM-09' ? `it is ${fm.short}, not overload` : 'the load did not change'}`
      : html`${nm(sl.tag)} moved ${Math.round(D.speedDev * 100)} %, so part of the change may be load`);
  }
  if (bits.length) out.push(html`${raw(cap1(String(bits[0])))}${bits[1] ? html`; ${bits[1]}` : ''}.`);
  out.push(cmmsS);
  const ap = rep && rep.approvals[0];
  if (rep && ap && ap.action === 'Approved' && rep.status !== 'DONE' && rep.window) {
    const w = rep.window, part = rep.part && rep.part.kind !== 'local' ? (rep.partArrived ? html`the part arrived ${wt(rep.eta)}` : html`the part arrives ${wt(rep.eta)} from ${M.siteById(rep.part.from).city}`) : html`the part is in stock`;
    out.push(html`${ap.by} approved ${rep.id} at ${wt(ap.at)}: ${part} and the ${rep.status === 'IN_PROGRESS' ? 'repair started' : 'repair is booked for'} <b>${wt(rep.status === 'IN_PROGRESS' ? rep.startedAt : w.start)}</b>${D.F && w.end < D.F ? `, ${agoH((D.F - w.end) / HOUR)} before the predicted failure` : ''}${riskOrder && w.end < riskOrder.due ? ` and ahead of the ${riskOrder.customer} order due ${wt(riskOrder.due)}` : ''}.`);
  } else if (plan) {
    const rk = rank.ix === 0 ? (rank.n > 1 ? html`why it ranks <b>first</b> of the ${rank.n} machines that need attention` : html`why it matters now`) : rank.ix > 0 ? html`why it ranks ${ordinal(rank.ix)} of ${rank.n}` : html`why it matters`;
    const ord = riskOrder ? html`the <b>${riskOrder.customer}</b> order (${inr(riskOrder.valueInr)}) due ${wt(riskOrder.due)}` : null;
    const from = plan.kind === 'transfer' ? M.siteById(plan.from).city : null;
    if (plan.kind === 'local') out.push(html`The spare (${lc(plan.part.name)}) is in stock in ${site.city}, so the repair fits the next low-impact window${D.rwin && D.rwin.start > t ? ` (${wt(D.rwin.start)})` : ''}${ord ? html`, before ${ord}` : ''}.`);
    else {
      const stock = plan.kind === 'transfer' ? html`zero stock in ${site.city} (${from} has ${plan.qty}, ${plan.etaH} h away)` : html`no spare in any plant (${plan.part.leadDays} days from the supplier)`;
      out.push(ord ? html`${raw(cap1(String(ord)))} and ${stock} are ${rk}.` : html`${raw(cap1(String(stock)))} is ${rk}.`);
    }
  }
  return out;
}

// ---------- timeline rendering ----------
// One marker: shape by kind (circle, diamond, triangle, badge, flag, square), colour by meaning, a glyph inside.
function mkSvg(e) {
  const f = FILL[e.tone] || FILL.normal, hol = !!e.hollow;
  const fill = hol ? 'var(--panel-2)' : f, st = hol ? f : 'var(--panel-2)', dash = hol ? ' stroke-dasharray="2.6 2"' : '', sw = hol ? 2 : 1.5;
  const a = `class="tl-mk" fill="${fill}" stroke="${st}" stroke-width="${sw}"${dash}`;
  let s, dy = 0;
  switch (e.shape) {
    case 'diamond': s = `<path ${a} d="M0-8.5L8.5 0 0 8.5-8.5 0z"/>`; break;
    case 'tri': s = `<path ${a} d="M0-8.6L8.6 6.6H-8.6z"/>`; dy = 1.6; break;
    case 'badge': s = `<rect ${a} x="-7.5" y="-7.5" width="15" height="15" rx="3.5"/>`; break;
    case 'square': s = `<rect ${a} x="-5.5" y="-5.5" width="11" height="11" rx="1.5"/>`; break;
    case 'cap': s = `<rect ${a} x="-4.5" y="-4.5" width="9" height="9" rx="2"/>`; break;
    case 'flag': s = `<path d="M-4 8.5V-8.5" stroke="${f}" stroke-width="2" stroke-linecap="round"/><path ${a} d="M-4-8.5H7.5L4.6-4.3 7.5-.1H-4z"/>`; break;
    default: s = `<circle ${a} r="${hol ? 6.5 : 7.5}"/>`;
  }
  const gc = hol ? f : e.tone === 'watch' ? 'var(--on-watch)' : 'var(--on-fill)';
  if (e.glyph === 'spark') s += `<path d="${SPARK}" fill="${gc}"/>`;
  else if (e.glyph) s += `<path d="${GLYPH[e.glyph]}" transform="translate(0,${dy})" fill="none" stroke="${gc}" stroke-width="${e.glyph === 'dot' ? 4 : 1.9}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
function evSvg(e, x, y) {
  const tip = /IST/.test(e.tip) ? e.tip : `${tw(e.t)} IST · ${e.tip}`;
  const att = `class="tl-ev" aria-label="${esc(e.aria)}" data-tlt="${esc(tip)}"`;
  const inner = e.shape === 'block'
    ? `<rect class="tl-mk" x="${f1(e.bx0)}" y="${y - 6}" width="${f1(e.bx1 - e.bx0)}" height="12" rx="3" fill="${e.tone === 'ok' ? 'var(--ok-fill)' : 'var(--ai-bg)'}" stroke="${FILL[e.tone]}" stroke-width="1.6"${e.tone === 'ok' ? '' : ' stroke-dasharray="3 2"'}/><rect x="${f1(e.bx0 - 4)}" y="${y - 13}" width="${f1(e.bx1 - e.bx0 + 8)}" height="26" fill="transparent"/>`
    : `<g transform="translate(${f1(x)},${y})">${mkSvg(e)}<circle r="13" fill="transparent"/></g>`;
  return e.href ? `<a href="${e.href}" ${att}>${inner}</a>` : `<g tabindex="0" role="img" ${att}>${inner}</g>`;
}

// One row of an event lane: markers never overlap (they shift sideways with a thin tick at the true time), labels go
// right or left of their marker only where there is room, by priority; the rest is in the tooltip, legend and list.
function tlTrack(evs, notes, x0, x1, y, X) {
  const ms = evs.filter(e => e.shape !== 'block').sort((p, q) => p.t - q.t), blocks = evs.filter(e => e.shape === 'block');
  let prev = -1e9;
  for (const e of ms) { e.x = Math.min(x1 - 9, Math.max(x0 + 9, X(e.t))); e.dx = Math.max(e.x, prev + 17); prev = e.dx; }
  let nxt = 1e9;
  for (let i = ms.length - 1; i >= 0; i--) { const e = ms[i]; e.dx = Math.min(e.dx, nxt - 17, x1 - 9); nxt = e.dx; }
  for (const e of ms) e.dx = Math.max(e.dx, x0 + 9);
  for (const b of blocks) { b.bx0 = Math.max(x0, X(b.t)); b.bx1 = Math.max(b.bx0 + 6, Math.min(x1, X(b.t1))); b.dx = (b.bx0 + b.bx1) / 2; }
  const occ = [...ms.map(e => [e.dx - 9, e.dx + 9]), ...blocks.map(b => [b.bx0 - 1, b.bx1 + 1])];
  const free = (p, q) => p >= x0 + 3 && q <= x1 - 3 && occ.every(([u, v]) => q + 4 <= u || p - 4 >= v);
  let labs = '';
  for (const n of notes) for (const txt of [n.long, n.short]) {
    const w = textW(txt), p = n.edge === 'l' ? [x0 + 6, x0 + 6 + w] : [x1 - 6 - w, x1 - 6];
    if (free(p[0], p[1])) { occ.push(p); labs += `<text class="tl-note" x="${f1(p[0])}" y="${y + 4}" aria-hidden="true">${esc(txt)}</text>`; break; }
  }
  for (const e of [...ms, ...blocks].sort((p, q) => (q.prio || 0) - (p.prio || 0))) for (const txt of [e.label, e.alt]) {
    if (!txt) continue;
    const w = textW(txt), half = e.shape === 'block' ? (e.bx1 - e.bx0) / 2 : 0;
    const R = [e.dx + half + 13, e.dx + half + 13 + w], Lf = [e.dx - half - 13 - w, e.dx - half - 13];
    const pos = (e.side === 'l' ? [Lf, R] : [R, Lf]).find(p => free(p[0], p[1]));
    if (pos) { occ.push(pos); e.shown = true; labs += `<text class="tl-lab" x="${f1(pos[0])}" y="${y + 4}" fill="${INK[e.tone]}" aria-hidden="true">${esc(txt)}</text>`; break; }
  }
  let out = blocks.map(b => evSvg(b, b.dx, y)).join('');
  for (const e of ms) {
    if (Math.abs(e.dx - e.x) > 2) out += `<path d="M${f1(e.x)} ${y + 12}L${f1(e.dx)} ${y + 7}" stroke="var(--ink-3)" fill="none"/>`;
    out += evSvg(e, e.dx, y);
  }
  return out + labs;
}

// Day (7 d), Monday (30 d) or month (120 d) grid lines with labels that never touch each other or the Now pill.
function tlTicks(D, ph, pw) {
  const pxDay = pw / ((D.to - D.from) / DAY), out = [], dow = x => new Date(x + 5.5 * HOUR).getUTCDay(), dom = x => new Date(x + 5.5 * HOUR).getUTCDate();
  for (let x = istDay0(D.from) + DAY; x < D.to; x += DAY) {
    if (D.days <= 7) out.push({ t: x, label: ph ? `${weekday(x)} ${day(x).slice(0, 2)}` : `${weekday(x)} ${day(x)}` });
    else if (D.days <= 30 ? dow(x) === 1 : dom(x) === 1) out.push({ t: x, label: day(x) });
  }
  const minGap = (ph ? 44 : 74) / pxDay * DAY;   // keep labels apart: thin them out evenly
  let last = -1e15;
  for (const k of out) if (k.t - last < minGap) k.label = ''; else last = k.t;
  return out;
}

function tlChart(D, c) {
  const ph = c.d.phone, w = Math.max(300, Math.round(c.d.full));
  const x0 = ph ? 2 : 150, x1 = w - (ph ? 2 : 48);
  const X = ms => x0 + (ms - D.from) / (D.to - D.from) * (x1 - x0);
  const AX = 24, TT = ph ? 18 : 0, G = ph ? 6 : 5;
  const L = [];
  let y = AX + 4;
  D.lanes.forEach((l, i) => { const top = y + TT, h = ph ? (i ? 44 : 54) : (i ? 50 : 62); L.push({ ...l, kind: 'sensor', top, h }); y = top + h + G; });
  y += ph ? 6 : 9;
  for (const k of ['cmms', 'erp', 'ai']) { const top = y + TT; L.push({ kind: k, top, h: 50 }); y = top + 50 + G; }
  const H = y - G + 2, yT = L[0].top, yB = L[L.length - 1].top + L[L.length - 1].h, tx = X(D.t);
  const ticks = tlTicks(D, ph, x1 - x0);
  let bg = '', ov = '', fg = '', hd = '', lab = '';
  for (const l of L) {
    bg += `<rect x="${x0}" y="${l.top}" width="${f1(x1 - x0)}" height="${l.h}" rx="4" fill="var(--panel-2)"/><rect x="${f1(tx)}" y="${l.top}" width="${f1(x1 - tx)}" height="${l.h}" fill="url(#tlFut)"/>`;
    for (const k of ticks) bg += `<line x1="${f1(X(k.t))}" x2="${f1(X(k.t))}" y1="${l.top}" y2="${l.top + l.h}" stroke="var(--line)"/>`;
  }
  const band = (t0, t1, fill, op) => L.map(l => `<rect x="${f1(X(t0))}" y="${l.top}" width="${f1(Math.max(2, X(t1) - X(t0)))}" height="${l.h}" fill="${fill}" opacity="${op}"/>`).join('');
  if (D.lo) ov += band(Math.max(D.lo, D.from), Math.min(D.hi, D.to), 'var(--act-fill)', 0.06);
  if (D.rwin && D.rep && !['DONE', 'REJECTED'].includes(D.rep.status) && D.rwin.end > D.from && D.rwin.start < D.to) ov += band(Math.max(D.rwin.start, D.from), Math.min(D.rwin.end, D.to), D.rep.window ? 'var(--ok-fill)' : 'var(--ai-fill)', 0.1);
  for (const e of D.E) if (e.guide && e.t >= D.from && e.t <= D.to) ov += `<line x1="${f1(X(e.t))}" x2="${f1(X(e.t))}" y1="${yT}" y2="${yB}" stroke="${FILL[e.guide]}" stroke-width="1.2" stroke-dasharray="2 3"/>`;
  if (D.F && D.F <= D.to) ov += `<line x1="${f1(X(D.F))}" x2="${f1(X(D.F))}" y1="${yT}" y2="${yB}" stroke="var(--act-fill)" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  ov += `<line x1="${f1(tx)}" x2="${f1(tx)}" y1="21" y2="${yB}" stroke="var(--ink)" stroke-width="1.5"/>`;

  // sensor lanes (OT)
  for (const l of L.filter(q => q.kind === 'sensor')) {
    const [v0, v1] = l.dom, tg = l.tag, Y = v => l.top + 5 + (1 - (v - v0) / (v1 - v0)) * (l.h - 10);
    const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p[0]))},${f1(Y(p[1]))}`).join('');
    let g = `<line x1="${x0}" x2="${x1}" y1="${f1(Y(tg.alarm))}" y2="${f1(Y(tg.alarm))}" stroke="var(--watch-fill)" stroke-width="1.3" stroke-dasharray="6 4"/>`;
    if (l.trip) g += `<line x1="${x0}" x2="${x1}" y1="${f1(Y(tg.trip))}" y2="${f1(Y(tg.trip))}" stroke="var(--act-fill)" stroke-width="1.3" stroke-dasharray="6 4"/>`;
    if (l.frozen) { const fx = X(Math.max(l.frozen, D.from)); g += `<rect x="${f1(fx)}" y="${l.top}" width="${f1(Math.max(3, tx - fx))}" height="${l.h}" fill="var(--watch-fill)" opacity=".25"/>`; }
    if (l.fc) g += `<path d="${path(l.fc.hi)}L${[...l.fc.lo].reverse().map(p => `${f1(X(p[0]))},${f1(Y(p[1]))}`).join('L')}Z" fill="var(--ai-fill)" opacity=".16"/><path d="${path(l.fc.points)}" fill="none" stroke="var(--ai-fill)" stroke-width="2" stroke-dasharray="5 4"/>`;
    g += `<path d="${path(l.pts)}" fill="none" stroke="${FILL[l.info.tone]}" stroke-width="1.6" stroke-linejoin="round"/>`;
    if (D.cross && tg.key === D.story.key && D.cross >= D.from) g += `<circle cx="${f1(X(D.cross))}" cy="${f1(Y(tg.alarm))}" r="4.5" fill="var(--watch-fill)" stroke="var(--panel-2)" stroke-width="2"/>`;
    const lim = [[tg.alarm, 'Alarm', 'var(--watch)'], ...(l.trip ? [[tg.trip, 'Trip', 'var(--act)']] : [])];
    if (ph) for (const [v, txt, col] of lim) { const yy = Y(v), up = yy - 4 - 10 >= l.top; g += `<text class="tl-lim" x="${x0 + 5}" y="${f1(up ? yy - 4 : yy + 13)}" fill="${col}">${txt} ${esc(num(v, tg.d))}</text>`; }
    else for (const [v, txt, col] of lim) lab += `<text class="tl-lim" x="${x1 + 6}" y="${f1(Y(v) + 4)}" fill="${col}">${txt}</text>`;
    if (l.frozen) { const fx = X(Math.max(l.frozen, D.from)), txt = `Frozen since ${wt(l.frozen)}: sensor fault`, w2 = textW(txt); g += `<text class="tl-lab" x="${f1(Math.max(x0 + 4, fx - 8 - w2))}" y="${l.top + 15}" fill="var(--watch)">${esc(txt)}</text>`; }
    const v1t = c.infos[tg.key];
    const aria = `${l.name}, ${tg.unit}: ${fv(tg, l.pts[0][1])} at the start of the window, ${fv(tg, l.pts[l.pts.length - 1][1])} now (${lc(v1t.word)}); alarm line ${fv(tg, tg.alarm)}${l.trip ? `, trip ${fv(tg, tg.trip)}` : ''}${l.fc ? `; forecast to reach the trip level in about ${hours(c.ass.rulH)}` : ''}${l.frozen ? `; frozen since ${wt(l.frozen)}` : ''}`;
    fg += `<g role="img" aria-label="${esc(aria)}">${g}</g>`;
    const word = `<tspan fill="${INK[v1t.tone]}" font-weight="600">${esc(v1t.word)}</tspan>`;
    if (ph) lab += `<text class="tl-ln" x="${x0}" y="${l.top - 5}">${esc(l.name)}<tspan class="tl-ls" font-weight="400"> · ${esc(tg.unit)} · </tspan>${word}</text>`;
    else {
      const lines = tlWrap(l.name, x0 - 16);
      lab += lines.map((s, i) => `<text class="tl-ln" x="0" y="${l.top + 15 + i * 14}">${esc(s)}</text>`).join('') + `<text class="tl-ls" x="0" y="${l.top + 16 + lines.length * 14}">${esc(tg.unit)} · ${word}</text>`;
    }
  }
  // record lanes (IT) and Nirantar's actions
  const NAMES = { cmms: ['Maintenance (CMMS)', 'work orders'], erp: ['ERP', 'orders · spare parts'], ai: ['Nirantar', 'AI actions · approvals'] };
  for (const l of L.filter(q => q.kind !== 'sensor')) {
    const ys = [l.top + 15, l.top + 36];
    let g = '';
    for (const b of D.bars.filter(q => q.lane === l.kind)) for (const s of b.segs) {
      const a0 = Math.max(s.t0, D.from), a1 = Math.min(s.t1, D.to);
      if (a1 > a0) g += `<line x1="${f1(X(a0))}" x2="${f1(X(a1))}" y1="${ys[b.row]}" y2="${ys[b.row]}" stroke="${FILL[s.tone]}" stroke-width="3" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
    }
    if (l.kind === 'ai' && D.lo) g += `<rect x="${f1(X(D.lo))}" y="${ys[0] - 8}" width="${f1(X(Math.min(D.hi, D.to)) - X(D.lo))}" height="16" rx="8" fill="var(--act-fill)" opacity=".16"/>`;
    for (const row of [0, 1]) g += tlTrack(D.E.filter(e => e.lane === l.kind && e.row === row), D.notes.filter(n => n.lane === l.kind && n.row === row), x0, x1, ys[row], X);
    fg += `<g role="group" aria-label="${esc(NAMES[l.kind].join(': '))}">${g}</g>`;
    if (ph) lab += `<text class="tl-ln" x="${x0}" y="${l.top - 5}">${NAMES[l.kind][0]}<tspan class="tl-ls" font-weight="400"> · ${NAMES[l.kind][1]}</tspan></text>`;
    else lab += `<text class="tl-ln" x="0" y="${l.top + 20}">${NAMES[l.kind][0]}</text><text class="tl-ls" x="0" y="${l.top + 35}">${NAMES[l.kind][1]}</text>`;
  }
  // header: grid labels and the Now pill
  for (const k of ticks) { const x = X(k.t); if (k.label && Math.abs(x + 3 + textW(k.label, 11, 400) / 2 - tx) > textW(k.label, 11, 400) / 2 + 26 && x + 3 + textW(k.label, 11, 400) <= x1) hd += `<text class="tl-tick" x="${f1(x + 3)}" y="16">${esc(k.label)}</text>`; }
  hd += `<rect x="${f1(tx - 19)}" y="4" width="38" height="17" rx="8.5" fill="var(--ink)"/><text class="tl-now" x="${f1(tx)}" y="16.5" text-anchor="middle">Now</text>`;
  if (!ph) hd += `<text class="tl-tick" x="0" y="16">${esc(D.days <= 7 ? 'IST, one line per day' : D.days <= 30 ? 'IST, one line per week' : 'IST, one line per month')}</text>`;
  const defs = `<defs><pattern id="tlFut" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--panel-2)"/><line x1="0" y1="0" x2="0" y2="7" stroke="var(--line)" stroke-width="1.4"/></pattern></defs>`;
  const aria = `Timeline of ${c.a.id} from ${tw(D.from)} to ${tw(D.to)} IST: ${D.lanes.map(l => l.name).join(', ')}, maintenance records, ERP and Nirantar's actions`;
  return raw(`<svg class="tl-svg" viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="group" aria-label="${esc(aria)}">${defs}${bg}${ov}${fg}${lab}${hd}</svg>`);
}
function tlWrap(s, maxW) {
  const words = String(s).split(' '), out = [];
  let cur = '';
  for (const wd of words) { const nx = cur ? cur + ' ' + wd : wd; if (cur && textW(nx, 12, 600) > maxW) { out.push(cur); cur = wd; } else cur = nx; }
  if (cur) out.push(cur);
  return out.slice(0, 2);
}

function tlLegend(D) {
  const k = new Set(D.E.map(e => e.kind)), L = [];
  const sw = e => `<svg class="tl-sw" viewBox="-10 -10 20 20" aria-hidden="true">${mkSvg(e)}</svg>`;
  const ln = (stroke, dash) => `<svg class="tl-sw" viewBox="0 0 20 20" aria-hidden="true"><line x1="1" x2="19" y1="10" y2="10" stroke="${stroke}" stroke-width="2.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  const bx = (fill, op, stroke) => `<svg class="tl-sw" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="4" width="16" height="12" rx="3" fill="${fill}" opacity="${op}"${stroke || ''}/></svg>`;
  if (D.lanes.some(l => l.fc)) L.push([ln('var(--ai-fill)', '5 3'), "Nirantar's forecast (likely range shaded)"]);
  if (D.lo) L.push([bx('var(--act-fill)', 0.3), 'Likely failure range']);
  if (D.lanes.some(l => l.frozen)) L.push([bx('var(--watch-fill)', 0.35), 'Frozen sensor']);
  const add = (keys, e, txt) => { if (keys.some(x => k.has(x))) L.push([sw(e), txt]); };
  add(['pm'], { shape: 'circle', tone: 'normal', glyph: 'check' }, 'Preventive job');
  add(['cm'], { shape: 'diamond', tone: 'watch', glyph: 'bang' }, 'Breakdown repair');
  add(['pmdue'], { shape: 'circle', hollow: true, tone: D.pmLate ? 'watch' : 'normal' }, 'Preventive job due');
  add(['pmbook'], { shape: 'circle', tone: 'ok', glyph: 'check' }, 'Preventive job booked by a person');
  if (k.has('wo')) L.push([ln('var(--ai-fill)', '5 3'), 'Work order waiting for approval'], ...(D.bars.some(b => b.lane === 'cmms' && b.segs.some(s => s.tone === 'ok')) ? [[ln('var(--ok-fill)'), 'Approved work order']] : []));
  if (k.has('winai')) L.push([bx('var(--ai-bg)', 1, ' stroke="var(--ai-fill)" stroke-width="1.6" stroke-dasharray="3 2"'), 'Proposed window (needs approval)']);
  if (k.has('winok')) L.push([bx('var(--ok-fill)', 1), 'Booked window']);
  add(['done'], { shape: 'circle', tone: 'ok', glyph: 'check' }, 'Repair done');
  add(['order', 'orisk'], { shape: 'flag', tone: k.has('orisk') ? 'watch' : 'normal' }, k.has('orisk') ? 'Customer order due (amber: at risk)' : 'Customer order due');
  add(['stock'], { shape: 'square', tone: 'watch' }, 'Spare-part stock now');
  add(['xfer'], { shape: 'circle', tone: 'normal', glyph: 'arrow' }, 'Part on its way');
  add(['xferai'], { shape: 'circle', hollow: true, tone: 'ai', glyph: 'arrow' }, 'Part arrival if approved now');
  add(['arrived'], { shape: 'circle', tone: 'ok', glyph: 'check' }, 'Part arrived');
  add(['watch'], { shape: 'circle', tone: 'watch', glyph: 'dot' }, 'Nirantar: first change (watch)');
  add(['cross'], { shape: 'tri', tone: 'watch', glyph: 'bang' }, 'Alarm line crossed');
  add(['alert'], { shape: 'badge', tone: 'act', glyph: 'bang' }, 'Alert raised');
  add(['sensor'], { shape: 'badge', tone: 'watch', glyph: 'bang' }, 'Sensor fault flagged');
  add(['conseq'], { shape: 'badge', tone: 'normal', glyph: 'bang' }, 'Alarm grouped under its root cause');
  add(['draft'], { shape: 'diamond', tone: 'ai', glyph: 'spark' }, 'Drafted by Nirantar');
  add(['approve'], { shape: 'circle', tone: 'ok', glyph: 'check' }, 'Decision by a person');
  add(['reject'], { shape: 'circle', tone: 'normal', glyph: 'x' }, 'Rejected by a person');
  add(['fail'], { shape: 'circle', tone: 'act', glyph: 'x' }, 'Predicted failure');
  return html`<ul class="tl-legend" aria-label="Key to the timeline">${L.map(([s, txt]) => html`<li>${raw(s)}<span>${txt}</span></li>`)}</ul>`;
}

function tlListHtml(D) {
  const strip = s => s.replace(/ at \w{3} \d{2} \w+ \d{2}:\d{2} IST/, '');
  return html`<ol class="tl-list">${D.pre.length ? html`<li><span class="tl-lt">Before</span><span class="tl-lc cmms">CMMS</span><span class="tl-lx">${cap1(D.pre.join(' · '))}</span></li>` : ''}${D.items.map(it => html`<li class="${it.fut ? 'fut' : ''}"><span class="tl-lt mono">${it.now ? 'Now' : it.kind === 'fail' ? `~${when(it.t)}` : tw(it.t)}</span><span class="tl-lc ${it.lane}">${TL_LANE[it.lane]}</span><span class="tl-lx">${strip(it.text)}${it.fut ? html` <span class="xs dim">(${it.lane === 'ai' && /Predicted/.test(it.text) ? 'predicted' : 'planned'})</span>` : ''}</span></li>`)}</ol>`;
}

// ---------- live strip: raw readings every simulated minute (the model itself works on 15-min points) ----------
// valueAt() adds noise per 15-min slot, so a minute-by-minute feed adds its own deterministic jitter between the quarter
// hours; on a quarter hour (and for a frozen sensor) it is exactly the historian value the charts use.
function liveAt(M, ST, a, tag, tm) {
  if (tm % (15 * MIN) === 0 || ST.sensorFaults.some(s => s.asset === a.id && s.tag === tag.key && tm >= s.start)) return M.valueAt(a, tag.key, tm);
  const s = M.smoothAt(a, tag.key, tm), k = tag.key;
  const sd = /^VIB/.test(k) ? 0.035 * s : /RPM$/.test(k) ? 0.002 * s : 0.012 * Math.abs(tag.normal);
  return s + gauss(a.idx * 31 + 11, k.length * 89 + k.charCodeAt(1), Math.floor(tm / MIN)) * sd;
}
function tlLiveRead(c, tag, m) {
  const { M, ST, a, infos } = c;
  const pts = [];
  for (let k = 59; k >= 0; k--) pts.push(liveAt(M, ST, a, tag, m - k * MIN));
  const frozen = ST.sensorFaults.find(s => s.asset === a.id && s.tag === tag.key && m >= s.start);
  const dv = M.smoothAt(a, tag.key, m) - M.smoothAt(a, tag.key, m - HOUR), rng = Math.abs(tag.trip - tag.normal);
  let d, dTone = 'normal';
  if (frozen) { d = `→ no change for ${agoH((m - frozen.start) / HOUR)} (frozen)`; dTone = 'watch'; }
  else if (Math.abs(dv) < 0.004 * rng) d = '→ steady vs 1 h ago';
  else { d = `${dv > 0 ? '↑' : '↓'} ${num(Math.abs(dv), tag.d)} ${tag.unit} vs 1 h ago`; dTone = (tag.dir === 'low' ? dv < 0 : dv > 0) ? 'watch' : 'normal'; }
  const lo = Math.min(...pts), hi = Math.max(...pts), mid = (lo + hi) / 2, half = Math.max((hi - lo) / 2 * 1.12, 0.03 * rng);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / 59 * 120).toFixed(1)},${(26 - (p - (mid - half)) / (2 * half) * 24).toFixed(1)}`).join('');
  return { v: num(pts[59], tag.d), d, dTone, path, tone: infos[tag.key] ? infos[tag.key].tone : 'normal' };
}
function tlLiveHtml(c, D) {
  const m = Math.floor(c.ST.simNow / MIN) * MIN, on = !!c.prefs.playing;
  return html`<section class="tl-live" aria-label="Live readings" data-m="${m}">
  <p class="tl-lh"><span class="live-dot ${on ? 'on' : 'paused'}" aria-hidden="true"></span><b class="tl-lv">${on ? 'Live' : 'Paused'}</b><span>· 1-minute ticks (simulated historian feed)</span><span class="tl-at mono">${time(m)} IST</span></p>
  <ul class="tl-tiles">${D.live.map(({ tag, role }) => { const r = tlLiveRead(c, tag, m); return html`<li class="tl-tile ${r.tone}" data-key="${tag.key}"><span class="tl-tn">${tlName(tag, role)}</span><span class="tl-tv"><b class="mono">${r.v}</b> <span class="tl-tu">${tag.unit}</span></span><span class="tl-td ${r.dTone}">${r.d}</span>${raw(`<svg class="tl-spk" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><path d="${r.path}" fill="none" stroke="${FILL[r.tone]}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`)}</li>`; })}</ul>
  </section>`;
}
// Called every second: only rewrites the strip's numbers and sparklines when the simulated minute changes.
function tlLiveTick(root, c) {
  const box = root.querySelector('.tl-live');
  if (!box || !c.ST || !c.ST.loaded) return;
  const on = !!c.prefs.playing, lv = box.querySelector('.tl-lv'), dot = box.querySelector('.live-dot');
  if (lv.textContent !== (on ? 'Live' : 'Paused')) { lv.textContent = on ? 'Live' : 'Paused'; dot.className = `live-dot ${on ? 'on' : 'paused'}`; }
  const m = Math.floor(c.ST.simNow / MIN) * MIN;
  if (String(m) === box.dataset.m) return;
  box.dataset.m = String(m);
  box.querySelector('.tl-at').textContent = `${time(m)} IST`;
  for (const li of box.querySelectorAll('.tl-tile')) {
    const tag = c.a.tags.find(x => x.key === li.dataset.key);
    if (!tag) continue;
    const r = tlLiveRead(c, tag, m), dEl = li.querySelector('.tl-td');
    li.querySelector('.tl-tv b').textContent = r.v;
    dEl.textContent = r.d; dEl.className = `tl-td ${r.dTone}`;
    li.querySelector('.tl-spk path').setAttribute('d', r.path);
  }
}

// Tooltip for timeline markers (hover, keyboard focus or tap); Escape hides it.
function tlTips(root) {
  const wrap = root.querySelector('.tl-wrap');
  if (!wrap) return () => {};
  const tip = wrap.querySelector('.tl-tip');
  const show = el => {
    tip.textContent = el.getAttribute('data-tlt'); tip.hidden = false;
    const r = el.getBoundingClientRect(), W = wrap.getBoundingClientRect(), tw2 = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.max(0, Math.min(W.width - tw2, r.left + r.width / 2 - W.left - tw2 / 2));
    const below = r.bottom - W.top + 6, above = r.top - W.top - th - 6;
    tip.style.left = `${x}px`; tip.style.top = `${below + th > W.height + 40 && above > 0 ? above : below}px`;
  };
  const hide = () => { tip.hidden = true; };
  const over = ev => { const el = ev.target.closest && ev.target.closest('[data-tlt]'); if (el && wrap.contains(el)) show(el); };
  const out = ev => { const el = ev.target.closest && ev.target.closest('[data-tlt]'); if (el && !(ev.relatedTarget && el.contains(ev.relatedTarget))) hide(); };
  const key = ev => { if (ev.key === 'Escape') hide(); };
  const evs = [['pointerover', over], ['focusin', over], ['pointerout', out], ['focusout', out], ['keydown', key]];
  evs.forEach(([k, f]) => wrap.addEventListener(k, f));
  return () => evs.forEach(([k, f]) => wrap.removeEventListener(k, f));
}

function timeline(c, mk) {
  const D = tlBuild(c), ph = c.d.phone;
  const span = `Past ${D.days} days and the next ${Math.round(D.ahead / 24)} days, IST`;
  return card(html`${mk ? marker(mk) : ''}<h2>IT + OT on one timeline</h2><span class="sub">sensors from the plant floor, ERP and maintenance records, and Nirantar's actions on one time axis</span>`,
    html`${tlLiveHtml(c, D)}
  <div class="tl-bar"><span class="m-lbl" id="tl-win-l">Records shown for</span><div class="seg" role="group" aria-labelledby="tl-win-l">${TL_WINS.map(([k, l]) => html`<button data-action="tlwin" data-id="${k}" aria-pressed="${ui.tlWin === k}">${l}</button>`)}</div><span class="small dim">${span}</span></div>
  <div class="tl-wrap"><div class="tl-plot">${tlChart(D, c)}</div><div class="tl-tip" role="tooltip" hidden></div></div>
  <div class="tl-read">${aiChip('Read by Nirantar')}<p><b>What lines up:</b> ${D.read.map((s, i) => html`${i ? ' ' : ''}${s}`)}</p></div>
  ${tlLegend(D)}
  <details class="tl-more" ${ph ? raw('open') : ''}><summary>Every event in this window, in time order (${D.items.length + (D.pre.length ? 1 : 0)})</summary>${tlListHtml(D)}</details>`, 'tl-card');
}
