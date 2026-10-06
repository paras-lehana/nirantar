// Tool · Maintenance calendar: when does each job happen, and what else fits in the same stop?
// A 7-day plan per plant (desktop: a Gantt with one row per line; phone: an agenda grouped by day) built from the live
// work orders, predicted failures, sales-order due dates, part arrivals and the preventive-maintenance (PM) plan.
// Nirantar suggests preventive jobs that fit into a stop that is already planned (opportunistic maintenance); a named
// person adds them (S.schedulePM). Nothing here books work on its own.
import { html, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, term, kpi, nextBack } from '../ui/components.js';
import { inr, hours, time, day, weekday, HOUR, DAY } from '../core/format.js';
import { savePrefs } from '../core/store.js';
import { FAILURE_MODES } from '../core/generator.js';

let ui = { site: null, lastParam: undefined, scen: null, showAll: false, name: null, editName: false };
let glowTimer = null;

const LIVE = ['PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS'];
// Same low-impact slots as M.planWindow (IST): night shift and the afternoon shift changeover.
const SLOTS = [[2, 6, 'night shift, lowest load'], [14, 18, 'shift changeover']];
const SHIFT = { A: [6, 14], B: [14, 22], C: [22, 6] };
const SHIFT_TXT = { A: '06:00 to 14:00', B: '14:00 to 22:00', C: '22:00 to 06:00' };
const TRACK_PX = 900;     // nominal Gantt track width used to pack labels into lanes (the Gantt never gets narrower; it scrolls)
const LANE = 26;          // px per lane in a Gantt row
const SOON_DAYS = 14;     // a PM due within this many days is worth adding to a planned stop

const OPP_TIP = 'Opportunistic maintenance: doing preventive jobs while the line is already stopped for a repair, so they cost no extra downtime.';
const LIW_TIP = 'Low-impact window: the hours when a stop costs least, 14:00 to 18:00 (shift changeover) and 02:00 to 06:00 (night shift, lowest load), IST. Nirantar plans repairs into these slots.';
const PM_TIP = 'PM = preventive maintenance: routine checks, greasing and filter changes done on a fixed interval (every 90 to 180 days by machine type), before anything breaks.';
const NAME_MSG = 'Type your name first: every booking is signed and goes into the audit log.';

// ---------- small formatters (IST) ----------
const tm = ms => time(ms).replace(/^24/, '00');                         // some ICU builds print midnight as 24:xx
const dLabel = ms => `${weekday(ms)} ${day(ms).replace(/^0/, '')}`;     // "Thu 8 Oct"
const dayStart = ms => Math.floor((ms + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;
const winText = w => (dayStart(w.start) === dayStart(w.end - 1) ? `${dLabel(w.start)}, ${tm(w.start)} to ${tm(w.end)}` : `${dLabel(w.start)} ${tm(w.start)} to ${dLabel(w.end)} ${tm(w.end)}`);
const plural = (n, w, many = w + 's') => `${n} ${n === 1 ? w : many}`;
const shortName = n => (!n ? 'a person' : n.length <= 16 ? n : n.split(/\s+/)[0]);
const lc1 = s => (s ? s[0].toLowerCase() + s.slice(1) : '');
const pmHours = cls => (cls === 'thermal' ? 3 : 2);
const istH = ms => new Date(ms + 5.5 * HOUR).getUTCHours();
function dueText(p) {
  if (p.overdue) { const n = Math.max(1, Math.round(-p.daysToDue)); return `overdue by ${plural(n, 'day')}`; }
  const n = Math.round(p.daysToDue);
  return n <= 0 ? 'due today' : n === 1 ? 'due tomorrow' : `due in ${n} days`;
}

export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, st = store.state;
    const scen = st.scenarioId + '@' + st.anchor;
    if (ui.scen !== scen) { ui.scen = scen; ui.site = null; ui.showAll = false; }
    const p0 = params[0];
    if (p0 !== ui.lastParam) { ui.lastParam = p0; if (p0 && W.sites.some(s => s.id === p0)) ui.site = p0; }
    if (!ui.site || !W.sites.some(s => s.id === ui.site)) ui.site = W.scenario.site;
    if (ui.name == null) ui.name = store.prefs.name || '';

    const D = analyse(store, S, M, ui.site);

    root.innerHTML = String(html`<div class="page schedpage">
      ${pageHead('schedule')}
      ${headlineFor(D, store)}
      ${doThis(stepsFor(D))}
      ${kpis(D)}
      ${calendarCard(D, store, M)}
      <div class="sch-grid">
        ${fitCard(D, store)}
        ${techCard(D)}
      </div>
      ${pmCard(D, store, M)}
      ${nextBack('schedule')}
    </div>`);

    return delegate(root, {
      site: el => {
        ui.site = el.dataset.id; ui.showAll = false;
        try { history.replaceState(null, '', '#/schedule/' + encodeURIComponent(ui.site)); } catch { /* sandboxed iframe */ }
        ctx.rerender();
      },
      'show-all': () => { ui.showAll = !ui.showAll; ctx.rerender(); },
      'edit-name': el => {
        ui.editName = true; ctx.rerender();
        const card = el.dataset.card && root.querySelector('#' + el.dataset.card);
        (card ? card.querySelector('input[data-action="f-name"]') : root.querySelector('input[data-action="f-name"]'))?.focus();
      },
      'f-name': (el, ev) => {
        if (ev.type === 'click') return;
        ui.name = el.value;
        for (const other of root.querySelectorAll('input[data-action="f-name"]')) if (other !== el) other.value = el.value;
        if (el.value.trim()) clearInvalid(root);
        if (ev.type === 'change' && el.value.trim()) { store.prefs.name = el.value.trim(); savePrefs(); }
      },
      'add-stop': el => {
        const name = signer(el, root, store); if (!name) return;
        S.schedulePM(el.dataset.asset, { start: +el.dataset.start, durH: +el.dataset.dur, reason: 'same stop as ' + el.dataset.wo, bundleWith: el.dataset.wo }, name);
      },
      'pm-next': el => {
        const name = signer(el, root, store); if (!name) return;
        const durH = +el.dataset.dur;
        const w = M.planWindow(store.state.simNow + HOUR, null, durH);
        S.schedulePM(el.dataset.asset, { start: w.start, durH, reason: 'next low-impact window' }, name);
      },
    }, ['click', 'input', 'change']);
  },
};

