// Tool · Analyse · Alarm rules: where should alarm limits sit so people are not flooded?
// ISA-18.2 alarm management on the synthetic fleet. The what-if replays 7 days of the model's smoothed readings for one
// sensor type at any alarm limit between normal and trip (activations with a deadband and a 15-minute re-arm, nuisance
// alarms on healthy machines, knock-on alarms, warning time before each developing fault) and plots the trade-off.
// A named person can propose a limit; it goes to management-of-change review and the live limits never change here.
// Then: alarm health with root-cause grouping, a simulated notification routing table with a message preview, and the
// shelving and suppression rules with what is shelved right now.
// autoRerender is off because the page has a name field: onStore() repaints on actions, and on clock steps only while
// nobody is typing or dragging. Typed values live in `ui`, so a repaint keeps them.
import { html, raw, esc, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, term, nextBack, confPct } from '../ui/components.js';
import { TAGS, FAILURE_MODES } from '../core/generator.js';
import { inr, hours, num, dateTime, time, ago, HOUR, MIN, DAY } from '../core/format.js';

// ---------- method constants (ISA-18.2 practice) ----------
export const WINDOW_D = 7;          // days of readings replayed
export const STEP_MIN = 30;         // one reading every 30 minutes
export const REARM_MIN = 15;        // an alarm re-arms only after 15 min back inside the limit
export const HYST = 0.02;           // deadband: 2 % of the normal-to-trip range
export const ISA = { flood10: 10, perHour: 6, dayOk: 150, dayMax: 300 };
const SWEEP = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const PROPOSE = 'Proposed an alarm-limit change';

let ui = { key: 'VIB_RMS', idx: {}, name: null, dataKey: null, pending: false, w: 0 };
let live = null;            // { root, ctx } of the last render, for onStore()
const cache = { sig: null, smooth: new Map(), raw: new Map(), fleet: null };

// format.js prints midnight as "24:15" in some engines; show "00:15"
const fixMid = s => s.replace(/\b24:(\d\d)/, '00:$1');
const dt = ms => fixMid(dateTime(ms));
const hm = ms => fixMid(time(ms));
const lc = label => label.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase());   // "Vibration (RMS)" → "vibration (RMS)"
const nb = v => String(v).replace(/ (%|L|Cr|h)\b/g, ' $1').replace(/Rs /g, 'Rs ');
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const join = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- the limit grid (pure, exported for Node tests) ----------
/** Slider grid for one catalogue tag: about 100 "nice" steps from normal (0) to trip (n). */
export function grid(T) {
  const span = Math.abs(T.trip - T.normal), raw0 = span / 100;
  const mag = 10 ** Math.floor(Math.log10(raw0));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw0 - 1e-12);
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return { step, n: Math.round(span / step), dec, sign: T.trip > T.normal ? 1 : -1, span };
}
export const limitValue = (T, g, i) => +(T.normal + g.sign * i * g.step).toFixed(g.dec);
export const fracOf = (T, v) => Math.abs(v - T.normal) / Math.abs(T.trip - T.normal);
const idxOf = (T, g, v) => Math.max(0, Math.min(g.n, Math.round(Math.abs(v - T.normal) / g.step)));
const fmtV = (g, v) => Number(v.toFixed(g.dec)).toLocaleString('en-IN', { minimumFractionDigits: Math.min(g.dec, 1), maximumFractionDigits: g.dec });

// ---------- replay readings (pure functions of the store, exported for Node tests) ----------
/**
 * One row per machine that has the sensor: readings every STEP_MIN over the last WINDOW_D days (smoothed model view, or
 * raw with sensor noise). Machines with a developing fault on this sensor are followed on into the future until their
 * predicted failure, so the warning time can be measured for limits that are not crossed yet.
 */
export function buildStudy(store, key, raw = false) {
  const M = store.model, W = store.world, st = store.state;
  const t1 = store.t, t0 = t1 - WINDOW_D * DAY, step = STEP_MIN * MIN;
  const cq = W.scenario.consequence;
  const rootF = cq ? st.faults.find(f => f.asset === cq.from) : null;
  const root = rootF && rootF.onset < t1 && !(rootF.repairedAt && rootF.repairedAt <= t0) ? rootF : null;
  const rows = [];
  for (const a of W.assets) {
    const tag = a.tags.find(x => x.key === key);
    if (!tag) continue;
    const faults = st.faults.filter(f => f.asset === a.id && f.onset < t1 && !(f.repairedAt && f.repairedAt <= t0));
    const own = raw ? null : faults.find(f => f.effects[key] != null && !f.repairedAt) || null;
    const knock = !faults.length && !!root && cq.tag === key && cq.lines.includes(a.lineId);
    const sf = st.sensorFaults.find(s => s.asset === a.id && s.tag === key && s.start <= t1) || null;
    // smoothed view, but a frozen sensor stays frozen (what the alarm system would actually see)
    const read = raw ? (t => M.valueAt(a, key, t)) : (t => M.smoothAt(a, key, sf && t >= sf.start ? sf.start : t));
    // sample grid anchored on the current model time, so a reload of the same scenario gives the same counts
    const from = (own ? Math.min(t0, own.onset) : t0) - step, start = t1 - Math.ceil((t1 - from) / step) * step;
    const end = own ? Math.max(t1, own.failAt) : t1;
    const ts = [], vs = [];
    for (let t = start; t <= end; t += step) { ts.push(t); vs.push(read(t)); }
    rows.push({ a, tag, cls: faults.length ? 'fault' : knock ? 'knock' : 'none', faults, own, sf, ts, vs });
  }
  return { key, raw, t0, t1, rows, root };
}

/**
 * Alarm activations at a limit `f` (0 = normal, 1 = trip, applied to each machine's own scaled limits).
 * An alarm fires when the reading crosses into alarm; it clears when the reading is back inside the limit by the
 * deadband (HYST of the range) and re-arms only after REARM_MIN. Warning time = first crossing → predicted failure.
 */
export function evaluate(sd, f) {
  const acts = [], leads = [], per = new Map(), rearm = REARM_MIN * MIN;
  for (const r of sd.rows) {
    const L = r.tag.normal + f * (r.tag.trip - r.tag.normal), hi = r.tag.dir !== 'low';
    const hy = HYST * Math.abs(r.tag.trip - r.tag.normal);
    const inA = v => (hi ? v >= L : v <= L), clear = v => (hi ? v < L - hy : v > L + hy);
    let on = inA(r.vs[0]), clearSince = on ? null : r.ts[0], first = on ? r.ts[0] : null, n = 0, firstAct = null;
    for (let i = 1; i < r.ts.length; i++) {
      const t = r.ts[i], v = r.vs[i], inside = inA(v);
      if (inside && first == null) first = t;
      if (!on) {
        if (inside && clearSince != null && t - clearSince >= rearm) {
          on = true;
          if (t > sd.t0 && t <= sd.t1) { acts.push({ id: r.a.id, t, cls: r.cls }); n++; if (firstAct == null) firstAct = t; }
        }
      } else if (clear(v)) { on = false; clearSince = t; }
    }
    if (n) per.set(r.a.id, { n, first: firstAct });
    if (r.own) {
      const fa = r.own.failAt, kept = first != null && first <= fa;
      leads.push({ id: r.a.id, mode: r.own.mode, first, failAt: fa, kept, leadH: kept ? (fa - first) / HOUR : null, ahead: first != null && first > sd.t1 });
    }
  }
  leads.sort((x, y) => x.failAt - y.failAt);
  const keptH = leads.filter(l => l.kept).map(l => l.leadH);
  return { f, acts, n: acts.length, perDay: acts.length / WINDOW_D, machines: per.size, per,
    nuisance: acts.filter(x => x.cls === 'none').length, knock: acts.filter(x => x.cls === 'knock').length, real: acts.filter(x => x.cls === 'fault').length,
    peak: peakOf(acts), leads, kept: keptH.length, median: median(keptH) };
}
/** Busiest moment: the most alarms that fired on the same half-hourly reading. */
export function peakOf(acts) {
  const m = new Map();
  for (const x of acts) m.set(x.t, (m.get(x.t) || 0) + 1);
  let best = { n: 0, t: null };
  for (const [t, n] of m) if (n > best.n || (n === best.n && t > best.t)) best = { n, t };
  return best;
}

