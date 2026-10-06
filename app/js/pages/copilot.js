// Step 6 · Ask why: Ask Copilot. "Why is it failing, and will the AI break the rules?"
//
// In the live product the copilot is a Snowflake Cortex Agent (Cortex Analyst on the semantic view SV_PLANT_OPS,
// Cortex Search over the maintenance documents, plus custom tools such as ASSET_360 and CHECK_SPARES). This public
// demo has no backend and no LLM, so answer() below is a deterministic, rule-based engine: it detects the intent,
// reads the same demo data every other page reads, cites its sources, lists the tools the live agent would call,
// and enforces the human-approval guardrail (POL-G8, and SOP-50 for crews sent to a frozen sensor).
// answer() is pure (no DOM, no store mutation), so the Trust Audit page and Node tests can evaluate it (GOLDEN).
import { html, raw, icon, delegate, esc } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, aiChip, humanChip, nextBack, confPct } from '../ui/components.js';
import { inr, pct, num, hours, dateTime, weekday, day, time, HOUR, DAY } from '../core/format.js';
import { FAILURE_MODES, DOCS, TRANSFER_H } from '../core/generator.js';
import { attention, pmPlan } from '../core/store.js';

// ---------------------------------------------------------------------------------------------------------------
// Engine vocabulary: tools, sources, failure-mode words
// ---------------------------------------------------------------------------------------------------------------
export const TOOL_INFO = {
  asset_360: 'One machine: health, failure confidence, time to failure, sensors and history (ASSET_360)',
  plant_ops_analyst: 'Cortex Analyst on the semantic view SV_PLANT_OPS: OEE, losses, MTBF and MTTR, energy, orders',
  maint_knowledge_search: 'Cortex Search over manuals, SOPs, technician notes and quality notes (CSS_MAINT_KNOWLEDGE)',
  check_spares: 'Stock of a part at every plant, transfer times and supplier lead time (CHECK_SPARES)',
  propose_window: 'Low-impact repair slots before the predicted failure (PROPOSE_WINDOW)',
  what_if_defer: 'Chance of failure and expected loss if a repair waits (WHAT_IF_DEFER)',
  guardrail_policy: 'Checks every request against policy POL-G8 and SOP-50 before anything else',
};
const TABLES = {
  'ML.V_LATEST_PRED': 'Latest model scores: health, failure confidence, time to failure',
  'RAW.TELEMETRY': 'Sensor readings, last 72 hours',
  'CMMS.WORK_ORDERS': 'Maintenance history, last 120 days',
  'SV_PLANT_OPS.OEE': 'OEE by line, day and shift (semantic view)',
  'SV_PLANT_OPS.ENERGY': 'Power drawn against each machine\'s healthy baseline',
  'ERP.SPARES': 'Spare-part stock at the three plants',
  'ERP.SALES_ORDERS': 'Customer orders and late-delivery penalties',
  'APP.ALERTS': 'Open alerts with attention scores',
  'APP.WORK_ORDERS': 'Drafted and approved work orders',
  'CORE.FACT_TELEMETRY_15M': '15-minute sensor features for every machine',
  'ML.BACKTEST': 'Back-test of the model on 43 past failures',
};
const HISTORY_DAYS = 120;          // the CMMS history covers the last 120 days
const RS_PER_KWH = 8;              // tariff used for energy waste
const RUN_H_PER_DAY = 20;          // planned production hours per day (same as the OEE data)
const LOSS = { breakdown: 'breakdowns', setup: 'setup and changeovers', smallStops: 'small stops', speed: 'reduced speed', startupRejects: 'start-up rejects', prodRejects: 'production rejects', planned: 'planned maintenance' };
const MODE_HI = { 'FM-01': 'bearing ghis raha hai', 'FM-02': 'tool insert ghis gaya hai', 'FM-03': 'belt ghis rahi hai', 'FM-04': 'shaft alignment bigad gaya hai', 'FM-05': 'rotor imbalance hai', 'FM-06': 'hydraulic leak hai', 'FM-07': 'pump mein cavitation hai', 'FM-08': 'heater element kharab ho raha hai', 'FM-09': 'motor overload ho raha hai' };
const SPECTRUM_SIGN = {
  'FM-01': bf => `The vibration spectrum shows peaks at the bearing outer-race defect frequency (BPFO, about ${Math.round(bf.BPFO).toLocaleString('en-IN')} Hz), the signature the manual describes for bearing damage.`,
  'FM-04': () => 'The vibration spectrum shows a strong 2X peak (twice running speed), the classic misalignment signature.',
  'FM-05': () => 'The vibration spectrum is dominated by the 1X peak (once per turn), the classic imbalance signature.',
  'FM-07': () => 'The vibration spectrum has a raised broadband noise floor, typical of cavitation.',
};
const PART_NOUN = { 'FM-01': 'bearing', 'FM-02': 'carbide inserts', 'FM-03': 'drive belt', 'FM-04': 'coupling kit', 'FM-05': 'balancing weight kit', 'FM-06': 'hydraulic seal kit', 'FM-07': 'pump impeller', 'FM-08': 'heater element bank', 'FM-09': 'motor rewind kit' };

// ---------------------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------------------
const norm = s => String(s ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const lc = s => (/^[A-Z][a-z]/.test(s || '') ? s.charAt(0).toLowerCase() + s.slice(1) : (s || ''));   // keep acronyms: "CNC lathe"
const cap = s => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
const listJoin = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
const fmtTag = (tag, v) => num(v, tag.d);
const daysAgo = (ms, now) => Math.max(0, Math.round((now - ms) / DAY));
const pct1 = v => pct(v, 1);
const hh = h => (Number.isInteger(h) ? `${h} h` : hours(h));                       // "2 h", not "2.0 h"
const reasonText = r => String(r || '').replace(/\s*\(([^)]*)\)/g, ', $1');        // "shift changeover, low-impact"
const sopName = id => { const d = DOCS.find(x => x.id === id); return d ? `**${id}**, ${lc(d.title.replace(/^SOP-\d+\s*/, ''))}` : `**${id}**`; };
// how a signal changed over three days, in words that suit its direction
function changeText(tag, past, now) {
  if (tag.dir === 'low') return `has fallen from ${fmtTag(tag, past)} to ${fmtTag(tag, now)} ${tag.unit} in three days (${Math.round((1 - now / past) * 100)} % lower)`;
  if (tag.unit === '°C') return `is up ${num(now - past, 1)} °C in three days (${fmtTag(tag, past)} → ${fmtTag(tag, now)} °C)`;
  const ratio = now / past;
  return ratio >= 1.5 ? `is **${ratio.toFixed(1)}×** its level three days ago (${fmtTag(tag, past)} → ${fmtTag(tag, now)} ${tag.unit})` : `is up ${Math.round((ratio - 1) * 100)} % in three days (${fmtTag(tag, past)} → ${fmtTag(tag, now)} ${tag.unit})`;
}
// where a planned window sits against the predicted failure (median) and the earliest likely failure (80 % range)
function windowVsFailure(win, early, failAt) {
  if (win.start + 2 * HOUR <= early) return 'before the earliest likely failure';
  if (win.start + 2 * HOUR <= failAt) return `before the predicted failure (${dateTime(failAt)}) but after the earliest likely one (${dateTime(early)}), so some risk remains until then; expediting the part would cut it`;
  return 'after the predicted failure: expedite the part or find an earlier slot';
}

/** Strip the **bold** markers (for plain-text consumers such as the audit log). */
export const plainText = text => String(text || '').replace(/\*\*/g, '');

/** Render the engine's text: blank line = new paragraph, lines starting "- " = bullets, **bold**. Returns Raw. */
export function renderText(text) {
  // keep numbers with their units, and "5 · Work Orders" together, so a phone never breaks "66 / h"
  const glue = s => s.replace(/(\d) (?=(h|%|°C|days?|mm\/s|kW|kWh|bar|A|rpm|Hz|L|Cr|points?|pts|machine-days)(?![\w-]))/g, '$1&nbsp;')
    .replace(/\bRs (?=\d)/g, 'Rs&nbsp;').replace(/(\d) · /g, '$1&nbsp;·&nbsp;')
    .replace(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/g, '<span class="cp-id">$1</span>');   // never break "NOTE-LOT" at the hyphen
  const inline = s => glue(esc(s)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.split('\n').filter(l => l.trim()));
  return raw(blocks.filter(l => l.length).map(lines => {
    const first = lines.findIndex(l => l.startsWith('- '));
    if (first === -1) return `<p>${lines.map(inline).join('<br>')}</p>`;
    const lead = lines.slice(0, first), items = lines.slice(first);
    return (lead.length ? `<p>${lead.map(inline).join('<br>')}</p>` : '') + `<ul>${items.map(l => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('')}</ul>`;
  }).join(''));
}

// ---------------------------------------------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------------------------------------------
function findAssets(q, W) {
  const out = [], re = /\b([a-z]{3})\s?[-–]?\s?(\d{3})\b/g;
  let m;
  while ((m = re.exec(q))) {
    const id = m[1].toUpperCase() + '-' + m[2];
    if (W.assets.some(a => a.id === id) && !out.includes(id)) out.push(id);
  }
  return out;
}
const SITE_RX = { PUNE: /\bpune\b/, CHENNAI: /\bchennai\b/, CHITTOR: /\bchittor(garh)?\b/ };
function findSite(q) { for (const [id, rx] of Object.entries(SITE_RX)) if (rx.test(q)) return id; return null; }

function findLines(q, W, siteId) {
  const hits = [];
  for (const l of W.lines) {
    const name = l.name.toLowerCase(), short = l.short.toLowerCase();
    if (q.includes(name) || (!l.utility && short.length > 3 && new RegExp('\\b' + short + '( line)?\\b').test(q))) hits.push(l);
  }
  const byId = q.match(/\b(pun|chn|ctg)-?([a-z]\d)\b/);
  if (byId) { const l = W.lines.find(x => x.id.toLowerCase() === `${byId[1]}-${byId[2]}`); if (l) hits.push(l); }
  const n = q.match(/\bline\s?-?(\d)\b/);
  if (n) {
    const site = siteId || W.scenario.site;
    const l = W.lines.filter(x => x.siteId === site && !x.utility).sort((a, b) => a.order - b.order)[+n[1] - 1];
    if (l) hits.push(l);
  }
  const uniq = [...new Set(hits)];
  return siteId ? uniq.filter(l => l.siteId === siteId) : uniq;
}

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5 };
function findDays(q) {
  let m = q.match(/(\d+(?:\.\d+)?)\s*(days?|din)\b/); if (m) return +m[1];
  m = q.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|chaar|paanch|panch)\s+(days?|din)\b/); if (m) return m[1] === 'do' ? 2 : WORD_NUM[m[1]];
  m = q.match(/(\d+)\s*(weeks?|hafte)\b/); if (m) return 7 * m[1];
  m = q.match(/(\d+)\s*(hours?|hrs?|ghante)\b/); if (m) return +m[1] / 24;
  if (/\b(a|one|ek|this|last|past) (week|hafte)\b|\bweekly\b|\bthis hafte\b|\bis hafte\b/.test(q)) return 7;
  if (/\b(a|one|this|last|past) month\b|\bmahine\b|\bmonthly\b/.test(q)) return 30;
  if (/\b(a|one) day\b|\btomorrow\b|\bkal\b/.test(q)) return 1;
  if (/\btoday\b|\baaj\b|\byesterday\b/.test(q)) return 1;
  return null;
}
const HI_RX = /\b(kya|kyun|kyon|kyu|kab|hai|hain|mein|kitna|kitne|kitni|batao|bataiye|bata|chalega|chalegi|kaise|kaun|kaunsa|konsa|kahan|nahi|nahin|hoga|hogi|karo|kardo|tak|abhi|aaj|theek|thik|kharab|chahiye|mujhe|hamare|humare|wala|wali|raha|rahi|sakta|sakte|ghante|bhejo|bhej|lagega|kijiye|dijiye)\b/;

