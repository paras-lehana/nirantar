// Tool · Presenter: a scripted live demo for judges and plant heads. Every step changes the demo data through the
// store actions (so toasts, the audit log and every page react exactly as they would for a real user) and names the
// page the audience should look at next. Time controls drive the simulation clock; live counters show the effect.
import { html, icon, delegate, raw } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, stateChip, aiChip, humanChip, nextBack } from '../ui/components.js';
import { FAILURE_MODES, SCENARIOS } from '../core/generator.js';
import { dateTime, clock, weekday, day, inr, hours, MIN, HOUR, DAY } from '../core/format.js';

const SPEEDS = [[1, '1 s = 1 s (real time)'], [900, '15 min per second'], [3600, '1 h per second'], [21600, '6 h per second']];
const JUMPS = [[15 * MIN, '+15 min'], [HOUR, '+1 h'], [6 * HOUR, '+6 h'], [DAY, '+1 day'], [2 * DAY, '+2 days']];
const HERO_SC = SCENARIOS.find(s => s.id === 'pune-bearing');
const FLOOD_SC = SCENARIOS.find(s => s.id === 'pune-flood');
const QUIET_SC = SCENARIOS.find(s => s.id === 'quiet');
// Failure modes the fault injector models with their own sensor effects (store.injectFault), and which machines show them.
const has = (a, k) => a.tags.some(t => t.key === k);
const MODE_FITS = {
  'FM-01': a => has(a, 'VIB_RMS'), 'FM-04': a => has(a, 'VIB_RMS'), 'FM-05': a => has(a, 'VIB_RMS'),
  'FM-07': a => has(a, 'DISCH_PRESS'), 'FM-09': a => has(a, 'MOTOR_CURRENT') && a.cls !== 'press',
};
const OPEN_WO = ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'];

// Local UI state (module scope survives re-renders): per-step results, injector choices, last time jump.
let ui = { done: {}, inj: { asset: null, mode: 'FM-01' }, sens: { asset: null, tag: 'VIB_RMS' }, lastJump: null };

// Counts shown before/after each step so the presenter can say what changed.
function snap(store, S) {
  if (!store.loaded) return { open: 0, pending: 0, red: 0, amber: 0, repaired: 0 };
  const st = store.state, M = store.model, t = store.t;
  const states = store.world.assets.map(a => M.assess(a, t).state);
  return { open: S.openAlerts().length, pending: st.workOrders.filter(w => w.status === 'PENDING_APPROVAL').length,
    red: states.filter(s => s === 'act').length, amber: states.filter(s => s === 'watch' || s === 'sensor').length,
    repaired: st.workOrders.filter(w => w.status === 'DONE').length };
}
const DIFF_LABEL = [['open', 'open alerts'], ['pending', 'waiting for approval'], ['red', 'machines in red'], ['amber', 'machines in amber'], ['repaired', 'repairs done']];
function diffText(b, a) {
  const parts = DIFF_LABEL.filter(([k]) => b[k] !== a[k]).map(([k, l]) => `${l} ${b[k]} → ${a[k]}`);
  return parts.length ? 'Changed: ' + parts.join(' · ') : 'Counts unchanged';
}

function pickDefault(store, M, want, avoid) {
  const W = store.world, open = new Set((store.state.alerts || []).filter(x => x.status !== 'CLOSED').map(x => x.assetId));
  const ok = a => a.id !== W.scenario.hero && a.id !== avoid && !open.has(a.id) && want(a) && M.assess(a, store.t).state === 'normal';
  const site = W.assets.filter(a => a.siteId === W.scenario.site);
  return (site.find(a => ok(a) && a.criticality === 'A') || site.find(ok) || W.assets.find(ok) || W.assets[0]).id;
}