// ---------- name: every booking is signed ----------
function signer(el, root, store) {
  if (store.prefs.name && !ui.editName) return store.prefs.name;
  const card = el.closest('section');
  const inp = (card && card.querySelector('input[data-action="f-name"]')) || root.querySelector('input[data-action="f-name"]');
  const v = ((inp && inp.value) || ui.name || '').trim();
  if (!v) { flagField(inp, card); return null; }
  store.prefs.name = v; ui.name = v; ui.editName = false; savePrefs();
  return v;
}
function nameBox(id, store) {
  const n = store.prefs.name;
  if (n && !ui.editName) return html`<p class="sch-signer small">${humanChip('Your decision')}<span>Bookings are signed as <b>${n}</b>.</span><button type="button" class="btn ghost sm" data-action="edit-name" data-card="${id}Card">Change</button></p>`;
  return html`<div class="field sch-name"><label for="${id}">Your name <span class="dim">(required to book; it goes into the audit log)</span></label>
    <input id="${id}" class="input" type="text" autocomplete="name" placeholder="e.g. Asha Deshpande, maintenance planner" value="${ui.name || ''}" data-action="f-name" aria-describedby="${id}Err">
    <p class="field-err" id="${id}Err" hidden></p></div>`;
}
function flagField(el, card) {
  if (!el) return;
  const err = card && card.querySelector('.field-err');
  if (err) { err.textContent = NAME_MSG; err.hidden = false; }
  el.setAttribute('aria-invalid', 'true');
  el.classList.remove('invalid'); void el.offsetWidth; el.classList.add('invalid');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.focus({ preventScroll: true }), 280);
  clearTimeout(glowTimer);
  glowTimer = setTimeout(() => el.classList.remove('invalid'), 3000);
}
function clearInvalid(root) {
  for (const el of root.querySelectorAll('input[data-action="f-name"]')) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); }
  for (const e of root.querySelectorAll('.sch-name .field-err')) e.hidden = true;
}

// ---------- the numbers behind the page ----------
// A job = a live work order with the window it occupies now. A pending repair shows the window it gets "if you approve
// now" (same rule as store.approve and 5 · Work Orders), which equals the AI's proposedWindow until the clock moves.
function jobOf(wo, store, M) {
  const a = M.assetById(wo.assetId), now = store.state.simNow;
  const pending = wo.status === 'PENDING_APPROVAL';
  let win = wo.window;
  if (pending || !win) {
    if (wo.kind === 'INSPECT') win = { start: now + 2 * HOUR, end: now + 3 * HOUR, reason: 'no production stop needed', beforeFailure: true };
    else if (wo.kind === 'PM') win = wo.proposedWindow;
    else {
      const ass = M.assess(a, store.t);
      const eta = now + (wo.part && wo.part.kind !== 'local' ? wo.part.etaH * HOUR : 0);
      win = M.planWindow(eta + HOUR, ass.failAt, Math.max(4, Math.ceil((FAILURE_MODES[wo.mode]?.repairH || 2) + 2)));
    }
  }
  const ap = wo.approvals.find(x => x.action === 'Approved' || x.action === 'Scheduled');
  return { wo, a, line: M.lineById(a.lineId), win, pending, by: ap ? ap.by : null };
}
const jobName = j => (j.wo.kind === 'INSPECT' ? `${j.a.id} sensor check` : j.wo.kind === 'PM' ? `${j.a.id} preventive job` : `${j.a.id} ${FAILURE_MODES[j.wo.mode]?.short || 'repair'} repair`);

function analyse(store, S, M, siteId) {
  const W = store.world, st = store.state, now = st.simNow;
  const site = M.siteById(siteId);
  const lines = W.lines.filter(l => l.siteId === siteId).sort((x, y) => (x.utility - y.utility) || x.order - y.order);
  const r0 = dayStart(now), r1 = r0 + 7 * DAY, w1 = now + 7 * DAY;
  const ids = new Set(W.assets.filter(a => a.siteId === siteId).map(a => a.id));
  const mine = st.workOrders.filter(w => ids.has(w.assetId));
  const jobs = mine.filter(w => LIVE.includes(w.status)).map(w => jobOf(w, store, M)).sort((x, y) => x.win.start - y.win.start);
  const stops = jobs.filter(j => j.wo.kind !== 'PM');
  const pms = jobs.filter(j => j.wo.kind === 'PM');
  const done = mine.filter(w => w.status === 'DONE' && w.doneAt >= r0 && w.doneAt < r1).map(w => ({ wo: w, a: M.assetById(w.assetId) }));
  const plan = S.pmPlan().filter(p => p.siteId === siteId).sort((x, y) => x.daysToDue - y.daysToDue);
  const overdue = plan.filter(p => p.overdue && !p.scheduled);
  const soon = plan.filter(p => !p.overdue && p.daysToDue <= SOON_DAYS && !p.scheduled);

  // predicted failures of alerted machines (sensor faults excluded: the machine itself is fine)
  const fails = [];
  for (const al of S.openAlerts()) {
    if (!ids.has(al.assetId) || al.type === 'SENSOR' || fails.some(f => f.a.id === al.assetId)) continue;
    const a = M.assetById(al.assetId), ass = M.assess(a, store.t);
    if (ass.rulKind !== 'trend' || !ass.failAt) continue;
    fails.push({ a, al, ass, failAt: ass.failAt, cause: al.type === 'CONSEQUENCE' && al.rootCause ? al.rootCause : a.id });
  }
  fails.sort((x, y) => x.failAt - y.failAt);
  // a failure is covered once a person has booked a repair of its cause that ends before it
  const covered = f => stops.some(j => j.a.id === f.cause && !j.pending && j.win.end <= f.failAt);
  const orders = W.salesOrders.filter(o => M.lineById(o.lineId).siteId === siteId && o.due >= r0 && o.due < r1).sort((x, y) => x.due - y.due)
    .map(o => ({ o, risk: fails.find(f => f.a.lineId === o.lineId && f.failAt < o.due && !covered(f)) || null }));

  // opportunistic maintenance: PM jobs on the same line that are overdue or due soon (same rule as the copilot)
  const fit = stops.map(j => {
    const started = j.wo.status === 'IN_PROGRESS' || j.win.start <= now;
    const cand = p => {
      const a = M.assetById(p.assetId), durH = pmHours(a.cls), costPerH = M.lineById(a.lineId).costPerH;
      return { p, a, durH, costPerH, save: durH * costPerH };
    };
    const open = plan.filter(p => p.lineId === j.a.lineId && !p.scheduled && (p.overdue || p.daysToDue <= SOON_DAYS));
    const cands = j.wo.kind === 'INSPECT' || started ? [] : open.filter(p => p.assetId !== j.a.id).map(cand);
    const self = j.wo.kind === 'INSPECT' || started ? null : open.filter(p => p.assetId === j.a.id).map(cand)[0] || null;
    const added = pms.filter(pj => pj.wo.bundleWith === j.wo.id).map(pj => ({ pj, moved: pj.win.start < j.win.start || pj.win.start >= j.win.end }));
    return { j, cands, self, added, started };
  });
  const bestSave = new Map();
  for (const f of fit) for (const c of f.cands) bestSave.set(c.a.id, Math.max(bestSave.get(c.a.id) || 0, c.save));
  const canSave = [...bestSave.values()].reduce((n, v) => n + v, 0);
  const savedBundled = pms.filter(pj => pj.wo.bundleWith).reduce((n, pj) => n + (pj.win.end - pj.win.start) / HOUR * pj.line.costPerH, 0);

  // technician load in the next 7 days (proposed jobs count too: they would book the person)
  const techs = W.technicians.filter(t => t.siteId === siteId).map(t => {
    const list = jobs.filter(j => j.wo.technician && j.wo.technician.id === t.id && j.win.end > now && j.win.start < w1);
    const clashes = [];
    for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++)
      if (list[i].win.start < list[k].win.end && list[k].win.start < list[i].win.end) clashes.push([list[i], list[k]]);
    const off = list.filter(j => !inShift(t.shift, j.win.start));
    return { t, list, clashes, off, hrs: list.reduce((n, j) => n + (j.win.end - j.win.start) / HOUR, 0) };
  });

  const next = M.planWindow(now + HOUR, null, 2);
  const hero = W.scenario.hero;
  const main = stops.find(j => j.a.id === hero) || stops.find(j => j.wo.kind === 'REPAIR') || stops[0] || null;
  const week = jobs.filter(j => j.win.end > now && j.win.start < w1);
  const siteJobs = Object.fromEntries(W.sites.map(s => [s.id, st.workOrders.filter(w => LIVE.includes(w.status) && M.assetById(w.assetId).siteId === s.id).length]));
  return { site, lines, now, r0, r1, jobs, stops, pms, done, plan, overdue, soon, fails, orders, fit, canSave, savedBundled, techs, next, main, week, siteJobs, covered };
}
function inShift(shift, ms) {
  const [a, b] = SHIFT[shift] || [0, 24], h = istH(ms);
  return a < b ? h >= a && h < b : h >= a || h < b;
}

