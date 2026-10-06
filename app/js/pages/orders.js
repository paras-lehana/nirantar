// Step 5 · Approve: is the repair plan ready? Nirantar drafts the plan (part, source plant, window, technician,
// steps, cost); a named person approves or rejects it, then starts and closes the repair. Every action is audited.
// The plan card can also preview (never send) the MCP requests that would share it to Jira, Slack and Drive.
// autoRerender is off because the decision box has text fields: onStore() repaints on actions, and on clock steps
// only while nobody is typing and the confirm dialog is closed. Typed values live in `ui`, so a repaint keeps them.
import { html, raw, icon, delegate } from '../ui/dom.js';
import { pageHead, caseStrip, headline, doThis, marker, stateChip, aiChip, humanChip, term, confPct, nextBack, heroId } from '../ui/components.js';
import { inr, hours, dateTime, shortDT, time, day, weekday, inHours, HOUR } from '../core/format.js';
import { savePrefs, DOCS } from '../core/store.js';
import { FAILURE_MODES } from '../core/generator.js';
import { workOrderPreview, openMcpPreview, appUrl, MCP_TIP } from '../ui/mcp.js';

let ui = { sel: null, name: null, notes: {}, done: null, ticks: {} };
let live = null;          // { root, ctx } of the last render, for onStore()
let glowTimer = null;

const ACTIVE = ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'];
const COLS = [
  { title: 'Pending approval', statuses: ['DRAFT', 'PENDING_APPROVAL'], empty: 'Nothing is waiting. Nirantar drafts a work order as soon as an alert is raised.' },
  { title: 'Scheduled', statuses: ['APPROVED', 'SCHEDULED'], empty: 'Approved work waits here while the part travels and the window comes up.' },
  { title: 'In progress', statuses: ['IN_PROGRESS'], empty: 'Repairs the crew is doing right now.' },
  { title: 'Done', statuses: ['DONE'], empty: 'Finished repairs; each saving is counted on 7 · OEE.' },
];
const SHIFT = { A: '06:00 to 14:00', B: '14:00 to 22:00', C: '22:00 to 06:00' };
const LOTO_TIP = 'Lock-out tag-out: switch off and lock every energy source (electric, hydraulic, air) and hang a tag with your name, so nobody can start the machine while someone works on it.';
const ALERT_TEXT = { NEW: 'new', ACK: 'acknowledged', SHELVED: 'shelved', ESCALATED: 'escalated', CLOSED: 'closed' };
const lc1 = s => (s ? s[0].toLowerCase() + s.slice(1) : '');
const reasonOf = w => String(w.reason || '').replace(' (low-impact)', ', low impact');   // window reason without nested brackets

