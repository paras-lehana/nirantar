// MCP preview: the requests Nirantar's agent would send to other tools through MCP (Model Context Protocol), namely a
// Jira issue, a Slack message and a work card file in Google Drive. They are built as JSON-RPC 2.0 `tools/call` requests
// from the live demo data and shown in one shared dialog. Preview only: nothing is sent anywhere. The live Snowflake build
// has no MCP connectors wired yet; the next step is a Snowflake-managed MCP server for Nirantar's tools plus CoCo
// `cortex mcp add` for the external servers.
// The builders are pure (work order + store + model in, plain objects out, no DOM), so Node tests can check them.
// The dialog is one <dialog> on <body>, outside every page, so a page re-render (clock tick, audit row) never closes it.
import { html, icon } from './dom.js';
import { FAILURE_MODES, DOCS } from '../core/generator.js';
import { inr, hours, dateTime, day, weekday, time, isoDate, HOUR } from '../core/format.js';

const server = (serverId, serverName, tool, noun) => ({ server: `${serverId} (${serverName})`, serverId, serverName, tool, noun });
export const MCP_SERVERS = {
  jira: server('jira', 'Atlassian MCP server', 'create_issue', 'Jira issue'),
  slack: server('slack', 'Slack MCP server', 'post_message', 'Slack message'),
  drive: server('google-drive', 'Drive MCP server', 'create_file', 'Drive file'),
};
export const MCP_TIP = 'Model Context Protocol: an open standard that lets an AI agent call tools in other apps (Jira, Slack, Google Drive) with structured requests.';
export const JIRA_PRIORITY = { P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low', P5: 'Lowest' };

// ---------- protocol helpers ----------
// One MCP request: JSON-RPC 2.0, method tools/call (string ids are allowed by both JSON-RPC and MCP).
export const toolCall = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
// Slack mrkdwn: & < > must be escaped; * and _ stay as formatting. Links (<url|text>) are added after escaping.
export const mrkdwn = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const section = text => ({ type: 'section', text: { type: 'mrkdwn', text } });
export const channelFor = city => '#maint-' + String(city || 'plant').toLowerCase().replace(/[^a-z0-9]+/g, '-');
// The page this demo runs on, for "open in Nirantar" links (empty outside a browser).
export const appUrl = () => (typeof location === 'undefined' ? '' : location.href.split('#')[0]);
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- facts about one work order, in the words the pages use ----------
const SHIFT = { A: '06:00 to 14:00', B: '14:00 to 22:00', C: '22:00 to 06:00' };
const ALERT_WORD = { NEW: 'new', ACK: 'acknowledged', SHELVED: 'shelved', ESCALATED: 'escalated', CLOSED: 'closed' };
const lc1 = s => (!s ? '' : /^[A-Z0-9]{2,}/.test(s) ? s : s[0].toLowerCase() + s.slice(1));   // keeps "CNC lathe", "ISO zone"
const confPct = c => (c >= 0.99 ? '99' : c < 0.01 ? '< 1' : String(Math.floor(c * 100))) + ' %';   // same rounding as components.confPct
const reasonOf = w => String(w.reason || '').replace(' (low-impact)', ', low impact');
const fmtWin = w => (day(w.start) === day(w.end) ? `${weekday(w.start)} ${day(w.start)}, ${time(w.start)} to ${time(w.end)} IST` : `${dateTime(w.start)} to ${dateTime(w.end)}`);

// `plan` (optional) = { win, eta, ready } as the Work Orders page computes them: before approval the window and the part
// arrival are "if you approve now", after approval the booked ones. Without it: the drafted or booked values.
export function woFacts(wo, store, M, plan = {}) {
  const st = store.state, now = st.simNow;
  const a = M.assetById(wo.assetId), site = M.siteById(a.siteId), line = M.lineById(a.lineId);
  const ass = M.assess(a, store.t);
  const fm = FAILURE_MODES[wo.mode] || null;
  const inspect = wo.kind === 'INSPECT';
  const pending = wo.status === 'PENDING_APPROVAL' || wo.status === 'DRAFT';
  const al = st.alerts.find(x => x.id === wo.alertId) || null;
  const moving = !!(wo.part && wo.part.kind !== 'local');
  const from = moving && wo.part.from !== 'Supplier' ? M.siteById(wo.part.from) : null;
  const eta = plan.eta ?? (pending || wo.eta == null ? now + (moving ? wo.part.etaH * HOUR : 0) : wo.eta);
  const win = plan.win || (pending ? wo.proposedWindow : wo.window || wo.proposedWindow) || null;
  const ready = plan.ready ?? (!moving || !!wo.partArrived || (!pending && wo.eta != null && now >= wo.eta));
  const failAt = inspect || ass.rulKind !== 'trend' || wo.status === 'DONE' ? null : ass.failAt;
  const ex = !inspect && wo.mode ? M.exposure(a, wo.mode) : null;
  const c = wo.costs || { parts: 0, labour: 0, total: 0 };
  const ap = wo.approvals.filter(x => x.action === 'Approved').pop() || null;
  const last = wo.approvals[wo.approvals.length - 1] || null;
  const sop = DOCS.find(d => d.id === wo.sop);
  const t = wo.technician;
  const title = inspect ? `Sensor check on ${a.id}` : wo.kind === 'PM' ? `Preventive job on ${a.id}` : `${fm ? fm.name : 'Repair'} on ${a.id}`;
  const prio = al ? al.priority : 'P3';

  const condition = inspect
    ? `${ass.sensorFault ? lc1(ass.sensorFault.reason) : 'a sensor reading looks frozen'}; the machine keeps running (health ${ass.health} of 100 from the other sensors)`
    : `health ${ass.health} of 100, failure confidence ${confPct(ass.conf)}, ${failAt ? `time to failure about ${hours(ass.rulH)} (likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)}), predicted failure about ${dateTime(failAt)}` : 'no failure trend'}`;
  const money = inspect
    ? `no production at stake (no stop needed); planned cost ${inr(c.total)} (labour ${inr(c.labour)}; a new sensor only if the check fails)`
    : `${ex ? `${inr(ex.inr)} if ${a.id} stops unplanned (${hours(ex.downH)} stopped)` : 'not estimated'}, against a planned repair of ${inr(c.total)} (parts ${inr(c.parts)}, labour ${inr(c.labour)})`;

  const part = wo.part ? `${wo.part.name} × ${wo.part.qty || 1} (${wo.part.id})${inspect ? ', only if the check fails' : ''}` : 'none needed';
  let source = '', sourceShort = '';
  if (wo.part) {
    const fromName = from ? from.name : wo.part.from;
    if (wo.part.kind === 'local') { source = `in stock at ${site.name}`; sourceShort = `in stock at ${site.city}`; }
    else if (wo.part.kind === 'transfer') {
      source = pending ? `road transfer from ${fromName} (${wo.part.etaH} h); arrives ${dateTime(eta)} if approved now`
        : ready ? `arrived from ${fromName} (road transfer, ${wo.part.etaH} h)` : `on the road from ${fromName} (${wo.part.etaH} h); arrives ${dateTime(eta)}`;
      sourceShort = `${ready && !pending ? 'arrived' : 'by road'} from ${from ? from.city : wo.part.from} (${wo.part.etaH} h)`;
    } else {
      const p = store.world.parts.find(x => x.id === wo.part.id);
      source = `no plant has one; bought from the supplier (lead time ${p ? p.leadDays : Math.round(wo.part.etaH / 24)} days)${ready && !pending ? '; arrived' : `; arrives about ${dateTime(eta)}${pending ? ' if approved now' : ''}`}`;
      sourceShort = `bought from the supplier (${p ? p.leadDays : Math.round(wo.part.etaH / 24)} days)`;
    }
  }

  const marginH = failAt && win ? (failAt - win.end) / HOUR : null;
  const windowTxt = !win ? 'no window booked'
    : `${fmtWin(win)} (${reasonOf(win)})${marginH == null ? '' : marginH > 0 ? `, about ${hours(marginH)} before the predicted failure` : ', after the predicted failure: expedite the part'}`;
  const tech = t ? `${t.name} (${t.id}), ${/\s/.test(t.why) ? t.why : t.why + ' specialist'}, usual shift ${t.shift} (${SHIFT[t.shift] || ''} IST)` : `no technician found at ${site.city}`;

  let approval;
  if (pending) approval = 'waiting for a named person (Policy G8: the AI drafts, only a person approves). Nothing is released until then.';
  else if (wo.status === 'REJECTED') approval = `rejected by ${last ? last.by : 'a person'}${last ? ` on ${dateTime(last.at)}` : ''}${last && last.comment ? `: "${last.comment}"` : ''}`;
  else approval = `approved by ${ap ? ap.by : 'a person'}${ap ? ` on ${dateTime(ap.at)}` : ''}${ap && ap.comment ? `: "${ap.comment}"` : ''}`
    + (wo.status === 'IN_PROGRESS' && wo.startedAt ? `; work started ${dateTime(wo.startedAt)}` : wo.status === 'DONE' && wo.doneAt ? `; done ${dateTime(wo.doneAt)}` : '');
  const statusWord = pending ? 'Waiting for approval' : wo.status === 'REJECTED' ? 'Rejected' : wo.status === 'IN_PROGRESS' ? 'In progress' : wo.status === 'DONE' ? 'Done' : `Approved by ${ap ? ap.by : 'a person'}`;

  return {
    wo, a, site, line, ass, fm, inspect, pending, al, from, eta, win, ready, failAt, ex, c, ap, sop, t, title, statusWord,
    priority: prio, jiraPriority: JIRA_PRIORITY[prio] || 'Medium',
    machine: `${a.id}, ${lc1(a.name)} (criticality ${a.criticality})`, where: `${site.name}, ${line.name}`,
    mode: inspect ? `none: a suspected sensor fault, not a machine failure (${wo.sop}). Do not send a repair crew.` : fm ? `${fm.name} (${wo.mode})` : 'not classified',
    condition, money, part, source, sourceShort, window: windowTxt, tech, approval,
    sopTitle: sop ? sop.title : wo.sop || 'no SOP',
    link: base => (base ? `${base}#/orders/${encodeURIComponent(wo.id)}` : ''),
  };
}

