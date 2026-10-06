// Tool · Compare machines: is this machine different from its identical siblings?
// Peer comparison is how engineers rule out process causes. Identical machines share the material, the programs,
// the operators and the utilities, so when one of them drifts and its siblings do not, the cause is the machine.
// When they all move together, the cause is shared (an upstream pump, a material batch), not the machine.
// Charts are drawn at the measured card width so SVG text keeps its real size on a phone.
import { html, raw, icon, delegate } from '../ui/dom.js';
import { lineChart } from '../ui/charts.js';
import { pageHead, headline, doThis, marker, stateChip, term, confPct, nextBack, STATE_TEXT } from '../ui/components.js';
import { HEALTH_FORMULA, CONF_NOTE } from '../core/scoring.js';
import { inr, num, int, pct, hours, day, time, weekday, HOUR, DAY } from '../core/format.js';

const FRESH = { assetId: null, on: null, tag: null, range: null, scale: null, hmSite: null, hmLine: 'all' };
let ui = { ...FRESH, key: null };

const MOVED = 0.1;          // a sensor has "moved" once it is 10 % of the way from normal to its trip level
const FLAG = 0.25;          // table cells are marked when they differ from the peer median by more than 25 %
const MAX_PEERS = 8;
// Sensor groups for the fleet heatmap (TAGS[].group in generator.js).
const GROUPS = [['vib', 'Vibration'], ['temp', 'Temperature'], ['elec', 'Electrical'], ['flow', 'Flow and pressure'], ['speed', 'Speed']];
const CLASS_WORDS = { cnc: 'CNC machines', rotating: 'rotating machines (drives, fans, mills)', pump: 'pumps', compressor: 'compressors and chillers', press: 'presses and hammers', thermal: 'furnaces and heaters', aux: 'auxiliary machines' };
// Peers are drawn in neutral greys (grey = normal); each gets its own dash pattern so they stay apart without colour.
const PEER_STYLES = [
  { tone: 'var(--ink-3)', dash: '8 4' }, { tone: 'var(--normal)', dash: '2 3' }, { tone: 'var(--ink-3)', dash: '12 3 3 3' }, { tone: 'var(--normal)', dash: '5 2 1 2' },
  { tone: 'var(--normal)', dash: '8 4' }, { tone: 'var(--ink-3)', dash: '2 3' }, { tone: 'var(--normal)', dash: '12 3 3 3' }, { tone: 'var(--ink-3)', dash: '5 2 1 2' },
];
const TERM_SIBLINGS = 'Machines of the same kind in the asset register. They share the material, programs, operators and utilities, so if one drifts while the others do not, the cause is that machine.';
const TERM_SIMILAR = 'There is no identical machine, so Nirantar compares with machines of the same class at this plant: same sensors and the same limits, but different jobs. A weaker check than identical siblings.';
const TERM_MEDIAN = 'The middle value of the siblings that are switched on (half are above, half below). One odd sibling cannot drag it the way it drags an average.';

// ---------- small helpers ----------
const lc = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const short = label => label.replace(/ \(RMS\)$/, '');
const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fv = (tag, v) => `${num(v, Math.abs(v) >= 100 ? 0 : tag.d === 0 ? 0 : 1)} ${tag.unit}`;
const toneOfState = s => (s === 'act' ? 'act' : s === 'normal' ? 'normal' : 'watch');
const when = ms => `${weekday(ms)} ${day(ms)} ${time(ms)}`;
export function median(arr) {
  const s = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// "Forging press 2500 t" and "Coolant pump (standby)" are the same kind as "Forging press" and "Coolant pump".
const kindLabel = name => name.replace(/\s*\([^)]*\)/g, '').replace(/\s+\d[\d,.]*\s*(t|kw|hp|kn)\b.*$/i, '').trim();
export const kindOf = name => kindLabel(name).toLowerCase();

// Peers: same kind anywhere in the fleet; else same class at the same plant; else same class anywhere.
// Order: same line, then same plant, then other plants.
export function peersOf(W, a) {
  const k = kindOf(a.name);
  let peers = W.assets.filter(x => x.id !== a.id && kindOf(x.name) === k), tier = 'kind';
  if (!peers.length) { peers = W.assets.filter(x => x.id !== a.id && x.cls === a.cls && x.siteId === a.siteId); tier = 'site'; }
  if (!peers.length) { peers = W.assets.filter(x => x.id !== a.id && x.cls === a.cls); tier = 'fleet'; }
  const rank = x => (x.lineId === a.lineId ? 0 : x.siteId === a.siteId ? 1 : 2);
  peers.sort((x, y) => rank(x) - rank(y) || x.idx - y.idx);
  return { tier, list: peers.slice(0, MAX_PEERS), identical: tier === 'kind' && peers.every(x => x.name === a.name) };
}

// Switched on by default: every sibling of the same kind; for "similar machines", the ones on the same line,
// topped up to three with healthy machines so the grey band shows what normal looks like.
export function defaultOn(P, a, M, t) {
  if (P.tier === 'kind') return P.list.slice(0, 6).map(x => x.id);
  const out = P.list.filter(x => x.lineId === a.lineId).slice(0, 4);
  for (const x of P.list) { if (out.length >= 3) break; if (!out.includes(x) && M.assess(x, t).state === 'normal') out.push(x); }
  if (!out.length) out.push(P.list[0]);
  return out.map(x => x.id);
}

// The sensor that tells this machine's story: the frozen one, else the biggest mover, else vibration.
function mainKey(a, ass) {
  if (ass.sensorFault) return ass.sensorFault.tag;
  if (ass.top) return ass.top.key;
  if (ass.worst > 0.05) return ass.worstKey;
  return (a.tags.find(x => x.key === 'VIB_RMS') || a.tags[0]).key;
}

// Outlier, shared change, same as siblings, or a frozen sensor, on one sensor (model trend now, no noise).
export function verdict(M, a, ass, peers, key, t) {
  const tag = M.tagOf(a, key);
  const selfV = M.trendAt(a, key, t), selfDev = M.deviation(tag, selfV);
  const pv = peers.map(p => { const pt = M.tagOf(p, key); const v = M.trendAt(p, key, t); return { p, v, dev: pt ? M.deviation(pt, v) : 0 }; });
  const mean = avg(pv.map(x => x.v)), medDev = median(pv.map(x => x.dev));
  const sensor = !!(ass.sensorFault && ass.sensorFault.tag === key);
  const kind = sensor ? 'sensor' : selfDev >= MOVED ? (medDev >= MOVED ? 'shared' : 'outlier') : 'same';
  return { tag, selfV, selfDev, pv, mean, medDev, kind, outPeers: pv.filter(x => x.dev >= MOVED) };
}

