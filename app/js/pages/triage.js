// Step 3 · Prioritise: is it the most urgent problem, and what does it cost?
// One ranked queue (attention score with a reason), ISA-18.2 alarm lifecycle (new, acknowledged, shelved with expiry,
// escalated, closed), consequence alarms grouped under their root cause, an alarm-health tile, the watch list and history.
import { html, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, term, nextBack, caseStrip, attentionBadge, confPct } from '../ui/components.js';
import { inr, hours, num, dateTime, weekday, day, ago, HOUR, MIN, DAY } from '../core/format.js';
import { FAILURE_MODES } from '../core/generator.js';

// module UI state survives re-renders
const nb = v => String(v).replace(/ (%|L|Cr)\b/g, '\u00a0$1').replace(/Rs /g, 'Rs\u00a0');
const money = v => nb(inr(v));
const lc = label => label.replace(/^([A-Z])(?=[a-z])/, c => c.toLowerCase());   // "Vibration (RMS)" → "vibration (RMS)"
const conf = c => nb(confPct(c));

let ui = { shelve: null, shelveH: 4, shelveReason: 0, verify: {}, checks: {}, groups: {} };
let lastCtx = null;

const SHELVE_HOURS = [2, 4, 8, 24];
const SHELVE_REASONS = ['Known issue, repair planned', 'Waiting for the part', 'Machine stopped for planned work', 'Nuisance alarm: review the limit'];
const PRIO = {
  P1: ['act', 'respond now', 'High priority: a failure is close and costly. Respond now.'],
  P2: ['watch', 'respond this shift', 'Medium priority: respond within this shift.'],
  P3: ['normal', 'when convenient', 'Low priority: respond when convenient.'],
};
// Physical checks per failure mode (what a technician does to confirm the prediction before the crew is released).
const PHYSICAL = {
  'FM-01': 'Listen at the spindle housing with a stethoscope: a rough, rumbling bearing confirms wear',
  'FM-02': 'Inspect the cutting edge and the last parts\' surface finish',
  'FM-03': 'Check belt tension and look for glazing or cracks',
  'FM-04': 'Check the coupling element for wear and the motor feet for soft foot',
  'FM-05': 'Look through the inspection door for clinker build-up on the fan blades',
  'FM-06': 'Look for oil on the cylinder seals and return-line fittings',
  'FM-07': 'Check the suction strainer and sump level; listen for a gravel-like cavitation noise',
  'FM-08': 'Compare zone temperature with a hand-held pyrometer and check the element current',
  'FM-09': 'Check the motor terminal temperature and the load on the driven machine',
};