// ---------- headline + do this ----------
function headlineFor(D, store) {
  const { site, main, fit, overdue, soon, next, stops } = D;
  if (!main) {
    const pmBit = overdue.length || soon.length
      ? html`<b>${plural(overdue.length, 'preventive job')} ${overdue.length === 1 ? 'is' : 'are'} overdue</b>${soon.length ? html` and ${soon.length} more ${soon.length === 1 ? 'falls' : 'fall'} due in the next ${SOON_DAYS} days` : ''}`
      : html`no preventive job is overdue or due in the next ${SOON_DAYS} days`;
    return headline(html`<b>No repairs planned at ${site.city}.</b> Preventive jobs still show here: ${pmBit}. The next ${term('low-impact window', LIW_TIP)} starts <b>${dLabel(next.start)}, ${tm(next.start)}</b>.`, overdue.length ? 'watch' : 'ok');
  }
  const f = fit.find(x => x.j === main);
  const fail = D.fails.find(x => x.a.id === main.a.id);
  const name = main.wo.kind === 'INSPECT' ? `${main.a.id}'s sensor check` : `${main.a.id}'s ${FAILURE_MODES[main.wo.mode]?.short || 'repair'} repair`;
  const when = main.wo.status === 'IN_PROGRESS' ? html`is under way (${winText(main.win)})`
    : main.pending ? html`is proposed by Nirantar for <b>${winText(main.win)}</b>`
    : html`is planned for <b>${winText(main.win)}</b> (approved by <b>${main.by || 'a person'}</b>)`;
  const marginH = fail ? (fail.failAt - main.win.end) / HOUR : null;
  const failBit = fail ? (marginH > 0 ? html`, about <b>${hours(marginH)} before the predicted failure</b>` : html`, <b>after the predicted failure</b>: expedite the part`) : '';
  const approveBit = main.pending ? html` It needs a person's approval on <a href="#/orders/${main.wo.id}">5 · Work Orders</a>.` : '';
  let fitBit;
  if (main.wo.kind === 'INSPECT') fitBit = html` The check runs with the machine on, so there is no line stop to share.`;
  else if (f.cands.length) {
    const nOver = f.cands.filter(c => c.p.overdue).length, sum = f.cands.reduce((n, c) => n + c.save, 0);
    const what = nOver === f.cands.length ? html`<b>${plural(nOver, 'overdue preventive job')}</b>` : html`<b>${plural(f.cands.length, 'preventive job')}</b>${nOver ? ` (${nOver} overdue)` : ''}`;
    fitBit = html` ${what} on the same line can be done in that stop with no extra downtime${sum > 0 ? html`, saving about <b>${inr(sum)}</b> of line time` : ''}.`;
  } else if (f.added.length) fitBit = html` ${plural(f.added.length, 'preventive job is', 'preventive jobs are')} already in that stop, saving about <b>${inr(f.added.reduce((n, x) => n + (x.pj.win.end - x.pj.win.start) / HOUR * x.pj.line.costPerH, 0))}</b> of extra downtime.`;
  else if (f.started) fitBit = '';
  else fitBit = html` No other preventive job on that line is due in the next ${SOON_DAYS} days, so nothing else needs the stop.`;
  const more = stops.length > 1 ? html` ${plural(stops.length - 1, 'more repair or check', 'more repairs or checks')} this week on the calendar.` : '';
  const tone = fail && marginH <= 0 ? 'act' : main.pending ? 'ai' : 'ok';
  return headline(html`${name} ${when}${failBit}.${approveBit}${fitBit}${more}`, tone);
}