// ---------- caches (per data + model time) ----------
function dataSig(store) {
  const s = store.state;
  return [s.scenarioId, s.seed, s.anchor, store.t,
    s.faults.map(f => `${f.asset}:${f.onset}:${f.failAt}:${f.repairedAt || 0}`).join(','),
    s.sensorFaults.map(x => `${x.asset}:${x.tag}:${x.start}`).join(',')].join('|');
}
function ensureCache(store) {
  const sig = dataSig(store);
  if (cache.sig !== sig) { cache.sig = sig; cache.smooth.clear(); cache.raw.clear(); cache.fleet = null; }
}
function studyFor(store, key, raw = false) {
  ensureCache(store);
  const m = raw ? cache.raw : cache.smooth;
  if (!m.has(key)) m.set(key, buildStudy(store, key, raw));
  return m.get(key);
}
const sweepOf = sd => (sd.sweep ||= SWEEP.map(f => evaluate(sd, f)));
const presentKeys = store => Object.keys(TAGS).filter(k => store.world.assets.some(a => a.tags.some(t => t.key === k)));
/** Every sensor type at today's limits, for the plant-level comparison with the ISA-18.2 rates. */
function fleetNow(store) {
  ensureCache(store);
  if (cache.fleet) return cache.fleet;
  const all = [];
  for (const k of presentKeys(store)) { const T = TAGS[k]; all.push(...evaluate(studyFor(store, k), fracOf(T, T.alarm)).acts); }
  cache.fleet = { n: all.length, perDay: all.length / WINDOW_D, peak: peakOf(all), machines: new Set(all.map(x => x.id)).size };
  return cache.fleet;
}

// ---------- trade-off chart (two panels sharing the limit axis) ----------
function scale(max) {
  const m = Math.max(max, 1e-9), step0 = m / 3, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= step0 - 1e-12);
  const top = Math.ceil(m / step - 1e-9) * step, ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return { top, ticks };
}
const tickTxt = v => (v >= 10 ? String(Math.round(v)) : String(+v.toFixed(1)));
/** Round limit values inside (normal, trip) for the shared x axis. */
function xTicks(T) {
  const lo = Math.min(T.normal, T.trip), hi = Math.max(T.normal, T.trip), step0 = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(x => x >= step0 - 1e-12);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) if ((v - lo) / (hi - lo) > 0.03 && (hi - v) / (hi - lo) > 0.03) out.push(+v.toFixed(6));
  return out;
}
const LEAD_STYLE = [['var(--ink)', ''], ['var(--ink-2)', '6 4'], ['var(--normal)', '2 3']];

function tradeChart({ T, g, pts, leadIds, cur, ch, w }) {
  const f1 = v => Math.round(v * 10) / 10;
  const hasB = leadIds.length > 0;   // no developing fault on this sensor: no warning panel
  const L = 40, R = 66, yA0 = 58, hA = 92, yA1 = yA0 + hA, yB0 = hasB ? yA1 + 36 : yA1, hB = hasB ? 100 : 0, yB1 = yB0 + hB, h = yB1 + 26;
  const X = f => L + f * (w - L - R);
  const sA = scale(Math.max(...pts.map(p => p.e.perDay), cur.perDay, ch.perDay, 0) || 1);
  const YA = v => yA1 - v / sA.top * hA;
  const leadsOf = id => pts.map(p => ({ f: p.f, l: p.e.leads.find(x => x.id === id) }));
  const maxOf = id => Math.max(0, ...pts.map(p => p.e.leads.find(x => x.id === id)).filter(l => l && l.kept).map(l => l.leadH));
  const maxB = Math.max(0, ...leadIds.slice(0, 3).map(maxOf));
  // one slow fault (weeks of warning) would flatten the others: scale to the first-failing machine, clip the rest
  const mainMax = leadIds.length ? maxOf(leadIds[0]) : 0;
  const capped = leadIds.length > 1 && mainMax > 0 && maxB > 2.5 * mainMax;
  const sB = scale(capped ? mainMax * 1.25 : maxB || 24);
  const clipped = capped ? leadIds.slice(1, 3).filter(id => maxOf(id) > sB.top).map(id => ({ id, max: maxOf(id) })) : [];
  const YB = v => yB1 - v / sB.top * hB;
  const txt = (x, y, s, cls = '', anchor = 'start', extra = '') => `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" class="${cls}" ${extra}>${esc(s)}</text>`;
  let s = '';
  // grids and y ticks
  for (const v of sA.ticks) s += `<line x1="${L}" x2="${w - R}" y1="${f1(YA(v))}" y2="${f1(YA(v))}" stroke="var(--line)"/>` + txt(L - 6, YA(v) + 4, tickTxt(v), '', 'end');
  if (hasB) for (const v of sB.ticks) s += `<line x1="${L}" x2="${w - R}" y1="${f1(YB(v))}" y2="${f1(YB(v))}" stroke="var(--line)"/>` + txt(L - 6, YB(v) + 4, tickTxt(v), '', 'end');
  s += txt(4, yA0 - 10, 'Alarms per day, all machines', 'lbl-strong rl-halo');
  if (hasB) s += txt(4, yB0 - 10, 'Hours of warning before the failure', 'lbl-strong rl-halo');
  // panel A: alarms per day (area + line)
  const pA = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.f))},${f1(YA(p.e.perDay))}`).join('');
  s += `<path d="${pA}L${f1(X(pts[pts.length - 1].f))},${yA1}L${f1(X(pts[0].f))},${yA1}Z" fill="var(--ink-2)" opacity=".12"/><path d="${pA}" fill="none" stroke="var(--ink-2)" stroke-width="2" stroke-linejoin="round"/>`;
  // panel B: hours of warning, one line per developing fault (gaps where the alarm would come too late)
  const ends = [];
  leadIds.slice(0, 3).forEach((id, k) => {
    const [stroke, dash] = LEAD_STYLE[k];
    let seg = [], last = null;
    const flush = () => {
      if (seg.length > 1) s += `<path clip-path="url(#rl-clipB)" d="${seg.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.f))},${f1(YB(p.l.leadH))}`).join('')}" fill="none" stroke="${stroke}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;
      else if (seg.length === 1) s += `<circle clip-path="url(#rl-clipB)" cx="${f1(X(seg[0].f))}" cy="${f1(YB(seg[0].l.leadH))}" r="2.5" fill="${stroke}"/>`;
      seg = [];
    };
    for (const p of leadsOf(id)) { if (p.l && p.l.kept) { seg.push(p); last = p; } else flush(); }
    flush();
    if (last && last.l.leadH <= sB.top) ends.push({ id, x: X(last.f), y: YB(last.l.leadH) - 7 });
  });
  ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => {
    if (i && e.y - arr[i - 1].y < 12) e.y = arr[i - 1].y + 12;
    const right = e.x + 4 + e.id.length * 6.6 > w - 2;
    s += txt(right ? e.x - 4 : e.x + 4, Math.max(yB0 + 10, e.y), e.id, 'lbl-strong rl-halo', right ? 'end' : 'start');
  });
  // baselines and the shared limit axis
  s += `<line x1="${L}" x2="${w - R}" y1="${yA1}" y2="${yA1}" stroke="var(--line-2)"/><line x1="${L}" x2="${w - R}" y1="${yB1}" y2="${yB1}" stroke="var(--line-2)"/>`;
  for (const v of xTicks(T)) {
    const x = X(fracOf(T, v)), str = (+v.toFixed(g.dec)).toLocaleString('en-IN'), tw = str.length * 6.2;
    s += `<line x1="${f1(x)}" x2="${f1(x)}" y1="${yB1}" y2="${yB1 + 4}" stroke="var(--line-2)"/>`;
    s += txt(x < L + tw / 2 ? x - 2 : x, yB1 + 17, str, '', x < L + tw / 2 ? 'start' : 'middle');
  }
  s += txt(w - R + 8, yB1 + 17, T.unit, '', 'start');
  // limit markers: today (amber, like the alarm line on Machine Detail) and yours (dark, dashed)
  const same = Math.abs(cur.f - ch.f) < 1e-9;
  const xC = X(cur.f), xY = X(ch.f);
  const label = (x, row, str, cls) => { const tw = str.length * 6.6; const cx = Math.min(Math.max(x, tw / 2 + 2), w - tw / 2 - 2); return txt(cx, row, str, `lbl-strong rl-halo ${cls}`, 'middle'); };
  const lC = same ? `Today's limit ${fmtV(g, T.alarm)}` : `Today ${fmtV(g, T.alarm)}`;
  const lY = `Yours ${fmtV(g, T.normal + g.sign * ch.f * g.span)}`;
  const clash = !same && Math.abs(xC - xY) < (lC.length + lY.length) * 3.3 + 10;
  const rowY = clash ? 30 : 14;
  s += `<line x1="${f1(xC)}" x2="${f1(xC)}" y1="18" y2="${yB1}" stroke="var(--watch-fill)" stroke-width="2"/>`;
  if (!same) s += `<line x1="${f1(xY)}" x2="${f1(xY)}" y1="${rowY + 4}" y2="${yB1}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="5 4"/>`;
  const dot = (x, y, fill) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="4.5" fill="${fill}" stroke="var(--panel)" stroke-width="2"/>`;
  s += dot(xC, YA(cur.perDay), 'var(--watch-fill)');
  if (!same) s += dot(xY, YA(ch.perDay), 'var(--ink)');
  for (const id of leadIds.slice(0, 3)) {
    const lc0 = cur.leads.find(x => x.id === id), ly = ch.leads.find(x => x.id === id);
    if (lc0 && lc0.kept) s += dot(xC, YB(lc0.leadH), 'var(--watch-fill)');
    if (!same && ly && ly.kept) s += dot(xY, YB(ly.leadH), 'var(--ink)');
  }
  s += label(xC, 14, lC, 'rl-today');
  if (!same) s += label(xY, rowY, lY, '');
  const title = `Trade-off for ${T.label}: alarms per day and hours of warning at every alarm limit from normal (${fmtV(g, T.normal)} ${T.unit}) to trip (${fmtV(g, T.trip)} ${T.unit})`;
  const defs = `<defs><clipPath id="rl-clipB"><rect x="${L - 4}" y="${yB0 - 2}" width="${w - L - R + 8}" height="${hB + 6}"/></clipPath></defs>`;
  return { svg: raw(`<svg class="chart rl-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><title>${esc(title)}</title>${defs}${s}</svg>`), clipped };
}

