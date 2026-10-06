// Tool · Data & scenarios: load sample data, switch scenario, rebuild with a seed, see what the synthetic plant
// contains and how its telemetry is made, export it (JSON / CSV), and clear or reset what this browser stores.
// Works with and without data loaded (main.js does not replace this page with the generic empty state).
import { html, icon, delegate, raw } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, nextBack, table } from '../ui/components.js';
import { SCENARIOS, TAGS, FAILURE_MODES, PARTS, buildWorld } from '../core/generator.js';
import { isoDate, int, HOUR } from '../core/format.js';

const KEY = 'nirantar-demo-v1';
const DEFAULT_SEED = 2391;   // the seed store.loadScenario uses when none is given
const SHOWS = {
  'pune-bearing': 'The whole loop: early warning, money at stake, a part that has to come from another plant (Chennai → Pune), a repair window that avoids the order deadline, and a person approving it.',
  'chennai-misalign': 'A different failure mode on a different machine class: growing 2X vibration on a forging press (misalignment). Parts are local, so the repair can be booked sooner.',
  'chittor-fan': 'Rotor imbalance on a kiln fan, plus a frozen sensor that Nirantar routes to an instrument check instead of a repair crew.',
  'pune-flood': 'Alarm management (ISA-18.2): about a dozen consequence alarms at once, grouped under one root cause, the coolant pump.',
  'quiet': 'What normal looks like: grey everywhere and no alerts, while OEE, the copilot and the trust audit still work.',
};

let ui = { seed: null, seedErr: '', asset: null, confirmReset: false };
let sample = null;   // the default world, built once, to describe the data when nothing is loaded
const sampleWorld = () => (sample ||= buildWorld('pune-bearing', DEFAULT_SEED));

