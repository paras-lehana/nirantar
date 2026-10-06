// Tool: How it is built — maps every demo feature to the Snowflake component that does it in the live app,
// and shows how Snowflake CoCo (Cortex Code) built it. Works without sample data.
import { html, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, aiChip, humanChip, nextBack } from '../ui/components.js';

const REPO = 'https://github.com/paras-lehana/nirantar';
let snap = null;   // site/data.json (CoCo journal + skills), fetched once

const LAYERS = [
  { name: 'Sources', items: ['OT telemetry: simulated PLC / SCADA historian (SIM.EMIT_TICK, a 1-minute serverless task)', 'ERP: stock by plant, supplier lots, production and sales orders', 'CMMS: work orders, failure codes, technicians', 'Documents: manuals, SOPs, Hinglish technician notes'] },
  { name: 'RAW → CORE', items: ['RAW tables landed as-is', 'Dynamic Tables: 15-minute telemetry features (FACT_TELEMETRY_15M), machine state, downtime facts', 'Ontology: plant → line → machine → sensor (ISA-95 style)'] },
  { name: 'ML', items: ['ML.SCORE_LATEST() (model rules-v1): health index, 72-hour failure risk and remaining useful life from sensor limits, trends and failure-mode signatures', 'ML.V_LATEST_PRED: one latest prediction per machine', 'Back-test on 43 past failures'] },
  { name: 'AI', items: ['Semantic View SV_PLANT_OPS (Cortex Analyst): governed metrics such as OEE, MTBF', 'Cortex Search CSS_MAINT_KNOWLEDGE over the documents', 'Cortex Agent NIRANTAR_COPILOT with tools: ASSET_360, CHECK_SPARES, PROPOSE_WINDOW, DRAFT_WORK_ORDER, WHAT_IF_DEFER'] },
  { name: 'APP', items: ['Streamlit in Snowflake "Nirantar Command Center" (this demo copies its 8-step journey)', 'ALERTS, auto-drafted work orders, APP.ACTION_LOG audit trail', 'Human approval procedures (APPROVE_WORK_ORDER / REJECT_WORK_ORDER)', 'CoCo Automation: Morning Reliability Briefing'] },
];

const MAP = [
  ['1 · Plant Map', 'ML.V_LATEST_PRED + ALERTS rendered in Streamlit', 'Seeded generator + the same health formula, in your browser'],
  ['2 · Machine Detail', 'Dynamic Tables of 15-minute telemetry; ML.SCORE_LATEST; ISO 10816 zones', 'Telemetry computed on demand from the scenario; spectrum from bearing geometry'],
  ['3 · Alert Triage', 'ALERTS ranked by risk × money × order deadline (V_PRIORITY)', 'Attention score with the same three ingredients plus criticality and your feedback'],
  ['4 · What If', 'Agent tool WHAT_IF_DEFER', 'Chance of failure read from the same time-to-failure range shown on Machine Detail'],
  ['5 · Work Orders', 'DRAFT_WORK_ORDER, CHECK_SPARES, PROPOSE_WINDOW; human approval procedures; ACTION_LOG', 'Same flow; approvals, transfers and windows simulated; audit kept in your browser'],
  ['6 · Ask Copilot', 'Cortex Agent: Analyst on SV_PLANT_OPS + Search on the documents + tools; guardrail in its instructions', 'A rule-based engine over the sample data that cites the same kinds of sources and enforces the same guardrail'],
  ['7 · OEE', 'Semantic View metrics (A × P × Q, six big losses)', 'Computed from 30 days of generated shift data'],
  ['8 · Trust Audit', 'Back-test table, AGENT_EVAL_SET golden questions, ACTION_LOG', 'Back-test from 56 days of generated history; golden questions run against the demo copilot'],
  ['Maintenance calendar', 'Partly: the PROPOSE_WINDOW agent tool picks the same low-impact windows; the calendar view itself is demo-only so far', 'Preventive jobs from the CMMS history and class intervals; bundling suggestions; a person schedules'],
  ['Technician view', 'Demo-only so far (next for the live app); the steps come from the same SOPs that Cortex Search indexes', 'Job card with lock-out first, step ticks, release reading and notes, each logged with the technician\'s name'],
  ['Reliability & root cause', 'CoCo skill nirantar-rca: 5 whys and fishbone grounded in SQL over telemetry, work-order history and notes', 'Pareto, MTBF / MTTR, bad actors, fishbone and 5 whys built from the sample history and notes'],
  ['Compare machines', 'Demo-only view; the same 15-minute features (FACT_TELEMETRY_15M) are in the live app', 'Peer overlay and fleet heatmap computed from the generated telemetry'],
  ['Alarm rules', 'Demo-only view; the live app alerts on fixed health and confidence thresholds', 'Alarm-limit what-if over the last 7 days; a proposal is an audit row, never a model change'],
  ['Business case', 'Demo-only calculator', 'Illustrative, prefilled from the sample plant; change any input'],
  ['IT + OT timeline (Machine Detail)', 'The same join in Snowflake: 1-minute ticks → FACT_TELEMETRY_15M → V_PRIORITY with ERP orders, stock and CMMS history; the timeline view itself is demo-only', 'Sensor lanes, live readings, ERP and maintenance records and Nirantar actions on one time axis'],
  ['Share via MCP (preview)', 'Not wired in Snowflake yet (finale step)', 'Exact MCP tools/call payloads for Jira, Slack and Drive; nothing is sent'],
  ['For judges: brief coverage', '—', 'Every point of the brief and the CoCo guidelines with a status and a one-click link'],
];