// ---------- notification routing (simulated) ----------
const ROUTES = [
  { id: 'P1', label: 'P1 · respond now', tone: 'act', ic: 'alert', to: 'Plant head and maintenance manager', via: 'WhatsApp + SMS', how: 'WhatsApp and SMS within 5 minutes. Not acknowledged in 30 minutes: it escalates (sent again, plus a phone call to the plant head).' },
  { id: 'P2', label: 'P2 · this shift', tone: 'watch', ic: 'info', to: 'Maintenance planner', via: 'Email + app', how: 'Email and the Nirantar app; respond within the shift.' },
  { id: 'P3', label: 'P3 · when convenient', tone: 'normal', ic: 'clock', to: 'Shift board', via: 'control-room screen', how: 'Shown on the shift board in the control room; nobody is paged.' },
  { id: 'SENSOR', label: 'Sensor check', tone: 'watch', ic: 'sensor', to: 'Instrumentation technician (no repair crew)', via: 'App', how: 'Nirantar app with the inspection task (SOP-50). The machine keeps running.' },
  { id: 'CONSEQUENCE', label: 'Knock-on alarm', tone: 'normal', ic: 'layers', to: 'Nobody separately: suppressed under its root cause', via: 'none', how: 'Folded under the root-cause alert; closes when the root cause is repaired.' },
];
const routeOf = al => (al.type === 'SENSOR' ? 'SENSOR' : al.type === 'CONSEQUENCE' ? 'CONSEQUENCE' : al.priority || 'P3');
const PRIO_WORD = { P1: 'respond now', P2: 'respond this shift', P3: 'when convenient' };

function topAlert(ctx) {
  const { store, S, M } = ctx;
  const t = store.t;
  const active = (store.state.alerts || []).filter(al => al.status !== 'CLOSED' && al.status !== 'SHELVED').map(al => {
    const a = M.assetById(al.assetId), ass = M.assess(a, t);
    return { al, a, ass, att: S.attention(a, ass), ex: M.exposure(a, ass.mode || al.mode || null) };
  });
  const roots = new Set(active.filter(x => x.al.type !== 'CONSEQUENCE').map(x => x.al.assetId));
  return active.filter(x => x.al.type !== 'CONSEQUENCE' || !roots.has(x.al.rootCause))
    .sort((p, q) => q.att.score - p.att.score || p.al.priority.localeCompare(q.al.priority) || p.al.createdAt - q.al.createdAt)[0] || null;
}

function messageLines(ctx, x) {
  const { M } = ctx;
  const { al, a, ass, ex } = x;
  const line = M.lineById(a.lineId), site = M.siteById(a.siteId);
  const link = `${location.origin}${location.pathname}#/machine/${a.id}`;
  const where = `${a.id} ${a.name}, ${line.name}, ${site.city}`;
  if (al.type === 'SENSOR') return [
    'Nirantar · sensor check (no repair crew)', where,
    `Problem: ${ass.sensorFault ? ass.sensorFault.reason : 'a sensor reading looks frozen'}`,
    'Failure confidence: not scored, the sensor itself is suspect',
    'Time to failure: none expected, the machine runs normally',
    'Money at stake: none, a sensor fault stops nothing',
    'Do: check the cable and mounting, compare with a handheld meter (SOP-50)',
    `Open: ${link}`];
  const problem = al.type === 'CONSEQUENCE' ? `${ass.contributions[0].label} out of range, caused by ${al.rootCause}` : ass.modeName || (al.mode && FAILURE_MODES[al.mode]?.name) || `${ass.contributions[0].label} out of range`;
  return [
    `Nirantar · ${al.priority} alert · ${PRIO_WORD[al.priority] || 'respond'}`, where,
    `Problem: ${problem}`,
    `Failure confidence: ${confPct(ass.conf)}`,
    `Time to failure: about ${hours(ass.rulH)}${ass.rulKind === 'trend' ? ` (likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)})` : ' (normal wear, no trend)'}`,
    `Money at stake: ${inr(ex.inr)} if it stops unplanned`,
    `Open: ${link}`];
}