function stepsFor(D) {
  const items = [];
  if (D.main && D.main.pending) items.push(html`Read the week ${marker(1)}: the blue dashed bar is Nirantar's proposal. It is booked only after a person approves it on <a href="#/orders/${D.main.wo.id}">5 · Work Orders</a>.`);
  else items.push(html`Read the week ${marker(1)}: green bars are booked by a person, red marks a predicted failure, grey bands are the ${term('low-impact windows', LIW_TIP)}.`);
  const n = D.fit.reduce((k, f) => k + f.cands.length, 0);
  items.push(n ? html`Press <b>Add to this stop</b> ${marker(2)} for preventive jobs on the same line: they cost no extra downtime. Your name goes into the audit log.`
    : html`Check the stop list ${marker(2)}: when a repair is planned, preventive jobs on the same line that fall due soon appear there.`);
  items.push(html`Check technician load ${marker(3)}: amber means one person is booked twice at the same time.`);
  items.push(html`Book the other ${term('PM', PM_TIP)} jobs in the next low-impact window ${marker(4)}, overdue ones first.`);
  return items;
}

function kpis(D) {
  const nProp = D.week.filter(j => j.pending).length, nBooked = D.week.length - nProp;
  const worst = D.overdue.length ? Math.max(...D.overdue.map(p => Math.round(-p.daysToDue))) : 0;
  const nFit = new Set(D.fit.flatMap(f => f.cands.map(c => c.a.id))).size;
  return html`<section class="cols-4" aria-label="The week in numbers">
    ${kpi({ label: 'Jobs in the next 7 days', value: D.week.length, mean: D.week.length ? `${nProp} proposed by the AI, ${nBooked} booked by a person` : 'nothing booked yet', tip: 'Repairs, sensor checks and preventive jobs at this plant whose window falls in the next 7 days.' })}
    ${kpi({ label: 'Preventive jobs overdue', value: D.overdue.length, tone: D.overdue.length ? 'watch' : '', mean: D.overdue.length ? `not booked yet; oldest by ${plural(worst, 'day')}` : `all ${D.plan.length} machines are within their interval or booked`, tip: PM_TIP })}
    ${kpi({ label: 'Line time you can save', value: inr(D.canSave), tone: D.canSave ? 'ai' : '', mean: nFit ? `by adding ${plural(nFit, 'job')} to a planned stop` : D.savedBundled ? `${inr(D.savedBundled)} already saved by bundling` : D.stops.length ? 'no due preventive job fits a planned stop' : 'no planned stop to share right now', tip: OPP_TIP + ' Saving = job hours × what one hour of the line standing still costs.' })}
    ${kpi({ label: 'Next low-impact window', value: `${weekday(D.next.start)} ${tm(D.next.start)}`, mean: `${dLabel(D.next.start)}, ${D.next.reason.replace(' (low-impact)', '')}`, tip: LIW_TIP })}
  </section>`;
}

// ---------- calendar events (one list feeds both the Gantt and the phone agenda) ----------
function events(D, store, M) {
  const ev = [];
  const sitePart = j => (j.wo.part && j.wo.part.from && j.wo.part.from !== 'Supplier' ? M.siteById(j.wo.part.from)?.city : 'the supplier');
  for (const j of D.stops) {
    const insp = j.wo.kind === 'INSPECT';
    const who = j.pending ? 'proposed by AI' : j.wo.status === 'IN_PROGRESS' ? 'in progress' : `approved by ${shortName(j.by)}`;
    ev.push({ kind: 'stop', lineId: j.a.lineId, s: j.win.start, e: j.win.end, bar: true, cls: j.pending ? 'prop' : 'ok', tone: j.pending ? 'ai' : 'ok', prio: 0,
      g: `${j.a.id} ${insp ? 'sensor check' : 'repair'} · ${who}`,
      a: html`<b>${jobName(j)}</b> · ${j.line.short}`,
      chip: j.pending ? aiChip('Proposed by the AI · needs approval') : j.wo.status === 'IN_PROGRESS' ? stateChip('ok', 'In progress') : stateChip('ok', `Approved by ${j.by || 'a person'}`),
      title: `${j.wo.id}: ${jobName(j)}, ${winText(j.win)}. ${j.pending ? 'Proposed by Nirantar; needs a person to approve it.' : `Approved by ${j.by || 'a person'}.`}${j.wo.technician ? ' Technician ' + j.wo.technician.name + '.' : ''}` });
    if (j.wo.part && j.wo.part.kind !== 'local' && j.wo.eta && !j.pending && j.wo.status !== 'DONE') {
      const arrived = j.wo.partArrived || D.now >= j.wo.eta;
      ev.push({ kind: 'eta', lineId: j.a.lineId, s: j.wo.eta, bar: false, cls: 'eta', icon: 'truck', tone: '', prio: 2,
        g: `Part ${arrived ? 'arrived' : 'arrives'} · ${j.a.id}`,
        a: html`<b>Part ${arrived ? 'arrived' : 'arrives'}</b> for ${j.a.id}: ${lc1(j.wo.part.name)} from ${sitePart(j)}`, chip: '',
        title: `${j.wo.part.name} for ${j.a.id} (${j.wo.id}) from ${sitePart(j)}: ${arrived ? 'arrived' : 'arrives'} ${dLabel(j.wo.eta)} ${tm(j.wo.eta)}` });
    }
  }
  for (const j of D.pms) {
    const bundle = j.wo.bundleWith;
    ev.push({ kind: 'pm', lineId: j.a.lineId, s: j.win.start, e: j.win.end, bar: true, cls: 'pm', tone: 'ok', prio: 0,
      g: `PM ${j.a.id} · ${bundle ? 'same stop' : shortName(j.by)}`,
      a: html`<b>${term('PM', PM_TIP)} ${j.a.id}</b> ${lc1(j.a.name)} · ${j.line.short}${bundle ? html` · in the ${bundle} stop` : ''}`,
      chip: stateChip('ok', `Booked by ${j.by || 'a person'}`),
      title: `${j.wo.id}: preventive job on ${j.a.id}, ${winText(j.win)}, booked by ${j.by || 'a person'}${bundle ? ` in the same stop as ${bundle}` : ''}` });
  }
  // predicted failures: one marker per line (an alarm flood can put many machines on one line)
  const byLine = new Map();
  for (const f of D.fails) { if (!byLine.has(f.a.lineId)) byLine.set(f.a.lineId, []); byLine.get(f.a.lineId).push(f); }
  for (const [lineId, fs] of byLine) {
    const f0 = fs[0], cause = fs.every(f => f.cause !== f.a.id) ? f0.cause : null;
    const one = fs.length === 1;
    ev.push({ kind: 'fail', lineId, s: f0.failAt, bar: false, cls: 'fail', icon: 'alert', tone: 'act', prio: 1, vline: true,
      g: one ? `${f0.a.id} predicted failure · ${weekday(f0.failAt)} ${tm(f0.failAt)}` : `${fs.length} machines predicted to fail · from ${weekday(f0.failAt)} ${tm(f0.failAt)}${cause ? ` · cause ${cause}` : ''}`,
      a: one ? html`<b>${f0.a.id} predicted failure</b>${cause ? ` (caused by ${cause})` : ''}`
        : html`<b>${fs.length} machines predicted to fail</b> from this time (${fs.map(f => f.a.id).join(', ')})${cause ? html`, all caused by <b>${cause}</b>` : ''}`,
      chip: fs.every(D.covered) ? stateChip('ok', 'A repair is booked before it') : stateChip('act', 'Act now: no repair booked yet'),
      title: fs.map(f => `${f.a.id}: predicted failure about ${dLabel(f.failAt)} ${tm(f.failAt)} (likely ${hours(f.ass.rulLo)} to ${hours(f.ass.rulHi)} from now)${f.cause !== f.a.id ? `, caused by ${f.cause}` : ''}`).join('; ') });
  }
  for (const { o, risk } of D.orders) {
    const line = M.lineById(o.lineId);
    ev.push({ kind: 'order', lineId: o.lineId, s: o.due, bar: false, cls: risk ? 'risk' : 'order', icon: 'flag', tone: risk ? 'watch' : '', prio: 3,
      g: `${o.customer} due${risk ? ' · at risk' : ''}`,
      a: html`<b>${o.customer}</b> order due · ${line.short} · ${inr(o.valueInr)}`,
      chip: risk ? stateChip('watch', `At risk: ${risk.a.id} may fail first`) : '',
      title: `${o.id} ${o.customer}: due ${dLabel(o.due)} ${tm(o.due)}, ${inr(o.valueInr)}, late penalty ${inr(o.penaltyPerDay)} a day${risk ? `. At risk: ${risk.a.id} is predicted to fail before it and no repair is approved yet.` : ''}` });
  }
  for (const p of D.plan) {
    if (p.overdue || p.scheduled || p.due < D.now || p.due >= D.r1) continue;
    const a = M.assetById(p.assetId);
    ev.push({ kind: 'pmdue', lineId: p.lineId, s: p.due, bar: false, cls: 'pmdue', icon: 'clock', tone: '', prio: 4,
      g: `PM due · ${p.assetId}`, a: html`<b>${term('PM', PM_TIP)} due</b> on ${p.assetId} ${lc1(a.name)} · not booked yet`, chip: '',
      title: `${p.assetId}: preventive job due ${dLabel(p.due)} (every ${p.interval} days); not booked yet` });
  }
  for (const d of D.done) {
    ev.push({ kind: 'done', lineId: d.a.lineId, s: d.wo.doneAt, bar: false, cls: 'done', icon: 'check', tone: 'ok', prio: 5,
      g: `${d.a.id} ${d.wo.kind === 'PM' ? 'PM' : d.wo.kind === 'INSPECT' ? 'check' : 'repair'} done`,
      a: html`<b>${d.a.id} ${d.wo.kind === 'PM' ? 'preventive job' : d.wo.kind === 'INSPECT' ? 'sensor check' : 'repair'} done</b> (${d.wo.id})`, chip: stateChip('ok', 'Done'),
      title: `${d.wo.id} done ${dLabel(d.wo.doneAt)} ${tm(d.wo.doneAt)}` });
  }
  return ev;
}

