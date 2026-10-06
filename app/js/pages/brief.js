// Tool · Shift brief: what should the morning meeting know? An auto-written briefing from the live demo data
// (top risks, decisions needed, last 24 h, yesterday's OEE, spares, repairs in the next 72 h), with print,
// copy-as-text and CSV/JSON downloads. In the live Snowflake app the same brief is a scheduled CoCo automation.
// "Slack message (MCP preview)" shows the post Nirantar's agent would send to the plant channel; nothing is sent.
import { html, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, aiChip, attentionBadge, confPct, nextBack } from '../ui/components.js';
import { FAILURE_MODES } from '../core/generator.js';
import { dateTime, day, weekday, time, inr, hours, isoDate, HOUR, DAY } from '../core/format.js';
import { slackPost, section, mrkdwn, channelFor, plural, openMcpPreview, appUrl } from '../ui/mcp.js';

const TARGET = 0.85;
const SEP = html`<span class="visually-hidden">: </span>`;
const lcFirst = s => (/^[A-Z0-9]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const LOSS_NAME = { breakdown: 'breakdowns', setup: 'set-ups and changeovers', smallStops: 'small stops', speed: 'slow running', startupRejects: 'start-up rejects', prodRejects: 'production rejects' };
const STATUS_TEXT = { NEW: 'new, not yet acknowledged', ACK: 'acknowledged', SHELVED: 'shelved', ESCALATED: 'escalated to the plant head' };
const WO_STATUS = { PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', SCHEDULED: 'scheduled', IN_PROGRESS: 'in progress', DONE: 'done', REJECTED: 'rejected' };

// ---------- brief content (pure: store + model → sections of {html} items) ----------
function buildBrief(store, S, M) {
  const W = store.world, st = store.state, t = store.t, now = st.simNow;
  const city = id => M.siteById(id)?.city || id;
  const where = a => `${lcFirst(a.name)}, ${M.lineById(a.lineId).name}, ${city(a.siteId)}`;
  const open = S.openAlerts();
  const sections = [];

  // 1. Top risks: open alerts ranked by attention; coolant-style consequence alarms grouped under their root cause
  const ranked = open.filter(al => al.type !== 'CONSEQUENCE').map(al => { const a = M.assetById(al.assetId), ass = M.assess(a, t); return { al, a, ass, att: S.attention(a, ass) }; })
    .sort((x, y) => y.att.score - x.att.score);
  const conseq = open.filter(al => al.type === 'CONSEQUENCE');
  const roots = [...new Set(conseq.map(al => al.rootCause))];
  const risks = ranked.slice(0, 6).map(({ al, a, ass, att }) => {
    const wo = al.woId ? st.workOrders.find(w => w.id === al.woId) : null;
    const status = al.status === 'SHELVED' ? `shelved until ${dateTime(al.shelvedUntil)}` : STATUS_TEXT[al.status] || al.status.toLowerCase();
    if (al.type === 'SENSOR') return html`${attentionBadge(att)} <b class="mono">${a.id}</b> (${where(a)}): ${ass.sensorFault ? lcFirst(ass.sensorFault.reason) : 'a sensor looks frozen'}. Inspect the sensor; do not send a repair crew. Alert ${status}${wo ? `, inspection ${wo.id} ${WO_STATUS[wo.status] || ''}` : ''}.`;
    const ex = M.exposure(a, ass.mode);
    const n = conseq.filter(c => c.rootCause === a.id).length;
    return html`${attentionBadge(att)} <b class="mono">${a.id}</b> (${where(a)}): ${(ass.modeName || 'abnormal readings').toLowerCase()}, health ${ass.health}, ${confPct(ass.conf)} failure confidence, likely to fail in about <b>${hours(ass.rulH)}</b> (${hours(ass.rulLo)} to ${hours(ass.rulHi)}). <b>${inr(ex.inr)}</b> at stake.${n ? ` It is also the root cause of ${n} low-coolant alarm${n === 1 ? '' : 's'} downstream.` : ''} Alert ${status}${wo ? `, repair ${wo.id} ${WO_STATUS[wo.status] || ''}` : ', no repair drafted yet'}.`;
  });
  const extraRoots = roots.filter(r => !ranked.some(x => x.a.id === r));
  for (const r of extraRoots) {
    const n = conseq.filter(c => c.rootCause === r).length;
    risks.push(html`<span class="state watch">${icon('layers')}Grouped</span>${SEP} <b>${n} machines</b> lose coolant pressure because <b class="mono">${r}</b> upstream is failing. One root cause: fix ${r} first.`);
  }
  if (ranked.length > 6) risks.push(html`<span class="dim">and ${ranked.length - 6} more in <a href="#/triage">Alert Triage</a>.</span>`);
  sections.push({ id: 'risks', title: 'Top risks', icon: 'alert', count: ranked.length + extraRoots.length, items: risks,
    empty: `No open alerts. All ${W.assets.length} machines are running normally; Nirantar keeps scoring them every 15 minutes.` });

  // 2. Decisions needed: pending work orders, unacknowledged alerts, escalations
  const pending = st.workOrders.filter(w => w.status === 'PENDING_APPROVAL').sort((x, y) => x.createdAt - y.createdAt);
  const decisions = pending.map(w => {
    const a = M.assetById(w.assetId);
    if (w.kind === 'INSPECT') return html`<span class="state act">${icon('orders')}Approve</span>${SEP} sensor check <b class="mono">${w.id}</b> on ${w.assetId} (${where(a)}): no production stop needed, ${inr(w.costs.total)}${w.technician ? `, ${w.technician.name}` : ''}. <a class="bd-open" href="#/orders">Open in Work Orders</a>`;
    const ass = M.assess(a, t), ex = M.exposure(a, w.mode);
    const pw = w.proposedWindow;
    const part = w.part ? (w.part.kind === 'local' ? `${w.part.name} in stock at ${city(a.siteId)}` : w.part.kind === 'transfer' ? `${w.part.name} from ${city(w.part.from)} (${w.part.etaH} h transfer)` : `${w.part.name} from the supplier (${Math.round(w.part.etaH / 24)} days)`) : 'no part needed';
    return html`<span class="state act">${icon('orders')}Approve or reject</span>${SEP} <b class="mono">${w.id}</b>, ${FAILURE_MODES[w.mode]?.name.toLowerCase() || 'repair'} on ${w.assetId}: drafted by Nirantar ${dateTime(w.createdAt)}. Planned cost <b>${inr(w.costs.total)}</b> against ${inr(ex.inr)} at stake. Proposed window ${pw ? dateTime(pw.start) : 'to be set'}${pw && pw.reason ? `, ${pw.reason}` : ''}${pw && !pw.beforeFailure ? ', after the predicted failure: expedite the part' : ''}. Part: ${part}.${w.technician ? ` Technician: ${w.technician.name}.` : ''}${ass.rulKind === 'trend' ? ` Time to failure now ${hours(ass.rulH)}.` : ''} <a class="bd-open" href="#/orders">Open in Work Orders</a>`;
  });
  const unack = open.filter(al => al.status === 'NEW' && !pending.some(w => w.alertId === al.id));
  if (unack.length) decisions.push(html`<span class="state watch">${icon('bell')}Acknowledge</span>${SEP} ${unack.length} new alert${unack.length === 1 ? '' : 's'} not yet acknowledged: ${unack.slice(0, 6).map(al => al.assetId).join(', ')}${unack.length > 6 ? '…' : ''}. <a class="bd-open" href="#/triage">Open Alert Triage</a>`);
  const esc = open.filter(al => al.status === 'ESCALATED');
  if (esc.length) decisions.push(html`<span class="state act">${icon('flag')}Plant head</span>${SEP} ${esc.length} escalated alert${esc.length === 1 ? '' : 's'} for the plant head: ${esc.map(al => al.assetId).join(', ')}.`);
  sections.push({ id: 'decisions', title: 'Decisions needed', icon: 'user', count: pending.length + (unack.length ? 1 : 0) + (esc.length ? 1 : 0), items: decisions,
    empty: 'Nothing is waiting for a decision. New repairs drafted by Nirantar appear here until a person approves them.' });

  // 3. What changed in the last 24 h (sim time)
  const since = now - DAY;
  const day24 = st.audit.filter(r => r.ts > since && r.ts <= now);
  const by = k => day24.filter(r => (r.kind || 'human') === k).length;
  const changes = [];
  if (day24.length) changes.push(html`<b>${day24.length} action${day24.length === 1 ? '' : 's'} logged</b>: ${by('ai')} by Nirantar, ${by('human')} by people, ${by('system')} automatic${by('blocked') ? `, ${by('blocked')} blocked by a guardrail` : ''}.`);
  for (const r of day24.slice(0, 10)) changes.push(html`<span class="mono dim">${time(r.ts)}</span> <b>${r.actor}</b>: ${r.action.charAt(0).toLowerCase() + r.action.slice(1)}, ${r.target}${r.detail ? ` (${r.detail})` : ''}.`);
  if (day24.length > 10) changes.push(html`<span class="dim">and ${day24.length - 10} earlier rows in the <a href="#/trust">audit log</a>.</span>`);
  sections.push({ id: 'changes', title: 'What changed in the last 24\u00a0h', icon: 'clock', count: day24.length, items: changes,
    empty: 'Nothing was logged in the last 24 hours of plant time.' });

  // 4. Yesterday's OEE by line vs 85 %
  const prodLines = W.lines.filter(l => !l.utility).sort((x, y) => (x.siteId === W.scenario.site ? -1 : 0) - (y.siteId === W.scenario.site ? -1 : 0));
  const oeeRows = prodLines.map(l => {
    let o = M.lineOee(l.id, 1, t);
    if (!o) { const last = Math.max(...W.oee.filter(r => r.lineId === l.id).map(r => r.date)); o = M.lineOee(l.id, 1, last + 60e3); }
    return { l, o };
  }).filter(x => x.o);
  const below = oeeRows.filter(x => x.o.oee < TARGET);
  const oeeItems = oeeRows.map(({ l, o }) => {
    const loss = Object.entries(o.losses).filter(([k]) => k !== 'planned').sort((a, b) => b[1] - a[1])[0];
    const gap = Math.round((TARGET - o.oee) * 100);
    return html`<span class="oee-line"><span class="oee-name"><b>${l.name}</b> <span class="dim">${city(l.siteId)}</span>${SEP}</span><span class="oee-bar" aria-hidden="true"><span style="width:${Math.round(o.oee * 100)}%" class="${o.oee < TARGET ? 'below' : ''}"></span><i style="left:${TARGET * 100}%"></i></span></span>
      OEE <b>${Math.round(o.oee * 100)} %</b> (availability ${Math.round(o.availability * 100)} %, performance ${Math.round(o.performance * 100)} %, quality ${Math.round(o.quality * 100)} %), ${gap > 0 ? `${gap} points below 85 %` : 'at or above 85 %'}${loss ? `; biggest loss: ${LOSS_NAME[loss[0]] || loss[0]}, ${loss[1].toFixed(1)} h` : ''}.`;
  });
  if (oeeRows.length) oeeItems.unshift(html`<b>${below.length} of ${oeeRows.length} lines</b> were below the 85 % world-class benchmark. <a class="bd-open" href="#/oee">Open OEE</a>`);
  sections.push({ id: 'oee', title: 'Yesterday\'s OEE by line vs 85 %', icon: 'gauge', count: oeeRows.length, items: oeeItems, empty: 'No OEE data for yesterday.' });

  // 5. Spares to watch: parts needed by open alerts first, then parts below reorder level at the focus plant
  const spares = [];
  const seen = new Set();
  for (const { al, a } of ranked) {
    if (al.type !== 'FAILURE' || !al.mode) continue;
    const plan = M.partPlan(a, al.mode); if (!plan) continue;
    const wo = al.woId ? st.workOrders.find(w => w.id === al.woId) : null;
    seen.add(plan.part.id);
    const stockTxt = Object.entries(plan.part.stock).map(([s, q]) => `${city(s)} ${q}`).join(', ');
    let txt;
    if (wo && wo.part && wo.part.kind === 'transfer' && wo.eta && wo.status !== 'PENDING_APPROVAL') txt = wo.partArrived ? `arrived at ${city(a.siteId)}` : `on the way from ${city(wo.part.from)}, arrives ${dateTime(wo.eta)}`;
    else if (plan.kind === 'local') txt = `in stock at ${city(a.siteId)}`;
    else if (plan.kind === 'transfer') txt = `none at ${city(a.siteId)}; nearest at ${city(plan.from)} (${plan.etaH} h transfer)`;
    else txt = `none in the group; supplier lead time ${plan.part.leadDays} days`;
    spares.push(html`<span class="state ${plan.kind === 'local' ? 'normal' : plan.kind === 'transfer' ? 'watch' : 'act'}">${icon('box')}Needed</span>${SEP} <b>${plan.part.name}</b> for ${a.id}: ${txt}. Stock: ${stockTxt}.`);
  }
  const site = W.scenario.site;
  const low = W.parts.filter(p => !seen.has(p.id) && (p.stock[site] || 0) < p.reorder);
  if (low.length) spares.push(html`<span class="state watch">${icon('box')}Reorder</span>${SEP} Below the reorder level at ${city(site)}: ${low.map(p => `${p.name} (${p.stock[site] || 0} of ${p.reorder})`).join('; ')}. <a class="bd-open" href="#/spares">Open Spares</a>`);
  sections.push({ id: 'spares', title: 'Spares to watch', icon: 'box', count: spares.length, items: spares, empty: `All spares needed by open alerts are in place, and nothing is below its reorder level at ${city(site)}.` });

  // 6. Repairs planned in the next 72 h
  const until = now + 72 * HOUR;
  const planned = st.workOrders.map(w => {
    const win = w.status === 'PENDING_APPROVAL' ? w.proposedWindow : ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'].includes(w.status) ? w.window : null;
    return win && win.end >= now && win.start <= until ? { w, win } : null;
  }).filter(Boolean).sort((x, y) => x.win.start - y.win.start);
  const repairs = planned.map(({ w, win }) => {
    const proposed = w.status === 'PENDING_APPROVAL';
    const what = w.kind === 'INSPECT' ? 'sensor check' : w.kind === 'PM' ? `preventive job${w.bundleWith ? ' (same stop as ' + w.bundleWith + ')' : ''}` : `${FAILURE_MODES[w.mode]?.short || 'repair'} repair`;
    return html`<span class="state ${proposed ? 'ai' : 'ok'}">${icon(proposed ? 'ai' : 'check')}${proposed ? 'Proposed' : 'Approved'}</span>${SEP} <b>${dateTime(win.start)}</b> to ${time(win.end)}: ${w.assetId} ${what} (${w.id})${w.technician ? `, ${w.technician.name}` : ''}${win.reason ? `, ${win.reason}` : ''}.${w.part && w.part.kind !== 'local' && w.eta && !proposed ? ` Part ${w.partArrived ? 'arrived' : `arrives ${dateTime(w.eta)}`}.` : ''}${proposed ? ' Waiting for approval.' : ''}${w.status === 'IN_PROGRESS' ? ' In progress now.' : ''}`;
  });
  sections.push({ id: 'repairs', title: 'Jobs planned in the next 72\u00a0h', icon: 'wrench', count: repairs.length, items: repairs, empty: 'No repairs or preventive jobs planned in the next 72 hours.' });

  const atRisk = open.filter(al => al.type === 'FAILURE').reduce((s, al) => s + M.exposure(M.assetById(al.assetId), al.mode).inr, 0);
  return { sections, atRisk, grouped: conseq.length, open: ranked.length + extraRoots.length, pending: pending.length, below: below.length, lines: oeeRows.length, at: now,
    lists: { ranked, conseq, extraRoots, pending, unack, esc } };
}

// ---------- Slack version (MCP preview, nothing is sent): summary, top risks, decisions needed, as Slack mrkdwn ----------
function briefSlack(B, store, M, base) {
  const W = store.world, st = store.state, L = B.lists;
  const site = M.siteById(W.scenario.site);
  const city = id => M.siteById(id)?.city || id;
  const woOf = al => (al.woId ? st.workOrders.find(w => w.id === al.woId) : null);
  const risks = L.ranked.slice(0, 5).map(({ al, a, ass }) => {
    const wo = woOf(al), where = `${M.lineById(a.lineId).name}, ${city(a.siteId)}`;
    if (al.type === 'SENSOR') return `• *${a.id}* (${where}): ${ass.sensorFault ? lcFirst(ass.sensorFault.reason) : 'a sensor looks frozen'}. Inspect the sensor; no repair crew.${wo ? ` Sensor check ${wo.id} ${WO_STATUS[wo.status] || ''}.` : ''}`;
    const ex = M.exposure(a, ass.mode), n = L.conseq.filter(c => c.rootCause === a.id).length;
    return `• *${a.id}* ${(ass.modeName || 'abnormal readings').toLowerCase()} (${where}): health ${ass.health}, ${confPct(ass.conf)} failure confidence, likely to fail in about ${hours(ass.rulH)}. ${inr(ex.inr)} at stake.${n ? ` Root cause of ${plural(n, 'low-coolant alarm')} downstream.` : ''}${wo ? ` Repair ${wo.id} ${WO_STATUS[wo.status] || ''}.` : ' No repair drafted yet.'}`;
  });
  for (const r of L.extraRoots) risks.push(`• *${plural(L.conseq.filter(c => c.rootCause === r).length, 'machine')}* lose coolant pressure because *${r}* upstream is failing: fix ${r} first.`);
  if (L.ranked.length > 5) risks.push(`…and ${L.ranked.length - 5} more in Alert Triage.`);
  const decisions = L.pending.slice(0, 5).map(w => {
    if (w.kind === 'INSPECT') return `• Approve the sensor check *${w.id}* on ${w.assetId}: no production stop, ${inr(w.costs.total)}.`;
    const ex = M.exposure(M.assetById(w.assetId), w.mode), pw = w.proposedWindow;
    return `• Approve or reject *${w.id}*, ${FAILURE_MODES[w.mode]?.short || 'repair'} on ${w.assetId}: ${inr(w.costs.total)} planned against ${inr(ex.inr)} at stake, proposed window ${pw ? dateTime(pw.start) : 'to be set'}.`;
  });
  if (L.pending.length > 5) decisions.push(`…and ${L.pending.length - 5} more on Work Orders.`);
  if (L.unack.length) decisions.push(`• Acknowledge ${plural(L.unack.length, 'new alert')}: ${L.unack.slice(0, 6).map(al => al.assetId).join(', ')}${L.unack.length > 6 ? ` and ${L.unack.length - 6} more` : ''}.`);
  if (L.esc.length) decisions.push(`• Plant head: ${plural(L.esc.length, 'escalated alert')} (${L.esc.map(al => al.assetId).join(', ')}).`);
  const sum = B.open ? `${plural(B.open, 'open risk')}, ${plural(B.pending, 'decision')} waiting, ${inr(B.atRisk)} of production at stake.`
    : `No open alerts; ${B.pending ? `${plural(B.pending, 'decision')} waiting.` : 'nothing waiting for a decision.'}`;
  const channel = channelFor(site.city);
  const nRisks = risks.filter(r => r.startsWith('•')).length, nDecisions = decisions.filter(d => d.startsWith('•')).length;
  return slackPost({
    id: `nirantar-slack-brief-${isoDate(B.at)}`, channel, title: 'Slack message for the shift brief',
    text: `Morning reliability brief for ${site.name}, ${weekday(B.at)} ${day(B.at)}. ${sum}`,
    blocks: [
      section(mrkdwn(`*Morning reliability brief · ${site.name} · ${weekday(B.at)} ${day(B.at)}*\n${sum}`)),
      section(mrkdwn(`*Top risks*\n${risks.length ? risks.join('\n') : `No open alerts. All ${W.assets.length} machines are running normally.`}`)),
      section(mrkdwn(`*Decisions needed*\n${decisions.length ? decisions.join('\n') : 'Nothing is waiting for a decision.'}`)),
      section(mrkdwn(`_Written by Nirantar from the data at ${dateTime(B.at)}. All data is synthetic._`) + (base ? `\n<${base}#/brief|Open the full brief>` : '')),
    ],
    what: `Posts the brief to ${channel}: the summary line, ${nRisks ? plural(nRisks, 'top risk') : 'no open risks'}, ${nDecisions ? `${plural(nDecisions, 'decision')} needed` : 'no decisions needed'}${base ? ' and a link back to the full brief' : ''}.`,
  });
}

// ---------- exports ----------
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => '﻿' + [cols.map(c => csvCell(c[0])).join(','), ...rows.map(r => cols.map(c => csvCell(c[1](r))).join(','))].join('\r\n');
const stamp = ts => (ts ? `${isoDate(ts)} ${time(ts)}` : '');
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportsFor(store, S, M) {
  const st = store.state, t = store.t, d = isoDate(st.simNow);
  return {
    alerts: () => {
      const rows = st.alerts.map(al => { const a = M.assetById(al.assetId), ass = M.assess(a, t); return { al, a, ass, att: S.attention(a, ass), ex: M.exposure(a, ass.mode) }; });
      return [`nirantar-alerts-${d}.csv`, toCsv([
        ['alert_id', r => r.al.id], ['machine', r => r.a.id], ['machine_name', r => r.a.name], ['line', r => M.lineById(r.a.lineId).name], ['plant', r => M.siteById(r.a.siteId).city],
        ['type', r => r.al.type], ['priority', r => r.al.priority], ['status', r => r.al.status], ['raised_ist', r => stamp(r.al.createdAt)], ['failure_mode', r => FAILURE_MODES[r.al.mode]?.name || ''],
        ['root_cause', r => r.al.rootCause || ''], ['health_now', r => r.ass.health], ['failure_confidence_now', r => r.ass.conf.toFixed(3)], ['time_to_failure_h', r => r.ass.rulKind === 'trend' ? r.ass.rulH.toFixed(1) : ''],
        ['money_at_stake_inr', r => r.ex.inr], ['attention', r => r.att.score.toFixed(2)], ['work_order', r => r.al.woId || ''], ['closed_ist', r => stamp(r.al.closedAt)],
      ], rows), 'text/csv;charset=utf-8', st.alerts.length];
    },
    orders: () => [`nirantar-work-orders-${d}.csv`, toCsv([
      ['work_order', w => w.id], ['machine', w => w.assetId], ['kind', w => w.kind], ['title', w => w.title], ['status', w => w.status], ['created_ist', w => stamp(w.createdAt)], ['created_by', w => w.createdBy],
      ['part', w => w.part?.name || ''], ['part_from', w => w.part ? (M.siteById(w.part.from)?.city || w.part.from) : ''], ['part_eta_h', w => w.part?.etaH ?? ''], ['technician', w => w.technician?.name || ''],
      ['proposed_window_ist', w => stamp(w.proposedWindow?.start)], ['window_start_ist', w => stamp(w.window?.start)], ['window_end_ist', w => stamp(w.window?.end)],
      ['parts_inr', w => w.costs?.parts ?? ''], ['labour_inr', w => w.costs?.labour ?? ''], ['total_inr', w => w.costs?.total ?? ''],
      ['decided_by', w => w.approvals.map(x => `${x.action} by ${x.by}`).join('; ')], ['decided_ist', w => stamp(w.approvals[0]?.at)], ['done_ist', w => stamp(w.doneAt)],
    ], st.workOrders), 'text/csv;charset=utf-8', st.workOrders.length],
    audit: () => [`nirantar-audit-log-${d}.csv`, toCsv([['time_ist', r => stamp(r.ts)], ['actor', r => r.actor], ['kind', r => r.kind || 'human'], ['action', r => r.action], ['target', r => r.target], ['detail', r => r.detail]], st.audit), 'text/csv;charset=utf-8', st.audit.length],
    state: () => [`nirantar-state-${d}.json`, JSON.stringify({ app: 'Nirantar interactive demo', note: 'All data is synthetic.', exportedAtIst: dateTime(st.simNow), scenario: store.world.scenario, state: st }, null, 2), 'application/json', null],
  };
}

// Plain text for WhatsApp / email, read from the rendered brief so it always matches the page.
function briefText(doc) {
  const clean = el => el.innerText.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/\s+:/g, ':').trim();
  const out = [clean(doc.querySelector('.bd-eyebrow')), clean(doc.querySelector('.bd-title')), clean(doc.querySelector('.bd-by')), clean(doc.querySelector('.bd-sum'))];
  for (const sec of doc.querySelectorAll('.bd-sec')) {
    out.push('', sec.dataset.title);
    for (const li of sec.querySelectorAll('li')) { const c = li.cloneNode(true); c.querySelectorAll('.bd-open').forEach(x => x.remove()); document.body.appendChild(c); c.style.cssText = 'position:absolute;left:-9999px;top:0'; out.push('- ' + clean(c)); c.remove(); }
  }
  out.push('', 'All data is synthetic (Nirantar interactive demo).');
  return out.join('\n');
}

export default {
  render(root, ctx) {
    const { store, S, M } = ctx;
    const B = buildBrief(store, S, M);
    const st = store.state, W = store.world;
    const site = M.siteById(W.scenario.site);
    const tone = B.open ? (B.pending ? 'act' : 'watch') : 'ok';

    root.innerHTML = String(html`<div class="page briefpage">
      ${pageHead('brief')}
      ${headline(B.open
        ? html`For the morning meeting: <b>${B.open} open risk${B.open === 1 ? '' : 's'}</b>${B.grouped ? ` (plus ${B.grouped} downstream alarm${B.grouped === 1 ? '' : 's'} grouped under the root cause)` : ''}, <b>${B.pending} decision${B.pending === 1 ? '' : 's'}</b> waiting${B.atRisk ? html` and <b>${inr(B.atRisk)}</b> of production at stake` : ''}. ${B.below} of ${B.lines} lines ran below 85 % OEE yesterday.`
        : html`A quiet morning: <b>no open alerts</b> and ${B.pending ? html`<b>${B.pending} decision${B.pending === 1 ? '' : 's'}</b> waiting` : 'nothing waiting for a decision'}. ${B.below} of ${B.lines} lines ran below 85 % OEE yesterday.`, tone)}
      ${doThis([
        html`Read the brief ${marker(1)}: six short sections, written from the live plant data.`,
        html`Print it, copy it as text for WhatsApp or email, or preview it as a Slack post ${marker(2)}.`,
        html`Need the raw numbers? Download alerts, work orders, the audit log or the full state ${marker(3)}.`,
      ])}

      <div class="card bf-actions" aria-label="Share and export">
        <div class="bf-grp">${marker(2)}<button class="btn primary" data-action="print">${icon('print')} Print</button><button class="btn" data-action="copy">${icon('doc')} Copy as text</button>
          <button class="btn" data-action="mcp-slack" aria-haspopup="dialog">${icon('plug')} Slack message (MCP preview)</button></div>
        <div class="bf-grp">${marker(3)}<span class="small muted">Download data:</span>
          <button class="btn sm" data-action="dl" data-kind="alerts">${icon('download')} Alerts CSV</button>
          <button class="btn sm" data-action="dl" data-kind="orders">${icon('download')} Work orders CSV</button>
          <button class="btn sm" data-action="dl" data-kind="audit">${icon('download')} Audit CSV</button>
          <button class="btn sm" data-action="dl" data-kind="state">${icon('download')} Full state JSON</button></div>
      </div>

      <article class="card brief-doc" id="brief-doc" aria-label="Morning reliability brief">
        <header class="bd-head">
          <div class="row between bd-top">
            <div class="stack" style="gap:2px">${marker(1)}<span class="eyebrow bd-eyebrow">Morning reliability brief · Indus Group</span>
              <h2 class="bd-title">${weekday(B.at)} ${day(B.at)} · focus plant: ${site.name}</h2></div>
            <span class="bd-by">${aiChip(`Written by Nirantar from the data at ${dateTime(B.at)}`)}</span>
          </div>
          <p class="bd-sum">${B.open ? `${B.open} open risk${B.open === 1 ? '' : 's'}, ${B.pending} decision${B.pending === 1 ? '' : 's'} waiting, ${inr(B.atRisk)} of production at stake.` : `No open alerts; ${B.pending ? `${B.pending} decision${B.pending === 1 ? '' : 's'} waiting.` : 'nothing waiting for a decision.'}`} Scenario: ${W.scenario.name}.</p>
        </header>
        <div class="bd-grid">${B.sections.map((s, i) => html`<section class="bd-sec bd-${s.id}" data-title="${s.title}${s.count ? ` (${s.count})` : ''}" aria-label="${s.title}">
          <h3><span class="bd-n">${i + 1}</span>${icon(s.icon)}${s.title}${s.count ? html` <span class="bd-count">${s.count}</span>` : ''}</h3>
          ${s.items.length ? html`<ul class="bd-list">${s.items.map(it => html`<li>${it}</li>`)}</ul>` : html`<ul class="bd-list empty-l"><li>${s.empty}</li></ul>`}
        </section>`)}</div>
        <p class="bd-foot small dim">All data is synthetic. Figures use plant time (IST) and the same model as the rest of the demo.</p>
      </article>

      <section class="card ai bf-note" aria-label="How this works in the live app">
        <div class="card-head"><h2>In the live Snowflake app</h2>${aiChip('Scheduled automation')}</div>
        <p class="small">This brief is a scheduled CoCo automation, <b>“Nirantar Morning Reliability Briefing”</b>. It runs before the morning meeting, reads the same alerts, work orders, audit log, OEE and stock tables, and writes these six sections. Here it is written live in your browser from the demo data.</p>
        <p class="small">Posting it to the plant's Slack channel needs an MCP connector, which is not wired in the live build yet. <b>Slack message (MCP preview)</b> shows exactly what would be sent; nothing leaves your browser.</p>
      </section>

      ${nextBack('brief')}
    </div>`);

    const ex = exportsFor(store, S, M);
    return delegate(root, {
      print: () => window.print(),
      copy: () => {
        const doc = root.querySelector('#brief-doc');
        const text = briefText(doc);
        const fallback = () => {
          const sel = window.getSelection(); sel.removeAllRanges(); sel.selectAllChildren(doc);
          S.toast({ kind: 'watch', title: 'Brief selected', body: 'Copying is blocked in this browser. Press Ctrl+C (or ⌘C) to copy the selected brief.' });
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => S.toast({ kind: 'ok', title: 'Brief copied as text', body: `${text.split('\n').length} lines, ready to paste into WhatsApp or email.` }), fallback);
        else fallback();
      },
      // MCP preview: the Slack post of this brief (nothing is sent) + an audit row saying a person looked at it
      'mcp-slack': el => {
        const pv = briefSlack(B, store, M, appUrl());
        openMcpPreview(pv, { opener: el });
        S.audit(store.prefs.name || 'You', 'Previewed an MCP Slack message (not sent)', 'Shift brief', `${pv.request.params.arguments.channel}: ${plural(B.open, 'open risk')}, ${plural(B.pending, 'decision')} waiting`, 'human');
        S.changed('mcp');
      },
      dl: el => {
        const [name, text, type, n] = ex[el.dataset.kind]();
        download(name, text, type);
        S.toast({ kind: 'ok', title: `Downloaded ${name}`, body: n == null ? 'The full demo state (alerts, work orders, audit log, guardrail log, copilot log, savings, policy).' : `${n} row${n === 1 ? '' : 's'}.` });
      },
    });
  },
};