// "4.1×", "38 % above", "52 % below" (compared with the peers' average)
function vsWords(tag, v, mean) {
  if (!mean) return 'different from';
  if (tag.dir === 'low') { const p = Math.round((mean - v) / mean * 100); return p >= 0 ? `${p} % below` : `${-p} % above`; }
  const r = v / mean;
  return r >= 1.5 ? `${r.toFixed(1)}×` : r >= 1 ? `${Math.round((r - 1) * 100)} % above` : `${Math.round((1 - r) * 100)} % below`;
}
function peerPhrase(P, peers, a, M) {
  const n = peers.length, first = peers[0] ? peers[0].id : '';
  const where = peers.every(p => p.lineId === a.lineId) ? ' on the same line'
    : peers.every(p => p.siteId === a.siteId) ? ` at ${M.siteById(a.siteId).city}`
    : ` across ${new Set([a.siteId, ...peers.map(p => p.siteId)]).size} plants`;
  if (P.tier !== 'kind') return n === 1 ? `the similar machine ${first}${where}` : `${n} similar machines${where}`;
  const noun = P.identical ? 'identical sibling' : 'same-kind sibling';
  return n === 1 ? `its ${noun} ${first}${where}` : `its ${n} ${noun}s${where}`;
}

// Today's energy: baseline kWh a day × (power trend now ÷ baseline power).
function kwhNow(W, M, a, t) {
  const p = M.tagOf(a, 'POWER_KW'), e = W.energy.find(x => x.assetId === a.id);
  return p && e && e.kwhDay ? e.kwhDay * M.trendAt(a, 'POWER_KW', t) / p.base : null;
}
function infoOf(W, M, a, t, pmById) {
  const ass = M.assess(a, t);
  return { a, ass, kwh: kwhNow(W, M, a, t), pm: pmById[a.id], cm: W.history.filter(h => h.assetId === a.id && h.type === 'CM' && h.date > t - 120 * DAY).length,
    line: M.lineById(a.lineId), site: M.siteById(a.siteId) };
}

function dims(root) {
  const cs = getComputedStyle(root);
  const cw = Math.max(300, root.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
  return { cw, full: Math.round(cw - 30), phone: window.innerWidth < 720 };
}

export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, t = store.t;
    const key = `${store.state.scenarioId}:${store.state.anchor}`;
    if (ui.key !== key) ui = { ...FRESH, key };
    const a = M.assetById(params[0]) || M.assetById(ui.assetId) || defaultAsset(W, M, t);
    if (ui.assetId !== a.id) {
      Object.assign(ui, { assetId: a.id, on: null, tag: null, range: null, scale: null });
      if (ui.hmSite && ui.hmSite !== a.siteId) Object.assign(ui, { hmSite: null, hmLine: 'all' });
    }
    const d = dims(root), ass = M.assess(a, t);
    const P = peersOf(W, a);
    if (!ui.on || !ui.on.length || !ui.on.every(id => P.list.some(p => p.id === id))) ui.on = defaultOn(P, a, M, t);
    const on = P.list.filter(p => ui.on.includes(p.id));
    const shared = a.tags.filter(tg => P.list.every(p => M.tagOf(p, tg.key)));
    const auto = mainKey(a, ass);
    const tagKey = ui.tag && shared.some(x => x.key === ui.tag) ? ui.tag : shared.some(x => x.key === auto) ? auto : (shared[0] || a.tags[0]).key;
    const v = verdict(M, a, ass, on, shared.some(x => x.key === auto) ? auto : tagKey, t);
    const pmById = Object.fromEntries(S.pmPlan(store.state.simNow).map(r => [r.assetId, r]));
    const c = { store, S, M, W, t, a, ass, d, P, on, shared, tagKey, v, pmById, cq: W.scenario.consequence };

    root.innerHTML = String(html`<div class="page cpage">
  ${pageHead('compare')}
  ${headLine(c)}
  ${doThis(todo(c))}
  ${pickCard(c)}
  ${chartCard(c)}
  ${sideCard(c)}
  ${heatCard(c)}
  ${plantsCard(c)}
  ${nextBack('compare')}
  </div>`);

    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { const n = dims(root); if (Math.abs(n.cw - d.cw) > 24 || n.phone !== d.phone) ctx.rerender(); }, 180); };
    window.addEventListener('resize', onResize);
    const off = delegate(root, {
      pick: (el, ev) => { if (ev.type === 'change' && el.value !== a.id) ctx.navigate('#/compare/' + el.value); },
      'pick-id': el => { if (el.dataset.id && el.dataset.id !== a.id) ctx.navigate('#/compare/' + el.dataset.id); },
      peer: el => {
        const id = el.dataset.id, cur = ui.on || [];
        if (cur.includes(id)) {
          if (cur.length <= 1) { ctx.toast({ kind: 'watch', title: 'Keep at least one sibling on', body: 'A comparison needs something to compare with. Switch another one on first.' }); return; }
          ui.on = cur.filter(x => x !== id);
        } else ui.on = [...cur, id];
        ctx.rerender();
      },
      tag: (el, ev) => { if (ev.type === 'change') { ui.tag = el.value; ui.scale = null; ctx.rerender(); } },
      range: el => { ui.range = el.dataset.id; ctx.rerender(); },
      scale: el => { ui.scale = el.dataset.id; ctx.rerender(); },
      'hm-site': el => { ui.hmSite = el.dataset.id; ui.hmLine = 'all'; ctx.rerender(); },
      'hm-line': (el, ev) => { if (ev.type === 'change') { ui.hmLine = el.value; ctx.rerender(); } },
    }, ['click', 'change']);
    return () => { off(); window.removeEventListener('resize', onResize); clearTimeout(timer); };
  },
};

// Default machine: the scenario hero, else the lowest health (ties: the biggest family of identical siblings).
function defaultAsset(W, M, t) {
  const hero = W.scenario.hero && M.assetById(W.scenario.hero);
  if (hero) return hero;
  let best = null;
  for (const a of W.assets) {
    const h = M.assess(a, t).health, P = peersOf(W, a), n = P.tier === 'kind' ? P.list.length : 0;
    if (!best || h < best.h || (h === best.h && n > best.n)) best = { a, h, n };
  }
  return best.a;
}

