// Step 4 · Decide: fix it now or wait for a planned window?
// Wait slider → chance it breaks first (from the time-to-failure estimate) → expected loss vs the planned repair,
// a 7-day production calendar with the recommended low-impact window, and three options with Nirantar's pick.
import { html, icon, delegate } from '../ui/dom.js';
import { lineChart, barsH } from '../ui/charts.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, term, nextBack, caseStrip, confPct, attentionBadge } from '../ui/components.js';
import { inr, hours, time, day, weekday, dateTime, HOUR, DAY } from '../core/format.js';
import { FAILURE_MODES } from '../core/generator.js';

let ui = { days: 3, pending: false, dragging: false, wChart: 0, wBars: 0 };
let lastCtx = null;

const fmtDays = d => (d === 1 ? '1 day' : `${Number.isInteger(d) ? d : d.toFixed(1)} days`);
const pctTxt = p => (p >= 0.995 ? '99 %' : p < 0.01 ? (p > 0 ? '< 1 %' : '0 %') : Math.round(p * 100) + ' %');
const istMidnight = ms => Math.floor((ms + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;

export default {
  autoRerender: false,   // the slider must not be replaced mid-drag by a clock tick
  onStore() {
    if (!lastCtx) return;
    const a = document.activeElement;
    if (ui.dragging || (a && a.id === 'wif-days')) { ui.pending = true; return; }
    lastCtx.rerender();
  },
  render(root, ctx) {
    lastCtx = ctx;
    const { store, S, M, params } = ctx;
    const W = store.world, t = store.t, now = store.state.simNow;
    const open = S.openAlerts();

    // ---- which machine ----
    const rankedAlerts = open.map(al => { const a = M.assetById(al.assetId); return { al, a, att: S.attention(a, M.assess(a, t)) }; }).sort((p, q) => q.att.score - p.att.score);
    let id = params[0] && M.assetById(params[0]) ? params[0] : null;
    if (!id) {
      const hero = W.scenario.hero;
      const firstFix = rankedAlerts.find(x => x.al.type === 'FAILURE' && x.al.status !== 'SHELVED');
      id = (hero && open.some(al => al.assetId === hero) && hero) || firstFix?.a.id || rankedAlerts[0]?.a.id || hero || W.assets[0].id;
    }
    const a = M.assetById(id), ass = M.assess(a, t);
    const alert = open.find(al => al.assetId === a.id);
    const kind = alert?.type === 'CONSEQUENCE' ? 'consequence' : ass.state === 'sensor' ? 'sensor' : ass.mode && ass.state !== 'normal' ? 'decide' : 'normal';

    const picker = machinePicker(W, M, t, rankedAlerts, a.id);
    const head = [pageHead('whatif'), caseStrip(a.id), picker];

    if (kind !== 'decide') {
      root.innerHTML = String(html`<div class="page wif">${head}${nothingToDecide(kind, a, ass, alert, ctx, rankedAlerts)}${nextBack('whatif')}</div>`);
      return delegate(root, { pick: (el, ev) => { if (ev.type === 'change') ctx.navigate('#/whatif/' + el.value); } }, ['click', 'change']);
    }

    // ---- the decision model (all from the shared model) ----
    const mode = ass.mode, fm = FAILURE_MODES[mode];
    const ex = M.exposure(a, mode), pc = M.plannedCost(a, mode), plan = M.partPlan(a, mode);
    const etaH = plan ? plan.etaH : 0;
    const partAt = now + etaH * HOUR;
    const readyAt = partAt + HOUR;                          // one hour to stage the part, as the work-order draft does
    const durH = Math.max(4, Math.ceil(fm.repairH + 2));
    const wo = store.state.workOrders.find(w => w.assetId === a.id && w.kind === 'REPAIR' && !['REJECTED', 'DONE'].includes(w.status));
    const approved = wo && wo.window && wo.approvals.length ? wo : null;
    const win = approved ? approved.window : M.planWindow(readyAt, ass.failAt, durH);
    const dWin = Math.max(0, (win.start - now) / DAY);
    const C = { a, ass, fm, ex, pc, plan, etaH, partAt, readyAt, durH, win, dWin, approved, wo, now, t, M };
    if (ui.days < 0 || ui.days > 14) ui.days = 3;

    const slots = d => dynamic(C, d);
    const D = slots(ui.days);
    const siteCity = M.siteById(a.siteId).city;

    root.innerHTML = String(html`<div class="page wif">
      ${head}
      <div data-slot="headline">${D.headline}</div>
      <div class="row">${aiChip('Nirantar priced the risk and picked the window')}${humanChip('Your decision: approve the repair')}</div>
      ${doThis([
        html`Move the <b>Wait</b> slider ${marker(1)} to see how fast the risk grows each day you wait.`,
        html`Read the three options ${marker(2)}: Nirantar marks the one with the lowest expected total cost.`,
        html`Go to <b>5 · Work Orders</b> ${marker(3)} and approve the repair with your name.`,
      ])}

      <div class="wif-grid">
        <section class="card" aria-label="Chance it breaks while you wait">
          <div class="card-head">${marker(1)}<h2>How long can it wait?</h2>${aiChip('Predicted by Nirantar')}</div>
          <div class="wif-slider">
            <label for="wif-days" class="wif-slider-label"><span>Wait</span> <output id="wif-out" class="mono" data-slot="out">${fmtDays(ui.days)}</output></label>
            <input type="range" id="wif-days" min="0" max="14" step="0.5" value="${ui.days}" data-action="days" aria-describedby="wif-readout">
            <div class="wif-scale xs dim" aria-hidden="true"><span>repair now</span><span>1 week</span><span>2 weeks</span></div>
          </div>
          <p id="wif-readout" class="wif-readout" data-slot="readout" aria-live="polite">${D.readout}</p>
          <div data-slot="chart">${D.chart}</div>
          <p class="wif-tip small"><b>Note:</b> the ${term('failure confidence', 'How sure Nirantar is that a real failure is developing (all related sensors agree, the trend is steady). It says nothing about when.')} of <b>${confPct(ass.conf)}</b> is how sure we are that a failure is developing, not when. This page uses the ${term('time-to-failure estimate', 'When the worst sensor reaches its trip level at the current rate, with an 80 % range.')}: about <b>${hours(ass.rulH)}</b>${ass.rulKind === 'trend' ? ` (likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)})` : ' (normal wear)'}.</p>
          <div class="wif-tip small">${term('Chance of failing while we wait', 'Read from the time-to-failure estimate itself: half of similar machines fail before the middle value, 10 % before the low end of the range and 90 % before the high end. It is for comparing options, not an exact forecast.')}: read from the time-to-failure estimate (${ass.rulKind === 'trend' ? `10 % by ${hours(ass.rulLo)}, 50 % by ${hours(ass.rulH)}, 90 % by ${hours(ass.rulHi)}` : 'normal wear'}).
            Expected loss = chance × the ${inr(ex.inr)} a breakdown would cost.</div>
        </section>

        <section class="card" aria-label="What waiting costs">
          <div class="card-head"><h2>What waiting costs</h2><span class="sub">planned repair vs expected loss</span></div>
          <div data-slot="bars">${D.bars}</div>
          <dl class="dl wif-dl">
            <dt>Planned repair</dt><dd><b class="mono">${inr(pc.total)}</b>: part ${inr(pc.parts)} + labour ${inr(pc.labour)} (2 technicians, ${fm.repairH} h, ${fm.sop})</dd>
            <dt>Breakdown</dt><dd><b class="mono">${inr(ex.inr)}</b>: ${hours(ex.downH)} down (${etaH ? `${etaH} h waiting for the part from ${M.siteById(plan.from).city} + ` : ''}${fm.repairH} h repair) × ${inr(ex.costPerH)}/h of ${M.lineById(a.lineId).name} output</dd>
          </dl>
        </section>
      </div>

      ${calendarCard(C, siteCity)}

      <section class="card" aria-label="Your options">
        <div class="card-head">${marker(2)}<h2>Your options</h2><span class="sub">expected total = expected loss + repair cost</span></div>
        <div data-slot="options">${D.options}</div>
        <div class="wif-approve">
          ${humanChip('Your decision')}
          ${approved
            ? html`<p class="small"><span class="state ok">${icon('check')}Approved by ${approved.approvals[0].by}</span> ${approved.id} is scheduled for ${dateTime(approved.window.start)}.</p><a class="btn primary" href="#/orders">${icon('orders')}See it on 5 · Work Orders</a>`
            : html`<p class="small muted">Nirantar never releases a repair by itself. ${wo ? html`Its draft <b class="nw">${wo.id}</b> already holds the part, the technician and this window.` : 'Ask it to draft the work order on 3 · Alert Triage.'}</p>
              <span class="wif-go">${marker(3)}<a class="btn primary lg" href="#/orders">${icon('orders')}Go to 5 · Work Orders to approve</a></span>`}
        </div>
      </section>

      ${nextBack('whatif')}
    </div>`);

    const update = d => {
      const N = slots(d);
      for (const k of ['headline', 'readout', 'chart', 'bars', 'options']) { const el = root.querySelector(`[data-slot="${k}"]`); if (el) el.innerHTML = String(N[k]); }
      const out = root.querySelector('[data-slot="out"]'); if (out) out.textContent = fmtDays(d);
    };
    const measure = () => {
      const c = root.querySelector('[data-slot="chart"]'), b = root.querySelector('[data-slot="bars"]');
      const wc = c ? c.clientWidth : 0, wb = b ? b.clientWidth : 0;
      if (wc && wb && (Math.abs(wc - ui.wChart) > 4 || Math.abs(wb - ui.wBars) > 4)) { ui.wChart = wc; ui.wBars = wb; update(ui.days); }
    };
    measure();
    let rT = null;
    const onResize = () => { clearTimeout(rT); rT = setTimeout(measure, 150); };
    window.addEventListener('resize', onResize);
    const down = ev => { if (ev.target.id === 'wif-days') ui.dragging = true; };
    const up = () => { ui.dragging = false; };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const off = delegate(root, {
      pick: (el, ev) => { if (ev.type === 'change') ctx.navigate('#/whatif/' + el.value); },
      days: (el, ev) => {
        if (ev.type === 'input') { ui.days = +el.value; update(ui.days); }
        else if (ev.type === 'focusout' && ui.pending && !ui.dragging) { ui.pending = false; ctx.rerender(); }
      },
    }, ['click', 'change', 'input', 'focusout']);
    return () => { off(); clearTimeout(rT); window.removeEventListener('resize', onResize); root.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  },
};

// ---------- machine picker ----------
function machinePicker(W, M, t, rankedAlerts, cur) {
  const withAlert = [...new Set(rankedAlerts.map(x => x.a.id))];
  const rest = W.assets.filter(a => !withAlert.includes(a.id)).map(a => ({ a, ass: M.assess(a, t) }));
  const watch = rest.filter(x => x.ass.state !== 'normal').sort((p, q) => q.ass.conf - p.ass.conf);
  const normal = rest.filter(x => x.ass.state === 'normal');
  const opt = (a, extra) => html`<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${a.id} · ${a.name}${extra ? ` (${extra})` : ''}</option>`;
  return html`<div class="wif-pick card">
    <label for="wif-machine" class="small"><b>Machine</b></label>
    <select id="wif-machine" class="input" data-action="pick">
      ${withAlert.length ? html`<optgroup label="Open alerts">${withAlert.map(id => { const x = rankedAlerts.find(r => r.a.id === id); return opt(x.a, x.al.type === 'CONSEQUENCE' ? `knock-on from ${x.al.rootCause}` : x.al.type === 'SENSOR' ? 'sensor check' : `attention ${x.att.score.toFixed(2)}`); })}</optgroup>` : ''}
      ${watch.length ? html`<optgroup label="Watch list">${watch.map(x => opt(x.a, 'watch'))}</optgroup>` : ''}
      <optgroup label="Normal machines">${normal.map(x => opt(x.a, ''))}</optgroup>
    </select>
    <span class="xs dim">Machines with open alerts come first.</span>
  </div>`;
}

// ---------- the parts that follow the slider ----------
function dynamic(C, days) {
  const { a, ass, ex, pc, win, dWin, etaH, partAt, now, M, approved } = C;
  const w = M.whatIf(ass.rulH, days, ex.inr);
  const fixNow = w.expectedLoss > pc.total;
  const tone = ass.state === 'act' || fixNow ? 'act' : 'watch';
  const winTxt = `${dateTime(win.start)}`;

  let headlineHtml;
  if (days === 0) headlineHtml = headline(html`${approved ? html`<b>The repair is approved</b> for ${winTxt}.` : html`<b>Repair ${a.id} in the recommended window</b>, ${winTxt}${etaH ? html`, right after the part arrives from ${M.siteById(C.plan.from).city}` : ''}.`} It costs <b>${inr(pc.total)}</b> and heads off the <b>${inr(ex.inr)}</b> breakdown. Move the slider to see what waiting would add.`, tone);
  else if (fixNow) headlineHtml = headline(html`<b>Fix it now.</b> Waiting <b>${fmtDays(days)}</b> gives a <b>${pctTxt(w.p)}</b> chance it breaks first and an expected loss of <b>${inr(w.expectedLoss)}</b>, versus a planned repair of <b>${inr(pc.total)}</b>.`, 'act');
  else headlineHtml = headline(html`<b>Waiting ${fmtDays(days)} is affordable.</b> It gives a <b>${pctTxt(w.p)}</b> chance it breaks first and an expected loss of <b>${inr(w.expectedLoss)}</b>, less than the planned repair of <b>${inr(pc.total)}</b>. Book the repair into a low-impact window; Nirantar warns you if the trend speeds up.`, 'watch');

  const readout = html`<b>${fmtDays(days)}</b>: <b class="${fixNow ? 'act' : 'watch'}">${pctTxt(w.p)}</b> chance it breaks first · expected loss <b>${inr(w.expectedLoss)}</b>`;

  // chart: chance of failure vs days waited
  const wC = Math.round(Math.max(300, Math.min(760, ui.wChart || 640))), wB = Math.round(Math.max(300, Math.min(640, ui.wBars || 420)));
  const narrow = wC < 480;
  const pts = [];
  for (let d = 0; d <= 14.0001; d += 0.25) pts.push([d, M.whatIf(ass.rulH, d, ex.inr).p * 100]);
  const vbands = dWin <= 14 ? [{ x0: dWin, x1: Math.min(14, dWin + (win.end - win.start) / DAY), tone: 'ok', label: approved ? 'Scheduled' : 'Recommended', opacity: 0.35 }] : [];
  const chart = lineChart({
    title: `Chance that ${a.id} breaks before the repair, by days waited`, w: wC, h: narrow ? 230 : 250, padL: 40, padR: narrow ? 60 : 72,
    series: [{ name: 'Chance it breaks first', points: pts, tone: 'ink2', width: 2.2, area: true }],
    xMin: 0, xMax: 14, yMin: 0, yMax: 100, xTicks: 7, xFmt: v => `${Math.round(v)}${narrow ? '' : ' d'}`, yFmt: v => `${v} %`,
    limits: [{ y: 50, label: 'coin flip', tone: 'normal' }],
    vbands,
    annotations: [{ x: days, y: w.p * 100, label: `${fmtDays(days)}: ${pctTxt(w.p)}`, tone: fixNow ? 'act' : 'watch' }],
  });
  const chartHtml = html`${chart}<p class="chart-caption">Days waited (0 to 14, across) against the chance it breaks before the repair. The green band is the ${approved ? 'scheduled' : 'recommended'} window; above the dashed line, a breakdown is more likely than not.</p>`;

  const bars = barsH({
    title: 'Planned repair cost versus expected loss and a breakdown', w: wB, labelW: Math.min(190, Math.round(wB * 0.42)), rowH: 32,
    items: [
      { label: 'Planned repair', value: pc.total, tone: 'normal' },
      { label: `Expected loss, ${fmtDays(days)}`, value: w.expectedLoss, tone: fixNow ? 'act' : 'watch', strong: true },
      { label: 'Breakdown (no repair)', value: ex.inr, tone: 'act' },
    ], fmt: v => inr(v), max: Math.max(ex.inr, pc.total),
  });

  // options
  const opt = (n, name, when, d, note, feasible = true) => {
    const p = d === Infinity ? 1 : M.whatIf(ass.rulH, d, ex.inr).p;
    const loss = p * ex.inr;
    return { n, name, when, p, loss, cost: pc.total, net: loss + pc.total, note, feasible };
  };
  const early = days < dWin;
  const rows = [
    opt(1, approved ? 'Repair in the scheduled window' : 'Repair in the recommended window', `${dateTime(win.start)} to ${time(win.end)}`, dWin,
      win.beforeFailure ? `${win.reason}; the chance covers the time until the window${etaH ? ', while the part is on its way' : ''}` : 'no low-impact slot before the predicted failure: expedite the part'),
    opt(2, `Wait ${fmtDays(days)}, then repair`, dateTime(now + days * DAY), days,
      early ? (etaH ? `not possible: the part only arrives ${dateTime(partAt)}` : `the first low-impact slot is ${winTxt}, so this is option 1`) : 'repair after the wait you picked with the slider', !early),
    opt(3, 'Run to failure', `breaks about ${dateTime(ass.failAt)}`, Infinity, 'repair after the breakdown; the line stands still meanwhile'),
  ];
  const best = rows.filter(r => r.feasible).sort((p, q) => p.net - q.net)[0];
  const options = html`<div class="table-wrap wif-opts"><table class="table">
    <thead><tr><th scope="col">Option</th><th scope="col" class="n">${term('Chance it breaks first', 'Chance of a breakdown before the repair starts, from the time-to-failure estimate.')}</th><th scope="col" class="n">Expected loss</th><th scope="col" class="n">Repair cost</th><th scope="col" class="n">${term('Expected total', 'Expected loss + repair cost. Lowest is best.')}</th></tr></thead>
    <tbody>${rows.map(r => html`<tr class="${r === best ? 'best' : ''} ${r.feasible ? '' : 'off'}">
      <td data-label="Option"><div class="wif-oname"><span class="marker-sm mono">${r.n}</span><b>${r.name}</b>${r === best ? aiChip('Nirantar recommends') : ''}</div><div class="xs dim">${r.when} · ${r.note}</div></td>
      ${r.feasible ? html`<td class="n" data-label="Chance it breaks first">${r.n === 3 ? 'certain' : pctTxt(r.p)}</td><td class="n" data-label="Expected loss">${inr(r.loss)}</td><td class="n" data-label="Repair cost">${inr(r.cost)}</td><td class="n" data-label="Expected total"><b>${inr(r.net)}</b></td>`
        : html`<td class="n" colspan="4" data-label="">–</td>`}
    </tr>`)}</tbody></table></div>
    ${best ? html`<p class="small wif-verdict">${icon('ai')}<span><b>Nirantar recommends option ${best.n}</b>: expected total <b>${inr(best.net)}</b>, ${inr(rows[2].net - best.net)} less than running to failure.</span></p>` : ''}`;

  return { headline: headlineHtml, readout, chart: chartHtml, bars, options };
}

// ---------- production calendar (next 7 days) ----------
function calendarCard(C, siteCity) {
  const { a, ass, fm, ex, plan, etaH, partAt, readyAt, durH, win, approved, now, t, M } = C;
  const day0 = istMidnight(now);
  const end = day0 + 7 * DAY;
  const failAt = ass.failAt, lo = t + ass.rulLo * HOUR, hi = t + ass.rulHi * HOUR;
  const pos = (ms, ds) => Math.max(0, Math.min(100, (ms - ds) / DAY * 100));
  const seg = (ds, from, to) => { const l = pos(from, ds), r = pos(to, ds); return r > l ? `left:${l.toFixed(2)}%;width:${(r - l).toFixed(2)}%` : null; };
  const SHIFTS = [['C', 0, 6], ['A', 6, 14], ['B', 14, 22], ['C', 22, 24]];
  const LOW = [[2, 6, 'night shift, lowest load'], [14, 18, 'shift changeover']];
  const winLabel = approved ? 'Scheduled' : 'Recommended';
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const ds = day0 + i * DAY, de = ds + DAY;
    const ev = [];
    if (now >= ds && now < de) ev.push(html`<span class="wif-ev ev-now">${icon('clock')}Now ${time(now)}</span>`);
    if (etaH && partAt >= ds && partAt < de) ev.push(html`<span class="wif-ev ev-part">${icon('truck')}Part arrives ${time(partAt)}</span>`);
    if (win.start >= ds && win.start < de) ev.push(html`<span class="wif-ev ev-win">${icon('wrench')}${winLabel} ${time(win.start)}–${time(win.end)}</span>`);
    if (failAt >= ds && failAt < de) ev.push(html`<span class="wif-ev ev-fail">${icon('alert')}Predicted failure ${time(failAt)}</span>`);
    rows.push(html`<div class="wif-day ${ev.length ? 'has-ev' : ''}">
      <div class="wif-dlabel"><b>${weekday(ds)}</b> <span>${day(ds)}</span></div>
      <div class="wif-track" role="img" aria-label="${weekday(ds)} ${day(ds)}: shifts A 06–14, B 14–22, C 22–06${ev.length ? '; ' + ev.map(e => String(e).replace(/<[^>]+>/g, '')).join('; ') : ''}">
        ${SHIFTS.map(([s, h0, h1]) => html`<span class="wif-shift s-${s}" style="left:${(h0 / 24 * 100).toFixed(2)}%;width:${((h1 - h0) / 24 * 100).toFixed(2)}%"></span>`)}
        ${LOW.map(([h0, h1, why]) => html`<span class="wif-low" style="left:${(h0 / 24 * 100).toFixed(2)}%;width:${((h1 - h0) / 24 * 100).toFixed(2)}%" title="Low-impact slot: ${why}"></span>`)}
        ${seg(ds, lo, hi) ? html`<span class="wif-range" style="${seg(ds, lo, hi)}"></span>` : ''}
        ${seg(ds, win.start, win.end) ? html`<span class="wif-win" style="${seg(ds, win.start, win.end)}"></span>` : ''}
        ${now >= ds && now < de ? html`<span class="wif-mark m-now" style="left:${pos(now, ds).toFixed(2)}%"></span>` : ''}
        ${etaH && partAt >= ds && partAt < de ? html`<span class="wif-mark m-part" style="left:${pos(partAt, ds).toFixed(2)}%"></span>` : ''}
        ${failAt >= ds && failAt < de ? html`<span class="wif-mark m-fail" style="left:${pos(failAt, ds).toFixed(2)}%"></span>` : ''}
      </div>
      ${ev.length ? html`<div class="wif-evs">${ev}</div>` : ''}
    </div>`);
  }
  const marginH = (failAt - win.end) / HOUR;
  const p1 = M.whatIf(ass.rulH, Math.max(0, (win.start - now) / DAY), ex.inr).p;
  const city = M.siteById(a.siteId).city;
  const partLine = !plan ? html`No spare is needed for this repair.`
    : plan.kind === 'local' ? html`<b>The part</b> (${plan.part.name}) is in stock in ${city}: no waiting.`
    : plan.kind === 'transfer' ? html`<b>The part</b> (${plan.part.name}) is not in stock in ${city}. ${M.siteById(plan.from).city} has ${plan.qty}; the road transfer takes ${etaH} h, so ordered now it arrives <b>${dateTime(partAt)}</b>.`
    : html`<b>The part</b> (${plan.part.name}) is not in stock anywhere: the supplier needs ${plan.part.leadDays} days, so it arrives <b>${dateTime(partAt)}</b>.`;
  return html`<section class="card" aria-label="Production calendar">
    <div class="card-head"><h2>Production calendar, next 7 days</h2>${aiChip(approved ? 'Window approved by a person' : 'Window picked by Nirantar')}<span class="sub">${M.lineById(a.lineId).name}, ${siteCity} · times in IST</span></div>
    <div class="wif-cal">
      <div class="wif-day wif-axis" aria-hidden="true"><div class="xs dim">Shift</div><div class="wif-shiftrow">${SHIFTS.map(([s, h0, h1]) => html`<span class="s-${s}" style="left:${(h0 / 24 * 100).toFixed(2)}%;width:${((h1 - h0) / 24 * 100).toFixed(2)}%">${h1 - h0 >= 6 ? s : ''}</span>`)}</div></div>
      <div class="wif-day wif-axis" aria-hidden="true"><div class="xs dim">Hour</div><div class="wif-hours">${[0, 6, 12, 18, 24].map(h => html`<span style="left:${(h / 24 * 100).toFixed(2)}%">${String(h).padStart(2, '0')}</span>`)}</div></div>
      ${rows}
    </div>
    <div class="legend wif-legend">
      <span><span class="wif-sw sw-shift"></span>Shifts A 06–14 · B 14–22 · C 22–06</span>
      <span><span class="wif-sw sw-low"></span>Low-impact slot (14–18 changeover, 02–06 night)</span>
      <span><span class="wif-sw sw-win"></span>${winLabel} window</span>
      ${etaH ? html`<span><span class="wif-sw sw-part"></span>Part arrives</span>` : ''}
      <span><span class="wif-sw sw-fail"></span>Predicted failure</span>
      <span><span class="wif-sw sw-range"></span>Likely failure range</span>
    </div>
    <div class="wif-why">
      <h3>${approved ? 'Why this window' : 'Why Nirantar picked this window'}</h3>
      <ol>
        <li>${partLine}</li>
        <li><b>The slot</b> ${dateTime(win.start)} to ${time(win.end)} is the first ${win.reason} after the part is ready (one hour after it arrives, to stage it). Low-impact slots cost the least output.</li>
        <li><b>The repair</b> takes about ${fm.repairH} h with two technicians (${fm.sop}); the ${durH} h window leaves room for the test run.</li>
        <li>${win.beforeFailure
          ? html`<b>It ends ${hours(marginH)} before the predicted failure</b> (${dateTime(failAt)}).${win.start > lo ? html` It starts after the earliest likely failure time (${dateTime(lo)}), so there is still a <b>${pctTxt(p1)}</b> chance it breaks first: the only lever is time, so approve today to keep the part moving.` : ''}`
          : html`<b>No low-impact slot fits before the predicted failure</b> (${dateTime(failAt)}). Expedite the part or plan a controlled stop as soon as it arrives.`}</li>
      </ol>
    </div>
  </section>`;
}

