// Tool · For judges: brief coverage (#/judges). Works with and without sample data.
// Maps every point of problem #03 and of the CoCo usage guidelines to an honest status and to the place a judge sees it
// in one click: a deep link into this demo, or an evidence file in the repository. The hero numbers are computed by the
// demo's model on a fresh reference copy of the sample scenario (withReference), so they stay the same whatever the
// visitor did to the live demo, and they are the numbers of the Snowflake build. Facts measured inside Snowflake (row
// counts, test results, the CLI version) cannot be computed in a browser: they are quoted from the evidence (SF below).
import { html, raw, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, term, nextBack, confPct } from '../ui/components.js';
import { TOUR, PAGES } from '../routes.js';
import { withReference, attention, SCENARIOS } from '../core/store.js';
import { inr, hours, num } from '../core/format.js';

const REPO = 'https://github.com/paras-lehana/nirantar';
const DECK = '../docs/submission/Nirantar_AidhunikIndia_CoCoHackathon_GCC.pdf';
const REF = { id: 'pune-bearing', seed: 2391 };          // the hero scenario: same seed as the deck, README and tests
const REF_SC = SCENARIOS.find(s => s.id === REF.id);
const HERO = REF_SC.hero;
const PLANNED_WINDOW_H = 4;                              // a planned repair takes one 4 h window (store.complete, 7 · OEE)

// Measured in the Snowflake build, not computable here. Sources: docs/submission/metrics.json, docs/coco-journal.md,
// docs/evidence/E/01 (hero run, automation), T/01 (tests), X/02 (CoCo CLI), D/12 (Cortex Search).
const NB = ' ';   // no-break space: a number never wraps away from its unit
const SF = {
  plants: 3, machines: 48, tags: 315, rows: `6.8${NB}M`, days: 75, episodes: 43, docs: 34, chunks: 79, skills: 8, chats: '20+',
  risk: '0.99', rul: `66.8${NB}h`, caught: '36 of 43', detect: `83.7${NB}%`, lead: `36${NB}h`, fa: '0.28', tests: '21 of 22',
  agentFirst: '9 of 15', brief: `07:00${NB}IST`, streamlit: '1.46.1', cli: 'v1.1.104', runCredits: 'about 1.8',
};
const AGENT_TOOLS = ['ASSET_360', 'CHECK_SPARES', 'PROPOSE_WINDOW', 'DRAFT_WORK_ORDER', 'WHAT_IF_DEFER'];
const SKILLS = ['nirantar-synthetic-plant', 'nirantar-ontology-semantic-view', 'nirantar-command-center', 'nirantar-alert-triage',
  'nirantar-rca', 'nirantar-work-order', 'nirantar-reliability-brief', 'nirantar-coco-evidence'];

// ---------- icons the shared set does not have (same 24 px stroke style as dom.js) ----------
const XP = {
  snow: 'M12 2v20M3.34 7l17.32 10M3.34 17l17.32-10M9.4 6L12 3.6L14.6 6M9.4 18L12 20.4L14.6 18M15.9 6.75L19.27 7.8L18.5 11.25M18.5 12.75L19.27 16.2L15.9 17.25M5.5 12.75L4.73 16.2L8.1 17.25M8.1 6.75L4.73 7.8L5.5 11.25',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  half: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 3v18M12 8h7.5M12 12h8.5M12 16h7.5',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
};
const ico = name => (XP[name] ? raw(`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${XP[name]}"/></svg>`) : icon(name));
const c = s => html`<code class="jd-code">${s}</code>`;
const nw = s => html`<span class="nw">${s}</span>`;     // IDs and values with units must not break at a hyphen or space
const H = nw(HERO);

// ---------- status chips: neutral outline = it exists; amber = partly, preview or not built. Icon + word, never colour alone.
const ST = {
  live: { label: 'Live in Snowflake', ic: 'snow', mean: 'built and run in our Snowflake account' },
  demo: { label: 'In this demo', ic: 'globe', mean: 'try it here, in your browser' },
  repo: { label: 'In the repo', ic: 'code', mean: 'files on GitHub' },
  partial: { label: 'Partly', ic: 'half', warn: true, mean: 'part is done; the row says which part' },
  preview: { label: 'Preview', ic: 'eye', warn: true, mean: 'shown with a label; nothing is sent' },
  nb: { label: 'Not built', ic: 'x', warn: true, mean: 'not in Snowflake yet, said plainly' },
};
const key = s => (Array.isArray(s) ? s[0] : s);
const has = (it, k) => it.st.some(s => key(s) === k);
function chip(s) {
  const d = ST[key(s)];
  return html`<span class="jd-chip ${d.warn ? 'warn' : ''}">${ico(d.ic)}${(Array.isArray(s) && s[1]) || d.label}</span>`;
}