// ---------- headline + do this ----------
function headLine({ M, a, ass, P, on, v, cq }) {
  const lab = lc(short(v.tag.label)), peers = peerPhrase(P, on, a, M);
  if (v.kind === 'sensor') {
    const h = Math.round(ass.sensorFault.sinceH);
    return headline(html`<b>${a.id}</b>'s ${lab} sensor has been <b>perfectly flat for ${h} h</b> while ${peers} keep moving. That is <b>a sensor issue, not the machine</b>: inspect the sensor (SOP-50) and send no repair crew.`, 'watch');
  }
  if (v.kind === 'outlier') {
    const why = P.tier === 'kind' ? 'The problem is the machine, not the process.' : 'Similar machines in the same conditions are normal, so the problem is most likely this machine, not the process.';
    return headline(html`<b>${a.id}</b>'s ${lab} is <b>${vsWords(v.tag, v.selfV, v.mean)} the average of ${peers}</b>. ${why}`, ass.state === 'act' ? 'act' : 'watch');
  }
  if (v.kind === 'shared') {
    const root = cq && cq.tag === v.tag.key && cq.lines.includes(a.lineId) && cq.from !== a.id ? M.assetById(cq.from) : null;
    const moved = v.tag.dir === 'low' ? `${Math.round((v.tag.normal - v.selfV) / v.tag.normal * 100)} % below normal` : `${(v.selfV / v.tag.normal).toFixed(1)}× its normal level`;
    return headline(html`<b>${a.id}</b>'s ${lab} is ${moved}, but <b>${peers} show the same change</b>. The cause is <b>shared, not this machine</b>: ${root ? html`look upstream at <b>${root.id}</b> (${lc(root.name)}) first.` : 'look at what they have in common: material, programs or utilities.'}`, 'watch');
  }
  // compare with the siblings that are themselves normal, so one failing sibling does not distort the average
  const odd = v.outPeers.map(x => x.p.id), calm = v.pv.filter(x => x.dev < MOVED);
  const ref = calm.length && odd.length ? avg(calm.map(x => x.v)) : v.mean;
  const within = ref ? Math.max(1, Math.round(Math.abs(v.selfV - ref) / Math.abs(ref) * 100)) : 0;
  const whom = odd.length && calm.length ? list(calm.map(x => x.p.id)) : peers;
  const one = on.length === 1;
  const like = P.tier === 'kind' ? (one ? 'its sibling' : 'its siblings') : one ? 'a similar machine' : 'similar machines';
  return headline(html`<b>${a.id} behaves like ${like}</b>: its ${lab} is within ${within} % of ${one ? '' : 'the average of '}${whom}${odd.length ? html`. Only <b>${list(odd)}</b> ${odd.length > 1 ? 'stand' : 'stands'} out; pick ${odd.length > 1 ? 'one' : 'it'} below to see why.` : one ? ', and both sit in their normal band.' : ', and every one of them sits in its normal band.'}`, odd.length ? 'watch' : 'ok');
}

function todo({ a, ass, v }) {
  const items = [
    html`Pick a machine and switch its siblings on or off ${marker(1)}.`,
    v.kind === 'sensor' ? html`Read the overlay chart ${marker(2)}: ${a.id}'s line is perfectly flat while its siblings keep moving. Real machines are never that still.`
      : html`Read the overlay chart ${marker(2)}: one line leaving the grey sibling band means that machine is the problem; all lines moving together means a shared cause.`,
    html`Check the side-by-side table ${marker(3)}: cells more than 25 % away from the ${term('peer median', TERM_MEDIAN)} are marked with an arrow and a word.`,
    html`Scan the plant heatmap ${marker(4)} for other odd machines (press a cell to compare it), then compare the three plants ${marker(5)}.`,
  ];
  if (ass.state === 'sensor') items.push(html`Do not send a repair crew: open the sensor check for ${a.id} in <a href="#/orders">5 · Work Orders</a>.`);
  return items;
}

// ---------- 1 · machine picker, sibling chips, odd ones out ----------
function pickCard(c) {
  const { W, M, t, a, ass, P, on } = c;
  const basis = P.tier === 'kind'
    ? html`${term(P.identical ? 'Identical siblings' : 'Siblings of the same kind', TERM_SIBLINGS)}: every ${lc(kindLabel(a.name))} in the fleet (${plural(P.list.length + 1, 'machine')}).`
    : html`No identical machine in the fleet, so Nirantar compares with ${term('similar machines', TERM_SIMILAR)}: ${CLASS_WORDS[a.cls] || a.cls}${P.tier === 'site' ? ` at ${M.siteById(a.siteId).city}` : ' in all plants'}.`;
  const odd = standOut(c);
  return html`<section class="card cp-pick" aria-label="Choose a machine and its siblings">
  <div class="card-head">${marker(1)}<h2>Machine and siblings</h2>${stateChip(ass.state)}</div>
  <div class="cp-pick-grid">
  <div class="field"><label for="cp-pick">Machine</label>
  <select id="cp-pick" class="input" data-action="pick">${W.lines.map(l => html`<optgroup label="${M.siteById(l.siteId).city} · ${l.name}">${W.assets.filter(x => x.lineId === l.id).map(x => { const st = M.assess(x, t).state; return html`<option value="${x.id}" ${x.id === a.id ? raw('selected') : ''}>${x.id}${st !== 'normal' ? ` (${STATE_TEXT[st]})` : ''} · ${x.name}</option>`; })}</optgroup>`)}</select></div>
  <div class="cp-basis small">${basis}</div>
  </div>
  <div class="cp-chips-wrap"><span class="cp-lbl" id="cp-chips-l">Compare with <span class="dim">(press to switch on or off)</span></span>
  <div class="cp-chips" role="group" aria-labelledby="cp-chips-l">${P.list.map(p => {
    const isOn = on.includes(p), i = on.indexOf(p), st = M.assess(p, t).state, s = PEER_STYLES[i % PEER_STYLES.length];
    const where = p.lineId === a.lineId ? 'same line' : p.siteId === a.siteId ? M.lineById(p.lineId).short : M.siteById(p.siteId).city;
    return html`<button class="cp-chip" data-action="peer" data-id="${p.id}" aria-pressed="${String(isOn)}">${isOn ? swatch(s.tone, s.dash) : html`<span class="cp-sw-off" aria-hidden="true"></span>`}<span class="cp-chip-t"><b class="mono">${p.id}</b><span class="cp-where">${where}${isOn ? '' : ' · off'}</span></span>${st !== 'normal' ? stateChip(st) : ''}</button>`;
  })}</div></div>
  <div class="cp-odd small">${odd.out.length ? html`<span class="cp-lbl">Stand out from their siblings now:</span> ${odd.out.map(x => html`<button class="btn sm" data-action="pick-id" data-id="${x.a.id}" ${x.a.id === a.id ? raw('aria-current="true"') : ''}>${icon(x.kind === 'sensor' ? 'sensor' : 'alert')}${x.a.id}${x.kind === 'sensor' ? ' (sensor)' : ''}</button>`)}`
    : html`<span class="dim">No machine stands out from its siblings right now.</span>`}${odd.shared ? html` <span class="dim">· ${plural(odd.shared, 'machine')} ${odd.shared === 1 ? 'moves' : 'move'} together with ${odd.shared === 1 ? 'its' : 'their'} siblings (a shared cause).</span>` : ''}</div>
  </section>`;
}

