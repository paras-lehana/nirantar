// Tool · Help & glossary: how to follow Nirantar (8 steps, colours, who does what), keyboard shortcuts, a searchable
// glossary of every term the pages use, and an FAQ. Works without data; live examples appear when data is loaded.
import { html, icon, delegate, raw } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, nextBack, legendStates } from '../ui/components.js';
import { TOUR } from '../routes.js';
import { ATTENTION_BANDS } from '../core/store.js';
import { HEALTH_FORMULA, CONF_NOTE } from '../core/scoring.js';
import { TAGS, FAILURE_MODES } from '../core/generator.js';
import { hours, inr, int } from '../core/format.js';

// index.html does not link this page's stylesheet; add it once (requested as a shared change in the report).
if (typeof document !== 'undefined' && !document.querySelector('link[data-page-css="help"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/pages/help.css', import.meta.url).href; l.dataset.pageCss = 'help';
  document.head.appendChild(l);
}

const REPO = 'https://github.com/paras-lehana/nirantar';
const DECK = '../docs/submission/Nirantar_AidhunikIndia_CoCoHackathon_GCC.pdf';
const GO_KEYS = [['h', 'Home'], ...[['m', 'map'], ['d', 'machine'], ['t', 'triage'], ['w', 'whatif'], ['o', 'orders'], ['c', 'copilot'], ['e', 'oee'], ['a', 'trust']]
  .map(([k, p]) => { const s = TOUR.find(x => x.page === p); return [k, `${s.n} · ${s.title}`]; }), ['s', 'Spares & logistics'], ['p', 'Presenter']];
const CATS = [['all', 'All'], ['rel', 'Reliability'], ['vib', 'Vibration'], ['alarm', 'Alarms'], ['oee', 'OEE'], ['trust', 'Trust and AI'], ['platform', 'Platform']];
const CAT_NAME = Object.fromEntries(CATS);
const ROLE = {
  map: ['Nirantar scores every machine every 15 minutes and colours the map.', 'You look for colour.'],
  machine: ['Nirantar shows the evidence: sensor trends, spectrum, P-F curve, time to failure.', 'You judge whether it convinces you.'],
  triage: ['Nirantar ranks alerts by attention score and groups floods by root cause.', 'You acknowledge, shelve or escalate.'],
  whatif: ['Nirantar prices waiting: chance of failure, expected loss, planned cost.', 'You choose the repair window.'],
  orders: ['Nirantar drafts the work order with steps, part, technician and window.', 'Only a named person approves it.'],
  copilot: ['The copilot answers with sources and refuses unsafe requests.', 'You ask, and decide what to do with the answer.'],
  oee: ['Nirantar computes OEE and counts the savings.', 'You read what it means for output.'],
  trust: ['Nirantar shows its back-test, guardrail log and audit trail.', 'You set the alert threshold and verify.'],
};

let ui = { q: '', cat: 'all', faq: new Set([0]) };   // faq = indexes of the open questions
let rerender = null;

