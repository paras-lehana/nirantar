// Tool · Energy: which machines waste power before they fail?
// Each machine's power (power meter, or motor current × 400 V × √3 × 0.85 when there is no meter) is compared with its
// own normal baseline. The model trend (shift load removed) minus the baseline, averaged over the last 24 h, is the
// extra draw; × the machine's equivalent full-power hours a day gives wasted kWh, rupees and CO2.
import { html, raw, esc, icon, delegate } from '../ui/dom.js';
import { lineChart } from '../ui/charts.js';
import { pageHead, headline, doThis, marker, kpi, term, aiChip, stateChip, nextBack, table, toneOf } from '../ui/components.js';
import { inr, num, weekday, time, HOUR } from '../core/format.js';

let ui = { site: null, rate: 40 };
let lastW = 0;

const TARIFF = 8;                                  // Rs per kWh, typical Indian industrial tariff (approx.)
const CO2_KG = 0.71;                               // kg CO2 per kWh, India grid emission factor (approx.)
const KW_PER_A = 400 * Math.sqrt(3) * 0.85 / 1000; // three-phase 400 V, power factor 0.85
const MIN_SHARE = 0.01;                            // drifts under 1 % of the baseline are noise, not waste
const RATES = [20, 40, 60];                        // assumed ideal output per hour (not in the sample data)
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
const lc = s => s.replace(/^([A-Z])(?![A-Z])/, c => c.toLowerCase());   // "Kiln ID fan" -> "kiln ID fan"
const pctS = v => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0) + '\u00a0%';

// Per-machine energy for the last 24 h. Exported for Node tests.
export function energyRows(W, M, siteId, t) {
  const assets = W.assets.filter(a => a.siteId === siteId);
  const hpdKnown = W.assets.map(a => { const p = M.tagOf(a, 'POWER_KW'), e = W.energy.find(x => x.assetId === a.id); return p && e && e.kwhDay ? e.kwhDay / p.base : null; }).filter(Boolean).sort((x, y) => x - y);
  const hpdMedian = hpdKnown.length ? hpdKnown[Math.floor(hpdKnown.length / 2)] : 0;
  const rows = [];
  for (const a of assets) {
    const p = M.tagOf(a, 'POWER_KW'), cur = M.tagOf(a, 'MOTOR_CURRENT');
    const src = p ? { key: 'POWER_KW', k: 1, tag: p, source: 'power meter' } : cur ? { key: 'MOTOR_CURRENT', k: KW_PER_A, tag: cur, source: 'motor current' } : null;
    if (!src) continue;
    let extra = 0, load = 0, curRise = 0, n = 0;
    for (let h = 24; h >= 0; h--) {
      const s = t - h * HOUR;
      const trend = M.trendAt(a, src.key, s), fault = trend - src.tag.base;
      extra += fault * src.k;
      load += (M.smoothAt(a, src.key, s) - fault) / src.tag.base;     // healthy draw at this hour's shift load ÷ baseline
      if (cur) curRise += (M.trendAt(a, 'MOTOR_CURRENT', s) - cur.base) / cur.base;
      n++;
    }
    extra /= n; load /= n; curRise /= n;
    const baseKW = src.tag.base * src.k;
    const e = W.energy.find(x => x.assetId === a.id);
    const hpd = p && e && e.kwhDay ? e.kwhDay / p.base : hpdMedian;
    const share = extra / baseKW;
    // counted as waste only while it is still drawing extra now (a machine repaired an hour ago is fine again)
    const nowShare = (M.trendAt(a, src.key, t) - src.tag.base) * src.k / baseKW;
    const wasteKWh = nowShare > MIN_SHARE && share > 0 ? hpd * extra : 0;
    const normalKWh = hpd * baseKW * load;
    const ass = M.assess(a, t);
    rows.push({ a, ass, line: M.lineById(a.lineId), src, baseKW, extra, share, nowShare, curRise: cur ? curRise : null, hpd, load, normalKWh, wasteKWh, kwh: normalKWh + wasteKWh });
  }
  return rows;
}

