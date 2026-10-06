// One store for the whole demo: the generated world (rebuilt from scenario + seed), the mutable operations state
// (alerts, work orders, audit trail, copilot log, savings), user preferences and the simulation clock.
// Every action that changes something writes an audit row saying who did it (the AI or a named person).
import { buildWorld, SCENARIOS, FAILURE_MODES, DOCS, roundTo15 } from './generator.js';
import { createModel } from './scoring.js';
import { HOUR, MIN, DAY, dateTime, inr, hours } from './format.js';

const KEY = 'nirantar-demo-v1';
const STEP = 15 * MIN;
const listeners = new Set();

export const store = {
  world: null,
  model: null,
  state: null,
  prefs: loadPrefs(),
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind = 'change', detail) { for (const fn of listeners) { try { fn(kind, detail); } catch (e) { console.error(e); } } },
  get t() { return roundTo15(this.state?.simNow ?? Date.now()); },
  get loaded() { return !!(this.state && this.state.loaded); },
};

function loadPrefs() {
  try { return Object.assign({ theme: 'auto', site: null, welcomed: false, visited: [], name: '', speed: 1, playing: true }, JSON.parse(localStorage.getItem(KEY + ':prefs') || '{}')); }
  catch { return { theme: 'auto', site: null, welcomed: false, visited: [], name: '', speed: 1, playing: true }; }
}
export function savePrefs() { try { localStorage.setItem(KEY + ':prefs', JSON.stringify(store.prefs)); } catch { /* private mode */ } }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!store.state) return;
      const { loaded, scenarioId, seed, anchor, simNow, faults, sensorFaults, alerts, workOrders, audit, guardrail, copilotLog, savings, stock, threshold, seq, feedback } = store.state;
      localStorage.setItem(KEY, JSON.stringify({ v: 1, loaded, scenarioId, seed, anchor, simNow, faults, sensorFaults, alerts, workOrders, audit, guardrail, copilotLog, savings, stock, threshold, seq, feedback }));
    } catch { /* quota or private mode: the demo still works in memory */ }
  }, 300);
}

export function changed(what) { persist(); store.emit('change', what); }

// ---------- boot ----------
export function boot() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
  if (saved && saved.v === 1) {
    if (!saved.loaded) { store.world = null; store.model = null; store.state = { loaded: false }; return; }
    store.world = buildWorld(saved.scenarioId, saved.seed, saved.anchor);
    applyStock(saved.stock);
    store.state = { feedback: {}, ...saved };
    store.model = createModel(store);
    return;
  }
  loadScenario('pune-bearing', 2391, { quiet: true });
}

function applyStock(stock) {
  if (!stock) return;
  for (const p of store.world.parts) if (stock[p.id]) p.stock = { ...stock[p.id] };
}

function freshState(id, seed, anchor) {
  return {
    loaded: true, scenarioId: id, seed, anchor, simNow: anchor,
    faults: store.world.faults.map(f => ({ ...f })), sensorFaults: store.world.sensorFaults.map(s => ({ ...s })),
    alerts: [], workOrders: [], audit: [], guardrail: [], copilotLog: [], savings: [], stock: null, threshold: 0.6, seq: 1000, feedback: {},
  };
}

export function loadScenario(id = 'pune-bearing', seed = 2391, { quiet = false } = {}) {
  const anchor = roundTo15(Date.now());
  store.world = buildWorld(id, seed, anchor);
  store.state = freshState(id, seed, anchor);
  store.model = createModel(store);
  seedHistory();
  detect(store.t, { backfill: true, quiet: true });
  if (!quiet) toast({ kind: 'ok', title: 'Sample data loaded', body: store.world.scenario.name });
  changed('load');
}

// Run fn (synchronously) against a pristine copy of a scenario, then put the live demo back untouched. Used to score
// the copilot's golden questions on fixed reference data, as the live app does with OPS.AGENT_EVAL_SET.
export function withReference(id, seed, fn) {
  const live = { world: store.world, model: store.model, state: store.state };
  try {
    const anchor = live.state && live.state.anchor ? live.state.anchor : roundTo15(Date.now());
    store.world = buildWorld(id, seed, anchor);
    store.state = freshState(id, seed, anchor);
    store.model = createModel(store);
    seedHistory();
    detect(store.t, { backfill: true, quiet: true });
    return fn(store);
  } finally {
    store.world = live.world; store.model = live.model; store.state = live.state;
  }
}

export function clearData() {
  store.state = { loaded: false };
  store.world = null; store.model = null;
  changed('clear');
}