export default {
  autoRerender: false,   // re-render on store changes ourselves, but not while a select in the shelve form is open
  onStore(kind) {
    if (!lastCtx) return;
    const a = document.activeElement;
    if (kind === 'tick' && a && a.matches && a.matches('select') && document.getElementById('main')?.contains(a)) return;
    lastCtx.rerender();
  },
  render(root, ctx) {
    lastCtx = ctx;
    const { store, S, M } = ctx;
    const W = store.world, t = store.t, now = store.state.simNow;
    // alert ids restart with every scenario load, so per-alert UI state is only valid for the data it was made on
    const dataKey = `${store.state.scenarioId}:${store.state.seed}:${store.state.anchor}`;
    if (ui.dataKey !== dataKey) ui = { ...ui, dataKey, shelve: null, verify: {}, checks: {}, groups: {} };
    const cq = W.scenario.consequence;

    // ---- the queue ----
    const all = store.state.alerts || [];
    const enrich = al => { const a = M.assetById(al.assetId), ass = M.assess(a, t); return { al, a, ass, att: S.attention(a, ass), ex: M.exposure(a, ass.mode || al.mode || null) }; };
    const active = all.filter(al => al.status !== 'CLOSED' && al.status !== 'SHELVED').map(enrich);
    const shelved = all.filter(al => al.status === 'SHELVED');
    const rootIds = new Set(active.filter(x => x.al.type !== 'CONSEQUENCE').map(x => x.al.assetId));
    const conseqOf = id => active.filter(x => x.al.type === 'CONSEQUENCE' && x.al.rootCause === id);
    const top = active.filter(x => x.al.type !== 'CONSEQUENCE' || !rootIds.has(x.al.rootCause))
      .sort((p, q) => q.att.score - p.att.score || p.al.priority.localeCompare(q.al.priority) || p.al.createdAt - q.al.createdAt);
    const first = top[0];
    const flood = first && conseqOf(first.al.assetId).length >= 3 ? conseqOf(first.al.assetId) : null;

    // ---- watch list: abnormal machines without an alert ----
    const alerted = new Set(all.filter(al => al.status !== 'CLOSED').map(al => al.assetId));
    const watch = W.assets.map(a => ({ a, ass: M.assess(a, t) })).filter(x => x.ass.state === 'watch' && !alerted.has(x.a.id))
      .map(x => ({ ...x, att: S.attention(x.a, x.ass) })).sort((p, q) => q.ass.conf - p.ass.conf);

    // ---- headline ----
    let head;
    const nextLine = watch.length ? html` The next machine on the watch list, <b>${watch[0].a.id}</b>, is only at <b>${conf(watch[0].ass.conf)}</b> failure confidence.` : ' No other machine is on the watch list.';
    if (!first) {
      head = shelved.length
        ? headline(html`<b>No active alerts.</b> ${shelved.length} ${shelved.length === 1 ? 'alert is' : 'alerts are'} shelved (${shelved.map(s => `${s.assetId} until ${dateTime(s.shelvedUntil)}`).join(', ')}) and ${shelved.length === 1 ? 'comes back by itself' : 'come back by themselves'} when the time is up.${nextLine}`, 'watch')
        : headline(html`<b>No open alerts.</b> All ${W.assets.length} machines are below the alert line; ${watch.length ? html`${watch.length} ${watch.length === 1 ? 'is' : 'are'} on the watch list below` : 'none is even on the watch list'}. <a href="#/map">See them on the Plant Map</a>.`, 'ok');
    } else if (flood) {
      const total = first.ex.inr + flood.reduce((s, x) => s + x.ex.inr, 0);
      head = headline(html`<b>${active.length} alarms, 1 root cause: fix ${first.a.id} first.</b> The ${first.a.name.toLowerCase()} shows ${(first.ass.modeName || 'abnormal readings').toLowerCase()} (<b>${conf(first.ass.conf)}</b> failure confidence, about <b>${nb(hours(first.ass.rulH))}</b> to failure), so the <b>${flood.length}</b> machines it feeds raise alarms too. Nirantar grouped those under it; together <b>${money(total)}</b> of production is at stake.`, 'act');
    } else {
      const o = first.att.order.order;
      const sensor = first.al.type === 'SENSOR';
      head = headline(html`<b>${first.a.id} is ${top.length === 1 ? 'the only open alert' : `#1 of ${top.length} open alerts`}</b>: ${sensor
        ? html`a frozen sensor, so Nirantar routes an inspection, not a repair crew.`
        : html`<b>${conf(first.ass.conf)}</b> failure confidence × <b>${money(first.ex.inr)}</b> at stake${o ? html` × the <b>${o.customer}</b> order due <b>${weekday(o.due)} ${day(o.due)}</b>` : ''}.`}${nextLine}`, first.ass.state === 'act' ? 'act' : 'watch');
    }

    const steps = first ? [
      flood ? html`Read the root-cause alert ${marker(1)}: the ${flood.length} other alarms are its consequences, folded under it.` : html`Read the top alert ${marker(1)}: ${nb(first.att.why.split(' · ').slice(0, 3).join(', '))}.`,
      html`Decide ${marker(2)}: <b>Acknowledge</b> to own it, <b>Shelve</b> to park it for a few hours with a reason, or <b>Escalate</b> to the plant head.`,
      html`Then open <b>What if</b> ${marker(3)} to decide when to repair.`,
    ] : [html`Nothing to triage. Check the watch list below, or open the <a href="#/presenter">Presenter</a> to inject a fault and watch an alert arrive.`];

    const bandsTip = S.ATTENTION_BANDS.map(([v, name]) => (v ? `${name} ≥ ${v.toFixed(2)}` : `${name} below`)).join(' · ');

    root.innerHTML = String(html`<div class="page tri">
      ${pageHead('triage')}
      ${caseStrip()}
      ${head}
      <div class="row">${aiChip('Nirantar ranked the alerts and drafted the work')}${humanChip('Your decision: acknowledge, shelve or escalate')}</div>
      ${doThis(steps)}

      ${S.alarmHealth().peak10 > 10 ? alarmHealthCard(S, store, all, now) : ''}

      <section class="card" aria-label="Open alerts, ranked">
        <div class="card-head"><h2>Open alerts, ranked</h2><span class="sub">${active.length} active${shelved.length ? `, ${shelved.length} shelved` : ''}</span></div>
        <p class="tri-formula small">${term('Attention', 'One score from 0 to 1 that ranks every alert in the fleet. Every card shows the score and the reason.')} = ${term('failure confidence', 'How sure Nirantar is that a real failure is developing (all related sensors agree, the trend is steady), not when it will happen.')} × ${term('criticality', 'How much the plant depends on the machine: A stops a line, B slows it, C has a workaround.')} × ${term('money at stake', 'Unplanned downtime hours (waiting for the part + repair) × what one hour of the line standing still costs.')} × ${term('order deadline', 'Rises as the next customer order on this line gets within 7 days of its due date.')}</p>
        <details class="tri-bands"><summary>What the bands mean</summary><p class="small">${bandsTip}. High and Medium need action now, Low goes on the watch list. Alarms caused by another machine are capped so their root cause ranks first, and your <i>Useful / Not useful</i> answers nudge the score.</p></details>
        ${top.length ? html`<div class="tri-list">${top.map((x, i) => alertCard(x, i, ctx, conseqOf(x.al.assetId), cq))}</div>`
          : html`<div class="tri-empty"><b>${shelved.length ? 'Every open alert is shelved.' : 'No open alerts.'}</b><p class="small muted">Alerts appear here, ranked, the moment a machine's health drops below 50 or its failure confidence passes 80 %. Each one arrives with a drafted work order and a reason for its rank.</p>
            <div class="row"><a class="btn" href="#/map">${icon('map')} Plant Map</a><a class="btn" href="#/presenter">${icon('play')} Inject a fault (Presenter)</a></div></div>`}
      </section>

      ${S.alarmHealth().peak10 > 10 ? '' : alarmHealthCard(S, store, all, now)}

      <section class="card" aria-label="Watch list">
        <div class="card-head"><h2>Watch list</h2>${aiChip('Watched by Nirantar')}<span class="sub">healthy for now; Nirantar keeps watching them every 15 minutes</span></div>
        ${watch.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Machine</th><th class="n">Health</th><th class="n">${term('Failure confidence', 'How sure Nirantar is that a real failure is developing, not when.')}</th><th class="n">${term('Time to failure', 'When the worst sensor reaches its trip level at the current rate; long values are shown in days.')}</th><th>Top signal</th><th>Attention</th></tr></thead>
          <tbody>${watch.map(x => html`<tr class="clickable" data-action="open" data-href="#/machine/${x.a.id}" tabindex="0">
            <td><a class="mono" href="#/machine/${x.a.id}"><b>${x.a.id}</b></a><br><span class="dim xs">${x.a.name} · ${M.lineById(x.a.lineId).short}</span></td>
            <td class="n">${x.ass.health}</td><td class="n">${conf(x.ass.conf)}</td>
            <td class="n">${hours(x.ass.rulH)}</td><td class="small tri-sig">${x.ass.top ? `${x.ass.top.label} ${x.ass.top.ratio.toFixed(1)}× vs 3 days ago` : '–'}</td><td>${attentionBadge(x.att)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="small muted">Nobody on the watch list: every machine without an alert is normal (grey). Machines land here when a sensor starts to drift but is still far from its alarm level.</p>`}
      </section>

      ${historyCard(all, M, now)}
      ${nextBack('triage')}
    </div>`);

    return delegate(root, {
      ack: el => S.acknowledge(el.dataset.id),
      'ack-all': el => { for (const id of el.dataset.ids.split(',')) S.acknowledge(id); },
      escalate: el => S.escalate(el.dataset.id),
      'shelve-open': el => { ui.shelve = ui.shelve === el.dataset.id ? null : el.dataset.id; ctx.rerender(); },
      'shelve-cancel': () => { ui.shelve = null; ctx.rerender(); },
      'shelve-h': (el, ev) => { if (ev.type === 'change') ui.shelveH = +el.value; },
      'shelve-r': (el, ev) => { if (ev.type === 'change') ui.shelveReason = +el.value; },
      'shelve-go': el => { const id = el.dataset.id; ui.shelve = null; S.shelve(id, ui.shelveH, SHELVE_REASONS[ui.shelveReason]); },
      draft: el => S.aiDraft(el.dataset.id),
      verify: el => { ui.verify[el.dataset.id] = !ui.verify[el.dataset.id]; ctx.rerender(); },
      check: (el, ev) => {
        if (ev.type !== 'change') return;
        const id = el.dataset.id, n = +el.dataset.n;
        (ui.checks[id] ||= [])[n] = el.checked;
        const box = el.closest('.tri-verify'), done = box.querySelectorAll('input:checked').length, total = box.querySelectorAll('input').length;
        box.querySelector('.tri-vcount').textContent = done === total ? `All ${total} checked: the prediction is confirmed. Acknowledge the alert and approve the work order.` : `${done} of ${total} checked`;
      },
      feedback: el => S.feedback(el.dataset.id, el.dataset.useful === '1'),
      group: el => { ui.groups[el.dataset.id] = !ui.groups[el.dataset.id]; ctx.rerender(); },
      open: el => ctx.navigate(el.dataset.href),
    }, ['click', 'change']);
  },
};

// ---------- alarm health (ISA-18.2) ----------
function alarmHealthCard(S, store, all, now) {
  const h = S.alarmHealth();
  // when did the peak 10-minute window end? (same windows as alarmHealth)
  let peakAt = null, best = 0;
  for (let i = 0; i < 144; i++) {
    const w0 = now - DAY + i * 10 * MIN;
    const n = all.filter(a => a.createdAt > w0 && a.createdAt <= w0 + 10 * MIN).length;
    if (n > best) { best = n; peakAt = w0 + 10 * MIN; }
  }
  const floodNow = h.last10 > h.target, floodDay = h.peak10 > h.target;
  const tone = floodNow ? 'act' : floodDay ? 'watch' : '';
  const meter = (v, label) => {
    const max = Math.max(h.target * 1.5, v, 1);
    return html`<div class="tri-meter ${v > h.target ? 'over' : ''}" role="img" aria-label="${label}: ${v} alarms in 10 minutes against a target of ${h.target}">
      <span class="fill" style="width:${Math.min(100, v / max * 100)}%"></span><span class="target" style="left:${h.target / max * 100}%" title="target ${h.target}"></span></div>`;
  };
  return html`<section class="card ${tone}" aria-label="Alarm health">
    <div class="card-head"><h2>Alarm health</h2>${stateChip(floodNow ? 'act' : floodDay ? 'watch' : 'normal', floodNow ? 'Flood now' : floodDay ? 'Flood in the last 24 h' : 'Calm')}<span class="sub">${term('ISA-18.2 practice', 'The alarm-management standard for process plants: more than 10 alarms in 10 minutes is an alarm flood, when operators start missing the alarm that matters.')}</span></div>
    <div class="tri-ah">
      <div><div class="tri-ah-k">Alarms in the last 10 minutes</div><div class="tri-ah-v mono">${h.last10}<small> / target ${h.target}</small></div>${meter(h.last10, 'Last 10 minutes')}</div>
      <div><div class="tri-ah-k">Busiest 10 minutes in the last 24 h</div><div class="tri-ah-v mono ${floodDay ? 'over' : ''}">${h.peak10}<small> alarms</small></div>${meter(h.peak10, 'Busiest 10 minutes')}${peakAt && best ? html`<div class="xs dim">ending ${dateTime(peakAt)}</div>` : ''}</div>
      <div><div class="tri-ah-k">Time in flood, last 24 h</div><div class="tri-ah-v mono">${num(h.floodPct * 100, 1)}<small> %</small></div><div class="xs dim">10-minute windows with more than ${h.target} alarms</div></div>
    </div>
    <p class="small muted">${floodDay
      ? html`<b>${h.peak10} alarms arrived within 10 minutes</b>: an alarm flood. When one machine fails and starves the machines it feeds, every one of them alarms. Nirantar folds the knock-on alarms under their root cause, so the list below shows one item to act on instead of ${h.peak10}.`
      : html`A calm control room gets no more than ${h.target} alarms in any 10 minutes. Above that is an alarm flood, when people start missing the alarm that matters. Nirantar keeps the count low by alerting on predictions, not on every limit crossing, and by folding knock-on alarms under their root cause.`}</p>
  </section>`;
}

// ---------- one alert card ----------
function typeLabel(al) {
  if (al.type === 'SENSOR') return html`<span class="pill">${icon('sensor')}Sensor check</span>`;
  if (al.type === 'CONSEQUENCE') return html`<span class="pill">${icon('layers')}Consequence of ${al.rootCause}</span>`;
  return html`<span class="pill">${icon('wrench')}Failure</span>`;
}
function prioChip(al) {
  const [tone, mean, tip] = PRIO[al.priority] || PRIO.P3;
  const m = al.type === 'CONSEQUENCE' ? 'clears with its root cause' : al.type === 'SENSOR' ? 'inspect, no repair' : mean;
  return html`<span class="state ${tone}" tabindex="0" data-tip="ISA-18.2 alarm priority says how fast someone must respond. ${tip}">${icon(tone === 'act' ? 'alert' : tone === 'watch' ? 'info' : 'clock')}${al.priority} · ${m}</span>`;
}
function statusLine(al, store) {
  const S = store.state;
  if (al.status === 'NEW') return html`<span class="state watch">${icon('bell')}New: nobody has acknowledged it yet</span>`;
  if (al.status === 'ACK') return html`<span class="state ok">${icon('check')}Acknowledged by ${al.ackBy} at ${dateTime(al.ackAt)}</span>`;
  if (al.status === 'SHELVED') return html`<span class="state normal">${icon('clock')}Shelved until ${dateTime(al.shelvedUntil)}</span> <span class="small muted">${al.shelveReason}</span>`;
  if (al.status === 'ESCALATED') {
    const row = S.audit.find(r => r.action === 'Escalated to the plant head' && r.target === al.assetId);
    return html`<span class="state ok">${icon('flag')}Escalated to the plant head${row ? ` by ${row.actor} at ${dateTime(row.ts)}` : ''}</span>`;
  }
  return html`<span class="state ok">${icon('check')}Closed${al.closedAt ? ` at ${dateTime(al.closedAt)}` : ''}</span>`;
}

function alertCard(x, i, ctx, conseq, cq) {
  const { store, M } = ctx;
  const { al, a, ass, att, ex } = x;
  const isTop = i === 0;
  const line = M.lineById(a.lineId), site = M.siteById(a.siteId);
  const sensor = al.type === 'SENSOR', consequence = al.type === 'CONSEQUENCE';
  const wo = al.woId ? store.state.workOrders.find(w => w.id === al.woId) : null;
  const op = att.order;
  const tone = consequence ? 'watch' : sensor ? 'watch' : ass.state === 'act' ? 'act' : 'watch';
  const mode = sensor ? `Frozen sensor: ${ass.sensorFault ? ass.sensorFault.label : 'reading'}`
    : consequence ? `${ass.contributions[0].label} out of range (fed by ${al.rootCause})`
    : ass.modeName || al.mode && FAILURE_MODES[al.mode]?.name || `${ass.contributions[0].label} out of range`;
  const woStatus = wo ? { PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', SCHEDULED: 'scheduled', IN_PROGRESS: 'in progress', DONE: 'done', REJECTED: 'rejected' }[wo.status] || wo.status.toLowerCase() : '';
  const fact = (label, value, mean, cls = '') => html`<div class="tri-fact ${cls}"><dt>${label}</dt><dd class="mono">${value}</dd>${mean ? html`<dd class="tri-mean">${mean}</dd>` : ''}</div>`;
  const whatIfId = consequence ? al.rootCause : a.id;

  return html`<article class="card tri-card ${tone}" id="alert-${al.id}" aria-label="Alert ${i + 1}: ${a.id}">
    <div class="tri-head">
      <h3>${isTop ? marker(1) : ''}<span class="tri-rank mono">#${i + 1}</span><a href="#/machine/${a.id}" class="mono">${a.id}</a> <span class="tri-name">${a.name}</span></h3>
      <span class="small dim">${line.name} · ${site.city} · criticality ${a.criticality}</span>
    </div>
    <div class="tri-tags">${attentionBadge(att)}${prioChip(al)}${typeLabel(al)}</div>
    <p class="tri-mode"><b>${mode}</b> <span class="small dim">· raised ${dateTime(al.createdAt)} (${ago(al.createdAt, store.state.simNow)}) by Nirantar</span></p>
    <dl class="tri-facts">
      ${fact(term('Health', 'Falls from 100 as sensors move from normal towards their trip level. Below 50 raises an alert.'), html`${ass.health}<small>/100</small>`, '0 = failed, 100 = new', ass.health < 50 ? 'act' : ass.health < 80 ? 'watch' : '')}
      ${fact(term('Failure confidence', 'How sure Nirantar is that a real failure is developing (all related sensors agree, the trend is steady), not when it will happen.'), sensor ? '–' : conf(ass.conf), sensor ? 'not scored: the sensor is suspect' : 'how sure a failure is developing', ass.conf >= 0.8 && !sensor ? 'act' : '')}
      ${fact(term('Time to failure', 'Remaining useful life: when the worst sensor reaches its trip level at the current rate, with an 80 % range.'), hours(ass.rulH), ass.rulKind === 'trend' ? `likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)}` : 'normal wear, no trend')}
      ${fact(term('Money at stake', 'If it stops unplanned: downtime hours (waiting for the part + repair) × what one hour of the line standing still costs.'), sensor ? '–' : money(ex.inr), sensor ? 'a sensor fault stops nothing' : conseq.length ? nb(`on this machine, plus ${inr(conseq.reduce((s2, c) => s2 + c.ex.inr, 0))} on the ${conseq.length} machines it feeds`) : nb(`${hours(ex.downH)} down × ${inr(ex.costPerH)}/h`), !sensor && ex.inr >= 5e5 ? 'act' : '')}
      ${fact(term('Order deadline', 'The next customer order on this line. Pressure rises from 0 to 100 % as its due date gets within 7 days.'), op.order ? html`${weekday(op.order.due)} ${day(op.order.due)}` : '–', op.order ? nb(`${op.order.customer} · ${Math.round(op.pressure * 100)} % pressure`) : 'no order due on this line')}
    </dl>
    <p class="tri-why small"><b>Why this rank:</b> ${nb(att.why)}.</p>
    <div class="tri-status">${statusLine(al, store)}${wo ? aiChip(`Work order ${wo.id} drafted, ${woStatus}`) : ''}</div>

    <div class="tri-alabel">${isTop ? marker(2) : ''}${humanChip(`Your decision on ${a.id}`)}</div>
    <div class="tri-actions" role="group" aria-label="Decide on ${a.id}">
      ${al.status !== 'ACK' ? html`<button class="btn approve" data-action="ack" data-id="${al.id}">${icon('check')}Acknowledge</button>` : ''}
      <button class="btn" data-action="shelve-open" data-id="${al.id}" aria-expanded="${ui.shelve === al.id}">${icon('clock')}Shelve…</button>
      ${al.status !== 'ESCALATED' ? html`<button class="btn approve" data-action="escalate" data-id="${al.id}">${icon('flag')}Escalate</button>` : ''}
      ${wo ? html`<a class="btn" href="#/orders">${icon('orders')}Work order</a>`
        : consequence ? html`<span class="small muted tri-nowo">No work order here: fixing ${al.rootCause} clears it.</span>`
        : html`<button class="btn ai" data-action="draft" data-id="${al.id}">${icon('ai')}Ask AI to draft a work order</button>`}
    </div>
    ${ui.shelve === al.id ? shelveForm(al) : ''}

    <div class="tri-more">
      <button class="btn" data-action="verify" data-id="${al.id}" aria-expanded="${!!ui.verify[al.id]}">${icon('check')}Verify${sensor ? ' (SOP-50)' : ''}</button>
      <a class="btn" href="#/machine/${a.id}">${icon('machine')}Machine detail</a>
      <div class="tri-next">${isTop ? marker(3) : ''}<a class="btn ${isTop ? 'primary' : ''}" href="#/whatif/${whatIfId}">${icon('decide')}What if: when to repair${consequence ? ` ${al.rootCause}` : ''}${icon('arrowR')}</a></div>
    </div>
    ${ui.verify[al.id] ? verifyBox(x, ctx, cq) : ''}

    <div class="tri-fb small" role="group" aria-label="Was this alert useful?">
      <span class="muted tri-fbq">Was this alert useful?</span>
      <button class="btn sm ${al.feedback === 'useful' ? 'approve' : ''}" data-action="feedback" data-id="${al.id}" data-useful="1" aria-pressed="${al.feedback === 'useful'}">${icon('thumbUp')}Useful</button>
      <button class="btn sm ${al.feedback === 'not useful' ? 'approve' : ''}" data-action="feedback" data-id="${al.id}" data-useful="0" aria-pressed="${al.feedback === 'not useful'}">${icon('thumbDown')}Not useful</button>
      <span class="dim xs">${al.feedback ? `You said: ${al.feedback}. ${al.feedback === 'useful' ? 'Similar alerts rank a little higher.' : 'Similar alerts rank lower unless the evidence grows.'}` : 'Your answer tunes the ranking for this machine.'}</span>
    </div>

    ${conseq.length ? conseqGroup(al, conseq, ctx, cq) : ''}
  </article>`;
}

function shelveForm(al) {
  return html`<div class="tri-shelve" role="group" aria-label="Shelve ${al.assetId}">
    <div class="field"><label for="sh-h-${al.id}">For how long</label>
      <select class="input" id="sh-h-${al.id}" data-action="shelve-h">${SHELVE_HOURS.map(h => html`<option value="${h}" ${h === ui.shelveH ? 'selected' : ''}>${h} hours</option>`)}</select></div>
    <div class="field"><label for="sh-r-${al.id}">Reason (goes into the audit log)</label>
      <select class="input" id="sh-r-${al.id}" data-action="shelve-r">${SHELVE_REASONS.map((r, i) => html`<option value="${i}" ${i === ui.shelveReason ? 'selected' : ''}>${r}</option>`)}</select></div>
    <div class="row"><button class="btn approve" data-action="shelve-go" data-id="${al.id}">${icon('clock')}Shelve</button><button class="btn ghost" data-action="shelve-cancel">Cancel</button></div>
    <p class="xs dim">Shelving hides the alert for a set time (ISA-18.2). It comes back by itself when the time is up, and your name and reason go into the audit log.</p>
  </div>`;
}

function verifyBox(x, ctx, cq) {
  const { M, store } = ctx;
  const { al, a, ass } = x;
  const t = store.t;
  const reading = key => { const tag = M.tagOf(a, key); const v = M.valueAt(a, key, t); return { tag, v: `${num(v, tag.d)} ${tag.unit}` }; };
  let items = [];
  if (al.type === 'SENSOR') {
    const sf = ass.sensorFault;
    items = [
      `Evidence: ${sf ? sf.reason : 'the reading is flat while related sensors move'}`,
      'Do not stop the machine: the related sensors say it is running normally',
      `Check the ${sf ? lc(sf.label) : 'sensor'} cable and mounting at the machine`,
      'Compare with a hand-held meter at the same point',
      'Replace the sensor if the readings differ (spare SP-090, in stock)',
    ];
  } else if (al.type === 'CONSEQUENCE') {
    const r = cq && M.tagOf(a, cq.tag) ? reading(cq.tag) : null;
    items = [
      r ? `Check ${lc(r.tag.label)} at the machine inlet: Nirantar reads ${r.v} (normal ${r.tag.normal} ${r.tag.unit}, alarm ${r.tag.alarm} ${r.tag.unit})` : 'Check the reading at the machine',
      `Confirm the root cause: ${al.rootCause} (${M.assetById(al.rootCause).name.toLowerCase()}) has its own alert above`,
      'Do not repair this machine: it recovers when the root cause is fixed',
    ];
  } else {
    const fm = FAILURE_MODES[al.mode || ass.mode];
    const keys = (fm ? fm.signals : [ass.worstKey]).filter(k => M.tagOf(a, k));
    items = keys.map(k => { const r = reading(k); return `Confirm ${lc(r.tag.label)} with a hand-held instrument: Nirantar reads ${r.v} (normal ${r.tag.normal}, alarm ${r.tag.alarm} ${r.tag.unit})`; });
    if (fm && PHYSICAL[al.mode || ass.mode]) items.push(PHYSICAL[al.mode || ass.mode]);
    items.push(`Open Machine detail and check the trend is still rising${fm && fm.sop ? `; repair steps follow ${fm.sop}` : ''}`);
  }
  const checks = ui.checks[al.id] || [];
  const done = items.filter((_, i) => checks[i]).length;
  return html`<div class="tri-verify" aria-label="Verify ${a.id}">
    <div class="row between"><b class="small">${al.type === 'SENSOR' ? 'Sensor check (SOP-50: suspected sensor fault)' : 'Before you release a crew, confirm on the machine'}</b>${aiChip('Checklist drafted by Nirantar')}</div>
    <ul>${items.map((it, i) => html`<li><label class="check"><input type="checkbox" data-action="check" data-id="${al.id}" data-n="${i}" ${checks[i] ? 'checked' : ''}><span>${it}</span></label></li>`)}</ul>
    <p class="tri-vcount xs dim">${done === items.length ? `All ${items.length} checked: the prediction is confirmed. Acknowledge the alert and approve the work order.` : `${done} of ${items.length} checked`}</p>
  </div>`;
}

function conseqGroup(rootAl, list, ctx, cq) {
  const { M, store } = ctx;
  const open = !!ui.groups[rootAl.id];
  const total = list.reduce((s, x) => s + x.ex.inr, 0);
  const newIds = list.filter(x => x.al.status !== 'ACK').map(x => x.al.id);
  const tagLabel = cq ? (M.tagOf(list[0].a, cq.tag)?.label || 'reading') : 'reading';
  return html`<div class="tri-group">
    <div class="row between">
      <button class="btn ghost tri-toggle" data-action="group" data-id="${rootAl.id}" aria-expanded="${open}">${icon('arrowR')}<b>${list.length} consequential alarms</b><span class="small muted">${lc(tagLabel)} low on ${list.length} machines · ${inr(total)} at stake together</span></button>
      ${newIds.length ? html`<button class="btn sm approve" data-action="ack-all" data-ids="${newIds.join(',')}">${icon('check')}Acknowledge all ${newIds.length}</button>` : html`<span class="state ok">${icon('check')}All acknowledged</span>`}
    </div>
    ${open ? html`<ul class="tri-conseq">${list.map(x => {
      const tag = cq ? M.tagOf(x.a, cq.tag) : null;
      const v = tag ? M.valueAt(x.a, cq.tag, store.t) : null;
      return html`<li>
        <span class="tri-c-id"><a class="mono" href="#/machine/${x.a.id}">${x.a.id}</a> <span class="small dim">${x.a.name} · ${M.lineById(x.a.lineId).short}</span></span>
        <span class="small">${tag ? html`${tag.label}: <b class="mono">${num(v, tag.d)} ${tag.unit}</b> <span class="dim">(normal ${tag.normal})</span>` : ''} · health ${x.ass.health}</span>
        <span>${x.al.status === 'ACK' ? html`<span class="state ok">${icon('check')}Acknowledged</span>` : html`<button class="btn sm approve" data-action="ack" data-id="${x.al.id}">Acknowledge</button>`}</span>
      </li>`;
    })}</ul>
    <p class="xs dim">These machines are fine in themselves: they alarm because ${rootAl.assetId} (${M.assetById(rootAl.assetId).name.toLowerCase()}) feeds them. Their alarms close when the root cause is repaired.</p>` : ''}
  </div>`;
}

// ---------- history ----------
function historyCard(all, M, now) {
  const hist = all.filter(al => al.status === 'CLOSED' || al.status === 'SHELVED')
    .sort((p, q) => (q.closedAt || q.shelvedUntil || q.createdAt) - (p.closedAt || p.shelvedUntil || p.createdAt)).slice(0, 10);
  return html`<section class="card" aria-label="Closed and shelved alerts">
    <div class="card-head"><h2>Closed and shelved</h2><span class="sub">last 10</span></div>
    ${hist.length ? html`<ul class="tri-hist">${hist.map(al => {
      const a = M.assetById(al.assetId);
      return html`<li>
        <span><a class="mono" href="#/machine/${a.id}">${a.id}</a> <span class="small dim">${a.name} · ${al.type === 'SENSOR' ? 'sensor check' : al.type === 'CONSEQUENCE' ? `consequence of ${al.rootCause}` : (FAILURE_MODES[al.mode]?.name || 'failure').toLowerCase()}</span></span>
        <span class="small">${al.status === 'SHELVED'
          ? html`<span class="state normal">${icon('clock')}Shelved until ${dateTime(al.shelvedUntil)}</span> <span class="muted">${al.shelveReason}</span> <span class="dim">(back ${Math.max(0, (al.shelvedUntil - now) / HOUR) < 1 ? 'within the hour' : 'in ' + hours((al.shelvedUntil - now) / HOUR)})</span>`
          : html`<span class="state ok">${icon('check')}Closed ${al.closedAt ? dateTime(al.closedAt) : ''}</span> <span class="dim">raised ${dateTime(al.createdAt)}</span>`}</span>
        ${al.status === 'SHELVED' ? html`<button class="btn sm approve" data-action="ack" data-id="${al.id}">${icon('check')}Take off the shelf</button>` : ''}
      </li>`;
    })}</ul>` : html`<p class="small muted">Nothing closed or shelved yet. An alert closes when its repair is marked done on 5 · Work Orders; shelved alerts wait here until their time is up.</p>`}
  </section>`;
}