// Greedy lane packing in percent of the track: a label sits right of its mark, or left when it would run off the end.
function pack(items, span, r0) {
  const lanes = [];
  const pc = ms => Math.max(0, Math.min(100, (ms - r0) / span * 100));
  const order = [...items].sort((x, y) => (x.bar === y.bar ? 0 : x.bar ? -1 : 1) || x.prio - y.prio || x.s - y.s);
  for (const it of order) {
    it.ps = pc(it.s); it.pe = it.bar ? Math.max(pc(it.e), it.ps + 0.5) : it.ps;
    const labPct = ((it.g.length * 6.9) + (it.bar ? 10 : 30)) / TRACK_PX * 100;
    let a, b;
    if (it.pe + labPct <= 99.5) { it.side = 'r'; a = it.ps - (it.bar ? 0 : 1.2); b = it.pe + labPct; }
    else { it.side = 'l'; a = it.ps - labPct; b = it.pe + (it.bar ? 0 : 1.2); }
    a -= 0.4; b += 0.4;
    let li = lanes.findIndex(L => L.every(([x, y]) => b <= x || a >= y));
    if (li < 0) { lanes.push([]); li = lanes.length - 1; }
    lanes[li].push([a, b]); it.lane = li;
  }
  return Math.max(1, lanes.length);
}

