// Step 1 · Spot: which machine is in trouble? Lanes = production lines, circles = machines, grey = normal.
import { html, icon, delegate, raw } from '../ui/dom.js';
import { pfCurve, sparkline } from '../ui/charts.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, term, kpi, why, nextBack, legendStates, attentionBadge, confPct, caseStrip, STATE_TEXT } from '../ui/components.js';
import { inr, hours, HOUR } from '../core/format.js';

let ui = { site: null, filter: 'all', sel: null, sort: 'attention', showAll: false };

export default {
  render(root, ctx) {
    const { store, S, M, params } = ctx;
    const W = store.world, t = store.t;
    if (!ui.site || !W.sites.find(s => s.id === ui.site)) ui.site = W.scenario.site;
    if (params[0] && W.sites.find(s => s.id === params[0])) ui.site = params[0];
    const site = M.siteById(ui.site);
    const lines = W.lines.filter(l => l.siteId === ui.site);
    const rows = W.assets.filter(a => a.siteId === ui.site).map(a => { const ass = M.assess(a, t); return { a, ass, att: S.attention(a, ass) }; });
    const open = S.openAlerts();
    const hasAlert = id => open.some(al => al.assetId === id);
    const bad = rows.filter(r => r.ass.state !== 'normal').sort((x, y) => y.att.score - x.att.score);
    const act = bad.filter(r => r.ass.state === 'act');
    if (!ui.sel || !rows.find(r => r.a.id === ui.sel)) ui.sel = (bad[0] || rows[0]).a.id;
    const sel = rows.find(r => r.a.id === ui.sel);
    const lineOf = id => M.lineById(id);

    let head;
    if (!bad.length) head = headline(html`<b>All ${rows.length} machines</b> at ${site.name} are normal (grey). Nothing needs attention. Try another plant above, or load a scenario with a fault.`, 'ok');
    else {
      const top = bad[0];
      const conseq = open.filter(al => al.type === 'CONSEQUENCE' && rows.some(r => r.a.id === al.assetId));
      head = headline(conseq.length > 2
        ? html`<b>${bad.length} of ${rows.length}</b> machines are abnormal, but they share <b>one root cause</b>: <b>${conseq[0].rootCause}</b> (${M.assetById(conseq[0].rootCause).name.toLowerCase()}) is failing, so ${conseq.length} machines lose coolant pressure. Fix ${conseq[0].rootCause} first.`
        : html`<b>${act.length || bad.length} of ${rows.length}</b> machines ${act.length === 1 || (!act.length && bad.length === 1) ? 'needs' : 'need'} attention: <b>${top.a.id}</b> on the ${lineOf(top.a.lineId).name} (${STATE_TEXT[top.ass.state].toLowerCase()}${top.ass.modeName ? ', ' + top.ass.modeName.toLowerCase() : ''}). ${rows.length - bad.length} are normal${bad.length > 1 ? html`; ${bad.slice(1).map(b => b.a.id).join(', ')} ${bad.length > 2 ? 'are' : 'is'} on the watch list` : ''}.`, act.length ? 'act' : 'watch');
    }

    const filtered = r => ui.filter === 'all' || (ui.filter === 'attention' ? r.ass.state !== 'normal' : r.ass.state === ui.filter);

    root.innerHTML = String(html`<div class="page mappage">
      ${pageHead('map')}
      ${caseStrip()}
      ${head}
      ${doThis([html`Find the coloured circle${bad.length > 1 ? 's' : ''} on the plant map ${marker(1)}. Grey ones are fine.`, html`Read its card ${marker(2)} under the map, then press <b>Open machine detail</b> to see the evidence.`])}

      <section class="card map-card" aria-label="Plant map">
        <div class="card-head">
          ${marker(1)}<h2>${site.name}</h2><span class="sub">${site.makes}</span>
          <div class="right">
            <div class="seg" role="group" aria-label="Plant">${W.sites.map(s => html`<button data-action="site" data-id="${s.id}" aria-pressed="${s.id === ui.site}">${s.city}${W.assets.some(a => a.siteId === s.id && M.assess(a, t).state === 'act') ? html` <span class="sw act" style="display:inline-block;width:8px;height:8px;border-radius:50%" aria-label="has alerts"></span>` : ''}</button>`)}</div>
          </div>
        </div>
        <div class="row between" style="margin-bottom:10px">
          ${legendStates()}
          <div class="seg" role="group" aria-label="Filter">${[['all', 'All'], ['attention', 'Needs attention'], ['act', 'Act now'], ['watch', 'Watch']].map(([k, l]) => html`<button data-action="filter" data-id="${k}" aria-pressed="${ui.filter === k}">${l}</button>`)}</div>
        </div>
        <div class="lanes">${lines.map(ln => {
          const lr = rows.filter(r => r.a.lineId === ln.id);
          const nb = lr.filter(r => r.ass.state !== 'normal').length;
          return html`<div class="lane ${ln.utility ? 'utility' : ''}">
            <div class="lane-head"><b>${ln.name}</b>${nb ? stateChip(lr.some(r => r.ass.state === 'act') ? 'act' : 'watch', `${nb} need${nb === 1 ? 's' : ''} attention`) : stateChip('normal', 'All normal')}${ln.costPerH ? html`<span class="dim xs">${term('downtime ' + inr(ln.costPerH) + '/h', 'What one hour of this line standing still costs (lost contribution + penalties).')}</span>` : html`<span class="dim xs">feeds the lines</span>`}</div>
            <div class="machines">${lr.map(r => {
              const st = r.ass.state, alarm = hasAlert(r.a.id);
              const dim = !filtered(r);
              return html`<button class="mnode s-${st} crit-${r.a.criticality} ${r.a.id === ui.sel ? 'sel' : ''} ${dim ? 'dimmed' : ''}" data-action="select" data-id="${r.a.id}" aria-pressed="${r.a.id === ui.sel}" aria-label="${r.a.id} ${r.a.name}: ${STATE_TEXT[st]}, health ${r.ass.health}${alarm ? ', open alert' : ''}">
                <span class="dotwrap">${alarm ? html`<span class="ring" aria-hidden="true"></span>` : ''}<span class="dot">${st === 'act' ? icon('alert') : st === 'sensor' ? icon('sensor') : st === 'watch' ? icon('info') : ''}</span></span>
                <span class="m-id mono">${r.a.id}</span><span class="m-name">${r.a.name}</span>
              </button>`;
            })}<span class="conveyor" aria-hidden="true"></span></div>
          </div>`;
        })}</div>
        <p class="chart-caption">Each band is a production line; each circle a machine. Bigger circle = more critical machine (A, B, C). A pulsing ring = an open alert. Tap a machine to see its card.</p>
      </section>

      ${sel ? selCard(sel, store, S, M, t, hasAlert(sel.a.id)) : ''}

      <section class="card" aria-label="All machines at this plant">
        <div class="card-head"><h2>All machines, ranked by attention</h2>${aiChip('Ranked by Nirantar')}<span class="sub">Attention = failure confidence × criticality × money at stake × order deadline</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Machine</th><th>State</th><th class="n">Health</th><th class="n">${term('Failure confidence', 'How sure Nirantar is that a real failure is developing (not noise or a sensor fault).')}</th><th class="n">${term('Time to failure', 'Remaining useful life: when the worst sensor reaches its trip level at the current rate. Long values come from age-based wear when there is no trend.')}</th><th>Last 24 h</th><th>Attention</th></tr></thead>
          <tbody>${rows.sort((x, y) => y.att.score - x.att.score).filter((r, i) => ui.showAll || r.ass.state !== 'normal' || i < 6).map(r => {
            const tag = r.ass.worstKey;
            const pts = M.series(r.a, tag, t - 24 * HOUR, t, 60);
            return html`<tr class="clickable" data-action="select" data-id="${r.a.id}" tabindex="0"><td><b class="mono">${r.a.id}</b><br><span class="dim xs">${r.a.name} · ${lineOf(r.a.lineId).short}</span></td><td>${stateChip(r.ass.state)}</td><td class="n">${r.ass.health}</td><td class="n">${confPct(r.ass.conf)}</td><td class="n">${hours(r.ass.rulH)}</td><td style="width:130px">${sparkline(pts, { tone: r.ass.state === 'act' ? 'act' : r.ass.state === 'normal' ? 'normal' : 'watch', title: `${r.a.id} ${tag} last 24 h` })}</td><td>${attentionBadge(r.att)}</td></tr>`;
          })}</tbody></table></div>
        ${rows.length > 6 ? html`<div class="row" style="margin-top:10px"><button class="btn sm" data-action="showall">${ui.showAll ? 'Show only the top machines' : `Show all ${rows.length} machines`}</button></div>` : ''}
      </section>
      ${nextBack('map')}
    </div>`);
    return delegate(root, {
      site: el => { ui.site = el.dataset.id; ui.sel = null; ctx.rerender(); },
      filter: el => { ui.filter = el.dataset.id; ctx.rerender(); },
      showall: () => { ui.showAll = !ui.showAll; ctx.rerender(); },
      select: el => { ui.sel = el.dataset.id; ctx.rerender(); document.getElementById('selcard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
    });
  },
};

function selCard(r, store, S, M, t, alarm) {
  const { a, ass, att } = r;
  const ex = M.exposure(a, ass.mode);
  const tone = ass.state === 'normal' ? '' : ass.state === 'act' ? 'act' : 'watch';
  // where on its P-F curve: fraction of life used
  const life = ass.rulKind === 'trend' ? Math.min(0.95, 72 / (72 + ass.rulH)) : 0.08;
  return html`<section class="card ${tone}" id="selcard" aria-label="Machine card">
    <div class="card-head">${marker(2)}<h2>${a.id} · ${a.name}</h2>${stateChip(ass.state)}${aiChip('Scored by Nirantar')}
      <div class="right"><a class="btn primary" href="#/machine/${a.id}">${icon('machine')} Open machine detail</a></div></div>
    <div class="sel-grid">
      <div class="cols-4">
        ${kpi({ label: 'Health', value: ass.health, unit: '/100', tone, mean: '0 = failed, 100 = new', tip: 'Health falls as sensors move from normal towards their trip level. Formula on the Machine Detail page.' })}
        ${kpi({ label: 'Failure confidence', value: confPct(ass.conf), tone: ass.conf >= 0.8 ? 'act' : ass.conf >= 0.15 ? 'watch' : '', mean: 'how sure a failure is developing', tip: 'Not the timing: see time to failure.' })}
        ${kpi({ label: 'Time to failure', value: hours(ass.rulH), tone: ass.rulKind === 'trend' ? tone : '', mean: ass.rulKind === 'trend' ? `likely ${hours(ass.rulLo)} to ${hours(ass.rulHi)}` : 'normal wear, no trend', tip: 'Remaining useful life with an 80 % range.' })}
        ${ass.iso ? kpi({ label: 'ISO vibration zone', value: ass.iso.zone, tone: ass.iso.zone === 'D' ? 'act' : ass.iso.zone === 'C' ? 'watch' : '', mean: ass.iso.text, tip: 'ISO 10816 severity zones: A new, B fine, C plan a repair, D damage occurring.' }) : kpi({ label: 'Criticality', value: a.criticality, mean: 'A = stops a line' })}
      </div>
      <div class="sel-pf">${pfCurve({ compact: true, w: 220, h: 70, detect: ass.state === 'normal' ? null : 0.2, now: 0.15 + life * 0.75, fail: ass.state === 'normal' ? null : 0.9 })}<span class="xs dim">where it is on its way from first sign (P) to failure (F)</span></div>
    </div>
    <p>${ass.state === 'sensor' ? html`<b>Top signal:</b> ${ass.sensorFault.reason}. This is a sensor problem, not a machine problem: Nirantar will not send a repair crew.`
      : ass.top ? html`<b>Top signal:</b> ${ass.top.label} is <b>${ass.top.ratio.toFixed(1)}×</b> its level three days ago${ass.state !== 'normal' ? ' and still rising' : ''}.` : html`<b>All sensors normal.</b> No trend in the last three days.`}
      ${ass.modeName ? html` Nirantar reads it as <b>${ass.modeName.toLowerCase()}</b>.` : ''}</p>
    ${ass.state === 'act' && ex.inr ? why(html`if ${a.id} stops unplanned, about <b>${inr(ex.inr)}</b> of production is lost (${hours(ex.downH)} down × ${inr(ex.costPerH)}/h${ex.plan && ex.plan.kind !== 'local' ? `, mostly waiting ${ex.plan.etaH} h for the part from ${M.siteById(ex.plan.from).city}` : ''}).`) : ''}
    <p class="small dim">Attention ${att.score.toFixed(2)} (${att.band}): ${att.why}.${alarm ? ' An alert is open: see 3 · Alert Triage.' : ''}</p>
  </section>`;
}