export default {
  render(root, ctx) {
    const { store, M, params } = ctx;
    const W = store.world, t = store.t;
    if (params[0] && W.sites.find(s => s.id === params[0])) ui.site = params[0];
    if (!ui.site || !W.sites.find(s => s.id === ui.site)) ui.site = W.scenario.site;
    const site = M.siteById(ui.site);
    const rows = energyRows(W, M, ui.site, t);
    const wasters = rows.filter(r => r.wasteKWh > 0).sort((x, y) => y.wasteKWh - x.wasteKWh);
    const plantKWh = sum(rows, r => r.kwh), wasteKWh = sum(wasters, r => r.wasteKWh);
    const top = wasters[0] || null;
    const hpdShown = rows.length ? rows[0].hpd : 0;
    // machines whose motor current rises while the power meter stays flat (worth a look, not counted as waste)
    const currentOnly = rows.filter(r => !r.wasteKWh && r.curRise != null && r.curRise > 0.03 && r.ass.state !== 'normal').sort((x, y) => y.curRise - x.curRise);

    // chart subject: the top waster, else the scenario hero at this plant, else the biggest consumer
    const heroRow = rows.find(r => r.a.id === W.scenario.hero);
    const subject = top || heroRow || rows.slice().sort((x, y) => y.kwh - x.kwh)[0];

    const cs = getComputedStyle(root);
    const inner = Math.max(300, root.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0));
    const cardW = Math.floor(inner - 30), narrow = cardW < 560;

    let head;
    if (top) {
      const cause = top.ass.modeName ? `an early sign of the ${top.ass.modeName.toLowerCase()}` : 'often the first sign that something is wearing';
      head = headline(html`<b>${top.a.id}</b> (${lc(top.a.name)}, ${top.line.short}) draws <b>${pctS(top.share).replace('+', '')} more power</b> than its normal baseline: about <b>${num(top.wasteKWh, 0)} kWh and ${inr(top.wasteKWh * TARIFF)} a day</b> of waste, ${cause}.${top.curRise != null && top.curRise > 0.03 ? html` Its motor current is up ${pctS(top.curRise).replace('+', '')}.` : ''}${wasters.length > 1 ? html` ${wasters.length - 1} other machine${wasters.length > 2 ? 's are' : ' is'} also above baseline.` : ''}`, top.ass.state === 'act' ? 'act' : 'watch');
    } else {
      head = headline(html`<b>No machine at ${site.city} draws more power than its normal baseline.</b> The plant uses about ${num(plantKWh, 0)} kWh (${inr(plantKWh * TARIFF)}) a day. Nirantar compares every machine with its own baseline every 15 minutes, because extra draw is often the first sign of wear.${currentOnly.length ? html` <b>${currentOnly[0].a.id}</b>'s motor current is ${pctS(currentOnly[0].curRise).replace('+', '')} above normal although its power meter is flat: worth a look.` : ''}`, 'ok');
    }

    const nOk = rows.length - wasters.length;
    const caption = wasters.length ? `${nOk} other machine${nOk === 1 ? ' is' : 's are'} within 1 % of ${nOk === 1 ? 'its' : 'their'} own baseline.` : `All ${rows.length} machines are within 1 % of their own baseline.`;
    const doc = (W.docs || []).find(d => d.id === 'ENERGY-01');

    root.innerHTML = String(html`<div class="page energy">
      ${pageHead('energy')}
      <div class="en-controls"><span class="ctl-label">Plant</span><div class="seg" role="group" aria-label="Plant">${W.sites.map(s => html`<button data-action="site" data-id="${s.id}" aria-pressed="${s.id === ui.site}">${s.city}</button>`)}</div></div>
      ${head}
      ${doThis([
        html`Read the top wasters ${marker(1)}: machines drawing more power than their own normal.`,
        html`Check the power chart ${marker(2)}: the gap between the trend and the dashed baseline is the waste.`,
        html`Fix the cause, not the meter ${marker(3)}: open ${subject.a.id} on 2 · Machine Detail to see why.`,
      ])}

      <section aria-label="Plant energy">
        <h2 class="sec-title">Energy at ${site.name}, last 24 h</h2>
        <div class="cols-4">
          ${kpi({ label: 'Plant energy use', value: num(plantKWh, 0), unit: ' kWh/day', mean: `${inr(plantKWh * TARIFF)} a day at Rs ${TARIFF} per kWh`, tip: `Sum over ${rows.length} machines of each one's baseline kWh a day × today's shift load (night shift runs lighter), plus any waste.` })}
          ${kpi({ label: 'Wasted energy', value: num(wasteKWh, 0), unit: ' kWh/day', tone: wasteKWh ? 'watch' : '', mean: wasteKWh ? `${(wasteKWh / plantKWh * 100).toFixed(1)}\u00a0% of plant use, from ${wasters.length} machine${wasters.length > 1 ? 's' : ''}` : 'every machine is at its baseline', tip: 'Extra power above each machine\'s own normal baseline, averaged over the last 24 h, × its full-power hours a day.' })}
          ${kpi({ label: 'Cost of the waste', value: inr(wasteKWh * TARIFF), unit: ' /day', tone: wasteKWh ? 'watch' : '', mean: wasteKWh ? `${inr(wasteKWh * TARIFF * 30)} a month if nothing is fixed` : 'nothing to fix', tip: `Wasted kWh × Rs ${TARIFF} per kWh (typical Indian industrial tariff, approx.). A month = 30 days.` })}
          ${kpi({ label: 'CO₂ from the waste', value: wasteKWh ? num(wasteKWh * 30 * CO2_KG / 1000, 1) : '0', unit: ' t/month', mean: `approx., at ${CO2_KG} kg CO₂ per kWh`, tip: `Wasted kWh a month × ${CO2_KG} kg CO₂ per kWh, the approximate Indian grid emission factor.` })}
        </div>
      </section>

      <section class="card" aria-label="Top wasters">
        <div class="card-head">${marker(1)}<h2>Top wasters</h2>${aiChip('Found by Nirantar')}<span class="sub">extra power versus each machine's own baseline, last 24 h</span></div>
        ${wasters.length ? html`<ul class="en-cards">${wasters.slice(0, 8).map(r => html`<li><a href="#/machine/${r.a.id}">
          <span class="en-c-head"><b class="mono">${r.a.id}</b>${stateChip(r.ass.state)}</span>
          <span class="dim xs">${r.a.name} · ${r.line.short}${r.line.utility ? '' : ' line'}</span>
          <span class="en-c-big"><span class="mono">+${num(r.extra, 1)} kW</span> <small>${pctS(r.share)} vs its ${num(r.baseKW, 1)} kW baseline</small></span>
          <span class="small">${num(r.wasteKWh, 0)} kWh and ${inr(r.wasteKWh * TARIFF)} a day${r.curRise != null ? html` · motor current ${pctS(r.curRise)}` : ''}</span>
          <span class="small">Likely cause: ${r.ass.modeName ? html`<b>${r.ass.modeName.toLowerCase()}</b>` : 'not matched yet'}</span>
        </a></li>`)}</ul>` : ''}
        ${wasters.length ? table({ caption: 'Machines drawing more power than their baseline', onRow: 'open', cols: [
          { label: 'Machine', get: r => html`<b class="mono nowrap">${r.a.id}</b><br><span class="dim xs">${r.a.name} · ${r.line.short}</span>` },
          { label: 'State', get: r => stateChip(r.ass.state) },
          { label: 'Extra power', n: 1, get: r => html`+${num(r.extra, 1)} kW<br><span class="dim xs">${pctS(r.share)} vs ${num(r.baseKW, 1)} kW</span>` },
          { label: 'Motor current', n: 1, get: r => r.curRise == null ? '–' : pctS(r.curRise) },
          { label: 'Extra kWh a day', n: 1, get: r => num(r.wasteKWh, 0) },
          { label: 'Cost a day', n: 1, get: r => inr(r.wasteKWh * TARIFF) },
          { label: 'Likely cause', get: r => r.ass.modeName ? html`${r.ass.modeName}` : html`<span class="dim">not matched yet</span>` },
        ], rows: wasters.slice(0, 8).map(r => ({ ...r, _id: r.a.id })) })
        : html`<div class="en-empty"><p><b>No machine is above its baseline.</b> When one starts to draw extra power, it appears here with the kWh, rupees and the likely failure it points to. Load the Pune or Chennai scenario to see one.</p><button class="btn sm" data-action="data-menu">${icon('data')} Choose a scenario</button></div>`}
        <p class="chart-caption">${wasters.length ? html`${caption} Tap a row to open the machine.` : caption}</p>
      </section>

      ${powerCard(subject, top, M, t, cardW, narrow, (store.state.faults || []).find(f => f.asset === subject.a.id && f.repairedAt && f.repairedAt <= t && f.repairedAt > t - 72 * HOUR))}

      <div class="cols-2">
        ${perPartCard(rows, top, W, M, t, site)}
        <section class="card" aria-label="Why power rises before a failure">
          <div class="card-head"><h2>Why power rises before a failure</h2></div>
          ${doc ? html`<blockquote class="en-quote"><p>“${doc.text.replace(/(\d)-(\d)/g, '$1–$2').replace(/ %/g, ' %')}”</p><footer class="xs dim">${icon('doc')}<span>Source: <b>${doc.id}</b> · ${doc.title}</span></footer></blockquote>` : ''}
          <p class="small">Friction from a worn bearing, a misaligned shaft or a dull tool makes the motor work harder for the same output. Current and power creep up days before vibration or temperature reach their trip levels, so the meter you already pay for becomes an early-warning sensor.</p>
          <details class="more"><summary>How the numbers are worked out</summary>
            <ul class="small en-how">
              <li>Baseline = each machine's own normal power (kW) from healthy running.</li>
              <li>Extra power = Nirantar's trend with the shift load removed, minus the baseline, averaged over the last 24 h. Drifts under 1\u00a0% are ignored as noise.</li>
              <li>Machines without a power meter: power = motor current × 400 V × √3 × 0.85 power factor ÷ 1000.</li>
              <li>kWh a day = extra kW × ${num(hpdShown, 0)} full-power hours a day (the baseline kWh a day ÷ baseline kW).</li>
              <li>Rs ${TARIFF} per kWh and ${CO2_KG} kg CO₂ per kWh are approximate Indian figures.</li>
            </ul>
          </details>
        </section>
      </div>

      ${nextBack('energy')}
    </div>`);

    let timer = null;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { if (Math.abs(root.clientWidth - lastW) > 30) ctx.rerender(); }, 200); };
    lastW = root.clientWidth;
    window.addEventListener('resize', onResize);
    const off = delegate(root, {
      site: el => { ui.site = el.dataset.id; ctx.rerender(); },
      rate: el => { ui.rate = +el.dataset.id; ctx.rerender(); },
      open: el => ctx.navigate(`#/machine/${el.dataset.id}`),
    });
    return () => { off(); window.removeEventListener('resize', onResize); clearTimeout(timer); };
  },
};