// Fleet scan: which machines differ from their default sibling set right now.
function standOut({ W, M, t }) {
  const out = []; let shared = 0;
  for (const a of W.assets) {
    const ass = M.assess(a, t);
    if (ass.state === 'normal') continue;
    const P = peersOf(W, a), peers = P.list.filter(p => defaultOn(P, a, M, t).includes(p.id));
    const k = mainKey(a, ass);
    if (!peers.every(p => M.tagOf(p, k))) continue;
    const v = verdict(M, a, ass, peers, k, t);
    if (v.kind === 'outlier' || v.kind === 'sensor') out.push({ a, kind: v.kind, sev: ass.state === 'act' ? 2 : 1 });
    else if (v.kind === 'shared') shared++;
  }
  out.sort((x, y) => y.sev - x.sev);
  return { out: out.slice(0, 6), shared };
}

function swatch(tone, dash, w = 2) {
  return raw(`<svg class="cp-sw" viewBox="0 0 26 10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" stroke="${tone}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`);
}

// ---------- 2 · overlay chart ----------
function chartCard(c) {
  const { M, t, a, ass, d, on, shared, tagKey } = c;
  const tag = M.tagOf(a, tagKey);
  const sf = ass.sensorFault && ass.sensorFault.tag === tagKey ? ass.sensorFault : null;
  const sfStart = sf ? t - sf.sinceH * HOUR : null;
  const range = ui.range || (sf && sf.sinceH < 48 ? '24h' : '7d');
  const H = range === '24h' ? 24 : 168, step = range === '24h' ? 15 : 60, from = t - H * HOUR;
  const self = M.series(a, tagKey, from, t, step);
  const peers = on.map((p, i) => ({ p, pts: M.series(p, tagKey, from, t, step), style: PEER_STYLES[i % PEER_STYLES.length] }));
  const band = peers.length >= 2 ? { lo: self.map(([x], i) => [x, Math.min(...peers.map(s => s.pts[i][1]))]), hi: self.map(([x], i) => [x, Math.max(...peers.map(s => s.pts[i][1]))]) } : null;
  const ref = band || (peers[0] ? { lo: peers[0].pts, hi: peers[0].pts } : null);

  // where the machine left the sibling range for good (walk back from now while it is outside)
  const span = Math.abs(tag.trip - tag.normal), tol = 0.03 * span;
  const outside = i => ref && (tag.dir === 'low' ? self[i][1] < ref.lo[i][1] - tol : self[i][1] > ref.hi[i][1] + tol);
  let left = null;
  if (!sf && ref && outside(self.length - 1)) { let i = self.length - 1; while (i > 0 && outside(i - 1)) i--; left = i; }

  const devNow = [M.deviation(tag, M.trendAt(a, tagKey, t)), ...on.map(p => M.deviation(M.tagOf(p, tagKey), M.trendAt(p, tagKey, t)))];
  const scale = ui.scale || (sf ? 'fit' : 'limits');
  const tone = toneOfState(ass.state) === 'normal' ? 'ink' : toneOfState(ass.state);
  const limits = [{ y: tag.alarm, label: d.phone ? 'Alarm' : 'Alarm (watch)', tone: 'watch' }];
  if (Math.max(...devNow) >= 0.15) limits.push({ y: tag.trip, label: d.phone ? 'Trip' : 'Trip (act now)', tone: 'act' });
  let yMin, yMax;
  if (scale === 'fit') {
    const ys = [...self, ...peers.flatMap(s => s.pts)].map(p => p[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.01, 0.05);
    yMin = lo - pad; yMax = hi + pad;
  }
  const limitsOff = scale === 'fit' ? limits.filter(l => l.y < yMin || l.y > yMax) : [];

  const ann = [];
  if (left != null && left > 0) ann.push({ x: self[left][0], y: self[left][1], label: d.phone ? 'Leaves the range' : `Leaves the sibling range ${weekday(self[left][0])} ${time(self[left][0])}`, tone: tone === 'ink' ? 'watch' : tone });
  const vb = sf ? [{ x0: Math.max(from, sfStart), x1: t, tone: 'watch', opacity: 0.16, label: d.phone ? 'Sensor frozen' : `Sensor frozen since ${weekday(sfStart)} ${time(sfStart)}: a sensor issue` }] : [];
  const nx = range === '24h' ? (d.phone ? 4 : 6) : (d.phone ? 2 : 7);
  const chart = lineChart({
    title: `${tag.label}: ${a.id} against ${plural(on.length, 'sibling')}, last ${range === '24h' ? '24 hours' : '7 days'}`,
    series: [...peers.map(s => ({ name: s.p.id, points: s.pts, tone: s.style.tone, dash: s.style.dash, width: 1.5 })), { name: a.id, points: self, tone, width: 2.6 }],
    forecast: band ? { points: [], lo: band.lo, hi: band.hi, tone: 'normal' } : null,
    limits, annotations: ann, vbands: vb, now: t, xType: 'time', xMin: from, xMax: t, xTicks: nx, yMin, yMax, unit: tag.unit,
    xFmt: x => (range === '24h' ? time(x) : `${weekday(x)} ${day(x)}`),
    w: d.full, h: d.phone ? 250 : 300, padL: 46, padR: d.phone ? 46 : 96,
  });

  const last = pts => pts[pts.length - 1][1];
  const legend = html`<ul class="cp-legend" aria-label="Chart key">
  <li>${swatch(`var(--${tone === 'ink' ? 'ink' : tone + '-fill'})`, '', 3)}<b>${a.id}</b> (this machine${sf ? ', sensor frozen' : ''})</li>
  ${peers.map(s => html`<li>${swatch(s.style.tone, s.style.dash)}${s.p.id}</li>`)}
  ${band ? html`<li><span class="cp-band-sw" aria-hidden="true"></span>Sibling range</li>` : ''}
  </ul>`;

  // meaning line
  const names = list(on.map(p => p.id)), every = range === '24h' ? 'every 15 minutes' : 'once an hour';
  let cap;
  if (sf) cap = html`<b>${a.id}</b> (amber) has been perfectly flat since ${when(sfStart)} IST (shaded) while ${names} keep moving. Real machines are never that still: this is <b>a sensor issue</b>, so inspect the sensor (SOP-50) and do not send a repair crew.`;
  else if (left != null) {
    // same basis as the headline: Nirantar's trend now (shift load and sensor noise removed)
    const ratio = vsWords(tag, M.trendAt(a, tagKey, t), avg(on.map(p => M.trendAt(p, tagKey, t))));
    cap = html`Grey dashed ${on.length === 1 ? 'line' : 'lines'}: ${names}${band ? '; the grey band is their range' : ''}. <b>${a.id}</b> ${left === 0 ? `is outside that range for the whole ${range === '24h' ? '24 hours' : '7 days'}` : html`left it on <b>${when(self[left][0])} IST</b>`} and its trend is now <b>${ratio} their average</b>.`;
  } else {
    const shiftDev = band ? Math.abs(M.deviation(tag, median(peers.map(s => last(s.pts)))) - M.deviation(tag, median(peers.map(s => s.pts[0][1])))) : 0;
    cap = shiftDev >= MOVED ? html`<b>${a.id}</b> stays inside the band of ${names}, and the whole band has moved: they changed together, so the cause is shared, not one machine.`
      : html`<b>${a.id}</b> stays inside the ${band ? 'grey band' : 'range'} of ${names}: same kind of machine, same behaviour.`;
  }
  const lim = html` Amber dashed: alarm level (${fv(tag, tag.alarm)})${limits.length > 1 ? html`; red: trip level, where it must stop (${fv(tag, tag.trip)})` : ''}${limitsOff.length ? html`. Zoomed in: the ${limitsOff.length > 1 ? 'alarm and trip lines are' : `${limitsOff[0].tone === 'act' ? 'trip' : 'alarm'} line is`} off the chart, far from the readings` : ''}.`;

  return html`<section class="card cp-chart" aria-label="Overlay chart">
  <div class="card-head">${marker(2)}<h2>${short(tag.label)}: ${a.id} against ${P_WORD(c)}</h2><span class="sub">readings ${every}</span>
  <span class="right"><a class="btn sm" href="#/machine/${a.id}">${icon('machine')} Open ${a.id} detail</a></span></div>
  <div class="cp-ctrls">
  <div class="field cp-tag"><label for="cp-tag">Sensor</label><select id="cp-tag" class="input" data-action="tag">${shared.map(x => html`<option value="${x.key}" ${x.key === tagKey ? raw('selected') : ''}>${x.label} (${x.unit})${x.key === mainKey(a, ass) ? ' · main signal' : ''}</option>`)}</select></div>
  <div class="field"><span class="cp-lbl" id="cp-range-l">Period</span><div class="seg" role="group" aria-labelledby="cp-range-l">${[['24h', '24 h'], ['7d', '7 days']].map(([k, l]) => html`<button data-action="range" data-id="${k}" aria-pressed="${String(range === k)}">${l}</button>`)}</div></div>
  <div class="field"><span class="cp-lbl" id="cp-scale-l">Scale</span><div class="seg" role="group" aria-labelledby="cp-scale-l">${[['limits', 'With alarm lines'], ['fit', 'Zoom to readings']].map(([k, l]) => html`<button data-action="scale" data-id="${k}" aria-pressed="${String(scale === k)}">${l}</button>`)}</div></div>
  </div>
  ${legend}
  ${chart}
  <p class="chart-caption">${cap}${lim} Each line is a raw reading ${every}.</p>
  </section>`;
}
const P_WORD = ({ P, on }) => (P.tier === 'kind' ? (on.length === 1 ? 'its sibling' : 'its siblings') : on.length === 1 ? 'a similar machine' : 'similar machines');

// ---------- 3 · side-by-side table ----------
function flagOf(row, val, med) {
  if (row.noFlag || val == null || med == null) return null;
  const diff = val - med;
  if (row.count) { if (Math.abs(diff) < 1) return null; }
  else {
    if (row.abs != null && Math.abs(diff) < row.abs) return null;
    if (med !== 0 && Math.abs(diff / med) <= FLAG) return null;
    if (med === 0 && diff === 0) return null;
  }
  const rel = med ? diff / Math.abs(med) : Infinity;
  const worse = row.good === 'high' ? diff < 0 : diff > 0;
  const big = row.count ? Math.abs(diff) >= 2 : diff > 0 ? rel >= 1 : rel <= -0.5;
  const amount = row.points ? `${diff > 0 ? '+' : '−'}${Math.round(Math.abs(diff) * row.points)} points`
    : row.count ? `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`
    : rel >= 1 && isFinite(rel) ? `${(val / med).toFixed(1)}×`
    : `${diff > 0 ? '+' : '−'}${Math.round(Math.abs(rel) * 100)} %`;
  return { tone: worse ? (big ? 'act' : 'watch') : 'better', arrow: diff > 0 ? '↑' : '↓', text: `${amount} vs median, ${worse ? 'worse' : 'better'}` };
}

function sideCard(c) {
  const { W, M, t, a, on, tagKey, pmById } = c;
  const cols = [a, ...on].map(x => infoOf(W, M, x, t, pmById));
  const tag = M.tagOf(a, tagKey);
  const daysAgo = r => (r && r.last ? (c.store.state.simNow - r.last) / DAY : null);
  const rows = [
    { label: 'State', mean: 'grey normal, amber watch, red act now', show: m => stateChip(m.ass.state), state: true },
    { label: 'Health', mean: '0 failed, 100 new', val: m => m.ass.health, fmt: v => String(v), good: 'high', abs: 5, points: 1 },
    { label: 'Failure confidence', mean: 'how sure a failure is developing', val: m => m.ass.conf, fmt: v => confPct(v), good: 'low', abs: 0.1, points: 100 },
    { label: 'Time to failure', mean: 'at today\'s rate; age-based when there is no trend', val: m => m.ass.rulH, fmt: (v, m) => (m.ass.rulKind === 'trend' ? `About ${hours(v)}` : `≈ ${hours(v)}`), sub: m => (m.ass.rulKind === 'trend' ? `likely ${hours(m.ass.rulLo)} to ${hours(m.ass.rulHi)}` : 'age-based, no trend'), good: 'high', only: m => m.ass.rulKind === 'trend' },
    { label: 'Vibration zone (ISO)', mean: 'A new, B fine, C plan a repair, D damage', val: m => (m.ass.iso ? m.ass.iso.v : null), fmt: (v, m) => `Zone ${m.ass.iso.zone}`, sub: m => (m.ass.iso ? `${num(m.ass.iso.v, 1)} mm/s, ${m.ass.iso.text}` : ''), none: 'no vibration sensor', good: 'low', abs: 0.5 },
    ...(tagKey !== 'VIB_RMS' ? [{ label: `${short(tag.label)} now`, mean: 'the sensor on the chart', val: m => M.valueAt(m.a, tagKey, t), fmt: v => fv(tag, v), good: tag.dir === 'low' ? 'high' : 'low', abs: Math.abs(tag.trip - tag.normal) * 0.05 }] : []),
    { label: 'Energy', mean: 'kWh a day at today\'s power draw', val: m => m.kwh, fmt: v => `${int(v)} kWh`, good: 'low' },
    { label: 'Last preventive job', mean: 'from the maintenance plan', val: m => daysAgo(m.pm), fmt: v => `${Math.round(v)} days ago`, sub: m => (m.pm ? (m.pm.overdue ? `overdue by ${Math.round(-m.pm.daysToDue)} days` : `next due in ${Math.round(m.pm.daysToDue)} days`) : ''), noFlag: true, overdue: m => m.pm && m.pm.overdue },
    { label: 'Breakdown repairs', mean: 'corrective jobs, last 120 days', val: m => m.cm, fmt: v => String(v), good: 'low', count: true },
    { label: 'Installed', mean: 'year', val: m => m.a.installed, fmt: v => String(v), noFlag: true },
  ];
  const peerCols = cols.slice(1);
  const marked = [];
  const body = rows.map(r => {
    const med = r.val ? median(peerCols.map(m => r.val(m))) : null;
    const cells = cols.map((m, i) => {
      if (r.state) {
        // a state that is not normal and not what most siblings show is marked too
        const counts = {}; peerCols.forEach(x => { counts[x.ass.state] = (counts[x.ass.state] || 0) + 1; });
        const maj = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0], st = m.ass.state;
        const f = st !== 'normal' && st !== maj ? { tone: st === 'act' ? 'act' : 'watch', arrow: '!', text: `differs: siblings ${STATE_TEXT[maj].toLowerCase()}` } : null;
        if (f) marked.push({ m, r, f, self: i === 0 });
        return html`<td class="cp-cell ${i === 0 ? 'cp-selfcol' : ''} ${f ? f.tone : ''}">${r.show(m)}${f ? html`<span class="cp-delta"><span aria-hidden="true">${f.arrow}</span> ${f.text}</span>` : ''}</td>`;
      }
      const v0 = r.val(m);
      if (v0 == null) return html`<td class="dim">${r.none || '–'}</td>`;
      let f = r.only && !r.only(m) ? null : flagOf(r, v0, med);
      if (r.overdue && r.overdue(m)) f = { tone: 'watch', arrow: '!', text: 'overdue, worse' };
      if (f && f.tone !== 'better') marked.push({ m, r, f, self: i === 0 });
      return html`<td class="cp-cell ${i === 0 ? 'cp-selfcol' : ''} ${f ? f.tone : ''}"><span class="cp-v">${r.fmt(v0, m)}</span>${r.sub ? html`<span class="cp-sub">${r.sub(m)}</span>` : ''}${f ? html`<span class="cp-delta"><span aria-hidden="true">${f.arrow}</span> ${f.text}</span>` : ''}</td>`;
    });
    const medCell = r.state || r.noFlag || med == null ? html`<td class="dim cp-med">–</td>` : html`<td class="cp-med">${r.fmt(med, peerCols.find(m => r.val(m) != null) || cols[0])}</td>`;
    return html`<tr><th scope="row"><span class="cp-rl">${r.label}</span><span class="cp-mean">${r.mean}</span></th>${cells}${medCell}</tr>`;
  });
  const mine = marked.filter(x => x.self);
  const sfa = cols[0].ass.sensorFault;
  const capText = sfa ? html`<b>${a.id} differs from its siblings only in its state: its ${lc(sfa.label)} sensor is frozen.</b> Nirantar leaves a frozen sensor out of the score, so health and the other measures still match the siblings; the machine itself is fine.`
    : mine.length ? html`<b>${a.id} stands apart from its siblings on ${plural(mine.length, 'measure')}</b>: ${list(mine.map(x => lc(x.r.label)))}.`
    : html`<b>${a.id} is within 25 % of the peer median on every measure.</b>`;
  const peerOdd = [...new Set(marked.filter(x => !x.self).map(x => x.m.a.id))];
  return html`<section class="card cp-sidecard" aria-label="Side-by-side table">
  <div class="card-head">${marker(3)}<h2>Side by side</h2><span class="sub">${a.id} and the ${plural(on.length, 'sibling')} switched on · last column: ${term('peer median', TERM_MEDIAN)}</span></div>
  <p class="small cp-sidecap">${capText}${peerOdd.length ? html` ${list(peerOdd)} ${peerOdd.length > 1 ? 'are' : 'is'} also marked against the median.` : ''}</p>
  <div class="table-wrap cp-side"><table class="table">
  <caption class="visually-hidden">${a.id} compared with its siblings, measure by measure</caption>
  <thead><tr><th scope="col" class="cp-corner">Measure</th>${cols.map((m, i) => html`<th scope="col" class="${i === 0 ? 'cp-selfcol' : ''}">${i === 0 ? html`<span class="mono">${m.a.id}</span><span class="cp-colsub">this machine</span>` : html`<button class="cp-colbtn" data-action="pick-id" data-id="${m.a.id}" title="Make ${m.a.id} the main machine"><span class="mono">${m.a.id}</span><span class="cp-colsub">${m.a.lineId === a.lineId ? 'same line' : m.site.city}</span></button>`}</th>`)}<th scope="col" class="cp-med">Peer median</th></tr></thead>
  <tbody>${body}</tbody></table></div>
  <p class="chart-caption">Marked cells differ from the median of the switched-on siblings by more than 25 %: <span class="cp-key act">↑↓ red</span> much worse (twice as bad or more), <span class="cp-key watch">↑↓ amber</span> worse, <span class="cp-key better">↑↓ grey</span> better. Small gaps (under 5 health points or 10 confidence points) are ignored as noise. Press a sibling's name to make it the main machine.</p>
  </section>`;
}