// ---------- downloads ----------
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
const istIso = t => (t ? new Date(t + 5.5 * HOUR).toISOString().slice(0, 19) + '+05:30' : '');
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const storeText = i => `${kb(i.bytes)} in ${i.keys.length} entr${i.keys.length === 1 ? 'y' : 'ies'}`;
const kb = bytes => (bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`);

function storageInfo() {
  try {
    const keys = [];
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY)) { keys.push(k); bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; }   // UTF-16
    }
    return { keys, bytes };
  } catch { return null; }
}

function counts(W) {
  const sensors = W.assets.reduce((s, a) => s + a.tags.length, 0);
  return [
    ['Plants', W.sites.length, W.sites.map(s => s.city).join(', ')],
    ['Lines', W.lines.length, `${W.lines.filter(l => !l.utility).length} production lines + ${W.lines.filter(l => l.utility).length} utility blocks`],
    ['Machines', W.assets.length, `criticality A ${W.assets.filter(a => a.criticality === 'A').length} · B ${W.assets.filter(a => a.criticality === 'B').length} · C ${W.assets.filter(a => a.criticality === 'C').length}`],
    ['Sensors', sensors, `${int(sensors * 96)} readings a day, every 15 minutes`],
    ['Sales orders', W.salesOrders.length, 'due in the next 10 days, with late-delivery penalties'],
    ['Technicians', W.technicians.length, 'with skills and shifts, per plant'],
    ['Spare-part types', W.parts.length, 'stock per plant, reorder level, supplier lead time'],
    ['Past work orders', W.history.length, 'last 120 days of maintenance history'],
    ['Back-test failures', W.backtest.episodes.length, `plus ${W.backtest.falseAlarms.length} false-alarm candidates over ${W.backtest.windowDays} days`],
    ['OEE rows', W.oee.length, `${W.oee.length / W.lines.filter(l => !l.utility).length} days × ${W.lines.filter(l => !l.utility).length} production lines, with shifts and losses`],
    ['Documents', W.docs.length, 'SOPs, manual pages, notes and policies the copilot cites'],
  ];
}

// Re-render on every store change except clock ticks while a select or text box here has focus
// (main.js only protects text inputs, and an open select would close at high clock speeds).
let rerender = null;
export default {
  autoRerender: false,
  onStore(kind, detail) {
    const what = kind === 'change' ? detail : kind;   // store.changed(what) emits ('change', what)
    const a = document.activeElement;
    if (what === 'tick' && a && a.closest && a.closest('.datapage') && a.matches('select, input')) return;
    if (rerender) rerender();
  },
  render(root, ctx) {
    rerender = ctx.rerender;
    const { store, S } = ctx;
    const loaded = store.loaded;
    const W = loaded ? store.world : sampleWorld();
    const st = loaded ? store.state : null;
    const curId = loaded ? st.scenarioId : null;
    const M = store.model;
    if (ui.seed == null) ui.seed = String(loaded ? W.seed : DEFAULT_SEED);
    if (!ui.asset || !W.assets.some(a => a.id === ui.asset)) ui.asset = (loaded && W.scenario.hero) || W.assets[0].id;
    const sto = storageInfo();
    const nSensors = W.assets.reduce((s, a) => s + a.tags.length, 0);

    const head = loaded
      ? headline(html`Loaded: <b>${W.scenario.name}</b> (seed ${W.seed}): <b>${W.assets.length} machines</b> with <b>${nSensors} sensors</b> in ${W.sites.length} plants. So far <b>${st.alerts.length}</b> alert${st.alerts.length === 1 ? '' : 's'}, <b>${st.workOrders.length}</b> work order${st.workOrders.length === 1 ? '' : 's'} and <b>${st.audit.length}</b> audit rows, saved only in this browser.`, 'ok')
      : headline(html`<b>No plant data is loaded</b>, so every page shows a teaching empty state. Load the sample plant, or pick one of ${SCENARIOS.length} scenarios below.`, 'watch');

    root.innerHTML = String(html`<div class="page datapage">
      ${pageHead('data')}
      ${head}
      ${loaded ? doThis([
        html`Load a scenario ${marker(1)} to rebuild the plant around a different problem. The current one is marked.`,
        html`Change the seed ${marker(2)} for a different but repeatable plant.`,
        html`Clear data or reset everything ${marker(3)} to see the empty states.`,
        html`Download the data ${marker(4)} as JSON or CSV to check any number yourself.`])
      : html`<section class="empty dt-empty" aria-label="No data loaded">
          ${icon('data')}
          <h2>Start with the sample plant</h2>
          <p>The fictional <b>Indus Group</b>: ${W.sites.length} plants, ${W.assets.length} machines, ${nSensors} sensors, ${W.backtest.windowDays} days of failure history. It loads the hero case: ${SCENARIOS[0].blurb}</p>
          <div class="row"><button class="btn primary lg" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load sample data</button><span class="small dim">or pick a scenario ${marker(1)} below</span></div>
        </section>`}

      <section aria-label="Scenarios">
        <div class="card-head">${marker(1)}<h2>Scenarios</h2><span class="sub">each one rebuilds the plant around one problem</span></div>
        <div class="dt-scens">${SCENARIOS.map(sc => scenarioCard(sc, sc.id === curId, W))}</div>
      </section>

      <div class="cols-2">
        <section class="card" aria-label="Seed">
          <div class="card-head">${marker(2)}<h2>Seed</h2>${loaded ? html`<span class="sub">now ${W.seed}</span>` : ''}</div>
          <p class="small">Every generated number (machine baselines, orders, maintenance history, OEE history, the back-test) comes from a random-number generator started from this seed. <b>Same seed + same scenario = the same plant</b>, on any computer, after any reload. Times are anchored to the moment you load.</p>
          <div class="dt-seed">
            <div class="field"><label for="dtSeed">Seed (a whole number)</label>
              <input id="dtSeed" class="input ${ui.seedErr ? 'invalid' : ''}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="9" data-action="d-seed" value="${ui.seed}" aria-describedby="dtSeedHelp" ${ui.seedErr ? raw('aria-invalid="true"') : ''}></div>
            <button class="btn primary" data-action="d-rebuild">${icon('data')}${loaded ? 'Rebuild with this seed' : 'Load with this seed'}</button>
          </div>
          <p class="small ${ui.seedErr ? 'dt-err' : 'dim'}" id="dtSeedHelp">${ui.seedErr || (loaded ? `Rebuilds “${W.scenario.name}”. Your approvals and audit rows start again.` : 'Loads the hero scenario with this seed.')} The standard seed is ${DEFAULT_SEED}.</p>
        </section>

        <section class="card" aria-label="Start over">
          <div class="card-head">${marker(3)}<h2>Start over</h2></div>
          <div class="dt-over">
            <div>
              <h3>Clear data</h3>
              <p class="small">Removes the plant data. Every page then shows a teaching empty state: what the page is for and the one button that fills it.</p>
              ${loaded ? html`<button class="btn" data-action="clear-data">${icon('x')} Clear data</button>` : html`<p class="small">${stateChip('normal', 'Already clear')}</p>`}
            </div>
            <div>
              <h3>Reset everything</h3>
              <p class="small">Deletes everything Nirantar saved in this browser${sto ? html` (<b id="dtStore">${storeText(sto)}</b>)` : ''}: data, approvals, audit trail, tour progress, theme and name. The page reloads like a first visit.</p>
              ${ui.confirmReset ? html`<div class="dt-confirm" role="alert"><p class="small"><b>Are you sure?</b> This cannot be undone.</p>
                  <div class="row"><button class="btn danger" data-action="d-reset-yes">${icon('x')} Yes, reset everything</button><button class="btn ghost" data-action="d-reset-no">Cancel</button></div></div>`
                : html`<button class="btn" data-action="d-reset">${icon('x')} Reset everything…</button>`}
            </div>
          </div>
        </section>
      </div>

      <section class="card" aria-label="Exports">
        <div class="card-head">${marker(4)}<h2>Exports</h2><span class="sub">files are made in your browser; nothing is uploaded</span></div>
        ${loaded ? html`<div class="dt-exports">
          <div class="dt-exp">
            <h3>Plant data (JSON)</h3>
            <p class="small muted">Plants, lines, machines with sensor limits, orders, spares, technicians, history, back-test and OEE: the whole generated world for “${W.scenario.name}”.</p>
            <button class="btn" data-action="d-world">${icon('download')} Download JSON</button>
          </div>
          <div class="dt-exp">
            <h3>Sensor readings, last 72 h (CSV)</h3>
            <div class="field"><label for="dtAsset">Machine</label>
              <select id="dtAsset" class="input" data-action="d-asset">${W.sites.map(s => html`<optgroup label="${s.city}">${W.assets.filter(a => a.siteId === s.id).map(a => html`<option value="${a.id}" ${a.id === ui.asset ? raw('selected') : ''}>${a.id} · ${a.name}${M.assess(a, store.t).state !== 'normal' ? ' (not normal)' : ''}</option>`)}</optgroup>`)}</select></div>
            <p class="small muted">One row every 15 minutes (289 rows), one column per sensor, plant time in IST.</p>
            <button class="btn" data-action="d-tele">${icon('download')} Download CSV</button>
          </div>
          <div class="dt-exp">
            <h3>Operations log (CSV)</h3>
            <p class="small muted">What happened in this session, including what the AI did and what people decided.</p>
            <div class="row">
              <button class="btn sm" data-action="d-alerts">${icon('download')} Alerts (${st.alerts.length})</button>
              <button class="btn sm" data-action="d-wos">${icon('download')} Work orders (${st.workOrders.length})</button>
              <button class="btn sm" data-action="d-audit">${icon('download')} Audit trail (${st.audit.length})</button>
            </div>
          </div>
        </div>` : html`<div class="dt-exp-empty"><p class="small">Exports need data. Load the sample plant first, then download it as JSON, any machine's last 72 hours of readings, and the alerts, work orders and audit trail as CSV.</p>
          <button class="btn" data-action="load-sample" data-scenario="pune-bearing">${icon('data')} Load sample data</button></div>`}
      </section>

      <section class="card" aria-label="About the data">
        <div class="card-head"><h2>About the data</h2>${aiChip('Generated, not real')}<span class="sub">${loaded ? 'what is loaded now' : 'what the sample plant contains'}</span></div>
        <p class="dt-truth">${icon('shield')}<span>All data is fictional (Indus Group); nothing is sent anywhere; your actions are saved only in this browser (localStorage).</span></p>
        <div class="dt-counts">${counts(W).map(([label, n, mean]) => html`<div class="dt-count"><span class="dt-n num">${int(n)}</span><span class="dt-l">${label}</span><span class="dt-m">${mean}</span></div>`)}</div>

        <h3 class="dt-h3">How the sensor readings are made</h3>
        <ul class="dt-how">
          <li><b>On demand, from a model.</b> Readings are never stored: when a page asks for a sensor at a time, the model computes it. That is why ${W.assets.length} machines × ${W.backtest.windowDays} days fit in a browser.</li>
          <li><b>Every 15 minutes.</b> Plant time moves in 15-minute steps; health, failure confidence and time to failure are recomputed at each step.</li>
          <li><b>Healthy baseline.</b> Each sensor starts a little on the safe side of its normal value, slightly different per machine.</li>
          <li><b>Shift pattern.</b> Current and power follow the load: the afternoon shift runs about 3 % harder and the night shift about 10 % lighter; temperatures and vibration follow partly.</li>
          <li><b>Noise.</b> Small random variation, the same every time for the same 15-minute slot: about 3.5 % on vibration, 0.2 % on speed, about 1 % of normal on the rest.</li>
          <li><b>Fault ramps.</b> A developing fault adds a growing change to its tell-tale sensors, from the first sign to the predicted failure. A failing coolant pump also lowers coolant pressure on every machine it feeds.</li>
          <li><b>Sensor faults.</b> A broken sensor freezes at its last value while related sensors keep moving; Nirantar spots the disagreement.</li>
        </ul>

        <h3 class="dt-h3">Sensor catalogue</h3>
        <p class="small dim">Limits as set for a CNC machine; current and power scale with machine size. Health measures how far a reading has moved from normal towards trip.</p>
        ${table({ caption: 'Sensor catalogue', cols: [
          { label: 'Sensor', get: r => html`<b>${r.label}</b>` }, { label: 'Unit', key: 'unit' },
          { label: 'Normal', n: true, key: 'normal' }, { label: 'Alarm', n: true, key: 'alarm' }, { label: 'Trip', n: true, key: 'trip' },
          { label: 'Bad when', get: r => (r.dir === 'low' ? html`${icon('arrowR', 'dt-down')}falling` : html`${icon('arrowR', 'dt-up')}rising`) },
          { label: 'Machines', n: true, get: r => W.assets.filter(a => a.tags.some(t => t.key === r.key)).length },
        ], rows: Object.entries(TAGS).map(([key, t]) => ({ key, ...t })) })}
        <p class="xs dim dt-swipe">Swipe the table sideways for more columns.</p>

        <h3 class="dt-h3">Failure modes</h3>
        <p class="small dim">What Nirantar can recognise, the sensors that reveal each one, and the repair it drafts.</p>
        ${table({ caption: 'Failure modes', cols: [
          { label: 'Failure mode', get: r => html`<b>${r.name}</b>` },
          { label: 'Shows in', get: r => r.signals.map(k => TAGS[k].label.toLowerCase()).join(', ') },
          { label: 'Repair', n: true, get: r => `${r.repairH} h` }, { label: 'Procedure', key: 'sop' },
          { label: 'Spare part', get: r => PARTS.find(p => p.id === r.part)?.name || r.part },
        ], rows: Object.values(FAILURE_MODES) })}
        <p class="xs dim dt-swipe">Swipe the table sideways for more columns.</p>
      </section>
      ${nextBack('data')}
    </div>`);

    // the store saves 300 ms after a change: refresh the storage figure once that has happened
    const tStore = setTimeout(() => { const el = root.querySelector('#dtStore'), i = storageInfo(); if (el && i) el.textContent = storeText(i); }, 450);
    const exportName = what => `nirantar-${loaded ? st.scenarioId : 'none'}-${what}-${isoDate(loaded ? st.simNow : Date.now())}`;
    const done = file => S.toast({ kind: 'ok', title: 'Downloaded', body: file });
    const undelegate = delegate(root, {
      'd-seed': (el, ev) => { if (ev.type === 'click') return; ui.seed = el.value.replace(/\D/g, '').slice(0, 9); if (ev.type === 'change' && el.value !== ui.seed) el.value = ui.seed; },
      'd-rebuild': () => {
        const n = parseInt(ui.seed, 10);
        if (!/^\d+$/.test(ui.seed) || !(n >= 1)) { ui.seedErr = 'Type a whole number of 1 or more, for example 2391.'; ctx.rerender(); root.querySelector('#dtSeed')?.focus(); return; }
        ui.seedErr = '';
        S.loadScenario(loaded ? st.scenarioId : 'pune-bearing', n);
      },
      'd-asset': (el, ev) => { if (ev.type === 'change') ui.asset = el.value; },
      'd-world': () => {
        const f = exportName('world') + '.json';
        download(f, JSON.stringify({ exportedAt: istIso(store.state.simNow), note: 'Synthetic data (fictional Indus Group), generated by the Nirantar demo.', ...store.world }, (k, v) => (typeof v === 'function' ? undefined : v), 1), 'application/json');
        done(f);
      },
      'd-tele': () => {
        const a = store.model.assetById(ui.asset), t = store.t, Mx = store.model;
        const cols = a.tags.map(tg => Mx.series(a, tg.key, t - 72 * HOUR, t, 15));
        const rows = cols[0].map(([ts], i) => [istIso(ts), ...cols.map(c => (c[i] ? Math.round(c[i][1] * 1000) / 1000 : ''))]);
        const f = `nirantar-${a.id}-72h-readings-${isoDate(t)}.csv`;
        download(f, toCsv(['time_ist', ...a.tags.map(tg => `${tg.label} (${tg.unit})`)], rows), 'text/csv');
        done(f);
      },
      'd-alerts': () => {
        const f = exportName('alerts') + '.csv';
        download(f, toCsv(['id', 'machine', 'type', 'priority', 'status', 'raised_ist', 'failure_mode', 'root_cause', 'work_order', 'acknowledged_by', 'feedback'],
          store.state.alerts.map(al => [al.id, al.assetId, al.type, al.priority, al.status, istIso(al.createdAt), al.mode ? FAILURE_MODES[al.mode]?.name : '', al.rootCause || '', al.woId || '', al.ackBy || '', al.feedback || ''])), 'text/csv');
        done(f);
      },
      'd-wos': () => {
        const f = exportName('work-orders') + '.csv';
        download(f, toCsv(['id', 'machine', 'kind', 'title', 'status', 'created_ist', 'created_by', 'part', 'part_from', 'part_eta_h', 'technician', 'window_start_ist', 'window_end_ist', 'approved_by', 'cost_inr'],
          store.state.workOrders.map(w => [w.id, w.assetId, w.kind, w.title, w.status, istIso(w.createdAt), w.createdBy, w.part?.name || '', w.part?.from || '', w.part?.etaH ?? '', w.technician?.name || '',
            istIso((w.window || w.proposedWindow)?.start), istIso((w.window || w.proposedWindow)?.end), w.approvals.map(x => `${x.action} by ${x.by}`).join('; '), w.costs?.total ?? ''])), 'text/csv');
        done(f);
      },
      'd-audit': () => {
        const f = exportName('audit') + '.csv';
        download(f, toCsv(['time_ist', 'who', 'kind', 'action', 'target', 'detail'], store.state.audit.map(r => [istIso(r.ts), r.actor, r.kind, r.action, r.target, r.detail])), 'text/csv');
        done(f);
      },
      'd-reset': () => { ui.confirmReset = true; ctx.rerender(); root.querySelector('[data-action="d-reset-yes"]')?.focus(); },
      'd-reset-no': () => { ui.confirmReset = false; ctx.rerender(); },
      'd-reset-yes': () => {
        // Stop anything from writing again (the clock and the debounced save both check store.state), then wipe and reload.
        store.prefs.playing = false;
        store.state = null;
        try { (storageInfo()?.keys || []).forEach(k => localStorage.removeItem(k)); } catch { /* storage blocked: reload still resets memory */ }
        location.reload();
      },
    }, ['click', 'input', 'change']);
    return () => { clearTimeout(tStore); undelegate(); };
  },
};

function scenarioCard(sc, current, W) {
  const city = W.sites.find(s => s.id === sc.site)?.city || sc.site;
  const facts = [city, sc.hero ? `case: ${sc.hero}` : 'no case', `${sc.faults.length} developing fault${sc.faults.length === 1 ? '' : 's'}`];
  if (sc.sensorFaults.length) facts.push(`${sc.sensorFaults.length} frozen sensor`);
  if (sc.consequence) facts.push('alarm flood');
  return html`<article class="card dt-scen ${current ? 'current' : ''}" aria-label="${sc.name}">
    <div class="dt-scen-head"><h3>${sc.name}</h3>${current ? html`<span class="state ok">${icon('check')}Loaded now</span>` : ''}</div>
    <p class="small muted">${sc.blurb}</p>
    <p class="small"><b>What it shows:</b> ${SHOWS[sc.id] || sc.blurb}</p>
    <p class="dt-facts">${facts.map(f => html`<span class="pill">${f}</span>`)}</p>
    <button class="btn ${current ? '' : 'primary'}" data-action="load-sample" data-scenario="${sc.id}">${icon('data')}${current ? 'Reload from the start' : 'Load'}</button>
  </article>`;
}