function previewBlock(ctx, x) {
  const { store } = ctx;
  const shelvedNow = (store.state.alerts || []).filter(al => al.status === 'SHELVED');
  if (!x && shelvedNow.length) return html`<div class="rl-nomsg"><b>Nothing would be sent right now:</b> every open alert is shelved (${shelvedNow.map(al => `${al.assetId} until ${dt(al.shelvedUntil)}`).join(', ')}). A shelved alert is not sent again until it comes back.</div>`;
  if (!x) return html`<div class="rl-nomsg"><b>Nothing would be sent right now:</b> there is no open alert. When Nirantar raises one, this box shows the message, who gets it and how. <a href="#/presenter">Inject a fault in the Presenter</a> to see one arrive.</div>`;
  const { al } = x;
  const r = ROUTES.find(z => z.id === routeOf(al));
  if (r.id === 'CONSEQUENCE') return html`<div class="rl-nomsg"><b>No message for ${x.a.id}:</b> it is a knock-on of ${al.rootCause}, so it is suppressed under that root cause and nobody is paged for it separately.</div>`;
  const now = store.state.simNow, waited = now - al.createdAt;
  const wo = al.woId ? (store.state.workOrders || []).find(w => w.id === al.woId) : null;
  const to = r.id === 'SENSOR' && wo && wo.technician ? `${wo.technician.name}, instrumentation (no repair crew)` : r.to;
  let status;
  if (al.status === 'ACK') status = html`<span class="state ok">${icon('check')}Acknowledged by ${al.ackBy} at ${dt(al.ackAt)}: no escalation</span>`;
  else if (al.status === 'ESCALATED') status = html`<span class="state ok">${icon('flag')}Escalated by ${al.escalatedBy || 'a person'}${al.escalatedAt ? ` at ${dt(al.escalatedAt)}` : ''}: the plant head has the evidence pack</span>`;
  else if (r.id === 'P1' && waited > 30 * MIN) status = html`<span class="state act">${icon('bell')}Not acknowledged for ${ago(al.createdAt, now).replace(' ago', '')}: by now this would have escalated to a phone call</span>`;
  else if (r.id === 'P1') status = html`<span class="state watch">${icon('clock')}Escalates at ${dt(al.createdAt + 30 * MIN)} unless someone acknowledges it</span>`;
  else status = html`<span class="state normal">${icon('clock')}Waiting for acknowledgement since ${dt(al.createdAt)}</span>`;
  return html`<div class="rl-preview">
    <div class="rl-pv-head"><span class="state outline rl-pv-label">${icon('info')}Preview only — the demo sends nothing</span></div>
    <div class="rl-bubble" role="group" aria-label="Message preview for ${x.a.id}">
      <p class="rl-b-to"><b>To:</b> ${to} <span class="dim">· ${r.via}</span></p>
      <pre class="rl-msg">${messageLines(ctx, x).join('\n')}</pre>
      <p class="rl-b-time">Would go out at ${dt(al.createdAt)} (when Nirantar raised the alert)</p>
    </div>
    <p class="rl-pv-status">${status}</p>
    <p class="small muted">Picked because it is the top open alert on <a href="#/triage">Alert Triage</a> (highest attention score). Every value comes from the same model as the rest of the demo.</p>
  </div>`;
}