// ---------- 4 · fleet heatmap ----------
function cellOf(M, a, g, t, sf) {
  const tags = a.tags.filter(x => x.group === g);
  if (!tags.length) return null;
  const rank = x => (x.beyond ? 4 : x.frozen ? 3 : x.dev >= MOVED ? 2 : 1) + x.dev;
  let worst = null;
  for (const tag of tags) {
    const frozen = !!(sf && sf.tag === tag.key);
    const v = M.trendAt(a, tag.key, t), dev = frozen ? 0 : M.deviation(tag, v);
    const beyond = !frozen && (tag.dir === 'low' ? v < tag.alarm : v > tag.alarm);
    const x = { tag, dev, beyond, frozen };
    if (!worst || rank(x) > rank(worst)) worst = x;
  }
  return { ...worst, tone: worst.frozen ? 'sensor' : worst.beyond ? 'act' : worst.dev >= MOVED ? 'watch' : 'normal' };
}

function heatCard(c) {
  const { W, M, t, a } = c;
  const siteId = ui.hmSite || a.siteId, site = M.siteById(siteId);
  const lines = W.lines.filter(l => l.siteId === siteId);
  const shown = ui.hmLine !== 'all' && lines.some(l => l.id === ui.hmLine) ? lines.filter(l => l.id === ui.hmLine) : lines;
  const rows = shown.map(l => ({ l, ms: W.assets.filter(x => x.lineId === l.id).map(x => { const ass = M.assess(x, t); return { x, ass, cells: GROUPS.map(([g]) => cellOf(M, x, g, t, ass.sensorFault)) }; }) }));
  const all = rows.flatMap(r => r.ms);
  const nAct = all.filter(m => m.cells.some(cl => cl && cl.tone === 'act')).length;
  const nWatch = all.filter(m => !m.cells.some(cl => cl && cl.tone === 'act') && m.cells.some(cl => cl && (cl.tone === 'watch' || cl.tone === 'sensor'))).length;
  const pctOf = cl => Math.floor(cl.dev * 100 + 1e-9);   // floor, so a grey cell never reads 10 % (the amber threshold)
  const cellText = cl => (cl.frozen ? 'Frozen' : `${pctOf(cl)} %`);
  const cellIcon = cl => (cl.tone === 'act' ? icon('alert') : cl.tone === 'watch' ? icon('info') : cl.tone === 'sensor' ? icon('sensor') : '');
  const cellWords = cl => (cl.frozen ? 'sensor frozen, a sensor issue' : cl.tone === 'act' ? 'past its alarm line, act now' : cl.tone === 'watch' ? 'moving towards its alarm line, watch' : 'normal');
  return html`<section class="card cp-heatcard" aria-label="Plant heatmap">
  <div class="card-head">${marker(4)}<h2>Plant heatmap: every machine at ${site.city}</h2><span class="sub">worst sensor in each group, now</span></div>
  <div class="cp-ctrls">
  <div class="field"><span class="cp-lbl" id="cp-hm-site-l">Plant</span><div class="seg" role="group" aria-labelledby="cp-hm-site-l">${W.sites.map(s => html`<button data-action="hm-site" data-id="${s.id}" aria-pressed="${String(s.id === siteId)}">${s.city}</button>`)}</div></div>
  <div class="field cp-hm-line"><label for="cp-hm-line">Line</label><select id="cp-hm-line" class="input" data-action="hm-line"><option value="all">All ${plural(lines.length, 'line')}</option>${lines.map(l => html`<option value="${l.id}" ${shown.length === 1 && shown[0] === l ? raw('selected') : ''}>${l.name}</option>`)}</select></div>
  </div>
  <p class="small">${nAct || nWatch ? html`<b>${nAct ? `${plural(nAct, 'machine')} past an alarm line (red)` : ''}${nAct && nWatch ? ' and ' : ''}${nWatch ? `${plural(nWatch, 'machine')} moving or with a frozen sensor (amber)` : ''}</b> out of ${all.length} shown. The rest are grey: normal.` : html`<b>All ${all.length} machines shown are grey: every sensor group is normal.</b>`}</p>
  <p class="cp-swipe xs dim">Swipe the table sideways to see every sensor group.</p>
  <div class="cp-heat-grid"><div class="table-wrap cp-heat"><table class="cp-hm">
  <caption class="visually-hidden">Worst sensor deviation per sensor group for each machine at ${site.name}</caption>
  <thead><tr><th scope="col" class="cp-hm-mach">Machine</th>${GROUPS.map(([, l]) => html`<th scope="col">${l}</th>`)}</tr></thead>
  <tbody>${rows.map(r => html`<tr class="cp-hm-line"><th scope="colgroup" colspan="${GROUPS.length + 1}">${r.l.name}</th></tr>
  ${r.ms.map(m => html`<tr class="${m.x.id === a.id ? 'sel' : ''}"><th scope="row" class="cp-hm-mach"><button class="cp-hm-row" data-action="pick-id" data-id="${m.x.id}" ${m.x.id === a.id ? raw('aria-current="true"') : ''}><b class="mono">${m.x.id}</b><span class="cp-hm-name">${m.x.id === a.id ? 'comparing now' : m.x.name}</span></button></th>
  ${m.cells.map((cl, j) => cl ? html`<td><button class="cp-c ${cl.tone}" data-action="pick-id" data-id="${m.x.id}" aria-label="${m.x.id} ${GROUPS[j][1].toLowerCase()}: ${cl.frozen ? '' : `${pctOf(cl)} % of the way to trip, `}${cellWords(cl)}. Press to compare ${m.x.id}." title="${cl.tag.label}: ${cellWords(cl)}">${cellIcon(cl)}${cellText(cl)}</button></td>` : html`<td><span class="cp-c none" aria-label="no ${GROUPS[j][1].toLowerCase()} sensor">–</span></td>`)}</tr>`)}`)}</tbody></table></div>
  <div class="cp-hm-side"><ul class="cp-hm-key small" aria-label="Heatmap key">
  <li><span class="cp-c normal">0 %</span> grey: normal (under 10 % of the way from normal to trip)</li>
  <li><span class="cp-c watch">${icon('info')}25 %</span> amber: moving towards its alarm line</li>
  <li><span class="cp-c act">${icon('alert')}60 %</span> red: past its alarm line</li>
  <li><span class="cp-c sensor">${icon('sensor')}Frozen</span> amber dashed: a frozen sensor (check the sensor, not the machine)</li>
  <li><span class="cp-c none">–</span> no sensor of that kind</li>
  </ul>
  <p class="chart-caption">Each cell is the worst sensor in that group: how far it has moved from normal towards its trip level (0 % normal, 100 % at trip), from Nirantar's trend with the shift load removed. Press a machine or a cell to compare it with its siblings.</p></div></div>
  </section>`;
}