// ---------- Jira: create_issue ----------
export function jiraIssue(wo, store, M, { plan, appUrl: base = '' } = {}) {
  const f = woFacts(wo, store, M, plan);
  const lines = [
    `Drafted by Nirantar AI on ${dateTime(wo.createdAt)} from live plant data (synthetic demo data).`,
    '',
    `Machine: ${f.machine}`,
    `Plant / line: ${f.where}`,
    `Failure mode: ${f.mode}`,
    `Condition now: ${f.condition}`,
    `${f.inspect ? 'Cost' : 'Money at stake'}: ${f.money}`,
    `Part: ${f.part}`,
    ...(f.source ? [`Source: ${f.source}`] : []),
    `${f.pending ? 'Proposed window (if approved now)' : 'Window'}: ${f.window}`,
    `Technician: ${f.tech}`,
    '',
    `Steps (${f.sopTitle}):`,
    ...wo.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `Approval: ${f.approval}`,
    `Alert: ${f.al ? `${f.al.id} (${f.al.priority}, ${ALERT_WORD[f.al.status] || lc1(f.al.status)})` : 'none'}. Nirantar work order ${wo.id}.`,
    ...(base ? [`Open in Nirantar: ${f.link(base)}`] : []),
  ];
  const args = {
    project_key: 'MAINT',
    issue_type: 'Task',
    summary: `${wo.id}: ${f.title}`,
    description: lines.join('\n'),
    priority: f.jiraPriority,
    labels: ['nirantar', 'predictive-maintenance', f.site.city.toLowerCase()],
  };
  if (f.win) args.due_date = isoDate(f.win.start);
  return {
    key: 'jira', ...MCP_SERVERS.jira, title: `Jira issue for ${wo.id}`,
    what: `Creates a Task in the MAINT project with the ${f.inspect ? 'sensor check, its cost' : 'plan, the money at stake'} and the approval state. Priority ${args.priority} (alert ${f.priority}), due ${f.win ? `${weekday(f.win.start)} ${day(f.win.start)}, the window start` : 'not set'}.`,
    request: toolCall(`nirantar-jira-${wo.id}`, 'create_issue', args),
  };
}