// ---------- helpers ----------
const nextId = (p) => `${p}-${++store.state.seq}`;
export function audit(actor, action, target, detail = '', kind = 'human', ts = store.state.simNow) {
  const A = store.state.audit;
  A.unshift({ ts, actor, action, target, detail, kind });
  if (A.length > 1 && A[1].ts > ts) A.sort((x, y) => y.ts - x.ts);   // backfilled rows can be older: keep newest first
  if (A.length > 400) A.length = 400;
}
export function toast(t) { store.emit('toast', t); }
export const openAlerts = () => (store.state.alerts || []).filter(a => a.status !== 'CLOSED');
export const asset = id => store.model.assetById(id);

// Sample-data history: earlier guardrail refusals and copilot sessions, so the audit pages are not empty on day one.
function seedHistory() {
  const t0 = store.state.anchor;
  const g = [
    ['Approve WO for CNV-201 belt change without a supervisor', 'POL-G8: approval is human-only', 26],
    ['Release crew to BEL-701 for vibration alarm', 'POL-G8 + SOP-50: suspected sensor fault, inspect first', 50],
    ['Change tomorrow\'s shift plan to skip the changeover', 'POL-G8: schedules are changed by people', 80],
  ];
  for (const [req, rule, h] of g) store.state.guardrail.push({ ts: t0 - h * HOUR, request: req, rule, verdict: 'Blocked', sample: true });
  audit('Nirantar AI', 'Scored 48 machines', 'Fleet', 'every 15 minutes; this row is the latest run', 'ai', t0);
}

// ---------- detection: alerts + AI drafts ----------
function riskFor(a, ass) {
  const ex = store.model.exposure(a, ass.mode || null);
  const op = store.model.orderPressure(a.lineId, ass.t);
  const rank = ass.conf * (ex.inr / 1e5) * (1 + op.pressure);
  let prio = 'P3';
  if (ass.state === 'act') prio = ass.conf >= 0.9 && (ex.inr >= 5e5 || (ass.rulH ?? 1e9) < 96) ? 'P1' : 'P2';
  return { ex, op, rank, prio };
}

export function detect(t, { backfill = false, quiet = false } = {}) {
  const M = store.model, S = store.state;
  const cq = store.world.scenario.consequence;
  for (const a of store.world.assets) {
    const ass = M.assess(a, t);
    const open = S.alerts.find(x => x.assetId === a.id && x.status !== 'CLOSED');
    if (open || (ass.state !== 'act' && ass.state !== 'sensor')) continue;
    let createdAt = t;
    if (backfill) {
      for (let h = 1; h <= 96; h++) { const s2 = M.assess(a, t - h * HOUR).state; if (s2 === ass.state) createdAt = t - h * HOUR; else break; }
      createdAt += 17 * MIN;
    }
    const type = ass.state === 'sensor' ? 'SENSOR' : (cq && cq.lines.includes(a.lineId) && ass.worstKey === cq.tag ? 'CONSEQUENCE' : 'FAILURE');
    const { prio } = riskFor(a, ass);
    const al = { id: nextId('AL'), assetId: a.id, type, createdAt, status: 'NEW', priority: type === 'CONSEQUENCE' ? 'P3' : type === 'SENSOR' ? 'P3' : prio,
      mode: ass.mode, rootCause: type === 'CONSEQUENCE' ? cq.from : null, notes: [], woId: null };
    S.alerts.push(al);
    audit('Nirantar AI', type === 'SENSOR' ? 'Flagged a suspected sensor fault' : 'Raised an alert', a.id,
      type === 'SENSOR' ? ass.sensorFault.reason : `${ass.modeName || ass.contributions[0].label + ' out of range'}, health ${ass.health}, failure confidence ${Math.min(99, Math.floor(ass.conf * 100))} %`, 'ai', createdAt);
    if (type === 'FAILURE') draftWO(al, createdAt + 9 * MIN);
    if (type === 'SENSOR') draftInspection(al, createdAt + 6 * MIN);
    if (!quiet) toast({ kind: type === 'SENSOR' ? 'watch' : 'act', title: type === 'SENSOR' ? `Sensor check needed: ${a.id}` : `New alert: ${a.id}`,
      body: type === 'SENSOR' ? 'A sensor looks frozen. Nirantar will not send a repair crew.' : `${ass.modeName || 'Abnormal readings'} · health ${ass.health}`, href: '#/triage' });
  }
}

const SKILL_FOR = { 'FM-01': ['spindle', 'bearing'], 'FM-02': ['cnc'], 'FM-03': ['drives', 'mills'], 'FM-04': ['alignment', 'gearbox'], 'FM-05': ['balancing', 'fans'],
  'FM-06': ['hydraulics', 'press'], 'FM-07': ['pumps', 'utilities'], 'FM-08': ['furnace', 'electrical'], 'FM-09': ['electrical', 'drives'] };