// ---------- 5 · plant benchmark ----------
function plantsCard(c) {
  const { W, M, S, t, a, cq } = c;
  const open = S.openAlerts();
  const P = W.sites.map(s => {
    const ms = W.assets.filter(x => x.siteId === s.id).map(x => ({ x, ass: M.assess(x, t) }));
    const o = M.siteOee(s.id, 30, t);
    const upstream = m => cq && cq.lines.includes(m.x.lineId) && m.ass.worstKey === cq.tag;   // reacting to another machine's fault
    const ab = ms.filter(m => m.ass.state === 'act' || m.ass.state === 'watch');
    const risky = ab.filter(m => !upstream(m));
    return { s, n: ms.length, oee: o ? o.oee : null, alerts: open.filter(al => M.assetById(al.assetId).siteId === s.id).length,
      health: avg(ms.map(m => m.ass.health)), act: ms.filter(m => m.ass.state === 'act').length, watch: ms.filter(m => m.ass.state === 'watch').length,
      sensor: ms.filter(m => m.ass.state === 'sensor').length, abn: ab.length, risk: risky.reduce((sum, m) => sum + M.exposure(m.x, m.ass.mode).inr, 0), riskN: risky.length,
      kwh: ms.reduce((sum, m) => sum + (kwhNow(W, M, m.x, t) || 0), 0) };
  });
  // best / worst per measure, in words; ties share the word; no words when the plants are effectively equal
  const MEAS = { oee: ['high', 0.005, 'Best', 'Lowest'], health: ['high', 0.5, 'Best', 'Lowest'], alerts: ['low', 0.5, 'Fewest', 'Most'], abn: ['low', 0.5, 'Fewest', 'Most'], risk: ['low', 1, 'Least', 'Most'] };
  const marks = {};
  for (const [k, [dir, eps, bw, ww]] of Object.entries(MEAS)) {
    const vals = P.map(p => p[k]), max = Math.max(...vals), min = Math.min(...vals);
    if (max - min <= eps) continue;
    const best = dir === 'high' ? max : min, worst = dir === 'high' ? min : max;
    P.forEach(p => { if (Math.abs(p[k] - best) <= eps / 2) marks[p.s.id + k] = ['best', bw]; else if (Math.abs(p[k] - worst) <= eps / 2) marks[p.s.id + k] = ['worst', ww]; });
  }
  const mk = (p, k) => { const m = marks[p.s.id + k]; return m ? html`<span class="cp-mark ${m[0]}">${m[0] === 'best' ? '▲' : '▼'} ${m[1]}</span>` : ''; };
  const byOee = [...P].sort((x, y) => y.oee - x.oee), riskTop = [...P].sort((x, y) => y.risk - x.risk)[0];
  const sum = html`<b>${byOee[0].s.city} runs best</b> at ${pct(byOee[0].oee)} OEE over 30 days; <b>${byOee[2].s.city} is lowest</b> at ${pct(byOee[2].oee)}${riskTop.risk > 0 ? html`. The most money at risk is at <b>${riskTop.s.city}: ${inr(riskTop.risk)}</b> on ${plural(riskTop.riskN, 'machine')}` : '. No plant has money at risk right now'}.`;
  return html`<section class="card cp-plantcard" aria-label="Plant benchmark">
  <div class="card-head">${marker(5)}<h2>Plant benchmark</h2><span class="sub">the three plants side by side, now and over 30 days</span></div>
  <p class="small">${sum}</p>
  <div class="cp-plants">${P.map(p => html`<article class="cp-plant ${p.s.id === a.siteId ? 'here' : ''}" aria-label="${p.s.name}">
  <header><h3>${p.s.city}</h3>${p.s.id === a.siteId ? html`<span class="pill">${a.id}'s plant</span>` : ''}<p class="xs dim">${p.s.name} · ${p.s.makes}</p></header>
  <div class="cp-oee"><span class="cp-oee-l">${term('30-day OEE', 'OEE = availability × performance × quality, averaged over the last 30 days. 85 % is the common world-class benchmark.')}</span><b class="mono">${pct(p.oee)}</b>${mk(p, 'oee')}</div>
  <dl class="cp-dl">
  <dt>Machines</dt><dd><span class="mono">${p.n}</span></dd>
  <dt>Open alerts</dt><dd><span class="mono">${p.alerts}</span>${mk(p, 'alerts')}</dd>
  <dt>Average health</dt><dd><span class="mono">${num(p.health, 0)}</span> <span class="dim">of 100</span>${mk(p, 'health')}</dd>
  <dt>Act now or watch</dt><dd>${p.abn ? html`<span>${p.act ? `${p.act} act now` : ''}${p.act && p.watch ? ' · ' : ''}${p.watch ? `${p.watch} watch` : ''}</span>` : html`<span class="dim">none</span>`}${p.sensor ? html` <span class="dim">· ${plural(p.sensor, 'sensor check')}</span>` : ''}${mk(p, 'abn')}</dd>
  <dt>Energy a day</dt><dd><span class="mono">${int(p.kwh)}</span> kWh</dd>
  <dt>${term('Money at risk', 'Downtime cost if every machine in act now or watch broke down: hours down (repair plus waiting for the part) × what the line loses per hour. Machines that only react to another machine\'s fault are not counted twice.')}</dt><dd><span class="mono">${p.risk ? inr(p.risk) : 'Rs 0'}</span>${mk(p, 'risk')}</dd>
  </dl></article>`)}</div>
  <p class="chart-caption">Best and worst are written next to each number, not shown by colour alone. Energy has no best or worst: a cement kiln and a machining line are not comparable. Open alerts count every alert not yet closed, including sensor checks.</p>
  </section>`;
}