// ---------- Slack: post_message ----------
export function slackPost({ id, channel, text, blocks, title, what }) {
  return { key: 'slack', ...MCP_SERVERS.slack, title, what, request: toolCall(id, 'post_message', { channel, text, blocks }) };
}

export function slackWorkOrder(wo, store, M, { plan, appUrl: base = '' } = {}) {
  const f = woFacts(wo, store, M, plan);
  const channel = channelFor(f.site.city);
  const where = `${f.line.name}, ${f.site.city}`;
  const when = f.win ? fmtWin(f.win) : 'no window yet';
  const job = f.inspect ? 'sensor check' : f.fm ? f.fm.short : 'repair';
  let text;
  if (f.pending) text = f.inspect
    ? `${wo.id} needs approval: sensor check on ${f.a.id} (${where}). The sensor looks frozen, so no repair crew and no production stop. Proposed ${when}.`
    : `${wo.id} needs approval: ${job} on ${f.a.id} (${where}). ${f.ex ? inr(f.ex.inr) : 'Production'} at stake against a ${inr(f.c.total)} repair. Proposed window ${when}.`;
  else text = `${wo.id} ${lc1(f.statusWord)}: ${f.inspect ? job : job + ' repair'} on ${f.a.id} (${where}), ${when}${f.t ? ` with ${f.t.name}` : ''}.`
    + (wo.part && wo.part.kind !== 'local' && !f.ready ? ` Part arrives ${dateTime(f.eta)}.` : '');
  const why = f.inspect
    ? `*Why:* ${f.condition}\n*Cost:* ${inr(f.c.total)}, no production stop`
    : `*Why now:* health ${f.ass.health} of 100, failure confidence ${confPct(f.ass.conf)}${f.failAt ? `, about ${hours(f.ass.rulH)} to failure` : ''}\n*At stake:* ${f.ex ? `${inr(f.ex.inr)} if it stops unplanned` : 'not estimated'}, against ${inr(f.c.total)} planned`;
  const link = f.link(base);
  const blocks = [
    section(mrkdwn(`*${wo.id} · ${f.title}*\n${f.statusWord} · ${f.a.name}, ${f.line.name}, ${f.site.name}`)),
    section(mrkdwn(why)),
    section(mrkdwn(`*Part:* ${wo.part ? `${wo.part.name}, ${f.sourceShort}${f.inspect ? ' (only if the check fails)' : ''}` : 'none needed'}\n*${f.pending ? 'Proposed window' : 'Window'}:* ${f.window}\n*Technician:* ${f.t ? f.t.name : 'not assigned'}`)),
    section(mrkdwn(`*Approval:* ${f.approval}`) + (link ? `\n<${link}|Open ${wo.id} in Nirantar>` : '')),
  ];
  return slackPost({
    id: `nirantar-slack-${wo.id}`, channel, text, blocks, title: `Slack message for ${wo.id}`,
    what: f.pending
      ? `Posts to ${channel} so the ${f.site.city} maintenance team sees the ${f.inspect ? 'sensor check waiting for approval (no repair crew, no production stop)' : 'plan waiting for approval and what is at stake'}.`
      : `Posts to ${channel} so the ${f.site.city} maintenance team sees the approved ${f.inspect ? 'sensor check' : 'plan'}, who approved it and when the work happens.`,
  });
}