export default {
  autoRerender: false,   // nothing here changes with the plant clock; keeps the glossary search box undisturbed
  // only loading or clearing data changes this page (live examples, the FAQ buttons); store.changed(what) emits ('change', what)
  onStore(kind, detail) { const what = kind === 'change' ? detail : kind; if ((what === 'load' || what === 'clear') && rerender) rerender(); },
  render(root, ctx) {
    const { store, M } = ctx;
    rerender = ctx.rerender;
    const loaded = store.loaded;
    const terms = glossary(store, M);
    const bandText = ATTENTION_BANDS.map(([min, name]) => (min ? `${name} from ${min.toFixed(2)}` : `${name} below ${ATTENTION_BANDS[ATTENTION_BANDS.length - 2][0].toFixed(2)}`)).join(', ');

    root.innerHTML = String(html`<div class="page helppage">
      ${pageHead('help')}
      ${headline(html`Nirantar follows one rule: <b>grey means normal, colour means act</b>. Follow the 8 steps in order; the AI prepares, a person decides. ${terms.length} terms are explained below.`, 'ai')}
      ${doThis([html`Read how a tour step works ${marker(1)} (about 30 seconds).`, html`Search the glossary ${marker(2)} when a word is unclear; every term links to the page that uses it.`, html`Check the FAQ ${marker(3)}, or replay the welcome.`])}

      <section class="card" aria-label="How to use Nirantar">
        <div class="card-head">${marker(1)}<h2>How to use Nirantar</h2><span class="sub">8 steps, about 3 minutes</span></div>
        <p class="small muted">Every step page answers one question in its first sentence, shows a numbered <b>Do this now</b> box with matching markers next to the things to press, and ends with Next and Back.</p>
        <ol class="hp-steps">${TOUR.map(s => html`<li>
          <a class="hp-step" href="${s.route}"><span class="stepnum">${s.n}</span><span><b>${s.verb}: ${s.title}</b><span class="small muted">${s.q}</span></span></a>
          <p class="hp-who"><span>${aiChip('AI')} ${ROLE[s.page][0]}</span><span>${humanChip('You')} ${ROLE[s.page][1]}</span></p>
        </li>`)}</ol>
      </section>

      <div class="cols-2">
        <section class="card" aria-label="Colours">
          <div class="card-head"><h2>What the colours mean</h2></div>
          ${legendStates()}
          <ul class="hp-colours">
            <li>${stateChip('normal')}<span>Grey: running normally. Most of the screen should be grey (ISA-101 practice).</span></li>
            <li>${stateChip('watch')}<span>Amber: something is drifting; keep an eye on it. Health below 80 or failure confidence 15 % or more.</span></li>
            <li>${stateChip('act')}<span>Red: act now. Health below 50 or failure confidence 80 % or more.</span></li>
            <li>${stateChip('sensor')}<span>Amber with a sensor icon: the sensor looks broken, not the machine. Inspect it; no repair crew.</span></li>
            <li>${aiChip('Made by the AI')}<span>Blue: predictions, drafts and answers made by Nirantar. They wait for a person.</span></li>
            <li>${stateChip('ok', 'Done')}<span>Green: a decision a person made (approved, completed).</span></li>
          </ul>
          <p class="small dim">Colour is never alone: every state also has an icon and a word.</p>
        </section>

        <section class="card" aria-label="Keyboard shortcuts">
          <div class="card-head">${icon('keyboard')}<h2>Keyboard shortcuts</h2></div>
          <dl class="hp-keys">
            <dt><span class="kbd">Ctrl</span> <span class="kbd">K</span> <span class="dim small">or</span> <span class="kbd">⌘</span> <span class="kbd">K</span> <span class="dim small">or</span> <span class="kbd">/</span></dt><dd>Search machines, pages and scenarios; jump anywhere</dd>
            <dt><span class="kbd">Shift</span> <span class="kbd">Space</span></dt><dd>Play or pause the plant clock</dd>
            <dt><span class="kbd">Esc</span></dt><dd>Close a dialog or the search</dd>
            <dt><span class="kbd">↑</span> <span class="kbd">↓</span> <span class="kbd">Enter</span></dt><dd>Move and open inside the search</dd>
          </dl>
          <h3 class="hp-keys-h"><span class="kbd">g</span> then a letter: go to a page</h3>
          <ul class="hp-go">${GO_KEYS.map(([k, label]) => html`<li><span class="kbd">${k}</span>${label}</li>`)}</ul>
        </section>
      </div>

      <section class="card" aria-label="Glossary">
        <div class="card-head">${marker(2)}<h2>Glossary</h2><span class="sub" id="hpCount" aria-live="polite">${terms.length} terms</span></div>
        <div class="hp-search">
          <div class="field"><label for="hpQ">Search the glossary</label>
            <input id="hpQ" class="input" type="search" data-action="h-q" value="${ui.q}" placeholder="Try “OEE”, “bearing” or “alarm”" autocomplete="off"></div>
          <div class="seg" role="group" aria-label="Filter by topic">${CATS.map(([k, l]) => html`<button data-action="h-cat" data-id="${k}" aria-pressed="${ui.cat === k}">${l}</button>`)}</div>
        </div>
        <dl class="hp-terms" id="hpTerms">${terms.map(g => html`<div class="hp-term" data-cat="${g.cat}" data-text="${(g.t + ' ' + (g.alias || '') + ' ' + g.plain).toLowerCase()}">
          <dt><b>${g.t}</b><span class="pill">${CAT_NAME[g.cat]}</span></dt>
          <dd>${g.d}${g.live ? html` <span class="hp-live">${icon('ai')}In this demo: ${g.live}</span>` : ''}${g.see ? html` <a class="hp-see" href="${g.see[0]}">See it on ${g.see[1]} ${icon('arrowR')}</a>` : ''}</dd>
        </div>`)}</dl>
        <p class="hp-none" id="hpNone" hidden>No term matches. Try a shorter word, or choose “All”.</p>
        <p class="small dim">Attention bands: ${bandText}.${loaded ? '' : ' Load sample data to see live examples next to each term.'}</p>
      </section>

      <section class="card" aria-label="Questions">
        <div class="card-head">${marker(3)}<h2>Questions</h2></div>
        <div class="hp-faq">
          <details data-faq="0" ${ui.faq.has(0) ? raw('open') : ''}><summary>Is this real data?</summary>
            <p>No. Everything is synthetic: the company (Indus Group), its plants, machines, people, customers and orders are made up, and the readings are generated in your browser from a seed. The patterns (bearing wear, misalignment, alarm floods) follow real reliability engineering.</p></details>
          <details data-faq="1" ${ui.faq.has(1) ? raw('open') : ''}><summary>How is this related to the Snowflake app?</summary>
            <p>This is the public twin of Nirantar, the app we built inside Snowflake with Snowflake CoCo (Cortex Code) for the CoCo hackathon. It follows the same 8 steps and the same hero case, but runs entirely in your browser so anyone can try it without a login.</p>
            <p class="row"><a class="btn sm" href="${REPO}" target="_blank" rel="noopener">${icon('doc')} Code repository</a><a class="btn sm" href="../">${icon('arrowR')} Story page</a><a class="btn sm" href="${DECK}" target="_blank" rel="noopener">${icon('doc')} Deck (PDF)</a></p></details>
          <details data-faq="2" ${ui.faq.has(2) ? raw('open') : ''}><summary>Does anything leave my browser?</summary>
            <p>No. There is no server and no tracking. Your approvals, notes and settings are kept in this browser's local storage, and exports are created on your computer.</p></details>
          <details data-faq="3" ${ui.faq.has(3) ? raw('open') : ''}><summary>Can I break it?</summary>
            <p>Go ahead: approve, reject, inject faults, jump days ahead. <b>Clear data</b> shows every page's empty state; <b>Reset everything</b> on the Data page wipes all that this browser saved and starts like a first visit.</p>
            <p class="row">${loaded ? html`<button class="btn sm" data-action="clear-data">${icon('x')} Clear data</button>` : html`<button class="btn sm" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load sample data</button>`}<a class="btn sm" href="#/data">${icon('data')} Data & scenarios</a><a class="btn sm" href="#/presenter">${icon('play')} Presenter</a></p></details>
          <details data-faq="4" ${ui.faq.has(4) ? raw('open') : ''}><summary>Does the AI act on its own?</summary>
            <p>No. It scores machines, predicts, ranks, drafts work orders and answers questions. Approving, releasing parts, scheduling and closing work are human-only, and every action, by the AI or a person, is in the audit trail on 8 · Trust Audit.</p></details>
          <details data-faq="5" ${ui.faq.has(5) ? raw('open') : ''}><summary>Who built it?</summary>
            <p>Team <b>Aidhunik India</b>, for the Snowflake CoCo CLI Hackathon 2026 (GCC Edition), problem 03: Predictive Maintenance and OEE Command Center.</p></details>
        </div>
        <div class="row hp-replay"><button class="btn" data-action="welcome">${icon('info')} Replay the welcome</button><span class="small dim">The 3-line introduction shown on your first visit.</span></div>
      </section>
      ${nextBack('help')}
    </div>`);

    const apply = () => {
      const q = ui.q.trim().toLowerCase();
      let shown = 0;
      root.querySelectorAll('.hp-term').forEach(el => {
        const ok = (ui.cat === 'all' || el.dataset.cat === ui.cat) && (!q || q.split(/\s+/).every(w => el.dataset.text.includes(w)));
        el.hidden = !ok; if (ok) shown++;
      });
      const c = root.querySelector('#hpCount'); if (c) c.textContent = shown === terms.length ? `${terms.length} terms` : `${shown} of ${terms.length} terms`;
      const none = root.querySelector('#hpNone'); if (none) none.hidden = shown > 0;
    };
    apply();
    const onToggle = e => { const d = e.target; if (d.dataset && d.dataset.faq != null) { if (d.open) ui.faq.add(+d.dataset.faq); else ui.faq.delete(+d.dataset.faq); } };
    root.addEventListener('toggle', onToggle, true);   // toggle does not bubble: listen in the capture phase
    const undelegate = delegate(root, {
      'h-q': (el, ev) => { if (ev.type === 'click') return; ui.q = el.value; apply(); },
      'h-cat': el => { ui.cat = el.dataset.id; root.querySelectorAll('[data-action="h-cat"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === ui.cat))); apply(); },
    }, ['click', 'input']);
    return () => { root.removeEventListener('toggle', onToggle, true); undelegate(); };
  },
};

// Glossary entries: t = term, cat, d = definition (html), plain = searchable text, see = [route, page], live = example from the loaded data.
function glossary(store, M) {
  const loaded = store.loaded;
  const W = loaded ? store.world : null;
  const heroA = loaded && W.scenario.hero ? M.assetById(W.scenario.hero) : null;
  const heroAss = heroA ? M.assess(heroA, store.t) : null;
  const bt = loaded ? M.backtestAt(store.state.threshold) : null;
  const v = TAGS.VIB_RMS;
  const bands = ATTENTION_BANDS.map(([min, name]) => `${name}${min ? ' ≥ ' + min.toFixed(2) : ''}`).join(', ');
  let bf = null;
  if (heroA && heroA.bearing && heroA.rpm) { const f = M.bearingFreqs(heroA.bearing, heroA.rpm / 60); bf = `${heroA.id} (${int(heroA.rpm)} rpm, bearing ${heroA.bearing.model}): BPFO ${int(f.BPFO)} Hz, BPFI ${int(f.BPFI)} Hz, BSF ${int(f.BSF)} Hz, FTF ${int(f.FTF)} Hz`; }
  const oee = loaded ? M.siteOee(W.scenario.site, 7, store.t) : null;
  const heroEx = heroA && heroAss ? M.exposure(heroA, heroAss.mode) : null;

  const G = [
    { t: 'Health score', cat: 'rel', alias: 'health 0-100', d: html`A 0 to 100 score per machine, recomputed every 15 minutes: 100 is like new, 0 means a sensor is at its trip limit. ${HEALTH_FORMULA}`,
      see: ['#/machine', '2 · Machine Detail'], live: heroAss ? `${heroA.id} has health ${heroAss.health}.` : '' },
    { t: 'Failure confidence', cat: 'rel', alias: 'risk probability', d: html`${CONF_NOTE} At 80 % or more the machine turns red.`,
      see: ['#/machine', '2 · Machine Detail'], live: heroAss ? `${heroA.id}: ${Math.min(99, Math.floor(heroAss.conf * 100))} %.` : '' },
    { t: 'Time to failure (RUL) and its range', cat: 'rel', alias: 'remaining useful life rul interval range', d: html`Remaining useful life: how long until the worst sensor reaches its trip level at its current rate of change. It comes with a range (roughly half to one and a half times the central value) because the rate itself is uncertain; plan for the short end. With no trend, Nirantar shows an age-based wear estimate in days.`,
      see: ['#/machine', '2 · Machine Detail'], live: heroAss && heroAss.rulKind === 'trend' ? `${heroA.id}: about ${hours(heroAss.rulH)}, likely ${hours(heroAss.rulLo)} to ${hours(heroAss.rulHi)}.` : '' },
    { t: 'P-F curve', cat: 'rel', alias: 'potential failure functional failure p-f interval', d: html`The classic reliability picture. <b>P</b> is the point where a coming failure can first be detected; <b>F</b> is the functional failure. The time between them, the P-F interval, is your window to plan the repair. Nirantar's job is to find P early and book the repair inside the interval.`,
      see: ['#/', 'Home'] },
    { t: 'Criticality A, B, C', cat: 'rel', alias: 'critical', d: html`How much a machine matters: <b>A</b> stops a production line, <b>B</b> slows it, <b>C</b> has a workaround such as a standby. Bigger circles on the map; A machines rank higher.`,
      see: ['#/map', '1 · Plant Map'] },
    { t: 'Failure mode', cat: 'rel', alias: 'fm', d: html`The way a machine fails, for example bearing wear or shaft misalignment. Nirantar knows ${Object.keys(FAILURE_MODES).length} modes, each with its tell-tale sensors, a procedure (SOP) and a spare part.`,
      see: ['#/data', 'Data & scenarios'] },
    { t: 'Money at stake', cat: 'rel', alias: 'exposure cost downtime rupees', d: html`Production lost if the machine stops without warning: hours down (waiting for the part plus the repair) × what one hour of that line standing still costs.`,
      see: ['#/triage', '3 · Alert Triage'], live: heroEx ? `${heroA.id}: ${inr(heroEx.inr)} (${hours(heroEx.downH)} × ${inr(heroEx.costPerH)}/h).` : '' },
    { t: 'Repair window', cat: 'rel', alias: 'changeover planned window schedule', d: html`A low-impact slot for the repair: a shift changeover (14:00 to 18:00) or the night shift (02:00 to 06:00), after the part arrives and before the predicted failure.`,
      see: ['#/whatif', '4 · What If'] },
    { t: 'MTBF', cat: 'rel', alias: 'mean time between failures', d: html`Mean time between failures: running time divided by the number of failures. Higher is better.`, see: ['#/reliability', 'Reliability & root cause'] },
    { t: 'MTTR', cat: 'rel', alias: 'mean time to repair', d: html`Mean time to repair: the average time from a breakdown to running again. A planned repair with the part on site is far shorter than a breakdown that waits for a part.`, see: ['#/reliability', 'Reliability & root cause'] },
    { t: 'Pareto (80/20)', cat: 'rel', alias: 'pareto chart bad actors', d: html`Sort the causes by cost and draw the running total: a few failure modes usually make most of the cost. Fix those first. The machines that fail most are the <b>bad actors</b>.`, see: ['#/reliability', 'Reliability & root cause'] },
    { t: 'Root-cause analysis (5 whys, fishbone)', cat: 'rel', alias: 'rca ishikawa five whys', d: html`Asking "why" until you reach a cause you can fix so the failure does not return. The fishbone groups possible causes into machine, method, material, people, measurement and environment. Nirantar marks which links the data confirms and which are hypotheses a person confirms at teardown.`, see: ['#/reliability', 'Reliability & root cause'] },
    { t: 'Repeat failure', cat: 'rel', alias: 'chronic recurring', d: html`The same machine needing corrective work twice or more within about 60 days. It usually means the first fix treated a symptom, not the cause.`, see: ['#/reliability', 'Reliability & root cause'] },
    { t: 'Preventive maintenance (PM)', cat: 'rel', alias: 'pm interval due overdue', d: html`Routine jobs done on a calendar interval (cleaning, greasing, filter changes) whether or not the machine shows wear. Nirantar shows when each one is due and which are overdue.`, see: ['#/schedule', 'Maintenance calendar'] },
    { t: 'Opportunistic maintenance', cat: 'rel', alias: 'bundle same stop', d: html`Doing other due jobs on the same line while it is already stopped for a repair, so they cost no extra downtime. Nirantar suggests them; a person adds them.`, see: ['#/schedule', 'Maintenance calendar'] },
    { t: 'Release reading', cat: 'rel', alias: 'post repair check acceptance', d: html`The check that proves a repair worked before the machine goes back to production. After a bearing change: vibration at or below 2.3 mm/s (ISO zone A), per SOP-17.`, see: ['#/tech', 'Technician view'] },
    { t: 'Peer comparison', cat: 'rel', alias: 'identical siblings fleet benchmark', d: html`Comparing a machine with identical machines doing the same work. If only one differs, the problem is that machine, not the process or the material.`, see: ['#/compare', 'Compare machines'] },
    { t: 'Payback and ROI', cat: 'rel', alias: 'business case return on investment', d: html`Payback: months until the savings cover the programme cost. ROI: yearly saving ÷ yearly programme cost. The Business case page computes both from inputs you can change.`, see: ['#/roi', 'Business case'] },
    { t: 'IT/OT convergence', cat: 'platform', alias: 'it ot correlate erp cmms sensors', d: html`Joining operational technology data (machine sensors: vibration, temperature, RPM) with IT data (ERP stock and orders, CMMS work orders and history) so a sensor change can be priced and acted on. Machine Detail shows it as one timeline.`, see: ['#/machine', '2 · Machine Detail'] },
    { t: 'MCP (Model Context Protocol)', cat: 'platform', alias: 'mcp jira slack drive connector tools', d: html`An open protocol that lets an AI agent call tools in other systems, such as creating a Jira issue or posting to Slack. The demo previews the exact MCP calls Nirantar would make; nothing is sent, and the live Snowflake build does not have them wired yet.`, see: ['#/orders', '5 · Work Orders'] },
    { t: 'LOTO', cat: 'rel', alias: 'lock out tag out safety', d: html`Lock out, tag out: isolate and lock every energy source before anyone works on a machine, then verify zero energy. Every drafted repair starts with it.`, see: ['#/orders', '5 · Work Orders'] },
    { t: 'Work order states', cat: 'rel', alias: 'draft pending approval approved scheduled in progress done rejected wo', d: html`Draft → Pending approval → Approved → Scheduled → In progress → Done (or Rejected). The AI can only create drafts; a named person moves a work order past Pending approval.`,
      see: ['#/orders', '5 · Work Orders'] },

    { t: 'ISO 10816 zones A to D', cat: 'vib', alias: 'iso 10816-3 severity zone', d: html`International vibration severity zones (ISO 10816-3, group 2) on RMS velocity: <b>A</b> up to 2.3 mm/s, new machine; <b>B</b> up to 4.5, fine for long-term running; <b>C</b> up to 7.1, plan a repair soon; <b>D</b> above 7.1, damage is occurring.`,
      see: ['#/machine', '2 · Machine Detail'], live: heroAss && heroAss.iso ? `${heroA.id} is in zone ${heroAss.iso.zone} (${heroAss.iso.v.toFixed(1)} mm/s).` : '' },
    { t: 'Alarm limit and trip limit', cat: 'vib', alias: 'alarm vs trip limits threshold', d: html`Each sensor has two limits. The <b>alarm</b> limit warns a person; the <b>trip</b> limit is where protection stops the machine or damage starts. Example, ${v.label.toLowerCase()}: normal ${v.normal}, alarm ${v.alarm}, trip ${v.trip} ${v.unit}.`,
      see: ['#/data', 'Data & scenarios'] },
    { t: 'Spectrum (FFT)', cat: 'vib', alias: 'frequency 1x 2x running speed fft', d: html`Vibration split into its frequencies. A big peak at <b>1X</b> (running speed) points to imbalance, at <b>2X</b> to misalignment, and peaks at the bearing defect frequencies to bearing damage.`,
      see: ['#/machine', '2 · Machine Detail'] },
    { t: 'Bearing defect frequencies (BPFO, BPFI, BSF, FTF)', cat: 'vib', alias: 'bpfo bpfi bsf ftf outer race inner race ball spin cage', d: html`Damage on a rolling bearing vibrates at frequencies set by its geometry and speed: <b>BPFO</b> outer race, <b>BPFI</b> inner race, <b>BSF</b> ball spin, <b>FTF</b> cage. For example BPFO = n/2 × shaft speed × (1 − d/D × cos contact angle).`,
      see: ['#/machine', '2 · Machine Detail'], live: bf ? bf + '.' : '' },
    { t: 'Sensor fault', cat: 'vib', alias: 'flat line frozen flatline broken sensor', d: html`The sensor is wrong, not the machine: a reading that stays perfectly flat or disagrees with every related sensor. Nirantar marks it <b>Check sensor</b> and drafts an inspection; it never sends a repair crew for a sensor fault (SOP-50).`,
      see: ['#/triage', '3 · Alert Triage'] },

    { t: 'Attention score and bands', cat: 'alarm', alias: 'ranking priority', d: html`One number from 0 to 1 that ranks every machine: failure confidence × criticality × money at stake × order deadline × your feedback. Bands: ${bands}. Every score comes with a one-line reason.`,
      see: ['#/triage', '3 · Alert Triage'] },
    { t: 'ISA-101 high-performance HMI', cat: 'alarm', alias: 'hmi grey normal', d: html`A standard for control-room screens: normal equipment is grey so the eye goes straight to what is abnormal, and colour is kept for states that need a person. Nirantar follows it everywhere.`,
      see: ['#/map', '1 · Plant Map'] },
    { t: 'ISA-18.2 alarm management', cat: 'alarm', alias: 'alarm flood rate', d: html`The standard for alarm systems. A person can handle about one alarm per 10 minutes; <b>more than 10 alarms in 10 minutes is an alarm flood</b>. Good practice: group alarms by root cause, shelve known issues for a fixed time, and measure the alarm rate.`,
      see: ['#/triage', '3 · Alert Triage'] },
    { t: 'Alarm rationalisation and MOC', cat: 'alarm', alias: 'alarm limit change management of change', d: html`Reviewing where each alarm limit sits so alarms are rare, meaningful and early enough. Limit changes go through <b>management of change</b> (MOC): a person proposes, a reviewer approves, and the change is logged.`, see: ['#/rules', 'Alarm rules'] },
    { t: 'Shelving', cat: 'alarm', alias: 'shelve suppress', d: html`Hiding a known alarm for a fixed time (for example 4 hours) with a reason. It comes back on its own when the time is up, so nothing is silenced for ever.`, see: ['#/triage', '3 · Alert Triage'] },
    { t: 'Root cause and consequence alarm', cat: 'alarm', alias: 'root cause vs consequence', d: html`The <b>root cause</b> is the machine that is actually failing; <b>consequence</b> alarms come from machines that only look abnormal because of it. In the alarm-flood scenario the coolant pump is the root cause and the machines it feeds lose coolant pressure. Fix the root cause first.`,
      see: ['#/triage', '3 · Alert Triage'] },

    { t: 'OEE', cat: 'oee', alias: 'overall equipment effectiveness', d: html`Overall equipment effectiveness = availability × performance × quality. 85 % is the common world-class benchmark.`,
      see: ['#/oee', '7 · OEE'], live: oee ? `${M.siteById(W.scenario.site).city}, last 7 days: ${Math.round(oee.oee * 100)} %.` : '' },
    { t: 'Availability', cat: 'oee', d: html`Run time ÷ planned production time. Breakdowns and changeovers lower it.`, see: ['#/oee', '7 · OEE'], live: oee ? `${Math.round(oee.availability * 100)} %.` : '' },
    { t: 'Performance', cat: 'oee', d: html`(Ideal cycle time × parts made) ÷ run time. Small stops and running slower than ideal lower it.`, see: ['#/oee', '7 · OEE'], live: oee ? `${Math.round(oee.performance * 100)} %.` : '' },
    { t: 'Quality', cat: 'oee', d: html`Good parts ÷ all parts made. Start-up and production rejects lower it.`, see: ['#/oee', '7 · OEE'], live: oee ? `${Math.round(oee.quality * 100)} %.` : '' },
    { t: 'Six big losses', cat: 'oee', alias: '6 losses pareto', d: html`The classic causes of lost OEE: breakdowns and setups (availability), small stops and reduced speed (performance), start-up rejects and production rejects (quality).`, see: ['#/oee', '7 · OEE'] },

    { t: 'Back-test', cat: 'trust', alias: 'backtest history replay', d: html`Replaying the model over past data where the outcome is known, to see what it would have caught, how early, and how many false alarms it would have raised.`,
      see: ['#/trust', '8 · Trust Audit'], live: bt ? `${bt.detected} of ${bt.total} past failures caught, median ${Math.round(bt.medianLead)} h ahead.` : '' },
    { t: 'Prognostic horizon', cat: 'trust', alias: 'ph', d: html`How long before the actual failure the prediction became, and stayed, accurate enough to act on. Longer is better.`, see: ['#/trust', '8 · Trust Audit'] },
    { t: 'Alpha-lambda accuracy', cat: 'trust', alias: 'α-λ alpha lambda cone', d: html`A test for time-to-failure predictions: at a given point on the way to failure (λ), is the prediction within ± α (for example 20 %) of the true remaining life? Drawn as a cone that narrows towards the failure.`, see: ['#/trust', '8 · Trust Audit'] },
    { t: 'False alarms per machine-month', cat: 'trust', alias: 'false positive rate', d: html`How many alerts turn out to be nothing, per machine per month. Too many and people stop trusting alerts; the threshold slider on the Trust Audit trades this against missed failures.`,
      see: ['#/trust', '8 · Trust Audit'], live: bt ? `${bt.faRate.toFixed(2)} at threshold ${bt.threshold.toFixed(2)}.` : '' },
    { t: 'Precision and recall', cat: 'trust', alias: 'detection rate', d: html`Recall: the share of real failures that were caught. Precision: the share of alerts that were real. Raising the alert threshold improves precision and lowers recall.`,
      see: ['#/trust', '8 · Trust Audit'], live: bt ? `recall ${Math.round(bt.recall * 100)} %, precision ${Math.round(bt.precision * 100)} %.` : '' },
    { t: 'Guardrail', cat: 'trust', alias: 'policy g8 human approval refuse blocked', d: html`A rule the AI cannot break. Here: only a named person may approve, release, schedule or close a work order (policy G8), and a sensor fault never dispatches a crew. Refused requests are logged on the Trust Audit.`,
      see: ['#/copilot', '6 · Ask Copilot'] },

    { t: 'Cortex Agent, Analyst and Search', cat: 'platform', alias: 'cortex agents snowflake ai', d: html`Snowflake's built-in AI services. <b>Cortex Analyst</b> turns questions into SQL over a semantic model; <b>Cortex Search</b> finds passages in documents (manuals, SOPs, notes); a <b>Cortex Agent</b> combines both with tools to answer. The live Nirantar copilot is a Cortex Agent; this demo imitates it in the browser.`,
      see: ['#/copilot', '6 · Ask Copilot'] },
    { t: 'CoCo (Cortex Code)', cat: 'platform', alias: 'coco cli cortex code', d: html`Snowflake's AI coding agent, in Snowsight and as a command-line tool. The live Nirantar app was planned, built and tested by prompting CoCo for the hackathon.` },
    { t: 'Snowflake', cat: 'platform', alias: 'data cloud', d: html`The cloud data platform where the live Nirantar app runs: tables, dynamic tables, Cortex AI services and a Streamlit app, all in one account.` },
    { t: 'Scenario, seed and plant clock', cat: 'platform', alias: 'simulation clock sim time seed scenario', d: html`A scenario picks the problem the plant has; the seed makes the plant reproducible (same seed, same numbers); the plant clock can be played, paused, sped up or jumped ahead.`,
      see: ['#/presenter', 'Presenter'], live: loaded ? `“${W.scenario.name}”, seed ${W.seed}.` : '' },
  ];
  return G.map(g => ({ ...g, plain: String(g.d).replace(/<[^>]+>/g, '') }));
}