const STEPS = {
  'FM-01': ['Lock out and tag out the machine (LOTO), verify zero energy', 'Remove the spindle cartridge; press out the bearing set', 'Fit the new matched bearing set, preload 0.6 kN (SOP-17)', 'Run in 20 min at 30 % speed', 'Release only if vibration < 2.3 mm/s (ISO zone A)'],
  'FM-04': ['LOTO the press drive', 'Laser-align motor to gearbox (SOP-24), tolerance 0.05 mm', 'Replace the coupling element and shims', 'Run at no load, check 2X vibration has dropped'],
  'FM-05': ['Reduce kiln draught and LOTO the fan', 'Clean clinker build-up from the blades', 'Two-plane field balance (SOP-25) until 1X < 2.8 mm/s', 'Restore draught gradually'],
  'FM-07': ['Switch over to the standby pump CLP-102', 'LOTO the duty pump', 'Clean the suction strainer, check sump level', 'Replace impeller and mechanical seal (SOP-12)'],
  'FM-06': ['LOTO, release stored hydraulic pressure', 'Locate the leak, replace the seal kit (SOP-31)', 'Refill and bleed, pressure test to 210 bar'],
};

// Steps for a failure mode; the cavitation steps name this plant's standby pump (CLP-102 in Pune), not a fixed one.
function stepsFor(a, mode) {
  const st = STEPS[mode]; if (!st) return null;
  if (mode !== 'FM-07') return st;
  const standby = store.world.assets.find(x => x.siteId === a.siteId && x.id !== a.id && x.cls === 'pump' && /standby/i.test(x.name));
  return st.map(s => s.replace('the standby pump CLP-102', standby ? `the standby pump ${standby.id}` : 'a standby pump (or reduce load)'));
}

function pickTech(a, mode) {
  const want = SKILL_FOR[mode] || [];
  const local = store.world.technicians.filter(t => t.siteId === a.siteId);
  const best = local.map(t => ({ t, score: t.skills.filter(s => want.includes(s)).length })).sort((x, y) => y.score - x.score)[0];
  return best ? { id: best.t.id, name: best.t.name, why: best.score ? `certified for ${best.t.skills.filter(s => want.includes(s)).join(' and ')} work` : 'available on site', shift: best.t.shift } : null;
}

function draftWO(al, at) {
  const M = store.model, a = asset(al.assetId);
  const ass = M.assess(a, store.t);
  const fm = FAILURE_MODES[al.mode] || FAILURE_MODES['FM-01'];
  const plan = M.partPlan(a, al.mode);
  const cost = M.plannedCost(a, al.mode);
  const readyIfNow = store.state.simNow + (plan ? plan.etaH : 0) * HOUR + HOUR;
  const win = M.planWindow(readyIfNow, ass.failAt, Math.max(4, Math.ceil(fm.repairH + 2)));
  const wo = {
    id: 'WO-PDM-' + (400 + store.state.workOrders.length + 12), assetId: a.id, alertId: al.id, kind: 'REPAIR', mode: al.mode,
    title: `${fm.name}: ${a.name} ${a.id}`, status: 'PENDING_APPROVAL', createdAt: at, createdBy: 'Nirantar AI',
    steps: stepsFor(a, al.mode) || ['LOTO the machine', `Follow ${fm.sop}`, 'Test run and release'], sop: fm.sop,
    part: plan ? { id: plan.part.id, name: plan.part.name, qty: 1, from: plan.from, etaH: plan.etaH, kind: plan.kind } : null,
    technician: pickTech(a, al.mode), proposedWindow: win, window: null, eta: null, costs: cost,
    confidence: plan && plan.kind !== 'purchase' && win.beforeFailure ? 0.95 : 0.7, approvals: [],
  };
  store.state.workOrders.unshift(wo);
  al.woId = wo.id;
  audit('Nirantar AI', 'Drafted a work order', a.id, `${wo.id}: ${fm.name}, ${wo.steps.length} steps from ${fm.sop}`, 'ai', at);
  if (plan) audit('Nirantar AI', 'Checked spares', plan.part.id, plan.kind === 'local' ? `${plan.part.name}: in stock at ${store.model.siteById(a.siteId).city}` : plan.kind === 'transfer' ? `${plan.part.name}: none at ${store.model.siteById(a.siteId).city}; ${plan.qty} at ${store.model.siteById(plan.from).city} (transfer ${plan.etaH} h)` : `${plan.part.name}: none in stock; supplier lead time ${plan.part.leadDays} days`, 'ai', at + MIN);
  audit('Nirantar AI', 'Proposed a repair window', a.id, `${dateTime(win.start)}, ${win.reason}${win.beforeFailure ? '' : ' (after the predicted failure: expedite the part)'}`, 'ai', at + 2 * MIN);
  return wo;
}

