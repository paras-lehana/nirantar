// Golden test for the Nirantar copilot engine (app/js/pages/copilot.js). Run: node golden.test.mjs [--verbose]
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
const APP = new URL('../js', import.meta.url).href;   // run: node app/tests/golden.test.mjs
const S = await import(`${APP}/core/store.js`);
const { answer, GOLDEN, GOLDEN_SCENARIO, checkGolden } = await import(`${APP}/pages/copilot.js`);
const { store } = S;
const verbose = process.argv.includes('--verbose');
S.loadScenario(GOLDEN_SCENARIO, 2391, { quiet: true });

let pass = 0;
const before = JSON.stringify(store.state);
for (const [i, g] of GOLDEN.entries()) {
  const r = answer(g.q, store);
  const c = checkGolden(g, r);
  if (c.pass) pass++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${String(i + 1).padStart(2)} [${r.intent}${r.blocked ? ', blocked' : ''}] ${g.q}` +
    (c.pass ? '' : `\n     missing: ${JSON.stringify(c.missing)} refuseOk=${c.refuseOk} intentOk=${c.intentOk} (want ${g.intent})`));
  if (verbose || !c.pass) console.log('     ' + r.text.replace(/\n/g, '\n     ') + `\n     tools=${r.tools.join(',')} sources=${r.sources.map(s => s.id).join(',')} conf=${r.confidence} ms=${r.ms}${r.rule ? ' rule=' + r.rule : ''}\n`);
}
const pure = JSON.stringify(store.state) === before;
console.log(`\nGOLDEN: ${pass}/${GOLDEN.length} pass · store unchanged by answer(): ${pure}`);

// robustness sweep: every scenario, now and +36 h, many phrasings; must never throw or return the error intent
const extra = ['', 'hello', 'help', 'What can you do?', 'Fix it', 'Is VMC-204 ok?', 'vibration of VMC-204', 'What is the bearing temperature of VMC-204?',
  'power of VMC-204', 'When should we repair VMC-204?', 'How much money is at stake on VMC-204?', 'Which machines need attention?', 'What is wrong with the plant?',
  'OEE of the heat treatment line last month', 'OEE for Chennai', 'oee utilities pune', 'MTBF of the Pune plant', 'MTBF of CLP-101', 'Why is BEL-701 alarming?', 'Dispatch a crew to BEL-701',
  'Send a technician to BEL-701 now', 'Who can approve work orders?', 'Can you approve WO-PDM-412?', 'Has WO-PDM-412 been approved?', 'I want to approve the work order', 'approve kar do',
  'Skip the approval for VMC-204', 'Change tomorrow\'s schedule', 'Close the alert on VMC-204', 'Why can\'t you approve it?', 'How close is VMC-204 to failure?', 'What if we wait a week?',
  'what if we wait 12 hours to repair VMC-204', 'VMC-204 kyun kharab hai?', 'stock kitna hai bearing ka?', 'OEE kitna hai is hafte?', 'Do we have coupling kit in stock?', 'Which spares are low?',
  'Does weather affect failures?', "What's the weather in Pune?", 'Who won the IPL?', 'Tell me a joke', 'Is the night shift worse?', 'Does temperature affect the Chennai plant?', 'Energy use of the press line',
  'Is lot L-9999 bad?', 'Why is VMC-201 failing?', 'Why is CLP-101 noisy?', 'Is it bad?', 'kya yeh kharab hai?', 'What should I do?', 'Why does PRS-402 keep failing?', 'Why is IDF-601 vibrating?',
  'asdfgh', 'line 3 oee', 'What is the OEE of Pune Line 9?', 'how is the press line doing', 'remaining life of IDF-601', 'compare shifts at chittorgarh',
  'Which preventive jobs are overdue?', 'Is VMC-202 due for service?', 'Is VMC-204 different from its identical siblings?', 'Is it different from its siblings?', 'PRS-402 siblings', 'What is the payback?', 'Is Nirantar worth it?', 'preventive jobs on the press line'];
let errors = 0, runs = 0;
const all = [...GOLDEN.map(g => g.q), ...extra];
for (const sc of ['pune-bearing', 'chennai-misalign', 'chittor-fan', 'pune-flood', 'quiet']) {
  S.loadScenario(sc, 2391, { quiet: true });
  for (const adv of [0, 36 * 3600e3]) {
    if (adv) S.advance(adv);
    for (const q of all) {
      runs++;
      const r = answer(q, store, { lastAsset: 'VMC-204' });
      const bad = r.intent === 'error' || typeof r.text !== 'string' || !r.text || /undefined|NaN|\[object/.test(r.text + String(r.html || ''));
      if (bad) { errors++; console.log(`SWEEP ${sc}+${adv / 3600e3}h: ${q} -> ${r.intent}: ${r.text.slice(0, 200)}`); }
    }
  }
}
console.log(`SWEEP: ${runs - errors}/${runs} clean`);

// Trust Audit scores the golden set on a pristine reference copy, so a finished repair cannot lower it (bug 2026-10-06: 7/15 after repair)
S.loadScenario('pune-bearing', 2391, { quiet: true });
{ const w = store.state.workOrders.find(x => x.assetId === 'VMC-204'); S.approve(w.id, 'T'); S.advance(49 * 3600e3); S.complete(w.id, 'T'); }
{ const live = store.state; const ref = S.withReference('pune-bearing', 2391, r => GOLDEN.filter(g => checkGolden(g, answer(g.q, r)).pass).length);
  const okr = ref === GOLDEN.length && store.state === live; if (!okr) errors++;
  console.log(`${okr ? 'PASS' : 'FAIL'} reference golden score after a repair: ${ref}/${GOLDEN.length}, live state restored: ${store.state === live}`); }

// v1.1 intents (demo-only, not part of the 15 golden questions that mirror the live AGENT_EVAL_SET)
S.loadScenario('pune-bearing', 2391, { quiet: true });
const V11 = [
  ['Which preventive jobs are overdue?', 'pm', ['overdue', 'VMC-202', 'VMC-204 stop', 'Maintenance calendar']],
  ['Is VMC-204 different from its identical siblings?', 'peer', ['VMC-201', 'VMC-203', 'the problem is VMC-204 itself']],
  ['What is the payback?', 'roi', ['84 %', '36 h', 'Business case', 'not a quote']],
];
for (const [q, intent, keys] of V11) {
  const r = answer(q, store);
  const miss = keys.filter(k => !r.text.includes(k));
  const okv = r.intent === intent && !miss.length;
  if (!okv) errors++;
  console.log(`${okv ? 'PASS' : 'FAIL'} v1.1 [${r.intent}] ${q}${miss.length ? ' missing: ' + miss.join(', ') : ''}`);
}
if (verbose) {
  S.loadScenario('pune-bearing', 2391, { quiet: true });
  for (const q of extra) { const r = answer(q, store); console.log(`\n>> ${q}\n[${r.intent}${r.blocked ? ' BLOCKED ' + r.rule : ''}] ${r.text}`); }
}
process.exit(pass === GOLDEN.length && pure && !errors ? 0 : 1);