// 72 h power of one machine: raw meter readings (grey), the model trend with the shift load removed, the baseline.
function powerCard(r, top, M, t, w, narrow, repaired) {
  const a = r.a, k = r.src.k, key = r.src.key;
  const from = t - 72 * HOUR;
  const rawPts = M.series(a, key, from, t, 30).map(([x, v]) => [x, v * k]);
  const trend = [];
  for (let s = Math.ceil(from / HOUR) * HOUR; s <= t; s += HOUR) trend.push([s, M.trendAt(a, key, s) * k]);
  if (trend[trend.length - 1][0] < t) trend.push([t, M.trendAt(a, key, t) * k]);
  const wasting = r === top;
  if (wasting) w -= 3;                     // the coloured card border is 3 px wider
  const tone = wasting ? (r.ass.state === 'act' ? 'act' : 'watch') : 'ink';
  const h = narrow ? 230 : 270, L = narrow ? 40 : 46, R = narrow ? 62 : 70, T = 14, B = 26;
  const ys = [...rawPts, ...trend].map(p => p[1]).concat(r.baseKW);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = (yMax - yMin) * 0.1 || 1;
  yMin -= pad; yMax += pad * 1.6;
  const X = x => L + (x - from) / (t - from) * (w - L - R);
  const Y = y => T + (1 - (y - yMin) / (yMax - yMin)) * (h - T - B);
  const svg = String(lineChart({ title: `${a.id} power over the last 72 hours against its normal baseline`, w, h, padL: L, padR: R, xMin: from, xMax: t, yMin, yMax, unit: 'kW', now: t,
    series: [{ name: 'Meter readings', points: rawPts, tone: 'var(--normal-2)', width: 1.2 }, { name: 'Trend', points: trend, tone, width: 2.6 }],
    limits: [{ y: r.baseKW, label: '', tone: 'ink2' }], xTicks: narrow ? 2 : 6, xFmt: ms => `${weekday(ms)} ${time(ms)}` }));
  const end = trend[trend.length - 1];
  const gapKW = end[1] - r.baseKW;
  let g = `<text x="${w - R + 6}" y="${(Y(r.baseKW) - 2).toFixed(1)}" class="lbl-strong">normal</text><text x="${w - R + 6}" y="${(Y(r.baseKW) + 11).toFixed(1)}" class="lbl-strong">baseline</text>`;
  if (wasting && gapKW / r.baseKW > MIN_SHARE) {
    // the gap now, drawn as a bar between the baseline and the trend, labelled in the right margin
    const col = tone === 'act' ? 'act' : 'watch';
    const ly = Math.max(T + 22, Math.min(Y(end[1]) + 4, Y(r.baseKW) - 18));
    g += `<line x1="${(X(end[0]) - 3).toFixed(1)}" x2="${(X(end[0]) - 3).toFixed(1)}" y1="${Y(r.baseKW).toFixed(1)}" y2="${Y(end[1]).toFixed(1)}" stroke="var(--${col}-fill)" stroke-width="4"/>`;
    g += `<text x="${w - R + 6}" y="${ly.toFixed(1)}" class="lbl-strong" fill="var(--${col})" style="fill:var(--${col})">+${esc(num(gapKW, 1))} kW</text>`;
  }
  const svgOut = raw(svg.replace('</svg>', g + '</svg>'));
  return html`<section class="card ${wasting ? toneOf(r.ass.state === 'act' ? 'act' : 'watch') : ''}" aria-label="Power chart">
    <div class="card-head">${marker(2)}<h2>${a.id} power, last 72 h</h2><span class="sub">${lc(a.name)}, ${r.line.utility ? 'utilities' : r.line.short + ' line'}</span>
      <div class="right">${marker(3)}<a class="btn sm" href="#/machine/${a.id}">${icon('machine')} Open machine detail</a></div></div>
    <div class="en-legend" aria-hidden="true"><span><i class="sw-line raw"></i>Meter readings every 30 min</span><span><i class="sw-line ${tone}"></i>Trend, shift load removed</span><span><i class="sw-line base"></i>Normal baseline ${num(r.baseKW, 1)} kW</span></div>
    ${svgOut}
    <p class="chart-caption">${wasting
      ? html`The grey readings dip on the night shift, when the machine works lighter; the trend removes that pattern. It has climbed from the baseline to ${num(end[1], 1)} kW now (${pctS(gapKW / r.baseKW)}). Averaged over the last 24 h the extra draw is ${num(r.extra, 1)} kW: about ${num(r.wasteKWh, 0)} kWh and ${inr(r.wasteKWh * TARIFF)} a day.`
      : repaired ? html`The trend dropped back to the baseline when the repair was completed (${weekday(repaired.repairedAt)} ${time(repaired.repairedAt)} IST): no extra draw now. The grey readings dip on the night shift, when the machine works lighter.`
      : html`${a.id}'s trend sits on its baseline: no extra draw. The grey readings dip on the night shift, when the machine works lighter.`}
      ${r.src.key === 'MOTOR_CURRENT' ? ' No power meter on this machine: power is worked out from motor current.' : ''}</p>
  </section>`;
}

// kWh per part needs an output rate the sample data does not hold, so the assumption is shown and can be changed.
function perPartCard(rows, top, W, M, t, site) {
  const line = top && !top.line.utility ? top.line : null;
  const lines = line ? [line] : W.lines.filter(l => l.siteId === site.id && !l.utility);
  const scope = rows.filter(r => lines.some(l => l.id === r.a.lineId));
  const kwh = sum(scope, r => r.kwh), waste = sum(scope, r => r.wasteKWh);
  const unit = /cement/i.test(site.makes) ? 'tonnes' : 'parts';
  const goodPerDay = sum(lines, l => { const o = M.lineOee(l.id, 7, t); return l.plannedHoursMonth / 30 * (o ? o.oee : 0) * ui.rate; });
  const per = goodPerDay ? kwh / goodPerDay : null;
  const wastePer = goodPerDay ? waste / goodPerDay : 0;
  const label = line ? `the ${line.short} line` : `${site.city}'s production lines`;
  return html`<section class="card" aria-label="Energy per ${unit === 'parts' ? 'part' : 'tonne'}">
    <div class="card-head"><h2>Energy per ${unit === 'parts' ? 'good part' : 'tonne'}</h2><span class="sub">${label}</span></div>
    <div class="en-perpart">
      <div><div class="k-label small muted">kWh per ${unit === 'parts' ? 'part' : 'tonne'}</div><div class="en-big mono">${per ? num(per, per < 10 ? 2 : 1) : '–'}</div></div>
      <div><div class="k-label small muted">of which waste</div><div class="en-big mono ${waste ? 'watch' : ''}">${waste ? num(wastePer * 1000, 0) + ' Wh' : '0'}</div><div class="xs dim">${waste ? `${(waste / kwh * 100).toFixed(1)}\u00a0% more energy in every ${unit === 'parts' ? 'part' : 'tonne'}` : 'nothing extra'}</div></div>
    </div>
    <div class="row en-rate"><span class="small">${term('Assumed ideal rate', `The sample data has no cycle times, so this is an assumption. Good ${unit} a day = planned hours a day × OEE (last 7 days) × this rate. The waste share does not depend on it.`)}:</span>
      <div class="seg" role="group" aria-label="Assumed ideal rate">${RATES.map(v => html`<button data-action="rate" data-id="${v}" aria-pressed="${v === ui.rate}">${v} ${unit}/h</button>`)}</div></div>
    <p class="chart-caption">${num(kwh, 0)} kWh a day on ${label} (machines on the line, utilities not included) ÷ about ${num(goodPerDay, 0)} good ${unit} a day.</p>
  </section>`;
}