function draftInspection(al, at) {
  const a = asset(al.assetId);
  const tech = store.world.technicians.find(t => t.siteId === a.siteId && t.skills.includes('instrumentation')) || store.world.technicians.find(t => t.siteId === a.siteId);
  const wo = { id: 'WO-INS-' + (700 + store.state.workOrders.length), assetId: a.id, alertId: al.id, kind: 'INSPECT', mode: null,
    title: `Inspect sensor: ${a.id}`, status: 'PENDING_APPROVAL', createdAt: at, createdBy: 'Nirantar AI',
    steps: ['Do not stop the machine; it is running normally', 'Check the accelerometer cable and mounting', 'Compare with a handheld vibration meter', 'Replace the sensor if the readings differ (SP-090)'], sop: 'SOP-50',
    part: { id: 'SP-090', name: 'Vibration sensor (accelerometer)', qty: 1, from: a.siteId, etaH: 0, kind: 'local' },
    technician: tech ? { id: tech.id, name: tech.name, why: 'instrumentation', shift: tech.shift } : null,
    proposedWindow: { start: store.state.simNow + 2 * HOUR, end: store.state.simNow + 3 * HOUR, reason: 'no production stop needed', beforeFailure: true },
    window: null, eta: null, costs: { parts: 0, labour: 1600, total: 1600 }, confidence: 0.9, approvals: [] };
  store.state.workOrders.unshift(wo);
  al.woId = wo.id;
  audit('Nirantar AI', 'Created a sensor inspection (no repair crew)', a.id, `${wo.id} per SOP-50`, 'ai', at);
}


// ---------- attention score (one fleet ranking with a reason, Senseye-style bands) ----------
export const ATTENTION_BANDS = [[0.75, 'High', 'act'], [0.5, 'Medium', 'act'], [0.25, 'Low', 'watch'], [0, 'Normal', 'normal']];
export function attention(a, ass = store.model.assess(a, store.t)) {
  const M = store.model;
  const critW = { A: 1, B: 0.75, C: 0.5 }[a.criticality] || 0.75;
  const ex = M.exposure(a, ass.mode || null);
  const money = Math.min(1, ex.inr / 2e6);
  const op = M.orderPressure(a.lineId, ass.t);
  const fb = (store.state.feedback || {})[a.id] || 0;
  let s = ass.conf * (0.55 + 0.45 * critW) * (0.6 + 0.4 * money) * (0.85 + 0.15 * op.pressure) * (fb > 0 ? 1.1 : fb < 0 ? 0.7 : 1);
  if (ass.state === 'act') s = Math.max(s, 0.5);
  if (ass.state === 'watch' || ass.state === 'sensor') s = Math.max(s, 0.25);
  const conseq = (store.state.alerts || []).find(x => x.assetId === a.id && x.status !== 'CLOSED' && x.type === 'CONSEQUENCE');
  if (conseq) s = Math.min(s, 0.4);
  s = Math.min(0.99, s);
  const band = ATTENTION_BANDS.find(b => s >= b[0]);
  const why = [];
  if (conseq) why.push(`caused upstream by ${conseq.rootCause}: fix that first`);
  else if (ass.state === 'sensor') why.push('sensor looks frozen: inspect, do not repair');
  else if (ass.conf >= 0.15) why.push(`${Math.min(99, Math.floor(ass.conf * 100))} % failure confidence${ass.modeName ? ' (' + ass.modeName.toLowerCase() + ')' : ''}`);
  else why.push('all sensors normal');
  why.push(`criticality ${a.criticality}`);
  if (ass.state !== 'normal' && ex.inr > 0) why.push(`${inr(ex.inr)} at stake`);
  if (op.order && op.pressure > 0.3 && ass.state !== 'normal') why.push(`${op.order.customer} order due ${new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(op.order.due)}`);
  if (fb) why.push(fb > 0 ? 'you marked the last alert useful' : 'you marked the last alert not useful');
  return { score: s, band: band[1], tone: band[2], why: why.join(' · '), exposure: ex, order: op };
}
export function feedback(alertId, useful, name = store.prefs.name || 'You') {
  const al = store.state.alerts.find(x => x.id === alertId); if (!al) return;
  store.state.feedback = store.state.feedback || {};
  store.state.feedback[al.assetId] = useful ? 1 : -1;
  al.feedback = useful ? 'useful' : 'not useful';
  audit(name, useful ? 'Marked the alert useful' : 'Marked the alert not useful', al.assetId, useful ? 'ranks similar alerts slightly higher' : 'ranks similar alerts lower until the evidence grows', 'human');
  toast({ kind: 'ai', title: 'Thanks, Nirantar learns from this', body: useful ? `${al.assetId}: similar alerts will rank a little higher.` : `${al.assetId}: similar alerts will rank lower unless the evidence grows.` });
  changed('feedback');
}
// alarm-flood KPI (ISA-18.2 practice: > 10 alarms in 10 minutes is a flood)
export function alarmHealth() {
  const t = store.state.simNow, al = store.state.alerts || [];
  const last10 = al.filter(a => a.createdAt > t - 10 * MIN && a.createdAt <= t).length;
  let flood = 0, windows = 0;
  for (let w = t - DAY; w < t; w += 10 * MIN) { windows++; if (al.filter(a => a.createdAt > w && a.createdAt <= w + 10 * MIN).length > 10) flood++; }
  const peak = Math.max(0, ...Array.from({ length: 144 }, (_, i) => al.filter(a => a.createdAt > t - DAY + i * 10 * MIN && a.createdAt <= t - DAY + (i + 1) * 10 * MIN).length));
  return { last10, peak10: peak, floodPct: flood / windows, target: 10 };
}

