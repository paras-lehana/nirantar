// Reliability & root cause (tool, group "Analyse"): which failures cost the most, and why do they repeat?
// Fleet view, from the back-test failure episodes (56 days) plus the CMMS breakdown jobs (type 'CM'): failure-mode
// Pareto, MTBF / MTTR / inherent availability per line, bad actors, repeat failures and the weekly failure trend.
// Machine view, a root-cause analysis built only from data (live sensors, the spectrum, CMMS jobs, notes, the PM plan):
// fishbone with six bones, 5 whys (confirmed by data vs hypotheses) and corrective actions. A named person confirms a
// hypothesis at teardown: that writes an audit row, and confirmations are read back from the audit log on every render.
// Charts are drawn at the measured card width (same idea as machine.js) so SVG text keeps its real size on a phone.
import { html, icon, delegate, raw, esc } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, term, nextBack, confPct } from '../ui/components.js';
import { FAILURE_MODES } from '../core/generator.js';
import { inr, num, int, hours, day, HOUR, DAY, MIN } from '../core/format.js';

let ui = { by: 'cost', site: 'all', view: 'diagram', tab: 'fish', name: null, nameErr: false, confirmed: {}, scrollTo: null, allRep: false };

const REPEAT_D = 60;                                       // "repeat failure": corrective work twice within 60 days
const ACTION = 'Confirmed a root cause at teardown';       // audit action; confirmations are read back from the log
const BY = [['cost', 'By cost'], ['count', 'By count'], ['down', 'By downtime hours']];
const BY_WORD = { cost: 'failure cost', count: 'failures', down: 'downtime hours' };
const BONES = [['machine', 'Machine'], ['method', 'Method'], ['material', 'Material'], ['people', 'People'], ['measurement', 'Measurement'], ['environment', 'Environment']];
const EVK = { sensor: ['sensor', 'Sensors'], spectrum: ['compare', 'Spectrum'], cmms: ['orders', 'CMMS history'], note: ['doc', 'Note'], policy: ['shield', 'Policy'], record: ['pareto', 'Failure record'] };
const WORD = { data: 'Confirmed by data', hyp: 'Hypothesis: confirm at teardown', out: 'Ruled out', info: 'Context' };
const DOT = { data: 'var(--ai-fill)', hyp: 'var(--watch-fill)', out: 'var(--normal)', info: 'var(--normal)', ok: 'var(--ok-fill)' };
const INK = { data: 'var(--ai)', hyp: 'var(--watch)', out: 'var(--ink-3)', info: 'var(--ink-3)', ok: 'var(--ok)' };
const MTBF_TIP = 'Mean time between failures: operating hours divided by the number of failures, so it is the running time per machine between two failures. Higher is better.';
const MTTR_TIP = 'Mean time to repair: the average hours from a failure to running again. Lower is better.';
const AV_TIP = 'Inherent availability = MTBF / (MTBF + MTTR): the share of time a line could run if failures were the only loss (no planned stops, no waiting for parts).';

// Failure-mode catalogue for the root-cause analysis (plain-English text only; every number comes from the data).
const CAT = {
  'FM-01': { cause: 'Lubrication breakdown or a weak bearing', claim: 'lubrication breakdown or a weak bearing', system: 'Bearing condition is only looked at during the preventive job, so a slipped job leaves the wear unseen', sysClaim: 'bearing condition only checked at the preventive job', prevent: 'Add a handheld vibration reading on the bearing to every preventive job', owner: 'Maintenance planner', material: 'Bearing grease or the bearing itself: check both at teardown' },
  'FM-02': { cause: 'Inserts run until they break instead of being changed by cutting current', claim: 'inserts run until they break', system: 'Inserts are changed on breakdown, not by cutting current as SOP-09 asks', sysClaim: 'inserts changed on breakdown, not by cutting current', prevent: 'Change inserts by cutting current (SOP-09), not on breakdown', owner: 'Production supervisor', material: 'A harder work-material batch wears inserts faster' },
  'FM-03': { cause: 'Belt tension drifts between preventive jobs', claim: 'belt tension drifting between preventive jobs', system: 'Belt tension is only checked at the preventive job', sysClaim: 'belt tension only checked at the preventive job', prevent: 'Add a belt-tension check to the weekly round', owner: 'Maintenance planner', material: 'An off-spec belt set that stretches early' },
  'FM-04': { cause: 'Shafts moved out of line after a motor, gearbox or foundation job', claim: 'shafts out of line after a motor or gearbox job', system: 'No rule requires a laser alignment (SOP-24) after a motor or gearbox change', sysClaim: 'no alignment rule after motor or gearbox changes', prevent: 'Make a laser alignment (SOP-24) mandatory after every motor or gearbox change, signed off with the reading', owner: 'Maintenance head', material: 'Coupling element may be worn: SOP-24 says replace it if worn' },
  'FM-05': { cause: 'Build-up on the rotor or a lost balance weight', claim: 'build-up on the rotor or a lost balance weight', system: 'Cleaning is not scheduled more often than the build-up returns', sysClaim: 'cleaning not scheduled more often than build-up returns', prevent: 'Schedule rotor cleaning more often than the build-up returns', owner: 'Maintenance planner', material: 'Build-up on the blades: SOP-25 names it the usual cause' },
  'FM-06': { cause: 'Seals aged by high oil temperature', claim: 'seals aged by high oil temperature', system: 'Seal condition is not tracked between preventive jobs', sysClaim: 'seal condition not tracked between preventive jobs', prevent: 'Trend oil temperature and replace seals on condition', owner: 'Reliability engineer', material: 'Seal kit near the end of its life' },
  'FM-07': { cause: 'A starved suction: a blocked strainer or a low sump level', claim: 'a starved suction (strainer or sump level)', system: 'Nobody checks the sump level and strainer between preventive jobs', sysClaim: 'sump and strainer only checked at the preventive job', prevent: 'Add a sump-level and strainer check to every shift round', owner: 'Utilities technician', material: 'Impeller or seal eroded by the cavitation (SOP-12)' },
  'FM-08': { cause: 'Element ageing from thermal cycling', claim: 'element ageing from thermal cycling', system: 'Element resistance is not measured between preventive jobs', sysClaim: 'element resistance not measured between jobs', prevent: 'Measure element resistance at each preventive job and replace by trend', owner: 'Maintenance planner', material: 'Heater element bank near the end of its life' },
  'FM-09': { cause: 'Overload from a jammed load or a wrong motor setting', claim: 'overload from a jammed load or a wrong motor setting', system: 'Overload trips are reset without a cause being logged', sysClaim: 'overload trips reset without a logged cause', prevent: 'Log a cause for every overload trip before the reset', owner: 'Production supervisor', material: 'Winding insulation ageing' },
};