function gantt(D, ev) {
  const { r0, r1, now } = D;
  const span = r1 - r0;
  const pc = ms => Math.max(0, Math.min(100, (ms - r0) / span * 100));
  const f2 = v => v.toFixed(2);
  const days = Array.from({ length: 7 }, (_, i) => r0 + i * DAY);
  const bands = days.flatMap(d => SLOTS.map(([h0, h1, why]) => ({ s: d + h0 * HOUR, e: d + h1 * HOUR, why })));
  const nowPc = pc(now);
  const nowShift = nowPc < 4 ? '0' : nowPc > 96 ? '-100%' : '-50%';
  const overdueBy = new Map();
  for (const p of D.overdue) { if (!overdueBy.has(p.lineId)) overdueBy.set(p.lineId, []); overdueBy.get(p.lineId).push(p.assetId); }

  const later = D.fails.filter(f => f.failAt >= r1);
  const rows = D.lines.map(l => {
    const items = ev.filter(e => e.lineId === l.id && (e.bar ? e.e > r0 && e.s < r1 : e.s >= r0 && e.s < r1));
    for (const f of later.filter(x => x.a.lineId === l.id).slice(0, 1))
      items.push({ kind: 'fail', s: r1 - 1, bar: false, cls: 'fail', icon: 'alert', tone: 'act', prio: 1, g: `${f.a.id} predicted failure after this week (${dLabel(f.failAt)})`, title: `${f.a.id}: predicted failure about ${dLabel(f.failAt)} ${tm(f.failAt)}` });
    const n = pack(items, span, r0);
    const od = overdueBy.get(l.id) || [];
    const nM = D.plan.filter(p => p.lineId === l.id).length;
    return html`<div class="g-row">
      <div class="g-label"><b>${l.short}</b><span class="xs dim">${plural(nM, 'machine')}</span>${l.costPerH ? html`<span class="xs dim nowrap" title="What one hour of this line standing still costs">${inr(l.costPerH)} an hour</span>` : ''}
        ${od.length ? html`<span class="state watch" title="Overdue and not booked: ${od.join(', ')}">${icon('info')}${od.length} PM overdue</span>` : ''}</div>
      <div class="g-track" style="min-height:${n * LANE + 10}px">
        ${items.length ? '' : html`<span class="g-empty xs dim">Nothing planned this week</span>`}
        ${items.map(it => itemHtml(it, f2))}
      </div>
    </div>`;
  });

  return html`<div class="gantt" role="group" aria-label="Seven-day maintenance calendar for ${D.site.name}, one row per line">
    <div class="g-head">
      <div class="g-corner">Line</div>
      <div class="g-days">
        ${days.map(d => html`<div class="g-day ${d === r0 ? 'today' : ''}"><b>${dLabel(d)}</b>${d === r0 ? html`<span class="xs dim"> · today</span>` : ''}
          ${[6, 12, 18].filter(h => Math.abs(pc(d + h * HOUR) - nowPc) > 4.6).map(h => html`<span class="g-tick" style="left:${f2(h / 24 * 100)}%" aria-hidden="true">${String(h).padStart(2, '0')}</span>`)}</div>`)}
        <div class="g-slots" aria-hidden="true">${bands.map(b => html`<span style="left:${f2(pc(b.s))}%;width:${f2(pc(b.e) - pc(b.s))}%" title="Low-impact window ${tm(b.s)} to ${tm(b.e)}: ${b.why}"></span>`)}</div>
        <span class="g-nowtag" style="left:${f2(nowPc)}%;transform:translateX(${nowShift})">Now ${tm(now)}</span>
      </div>
    </div>
    <div class="g-body">
      <div class="g-over" aria-hidden="true">
        <span class="g-past" style="width:${f2(nowPc)}%"></span>
        ${bands.map(b => html`<span class="g-band" style="left:${f2(pc(b.s))}%;width:${f2(pc(b.e) - pc(b.s))}%"></span>`)}
        ${days.slice(1).map(d => html`<span class="g-mid" style="left:${f2(pc(d))}%"></span>`)}
        <span class="g-nowline" style="left:${f2(nowPc)}%"></span>
      </div>
      ${rows}
    </div>
  </div>`;
}

function itemHtml(it, f2) {
  const top = 5 + it.lane * LANE;
  const sr = html`<span class="visually-hidden">${it.bar ? `${dLabel(it.s)} ${tm(it.s)} to ${tm(it.e)}: ` : `${dLabel(it.s)} ${tm(it.s)}: `}</span>`;
  if (it.bar) {
    const pos = it.side === 'r' ? `left:calc(${f2(it.pe)}% + 5px)` : `right:calc(${f2(100 - it.ps)}% + 5px)`;
    return html`<span class="g-bar ${it.cls}" style="left:${f2(it.ps)}%;width:${f2(it.pe - it.ps)}%;top:${top}px" title="${it.title}" aria-hidden="true"></span>
      <span class="g-lab t-${it.tone || 'none'} side-${it.side}" style="${pos};top:${top}px" title="${it.title}">${sr}${it.g}</span>`;
  }
  const pos = it.side === 'r' ? `left:${f2(it.ps)}%` : `right:${f2(100 - it.ps)}%`;
  return html`${it.vline ? html`<span class="g-vl" style="left:${f2(it.ps)}%" aria-hidden="true"></span>` : ''}
    <span class="g-mk ${it.cls} side-${it.side}" style="${pos};top:${top}px" title="${it.title}"><span class="g-dot" aria-hidden="true">${icon(it.icon)}</span><span class="g-lab-in t-${it.tone || 'none'}">${sr}${it.g}</span></span>`;
}

function agenda(D, ev) {
  const { r0, now } = D;
  const days = Array.from({ length: 7 }, (_, i) => r0 + i * DAY);
  const inDay = (e, d) => e.s >= d && e.s < d + DAY;
  const later = D.fails.filter(f => f.failAt >= D.r1);
  const timeOf = e => (e.bar ? `${tm(e.s)}–${tm(e.e)}` : tm(e.s));
  return html`<div class="agenda" aria-label="Seven-day agenda for ${D.site.name}">
    <p class="small ag-note">${icon('clock')}<span>${term('Low-impact windows', LIW_TIP)} every day: <b>02:00–06:00</b> (night) and <b>14:00–18:00</b> (changeover).</span></p>
    ${D.overdue.length ? html`<p class="small ag-over">${stateChip('watch', `${D.overdue.length} PM overdue`)}<span>${D.overdue.slice(0, 4).map(p => p.assetId).join(', ')}${D.overdue.length > 4 ? '…' : ''}: book them in the table ${marker(4)}.</span></p>` : ''}
    ${days.map(d => {
      const list = ev.filter(e => inDay(e, d)).sort((x, y) => x.s - y.s);
      const today = d === r0;
      const nowRow = html`<li class="ag-now"><span class="ag-t mono">${tm(now)}</span><span class="ag-what"><b>Now</b></span></li>`;
      let placed = !today;
      const rows = [];
      for (const e of list) {
        if (!placed && e.s > now) { rows.push(nowRow); placed = true; }
        rows.push(html`<li class="ag-${e.kind} t-${e.tone || 'none'}"><span class="ag-t mono">${timeOf(e)}</span><span class="ag-what">${e.icon ? icon(e.icon) : ''}<span>${e.a}${e.chip ? html` ${e.chip}` : ''}</span></span></li>`);
      }
      if (!placed) rows.push(nowRow);
      return html`<section class="ag-day ${today ? 'today' : ''}" aria-label="${dLabel(d)}">
        <h3>${dLabel(d)}${today ? html` <span class="dim">· today</span>` : ''}</h3>
        ${list.length ? html`<ol>${rows}</ol>` : html`<ol>${today ? nowRow : ''}</ol><p class="xs dim">Nothing planned.</p>`}
      </section>`;
    })}
    ${later.length ? html`<p class="small ag-later">${icon('alert')}<span>After this week: ${later.map(f => `${f.a.id} predicted failure about ${dLabel(f.failAt)} ${tm(f.failAt)}`).join('; ')}.</span></p>` : ''}
  </div>`;
}