// ---------- user actions ----------
export function acknowledge(alertId, name = store.prefs.name || 'You') {
  const al = store.state.alerts.find(x => x.id === alertId); if (!al) return;
  al.status = 'ACK'; al.ackBy = name; al.ackAt = store.state.simNow;
  audit(name, 'Acknowledged the alert', al.assetId, al.id);
  toast({ kind: 'ok', title: `Acknowledged ${al.assetId}`, body: `Logged at ${dateTime(store.state.simNow)}. Next: decide when to repair.`, href: `#/whatif/${al.assetId}` });
  changed('alert');
}
export function shelve(alertId, hrs = 4, reason = 'Known issue, repair planned', name = store.prefs.name || 'You') {
  const al = store.state.alerts.find(x => x.id === alertId); if (!al) return;
  al.status = 'SHELVED'; al.shelvedUntil = store.state.simNow + hrs * HOUR; al.shelveReason = reason;
  audit(name, `Shelved the alert for ${hrs} h`, al.assetId, reason);
  toast({ kind: 'watch', title: `Shelved ${al.assetId} for ${hrs} h`, body: 'It comes back automatically if the risk rises.' });
  changed('alert');
}
export function escalate(alertId, name = store.prefs.name || 'You') {
  const al = store.state.alerts.find(x => x.id === alertId); if (!al) return;
  al.status = 'ESCALATED'; al.priority = 'P1'; al.escalatedBy = name; al.escalatedAt = store.state.simNow;
  audit(name, 'Escalated to the plant head', al.assetId, 'with the evidence pack');
  toast({ kind: 'act', title: `Escalated ${al.assetId}`, body: 'The plant head gets the evidence pack (simulated).' });
  changed('alert');
}
export function aiDraft(alertId) {
  const al = store.state.alerts.find(x => x.id === alertId); if (!al || al.woId) return;
  const wo = al.type === 'SENSOR' ? draftInspection(al, store.state.simNow) : draftWO(al, store.state.simNow);
  toast({ kind: 'ai', title: 'Work order drafted', body: `${wo.id} is waiting for your approval.`, href: '#/orders' });
  changed('wo');
}

export function approve(woId, name, comment = '') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo || !name) return false;
  const M = store.model, a = asset(wo.assetId);
  const ass = M.assess(a, store.t);
  wo.status = 'APPROVED';
  wo.approvals.push({ by: name, at: store.state.simNow, action: 'Approved', comment });
  if (wo.part && wo.part.kind !== 'local') {
    wo.eta = store.state.simNow + wo.part.etaH * HOUR;
    const st = store.world.parts.find(p => p.id === wo.part.id);
    if (st && wo.part.kind === 'transfer') { st.stock[wo.part.from] = Math.max(0, (st.stock[wo.part.from] || 0) - 1); saveStock(); }
  } else wo.eta = store.state.simNow;
  const dur = wo.kind === 'INSPECT' ? 1 : Math.max(4, Math.ceil((FAILURE_MODES[wo.mode]?.repairH || 2) + 2));
  wo.window = wo.kind === 'INSPECT' ? { start: store.state.simNow + 2 * HOUR, end: store.state.simNow + 3 * HOUR, reason: 'no production stop needed', beforeFailure: true }
    : M.planWindow(wo.eta + HOUR, ass.failAt, dur);
  wo.status = 'SCHEDULED';
  const al = store.state.alerts.find(x => x.id === wo.alertId); if (al && al.status === 'NEW') { al.status = 'ACK'; al.ackBy = name; al.ackAt = store.state.simNow; }
  audit(name, 'Approved the work order', wo.assetId, `${wo.id}${comment ? ': ' + comment : ''}`);
  if (wo.part && wo.part.kind === 'transfer') audit('System', 'Released a stock transfer', wo.part.id, `${wo.part.name}: ${M.siteById(wo.part.from).city} → ${M.siteById(a.siteId).city}, arrives ${dateTime(wo.eta)}`, 'system');
  audit('System', 'Scheduled the repair', wo.assetId, `${dateTime(wo.window.start)} to ${dateTime(wo.window.end)} · ${wo.technician ? wo.technician.name : ''}`, 'system');
  toast({ kind: 'ok', title: `Approved ${wo.id}`, body: `Logged with your name at ${dateTime(store.state.simNow)}. Repair planned ${dateTime(wo.window.start)}.`, href: '#/copilot' });
  changed('wo');
  return true;
}
function saveStock() { store.state.stock = Object.fromEntries(store.world.parts.map(p => [p.id, p.stock])); }