const PHASE_TONE = { SETUP: 'normal', PLANNING: 'ai', DEVELOPMENT: 'ok', EXECUTION: 'watch', TESTING: 'act' };

export default {
  render(root, ctx) {
    if (!snap) fetch('../site/data.json').then(r => r.ok ? r.json() : null).then(d => { snap = d || { journal: [], skills: [] }; ctx.rerender(); }).catch(() => { snap = { journal: [], skills: [] }; ctx.rerender(); });
    const journal = snap?.journal || [];
    const skills = snap?.skills || [];
    root.innerHTML = String(html`<div class="page built">
      ${pageHead('built')}
      ${headline(html`The live Nirantar runs inside <b>one Snowflake account</b> and was built by <b>Snowflake CoCo</b> (Cortex Code) over 20+ chats covering planning, development, execution and testing. This public demo copies its behaviour on sample data so anyone can try it without a login.`, 'ai')}

      <section class="card" aria-label="Architecture">
        <div class="card-head"><h2>From sensor to approved repair, inside Snowflake</h2>${aiChip('Built by CoCo')}</div>
        <ol class="layers">${LAYERS.map((l, i) => html`<li class="layer"><span class="stepnum">${i + 1}</span><div><b>${l.name}</b><ul>${l.items.map(it => html`<li>${it}</li>`)}</ul></div></li>`)}</ol>
        <p class="small dim">IT and OT data meet in one governed place: no copies leave Snowflake, and every AI action is logged next to the data.</p>
      </section>

      <section class="card" aria-label="Feature map">
        <div class="card-head"><h2>Each demo page and what does it in the live app</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Step</th><th>Live app in Snowflake</th><th>This public demo</th></tr></thead>
          <tbody>${MAP.map(([a, b, c]) => html`<tr><td><b>${a}</b></td><td>${b}</td><td class="dim">${c}</td></tr>`)}</tbody></table></div>
      </section>

      <div class="cols-2">
        <section class="card" aria-label="Guardrails">
          <div class="card-head"><h2>Guardrails are features</h2>${humanChip('People decide')}</div>
          <ul class="ticks">
            <li>No path lets the AI approve, release or close a work order.</li>
            <li>A suspected sensor fault never dispatches a repair crew (inspection first).</li>
            <li>Schedules are changed by people, not by the copilot.</li>
            <li>Every AI and human action is written to the audit log with who and when.</li>
          </ul>
        </section>
        <section class="card" aria-label="CoCo skills">
          <div class="card-head"><h2>Reusable CoCo skills</h2><span class="sub">${skills.length || 8} skills</span></div>
          <p class="small muted">Custom skills that teach CoCo how to rebuild and run Nirantar; published in the repository.</p>
          <ul class="skills">${(skills.length ? skills : ['nirantar-synthetic-plant', 'nirantar-ontology-semantic-view', 'nirantar-alert-triage', 'nirantar-work-order', 'nirantar-rca', 'nirantar-reliability-brief', 'nirantar-command-center', 'nirantar-coco-evidence']).map(s => html`<li><a class="mono" href="${REPO}/tree/main/skills/${s}" rel="noopener">${s}</a></li>`)}</ul>
        </section>
      </div>

      <section class="card" aria-label="CoCo build journal">
        <div class="card-head"><h2>How CoCo built it</h2><span class="sub">milestones from the CoCo journal</span></div>
        ${journal.length ? html`<ol class="journal">${journal.map(j => html`<li><span class="j-ts mono">${j.ts.slice(5, 16)}</span><span class="state ${PHASE_TONE[j.phase] || 'normal'}">${j.phase.charAt(0) + j.phase.slice(1).toLowerCase()}</span><span>${j.summary}</span></li>`)}</ol>`
          : html`<p class="dim">${snap ? 'Journal not available offline. See docs/coco-journal.md in the repository.' : 'Loading the CoCo journal…'}</p>`}
        <p class="small"><a href="${REPO}/blob/main/docs/coco-journal.md" rel="noopener">Full journal with screenshots ${icon('arrowR')}</a></p>
      </section>

      <section class="card" aria-label="Links">
        <div class="row"><a class="btn primary" href="${REPO}" rel="noopener">${icon('doc')} Source code on GitHub</a><a class="btn" href="../">Story page</a><a class="btn" href="../docs/submission/Nirantar_AidhunikIndia_CoCoHackathon_GCC.pdf">Pitch deck (PDF)</a></div>
      </section>
      ${nextBack('built')}
    </div>`);
    return delegate(root, {});
  },
};