function calendarCard(D, store, M) {
  const ev = events(D, store, M);
  const W = store.world;
  return html`<section class="card sch-cal" aria-label="Maintenance calendar">
    <div class="card-head">${marker(1)}<h2>Next 7 days at ${D.site.city}</h2><span class="sub">${dLabel(D.r0)} to ${dLabel(D.r1 - 1)}, IST</span>
      <div class="right"><div class="seg" role="group" aria-label="Plant">${W.sites.map(s => html`<button type="button" data-action="site" data-id="${s.id}" aria-pressed="${s.id === D.site.id}">${s.city}${D.siteJobs[s.id] ? ` · ${plural(D.siteJobs[s.id], 'job')}` : ''}</button>`)}</div></div></div>
    <div class="g-scroll" tabindex="0" aria-label="Calendar, scrolls sideways">${gantt(D, ev)}</div>
    <p class="g-hint xs dim">${icon('arrowR')}Scroll sideways for the rest of the week; the line names stay put.</p>
    ${agenda(D, ev)}
    <div class="legend sch-legend" aria-label="Calendar legend">
      <span><i class="lg band"></i>${term('Low-impact window', LIW_TIP)}</span>
      <span><i class="lg prop"></i>Proposed by the AI (needs approval)</span>
      <span><i class="lg ok"></i>Repair or check approved by a person</span>
      <span><i class="lg pm"></i>Preventive job booked by a person</span>
      <span><span class="g-dot fail">${icon('alert')}</span>Predicted failure</span>
      <span><span class="g-dot order">${icon('flag')}</span>Sales order due</span>
      <span><span class="g-dot risk">${icon('flag')}</span>Order at risk</span>
      <span><span class="g-dot eta">${icon('truck')}</span>Part arrives</span>
      <span><i class="lg now"></i>Now</span>
    </div>
  </section>`;
}

// ---------- fit more into the same stop ----------
function fitCard(D, store) {
  const { fit, site } = D;
  const body = fit.length ? fit.map(f => stopBlock(f)) : html`<div class="fit-empty">
      <p><b>No repairs planned at ${site.city}, so there is no stop to share.</b></p>
      <p class="small">When Nirantar drafts a repair, preventive jobs on the same line that are overdue or due within ${SOON_DAYS} days appear here, with the downtime you save by doing them in the same stop. Until then, book them in the next low-impact window ${marker(4)}.</p>
      <div class="row"><a class="btn sm" href="#/presenter">${icon('play')} Inject a fault on Presenter</a></div>
    </div>`;
  return html`<section class="card ai" id="schNameFitCard" aria-label="Fit more into the same stop">
    <div class="card-head">${marker(2)}<h2>Fit more into the same stop</h2>${aiChip('Suggested by Nirantar')}</div>
    <p class="small muted">${term('Opportunistic maintenance', OPP_TIP)}: while a line is stopped for a repair, preventive jobs on the same line cost no extra downtime. Nirantar suggests; a person decides.</p>
    ${fit.some(f => f.cands.length || f.self) ? nameBox('schNameFit', store) : ''}
    <div class="fit-stops">${body}</div>
  </section>`;
}