// ---------- links: demo deep links ("Show me") and evidence files (GitHub, or a page of the published site) ----------
const ghHref = p => (!p ? REPO : p.startsWith('../') ? p : `${REPO}/${p.endsWith('/') ? 'tree' : 'blob'}/main/${p.replace(/\/$/, '')}`);
function goBtn([route, focus]) {
  const page = route.replace(/^#\/?/, '').split('/')[0] || 'home';
  const p = PAGES[page], step = TOUR.find(s => s.page === page);
  const title = p ? (step ? `${step.n} · ${p.title}` : p.title) : route;
  return html`<a class="btn jd-go" href="${route}">${icon(p ? p.icon : 'arrowR')}<span>${title}${focus ? html`<span class="jd-go-f">: ${focus}</span>` : ''}</span>${icon('arrowR')}</a>`;
}
const evLink = ([path, label]) => html`<a class="jd-ev" href="${ghHref(path)}" target="_blank" rel="noopener" title="${path || 'the repository'}">${ico('ext')}<span>${label}</span><span class="visually-hidden"> (opens in a new tab)</span></a>`;
function seeIt(it) {
  return html`<div class="jd-see">
    ${it.go && it.go.length ? html`<div class="jd-show" role="group" aria-label="Show me in this demo"><span class="jd-lbl">Show me</span>${it.go.map(goBtn)}</div>` : ''}
    <div class="jd-evs"><span class="jd-lbl">Evidence</span>${it.ev && it.ev.length ? it.ev.map(evLink) : html`<span class="jd-none">${it.evNone || 'none yet'}</span>`}${it.to ? html`<button class="jd-ev jd-to" data-action="jd-to" data-to="${it.to}">${icon('arrowR')}<span>${it.toLabel}</span></button>` : ''}</div>
  </div>`;
}

// ---------- hero numbers from a pristine reference copy (cached per live anchor; about 30 ms) ----------
let refCache = { key: null, n: null };
function refNumbers(store) {
  const k = store.loaded ? String(store.state.anchor) : 'none';
  if (refCache.key === k) return refCache.n;
  let n = null;
  try {
    n = withReference(REF.id, REF.seed, st => {
      const M = st.model, W = st.world, a = M.assetById(HERO), ass = M.assess(a, st.t);
      const ex = M.exposure(a, ass.mode), pc = M.plannedCost(a, ass.mode), bt = M.backtestAt(st.state.threshold);
      const line = M.lineById(a.lineId), site = M.siteById(a.siteId), plan = ex.plan;
      const oeeLine = line.utility ? W.lines.find(l => l.siteId === a.siteId && !l.utility) : line;   // same as 7 · OEE
      const wo = st.state.workOrders.find(w => w.assetId === a.id) || null;
      const ranked = W.assets.map(x => [x.id, attention(x).score]).sort((p, q) => q[1] - p[1]);
      const savedH = Math.max(0, ex.downH - PLANNED_WINDOW_H);
      const op = M.orderPressure(a.lineId, st.t);
      return {
        site: site.city, line: line.short, health: ass.health, conf: confPct(ass.conf), rul: hours(ass.rulH),
        range: ass.rulHi < 240 ? `${Math.round(ass.rulLo)}–${hours(ass.rulHi)}` : `${hours(ass.rulLo)} to ${hours(ass.rulHi)}`,
        zone: ass.iso ? ass.iso.zone : '–', vib: ass.iso ? num(ass.iso.v, 1) : '–',
        atStake: inr(ex.inr), planned: inr(pc.total), savedH: hours(savedH), saved: inr(ex.inr - pc.total),
        pts: num(savedH / oeeLine.plannedHoursMonth * 100, 1),
        part: plan ? plan.part.name.replace(/^./, ch => ch.toLowerCase()) : 'spare part', from: plan ? M.siteById(plan.from).city : '–', eta: plan ? plan.etaH : 0,
        stockHere: plan ? plan.part.stock[a.siteId] || 0 : 0, stockFrom: plan ? plan.part.stock[plan.from] || 0 : 0,
        sop: wo ? wo.sop : '–', steps: wo ? wo.steps.length : '–',
        det: bt.detected, tot: bt.total, lead: hours(bt.medianLead), fa: num(bt.faRate, 2),
        score: ranked.length ? ranked.find(r => r[0] === a.id)[1].toFixed(2) : '–', first: ranked.length && ranked[0][0] === a.id,
        customer: op.order ? op.order.customer : 'a customer',
        customers: op.order ? op.order.customer + (/s$/.test(op.order.customer) ? "'" : "'s") : "a customer's",
      };
    });
  } catch (e) { console.error('For judges: could not compute the reference numbers', e); }
  refCache = { key: k, n };
  return n;
}

// ---------- the brief (problem statement #03), point by point ----------
const PROBLEM = 'Manufacturers lose value to unplanned downtime because OT sensor data sits apart from ERP and maintenance context. Build a solution that converges IT and OT data to predict failures, automate work orders, and lift Overall Equipment Effectiveness.';
function briefPoints(N) {
  const v = k => (k === 'part' || k === 'customers' ? (N[k] ?? '–') : nw(N[k] ?? '–'));
  return [
    { q: 'Converge IT and OT data', st: ['live', 'demo'],
      does: html`One Snowflake account holds the OT sensor readings, ERP stock, supplier lots and orders, the CMMS work orders and ${SF.docs} maintenance documents, and Dynamic Tables shape them into one plant → line → machine → sensor model.`,
      go: [['#/built', 'what runs in Snowflake'], [`#/machine/${HERO}`, 'IT + OT timeline']],
      ev: [['../docs/diagrams/archify/architecture-nirantar-20261006-2030/nirantar-architecture.html', 'Architecture diagram'], ['../docs/diagrams/01-system-architecture.png', 'Detailed architecture']] },
    { q: 'Correlate real-time sensor streams (vibration, temperature, RPM) with ERP and maintenance records', st: ['live', 'demo'],
      does: html`In Snowflake a serverless task adds a minute of sensor readings at a time and joins them to ERP and CMMS; here the IT + OT timeline of ${H} shows vibration (${nw(html`${N.vib ?? '–'} mm/s`)}, ${nw(html`ISO zone ${N.zone ?? '–'}`)}), bearing temperature and spindle speed beside its work-order history, the spare part (${v('stockHere')} in ${v('site')}, ${v('stockFrom')} in ${v('from')}, ${v('eta')} h away) and ${v('customers')} order.`,
      go: [[`#/machine/${HERO}`, 'IT + OT timeline'], ['#/spares', 'stock by plant']],
      ev: [['docs/evidence/prompts/D6-D7-D8-sim-tools-alert.txt', '1-minute sensor task (prompt)'], ['docs/evidence/prompts/D4-D5-pipeline-scoring.txt', '15-minute features (prompt)']] },
    { q: 'Predict failures in advance', st: ['live', 'demo'],
      does: html`${H} has ${term('health', 'A 0 to 100 score per machine: 100 is like new, 0 means a sensor is at its trip limit.')} ${v('health')}, ${v('conf')} ${term('failure confidence', 'How sure Nirantar is that a real failure is developing (all related sensors agree), not when it will happen.')} and about ${v('rul')} to failure (likely ${v('range')}); the ${term('back-test', 'The model replayed over past failures whose outcome is known.')} caught ${v('det')} of ${v('tot')} past failures a median ${v('lead')} early, with ${v('fa')} false alarms per machine-month.`,
      go: [[`#/machine/${HERO}`, 'forecast and P-F curve'], ['#/trust', 'back-test']],
      ev: [['docs/evidence/E/01-hero-run-e1-e2.jpg', 'Hero run in Snowflake'], ['docs/evidence/T/01-test-suite-results.jpg', 'Test results'], ['docs/submission/metrics.json', 'Measured metrics']] },
    { q: 'Support root-cause investigation in natural language', st: ['live', 'demo'],
      does: html`Ask “Why does ${H} keep failing?” in English or Hinglish and the copilot answers from sensor evidence, work-order history, stock and SOPs with its sources listed; in Snowflake this is a Cortex Agent (Cortex Analyst on the semantic view, Cortex Search over ${SF.docs} documents and ${AGENT_TOOLS.length} tools).`,
      go: [['#/copilot', 'ask why'], ['#/reliability', 'fishbone and 5 whys']],
      ev: [['docs/evidence/prompts/D11-agent.txt', 'Cortex Agent (prompt)'], ['docs/evidence/D/12-cortex-search.jpg', 'Cortex Search test'], ['docs/evidence/prompts/D9-semantic-view.txt', 'Semantic view (prompt)']] },
    { q: 'Command-center experience for alert triage and action', st: ['live', 'demo'],
      does: html`Every alert is ranked by one ${term('attention score', 'One 0 to 1 number per machine: failure confidence × criticality × money at stake × order deadline.')}: ${H} comes ${N.first ? 'first' : 'high'} at ${v('score')} with ${v('atStake')} at stake, and each alert can be acknowledged, shelved or escalated, with every action written to the audit trail.`,
      go: [['#/triage', 'ranked alerts'], ['#/schedule', 'repair windows']],
      ev: [['docs/evidence/prompts/D12-streamlit.txt', 'Streamlit app (prompt)'], ['docs/screenshots/08-snowflake-streamlit-plant-map.jpg', 'Live app in Snowflake']] },
    { q: 'Automate work orders', st: ['live', 'demo'],
      does: html`When the alert fires the AI drafts the repair: ${v('steps')} steps from ${v('sop')}, the ${v('part')} moved from ${v('from')} (${v('eta')} h), a certified technician and a window before the predicted failure, at ${v('planned')} against ${v('atStake')} at stake; only a named person can approve it.`,
      go: [['#/orders', 'AI draft and approval'], ['#/tech', 'job card']],
      ev: [['docs/evidence/prompts/D6-D7-D8-sim-tools-alert.txt', 'Agent tools and alert (prompt)'], ['docs/screenshots/09-snowflake-streamlit-work-orders.jpg', 'Work orders in Snowflake']] },
    { q: 'Lift OEE', st: ['live', 'demo'],
      does: html`${term('OEE', 'Overall equipment effectiveness = availability × performance × quality. 85 % is world class.')} is shown by line and shift with the six big losses, and repairing ${H} in a planned ${PLANNED_WINDOW_H}-hour window instead of after a breakdown saves ${v('savedH')} of downtime (about ${v('pts')} OEE points over a month on the ${v('line')} line) and ${v('saved')}.`,
      go: [['#/oee', 'what the repair saves'], ['#/roi', 'payback']],
      ev: [['docs/evidence/prompts/D4-D5-pipeline-scoring.txt', 'OEE facts (prompt)'], ['docs/evidence/T/01-test-suite-results.jpg', 'OEE bands test']] },
  ];
}

// ---------- CoCo across the lifecycle: real screenshots (thumbnails crop on the meaningful part: --fx --fy --z) ----------
const SHOTS = [
  { path: 'docs/evidence/P/01-planning-coco.jpg', w: 1254, h: 616, fx: 60, fy: 62, z: 2.1, title: 'Planning: CoCo writes the plan', short: 'The planning chat and its summary',
    alt: 'CoCo in Snowsight: the planning chat ends with a five-point summary of the 437-line plan (problem framing, ontology, workflow, build plan, risks).',
    cap: 'The planning chat in CoCo in Snowsight: the plan file was written and no Snowflake objects were created in this phase.' },
  { path: 'docs/evidence/D/12-cortex-search.jpg', w: 1254, h: 616, fx: 60, fy: 62, z: 2.1, title: 'Development: CoCo builds Cortex Search', short: 'Cortex Search, built and tested',
    alt: 'CoCo in Snowsight: the Cortex Search service CSS_MAINT_KNOWLEDGE is created and five test queries return the right documents, one of them in Hinglish.',
    cap: 'One of the development chats: the search service over the maintenance documents, tested with five questions.' },
  { path: 'docs/evidence/E/01-hero-run-e1-e2.jpg', w: 1568, h: 771, fx: 60, fy: 35, z: 2, title: 'Execution: the hero run and the automation', short: 'Hero run and the 07:00 IST automation',
    alt: 'CoCo in Snowsight: hero tuning table (risk 0.99, RUL 66.8 h, ISO zone C, back-test 83.7 %), the live hero flow and the Morning Reliability Briefing automation at 07:00 IST.',
    cap: 'Six 1-minute ticks raise the VMC-204 alert and the work-order draft; the CoCo Automation runs the morning brief daily at 07:00 IST.' },
  { path: 'docs/evidence/T/01-test-suite-results.jpg', w: 1568, h: 771, fx: 60, fy: 45, z: 2, title: 'Testing: the test suite CoCo wrote and ran', short: 'Test results, PASS by PASS',
    alt: 'CoCo in Snowsight: the test results table with PASS for telemetry, physics, OEE, patterns, guardrails, ML, hero and edge cases, and one agent-evaluation row marked FAIL because judging had not run yet.',
    cap: 'All checks pass except the agent-evaluation row, which is reported separately; the edge cases include approval bypass and stale data.' },
  { path: 'docs/evidence/S/00-skills-installed-by-coco.jpg', w: 1254, h: 616, fx: 100, fy: 45, z: 2.2, title: 'Sharing: the 8 skills installed in Snowsight', short: 'In Snowsight: 8 skills installed',
    alt: 'Snowsight workspace with the AGENTS.md rules open and the CoCo panel listing the 8 installed nirantar skills.',
    cap: 'CoCo moved the uploaded files into place and listed the 8 nirantar-* skills as installed in the workspace.' },
  { path: 'docs/evidence/X/02-coco-cli-skill-add.png', w: 2253, h: 978, fx: 0, fy: 22, z: 1.6, title: 'Sharing: the CoCo CLI installs the skills from GitHub', short: 'In the CoCo CLI: installed from GitHub',
    alt: 'Terminal: Cortex Code CLI v1.1.104; cortex skill add with the public GitHub repository finds the 8 nirantar skills, and cortex skill list shows them as remote skills.',
    cap: 'Terminal screenshot of the CoCo CLI, 06 Oct 2026; the full transcript is in the repository. Running the skills from the CLI needs a Snowflake login.' },
];
const PHASES = [
  { n: 1, name: 'Planning', shots: [0],
    did: html`Framed the problem in 10 points (personas, decisions, the cost of not knowing), drew the ontology as an ER diagram (ISA-95 plant hierarchy, ISO 14224 failure modes, ERP, CMMS), mapped the workflow and wrote a 21-row build plan with the top 8 risks: a 437-line plan.`,
    skills: [], skillNote: 'none needed: CoCo read our 4 design documents and the workspace rules',
    ev: [['docs/coco-journal.md', 'CoCo journal'], ['snowflake-workspace/AGENTS.md', 'Rules CoCo followed']] },
  { n: 2, name: 'Development', shots: [1],
    did: html`Generated the synthetic plant (${SF.machines} machines, ${SF.tags} sensor tags, ${SF.rows} readings, ${SF.episodes} failure episodes) and ${SF.docs} documents, then built the Dynamic Tables, the rules-v1 scoring, the agent tools, the semantic view, Cortex Search (shown), the Cortex Agent and the Streamlit app.`,
    skills: ['nirantar-synthetic-plant', 'nirantar-ontology-semantic-view', 'nirantar-work-order', 'nirantar-rca', 'nirantar-command-center'], builtin: 'agent-studio',
    ev: [['docs/evidence/prompts/', 'Every prompt CoCo received'], ['docs/evidence/D/', 'Development screenshots']] },
  { n: 3, name: 'Execution', shots: [2],
    did: html`Ran the hero case live: reset, six 1-minute serverless ticks, the alert on ${H} (risk ${SF.risk}, ${SF.rul} to failure) and the drafted work order waiting for approval, then suspended the tasks (${SF.runCredits} warehouse credits). Scheduled a CoCo Automation, the Morning Reliability Briefing, daily at ${SF.brief}.`,
    skills: ['nirantar-reliability-brief'],
    ev: [['docs/evidence/prompts/E-execution.txt', 'Execution prompt']] },
  { n: 4, name: 'Testing', shots: [3],
    did: html`Wrote and ran ${c('OPS.RUN_TESTS()')}: data integrity, telemetry, physics, OEE bands, the seeded failure patterns, the back-test, the hero numbers and edge cases (duplicate alert, sensor-fault veto, approval bypass, stale data). ${SF.tests} pass; the agent golden set is reported separately (first run: ${SF.agentFirst}).`,
    skills: ['nirantar-coco-evidence'],
    ev: [['docs/evidence/prompts/T-testing.txt', 'Testing prompt'], ['docs/submission/metrics.json', 'Measured metrics']] },
];
const SHARE = { name: 'Sharing: reusable skills', shots: [4, 5],
  did: html`CoCo installed our ${SF.skills} ${c('nirantar-*')} skills in the Snowsight workspace, and the CoCo CLI (${SF.cli}) installs the same ${SF.skills} straight from GitHub with ${c('cortex skill add')} (verified on 06 Oct). Running them from the CLI needs a Snowflake login (personal access token).`,
  skills: SKILLS, ev: [['skills/', 'Skills folder'], ['.cortex-plugin/plugin.json', 'plugin.json'], ['docs/evidence/X/02-coco-cli-skill-add.txt', 'CLI transcript']] };

// ---------- the CoCo guidelines: recommended tasks and ways to show ingenuity ----------
const MCP_DOES = html`Not wired in Snowflake. Work Orders and the Shift brief show a labelled “Share via MCP (preview)” with the exact tool calls for Jira, Slack and Google Drive; nothing is sent. Preview in the demo; live wiring is the finale step.`;
function guides() {
  return [
    { title: 'Recommended CoCo tasks', items: [
      { name: 'Synthetic data generation', st: ['live', 'demo', 'repo'],
        does: html`CoCo generated the fictional Indus Group with the ${c('nirantar-synthetic-plant')} skill: ${SF.plants} plants, ${SF.machines} machines, ${SF.tags} sensor tags, ${SF.rows} readings over ${SF.days} days and ${SF.episodes} failure episodes, consistent across OT, ERP and CMMS. This demo rebuilds the same plants and machines from a seed in your browser.`,
        go: [['#/data', 'scenarios']], ev: [['docs/evidence/D/02-history-generated.jpg', 'History generated'], ['skills/nirantar-synthetic-plant/SKILL.md', 'Skill'], ['DATASETS.md', 'Datasets']] },
      { name: 'Pipelines (dynamic tables, tasks, streams)', st: ['live'],
        does: html`Dynamic Tables with a 15-minute lag (chosen for cost), a serverless task graph (a 1-minute sensor tick, then scoring) and a serverless alert that drafts the work order. Snowflake streams are not used.`,
        go: [['#/built', 'architecture']], ev: [['docs/evidence/prompts/D4-D5-pipeline-scoring.txt', 'Dynamic Tables (prompt)'], ['docs/evidence/prompts/D6-D7-D8-sim-tools-alert.txt', 'Tasks and alert (prompt)']] },
      { name: 'Semantic model and ontology', st: ['live'],
        does: html`The semantic view ${c('SV_PLANT_OPS')} carries the ontology (plant → line → machine → sensor, ISO 14224 failure modes, ERP and CMMS) and governed metrics such as OEE, MTBF and MTTR, with verified queries validated against 5 paraphrases each.`,
        go: [['#/copilot', 'ask about OEE']], ev: [['docs/evidence/prompts/D9-semantic-view.txt', 'Semantic view (prompt)'], ['skills/nirantar-ontology-semantic-view/SKILL.md', 'Skill']] },
      { name: 'Streamlit app', st: ['live'],
        does: html`The live Command Center is a Streamlit app in Snowflake (Streamlit ${SF.streamlit} on the warehouse runtime) with the same ${TOUR.length}-step tour as this demo.`,
        go: [['#/built', 'live app and demo side by side']], ev: [['docs/evidence/prompts/D12-streamlit.txt', 'Streamlit (prompt)'], ['docs/screenshots/08-snowflake-streamlit-plant-map.jpg', 'Plant Map in Snowflake'], ['docs/screenshots/09-snowflake-streamlit-work-orders.jpg', 'Work orders in Snowflake']] },
      { name: 'MCP connectors', short: 'MCP', st: ['preview', ['nb', 'Not built in Snowflake']], does: MCP_DOES,
        go: [['#/orders', 'MCP preview'], ['#/brief', 'MCP preview']], ev: [], evNone: 'none in Snowflake yet: not built' },
      { name: 'Document processing', st: ['live', 'demo'],
        does: html`CoCo generated ${SF.docs} maintenance documents (manuals, SOPs, quality notes, Hinglish technician notes) with ${c('AI_COMPLETE')} and ${c('AI_TRANSLATE')}, split them into ${SF.chunks} chunks and indexed them in Cortex Search; the copilot cites them by name.`,
        go: [['#/copilot', 'sources']], ev: [['docs/evidence/D/03-docs-corpus.jpg', 'Documents generated'], ['docs/evidence/D/12-cortex-search.jpg', 'Cortex Search test']] },
    ] },
    { title: 'Ways to show ingenuity', items: [
      { name: 'Reusable, shareable skills (the headline item)', st: ['live', 'repo'],
        does: html`${SF.skills} ${c('nirantar-*')} skills plus ${c('.cortex-plugin/plugin.json')}: CoCo installed them in the Snowsight workspace, and the CoCo CLI installs the same ${SF.skills} from GitHub (verified, screenshot).`,
        ev: [['skills/', 'Skills folder'], ['.cortex-plugin/plugin.json', 'plugin.json'], ['docs/evidence/X/02-coco-cli-skill-add.png', 'CLI screenshot']], to: 'jdCoco', toLabel: 'See both screenshots' },
      { name: 'MCP to external tools', short: 'MCP', st: ['preview', ['nb', 'Not built in Snowflake']], does: MCP_DOES,
        go: [['#/orders', 'MCP preview'], ['#/brief', 'MCP preview']], ev: [], evNone: 'none in Snowflake yet: not built' },
      { name: 'Automations and scheduled runs', st: ['live', 'demo'],
        does: html`A CoCo Automation, the Morning Reliability Briefing, runs daily at ${SF.brief} with the ${c('nirantar-reliability-brief')} skill and stores the brief in ${c('APP.SHIFT_BRIEFS')}; the Shift brief page shows the same kind of brief.`,
        go: [['#/brief', 'morning brief']], ev: [['docs/evidence/E/01-hero-run-e1-e2.jpg', 'Automation created'], ['docs/evidence/prompts/E-execution.txt', 'Execution prompt']] },
      { name: 'Custom tools and function calling', st: ['live', 'demo'],
        does: html`The Cortex Agent calls ${AGENT_TOOLS.length} procedures as tools: ${AGENT_TOOLS.map((t, i) => html`${i ? (i === AGENT_TOOLS.length - 1 ? ' and ' : ', ') : ''}${c(t)}`)}; each copilot answer in this demo lists the tools it used.`,
        go: [['#/copilot', 'tools used']], ev: [['docs/evidence/prompts/D11-agent.txt', 'Agent (prompt)'], ['docs/evidence/prompts/D6-D7-D8-sim-tools-alert.txt', 'Tools (prompt)']] },
      { name: 'Multi-agent orchestration', st: ['partial', 'live'],
        does: html`A chained skill workflow (alert-triage → rca → work-order) plus one tool-calling Cortex Agent; not separate agents talking to each other.`,
        ev: [['skills/README.md', 'Skill chain'], ['docs/diagrams/03-coco-skills.png', 'Skills diagram']] },
      { name: 'Working across surfaces', st: ['partial', 'live'],
        does: html`The build ran in CoCo in Snowsight (Cloud Agent panel, parallel chats, workspace files) with a CoCo Automation, and the agent is registered for Snowflake CoWork. The CoCo CLI installs the same ${SF.skills} skills from GitHub (verified, screenshot); running them from the CLI needs a Snowflake login (personal access token). Desktop and Slackbot were not used.`,
        ev: [['docs/evidence/X/02-coco-cli-skill-add.png', 'CLI screenshot'], ['docs/evidence/X/02-coco-cli-skill-add.txt', 'CLI transcript'], ['docs/coco-journal.md', 'CoCo journal']] },
      { name: 'Guardrails and graceful fallback', st: ['live', 'demo'],
        does: html`Only a named person approves (POL-G8); a suspected sensor fault never sends a crew (SOP-50); refused requests are logged; tests cover approval bypass and stale-data refusal; CoCo has daily credit caps and the warehouse a resource monitor.`,
        go: [['#/copilot', 'try a refusal'], ['#/trust', 'blocked requests']], ev: [['docs/evidence/T/01-test-suite-results.jpg', 'Guardrail tests'], ['snowflake-workspace/AGENTS.md', 'Workspace rules'], ['docs/evidence/prompts-used.md', 'Credit caps (setup)']] },
    ] },
  ];
}

// ---------- the rubric: where each score comes from ----------
function rubric(N) {
  const v = k => (k === 'customers' ? (N[k] ?? '–') : nw(N[k] ?? '–'));
  return [
    { name: 'Real-World Relevance', w: 30, items: [
      { t: html`Rupees and orders, not just alarms: ${H} puts ${v('atStake')} of production and ${v('customers')} order at risk, and alerts are ranked by it.`, go: [['#/triage', '']] },
      { t: html`IT and OT on one screen: sensors beside spares, supplier lots, orders and the work-order history.`, go: [[`#/machine/${HERO}`, 'IT + OT timeline']] },
      { t: html`Plant practice built in: ISO 10816 vibration zones, ISA-101 grey screens, ISA-18.2 alarm floods, lock-out first and a Hindi job card.`, go: [['#/tech', ''], ['#/rules', '']] },
      { t: html`A business case a plant head can check, from inputs they can change.`, go: [['#/roi', '']] },
    ] },
    { name: 'Technical Execution', w: 40, items: [
      { t: html`One Snowflake account runs it all: Dynamic Tables, serverless tasks and alert, the semantic view, Cortex Search, a Cortex Agent with ${AGENT_TOOLS.length} tools and the Streamlit app.`, go: [['#/built', '']] },
      { t: html`Measured, not claimed: the explainable rules-v1 model caught ${v('det')} of ${v('tot')} past failures a median ${v('lead')} early, with ${v('fa')} false alarms per machine-month.`, go: [['#/trust', '']] },
      { t: html`Tested by CoCo: ${SF.tests} checks pass, including approval bypass, the sensor-fault veto and stale-data refusal.`, ev: [['docs/evidence/T/01-test-suite-results.jpg', 'Test results']] },
      { t: html`CoCo in all ${PHASES.length} phases, packaged as ${SF.skills} reusable skills.`, to: 'jdCoco', toLabel: 'CoCo across the lifecycle' },
    ] },
    { name: 'Solution Completeness', w: 30, items: [
      { t: html`The loop closes in ${TOUR.length} steps: ${TOUR.map(s => s.verb.toLowerCase()).join(', ')}.`, go: [['#/map', 'start the tour']] },
      { t: html`After approval: the part transfer, the booked window, the technician's job card and the OEE gain.`, go: [['#/orders', ''], ['#/tech', '']] },
      { t: html`${SCENARIOS.length} scenarios, including a sensor fault and an alarm flood; works offline, on a phone, in light and dark.`, go: [['#/data', '']] },
      { t: html`An open repository: the skills, the prompts CoCo received, tests, the deck and an MIT licence.`, ev: [['', 'Repository on GitHub']] },
    ] },
  ];
}

// ---------- full-size screenshot dialog ----------
function lightbox(s) {
  return html`<div class="jd-lb">
    <div class="jd-lb-head">
      <h2 id="jdLbTitle">${s.title}</h2>
      <div class="jd-lb-tools">
        <button class="btn" data-action="jd-zoom" aria-pressed="false">${icon('search')}<span>Zoom in</span></button>
        <a class="btn" href="../${s.path}" target="_blank" rel="noopener">${ico('ext')}Open the image<span class="visually-hidden"> (new tab)</span></a>
        <a class="btn" href="${ghHref(s.path)}" target="_blank" rel="noopener">${ico('code')}On GitHub<span class="visually-hidden"> (new tab)</span></a>
      </div>
      <button class="icon-btn jd-lb-x" data-action="jd-close" aria-label="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="jd-lb-img" tabindex="0" aria-label="Screenshot. When zoomed in, scroll to move around."><img src="../${s.path}" width="${s.w}" height="${s.h}" alt="${s.alt}"></div>
    <p class="jd-lb-foot">${s.cap} <span class="dim">Esc closes.</span></p>
  </div>`;
}
const shotBtn = i => {
  const s = SHOTS[i];
  return html`<figure class="jd-fig">
    <button class="jd-shot" data-action="jd-open" data-i="${i}" data-clip-ok style="--fx:${s.fx}%;--fy:${s.fy}%;--z:${s.z}">
      <img src="../${s.path}" width="${s.w}" height="${s.h}" loading="lazy" decoding="async" alt="${s.alt}">
      <span class="jd-shot-off">${icon('info')}Screenshot not available offline: open it on GitHub</span>
      <span class="jd-shot-cta">${ico('expand')}View full size</span>
    </button>
    <figcaption>${s.short}</figcaption>
  </figure>`;
};
const skillList = (skills, builtin) => html`<p class="jd-skills"><span class="jd-lbl">Skills</span>${skills.map(k => html`<code class="jd-skill">${k}</code>`)}${builtin ? html`<span class="dim small">built-in: ${builtin}</span>` : ''}</p>`;

let ui = { opener: null, shot: null };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default {
  autoRerender: false,   // nothing here follows the plant clock; load / clear re-render through the router
  render(root, ctx) {
    const { store } = ctx;
    const N = refNumbers(store) || {};
    const B = briefPoints(N), G = guides(), R = rubric(N);
    const all = G.flatMap(g => g.items);
    const both = B.filter(p => has(p, 'live') && has(p, 'demo')).length;
    const liveN = all.filter(it => has(it, 'live') && !has(it, 'partial')).length;
    const partN = all.filter(it => has(it, 'partial')).length;
    const prevN = all.filter(it => has(it, 'preview')).length;
    const previews = [...new Set(all.filter(it => has(it, 'preview')).map(it => it.short || it.name))];
    const sc = store.loaded ? SCENARIOS.find(s => s.id === store.state.scenarioId) : null;

    const note = !store.loaded
      ? html`<section class="jd-note" aria-label="Sample data">${icon('info')}<p>No sample data is loaded, so the <b>Show me</b> pages will ask you to load it first. The numbers on this page come from a fresh copy of the sample plant either way.</p><button class="btn primary" data-action="load-sample" data-scenario="${REF.id}">${icon('data')} Load sample data</button></section>`
      : sc && sc.id !== REF.id ? html`<section class="jd-note" aria-label="Scenario">${icon('info')}<p>You have “${sc.name}” loaded. The <b>Show me</b> links follow ${H} in “${REF_SC.name}”; load it to see the same numbers.</p><button class="btn primary" data-action="load-sample" data-scenario="${REF.id}">${icon('data')} Load “${REF_SC.name}”</button></section>` : '';

    root.innerHTML = String(html`<div class="page judges">
      ${pageHead('judges')}
      ${headline(html`<b>${both === B.length ? `All ${B.length}` : `${both} of ${B.length}`} points of problem #03</b> are live in Snowflake and shown in this demo, and <b>CoCo was used in all ${PHASES.length} phases</b>: planning, development, execution and testing. Each row opens the place to see it in one click and says plainly what is only partly done (${partN} items) or just a labelled preview (${previews.join(', ')}).`)}
      ${note}
      ${doThis([
        html`Read the brief point by point ${marker(1)}: every row has a status and <b>Show me</b> buttons that open the exact page of this demo.`,
        html`Press a screenshot ${marker(2)} to see the real CoCo work full size (Esc closes it).`,
        html`Check the CoCo guideline items ${marker(3)} and where each judging score comes from ${marker(4)}.`,
        html`Read what is measured and what is simulated ${marker(5)}, so you know exactly what is real.`,
      ])}

      <section class="jd-legend" aria-label="What the status chips mean"><b>Status</b>${Object.keys(ST).map(k => html`<span class="jd-lg">${chip(k)}<span>${ST[k].mean}</span></span>`)}</section>

      <section class="jd-sec" id="jdBrief" aria-labelledby="jdBriefH">
        <div class="jd-sec-head">${marker(1)}<h2 id="jdBriefH" tabindex="-1">The brief, point by point</h2><span class="sub">${both} of ${B.length} live in Snowflake and in this demo</span></div>
        <blockquote class="jd-quote"><p>${PROBLEM}</p><footer>Problem statement #03, Predictive Maintenance and OEE Command Center</footer></blockquote>
        <p class="jd-intro small dim">Numbers below are computed by this demo's model on a fresh copy of the sample plant (“${REF_SC.name}”), the same case as the Snowflake build; the live pages move on with the plant clock.</p>
        <div class="jd-cols" aria-hidden="true"><span>The brief asks</span><span>What Nirantar does</span><span>See it</span></div>
        <ol class="jd-points">${B.map((p, i) => html`<li class="jd-pt">
          <div class="jd-pt-q"><span class="jd-num">${i + 1}</span><div><h3>${p.q}</h3><div class="jd-chips">${p.st.map(chip)}</div></div></div>
          <p class="jd-pt-a">${p.does}</p>
          ${seeIt(p)}
        </li>`)}</ol>
      </section>

      <section class="jd-sec" id="jdCoco" aria-labelledby="jdCocoH">
        <div class="jd-sec-head">${marker(2)}<h2 id="jdCocoH" tabindex="-1">CoCo across the lifecycle</h2><span class="sub">${SF.chats} chats in CoCo in Snowsight · press a screenshot to enlarge it</span></div>
        <div class="jd-phases">
          ${PHASES.map(p => html`<article class="jd-phase" aria-labelledby="jdPh${p.n}">
            ${p.shots.map(shotBtn)}
            <h3 id="jdPh${p.n}"><span class="stepnum">${p.n}</span>${p.name}</h3>
            <p class="jd-did">${p.did}</p>
            ${p.skills.length ? skillList(p.skills, p.builtin) : html`<p class="jd-skills"><span class="jd-lbl">Skills</span><span class="dim small">${p.skillNote}</span></p>`}
            <div class="jd-evs"><span class="jd-lbl">Evidence</span>${p.ev.map(evLink)}</div>
          </article>`)}
          <article class="jd-phase share" aria-labelledby="jdPhS">
            <div class="jd-shots">${SHARE.shots.map(shotBtn)}</div>
            <h3 id="jdPhS"><span class="stepnum">${ico('code')}</span>${SHARE.name}</h3>
            <p class="jd-did">${SHARE.did}</p>
            ${skillList(SHARE.skills)}
            <div class="jd-evs"><span class="jd-lbl">Evidence</span>${SHARE.ev.map(evLink)}</div>
          </article>
        </div>
      </section>

      <section class="jd-sec" id="jdGuides" aria-labelledby="jdGuidesH">
        <div class="jd-sec-head">${marker(3)}<h2 id="jdGuidesH" tabindex="-1">The CoCo guidelines, item by item</h2><span class="sub">${liveN} of ${all.length} live · ${partN} partly · ${prevN} preview</span></div>
        <div class="jd-guides">${G.map(g => html`<section class="card jd-guide" aria-label="${g.title}">
          <div class="card-head"><h3>${g.title}</h3><span class="sub">${g.items.length} items</span></div>
          <ul class="jd-list">${g.items.map(it => {
            const warn = has(it, 'preview') || has(it, 'nb') || has(it, 'partial');
            return html`<li class="jd-ck">
              <span class="jd-ck-ic ${warn ? 'warn' : ''}">${ico(has(it, 'preview') ? 'eye' : has(it, 'partial') ? 'half' : 'check')}</span>
              <div class="jd-ck-body">
                <div class="jd-ck-head"><h4>${it.name}</h4><span class="jd-chips">${it.st.map(chip)}</span></div>
                <p>${it.does}</p>
                ${seeIt(it)}
              </div>
            </li>`;
          })}</ul>
        </section>`)}</div>
      </section>

      <section class="jd-sec" id="jdRubric" aria-labelledby="jdRubricH">
        <div class="jd-sec-head">${marker(4)}<h2 id="jdRubricH" tabindex="-1">Rubric: where each score comes from</h2><span class="sub">${R.map(r => `${r.name} ${r.w} %`).join(' · ')}</span></div>
        <div class="jd-rubric">${R.map(r => html`<section class="card jd-rb" aria-label="${r.name}, ${r.w} %">
          <div class="jd-rb-head"><span class="jd-rb-w">${r.w}<small> %</small></span><h3>${r.name}</h3></div>
          <ul>${r.items.map(it => html`<li><span>${it.t}</span><span class="jd-rb-links">${(it.go || []).map(([route, focus]) => {
            const page = route.replace(/^#\/?/, '').split('/')[0] || 'home', p = PAGES[page], step = TOUR.find(s => s.page === page);
            return html`<a class="jd-rb-go" href="${route}">${icon('arrowR')}${step ? `${step.n} · ` : ''}${p ? p.title : route}${focus ? `: ${focus}` : ''}</a>`;
          })}${(it.ev || []).map(evLink)}${it.to ? html`<button class="jd-rb-go" data-action="jd-to" data-to="${it.to}">${icon('arrowR')}${it.toLabel}</button>` : ''}</span></li>`)}</ul>
        </section>`)}</div>
      </section>

      <section class="jd-sec" id="jdHonest" aria-labelledby="jdHonestH">
        <div class="jd-sec-head">${marker(5)}<h2 id="jdHonestH" tabindex="-1">Measured vs simulated</h2><span class="sub">all data is synthetic</span></div>
        <div class="jd-honest">
          <section class="card" aria-label="Measured in Snowflake"><h3>${ico('snow')}Measured in Snowflake, on synthetic data</h3><ul>
            <li>Back-test over ${SF.episodes} past failures: ${SF.caught} caught (${SF.detect}), a median ${SF.lead} early, ${SF.fa} false alarms per machine-month.</li>
            <li>Hero run: ${H} risk ${SF.risk}, ${SF.rul} to failure, ISO zone C; the work order was drafted within a minute of the alert.</li>
            <li>Tests: ${SF.tests} pass; the agent golden set scored ${SF.agentFirst} on its first run and is reported as measured.</li>
          </ul></section>
          <section class="card" aria-label="Simulated"><h3>${icon('play')}Simulated</h3><ul>
            <li>The company: a fictional Indus Group with ${SF.plants} plants and ${SF.machines} machines; no real company, person or reading.</li>
            <li>The sensor stream: in Snowflake a serverless task writes each new minute of readings; no plant historian is connected yet.</li>
            <li>In this demo the plant clock, part transfers, approvals and repairs run in your browser; nothing is sent anywhere.</li>
          </ul></section>
          <section class="card" aria-label="This demo and the live app"><h3>${icon('globe')}This public demo and the live app</h3><ul>
            <li>The live app is a Streamlit app in Snowflake with a Cortex Agent; its link and a read-only login are in the submission form.</li>
            <li>This demo re-implements the scoring model in your browser (rules-v1: sensor limits, trends and failure-mode signatures, not an ML classifier) and replaces the agent with a rule-based copilot that cites the same kinds of sources.</li>
            <li>The numbers match the Snowflake build: here ${H} shows ${nw(N.conf || '–')} confidence and about ${nw(N.rul || '–')} to failure (Snowflake: risk ${SF.risk}, ${SF.rul}), and the back-test gives ${N.det ?? '–'} of ${N.tot ?? '–'} here too.</li>
          </ul></section>
          <section class="card" aria-label="Not used or not built"><h3>${icon('x')}Not used, or not built yet</h3><ul>
            <li>Snowflake streams and Snowpipe Streaming: the pipeline uses Dynamic Tables and serverless tasks.</li>
            <li>The CoCo CLI and Desktop for the build: it ran in CoCo in Snowsight; the CLI was used only to install the skills from GitHub.</li>
            <li>MCP wiring to Jira, Slack and Google Drive: a labelled preview; live wiring is the finale step.</li>
            <li>An ML classifier: rules-v1 stays explainable with only ${SF.episodes} failures; comparing it with an ML model is a finale step.</li>
          </ul></section>
        </div>
      </section>

      <section class="card jd-links" aria-label="Links">
        <div class="card-head"><h2>Read further</h2><span class="sub">code, decks and story page</span></div>
        <div class="row">
          <a class="btn primary" href="${REPO}" target="_blank" rel="noopener">${ico('code')} Source code on GitHub<span class="visually-hidden"> (new tab)</span></a>
          <a class="btn" href="../docs/slides/nirantar-deck.html" target="_blank" rel="noopener">${icon('doc')} Slides (19, web)<span class="visually-hidden"> (new tab)</span></a>
          <a class="btn" href="${DECK}" target="_blank" rel="noopener">${icon('doc')} Deck (PDF)<span class="visually-hidden"> (new tab)</span></a>
          <a class="btn" href="../">${icon('globe')} Story page</a>
        </div>
      </section>
      ${nextBack('judges')}
      <dialog class="jd-lightbox" id="jdLb" aria-labelledby="jdLbTitle"></dialog>
    </div>`);

    const dlg = root.querySelector('#jdLb');
    const onBackdrop = e => { if (e.target === dlg) dlg.close(); };
    const onDlgKey = e => { if (e.key !== 'Escape') e.stopPropagation(); };   // keep the app's g-shortcuts and palette out
    const onClose = () => { const o = ui.opener; ui.opener = null; if (o && o.isConnected) o.focus({ preventScroll: true }); };
    const onImgErr = e => { const b = e.target && e.target.tagName === 'IMG' ? e.target.closest('.jd-shot') : null; if (b) b.classList.add('broken'); };
    dlg.addEventListener('click', onBackdrop);
    dlg.addEventListener('keydown', onDlgKey);
    dlg.addEventListener('close', onClose);
    root.addEventListener('error', onImgErr, true);   // image errors do not bubble
    const off = delegate(root, {
      'jd-open': el => {
        const s = SHOTS[+el.dataset.i];
        if (!s) return;
        if (el.classList.contains('broken')) { window.open(ghHref(s.path), '_blank', 'noopener'); return; }
        dlg.innerHTML = String(lightbox(s));
        ui.opener = el; ui.shot = s;
        if (!dlg.open) dlg.showModal();
      },
      'jd-close': () => { if (dlg.open) dlg.close(); },
      'jd-zoom': el => {
        const box = dlg.querySelector('.jd-lb-img'), on = !box.classList.contains('zoomed'), s = ui.shot;
        box.classList.toggle('zoomed', on);
        el.setAttribute('aria-pressed', String(on));
        el.querySelector('span').textContent = on ? 'Fit to screen' : 'Zoom in';
        if (on && s) {   // start where the thumbnail pointed (the meaningful part), at the image's own pixel size
          box.scrollLeft = Math.max(0, (box.scrollWidth - box.clientWidth) * s.fx / 100);
          box.scrollTop = Math.max(0, (box.scrollHeight - box.clientHeight) * Math.max(0, s.fy - 15) / 100);
        }
      },
      'jd-to': el => {
        const t = root.querySelector('#' + el.dataset.to);
        if (!t) return;
        t.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        const h = t.querySelector('h2');
        if (h) h.focus({ preventScroll: true });
      },
    });
    return () => {
      off();
      root.removeEventListener('error', onImgErr, true);
      dlg.removeEventListener('click', onBackdrop);
      dlg.removeEventListener('keydown', onDlgKey);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
    };
  },
};