// Re-render on every store change except clock ticks while a select or text box here has focus
// (main.js only protects text inputs, and an open select would close at high clock speeds).
let rerender = null;
export default {
  autoRerender: false,
  onStore(kind, detail) {
    const what = kind === 'change' ? detail : kind;   // store.changed(what) emits ('change', what)
    const a = document.activeElement;
    if (what === 'tick' && a && a.closest && a.closest('.presenter') && a.matches('select, input')) return;
    if (rerender) rerender();
  },
  render(root, ctx) {
    rerender = ctx.rerender;
    const { store, S } = ctx;
    const M = store.model, W = store.world, st = store.state, t = store.t;
    const now = snap(store, S);
    const name = (store.prefs.name || '').trim() || 'Presenter';
    const openIds = new Set(S.openAlerts().map(x => x.assetId));
    const sensorIds = new Set((st.sensorFaults || []).map(s => s.asset));
    const hero = W.scenario.hero;
    const heroLine = id => { const a = M.assetById(id); return a ? M.lineById(a.lineId).name : ''; };

    // injector defaults (keep the presenter's choice while it stays valid)
    if (!M.assetById(ui.inj.asset)) ui.inj.asset = pickDefault(store, M, a => has(a, 'VIB_RMS'));
    const injA = M.assetById(ui.inj.asset);
    const injModes = Object.keys(MODE_FITS).filter(m => MODE_FITS[m](injA));
    if (!injModes.includes(ui.inj.mode)) ui.inj.mode = injModes[0];
    if (!M.assetById(ui.sens.asset)) ui.sens.asset = pickDefault(store, M, a => has(a, 'VIB_RMS'), ui.inj.asset);
    const sensA = M.assetById(ui.sens.asset);
    if (!sensA.tags.some(x => x.key === ui.sens.tag)) ui.sens.tag = sensA.tags[0].key;

    // the work orders the scripted steps act on
    const wos = st.workOrders;
    const pendingWo = wos.find(w => w.status === 'PENDING_APPROVAL' && w.kind === 'REPAIR' && w.assetId === hero)
      || wos.find(w => w.status === 'PENDING_APPROVAL' && w.kind === 'REPAIR') || wos.find(w => w.status === 'PENDING_APPROVAL');
    const doWo = wos.find(w => OPEN_WO.includes(w.status) && w.kind === 'REPAIR' && w.assetId === hero)
      || wos.find(w => OPEN_WO.includes(w.status) && w.kind === 'REPAIR') || wos.find(w => OPEN_WO.includes(w.status));
    const partWaiting = w => w && w.part && w.part.kind !== 'local' && !w.partArrived;
    const city = id => M.siteById(id)?.city || id;

    const steps = [
      { n: 1, title: `Reset the hero scenario`, does: `Loads “${HERO_SC.name}” from the start: ${HERO_SC.hero} is wearing out and the AI has drafted the repair.`,
        btn: [`Reset to ${HERO_SC.hero}`, 'data', 'primary'], ok: true,
        look: [['#/map', '1 · Plant Map'], html`${HERO_SC.hero} on the ${heroLine(HERO_SC.hero)} is the one red circle; everything else is grey. Then open 2 · Machine Detail for the evidence.`],
        run: () => { ui.done = {}; S.loadScenario(HERO_SC.id); } },
      { n: 2, title: 'Approve the drafted repair', does: html`Signs ${pendingWo ? html`<b>${pendingWo.id}</b> for ${pendingWo.assetId}` : 'the drafted work order'} as <b class="pr-who">${name}</b>. Only a named person can do this; the AI cannot.`,
        controls: html`<div class="pr-fields"><div class="field"><label for="prName">Approver name (also used in step 4 and the audit log)</label>
          <input id="prName" class="input" type="text" data-action="p-name" value="${store.prefs.name || ''}" placeholder="Presenter" autocomplete="name" maxlength="40"></div></div>`,
        btn: [html`Approve as <span class="pr-who">${name}</span>`, 'check', 'approve'], ok: !!pendingWo, why: 'Nothing is waiting for approval. Run step 1 first.',
        look: [['#/orders', '5 · Work Orders'], html`the card moves from Pending approval to Scheduled with your name on it${pendingWo && pendingWo.part && pendingWo.part.kind === 'transfer' ? html`, and the ${city(pendingWo.part.from)} → ${city(M.assetById(pendingWo.assetId).siteId)} part transfer starts (${pendingWo.part.etaH} h)` : ''}. 8 · Trust Audit shows the audit row.`],
        run: () => S.approve(pendingWo.id, name, 'Approved live in the presenter demo') },
      { n: 3, title: 'Jump 2 days (the part arrives)', does: 'Moves the plant clock forward 48 hours in one go.',
        btn: ['Jump 2 days', 'forward', ''], ok: true,
        look: [['#/orders', '5 · Work Orders'], html`watch for the toast <b>“Part arrived”</b>, then show the work order: the part is on site and the repair window is next. The failure is now two days closer.`],
        run: () => S.advance(2 * DAY) },
      { n: 4, title: 'Mark the repair done', does: html`Starts and completes ${doWo ? html`<b>${doWo.id}</b> on ${doWo.assetId}` : 'the approved repair'} as <span class="pr-who">${name}</span>.`,
        btn: ['Mark repair done', 'wrench', 'approve'], ok: !!doWo && !partWaiting(doWo),
        why: !doWo ? 'No approved repair yet. Run step 2 first.' : `The part is still on the way (arrives ${dateTime(doWo.eta)}). Run step 3 first.`,
        look: [['#/oee', '7 · OEE'], html`${doWo ? doWo.assetId : HERO_SC.hero} turns grey on 1 · Plant Map, its alert closes, and OEE counts the saving${doWo ? html` (${inr(M.exposure(M.assetById(doWo.assetId), doWo.mode).inr)} of production protected)` : ''}.`],
        run: () => { S.startWork(doWo.id, name); S.complete(doWo.id, name); } },
      { n: 5, title: 'Inject a fault on another machine', does: 'Starts a developing fault (30 h old, about 40 h to failure) on the machine you choose.',
        controls: injectControls(W, M, injA, injModes, openIds), btn: ['Inject fault', 'bolt', 'danger'],
        ok: !openIds.has(injA.id), why: `${injA.id} already has an open alert. Pick another machine.`,
        look: [['#/triage', '3 · Alert Triage'], html`a new red alert appears with a work order drafted by the AI (blue) within seconds; the toast links straight to it.`],
        run: () => S.injectFault(injA.id, ui.inj.mode) },
      { n: 6, title: 'Inject a sensor fault', does: 'Freezes one sensor reading (a flat line) while the machine itself stays healthy.',
        controls: sensorControls(W, sensA, openIds), btn: ['Freeze this sensor', 'sensor', ''],
        ok: !openIds.has(sensA.id) && !sensorIds.has(sensA.id), why: `${sensA.id} already has an open alert or a frozen sensor. Pick another machine.`,
        look: [['#/triage', '3 · Alert Triage'], html`the alert says <b>Check sensor</b>. Nirantar drafts an inspection, not a repair crew, and the machine keeps running.`],
        run: () => S.injectSensorFault(sensA.id, ui.sens.tag) },
      { n: 7, title: 'Load the alarm-flood scenario', does: `Loads “${FLOOD_SC.name}”: the coolant pump ${FLOOD_SC.hero} is cavitating.`,
        btn: ['Load alarm flood', 'alert', ''], ok: true,
        look: [['#/triage', '3 · Alert Triage'], html`about a dozen alarms arrive at once, grouped under one root cause, ${FLOOD_SC.hero}. 1 · Plant Map says fix ${FLOOD_SC.hero} first.`],
        run: () => S.loadScenario(FLOOD_SC.id) },
      { n: 8, title: 'Load the quiet day', does: `Loads “${QUIET_SC.name}”: every machine is healthy.`,
        btn: ['Load quiet day', 'check', ''], ok: true,
        look: [['#/map', '1 · Plant Map'], html`every machine is grey and there are no alerts: this is what normal looks like. 6 · Ask Copilot and 7 · OEE still work.`],
        run: () => S.loadScenario(QUIET_SC.id) },
      { n: 9, title: 'Clear data', does: 'Removes the plant data from this browser (scenario cards bring it back).',
        btn: ['Clear data', 'x', ''], ok: true,
        look: [['#/', 'any page'], html`each page shows a teaching empty state that says what it is for and offers <b>Load sample data</b>. Step 1 brings the plant back.`],
        run: () => { S.clearData(); S.toast({ kind: 'watch', title: 'Data cleared', body: 'Every page now shows its empty state. Press "Load sample data" to bring the plant back.' }); } },
    ];
    const nDone = steps.filter(s => ui.done[s.n]).length;

    root.innerHTML = String(html`<div class="page presenter">
      ${pageHead('presenter')}
      ${headline(html`Presenter controls for live demos. Each step changes the demo data; the audience should look at the page named after it. Right now: <b>${W.scenario.name}</b>, <b>${now.open}</b> open alert${now.open === 1 ? '' : 's'}, <b>${now.pending}</b> waiting for approval${nDone ? html`, <b>${nDone} of ${steps.length}</b> steps run` : ''}.`, now.red ? 'act' : now.open ? 'watch' : 'ok')}
      ${doThis([html`Pause the clock ${marker(1)} so nothing moves while you talk; jump time when the story needs it.`,
        html`Run the demo script ${marker(2)} from the top: press a step's button, then open the page it names.`,
        html`Watch the live counters ${marker(3)} to say what changed.`])}

      <div class="pr-grid">
        <aside class="pr-side">
          <section class="card" aria-label="Time controls">
            <div class="card-head">${marker(1)}<h2>Plant clock</h2></div>
            <p class="pr-clockline"><span class="live-dot ${store.prefs.playing ? 'on' : 'paused'}" aria-hidden="true"></span>
              ${store.prefs.playing ? html`Running at <b>${(SPEEDS.find(s => s[0] === store.prefs.speed) || SPEEDS[0])[1]}</b>` : html`<b>Paused.</b> Time only moves when you jump.`}</p>
            <div class="pr-controls">
              <button class="btn ${store.prefs.playing ? '' : 'primary'}" data-action="p-play" aria-pressed="${!store.prefs.playing}">${icon(store.prefs.playing ? 'pause' : 'play')}${store.prefs.playing ? 'Pause the clock' : 'Play the clock'}</button>
              <div class="field"><label for="prSpeed">Speed</label>
                <select id="prSpeed" class="input" data-action="p-speed">${SPEEDS.map(([v, l]) => html`<option value="${v}" ${v === store.prefs.speed ? raw('selected') : ''}>${l}</option>`)}</select></div>
            </div>
            <div class="pr-jumps" role="group" aria-label="Jump the clock forward">${JUMPS.map(([ms, l]) => html`<button class="btn sm" data-action="p-jump" data-ms="${ms}">${icon('forward')}${l}</button>`)}</div>
            ${ui.lastJump ? html`<p class="small muted pr-note">Jumped <b>${ui.lastJump.label}</b> to ${dateTime(ui.lastJump.to)}. ${ui.lastJump.diff}.</p>` : html`<p class="small dim pr-note">Jumps move the plant clock; faults keep developing and parts arrive on time.</p>`}
          </section>

          <section class="card" aria-label="Live counters">
            <div class="card-head">${marker(3)}<h2>Live counters</h2></div>
            <div class="pr-counters">
              <div class="pr-ctr wide"><span class="pr-k">Scenario</span><span class="pr-v">${W.scenario.name} <span class="dim small">· seed ${W.seed}</span></span></div>
              <div class="pr-ctr wide"><span class="pr-k">Plant time</span><span class="pr-v num"><span id="prClock">${weekday(st.simNow)} ${day(st.simNow)} ${clock(st.simNow)}</span> IST</span></div>
              <a class="pr-ctr ${now.open ? 'act' : ''}" href="#/triage"><span class="pr-k">Open alerts</span><span class="pr-v big num">${now.open}</span><span class="pr-go">Triage ${icon('arrowR')}</span></a>
              <a class="pr-ctr ${now.pending ? 'watch' : ''}" href="#/orders"><span class="pr-k">Waiting for approval</span><span class="pr-v big num">${now.pending}</span><span class="pr-go">Work orders ${icon('arrowR')}</span></a>
              <a class="pr-ctr ${now.red ? 'act' : ''}" href="#/map"><span class="pr-k">Machines in red</span><span class="pr-v big num">${now.red}</span><span class="pr-go">Plant map ${icon('arrowR')}</span></a>
              <a class="pr-ctr ${now.amber ? 'watch' : ''}" href="#/map"><span class="pr-k">Machines in amber</span><span class="pr-v big num">${now.amber}</span><span class="pr-go">Plant map ${icon('arrowR')}</span></a>
              <div class="pr-ctr wide ${now.repaired ? 'ok' : ''}"><span class="pr-k">Repairs done</span><span class="pr-v">${now.repaired ? html`<b class="num">${now.repaired}</b> · ${inr(st.savings.reduce((s, x) => s + x.avoidedInr, 0))} of production protected` : html`<span class="dim">none yet (step 4)</span>`}</span></div>
            </div>
          </section>
        </aside>

        <section class="card pr-script" aria-label="Demo script">
          <div class="card-head">${marker(2)}<h2>Demo script</h2><span class="sub">${steps.length} steps, about 6 minutes</span>
            <div class="right">${nDone ? html`<button class="btn sm ghost" data-action="p-forget">${icon('x')}Clear the ticks</button>` : ''}</div></div>
          <ol class="pr-steps">${steps.map(s => stepHtml(s, ui.done[s.n]))}</ol>
          <p class="small dim">Every step goes through the same actions a user would take, so the toasts, the audit log and every page react for real.</p>
          <div class="row pr-chips">${aiChip('Blue = made by the AI')}${humanChip('Approvals need a person')}</div>
        </section>
      </div>
      ${nextBack('presenter')}
    </div>`);

    const off = store.on(kind => {
      if (kind !== 'clock' || !store.loaded) return;
      const el = root.querySelector('#prClock');
      if (el) el.textContent = `${weekday(store.state.simNow)} ${day(store.state.simNow)} ${clock(store.state.simNow)}`;
    });

    const runStep = n => {
      const s = steps.find(x => x.n === n);
      if (!s || !s.ok) return;
      const before = snap(store, S), y = window.scrollY, at = store.loaded ? store.state.simNow : Date.now();
      const injected = n === 5 ? ui.inj.asset : n === 6 ? ui.sens.asset : null;
      const arrivedBefore = new Set(store.loaded ? store.state.workOrders.filter(w => w.partArrived).map(w => w.id) : []);
      s.run();
      const after = snap(store, S);
      let note = '';
      if (n === 5 && store.loaded) {
        const a = store.model.assetById(injected), ass = store.model.assess(a, store.t);
        note = S.openAlerts().some(x => x.assetId === injected) ? `${injected} raised an alert (${FAILURE_MODES[ui.inj.mode].name.toLowerCase()}, health ${ass.health})`
          : `${injected} moved to ${ass.state === 'normal' ? 'normal' : 'watch'} (health ${ass.health}); no alert yet. Jump +6 h to let the fault grow`;
      }
      if (n === 3 && store.loaded) {
        const arrived = store.state.workOrders.filter(w => w.partArrived && !arrivedBefore.has(w.id) && w.part && w.part.kind !== 'local');
        const h = store.world.scenario.hero && store.model.assess(store.model.assetById(store.world.scenario.hero), store.t);
        note = [arrived.length ? `Part arrived for ${arrived.map(w => w.id).join(', ')}` : 'No part was on the way',
          h && h.state !== 'normal' && h.rulKind === 'trend' ? `${store.world.scenario.hero} is now about ${hours(h.rulH)} from failure` : ''].filter(Boolean).join('; ');
      }
      if (n === 6) note = `${injected} now reads “check sensor”; an inspection was drafted, no repair crew`;
      if (n === 5) ui.inj.asset = null;    // pick a fresh healthy machine so the step can be repeated
      if (n === 6) ui.sens.asset = null;
      if (n === 7 && store.loaded) { const c = store.state.alerts.filter(x => x.type === 'CONSEQUENCE').length; note = `${store.state.alerts.length} alarms, ${c} of them caused by ${FLOOD_SC.hero}`; }
      ui.done[n] = { at, diff: diffText(before, after), note };
      ctx.rerender();
      if ([1, 7, 8].includes(n)) setTimeout(() => window.scrollTo(0, y), 120);   // loading a scenario re-routes to the top
    };

    const undelegate = delegate(root, {
      'p-step': el => runStep(+el.dataset.step),
      'p-play': () => { store.prefs.playing = !store.prefs.playing; S.savePrefs(); S.changed('prefs'); },
      'p-speed': (el, ev) => { if (ev.type !== 'change') return; store.prefs.speed = +el.value; S.savePrefs(); S.changed('prefs'); },
      'p-jump': el => {
        const ms = +el.dataset.ms, before = snap(store, S);
        S.advance(ms);
        ui.lastJump = { label: JUMPS.find(j => j[0] === ms)?.[1] || hours(ms / HOUR), to: store.state.simNow, diff: diffText(before, snap(store, S)) };
        ctx.rerender();
      },
      // typing updates the labels in place (a re-render here could swallow the click that caused the blur)
      'p-name': (el, ev) => {
        if (ev.type === 'click') return;
        store.prefs.name = el.value.trim().slice(0, 40);
        root.querySelectorAll('.pr-who').forEach(x => { x.textContent = store.prefs.name || 'Presenter'; });
        if (ev.type === 'change') S.savePrefs();
      },
      'p-inj-asset': (el, ev) => { if (ev.type !== 'change') return; ui.inj.asset = el.value; ctx.rerender(); },
      'p-inj-mode': (el, ev) => { if (ev.type !== 'change') return; ui.inj.mode = el.value; ctx.rerender(); },
      'p-sens-asset': (el, ev) => { if (ev.type !== 'change') return; ui.sens.asset = el.value; ctx.rerender(); },
      'p-sens-tag': (el, ev) => { if (ev.type !== 'change') return; ui.sens.tag = el.value; },
      'p-forget': () => { ui.done = {}; ui.lastJump = null; ctx.rerender(); },
    }, ['click', 'change', 'input']);
    return () => { off(); undelegate(); };
  },
};

function stepHtml(s, done) {
  const [label, ic, cls] = s.btn;
  return html`<li class="pr-step ${done ? 'done' : ''} ${s.ok ? '' : 'blocked'}">
    <span class="pr-num" aria-hidden="true">${done ? icon('check') : s.n}</span>
    <div class="pr-body">
      <h3><span class="visually-hidden">Step ${s.n}: </span>${s.title}</h3>
      <p class="small muted">${s.does}</p>
      ${s.controls || ''}
      <div class="row">
        <button class="btn ${cls}" data-action="p-step" data-step="${s.n}" ${s.ok ? '' : raw('disabled aria-disabled="true"')}>${icon(ic)}<span>${label}</span></button>
        ${s.ok ? '' : html`<span class="small pr-why">${icon('info')}${done ? 'Done. Run step 1 to reset the story and do it again.' : s.why}</span>`}
      </div>
      <p class="pr-look">${icon('arrowR')}<span><b>Now open</b> <a href="${s.look[0][0]}">${s.look[0][1]}</a>: ${s.look[1]}</span></p>
      ${done ? html`<p class="pr-result">${stateChip('ok', 'Done')}<span>${done.note ? html`${done.note}. ` : ''}${done.diff}.</span></p>` : ''}
    </div>
  </li>`;
}

function assetOptions(W, sel, openIds, fits = () => true) {
  return W.sites.map(site => html`<optgroup label="${site.city}">${W.assets.filter(a => a.siteId === site.id && fits(a)).map(a =>
    html`<option value="${a.id}" ${a.id === sel ? raw('selected') : ''}>${a.id} · ${a.name}${openIds.has(a.id) ? ' (has an alert)' : ''}</option>`)}</optgroup>`);
}

function injectControls(W, M, a, modes, openIds) {
  return html`<div class="pr-fields">
    <div class="field"><label for="prInjA">Machine</label><select id="prInjA" class="input" data-action="p-inj-asset">${assetOptions(W, a.id, openIds)}</select></div>
    <div class="field"><label for="prInjM">Failure mode</label><select id="prInjM" class="input" data-action="p-inj-mode">${modes.map(m => html`<option value="${m}" ${m === ui.inj.mode ? raw('selected') : ''}>${FAILURE_MODES[m].name}</option>`)}</select></div>
    <p class="xs dim pr-hint">Shows in: ${FAILURE_MODES[ui.inj.mode].signals.filter(k => has(a, k)).map(k => M.tagOf(a, k).label.toLowerCase()).join(', ')}. ${M.lineById(a.lineId).name}, ${M.siteById(a.siteId).city}, criticality ${a.criticality}.</p>
  </div>`;
}

function sensorControls(W, a, openIds) {
  return html`<div class="pr-fields">
    <div class="field"><label for="prSensA">Machine</label><select id="prSensA" class="input" data-action="p-sens-asset">${assetOptions(W, a.id, openIds)}</select></div>
    <div class="field"><label for="prSensT">Sensor to freeze</label><select id="prSensT" class="input" data-action="p-sens-tag">${a.tags.map(tg => html`<option value="${tg.key}" ${tg.key === ui.sens.tag ? raw('selected') : ''}>${tg.label} (${tg.unit})</option>`)}</select></div>
  </div>`;
}