// ---------- KPI tile with a change against today's limit ----------
function tile({ label, value, unit = '', mean = '', tone = '', delta = '' }) {
  return html`<div class="card kpi rl-kpi ${tone}"><div class="k-label">${label}</div><div class="k-value">${value}${unit ? html`<small>${unit}</small>` : ''}${delta}</div>${mean ? html`<div class="k-mean">${mean}</div>` : ''}</div>`;
}
function delta(d, goodUp, fmt = v => String(Math.round(v)), same = false) {
  if (same || d == null || Math.abs(d) < 0.05) return '';
  const better = goodUp ? d > 0 : d < 0;
  return html`<span class="rl-delta ${better ? 'better' : 'worse'}" title="compared with today's limit">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
}

// ---------- the live part of the what-if (repainted while the slider moves) ----------
function studyHtml(ctx, key) {
  const { store, M } = ctx;
  const T = TAGS[key], g = grid(T);
  const sd = studyFor(store, key), rsd = studyFor(store, key, true);
  const fCur = fracOf(T, T.alarm), i = ui.idx[key], vCh = limitValue(T, g, i), fCh = fracOf(T, vCh);
  const cur = evaluate(sd, fCur), ch = Math.abs(fCh - fCur) < 1e-9 ? cur : evaluate(sd, fCh), rch = evaluate(rsd, fCh);
  const same = ch === cur;
  const unit = T.unit, hi = T.dir !== 'low';
  const fleet = fleetNow(store);

  // readout
  const d = vCh - T.alarm;
  const earlier = hi ? d < 0 : d > 0;
  const readNote = same ? 'today\'s alarm limit' : `${fmtV(g, Math.abs(d))} ${unit} ${d < 0 ? 'below' : 'above'} today's ${fmtV(g, T.alarm)}: alarms ${earlier ? 'sooner' : 'later'}`;

  // tiles
  const perDayTxt = v => num(v, v < 10 ? 1 : 0);
  const flood = ch.peak.n > ISA.flood10;
  const t1 = tile({
    label: term('Alarms per day', `Alarm activations from this sensor type across all ${sd.rows.length} machines in the last ${WINDOW_D} days, divided by ${WINDOW_D}. ISA-18.2 guide for one operator: about ${ISA.dayOk} a day is acceptable, ${ISA.dayMax} is the most anyone can manage, and more than ${ISA.flood10} in 10 minutes is a flood.`),
    value: perDayTxt(ch.perDay), delta: delta(ch.perDay - cur.perDay, false, v => num(v, v < 10 ? 1 : 0), same),
    tone: flood ? 'act' : ch.perDay > ISA.dayOk ? 'watch' : '',
    mean: html`${ch.n ? `${plural(ch.n, 'alarm')} in ${WINDOW_D} days on ${plural(ch.machines, 'machine')}.` : `No alarms in ${WINDOW_D} days.`}${flood ? html` <b>Flood:</b> ${ch.peak.n} at once at ${hm(ch.peak.t)}.` : ch.peak.n > 1 ? ` Busiest moment: ${ch.peak.n} at once.` : ''} ISA-18.2: ≤ ${ISA.dayOk} a day per operator.`,
  });
  const t2 = tile({
    label: term('Nuisance alarms', 'Alarms on machines with nothing wrong: here, normal load swings between shifts crossing a limit set too close to normal. Each one costs a look and some trust in the alarm system.'),
    value: String(ch.nuisance), delta: delta(ch.nuisance - cur.nuisance, false, String, same), tone: ch.nuisance ? 'watch' : '',
    mean: (() => {
      const rc = sd.root ? sd.root.asset : 'the root cause';
      if (!ch.n) return 'no healthy machine crosses this limit';
      if (!ch.nuisance && ch.knock === ch.n) return `all ${ch.n} were knock-ons of ${rc}: real, but one problem upstream`;
      return html`${ch.nuisance ? 'on healthy machines in 7 days' : 'every alarm was on a machine with a real problem'}${ch.knock ? html` · plus ${plural(ch.knock, 'knock-on alarm')} caused by ${rc}` : ''}`;
    })(),
  });
  const missed = ch.leads.filter(l => !l.kept);
  const t3 = tile({
    label: term('Early warnings kept', 'Machines with a developing fault on this sensor whose reading crosses the limit before the predicted failure (in the last 7 days, or ahead on the current trend).'),
    value: ch.leads.length ? html`${ch.kept}<small>/ ${ch.leads.length}</small>` : '–', delta: ch.leads.length ? delta(ch.kept - cur.kept, true, String, same) : '',
    tone: missed.length ? 'act' : '',
    mean: !ch.leads.length ? 'no machine has a developing fault on this sensor' : missed.length ? html`${join(missed.map(l => l.id))} would fail before the alarm fires` : 'every developing fault alarms before it fails',
  });
  const main = ch.leads.find(l => l.kept) || ch.leads[0];
  const nir = main ? (store.state.alerts || []).filter(al => al.assetId === main.id && al.type === 'FAILURE').sort((a, b) => a.createdAt - b.createdAt)[0] : null;
  const nirLead = nir ? (main.failAt - nir.createdAt) / HOUR : null;
  const t4 = tile({
    label: term('Median warning', 'Hours from the first alarm (past, or ahead on the current trend) to the predicted failure, the middle value over the machines that alarm in time.'),
    value: ch.median == null ? '–' : nb(hours(ch.median)), delta: ch.median != null && cur.median != null ? delta(ch.median - cur.median, true, v => `${Math.round(v)} h`, same) : '',
    mean: ch.median == null ? (ch.leads.length ? 'no alarm comes before the failure' : 'nothing to warn about on this sensor') : nirLead != null ? nb(`Nirantar's own alert on ${main.id}: ${hours(nirLead)} before (all sensors)`) : 'from the first alarm to the predicted failure',
  });

  // trade-off sentence
  const parts = [];
  if (!same) {
    for (const l of ch.leads) {
      const o = cur.leads.find(x => x.id === l.id);
      if (!o) continue;
      if (l.kept && o.kept) { const dd = l.leadH - o.leadH; parts.push(Math.abs(dd) >= 1 ? `${l.id} gets ${Math.round(Math.abs(dd))} h ${dd > 0 ? 'more' : 'less'} warning` : `${l.id}'s warning hardly changes`); }
      else if (l.kept && !o.kept) parts.push(`${l.id} is now caught ${nb(hours(l.leadH))} before it fails (today's limit misses it)`);
      else if (!l.kept && o.kept) parts.push(`${l.id} would fail before the alarm fires`);
    }
    const dn = ch.n - cur.n, dnu = ch.nuisance - cur.nuisance;
    parts.push(dn > 0 ? `the fleet gets ${plural(dn, 'more alarm')} a week${dnu > 0 ? ` (${dnu} of them nuisance)` : ''}` : dn < 0 ? `the fleet gets ${plural(-dn, 'fewer alarm')} a week` : 'the number of alarms stays the same');
  }
  const trade = same ? html`This is today's limit. Drag the slider to see what moving it would change.`
    : html`<b>Moving the alarm from ${fmtV(g, T.alarm)} to ${fmtV(g, vCh)} ${unit}:</b> ${join(parts)}.${flood ? html` <b>At ${hm(ch.peak.t)} alone ${ch.peak.n} machines alarm on the same reading: an alarm flood</b> (more than ${ISA.flood10} in 10 minutes).` : ''}`;

  // trade-off chart data
  const pts = sweepOf(sd).map(e => ({ f: e.f, e }));
  for (const e of [cur, ch]) if (!pts.some(p => Math.abs(p.f - e.f) < 1e-9)) pts.push({ f: e.f, e });
  pts.sort((a, b) => a.f - b.f);
  const leadIds = sd.rows.filter(r => r.own).sort((a, b) => a.own.failAt - b.own.failAt).map(r => r.a.id);
  const tc = tradeChart({ T, g, pts, leadIds, cur, ch, w: ui.w }), chart = tc.svg;

  // per-machine detail at the chosen limit
  const rows = sd.rows.filter(r => ch.per.has(r.a.id) || r.own || r.sf).map(r => {
    const p = ch.per.get(r.a.id), l = ch.leads.find(x => x.id === r.a.id);
    return { r, n: p ? p.n : 0, first: l ? l.first : p ? p.first : null, l };
  }).sort((a, b) => (b.r.own ? 1 : 0) - (a.r.own ? 1 : 0) || b.n - a.n || a.r.a.id.localeCompare(b.r.a.id));
  const situation = r => r.sf ? html`<span class="state watch">${icon('sensor')}Sensor frozen</span>`
    : r.own ? html`<span class="state act">${icon('wrench')}${FAILURE_MODES[r.own.mode]?.name || 'Fault'} developing</span>`
    : r.cls === 'fault' ? html`<span class="state watch">${icon('wrench')}Other fault</span>`
    : r.cls === 'knock' ? html`<span class="pill">${icon('layers')}Knock-on of ${sd.root ? sd.root.asset : 'root cause'}</span>`
    : html`<span class="state normal">${icon('check')}Nothing wrong</span>`;
  const firstTxt = x => (x.first == null ? '–' : x.first > sd.t1 ? `in ${nb(hours((x.first - sd.t1) / HOUR))} (trend)` : dt(x.first));
  const warnTxt = x => (!x.l ? '–' : x.l.kept ? nb(hours(x.l.leadH)) : 'none: fails first');
  const shown = rows.slice(0, 12);
  const frozen = sd.rows.filter(r => r.sf);

  return {
    same, cur, ch, vCh,
    html: html`
    <div class="rl-readout" aria-live="polite"><span class="rl-rv mono">${fmtV(g, vCh)}<small>${unit}</small></span><span class="rl-rn ${same ? '' : earlier ? 'sooner' : 'later'}">${readNote}</span></div>
    <div class="cols-4 rl-kpis">${t1}${t2}${t3}${t4}</div>
    <p class="rl-trade ${same ? '' : 'moved'}" aria-live="polite">${icon(same ? 'check' : 'info')}<span>${trade}</span></p>
    <figure class="rl-fig">
      <figcaption>${marker(2)}<span><b>The trade-off at every limit</b> <span class="dim">${leadIds.length ? html`top: alarms per day from ${plural(sd.rows.length, 'machine')}; bottom: hours of warning before each developing fault fails` : html`alarms per day from ${plural(sd.rows.length, 'machine')}. No machine has a developing fault on this sensor, so there is no warning time to plot.`}</span></span></figcaption>
      ${chart}
      <div class="rl-axis"><span>← near normal: earlier warning, more alarms</span><span>near trip: fewer alarms, later warning →</span></div>
      <ul class="rl-legend" aria-label="Chart legend">
        <li><span class="lg today"></span>Today's limit ${fmtV(g, T.alarm)} ${unit}</li>
        ${same ? '' : html`<li><span class="lg yours"></span>Your limit ${fmtV(g, vCh)} ${unit}</li>`}
        ${leadIds.slice(0, 3).map((id, k) => { const r = sd.rows.find(z => z.a.id === id), c = tc.clipped.find(z => z.id === id);
          return html`<li><span class="lg lead l${k}"></span>${id}${r && r.own ? `: ${FAILURE_MODES[r.own.mode]?.short || 'fault'}` : ''}${c ? nb(` (up to ${hours(c.max)} of warning near normal, above the top of the chart)`) : ''}</li>`; })}
      </ul>
    </figure>
    ${frozen.length ? html`<p class="rl-note watch">${icon('sensor')}<span><b>${join(frozen.map(r => r.a.id))}: ${lc(T.label)} sensor frozen</b> since ${dt(frozen[0].sf.start)}. No limit can make a frozen reading alarm, which is why Nirantar checks that related sensors agree and raises a <a href="#/triage">sensor check</a> instead.</span></p>` : ''}
    <details class="rl-more">
      <summary>Which machines alarm at ${fmtV(g, vCh)} ${unit} (${plural(rows.length, 'row')})</summary>
      ${rows.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Machine</th><th scope="col">Situation</th><th scope="col" class="n">Alarms, ${WINDOW_D} days</th><th scope="col">First alarm</th><th scope="col" class="n">Warning</th></tr></thead>
        <tbody>${shown.map(x => html`<tr><td><a class="mono" href="#/machine/${x.r.a.id}"><b>${x.r.a.id}</b></a><br><span class="dim xs">${x.r.a.name}</span></td><td>${situation(x.r)}</td><td class="n">${x.n}</td><td class="small">${firstTxt(x)}</td><td class="n">${warnTxt(x)}</td></tr>`)}</tbody>
      </table></div>${rows.length > shown.length ? html`<p class="small dim">and ${rows.length - shown.length} more.</p>` : ''}`
      : html`<p class="small muted">No machine crossed ${fmtV(g, vCh)} ${unit} in the last ${WINDOW_D} days and none has a developing fault on this sensor.</p>`}
    </details>
    <p class="rl-method small muted"><b>How this is measured.</b> Every machine with this sensor, the ${term('smoothed reading', 'The model view: the reading without sensor noise, including the normal load pattern of the shifts. Raw readings jitter, so a raw count mostly measures noise.')} every ${STEP_MIN} minutes from ${dt(sd.t0)} to ${dt(sd.t1)}. An alarm fires when the reading crosses the limit and ${term('re-arms', `Deadband and re-arm: after an alarm the reading must come back inside the limit by ${Math.round(HYST * 100)} % of the normal-to-trip range and stay there for ${REARM_MIN} minutes before the same alarm can fire again. This stops one wobble from raising many alarms.`)} only after ${REARM_MIN} minutes back inside it. ${isScaled(store, key) ? 'Motor current and power limits scale with machine size. ' : ''}${rch.n === ch.n ? `Raw readings with sensor noise give the same count at this limit. ` : html`On raw readings with sensor noise the same limit would have raised <b>${plural(rch.n, 'alarm')}</b> instead of ${ch.n}${rch.n > ch.n ? ': noise makes a reading chatter across a limit' : ''}. `}All ${presentKeys(store).length} sensor types at today's limits raised ${fleet.n ? plural(fleet.n, 'alarm') : 'no alarms'} in ${WINDOW_D} days (${num(fleet.perDay, 1)} a day) across ${plural(store.world.assets.length, 'machine')}.</p>`,
  };
}
const isScaled = (store, key) => store.world.assets.some(a => a.tags.some(t => t.key === key && Math.abs(t.normal - TAGS[key].normal) > 1e-9));