// ---------- Google Drive: create_file (the printable work card as Markdown) ----------
export function workCardMarkdown(wo, store, M, { plan, appUrl: base = '' } = {}) {
  const f = woFacts(wo, store, M, plan);
  const c = f.c;
  const confMean = f.inspect ? 'High: a reading that stays flat while related sensors move is a classic sensor fault (SOP-50).'
    : wo.confidence >= 0.9 ? 'High: the part can be in place and the repair finished before the predicted failure.'
    : 'Lower: the part has to be bought, or the window falls after the predicted failure. Consider expediting.';
  const when = !f.win ? 'No window booked.'
    : f.inspect ? `A one-hour check on ${fmtWin(f.win)}. The machine keeps running: no production stop.`
    : `${f.pending ? 'If approved now: ' : ''}${f.window}.`;
  const L = [
    `# Nirantar work card · ${wo.id}`,
    '',
    `**${f.title}** · ${f.a.name} · ${f.where} · criticality ${f.a.criticality}`,
    '',
    `- Status: ${lc1(f.statusWord)}`,
    `- Drafted by Nirantar AI on ${dateTime(wo.createdAt)}`,
    `- Printed ${dateTime(store.state.simNow)} · synthetic demo data`,
    '',
    '## Part',
    f.part.charAt(0).toUpperCase() + f.part.slice(1),
    '',
    '## Where from',
    wo.part ? `${f.source.charAt(0).toUpperCase() + f.source.slice(1)}.` : 'No part is needed.',
    '',
    '## When',
    when,
    '',
    '## Who',
    f.t ? `${f.tech}.` : `No technician found at ${f.site.city}.`,
    '',
    '## Steps',
    `From ${f.sopTitle}.`,
    '',
    ...wo.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Cost',
    '| Item | Amount |',
    '|---|---:|',
    `| Parts | ${inr(c.parts)} |`,
    `| Labour | ${inr(c.labour)} |`,
    `| **Total** | **${inr(c.total)}** |`,
    '',
    (f.inspect ? 'Labour: one instrumentation technician for about an hour; a new sensor only if the check fails.' : 'Labour: 2 technicians at the shutdown rate.')
      + (f.ex ? ` If ${f.a.id} breaks down instead, about ${inr(f.ex.inr)} of production is lost (${hours(f.ex.downH)} stopped).` : ''),
    '',
    '## Plan confidence',
    `${confPct(wo.confidence)} · ${confMean}`,
    '',
    '## Sign-off',
    `- Approved by: ${f.ap ? `${f.ap.by}, ${dateTime(f.ap.at)}` : '______________________'}`,
    '- Technician: ______________________ · Start: ________ · End: ________',
    f.inspect ? '- Readings agree with a handheld vibration meter: ☐ yes ☐ no · Sensor replaced: ☐ yes ☐ no'
      : '- Test run passed (vibration back in zone A or B): ☐ yes ☐ no',
    '- Released to production by: ______________________',
    '',
    `Source: Nirantar work order ${wo.id}${base ? ` (${f.link(base)})` : ''}. All data is synthetic.`,
  ];
  return { f, markdown: L.join('\n') };
}