export default {
  autoRerender: false,
  onStore(kind, detail) {
    // store.changed(what) arrives as ('change', what); a 15-min clock step is ('change', 'tick'), a second is ('clock').
    const what = kind === 'change' ? detail : kind;
    if (!live || what === 'clock') return;
    const { root, ctx } = live;
    if (!root.isConnected) return;
    const dlg = root.querySelector('dialog[open]');
    if (what === 'tick') {
      const a = document.activeElement;
      if (dlg || (a && root.contains(a) && a.matches('input, textarea, select'))) return;
    } else if (dlg) dlg.close();
    ctx.rerender();
  },

  render(root, ctx) {
    const { store, S, M } = ctx;
    live = { root, ctx };
    const st = store.state, W = store.world;
    const all = st.workOrders.filter(w => w.kind !== 'PM');   // preventive jobs live on the Maintenance calendar
    const nPm = st.workOrders.length - all.length;
    if (ui.name == null) ui.name = store.prefs.name || '';

    // selection: deep link #/orders/<woId> wins, then the last pick, then the most urgent one
    const m = location.hash.match(/^#\/orders\/([^/?#]+)/);
    const fromHash = m ? decodeURIComponent(m[1]) : null;
    if (fromHash && all.some(w => w.id === fromHash)) ui.sel = fromHash;
    if (!all.some(w => w.id === ui.sel)) ui.sel = defaultSel(all, store, M);
    const wo = all.find(w => w.id === ui.sel) || null;
    const showCase = !!(W.scenario.hero || S.openAlerts().length);

    if (!wo) {
      root.innerHTML = String(html`<div class="page orderspage">
        ${pageHead('orders')}
        ${showCase ? caseStrip() : ''}
        ${headline(html`<b>No work orders yet.</b> All machines are running normally, so Nirantar has nothing to repair. As soon as one crosses its alert level, it drafts the repair here (part, window, technician, steps, cost) for you to approve.`, 'ok')}
        <section class="empty" aria-label="No work orders">
          ${icon('orders')}
          <h2>The board fills when a machine starts to fail</h2>
          <p>To see the approval flow, inject a fault on the Presenter page, or load the Pune spindle-bearing scenario: Nirantar raises the alert and drafts a work order within minutes of plant time.</p>
          <div class="row"><button class="btn primary" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load the Pune bearing scenario</button><a class="btn" href="#/presenter">${icon('play')} Open Presenter</a></div>
        </section>
        ${nextBack('orders')}
      </div>`);
      return delegate(root, {});
    }

    const P = planOf(wo, store, M);
    const pending = all.filter(w => w.status === 'PENDING_APPROVAL');
    const fresh = ui.done && ui.done.woId === wo.id && ui.done.fresh;

    root.innerHTML = String(html`<div class="page orderspage">
      ${pageHead('orders')}
      ${showCase ? caseStrip() : ''}
      ${headlineFor(wo, P, pending, store, M)}
      ${doThis(stepsFor(wo, P))}
      ${board(all, wo.id, store, M)}
      ${nPm ? html`<p class="small dim">${icon('calendar')} ${nPm} preventive job${nPm > 1 ? 's are' : ' is'} booked on the <a href="#/schedule">Maintenance calendar</a>; the technician works through ${nPm > 1 ? 'them' : 'it'} in the <a href="#/tech">Technician view</a>.</p>` : ''}
      <div class="wo-grid">
        ${planCard(wo, P, store, M)}
        ${decisionBox(wo, P, store, M)}
      </div>
      ${historyCard(wo, P, store)}
      ${nextBack('orders')}
    </div>`);

    if (fresh) { ui.done.fresh = false; root.querySelector('#woAfter')?.focus({ preventScroll: true }); }

    // printing: only the selected work card (Ctrl+P on this page does the same)
    const beforePrint = () => document.body.classList.add('print-wo');
    const afterPrint = () => document.body.classList.remove('print-wo');
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);

    const off = delegate(root, {
      select: el => {
        ui.sel = el.dataset.id;
        if (ui.done && ui.done.woId !== ui.sel) ui.done = null;
        try { history.replaceState(null, '', '#/orders/' + encodeURIComponent(ui.sel)); } catch { /* file:// or sandbox */ }
        ctx.rerender();
        root.querySelector('#woCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      'f-name': (el, ev) => {
        if (ev.type === 'click') return;
        ui.name = el.value;
        if (el.value.trim()) clearInvalid(root, 'woName', 'woNameErr');
        if (ev.type === 'change' && el.value.trim()) { store.prefs.name = el.value.trim(); savePrefs(); }
      },
      'f-note': (el, ev) => {
        if (ev.type === 'click') return;
        ui.notes[wo.id] = el.value;
        if (el.value.trim()) clearInvalid(root, 'woNote', 'woNoteErr');
      },
      'wo-approve': () => {
        const name = (root.querySelector('#woName')?.value || '').trim();
        const note = (root.querySelector('#woNote')?.value || '').trim();
        if (!name) return flagField(root, 'woName', 'woNameErr', 'Type your name first: every approval is signed and goes into the audit log.');
        store.prefs.name = name; ui.name = name; savePrefs();
        ui.notes[wo.id] = '';
        ui.done = { woId: wo.id, action: 'approved', fresh: true };
        S.approve(wo.id, name, note);
      },
      'wo-reject': () => {
        const name = (root.querySelector('#woName')?.value || '').trim();
        const note = (root.querySelector('#woNote')?.value || '').trim();
        if (!name) return flagField(root, 'woName', 'woNameErr', 'Type your name first: a rejection is signed too.');
        if (!note) return flagField(root, 'woNote', 'woNoteErr', 'Say why you reject the plan (for example "window clashes with the audit visit"), so the planner and Nirantar can learn.');
        store.prefs.name = name; ui.name = name; savePrefs();
        ui.notes[wo.id] = '';
        ui.done = { woId: wo.id, action: 'rejected', fresh: true };
        S.reject(wo.id, name, note);
      },
      'wo-jump': el => { S.jumpTo(+el.dataset.ms); },
      'wo-start': el => {
        if (el.disabled) return;
        ui.done = { woId: wo.id, action: 'started', fresh: true };
        S.startWork(wo.id, store.prefs.name || ui.name || 'You');
      },
      'wo-tick': (el, ev) => {
        if (ev.type !== 'change') return;
        const key = 'step-' + el.dataset.i;
        if (!!(wo.checks && wo.checks[key]) !== el.checked) S.toggleCheck(wo.id, key, store.prefs.name || ui.name || 'You');   // shared with the Technician view
      },
      'wo-done-ask': () => {
        const d = root.querySelector('#woDoneDlg');
        if (!d) return;
        const n = wo.steps.filter((_, i) => ticksOf(wo)[i]).length;
        const out = d.querySelector('#dlgTicks');
        if (out) out.textContent = wo.status !== 'IN_PROGRESS' ? '' : n === wo.steps.length ? `All ${n} steps are ticked.` : `${n} of ${wo.steps.length} steps are ticked. You can still close it; the audit log records who closed it.`;
        d.showModal();
      },
      'wo-cancel': () => root.querySelector('#woDoneDlg')?.close(),
      'wo-complete': () => {
        root.querySelector('#woDoneDlg')?.close();
        ui.done = { woId: wo.id, action: 'done', fresh: true };
        const who = store.prefs.name || ui.name || 'You';
        if (wo.status !== 'IN_PROGRESS') S.startWork(wo.id, who);
        S.complete(wo.id, who);
      },
      'wo-print': () => { document.body.classList.add('print-wo'); window.print(); },
      // MCP preview: show the request for this work order (nothing is sent) and log that a person looked at it
      mcp: el => {
        const cur = planOf(wo, store, M);   // same "if you approve now" window and arrival as the plan card shows
        const pv = workOrderPreview(el.dataset.target, wo, store, M, { plan: { win: cur.win, eta: cur.eta, ready: cur.ready }, appUrl: appUrl() });
        if (!pv) return;
        openMcpPreview(pv, { opener: el });
        S.audit(store.prefs.name || 'You', `Previewed an MCP ${pv.noun} (not sent)`, wo.assetId, wo.id, 'human');
        S.changed('mcp');
      },
    }, ['click', 'input', 'change']);

    return () => {
      off();
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      document.body.classList.remove('print-wo');
    };
  },
};

// ---------- data helpers ----------
// Step ticks are stored on the work order (wo.checks), so the Technician view and this page show the same progress.
const ticksOf = wo => wo.steps.map((_, i) => !!(wo.checks && wo.checks['step-' + i]));
// Urgency for ordering: repairs before sensor checks, then money at stake.
const rankOf = (w, M) => (w.kind === 'REPAIR' ? 1e12 : 0) + M.exposure(M.assetById(w.assetId), w.mode).inr;
function defaultSel(all, store, M) {
  const hero = heroId();
  const pend = all.filter(w => w.status === 'PENDING_APPROVAL').sort((x, y) => rankOf(y, M) - rankOf(x, M));
  const open = all.filter(w => ACTIVE.includes(w.status));
  return (pend.find(w => w.assetId === hero) || pend[0] || open.find(w => w.assetId === hero) || open[0] || all[0] || {}).id || null;
}

// The plan as it stands now: before approval the arrival and window are recomputed from "if you approve now"
// (same rule as store.approve), after approval they are the booked ones.
function planOf(wo, store, M) {
  const a = M.assetById(wo.assetId);
  const ass = M.assess(a, store.t);
  const now = store.state.simNow;
  const moving = !!(wo.part && wo.part.kind !== 'local');
  let eta, win;
  if (wo.status === 'PENDING_APPROVAL' || !wo.window) {
    eta = now + (moving ? wo.part.etaH * HOUR : 0);
    const dur = wo.kind === 'INSPECT' ? 1 : Math.max(4, Math.ceil((FAILURE_MODES[wo.mode]?.repairH || 2) + 2));
    win = wo.kind === 'INSPECT' ? { start: now + 2 * HOUR, end: now + 3 * HOUR, reason: 'no production stop needed', beforeFailure: true }
      : M.planWindow(eta + HOUR, ass.failAt, dur);
  } else { eta = wo.eta; win = wo.window; }
  const failAt = wo.kind === 'INSPECT' || ass.rulKind !== 'trend' || wo.status === 'DONE' ? null : ass.failAt;
  const ready = !moving || !!wo.partArrived || (wo.eta != null && wo.status !== 'PENDING_APPROVAL' && now >= wo.eta);
  const site = M.siteById(a.siteId);
  return { a, ass, now, eta, win, failAt, marginH: failAt ? (failAt - win.end) / HOUR : null, ready, moving, site, line: M.lineById(a.lineId),
    from: moving && wo.part.from !== 'Supplier' ? M.siteById(wo.part.from) : null, clash: techClash(wo, win, store.state.workOrders) };
}

function techClash(wo, win, all) {
  if (!wo.technician) return null;
  return all.find(o => o.id !== wo.id && o.technician && o.technician.id === wo.technician.id && ACTIVE.includes(o.status)
    && o.window && o.window.start < win.end && o.window.end > win.start) || null;
}

const fmtWin = w => {
  const same = day(w.start) === day(w.end);
  return same ? `${weekday(w.start)} ${day(w.start)}, ${time(w.start)} to ${time(w.end)} IST` : `${dateTime(w.start)} to ${dateTime(w.end)}`;
};
const lastApproval = wo => wo.approvals[wo.approvals.length - 1];
const actorOf = (store, wo, actions) => (store.state.audit.find(r => actions.includes(r.action) && String(r.detail).startsWith(wo.id)) || {}).actor;

function statusChip(wo, P) {
  switch (wo.status) {
    case 'PENDING_APPROVAL': case 'DRAFT': return stateChip('act', 'Needs your approval');
    case 'APPROVED': case 'SCHEDULED': return html`${stateChip('ok', 'Approved')}${P && P.moving && !P.ready ? html`<span class="state normal">${icon('truck')}Part on the way</span>` : ''}`;
    case 'IN_PROGRESS': return html`<span class="state normal">${icon('wrench')}In progress</span>`;
    case 'DONE': return stateChip('ok', 'Done');
    case 'REJECTED': return html`<span class="state normal">${icon('x')}Rejected</span>`;
    default: return html`<span class="state normal">${wo.status}</span>`;
  }
}

// ---------- headline + do this ----------
function headlineFor(wo, P, pending, store, M) {
  const { a } = P;
  const tech = wo.technician ? wo.technician.name : 'a technician';
  const others = pending.filter(w => w.id !== wo.id).length;
  const otherNote = others ? html` <b>${others} other work order${others > 1 ? 's' : ''}</b> also ${others > 1 ? 'wait' : 'waits'} for approval on the board below.` : '';
  const part = wo.part ? lc1(wo.part.name) : 'part';
  const techFree = P.clash ? html`<b>${tech}</b> is already booked on ${P.clash.id} at that time (pick another window)` : html`<b>${tech}</b> is free in the proposed window`;
  switch (wo.status) {
    case 'PENDING_APPROVAL': {
      if (wo.kind === 'INSPECT') {
        const sensor = P.ass.sensorFault ? lc1(P.ass.sensorFault.label) : 'vibration';
        return headline(html`Nirantar thinks the <b>${sensor} sensor on ${a.id}</b> is faulty, not the machine. It proposes a <b>sensor check</b> by <b>${tech}</b> on ${fmtWin(P.win)}: no repair crew, no production stop, as ${wo.sop} says. It needs your approval.${otherNote}`, 'act');
      }
      const where = !wo.part ? html`no part is needed`
        : wo.part.kind === 'transfer' ? html`the <b>${part}</b> (none in stock in ${P.site.city}) moves from <b>${P.from ? P.from.city : wo.part.from}</b> in <b>${wo.part.etaH} h</b>`
        : wo.part.kind === 'purchase' ? html`the <b>${part}</b> is not in stock at any plant and must be bought (supplier lead time <b>${hours(wo.part.etaH)}</b>)`
        : html`the <b>${part}</b> is in stock in ${P.site.city}`;
      const late = P.win.beforeFailure ? '' : html` <b>Careful:</b> the earliest window is after the predicted failure, so expedite the part.`;
      return headline(html`The AI has prepared everything for the repair: ${where}, ${techFree}, and the steps follow <b>${wo.sop}</b>. It needs your approval.${late}${otherNote}`, 'act');
    }
    case 'APPROVED': case 'SCHEDULED': {
      const ap = lastApproval(wo);
      const partBit = !P.moving ? html`The part is in stock` : P.ready ? html`The ${part} <b>has arrived</b> in ${P.site.city}` : html`The ${part} arrives in ${P.site.city} <b>${dateTime(P.eta)}</b> (${inHours(P.eta, P.now)})`;
      const margin = P.failAt && P.marginH > 0 ? html`, about <b>${hours(P.marginH)}</b> before the predicted failure` : '';
      return headline(html`Approved by <b>${ap ? ap.by : 'a person'}</b> at ${shortDT(ap ? ap.at : P.now)}. ${partBit}; <b>${tech}</b> ${wo.kind === 'INSPECT' ? 'checks the sensor' : 'repairs ' + a.id} on <b>${fmtWin(P.win)}</b>${margin}. ${P.ready ? 'Press Start repair when the crew begins.' : 'Nothing else is needed until the part arrives.'}${otherNote}`, 'ok');
    }
    case 'IN_PROGRESS':
      return headline(html`The ${wo.kind === 'INSPECT' ? 'sensor check' : 'repair'} of <b>${a.id}</b> is in progress (started ${shortDT(wo.startedAt || P.now)}). Tick the steps as the crew finishes them, then mark it done after the test run.${otherNote}`, 'ok');
    case 'DONE': {
      const sv = (store.state.savings || []).find(s => s.woId === wo.id);
      return headline(wo.kind === 'INSPECT'
        ? html`<b>${a.id}</b>: the sensor was checked and its readings are live again. No repair crew was sent, and the alert is closed.${otherNote}`
        : html`<b>${a.id}</b> was repaired ${shortDT(wo.doneAt || P.now)}: the alert is closed and about <b>${inr(sv ? sv.avoidedInr : 0)}</b> of unplanned downtime was avoided. The saving is counted on 7 · OEE.${otherNote}`, 'ok');
    }
    case 'REJECTED': {
      const ap = lastApproval(wo);
      return headline(html`${wo.id} was rejected by <b>${ap ? ap.by : 'a person'}</b>${ap && ap.comment ? html`: “${ap.comment}”` : ''}. Nirantar keeps watching ${a.id} and alerts again if the risk rises.${otherNote}`, 'watch');
    }
    default: return headline(html`${wo.id} is ${lc1(wo.status)}.`);
  }
}

function stepsFor(wo, P) {
  switch (wo.status) {
    case 'PENDING_APPROVAL': return [
      html`Check the plan ${marker(1)}: the part and where it comes from, the window, the technician, the steps and the cost.`,
      html`Type your name and press <b>Approve</b> ${marker(2)}, or <b>Reject</b> with a reason. Nothing moves until you do.`];
    case 'APPROVED': case 'SCHEDULED': return [
      html`Follow the part and the window ${marker(2)}. ${P.ready ? 'The part is ready.' : html`The part is on the road; use <b>Skip ahead</b> to jump the plant clock (demo).`}`,
      html`Press <b>Start repair</b> ${marker(2)} when the crew begins; the plan ${marker(1)} turns into a checklist.`];
    case 'IN_PROGRESS': return [
      html`Tick the steps in the plan ${marker(1)} as the crew finishes them.`,
      html`Press <b>Mark repair done</b> ${marker(2)} after the test run passes.`];
    case 'DONE': return [
      html`Read what changed ${marker(2)}: the machine is back to normal and the saving is counted.`,
      html`Ask the copilot why it failed: <a href="#/copilot">6 · Ask Copilot</a>.`];
    default: return [html`Read why it was rejected ${marker(2)}.`, html`Pick another work order on the board, or go back to <a href="#/triage">3 · Alert Triage</a>.`];
  }
}

// ---------- board ----------
function board(all, selId, store, M) {
  const rejected = all.filter(w => w.status === 'REJECTED');
  return html`<section class="card wo-board-card" aria-label="Work order board">
    <div class="card-head"><h2>All work orders</h2><span class="sub">Tap a card to open its plan. Left to right: waiting for a person, approved, being repaired, done.</span></div>
    <div class="wo-board">${COLS.map(c => {
      const items = all.filter(w => c.statuses.includes(w.status))
        .sort((x, y) => (c.title === 'Pending approval' ? rankOf(y, M) - rankOf(x, M) : 0) || y.createdAt - x.createdAt);
      return html`<section class="wo-col ${items.length ? '' : 'empty-col'}" aria-label="${c.title}">
        <h3>${c.title} <span class="count">${items.length}</span></h3>
        ${items.length ? items.map(w => woCard(w, selId, store, M)) : html`<p class="xs dim">${c.empty}</p>`}
      </section>`;
    })}</div>
    ${rejected.length ? html`<details class="wo-rejected"><summary>Rejected (${rejected.length})</summary><div class="wo-rej-list">${rejected.map(w => woCard(w, selId, store, M))}</div></details>` : ''}
  </section>`;
}

function woCard(w, selId, store, M) {
  const P = planOf(w, store, M);
  const a = P.a;
  const pend = w.status === 'PENDING_APPROVAL';
  let partLine = 'No part needed';
  if (w.part) {
    if (pend) partLine = w.part.kind === 'transfer' ? `Part from ${P.from ? P.from.city : w.part.from}: ${w.part.etaH} h after approval` : w.part.kind === 'purchase' ? `Part must be bought: ${hours(w.part.etaH)}` : `Part in stock at ${P.site.city}`;
    else if (w.status === 'REJECTED') partLine = 'Nothing released';
    else partLine = !P.moving ? `Part from the ${P.site.city} store` : P.ready ? `Part arrived in ${P.site.city}` : `Part arrives ${shortDT(P.eta)}`;
  }
  const winLine = w.status === 'REJECTED' ? 'No window booked' : w.status === 'DONE' ? `Done ${shortDT(w.doneAt || P.now)}` : `${pend ? 'Proposed window' : 'Window'} ${shortDT(P.win.start)}`;
  const cls = pend ? 's-pending' : w.status === 'REJECTED' ? 's-rejected' : 's-approved';
  return html`<button type="button" class="wo-card ${cls}" data-action="select" data-id="${w.id}" aria-pressed="${w.id === selId}">
    <span class="wo-top"><b class="mono">${w.id}</b>${statusChip(w, P)}</span>
    <span class="wo-title">${w.kind === 'INSPECT' ? 'Sensor check' : FAILURE_MODES[w.mode]?.name || 'Repair'} on ${a.id}</span>
    <span class="wo-meta">${a.name} · ${P.line.short}, ${P.site.city}</span>
    <span>${aiChip(`Drafted by Nirantar at ${shortDT(w.createdAt)}`)}</span>
    <span class="wo-line">${icon('truck')}${partLine}</span>
    <span class="wo-line">${icon('clock')}${winLine}</span>
  </button>`;
}

// ---------- the plan (also the printable work card) ----------
function lotoText(s) {
  const parts = String(s).split('LOTO');
  return html`${parts.map((p, i) => (i ? html`${term('LOTO', LOTO_TIP)}${p}` : p))}`;
}

function planCard(wo, P, store, M) {
  const W = store.world, a = P.a;
  const fm = FAILURE_MODES[wo.mode];
  const sopDoc = DOCS.find(d => d.id === wo.sop);
  const ex = wo.kind === 'REPAIR' ? M.exposure(a, wo.mode) : null;
  const al = store.state.alerts.find(x => x.id === wo.alertId);
  const inProg = wo.status === 'IN_PROGRESS';
  const pend = wo.status === 'PENDING_APPROVAL';
  const ticks = ticksOf(wo);
  const nTicked = wo.steps.filter((_, i) => ticks[i]).length;
  const tone = pend ? 'ai' : wo.status === 'REJECTED' ? '' : 'ok';
  const ap = lastApproval(wo);
  const title = wo.kind === 'INSPECT' ? `Sensor check on ${a.id}` : `${fm ? fm.name : 'Repair'} on ${a.id}`;

  // where from: stock of this part at every plant, chosen source first
  let whereFrom = html`No part is needed.`;
  if (wo.part) {
    const part = W.parts.find(p => p.id === wo.part.id);
    const stockAt = s => (part ? part.stock[s.id] || 0 : 0);
    const order = [...W.sites].sort((x, y) => (y.id === wo.part.from) - (x.id === wo.part.from) || (y.id === a.siteId) - (x.id === a.siteId));
    const list = html`${order.map((s, i) => html`${i ? '; ' : ''}<b>${s.name}</b> has ${stockAt(s)}`)}`;
    if (wo.part.kind === 'local') whereFrom = html`In stock at <b>${P.site.name}</b> (${stockAt(P.site)} on the shelf), so no transfer is needed. ${pend ? 'The storeroom issues it on the day.' : ''}`;
    else if (wo.part.kind === 'transfer' && pend) whereFrom = html`${list}. Nirantar picked <b>${P.from.city}</b>: the fastest road transfer from a plant that has one (<b>${wo.part.etaH} h</b>). <a class="no-print" href="#/spares">See all stock</a>`;
    else if (wo.part.kind === 'transfer') whereFrom = html`One unit is ${P.ready ? 'already in' : 'on the road to'} ${P.site.city} from <b>${P.from.name}</b> (${wo.part.etaH} h by road); ${P.from.city} has ${stockAt(P.from)} left. <a class="no-print" href="#/spares">See all stock</a>`;
    else whereFrom = html`No plant has one (${list}). It must be bought: supplier lead time <b>${part ? part.leadDays : Math.round(wo.part.etaH / 24)} days</b>.`;
  }

  // when
  let when;
  const marginTxt = P.failAt ? (P.marginH > 0 ? html`, about <b>${hours(P.marginH)}</b> before the predicted failure` : html`, <b>after</b> the predicted failure`) : '';
  if (wo.kind === 'INSPECT') when = html`A one-hour check on <b>${fmtWin(P.win)}</b>. The machine keeps running: no production stop.`;
  else if (pend) when = P.moving
    ? html`If you approve now, the part arrives <b>${dateTime(P.eta)}</b> and the repair is planned for <b>${fmtWin(P.win)}</b> (${reasonOf(P.win)})${marginTxt}.`
    : html`The part is ready, so if you approve now the repair is planned for <b>${fmtWin(P.win)}</b> (${reasonOf(P.win)})${marginTxt}.`;
  else if (wo.status === 'REJECTED') when = html`No window booked (rejected).`;
  else when = html`Window <b>${fmtWin(P.win)}</b> (${reasonOf(P.win)}). ${P.moving ? html`Part ${P.ready ? 'arrived' : 'arrives'} <b>${dateTime(P.eta)}</b>.` : 'Part from local stock.'}${P.failAt ? html` Predicted failure about <b>${dateTime(P.failAt)}</b>, so the repair ${P.marginH > 0 ? html`ends <b>${hours(P.marginH)}</b> before it` : 'comes too late: expedite'}.` : ''}`;

  const t = wo.technician;
  const who = t ? html`<b>${t.name}</b> (${t.id}), ${/\s/.test(t.why) ? t.why : t.why + ' specialist'}. Usual shift ${t.shift} (${SHIFT[t.shift] || ''} IST). ${P.clash ? html`<span class="state watch">${icon('info')}Booked on ${P.clash.id} at that time</span>` : 'Free in the window: no other work order is booked for this person.'}` : html`No technician found at ${P.site.city}.`;

  const c = wo.costs || { parts: 0, labour: 0, total: 0 };
  const confMean = wo.kind === 'INSPECT' ? 'High: a reading that stays flat while related sensors move is a classic sensor fault (SOP-50).'
    : wo.confidence >= 0.9 ? 'High: the part can be in place and the repair finished before the predicted failure.'
    : 'Lower: the part has to be bought, or the window falls after the predicted failure. Consider expediting.';

  return html`<section class="card wo-detail ${tone}" id="woCard" aria-label="Work card ${wo.id}">
    <p class="print-only print-head"><b>Nirantar work card</b> · printed ${dateTime(store.state.simNow)} · synthetic demo data</p>
    <div class="card-head">${marker(1)}<h2><span class="mono">${wo.id}</span> · ${title}</h2>
      <div class="right no-print"><button type="button" class="btn sm" data-action="wo-print">${icon('print')} Print work card</button></div></div>
    <p class="wo-sub">${statusChip(wo, P)}${aiChip(`Drafted by Nirantar at ${shortDT(wo.createdAt)}`)}<span>${a.name} · ${P.line.name}, ${P.site.name} · criticality ${a.criticality}</span></p>
    <ul class="plan">
      <li><span class="pi">${icon('box')}</span><div><h3>Part</h3><p>${wo.part ? html`<b>${wo.part.name}</b> × ${wo.part.qty || 1} <span class="dim mono xs">${wo.part.id}</span>` : 'None'}</p></div></li>
      <li><span class="pi">${icon('truck')}</span><div><h3>Where from</h3><p>${whereFrom}</p></div></li>
      <li><span class="pi">${icon('clock')}</span><div><h3>When</h3><p>${when}</p>${pend && !P.win.beforeFailure ? html`<p class="why"><b>Why it matters:</b> even the earliest low-impact window is after the predicted failure. Expedite the part or run ${a.id} at reduced load until it arrives.</p>` : ''}</div></li>
      <li><span class="pi">${icon('user')}</span><div><h3>Who</h3><p>${who}</p></div></li>
      <li><span class="pi">${icon('orders')}</span><div><h3>Steps</h3>
        <ol class="wo-steps">${wo.steps.map((s, i) => html`<li>${inProg ? html`<label class="check"><input type="checkbox" data-action="wo-tick" data-i="${i}" ${ticks[i] ? raw('checked') : ''}><span>${lotoText(s)}</span></label>` : lotoText(s)}</li>`)}</ol>
        <p class="small dim">From ${sopDoc ? sopDoc.title : wo.sop}.${inProg ? html` <span id="tickCount" aria-live="polite">${nTicked} of ${wo.steps.length} steps ticked.</span>` : ''}</p></div></li>
      <li><span class="pi">${icon('rupee')}</span><div><h3>Cost</h3>
        <div class="cost"><span>Parts</span><b>${inr(c.parts)}</b><span>Labour</span><b>${inr(c.labour)}</b><span class="cost-rule" aria-hidden="true"></span><span class="tot">Total</span><b class="tot">${inr(c.total)}</b></div>
        <p class="small dim">${wo.kind === 'INSPECT' ? 'Labour: one instrumentation technician for about an hour; a new sensor only if the check fails.' : 'Labour: 2 technicians at the shutdown rate.'}${ex ? html` If ${a.id} breaks down instead, about <b>${inr(ex.inr)}</b> of production is lost (${hours(ex.downH)} stopped).` : ''}</p></div></li>
      <li><span class="pi">${icon('ai')}</span><div><h3>${term('Plan confidence', 'How sure Nirantar is that this plan works: the part arrives and the repair is done before the predicted failure. It is not the failure confidence of the machine.')}</h3><p><b class="mono">${confPct(wo.confidence)}</b> · ${confMean}</p></div></li>
      <li class="no-print"><span class="pi">${icon('alert')}</span><div><h3>Linked</h3><p class="row">
        ${al ? html`<a class="btn sm" href="#/triage">Alert ${al.id} (${ALERT_TEXT[al.status] || al.status})</a>` : ''}
        <a class="btn sm" href="#/machine/${a.id}">${icon('machine')} ${a.id} machine detail</a>
        ${wo.kind === 'REPAIR' ? html`<a class="btn sm" href="#/whatif/${a.id}">${icon('decide')} What if we wait?</a>` : ''}</p></div></li>
      ${shareRow(wo)}
    </ul>
    <div class="print-only sign">
      <p>Approved by: <b>${ap && ap.action === 'Approved' ? `${ap.by}, ${dateTime(ap.at)}` : '______________________'}</b></p>
      <p>Technician: ______________________ Start: ________ End: ________</p>
      <p>Test run passed (vibration back in zone A or B): ☐ yes ☐ no · Released to production by: ______________________</p>
    </div>
  </section>`;
}

// Share the plan with other tools: previews of the MCP requests Nirantar's agent would send (js/ui/mcp.js).
// Only while the plan is live (waiting for approval or approved); never printed.
function shareRow(wo) {
  if (!['PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(wo.status)) return '';
  const btn = (target, label) => html`<button type="button" class="btn sm" data-action="mcp" data-target="${target}" aria-haspopup="dialog">${icon('plug')} ${label}</button>`;
  return html`<li class="no-print wo-share"><span class="pi">${icon('plug')}</span><div>
    <h3 id="woShareH">Share across tools (${term('MCP', MCP_TIP)} preview)</h3>
    <p class="row" role="group" aria-labelledby="woShareH">${btn('jira', 'Jira issue')}${btn('slack', 'Slack message')}${btn('drive', 'Drive work card')}</p>
    <p class="xs dim">See the exact request Nirantar's agent would send to each tool. Nothing is sent.</p></div></li>`;
}

// ---------- decision / progress box ----------
function decisionBox(wo, P, store, M) {
  const a = P.a;
  const tech = wo.technician ? wo.technician.name : 'The technician';
  const al = store.state.alerts.find(x => x.id === wo.alertId);
  const part = wo.part ? lc1(wo.part.name) : '';
  const done = ui.done && ui.done.woId === wo.id ? ui.done.action : null;

  if (wo.status === 'PENDING_APPROVAL') {
    const note = ui.notes[wo.id] || '';
    const pol = DOCS.find(d => d.id === 'POL-G8');
    return html`<section class="card approve-box sticky" id="approveBox" aria-label="Your decision">
      <div class="card-head">${marker(2)}<h2>${wo.kind === 'INSPECT' ? 'Approve the sensor check?' : 'Approve this repair?'}</h2>${humanChip('Your decision')}</div>
      <p>Nothing is released until a person approves; your name and time go into the audit log.</p>
      <div class="effects"><p class="small"><b>If you approve:</b></p><ul class="ticks small">
        ${wo.part && wo.part.kind === 'transfer' ? html`<li>The ${part} leaves ${P.from.city} now and reaches ${P.site.city} ${dateTime(P.eta)}.</li>` : ''}
        ${wo.part && wo.part.kind === 'purchase' ? html`<li>A purchase of the ${part} is released (${hours(wo.part.etaH)}).</li>` : ''}
        ${wo.part && wo.part.kind === 'local' && wo.kind !== 'INSPECT' ? html`<li>The ${P.site.city} storeroom reserves the ${part}.</li>` : ''}
        <li>${tech} is booked for ${fmtWin(P.win)}.</li>
        ${al && al.status === 'NEW' ? html`<li>Alert ${al.id} is acknowledged in your name.</li>` : ''}
      </ul></div>
      <div class="field"><label for="woName">Your name <span class="dim">(required)</span></label>
        <input id="woName" class="input" type="text" autocomplete="name" placeholder="e.g. Asha Deshpande, maintenance head" value="${ui.name || ''}" data-action="f-name" aria-describedby="woNameErr">
        <p class="field-err" id="woNameErr" hidden></p></div>
      <div class="field"><label for="woNote">Comment <span class="dim">(optional to approve, required to reject)</span></label>
        <textarea id="woNote" class="input" rows="2" placeholder="e.g. OK, keep the Maratha Motors batch on VMC-203" data-action="f-note" aria-describedby="woNoteErr">${note}</textarea>
        <p class="field-err" id="woNoteErr" hidden></p></div>
      <div class="row decide-btns">
        <button type="button" class="btn approve lg" data-action="wo-approve">${icon('check')} Approve</button>
        <button type="button" class="btn danger" data-action="wo-reject">${icon('x')} Reject</button>
      </div>
      <p class="xs dim">${term('Policy G8', pol ? pol.text : 'Only a named person may approve.')}: the AI drafts, checks spares and proposes windows; only a named person approves, releases or closes a work order.</p>
    </section>`;
  }

  if (wo.status === 'REJECTED') {
    const ap = lastApproval(wo);
    return html`<section class="card approve-box" id="approveBox" aria-label="Decision">
      <div class="card-head">${marker(2)}<h2>Rejected</h2>${humanChip(`Decided by ${ap ? ap.by : 'a person'}`)}</div>
      <p><b>Reason:</b> ${ap && ap.comment ? ap.comment : 'none given'}</p>
      <p class="small">Nothing was released: no transfer, no booking. Nirantar keeps scoring ${a.id} every 15 minutes; if the risk rises it raises a new alert and drafts a new plan.</p>
      <div class="row"><a class="btn" href="#/triage">${icon('alert')} 3 · Alert Triage</a><a class="btn ghost" href="#/whatif/${a.id}">${icon('decide')} What if we wait?</a></div>
    </section>`;
  }

  const ap = wo.approvals.find(x => x.action === 'Approved') || lastApproval(wo);
  const tl = timeline(wo, P, ap);

  if (wo.status === 'DONE') {
    const sv = (store.state.savings || []).find(s => s.woId === wo.id);
    const by = actorOf(store, wo, ['Completed the repair', 'Replaced the sensor']) || 'a person';
    return html`<section class="card ok approve-box" id="approveBox" aria-label="Result">
      <div class="card-head">${marker(2)}<h2>${wo.kind === 'INSPECT' ? 'Sensor check done' : 'Repair done'}</h2>${stateChip('ok', `Closed by ${by}`)}</div>
      <div class="after" id="woAfter" tabindex="-1" role="status">
        <p><b>${a.id} is back to normal.</b> ${wo.kind === 'INSPECT' ? 'The sensor readings are live again and the sensor alert is closed. No repair crew was needed.' : html`Its health has returned to normal, the alert is closed and about <b>${inr(sv ? sv.avoidedInr : 0)}</b> of unplanned downtime was avoided${sv && sv.hoursSaved ? html` (${hours(sv.hoursSaved)} of lost production)` : ''}. The saving is counted on 7 · OEE.`}</p>
        <div class="row"><a class="btn primary" href="#/copilot">${icon('chat')} 6 · Ask Copilot why it failed</a><a class="btn" href="#/oee">${icon('gauge')} 7 · See the saving on OEE</a></div>
      </div>
      ${tl}
    </section>`;
  }

  if (wo.status === 'IN_PROGRESS') {
    const by = actorOf(store, wo, ['Started the repair']) || 'a person';
    const sv = wo.kind === 'REPAIR' ? M.exposure(a, wo.mode) : null;
    return html`<section class="card ok approve-box" id="approveBox" aria-label="Repair in progress">
      <div class="card-head">${marker(2)}<h2>${wo.kind === 'INSPECT' ? 'Sensor check in progress' : 'Repair in progress'}</h2>${humanChip(`Started by ${by}`)}</div>
      ${done === 'started' ? html`<div class="after" id="woAfter" tabindex="-1" role="status"><p><b>Started and logged.</b> The plan ${marker(1)} is now a checklist: tick each step as it is done. When the test run passes, mark the repair done.</p></div>` : html`<p>Started ${shortDT(wo.startedAt || P.now)}. Tick the steps in the plan ${marker(1)} as the crew finishes them.</p>`}
      ${tl}
      <button type="button" class="btn approve lg" data-action="wo-done-ask">${icon('check')} Mark repair done</button>
      ${doneDialog(wo, P, store, sv, false)}
    </section>`;
  }

  // APPROVED / SCHEDULED
  return html`<section class="card ok approve-box" id="approveBox" aria-label="Part and window">
    <div class="card-head">${marker(2)}<h2>Approved: ${P.moving ? 'part and window' : 'window booked'}</h2>${humanChip(`Approved by ${ap ? ap.by : 'a person'}`)}</div>
    ${done === 'approved' && !P.ready ? html`<div class="after" id="woAfter" tabindex="-1" role="status">
      <p><b>Approved and logged.</b> What happens next:</p>
      <ol class="small">
        ${P.moving ? html`<li>The ${part} left ${P.from ? P.from.city : 'the supplier'} and reaches ${P.site.city} <b>${dateTime(P.eta)}</b>.</li>` : html`<li>The ${P.site.city} storeroom issues the ${part || 'part'}.</li>`}
        <li>${tech} is booked for <b>${fmtWin(P.win)}</b>.</li>
        <li>Nirantar keeps scoring ${a.id} every 15 minutes and warns you if it wears faster than predicted.</li>
      </ol>
      <a class="btn primary" href="#/copilot">${icon('chat')} Next: 6 · Ask Copilot why it is failing ${icon('arrowR')}</a>
    </div>` : ''}
    ${tl}
    ${P.ready ? html`<p class="small">${P.moving ? 'The part is here.' : 'The part is in stock.'} Start the repair in the window, or earlier if the line allows it.</p>`
      : html`<p class="small">The repair can start once the part arrives (${inHours(P.eta, P.now)}). In this demo you can jump the plant clock instead of waiting:</p>
        <button type="button" class="btn" data-action="wo-jump" data-ms="${P.eta}">${icon('forward')} Skip ahead to the part arrival (demo)</button>`}
    <div class="row"><button type="button" class="btn approve lg" data-action="wo-start" ${P.ready ? '' : raw('disabled aria-describedby="startHint"')}>${icon('wrench')} Start repair</button>
      ${P.ready ? html`<button type="button" class="btn" data-action="wo-done-ask">${icon('check')} Mark repair done</button>` : html`<span class="xs dim" id="startHint">Available when the part has arrived.</span>`}</div>
    ${P.ready ? doneDialog(wo, P, store, wo.kind === 'REPAIR' ? M.exposure(a, wo.mode) : null, true) : ''}
  </section>`;
}

// Confirm before closing: says exactly what changes. `direct` = closing straight from Scheduled (start + finish now).
function doneDialog(wo, P, store, sv, direct) {
  const a = P.a;
  return html`<dialog id="woDoneDlg" class="wo-dialog" aria-labelledby="woDoneTitle">
    <div class="d-body">
      <div class="d-head">${icon('check')}<h2 id="woDoneTitle">Mark ${wo.id} done?</h2></div>
      <p>Only confirm when the work is finished and the test run has passed.${direct ? ' This records the repair as started and finished now.' : ''} What happens next:</p>
      <ul class="ticks">${wo.kind === 'INSPECT' ? html`<li>The ${a.id} sensor readings go live again and it returns to normal.</li><li>The sensor alert closes. No repair crew was needed.</li>`
        : html`<li><b>${a.id}'s health returns to normal</b>: the readings drop back to their usual level.</li><li>The alert closes${store.world.scenario.consequence && store.world.scenario.consequence.from === a.id ? ', together with the alarms it caused downstream' : ''}.</li><li>The saving (about <b>${inr(sv ? sv.inr : 0)}</b> of unplanned downtime avoided) is counted on 7 · OEE.</li>`}</ul>
      <p class="small" id="dlgTicks"></p>
      <p class="small dim">Logged as ${store.prefs.name || ui.name || 'You'} at ${dateTime(P.now)}.</p>
    </div>
    <div class="d-foot"><button type="button" class="btn ghost" data-action="wo-cancel">Not yet</button><button type="button" class="btn approve" data-action="wo-complete">${icon('check')} Yes, the repair is done</button></div>
  </dialog>`;
}

// Transfer + schedule: a proportional strip (visual) and the same facts as a list (readable, screen-reader friendly).
function timeline(wo, P, ap) {
  const t0 = ap ? ap.at : P.now;
  const ends = [P.win.end, P.eta || t0, P.now];
  if (P.failAt) ends.push(P.failAt);
  const t1 = Math.max(...ends) + 4 * HOUR;
  const pc = x => Math.max(0, Math.min(100, (x - t0) / (t1 - t0) * 100)).toFixed(1) + '%';
  const done = wo.status === 'DONE', prog = wo.status === 'IN_PROGRESS';
  const strip = html`<div class="tstrip" aria-hidden="true">
    <span class="track"></span>
    ${P.moving ? html`<span class="seg-transit" style="left:0;width:${pc(P.eta)}"></span>` : ''}
    <span class="seg-win" style="left:${pc(P.win.start)};width:${pc(t0 + (P.win.end - P.win.start))}"></span>
    ${P.failAt ? html`<span class="pin fail" style="left:${pc(P.failAt)}"></span>` : ''}
    <span class="pin now" style="left:${pc(P.now)}"></span>
  </div>
  <div class="tlegend" aria-hidden="true"><span><i class="sw-now"></i>Now</span>${P.moving ? html`<span><i class="sw-transit"></i>Part on the road</span>` : ''}<span><i class="sw-win"></i>Repair window</span>${P.failAt ? html`<span><i class="sw-fail"></i>Predicted failure</span>` : ''}</div>`;
  const items = [];
  items.push(html`<li class="done"><span class="tl-ic">${icon('check')}</span><span><b>Approved</b> by ${ap ? ap.by : 'a person'}${ap && ap.comment ? html`: “${ap.comment}”` : ''}</span><span class="tl-t">${shortDT(t0)}</span></li>`);
  if (P.moving) {
    items.push(html`<li class="done"><span class="tl-ic">${icon('truck')}</span><span><b>Part left ${P.from ? P.from.city : 'the supplier'}</b> by road (${wo.part.etaH} h)</span><span class="tl-t">${shortDT(t0)}</span></li>`);
    items.push(html`<li class="${P.ready ? 'done' : 'next'}"><span class="tl-ic">${icon('box')}</span><span><b>${P.ready ? 'Part arrived' : 'Part arrives'}</b> at ${P.site.name}</span><span class="tl-t">${shortDT(P.eta)}${P.ready ? '' : ' · ' + inHours(P.eta, P.now)}</span></li>`);
  } else items.push(html`<li class="done"><span class="tl-ic">${icon('box')}</span><span><b>Part ready</b> in the ${P.site.city} storeroom</span><span class="tl-t">${shortDT(t0)}</span></li>`);
  items.push(html`<li class="${done ? 'done' : prog || P.ready ? 'next' : ''}"><span class="tl-ic">${icon('wrench')}</span><span><b>${done ? 'Repaired' : prog ? 'Repair under way' : 'Repair window'}</b> · ${wo.technician ? wo.technician.name : ''}${done ? '' : ' · ' + reasonOf(P.win)}</span><span class="tl-t">${done ? shortDT(wo.doneAt) : fmtWin(P.win)}</span></li>`);
  if (P.failAt) items.push(html`<li class="fail"><span class="tl-ic">${icon('flag')}</span><span><b>Predicted failure</b> if nothing were done</span><span class="tl-t">about ${shortDT(P.failAt)}</span></li>`);
  return html`<div class="wo-timeline">${done ? '' : strip}<ol class="tl">${items}</ol></div>`;
}

// ---------- approval history + audit excerpt ----------
function historyCard(wo, P, store) {
  const a = P.a;
  const rows = store.state.audit.filter(r => r.target === wo.assetId || String(r.detail).includes(wo.id) || (wo.part && r.target === wo.part.id && r.ts >= wo.createdAt))
    .slice().sort((x, y) => y.ts - x.ts).slice(0, 10);
  const who = r => (r.kind === 'ai' || r.kind === 'blocked' ? aiChip(r.actor) : r.kind === 'system' ? html`<span class="chip sys">${icon('layers')}${r.actor}</span>` : humanChip(r.actor));
  return html`<section class="card" aria-label="Approval history and audit trail">
    <div class="card-head"><h2>Who did what</h2><span class="sub">Decisions on ${wo.id} and the audit trail for ${a.id}</span><div class="right"><a class="btn sm ghost" href="#/trust">Full audit log: 8 · Trust Audit ${icon('arrowR')}</a></div></div>
    <h3 class="h-sub">Decisions</h3>
    ${wo.approvals.length ? html`<ul class="decisions">${wo.approvals.map(x => html`<li>${x.action === 'Approved' ? stateChip('ok', 'Approved') : html`<span class="state normal">${icon('x')}Rejected</span>`}<span><b>${x.by}</b> · ${dateTime(x.at)}${x.comment ? html` · “${x.comment}”` : ''}</span></li>`)}</ul>`
      : html`<p class="small dim">No decision yet. This plan waits for a person: the AI cannot approve its own work (Policy G8).</p>`}
    <h3 class="h-sub">Audit trail, newest first</h3>
    <ol class="audit-list">${rows.map(r => html`<li><span class="au-t mono">${shortDT(r.ts)}</span><span class="au-who">${who(r)}</span><span class="au-what"><b>${r.action}</b>${r.detail ? html` · ${r.detail}` : ''}</span></li>`)}</ol>
  </section>`;
}

// ---------- form errors: scroll + glow + focus (no blocking toast) ----------
function flagField(root, id, errId, msg) {
  const el = root.querySelector('#' + id), err = root.querySelector('#' + errId);
  if (!el) return;
  if (err) { err.textContent = msg; err.hidden = false; }
  el.setAttribute('aria-invalid', 'true');
  el.classList.remove('invalid'); void el.offsetWidth; el.classList.add('invalid');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.focus({ preventScroll: true }), 280);
  clearTimeout(glowTimer);
  glowTimer = setTimeout(() => el.classList.remove('invalid'), 3000);
}
function clearInvalid(root, id, errId) {
  const el = root.querySelector('#' + id), err = root.querySelector('#' + errId);
  if (el) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); }
  if (err) err.hidden = true;
}