function proposeHtml(store, key, s) {
  const T = TAGS[key], g = grid(T);
  if (s.same) return html`<p class="muted">Move the slider ${marker(1)} away from today's limit first. Today the ${lc(T.label)} alarm is <b>${fmtV(g, T.alarm)} ${T.unit}</b> (normal ${fmtV(g, T.normal)}, trip ${fmtV(g, T.trip)}).</p>`;
  const { cur, ch } = s;
  const leadLine = ch.leads.slice(0, 3).map(l => { const o = cur.leads.find(x => x.id === l.id); return `${l.id} warning ${o && o.kept ? nb(hours(o.leadH)) : 'none'} → ${l.kept ? nb(hours(l.leadH)) : 'none'}`; });
  return html`<p class="rl-change"><b>${T.label} alarm: ${fmtV(g, T.alarm)} → ${fmtV(g, s.vCh)} ${T.unit}</b> <span class="dim">on all ${plural(studyFor(store, key).rows.length, 'machine')} with this sensor${isScaled(store, key) ? ', scaled to machine size' : ''}</span></p>
    <ul class="rl-impact">
      <li>Alarms: ${plural(cur.n, 'alarm')} → ${plural(ch.n, 'alarm')} a week (nuisance ${cur.nuisance} → ${ch.nuisance})</li>
      ${leadLine.map(t => html`<li>${t}</li>`)}
      ${ch.peak.n > ISA.flood10 ? html`<li class="bad">${ch.peak.n} alarms at once at ${hm(ch.peak.t)}: an alarm flood</li>` : ''}
    </ul>`;
}