export function driveWorkCard(wo, store, M, opts = {}) {
  const { f, markdown } = workCardMarkdown(wo, store, M, opts);
  const folder = `Nirantar/Work orders/${f.site.city}`;
  return {
    key: 'drive', ...MCP_SERVERS.drive, title: `Drive work card for ${wo.id}`,
    what: `Saves the printable work card as a Markdown file in ${folder}, so the crew can open it on a phone or tablet.`,
    request: toolCall(`nirantar-drive-${wo.id}`, 'create_file', { name: `${wo.id} work card.md`, mime_type: 'text/markdown', parent_folder: folder, content: markdown }),
  };
}

const BUILDERS = { jira: jiraIssue, slack: slackWorkOrder, drive: driveWorkCard };
export const workOrderPreview = (target, wo, store, M, opts) => (BUILDERS[target] ? BUILDERS[target](wo, store, M, opts) : null);

// ---------- the dialog (shared by Work Orders and Shift brief) ----------
let dlg = null;
let back = null;   // { el, sel }: where focus returns when the dialog closes (the page may have re-rendered the button)

function selectorFor(el) {
  if (!el || !el.dataset || !el.dataset.action) return null;
  const q = v => String(v).replace(/["\\]/g, '\\$&');
  return `#main [data-action="${q(el.dataset.action)}"]${el.dataset.target ? `[data-target="${q(el.dataset.target)}"]` : ''}`;
}

function setStatus(d, msg, ok) {
  const s = d.querySelector('.mcp-status');
  if (!s) return;
  s.textContent = msg;
  s.classList.toggle('ok', !!ok);
}

async function copyPayload(d) {
  const pre = d.querySelector('.mcp-json');
  if (!pre) return;
  const text = pre.textContent;
  const done = `Copied the payload (${text.length.toLocaleString('en-IN')} characters).`;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard not available');
    await navigator.clipboard.writeText(text);
    setStatus(d, done, true);
  } catch {
    // fallback: select the text, try the old copy command, otherwise ask for Ctrl+C
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(r);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    setStatus(d, ok ? done : 'Copying is blocked in this browser. The payload is selected: press Ctrl+C (or ⌘C) to copy it.', ok);
  }
}

function ensureDialog() {
  if (dlg && dlg.isConnected) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'mcpDlg';
  dlg.className = 'mcp-dlg';
  dlg.setAttribute('aria-labelledby', 'mcpDlgTitle');
  dlg.setAttribute('aria-describedby', 'mcpDlgWhat');
  dlg.addEventListener('click', ev => {
    const b = ev.target.closest('[data-mcp]');
    if (!b) return;
    if (b.dataset.mcp === 'close') dlg.close();
    else if (b.dataset.mcp === 'copy') copyPayload(dlg);
  });
  // keep the app's keyboard shortcuts (g then m, /, Shift+Space) from acting behind the modal; Esc still closes it
  dlg.addEventListener('keydown', ev => { if (ev.key !== 'Escape') ev.stopPropagation(); });
  dlg.addEventListener('close', () => {
    const sel = window.getSelection();
    if (sel && sel.anchorNode && dlg.contains(sel.anchorNode)) sel.removeAllRanges();
    const r = back; back = null;
    const el = r ? (r.el && r.el.isConnected ? r.el : r.sel ? document.querySelector(r.sel) : null) : null;
    if (el && typeof el.focus === 'function') el.focus();
  });
  window.addEventListener('hashchange', () => { if (dlg && dlg.open) dlg.close(); });   // never leave it over another page
  document.body.appendChild(dlg);
  return dlg;
}

// pv = a preview from the builders above: { title, server, tool, what, request }. opener = the button pressed.
export function openMcpPreview(pv, { opener = null } = {}) {
  const d = ensureDialog();
  const json = JSON.stringify(pv.request, null, 2);
  d.innerHTML = String(html`<div class="d-body">
      <div class="d-head">${icon('plug')}<div class="mcp-h"><span class="eyebrow">MCP preview · not sent</span><h2 id="mcpDlgTitle">${pv.title}</h2></div></div>
      <dl class="mcp-meta">
        <dt>Server</dt><dd><span class="mono">${pv.serverId}</span> (${pv.serverName})</dd>
        <dt>Tool</dt><dd class="mono">${pv.tool}</dd>
      </dl>
      <p class="mcp-what" id="mcpDlgWhat"><b>What this does:</b> ${pv.what}</p>
      <p class="mcp-note">${icon('info')}<span><b>Preview only. The demo sends nothing.</b> In the live Snowflake build these connectors are not wired yet; connecting Jira, Slack and Drive through MCP is the next step (Snowflake-managed MCP server for Nirantar's tools + CoCo <code>cortex mcp add</code> for external servers).</span></p>
      <p class="mcp-pre-head small">The request Nirantar's agent would send (JSON-RPC 2.0, <code>tools/call</code>):</p>
      <pre class="mcp-json" tabindex="0" aria-label="Request payload (JSON)">${json}</pre>
    </div>
    <div class="d-foot">
      <p class="mcp-status small" role="status" aria-live="polite"></p>
      <button type="button" class="btn" data-mcp="close">Close</button>
      <button type="button" class="btn primary" data-mcp="copy" autofocus>${icon('doc')} Copy payload</button>
    </div>`);
  back = { el: opener, sel: selectorFor(opener) };
  if (!d.open) d.showModal();
  d.querySelector('[data-mcp="copy"]')?.focus();
  return d;
}
