// Home: what is happening right now, what to do, and where to start. Works with and without data.
import { html, icon, delegate } from '../ui/dom.js';
import { pfCurve } from '../ui/charts.js';
import { TOUR } from '../routes.js';
import { headline, kpi, stateChip, aiChip, humanChip, attentionBadge, confPct, noData, legendStates } from '../ui/components.js';
import { inr, hours, dateTime } from '../core/format.js';
import { SCENARIOS } from '../core/generator.js';

export default {
  render(root, { store, S, M }) {
    if (!store.loaded) {
      root.innerHTML = String(html`<div class="page home">
        ${hero(null)}
        ${noData('the command center')}
        ${scenarioCards(null)}
      </div>`);
      return delegate(root, {});
    }
    const t = store.t, W = store.world;
    const all = W.assets.map(a => ({ a, ass: M.assess(a, t) }));
    const ranked = all.map(x => ({ ...x, att: S.attention(x.a, x.ass) })).sort((p, q) => q.att.score - p.att.score);
    const open = S.openAlerts();
    const pending = store.state.workOrders.filter(w => w.status === 'PENDING_APPROVAL');
    const heroId = W.scenario.hero;
    const heroA = heroId ? M.assetById(heroId) : null;
    const heroAss = heroA ? M.assess(heroA, t) : null;
    const heroEx = heroA ? M.exposure(heroA, heroAss.mode) : null;
    const siteAssets = all.filter(x => x.a.siteId === W.scenario.site);
    const atRisk = open.filter(al => al.type === 'FAILURE').reduce((s, al) => s + M.exposure(M.assetById(al.assetId), al.mode).inr, 0);
    const bt = M.backtestAt(store.state.threshold ?? 0.6);

    let now;
    if (heroA && heroAss.state === 'act') now = headline(html`<b>${heroA.id}</b> on the <b>${M.lineById(heroA.lineId).name}</b> in <b>${M.siteById(heroA.siteId).city}</b> shows <b>${(heroAss.modeName || 'abnormal readings').toLowerCase()}</b>. It will probably fail in about <b>${hours(heroAss.rulH)}</b> (likely ${hours(heroAss.rulLo)} to ${hours(heroAss.rulHi)}). <b>${inr(heroEx.inr)}</b> of production depends on it. ${pending.length ? html`The AI has drafted the repair; it <b>needs your approval</b>.` : 'The repair is in hand.'}`, 'act');
    else if (open.length) now = headline(html`<b>${open.length} open alert${open.length > 1 ? 's' : ''}</b> at ${M.siteById(W.scenario.site).name}. Start with the highest attention score in the list below.`, 'watch');
    else now = headline(html`<b>All ${siteAssets.length} machines at ${M.siteById(W.scenario.site).name} are normal.</b> Nirantar scores every machine every 15 minutes and will raise an alert, with a drafted repair, as soon as one starts to wear.`, 'ok');

    const todo = [];
    for (const w of pending) todo.push(html`<li><span class="state act">${icon('orders')}${w.kind === 'INSPECT' ? 'Approve a sensor check' : 'Approve a repair'}</span> <a href="#/orders">${w.id} for ${w.assetId}</a> <span class="dim">drafted by Nirantar ${dateTime(w.createdAt)}</span></li>`);
    for (const al of open.filter(a => a.status === 'NEW').slice(0, 4)) todo.push(html`<li><span class="state watch">${icon('alert')}Acknowledge</span> <a href="#/triage">${al.assetId}: ${al.type === 'SENSOR' ? 'sensor check' : al.type === 'CONSEQUENCE' ? `caused by ${al.rootCause}` : (M.assess(M.assetById(al.assetId), t).modeName || 'alert')}</a></li>`);
    if (!todo.length) todo.push(html`<li class="dim">Nothing waiting for you. ${heroA ? html`<a href="#/machine/${heroA.id}">See ${heroA.id}</a>` : ''}</li>`);

    root.innerHTML = String(html`<div class="page home">
      ${hero(heroA ? { a: heroA, ass: heroAss } : null)}
      <section class="stack" aria-label="Right now"><h2 class="sec-title">Right now</h2>${now}</section>

      <div class="cols-2">
        <section class="card" aria-label="Your to-do">
          <div class="card-head"><h2>Your to-do</h2>${humanChip('Needs a person')}</div>
          <ul class="todo">${todo}</ul>
        </section>
        <section class="card" aria-label="Machines that need attention">
          <div class="card-head"><h2>Where to look first</h2>${aiChip('Ranked by Nirantar')}</div>
          <p class="small dim">Attention score 0 to 1: failure confidence × how critical the machine is × money at stake × order deadline. Grey rows are fine.</p>
          <ol class="attn">${ranked.slice(0, 5).map(x => html`<li><a href="#/machine/${x.a.id}"><span class="a-id mono">${x.a.id}</span><span class="a-why">${x.a.name} · ${x.att.why}</span></a>${attentionBadge(x.att)}</li>`)}</ol>
        </section>
      </div>

      <section aria-label="The 8 steps">
        <div class="row between"><h2 class="sec-title">The 8 steps (about 3 minutes)</h2><a class="btn sm" href="#/map">Start at step 1 ${icon('arrowR')}</a></div>
        <ol class="steps8">${TOUR.map(s => html`<li><a href="${s.route}" class="step-card ${(store.prefs.visited || []).includes(s.n) ? 'done' : ''}"><span class="stepnum">${s.n}</span><b>${s.verb}</b><span class="small">${s.title}: ${s.q}</span></a></li>`)}</ol>
      </section>

      <section aria-label="Choose your path">
        <h2 class="sec-title">Or choose your path</h2>
        <div class="cols-4 paths">
          ${path('Plant head', 'Show me the money at risk', [['#/triage', '3 · Alert Triage'], ['#/oee', '7 · OEE'], ['#/roi', 'Business case']])}
          ${path('Maintenance planner', 'Show me the repair plan', [['#/orders', '5 · Work Orders'], ['#/schedule', 'Calendar'], ['#/spares', 'Spares']])}
          ${path('Technician', 'Show me my job', [['#/tech', 'Technician view'], ['#/brief', 'Shift brief']])}
          ${path('Engineer or judge', 'Show me the evidence', [[heroA ? `#/machine/${heroA.id}` : '#/machine', '2 · Machine Detail'], ['#/reliability', 'Root cause'], ['#/compare', 'Compare'], ['#/trust', '8 · Trust Audit']])}
        </div>
      </section>

      <section class="cols-2" aria-label="What is AI and what is human">
        <div class="card ai"><div class="card-head"><h2>Done by Nirantar</h2>${aiChip('AI')}</div>
          <ul class="ticks"><li>Scores 48 machines every 15 minutes</li><li>Predicts failures with a confidence and a time range</li><li>Ranks alerts by money at stake and order deadlines</li><li>Drafts work orders, checks spares across plants, proposes a low-impact window</li><li>Suggests preventive jobs that fit into a stop already planned</li><li>Finds repeat failures and the likely root cause, compares each machine with its identical siblings</li><li>Answers questions with sources; refuses unsafe requests</li></ul></div>
        <div class="card"><div class="card-head"><h2>Your decision</h2>${humanChip()}</div>
          <ul class="ticks"><li>Approve or reject every repair (with your name)</li><li>Release crews, parts transfers and schedule changes</li><li>Shelve or escalate alerts</li><li>Confirm root causes at teardown; propose alarm-limit changes for review</li><li>On the job card: lock out first, tick each step, record the release reading</li><li>Tell Nirantar whether an alert was useful</li></ul>
          <p class="small dim">Nothing is released without a person. Every action is logged on the Trust Audit page.</p></div>
      </section>

      <section aria-label="The plant in numbers">
        <h2 class="sec-title">The fleet in numbers</h2>
        <div class="cols-4">
          ${kpi({ label: 'Machines monitored', value: W.assets.length, mean: `${W.sites.length} plants, sensors scored every 15 min`, tip: 'Every machine has 3 to 7 sensors (vibration, temperature, current, pressure…).' })}
          ${kpi({ label: 'Open alerts', value: open.length, tone: open.length ? 'act' : '', mean: open.length ? 'machines that need a decision' : 'nothing needs a decision', tip: 'Alerts are raised when health drops below 50 or failure confidence passes 80 %.' })}
          ${kpi({ label: 'Money at risk', value: inr(atRisk), tone: atRisk ? 'act' : '', mean: 'production that depends on alerted machines', tip: 'Unplanned downtime hours (waiting for parts + repair) × the line\'s downtime cost per hour.' })}
          ${kpi({ label: 'Early detection', value: Math.round(bt.recall * 100) + ' %', tone: 'ai', mean: `${bt.detected} of ${bt.total} past failures caught, median ${Math.round(bt.medianLead)} h ahead`, tip: 'Back-test on 56 days of history. Details on 8 · Trust Audit.' })}
        </div>
      </section>

      ${scenarioCards(store.state.scenarioId)}
      ${legendStates()}
    </div>`);
    return delegate(root, {});
  },
};

function hero(heroCase) {
  let pf = { detect: 0.3, now: 0.55, window: [0.66, 0.72], fail: 0.9 };
  if (heroCase && heroCase.ass.state === 'act') {
    const ass = heroCase.ass;
    const total = 72 + ass.rulH;
    pf = { detect: 0.15 + 0.75 * 0.25, now: 0.15 + 0.75 * (72 / total), window: [0.15 + 0.75 * ((72 + 50) / total), 0.15 + 0.75 * ((72 + 54) / total)], fail: 0.9 };
  }
  return html`<section class="hero" aria-label="Nirantar">
    <div class="hero-copy">
      <p class="eyebrow">Predictive maintenance and OEE command center</p>
      <h1 class="hero-title">Catch machine failures <span class="nowrap">before they stop the line.</span></h1>
      <p class="hero-sub">Nirantar <span lang="hi" class="deva">(निरंतर, “uninterrupted”)</span> watches every machine's sensors, predicts failures days ahead, prices the risk in rupees, drafts the repair with parts and a window, and waits for a person to approve.</p>
      <div class="row">
        <a class="btn primary lg" href="#/map">${icon('play')} Start the 3-minute tour</a>
        <button class="btn lg" data-action="welcome">${icon('info')} What is this?</button>
        <a class="btn lg" href="#/judges">${icon('award')} For judges</a>
      </div>
      <p class="small dim">Grey means normal. Colour means act. All data is synthetic and stays in your browser.</p>
    </div>
    <figure class="hero-pf">
      ${pfCurve({ ...pf, labels: { detect: 'Nirantar alerts', now: 'Today', window: 'Planned repair', fail: 'Breakdown avoided' } })}
      <figcaption class="small dim">The P-F curve: every machine slides from first sign of wear (P) to failure (F). Nirantar finds it early, so the repair happens in a planned window instead of a breakdown.</figcaption>
    </figure>
  </section>`;
}

function path(who, what, links) {
  return html`<div class="card path"><span class="eyebrow">${who}</span><h3>${what}</h3><div class="row">${links.map(([h, l]) => html`<a class="btn sm" href="${h}">${l}</a>`)}</div></div>`;
}

function scenarioCards(curId) {
  return html`<section aria-label="Scenarios"><div class="row between"><h2 class="sec-title">Try another scenario</h2><button class="btn sm" data-action="data-menu">${icon('data')} All data options</button></div>
    <div class="cols-3 scen-cards">${SCENARIOS.map(sc => html`<button class="card scen ${sc.id === curId ? 'current' : ''}" data-action="load-sample" data-scenario="${sc.id}"><b>${sc.name}</b><span class="small muted">${sc.blurb}</span>${sc.id === curId ? html`<span class="state ok">${icon('check')}Loaded now</span>` : html`<span class="small" style="color:var(--ai)">Load this scenario</span>`}</button>`)}</div></section>`;
}
