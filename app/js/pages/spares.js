// Tool · Spares & logistics: do we have the parts, and where? Stock per plant against reorder points, the parts that
// open alerts need, transfers on the road, and Nirantar's restocking suggestions. Suggestions are proposals only:
// the buttons write a "(demo)" request row to the audit log; no stock moves and nothing is ordered.
import { html, raw, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, term, kpi, nextBack } from '../ui/components.js';
import { inr, hours, dateTime, shortDT, inHours, HOUR } from '../core/format.js';
import { FAILURE_MODES, TRANSFER_H } from '../core/generator.js';

const REQ = { buy: 'Raised a purchase request (demo)', move: 'Requested a stock transfer (demo)' };
// Which machine classes a spare fits (bearings are matched on the bearing model each machine carries).
const FM_CLASSES = { 'FM-02': ['cnc'], 'FM-03': ['rotating', 'aux'], 'FM-04': ['press', 'rotating', 'compressor'], 'FM-05': ['rotating'],
  'FM-06': ['press'], 'FM-07': ['pump'], 'FM-08': ['thermal'], 'FM-09': ['cnc', 'rotating', 'pump', 'compressor', 'press'] };
// Schematic positions (Chittorgarh north, Pune west, Chennai south-east; not to scale) and where each label sits.
const NODE = { CHITTOR: { x: 170, y: 44, lab: ['start', 18, 4] }, PUNE: { x: 130, y: 170, lab: ['end', -18, 4] }, CHENNAI: { x: 280, y: 262, lab: ['middle', 0, 32] } };
const lc1 = s => (s ? s[0].toLowerCase() + s.slice(1) : '');
const transferH = (from, to) => TRANSFER_H[from + '>' + to] ?? 72;

function fits(a, part) {
  if (part.for === 'SENSOR') return a.tags.some(t => t.key === 'VIB_RMS');
  if (part.for === 'FM-01') return a.tags.some(t => t.key === 'VIB_RMS') && part.name.includes(a.bearing.model.split(' ')[0]);
  return (FM_CLASSES[part.for] || []).includes(a.cls);
}