// ---------- small helpers ----------
const f1 = v => Math.round(v * 10) / 10;
const lc = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const ago = (ms, now) => Math.max(0, Math.round((now - ms) / DAY));
const pctS = v => `${Math.round(v * 100)} %`;
const fv = (tag, v) => `${num(v, Math.abs(v) >= 100 ? 0 : 1)} ${tag.unit}`;
const inrC = v => (v >= 1e7 ? (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr' : v >= 1e5 ? (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L' : Math.round(v / 1000) + 'k');
const odays = pm => plural(Math.max(1, Math.round(-pm.daysToDue)), 'day');
const scenKey = st => `${st.scenarioId}|${st.seed}|${st.anchor}`;
const card = (head, body, cls = '', attrs = '') => html`<section class="card ${cls}" ${raw(attrs)}><div class="card-head">${head}</div>${body}</section>`;

// Text measurement for SVG wrapping (canvas, with the page font). Falls back to a width estimate in Node.
let c2d = null, fam = null;
function textW(s, px, weight = 400, italic = false) {
  if (c2d === null) { try { c2d = document.createElement('canvas').getContext('2d') || false; fam = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif'; } catch { c2d = false; } }
  if (!c2d) return String(s).length * px * 0.56;
  c2d.font = `${italic ? 'italic ' : ''}${weight} ${px}px ${fam}`;
  return c2d.measureText(String(s)).width * 1.05;   // 5 % slack in case the web font swaps in later
}
function wrapText(s, maxW, px, weight = 400, italic = false) {
  const lines = []; let cur = '';
  for (const w of String(s).split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && textW(t, px, weight, italic) > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Content width, so each chart is drawn 1:1 with its card. Breakpoints 720 / 1100 px mirror reliability.css.
function dims(root) {
  const cs = getComputedStyle(root);
  const cw = Math.max(300, root.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  const vw = window.innerWidth, wide = vw >= 1100, mid = vw >= 720, full = Math.round(cw - 30);
  return { cw, full, phone: !mid, wide, big: wide ? Math.round((cw - 16) * 1.35 / 2.35 - 30) : full, small: wide ? Math.round((cw - 16) / 2.35 - 30) : full };
}

// ---------- fleet analysis (pure, exported for Node tests) ----------
/** Failures = back-test episodes + CMMS breakdown jobs. `win` holds the ones inside the back-test window. */
export function failureEvents(W) {
  const days = W.backtest.windowDays, from = W.anchor - days * DAY;
  const ep = W.backtest.episodes.map(e => ({ id: e.id, assetId: e.assetId, mode: e.mode, at: e.at, costInr: e.costInr, downH: e.repairH, src: 'ep' }));
  const cm = W.history.filter(h => h.type === 'CM' && h.mode).map(h => ({ id: h.id, assetId: h.assetId, mode: h.mode, at: h.date, costInr: h.costInr, downH: h.durationH, src: 'cm' }));
  const all = [...ep, ...cm].filter(e => e.at <= W.anchor).sort((x, y) => x.at - y.at);
  const win = all.filter(e => e.at >= from);
  return { all, win, from, to: W.anchor, days, nEp: win.filter(e => e.src === 'ep').length, nCm: win.filter(e => e.src === 'cm').length };
}

/** Failure modes ranked by cost / count / downtime, with each mode's share and the running (cumulative) share. */
export function pareto(evs, by = 'cost') {
  const g = {};
  for (const e of evs) {
    const r = g[e.mode] ||= { mode: e.mode, n: 0, cost: 0, down: 0, ep: 0, cm: 0 };
    r.n++; r.cost += e.costInr; r.down += e.downH; r[e.src]++;
  }
  const key = by === 'count' ? 'n' : by === 'down' ? 'down' : 'cost';
  const rows = Object.values(g).sort((x, y) => y[key] - x[key] || y.cost - x.cost);
  const total = rows.reduce((s, r) => s + r[key], 0) || 1;
  let cum = 0;
  for (const r of rows) { r.v = r[key]; r.share = r.v / total; cum += r.v; r.cum = cum / total; }
  const vital = Math.max(1, rows.findIndex(r => r.cum >= 0.8 - 1e-9) + 1);
  return { rows, total, vital, by, cumAtVital: rows[vital - 1] ? rows[vital - 1].cum : 1 };
}

/** MTBF, MTTR and inherent availability per line. Operating hours = machines x window hours (round the clock). */
export function lineStats(W, evs, days, site = 'all') {
  const winH = days * 24;
  const rows = W.lines.filter(l => site === 'all' || l.siteId === site).map(l => {
    const ids = new Set(W.assets.filter(a => a.lineId === l.id).map(a => a.id));
    const fe = evs.filter(e => ids.has(e.assetId));
    const opH = ids.size * winH, n = fe.length;
    const mtbf = n ? opH / n : null, mttr = n ? fe.reduce((s, e) => s + e.downH, 0) / n : null;
    return { line: l, machines: ids.size, failures: n, opH, mtbf, mttr, avail: n ? mtbf / (mtbf + mttr) : 1 };
  });
  const opH = rows.reduce((s, r) => s + r.opH, 0), n = rows.reduce((s, r) => s + r.failures, 0);
  const down = rows.reduce((s, r) => s + (r.mttr || 0) * r.failures, 0);
  const total = { machines: rows.reduce((s, r) => s + r.machines, 0), failures: n, opH, mtbf: n ? opH / n : null, mttr: n ? down / n : null };
  total.avail = n ? total.mtbf / (total.mtbf + total.mttr) : 1;
  const withF = rows.filter(r => r.failures);
  const worst = withF.length ? withF.reduce((w, r) => (r.avail < w.avail || (r.avail === w.avail && r.mtbf < w.mtbf) ? r : w)) : null;
  return { rows, total, worst };
}

/** Machines ranked by failure cost in the window. */
export function badActors(evs) {
  const g = {};
  for (const e of evs) {
    const r = g[e.assetId] ||= { id: e.assetId, n: 0, cost: 0, down: 0, last: 0, ep: 0, cm: 0, modes: {} };
    r.n++; r.cost += e.costInr; r.down += e.downH; r.last = Math.max(r.last, e.at); r[e.src]++; r.modes[e.mode] = (r.modes[e.mode] || 0) + 1;
  }
  return Object.values(g).sort((x, y) => y.cost - x.cost || y.n - x.n);
}

/** Same failure mode twice or more with at most `gapD` days between two of them. */
export function sameModeRepeats(evs, gapD = REPEAT_D) {
  const out = [];
  for (const m of new Set(evs.map(e => e.mode))) {
    const ms = evs.filter(e => e.mode === m).sort((x, y) => x.at - y.at);
    let best = null;
    for (let i = 1; i < ms.length; i++) { const gap = (ms[i].at - ms[i - 1].at) / DAY; if (gap <= gapD && (!best || gap < best.gapD)) best = { mode: m, first: ms[i - 1], last: ms[i], gapD: gap, n: ms.length, events: ms }; }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.gapD - y.gapD);
}

/** Machines with corrective work twice or more within `gapD` days. Same-mode repeats rank first. */
export function repeatFailures(evs, gapD = REPEAT_D) {
  const per = {};
  for (const e of evs) (per[e.assetId] ||= []).push(e);
  const out = [];
  for (const [id, l0] of Object.entries(per)) {
    const l = l0.slice().sort((x, y) => x.at - y.at);
    const close = l.filter((e, i) => (i > 0 && e.at - l[i - 1].at <= gapD * DAY) || (i < l.length - 1 && l[i + 1].at - e.at <= gapD * DAY));
    if (close.length < 2) continue;
    const same = sameModeRepeats(l, gapD)[0] || null;
    out.push({ id, events: close, n: close.length, spanD: (close[close.length - 1].at - close[0].at) / DAY, same, last: l[l.length - 1].at });
  }
  return out.sort((x, y) => (!!y.same - !!x.same) || y.n - x.n || y.last - x.last);
}

/** Failures per week over the window (oldest week first). */
export function weekly(evs, to, days) {
  const n = Math.round(days / 7);
  return Array.from({ length: n }, (_, i) => {
    const start = to - (n - i) * 7 * DAY, end = start + 7 * DAY;
    return { start, end, n: evs.filter(e => e.at >= start && (i === n - 1 ? e.at <= end : e.at < end)).length };
  });
}

// Spectrum features: peak heights at 1X, 2X, BPFO, BPFI against the median noise floor (same reading as Machine Detail).
function specFeat(sp) {
  const bin = sp.fmax / 420 * 1.6;
  const amp = f => sp.pts.reduce((m, [x, y]) => (Math.abs(x - f) <= bin ? Math.max(m, y) : m), 0);
  const ys = sp.pts.map(p => p[1]).sort((x, y) => x - y), floor = ys[ys.length >> 1];
  const a1 = amp(sp.fr), a2 = amp(2 * sp.fr), bpfo = amp(sp.bf.BPFO), bpfi = amp(sp.bf.BPFI);
  return { a1, a2, bpfo, bpfi, floor, bearing: bpfo > Math.max(0.3, 5 * floor), imbalance: a1 > 1, misalign: a2 > 0.5 && a2 > 0.5 * a1, cavitation: floor > 0.1 };
}

// A technician note: "<Hinglish> (<English>)". Returns the shift, both languages and their first sentences.
function parseNote(n) {
  const m = n.text.match(/^([\s\S]*?)\s*\(([\s\S]*)\)\s*$/);
  const hi = (m ? m[1] : n.text).trim(), en = (m ? m[2] : '').trim();
  const shift = ((en || hi).match(/^Shift (\w)\b/) || [])[1] || null;
  const strip = s => s.replace(/^Shift \w:\s*/, '');
  const first = s => (strip(s).match(/^[\s\S]*?[.!?](?=\s|$)/) || [strip(s)])[0];
  return { id: n.id, title: n.title, shift, hi, en, hiFirst: first(hi), enFirst: en ? first(en) : '', text: n.text };
}

// ---------- root-cause analysis for one machine ----------
const F = (text, status, ev, extra = {}) => ({ text, status, ev, ...extra });
const ev = (kind, ref = null, label = null) => ({ kind, ref, label });

export function buildCase(ctx, a, E, actors) {
  const { store, M, S } = ctx, W = store.world, st = store.state, t = store.t;
  const ass = M.assess(a, t), sf = ass.sensorFault;
  const fa = sf ? null : (M.activeFault(a, t) || st.faults.filter(f => f.asset === a.id && f.repairedAt && f.repairedAt <= t).sort((x, y) => y.repairedAt - x.repairedAt)[0] || null);
  const repaired = !!(fa && fa.repairedAt && fa.repairedAt <= t);
  const tE = repaired ? fa.repairedAt - 15 * MIN : t;       // evidence is read just before the repair
  const aE = repaired ? M.assess(a, tE) : ass;
  const line = M.lineById(a.lineId), site = M.siteById(a.siteId);
  const hist = W.history.filter(h => h.assetId === a.id).sort((x, y) => x.date - y.date);
  const cms = hist.filter(h => h.type === 'CM' && h.mode);
  const rec = E.win.filter(e => e.assetId === a.id);
  const pm = S.pmPlan(st.simNow).find(p => p.assetId === a.id);
  const notes = W.docs.filter(d => d.kind === 'Note' && d.text.includes(a.id)).map(parseNote);
  const sp = !sf && a.tags.some(x => x.key === 'VIB_RMS') ? M.spectrum(a, tE) : null;
  const feat = sp ? specFeat(sp) : null;
  const rank = actors.findIndex(x => x.id === a.id) + 1, actor = rank ? actors[rank - 1] : null;
  const wos = st.workOrders.filter(w => w.assetId === a.id).sort((x, y) => y.createdAt - x.createdAt);
  const wo = wos.find(w => !['DONE', 'REJECTED'].includes(w.status) && w.kind !== 'PM') || null;
  const doneWo = repaired ? wos.find(w => w.status === 'DONE' && w.kind === 'REPAIR') : null;

  let kind = sf ? 'sensor' : fa ? 'fault' : null, mode = fa ? fa.mode : null, histTop = null;
  if (!kind && rec.length) {
    const byMode = {};
    for (const e of rec) { const r = byMode[e.mode] ||= { mode: e.mode, n: 0, cost: 0 }; r.n++; r.cost += e.costInr; }
    histTop = Object.values(byMode).sort((x, y) => y.cost - x.cost || y.n - x.n)[0];
    kind = 'history'; mode = histTop.mode;
  }
  // a machine whose alarm comes from upstream (alarm-flood scenario): its own parts are not wearing
  const cqW = W.scenario.consequence;
  const upAl = (st.alerts || []).find(x => x.assetId === a.id && x.type === 'CONSEQUENCE' && x.status !== 'CLOSED');
  const upstream = cqW && cqW.from !== a.id && (upAl || (cqW.lines.includes(a.lineId) && M.tagOf(a, cqW.tag) && M.deviation(M.tagOf(a, cqW.tag), M.trendAt(a, cqW.tag, t)) > 0.1)) ? cqW.from : null;
  const base = { a, ass, line, site, rank, actor, rec, cms, notes, pm, kind, upstream };
  if (!kind) return { ...base, empty: true };

  const fm = mode ? FAILURE_MODES[mode] : null, cat = mode ? CAT[mode] : null;
  const phrase = !fm ? '' : mode === 'FM-01' && a.cls === 'cnc' ? 'spindle bearing wear' : lc(fm.name);
  const tag = key => { const tg = M.tagOf(a, key); return tg ? { tg, now: M.trendAt(a, key, tE), past: M.trendAt(a, key, tE - 72 * HOUR) } : null; };
  const cmRep = sameModeRepeats(cms.map(h => ({ mode: h.mode, at: h.date, id: h.id })));
  const ins = cmRep.find(r => r.mode === 'FM-02');
  const prior = mode && fa ? cms.filter(h => h.mode === mode && h.date < fa.onset).pop() || null : null;
  const recRep = kind === 'history' ? sameModeRepeats(rec).find(r => r.mode === mode) || null : null;
  const motor = kind === 'fault' && mode === 'FM-04' && W.scenario.hero === a.id && /motor change/i.test(W.scenario.blurb || '');
  const notePM = notes.find(n => /next PM/i.test(n.en || n.text));
  const coolantOk = notes.find(n => /coolant is fine|coolant theek/i.test(n.text));
  const sop = id => W.docs.find(d => d.id === id);
  const sop09 = sop('SOP-09'), insPct = sop09 ? (sop09.text.match(/(\d+) % above baseline/) || [])[1] : null;
  const cq = W.scenario.consequence;
  const downstream = cq && cq.from === a.id ? (st.alerts || []).filter(x => x.rootCause === a.id) : [];

  // fleet note on a bearing lot: applies to spindle bearing wear only, and is never claimed for this machine
  let lot = null;
  const lotDoc = W.docs.find(d => d.id === 'NOTE-LOT');
  if (lotDoc && mode === 'FM-01' && a.bearing && /7014/.test(a.bearing.model) && /spindle/i.test(lotDoc.text)) {
    const good = lotDoc.text.match(/stock at (\w+) is from lot (L-\d+) \((\w+)\)/);
    lot = { id: lotDoc.id, bad: (lotDoc.text.match(/lot (L-\d+)/) || [])[1], named: [...new Set(lotDoc.text.match(/\b[A-Z]{3}-\d{3}\b/g) || [])], goodCity: good?.[1], good: good?.[2], goodWord: good?.[3] };
    lot.here = lot.named.includes(a.id);
  }

  // ---- effect (the fish head) ----
  const effect = kind === 'sensor' ? { title: `${a.id}: frozen ${lc(sf.label)} sensor`, sub: `${Math.round(sf.sinceH)} h without a change · machine healthy`, tone: 'watch' }
    : kind === 'fault' ? { title: `${a.id}: ${phrase}`, sub: repaired ? `repaired ${day(fa.repairedAt)} · caught before it failed` : `health ${aE.health} · ${confPct(aE.conf)} failure confidence`, tone: repaired ? 'ok' : aE.state === 'act' ? 'act' : 'watch' }
    : { title: `${a.id}: ${phrase}, ${times(histTop.n)} in ${E.days} days`, sub: `${inr(histTop.cost)} · ${upstream ? `alarm from ${upstream} today` : ass.state === 'normal' ? 'healthy today' : `health ${ass.health} today`}`, tone: 'normal' };

  // ---- fishbone findings (1-2 per bone, most telling first) ----
  const bones = { machine: [], method: [], material: [], people: [], measurement: [], environment: [] };
  const B = bones;
  // Machine
  if (kind === 'sensor') {
    const others = a.tags.filter(x => x.key !== sf.tag && ['temp', 'elec'].includes(x.group)).map(x => lc(x.label));
    B.machine.push(F(`The machine itself looks healthy: ${list(others.slice(0, 2))} stay in their normal band`, 'out', ev('sensor')));
  } else if (kind === 'fault') {
    if (feat) {
      if (mode === 'FM-01' && feat.bearing) B.machine.push(F(`Outer-race bearing defect: the BPFO peak stands ${Math.round(feat.bpfo / feat.floor)}x above the noise floor in the spectrum`, 'data', ev('spectrum')));
      else if (mode === 'FM-04' && feat.misalign) B.machine.push(F(`High 2X vibration (${(feat.a2 / feat.a1).toFixed(1)}x the 1X peak): the fingerprint of shaft misalignment`, 'data', ev('spectrum')));
      else if (mode === 'FM-05' && feat.imbalance) B.machine.push(F(`The 1X peak dominates at ${num(feat.a1, 1)} mm/s (${Math.round(feat.a1 / Math.max(feat.a2, 0.01))}x the 2X peak): the rotor is out of balance`, 'data', ev('spectrum')));
      else if (mode === 'FM-07' && feat.cavitation) B.machine.push(F(`The whole spectrum floor is raised (${num(feat.floor, 2)} mm/s): typical of cavitation`, 'data', ev('spectrum')));
    }
    const wk = tag(aE.worstKey);
    if (wk) B.machine.push(F(wk.tg.key === 'VIB_RMS' && aE.iso ? `Vibration at ${num(wk.now, 1)} mm/s, ISO zone ${aE.iso.zone} (${aE.iso.text}); health ${aE.health}`
      : `${wk.tg.label} ${wk.tg.dir === 'low' ? 'down' : 'up'} to ${fv(wk.tg, wk.now)} (normal ${fv(wk.tg, wk.tg.normal)}, alarm ${fv(wk.tg, wk.tg.alarm)}); health ${aE.health}`, 'data', ev('sensor')));
  } else {
    B.machine.push(F(`${fm.name} ${times(histTop.n)} in ${E.days} days, costing ${inr(histTop.cost)}`, 'data', ev('record')));
    B.machine.push(upstream ? F(`Health ${ass.health} today, but the low reading comes from upstream (${upstream}), not wear on ${a.id}`, 'info', ev('sensor'))
      : ass.state === 'normal' ? F(`Healthy today (health ${ass.health}): no failure is developing now`, 'out', ev('sensor'))
      : F(`Health ${ass.health} today: see Machine Detail for what is moving`, 'info', ev('sensor')));
  }
  // Method
  for (const r of cmRep) B.method.push(F(`${FAILURE_MODES[r.mode].name} ${times(r.n)} in ${Math.round(r.gapD)} days (CMMS jobs ${day(r.first.at)} and ${day(r.last.at)})${pm && r.gapD < pm.interval ? `: faster than the ${pm.interval}-day preventive job can catch` : ''}`, 'data', ev('cmms'), { link: r.mode === 'FM-02' && mode === 'FM-01' ? 'load' : null }));
  if (prior && !cmRep.some(r => r.mode === mode)) B.method.push(F(`Same failure before: ${lc(FAILURE_MODES[mode].name)} ${ago(prior.date, t)} days ago (CMMS job ${prior.id}), so it came back`, 'data', ev('cmms')));
  if (recRep && !cmRep.some(r => r.mode === mode)) B.method.push(F(`${fm.name} ${times(recRep.n)}, ${Math.round(recRep.gapD)} days apart${pm && recRep.gapD < pm.interval ? `: faster than the ${pm.interval}-day preventive job` : ''}`, 'data', ev('record')));
  if (motor) B.method.push(F('Motor changed recently, and no laser alignment (SOP-24) is on record since', 'hyp', ev('cmms'), { link: 'align' }));
  if (pm) B.method.push(pm.overdue ? F(`Preventive job ${odays(pm)} overdue (last done ${day(pm.last)}, due every ${pm.interval} days)`, 'data', ev('cmms', null, 'PM plan'))
    : F(`Preventive job on time: next one due ${day(pm.due)}`, 'out', ev('cmms', null, 'PM plan')));
  // Material
  if (kind === 'sensor') B.material.push(F('Accelerometer cable or mounting: the usual cause of a frozen reading (SOP-50)', 'hyp', ev('policy', 'SOP-50'), { link: 'cable' }));
  else if (lot) {
    B.material.push(lot.here ? F(`This machine is named in the supplier note: lot ${lot.bad} caused its early bearing failure`, 'data', ev('note', lot.id))
      : F(`Fleet finding, not proven here: bearing lot ${lot.bad} caused early failures on ${list(lot.named)}. Which lot ${a.id}'s bearing came from is not recorded`, 'hyp', ev('note', lot.id), { link: 'lot' }));
    const plan = M.partPlan(a, 'FM-01');
    if (kind === 'fault' && lot.good && plan && plan.kind === 'transfer' && M.siteById(plan.from)?.city === lot.goodCity) B.material.push(F(`The replacement set comes from ${lot.goodCity} stock: lot ${lot.good}, which ${lot.goodWord}`, 'out', ev('note', lot.id), { word: 'Ruled out for the new part' }));
  } else if (cat) B.material.push(F(cat.material, 'hyp', ev('policy', fm.sop), { link: mode === 'FM-05' ? 'buildup' : null }));
  // People
  for (const n of notes) B.people.push(F(`${n.shift ? `Shift ${n.shift}` : 'A technician'} wrote it down: "${n.enFirst || n.hiFirst}"`, 'data', ev('note', n.id), { quote: n.en ? n.hiFirst : null }));
  if (!notes.length && motor) B.people.push(F('No note from the crew that changed the motor: ask whether they re-aligned the shafts', 'hyp', ev('note'), { link: 'align' }));
  else if (!notes.length) B.people.push(F(`No operator or technician note logged for ${a.id}`, 'out', ev('note'), { word: 'Nothing logged' }));
  const oee = W.oee.filter(r => r.lineId === a.lineId);
  if (oee.length) {
    const sh = s => oee.reduce((x, r) => x + (r.shifts.find(q => q.shift === s)?.oee || 0), 0) / oee.length;
    const gap = (sh('A') - sh('C')) * 100;
    if (gap >= 3) B.people.push(F(`Night shift C runs ${Math.round(gap)} OEE points below shift A on this line (30 days): check that night checks happen`, 'info', ev('record', null, 'OEE by shift')));
  }
  // Measurement
  if (kind === 'sensor') B.measurement.push(F(`${sf.label} sensor frozen for ${Math.round(sf.sinceH)} h while the related sensors move: a sensor fault, not wear (SOP-50)`, 'data', ev('sensor')));
  else if (kind === 'fault') {
    const moved = aE.contributions.filter(x => x.dev > 0.1).map(x => lc(x.label));
    B.measurement.push(moved.length >= 2 ? F(`${moved.length} sensors moved together (${list(moved)}): real wear, not a sensor fault`, 'data', ev('sensor'))
      : F('Only one sensor has moved so far: it could still be a sensor or process issue', 'hyp', ev('sensor')));
  } else {
    const off = ass.contributions.filter(x => x.dev > 0.1);
    B.measurement.push(!off.length ? F(`All ${a.tags.length} sensors normal today and none frozen`, 'out', ev('sensor'))
      : upstream && off.every(x => x.key === cqW.tag) ? F(`Only the ${lc(off[0].label)} is off, and it follows ${upstream}: the machine's own sensors are normal`, 'out', ev('sensor'))
      : F(`${list(off.map(x => lc(x.label)))} off normal today`, 'info', ev('sensor')));
  }
  // Environment
  if (cq && cq.from !== a.id && cq.lines.includes(a.lineId)) {
    const c = tag(cq.tag);
    if (c && M.deviation(c.tg, c.now) > 0.1) B.environment.push(F(`${c.tg.label} fed by ${cq.from} is down to ${fv(c.tg, c.now)}: the cause is upstream`, 'data', ev('sensor')));
  }
  for (const key of ['COOLANT_PRESS', 'AIR_PRESS', 'HYD_PRESS']) {
    const c = tag(key);
    if (!c || (cq && key === cq.tag && B.environment.length)) continue;
    const ok = M.deviation(c.tg, c.now) < 0.1;
    B.environment.push(ok ? F(`${c.tg.label} normal at ${fv(c.tg, c.now)} (alarm below ${fv(c.tg, c.tg.alarm)})${key === 'COOLANT_PRESS' && coolantOk ? `, and the ${coolantOk.shift ? 'Shift ' + coolantOk.shift + ' ' : ''}note says the coolant is fine` : ''}`, 'out', ev('sensor'))
      : F(`${c.tg.label} low at ${fv(c.tg, c.now)} (alarm below ${fv(c.tg, c.tg.alarm)})`, 'data', ev('sensor')));
  }
  if (mode === 'FM-07' && kind === 'fault') B.environment.push(F('The suction side (strainer, sump level) has no sensor: check it first (SOP-12)', 'hyp', ev('policy', 'SOP-12'), { link: 'suction' }));
  B.environment.push(F('Ambient temperature, humidity and dust are not measured on this machine', 'out', ev('sensor'), { word: 'Not measured' }));
  const spd = a.tags.find(x => ['SPEED_RPM', 'SPINDLE_RPM', 'STROKES'].includes(x.key));
  if (spd && B.environment.length < 2) { const c = tag(spd.key); B.environment.unshift(F(`${spd.label} steady at ${fv(spd, c.now)}: no process upset`, 'out', ev('sensor'))); }
  for (const k in B) B[k] = B[k].slice(0, 2);

  // ---- 5 whys (data first, hypotheses last) ----
  const whys = [];
  const Q = (q, answers) => whys.push({ n: whys.length + 1, q, answers });
  const A = (text, status, e, key = null, claim = null) => ({ text, status, ev: e, key, claim });
  if (kind === 'sensor') {
    const rel = a.tags.filter(x => x.key !== sf.tag && ['temp', 'elec'].includes(x.group)).map(x => lc(x.label));
    Q(`Why did ${a.id} raise an alert?`, [A(`Its ${lc(sf.label)} reading has not changed for ${Math.round(sf.sinceH)} h.`, 'data', ev('sensor'))]);
    Q('Why do we say it is the sensor, not the machine?', [A(`The related sensors (${list(rel)}) keep moving and stay normal: a real machine is never that still (SOP-50).`, 'data', ev('sensor'))]);
    Q('Why did the reading freeze?', [A('A loose cable or a failed accelerometer mounting, the usual causes listed in SOP-50.', 'hyp', ev('policy', 'SOP-50'), 'cable', 'a loose cable or a failed sensor mounting')]);
    Q('Why could it have sent a crew to a healthy machine?', [A('The alarm rules alone would treat a frozen high reading as real; only the model checks for flat lines today.', 'hyp', ev('policy'), 'policy-flat', 'no frozen-reading check in the alarm rules')]);
  } else if (kind === 'fault') {
    const iso = aE.iso ? `, vibration in ISO zone ${aE.iso.zone}` : '';
    Q(`Why is ${a.id} ${repaired ? 'being analysed' : 'at risk of stopping'}?`, [A(repaired
      ? `${cap(phrase)} was caught before it failed and repaired on ${day(fa.repairedAt)}${doneWo ? ` (${doneWo.id})` : ''}. The evidence below is from just before the repair.`
      : `${cap(phrase)} is developing: health ${aE.health}, ${confPct(aE.conf)} failure confidence${iso}, about ${hours(aE.rulH)} to failure.${downstream.length ? ` It also starves the machines it feeds: ${plural(downstream.length, 'alarm')} downstream are grouped under it.` : ''}`, 'data', ev('sensor'))]);
    const t1 = tag('BEARING_TEMP'), oil = tag('OIL_TEMP'), dp = tag('DISCH_PRESS');
    const tempUp = t1 && t1.now - t1.past >= 3 ? ` and bearing temperature is up ${num(t1.now - t1.past, 0)} °C in 3 days` : '';
    const moved = aE.contributions.filter(x => x.dev > 0.1).length;
    const agree = moved >= 2 ? `; ${moved} sensors agree, so it is not a sensor fault` : '';
    let why2 = null;
    if (mode === 'FM-01' && feat?.bearing) why2 = A(`The BPFO peak (a ball rolling over an outer-race defect) stands ${Math.round(feat.bpfo / feat.floor)}x above the spectrum's noise floor${tempUp}${agree}.`, 'data', ev('spectrum'));
    else if (mode === 'FM-04' && feat?.misalign) why2 = A(`2X vibration is ${(feat.a2 / feat.a1).toFixed(1)}x the 1X peak, the fingerprint of misalignment${oil && oil.now - oil.past >= 3 ? `, and oil temperature is up ${num(oil.now - oil.past, 0)} °C` : ''}${agree}.`, 'data', ev('spectrum'));
    else if (mode === 'FM-05' && feat?.imbalance) why2 = A(`The 1X peak dominates at ${num(feat.a1, 1)} mm/s: a heavy spot on the rotor shakes it once per turn${agree}.`, 'data', ev('spectrum'));
    else if (mode === 'FM-07' && dp) why2 = A(`Discharge pressure fell to ${fv(dp.tg, dp.now)} (normal ${fv(dp.tg, dp.tg.normal)})${feat?.cavitation ? ' and the spectrum floor is raised, the noise of collapsing vapour bubbles' : ''}${agree}.`, feat?.cavitation ? 'data' : 'data', ev(feat?.cavitation ? 'spectrum' : 'sensor'));
    else why2 = A(`Its signature signals moved: ${list(aE.contributions.filter(x => x.dev > 0.05).slice(0, 3).map(x => lc(x.label)))}${agree}.`, 'data', ev('sensor'));
    Q(`Why do we say it is ${fm.short}?`, [why2]);
    if (pm && pm.overdue) Q('Why was it not caught at a planned stop?', [A(`The preventive job is ${odays(pm)} overdue (last done ${day(pm.last)}, due every ${pm.interval} days)${notePM ? `, and the ${notePM.shift ? 'Shift ' + notePM.shift + ' ' : ''}note asked for a bearing check at that job` : ''}.`, 'data', ev('cmms', null, 'PM plan'))]);
    else if (prior) Q('Why did it come back?', [A(`${cap(lc(FAILURE_MODES[mode].name))} was repaired ${ago(prior.date, t)} days ago (CMMS job ${prior.id}). The preventive job comes every ${pm ? pm.interval : '?'} days, longer than the ${ago(prior.date, fa.onset)} days that fix lasted, so it cannot get there first.`, 'data', ev('cmms'))]);
    else Q('Why was it not caught at a planned stop?', [A(`It started between planned jobs: the last preventive job was ${pm ? ago(pm.last, t) : '?'} days ago and the change began about ${hours((tE - fa.onset) / HOUR)} ago.`, 'data', ev('cmms', null, 'PM plan'))]);
    // the deeper whys are hypotheses until someone confirms them at teardown
    const opts = [];
    if (mode === 'FM-01') {
      if (ins) opts.push(A(`Extra spindle load: tool inserts wore out ${times(ins.n)} in ${Math.round(ins.gapD)} days (CMMS), and a blunt insert pushes more cutting force into the spindle bearing.`, 'hyp', ev('cmms'), 'load', 'extra spindle load from worn tool inserts'));
      if (lot && !lot.here) opts.push(A(`A weak bearing: lot ${lot.bad} failed early on ${list(lot.named)} (a fleet finding). Whether ${a.id}'s set came from that lot is not recorded: read the lot number at teardown.`, 'hyp', ev('note', lot.id), 'lot', `a weak bearing from lot ${lot.bad}`));
    } else if (mode === 'FM-04' && motor) opts.push(A('The shafts were not re-aligned after the motor change: no laser alignment (SOP-24) is on record since.', 'hyp', ev('cmms'), 'align', 'shafts not re-aligned after the motor change'));
    else if (mode === 'FM-05') opts.push(A(`Clinker has built up on the blades${prior ? ' again' : ''}: SOP-25 names build-up as the usual cause.`, 'hyp', ev('policy', 'SOP-25'), 'buildup', 'build-up on the fan blades'));
    else if (mode === 'FM-07') opts.push(A("The pump's suction is starved: a blocked strainer or a low sump level (SOP-12 checks these first).", 'hyp', ev('policy', 'SOP-12'), 'suction', 'a starved suction (strainer or sump level)'));
    if (!opts.length) opts.push(A(`${cat.cause}.`, 'hyp', ev('policy', fm.sop), 'cause', cat.claim));
    Q(`Why is ${a.id} getting ${fm.short}?`, opts);
    if (mode === 'FM-01' && ins) Q('Why does the plan let that happen?', [A(`Inserts are changed when they break, not at +${insPct || '15'} % cutting current as SOP-09 asks, so the spindle keeps cutting with blunt tools.`, 'hyp', ev('policy', 'SOP-09'), 'policy-insert', 'inserts changed on breakdown, not by cutting current')]);
    else if (mode === 'FM-05' && prior && pm) Q('Why does the plan let it come back?', [A(`Blade cleaning only happens at the ${pm.interval}-day preventive job, but the build-up returned within ${ago(prior.date, fa.onset)} days last time.`, 'hyp', ev('policy'), 'policy-clean', 'cleaning interval longer than the build-up time')]);
    else if (mode === 'FM-07' && pm) Q('Why does the plan let it happen?', [A(`The sump level and strainer are only checked at the ${pm.interval}-day preventive job, not on the shift round.`, 'hyp', ev('policy'), 'policy-round', cat.sysClaim)]);
    else Q('Why does the plan let it happen?', [A(`${cat.system}.`, 'hyp', ev('policy'), 'policy', cat.sysClaim)]);
  } else {
    Q(rank && rank <= 8 ? `Why is ${a.id} on the bad-actor list?` : `Why look at ${a.id}?`, [A(`${plural(rec.length, 'failure')} in ${E.days} days cost ${inr(actor ? actor.cost : rec.reduce((s, e) => s + e.costInr, 0))}${rank ? `, number ${rank} of the ${actors.length} machines that failed` : ''}.`, 'data', ev('record'))]);
    const own = rec.reduce((s, e) => s + e.costInr, 0) || 1;
    Q('Which failure costs it most?', [A(`${fm.name}: ${times(histTop.n)}, ${inr(histTop.cost)} (${pctS(histTop.cost / own)} of its failure cost).`, 'data', ev('record'))]);
    Q('Why was it not prevented?', [A(pm && pm.overdue ? `The preventive job is ${odays(pm)} overdue (last done ${day(pm.last)}).`
      : recRep && pm ? `The same failure came back after ${Math.round(recRep.gapD)} days, faster than the ${pm.interval}-day preventive job.`
      : `${rec.length > 1 ? 'The failures fell' : 'The failure fell'} between preventive jobs${pm ? ` (every ${pm.interval} days)` : ''}: nothing in the plan looks for ${fm.short} in between.`, 'data', ev('cmms', null, 'PM plan'))]);
    const opts = [A(`${cat.cause}.`, 'hyp', ev('policy', fm.sop), 'cause', cat.claim)];
    if (lot) opts.push(lot.here ? A(`A weak bearing: the supplier note names ${a.id} among the early failures from lot ${lot.bad}. Check that it means this failure.`, 'hyp', ev('note', lot.id), 'lot', `a weak bearing from lot ${lot.bad}`)
      : A(`A weak bearing: lot ${lot.bad} failed early on ${list(lot.named)} (a fleet finding, not proven here). Read the lot number at teardown.`, 'hyp', ev('note', lot.id), 'lot', `a weak bearing from lot ${lot.bad}`));
    Q(`Why does ${fm.short} happen on ${a.id}?`, opts);
    Q(histTop.n > 1 ? 'Why does the plan let it repeat?' : 'Why does the plan let it happen?', [A(`${cat.system}.`, 'hyp', ev('policy'), 'policy', cat.sysClaim)]);
  }
  for (const w of whys) w.answers.forEach((x, j) => { if (x.status === 'hyp') x.detail = `Why ${w.n}${w.answers.length > 1 ? String.fromCharCode(97 + j) : ''}: ${x.claim}`; });

  // ---- corrective actions: fix now, stop it coming back ----
  const now = [], prevent = [];
  const WO_WORD = { PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', SCHEDULED: 'scheduled', IN_PROGRESS: 'in progress' };
  if (wo) now.push({ text: `${wo.id}: ${wo.title}${wo.sop ? ` (${wo.sop})` : ''}, ${WO_WORD[wo.status] || lc(wo.status)}`, owner: wo.status === 'PENDING_APPROVAL' ? 'Maintenance head approves' : wo.technician ? `${wo.technician.name}, technician` : 'Technician', href: `#/orders/${wo.id}`, cta: wo.status === 'PENDING_APPROVAL' ? 'Review and approve' : 'Open the work order', primary: wo.status === 'PENDING_APPROVAL' });
  else if (repaired) now.push({ text: `Repaired ${day(fa.repairedAt)}${doneWo ? ` (${doneWo.id})` : ''}: use the teardown to confirm or reject the hypotheses`, owner: 'Technician who did the repair', done: true });
  else if (kind === 'fault' || kind === 'sensor') now.push({ text: 'No work order yet: open the alert and ask Nirantar to draft one', owner: 'Maintenance planner', href: '#/triage', cta: 'Open Alert Triage' });
  else if (upstream) now.push({ text: `Nothing to fix on ${a.id}: its alarm comes from ${upstream}. Fix that first`, owner: 'Maintenance planner', href: `#/reliability/${upstream}`, cta: `Root cause of ${upstream}`, primary: true });
  else if (ass.state !== 'normal') now.push({ text: `${a.id} is not normal today (health ${ass.health}): check it on Machine Detail`, owner: 'Maintenance planner', href: `#/machine/${a.id}`, cta: 'Machine Detail' });
  else now.push({ text: `Nothing to fix today: ${a.id} is healthy (health ${ass.health})`, owner: 'No action', done: true });
  if (pm && pm.overdue) prevent.push({ text: `Bring the overdue preventive job back on the calendar${notePM ? ' and add the bearing check the note asked for' : ''}`, owner: 'Maintenance planner', href: '#/schedule', cta: 'Maintenance calendar' });
  if (kind === 'sensor') prevent.push({ text: `Add a frozen-reading check to the alarm rules for ${a.id}`, owner: 'Instrumentation technician', href: '#/rules', cta: 'Alarm rules' });
  if (mode === 'FM-01' && ins) prevent.push({ text: `Change tool inserts at +${insPct || '15'} % cutting current (SOP-09), not on breakdown`, owner: 'Production supervisor' });
  if (lot && !lot.here) prevent.push({ text: `Read the lot number on the ${kind === 'fault' ? 'removed bearing set' : 'bearing set fitted at the last repair'}; if it is ${lot.bad}, quarantine the rest and tell the supplier`, owner: 'Quality engineer' });
  if (mode === 'FM-04') prevent.push({ text: CAT['FM-04'].prevent, owner: CAT['FM-04'].owner });
  if (mode === 'FM-04' && kind === 'fault') prevent.push({ text: 'Re-check 2X vibration 24 h after the alignment', owner: 'Reliability engineer', href: `#/machine/${a.id}`, cta: 'Machine Detail' });
  if (mode === 'FM-05') {
    const gapD = prior && fa ? ago(prior.date, fa.onset) : recRep ? Math.round(recRep.gapD) : null;
    prevent.push({ text: gapD ? `Clean the blades every ${Math.max(2, Math.floor(gapD * 0.75 / 7))} weeks: the build-up came back within ${gapD} days, but the preventive job is every ${pm ? pm.interval : '?'} days` : CAT['FM-05'].prevent, owner: 'Maintenance planner', href: '#/schedule', cta: 'Maintenance calendar' });
  }
  if (mode === 'FM-07') {
    prevent.push({ text: CAT['FM-07'].prevent, owner: CAT['FM-07'].owner });
    const sb = W.assets.find(x => x.lineId === a.lineId && x.id !== a.id && /standby/i.test(x.name));
    const sbp = sb && S.pmPlan(st.simNow).find(p => p.assetId === sb.id);
    if (sb && sbp) prevent.push({ text: `Keep the standby pump ${sb.id} ready: its preventive job is ${sbp.overdue ? `${odays(sbp)} overdue` : `due ${day(sbp.due)}`}`, owner: 'Maintenance planner', href: '#/schedule', cta: 'Maintenance calendar' });
  }
  if (recRep && pm && recRep.gapD < pm.interval && mode !== 'FM-05') prevent.push({ text: `Check for ${fm.short} every ${Math.max(7, Math.floor(recRep.gapD * 0.75))} days instead of every ${pm.interval}, or on condition`, owner: 'Reliability engineer', href: '#/schedule', cta: 'Maintenance calendar' });
  const specific = (mode === 'FM-01' && ins) || ['FM-04', 'FM-05', 'FM-07'].includes(mode) || (recRep && pm && recRep.gapD < pm.interval);
  if (cat && !specific && kind !== 'sensor') prevent.push({ text: cat.prevent, owner: cat.owner });

  const used = [kind !== 'history' ? 'live sensors' : null, feat && kind !== 'history' ? 'the vibration spectrum' : null, cms.length ? plural(cms.length, 'CMMS job') : null,
    kind === 'history' ? plural(rec.length, 'failure') + ' in the record' : null, notes.length ? plural(notes.length, 'note') : null, lot ? 'the supplier quality note' : null, pm ? 'the PM plan' : null].filter(Boolean);
  return { ...base, mode, fm, phrase, effect, bones, whys, now, prevent, used, repaired, wo };
}

// ---------- charts (SVG strings at measured width) ----------
function paretoSvg(P, w, heroMode) {
  const fmt = v => (P.by === 'cost' ? inrC(v) : P.by === 'down' ? `${Math.round(v)} h` : String(v));
  const rows = P.rows, n = rows.length, name = r => FAILURE_MODES[r.mode].name;
  const title = `Failure modes ranked ${BY_WORD[P.by] === 'failures' ? 'by number of failures' : 'by ' + BY_WORD[P.by]}, with the running total`;
  let g = '';
  if (w < 560) {   // phone: rotated Pareto (bars run sideways, the running total goes down the page)
    const rowH = 46, T = 26, B = 22, R = 6, pw = w - R, h = T + n * rowH + B, X = p => f1(p * pw);
    for (const p of [0, 0.5, 1]) g += `<line x1="${X(p)}" x2="${X(p)}" y1="${T - 6}" y2="${h - B}" class="rel-grid"/><text x="${X(p)}" y="${h - 6}" text-anchor="${p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}">${p * 100} %</text>`;
    g += `<line x1="${X(0.8)}" x2="${X(0.8)}" y1="${T - 6}" y2="${h - B}" class="rel-ref"/><text x="${X(0.8)}" y="${T - 10}" text-anchor="middle" class="lbl-strong">80 %</text>`;
    rows.forEach((r, i) => {
      const y = T + i * rowH, vital = i < P.vital;
      g += `<rect x="0" y="${y + 21}" width="${pw}" height="12" rx="2" class="rel-track"/><rect x="0" y="${y + 21}" width="${Math.max(2, X(r.share))}" height="12" rx="2" class="rel-bar${vital ? ' vital' : ''}"><title>${esc(name(r))}: ${esc(fmt(r.v))}</title></rect>`;
    });
    // the running total goes under the row labels, which sit on small panel-coloured plates so the line never crosses text
    const pts = rows.map((r, i) => [X(r.cum), T + i * rowH + 27]);
    g += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')}" class="rel-cum"/>`;
    rows.forEach((r, i) => {
      const y = T + i * rowH, hero = r.mode === heroMode, left = `${i + 1}. ${name(r)}`, right = `${P.by === 'cost' ? inr(r.v) : fmt(r.v)} · ${pctS(r.share)}`;
      const lw = textW(left, 12, hero ? 600 : 400) + 4, rw = textW(right, 12, 600) + 6;
      g += `<rect x="0" y="${y + 1}" width="${f1(lw)}" height="18" class="rel-plate"/><rect x="${f1(pw - rw)}" y="${y + 1}" width="${f1(rw)}" height="18" class="rel-plate"/>`;
      g += `<text x="0" y="${y + 14}" class="rel-hl${hero ? ' lbl-strong' : ''}">${esc(left)}</text><text x="${pw}" y="${y + 14}" text-anchor="end" class="rel-hl lbl-strong">${esc(right)}</text>`;
    });
    g += pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="rel-cumdot"/>`).join('');
    return raw(`<svg class="chart rel-pareto" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${g}</svg>`);
  }
  const h = 300, L = 42, R = 50, T = 22, Bm = 44, pw = w - L - R, ph = h - T - Bm, bw = pw / n, barW = Math.min(70, bw * 0.6);
  const Y = p => f1(T + (1 - p) * ph);
  for (const p of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${L}" x2="${w - R}" y1="${Y(p)}" y2="${Y(p)}" class="rel-grid"/><text x="${L - 6}" y="${Y(p) + 4}" text-anchor="end">${p * 100} %</text>`;
  g += `<line x1="${L}" x2="${w - R}" y1="${Y(0.8)}" y2="${Y(0.8)}" class="rel-ref"/><text x="${w - R + 6}" y="${Y(0.8) + 4}" class="lbl-strong">80 %</text>`;
  rows.forEach((r, i) => {
    const cx = L + bw * (i + 0.5), y = Y(r.share), bh = Y(0) - y, vital = i < P.vital, hero = r.mode === heroMode;
    g += `<rect x="${f1(cx - barW / 2)}" y="${y}" width="${f1(barW)}" height="${f1(Math.max(1, bh))}" rx="2" class="rel-bar${vital ? ' vital' : ''}"><title>${esc(name(r))}: ${esc(fmt(r.v))} (${pctS(r.share)})</title></rect>`;
    g += bh >= 22 && textW(fmt(r.v), 11, 600) < barW - 4 ? `<text x="${f1(cx)}" y="${f1(y + 15)}" text-anchor="middle" class="rel-in${vital ? '' : ' light'}">${esc(fmt(r.v))}</text>`
      : `<text x="${f1(cx)}" y="${f1(y - 5)}" text-anchor="middle" class="lbl-strong">${esc(fmt(r.v))}</text>`;
    wrapText(name(r), bw - 6, 11, hero ? 600 : 400).slice(0, 2).forEach((ln, j) => { g += `<text x="${f1(cx)}" y="${h - Bm + 16 + j * 13}" text-anchor="middle" class="${hero ? 'lbl-strong' : ''}">${esc(ln)}</text>`; });
  });
  const pts = rows.map((r, i) => [f1(L + bw * (i + 0.5)), Y(r.cum)]);
  g += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')}" class="rel-cum"/>`;
  pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="rel-cumdot"/><text x="${p[0]}" y="${p[1] - 8}" text-anchor="middle" class="rel-cumlab">${pctS(rows[i].cum)}</text>`; });
  return raw(`<svg class="chart rel-pareto" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${g}</svg>`);
}

function trendSvg(weeks, w, stats) {
  const h = 210, L = 26, R = 40, T = 22, Bm = 24, n = weeks.length, pw = w - L - R, ph = h - T - Bm, bw = pw / n;
  const max = Math.max(...weeks.map(x => x.n), stats.mean, 1) * 1.2, Y = v => f1(T + (1 - v / max) * ph);
  const step = Math.max(1, Math.ceil(max / 3));
  let g = '';
  for (let v = 0; v <= max; v += step) g += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" class="rel-grid"/><text x="${L - 5}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const every = bw < 44 ? 2 : 1;
  weeks.forEach((wk, i) => {
    const x = L + i * bw + bw * 0.18, cw = bw * 0.64, y = Y(wk.n), high = wk.n > stats.mean + stats.sd;
    g += `<rect x="${f1(x)}" y="${y}" width="${f1(cw)}" height="${f1(Math.max(1, Y(0) - y))}" rx="2" class="rel-col${high ? ' high' : ''}"><title>Week of ${esc(day(wk.start))}: ${plural(wk.n, 'failure')}</title></rect>`;
    g += `<text x="${f1(x + cw / 2)}" y="${y - 5}" text-anchor="middle" class="lbl-strong rel-halo${high ? ' rel-high' : ''}">${high ? '▲ ' : ''}${wk.n}</text>`;
    if (i % every === (n - 1) % every) g += `<text x="${f1(x + cw / 2)}" y="${h - 7}" text-anchor="middle">${esc(day(wk.start))}</text>`;
  });
  g += `<line x1="${L}" x2="${w - R}" y1="${Y(stats.mean)}" y2="${Y(stats.mean)}" class="rel-mean"/><text x="${w - R + 4}" y="${Y(stats.mean) - 2}" class="lbl-strong">avg</text><text x="${w - R + 4}" y="${Y(stats.mean) + 11}">${num(stats.mean, 1)}</text>`;
  return raw(`<svg class="chart rel-trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Failures per week with the average line"><title>Failures per week with the average line</title>${g}</svg>`);
}

// Fishbone (Ishikawa): six bones meet the spine; each finding hangs on a rib with a coloured status dot.
function fishSvg(rc, w, stat) {
  const FS = 12.5, LH = 16, SFS = 12, SLH = 15, PILL = 26, GAP = 10;
  const headW = Math.max(170, Math.min(220, Math.round(w * 0.19)));
  const L = 6, spineEnd = w - headW - 6, regW = (spineEnd - L) / 3, slant = 46, colW = regW - slant - 34;
  const blocks = BONES.map(([k]) => rc.bones[k].map(f => {
    const s = stat(f);
    const lines = wrapText(f.text, colW, FS), q = f.quote ? wrapText(`"${f.quote}"`, colW, SFS, 400, true) : [];
    const meta = wrapText(`${evText(f.ev)} · ${s.word}`, colW, SFS, 600);
    return { f, s, lines, q, meta, h: lines.length * LH + q.length * SLH + meta.length * SLH + 4 };
  }));
  const stackH = i => Math.max(LH, blocks[i].reduce((s, b) => s + b.h + GAP, 0));
  const T = 2, topStart = T + PILL + 14, topH = Math.max(stackH(0), stackH(1), stackH(2));
  const spineY = topStart + topH + 6, botStart = spineY + 18, botH = Math.max(stackH(3), stackH(4), stackH(5));
  const botEnd = botStart + botH, H = botEnd + 12 + PILL + 2;
  let g = `<line x1="${L}" y1="${spineY}" x2="${spineEnd - 8}" y2="${spineY}" class="fb-spine"/><path d="M${spineEnd - 14},${spineY - 8} L${spineEnd},${spineY} L${spineEnd - 14},${spineY + 8}Z" class="fb-arrow"/>`;
  const hx = spineEnd + 4, hw = w - hx - 1, tl = wrapText(rc.effect.title, hw - 22, 14, 600), sl = wrapText(rc.effect.sub, hw - 22, SFS), hh = tl.length * 18 + sl.length * SLH + 24;
  g += `<rect x="${hx}" y="${f1(spineY - hh / 2)}" width="${hw}" height="${hh}" rx="10" class="fb-head ${rc.effect.tone}"/>`;
  let hy = spineY - hh / 2 + 24;
  tl.forEach(ln => { g += `<text x="${hx + 11}" y="${f1(hy)}" class="fb-ht">${esc(ln)}</text>`; hy += 18; });
  sl.forEach(ln => { g += `<text x="${hx + 11}" y="${f1(hy)}" class="fb-hs">${esc(ln)}</text>`; hy += SLH; });
  BONES.forEach(([, label], i) => {
    const top = i < 3, col = i % 3, x1 = L + (col + 1) * regW - 8, x0 = x1 - slant, yEnd = top ? T + PILL : botEnd + 12;
    const boneX = y => x0 + (y - yEnd) / (spineY - yEnd) * (x1 - x0);
    g += `<line x1="${f1(x0)}" y1="${yEnd}" x2="${f1(x1)}" y2="${spineY}" class="fb-bone"/>`;
    const pw = textW(label, 13, 600) + 24, py = top ? T : botEnd + 12;
    g += `<rect x="${f1(x0 - pw / 2)}" y="${py}" width="${f1(pw)}" height="${PILL}" rx="13" class="fb-pill"/><text x="${f1(x0)}" y="${py + 17.5}" text-anchor="middle" class="fb-cat">${esc(label)}</text>`;
    const xl = L + col * regW + 4;
    let y = top ? topStart : botStart;
    if (!blocks[i].length) g += `<text x="${xl}" y="${y + 12}" class="fb-meta" style="fill:var(--ink-3)">Nothing found</text>`;
    for (const b of blocks[i]) {
      let ty = y + 12;
      for (const ln of b.lines) { g += `<text x="${xl}" y="${f1(ty)}" class="fb-t">${esc(ln)}</text>`; ty += LH; }
      for (const ln of b.q) { g += `<text x="${xl}" y="${f1(ty)}" class="fb-q" lang="hi-Latn">${esc(ln)}</text>`; ty += SLH; }
      for (const ln of b.meta) { g += `<text x="${xl}" y="${f1(ty)}" class="fb-meta" style="fill:${INK[b.s.k]}">${esc(ln)}</text>`; ty += SLH; }
      const ry = y + 8, rx0 = xl + Math.min(colW, textW(b.lines[0], FS)) + 6, rx1 = boneX(ry);
      g += `<line x1="${f1(rx0)}" y1="${f1(ry)}" x2="${f1(rx1)}" y2="${f1(ry)}" class="fb-rib"/><circle cx="${f1(rx1)}" cy="${f1(ry)}" r="5.5" class="fb-dot" style="fill:${DOT[b.s.k]}"/>`;
      y += b.h + GAP;
    }
  });
  const label = `Fishbone diagram: possible causes of ${rc.effect.title}, grouped into machine, method, material, people, measurement and environment`;
  const desc = BONES.map(([k, l], i) => `${l}: ${blocks[i].length ? blocks[i].map(b => `${b.f.text} (${evText(b.f.ev)}, ${b.s.word})`).join('; ') : 'nothing found'}.`).join(' ');
  return raw(`<svg class="rel-fish" viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><desc>${esc(desc)}</desc>${g}</svg>`);
}
const evText = e => `${e.label || EVK[e.kind][1]}${e.ref ? ' ' + e.ref : ''}`;

// ---------- page ----------
export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, st = store.state, t = store.t;
    const d = dims(root);
    const E = failureEvents(W);
    const P = pareto(E.win, ui.by), Pc = ui.by === 'cost' ? P : pareto(E.win, 'cost');
    const actors = badActors(E.win);
    const reps = repeatFailures(E.all);
    const repIds = new Set(reps.filter(r => r.same).map(r => r.id));
    const hero = W.scenario.hero ? M.assetById(W.scenario.hero) : null;
    const a = M.assetById(params[0]) || hero || M.assetById(actors[0].id);
    const rc = buildCase(ctx, a, E, actors);
    const heroMode = hero ? (M.activeFault(hero, t)?.mode || null) : null;
    const weeks = weekly(E.win, E.to, E.days);
    const mean = weeks.reduce((s, x) => s + x.n, 0) / weeks.length;
    const sd = Math.sqrt(weeks.reduce((s, x) => s + (x.n - mean) ** 2, 0) / weeks.length);
    const LS = lineStats(W, E.win, E.days, ui.site);

    // confirmations: module state for this scenario + the audit log (survives reloads)
    const conf = {};
    for (const r of st.audit || []) if (r.action === ACTION && r.target === a.id && !conf[r.detail]) conf[r.detail] = { by: r.actor, at: r.ts };
    const pre = `${scenKey(st)}|${a.id}|`;
    for (const [k, v] of Object.entries(ui.confirmed)) if (k.startsWith(pre)) conf[k.slice(pre.length)] ||= v;
    const byKey = {};
    if (!rc.empty) for (const w of rc.whys) for (const x of w.answers) if (x.detail && conf[x.detail]) byKey[x.key] = conf[x.detail];
    const stat = f => (f.link && byKey[f.link] ? { k: 'ok', word: `Confirmed by ${byKey[f.link].by}` } : { k: f.status, word: f.word || WORD[f.status] });
    if (ui.name == null) ui.name = store.prefs.name || '';

    const top = Pc.rows[0], heroRep = hero ? reps.find(r => r.id === hero.id && r.same) : null;
    const sameN = reps.filter(r => r.same).length;
    const ta = M.assetById(actors[0].id), tl = M.lineById(ta.lineId);
    // today's case: a repeat within 60 days, or the same failure back after an older CMMS fix
    const heroFault = hero ? M.activeFault(hero, t) : null;
    const heroPrior = heroFault && !heroRep ? W.history.filter(h => h.assetId === hero.id && h.type === 'CM' && h.mode === heroFault.mode && h.date < heroFault.onset).pop() : null;
    const head = headline(html`<b>${FAILURE_MODES[top.mode].name}</b> caused <b>${pctS(top.share)}</b> of failure cost in the last ${E.days} days (${inr(top.v)} of ${inr(Pc.total)}).
      <b>${ta.id}</b> (${lc(ta.name)}, ${tl.utility ? 'utilities' : tl.name}, ${M.siteById(ta.siteId).city}) is the top bad actor at ${inr(actors[0].cost)}, and <b>${plural(sameN, 'machine')}</b> failed the same way twice within ${REPEAT_D} days${heroRep ? html`, including today's case <b>${hero.id}</b> (${FAILURE_MODES[heroRep.same.mode].short}, ${Math.round(heroRep.same.gapD)} days apart)` : ''}.${heroPrior ? html` Today's case <b>${hero.id}</b> is a repeat too: ${FAILURE_MODES[heroFault.mode].short} is back ${ago(heroPrior.date, heroFault.onset)} days after the last fix.` : ''}`, sameN || heroPrior ? 'watch' : '');

    root.innerHTML = String(html`<div class="page relpage">
  ${pageHead('reliability')}
  ${head}
  ${doThis([
    html`Read the Pareto ${marker(1)}: the first ${plural(P.vital, 'failure mode')} make ${pctS(P.cumAtVital)} of the ${BY_WORD[ui.by]}. Switch between cost, count and downtime.`,
    html`Find the weakest line ${marker(2)}: amber marks the lowest availability.`,
    html`Pick a bad actor or a repeat failure ${marker(3)} and press <b>Root cause</b>.`,
    html`Walk the 5 whys ${marker(4)}: blue links are proven by data; confirm the amber hypotheses at teardown with your name.`,
  ])}
  ${paretoCard(P, E, d, rc, heroMode, hero)}
  <div class="rel-grid2">
    ${lineCard(LS, W, E, d)}
    ${trendCard(weeks, mean, sd, E, d)}
  </div>
  <div class="rel-grid2">
    ${actorsCard(actors, M, t, a, hero, repIds, E)}
    ${repeatCard(reps, M, a, E)}
  </div>
  ${rcaCard(rc, ctx, d, stat, conf, W)}
  ${nextBack('reliability')}
  </div>`);

    if (ui.scrollTo === 'rca') { ui.scrollTo = null; requestAnimationFrame(() => root.querySelector('#rel-rca')?.scrollIntoView({ block: 'start' })); }

    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { const n = dims(root); if (Math.abs(n.cw - d.cw) > 24 || n.phone !== d.phone || n.wide !== d.wide) ctx.rerender(); }, 180); };
    window.addEventListener('resize', onResize);
    const off = delegate(root, {
      by: el => { if (ui.by !== el.dataset.id) { ui.by = el.dataset.id; ctx.rerender(); } },
      site: el => { if (ui.site !== el.dataset.id) { ui.site = el.dataset.id; ctx.rerender(); } },
      view: el => { if (ui.view !== el.dataset.id) { ui.view = el.dataset.id; ctx.rerender(); } },
      tab: el => { if (ui.tab !== el.dataset.id) { ui.tab = el.dataset.id; ctx.rerender(); } },
      'all-rep': () => { ui.allRep = !ui.allRep; ctx.rerender(); },
      'rca-go': (el, ev) => {
        ui.scrollTo = 'rca';
        if (location.hash === el.getAttribute('href')) { ev.preventDefault(); ui.scrollTo = null; root.querySelector('#rel-rca')?.scrollIntoView({ block: 'start' }); }
      },
      pick: (el, ev) => { if (ev.type === 'change' && el.value !== a.id) { ui.scrollTo = 'rca'; ctx.navigate('#/reliability/' + el.value); } },
      'rca-name': (el, ev) => {
        if (ev.type === 'click') return;
        ui.name = el.value;
        if (ui.nameErr && el.value.trim()) { ui.nameErr = false; el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); const e = root.querySelector('#rca-name-err'); if (e) e.hidden = true; }
      },
      confirm: el => {
        const inp = root.querySelector('#rca-name');
        const name = String(inp ? inp.value : ui.name || '').trim();
        if (!name) {
          ui.nameErr = true;
          if (inp) { inp.classList.add('invalid'); inp.setAttribute('aria-invalid', 'true'); inp.scrollIntoView({ block: 'center' }); inp.focus({ preventScroll: true }); }
          const e = root.querySelector('#rca-name-err'); if (e) e.hidden = false;
          return;
        }
        ui.name = name; ui.nameErr = false;
        store.prefs.name = name; S.savePrefs();
        const detail = el.dataset.detail;
        ui.confirmed[`${scenKey(st)}|${a.id}|${detail}`] = { by: name, at: st.simNow };
        S.audit(name, ACTION, a.id, detail);
        S.toast({ kind: 'ok', title: `Root cause confirmed on ${a.id}`, body: `${detail}. Logged with your name in the audit trail.`, href: '#/trust' });
        S.changed('rca');
      },
    }, ['click', 'input', 'change']);
    return () => { off(); window.removeEventListener('resize', onResize); clearTimeout(timer); };
  },
};

// ---------- cards ----------
function paretoCard(P, E, d, rc, heroMode, hero) {
  const names = P.rows.slice(0, P.vital).map(r => FAILURE_MODES[r.mode].short);
  const hr = heroMode ? P.rows.findIndex(r => r.mode === heroMode) : -1;
  const unit = P.by === 'cost' ? 'cost (rupees)' : P.by === 'down' ? 'repair and downtime hours' : 'number of failures';
  return card(html`${marker(1)}<h2>Which failure modes cost the most</h2><span class="sub">Pareto, last ${E.days} days, all 3 plants</span>
    <div class="right seg" role="group" aria-label="Rank the failure modes">${BY.map(([k, l]) => html`<button data-action="by" data-id="${k}" aria-pressed="${ui.by === k}">${l}</button>`)}</div>`,
  html`${paretoSvg(P, d.full, heroMode)}
  <p class="chart-caption"><b>The first ${plural(P.vital, 'mode')} (${list(names)}) make ${pctS(P.cumAtVital)} of the ${BY_WORD[P.by]}</b>: dark bars are this "vital few", where prevention pays most. Each bar is one failure mode's share of the total ${unit}; the line adds the bars up from left to right until it reaches 100 %.${hr >= 0 ? html` Today's case, ${hero.id} (${FAILURE_MODES[heroMode].short}), is number ${hr + 1} here.` : ''}</p>
  <p class="small dim">Source: ${plural(E.nEp, 'failure')} found in the sensor back-test plus ${plural(E.nCm, 'breakdown job')} from the maintenance system (CMMS), ${day(E.from)} to ${day(E.to)}. Cost covers lost production and repair.</p>`, 'rel-pcard');
}

function lineCard(LS, W, E, d) {
  const sites = [['all', 'All plants'], ...W.sites.map(s => [s.id, s.city])];
  const fmtMtbf = v => (v == null ? html`<span class="dim">no failures</span>` : html`${int(v)} h<span class="rel-sub">≈ ${Math.round(v / 24)} days</span>`);
  const row = (r, cls = '') => html`<tr class="${cls}">
    <td class="rl" data-l=""><b>${r.line ? r.line.name : 'All lines shown'}</b>${r.line ? html`<span class="rel-sub">${W.sites.find(s => s.id === r.line.siteId).city}${r.line.utility ? ' · utility' : ''}</span>` : ''}${r === LS.worst ? html` <span class="state watch">${icon('info')}Lowest</span>` : ''}</td>
    <td class="n" data-l="Machines">${r.machines}</td><td class="n" data-l="Failures">${r.failures}</td>
    <td class="n" data-l="MTBF">${fmtMtbf(r.mtbf)}</td><td class="n" data-l="MTTR">${r.mttr == null ? html`<span class="dim">–</span>` : hours(r.mttr)}</td>
    <td class="n" data-l="Availability"><b>${r.avail === 1 ? '100' : num(r.avail * 100, 2)} %</b></td></tr>`;
  const w = LS.worst;
  return card(html`${marker(2)}<h2>How often each line fails, and for how long</h2>
    <div class="right seg" role="group" aria-label="Filter by plant">${sites.map(([k, l]) => html`<button data-action="site" data-id="${k}" aria-pressed="${ui.site === k}">${l}</button>`)}</div>`,
  html`<p class="rel-terms small">${term('MTBF', MTBF_TIP)} = operating hours ÷ failures · ${term('MTTR', MTTR_TIP)} = average repair hours · ${term('Availability', AV_TIP)} = MTBF ÷ (MTBF + MTTR)</p>
  <div class="table-wrap rel-tw"><table class="table rel-lines"><caption class="visually-hidden">MTBF, MTTR and inherent availability per line</caption>
  <thead><tr><th scope="col">Line</th><th class="n" scope="col">Machines</th><th class="n" scope="col">Failures</th><th class="n" scope="col">MTBF</th><th class="n" scope="col">MTTR</th><th class="n" scope="col">Availability</th></tr></thead>
  <tbody>${LS.rows.map(r => row(r, r === w ? 'worst' : ''))}</tbody>
  <tfoot>${row({ ...LS.total, line: null }, 'total')}</tfoot></table></div>
  <p class="chart-caption">${w ? html`<b>${w.line.name} (${W.sites.find(s => s.id === w.line.siteId).city}) has the lowest availability</b>: ${plural(w.failures, 'failure')} on ${plural(w.machines, 'machine')} in ${E.days} days, so each machine fails about once every ${Math.round(w.mtbf / 24)} days, and a fix takes ${hours(w.mttr)} on average. ` : 'No failures on these lines in the window. '}Operating hours = machines × ${int(E.days * 24)} h (${E.days} days round the clock; utility lines included).</p>
  <p class="small dim">${icon('info')} This is the sample plant: ${E.days} days of synthetic history, so one failure more or less moves a line's MTBF a lot. A real plant would use a year or more of work orders.</p>`, 'rel-linecard');
}

function trendCard(weeks, mean, sd, E, d) {
  const high = weeks.filter(w => w.n > mean + sd), busiest = weeks.reduce((b, w) => (w.n > b.n ? w : b), weeks[0]);
  const last2 = weeks.slice(-2).reduce((s, w) => s + w.n, 0) / 2;
  return card(html`<h2>Failures per week</h2><span class="sub">last ${weeks.length} weeks, all plants</span>`,
    html`${trendSvg(weeks, d.small, { mean, sd })}
  <p class="chart-caption">Each column counts the failures that started that week (back-test episodes and CMMS breakdown jobs). Dashed line: the average, <b>${num(mean, 1)} a week</b>. ${high.length ? html`<b>▲ Amber</b> weeks are more than one standard deviation above it (${list(high.map(w => day(w.start)))}); the busiest started ${day(busiest.start)} with ${busiest.n}.` : 'No week stands far above the average: failures arrive steadily, not in one bad burst.'} The last two weeks average ${num(last2, 1)}, ${last2 < mean ? 'below' : last2 > mean ? 'above' : 'at'} the ${weeks.length}-week average.</p>`, 'rel-trendcard');
}

function actorsCard(actors, M, t, sel, hero, repIds, E) {
  const top = actors.slice(0, 8);
  const share = top.reduce((s, x) => s + x.cost, 0) / actors.reduce((s, x) => s + x.cost, 0);
  return card(html`${marker(3)}<h2>Bad actors: the 8 machines whose failures cost most</h2>`,
    html`<div class="table-wrap rel-tw"><table class="table rel-actors"><caption class="visually-hidden">Top 8 machines by failure cost</caption>
  <thead><tr><th scope="col">Machine</th><th class="n" scope="col">Failure cost</th><th scope="col">Last failure</th><th scope="col">Now</th><th scope="col"><span class="visually-hidden">Root-cause analysis</span></th></tr></thead>
  <tbody>${top.map((r, i) => {
    const x = M.assetById(r.id), ln = M.lineById(x.lineId), s = M.assess(x, t).state;
    return html`<tr class="${r.id === sel.id ? 'sel' : ''}">
      <td class="mc"><span class="rel-rk">${i + 1}</span><a class="rel-id" href="#/machine/${r.id}" title="Open ${r.id} in Machine Detail">${r.id}</a>${hero && r.id === hero.id ? html` <span class="pill">today's case</span>` : ''}${repIds.has(r.id) ? html` <span class="state watch" title="The same failure mode twice within ${REPEAT_D} days">${icon('info')}Same failure twice</span>` : ''}<span class="rel-sub">${x.name} · ${ln.short}, ${M.siteById(x.siteId).city}</span></td>
      <td class="n co" data-l="Cost" title="${[r.cm ? `${r.cm} CMMS breakdown job${r.cm > 1 ? 's' : ''}` : '', r.ep ? `${r.ep} back-test episode${r.ep > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')}">${inr(r.cost)}<span class="rel-sub">${plural(r.n, 'failure')}</span></td>
      <td class="la" data-l="Last">${day(r.last)}<span class="rel-sub">${ago(r.last, E.to)} days ago</span></td>
      <td class="st">${stateChip(s)}</td>
      <td class="ac"><a class="btn sm${r.id === sel.id ? ' primary' : ''}" href="#/reliability/${r.id}" data-action="rca-go" aria-label="Root cause of ${r.id}">Root cause</a></td>
    </tr>`;
  })}</tbody></table></div>
  <p class="chart-caption">These 8 of the ${actors.length} machines that failed carry <b>${pctS(share)}</b> of the failure cost. Failures count back-test episodes and CMMS breakdown jobs. "Now" is today's state from the live sensors: a costly past does not mean it is failing today. Press a machine ID for Machine Detail.</p>`, 'rel-actcard');
}

function repeatCard(reps, M, sel, E) {
  const same = reps.filter(r => r.same), other = reps.filter(r => !r.same);
  const shown = ui.allRep ? same : same.slice(0, 5);
  const evWord = e => (e.src === 'cm' ? 'CMMS job' : 'back-test episode');
  const item = r => {
    const x = M.assetById(r.id), s = r.same, fm = FAILURE_MODES[s.mode];
    const both = s.first.src === s.last.src ? `both ${evWord(s.first)}s` : `${evWord(s.first)} and ${evWord(s.last)}`;
    const rest = r.n - 2;
    return html`<li class="${r.id === sel.id ? 'sel' : ''}">
      <div class="rr-head"><b>${r.id}</b><span class="state watch">${icon('info')}Repeat: same failure</span></div>
      <p><b>${fm.name} ${times(s.n)}</b>, ${Math.round(s.gapD)} days apart (${ago(s.first.at, E.to)} and ${ago(s.last.at, E.to)} days ago, ${both})${rest > 0 ? `, plus ${plural(rest, 'other failure')}` : ''}.</p>
      <p class="rel-sub">${x.name} · ${M.lineById(x.lineId).short}, ${M.siteById(x.siteId).city}</p>
      <a class="btn sm" href="#/reliability/${r.id}" data-action="rca-go">Root cause ${icon('arrowR')}</a>
    </li>`;
  };
  return card(html`<h2>Repeat failures</h2><span class="sub">corrective work twice within ${REPEAT_D} days</span>`,
    html`<p class="rel-meaning">${icon('info')}<span>A repeat failure usually means the last repair fixed the symptom, not the cause: the part was swapped, but whatever wore it out (a slipped preventive job, a weak part lot, misalignment, how the machine is run) is still there. Do a root-cause analysis before the third failure.</span></p>
  ${same.length ? html`<ul class="rel-rep">${shown.map(item)}</ul>${same.length > 5 ? html`<button class="btn sm ghost" data-action="all-rep">${ui.allRep ? 'Show fewer' : `Show all ${same.length}`}</button>` : ''}` : html`<p class="small">No machine failed the same way twice within ${REPEAT_D} days.</p>`}
  ${other.length ? html`<p class="small rel-other"><b>Also failed twice or more within ${REPEAT_D} days, with different causes:</b> ${other.map((r, i) => html`${i ? ', ' : ''}<a href="#/reliability/${r.id}" data-action="rca-go">${r.id}</a> (${r.n})`)}.</p>` : ''}`, 'rel-repcard');
}

function statusChip(s) {
  if (s.k === 'ok') return html`<span class="state ok">${icon('check')}${s.word}</span>`;
  if (s.k === 'data') return aiChip(s.word);
  if (s.k === 'hyp') return html`<span class="state watch">${icon('info')}${s.word}</span>`;
  return html`<span class="state normal">${icon(s.k === 'info' ? 'info' : 'x')}${s.word}</span>`;
}
const evChip = e => html`<span class="pill rel-ev">${icon(EVK[e.kind][0])}${evText(e)}</span>`;

function fishList(rc, stat) {
  return html`<div class="rel-fishlist">
    <p class="rel-effect ${rc.effect.tone}"><b>Effect:</b> ${rc.effect.title} <span class="dim">(${rc.effect.sub})</span></p>
    <div class="rel-bones">${BONES.map(([k, label]) => html`<section class="rel-bone" aria-label="${label}"><h4>${label}</h4>
      ${rc.bones[k].length ? html`<ul>${rc.bones[k].map(f => { const s = stat(f); return html`<li><span class="rel-dot ${s.k}" aria-hidden="true"></span><div><p>${f.text}</p>${f.quote ? html`<p class="rel-q" lang="hi-Latn">"${f.quote}"</p>` : ''}<div class="rel-tags">${evChip(f.ev)}${statusChip(s)}</div></div></li>`; })}</ul>` : html`<p class="small dim">Nothing found</p>`}
    </section>`)}</div></div>`;
}

function rcaCard(rc, ctx, d, stat, conf, W) {
  const { store, M } = ctx, a = rc.a, t = store.t;
  const picker = html`<div class="field rel-pick"><label for="rel-pick">Machine to analyse</label>
    <select id="rel-pick" class="input" data-action="pick">${W.sites.map(s => html`<optgroup label="${s.city}">${W.assets.filter(x => x.siteId === s.id).map(x => { const st = M.assess(x, t).state; return html`<option value="${x.id}" ${x.id === a.id ? raw('selected') : ''}>${x.id}${x.id === W.scenario.hero ? " (today's case)" : st !== 'normal' ? ` (${st === 'sensor' ? 'check sensor' : st === 'act' ? 'act now' : 'watch'})` : ''} · ${x.name}</option>`; })}</optgroup>`)}</select></div>`;
  const headTxt = html`<h2>Root cause: ${a.id}</h2>${stateChip(rc.ass.state)}${aiChip('Analysis drafted by Nirantar')}`;
  if (rc.empty) return html`<section class="card rel-rca" id="rel-rca" aria-label="Root-cause analysis"><div class="card-head">${headTxt}</div>${picker}
    ${rc.upstream ? html`<div class="empty rel-empty">${icon('layers')}<h3>${a.id} is a victim, not the cause</h3><p>${a.id} has no failure of its own in the last ${failureEvents(W).days} days. Its alarm comes from upstream: <b>${rc.upstream}</b> is failing and the ${lc(M.tagOf(a, W.scenario.consequence.tag)?.label || 'supply')} dropped on every machine it feeds. Analyse the source instead.</p><a class="btn primary" href="#/reliability/${rc.upstream}" data-action="rca-go">Root cause of ${rc.upstream} ${icon('arrowR')}</a></div>`
      : html`<div class="empty rel-empty">${icon('pareto')}<h3>Nothing to analyse on ${a.id}</h3><p>${a.id} has no failure in the last ${failureEvents(W).days} days and ${rc.ass.state === 'normal' ? 'is healthy today' : 'no failure is developing'}. A root-cause analysis starts from a failure: pick a bad actor or a repeat failure above, or today's case.</p></div>`}</section>`;
  const fishMode = d.full >= 860 ? ui.view : 'list';
  const hyps = rc.whys.flatMap(w => w.answers).filter(x => x.status === 'hyp');
  const open = hyps.filter(x => !conf[x.detail]).length;
  const whyItem = w => html`<li class="rel-why">
    <span class="rel-wn" aria-hidden="true">${w.n}</span>
    <div class="rel-wb"><p class="rel-wq"><b>${w.q}</b></p>
    ${w.answers.map((x, j) => {
      const c = x.detail ? conf[x.detail] : null, s = c ? { k: 'ok', word: `Confirmed by ${c.by}` } : { k: x.status, word: WORD[x.status] };
      return html`<div class="rel-ans ${s.k}">${w.answers.length > 1 ? html`<span class="rel-opt">Option ${String.fromCharCode(65 + j)}</span>` : ''}<p>${x.text}</p>
        <div class="rel-tags">${evChip(x.ev)}${statusChip(s)}${x.status === 'hyp' && !c ? html`<button class="btn sm approve" data-action="confirm" data-detail="${x.detail}">${icon('check')} Confirm at teardown</button>` : ''}</div></div>`;
    })}</div></li>`;
  const act = x => html`<li class="${x.done ? 'done' : ''}"><p>${x.text}</p><div class="rel-tags"><span class="pill">${icon('user')}${x.owner}</span>${x.href ? html`<a class="btn sm ${x.primary ? 'primary' : ''}" href="${x.href}">${x.cta} ${icon('arrowR')}</a>` : ''}</div></li>`;
  const fishSec = html`<div class="rel-sec" id="rel-fishsec"><div class="rel-sech"><h3>Fishbone: where the causes could sit</h3>${d.full >= 860 ? html`<div class="seg" role="group" aria-label="Show the fishbone as">${[['diagram', 'Diagram'], ['list', 'List']].map(([k, l]) => html`<button data-action="view" data-id="${k}" aria-pressed="${fishMode === k}">${l}</button>`)}</div>` : ''}</div>
    ${fishMode === 'diagram' ? fishSvg(rc, d.full, stat) : fishList(rc, stat)}
    <p class="chart-caption rel-legend"><span><span class="rel-dot data"></span>Blue: confirmed by data</span><span><span class="rel-dot hyp"></span>Amber: hypothesis, confirm at teardown</span><span><span class="rel-dot out"></span>Grey: checked and ruled out, or not measured</span><span><span class="rel-dot ok"></span>Green: confirmed by a person</span></p></div>`;
  const whysSec = html`<div class="rel-sec" id="rel-whysec"><div class="rel-sech">${d.phone ? '' : marker(4)}<h3>5 whys: from the symptom to a cause we can fix</h3></div>
      ${open ? html`<div class="field rel-name"><label for="rca-name">Your name <span class="dim">(signs each confirmation in the audit log)</span></label>
        <input id="rca-name" class="input${ui.nameErr ? ' invalid' : ''}" type="text" autocomplete="name" placeholder="e.g. Ravi Kulkarni, maintenance engineer" value="${ui.name || ''}" data-action="rca-name" ${ui.nameErr ? raw('aria-invalid="true"') : ''} aria-describedby="rca-name-err">
        <p id="rca-name-err" class="rel-err" ${ui.nameErr ? '' : raw('hidden')}>Type your name first: every confirmation is signed and goes into the audit log.</p></div>` : ''}
      <ol class="rel-whys">${rc.whys.map(whyItem)}</ol>
      <p class="small dim">${hyps.length - open} of ${plural(hyps.length, 'hypothesis', 'hypotheses')} confirmed. A hypothesis stays amber until a person sees it at teardown; Nirantar never marks its own guesses as proven.</p></div>`;
  const actsSec = html`<div class="rel-sec" id="rel-actsec"><div class="rel-sech"><h3>Corrective actions</h3></div>
      <h4 class="rel-acth">Fix it now</h4><ul class="rel-acts">${rc.now.map(act)}</ul>
      <h4 class="rel-acth">Stop it coming back</h4><ul class="rel-acts">${rc.prevent.map(act)}</ul>
      <div class="row rel-links"><a class="btn" href="#/orders">${icon('orders')} Work Orders</a><a class="btn" href="#/schedule">${icon('calendar')} Maintenance calendar</a></div></div>`;
  // phones: one view at a time (Fishbone, 5 whys, Actions) instead of a very long card
  const TABS = [['fish', 'Fishbone'], ['whys', '5 whys'], ['acts', 'Actions']];
  const tab = TABS.some(x => x[0] === ui.tab) ? ui.tab : 'fish';
  const body = d.phone ? html`<div class="seg rel-tabs" role="tablist" aria-label="Root-cause views">${TABS.map(([k, l]) => html`<button role="tab" data-action="tab" data-id="${k}" aria-selected="${tab === k}" aria-controls="rel-tabpanel">${k === 'whys' ? marker(4) : ''}${l}${k === 'whys' && open ? html` <span class="rel-count">${open}</span>` : ''}</button>`)}</div>
    <div id="rel-tabpanel" role="tabpanel">${tab === 'fish' ? fishSec : tab === 'whys' ? whysSec : actsSec}</div>`
    : html`${fishSec}<div class="rel-rcagrid">${whysSec}${actsSec}</div>`;
  return html`<section class="card rel-rca" id="rel-rca" aria-label="Root-cause analysis">
  <div class="card-head">${headTxt}<span class="right"><a class="btn sm ghost" href="#/machine/${a.id}">${icon('machine')} Machine Detail</a></span></div>
  <div class="rel-rcabar">${picker}<p class="small rel-used"><b>Built only from data:</b> ${list(rc.used)}. ${rc.kind === 'history' ? `${a.id} has no failure developing today, so this looks back at its failure record.` : rc.kind === 'sensor' ? 'The machine is fine; the analysis is about the sensor.' : ''}</p></div>
  ${body}</section>`;
}