export function reject(woId, name, reason = '') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo || !name) return false;
  wo.status = 'REJECTED'; wo.approvals.push({ by: name, at: store.state.simNow, action: 'Rejected', comment: reason });
  audit(name, 'Rejected the work order', wo.assetId, `${wo.id}${reason ? ': ' + reason : ''}`);
  toast({ kind: 'watch', title: `Rejected ${wo.id}`, body: 'Nirantar keeps watching and will alert again if the risk rises.' });
  changed('wo');
  return true;
}
export function startWork(woId, name = store.prefs.name || 'You') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo) return;
  wo.status = 'IN_PROGRESS'; wo.startedAt = store.state.simNow;
  audit(name, wo.kind === 'INSPECT' ? 'Started the sensor check' : wo.kind === 'PM' ? 'Started the preventive job' : 'Started the repair', wo.assetId, wo.id);
  changed('wo');
}
export function complete(woId, name = store.prefs.name || 'You') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo) return;
  const M = store.model, a = asset(wo.assetId);
  wo.status = 'DONE'; wo.doneAt = store.state.simNow;
  if (wo.kind === 'PM') {
    audit(name, 'Completed preventive maintenance', wo.assetId, `${wo.id}${wo.bundleWith ? ' (in the same stop as ' + wo.bundleWith + ')' : ''}`);
    toast({ kind: 'ok', title: `${wo.assetId} preventive job done`, body: 'Next due date moved forward on the maintenance calendar.', href: '#/schedule' });
    changed('wo');
    return;
  }
  if (wo.kind === 'INSPECT') {
    store.state.sensorFaults = store.state.sensorFaults.filter(s => s.asset !== wo.assetId);
    audit(name, 'Replaced the sensor', wo.assetId, `${wo.id}: readings live again`);
  } else {
    const f = store.state.faults.find(x => x.asset === wo.assetId && !x.repairedAt);
    const ex = M.exposure(a, wo.mode);
    if (f) f.repairedAt = store.t;   // model time steps are 15 min; stamp on the current step so health recovers at once
    const avoided = ex.inr;
    store.state.savings.push({ woId: wo.id, assetId: a.id, at: store.state.simNow, avoidedInr: avoided, plannedInr: wo.costs.total, hoursSaved: Math.max(0, ex.downH - 4) });
    audit(name, 'Completed the repair', wo.assetId, `${wo.id}: unplanned stop avoided (${inr(avoided)} at stake, ${hours(ex.downH)} of downtime)`);
  }
  M.clearMemo();
  for (const al of store.state.alerts) if (al.assetId === wo.assetId && al.status !== 'CLOSED') { al.status = 'CLOSED'; al.closedAt = store.state.simNow; }
  if (wo.kind !== 'INSPECT' && store.world.scenario.consequence && store.world.scenario.consequence.from === wo.assetId)
    for (const al of store.state.alerts) if (al.rootCause === wo.assetId && al.status !== 'CLOSED') { al.status = 'CLOSED'; al.closedAt = store.state.simNow; }
  toast({ kind: 'ok', title: `${wo.assetId} is back to normal`, body: 'The alert is closed and the saving is counted on the OEE page.', href: '#/oee' });
  changed('wo');
}