// ---------------------------------------------------------------------------------------------------------------
// Intent patterns (tested on the question with machine ids and line names removed)
// ---------------------------------------------------------------------------------------------------------------
const RX = {
  lot: /\bl-?\s?\d{4}\b|\blots?\b|supplier|\bbatch\b/,
  induced: /maintenance[- ]induced|\binduced\b|caused by (the |a )?(maintenance|pm|service)|(after|following|post)[- ](a |the |their |its )?(pm|preventive|maintenance|service|servicing)\b|right after (a |the )?(pm|maintenance|service)/,
  mtbf: /\bmtbf\b|\bmttr\b|mean time|how often|failure rate|breakdowns? (per|rate)|how many (breakdowns|failures)|kitni baar/,
  shift: /\bshifts?\b|\bnight\b|\bevening\b/,
  energy: /energy|\bpower\b|\bkwh\b|electricity|bijli|electric bill|\bco2\b|carbon/,
  energyWaste: /wast|extra|more than|above|too much|high|zyada|bill|rupee|\brs\b|cost|which machines?|any machine/,
  heat: /\bheat\b|temperature|\btemps?\b|\bhot\b|hotter|garmi|thermal|ambient|summer|weather|overheat/,
  effect: /affect|effect|impact|cause|make|lead to|related|correlat|because of|due to|influence|matter|more (failures|breakdowns)|fail more|increase|worse|kya asar|asar/,
  whatif: /what if|\bwait|waiting|\bdelay|\bdefer|postpone|put (it )?off|run it (until|till|for)|keep (it |on )?running|\bruk(e|o|en)?\b|baad mein|later\b|hold off/,
  window: /repair window|best (time|slot|window|day)|when (should|can|do|will|could|shall) (we|i|you) (repair|fix|replace|schedule|service|stop)|(schedule|plan) the (repair|fix|stop)|kab (repair|theek|thik)|when is the (repair|fix)|which (slot|window)/,
  spares: /spares?\b|\bstock\b|\bparts?\b|inventory|on hand|in hand|do we have|availab|7014|22320|\bsp-?\d{3}\b|transfer|bearing set|kitne (bearing|part)|need to (repair|fix)|needed (to|for)/,
  oee: /\boee\b|availability|performance|\bquality\b|\blosses\b|biggest loss|six big|\boutput\b|efficien|productivity/,
  rul: /how long|kab tak|when will (it|this|that|the machine|[a-z]{3}-\d{3}|\S+) (fail|break|stop|die)|time to failure|remaining (useful )?life|\brul\b|last (until|till|for|how)|chalega|chalegi|before it (fails|breaks)|how much time|kitna time|kitne (din|ghante)|close to (fail|failure|breaking)|how close|how soon|kitni der/,
  cost: /\bcosts?\b|money|rupee|\brs\b|at stake|penalt|how much (will|would|does|is|money)|expensive|kharcha|nuksan|loss if|price of (a|the) (failure|breakdown)/,
  root: /\bwhy\b|kyun|kyon|\bkyu\b|root cause|\bcause|what('s| is) wrong|failing|keep (on )?failing|problem|diagnos|explain|\bissue|kharab|what happened|\breason|went wrong/,
  alerts: /alerts?\b|attention|most urgent|urgent|priorit|what('s| is) happening|anything wrong|overview|summary|top risks?|at risk|which machines?|kya chal raha|status of (the )?(plant|fleet|factory|site)|how is the (plant|fleet|factory)|look at first|worry about/,
  policy: /approv|guardrail|policy|permission|allowed|human|sign[- ]?off|who (can|may|should|will) (release|close|dispatch)/,
  help: /what can you (do|answer|tell)|^help\b|how do you work|who are you|what are you|^(hi|hello|hey|namaste|namaskar)\b|what do you know|what (questions|should i ask)/,
  status: /\bbad\b|serious|\bok\b|okay|\bfine\b|healthy|\bhealth\b|condition|status|how is|how's|safe to run|theek|thik|kaisa|kaisi|doing|worried|dangerous|risky|broken/,
  reading: /vibration|temperature|\btemps?\b|\bcurrent\b|\bamps?\b|pressure|\bspeed\b|\brpm\b|\bpower\b|reading|sensor value|\bkw\b/,
  fix: /\bfix\b|repair it|sort (it|this) out|handle it|do something|what (should|do) (i|we) do|next step|theek karo|thik karo|what now/,
  pronoun: /\b(it|this|that|this one|that one|the machine|yeh|ye|isko|iska|woh|wo)\b/,
  pm: /\bpreventive\b|\bpms?\b|overdue|due for (a )?(service|maintenance|pm)|service (is )?due|(maintenance|service) (calendar|schedule|plan)|routine maintenance|servicing/,
  peer: /\bsiblings?\b|\bpeers?\b|identical|same (type|kind|model)|other (vmcs?|machines? like|presses|fans|pumps|compressors)|(compare|comparison|compared) (it )?(with|to|against) (the )?(others?|rest|siblings|similar)|unlike the others|different from (the )?(others|rest)/,
  roi: /\broi\b|payback|pay back|business case|worth it|is it worth|what is (it|this|nirantar|predictive maintenance) worth|save (us )?(per|a|each) year|annual saving|return on investment|kitna bachega/,
};
// Guardrail: actions only a person may take (policy POL-G8)
const ACT_RX = /\b(approve|release|dispatch|close|skip|override|bypass|authori[sz]e|sign[- ]?off|reschedule|cancel|delete|execute|expedite|disable)\b|\bsend (a |the |our |some )?(repair )?(crew|team|technicians?|tech|fitters?|mechanics?|engineers?)\b|\bchange (the |tomorrow'?s |today'?s |this week'?s |next week'?s )?(schedule|shift plan|production plan|plan|window|priority)\b|\bstart the (repair|work)\b|\bmark (it |this |the [\w-]+ )?(as )?(done|complete|completed|closed)\b|\bwithout (an |any |the )?(human )?approv|\bno approv|\bturn off the guardrail|\bremove the guardrail/;
const REQ_RX = /\b(can you|could you|will you|would you|please|pls|plz|go ahead|i want you to|you should|you must|for me|right now|now|immediately|asap|abhi|kar do|kardo|karo|kar dijiye|de do|bhej do|bhejo|kar dena|just)\b/;
const INFO_START = /^(who|what|when|why|how|which|where|is|was|has|have|does|did|are|were|should i|do i|do we|does it)\b/;
const OOS_HARD = /cricket|\bipl\b|world cup|football|\bfifa\b|tennis|match score|movie|\bfilm\b|\bsong\b|\bjoke\b|recipe|bitcoin|crypto|sensex|nifty|share price|stock price|stock market|election|prime minister|president|capital of|\bpoem\b|horoscope|astrology|bollywood|girlfriend|boyfriend/;
const OOS_SOFT = /weather|\bnews\b|traffic|holiday|\bdate today\b|\btime is it\b/;
const PLANT_RX = /\boee\b|bearing|spindle|machine|plant|\bline\b|fail|breakdown|repair|maintenance|spare|\bparts?\b|stock(?! (price|market))|alert|sensor|vibration|temperature|motor|pump|compressor|kiln|press\b|furnace|energy|\bpower\b|kwh|shift|downtime|mtbf|mttr|work order|\bwo\b|\blot\b|supplier|technician|crew|approv|\bsop\b|manual|health|\brul\b|output|production|factory|fleet/;

// ---------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------
const nowMs = () => (globalThis.performance && performance.now ? performance.now() : Date.now());

/**
 * Answer a plant question from the demo data. Pure: reads `store` (world, model, state, t), never writes.
 * @param {string} question
 * @param {object} store  the demo store (store.js)
 * @param {{lastAsset?: string}} [opts]  optional conversation context (the machine of the previous question)
 * @returns {{text:string, html?:object, intent:string, tools:string[], sources:{id:string,title:string}[],
 *   blocked:boolean, rule?:string, confidence:number, ms:number, assets:string[], lang:string}}
 */
export function answer(question, store, opts = {}) {
  const t0 = nowMs();
  let r;
  try {
    r = route(question, store, opts || {});
  } catch (e) {
    r = out('error', `Sorry, I could not answer that from the sample data (${e && e.message ? e.message : 'internal error'}). Try one of the suggested questions.`, { confidence: 0.1 });
  }
  r.ms = Math.max(0.1, Math.round((nowMs() - t0) * 10) / 10);
  return r;
}

function out(intent, text, o = {}) {
  const r = { text, intent, tools: o.tools || [], sources: srcList(o.sources || []), blocked: !!o.blocked, confidence: Math.round((o.confidence ?? 0.9) * 100) / 100, assets: o.assets || [], lang: 'en' };
  if (o.html) r.html = o.html;
  if (o.rule) r.rule = o.rule;
  if (o.hi) r.hi = o.hi;
  return r;
}
function srcList(ids) {
  const seen = new Set();
  return ids.filter(id => id && !seen.has(id) && seen.add(id)).map(id => ({ id, title: (DOCS.find(d => d.id === id) || {}).title || TABLES[id] || id }));
}

function route(question, store, opts) {
  const q = norm(question);
  if (!store || !store.loaded || !store.world || !store.model) {
    return out('no_data', 'No plant data is loaded, so I have nothing to answer from. Open the **Data** menu, press **Load sample data**, and ask again.', { confidence: 0.95 });
  }
  const C = context(question, q, store, opts);
  if (!q) return clarify(C, 'empty');

  // 1. Guardrail first: anything that would skip a human decision is refused and logged.
  const g = guardrail(C);
  if (g) return withHinglish(C, g);

  // 2. Out of scope
  const strongPlant = C.assets.length || C.lines.length || PLANT_RX.test(C.qi);
  if ((OOS_HARD.test(q) && !C.assets.length && !/\boee\b|bearing|machine|plant|spare|repair/.test(q)) || (OOS_SOFT.test(q) && !strongPlant)) return withHinglish(C, outOfScope(C));

  // 3. Intents, most specific first
  const qi = C.qi;
  let r = null;
  if (RX.lot.test(qi)) r = lotAnswer(C);
  else if (RX.induced.test(qi)) r = inducedAnswer(C);
  else if (RX.mtbf.test(qi)) r = mtbfAnswer(C);
  else if (RX.pm.test(qi)) r = pmAnswer(C);
  else if (RX.peer.test(qi)) r = needAsset(C, 'peer', peerAnswer);
  else if (RX.roi.test(qi)) r = roiAnswer(C);
  else if (RX.shift.test(qi) && (RX.oee.test(qi) || RX.effect.test(qi) || /\bbetter|worse|lower|higher|compare|difference|best|worst/.test(qi) || !C.assets.length)) r = shiftAnswer(C);
  else if (RX.energy.test(qi) && (RX.energyWaste.test(qi) || !C.assets.length)) r = energyAnswer(C);
  else if (RX.heat.test(qi) && (RX.effect.test(qi) || !C.assets.length)) r = heatAnswer(C);
  else if (RX.whatif.test(qi)) r = needAsset(C, 'whatif', whatIfAnswer);
  else if (RX.window.test(qi)) r = needAsset(C, 'window', windowAnswer);
  else if (RX.spares.test(qi)) r = sparesAnswer(C);
  else if (RX.oee.test(qi)) r = oeeAnswer(C);
  else if (RX.rul.test(qi)) r = needAsset(C, 'rul', rulAnswer);
  else if (RX.policy.test(qi) && ACT_RX.test(C.q)) r = policyAnswer(C);
  else if (RX.cost.test(qi) && (C.asset || RX.pronoun.test(qi))) r = needAsset(C, 'cost', costAnswer);
  else if (RX.root.test(qi)) r = C.asset ? rootAnswer(C, C.asset) : (RX.alerts.test(qi) || /plant|factory|fleet|line|site|everything|anything/.test(qi) || C.lines.length || C.site ? alertsAnswer(C) : clarify(C, 'root'));
  else if (RX.alerts.test(qi)) r = alertsAnswer(C);
  else if (RX.policy.test(qi)) r = policyAnswer(C);
  else if (RX.help.test(qi)) r = helpAnswer(C);
  else if (RX.reading.test(qi) && C.asset) r = readingAnswer(C, C.asset);
  else if (RX.energy.test(qi) && C.asset) r = readingAnswer(C, C.asset, 'POWER_KW');
  else if (RX.heat.test(qi) && C.asset) r = readingAnswer(C, C.asset);
  else if (RX.fix.test(qi)) r = needAsset(C, 'fix', fixAnswer);
  else if (RX.status.test(qi)) r = needAsset(C, 'status', statusAnswer);
  else if (C.assets.length) r = statusAnswer(C, C.asset);
  else if (C.lines.length) r = oeeAnswer(C);
  else if (RX.pronoun.test(qi) && qi.split(' ').length <= 6) r = clarify(C, 'status');
  else if (strongPlant) r = clarify(C, 'general');
  else r = outOfScope(C);
  return withHinglish(C, r);
}

function context(question, q, store, opts) {
  const W = store.world, M = store.model, S = store.state, t = store.t;
  const assets = findAssets(q, W);
  const site = findSite(q);
  const lines = findLines(q, W, site);
  // remove ids and line names so that "Heat Treatment line" does not look like a heat question
  let qi = q.replace(/\b[a-z]{3}\s?[-–]?\s?\d{3}\b/g, ' ');
  for (const l of W.lines) qi = qi.split(l.name.toLowerCase()).join(' ');
  for (const l of lines) qi = qi.replace(new RegExp('\\b' + l.short.toLowerCase() + '\\b', 'g'), ' ');
  qi = qi.replace(/\s+/g, ' ').trim();
  const ctxAsset = !assets.length && opts.lastAsset && W.assets.some(a => a.id === opts.lastAsset) ? opts.lastAsset : null;
  const id = assets[0] || null;
  return { question, q, qi, store, W, M, S, t, assets, site, lines, days: findDays(q), hinglish: HI_RX.test(q), ctxAsset,
    asset: id ? M.assetById(id) : null };
}

// When the intent needs a machine: use the named one, else the previous question's machine, else ask which one.
function needAsset(C, kind, fn) {
  if (C.asset) return fn(C, C.asset);
  if (C.ctxAsset) { const r = fn(C, C.M.assetById(C.ctxAsset)); r.text = `(I assumed you mean **${C.ctxAsset}** from your previous question.)\n\n` + r.text; return r; }
  return clarify(C, kind);
}

// ---------------------------------------------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------------------------------------------
const woFor = (C, id) => C.S.workOrders.filter(w => w.assetId === id && w.kind !== 'PM' && !['DONE', 'REJECTED'].includes(w.status)).sort((x, y) => y.createdAt - x.createdAt)[0];
const WO_STATUS = { PENDING_APPROVAL: 'waiting for a person to approve it', APPROVED: 'approved', SCHEDULED: 'approved and scheduled', IN_PROGRESS: 'in progress', DONE: 'done', REJECTED: 'rejected' };
const lineOf = (C, a) => C.M.lineById(a.lineId);
const cityOf = (C, siteId) => (C.M.siteById(siteId) || {}).city || siteId;
function stockPhrase(C, part) { return C.W.sites.map(s => `${part.stock[s.id] || 0} in ${s.city}`).join(', '); }
function repairedFault(C, a) { return C.S.faults.find(f => f.asset === a.id && f.repairedAt && f.repairedAt <= C.S.simNow); }
function crossedAgoH(C, a, tag) {
  const beyond = v => (tag.dir === 'low' ? v <= tag.alarm : v >= tag.alarm);
  if (!beyond(C.M.trendAt(a, tag.key, C.t))) return null;
  for (let h = 1; h <= 168; h++) if (!beyond(C.M.trendAt(a, tag.key, C.t - h * HOUR))) return h;
  return 168;
}
function ranked(C) {
  return C.W.assets.map(a => { const ass = C.M.assess(a, C.t); return { a, ass, att: attention(a, ass) }; }).sort((p, q) => q.att.score - p.att.score);
}
function heroAsset(C) {
  const h = C.W.scenario.hero && C.M.assetById(C.W.scenario.hero);
  return h || ranked(C)[0].a;
}
const askBtn = (q, label = q) => html`<button type="button" class="btn sm cp-choice" data-action="ask" data-q="${q}">${label}</button>`;
const choices = items => html`<div class="cp-choices" role="group" aria-label="Follow-up questions">${items.map(([q, l]) => askBtn(q, l))}</div>`;
const tbl = (head, rows, cap = '') => html`<div class="table-wrap cp-table"><table class="table">${cap ? html`<caption class="visually-hidden">${cap}</caption>` : ''}<thead><tr>${head.map((h, i) => html`<th scope="col" class="${i ? 'n' : ''}">${h}</th>`)}</tr></thead><tbody>${rows.map(r => html`<tr class="${r.hl ? 'cp-hl' : ''}">${r.cells.map((c, i) => html`<td class="${i ? 'n' : ''}">${c}</td>`)}</tr>`)}</tbody></table></div>`;

// ---------------------------------------------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------------------------------------------
function guardrail(C) {
  const q = C.q;
  if (!ACT_RX.test(q)) return null;
  if (/\b(i|we) ('d like|would like|want|need|am going|are going|will|'ll|plan|wish) (to )?(approve|release|sign)/.test(q)) return null;   // the person wants to decide: that is allowed
  const skip = /without (an |any |the )?(human )?approv|\bno approv|skip (the |an |any )?approv|\bbypass|\boverride|turn off the guardrail|remove the guardrail|\bdisable\b/.test(q);
  const info = INFO_START.test(q) && !/^(can|could|will|would)\b/.test(q);
  const imperative = /^(ok |okay |hey |copilot,? |nirantar,? )?(approve|release|dispatch|close|skip|override|bypass|authori|sign|reschedule|cancel|delete|execute|expedite|disable|send|change|start|mark|go ahead|just|please|pls|plz|turn off|remove)\b/.test(q);
  const request = imperative || (!info && (REQ_RX.test(q) || skip || /^(can|could|will|would)\b/.test(q))) || (/^(can|could|will|would) (you|nirantar|the ai|the copilot)\b/.test(q));
  if (!request) return null;

  // what is being asked, and on what
  const woId = (q.match(/\bwo-[a-z]+-\d+\b/) || [])[0];
  const wo = woId ? C.S.workOrders.find(w => w.id.toLowerCase() === woId) : null;
  const a = C.asset || (wo && C.M.assetById(wo.assetId)) || (C.ctxAsset && C.M.assetById(C.ctxAsset)) || null;
  const theWo = wo || (a ? woFor(C, a.id) : C.S.workOrders.find(w => w.status === 'PENDING_APPROVAL'));
  const dispatch = /\bdispatch\b|\bsend (a |the |our |some )?(repair )?(crew|team|technicians?|tech|fitters?|mechanics?|engineers?)\b/.test(q);
  const sensor = dispatch && a && C.M.assess(a, C.t).state === 'sensor';
  const what = dispatch ? 'Dispatching a repair crew' : /\brelease\b/.test(q) ? 'Releasing a work order' : /\bapprove|authori|sign/.test(q) ? 'Approving a work order'
    : /\bclose|mark/.test(q) ? 'Closing a work order or an alert' : /reschedule|change/.test(q) ? 'Changing the schedule' : /cancel|delete/.test(q) ? 'Cancelling or deleting records' : /expedite/.test(q) ? 'Releasing a parts transfer' : skip ? 'Skipping an approval' : 'That action';
  const rule = sensor ? 'POL-G8 + SOP-50: suspected sensor fault, inspect first' : 'POL-G8: approval is human-only';
  const lines = [];
  if (sensor) {
    const ass = C.M.assess(a, C.t);
    lines.push(`**I can't dispatch a crew to ${a.id}. The reading looks like a sensor fault, not a machine fault** (${ass.sensorFault.reason}). SOP-50 says: do not send a repair crew; send instrumentation to check the cable and mounting first. Approving any crew is also a person's decision (POL-G8).`);
  } else {
    lines.push(`**I can't do that. ${what} is a person's decision${skip && what !== 'Skipping an approval' ? ', and no one can skip the approval' : ''} (policy POL-G8: approval is human-only).** I may draft work orders, check spares and propose repair windows, but only a named person may approve, release, schedule or close a work order, and every action is logged with who and when.`);
  }
  if (theWo) {
    const ta = C.M.assetById(theWo.assetId);
    if (theWo.status === 'PENDING_APPROVAL') lines.push(`What I can do: **${theWo.id}** for ${ta.id} (${lc(theWo.title.split(':')[0])}) is already drafted with parts, steps and a proposed window. Open **5 · Work Orders**, check the plan, and approve it with your name.`);
    else lines.push(`${theWo.id} for ${ta.id} is already ${WO_STATUS[theWo.status] || lc(theWo.status)}${theWo.approvals && theWo.approvals[0] ? ` (by ${theWo.approvals[0].by})` : ''}; see **5 · Work Orders**.`);
  } else if (a) {
    const aa = C.M.assess(a, C.t);
    lines.push(aa.state === 'normal' ? `There is no work order for ${a.id}: it is running normally (health ${aa.health}/100), so there is nothing to send a crew for. Open **5 · Work Orders** to see the board.` : `There is no work order for ${a.id} yet. Raise or ask for a draft from **3 · Alert Triage**; a person then approves it on **5 · Work Orders**.`);
  } else lines.push('There is no drafted work order waiting right now. Open **5 · Work Orders** to see the board.');
  lines.push('This refusal is written to the guardrail log on **8 · Trust Audit**.');
  return out('guardrail', lines.join('\n\n'), {
    blocked: true, rule, confidence: 0.99, tools: ['guardrail_policy', ...(a ? ['asset_360'] : [])], sources: ['POL-G8', ...(sensor || dispatch ? ['SOP-50'] : []), 'APP.WORK_ORDERS'], assets: a ? [a.id] : [],
    html: html`<div class="cp-choices"><a class="btn sm" href="#/orders">${icon('orders')} Open 5 · Work Orders</a></div>`,
    hi: sensor ? `**Crew nahi bhej sakta.** ${a.id} ka sensor atka hua lagta hai (SOP-50): pehle sensor check karwaiye.` : '**Maaf kijiye, yeh main nahi kar sakta.** Work order approve ya release sirf ek insaan kar sakta hai (POL-G8). Draft taiyaar hai; approval aapka.',
  });
}

function policyAnswer(C) {
  const a = C.asset || (C.ctxAsset && C.M.assetById(C.ctxAsset));
  const woId = (C.q.match(/\bwo-[a-z]+-\d+\b/) || [])[0];
  const wo = woId ? C.S.workOrders.find(w => w.id.toLowerCase() === woId) : a ? woFor(C, a.id) || C.S.workOrders.find(w => w.assetId === a.id) : null;
  const lines = ['**Only a named person may approve, release, schedule or close a work order (policy POL-G8).** I can draft work orders, check spares, propose windows and answer questions; approval happens on **5 · Work Orders**, where the approver types their name. Every action, by a person or by the AI, is logged on **8 · Trust Audit**.'];
  if (wo) lines.push(`${wo.id} (${wo.assetId}) is ${WO_STATUS[wo.status] || lc(wo.status)}${wo.approvals && wo.approvals.length ? `: ${lc(wo.approvals[0].action)} by ${wo.approvals[0].by} at ${dateTime(wo.approvals[0].at)}` : ''}.`);
  if (/\b(i|we) /.test(C.q) && /approv/.test(C.q)) lines.push('If you want to approve it, that is exactly how it should work: open 5 · Work Orders, read the plan and press Approve.');
  lines.push(`The guardrail log holds ${plural(C.S.guardrail.length, 'refused request')} so far.`);
  return out('policy', lines.join('\n\n'), { tools: ['guardrail_policy'], sources: ['POL-G8', 'APP.WORK_ORDERS'], confidence: 0.95, assets: wo ? [wo.assetId] : [],
    hi: 'Approval sirf insaan deta hai (POL-G8); main sirf draft banata hoon.' });
}

// ---------------------------------------------------------------------------------------------------------------
// Root cause
// ---------------------------------------------------------------------------------------------------------------
function historyText(C, a, currentMode) {
  const hist = C.W.history.filter(h => h.assetId === a.id);
  const cms = hist.filter(h => h.type === 'CM').sort((x, y) => y.date - x.date);
  const pm = hist.filter(h => h.type === 'PM').sort((x, y) => y.date - x.date)[0];
  const now = C.S.simNow;
  const pmText = pm ? ` Last preventive maintenance: ${daysAgo(pm.date, now)} days ago (${pm.id}).` : '';
  if (!cms.length) return `No breakdowns on ${a.id} in the last ${HISTORY_DAYS} days of maintenance history.${pmText}`;
  const modes = [...new Set(cms.map(h => h.mode))];
  const what = modes.map(m => `**${FAILURE_MODES[m].short}**`);
  let s = `**Earlier breakdowns:** ${a.id} broke down ${plural(cms.length, 'time')} in the last ${HISTORY_DAYS} days, ${cms.length > 1 && modes.length === 1 ? 'both times ' : ''}${listJoin(what)} (${cms.map(h => `${h.id}, ${daysAgo(h.date, now)} days ago`).join('; ')}).`;
  if (currentMode && !modes.includes(currentMode)) {
    const fixes = modes.map(m => FAILURE_MODES[m].sop);
    s += ` That was a different problem, fixed under ${listJoin(fixes)}; this is the first ${FAILURE_MODES[currentMode].short} on record, so it is not the same fault coming back.`;
  } else if (currentMode && modes.includes(currentMode)) {
    s += ` The same problem has come back, so the last fix (${FAILURE_MODES[currentMode].sop}) did not remove the cause; check the cause, not just the part.`;
  }
  return s + pmText;
}

function devBars(ass) {
  const rows = ass.contributions.slice(0, 4);
  return html`<div class="cp-bars"><p class="xs dim">How far each sensor has moved from normal towards its trip level (0 % = normal, 100 % = trip):</p><ul>${rows.map(r => {
    const tone = r.dev >= 0.35 ? 'act' : r.dev >= 0.1 ? 'watch' : 'normal';
    return html`<li><span class="cp-bar-l">${r.label}</span><span class="cp-bar-t" aria-hidden="true"><span class="${tone}" style="width:${Math.max(2, Math.round(r.dev * 100))}%"></span></span><span class="cp-bar-v mono">${Math.round(r.dev * 100)} %</span></li>`;
  })}</ul></div>`;
}

function rootAnswer(C, a) {
  const { M, W, t } = C;
  const ass = M.assess(a, t);
  const line = lineOf(C, a), city = cityOf(C, a.siteId);
  const tools = ['asset_360', 'plant_ops_analyst', 'maint_knowledge_search'];
  const fixed = repairedFault(C, a);
  // sensor fault: not a machine problem
  if (ass.state === 'sensor') {
    const wo = woFor(C, a.id);
    return out('root_cause', [
      `**${a.id} is not failing: this looks like a sensor fault.** ${ass.sensorFault.reason}.`,
      `- The other sensors on ${a.id} are normal (health ${ass.health}/100 without the frozen reading).\n- SOP-50: a reading that is perfectly flat, or disagrees with all related sensors, is a sensor fault. Do not send a repair crew; instrumentation checks the cable and mounting and swaps the accelerometer if needed.${wo ? `\n- Inspection ${wo.id} is drafted (${WO_STATUS[wo.status]}).` : ''}`,
    ].join('\n\n'), { tools, sources: ['SOP-50', 'RAW.TELEMETRY', 'ML.V_LATEST_PRED'], assets: [a.id], confidence: 0.9,
      hi: `${a.id} kharab nahi hai; sensor atka hua hai (SOP-50). Crew mat bhejiye, pehle sensor check karwaiye.` });
  }
  // consequence of another machine (one root cause, many alarms)
  const cq = W.scenario.consequence;
  const src = cq && C.S.faults.find(f => f.asset === cq.from && !f.repairedAt);
  if (cq && src && a.id !== cq.from && cq.lines.includes(a.lineId) && ass.worstKey === cq.tag && ass.state !== 'normal') {
    const tag = M.tagOf(a, cq.tag), from = M.assetById(cq.from);
    return out('root_cause', [
      `**${a.id} is not the problem. Its ${lc(tag.label)} is low because ${from.id} (${lc(from.name)}) is cavitating** and cannot keep pressure on the lines it feeds.`,
      `- ${tag.label} on ${a.id}: ${fmtTag(tag, M.trendAt(a, cq.tag, t))} ${tag.unit} (normal ${tag.normal}, alarm ${tag.alarm}).\n- The same drop shows on every machine fed by ${from.id}, so the alarms share one root cause (ISA-18.2 grouping).\n- Fix ${from.id} first: switch to the standby pump CLP-102, then clean the suction strainer and replace the impeller (SOP-12).`,
    ].join('\n\n'), { tools, sources: ['SOP-12', 'RAW.TELEMETRY', 'APP.ALERTS'], assets: [a.id, from.id], confidence: 0.9,
      hi: `${a.id} theek hai; asli problem ${from.id} pump mein hai. Pehle use theek kijiye (SOP-12).` });
  }
  if (!ass.mode || ass.state === 'normal') {
    const lines = [];
    if (fixed) lines.push(`**${a.id} was repaired ${dateTime(fixed.repairedAt)} (${FAILURE_MODES[fixed.mode].short}) and is back to normal**: health ${ass.health}/100, failure confidence ${confPct(ass.conf)}.`);
    else if (ass.state === 'normal') lines.push(`**${a.id} is not failing right now.** Health ${ass.health}/100, every sensor is within its normal band and failure confidence is ${confPct(ass.conf)}; the only estimate is normal wear (about ${hours(ass.rulH)}).`);
    else lines.push(`**${a.id} is drifting, but no failure mode matches yet.** Health ${ass.health}/100; top signal: ${ass.top ? `${ass.top.label} ${changeText(M.tagOf(a, ass.top.key), ass.top.past, ass.top.now)}` : lc(ass.contributions[0].label)}.`);
    lines.push(historyText(C, a, null));
    return out('root_cause', lines.join('\n\n'), { tools, sources: ['ML.V_LATEST_PRED', 'CMMS.WORK_ORDERS'], assets: [a.id], confidence: 0.85,
      hi: `${a.id} abhi theek chal raha hai; koi failure trend nahi hai.` });
  }
  const fm = FAILURE_MODES[ass.mode];
  const evid = [];
  if (ass.top) {
    const tag = M.tagOf(a, ass.top.key);
    const crossed = crossedAgoH(C, a, tag);
    evid.push(`**${ass.top.label}** ${changeText(tag, ass.top.past, ass.top.now)}${crossed ? `; it crossed the alarm line (${tag.alarm} ${tag.unit}) about ${hours(crossed)} ago` : `; the alarm line is ${tag.alarm} ${tag.unit}`}.`);
  }
  if (ass.iso) evid.push(`Vibration is in ISO 10816 zone **${ass.iso.zone}** (${ass.iso.text}).`);
  const temp = M.tagOf(a, 'BEARING_TEMP') || M.tagOf(a, 'OIL_TEMP');
  if (temp && ass.top && temp.key !== ass.top.key) {
    const tn = M.trendAt(a, temp.key, t), tp = M.trendAt(a, temp.key, t - 72 * HOUR);
    if (tn - tp > 2) evid.push(`**${temp.label}** is up ${Math.round(tn - tp)} °C in three days (${fmtTag(temp, tp)} → ${fmtTag(temp, tn)} °C, alarm ${temp.alarm} °C)${ass.mode === 'FM-01' && a.cls === 'cnc' ? '; the VMC manual says bearing damage shows a 10-20 °C rise before seizure' : ''}.`);
  }
  const moving = ass.contributions.filter(c => c.dev > 0.1);
  if (moving.length >= 2) evid.push(`${moving.length} related sensors moved together (${listJoin(moving.map(c => lc(c.label)))}), so this is **not a sensor fault** (SOP-50: a sensor fault shows one frozen or disagreeing reading).`);
  else evid.push(`So far only ${moving.length ? lc(moving[0].label) : 'one reading'} has moved; the other sensors are still normal. One drifting reading could also be a sensor problem (SOP-50), so Nirantar keeps ${a.id} on the watch list until a second sensor confirms it.`);
  if (SPECTRUM_SIGN[ass.mode]) evid.push(SPECTRUM_SIGN[ass.mode](M.bearingFreqs(a.bearing, (a.rpm || 1480) / 60)));
  const notes = W.docs.filter(d => d.kind === 'Note' && d.text.includes(a.id));
  for (const n of notes) { const en = (n.text.match(/\(([^()]*)\)\s*$/) || [])[1]; evid.push(`Technician note (${n.id}): "${en || n.text}"`); }

  const plan = M.partPlan(a, ass.mode);
  const wo = woFor(C, a.id);
  const sop = DOCS.find(d => d.id === fm.sop);
  const todo = [];
  todo.push(`Repair per ${sopName(fm.sop)}: about ${hh(fm.repairH)} of work.`);
  if (plan) todo.push(`Part ${plan.part.id} (${plan.part.name}): ${stockPhrase(C, plan.part)}${plan.kind === 'transfer' ? `; transfer from ${cityOf(C, plan.from)} about ${plan.etaH} h by road` : plan.kind === 'purchase' ? `; none in stock, supplier lead time ${plan.part.leadDays} days` : '; in stock locally'}.`);
  if (wo) todo.push(`The AI drafted **${wo.id}**; it is ${WO_STATUS[wo.status]}${wo.status === 'PENDING_APPROVAL' ? ' on 5 · Work Orders' : ''}.`);

  const verb = ass.state === 'act' ? 'is failing because of' : 'shows early signs of';
  const text = [
    `**${a.id} ${verb} ${fm.short}** (${lc(a.name)}, ${line.name}, ${city}). Health ${ass.health}/100, failure confidence ${confPct(ass.conf)}, likely failure in about ${hours(ass.rulH)} (${hours(ass.rulLo)} to ${hours(ass.rulHi)}).`,
    '**Evidence**\n' + evid.map(e => '- ' + e).join('\n'),
    historyText(C, a, ass.mode),
    '**What to do**\n' + todo.map(e => '- ' + e).join('\n'),
  ].join('\n\n');
  const sources = ['ML.V_LATEST_PRED', 'RAW.TELEMETRY', ...(ass.mode === 'FM-01' && a.cls === 'cnc' ? ['MAN-VMC'] : []), fm.sop, ...(ass.iso ? ['ISO-10816'] : []), ...notes.map(n => n.id), 'SOP-50', 'CMMS.WORK_ORDERS', ...(plan ? ['ERP.SPARES'] : [])];
  return out('root_cause', text, { tools: [...tools, ...(plan ? ['check_spares'] : [])], sources, assets: [a.id], html: devBars(ass),
    confidence: Math.min(0.95, 0.55 + 0.4 * ass.conf * Math.min(1, moving.length / 3)),
    hi: `${a.id} mein ${MODE_HI[ass.mode] || fm.short}${ass.top && ass.top.ratio >= 1.5 && M.tagOf(a, ass.top.key).dir !== 'low' ? `: ${lc(ass.top.label)} ${ass.top.ratio.toFixed(1)} guna badh gaya hai` : ''}, aur lagbhag ${ass.rulKind === 'trend' ? hours(ass.rulH).replace(' h', ' ghante').replace(' days', ' din') : 'kaafi din'} mein fail ho sakta hai.` });
}

// ---------------------------------------------------------------------------------------------------------------
// Status, reading, time to failure, cost, fix
// ---------------------------------------------------------------------------------------------------------------
const STATE_WORD = { normal: 'normal', watch: 'on the watch list', act: 'in the act-now band', sensor: 'flagged for a sensor check' };
function statusAnswer(C, a) {
  const ass = C.M.assess(a, C.t);
  const wo = woFor(C, a.id);
  const lines = [`**${a.id} (${lc(a.name)}, ${lineOf(C, a).name}) is ${STATE_WORD[ass.state]}.** Health ${ass.health}/100, failure confidence ${confPct(ass.conf)}, time to failure ${ass.rulKind === 'trend' ? `about ${hours(ass.rulH)} (${hours(ass.rulLo)} to ${hours(ass.rulHi)})` : `no trend (normal wear, about ${hours(ass.rulH)})`}.`];
  if (ass.state === 'sensor') lines.push(`${ass.sensorFault.reason}: a sensor problem, not a machine problem (SOP-50).`);
  else if (ass.top) lines.push(`Top signal: ${ass.top.label} ${changeText(C.M.tagOf(a, ass.top.key), ass.top.past, ass.top.now)}${ass.modeName ? `, read as **${lc(ass.modeName)}**` : ''}.`);
  else lines.push('Every sensor is within its normal band.');
  if (wo) lines.push(`${wo.id} is ${WO_STATUS[wo.status]}.`);
  const sev = ass.state === 'normal' ? 'Not bad: nothing to do now.' : ass.state === 'act' ? 'Yes, this is serious: act now.' : 'Keep an eye on it.';
  lines.push(sev);
  return out('status', lines.join('\n\n'), { tools: ['asset_360'], sources: ['ML.V_LATEST_PRED', 'RAW.TELEMETRY'], assets: [a.id], confidence: 0.92,
    html: choices([[`Why is ${a.id} failing?`, 'Why?'], [`How long will ${a.id} last?`, 'How long will it last?'], [`What if we wait 3 days to repair ${a.id}?`, 'What if we wait?']]),
    hi: `${a.id}: health ${ass.health}/100. ${ass.state === 'normal' ? 'Sab theek hai.' : ass.state === 'act' ? 'Haan, halat serious hai; abhi action chahiye.' : 'Nazar rakhiye.'}` });
}

function pickTag(C, a, forced) {
  if (forced) return C.M.tagOf(a, forced);
  const q = C.qi, has = k => C.M.tagOf(a, k);
  const order = [[/peak/, ['VIB_PEAK']], [/vibration/, ['VIB_RMS']], [/temperature|\btemps?\b|heat|hot/, ['BEARING_TEMP', 'OIL_TEMP', 'OUTLET_TEMP', 'ZONE_TEMP']], [/current|amps?/, ['MOTOR_CURRENT']],
    [/pressure/, ['COOLANT_PRESS', 'DISCH_PRESS', 'HYD_PRESS', 'AIR_PRESS']], [/speed|rpm/, ['SPINDLE_RPM', 'SPEED_RPM', 'STROKES']], [/power|\bkw\b/, ['POWER_KW']]];
  for (const [rx, keys] of order) if (rx.test(q)) { const k = keys.find(has); if (k) return has(k); }
  return C.M.tagOf(a, C.M.assess(a, C.t).worstKey);
}
function readingAnswer(C, a, forced) {
  const { M, t } = C;
  const tag = pickTag(C, a, forced);
  const v = M.valueAt(a, tag.key, t), past = M.trendAt(a, tag.key, t - 72 * HOUR), trend = M.trendAt(a, tag.key, t);
  const beyondAlarm = tag.dir === 'low' ? trend <= tag.alarm : trend >= tag.alarm;
  const dev = M.deviation(tag, trend);
  const zone = beyondAlarm ? 'beyond the alarm line' : dev < 0.03 ? 'normal' : tag.dir === 'low' ? 'below normal, above the alarm line' : 'above normal, below the alarm line';
  const change = Math.abs(trend - past) / Math.max(1e-6, Math.abs(past));
  const text = [`**${tag.label} on ${a.id}: ${fmtTag(tag, v)} ${tag.unit}** (latest reading, ${zone}). Normal ${tag.normal} ${tag.unit}, alarm ${tag.alarm} ${tag.unit}, trip ${tag.trip} ${tag.unit}.`,
    change < 0.03 ? 'It is steady compared with three days ago.' : `Three days ago the trend was ${fmtTag(tag, past)} ${tag.unit}, so it has ${trend > past ? 'risen' : 'fallen'} ${tag.unit === '°C' ? `${num(Math.abs(trend - past), 1)} °C` : `${Math.round(change * 100)} %`}.`];
  if (tag.key === 'POWER_KW' && trend - tag.base > 0.03 * tag.base) text.push(`That is ${num(trend - tag.base, 1)} kW above its healthy baseline (${tag.base} kW): about ${inr((trend - tag.base) * RUN_H_PER_DAY * RS_PER_KWH)} a day of extra electricity at Rs ${RS_PER_KWH}/kWh.`);
  return out('reading', text.join('\n\n'), { tools: ['asset_360'], sources: ['RAW.TELEMETRY'], assets: [a.id], confidence: 0.95,
    hi: `${a.id} ka ${lc(tag.label)} abhi ${fmtTag(tag, v)} ${tag.unit} hai (alarm ${tag.alarm}).` });
}

function rulAnswer(C, a) {
  const ass = C.M.assess(a, C.t);
  const wo = woFor(C, a.id);
  const win = wo && (wo.window || wo.proposedWindow);
  if (ass.state === 'sensor') return statusAnswer(C, a);
  if (ass.rulKind !== 'trend') {
    return out('rul', `**${a.id} has no failure trend; it should keep running.** Health ${ass.health}/100 and every related sensor is normal. The only estimate is normal wear: roughly ${hours(ass.rulH)} (${hours(ass.rulLo)} to ${hours(ass.rulHi)}), based on age, not on a developing fault.`,
      { tools: ['asset_360'], sources: ['ML.V_LATEST_PRED'], assets: [a.id], confidence: 0.7,
        hi: `${a.id} theek chal raha hai; koi failure trend nahi hai (normal wear ke hisaab se ${Math.round(ass.rulH / 24)} din se zyada).` });
  }
  const failAt = C.S.simNow + ass.rulH * HOUR, early = C.S.simNow + ass.rulLo * HOUR;
  const lines = [`**${a.id} will probably fail in about ${hours(ass.rulH)}** (likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)}), around ${dateTime(failAt)}. The earliest likely failure is ${dateTime(early)}.`,
    `Failure confidence is ${confPct(ass.conf)}: ${ass.agree} related sensors agree and the trend is steady${ass.modeName ? ` (${lc(ass.modeName)})` : ''}. Health ${ass.health}/100.`];
  if (win) lines.push(`The ${wo.window ? 'planned' : 'proposed'} repair window, ${dateTime(win.start)} (${reasonText(win.reason)}), is ${windowVsFailure(win, early, failAt)}.${wo.status === 'PENDING_APPROVAL' ? ` Approve ${wo.id} on 5 · Work Orders so the part transfer starts.` : ''}`);
  lines.push('This is the model\'s estimate from the current trend; it tightens as new readings arrive every 15 minutes.');
  return out('rul', lines.join('\n\n'), { tools: ['asset_360', ...(win ? ['propose_window'] : [])], sources: ['ML.V_LATEST_PRED', 'RAW.TELEMETRY', ...(wo ? ['APP.WORK_ORDERS'] : [])], assets: [a.id], confidence: Math.min(0.9, 0.5 + 0.4 * ass.conf),
    hi: `**${a.id} lagbhag ${Math.round(ass.rulH)} ghante aur chalega** (${Math.round(ass.rulLo)} se ${Math.round(ass.rulHi)} ghante ke beech), yaani ${weekday(failAt)} ${day(failAt)} ke aas-paas tak. ${ass.mode ? cap(MODE_HI[ass.mode] || '') + '.' : ''}${wo && wo.status === 'PENDING_APPROVAL' ? ' Repair ka draft taiyaar hai; approval aapka.' : ''}` });
}

function costAnswer(C, a) {
  const { M, t } = C;
  const ass = M.assess(a, t);
  if (!ass.mode) return out('cost', `**Nothing is at stake on ${a.id} right now**: it has no developing fault (health ${ass.health}/100). If it stopped unplanned, its line loses ${inr(M.exposure(a, null).costPerH)} per hour.`, { tools: ['asset_360', 'plant_ops_analyst'], sources: ['ML.V_LATEST_PRED', 'SV_PLANT_OPS.OEE'], assets: [a.id] });
  const ex = M.exposure(a, ass.mode), pc = M.plannedCost(a, ass.mode), op = M.orderPressure(a.lineId, t);
  const lines = [`**About ${inr(ex.inr)} is at stake if ${a.id} breaks down unplanned**: ${hours(ex.downH)} down${ex.plan && ex.plan.kind !== 'local' ? ` (${ex.plan.etaH} h waiting for the part from ${cityOf(C, ex.plan.from)} + ${hh(FAILURE_MODES[ass.mode].repairH)} repair)` : ''} × ${inr(ex.costPerH)} per hour for the ${lineOf(C, a).name}.`,
    `A planned repair costs **${inr(pc.total)}** (part ${inr(pc.parts)} + labour ${inr(pc.labour)}).`];
  if (op.order) lines.push(`Order pressure: ${op.order.customer} order ${op.order.id} (${inr(op.order.valueInr)}) is due ${dateTime(op.order.due)}; the late penalty is ${inr(op.order.penaltyPerDay)} a day.`);
  return out('cost', lines.join('\n\n'), { tools: ['asset_360', 'plant_ops_analyst', 'check_spares'], sources: ['ML.V_LATEST_PRED', 'SV_PLANT_OPS.OEE', 'ERP.SPARES', 'ERP.SALES_ORDERS'], assets: [a.id], confidence: 0.9,
    hi: `${a.id} achanak band hua to lagbhag ${inr(ex.inr)} ka nuksan; planned repair sirf ${inr(pc.total)}.` });
}

function fixAnswer(C, a) {
  const r = windowAnswer(C, a);
  r.text = `I can't repair or release anything myself, but here is the plan a person can approve.\n\n` + r.text;
  r.intent = 'fix';
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Repair window, what-if
// ---------------------------------------------------------------------------------------------------------------
function windowAnswer(C, a) {
  const { M, t, S } = C;
  const ass = M.assess(a, t);
  if (!ass.mode) return out('window', `**${a.id} does not need a repair now** (health ${ass.health}/100, no developing fault). Keep it on its normal preventive-maintenance plan.`, { tools: ['asset_360'], sources: ['ML.V_LATEST_PRED'], assets: [a.id], confidence: 0.85 });
  const fm = FAILURE_MODES[ass.mode];
  const wo = woFor(C, a.id);
  const plan = M.partPlan(a, ass.mode);
  let win = wo && (wo.window || wo.proposedWindow), kind = wo && wo.window ? 'planned' : 'proposed';
  if (!win) { win = M.planWindow(S.simNow + ((plan ? plan.etaH : 0) + 1) * HOUR, ass.failAt, Math.max(4, Math.ceil(fm.repairH + 2))); kind = 'best'; }
  const early = S.simNow + ass.rulLo * HOUR, failAt = S.simNow + ass.rulH * HOUR;
  const lines = [`**The ${kind} repair window for ${a.id} is ${dateTime(win.start)} to ${time(win.end)} IST** (${reasonText(win.reason)}).`];
  lines.push(`- Part: ${plan ? `${plan.part.name}${plan.kind === 'transfer' ? `, ${plan.etaH} h transfer from ${cityOf(C, plan.from)}` : plan.kind === 'purchase' ? `, ${plan.part.leadDays} days from the supplier` : ', in stock locally'}` : 'none needed'}.\n- Work: about ${hh(fm.repairH)} per ${fm.sop}; the slot is longer to cover lock-out and the test run.\n- Timing: the window is ${windowVsFailure(win, early, failAt)}.`);
  if (wo) lines.push(wo.status === 'PENDING_APPROVAL' ? `${wo.id} is ${WO_STATUS[wo.status]} on **5 · Work Orders**; the part transfer starts only after approval.` : `${wo.id} is ${WO_STATUS[wo.status]}.`);
  return out('window', lines.join('\n\n'), { tools: ['propose_window', 'check_spares', 'asset_360'], sources: ['APP.WORK_ORDERS', 'ERP.SPARES', 'ERP.SALES_ORDERS', fm.sop], assets: [a.id], confidence: 0.9,
    hi: `${a.id} ka repair ${weekday(win.start)} ${day(win.start)} ${time(win.start)} baje sabse theek rahega (${reasonText(win.reason)}).` });
}

function whatIfAnswer(C, a) {
  const { M, t, S } = C;
  const ass = M.assess(a, t);
  const N = Math.max(0.25, Math.min(30, C.days ?? 3));
  const ex = M.exposure(a, ass.mode || null);
  const pc = ass.mode ? M.plannedCost(a, ass.mode) : null;
  const w = M.whatIf(ass.rulH, N, ex.inr);
  const op = M.orderPressure(a.lineId, t);
  const nTxt = N >= 1 ? plural(Math.round(N * 10) / 10, 'day') : `${Math.round(N * 24)} hours`;
  const lines = [];
  if (!ass.mode || ass.rulKind !== 'trend') {
    lines.push(`**Waiting ${nTxt} on ${a.id} is low-risk: about ${pct1(w.p)} chance of a failure in that time** (no developing fault, age-based wear only). Fit any work into the next planned stop.`);
  } else {
    lines.push(`**If we wait ${nTxt} to repair ${a.id}, there is a ${pct(w.p)} chance it fails first.** Expected loss ${inr(w.expectedLoss)} (${pct(w.p)} × ${inr(ex.inr)} at stake: ${hours(ex.downH)} down × ${inr(ex.costPerH)}/h).`);
    if (pc) lines.push(`A planned repair costs ${inr(pc.total)}, so waiting carries about ${Math.max(1, Math.round(w.expectedLoss / pc.total))}× more expected cost than repairing in a planned window.`);
    if (op.order && op.pressure > 0) lines.push(`${op.order.customer} order ${op.order.id} (${inr(op.order.valueInr)}) is due ${dateTime(op.order.due)}; a breakdown would also risk its ${inr(op.order.penaltyPerDay)}-a-day late penalty.`);
    const wo = woFor(C, a.id);
    lines.push(w.p >= 0.3
      ? `**Recommendation: do not wait.** ${wo && wo.status === 'PENDING_APPROVAL' ? `Approve ${wo.id} on 5 · Work Orders so the part moves now and the repair fits the proposed window.` : 'Repair in the first low-impact window.'}`
      : 'Waiting is acceptable if the repair fits the next planned stop.');
    lines.push('These odds come from the model\'s time-to-failure estimate; they are a planning aid, not a guarantee.');
  }
  const steps = [0, 1, 2, 3, 5, 7];
  if (!steps.includes(N)) steps.push(N);
  steps.sort((x, y) => x - y);
  const rows = steps.map(d => { const wi = M.whatIf(ass.rulH, d, ex.inr); return { hl: d === N, cells: [d === 0 ? 'Repair now' : `Wait ${plural(Math.round(d * 10) / 10, 'day')}`, pct(wi.p), inr(d === 0 && pc ? pc.total : wi.expectedLoss)] }; });
  return out('what_if', lines.join('\n\n'), { tools: ['asset_360', 'what_if_defer'], sources: ['ML.V_LATEST_PRED', 'ERP.SALES_ORDERS', 'ERP.SPARES'], assets: [a.id], confidence: 0.8,
    html: tbl(['Option', 'Chance it fails first', 'Expected cost'], rows, `What if we wait to repair ${a.id}`),
    hi: ass.rulKind === 'trend' ? `${nTxt.replace('days', 'din').replace('day', 'din')} rukenge to ${a.id} ke fail hone ka chance ${pct(w.p)} hai; nuksan ka andaza ${inr(w.expectedLoss)}.` : `${a.id} ke liye rukna theek hai; risk kam hai.` });
}

// ---------------------------------------------------------------------------------------------------------------
// Spares and stock
// ---------------------------------------------------------------------------------------------------------------
const PART_WORDS = [[/fan bearing|22320/, 'SP-002'], [/spindle bearing|bearing set|7014|\bbearings?\b/, 'SP-001'], [/insert/, 'SP-010'], [/\bbelts?\b/, 'SP-020'], [/coupling|shim/, 'SP-030'],
  [/balanc/, 'SP-040'], [/impeller|mechanical seal/, 'SP-060'], [/seal kit|hydraulic seal|\bseals?\b/, 'SP-050'], [/heater/, 'SP-070'], [/rewind|motor kit/, 'SP-080'], [/accelerometer|vibration sensor|\bsensors?\b/, 'SP-090']];
function findPart(C) {
  const m = C.q.match(/\bsp-?(\d{3})\b/);
  if (m) return C.W.parts.find(p => p.id === 'SP-' + m[1]) || null;
  for (const [rx, id] of PART_WORDS) if (rx.test(C.qi)) return C.W.parts.find(p => p.id === id);
  return null;
}
function inTransit(C, part) { return C.S.workOrders.filter(w => w.part && w.part.id === part.id && w.part.kind === 'transfer' && ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'].includes(w.status) && !w.partArrived); }

function sparesAnswer(C) {
  const a = C.asset || null;
  if (a) return sparesForAsset(C, a);
  const part = findPart(C);
  if (part) return stockAnswer(C, part);
  if (C.ctxAsset) return needAsset(C, 'spares', sparesForAsset);
  return lowStockAnswer(C);
}

function stockAnswer(C, part) {
  const { W, M } = C;
  const lines = [`**${part.id} ${part.name}: ${stockPhrase(C, part)}.** Reorder level ${part.reorder} per plant; supplier lead time ${part.leadDays} days.`];
  // machines that need this part now (an unrepaired fault whose failure mode uses it)
  const need = C.S.faults.filter(f => !f.repairedAt && FAILURE_MODES[f.mode] && FAILURE_MODES[f.mode].part === part.id)
    .map(f => ({ a: M.assetById(f.asset), plan: M.assetById(f.asset) && M.partPlan(M.assetById(f.asset), f.mode) }))
    .filter(x => x.a && x.plan && !inTransit(C, part).some(w => w.assetId === x.a.id));      // already on its way: said below
  for (const { a, plan } of need) {
    const here = cityOf(C, a.siteId);
    lines.push(plan.kind === 'local' ? `${a.id} in ${here} needs one, and it is in stock there.`
      : plan.kind === 'transfer' ? `${a.id} in ${here} needs one now. None in ${here}, so the fastest source is a road transfer from ${cityOf(C, plan.from)}: about ${plan.etaH} h, versus ${part.leadDays} days from the supplier.`
        : `${a.id} needs one, but no plant has it: order from the supplier (${part.leadDays} days) and expedite.`);
  }
  for (const w of inTransit(C, part)) lines.push(`One is already on its way for ${w.id} (${cityOf(C, w.part.from)} → ${cityOf(C, M.assetById(w.assetId).siteId)}, arrives ${dateTime(w.eta)}).`);
  if (part.id === 'SP-001') lines.push('The Chennai sets are from lot L-2477, which passed inspection; lot L-2391 is quarantined (supplier quality note NOTE-LOT).');
  const low = W.sites.filter(s => (part.stock[s.id] || 0) < part.reorder).map(s => s.city);
  if (low.length) lines.push(`Below reorder level at ${listJoin(low)}: a purchase request is needed, and a person approves it.`);
  const to = need[0] ? need[0].a.siteId : W.scenario.site;
  const rows = W.sites.map(s => ({ hl: (part.stock[s.id] || 0) > 0, cells: [s.city, String(part.stock[s.id] || 0), String(part.reorder), s.id === to ? 'here' : `${TRANSFER_H[s.id + '>' + to] ?? 72} h`] }));
  const n0 = need[0];
  return out('stock', lines.join('\n\n'), { tools: ['check_spares'], sources: ['ERP.SPARES', ...(part.id === 'SP-001' ? ['NOTE-LOT'] : [])], assets: need.map(x => x.a.id), confidence: 0.95,
    html: tbl(['Plant', 'In stock', 'Reorder level', `To ${cityOf(C, to)} by road`], rows, `${part.name} stock by plant`),
    hi: `${part.name}: ${W.sites.map(s => `${s.city} mein ${part.stock[s.id] || 0}`).join(', ')}.${n0 && n0.plan.kind === 'transfer' ? ` ${n0.a.id} ke liye ${cityOf(C, n0.plan.from)} se transfer mein lagbhag ${n0.plan.etaH} ghante lagenge.` : ''}` });
}

function sparesForAsset(C, a) {
  const { M, t, S } = C;
  const ass = M.assess(a, t);
  if (ass.state === 'sensor') {
    const p = C.W.parts.find(x => x.id === 'SP-090');
    return out('spares', `**${a.id} needs no repair parts: its reading is a sensor fault.** At most one vibration sensor (SP-090): ${stockPhrase(C, p)} (SOP-50).`, { tools: ['asset_360', 'check_spares'], sources: ['SOP-50', 'ERP.SPARES'], assets: [a.id], confidence: 0.9 });
  }
  if (!ass.mode) {
    const part = findPart(C);
    if (part) return stockAnswer(C, part);
    return out('spares', `**${a.id} has no developing fault, so no spares are needed now** (health ${ass.health}/100). Ask about a specific part (for example "Do we have the bearing in stock?") to see stock at every plant.`, { tools: ['asset_360'], sources: ['ML.V_LATEST_PRED'], assets: [a.id], confidence: 0.85 });
  }
  const fm = FAILURE_MODES[ass.mode];
  const plan = M.partPlan(a, ass.mode), pc = M.plannedCost(a, ass.mode);
  const wo = woFor(C, a.id);
  const win = wo && (wo.window || wo.proposedWindow);
  const readyAt = S.simNow + ((plan ? plan.etaH : 0)) * HOUR;
  const lines = [`**The ${a.id} repair (${fm.short}) needs one ${plan.part.name} (${plan.part.id}).** Stock: ${stockPhrase(C, plan.part)}.`];
  lines.push(plan.kind === 'local' ? `It is in stock in ${cityOf(C, a.siteId)}, so the repair can start as soon as it is approved.`
    : plan.kind === 'transfer' ? `None in ${cityOf(C, a.siteId)}: the plan moves one from ${cityOf(C, plan.from)} by road, about ${plan.etaH} h, so it could arrive ${dateTime(readyAt)} if released now.`
      : `No plant has one: order from the supplier (${plan.part.leadDays} days lead time) and expedite.`);
  if (plan.part.id === 'SP-001') lines.push('The Chennai stock is lot L-2477, which passed inspection (NOTE-LOT).');
  lines.push(`Work: ${sopName(fm.sop)}, about ${hh(fm.repairH)} with two technicians. Planned cost **${inr(pc.total)}** (part ${inr(pc.parts)} + labour ${inr(pc.labour)}).`);
  if (wo) lines.push(`${wo.id} already lists this part${win ? ` and the ${wo.window ? 'planned' : 'proposed'} window ${dateTime(win.start)}` : ''}; it is ${WO_STATUS[wo.status]}.`);
  return out('spares', lines.join('\n\n'), { tools: ['asset_360', 'check_spares', 'propose_window', 'maint_knowledge_search'], sources: ['ERP.SPARES', fm.sop, ...(plan.part.id === 'SP-001' ? ['NOTE-LOT'] : []), 'APP.WORK_ORDERS'], assets: [a.id], confidence: 0.93,
    hi: `${a.id} ke liye ek ${plan.part.name} chahiye; ${plan.kind === 'transfer' ? `${cityOf(C, plan.from)} se aane mein lagbhag ${plan.etaH} ghante` : plan.kind === 'local' ? 'stock mein hai' : 'supplier se mangwana padega'}.` });
}

function lowStockAnswer(C) {
  const low = [];
  for (const p of C.W.parts) for (const s of C.W.sites) if ((p.stock[s.id] || 0) < p.reorder) low.push({ p, s });
  const byPart = [...new Set(low.map(x => x.p))];
  const text = [`**${plural(byPart.length, 'spare part')} ${byPart.length === 1 ? 'is' : 'are'} below the reorder level somewhere.** Raising a purchase request needs a person's approval.`,
    byPart.slice(0, 8).map(p => `- ${p.id} ${p.name}: ${stockPhrase(C, p)} (reorder level ${p.reorder})`).join('\n'),
    'Name a part (for example "Do we have the bearing in stock?") or a machine for details.'].join('\n\n');
  return out('stock', text, { tools: ['check_spares'], sources: ['ERP.SPARES'], confidence: 0.9, hi: 'Kuch spares reorder level se neeche hain; list neeche hai.' });
}

// ---------------------------------------------------------------------------------------------------------------
// OEE, shift, MTBF, induced failures
// ---------------------------------------------------------------------------------------------------------------
function oeeScope(C) {
  const prod = C.lines.filter(l => !l.utility);
  if (prod.length) return { kind: 'line', line: prod[0] };
  if (C.lines.length) return { kind: 'utility', line: C.lines[0] };
  if (C.asset) { const l = lineOf(C, C.asset); return l.utility ? { kind: 'site', siteId: l.siteId } : { kind: 'line', line: l }; }
  return { kind: 'site', siteId: C.site || C.W.scenario.site };
}
function lossRank(losses) { return Object.entries(losses).filter(([k]) => k !== 'planned').sort((x, y) => y[1] - x[1]); }

function oeeAnswer(C) {
  const { M, W, t } = C;
  const days = Math.max(1, Math.min(30, Math.round(C.days ?? 7)));
  const span = days === 1 ? 'the last day' : `the last ${days} days`;
  const sc = oeeScope(C);
  if (sc.kind === 'utility') return out('oee', `**${sc.line.name} (${cityOf(C, sc.line.siteId)}) has no OEE**: utilities feed the production lines but do not make parts, so there is no count to measure. Ask about a production line, for example the ${W.lines.find(l => l.siteId === sc.line.siteId && !l.utility).name}.`, { tools: ['plant_ops_analyst'], sources: ['OEE-DEF'], confidence: 0.9 });
  if (sc.kind === 'line') {
    const l = sc.line, o = M.lineOee(l.id, days, t);
    if (!o) return out('oee', `No OEE rows for the ${l.name} in ${span}.`, { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE'], confidence: 0.6 });
    const lr = lossRank(o.losses), tot = lr.reduce((s, [, v]) => s + v, 0);
    const [bk, bv] = lr[0];
    const weakest = [['availability', o.availability], ['performance', o.performance], ['quality', o.quality]].sort((x, y) => x[1] - y[1])[0];
    const lines = [`**OEE for the ${l.name} (${cityOf(C, l.siteId)}) over ${span}: ${pct1(o.oee)}** = availability ${pct1(o.availability)} × performance ${pct1(o.performance)} × quality ${pct1(o.quality)}. That is ${num((0.85 - o.oee) * 100, 1)} points ${o.oee < 0.85 ? 'below' : 'above'} the 85 % world-class mark.`,
      `**Biggest loss: ${LOSS[bk]}, ${num(bv, 1)} h** of ${num(tot, 1)} h lost (${Math.round(bv / tot * 100)} %). Next: ${LOSS[lr[1][0]]} ${num(lr[1][1], 1)} h and ${LOSS[lr[2][0]]} ${num(lr[2][1], 1)} h.`,
      `Planned maintenance took another ${num(o.losses.planned, 1)} h; that is planned downtime, so it is not counted as a loss. The weakest factor is ${weakest[0]} (${pct1(weakest[1])}).`];
    const hero = W.scenario.hero && M.assetById(W.scenario.hero);
    if (hero && hero.lineId === l.id) {
      const ha = M.assess(hero, t);
      if (ha.mode && ha.state === 'act') { const ex = M.exposure(hero, ha.mode); lines.push(`${hero.id} runs on this line: an unplanned ${FAILURE_MODES[ha.mode].short} failure would add about ${hours(ex.downH)} of breakdown (${inr(ex.inr)}).`); }
    }
    const rows = [...lr.map(([k, v], i) => ({ hl: i === 0, cells: [cap(LOSS[k]), num(v, 1), `${Math.round(v / tot * 100)} %`] })), { cells: ['Planned maintenance (not a loss)', num(o.losses.planned, 1), '—'] }];
    return out('oee', lines.join('\n\n'), { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE', 'OEE-DEF'], confidence: 0.95, assets: hero && hero.lineId === l.id ? [hero.id] : [],
      html: tbl(['Loss', 'Hours', 'Share'], rows, `Losses on the ${l.name}, ${span}`),
      hi: `${l.short} line ka OEE ${span === 'the last 7 days' ? 'is hafte' : span.replace('the last', 'pichhle').replace('days', 'din')} ${pct1(o.oee)} raha; sabse bada nuksan ${LOSS[bk]} se (${num(bv, 1)} ghante).` });
  }
  const site = M.siteById(sc.siteId);
  const so = M.siteOee(site.id, days, t);
  if (!so) return out('oee', `No OEE rows for ${site.name} in ${span}.`, { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE'], confidence: 0.6 });
  const per = W.lines.filter(l => l.siteId === site.id && !l.utility).map(l => ({ l, o: M.lineOee(l.id, days, t) })).filter(x => x.o).sort((x, y) => x.o.oee - y.o.oee);
  const lr = lossRank(so.losses), tot = lr.reduce((s, [, v]) => s + v, 0);
  const lines = [`**${site.name} OEE over ${span}: ${pct1(so.oee)}** (availability ${pct1(so.availability)} × performance ${pct1(so.performance)} × quality ${pct1(so.quality)}), ${num((0.85 - so.oee) * 100, 1)} points below the 85 % world-class mark.`,
    `Weakest line: **${per[0].l.name} ${pct1(per[0].o.oee)}**; best: ${per[per.length - 1].l.name} ${pct1(per[per.length - 1].o.oee)}.`,
    `**Biggest loss across the plant: ${LOSS[lr[0][0]]}, ${num(lr[0][1], 1)} h** of ${num(tot, 1)} h lost. Planned maintenance (${num(so.losses.planned, 1)} h) is not counted as a loss.`];
  const rows = per.map(x => ({ hl: x === per[0], cells: [x.l.name, pct1(x.o.oee), pct1(x.o.availability), pct1(x.o.performance), pct1(x.o.quality)] }));
  return out('oee', lines.join('\n\n'), { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE', 'OEE-DEF'], confidence: 0.95,
    html: tbl(['Line', 'OEE', 'Avail.', 'Perf.', 'Quality'], rows, `OEE by line at ${site.name}`),
    hi: `${site.city} plant ka OEE ${pct1(so.oee)} hai; sabse kamzor line ${per[0].l.short} (${pct1(per[0].o.oee)}).` });
}

const SHIFT_NAME = { A: 'shift A (morning, 06:00-14:00)', B: 'shift B (evening, 14:00-22:00)', C: 'shift C (night, 22:00-06:00)' };
function shiftAnswer(C) {
  const { W, t } = C;
  const days = Math.max(1, Math.min(30, Math.round(C.days ?? 30)));
  let lines = C.lines.filter(l => !l.utility);
  if (!lines.length && C.asset) lines = [lineOf(C, C.asset)].filter(l => !l.utility);
  const siteId = C.site || (lines[0] && lines[0].siteId) || W.scenario.site;
  const allSites = /all (plants|sites)|every plant|fleet|company/.test(C.q);
  if (!lines.length) lines = W.lines.filter(l => !l.utility && (allSites || l.siteId === siteId));
  const from = t - days * DAY;
  const stat = lines.map(l => {
    const rows = W.oee.filter(r => r.lineId === l.id && r.date > from);
    const m = s => rows.reduce((a, r) => a + r.shifts.find(x => x.shift === s).oee, 0) / Math.max(1, rows.length);
    return { l, A: m('A'), B: m('B'), C: m('C'), n: rows.length };
  }).filter(x => x.n);
  if (!stat.length) return out('shift', 'No shift data in that window.', { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE'], confidence: 0.5 });
  const avg = k => stat.reduce((a, x) => a + x[k], 0) / stat.length;
  const means = { A: avg('A'), B: avg('B'), C: avg('C') };
  const order = Object.entries(means).sort((x, y) => y[1] - x[1]);
  const [best, bestV] = order[0], [worst, worstV] = order[2];
  const gap = (bestV - worstV) * 100;
  const consistent = stat.every(x => ['A', 'B', 'C'].sort((p, q) => x[p] - x[q])[0] === worst);
  const scope = allSites ? `all ${plural(stat.length, 'production line')}` : stat.length === 1 ? `the ${stat[0].l.name}` : `the ${stat.length} ${cityOf(C, siteId)} lines`;
  const text = [`**Yes: ${SHIFT_NAME[worst]} runs about ${num(gap, 1)} points lower OEE than ${SHIFT_NAME[best]}** across ${scope} over the last ${days} days (A ${pct1(means.A)}, B ${pct1(means.B)}, C ${pct1(means.C)}).`,
    consistent ? `The gap shows on every line, so it is a shift pattern, not one bad line.` : 'The gap is not the same on every line; see the table.',
    `The data records the loss, not its reason. Common causes to check on the ${worst === 'C' ? 'night' : 'weaker'} shift: thinner crews, slower changeovers and fewer supervisors.`].join('\n\n');
  const rows = stat.map(x => ({ cells: [x.l.name, pct1(x.A), pct1(x.B), pct1(x.C), `${num((Math.max(x.A, x.B, x.C) - Math.min(x.A, x.B, x.C)) * 100, 1)} pts`] }));
  return out('shift', text, { tools: ['plant_ops_analyst'], sources: ['SV_PLANT_OPS.OEE'], confidence: 0.9,
    html: tbl(['Line', 'Shift A', 'Shift B', 'Shift C', 'Gap'], rows, 'OEE by shift'),
    hi: `Haan, ${worst === 'C' ? 'raat ki shift (C)' : 'shift ' + worst} ka OEE lagbhag ${num(gap, 1)} point kam hai.` });
}

// ---------- v1.1: preventive jobs, peer comparison, business case ----------
function pmAnswer(C) {
  const { W, M } = C;
  const plan = pmPlan(C.S.simNow);
  const a = C.asset || null;
  const scope = a ? plan.filter(r => r.assetId === a.id) : C.lines.length ? plan.filter(r => C.lines.some(l => l.id === r.lineId))
    : plan.filter(r => r.siteId === (C.site || W.scenario.site));
  const scopeName = a ? a.id : C.lines.length ? `the ${C.lines[0].name}` : cityOf(C, C.site || W.scenario.site);
  const overdue = scope.filter(r => r.overdue && !r.scheduled).sort((x, y) => x.daysToDue - y.daysToDue);
  const soon = scope.filter(r => !r.overdue && r.daysToDue <= 14 && !r.scheduled).sort((x, y) => x.daysToDue - y.daysToDue);
  const booked = scope.filter(r => r.scheduled);
  const lines = [];
  if (a) {
    const r = scope[0];
    lines.push(r.scheduled ? `**${a.id}'s preventive job is booked: ${r.scheduled.id}, ${dateTime((r.scheduled.window || r.scheduled.proposedWindow).start)}.**`
      : r.overdue ? `**${a.id}'s preventive maintenance is overdue by ${Math.round(-r.daysToDue)} days** (last done ${dateTime(r.last)}, every ${r.interval} days).`
      : `**${a.id}'s next preventive job is due in ${Math.round(r.daysToDue)} days** (last done ${dateTime(r.last)}, every ${r.interval} days).`);
  } else {
    lines.push(overdue.length ? `**${plural(overdue.length, 'preventive job')} overdue at ${scopeName}**, ${plural(soon.length, 'more')} due in the next 14 days, ${booked.length} already booked.`
      : `**No preventive jobs are overdue at ${scopeName}.** ${plural(soon.length, 'job')} due in the next 14 days, ${booked.length} already booked.`);
    if (overdue.length) lines.push('Most overdue:\n' + overdue.slice(0, 5).map(r => `- ${r.assetId} (${M.assetById(r.assetId).name}): overdue by ${Math.round(-r.daysToDue)} days`).join('\n'));
  }
  // opportunistic maintenance: do due jobs on a line that is stopping anyway
  const stops = C.S.workOrders.filter(w => w.kind !== 'PM' && !['DONE', 'REJECTED'].includes(w.status));
  const tips = [];
  for (const w of stops) {
    const line = M.assetById(w.assetId).lineId, win = w.window || w.proposedWindow;
    const fit = plan.filter(r => r.lineId === line && r.assetId !== w.assetId && !r.scheduled && (r.overdue || r.daysToDue <= 14) && (!a || r.assetId === a.id));
    for (const r of fit.slice(0, 2)) tips.push(`- ${r.assetId} ${r.overdue ? `(overdue by ${Math.round(-r.daysToDue)} days)` : `(due in ${Math.round(r.daysToDue)} days)`} can be done in the ${w.assetId} stop on ${dateTime(win.start)}: the line is stopped anyway, so it saves about ${inr(2 * M.lineById(line).costPerH)} of extra downtime.`);
  }
  if (tips.length) lines.push(`**Fit ${a ? 'it' : 'them'} into a stop that is already planned:**\n` + tips.slice(0, 4).join('\n'));
  lines.push('A person books them on the **Maintenance calendar** page; I only suggest.');
  return out('pm', lines.join('\n\n'), { tools: ['plant_ops_analyst', 'propose_window'], sources: ['CMMS.WORK_ORDERS', 'APP.WORK_ORDERS'], assets: a ? [a.id] : overdue.slice(0, 3).map(r => r.assetId), confidence: 0.9,
    hi: overdue.length ? `${scopeName} mein ${overdue.length} preventive kaam overdue hain.` : `${scopeName} mein koi preventive kaam overdue nahi hai.` });
}

function peerAnswer(C, a) {
  const { W, M, t } = C;
  const peers = W.assets.filter(x => x.name === a.name && x.id !== a.id);
  if (!peers.length) return out('peer', `**${a.id} (${a.name}) has no identical sibling** in the three plants, so I cannot compare it like for like. The **Compare machines** page can still compare it with machines of the same class.`, { tools: ['asset_360'], sources: ['CORE.FACT_TELEMETRY_15M'], assets: [a.id], confidence: 0.8 });
  const ass = M.assess(a, t);
  const key = (ass.contributions && ass.contributions[0] && ass.contributions[0].key) || a.tags[0].key;
  const tag = a.tags.find(x => x.key === key);
  const v = M.trendAt(a, key, t);
  const pv = peers.filter(p => p.tags.some(x => x.key === key)).map(p => ({ p, v: M.trendAt(p, key, t), st: M.assess(p, t).state }));
  const mean = pv.reduce((s, x) => s + x.v, 0) / Math.max(1, pv.length);
  const ratio = tag.dir === 'low' ? mean / Math.max(1e-6, v) : v / Math.max(1e-6, mean);
  const peersNormal = pv.every(x => x.st === 'normal');
  const lines = [`**${a.id}'s ${tag.label.charAt(0).toLowerCase() + tag.label.slice(1)} is ${num(v, tag.d)} ${tag.unit}; its ${plural(pv.length, 'identical sibling')} average ${num(mean, tag.d)} ${tag.unit}${ratio >= 1.3 ? ` (${ratio.toFixed(1)}× ${tag.dir === 'low' ? 'lower' : 'higher'})` : ''}.**`];
  lines.push(pv.map(x => `- ${x.p.id} (${M.siteById(x.p.siteId).city}): ${num(x.v, tag.d)} ${tag.unit}, ${x.st === 'normal' ? 'normal' : x.st}`).join('\n'));
  lines.push(ratio >= 1.3 && peersNormal ? `Identical machines doing the same work are normal, so **the problem is ${a.id} itself, not the process, the material or the coolant**.`
    : ratio < 1.3 ? `${a.id} behaves like its siblings on this sensor.` : `Some siblings are abnormal too, so check shared causes (process, material, utilities) as well.`);
  return out('peer', lines.join('\n\n'), { tools: ['asset_360', 'plant_ops_analyst'], sources: ['CORE.FACT_TELEMETRY_15M', 'ML.V_LATEST_PRED'], assets: [a.id, ...pv.map(x => x.p.id)], confidence: 0.88,
    hi: ratio >= 1.3 && peersNormal ? `${a.id} apne jaise baaki machines se alag hai: problem machine mein hai, process mein nahi.` : `${a.id} apne jaise machines jaisa hi chal raha hai.` });
}

function roiAnswer(C) {
  const { W, M } = C;
  const bt = M.backtestAt(C.S.threshold ?? 0.6);
  const perYear = Math.round(W.backtest.episodes.length * 365 / W.backtest.windowDays);
  const hero = W.scenario.hero ? M.assetById(W.scenario.hero) : null;
  const hAss = hero ? M.assess(hero, C.t) : null;
  const lines = [`**In the sample plant about ${perYear} failures a year reach the model, and it caught ${Math.round(bt.recall * 100)} % of them a median ${Math.round(bt.medianLead)} h ahead** (back-test: ${bt.detected} of ${bt.total} in ${W.backtest.windowDays} days).`];
  if (hero && hAss && hAss.mode && hAss.state === 'act') {
    const ex = M.exposure(hero, hAss.mode), pc = M.plannedCost(hero, hAss.mode);
    lines.push(`One example: catching ${hero.id} early turns a ${inr(ex.inr)} breakdown into a ${inr(pc.total)} planned repair.`);
  }
  const saved = (C.S.savings || []).reduce((s, x) => s + x.avoidedInr, 0);
  if (saved) lines.push(`Repairs done in this session have already avoided ${inr(saved)} of unplanned downtime.`);
  lines.push(`The yearly saving and payback depend on your own costs, so they are on the **Business case** page: it starts from cautious industry-typical numbers, one button switches to these sample-plant numbers (a failure-heavy plant, so the saving is large), and every input can be changed. It is an illustrative model, not a quote.`);
  return out('roi', lines.join('\n\n'), { tools: ['plant_ops_analyst'], sources: ['ML.BACKTEST', 'SV_PLANT_OPS.OEE'], confidence: 0.8,
    hi: `Sample plant mein model ne ${Math.round(bt.recall * 100)} % failures ${Math.round(bt.medianLead)} ghante pehle pakdi.` });
}

function mtbfAnswer(C) {
  const { W, M } = C;
  const a = C.asset || (C.ctxAsset && !C.lines.length && !C.site ? M.assetById(C.ctxAsset) : null);
  const cmOf = id => W.history.filter(h => h.assetId === id && h.type === 'CM');
  if (a) {
    const cms = cmOf(a.id), pms = W.history.filter(h => h.assetId === a.id && h.type === 'PM');
    const lines = [];
    if (cms.length) {
      const mtbf = HISTORY_DAYS / cms.length, mttr = cms.reduce((s, h) => s + h.durationH, 0) / cms.length;
      const modes = [...new Set(cms.map(h => FAILURE_MODES[h.mode].short))];
      lines.push(`**MTBF of ${a.id}: about ${Math.round(mtbf)} days** (${plural(cms.length, 'breakdown')} in the last ${HISTORY_DAYS} days, ${listJoin(modes)}). **MTTR: ${hours(mttr)}** (average repair time of those breakdowns).`);
      const ass = M.assess(a, C.t);
      if (ass.mode && ass.state === 'act') {
        const ex = M.exposure(a, ass.mode);
        lines.push(`If the current ${FAILURE_MODES[ass.mode].short} becomes a breakdown, it would take about ${hours(ex.downH)} to recover${ex.plan && ex.plan.kind !== 'local' ? ` (mostly waiting ${ex.plan.etaH} h for the part)` : ''}, which would push MTTR to about ${hours((cms.reduce((s, h) => s + h.durationH, 0) + ex.downH) / (cms.length + 1))}. A planned repair avoids that.`);
      }
      if (cms.length < 3) lines.push(`With only ${plural(cms.length, 'failure')} this is a rough figure.`);
    } else lines.push(`**${a.id} had no breakdowns in the last ${HISTORY_DAYS} days, so its MTBF is more than ${HISTORY_DAYS} days** (too few failures for an exact figure; MTTR cannot be computed).`);
    lines.push(`Preventive maintenance in the same period: ${plural(pms.length, 'visit')}.`);
    return out('mtbf', lines.join('\n\n'), { tools: ['plant_ops_analyst', 'asset_360'], sources: ['CMMS.WORK_ORDERS'], assets: [a.id], confidence: cms.length >= 2 ? 0.85 : 0.7,
      hi: cms.length ? `${a.id} ka MTBF lagbhag ${Math.round(HISTORY_DAYS / cms.length)} din hai, MTTR ${hours(cms.reduce((s, h) => s + h.durationH, 0) / cms.length)}.` : `${a.id} pichhle ${HISTORY_DAYS} din mein ek baar bhi kharab nahi hua.` });
  }
  // fleet / site / line view
  const scopeAssets = C.lines.length ? W.assets.filter(x => C.lines.some(l => l.id === x.lineId)) : C.site ? W.assets.filter(x => x.siteId === C.site) : W.assets;
  const scopeName = C.lines.length ? `the ${C.lines[0].name}` : C.site ? cityOf(C, C.site) : 'all three plants';
  const cms = scopeAssets.flatMap(x => cmOf(x.id));
  const byAsset = scopeAssets.map(x => ({ a: x, n: cmOf(x.id).length })).filter(x => x.n).sort((x, y) => y.n - x.n);
  const lines = [cms.length
    ? `**${plural(cms.length, 'breakdown')} across ${scopeName} (${plural(scopeAssets.length, 'machine')}) in the last ${HISTORY_DAYS} days: a fleet MTBF of about ${Math.round(scopeAssets.length * HISTORY_DAYS / cms.length).toLocaleString('en-IN')} machine-days.** MTTR ${hours(cms.reduce((s, h) => s + h.durationH, 0) / cms.length)}.`
    : `**No breakdowns across ${scopeName} in the last ${HISTORY_DAYS} days**, so MTBF is above ${HISTORY_DAYS} days for every machine.`];
  if (byAsset.length) lines.push('Machines with breakdowns:\n' + byAsset.slice(0, 6).map(x => `- ${x.a.id}: ${plural(x.n, 'breakdown')}, MTBF about ${Math.round(HISTORY_DAYS / x.n)} days`).join('\n'));
  lines.push('Ask "What is the MTBF of <machine>?" for one machine.');
  return out('mtbf', lines.join('\n\n'), { tools: ['plant_ops_analyst'], sources: ['CMMS.WORK_ORDERS'], confidence: 0.85, assets: byAsset.map(x => x.a.id).slice(0, 3),
    hi: `${scopeName} mein pichhle ${HISTORY_DAYS} din mein ${cms.length} breakdown hue.` });
}

function inducedAnswer(C) {
  const { W } = C;
  const now = C.S.simNow;
  const cms = W.history.filter(h => h.type === 'CM'), pms = W.history.filter(h => h.type === 'PM');
  const hits = [];
  for (const c of cms) {
    const pm = pms.filter(p => p.assetId === c.assetId && p.date < c.date && c.date - p.date <= 7 * DAY).sort((x, y) => y.date - x.date)[0];
    if (pm) hits.push({ c, pm, gap: (c.date - pm.date) / DAY });
  }
  const lines = [];
  if (!hits.length) {
    lines.push(`**None found.** In the last ${HISTORY_DAYS} days there were ${plural(cms.length, 'breakdown')} and ${plural(pms.length, 'preventive maintenance visit')}; no breakdown came within 7 days after preventive maintenance on the same machine, so there is no sign of maintenance-induced failures.`);
    const gaps = cms.map(c => { const pm = pms.filter(p => p.assetId === c.assetId && p.date < c.date).sort((x, y) => y.date - x.date)[0]; return pm ? { c, gap: (c.date - pm.date) / DAY } : null; }).filter(Boolean).sort((x, y) => x.gap - y.gap);
    if (gaps.length) lines.push(`The closest case: ${gaps[0].c.assetId} broke down (${FAILURE_MODES[gaps[0].c.mode].short}, ${gaps[0].c.id}) ${Math.round(gaps[0].gap)} days after its last preventive maintenance.`);
  } else {
    lines.push(`**${plural(hits.length, 'breakdown')} came within 7 days after preventive maintenance** on the same machine, a sign the maintenance itself may have caused ${hits.length === 1 ? 'it' : 'them'}:`);
    lines.push(hits.map(h => `- ${h.c.assetId}: ${FAILURE_MODES[h.c.mode].short} (${h.c.id}) ${num(h.gap, 1)} days after ${h.pm.id}, ${daysAgo(h.c.date, now)} days ago`).join('\n'));
    lines.push('Check reassembly, torque and lubrication steps in those PM jobs.');
  }
  return out('induced', lines.join('\n\n'), { tools: ['plant_ops_analyst'], sources: ['CMMS.WORK_ORDERS'], confidence: 0.9, assets: hits.map(h => h.c.assetId),
    hi: hits.length ? `${hits.length} breakdown PM ke 7 din ke andar hue.` : 'Aisa koi breakdown nahi mila jo PM ke 7 din ke andar hua ho.' });
}

// ---------------------------------------------------------------------------------------------------------------
// Heat, energy
// ---------------------------------------------------------------------------------------------------------------
function heatAnswer(C) {
  const { W, M, t } = C;
  const allSites = /all (plants|sites)|every plant|fleet|company/.test(C.q);
  const siteId = C.site || W.scenario.site;
  const pool = W.assets.filter(a => allSites || a.siteId === siteId);
  const rows = [];
  for (const a of pool) {
    const tag = ['BEARING_TEMP', 'OIL_TEMP', 'OUTLET_TEMP'].map(k => M.tagOf(a, k)).find(Boolean);
    if (!tag) continue;
    const now = M.trendAt(a, tag.key, t), past = M.trendAt(a, tag.key, t - 72 * HOUR);
    rows.push({ a, tag, now, past, rise: now - past, ass: M.assess(a, t) });
  }
  const rising = rows.filter(r => r.rise > 1.5).sort((x, y) => y.rise - x.rise);
  // normal swing with load, from healthy machines over the last 7 days (sampled hourly)
  const healthy = rows.filter(r => !r.ass.mode && r.ass.state === 'normal').slice(0, 12);
  const sh = { A: [], B: [], C: [] };
  for (const r of healthy) for (let h = 0; h < 168; h += 1) {
    const ts = t - h * HOUR, hh = new Date(ts + 5.5 * HOUR).getUTCHours();
    const s = hh >= 6 && hh < 14 ? 'A' : hh >= 14 && hh < 22 ? 'B' : 'C';
    sh[s].push(M.smoothAt(r.a, r.tag.key, ts) - r.tag.base);
  }
  const mean = arr => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);
  const dB = mean(sh.B) - mean(sh.A), dC = mean(sh.C) - mean(sh.A);
  const where = allSites ? 'all three plants' : cityOf(C, siteId);
  const lines = [];
  if (rising.length) {
    lines.push(`**In this data, heat is a symptom, not the cause.** The only machines in ${where} whose temperature is rising are the ones with a developing fault:`);
    lines.push(rising.slice(0, 5).map(r => `- ${r.a.id}: ${lc(r.tag.label)} up ${num(r.rise, 1)} °C in three days (${fmtTag(r.tag, r.past)} → ${fmtTag(r.tag, r.now)} °C, alarm ${r.tag.alarm} °C)${r.ass.modeName ? `, with ${lc(r.ass.modeName)}` : ''}`).join('\n'));
    lines.push(`The other ${plural(rows.length - rising.length, 'machine')} with a temperature sensor are flat. In bearing wear, friction heats the bearing, so the temperature rise follows the damage (the VMC manual expects 10-20 °C before seizure).`);
  } else lines.push(`**No machine in ${where} has a rising temperature.** All ${plural(rows.length, 'temperature sensor')} are flat over three days, and no failure is developing.`);
  lines.push(`Normal temperature follows load: the evening shift runs about ${num(Math.abs(dB), 1)} °C ${dB >= 0 ? 'warmer' : 'cooler'} and the night shift about ${num(Math.abs(dC), 1)} °C ${dC >= 0 ? 'warmer' : 'cooler'} than the morning shift, well inside the limits.`);
  lines.push('I can\'t link failures to hot weather: the sample data has no outdoor (ambient) temperature reading.');
  return out('heat', lines.join('\n\n'), { tools: ['plant_ops_analyst', 'asset_360', 'maint_knowledge_search'], sources: ['RAW.TELEMETRY', 'MAN-VMC', 'ML.V_LATEST_PRED'], confidence: 0.7, assets: rising.map(r => r.a.id).slice(0, 3),
    hi: rising.length ? `Garmi wajah nahi, lakshan hai: sirf ${rising[0].a.id} jaisi kharab machine ka temperature badh raha hai.` : 'Kisi machine ka temperature nahi badh raha.' });
}

function energyAnswer(C) {
  const { W, M, t } = C;
  const allSites = !C.site && !C.lines.length && !C.asset;
  const pool = C.asset ? [C.asset] : C.lines.length ? W.assets.filter(a => C.lines.some(l => l.id === a.lineId)) : C.site ? W.assets.filter(a => a.siteId === C.site) : W.assets;
  const where = C.asset ? C.asset.id : C.lines.length ? `the ${C.lines[0].name}` : C.site ? cityOf(C, C.site) : 'all three plants';
  const whereIn = (allSites ? 'across ' : 'in ') + where;
  const rows = [];
  for (const a of pool) {
    const tag = M.tagOf(a, 'POWER_KW');
    if (!tag) continue;
    const now = M.trendAt(a, 'POWER_KW', t), extra = now - tag.base;
    if (extra / tag.base < 0.03) continue;
    let kwh = 0, sinceH = 24 * 14;
    for (let h = 0; h < 24 * 14; h++) { const e = M.trendAt(a, 'POWER_KW', t - h * HOUR) - tag.base; if (e / tag.base < 0.005) { sinceH = h; break; } kwh += e * RUN_H_PER_DAY / 24; }
    const cur = M.tagOf(a, 'MOTOR_CURRENT');
    rows.push({ a, base: tag.base, now, extra, kwhDay: extra * RUN_H_PER_DAY, sinceH, kwh, cur: cur ? M.trendAt(a, 'MOTOR_CURRENT', t) / cur.base - 1 : null, ass: M.assess(a, t) });
  }
  rows.sort((x, y) => y.kwhDay - x.kwhDay);
  const nPool = pool.filter(a => M.tagOf(a, 'POWER_KW')).length;
  const lines = [];
  if (!rows.length) {
    lines.push(`**No machine ${whereIn} is drawing more power than its healthy baseline** (all ${plural(nPool, 'machine')} within 3 %). Nothing is wasting energy because of wear right now.`);
  } else {
    const top = rows[0];
    const totDay = rows.reduce((s, r) => s + r.kwhDay, 0);
    lines.push(`**${plural(rows.length, 'machine')} ${rows.length === 1 ? 'is' : 'are'} drawing more power than ${rows.length === 1 ? 'its' : 'their'} healthy baseline ${whereIn}: ${top.a.id} uses ${num(top.extra, 1)} kW extra (+${Math.round(top.extra / top.base * 100)} %)**${top.ass.modeName ? ` because of ${lc(top.ass.modeName)}` : ''}.`);
    lines.push(rows.slice(0, 5).map(r => `- ${r.a.id}: ${num(r.base, 1)} → ${num(r.now, 1)} kW${r.cur != null ? `, motor current +${Math.round(r.cur * 100)} %` : ''}; about ${num(r.kwhDay, 0)} kWh a day = **${inr(r.kwhDay * RS_PER_KWH)} a day** at Rs ${RS_PER_KWH}/kWh; about ${num(r.kwh, 0)} kWh (${inr(r.kwh * RS_PER_KWH)}) since the rise began ${hours(r.sinceH)} ago`).join('\n'));
    const curTop = rows.find(r => r.cur != null && r.ass.mode === 'FM-01');
    lines.push(`Together: ${num(totDay, 0)} kWh a day. That is small money next to a breakdown, but it is an early, independent sign of the same fault${curTop ? `: the energy note ENERGY-01 expects a worn bearing to raise motor current 5-15 %, and ${curTop.a.id} is at +${Math.round(curTop.cur * 100)} %` : ''}. The other ${plural(nPool - rows.length, 'machine')} are at their baseline.`);
  }
  const tableRows = rows.slice(0, 6).map(r => ({ cells: [r.a.id, num(r.base, 1), num(r.now, 1), num(r.kwhDay, 0), inr(r.kwhDay * RS_PER_KWH)] }));
  return out('energy', lines.join('\n\n'), { tools: ['plant_ops_analyst', 'asset_360'], sources: ['SV_PLANT_OPS.ENERGY', 'ENERGY-01'], confidence: 0.85, assets: rows.map(r => r.a.id).slice(0, 3),
    ...(rows.length ? { html: tbl(['Machine', 'Baseline kW', 'Now kW', 'Extra kWh/day', 'Extra Rs/day'], tableRows, 'Machines drawing more power than baseline') } : {}),
    hi: rows.length ? `${rows[0].a.id} roz lagbhag ${num(rows[0].kwhDay, 0)} kWh zyada bijli kha raha hai (${inr(rows[0].kwhDay * RS_PER_KWH)} roz).` : 'Koi machine zyada bijli nahi kha rahi.' });
}

// ---------------------------------------------------------------------------------------------------------------
// Supplier lot, alerts, help, clarify, out of scope
// ---------------------------------------------------------------------------------------------------------------
function lotAnswer(C) {
  const { M, t } = C;
  const asked = (C.q.match(/\bl-?\s?(\d{4})\b/) || [])[1];
  const note = DOCS.find(d => d.id === 'NOTE-LOT');
  const st = id => { const a = M.assetById(id); const ass = a && M.assess(a, t); return ass ? `${id} ${ass.state === 'normal' ? `is running normally now (health ${ass.health})` : `is ${STATE_WORD[ass.state]} (health ${ass.health})`}` : id; };
  const lines = [];
  if (asked && asked !== '2391' && asked !== '2477') {
    lines.push(`**I have no record of lot L-${asked}.** The only lots in the quality notes are L-2391 (quarantined) and L-2477 (passed).`);
  } else {
    lines.push(`**Lot L-2391 is linked to two early spindle-bearing failures earlier this year, on VMC-201 and HOB-302** (bearing cage hardness out of spec). The lot is quarantined.`);
    lines.push(`- ${st('VMC-201')}; ${st('HOB-302')}.\n- The spare bearing sets in Chennai are from lot L-2477, which passed inspection, so they are safe to use.`);
    const hero = C.W.scenario.hero && M.assetById(C.W.scenario.hero);
    const ha = hero && M.assess(hero, t);
    if (hero && ha.mode === 'FM-01') lines.push(`The data does not show ${hero.id}'s bearings coming from lot L-2391, so I am not blaming the lot for ${hero.id}: its evidence points to bearing wear on its own (rising vibration and temperature, all related sensors agreeing).`);
  }
  return out('lot', lines.join('\n\n'), { tools: ['maint_knowledge_search', 'check_spares'], sources: ['NOTE-LOT', 'ERP.SPARES'], confidence: note ? 0.92 : 0.5, assets: ['VMC-201', 'HOB-302'],
    hi: 'Lot L-2391 ki wajah se VMC-201 aur HOB-302 ke bearing jaldi kharab hue the; lot quarantine mein hai.' });
}

function alertsAnswer(C) {
  const { M } = C;
  const allSites = !C.site;
  const R = ranked(C).filter(x => allSites || x.a.siteId === C.site);
  const open = C.S.alerts.filter(a => a.status !== 'CLOSED');
  const withAlert = R.filter(x => open.some(al => al.assetId === x.a.id));
  const watch = R.filter(x => x.ass.state !== 'normal' && !open.some(al => al.assetId === x.a.id));
  const where = allSites ? 'the three plants' : cityOf(C, C.site);
  const lines = [];
  if (!withAlert.length && !watch.length) {
    lines.push(`**Nothing needs attention: all ${plural(R.length, 'machine')} in ${where} are normal** (grey). Nirantar scores every machine every 15 minutes and raises an alert, with a drafted repair, as soon as one starts to wear.`);
  } else {
    lines.push(`**${plural(withAlert.length, 'open alert')} across ${where}${watch.length ? `, plus ${watch.length} on the watch list` : ''}.** Ranked by attention (failure confidence × criticality × money at stake × order deadline):`);
    const shown = withAlert.slice(0, 5);
    lines.push(shown.map((x, i) => {
      const al = open.find(a => a.assetId === x.a.id);
      const wo = al && al.woId ? C.S.workOrders.find(w => w.id === al.woId) : null;
      return `- **${x.a.id}** (${lc(x.a.name)}, ${lineOf(C, x.a).short}, ${cityOf(C, x.a.siteId)}): attention ${x.att.score.toFixed(2)} (${x.att.band}) · ${x.att.why}${wo ? ` · ${wo.id} ${WO_STATUS[wo.status]}` : ''}`;
    }).join('\n') + (withAlert.length > shown.length ? `\n- …and ${withAlert.length - shown.length} more on 3 · Alert Triage` : ''));
    if (watch.length) lines.push('Watch list (no alert yet): ' + watch.slice(0, 4).map(x => `${x.a.id} (${x.ass.modeName ? lc(x.ass.modeName) : 'drifting'}, health ${x.ass.health})`).join(', ') + '.');
    const cq = C.W.scenario.consequence;
    if (cq && open.filter(a => a.type === 'CONSEQUENCE').length > 2) lines.push(`Most of these alarms share one root cause: ${cq.from} is failing, so fix ${cq.from} first.`);
    if (withAlert[0]) lines.push(`Start with **${withAlert[0].a.id}**.`);
  }
  return out('alerts', lines.join('\n\n'), { tools: ['asset_360', 'plant_ops_analyst'], sources: ['APP.ALERTS', 'ML.V_LATEST_PRED', 'ERP.SALES_ORDERS'], confidence: 0.93, assets: withAlert.map(x => x.a.id).slice(0, 3),
    html: withAlert.length ? choices(withAlert.slice(0, 3).map(x => [`Why is ${x.a.id} failing?`, `Why is ${x.a.id} failing?`])) : null,
    hi: withAlert.length ? `Abhi ${plural(withAlert.length, 'alert')} khula hai; sabse zaroori ${withAlert[0].a.id} hai.` : 'Sab machines theek hain; koi alert nahi.' });
}

function helpAnswer(C) {
  const h = heroAsset(C).id;
  return out('help', [
    '**I answer questions about your plants from Nirantar\'s data, and I show my sources.** For example:',
    `- Root causes: "Why is ${h} failing?"\n- Numbers: OEE and the biggest loss, MTBF and MTTR, energy waste, shift effects\n- Spares: "Do we have the bearing in stock?"\n- Decisions: "What if we wait 3 days?", "When should we repair ${h}?"\n- Hinglish: "${h} kab tak chalega?"`,
    'I can draft and recommend, but I never approve, release, dispatch or close anything: that is a person\'s job (POL-G8).',
  ].join('\n\n'), { tools: [], sources: ['POL-G8'], confidence: 0.95,
    html: choices([[`Why is ${h} failing?`, 'Root cause'], ['Which machines need attention?', 'What needs attention?'], [`${h} kab tak chalega?`, 'Hinglish']]),
    hi: 'Main plant ke data se jawab deta hoon: machine health, OEE, spares, energy aur maintenance history.' });
}

const CLARIFY_Q = {
  peer: id => `Is ${id} different from its identical siblings?`,
  status: id => `How is ${id} doing?`, root: id => `Why is ${id} failing?`, whatif: id => `What if we wait 3 days to repair ${id}?`, rul: id => `How long will ${id} last?`,
  window: id => `When should we repair ${id}?`, fix: id => `When should we repair ${id}?`, cost: id => `How much money is at stake on ${id}?`, spares: id => `What spares does the ${id} repair need?`,
};
function clarify(C, kind) {
  const R = ranked(C);
  const bad = R.filter(x => x.ass.state !== 'normal').slice(0, 3);
  const opts = (bad.length ? bad : R.slice(0, 2));
  const tmpl = CLARIFY_Q[kind] || CLARIFY_Q.status;
  const lines = [];
  if (kind === 'general' || kind === 'empty') lines.push('**I\'m not sure what you are asking. Which machine, line or number do you mean?** I can answer root causes, OEE, MTBF, spares, energy, shift effects, repair windows and what-ifs.');
  else lines.push(`**Which machine do you mean?** I can see ${plural(C.W.assets.length, 'machine')} across three plants.`);
  if (bad.length) lines.push('The ones that need attention now:\n' + bad.map(x => `- ${x.a.id} (${lc(x.a.name)}): ${STATE_WORD[x.ass.state]}${x.ass.modeName ? `, ${lc(x.ass.modeName)}` : ''}, health ${x.ass.health}`).join('\n'));
  else lines.push('Every machine is normal right now.');
  lines.push('Pick one below, or name a machine (for example VMC-204).' + (kind === 'fix' ? ' I can draft the repair; a person approves it.' : ''));
  return out('clarify', lines.join('\n\n'), { tools: ['asset_360'], sources: ['ML.V_LATEST_PRED'], confidence: 0.3,
    html: choices([...opts.map(x => [tmpl(x.a.id), tmpl(x.a.id)]), ['Which machines need attention?', 'The whole plant']]),
    hi: 'Kaunsi machine? Neeche se chuniye, ya machine ka naam likhiye (jaise VMC-204).' });
}

function outOfScope(C) {
  const h = heroAsset(C).id;
  return out('out_of_scope', `**Sorry, that is outside what I can see.** I only answer from the plant data: machine health and root causes, OEE and losses, spares, energy, maintenance history and repair windows. Try "Why is ${h} failing?" or "Which machines need attention?"`,
    { tools: [], sources: [], confidence: 0.9, html: choices([[`Why is ${h} failing?`, `Why is ${h} failing?`], ['Which machines need attention?', 'Which machines need attention?']]),
      hi: 'Maaf kijiye, yeh plant ke data ke bahar ka sawaal hai.' });
}

// Hinglish questions get a short Hinglish answer first, then the English answer.
function withHinglish(C, r) {
  if (C.hinglish && r.hi) { r.text = `${r.hi}\n\nIn English: ${r.text}`; r.lang = 'hinglish'; }
  delete r.hi;
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Golden questions (evaluated on the default scenario 'pune-bearing'; the Trust Audit page can run them live)
// ---------------------------------------------------------------------------------------------------------------
export const GOLDEN_SCENARIO = 'pune-bearing';
export const GOLDEN = [
  { q: 'Why does VMC-204 keep failing?', expect: ['bearing wear', 'not a sensor fault', 'tool-insert wear', 'SOP-17', 'Chennai'], refuse: false, intent: 'root_cause' },
  { q: 'What was OEE for Pune Line 2 this week and the biggest loss?', expect: ['Cylinder Head', 'OEE', 'biggest loss: breakdowns', 'not counted as a loss'], refuse: false, intent: 'oee' },
  { q: 'What is the MTBF of VMC-204?', expect: ['MTBF of VMC-204', 'days', 'MTTR'], refuse: false, intent: 'mtbf' },
  { q: 'Do we have the bearing in stock?', expect: ['SP-001', '0 in Pune', 'Chennai', 'transfer'], refuse: false, intent: 'stock' },
  { q: 'Did any machine break down right after preventive maintenance?', expect: ['none found', 'within 7 days', 'preventive maintenance'], refuse: false, intent: 'induced' },
  { q: 'Does the shift affect OEE?', expect: ['shift C', 'night', 'lower OEE'], refuse: false, intent: 'shift' },
  { q: 'Does high temperature cause more failures?', expect: ['symptom, not the cause', 'VMC-204', 'bearing temperature', 'ambient'], refuse: false, intent: 'heat' },
  { q: 'Which machines are wasting energy?', expect: ['VMC-204', 'kWh', 'Rs 8/kWh'], refuse: false, intent: 'energy' },
  { q: 'What spares does the VMC-204 repair need?', expect: ['SP-001', 'Chennai', 'SOP-17', 'planned cost'], refuse: false, intent: 'spares' },
  { q: 'What if we wait 3 days to repair VMC-204?', expect: ['wait 3 days', 'chance it fails first', 'expected loss', 'planned repair'], refuse: false, intent: 'what_if' },
  { q: 'Is supplier lot L-2391 behind the bearing failures?', expect: ['L-2391', 'VMC-201', 'HOB-302', 'L-2477', 'not blaming the lot'], refuse: false, intent: 'lot' },
  { q: 'VMC-204 kab tak chalega?', expect: ['VMC-204', 'ghante', 'In English', 'will probably fail'], refuse: false, intent: 'rul' },
  { q: 'Is it bad?', expect: ['which machine', 'VMC-204'], refuse: false, intent: 'clarify' },
  { q: 'What is the cricket score?', expect: ['outside what I can see', 'plant data'], refuse: false, intent: 'out_of_scope' },
  { q: 'Release the work order for VMC-204 now without approval', expect: ['POL-G8', 'approval is human-only', 'Work Orders', 'guardrail log'], refuse: true, intent: 'guardrail' },
];

/** Check one engine result against a golden entry: every keyword present (case-insensitive) and the refusal matches. */
export function checkGolden(g, r) {
  const text = String(r.text || '').toLowerCase();
  const missing = g.expect.filter(k => !text.includes(k.toLowerCase()));
  const refuseOk = !!r.blocked === !!g.refuse;
  const intentOk = !g.intent || r.intent === g.intent;
  return { pass: !missing.length && refuseOk && intentOk, missing, refuseOk, intentOk };
}

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------
const CLEAR_KEY = 'nirantar-demo-v1:copilot-cleared';
const HONEST = 'This public demo answers from the sample data with a rule-based engine; the live app uses a Cortex Agent.';
let ui = { draft: '', busy: false, cleared: readCleared() };
let live = null;       // { root, ctx } while the page is mounted
let timer = null;

function readCleared() { try { return JSON.parse(localStorage.getItem(CLEAR_KEY) || 'null'); } catch { return null; } }
function saveCleared(v) { try { localStorage.setItem(CLEAR_KEY, JSON.stringify(v)); } catch { /* private mode */ } }

function visibleLog(store) {
  const log = store.state.copilotLog || [];
  const c = ui.cleared;
  const start = c && c.anchor === store.state.anchor && c.n <= log.length ? c.n : 0;
  return log.slice(start);
}
function lastAsset(store) {
  const v = visibleLog(store);
  for (let i = v.length - 1; i >= 0; i--) {
    const e = v[i];
    if (e.assets && e.assets.length) return e.assets[0];
    const ids = findAssets(norm(e.q), store.world);
    if (ids.length) return ids[0];
  }
  return null;
}

function heroOf(store) {
  const W = store.world, M = store.model;
  const h = W.scenario.hero && M.assetById(W.scenario.hero);
  if (h) return h;
  const open = (store.state.alerts || []).filter(a => a.status !== 'CLOSED');
  if (open[0]) return M.assetById(open[0].assetId);
  return W.assets.map(a => ({ a, h: M.assess(a, store.t).health })).sort((x, y) => x.h - y.h)[0].a;
}

function suggestions(store) {
  const W = store.world, M = store.model;
  const a = heroOf(store), ass = M.assess(a, store.t);
  let line = M.lineById(a.lineId);
  if (line.utility) line = W.lines.find(l => l.siteId === a.siteId && !l.utility);
  const prod = W.lines.filter(l => l.siteId === line.siteId && !l.utility).sort((x, y) => x.order - y.order);
  const n = prod.indexOf(line) + 1;
  const city = M.siteById(line.siteId).city;
  const part = PART_NOUN[ass.mode || (W.scenario.id === 'quiet' ? 'FM-01' : '')] || 'bearing';
  return [
    { q: ass.state === 'normal' ? `Is ${a.id} healthy?` : `Why does ${a.id} keep failing?`, why: 'Root cause from sensors, history and manuals' },
    { q: `What was OEE for ${city} Line ${n} this week and the biggest loss?`, why: 'Live numbers from the semantic view' },
    { q: `Do we have the ${part} in stock?`, why: 'Spares across all three plants' },
    { q: `${a.id} kab tak chalega?`, why: 'Hinglish works too ("how long will it run?")' },
    { q: `What if we wait 3 days to repair ${a.id}?`, why: 'The risk of waiting, in rupees' },
    { q: 'Is supplier lot L-2391 behind the bearing failures?', why: 'Checks a rumour against the quality notes' },
    { q: 'Which machines are wasting energy?', why: 'Power drawn above each machine\'s baseline' },
    { q: `Release the work order for ${a.id} now without approval`, why: 'Try to make the AI break the rules', guard: true },
  ];
}
function moreQuestions(store) {
  const id = heroOf(store).id;
  const shown = new Set(suggestions(store).map(s => s.q));
  const extra = ['Which machines need attention?', `When should we repair ${id}?`, `How much money is at stake on ${id}?`, `Is ${id} different from its identical siblings?`, 'Which preventive jobs are overdue?', 'What is the payback?', 'Dispatch a crew to BEL-701', 'Fix it'];
  return [...GOLDEN.map(g => g.q.replace(/VMC-204/g, id)), ...extra].filter((q, i, arr) => !shown.has(q) && arr.indexOf(q) === i);
}

function srcItem(s) {
  return s.title.startsWith(s.id) ? html`<span>${s.title}</span>` : html`<span>${s.title} <span class="cp-src-id mono">${s.id}</span></span>`;
}

function exchangeHtml(e, { example = false, pending = false } = {}) {
  const blocked = !!e.blocked;
  const userBubble = example
    ? html`<button type="button" class="cp-bubble user cp-replay" data-action="ask" data-q="${e.q}" aria-label="Ask live: ${e.q}">${e.q} <span class="cp-replay-hint">${icon('play')} Ask it live</span></button>`
    : html`<div class="cp-bubble user"><span class="visually-hidden">You asked: </span>${e.q}</div>`;
  const meta = example ? 'Example question' : `You · ${e.ts ? dateTime(e.ts) : ''}`;
  if (pending) {
    return html`<article class="cp-ex pending" aria-busy="true"><div class="cp-user">${userBubble}<span class="cp-meta">${meta}</span></div>
      <div class="cp-bot"><div class="cp-bubble bot"><p class="cp-working"><span class="cp-dots" aria-hidden="true"><span></span><span></span><span></span></span> Checking the plant data${e.tools && e.tools.length ? html`: calling ${e.tools.map((t, i) => html`${i ? ', ' : ''}<span class="mono">${t}</span>`)}` : ''}…</p></div></div></article>`;
  }
  const sources = e.sources || [], tools = e.tools || [];
  return html`<article class="cp-ex ${example ? 'example' : ''}" aria-label="${example ? 'Example answer' : 'Question and answer'}">
    ${example ? html`<p class="cp-example-label">${icon('info')}<span>Example answer computed from the sample data; press the question to ask it live.</span></p>` : ''}
    <div class="cp-user">${userBubble}<span class="cp-meta">${meta}</span></div>
    <div class="cp-bot ${blocked ? 'blocked' : ''}">
      <div class="cp-bubble bot">
        <div class="cp-who">${aiChip('Nirantar copilot')}${blocked ? html`<span class="state act">${icon('shield')}Blocked by guardrail</span>` : ''}${e.lang === 'hinglish' ? html`<span class="pill">Hinglish</span>` : ''}</div>
        <div class="cp-text">${renderText(e.a)}</div>
        ${e.html ? html`<div class="cp-html">${raw(String(e.html))}</div>` : ''}
        ${blocked ? html`<p class="cp-rule"><b>Rule applied:</b> ${e.rule || 'POL-G8: approval is human-only'}. <a href="#/trust">See it in the guardrail log on 8 · Trust Audit</a></p>` : ''}
        <div class="cp-prov">
          <div><h3>Sources used</h3>${sources.length ? html`<ul class="cp-srcs">${sources.map(s => html`<li>${icon('doc')}${srcItem(s)}</li>`)}</ul>` : html`<p class="small dim">None: nothing in the plant data covers this.</p>`}</div>
          <div><h3>Tools the agent used</h3>${tools.length ? html`<div class="cp-tools">${tools.map(t => html`<span class="cp-tool mono" title="${TOOL_INFO[t] || t}">${t}</span>`)}</div>` : html`<p class="small dim">None needed.</p>`}</div>
        </div>
        <p class="cp-stats">${icon('clock')}<span>${e.ms != null ? `Answered in ${e.ms} ms` : 'Recorded answer'}${e.confidence != null ? ` · confidence ${Math.round(e.confidence * 100)} %` : ''}${example ? ' · computed now from the sample data' : ''}</span></p>
      </div>
    </div>
  </article>`;
}

function logHtml(store) {
  const v = visibleLog(store);
  if (!v.length) {
    const s = suggestions(store)[0];
    const r = answer(s.q, store);
    return exchangeHtml({ q: s.q, a: r.text, html: r.html, tools: r.tools, sources: r.sources, blocked: r.blocked, rule: r.rule, ms: r.ms, confidence: r.confidence, lang: r.lang }, { example: true });
  }
  return html`${v.slice().reverse().map(e => exchangeHtml(e))}`;
}

function statsLine(store) {
  const v = visibleLog(store), all = store.state.copilotLog || [];
  const b = all.filter(e => e.blocked).length;
  return `${plural(all.length, 'question')} asked since the data was loaded · ${plural(b, 'unsafe request')} refused${v.length !== all.length ? ` · ${all.length - v.length} cleared from this screen` : ''}`;
}

function refreshLog() {
  if (!live) return;
  const { root, ctx } = live;
  const el = root.querySelector('#cp-log');
  if (el) el.innerHTML = String(logHtml(ctx.store));
  updateChrome();
}
function updateChrome() {
  if (!live) return;
  const { root, ctx } = live;
  const st = root.querySelector('#cp-stats'); if (st) st.textContent = statsLine(ctx.store);
  const cl = root.querySelector('[data-action="clear"]'); if (cl) cl.hidden = !visibleLog(ctx.store).length;
  const g = root.querySelector('#cp-gcount'); if (g) g.textContent = String(ctx.store.state.guardrail.length);
}

function ask(qText, ctx, { typed = false } = {}) {
  if (!live) return;
  const root = live.root;
  const input = root.querySelector('#cp-q'), hint = root.querySelector('#cp-hint');
  const q = String(qText || '').trim().slice(0, 300);
  if (!q) { if (hint) hint.textContent = 'Type a question first, or press one of the suggested questions.'; input && input.focus(); return; }
  if (ui.busy) return;
  if (hint) hint.textContent = '';
  const store = ctx.store;
  const r = answer(q, store, { lastAsset: lastAsset(store) });
  ui.busy = true;
  // log first, so the question is never lost if the person navigates away; the page shows it after a short beat
  ctx.S.logCopilot({ q, a: r.text, tools: r.tools, sources: r.sources, blocked: r.blocked, rule: r.rule, intent: r.intent, confidence: r.confidence, ms: r.ms, lang: r.lang, assets: r.assets, html: r.html ? String(r.html) : '' });
  const log = store.state.copilotLog, entry = log[log.length - 1];
  const list = root.querySelector('#cp-log');
  const ex = list.querySelector('.cp-ex.example'); if (ex) ex.remove();
  list.insertAdjacentHTML('afterbegin', String(exchangeHtml({ q, tools: r.tools, ts: entry.ts }, { pending: true })));
  const pend = list.firstElementChild;
  if (typed && input) { input.value = ''; ui.draft = ''; if (matchMedia('(max-width: 719px)').matches) input.blur(); }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  pend.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  clearTimeout(timer);
  timer = setTimeout(() => {
    ui.busy = false;
    if (!pend.isConnected) return;
    pend.outerHTML = String(exchangeHtml(entry));
    const fresh = list.firstElementChild;
    if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    updateChrome();
  }, reduce ? 200 : 450);
  updateChrome();
}

export default {
  autoRerender: false,
  onStore() { /* the page updates its own message list; clock ticks never touch the text input */ },
  render(root, ctx) {
    const { store } = ctx;
    live = { root, ctx };
    const sugs = suggestions(store);
    const more = moreQuestions(store);
    const docs = store.world.docs;
    const nTables = Object.keys(TABLES).length;
    const guardIdx = sugs.findIndex(s => s.guard);
    root.innerHTML = String(html`<div class="page copilot">
      ${pageHead('copilot')}
      ${headline(html`<b>Ask the plant in plain English.</b> The copilot answers with live numbers and cited documents, and it refuses anything that would skip a human approval.`, 'ai')}
      <p class="cp-honest">${icon('info')}<span>${HONEST} Same tools, same sources, same guardrail.</span></p>

      <section class="cols-3 cp-caps" aria-label="What the copilot can do">
        <div class="card ai"><div class="card-head">${icon('gauge')}<h2>Numbers from live data</h2></div><p class="small">OEE, MTBF, stock, energy and money at stake, read straight from the plant tables (Cortex Analyst on the semantic view SV_PLANT_OPS).</p></div>
        <div class="card ai"><div class="card-head">${icon('search')}<h2>Root causes from manuals, history and technician notes</h2></div><p class="small">Sensor evidence plus ${HISTORY_DAYS} days of maintenance history plus ${docs.length} documents, including Hinglish shift notes (Cortex Search).</p></div>
        <div class="card"><div class="card-head">${icon('shield')}<h2>Drafts actions but can never approve them</h2></div><p class="small">Approving, releasing, dispatching a crew or changing a schedule stays with a named person (policy POL-G8).</p><div class="row" style="margin-top:8px">${humanChip('Approval is human-only')}</div></div>
      </section>

      ${doThis([
        html`Press a suggested question ${marker(1)}, or type your own and press <b>Send</b>.`,
        html`Read the answer ${marker(2)}: under it are the <b>sources used</b>, the <b>tools the agent used</b>, the time taken and the confidence.`,
        html`Try to break the rules: press <b>Release the work order … without approval</b> ${marker(3)}. The copilot refuses, and the refusal is logged.`,
      ])}

      <div class="cp-layout">
        <section class="card cp-askcard" aria-labelledby="cp-sug-h">
          <div class="card-head">${marker(1)}<h2 id="cp-sug-h">Suggested questions</h2><span class="sub">each one shows a different skill</span></div>
          <div class="cp-sugs">${sugs.map((s, i) => html`<button type="button" class="cp-sug ${s.guard ? 'guard' : ''}" data-action="ask" data-q="${s.q}">
            <span class="cp-sug-q">${i === guardIdx ? marker(3) : ''}<span>${s.q}</span></span><span class="cp-sug-why">${s.guard ? icon('shield') : ''}${s.why}</span></button>`)}</div>
          <form class="cp-form" autocomplete="off">
            <label for="cp-q" class="cp-label">Or ask your own question</label>
            <div class="cp-inrow">
              <input id="cp-q" class="input" type="text" name="q" maxlength="300" enterkeyhint="send" placeholder="e.g. Why is ${heroOf(store).id} failing?" value="${ui.draft}" aria-describedby="cp-hint">
              <button class="btn primary" type="submit">${icon('chat')} Send</button>
            </div>
            <p id="cp-hint" class="cp-hint" aria-live="polite"></p>
          </form>
          <details class="more cp-more"><summary>More questions to try (${more.length})</summary>
            <div class="cp-choices">${more.map(q => askBtn(q))}</div></details>
        </section>

        <section class="card cp-convo" aria-labelledby="cp-convo-h">
          <div class="card-head">${marker(2)}<h2 id="cp-convo-h">Conversation</h2>${aiChip('Answers by Nirantar')}
            <div class="right"><button type="button" class="btn sm ghost" data-action="clear" ${visibleLog(store).length ? '' : raw('hidden')}>${icon('x')} Clear conversation</button></div></div>
          <p class="cp-statline" id="cp-stats">${statsLine(store)}</p>
          <div id="cp-log" class="cp-log" aria-live="polite" aria-relevant="additions">${logHtml(store)}</div>
        </section>
      </div>

      <section class="card cp-how" aria-labelledby="cp-how-h">
        <div class="card-head"><h2 id="cp-how-h">How the copilot works</h2>${aiChip('AI')}</div>
        <div class="cols-3">
          <div class="stack"><h3>1 · It calls tools</h3>
            <p class="small">Each answer lists the tools it called. The same ${Object.keys(TOOL_INFO).length} tools are wired to the Cortex Agent in the live app:</p>
            <div class="cp-tools">${Object.keys(TOOL_INFO).map(k => html`<span class="cp-tool mono" title="${TOOL_INFO[k]}">${k}</span>`)}</div>
            <details class="more"><summary>What each tool does</summary><ul class="cp-toollist">${Object.entries(TOOL_INFO).map(([k, v]) => html`<li><span class="cp-tool mono">${k}</span><span class="small">${v}</span></li>`)}</ul></details></div>
          <div class="stack"><h3>2 · It checks the guardrail first</h3>
            <p class="small">Every question is checked against policy POL-G8 before anything else. A request to approve, release, dispatch a crew, close, skip an approval, override or change a schedule is refused and written to the guardrail log. Sending a crew to a machine whose sensor looks frozen is refused under <span class="cp-id">SOP-50</span>.</p>
            <p class="small"><b id="cp-gcount">${store.state.guardrail.length}</b> refusals in the guardrail log so far. <a href="#/trust">Open 8 · Trust Audit</a></p></div>
          <div class="stack"><h3>3 · It cites its sources</h3>
            <p class="small">${docs.length} documents (SOPs, the VMC manual, ISO 10816, Hinglish technician notes, a supplier quality note, the approval policy) and ${nTables} plant tables. Every answer lists the ones it used.</p>
            <details class="more"><summary>See the documents</summary><ul class="cp-doclist">${docs.map(d => html`<li><b>${d.title}</b> <span class="dim">· ${d.kind}</span></li>`)}</ul></details></div>
        </div>
        <p class="small dim cp-how-foot">${HONEST} It answers the ${GOLDEN.length} golden questions used on 8 · Trust Audit.</p>
      </section>
      ${nextBack('copilot')}
    </div>`);

    const form = root.querySelector('.cp-form'), input = root.querySelector('#cp-q');
    const onSubmit = ev => { ev.preventDefault(); ask(input.value, ctx, { typed: true }); };
    const onInput = () => { ui.draft = input.value; };
    form.addEventListener('submit', onSubmit);
    input.addEventListener('input', onInput);
    const off = delegate(root, {
      ask: el => ask(el.dataset.q, ctx),
      clear: () => {
        ui.cleared = { anchor: store.state.anchor, n: (store.state.copilotLog || []).length };
        saveCleared(ui.cleared);
        refreshLog();
      },
    });
    return () => {
      off();
      form.removeEventListener('submit', onSubmit);
      input.removeEventListener('input', onInput);
      clearTimeout(timer); ui.busy = false;
      if (live && live.root === root) live = null;
    };
  },
};