function stopBlock(f) {
  const { j, cands, self, added } = f;
  const status = j.pending ? aiChip('Proposed by the AI') : j.wo.status === 'IN_PROGRESS' ? stateChip('ok', 'In progress') : stateChip('ok', `Approved by ${j.by || 'a person'}`);
  const btn = c => html`<button type="button" class="btn approve" data-action="add-stop" data-asset="${c.a.id}" data-wo="${j.wo.id}" data-dur="${c.durH}" data-start="${j.win.start}">${icon('check')} Add to this stop</button>`;
  const saveTxt = c => (c.costPerH ? html`Saves about <b>${inr(c.save)}</b>: ${c.durH} h × ${inr(c.costPerH)} an hour the line would otherwise stand still.` : html`No production line stops for this machine, so the saving is a second trip for the crew.`);
  let list;
  if (j.wo.kind === 'INSPECT') list = html`<p class="small dim">This sensor check runs with the machine on, so there is no line stop to share. Preventive jobs on the ${j.line.name} need their own low-impact window ${marker(4)}.</p>`;
  else if (f.started) list = html`<p class="small dim">This stop has started. New preventive jobs go into the next low-impact window ${marker(4)}.</p>`;
  else if (cands.length) list = html`<ul class="fit-list">${cands.map(c => html`<li>
      <div class="fit-what">
        <span><b>${c.a.id}</b> ${lc1(c.a.name)} · ${term('PM', PM_TIP)} every ${c.p.interval} days</span>
        <span class="fit-why">${c.p.overdue ? stateChip('watch', dueText(c.p)) : html`<span class="state normal">${icon('clock')}${dueText(c.p)}</span>`}<span class="xs">${c.durH} h job</span></span>
        <span class="small">${saveTxt(c)}</span>
      </div>${btn(c)}</li>`)}</ul>
    ${cands.length > 1 ? html`<p class="small fit-total">All ${cands.length}: about <b>${inr(cands.reduce((n, c) => n + c.save, 0))}</b> of line time saved and ${hours(cands.reduce((n, c) => n + c.durH, 0))} of preventive work done in one stop.</p>` : ''}`;
  else list = html`<p class="small dim">${added.length ? 'Every other preventive job on this line that falls due soon is already in this stop.' : `No other preventive job on the ${j.line.name} is overdue or due in the next ${SOON_DAYS} days, so nothing else needs this stop.`}</p>`;
  return html`<article class="fit-stop ${j.pending ? 'pending' : 'booked'}" aria-label="Stop ${j.wo.id}">
    <header class="fit-head"><div><b>${jobName(j)}</b> <span class="dim">· ${j.line.name}</span><br><span class="small">${winText(j.win)} · <span class="mono">${j.wo.id}</span></span></div>${status}</header>
    ${list}
    ${self ? html`<div class="fit-self small"><span>${icon('wrench')}<span>${j.a.id}'s own preventive job is ${dueText(self.p)}: the crew can do its checklist while the machine is open.</span></span>${btn(self)}</div>` : ''}
    ${added.length ? html`<ul class="fit-added">${added.map(x => html`<li>${stateChip('ok', `Added by ${x.pj.by || 'a person'}`)}<span><b>${x.pj.a.id}</b> preventive job · <span class="mono">${x.pj.wo.id}</span> · ${tm(x.pj.win.start)} to ${tm(x.pj.win.end)}</span>${x.moved ? stateChip('watch', 'The repair moved: re-plan this job') : ''}</li>`)}</ul>` : ''}
    ${j.pending && (cands.length || added.length) ? html`<p class="xs dim">This stop is still a proposal: if the approved time changes, re-plan the jobs added here.</p>` : ''}
  </article>`;
}

// ---------- technician load ----------
function techCard(D) {
  const anyClash = D.techs.some(x => x.clashes.length);
  return html`<section class="card" aria-label="Technician load">
    <div class="card-head">${marker(3)}<h2>Technician load, next 7 days</h2></div>
    <p class="small muted">Jobs booked or proposed for each person at ${D.site.city}. ${anyClash ? html`<b>Amber: one person is booked twice at the same time.</b>` : 'No one is booked twice.'}</p>
    <ul class="tech-list">${D.techs.map(x => html`<li class="${x.clashes.length ? 'clash' : ''}">
      <div class="tl-row"><div class="tl-who"><b>${x.t.name}</b><span class="xs dim">Shift ${x.t.shift} (${SHIFT_TXT[x.t.shift]}) · ${x.t.skills.join(', ')}</span></div>
        <div class="tl-load"><b class="mono">${x.list.length}</b> <span class="small">${x.list.length === 1 ? 'job' : 'jobs'}${x.list.length ? ` · ${hours(x.hrs)}` : ''}</span></div></div>
      ${x.list.length ? html`<ul class="tl-jobs">${x.list.map(j => html`<li class="${j.pending ? 'p' : 'b'}" title="${jobName(j)}, ${winText(j.win)}${j.pending ? ' (proposed by the AI)' : ''}"><span class="mono">${j.wo.id}</span> ${weekday(j.win.start)} ${tm(j.win.start)}${j.pending ? ' · proposed' : ''}</li>`)}</ul>` : html`<p class="xs dim">Free all week.</p>`}
      ${x.clashes.map(([p, q]) => html`<p class="tl-clash">${stateChip('watch', 'Overlap')}<span><span class="mono">${p.wo.id}</span> and <span class="mono">${q.wo.id}</span> both on ${dLabel(Math.max(p.win.start, q.win.start))} from ${tm(Math.max(p.win.start, q.win.start))}. Give one job to someone else or move it.</span></p>`)}
      ${x.off.length ? html`<p class="xs dim">${x.off.map(j => j.wo.id).join(', ')} ${x.off.length === 1 ? 'starts' : 'start'} outside ${x.t.name.split(' ')[0]}'s usual shift: plan the hand-over or overtime.</p>` : ''}
    </li>`)}</ul>
  </section>`;
}

// ---------- preventive jobs table ----------
function pmCard(D, store, M) {
  const { plan, next, site, now } = D;
  const focus = p => p.overdue || p.daysToDue <= SOON_DAYS || !!p.scheduled;
  const nFocus = plan.filter(focus).length;
  const later = plan.length - nFocus;
  const lastTxt = p => (p.last > 0 ? html`<span class="nowrap">${dLabel(p.last)}</span><span class="xs dim sub">${plural(Math.max(0, Math.round((now - p.last) / DAY)), 'day')} ago</span>` : html`<span class="dim">no record</span>`);
  const rows = plan.map(p => {
    const a = M.assetById(p.assetId), line = M.lineById(p.lineId), durH = pmHours(a.cls);
    const w = p.scheduled ? (p.scheduled.window || p.scheduled.proposedWindow) : null;
    const by = p.scheduled ? (p.scheduled.approvals[0] || {}).by : null;
    return html`<tr class="${focus(p) ? '' : 'pm-later'} ${p.overdue && !p.scheduled ? 'row-watch' : ''}">
      <td class="c-machine" data-label="Machine"><b>${a.id}</b> <span class="small">${a.name}</span><span class="xs dim sub">${line.short} line</span></td>
      <td data-label="Last done">${lastTxt(p)}</td>
      <td data-label="Interval"><span class="nowrap">${p.interval} days</span><span class="xs dim sub">${durH} h job</span></td>
      <td data-label="Next due">${p.overdue ? stateChip('watch', dueText(p)) : html`<span class="${p.daysToDue <= SOON_DAYS ? '' : 'dim'}">${dueText(p)}</span>`}<span class="xs dim sub">${dLabel(p.due)}</span></td>
      <td data-label="Booked job">${w ? html`<span class="state ok">${icon('check')}<span class="mono">${p.scheduled.id}</span></span> <span class="small nowrap">${dLabel(w.start)}, ${tm(w.start)}</span><span class="xs dim sub">by ${by || 'a person'}${p.scheduled.bundleWith ? ` · same stop as ${p.scheduled.bundleWith}` : ''}</span>` : html`<span class="dim small nowrap">Not booked</span>`}</td>
      <td class="c-act" data-label="">${w ? '' : html`<button type="button" class="btn sm ${p.overdue ? 'approve' : ''}" data-action="pm-next" data-asset="${a.id}" data-dur="${durH}" title="Book ${a.id} for ${winText({ start: next.start, end: next.start + durH * HOUR })}">${icon('calendar')} Schedule in next window</button>`}</td>
    </tr>`;
  });
  return html`<section class="card" id="schNamePmCard" aria-label="Preventive jobs">
    <div class="card-head">${marker(4)}<h2>Preventive jobs at ${site.city}</h2><span class="sub">${term('PM', PM_TIP)} interval by machine type, most urgent first.</span></div>
    <p class="small muted">The next ${term('low-impact window', LIW_TIP)} is <b>${winText({ start: next.start, end: next.start + 2 * HOUR })}</b> (${next.reason.replace(' (low-impact)', '')}). <b>Schedule in next window</b> books the job there in your name; a job that fits a planned repair is better added to that stop ${marker(2)}.</p>
    ${nameBox('schNamePm', store)}
    ${!nFocus ? html`<p class="small pm-none">${stateChip('ok', 'Nothing urgent')} No preventive job at ${site.city} is overdue or due in the next ${SOON_DAYS} days.</p>` : ''}
    <div class="table-wrap pm-wrap ${ui.showAll ? 'all' : ''}"><table class="table pm-table">
      <caption class="visually-hidden">Preventive maintenance plan for ${site.name}: last done, interval, next due and booked job per machine</caption>
      <thead><tr><th scope="col">Machine</th><th scope="col">Last done</th><th scope="col">Interval</th><th scope="col">Next due</th><th scope="col">Booked job</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${later ? html`<button type="button" class="btn sm pm-more" data-action="show-all" aria-expanded="${ui.showAll}">${ui.showAll ? `Show only overdue and due in ${SOON_DAYS} days` : `Show all ${plan.length} machines (${later} more)`}</button>` : ''}
  </section>`;
}