export default {
  render(root, ctx) {
    const { store, S, M } = ctx;
    const A = analyse(store, M, S);
    const { sites, parts, needs, below, moves, buys, zero, transfers } = A;
    const short = needs.filter(n => n.status === 'short');
    const onRoad = transfers.filter(x => x.state === 'moving');

    root.innerHTML = String(html`<div class="page sparespage">
      ${pageHead('spares')}
      ${headlineFor(A, store, M)}
      ${doThis([
        short.length ? html`Find the red row in the stock table ${marker(1)}: a part an open alert needs that is not at the machine's plant.`
          : html`Scan the stock table ${marker(1)}: grey numbers are fine, amber marks a plant below its reorder point.`,
        html`Read Nirantar's suggestions ${marker(2)}: moves between plants come first (nothing to buy), then purchases. You decide; each button only logs a request.`,
        html`Approve the repair and its transfer on <a href="#/orders">5 · Work Orders</a>, then follow it on the road ${marker(3)}.`])}

      <section class="cols-4" aria-label="Spares in numbers">
        ${kpi({ label: 'Stock on hand', value: inr(A.value), mean: `${parts.length} spare types across ${sites.length} plants`, tip: 'Units on the shelf × unit cost, all plants together.' })}
        ${kpi({ label: 'Short for open alerts', value: short.length, tone: short.length ? 'act' : '', mean: short.length ? 'needed by a failing machine, not at its plant' : 'every alert has its part where it is needed', tip: 'A part an open alert needs (from its failure mode) with zero stock at that machine\'s plant.' })}
        ${kpi({ label: 'Below reorder point', value: below.length, tone: below.length ? 'watch' : '', mean: 'plant stock levels under their minimum', tip: 'Counted only at plants that have machines the part fits. Reorder point = the minimum each plant keeps on the shelf.' })}
        ${kpi({ label: 'On the road', value: onRoad.length, mean: onRoad.length ? `next arrives ${shortDT(Math.min(...onRoad.map(x => x.eta)))}` : 'no transfer travelling now', tip: 'Transfers released by an approved work order and not yet arrived.' })}
      </section>

      ${stockCard(A, store)}

      <div class="sp-grid">
        ${suggestCard(A, store)}
        <div class="stack-lg">
          ${transferCard(A, store, M)}
          ${routeCard(A, store, M)}
        </div>
      </div>

      ${howCard(A, store, M)}
      ${nextBack('spares')}
    </div>`);

    return delegate(root, {
      req: el => {
        const p = parts.find(x => x.id === el.dataset.part);
        if (!p) return;
        const kind = el.dataset.kind, detail = el.dataset.detail;
        const name = store.prefs.name || 'You';
        S.audit(name, REQ[kind], p.id, detail, 'human');
        S.changed('spares');
        S.toast({ kind: 'ok', title: kind === 'buy' ? 'Purchase request logged (demo)' : 'Transfer request logged (demo)',
          body: `${detail}. Nothing is ordered or moved in this demo; the request is in the audit log with your name.`, href: '#/trust' });
      },
    });
  },
};

// ---------- the numbers behind the page ----------
function analyse(store, M, S) {
  const W = store.world, st = store.state, now = st.simNow;
  const sites = W.sites, parts = W.parts;
  const fitN = {};
  for (const p of parts) { fitN[p.id] = {}; for (const s of sites) fitN[p.id][s.id] = W.assets.filter(a => a.siteId === s.id && fits(a, p)).length; }

  // parts that open alerts need (from the alert's failure mode; a sensor alert needs a spare accelerometer)
  const needs = [];
  for (const al of S.openAlerts()) {
    if (al.type === 'CONSEQUENCE') continue;          // the root-cause machine carries the repair
    const partId = al.type === 'SENSOR' ? 'SP-090' : FAILURE_MODES[al.mode]?.part;
    const part = parts.find(p => p.id === partId);
    if (!part) continue;
    const a = M.assetById(al.assetId);
    const wo = al.woId ? st.workOrders.find(w => w.id === al.woId) : null;
    const released = wo && ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'].includes(wo.status);
    const local = part.stock[a.siteId] || 0;
    let status;
    if (released && wo.part && wo.part.kind !== 'local') status = wo.partArrived || (wo.eta && now >= wo.eta) ? 'arrived' : 'moving';
    else if (released) status = 'reserved';
    else status = local > 0 ? 'local' : 'short';
    const plan = al.mode ? M.partPlan(a, al.mode) : { part, from: a.siteId, etaH: 0, kind: 'local' };
    needs.push({ al, a, part, wo, local, plan, status });
  }

  // transfers released (or proposed) by work orders
  const transfers = st.workOrders.filter(w => w.part && w.part.kind === 'transfer' && w.status !== 'REJECTED').map(w => {
    const a = M.assetById(w.assetId);
    const ap = w.approvals.find(x => x.action === 'Approved');
    const pending = w.status === 'PENDING_APPROVAL';
    const arrived = !pending && (w.partArrived || (w.eta && now >= w.eta));
    return { wo: w, a, from: M.siteById(w.part.from), to: M.siteById(a.siteId), h: w.part.etaH, startAt: ap ? ap.at : null, eta: pending ? null : w.eta,
      state: pending ? 'proposed' : arrived ? (w.status === 'DONE' ? 'used' : 'arrived') : 'moving' };
  }).sort((x, y) => ({ moving: 0, proposed: 1, arrived: 2, used: 3 }[x.state] - { moving: 0, proposed: 1, arrived: 2, used: 3 }[y.state]));

  // plant stock below its reorder point (only where the part fits a machine)
  const below = [];
  for (const p of parts) for (const s of sites) {
    const q = p.stock[s.id] || 0;
    if (fitN[p.id][s.id] > 0 && q < p.reorder) below.push({ p, s, q, need: p.reorder - q + 1 });
  }

  // suggestions: move surplus between plants first, buy the rest. Stock earmarked for a pending transfer is kept back.
  const moves = [], buyMap = new Map();
  for (const p of parts) {
    const surplus = {};
    for (const s of sites) {
      const earmarked = st.workOrders.filter(w => w.status === 'PENDING_APPROVAL' && w.part && w.part.kind === 'transfer' && w.part.id === p.id && w.part.from === s.id).length;
      surplus[s.id] = (p.stock[s.id] || 0) - (fitN[p.id][s.id] > 0 ? p.reorder : 0) - earmarked;
    }
    for (const b of below.filter(x => x.p === p)) {
      let need = b.need;
      const donors = sites.filter(s => s.id !== b.s.id && surplus[s.id] > 0)
        .sort((x, y) => surplus[y.id] - surplus[x.id] || transferH(x.id, b.s.id) - transferH(y.id, b.s.id));
      for (const d of donors) {
        if (need <= 0) break;
        const q = Math.min(need, surplus[d.id]);
        surplus[d.id] -= q; need -= q;
        moves.push({ p, from: d, to: b.s, qty: q, h: transferH(d.id, b.s.id), have: b.q, usedAtFrom: fitN[p.id][d.id] > 0 });
      }
      if (need > 0) {
        const e = buyMap.get(p.id) || { p, qty: 0, at: [] };
        e.qty += need; e.at.push({ s: b.s, qty: need }); buyMap.set(p.id, e);
      }
    }
  }
  const urgent = new Set(needs.filter(n => n.status === 'short').map(n => n.part.id));
  const buys = [...buyMap.values()].sort((x, y) => (urgent.has(y.p.id) - urgent.has(x.p.id)) || (y.qty * y.p.unitCost - x.qty * x.p.unitCost));
  moves.sort((x, y) => (urgent.has(y.p.id) - urgent.has(x.p.id)) || x.h - y.h);
  const zero = parts.filter(p => sites.every(s => !(p.stock[s.id] > 0)));
  const value = parts.reduce((sum, p) => sum + sites.reduce((n, s) => n + (p.stock[s.id] || 0), 0) * p.unitCost, 0);
  return { sites, parts, fitN, needs, transfers, below, moves, buys, zero, value, urgent };
}

const requested = (store, kind, partId, detail) => store.state.audit.find(r => r.action === REQ[kind] && r.target === partId && r.detail === detail);

// ---------- headline ----------
function headlineFor(A, store, M) {
  const short = A.needs.filter(n => n.status === 'short');
  const moving = A.needs.filter(n => n.status === 'moving');
  const restock = A.below.length ? html` ${A.below.length} plant stock level${A.below.length > 1 ? 's are' : ' is'} below the reorder point; Nirantar suggests ${A.moves.length} move${A.moves.length === 1 ? '' : 's'} between plants and ${A.buys.length} purchase${A.buys.length === 1 ? '' : 's'} below.` : '';
  if (short.length) {
    const bits = short.map(n => {
      const site = M.siteById(n.a.siteId);
      const src = n.plan && n.plan.kind === 'transfer' ? html`<b>${M.siteById(n.plan.from).name}</b> has ${n.plan.qty} (<b>${n.plan.etaH} h</b> by road)`
        : html`no plant has one, so it must be bought (<b>${n.part.leadDays} days</b>)`;
      return html`the <b>${lc1(n.part.name)}</b> has 0 in ${site.city} and is needed by <b>${n.a.id}</b>; ${src}`;
    });
    const wo = short.find(n => n.wo && n.wo.status === 'PENDING_APPROVAL');
    return headline(html`<b>${short.length} part${short.length > 1 ? 's are' : ' is'} short:</b> ${bits.map((b, i) => html`${i ? '; ' : ''}${b}`)}.${wo ? html` Nirantar has already drafted the ${wo.plan && wo.plan.kind === 'transfer' ? 'transfer' : 'order'} in <a href="#/orders/${wo.wo.id}">${wo.wo.id}</a>: approve it on 5 · Work Orders.` : ''}`, 'act');
  }
  if (moving.length) {
    const n = moving[0];
    return headline(html`<b>No part is short.</b> The ${lc1(n.part.name)} for <b>${n.a.id}</b> is on the road from ${M.siteById(n.wo.part.from).city} and arrives <b>${dateTime(n.wo.eta)}</b> (${inHours(n.wo.eta, store.state.simNow)}).${restock}`, A.below.length ? 'watch' : 'ok');
  }
  if (A.needs.length) return headline(html`<b>Yes: every part the open alerts need is on the shelf where it is needed</b> (${A.needs.map(n => n.a.id).join(', ')}).${restock}`, A.below.length ? 'watch' : 'ok');
  return headline(html`<b>No machine needs a part right now.</b> ${inr(A.value)} of spares sits across ${A.sites.length} plants.${restock}`, A.below.length ? 'watch' : 'ok');
}

// ---------- stock matrix ----------
// What one plant's shelf means for one part: needed by an open alert (act), below reorder (watch), or neutral.
function cellInfo(A, p, s) {
  const q = p.stock[s.id] || 0;
  const used = A.fitN[p.id][s.id] > 0;
  const here = A.needs.filter(n => n.part.id === p.id && n.a.siteId === s.id);
  const ids = here.map(n => n.a.id).join(', ');
  if (here.some(n => n.status === 'short')) return { q, used, tone: 'act', icon: 'alert', text: `Needed: ${ids}` };
  if (here.some(n => n.status === 'moving')) return { q, used, tone: '', icon: 'truck', text: `On the way for ${ids}` };
  if (here.length) return { q, used, tone: '', icon: 'check', text: `Covers ${ids}` };
  if (used && q < p.reorder) return { q, used, tone: 'watch', icon: 'info', text: 'Below reorder' };
  if (!used) return { q, used, tone: 'unused', icon: '', text: q ? 'Group spare' : 'No machine here' };
  return { q, used, tone: '', icon: '', text: '' };
}
function stockCard(A, store) {
  const { sites, parts, fitN, needs, urgent } = A;
  const rows = [...parts].sort((x, y) => urgent.has(y.id) - urgent.has(x.id));
  const cell = (p, s) => {
    const c = cellInfo(A, p, s);
    const tag = c.tone === 'act' ? stateChip('act', c.text) : c.tone === 'watch' ? stateChip('watch', c.text)
      : c.tone === 'unused' ? html`<span class="xs dim">${c.text}</span>` : c.text ? html`<span class="state normal">${icon(c.icon)}${c.text}</span>` : '';
    return html`<td class="n sp-cell ${c.used ? '' : 'unused'}"><b class="qty">${c.q}</b>${tag ? html`<span class="tagline">${tag}</span>` : ''}</td>`;
  };
  const fmOf = p => (p.for === 'SENSOR' ? 'sensor faults' : lc1(FAILURE_MODES[p.for]?.name || ''));
  // phone: one card per part with the three plants side by side (no sideways scrolling)
  const cards = html`<ul class="sp-cards">${rows.map(p => {
    const total = sites.reduce((n, s) => n + (p.stock[s.id] || 0), 0);
    return html`<li class="sp-pc ${urgent.has(p.id) ? 'row-act' : ''}">
      <div class="pc-head"><b>${p.name}</b><span class="xs dim"><span class="mono">${p.id}</span> · for ${fmOf(p)}</span></div>
      <div class="pc-plants">${sites.map(s => {
        const c = cellInfo(A, p, s);
        return html`<div class="pc-cell t-${c.tone || 'none'}"><span class="xs dim">${s.city}</span><b class="qty">${c.q}</b>${c.text ? html`<span class="pc-st">${c.tone === 'unused' ? '' : icon(c.icon)}${c.text}</span>` : ''}</div>`;
      })}</div>
      <p class="xs dim">Reorder point ${p.reorder} · lead time ${p.leadDays} days · ${inr(p.unitCost)} each · ${inr(total * p.unitCost)} on hand</p>
    </li>`;
  })}</ul>`;
  return html`<section class="card" aria-label="Stock by plant">
    <div class="card-head">${marker(1)}<h2>Stock by plant</h2><span class="sub">Units on the shelf now. Red = an open alert needs it there; amber = below the plant's reorder point.</span></div>
    ${cards}
    <div class="table-wrap sp-table"><table class="table">
      <caption class="visually-hidden">Spare parts stock by plant with reorder point, lead time, unit cost and value on hand</caption>
      <thead><tr><th scope="col" class="sticky-col">Part</th>${sites.map(s => html`<th scope="col" class="n" title="${s.name}">${s.city}</th>`)}
        <th scope="col" class="n">${term('Reorder point', 'The minimum each plant keeps on the shelf for machines the part fits. Below it, Nirantar suggests a move or a purchase.')}</th>
        <th scope="col" class="n">${term('Lead time', 'Days the supplier needs to deliver a new one. Moving one between plants by road is quicker: 30 to 60 h.')}</th>
        <th scope="col" class="n">Unit cost</th><th scope="col" class="n">Value on hand</th></tr></thead>
      <tbody>${rows.map(p => {
        const total = sites.reduce((n, s) => n + (p.stock[s.id] || 0), 0);
        const fm = fmOf(p);
        return html`<tr class="${urgent.has(p.id) ? 'row-act' : ''}">
          <th scope="row" class="sticky-col"><span class="p-name">${p.name}</span><span class="xs dim"><span class="mono">${p.id}</span> · for ${fm}</span></th>
          ${sites.map(s => cell(p, s))}
          <td class="n">${p.reorder}</td><td class="n">${p.leadDays} days</td><td class="n">${inr(p.unitCost)}</td><td class="n">${inr(total * p.unitCost)}</td>
        </tr>`;
      })}</tbody>
      <tfoot><tr><th scope="row" class="sticky-col">All spares</th>${sites.map(s => html`<td class="n">${parts.reduce((n, p) => n + (p.stock[s.id] || 0), 0)}</td>`)}<td></td><td></td><td></td><td class="n"><b>${inr(A.value)}</b></td></tr></tfoot>
    </table></div>
    <p class="chart-caption">"No machine here": the plant has no machine this spare fits, so it keeps no minimum. "Group spare": a unit kept at such a plant, available to the others by road.</p>
  </section>`;
}

// ---------- suggestions ----------
function suggestCard(A, store) {
  const { moves, buys, zero, needs } = A;
  const pendingShort = needs.filter(n => n.status === 'short' && n.wo && n.wo.status === 'PENDING_APPROVAL');
  const btn = (kind, p, detail) => {
    const done = requested(store, kind, p.id, detail);
    return done ? html`<span class="state ok">${icon('check')}Requested by ${done.actor}, ${shortDT(done.ts)}</span>`
      : html`<button type="button" class="btn sm" data-action="req" data-kind="${kind}" data-part="${p.id}" data-detail="${detail}">${icon(kind === 'buy' ? 'doc' : 'truck')} ${kind === 'buy' ? 'Create purchase request' : 'Request transfer'}</button>`;
  };
  return html`<section class="card ai" aria-label="Suggestions">
    <div class="card-head">${marker(2)}<h2>What to do about stock</h2>${aiChip('Suggested by Nirantar')}</div>
    <p class="small muted">Proposals only: a person decides. In this demo the buttons write a request to the audit log; nothing is ordered or moved.</p>

    ${pendingShort.length ? html`<div class="sg-urgent">${pendingShort.map(n => html`<p>${stateChip('act', 'Urgent')} <b>${n.a.id}</b> needs the ${lc1(n.part.name)} now. The transfer is already in <a href="#/orders/${n.wo.id}">${n.wo.id}</a>, waiting for your approval.</p>`)}</div>` : ''}

    <h3 class="h-sub">Move between plants <span class="dim">(nothing to buy)</span></h3>
    ${moves.length ? html`<ul class="sg-list">${moves.map(m => {
      const detail = `${m.qty} × ${m.p.name}: ${m.from.city} → ${m.to.city} (${m.h} h by road)`;
      return html`<li><div class="sg-what"><span><b>Move ${m.qty} × ${m.p.name}</b> from ${m.from.city} to ${m.to.city} <span class="dim">· ${m.h} h by road</span></span><span class="xs dim">${m.to.city} keeps at least ${m.p.reorder} and has ${m.have}; ${m.from.city} ${m.usedAtFrom ? `stays at its own minimum` : 'has no machine it fits'}.</span></div>${btn('move', m.p, detail)}</li>`;
    })}</ul>` : html`<p class="small dim">No moves needed: no plant is short of a part another plant has spare.</p>`}

    <h3 class="h-sub">Buy (reorder) <span class="dim">(order = reorder point − stock + 1)</span></h3>
    ${buys.length ? html`<ul class="sg-list">${buys.map(b => {
      const where = b.at.map(x => `${x.qty} for ${x.s.city}`).join(', ');
      const detail = `${b.qty} × ${b.p.name} (${where}), ${inr(b.qty * b.p.unitCost)}`;
      return html`<li><div class="sg-what"><span><b>Buy ${b.qty} × ${b.p.name}</b> · <span class="mono">${inr(b.qty * b.p.unitCost)}</span></span><span class="xs dim">${where} · supplier lead time ${b.p.leadDays} days${A.urgent.has(b.p.id) ? ' · an open alert needs this part' : ''}</span></div>${btn('buy', b.p, detail)}</li>`;
    })}</ul>
    <p class="small sg-total">Total if all are approved: <b class="mono">${inr(buys.reduce((n, b) => n + b.qty * b.p.unitCost, 0))}</b></p>` : html`<p class="small dim">Nothing to buy: every plant is at or above its reorder point once the moves above are done.</p>`}

    <h3 class="h-sub">Out of stock everywhere</h3>
    ${zero.length ? html`<ul class="sg-list">${zero.map(p => html`<li><div class="sg-what"><span>${stateChip('act', 'None in any plant')} <b>${p.name}</b></span><span class="xs dim">The next failure that needs it waits ${p.leadDays} days for the supplier.</span></div></li>`)}</ul>`
      : html`<p class="small dim">None: every spare is on the shelf in at least one plant.</p>`}
  </section>`;
}

// ---------- transfers ----------
function transferCard(A, store, M) {
  const now = store.state.simNow;
  return html`<section class="card" aria-label="Transfers">
    <div class="card-head">${marker(3)}<h2>Transfers on the road</h2><div class="right"><a class="btn sm" href="#/orders">${icon('orders')} 5 · Work Orders</a></div></div>
    ${A.transfers.length ? html`<ul class="tr-list">${A.transfers.map(x => {
      const prog = x.state === 'moving' && x.startAt ? Math.max(0, Math.min(1, (now - x.startAt) / (x.eta - x.startAt))) : x.state === 'proposed' ? 0 : 1;
      const chip = x.state === 'proposed' ? aiChip('Proposed by Nirantar · needs approval') : x.state === 'moving' ? html`<span class="state normal">${icon('truck')}On the road</span>` : x.state === 'arrived' ? stateChip('ok', 'Arrived') : stateChip('ok', 'Used in the repair');
      return html`<li>
        <div class="tr-head"><b>${x.wo.part.name} × ${x.wo.part.qty || 1}</b>${chip}</div>
        <div class="tr-route"><span>${x.from.city}</span>${icon('arrowR')}<span>${x.to.city}</span></div>
        <p class="xs dim">${x.h} h by road · for ${x.a.id} (<a href="#/orders/${x.wo.id}">${x.wo.id}</a>)</p>
        ${x.state === 'proposed' ? html`<p class="xs dim">Leaves ${x.from.city} as soon as a person approves ${x.wo.id}; arrives ${x.h} h later.</p>`
          : html`<div class="bar ${x.state === 'moving' ? '' : 'ok'}" role="img" aria-label="${Math.round(prog * 100)} % of the trip done"><span style="width:${(prog * 100).toFixed(0)}%"></span></div>
            <p class="xs dim">Left ${shortDT(x.startAt)} · ${x.state === 'moving' ? html`arrives <b>${dateTime(x.eta)}</b> (${inHours(x.eta, now)})` : html`arrived ${shortDT(x.eta)}`}</p>`}
      </li>`;
    })}</ul>` : html`<p class="small dim">No transfers yet. When you approve a work order whose part sits at another plant, the transfer appears here with its departure, arrival and progress.</p>`}
  </section>`;
}

// ---------- route diagram ----------
function routeCard(A, store, M) {
  const { sites } = A;
  const pos = {};
  sites.forEach((s, i) => { pos[s.id] = NODE[s.id] || { x: 60 + i * 100, y: 160, lab: ['middle', 0, 32] }; });
  const shortAt = new Set(A.needs.filter(n => n.status === 'short').map(n => n.a.siteId));
  const pairs = [];
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) pairs.push([sites[i], sites[j]]);
  const flow = (a, b) => A.transfers.filter(x => (x.from.id === a.id && x.to.id === b.id) || (x.from.id === b.id && x.to.id === a.id));
  const now = store.state.simNow;
  let g = '';
  for (const [a, b] of pairs) {
    const pa = pos[a.id], pb = pos[b.id];
    const f = flow(a, b);
    const live = f.find(x => x.state === 'moving'), prop = f.find(x => x.state === 'proposed');
    const stroke = live ? 'var(--ok-fill)' : prop ? 'var(--ai-fill)' : 'var(--line-2)';
    g += `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}" stroke="${stroke}" stroke-width="${live || prop ? 3 : 2}" ${prop && !live ? 'stroke-dasharray="7 5"' : ''} stroke-linecap="round"/>`;
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const h = transferH(a.id, b.id);
    g += `<rect x="${mx - 20}" y="${my - 11}" width="40" height="22" rx="11" fill="var(--panel)" stroke="${stroke}"/><text x="${mx}" y="${my + 4.5}" text-anchor="middle" class="lbl-strong" style="font-size:12.5px">${h} h</text>`;
    const x = live || prop;
    if (x) {
      const from = pos[x.from.id], to = pos[x.to.id];
      const k = live && live.startAt ? Math.max(0.12, Math.min(0.88, (now - live.startAt) / (live.eta - live.startAt))) : 0.22;
      const tx = from.x + (to.x - from.x) * k, ty = from.y + (to.y - from.y) * k;
      g += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="9" fill="${live ? 'var(--ok-fill)' : 'var(--ai-fill)'}" stroke="var(--panel)" stroke-width="2"><title>${live ? 'On the road' : 'Proposed'}: ${x.wo.part.name}, ${x.from.city} to ${x.to.city}</title></circle>`;
      g += `<path d="M${(tx - 4).toFixed(1)},${(ty - 3).toFixed(1)}h5v5h-5zM${(tx + 1).toFixed(1)},${(ty - 1).toFixed(1)}h2l2,2v1h-4z" fill="var(--on-fill)"/>`;
    }
  }
  for (const s of sites) {
    const p = pos[s.id];
    const units = A.parts.reduce((n, pt) => n + (pt.stock[s.id] || 0), 0);
    const bad = shortAt.has(s.id);
    const [anchor, dx, dy] = p.lab;
    if (bad) g += `<circle cx="${p.x}" cy="${p.y}" r="17" fill="none" stroke="var(--act-fill)" stroke-width="2.5" opacity=".55"/>`;
    g += `<circle cx="${p.x}" cy="${p.y}" r="11" fill="${bad ? 'var(--act-fill)' : 'var(--normal)'}" stroke="var(--panel)" stroke-width="3"/>`;
    g += `<text x="${p.x + dx}" y="${p.y + dy}" text-anchor="${anchor}" class="lbl-strong" style="font-size:13.5px">${s.city}</text>`;
    g += `<text x="${p.x + dx}" y="${p.y + dy + 16}" text-anchor="${anchor}" style="font-size:12px">${bad ? 'part short' : units + ' units on hand'}</text>`;
  }
  const svg = `<svg class="chart sp-route" viewBox="0 0 340 322" role="img" aria-label="Road transfer times between the three plants"><title>Road transfer times: ${Object.entries(TRANSFER_H).filter(([k]) => k.split('>')[0] < k.split('>')[1]).map(([k, v]) => `${k.replace('>', ' to ')} ${v} h`).join(', ')}</title>${g}</svg>`;
  return html`<section class="card" aria-label="Plant routes">
    <div class="card-head"><h2>Road routes between plants</h2></div>
    <div class="sp-route-wrap">${raw(svg)}</div>
    <div class="legend sp-legend"><span><span class="sw normal"></span>Plant</span><span><span class="sw act"></span>Part short here</span><span><span class="sw ok"></span>Transfer on the road</span><span><span class="sw ai"></span>Proposed, needs approval</span></div>
    <p class="chart-caption">Schematic, not to scale. Hours are road transfer times used to pick the source of a part.</p>
  </section>`;
}

// ---------- how the source is picked ----------
function howCard(A, store, M) {
  const ex = A.needs.find(n => n.plan && n.plan.kind !== 'local' && n.status !== 'local') || A.needs.find(n => n.al.mode);
  let example = '';
  if (ex) {
    const site = M.siteById(ex.a.siteId);
    const stock = A.sites.map(s => `${s.city} ${ex.part.stock[s.id] || 0}`).join(', ');
    const p = ex.plan;
    example = html`<p class="small"><b>Today's example:</b> ${ex.a.id} in ${site.city} needs the ${lc1(ex.part.name)}. Stock now: ${stock}. ${p.kind === 'local' ? html`${site.city} has one, so it is used straight away.`
      : p.kind === 'transfer' ? html`${site.city} has none, so Nirantar takes the fastest road transfer from a plant that has one: <b>${M.siteById(p.from).city}, ${p.etaH} h</b>.`
      : html`No plant has one, so it must be bought: <b>${ex.part.leadDays} days</b>.`}</p>`;
  }
  const routes = Object.entries(TRANSFER_H).filter(([k]) => k.split('>')[0] < k.split('>')[1]).map(([k, v]) => { const [a, b] = k.split('>'); return `${M.siteById(a).city} ↔ ${M.siteById(b).city} ${v} h`; }).join(' · ');
  return html`<section class="card" aria-label="How Nirantar picks the source">
    <div class="card-head"><h2>How Nirantar picks where a part comes from</h2>${aiChip('Done by Nirantar')}</div>
    <ol class="how-list">
      <li><b>Local first.</b> If the machine's own plant has one on the shelf, it is used: no waiting.</li>
      <li><b>Otherwise the fastest road transfer</b> from a plant that has one in stock (${routes}).</li>
      <li><b>If no plant has one, buy it</b> from the supplier: the lead time is in days (for example ${A.parts[0].leadDays} days for the ${lc1(A.parts[0].name)}).</li>
    </ol>
    ${example}
    <p class="small">${humanChip('Your decision')} Nirantar never moves or orders stock on its own: a transfer is released only when a named person approves the work order (Policy G8), and it is written to the audit log.</p>
  </section>`;
}