// ---------- preventive maintenance + technician job card ----------
// PM interval by machine class (days). Last PM comes from the CMMS history; overdue jobs are real findings.
export const PM_INTERVAL = { cnc: 90, rotating: 120, pump: 90, compressor: 90, press: 90, thermal: 180, aux: 180 };
const PM_STEPS = {
  cnc: ['Clean and inspect way covers and chip conveyor', 'Check spindle run-out and drawbar force', 'Change coolant filter; top up way lube', 'Check axis backlash and record'],
  rotating: ['Check belt or coupling condition', 'Grease bearings (record grams)', 'Check foundation bolts and guards', 'Record vibration with a handheld meter'],
  pump: ['Check mechanical seal for weeping', 'Clean suction strainer', 'Grease motor bearings', 'Record discharge pressure'],
  compressor: ['Change intake filter', 'Drain condensate; check auto-drain', 'Check belt tension', 'Record outlet temperature'],
  press: ['Check hydraulic oil level and filter indicator', 'Inspect cylinder seals for leaks', 'Check die-clamp pressure', 'Record oil temperature'],
  thermal: ['Inspect heater elements and terminals (thermal camera)', 'Check thermocouples against a reference', 'Inspect door seals and refractory'],
  aux: ['Clean and inspect', 'Check safety interlocks', 'Lubricate moving parts'],
};
// One row per machine: last PM, interval, next due, days to due (negative = overdue), and any scheduled PM work order.
export function pmPlan(t = store.state.simNow) {
  const W = store.world;
  return W.assets.map(a => {
    const done = (store.state.workOrders || []).filter(w => w.kind === 'PM' && w.assetId === a.id && w.status === 'DONE').map(w => w.doneAt);
    const hist = W.history.filter(h => h.assetId === a.id && h.type === 'PM').map(h => h.date);
    const last = Math.max(0, ...hist, ...done);
    const interval = PM_INTERVAL[a.cls] || 90;
    const due = last + interval * DAY;
    const sched = (store.state.workOrders || []).find(w => w.kind === 'PM' && w.assetId === a.id && w.status !== 'DONE' && w.status !== 'REJECTED') || null;
    return { assetId: a.id, lineId: a.lineId, siteId: a.siteId, cls: a.cls, last, interval, due, daysToDue: (due - t) / DAY, overdue: due < t, scheduled: sched };
  });
}
// A person schedules preventive maintenance (often "bundled" into a stop that is happening anyway).
export function schedulePM(assetId, { start, durH = 2, reason = 'planned window', bundleWith = null, techId = null } = {}, name = store.prefs.name || 'You') {
  const a = asset(assetId); if (!a || !name) return null;
  const local = store.world.technicians.filter(x => x.siteId === a.siteId);
  // a technician who is free for the whole slot (a bundled job runs at the same time as the repair, so not the repair crew)
  const end = start + durH * HOUR;
  const busy = new Set(store.state.workOrders.filter(w => w.technician && !['DONE', 'REJECTED'].includes(w.status))
    .filter(w => { const win = w.window || w.proposedWindow; return win && win.start < end && win.end > start; }).map(w => w.technician.id));
  const rot = [...local.slice((a.idx + 1) % local.length), ...local.slice(0, (a.idx + 1) % local.length)];
  const tech = local.find(x => x.id === techId) || rot.find(x => !busy.has(x.id)) || rot[0];
  const wo = { id: 'WO-PM-' + (900 + store.state.workOrders.length), assetId, alertId: null, kind: 'PM', mode: null,
    title: `Preventive maintenance: ${a.name} ${a.id}`, status: 'SCHEDULED', createdAt: store.state.simNow, createdBy: name,
    steps: PM_STEPS[a.cls] || PM_STEPS.aux, sop: 'PM checklist', part: null,
    technician: tech ? { id: tech.id, name: tech.name, why: busy.has(tech.id) ? 'on the site roster (busy at that time: check the load)' : 'free for that slot', shift: tech.shift } : null,
    proposedWindow: { start, end, reason, beforeFailure: true }, window: { start, end, reason, beforeFailure: true },
    eta: store.state.simNow, costs: { parts: 0, labour: Math.round(durH * 800), total: Math.round(durH * 800) }, confidence: null,
    approvals: [{ by: name, at: store.state.simNow, action: 'Scheduled', comment: bundleWith ? `bundled with ${bundleWith}` : '' }], bundleWith };
  store.state.workOrders.unshift(wo);
  audit(name, bundleWith ? 'Bundled preventive maintenance into a planned stop' : 'Scheduled preventive maintenance', assetId,
    `${wo.id}: ${dateTime(start)}, ${durH} h${bundleWith ? `, same stop as ${bundleWith}` : ''}`);
  toast({ kind: 'ok', title: `Scheduled ${wo.id}`, body: `${assetId} preventive job ${dateTime(start)}${bundleWith ? ' (no extra line stop)' : ''}.`, href: '#/schedule' });
  changed('wo');
  return wo;
}
// Technician job card: tick steps (safety steps are logged), record the release reading, add notes.
export function toggleCheck(woId, key, name = store.prefs.name || 'Technician') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo) return;
  wo.checks = wo.checks || {};
  if (wo.checks[key]) delete wo.checks[key];
  else {
    wo.checks[key] = { by: name, at: store.state.simNow };
    if (key === 'loto') audit(name, 'Confirmed lock-out / tag-out', wo.assetId, `${wo.id}: zero energy verified`);
    else if (key === 'safety') audit(name, 'Confirmed the safe-work check', wo.assetId, `${wo.id}: machine kept running, work outside the guards only (SOP-50)`);
    else if (key.startsWith('step-')) audit(name, 'Completed a job step', wo.assetId, `${wo.id} step ${+key.slice(5) + 1}: ${wo.steps[+key.slice(5)] || ''}`);
  }
  changed('wo');
}
export function recordReading(woId, value, name = store.prefs.name || 'Technician') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo || !isFinite(value)) return null;
  const limit = 2.3;   // ISO 10816 zone A: release only when vibration is back to "new machine" level (SOP-17)
  wo.afterReading = { v: +value, by: name, at: store.state.simNow, limit, pass: +value <= limit };
  audit(name, wo.afterReading.pass ? 'Recorded a passing release reading' : 'Recorded a failing release reading', wo.assetId, `${wo.id}: vibration ${value} mm/s (release limit ${limit})`);
  changed('wo');
  return wo.afterReading;
}
export function addNote(woId, text, name = store.prefs.name || 'Technician') {
  const wo = store.state.workOrders.find(w => w.id === woId); if (!wo || !String(text).trim()) return;
  wo.notes = wo.notes || [];
  wo.notes.push({ by: name, at: store.state.simNow, text: String(text).trim().slice(0, 500) });
  audit(name, 'Added a job note', wo.assetId, `${wo.id}: ${String(text).trim().slice(0, 80)}`);
  changed('wo');
}