// ---------- machines with nothing to decide ----------
function nothingToDecide(kind, a, ass, alert, ctx, rankedAlerts) {
  const { M, store } = ctx;
  const others = rankedAlerts.filter(x => x.al.type === 'FAILURE' && x.a.id !== a.id);
  const links = others.length ? html`<div class="row">${others.slice(0, 4).map(x => html`<a class="btn" href="#/whatif/${x.a.id}">${icon('decide')}${x.a.id}${attentionBadge(x.att)}</a>`)}</div>` : '';
  if (kind === 'consequence') {
    const root = M.assetById(alert.rootCause);
    return html`${headline(html`<b>${a.id} has nothing to repair.</b> Its alarm (${ass.contributions[0].label.toLowerCase()} out of range) is a knock-on from <b>${root.id}</b> (${root.name.toLowerCase()}), which feeds it. Decide on ${root.id} instead: fixing it clears this alarm too.`, 'watch')}
      <section class="card"><div class="card-head"><h2>Decide on the root cause</h2>${aiChip('Grouped by Nirantar')}</div>
        <p class="small muted">When one machine starves many others, every one of them alarms. Repairing each would waste crews; Nirantar traces them back to one root cause.</p>
        <div class="row"><a class="btn primary" href="#/whatif/${root.id}">${icon('decide')}What if for ${root.id}</a><a class="btn" href="#/triage">${icon('alert')}See the grouped alarms on 3 · Alert Triage</a></div></section>`;
  }
  if (kind === 'sensor') {
    const wo = alert && alert.woId ? store.state.workOrders.find(w => w.id === alert.woId) : null;
    return html`${headline(html`<b>${a.id} needs a sensor check, not a repair.</b> ${ass.sensorFault ? ass.sensorFault.reason : 'One reading is frozen'}. The machine itself is running normally, so there is no fix-now-or-wait trade-off${wo ? html`: the inspection costs <b>${inr(wo.costs.total)}</b> and needs no production stop` : ''}.`, 'watch')}
      <section class="card"><div class="card-head"><h2>What happens instead</h2>${aiChip('Routed by Nirantar')}</div>
        <p class="small muted">A flat-lined sensor looks like a healthy machine or a failing one depending on when it froze. Nirantar compares it with the related sensors and sends instrumentation to check it (SOP-50), never a repair crew.</p>
        <div class="row"><a class="btn primary" href="#/orders">${icon('orders')}Approve the inspection on 5 · Work Orders</a></div>${links ? html`<p class="small">Machines with a repair to decide:</p>${links}` : ''}</section>`;
  }
  return html`${headline(html`<b>${a.id} is ${ass.state === 'normal' ? 'normal' : 'on the watch list'}</b> (health ${ass.health}, failure confidence ${confPct(ass.conf)}). There is nothing to decide yet: Nirantar scores it every 15 minutes and will raise an alert, with a drafted repair and a window, as soon as a failure pattern shows.`, ass.state === 'normal' ? 'ok' : 'watch')}
    <section class="card"><div class="card-head"><h2>Nothing to decide here</h2>${stateChip(ass.state)}</div>
      <p class="small muted">This page compares repairing now with waiting, once a machine is heading for a failure. ${others.length ? 'Pick a machine with an open alert:' : 'No machine has an open alert right now. Load the hero scenario or inject a fault on the Presenter page to see a decision.'}</p>
      ${links || html`<div class="row"><button class="btn primary" data-action="load-sample" data-scenario="pune-bearing">${icon('data')}Load the hero scenario</button><a class="btn" href="#/presenter">${icon('play')}Presenter</a></div>`}</section>`;
}
