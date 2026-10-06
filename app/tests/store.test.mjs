// Model + store checks for the demo (run: node app/tests/store.test.mjs). Pins the hero numbers that the deck,
// README and live Snowflake app quote, and the approve -> part transfer -> repair flow.
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const S = await import(new URL('../js/core/store.js', import.meta.url).href);
const { store } = S;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

S.loadScenario('pune-bearing', 2391, { quiet: true });
const M = store.model, a = M.assetById('VMC-204'), ass = M.assess(a, store.t), ex = M.exposure(a, ass.mode);
ok(ass.state === 'act', `VMC-204 is red (state ${ass.state})`);
ok(Math.abs(ass.health - 32) <= 2, `health ≈ 32 (${ass.health})`);
ok(ass.conf >= 0.98, `failure confidence ≥ 98 % (${(ass.conf * 100).toFixed(1)})`);
ok(ass.rulH > 60 && ass.rulH < 72, `time to failure ≈ 67 h (${ass.rulH.toFixed(1)})`);
ok(ass.iso.zone === 'C', `ISO zone C (${ass.iso.zone})`);
ok(ex.inr === 1680000, `money at stake Rs 16.8 L (${ex.inr})`);
ok(M.plannedCost(a, ass.mode).total === 61000, 'planned repair Rs 61,000');
const bt = M.backtestAt(0.6);
ok(bt.detected === 36 && bt.total === 43 && bt.falseAlarms === 25, `back-test 36/43, 25 false alarms (${bt.detected}/${bt.total}, ${bt.falseAlarms})`);
ok(Math.abs(bt.faRate - 0.28) < 0.01 && Math.round(bt.medianLead) === 36, `0.28 false alarms per machine-month, median lead 36 h`);
const others = M.assessAll(store.t).filter(x => x.state !== 'normal').map(x => x.assetId).sort();
ok(JSON.stringify(others) === JSON.stringify(['CLP-101', 'VMC-204']), `only VMC-204 and CLP-101 abnormal (${others})`);
const p2 = M.whatIf(ass.rulH, 1.5, ex.inr).p, p5 = M.whatIf(ass.rulH, 5, ex.inr).p;
ok(p2 < 0.2 && p5 > 0.9, `what-if odds follow the 36–97 h range (1.5 d ${(p2 * 100).toFixed(0)} %, 5 d ${(p5 * 100).toFixed(0)} %)`);

const wo = store.state.workOrders.find(w => w.assetId === 'VMC-204');
ok(wo && wo.status === 'PENDING_APPROVAL' && wo.part.from === 'CHENNAI' && wo.part.etaH === 48, 'AI drafted WO with Chennai → Pune transfer (48 h)');
ok(!S.approve(wo.id, ''), 'approval without a name is refused');
S.approve(wo.id, 'Test Approver', 'ok');
ok(wo.status === 'SCHEDULED' && wo.window.beforeFailure, 'approved → scheduled before the predicted failure');
S.advance(49 * 3600e3);
ok(wo.partArrived, 'part arrived after 49 h');
S.complete(wo.id, 'Test Approver');
ok(M.assess(a, store.t).health === 100 && store.state.alerts.every(x => x.status === 'CLOSED'), 'repair restores health 100 and closes the alert');
ok(store.state.audit.some(r => r.actor === 'Test Approver' && /Approved/.test(r.action)), 'audit has the named approval');

S.loadScenario('chittor-fan', 2391, { quiet: true });
const bel = store.state.alerts.find(x => x.assetId === 'BEL-701');
ok(bel && bel.type === 'SENSOR' && store.state.workOrders.find(w => w.alertId === bel.id).kind === 'INSPECT', 'sensor fault → inspection, no repair crew');
S.loadScenario('pune-flood', 2391, { quiet: true });
ok(store.state.alerts.filter(x => x.type === 'CONSEQUENCE' && x.rootCause === 'CLP-101').length === 13, '13 consequential alarms under CLP-101');
ok(S.alarmHealth().peak10 > 10, 'alarm flood detected (> 10 alarms in 10 min)');
S.loadScenario('quiet', 2391, { quiet: true });
ok(store.state.alerts.length === 0, 'quiet day has no alerts');

// v1.1: preventive maintenance, bundling into a planned stop, technician job card
S.loadScenario('pune-bearing', 2391, { quiet: true });
const pm = S.pmPlan();
ok(pm.length === 48 && pm.every(r => r.interval > 0 && r.due > r.last), 'PM plan covers all 48 machines');
const vmc202 = pm.find(r => r.assetId === 'VMC-202');
ok(vmc202.overdue && vmc202.lineId === 'PUN-L2', `VMC-202 PM is overdue on the hero's line (${vmc202.daysToDue.toFixed(1)} d)`);
const hero = store.state.workOrders.find(w => w.assetId === 'VMC-204');
S.approve(hero.id, 'Planner');
ok(S.schedulePM('VMC-202', { start: hero.window.start, durH: 2, bundleWith: hero.id }, '') === null, 'scheduling PM without a name is refused');
const pmWo = S.schedulePM('VMC-202', { start: hero.window.start, durH: 2, reason: 'same stop as ' + hero.id, bundleWith: hero.id }, 'Planner');
ok(pmWo && pmWo.kind === 'PM' && pmWo.status === 'SCHEDULED' && pmWo.bundleWith === hero.id, 'PM bundled into the repair stop');
ok(pmWo.technician.id !== hero.technician.id, `bundled PM goes to a free technician, not the repair crew (${pmWo.technician.name})`);
ok(S.pmPlan().find(r => r.assetId === 'VMC-202').scheduled?.id === pmWo.id, 'PM plan shows the scheduled job');
ok(store.state.audit.some(r => r.actor === 'Planner' && /Bundled preventive maintenance/.test(r.action)), 'bundling is in the audit trail');
S.toggleCheck(hero.id, 'loto', 'Ravi Kulkarni');
hero.steps.forEach((_, i) => S.toggleCheck(hero.id, 'step-' + i, 'Ravi Kulkarni'));
ok(hero.checks.loto && hero.steps.every((_, i) => hero.checks['step-' + i]), 'LOTO and every step ticked on the job card');
ok(store.state.audit.some(r => r.actor === 'Ravi Kulkarni' && /lock-out/.test(r.action)), 'LOTO confirmation is logged with the name');
S.toggleCheck(hero.id, 'step-0', 'Ravi Kulkarni');
ok(!hero.checks['step-0'], 'a step can be unticked');
ok(S.recordReading(hero.id, 3.1, 'Ravi Kulkarni').pass === false && S.recordReading(hero.id, 1.9, 'Ravi Kulkarni').pass === true, 'release reading: 3.1 mm/s fails, 1.9 passes (limit 2.3)');
S.addNote(hero.id, 'Bearing outer race pitted', 'Ravi Kulkarni');
ok(hero.notes.length === 1 && hero.notes[0].by === 'Ravi Kulkarni', 'job note stored with the name');
S.complete(pmWo.id, 'Sneha Patil');
ok(pmWo.status === 'DONE' && S.pmPlan().find(r => r.assetId === 'VMC-202').overdue === false, 'completing the PM moves the next due date forward');
ok(store.state.savings.length === 0, 'a PM does not count as an avoided breakdown');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