// ---------- page ----------
export default {
  autoRerender: false,
  onStore(kind, detail) {
    // store.changed(what) arrives as ('change', what); a 15-min model step is ('change', 'tick').
    const what = kind === 'change' ? detail : kind;
    if (!live || what === 'clock') return;
    const { root, ctx } = live;
    if (!root.isConnected) return;
    if (what === 'tick') {
      const a = document.activeElement;
      if (a && root.contains(a) && a.matches('input, select, textarea')) { ui.pending = true; return; }
    }
    ctx.rerender();
  },

  render(root, ctx) {
    const { store, S, M } = ctx;
    live = { root, ctx };
    ui.pending = false;
    const W = store.world, st = store.state;
    const dk = `${st.scenarioId}|${st.seed}|${st.anchor}`;
    if (ui.dataKey !== dk) { ui.dataKey = dk; ui.idx = {}; }
    if (ui.name == null) ui.name = store.prefs.name || '';
    const keys = presentKeys(store);
    if (!keys.includes(ui.key)) ui.key = keys.includes('VIB_RMS') ? 'VIB_RMS' : keys[0];
    const key = ui.key, T = TAGS[key], g = grid(T), iCur = idxOf(T, g, T.alarm);
    if (ui.idx[key] == null) ui.idx[key] = iCur;
    const cs = getComputedStyle(root);
    const inner = (root.clientWidth || 390) - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    ui.w = Math.round(Math.max(270, Math.min(980, inner - 54)));   // card (2 × 15) and figure (2 × 11) padding + borders, so 11 px chart text stays 11 px

    const sd = studyFor(store, key);
    const cur = evaluate(sd, fracOf(T, T.alarm));
    const s = studyHtml(ctx, key);
    const counts = Object.fromEntries(keys.map(k => [k, store.world.assets.filter(a => a.tags.some(t => t.key === k)).length]));

    // sensors where something is happening now (faults, knock-ons, frozen sensors)
    const hot = new Map();
    const add = (k, why) => { if (!keys.includes(k)) return; const v = hot.get(k) || []; if (!v.includes(why)) v.push(why); hot.set(k, v); };
    for (const f of st.faults) if (!f.repairedAt) for (const k of Object.keys(f.effects)) add(k, f.asset);
    if (W.scenario.consequence && st.faults.some(f => f.asset === W.scenario.consequence.from && !f.repairedAt)) add(W.scenario.consequence.tag, `knock-on of ${W.scenario.consequence.from}`);
    for (const x of st.sensorFaults) add(x.tag, `${x.asset} frozen`);

    // headline: today's limits on the chosen sensor type
    const lead0 = cur.leads[0];
    const nir = lead0 ? (st.alerts || []).filter(al => al.assetId === lead0.id && al.type === 'FAILURE').sort((a, b) => a.createdAt - b.createdAt)[0] : null;
    const tag = lc(T.label);
    const countTxt = html`<b>${cur.n === 0 ? `no ${tag} alarms` : `${cur.n} ${tag} alarm${cur.n === 1 ? '' : 's'}`} in ${WINDOW_D} days</b>${cur.machines > 1 ? ` on ${cur.machines} machines` : ''}`;
    let tail;
    if (lead0) {
      const fa = `${nb(hours((lead0.failAt - sd.t1) / HOUR))}`;
      tail = lead0.kept && !lead0.ahead ? html`, and <b>${lead0.id}</b> crossed its alarm <b>${nb(hours(lead0.leadH))} before the predicted failure</b>`
        : lead0.kept ? html`; <b>${lead0.id}</b> will cross the limit in about ${nb(hours((lead0.first - sd.t1) / HOUR))}, only <b>${nb(hours(lead0.leadH))} before the predicted failure</b>`
        : html`, but <b>${lead0.id}</b> would fail (in about ${fa}) before its ${tag} ever reaches the limit`;
      if (nir) tail = html`${tail}. Nirantar's own alert on it came <b>${nb(hours((lead0.failAt - nir.createdAt) / HOUR))}</b> before, from all its sensors together.`;
      else tail = html`${tail}.`;
    } else if (cur.knock) tail = html`, all of them knock-ons of <b>${sd.root.asset}</b>. No machine has its own fault on this sensor.`;
    else {
      const sw = sweepOf(sd), edge = [...sw].reverse().find(e => e.nuisance > 0);
      tail = edge && edge.f === 0 ? html`: no machine has a developing fault on it. Only a limit right at the normal level (${fmtV(g, T.normal)} ${T.unit}) would make healthy machines alarm on normal shift swings.`
        : edge ? html`: no machine has a developing fault on it. Set the limit at ${fmtV(g, T.normal + g.sign * edge.f * g.span)} ${T.unit} or closer to normal and healthy machines start alarming on normal shift swings.`
        : html`: no machine has a developing fault on it, and healthy machines stay clear of every limit between normal and trip.`;
    }
    const folded = Object.entries((st.alerts || []).filter(al => al.type === 'CONSEQUENCE' && al.rootCause && al.status !== 'CLOSED')
      .reduce((m, al) => { (m[al.rootCause] ||= []).push(al); return m; }, {})).sort((a, b) => b[1].length - a[1].length)[0];
    if (folded && folded[1].length >= 3) tail = html`${tail} <b>${folded[1].length} alarms → 1 decision:</b> the knock-on alarms are grouped under ${folded[0]} (see Alarm health below).`;
    const missedNow = cur.leads.filter(l => !l.kept).length;
    const hTone = missedNow || cur.nuisance ? 'watch' : 'ai';

    // alarm health + grouping
    const ah = S.alarmHealth();
    const now = st.simNow;
    const raised24 = (st.alerts || []).filter(al => al.createdAt > now - DAY && al.createdAt <= now).length;
    const groups = {};
    for (const al of st.alerts || []) if (al.type === 'CONSEQUENCE' && al.rootCause) (groups[al.rootCause] ||= []).push(al);
    const floodNow = ah.last10 > ah.target, floodDay = ah.peak10 > ah.target;
    const meter = (v, label) => {
      const max = Math.max(ah.target * 1.5, v, 1);
      return html`<div class="rl-meter ${v > ah.target ? 'over' : ''}" role="img" aria-label="${label}: ${v} alarms in 10 minutes against a target of ${ah.target}"><span class="fill" style="width:${Math.min(100, v / max * 100)}%"></span><span class="target" style="left:${ah.target / max * 100}%"></span></div>`;
    };

    // routing
    const openA = (st.alerts || []).filter(al => al.status !== 'CLOSED' && al.status !== 'SHELVED');
    const nRoute = id => openA.filter(al => routeOf(al) === id).length;
    const top = topAlert(ctx);
    const topRoute = top ? routeOf(top.al) : null;

    // shelving
    const shelved = (st.alerts || []).filter(al => al.status === 'SHELVED');
    const shelvedBy = al => st.audit.find(r => r.target === al.assetId && /^Shelved the alert/.test(r.action));
    const proposals = st.audit.filter(r => r.action === PROPOSE);

    root.innerHTML = String(html`<div class="page rulespage">
      ${pageHead('rules')}
      ${headline(html`At today's limits the fleet raised ${countTxt}${tail}`, hTone)}
      ${doThis([
        html`Pick a sensor type and drag its alarm limit ${marker(1)}: alarms per day, nuisance alarms and warning time update at once.`,
        html`Read the trade-off ${marker(2)}: a limit near normal warns earlier but floods people; near trip it is quiet but late.`,
        html`Propose the limit with your name ${marker(3)}. It goes to management-of-change review; the demo never changes the live limits.`,
        html`Check alarm health ${marker(4)}, who gets which alert, and what is shelved or suppressed.`,
      ])}

      <section class="card rl-tool" aria-label="Alarm-limit what-if">
        <div class="card-head">${marker(1)}<h2>Alarm-limit what-if</h2><span class="right">${aiChip(`Measured by Nirantar on ${WINDOW_D} days of readings`)}</span></div>
        <div class="rl-controls">
          <div class="field rl-tagpick"><label for="rl-tag">Sensor type</label>
            <select id="rl-tag" class="input" data-action="tag">${keys.map(k => html`<option value="${k}" ${k === key ? raw('selected') : ''}>${TAGS[k].label} · ${counts[k]} machines</option>`)}</select>
          </div>
          ${hot.size ? html`<div class="rl-hot"><span class="small muted">Something is happening on:</span>${[...hot].slice(0, 7).map(([k, why]) => html`<button class="rl-chip" data-action="pick" data-key="${k}" aria-pressed="${k === key}">${TAGS[k].label} <span class="dim">· ${why.slice(0, 2).join(', ')}</span></button>`)}</div>` : ''}
          <div class="rl-slider">
            <div class="row between"><label for="rl-range"><b>${T.label} alarm limit</b> <span class="dim small">${T.dir === 'low' ? `falling is bad: the alarm fires when it drops below the limit` : 'the alarm fires when the reading rises above the limit'}</span></label>
              <button class="btn sm ghost" data-action="reset" ${s.same ? raw('hidden') : ''}>${icon('arrowL')} Back to today's ${fmtV(g, T.alarm)}</button></div>
            <div class="rl-track" style="--f:${iCur / g.n}">
              <input id="rl-range" type="range" min="0" max="${g.n}" step="1" value="${ui.idx[key]}" data-action="limit" aria-valuetext="${fmtV(g, limitValue(T, g, ui.idx[key]))} ${T.unit}" aria-describedby="rl-ends">
              <span class="rl-tick" aria-hidden="true"><span>Today ${fmtV(g, T.alarm)}</span></span>
            </div>
            <div class="row between small dim rl-ends" id="rl-ends"><span>Normal ${fmtV(g, T.normal)} ${T.unit}</span><span>Trip ${fmtV(g, T.trip)} ${T.unit}</span></div>
          </div>
        </div>
        <div data-live="study">${s.html}</div>
      </section>

      <section class="card rl-propose" aria-label="Propose a new limit">
        <div class="card-head">${marker(3)}<h2>Propose this limit</h2><span class="right">${humanChip('A person proposes, people review')}</span></div>
        <div data-live="propose">${proposeHtml(store, key, s)}</div>
        <div class="rl-sign">
          <div class="field"><label for="rlName">Your name <span class="dim">(required, goes into the audit log)</span></label>
            <input id="rlName" class="input" type="text" autocomplete="name" placeholder="e.g. Asha Deshpande, reliability engineer" value="${ui.name || ''}" data-action="rl-name" aria-describedby="rlNameErr">
            <p class="rl-err small" id="rlNameErr" role="alert" hidden></p></div>
          <button class="btn approve" data-action="propose" ${s.same ? raw('disabled') : ''}>${icon('check')} Propose this limit</button>
        </div>
        <p class="rl-moc">${icon('lock')}<span><b>The demo does not change the live model's limits.</b> An alarm limit is a safety setting, so a change goes through ${term('management of change (MOC)', 'A formal review before any change to a plant setting: operations, maintenance and safety check the reason and the impact, approve it, and record who changed what and when. ISA-18.2 requires it for alarm limits.')}: operations, maintenance and safety review the proposal with the measured impact above. The AI only measures the impact; people decide.</span></p>
        <h3 class="rl-h3">Proposals so far</h3>
        ${proposals.length ? html`<ol class="rl-props">${proposals.slice(0, 8).map(r => html`<li><span class="mono small dim">${dt(r.ts)}</span><span><b>${r.actor}</b> · ${r.target}: ${r.detail}</span><span class="pill">${icon('clock')}In MOC review</span></li>`)}</ol>`
          : html`<p class="small muted">None yet. A proposal appears here and in the <a href="#/trust">Trust Audit</a> log with your name and time.</p>`}
      </section>

      <section class="card rl-health ${floodNow ? 'act' : floodDay ? 'watch' : ''}" aria-label="Alarm health">
        <div class="card-head">${marker(4)}<h2>Alarm health</h2>${stateChip(floodNow ? 'act' : floodDay ? 'watch' : 'normal', floodNow ? 'Flood now' : floodDay ? 'Flood in the last 24 h' : 'Calm')}<span class="sub">Nirantar's alerts against ${term('ISA-18.2', `The alarm-management standard for process plants. A flood is more than ${ISA.flood10} alarms in 10 minutes; a manageable load is about ${ISA.perHour} an hour per operator (${ISA.dayOk} a day acceptable, ${ISA.dayMax} at most).`)} targets</span></div>
        <div class="rl-ah">
          <div><div class="rl-ah-k">Alarms in the last 10 minutes</div><div class="rl-ah-v mono ${floodNow ? 'over' : ''}">${ah.last10}<small> / ≤ ${ah.target}</small></div>${meter(ah.last10, 'Last 10 minutes')}</div>
          <div><div class="rl-ah-k">Busiest 10 minutes, last 24 h</div><div class="rl-ah-v mono ${floodDay ? 'over' : ''}">${ah.peak10}<small> / ≤ ${ah.target}</small></div>${meter(ah.peak10, 'Busiest 10 minutes')}</div>
          <div><div class="rl-ah-k">Time in flood, last 24 h</div><div class="rl-ah-v mono">${num(ah.floodPct * 100, 1)}<small> %</small></div><div class="xs dim">of 10-minute windows had more than ${ah.target} alarms (target 0 %)</div></div>
          <div><div class="rl-ah-k">Raised in the last 24 h</div><div class="rl-ah-v mono">${raised24}<small> / ≤ ${ISA.dayOk}</small></div><div class="xs dim">${num(raised24 / 24, 1)} an hour; ISA-18.2: about ${ISA.perHour} an hour per operator, ${ISA.dayMax} a day at most</div></div>
        </div>
        ${Object.keys(groups).length ? Object.entries(groups).map(([rc, list]) => {
          const open = list.filter(al => al.status !== 'CLOSED'), rootA = M.assetById(rc);
          return html`<div class="rl-fold" aria-label="Knock-on alarms grouped under ${rc}">
            <p class="rl-fold-h"><b>${list.length} alarms → 1 decision.</b> ${open.length ? html`Nirantar folded ${plural(list.length, 'knock-on alarm')} under the root cause <a class="mono nw" href="#/machine/${rc}">${rc}</a> (${rootA ? lc(rootA.name) : 'root cause'}), so the operator acts once: fix ${rc} and they clear together.` : html`They were folded under <b>${rc}</b> and closed together when it was repaired.`}</p>
            <div class="rl-fold-viz"><ul class="rl-fold-in">${list.map(al => html`<li class="${al.status === 'CLOSED' ? 'closed' : ''}">${al.assetId}</li>`)}</ul><span class="rl-fold-arrow" aria-hidden="true">${icon('arrowR')}</span><span class="rl-fold-out">${icon('wrench')}<b>${rc}</b><small>1 decision</small></span></div>
          </div>`;
        }) : html`<div class="rl-fold empty"><p class="small"><b>No knock-on alarms right now.</b> When one machine starves the others (a failing coolant pump feeding three lines), every fed machine alarms at once. Nirantar folds those alarms under the root cause so people make one decision, not thirteen.</p><button class="btn sm" data-action="load-sample" data-scenario="pune-flood">${icon('data')} Load the alarm-flood scenario</button></div>`}
        <p class="small muted">Nirantar keeps the count low by alerting on predictions (health below 50 or failure confidence 80 % or more), not on every limit crossing, and by folding knock-on alarms under their root cause. See them ranked on <a href="#/triage">Alert Triage</a>.</p>
      </section>

      <section class="card rl-route" aria-label="Notification routing">
        <div class="card-head"><h2>Who gets which alert</h2><span class="right"><span class="state outline">${icon('info')}Simulated: nothing is sent</span></span></div>
        <div class="table-wrap rl-rt-wrap"><table class="table rl-rt">
          <thead><tr><th scope="col">Alert</th><th scope="col">Goes to</th><th scope="col">How and when</th><th scope="col" class="n">Open now</th></tr></thead>
          <tbody>${ROUTES.map(r => html`<tr class="${r.id === topRoute ? 'hit' : ''}">
            <td><span class="state ${r.tone}">${icon(r.ic)}${r.label}</span></td><td data-label="Goes to"><b>${r.to}</b></td><td class="small" data-label="How">${r.how}</td><td class="n" data-label="Open now">${nRoute(r.id)}</td></tr>`)}</tbody>
        </table></div>
        <h3 class="rl-h3">The message for the top open alert${top ? html`: <a class="mono" href="#/machine/${top.a.id}">${top.a.id}</a>` : ''}</h3>
        ${previewBlock(ctx, top)}
      </section>

      <section class="card rl-shelve" aria-label="Shelving and suppression rules">
        <div class="card-head"><h2>Shelving and suppression rules</h2><span class="sub">read-only: how alarms are kept from piling up</span></div>
        <ul class="rl-rules">
          <li>${humanChip('A person')}<span><b>Shelve:</b> park an alert for 2, 4, 8 or 24 hours with a reason (on Alert Triage). It comes back by itself when the time is up, and the shelving is logged with the name.</span></li>
          <li>${aiChip('Automatic')}<span><b>Suppress knock-ons:</b> an alarm caused by another machine is folded under that root cause at P3 and closes when the root cause is repaired.</span></li>
          <li>${aiChip('Automatic')}<span><b>Sensor faults:</b> a frozen or disagreeing sensor raises an inspection for the instrumentation technician, never a repair crew (SOP-50).</span></li>
          <li>${aiChip('Automatic')}<span><b>Predictions, not crossings:</b> an alert needs health below 50 or failure confidence of 80 % or more; a single limit crossing only shows on the machine's chart.</span></li>
          <li>${humanChip('People')}<span><b>Limit changes:</b> proposed here, decided through management of change. Nirantar measures the impact and never changes a limit itself.</span></li>
        </ul>
        <h3 class="rl-h3">Shelved now</h3>
        ${shelved.length ? html`<ol class="rl-shelved">${shelved.map(al => { const by = shelvedBy(al); return html`<li><a class="mono" href="#/machine/${al.assetId}"><b>${al.assetId}</b></a><span class="small">${al.shelveReason || 'no reason given'}${by ? html` · shelved by <b>${by.actor}</b>` : ''}</span><span class="state normal">${icon('clock')}Back ${dt(al.shelvedUntil)} (in ${nb(hours(Math.max(0, (al.shelvedUntil - now) / HOUR)))})</span></li>`; })}</ol>`
          : html`<p class="small muted">Nothing is shelved. Shelve an alert on <a href="#/triage">Alert Triage</a> (Shelve…) and it appears here with the time it comes back.</p>`}
        <p class="small muted">${(() => { const n = openA.filter(al => al.type === 'CONSEQUENCE').length; return n ? `Suppressed under a root cause right now: ${plural(n, 'knock-on alarm')}.` : 'Nothing is suppressed under a root cause right now.'; })()}</p>
      </section>

      ${nextBack('rules')}
    </div>`);

    // ---- live repaint while the slider moves (keeps the slider element and its focus) ----
    const studyBox = root.querySelector('[data-live="study"]'), propBox = root.querySelector('[data-live="propose"]');
    const range = root.querySelector('#rl-range'), btn = root.querySelector('[data-action="propose"]'), resetBtn = root.querySelector('[data-action="reset"]');
    const repaint = () => {
      const x = studyHtml(ctx, key);
      const open = studyBox.querySelector('details.rl-more')?.open;
      studyBox.innerHTML = String(x.html);
      if (open) studyBox.querySelector('details.rl-more').open = true;
      propBox.innerHTML = String(proposeHtml(store, key, x));
      if (btn) btn.disabled = x.same;
      if (resetBtn) resetBtn.hidden = x.same;
      if (range) range.setAttribute('aria-valuetext', `${fmtV(g, limitValue(T, g, ui.idx[key]))} ${T.unit}`);
    };
    // a clock step skipped while typing or dragging is caught up shortly after focus leaves the field
    // (deferred, so a click on a button that took the focus still lands)
    const onBlur = () => setTimeout(() => {
      const a = document.activeElement;
      if (!ui.pending || !root.isConnected || (a && root.contains(a) && a.matches('input, select, textarea'))) return;
      ui.pending = false; ctx.rerender();
    }, 400);
    root.addEventListener('focusout', onBlur);
    const off = delegate(root, {
      tag: (el, ev) => { if (ev.type !== 'change' || el.value === ui.key) return; ui.key = el.value; ctx.rerender(); root.querySelector('#rl-tag')?.focus(); },
      pick: el => { ui.key = el.dataset.key; ctx.rerender(); },
      limit: el => { const i = +el.value; if (i === ui.idx[key]) return; ui.idx[key] = i; repaint(); },
      reset: () => { ui.idx[key] = iCur; ctx.rerender(); },
      'rl-name': (el, ev) => {
        if (ev.type === 'click') return;
        ui.name = el.value;
        if (el.value.trim()) { el.removeAttribute('aria-invalid'); el.classList.remove('invalid'); const e = root.querySelector('#rlNameErr'); if (e) e.hidden = true; }
      },
      propose: () => {
        const i = ui.idx[key];
        if (i === iCur) return;
        const el = root.querySelector('#rlName'), name = (el?.value || '').trim();
        if (!name) {
          const e = root.querySelector('#rlNameErr');
          if (e) { e.textContent = 'Type your name first: every proposal is signed and goes into the audit log.'; e.hidden = false; }
          if (el) { el.setAttribute('aria-invalid', 'true'); el.classList.remove('invalid'); void el.offsetWidth; el.classList.add('invalid'); el.focus(); }
          return;
        }
        store.prefs.name = name; ui.name = name; S.savePrefs();
        const from = fmtV(g, T.alarm), to = fmtV(g, limitValue(T, g, i));
        S.audit(name, PROPOSE, T.label, `alarm ${from} → ${to} ${T.unit}; goes to management-of-change review`, 'human');
        S.toast({ kind: 'ok', title: 'Proposal logged for review', body: `${T.label}: ${from} → ${to} ${T.unit}, signed by ${name}. The live limits stay as they are until the review approves it.` });
        S.changed('rules');
      },
    }, ['click', 'input', 'change']);
    return () => { off(); root.removeEventListener('focusout', onBlur); };
  },
};