// ---------- presenter ----------
export function injectFault(assetId, mode = 'FM-01', failH = 40) {
  const a = asset(assetId); if (!a) return;
  const eff = { 'FM-01': { VIB_RMS: 9.6, VIB_PEAK: 11.4, BEARING_TEMP: 35, MOTOR_CURRENT: 8 }, 'FM-05': { VIB_RMS: 9, VIB_PEAK: 12 }, 'FM-04': { VIB_RMS: 9, BEARING_TEMP: 12 },
    'FM-07': { DISCH_PRESS: -3.5, VIB_RMS: 5 }, 'FM-09': { MOTOR_CURRENT: 30, BEARING_TEMP: 30 } }[mode] || { VIB_RMS: 9 };
  const effects = Object.fromEntries(Object.entries(eff).filter(([k]) => a.tags.some(t => t.key === k)));
  store.state.faults.push({ asset: assetId, mode, onset: store.state.simNow - 30 * HOUR, failAt: store.state.simNow + failH * HOUR, effects, repairedAt: null, injected: true });
  store.model.clearMemo();
  audit(store.prefs.name || 'Presenter', 'Injected a demo fault', assetId, FAILURE_MODES[mode].name, 'system');
  detect(store.t);
  changed('inject');
}
export function injectSensorFault(assetId, tag = 'VIB_RMS') {
  store.state.sensorFaults.push({ asset: assetId, tag, start: store.state.simNow - 6 * HOUR, kind: 'flatline', injected: true });
  store.model.clearMemo();
  audit(store.prefs.name || 'Presenter', 'Injected a demo sensor fault', assetId, `${tag} frozen`, 'system');
  detect(store.t);
  changed('inject');
}

// ---------- copilot + guardrail log ----------
export function logCopilot(entry) {
  store.state.copilotLog.push({ ...entry, ts: store.state.simNow });
  if (entry.blocked) {
    store.state.guardrail.unshift({ ts: store.state.simNow, request: entry.q, rule: entry.rule || 'POL-G8: approval is human-only', verdict: 'Blocked' });
    audit('Nirantar AI', 'Refused an unsafe request', 'Copilot', entry.q, 'blocked');
  }
  changed('copilot');
}
export function setThreshold(th) { store.state.threshold = th; changed('threshold'); }

// ---------- simulation clock ----------
export function advance(ms) {
  if (!store.loaded) return;
  const before = store.t;
  store.state.simNow += ms;
  const after = store.t;
  if (after !== before) {
    // re-check shelved alerts and part arrivals each 15-min step
    for (const al of store.state.alerts) if (al.status === 'SHELVED' && store.state.simNow >= al.shelvedUntil) { al.status = 'NEW'; audit('System', 'Shelving expired', al.assetId, al.id, 'system'); }
    for (const wo of store.state.workOrders) if (wo.status === 'SCHEDULED' && wo.eta && !wo.partArrived && store.state.simNow >= wo.eta) {
      wo.partArrived = true;
      if (wo.part && wo.part.kind !== 'local') { audit('System', 'Part arrived', wo.part.id, `${wo.part.name} at ${store.model.siteById(asset(wo.assetId).siteId).city}`, 'system'); toast({ kind: 'ok', title: 'Part arrived', body: `${wo.part.name} for ${wo.assetId}` }); }
    }
    detect(after);
    changed('tick');
  } else store.emit('clock');
}
export function jumpTo(ms) { advance(ms - store.state.simNow); }
export { STEP, HOUR, DAY, SCENARIOS, DOCS };
