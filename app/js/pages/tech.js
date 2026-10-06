// Tool · Plan and act · Technician view: what the person doing the repair sees on their phone.
// It closes the loop from the AI's draft to the hands-on repair: the technician's own jobs, why the AI raised each
// one (failure mode, health, the sensor value against its limit), the part and the window, the SOP, then a gated
// checklist: a person approved it → the part is on site → LOTO → steps → release reading → Mark job done.
// Every tick goes through the store (toggleCheck, recordReading, addNote, startWork, complete), so it is signed with
// a name and the time and lands in the audit log on 8 · Trust Audit.
// autoRerender is off because the job card has text fields: onStore() repaints on job changes and clock steps,
// keeps typed values in `ui`, and restores focus, caret and the phone screen's scroll position.
import { html, raw, icon, delegate } from '../ui/dom.js';
import { pageHead, headline, doThis, marker, aiChip, humanChip, term, confPct, nextBack } from '../ui/components.js';
import { inr, hours, num, time, day, weekday, dateTime, shortDT, HOUR, MIN, DAY } from '../core/format.js';
import { savePrefs, DOCS, pmPlan } from '../core/store.js';
import { FAILURE_MODES } from '../core/generator.js';

const fresh = () => ({ key: null, techId: null, sel: null, name: null, editName: false, note: {}, reading: {}, photos: {}, done: null, stale: false, focus: null, scrollCard: false });
let ui = fresh();
let live = null;          // { root, ctx } of the last render, for onStore()
let glowTimer = null;

const ACTIVE = ['APPROVED', 'SCHEDULED', 'IN_PROGRESS'];
const PENDING = ['DRAFT', 'PENDING_APPROVAL'];
const isActive = w => ACTIVE.includes(w.status);
const isPending = w => PENDING.includes(w.status);
const r15 = t => Math.floor(t / (15 * MIN)) * 15 * MIN;
const istDay = t => Math.floor((t + 5.5 * HOUR) / DAY);
const RELEASE_LIMIT = 2.3;   // same limit as store.recordReading (ISO 10816 zone A, SOP-17)
const MAX_PHOTOS = 6;
const LOTO_TIP = 'Lock-out tag-out: switch off and lock every energy source (electric, hydraulic, air) and hang a tag with your name, so nobody can start the machine while someone works on it.';
const SHIFT = { A: '06:00–14:00', B: '14:00–22:00', C: '22:00–06:00' };

// ---------- words: English and Hindi (Devanagari) for the phone app ----------
// Machine IDs, part numbers, SOP numbers and units stay Latin in both languages, as printed on the shop floor.
const HI_DATE = new Intl.DateTimeFormat('hi-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });
const HI_WD = new Intl.DateTimeFormat('hi-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const STR = {
  en: {
    app: 'My jobs', viewingAs: 'Technician', lang: 'Language',
    signedAs: 'Signed in as', change: 'Change', yourName: 'Your name', save: 'Save', iAm: n => `I am ${n}`,
    nameHelp: 'Every tick, reading and note is signed with this name and the time.',
    nameNeeded: 'Type your name first: nothing is logged without a name.',
    jobsN: n => plural(n, 'job'), toDo: 'To do', waiting: 'Waiting for approval', doneToday: 'Done today',
    locked: 'Waiting for approval — you cannot start it.', openOrders: 'Open 5\u00a0·\u00a0Work Orders',
    earlierDone: n => `${plural(n, 'earlier job')} done before today.`,
    kind: { REPAIR: 'Repair', INSPECT: 'Sensor check', PM: 'Preventive' },
    status: { SCHEDULED: 'Scheduled', APPROVED: 'Scheduled', IN_PROGRESS: 'In progress', DONE: 'Done', PENDING_APPROVAL: 'Waiting for approval', DRAFT: 'Waiting for approval' },
    winLine: w => `Window ${w}`, propLine: w => `Proposed ${w} (fixed when approved)`, doneLine: (t, n) => `Done ${t} by ${n}`,
    stepsOf: (n, N) => `${n} of ${N} steps done`,
    noPart: 'No part needed', inStock: c => `Part in stock at ${c}`, notYet: (c, h) => `Part comes from ${c} (${h} h) after approval`,
    buy: h => `Part must be bought (${h}) after approval`,
    transit: (c, t) => `Part in transit from ${c}, arrives ${t}`, arrived: c => `Part arrived from ${c}`,
    // job card
    why: 'Why the AI raised it', whyPm: 'Why this job', raisedBy: t => `Raised by Nirantar ${t}`, schedBy: n => `Booked by ${n}`,
    health: h => `Health ${h}/100`, conf: c => `failure confidence ${c}`,
    rul: (h, lo, hi) => `Likely to fail in about ${h} (${lo} to ${hi} h)`,
    limits: (al, tr, u) => `alarm ${al} ${u} · trip ${tr} ${u}`,
    vsLimit: 'Top sensor against its limit', normalLbl: v => `normal ${v}`, beforeRepair: 'Just before the repair:',
    sensorWhy: (l, h) => `The ${l} reading has not changed for ${h} h while the related sensors move. The machine is fine: check the sensor, do not repair (SOP-50).`,
    sensorWas: 'A vibration reading was frozen while the related sensors moved; the machine itself was fine (SOP-50).',
    frozenAt: (v, u) => `Frozen at ${v} ${u}`,
    pmWhy: (last, n, due) => `Last preventive job ${last}, every ${n} days, next due ${due}.`,
    overdue: d => `Overdue by ${plural(d, 'day')}.`,
    nowNormal: h => `Now: health ${h}, normal.`,
    machine: 'Machine', window: 'Window', part: 'Part', tech: 'Technician', approvedBy: 'Approved by',
    techLine: (n, s) => `${n}, shift ${s} (${SHIFT[s] || ''})`,
    sop: id => `Read ${id}`, sopNone: 'Preventive checklist for this machine class (no separate SOP).',
    safety: 'Safety first', safetyRun: 'Safety first: the machine keeps running',
    lotoLabel: (id, pre) => `${pre}I have locked out and tagged out ${id} (LOTO) and checked zero energy.`,
    preStandby: 'Standby pump running. ', preDraught: 'Kiln draught reduced. ',
    safeLabel: 'The machine stays running (SOP-50). I work only on the sensor cable and mounting, outside the guards, and the shift in-charge knows.',
    tickedBy: (n, t) => `Ticked by ${n} at ${t}`,
    lotoWait: 'Do not lock out yet: the machine keeps producing until the part is here.',
    lotoStays: 'LOTO stays on until the job is done.',
    lotoPending: 'Locked until a person approves the job.',
    steps: 'Steps', next: 'Next',
    gatePending: 'Locked until a person approves the job. Read the steps to prepare.',
    gateTransit: t => `Part in transit, arrives ${t}. Prepare, but do not start.`,
    gateLoto: 'Tick the LOTO check above first: every step is locked until then.',
    gateSafe: 'Tick the safety check above first.',
    jumpDemo: 'Demo: jump the clock on Presenter',
    release: 'Release check',
    releaseHelp: sop => `After the run-in, measure the vibration (RMS) on the bearing housing. Release only at 2.3 mm/s or below: ISO 10816 zone A, new-machine level${sop ? ' (SOP-17)' : ''}.`,
    readLabel: 'Vibration after repair (mm/s)', saveReading: 'Save reading', readBad: 'Enter a number such as 1.9 (mm/s).',
    pass: 'Release allowed', passTxt: v => `${v} mm/s is in zone A (limit 2.3).`,
    fail: 'Do not release', failTxt: (v, hint) => `${v} mm/s is above 2.3: ${hint}, run in again and measure.`,
    savedBy: (n, t) => `Saved by ${n} at ${t}`, limitLbl: 'release limit',
    noVib: 'This machine has no vibration sensor: release after the test run in the SOP.',
    notes: 'Notes', addNote: 'Add note', notePh: 'e.g. Old bearing outer race pitted; photo taken', noteEmpty: 'Write the note first.',
    noNotes: 'No notes on this job yet.', earlierNote: 'Earlier note from Shift B',
    photos: 'Photos', addPhoto: 'Take or add a photo', photoCap: 'Photos stay on this device in the demo', removePhoto: 'Remove photo',
    photoMax: `Up to ${MAX_PHOTOS} photos per job.`,
    markDone: 'Mark job done', stillToDo: 'Still to do:', allSet: 'Everything is ticked. Press when the machine is handed back.',
    miss: { approval: 'approval on 5 · Work Orders', part: 'the part', loto: 'the LOTO check', safety: 'the safety check', steps: n => plural(n, 'step'), reading: 'a vibration reading', passing: 'a passing vibration reading', name: 'your name' },
    resRepair: id => `${id} is back to normal`, resInspect: id => `${id} sensor is live again`, resPm: id => `${id} preventive job done`,
    resRepairTxt: (s) => `The alert is closed and the saving (about ${s} of unplanned downtime avoided) is counted on 7 · OEE.`,
    resInspectTxt: 'The sensor alert is closed. No repair crew was sent.',
    resPmTxt: 'The next due date moved forward on the Maintenance calendar.',
    closedBy: (n, t) => `Closed by ${n} at ${t}`, seeMap: 'See it on 1\u00a0·\u00a0Plant Map', seeOee: '7\u00a0·\u00a0OEE', seeTrust: '8\u00a0·\u00a0Trust Audit', seeCal: 'Maintenance calendar',
    emptyTitle: n => `No jobs for ${n} yet.`,
    emptyApprove: (id, job) => `Approve the ${id} ${job} on 5 · Work Orders first.`,
    emptyOther: n => `Today's open job belongs to ${n}.`,
    emptyQuiet: 'Every machine is normal, so there is nothing to repair. Book preventive maintenance, or inject a fault on Presenter.',
    showJobsOf: n => `Show ${n}'s jobs`,
  },
  hi: {
    app: 'मेरे काम', viewingAs: 'टेक्नीशियन', lang: 'भाषा',
    signedAs: 'लॉग-इन नाम', change: 'बदलें', yourName: 'आपका नाम', save: 'सेव करें', iAm: n => `मैं ${n} हूँ`,
    nameHelp: 'हर टिक, रीडिंग और नोट पर यही नाम और समय दर्ज होता है।',
    nameNeeded: 'पहले अपना नाम लिखें: बिना नाम के कुछ भी दर्ज नहीं होता।',
    jobsN: n => `${n} काम`, toDo: 'करने वाले काम', waiting: 'मंज़ूरी का इंतज़ार', doneToday: 'आज पूरे हुए',
    locked: 'मंज़ूरी का इंतज़ार है — आप इसे अभी शुरू नहीं कर सकते।', openOrders: '5\u00a0·\u00a0Work Orders खोलें',
    earlierDone: n => `${n} पुराने काम पहले ही पूरे हो चुके हैं।`,
    kind: { REPAIR: 'मरम्मत', INSPECT: 'सेंसर जाँच', PM: 'प्रिवेंटिव (PM)' },
    status: { SCHEDULED: 'शेड्यूल्ड', APPROVED: 'शेड्यूल्ड', IN_PROGRESS: 'काम चालू', DONE: 'पूरा हुआ', PENDING_APPROVAL: 'मंज़ूरी बाकी', DRAFT: 'मंज़ूरी बाकी' },
    winLine: w => `समय ${w}`, propLine: w => `प्रस्तावित समय ${w} (मंज़ूरी पर तय होगा)`, doneLine: (t, n) => `${n} ने ${t} पर पूरा किया`,
    stepsOf: (n, N) => `${N} में से ${n} स्टेप पूरे`,
    noPart: 'पार्ट की ज़रूरत नहीं', inStock: c => `पार्ट ${c} स्टोर में है`, notYet: (c, h) => `मंज़ूरी के बाद पार्ट ${c} से आएगा (${h} h)`,
    buy: h => `मंज़ूरी के बाद पार्ट ख़रीदना होगा (${h})`,
    transit: (c, t) => `पार्ट ${c} से रास्ते में है, ${t} पहुँचेगा`, arrived: c => `पार्ट ${c} से पहुँच गया`,
    why: 'AI ने यह काम क्यों बनाया', whyPm: 'यह काम क्यों', raisedBy: t => `Nirantar ने ${t} पर बनाया`, schedBy: n => `${n} ने बुक किया`,
    health: h => `हेल्थ ${h}/100`, conf: c => `ख़राबी का यक़ीन ${c}`,
    rul: (h, lo, hi) => `लगभग ${h} में ख़राब हो सकती है (${lo} से ${hi} h)`,
    limits: (al, tr, u) => `अलार्म ${al} ${u} · ट्रिप ${tr} ${u}`,
    vsLimit: 'सबसे ज़्यादा बदला सेंसर, उसकी सीमा के साथ', normalLbl: v => `सामान्य ${v}`, beforeRepair: 'मरम्मत से ठीक पहले:',
    sensorWhy: (l, h) => `${l} की रीडिंग ${h} h से नहीं बदली, जबकि बाकी सेंसर बदल रहे हैं। मशीन ठीक है: सेंसर जाँचें, मरम्मत नहीं (SOP-50)।`,
    sensorWas: 'एक वाइब्रेशन रीडिंग अटक गई थी, जबकि बाकी सेंसर बदल रहे थे; मशीन ठीक थी (SOP-50)।',
    frozenAt: (v, u) => `${v} ${u} पर अटकी`,
    pmWhy: (last, n, due) => `पिछला PM ${last}, हर ${n} दिन में, अगला ${due}।`,
    overdue: d => `${d} दिन लेट।`,
    nowNormal: h => `अब: हेल्थ ${h}, सामान्य।`,
    machine: 'मशीन', window: 'काम का समय', part: 'पार्ट', tech: 'टेक्नीशियन', approvedBy: 'मंज़ूरी दी',
    techLine: (n, s) => `${n}, शिफ़्ट ${s} (${SHIFT[s] || ''})`,
    sop: id => `${id} पढ़ें (अंग्रेज़ी में)`, sopNone: 'इस मशीन के लिए PM चेकलिस्ट (अलग SOP नहीं)।',
    safety: 'पहले सुरक्षा', safetyRun: 'पहले सुरक्षा: मशीन चालू रहेगी',
    lotoLabel: (id, pre) => `${pre}मैंने ${id} का लॉक-आउट टैग-आउट (LOTO) कर दिया है और ज़ीरो एनर्जी जाँच ली है।`,
    preStandby: 'स्टैंडबाय पंप चालू है। ', preDraught: 'किल्न का ड्राफ़्ट कम कर दिया है। ',
    safeLabel: 'मशीन चालू रहेगी (SOP-50)। मैं सिर्फ़ सेंसर की केबल और माउंटिंग पर, गार्ड के बाहर से काम करूँगा, और शिफ़्ट इंचार्ज को बता दिया है।',
    tickedBy: (n, t) => `${n} ने ${t} पर टिक किया`,
    lotoWait: 'अभी LOTO न करें: पार्ट आने तक मशीन उत्पादन करती रहेगी।',
    lotoStays: 'काम पूरा होने तक LOTO लगा रहेगा।',
    lotoPending: 'मंज़ूरी मिलने तक लॉक है।',
    steps: 'काम के स्टेप', next: 'अगला',
    gatePending: 'मंज़ूरी मिलने तक लॉक है। तैयारी के लिए स्टेप पढ़ लें।',
    gateTransit: t => `पार्ट रास्ते में है, ${t} पहुँचेगा। तैयारी कर लें, पर काम शुरू न करें।`,
    gateLoto: 'पहले ऊपर LOTO पर टिक करें: तब तक हर स्टेप लॉक है।',
    gateSafe: 'पहले ऊपर सुरक्षा जाँच पर टिक करें।',
    jumpDemo: 'डेमो: Presenter पर घड़ी आगे बढ़ाएँ',
    release: 'रिलीज़ जाँच',
    releaseHelp: sop => `रन-इन के बाद बेयरिंग हाउसिंग पर वाइब्रेशन (RMS) नापें। 2.3 mm/s या उससे कम हो तभी रिलीज़ करें: ISO 10816 ज़ोन A, नई मशीन जैसा${sop ? ' (SOP-17)' : ''}।`,
    readLabel: 'मरम्मत के बाद वाइब्रेशन (mm/s)', saveReading: 'रीडिंग सेव करें', readBad: '1.9 जैसा नंबर लिखें (mm/s)।',
    pass: 'रिलीज़ कर सकते हैं', passTxt: v => `${v} mm/s ज़ोन A में है (सीमा 2.3)।`,
    fail: 'रिलीज़ न करें', failTxt: (v, hint) => `${v} mm/s, 2.3 से ज़्यादा है: ${hint}, फिर से रन-इन करके नापें।`,
    savedBy: (n, t) => `${n} ने ${t} पर सेव किया`, limitLbl: 'रिलीज़ सीमा',
    noVib: 'इस मशीन पर वाइब्रेशन सेंसर नहीं है: SOP के टेस्ट रन के बाद रिलीज़ करें।',
    notes: 'नोट', addNote: 'नोट जोड़ें', notePh: 'जैसे: पुराने बेयरिंग की आउटर रेस में गड्ढे; फ़ोटो ली', noteEmpty: 'पहले नोट लिखें।',
    noNotes: 'इस काम पर अभी कोई नोट नहीं।', earlierNote: 'शिफ़्ट B का पुराना नोट',
    photos: 'फ़ोटो', addPhoto: 'फ़ोटो लें या जोड़ें', photoCap: 'डेमो में फ़ोटो इसी डिवाइस पर रहती हैं', removePhoto: 'फ़ोटो हटाएँ',
    photoMax: `हर काम पर ज़्यादा से ज़्यादा ${MAX_PHOTOS} फ़ोटो।`,
    markDone: 'काम पूरा करें', stillToDo: 'अभी बाकी:', allSet: 'सब टिक हो गया। मशीन वापस सौंपते समय दबाएँ।',
    miss: { approval: '5 · Work Orders पर मंज़ूरी', part: 'पार्ट', loto: 'LOTO', safety: 'सुरक्षा जाँच', steps: n => `${n} स्टेप`, reading: 'वाइब्रेशन रीडिंग', passing: 'पास होने वाली वाइब्रेशन रीडिंग', name: 'आपका नाम' },
    resRepair: id => `${id} फिर से सामान्य है`, resInspect: id => `${id} का सेंसर फिर से चालू है`, resPm: id => `${id} का प्रिवेंटिव काम पूरा`,
    resRepairTxt: (s) => `अलर्ट बंद हो गया और बचत (लगभग ${s} का अनियोजित डाउनटाइम टला) 7 · OEE पर गिनी गई।`,
    resInspectTxt: 'सेंसर अलर्ट बंद हो गया। मरम्मत टीम नहीं भेजनी पड़ी।',
    resPmTxt: 'अगली तारीख़ मेंटेनेंस कैलेंडर पर आगे बढ़ गई।',
    closedBy: (n, t) => `${n} ने ${t} पर बंद किया`, seeMap: '1\u00a0·\u00a0Plant Map पर देखें', seeOee: '7\u00a0·\u00a0OEE', seeTrust: '8\u00a0·\u00a0Trust Audit', seeCal: 'मेंटेनेंस कैलेंडर',
    emptyTitle: n => `${n} के लिए अभी कोई काम नहीं है।`,
    emptyApprove: (id, job) => `पहले 5 · Work Orders पर ${id} (${job}) को मंज़ूरी दें।`,
    emptyOther: n => `आज का खुला काम ${n} के पास है।`,
    emptyQuiet: 'सभी मशीनें सामान्य हैं, मरम्मत का कोई काम नहीं। प्रिवेंटिव मेंटेनेंस बुक करें, या Presenter पर फ़ॉल्ट डालें।',
    showJobsOf: n => `${n} के काम देखें`,
  },
};

// Short job names (what the technician calls the job), per failure mode.
const JOB = {
  en: { 'FM-01': 'bearing replacement', 'FM-02': 'tool-insert change', 'FM-03': 'belt change', 'FM-04': 'shaft alignment', 'FM-05': 'fan balancing',
    'FM-06': 'hydraulic seal change', 'FM-07': 'pump impeller and seal change', 'FM-08': 'heater element change', 'FM-09': 'motor overload repair', INSPECT: 'sensor check', PM: 'preventive maintenance' },
  hi: { 'FM-01': 'बेयरिंग बदलना', 'FM-02': 'टूल इंसर्ट बदलना', 'FM-03': 'बेल्ट बदलना', 'FM-04': 'शाफ़्ट अलाइनमेंट', 'FM-05': 'फ़ैन बैलेंसिंग',
    'FM-06': 'हाइड्रॉलिक सील बदलना', 'FM-07': 'पंप इम्पेलर और सील बदलना', 'FM-08': 'हीटर एलिमेंट बदलना', 'FM-09': 'मोटर ओवरलोड की मरम्मत', INSPECT: 'सेंसर जाँच', PM: 'प्रिवेंटिव मेंटेनेंस' },
};
const MODE_HI = { 'FM-01': 'बेयरिंग घिसना', 'FM-02': 'टूल इंसर्ट घिसना', 'FM-03': 'बेल्ट घिसना', 'FM-04': 'शाफ़्ट मिसअलाइनमेंट', 'FM-05': 'रोटर इम्बैलेंस',
  'FM-06': 'हाइड्रॉलिक लीक', 'FM-07': 'पंप कैविटेशन', 'FM-08': 'हीटर एलिमेंट ख़राब', 'FM-09': 'मोटर ओवरलोड' };
const TAG_HI = { VIB_RMS: 'वाइब्रेशन (RMS)', VIB_PEAK: 'पीक वाइब्रेशन', BEARING_TEMP: 'बेयरिंग तापमान', MOTOR_CURRENT: 'मोटर करंट', SPINDLE_RPM: 'स्पिंडल स्पीड',
  COOLANT_PRESS: 'कूलेंट प्रेशर', SPEED_RPM: 'शाफ़्ट स्पीड', DISCH_PRESS: 'डिस्चार्ज प्रेशर', OUTLET_TEMP: 'आउटलेट तापमान', OIL_TEMP: 'हाइड्रॉलिक तेल तापमान',
  HYD_PRESS: 'हाइड्रॉलिक प्रेशर', STROKES: 'स्ट्रोक प्रति मिनट', ZONE_TEMP: 'ज़ोन तापमान', POWER_KW: 'पावर', AIR_PRESS: 'एयर प्रेशर' };
// What to re-check when the release reading fails, per failure mode.
const FAIL_HINT = {
  en: { 'FM-01': 're-check the bearing fit and preload', 'FM-04': 're-check the alignment and the coupling', 'FM-05': 'balance again with a correction weight', 'FM-07': 're-check the impeller fit and the suction side', _: 'find the cause before release' },
  hi: { 'FM-01': 'बेयरिंग की फ़िटिंग और प्रीलोड दोबारा जाँचें', 'FM-04': 'अलाइनमेंट और कपलिंग दोबारा जाँचें', 'FM-05': 'करेक्शन वेट लगाकर फिर से बैलेंस करें', 'FM-07': 'इम्पेलर की फ़िटिंग और सक्शन साइड दोबारा जाँचें', _: 'रिलीज़ से पहले कारण ढूँढें' },
};
// Hindi step texts for the step lists in store.js (STEPS per failure mode, the sensor inspection, PM_STEPS per machine class).
const HI_STEPS = {
  // FM-01 bearing replacement
  'Lock out and tag out the machine (LOTO), verify zero energy': 'मशीन का लॉक-आउट और टैग-आउट (LOTO) करें, ज़ीरो एनर्जी जाँचें',
  'Remove the spindle cartridge; press out the bearing set': 'स्पिंडल कार्ट्रिज निकालें; बेयरिंग सेट प्रेस से बाहर निकालें',
  'Fit the new matched bearing set, preload 0.6 kN (SOP-17)': 'नया मैच्ड बेयरिंग सेट लगाएँ, प्रीलोड 0.6 kN (SOP-17)',
  'Run in 20 min at 30 % speed': '30 % स्पीड पर 20 मिनट रन-इन करें',
  'Release only if vibration < 2.3 mm/s (ISO zone A)': 'वाइब्रेशन 2.3 mm/s से कम हो तभी मशीन रिलीज़ करें (ISO ज़ोन A)',
  // FM-04 misalignment
  'LOTO the press drive': 'प्रेस ड्राइव का LOTO करें',
  'Laser-align motor to gearbox (SOP-24), tolerance 0.05 mm': 'मोटर और गियरबॉक्स का लेज़र अलाइनमेंट करें (SOP-24), टॉलरेंस 0.05 mm',
  'Replace the coupling element and shims': 'कपलिंग एलिमेंट और शिम बदलें',
  'Run at no load, check 2X vibration has dropped': 'बिना लोड चलाएँ, देखें कि 2X वाइब्रेशन कम हो गया है',
  // FM-05 imbalance
  'Reduce kiln draught and LOTO the fan': 'किल्न का ड्राफ़्ट कम करें और फ़ैन का LOTO करें',
  'Clean clinker build-up from the blades': 'ब्लेड पर जमा क्लिंकर साफ़ करें',
  'Two-plane field balance (SOP-25) until 1X < 2.8 mm/s': 'टू-प्लेन फ़ील्ड बैलेंसिंग करें (SOP-25), जब तक 1X 2.8 mm/s से कम न हो',
  'Restore draught gradually': 'ड्राफ़्ट धीरे-धीरे वापस बढ़ाएँ',
  // FM-07 cavitation
  'Switch over to the standby pump CLP-102': 'स्टैंडबाय पंप CLP-102 पर चेंजओवर करें',
  'LOTO the duty pump': 'चालू (ड्यूटी) पंप का LOTO करें',
  'Clean the suction strainer, check sump level': 'सक्शन स्ट्रेनर साफ़ करें, संप का लेवल जाँचें',
  'Replace impeller and mechanical seal (SOP-12)': 'इम्पेलर और मैकेनिकल सील बदलें (SOP-12)',
  // FM-06 hydraulic leak
  'LOTO, release stored hydraulic pressure': 'LOTO करें, जमा हाइड्रॉलिक प्रेशर रिलीज़ करें',
  'Locate the leak, replace the seal kit (SOP-31)': 'लीक ढूँढें, सील किट बदलें (SOP-31)',
  'Refill and bleed, pressure test to 210 bar': 'तेल भरें और ब्लीड करें, 210 bar तक प्रेशर टेस्ट करें',
  // sensor inspection (SOP-50)
  'Do not stop the machine; it is running normally': 'मशीन बंद न करें; यह सामान्य रूप से चल रही है',
  'Check the accelerometer cable and mounting': 'एक्सेलेरोमीटर की केबल और माउंटिंग जाँचें',
  'Compare with a handheld vibration meter': 'हैंडहेल्ड वाइब्रेशन मीटर से रीडिंग मिलाएँ',
  'Replace the sensor if the readings differ (SP-090)': 'रीडिंग अलग हो तो सेंसर बदलें (SP-090)',
  // generic draft steps
  'LOTO the machine': 'मशीन का LOTO करें',
  'Test run and release': 'टेस्ट रन करें और रिलीज़ करें',
  // PM: cnc
  'Clean and inspect way covers and chip conveyor': 'वे-कवर और चिप कन्वेयर साफ़ करें और जाँचें',
  'Check spindle run-out and drawbar force': 'स्पिंडल रन-आउट और ड्रॉबार फ़ोर्स जाँचें',
  'Change coolant filter; top up way lube': 'कूलेंट फ़िल्टर बदलें; वे-ल्यूब टॉप-अप करें',
  'Check axis backlash and record': 'एक्सिस बैकलैश जाँचें और लिखें',
  // PM: rotating
  'Check belt or coupling condition': 'बेल्ट या कपलिंग की हालत जाँचें',
  'Grease bearings (record grams)': 'बेयरिंग में ग्रीस भरें (कितने ग्राम, लिखें)',
  'Check foundation bolts and guards': 'फ़ाउंडेशन बोल्ट और गार्ड जाँचें',
  'Record vibration with a handheld meter': 'हैंडहेल्ड मीटर से वाइब्रेशन नापें और लिखें',
  // PM: pump
  'Check mechanical seal for weeping': 'मैकेनिकल सील से रिसाव तो नहीं, जाँचें',
  'Clean suction strainer': 'सक्शन स्ट्रेनर साफ़ करें',
  'Grease motor bearings': 'मोटर बेयरिंग में ग्रीस भरें',
  'Record discharge pressure': 'डिस्चार्ज प्रेशर लिखें',
  // PM: compressor
  'Change intake filter': 'इनटेक फ़िल्टर बदलें',
  'Drain condensate; check auto-drain': 'कंडेनसेट ड्रेन करें; ऑटो-ड्रेन जाँचें',
  'Check belt tension': 'बेल्ट का टेंशन जाँचें',
  'Record outlet temperature': 'आउटलेट तापमान लिखें',
  // PM: press
  'Check hydraulic oil level and filter indicator': 'हाइड्रॉलिक तेल का लेवल और फ़िल्टर इंडिकेटर जाँचें',
  'Inspect cylinder seals for leaks': 'सिलेंडर सील में लीक जाँचें',
  'Check die-clamp pressure': 'डाई-क्लैंप प्रेशर जाँचें',
  'Record oil temperature': 'तेल का तापमान लिखें',
  // PM: thermal
  'Inspect heater elements and terminals (thermal camera)': 'हीटर एलिमेंट और टर्मिनल जाँचें (थर्मल कैमरा)',
  'Check thermocouples against a reference': 'थर्मोकपल को रेफ़रेंस से मिलाकर जाँचें',
  'Inspect door seals and refractory': 'दरवाज़े की सील और रिफ़्रैक्टरी जाँचें',
  // PM: aux
  'Clean and inspect': 'साफ़ करें और जाँचें',
  'Check safety interlocks': 'सेफ़्टी इंटरलॉक जाँचें',
  'Lubricate moving parts': 'चलने वाले पुर्ज़ों में लुब्रिकेशन करें',
};
// NOTE-204 (Hinglish) in Devanagari, for the Hindi job card.
const NOTE_HI = { 'NOTE-204': 'शिफ़्ट B: VMC-204 स्पिंडल से हल्की सी घिस-घिस आवाज़ आ रही है हाई RPM पे। कूलेंट ठीक है। अगले PM में बेयरिंग चेक करना।' };

function stepText(s, lang) {
  if (lang !== 'hi') return s;
  if (HI_STEPS[s]) return HI_STEPS[s];
  const m = /^Follow (.+)$/.exec(s);
  return m ? `${m[1]} के हिसाब से काम करें` : s;
}

// ---------- page ----------
export default {
  autoRerender: false,
  onStore(what) {
    if (!live || what === 'clock') return;
    const { root, ctx } = live;
    if (!root.isConnected || !root.querySelector('.techpage')) return;
    if (!['wo', 'tick', 'load', 'clear', 'inject', 'alert'].includes(what)) return;
    // a 15-min clock step must not close the keyboard or an open select: repaint when the field is left
    if (what === 'tick' && typing(root)) { ui.stale = true; return; }
    repaint(root, ctx);
  },

  render(root, ctx) {
    const { store, S, M } = ctx;
    live = { root, ctx };
    const st = store.state, W = store.world;
    const key = `${st.scenarioId}@${st.anchor}`;
    if (ui.key !== key) ui = { ...fresh(), key };              // new scenario: forget picks, drafts and photos
    if (ui.name == null) ui.name = store.prefs.name || '';
    const lang = store.prefs.techLang === 'hi' ? 'hi' : 'en';
    const T = STR[lang];

    // selection: #/tech/<TECH_ID>/<WO_ID> wins, then the last pick, then the hero case's technician
    const m = location.hash.match(/^#\/tech(?:\/([^/?#]+))?(?:\/([^/?#]+))?/);
    let pTech = m && m[1] ? decodeURIComponent(m[1]) : null;
    let pWo = m && m[2] ? decodeURIComponent(m[2]) : null;
    // a technician is pickable when they work at the scenario's plant or have a job (e.g. a fault injected elsewhere)
    const pickable = id => W.technicians.some(t => t.id === id && (t.siteId === W.scenario.site || st.workOrders.some(w => w.technician && w.technician.id === id && w.status !== 'REJECTED')));
    if (pTech && !W.technicians.some(t => t.id === pTech)) { if (st.workOrders.some(w => w.id === pTech)) pWo = pTech; pTech = null; }
    if (pWo) {
      const w = st.workOrders.find(x => x.id === pWo);
      if (w && w.technician && (!pTech || pTech === w.technician.id)) pTech = w.technician.id; else pWo = null;
    }
    if (pTech && !pickable(pTech)) { pTech = null; setHash('#/tech'); }   // e.g. a link left over from another scenario
    if (pTech) ui.techId = pTech;
    if (!pickable(ui.techId)) ui.techId = defaultTech(store);
    const tech = W.technicians.find(t => t.id === ui.techId);
    const L = listOf(st.workOrders, tech.id, st.simNow, pWo || ui.sel);
    const jobs = [...L.active, ...L.pending, ...L.done];
    if (pWo && jobs.some(j => j.id === pWo)) ui.sel = pWo;
    if (!jobs.some(j => j.id === ui.sel)) { ui.sel = (jobs[0] || {}).id || null; ui.done = null; }
    const wo = jobs.find(j => j.id === ui.sel) || null;

    const a = wo ? M.assetById(wo.assetId) : null;
    const pi = wo ? partInfo(wo, store, M) : null;
    const pr = wo ? progressOf(wo, a, pi, store.prefs.name) : null;
    const urls = [];   // object URLs for photo previews made by this render; revoked in the cleanup
    const C = { store, S, M, W, st, T, lang, tech, L, wo, a, pi, pr, urls };

    const prevScreen = root.querySelector('.tp-screen');
    const prevTop = prevScreen ? prevScreen.scrollTop : 0;

    root.innerHTML = String(html`<div class="page techpage">
      ${pageHead('tech')}
      ${headlineFor(C)}
      ${doThis(stepsFor(C))}
      <div class="tp-layout">
        <div class="tp-phone-col">
          <div class="tp-phone" role="region" aria-label="Technician app as it looks on a phone">
            <div class="tp-statusbar" aria-hidden="true"><span id="tpClock" class="num">${time(st.simNow)}</span><span class="tp-island"></span><span class="tp-sig">${icon('sensor')}<span class="tp-batt"></span></span></div>
            <div class="tp-screen" id="tpScreen">
              ${appHead(C)}
              <div class="tp-body ${lang === 'hi' ? 'deva' : ''}" ${lang === 'hi' ? raw('lang="hi"') : ''}>
                ${nameBar(C)}
                ${jobList(C)}
                ${wo ? jobCard(C) : ''}
              </div>
            </div>
          </div>
        </div>
        ${explain(C)}
      </div>
      <div data-layered>${nextBack('tech')}</div>${/* phone content scrolls under the frame above this bar: tell the overlap audit it is deliberate */ ''}
    </div>`);

    // keep the phone screen where it was; after picking a job, show its card
    const scr = root.querySelector('.tp-screen');
    if (scr) scr.scrollTop = prevTop;
    if (ui.scrollCard) {
      ui.scrollCard = false;
      requestAnimationFrame(() => {
        const card = root.querySelector('#tpCard');
        if (!card || !scr) return;
        if (getComputedStyle(scr).overflowY === 'auto') scr.scrollTop = Math.max(0, card.offsetTop - 8);
        else window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 64 });
      });
    }

    // the status-bar clock follows the plant clock every second (clock seconds are not sent to onStore)
    const iv = setInterval(() => { const el = root.querySelector('#tpClock'); if (el && store.state && store.state.simNow) el.textContent = time(store.state.simNow); }, 1000);
    const onOut = ev => {
      if (!ui.stale || !ev.target.matches('input, select, textarea')) return;
      setTimeout(() => { if (ui.stale && live && live.root === root && !typing(root)) repaint(root, ctx); }, 400);
    };
    root.addEventListener('focusout', onOut);

    const need = () => needName(root, store);
    const cur = () => st.workOrders.find(w => w.id === ui.sel);
    const off = delegate(root, {
      't-tech': (el, ev) => {
        if (ev.type !== 'change') return;
        ui.techId = el.value; ui.sel = null; ui.done = null;
        setHash(`#/tech/${encodeURIComponent(ui.techId)}`);
        repaint(root, ctx);
      },
      't-sel': el => {
        if (ui.sel !== el.dataset.id) ui.done = null;
        ui.sel = el.dataset.id; ui.scrollCard = true;
        setHash(`#/tech/${encodeURIComponent(ui.techId)}/${encodeURIComponent(ui.sel)}`);
        repaint(root, ctx);
      },
      't-show-tech': el => { ui.techId = el.dataset.id; ui.sel = null; ui.done = null; setHash(`#/tech/${encodeURIComponent(ui.techId)}`); repaint(root, ctx); },
      't-lang': el => { store.prefs.techLang = el.dataset.lang; savePrefs(); repaint(root, ctx); },
      // name: typed into ui, committed to prefs on change / Save / Enter / "I am …"
      't-name': (el, ev) => {
        if (ev.type === 'click') return;
        ui.name = el.value;
        if (el.value.trim()) clearInvalid(root, 'tpName', 'tpNameErr');
        if (ev.type === 'keydown' && ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commitName(store, el.value); repaint(root, ctx); }
        else if (ev.type === 'change' && el.value.trim()) { store.prefs.name = el.value.trim(); savePrefs(); }
      },
      't-name-save': () => {
        const v = (root.querySelector('#tpName')?.value || '').trim();
        if (!v) return flagField(root, 'tpName', 'tpNameErr', T.nameNeeded);
        commitName(store, v); repaint(root, ctx);
      },
      't-name-me': el => { commitName(store, el.dataset.name); repaint(root, ctx); },
      't-name-edit': () => { ui.editName = true; ui.focus = '#tpName'; repaint(root, ctx); },
      // safety gate: LOTO for repairs and PM; a safe-work check for a sensor inspection (the machine keeps running)
      't-safety': (el, ev) => {
        if (ev.type !== 'change') return;
        const w = cur(); if (!w) return;
        const name = need(); if (!name) { el.checked = !el.checked; return; }
        const k = el.dataset.key;
        S.toggleCheck(w.id, k, name);
      },
      't-step': (el, ev) => {
        if (ev.type !== 'change') return;
        const w = cur(); if (!w) return;
        const name = need(); if (!name) { el.checked = !el.checked; return; }
        const k = 'step-' + el.dataset.i;
        const ticking = !(w.checks && w.checks[k]);
        if (ticking && (w.status === 'SCHEDULED' || w.status === 'APPROVED')) S.startWork(w.id, name);
        S.toggleCheck(w.id, k, name);
      },
      't-reading': (el, ev) => {
        if (ev.type === 'click') return;
        ui.reading[ui.sel] = el.value;
        if (el.value.trim()) clearInvalid(root, 'tpReading', 'tpReadingErr');
        if (ev.type === 'keydown' && ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); saveReading(root, ctx, T); }
      },
      't-save-reading': () => saveReading(root, ctx, T),
      't-note': (el, ev) => {
        if (ev.type === 'click') return;
        ui.note[ui.sel] = el.value;
        if (el.value.trim()) clearInvalid(root, 'tpNote', 'tpNoteErr');
        if (ev.type === 'keydown' && ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); addNote(root, ctx, T); }
      },
      't-add-note': () => addNote(root, ctx, T),
      't-photo': (el, ev) => {
        if (ev.type !== 'change') return;
        const list = ui.photos[ui.sel] || (ui.photos[ui.sel] = []);
        const files = [...(el.files || [])].filter(f => /^image\//.test(f.type)).slice(0, Math.max(0, MAX_PHOTOS - list.length));
        list.push(...files);
        el.value = '';
        ui.focus = '#tpPhoto';
        repaint(root, ctx);
      },
      't-photo-del': el => { (ui.photos[ui.sel] || []).splice(+el.dataset.i, 1); ui.focus = '#tpPhoto'; repaint(root, ctx); },
      't-done': () => {
        const w = cur(); if (!w) return;
        const name = need(); if (!name) return;
        const p = progressOf(w, M.assetById(w.assetId), partInfo(w, store, M), name);
        if (!p.canFinish) return showMissing(root, p);
        if (w.status !== 'IN_PROGRESS') S.startWork(w.id, name);
        ui.done = { woId: w.id };
        ui.focus = '#tpResult';
        S.complete(w.id, name);
      },
      't-skip': el => S.jumpTo(+el.dataset.ms),
    }, ['click', 'input', 'change', 'keydown']);

    return () => {
      off();
      clearInterval(iv);
      root.removeEventListener('focusout', onOut);
      urls.forEach(u => URL.revokeObjectURL(u));
    };
  },
};

// ---------- state helpers ----------
function typing(root) {
  const a = document.activeElement;
  return !!(a && root.contains(a) && a.matches('input[type=text], input:not([type]), textarea, select'));
}
// Re-render, then put focus (and the caret) back where it was, or on ui.focus when an action asked for it.
function repaint(root, ctx) {
  const a = document.activeElement;
  let f = null;
  if (a && a !== document.body && root.contains(a) && a.id) {
    f = { id: a.id };
    try { if (typeof a.selectionStart === 'number') f.sel = [a.selectionStart, a.selectionEnd]; } catch { /* not a text field */ }
  }
  ui.stale = false;
  const want = ui.focus;
  ui.focus = null;
  ctx.rerender();
  const el = want ? root.querySelector(want) : f ? root.querySelector('#' + CSS.escape(f.id)) : null;
  if (el && !el.disabled) {
    el.focus({ preventScroll: true });
    // an action's outcome (the result after Mark job done, the reading verdict) must be on screen
    if (want) el.scrollIntoView({ block: want === '#tpResult' ? 'center' : 'nearest' });
    if (f && f.sel && !want) { try { el.setSelectionRange(f.sel[0], f.sel[1]); } catch { /* ignore */ } }
  }
}
function setHash(h) { try { history.replaceState(null, '', h); } catch { /* sandboxed */ } }
function commitName(store, v) {
  const n = String(v || '').trim();
  if (!n) return;
  store.prefs.name = n; ui.name = n; ui.editName = false; savePrefs();
}
// The name every action is signed with; flags the field when it is missing.
function needName(root, store) {
  const typed = (root.querySelector('#tpName')?.value || '').trim();
  if (!store.prefs.name && typed) commitName(store, typed);
  const n = (store.prefs.name || '').trim();
  if (!n) {
    const lang = store.prefs.techLang === 'hi' ? 'hi' : 'en';
    flagField(root, 'tpName', 'tpNameErr', STR[lang].nameNeeded);
  }
  return n;
}

function defaultTech(store) {
  const W = store.world, st = store.state;
  const hero = W.scenario.hero;
  const mine = st.workOrders.filter(w => w.technician && w.status !== 'REJECTED');
  const heroWo = hero ? (mine.find(w => w.assetId === hero && w.status !== 'DONE') || mine.find(w => w.assetId === hero)) : null;
  if (heroWo) return heroWo.technician.id;
  const any = mine.find(isActive) || mine.find(isPending) || mine[0];
  if (any) return any.technician.id;
  return (W.technicians.find(t => t.siteId === W.scenario.site) || W.technicians[0]).id;
}

// A technician's jobs: to do (in progress first, then by window), waiting for approval, done today.
function listOf(all, techId, now, keepId) {
  const mine = all.filter(w => w.technician && w.technician.id === techId && w.status !== 'REJECTED');
  const winStart = w => (w.window || w.proposedWindow || {}).start || w.createdAt;
  const active = mine.filter(isActive).sort((x, y) => (y.status === 'IN_PROGRESS') - (x.status === 'IN_PROGRESS') || winStart(x) - winStart(y));
  const pending = mine.filter(isPending).sort((x, y) => winStart(x) - winStart(y));
  const doneAll = mine.filter(w => w.status === 'DONE');
  const done = doneAll.filter(w => istDay(w.doneAt || 0) === istDay(now) || w.id === keepId).sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
  return { active, pending, done, olderDone: doneAll.length - done.length };
}

function partInfo(wo, store, M) {
  const a = M.assetById(wo.assetId), site = M.siteById(a.siteId), now = store.state.simNow;
  if (!wo.part) return { k: 'none', ready: true, site };
  const from = wo.part.from && wo.part.from !== 'Supplier' ? M.siteById(wo.part.from) : null;
  const base = { part: wo.part, site, from, fromCity: from ? from.city : 'the supplier' };
  if (wo.part.kind === 'local') return { ...base, k: 'stock', ready: true };
  if (isPending(wo)) return { ...base, k: wo.part.kind === 'purchase' ? 'buy' : 'notyet', ready: false };
  if (wo.partArrived || (wo.eta != null && now >= wo.eta)) return { ...base, k: 'arrived', ready: true, eta: wo.eta };
  return { ...base, k: 'transit', ready: false, eta: wo.eta };
}

const safetyKey = wo => (wo.kind === 'INSPECT' ? 'safety' : 'loto');
const hasVib = a => a.tags.some(t => t.key === 'VIB_RMS');
const needsReading = (wo, a) => wo.kind === 'REPAIR' && hasVib(a);

// Where the job stands against the gates: approval → part → safety → steps → reading → done.
function progressOf(wo, a, pi, name) {
  const checks = wo.checks || {};
  const sk = safetyKey(wo);
  const safe = checks[sk] || null;
  const ticks = wo.steps.map((_, i) => checks['step-' + i] || null);
  const nDone = ticks.filter(Boolean).length;
  const needRead = needsReading(wo, a);
  const reading = needRead ? (wo.afterReading || null) : null;
  const approved = !isPending(wo) && wo.status !== 'REJECTED';
  const open = approved && wo.status !== 'DONE';
  const gateSafety = open && pi.ready;
  const gateSteps = gateSafety && !!safe;
  const missing = [];
  if (wo.status !== 'DONE') {
    if (!approved) missing.push(['approval']);
    if (!pi.ready) missing.push(['part']);
    if (!safe) missing.push([sk]);
    if (nDone < wo.steps.length) missing.push(['steps', wo.steps.length - nDone]);
    if (needRead && !reading) missing.push(['reading']);
    if (needRead && reading && !reading.pass) missing.push(['passing']);
    if (!(name || '').trim()) missing.push(['name']);
  }
  return { sk, safe, ticks, nDone, needRead, reading, approved, open, gateSafety, gateSteps, missing, canFinish: open && !missing.length };
}

// ---------- formatting ----------
const whenOf = (t, lang) => (lang === 'hi' ? `${HI_DATE.format(t)} ${time(t)}` : `${weekday(t)} ${day(t)} ${time(t)}`);
const shortWhen = (t, lang) => (lang === 'hi' ? `${HI_WD.format(t)} ${time(t)}` : `${weekday(t)} ${time(t)}`);
function winText(w, lang) {
  if (!w) return '';
  return istDay(w.start) === istDay(w.end) ? `${whenOf(w.start, lang)}–${time(w.end)}` : `${whenOf(w.start, lang)} – ${whenOf(w.end, lang)}`;
}
function jobTitle(wo, a, lang) {
  const k = wo.kind === 'INSPECT' ? 'INSPECT' : wo.kind === 'PM' ? 'PM' : wo.mode;
  const t = JOB[lang][k] || (FAILURE_MODES[wo.mode] ? FAILURE_MODES[wo.mode].name.toLowerCase() + (lang === 'hi' ? ' की मरम्मत' : ' repair') : (lang === 'hi' ? 'मरम्मत' : 'repair'));
  if (wo.mode === 'FM-01' && a.cls === 'cnc') return lang === 'hi' ? 'स्पिंडल ' + t : 'spindle ' + t;
  return t;
}
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const lc1 = s => (s ? s[0].toLowerCase() + s.slice(1) : '');
const tagLabel = (tag, lang) => (lang === 'hi' ? TAG_HI[tag.key] || tag.label : tag.label);
const modeName = (mode, lang) => (lang === 'hi' ? MODE_HI[mode] || FAILURE_MODES[mode]?.name : FAILURE_MODES[mode]?.name) || '';
const fmtV = (v, d) => num(v, d == null ? 1 : Math.max(0, Math.min(2, d)));
// Short part noun for sentences ("The bearing set arrives from Chennai …").
const PART_NOUN = { 'SP-001': 'spindle bearing set', 'SP-002': 'fan bearing', 'SP-030': 'coupling kit', 'SP-040': 'balancing weight kit', 'SP-050': 'seal kit',
  'SP-060': 'impeller and seal', 'SP-070': 'heater element bank', 'SP-080': 'rewind kit', 'SP-090': 'spare sensor', 'SP-010': 'insert pack', 'SP-020': 'belt set' };
const partNoun = p => PART_NOUN[p.id] || lc1(p.name);

function kindChip(wo, T) {
  const ic = wo.kind === 'INSPECT' ? 'sensor' : wo.kind === 'PM' ? 'calendar' : 'wrench';
  return html`<span class="tp-kind">${icon(ic)}${T.kind[wo.kind] || T.kind.REPAIR}</span>`;
}
function statusChip(wo, T) {
  const s = T.status[wo.status] || wo.status;
  if (isPending(wo)) return html`<span class="state normal">${icon('lock')}${s}</span>`;
  if (wo.status === 'IN_PROGRESS') return html`<span class="state normal">${icon('wrench')}${s}</span>`;
  return html`<span class="state ok">${icon('check')}${s}</span>`;
}
function partLine(pi, T, lang) {
  switch (pi.k) {
    case 'none': return T.noPart;
    case 'stock': return T.inStock(pi.site.city);
    case 'notyet': return T.notYet(pi.fromCity, pi.part.etaH);
    case 'buy': return T.buy(hours(pi.part.etaH));
    case 'arrived': return T.arrived(pi.fromCity);
    default: return T.transit(pi.fromCity, whenOf(pi.eta, lang));
  }
}

// ---------- headline + do this (page level, English) ----------
function headlineFor(C) {
  const { tech, L, wo, M, store } = C;
  const first = L.active[0];
  const nm = tech.name;
  const label = w => { const a = M.assetById(w.assetId); return `${a.id} ${jobTitle(w, a, 'en')}`; };
  const more = L.pending.length ? html` ${plural(L.pending.length, 'more job')} ${L.pending.length > 1 ? 'wait' : 'waits'} for approval and cannot be started yet.` : '';
  if (first) {
    const pi = partInfo(first, store, M);
    const win = first.window || first.proposedWindow;
    const head = L.active.length === 1 ? html`<b>${nm}</b> has 1 job: <b>${label(first)}</b>, ${shortWhen(win.start, 'en')}.`
      : html`<b>${nm}</b> has ${L.active.length} jobs; first: <b>${label(first)}</b>, ${shortWhen(win.start, 'en')}.`;
    let part = '';
    if (pi.k === 'transit') part = html` The ${partNoun(pi.part)} arrives from ${pi.fromCity} <b>${shortWhen(pi.eta, 'en')}</b>; until then the steps stay locked.`;
    else if (pi.k === 'arrived') part = html` The ${partNoun(pi.part)} has arrived from ${pi.fromCity}, so the job can start.`;
    else if (pi.k === 'stock' && first.kind !== 'INSPECT') part = html` The ${partNoun(pi.part)} is in the ${pi.site.city} store.`;
    else if (first.kind === 'INSPECT') part = html` No production stop: the machine keeps running.`;
    const prog = first.status === 'IN_PROGRESS' ? html` In progress: ${first.steps.filter((_, i) => first.checks && first.checks['step-' + i]).length} of ${first.steps.length} steps done.` : '';
    return headline(html`${head}${part}${prog}${more}`, pi.k === 'transit' ? 'watch' : 'ok');
  }
  if (L.pending.length) {
    const p = L.pending[0];
    return headline(html`<b>${nm}</b> has no job to start yet: the <b>${label(p)}</b> waits for approval on 5 · Work Orders. The phone shows it locked; nobody can start a job before a person approves it.`, 'act');
  }
  if (L.done.length) {
    const d = L.done[0], a = M.assetById(d.assetId);
    return headline(html`<b>${nm}</b> finished ${plural(L.done.length, 'job')} today: <b>${a.id}</b> is back to normal and the alert is closed. Every tick is in the audit log with the name and time.`, 'ok');
  }
  const other = otherOpenTech(C);
  return headline(html`<b>${nm}</b> has no jobs yet.${other ? html` Today's open job, <b>${label(other.wo)}</b>, belongs to <b>${other.tech.name}</b>.` : ' Jobs appear here once a person approves a work order or books preventive maintenance.'}`);
}
// Someone else at the plant with an open (or waiting) job, for the empty state.
function otherOpenTech(C) {
  const { W, st, tech } = C;
  const wo = st.workOrders.find(w => w.technician && w.technician.id !== tech.id && (isActive(w) || isPending(w)));
  if (!wo) return null;
  return { wo, tech: W.technicians.find(t => t.id === wo.technician.id) || { id: wo.technician.id, name: wo.technician.name } };
}

function stepsFor(C) {
  const { wo, pi, pr, tech } = C;
  const first = html`Pick the technician ${marker(1)} (it starts on the person assigned to today's case) and tap a job in <b>My jobs</b>.`;
  if (!wo) return [first, html`No jobs yet: approve a repair on <a href="#/orders">5\u00a0·\u00a0Work Orders</a> or book preventive maintenance on the <a href="#/schedule">Maintenance calendar</a>, then come back.`];
  if (!pr.approved) return [first, html`${tech.name}'s job is locked: approve it on <a href="#/orders/${wo.id}">5\u00a0·\u00a0Work Orders</a> with your name, then come back here.`];
  if (wo.status === 'DONE') return [first, html`Read the result ${marker(4)}, then see the machine grey on <a href="#/map">1\u00a0·\u00a0Plant Map</a> and every signed tick on <a href="#/trust">8\u00a0·\u00a0Trust Audit</a>.`];
  if (!pi.ready) return [first, html`The part is on the road, so LOTO and the steps ${marker(2)} stay locked. Jump the plant clock to the arrival (<b>Skip to the part arrival</b> under What is enforced, or <a href="#/presenter">Presenter</a>).`,
    html`Then tick LOTO ${marker(2)}, the steps ${marker(3)}${pr.needRead ? ', enter the vibration after the repair' : ''} and press <b>Mark job done</b> ${marker(4)}.`];
  return [first, html`Tick the ${wo.kind === 'INSPECT' ? 'safety check' : 'LOTO check'} ${marker(2)} first: every step stays locked until it is ticked.`,
    html`Tick each step ${marker(3)} as you finish it${pr.needRead ? ', enter the vibration after the repair (2.3 mm/s or below to release)' : ''}, then press <b>Mark job done</b> ${marker(4)}.`];
}

// ---------- phone: header, name, job list ----------
function appHead(C) {
  const { W, st, T, lang, tech } = C;
  const site = W.technicians.filter(t => t.siteId === W.scenario.site);
  const withJobs = W.technicians.filter(t => t.siteId !== W.scenario.site && (st.workOrders.some(w => w.technician && w.technician.id === t.id && w.status !== 'REJECTED') || t.id === tech.id));
  const count = t => st.workOrders.filter(w => w.technician && w.technician.id === t.id && (isActive(w) || isPending(w))).length;
  const opt = t => html`<option value="${t.id}" ${t.id === tech.id ? raw('selected') : ''}>${t.name} · ${T.jobsN(count(t))}</option>`;
  return html`<div class="tp-apphead">
    <div class="tp-apptitle"><span class="tp-avatar" aria-hidden="true">${tech.name.split(' ').map(s => s[0]).join('').slice(0, 2)}</span>
      <div class="tp-apptitle-t"><b class="${lang === 'hi' ? 'deva' : ''}" ${lang === 'hi' ? raw('lang="hi"') : ''}>${T.app}</b><span class="xs">${C.M.siteById(tech.siteId).name}</span></div>
      <div class="seg tp-lang" role="group" aria-label="Language / भाषा">
        <button type="button" data-action="t-lang" data-lang="en" aria-pressed="${lang === 'en'}" id="tpLangEn">English</button>
        <button type="button" data-action="t-lang" data-lang="hi" aria-pressed="${lang === 'hi'}" id="tpLangHi" lang="hi" class="deva">हिन्दी</button>
      </div>
    </div>
    <div class="tp-picker">
      ${marker(1)}
      <label for="tpTech" class="visually-hidden">${lang === 'hi' ? 'टेक्नीशियन चुनें' : 'Choose the technician'}</label>
      <select id="tpTech" class="input" data-action="t-tech">
        <optgroup label="${C.M.siteById(W.scenario.site).name}">${site.map(opt)}</optgroup>
        ${withJobs.length ? html`<optgroup label="Other plants with jobs">${withJobs.map(opt)}</optgroup>` : ''}
      </select>
    </div>
  </div>`;
}

function nameBar(C) {
  const { store, T, tech } = C;
  const n = store.prefs.name;
  if (n && !ui.editName) {
    return html`<div class="tp-namebar"><span>${icon('user')}${T.signedAs} <b>${n}</b></span><button type="button" class="btn sm ghost" data-action="t-name-edit" id="tpNameEdit">${T.change}</button></div>`;
  }
  return html`<div class="tp-namebox">
    <div class="field"><label for="tpName">${T.yourName}</label>
      <div class="tp-inline"><input id="tpName" class="input" type="text" autocomplete="name" maxlength="40" placeholder="${tech.name}" value="${ui.name || ''}" data-action="t-name" aria-describedby="tpNameErr tpNameHelp">
        <button type="button" class="btn" data-action="t-name-save">${T.save}</button></div>
      <p class="tp-err" id="tpNameErr" hidden></p>
      <p class="xs dim" id="tpNameHelp">${T.nameHelp}</p></div>
    ${n !== tech.name ? html`<button type="button" class="btn sm" data-action="t-name-me" data-name="${tech.name}">${icon('user')}${T.iAm(tech.name)}</button>` : ''}
  </div>`;
}

function jobList(C) {
  const { L, T, tech } = C;
  const n = L.active.length + L.pending.length + L.done.length;
  if (!n) return emptyJobs(C);
  const groups = [['toDo', L.active], ['waiting', L.pending], ['doneToday', L.done]].filter(g => g[1].length);
  return html`<section class="tp-jobs" aria-label="${T.app}: ${tech.name}">
    ${groups.map(([k, list]) => html`<h3 class="tp-sub">${T[k]} <span class="tp-count">${list.length}</span></h3>
      <ul class="tp-joblist">${list.map(w => jobItem(w, C))}</ul>`)}
    ${L.olderDone ? html`<p class="xs dim">${T.earlierDone(L.olderDone)}</p>` : ''}
  </section>`;
}

function jobItem(w, C) {
  const { M, store, T, lang } = C;
  const a = M.assetById(w.assetId), line = M.lineById(a.lineId), site = M.siteById(a.siteId);
  const pi = partInfo(w, store, M);
  const pend = isPending(w), done = w.status === 'DONE';
  const by = done ? doneBy(store, w) : '';
  const win = w.window || w.proposedWindow;
  const nDone = w.steps.filter((_, i) => w.checks && w.checks['step-' + i]).length;
  return html`<li class="tp-job ${pend ? 'is-locked' : ''} ${done ? 'is-done' : ''}">
    <button type="button" class="tp-job-main" data-action="t-sel" data-id="${w.id}" id="tp-job-${w.id}" aria-pressed="${w.id === ui.sel}">
      <span class="tp-job-top">${kindChip(w, T)}${statusChip(w, T)}</span>
      <span class="tp-job-title"><b class="mono">${a.id}</b> · ${cap1(jobTitle(w, a, lang))}</span>
      <span class="tp-job-meta">${a.name} · ${line.short}, ${site.city}</span>
      <span class="tp-job-line">${icon('clock')}<span>${done ? T.doneLine(shortWhen(w.doneAt, lang), by) : pend ? T.propLine(winText(win, lang)) : T.winLine(winText(win, lang))}</span></span>
      ${done ? '' : html`<span class="tp-job-line ${pi.k === 'transit' ? 'is-wait' : ''}">${icon(pi.k === 'transit' || pi.k === 'notyet' ? 'truck' : 'box')}<span>${partLine(pi, T, lang)}</span></span>`}
      ${w.status === 'IN_PROGRESS' ? html`<span class="tp-job-line">${icon('check')}<span>${T.stepsOf(nDone, w.steps.length)}</span></span>` : ''}
    </button>
    ${pend ? html`<p class="tp-lock">${icon('lock')}<span>${T.locked} <a href="#/orders/${w.id}">${T.openOrders}</a></span></p>` : ''}
  </li>`;
}

function emptyJobs(C) {
  const { T, tech, st, W, lang, M } = C;
  const other = otherOpenTech(C);
  const pendAny = st.workOrders.find(w => isPending(w));
  const pa = pendAny ? M.assetById(pendAny.assetId) : null;
  return html`<section class="tp-empty" aria-label="${T.app}">
    ${icon('orders')}
    <h3>${T.emptyTitle(tech.name)}</h3>
    ${pendAny ? html`<p>${T.emptyApprove(pa.id, jobTitle(pendAny, pa, lang))}</p>` : !st.workOrders.length ? html`<p>${T.emptyQuiet}</p>` : ''}
    ${other ? html`<p class="small">${T.emptyOther(other.tech.name)}</p>` : ''}
    <div class="tp-empty-btns">
      ${pendAny ? html`<a class="btn primary" href="#/orders/${pendAny.id}">${icon('orders')}${T.openOrders}</a>` : ''}
      ${other ? html`<button type="button" class="btn" data-action="t-show-tech" data-id="${other.tech.id}">${icon('user')}${T.showJobsOf(other.tech.name)}</button>` : ''}
      ${!pendAny && !other ? html`<a class="btn primary" href="#/schedule">${icon('calendar')}${T.seeCal}</a><a class="btn" href="#/presenter">${icon('play')}Presenter</a>` : ''}
      ${!W.scenario.hero && !st.workOrders.length ? html`<button type="button" class="btn" data-action="load-sample" data-scenario="pune-bearing">${icon('data')}Load the Pune bearing case</button>` : ''}
    </div>
  </section>`;
}

const doneBy = (store, w) => (store.state.audit.find(r => /^(Completed the repair|Replaced the sensor|Completed preventive maintenance)$/.test(r.action) && String(r.detail).startsWith(w.id)) || {}).actor || '';

// ---------- phone: the job card ----------
function jobCard(C) {
  const { wo, a, pr, M, T, lang } = C;
  const line = M.lineById(a.lineId), site = M.siteById(a.siteId);
  return html`<article class="tp-card" id="tpCard" aria-label="${wo.id}">
    <header class="tp-card-head">
      <div class="tp-job-top">${kindChip(wo, T)}${statusChip(wo, T)}<span class="mono xs dim tp-woid">${wo.id}</span></div>
      <h3><span class="mono">${a.id}</span> · ${cap1(jobTitle(wo, a, lang))}</h3>
      <p class="small muted">${a.name} · ${line.name}, ${site.name}</p>
    </header>
    ${resultPanel(C)}
    ${!pr.approved ? html`<p class="tp-banner lock" role="note">${icon('lock')}<span><b>${T.locked}</b> <a href="#/orders/${wo.id}">${T.openOrders}</a></span></p>` : ''}
    ${whyBlock(C)}
    ${facts(C)}
    ${sopBlock(C)}
    ${safetyBlock(C)}
    ${stepsBlock(C)}
    ${pr.needRead || (wo.kind === 'REPAIR' && !hasVib(a)) ? releaseBlock(C) : ''}
    ${notesBlock(C)}
    ${photoBlock(C)}
    ${doneBlock(C)}
  </article>`;
}

function resultPanel(C) {
  const { wo, a, T, store, M, lang } = C;
  if (wo.status !== 'DONE') return '';
  const sv = (store.state.savings || []).find(s => s.woId === wo.id);
  const ass = M.assess(a, store.t);
  const title = wo.kind === 'INSPECT' ? T.resInspect(a.id) : wo.kind === 'PM' ? T.resPm(a.id) : T.resRepair(a.id);
  const txt = wo.kind === 'INSPECT' ? T.resInspectTxt : wo.kind === 'PM' ? T.resPmTxt : T.resRepairTxt(inr(sv ? sv.avoidedInr : 0));
  const by = doneBy(store, wo);
  return html`<div class="tp-result" id="tpResult" tabindex="-1" role="status">
    <p class="tp-result-title">${icon('check')}<b>${title}</b></p>
    <p>${txt}${wo.kind !== 'PM' ? html` ${T.nowNormal(ass.health)}` : ''}</p>
    <p class="xs">${T.closedBy(by || '—', whenOf(wo.doneAt, lang))}</p>
    <div class="tp-result-links">
      <a class="btn sm" href="#/map">${icon('map')}${T.seeMap}</a>
      ${wo.kind === 'REPAIR' ? html`<a class="btn sm" href="#/oee">${icon('gauge')}${T.seeOee}</a>` : wo.kind === 'PM' ? html`<a class="btn sm" href="#/schedule">${icon('calendar')}${T.seeCal}</a>` : ''}
      <a class="btn sm" href="#/trust">${icon('shield')}${T.seeTrust}</a>
    </div>
  </div>`;
}

// Why the job exists: the AI's evidence for a repair or a sensor check; the PM due date for a preventive job.
function whyBlock(C) {
  const { wo, a, T, lang, store, M } = C;
  if (wo.kind === 'PM') {
    const row = pmPlan().find(r => r.assetId === a.id);
    const by = wo.createdBy || (wo.approvals[0] || {}).by || '';
    return html`<section class="tp-sec" aria-label="${T.whyPm}">
      <h4>${T.whyPm}</h4>
      <p class="tp-chips">${humanChip(T.schedBy(by))}</p>
      ${row ? html`<p class="small">${T.pmWhy(whenOf(row.last, lang).replace(/ \d\d:\d\d$/, ''), row.interval, whenOf(row.due, lang).replace(/ \d\d:\d\d$/, ''))} ${row.overdue && wo.status !== 'DONE' ? T.overdue(Math.ceil(-row.daysToDue)) : ''}</p>` : ''}
      ${wo.bundleWith ? html`<p class="small dim">${lang === 'hi' ? `${wo.bundleWith} वाले स्टॉप में ही` : `Bundled into the ${wo.bundleWith} stop: no extra line stop.`}</p>` : ''}
    </section>`;
  }
  const al = store.state.alerts.find(x => x.id === wo.alertId);
    const done = wo.status === 'DONE';
  const ass = M.assess(a, done ? r15(wo.doneAt || store.t) - 15 * MIN : store.t);
  const chip = aiChip(T.raisedBy(shortWhen(al ? al.createdAt : wo.createdAt, lang)));
  if (wo.kind === 'INSPECT') {
    const sf = ass.sensorFault;
    const tag = sf ? M.tagOf(a, sf.tag) : null;
    return html`<section class="tp-sec" aria-label="${T.why}">
      <h4>${T.why}</h4>
      <p class="tp-chips">${chip}</p>
      <p class="small">${sf ? T.sensorWhy(tagLabel(tag, lang), Math.round(sf.sinceH)) : T.sensorWas}</p>
      ${sf ? html`<p class="small dim">${T.frozenAt(fmtV(M.valueAt(a, sf.tag, store.t), tag.d), tag.unit)}</p>` : ''}
    </section>`;
  }
  const c = ass.contributions[0];
  const tag = M.tagOf(a, c.key);
  const v = M.trendAt(a, c.key, ass.t);
  const dev = M.deviation(tag, v), devAlarm = M.deviation(tag, tag.alarm);
  const over = dev >= devAlarm;
  return html`<section class="tp-sec" aria-label="${T.why}">
    <h4>${T.why}</h4>
    <p class="tp-chips">${chip}</p>
    <p>${done ? html`<span class="dim">${T.beforeRepair}</span> ` : ''}<b>${modeName(wo.mode, lang) || ass.modeName || (lang === 'hi' ? 'असामान्य रीडिंग' : 'Abnormal readings')}</b> · ${T.health(ass.health)} · ${T.conf(confPct(ass.conf))}</p>
    <div class="tp-gauge" role="img" aria-label="${tagLabel(tag, lang)} ${fmtV(v, tag.d)} ${tag.unit}; ${T.limits(tag.alarm, tag.trip, tag.unit)}">
      <div class="tp-gauge-top"><span>${T.vsLimit}: <b>${tagLabel(tag, lang)}</b></span><b class="num ${over ? 'is-act' : ''}">${fmtV(v, tag.d)} ${tag.unit}</b></div>
      <div class="tp-gauge-bar" aria-hidden="true"><span class="fill ${over ? 'act' : 'watch'}" style="width:${(Math.max(0.02, dev) * 100).toFixed(1)}%"></span><span class="tick" style="left:${(devAlarm * 100).toFixed(1)}%"></span></div>
      <div class="tp-gauge-scale xs" aria-hidden="true"><span>${T.normalLbl(fmtV(tag.normal, tag.d))}</span><span>${T.limits(tag.alarm, tag.trip, tag.unit)}</span></div>
    </div>
    ${!done && ass.rulKind === 'trend' && ass.rulH ? html`<p class="small">${T.rul(hours(ass.rulH), Math.round(ass.rulLo), Math.round(ass.rulHi))}</p>` : ''}
    ${done ? html`<p class="small dim">${T.nowNormal(M.assess(a, store.t).health)}</p>` : ''}
  </section>`;
}

function facts(C) {
  const { wo, pi, T, lang } = C;
  const win = wo.window || wo.proposedWindow;
  const ap = wo.approvals.find(x => x.action === 'Approved');
  const t = wo.technician;
  return html`<section class="tp-sec">
    <dl class="tp-facts">
      <dt>${icon('clock')}${T.window}</dt><dd>${isPending(wo) ? T.propLine(winText(win, lang)) : winText(win, lang)}${win && win.reason && lang === 'en' ? html`<span class="dim"> · ${win.reason}</span>` : ''}</dd>
      <dt>${icon(pi.k === 'transit' || pi.k === 'notyet' ? 'truck' : 'box')}${T.part}</dt>
      <dd>${wo.part ? html`${wo.part.name} <span class="mono xs dim nowrap">${wo.part.id}</span><br>` : ''}<span class="${pi.k === 'transit' ? 'state watch' : pi.k === 'arrived' || pi.k === 'stock' ? 'state normal' : ''}">${pi.k === 'transit' ? icon('truck') : pi.k === 'arrived' || pi.k === 'stock' ? icon('check') : ''}${partLine(pi, T, lang)}</span></dd>
      <dt>${icon('user')}${T.tech}</dt><dd>${t ? T.techLine(t.name, t.shift) : '—'}</dd>
      ${ap ? html`<dt>${icon('check')}${T.approvedBy}</dt><dd>${humanChip(`${ap.by} · ${shortWhen(ap.at, lang)}`)}</dd>` : ''}
    </dl>
  </section>`;
}

function sopBlock(C) {
  const { wo, T, lang } = C;
  const doc = DOCS.find(d => d.id === wo.sop);
  if (!doc) return html`<p class="small dim tp-sec-inline">${icon('doc')}${T.sopNone}</p>`;
  return html`<details class="tp-sop">
    <summary>${icon('doc')}<span>${T.sop(doc.id)}${lang === 'en' ? html`<span class="dim">: ${doc.title.replace(/^\S+\s/, '')}</span>` : ''}</span></summary>
    <p lang="en">${doc.text}</p>
  </details>`;
}

function safetyBlock(C) {
  const { wo, a, pr, pi, T, lang } = C;
  const k = pr.sk;
  const on = !!pr.safe;
  const lockedAfter = on && pr.nDone > 0 && wo.status !== 'DONE';     // LOTO cannot come off mid-job
  const enabled = pr.gateSafety && !lockedAfter;
  const pre = wo.mode === 'FM-07' ? T.preStandby : wo.mode === 'FM-05' ? T.preDraught : '';
  const label = k === 'safety' ? T.safeLabel : T.lotoLabel(a.id, pre);
  let hint = '';
  if (!pr.approved) hint = T.lotoPending;
  else if (!pi.ready) hint = T.lotoWait;
  else if (lockedAfter) hint = T.lotoStays;
  return html`<section class="tp-sec tp-safety ${on ? 'is-on' : ''} ${enabled || on ? '' : 'is-off'}" aria-label="${T.safety}">
    <h4>${marker(2)}${icon('lock')}${k === 'safety' ? T.safetyRun : T.safety}</h4>
    <label class="tp-big-check" for="tp-chk-${k}">
      <input type="checkbox" id="tp-chk-${k}" data-action="t-safety" data-key="${k}" ${on ? raw('checked') : ''} ${enabled ? '' : raw('disabled')} aria-describedby="tpSafetyHint">
      <span>${label}</span>
    </label>
    <p class="xs tp-signed" id="tpSafetyHint">${on ? html`${icon('user')}<span>${T.tickedBy(pr.safe.by, shortWhen(pr.safe.at, lang))}${hint ? ' · ' + hint : ''}</span>` : hint}</p>
  </section>`;
}

function stepsBlock(C) {
  const { wo, pr, pi, T, lang } = C;
  const nextI = pr.gateSteps ? pr.ticks.findIndex(x => !x) : -1;
  let gate = '';
  if (!pr.approved) gate = html`<p class="tp-banner lock">${icon('lock')}<span>${T.gatePending}</span></p>`;
  else if (wo.status !== 'DONE' && !pi.ready) gate = html`<p class="tp-banner wait">${icon('truck')}<span><b>${T.gateTransit(whenOf(pi.eta, lang))}</b> <a href="#/presenter">${T.jumpDemo}</a></span></p>`;
  else if (wo.status !== 'DONE' && !pr.safe) gate = html`<p class="tp-banner lock">${icon('lock')}<span>${pr.sk === 'safety' ? T.gateSafe : T.gateLoto}</span></p>`;
  const doc = DOCS.find(d => d.id === wo.sop);
  return html`<section class="tp-sec" aria-label="${T.steps}">
    <h4>${marker(3)}${T.steps} <span class="tp-count">${pr.nDone}/${wo.steps.length}</span></h4>
    ${gate}
    <ol class="tp-steps">${wo.steps.map((s, i) => {
      const tk = pr.ticks[i];
      const dis = !pr.gateSteps;
      return html`<li class="${tk ? 'is-done' : ''} ${i === nextI ? 'is-next' : ''}">
        <label class="tp-step" for="tp-chk-step-${i}">
          <input type="checkbox" id="tp-chk-step-${i}" data-action="t-step" data-i="${i}" ${tk ? raw('checked') : ''} ${dis ? raw('disabled') : ''}>
          <span class="tp-step-t"><span class="tp-step-n mono">${i + 1}</span>${stepText(s, lang)}${i === nextI ? html` <span class="tp-next">${T.next}</span>` : ''}</span>
        </label>
        ${tk ? html`<span class="xs tp-signed">${icon('user')}<span>${T.tickedBy(tk.by, shortWhen(tk.at, lang))}</span></span>` : ''}
      </li>`;
    })}</ol>
    ${doc && lang === 'en' ? html`<p class="xs dim">From ${doc.title}.</p>` : ''}
  </section>`;
}

function releaseBlock(C) {
  const { wo, a, pr, T, lang } = C;
  if (!hasVib(a)) return html`<section class="tp-sec" aria-label="${T.release}"><h4>${T.release}</h4><p class="small">${T.noVib}</p></section>`;
  const r = pr.reading;
  const enabled = pr.gateSteps;
  const val = ui.reading[wo.id] || '';
  const hint = FAIL_HINT[lang][wo.mode] || FAIL_HINT[lang]._;
  const MAXV = 11.2;
  const X = v => (Math.min(v, MAXV) / MAXV * 100).toFixed(1) + '%';
  return html`<section class="tp-sec" aria-label="${T.release}">
    <h4>${icon('gauge')}${T.release}</h4>
    <p class="small">${T.releaseHelp(wo.mode === 'FM-01')}</p>
    <div class="tp-zones" aria-hidden="true">
      <span class="z a" style="width:${X(2.3)}">A ≤ 2.3</span><span class="z b" style="width:calc(${X(4.5)} - ${X(2.3)})">B</span><span class="z c" style="width:calc(${X(7.1)} - ${X(4.5)})">C</span><span class="z d" style="flex:1">D</span>
      <span class="lim" style="left:${X(2.3)}"></span>
      ${r ? html`<span class="mk ${r.pass ? 'ok' : 'act'}" style="left:${X(r.v)}"></span>` : ''}
    </div>
    <p class="xs dim tp-zone-cap" aria-hidden="true">ISO 10816 · mm/s · ${T.limitLbl} 2.3</p>
    <div class="field"><label for="tpReading">${T.readLabel}</label>
      <div class="tp-inline"><input id="tpReading" class="input num" type="text" inputmode="decimal" autocomplete="off" maxlength="6" placeholder="1.9" value="${val}" data-action="t-reading" ${enabled ? '' : raw('disabled')} aria-describedby="tpReadingErr">
        <button type="button" class="btn" data-action="t-save-reading" ${enabled ? '' : raw('disabled')}>${T.saveReading}</button></div>
      <p class="tp-err" id="tpReadingErr" hidden></p></div>
    ${r ? html`<div class="tp-verdict ${r.pass ? 'ok' : 'act'}" id="tpVerdict" tabindex="-1" role="status">
      <p class="tp-verdict-t">${icon(r.pass ? 'check' : 'x')}<b>${r.pass ? T.pass : T.fail}</b></p>
      <p class="small">${r.pass ? T.passTxt(fmtV(r.v, 1)) : T.failTxt(fmtV(r.v, 1), hint)}</p>
      <p class="xs">${T.savedBy(r.by, shortWhen(r.at, lang))}</p>
    </div>` : ''}
  </section>`;
}

function notesBlock(C) {
  const { wo, a, T, lang } = C;
  const notes = wo.notes || [];
  const old = DOCS.filter(d => d.kind === 'Note' && d.title.includes(a.id));
  const open = wo.status !== 'DONE';
  return html`<section class="tp-sec" aria-label="${T.notes}">
    <h4>${icon('chat')}${T.notes}</h4>
    ${old.map(d => {
      const mm = /^(.*?)\s*\((.*)\)\s*$/.exec(d.text);
      const hinglish = mm ? mm[1] : d.text, english = mm ? mm[2] : '';
      return html`<figure class="tp-oldnote">
        <figcaption class="xs">${icon('doc')}${T.earlierNote} · ${d.id}</figcaption>
        <blockquote lang="hi-Latn">${hinglish}</blockquote>
        ${lang === 'hi' && NOTE_HI[d.id] ? html`<p class="small deva" lang="hi">${NOTE_HI[d.id]}</p>` : english ? html`<p class="small dim" lang="en">${english}</p>` : ''}
      </figure>`;
    })}
    ${notes.length ? html`<ul class="tp-notes">${notes.map(n => html`<li><p>${n.text}</p><p class="xs dim">${icon('user')}${n.by} · ${shortWhen(n.at, lang)}</p></li>`)}</ul>` : html`<p class="small dim">${T.noNotes}</p>`}
    ${open ? html`<div class="field"><label for="tpNote" class="visually-hidden">${T.notes}</label>
      <div class="tp-inline"><input id="tpNote" class="input" type="text" maxlength="300" placeholder="${T.notePh}" value="${ui.note[wo.id] || ''}" data-action="t-note" aria-describedby="tpNoteErr">
        <button type="button" class="btn" data-action="t-add-note">${T.addNote}</button></div>
      <p class="tp-err" id="tpNoteErr" hidden></p></div>` : ''}
  </section>`;
}

function photoBlock(C) {
  const { wo, T, urls } = C;
  const list = ui.photos[wo.id] || [];
  const full = list.length >= MAX_PHOTOS;
  return html`<section class="tp-sec" aria-label="${T.photos}">
    <h4>${icon('camera')}${T.photos}</h4>
    ${list.length ? html`<ul class="tp-photos">${list.map((f, i) => {
      const u = URL.createObjectURL(f); urls.push(u);
      return html`<li><img src="${u}" alt="${f.name || T.photos}"><button type="button" class="tp-photo-del" data-action="t-photo-del" data-i="${i}" aria-label="${T.removePhoto} ${i + 1}">${icon('x')}</button></li>`;
    })}</ul>` : ''}
    <div class="tp-photo-add">
      <input type="file" id="tpPhoto" class="tp-file" accept="image/*" capture="environment" data-action="t-photo" ${full ? raw('disabled') : ''}>
      <label for="tpPhoto" class="btn ${full ? 'is-disabled' : ''}">${icon('camera')}${T.addPhoto}</label>
      <span class="xs dim">${T.photoCap}${full ? '. ' + T.photoMax : ''}</span>
    </div>
  </section>`;
}

function doneBlock(C) {
  const { wo, pr, T } = C;
  if (wo.status === 'DONE') return '';
  const words = pr.missing.map(([k, n]) => (k === 'steps' ? T.miss.steps(n) : T.miss[k]));
  const can = pr.canFinish;
  return html`<section class="tp-sec tp-finish" aria-label="${T.markDone}">
    <button type="button" class="btn approve lg tp-done-btn" data-action="t-done" id="tpDone" ${can ? '' : raw('aria-disabled="true"')} aria-describedby="tpDoneWhy">${marker(4)}${icon('check')}${T.markDone}</button>
    <p class="small ${can ? 'tp-ready' : 'tp-missing'}" id="tpDoneWhy">${can ? T.allSet : html`<b>${T.stillToDo}</b> ${words.join(', ')}.`}</p>
  </section>`;
}

// ---------- actions with fields ----------
// The disabled "Mark job done" explains itself; pressing it anyway scrolls to the first thing still missing.
function showMissing(root, p) {
  const k = (p.missing[0] || [])[0];
  const sel = { approval: '.tp-card > .tp-banner.lock', part: '.tp-banner.wait', loto: '.tp-safety', safety: '.tp-safety', steps: '.tp-steps > li:not(.is-done)', reading: '#tpReading', passing: '#tpReading' }[k];
  const el = sel ? root.querySelector(sel) : null;
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  if (el.matches('input') && !el.disabled) setTimeout(() => el.focus({ preventScroll: true }), 300);
  el.classList.remove('tp-flash'); void el.offsetWidth; el.classList.add('tp-flash');
  setTimeout(() => el.classList.remove('tp-flash'), 2600);
}

function saveReading(root, ctx, T) {
  const { S, store } = ctx;
  const w = store.state.workOrders.find(x => x.id === ui.sel); if (!w) return;
  const name = needName(root, store); if (!name) return;
  const raw0 = (root.querySelector('#tpReading')?.value || '').trim().replace(',', '.');
  const v = Number(raw0);
  if (!raw0 || !isFinite(v) || v < 0 || v > 50) return flagField(root, 'tpReading', 'tpReadingErr', T.readBad);
  ui.reading[w.id] = '';
  ui.focus = '#tpVerdict';
  S.recordReading(w.id, Math.round(v * 100) / 100, name);
}
function addNote(root, ctx, T) {
  const { S, store } = ctx;
  const w = store.state.workOrders.find(x => x.id === ui.sel); if (!w) return;
  const text = (root.querySelector('#tpNote')?.value || '').trim();
  if (!text) return flagField(root, 'tpNote', 'tpNoteErr', T.noteEmpty);
  const name = needName(root, store); if (!name) return;
  ui.note[w.id] = '';
  ui.focus = '#tpNote';
  S.addNote(w.id, text, name);
}

// ---------- the explanation column (page level, English) ----------
function explain(C) {
  const { wo, a, pi, st } = C;
  const rules = wo ? rulesFor(C) : [];
  const rows = wo ? st.audit.filter(r => String(r.detail).startsWith(wo.id) || (wo.part && r.target === wo.part.id && r.ts >= wo.createdAt)).slice(0, 6) : [];
  const who = r => (r.kind === 'ai' || r.kind === 'blocked' ? aiChip(r.actor) : r.kind === 'system' ? html`<span class="chip tp-sys">${icon('layers')}${r.actor}</span>` : humanChip(r.actor));
  return html`<aside class="tp-explain" aria-label="How the technician view works">
    <section class="card">
      <div class="card-head"><h2>What the technician sees</h2></div>
      <ul class="tp-bullets small">
        <li><b>Only their own jobs</b>, in the order to do them: the job in hand, then jobs still waiting for approval (shown locked), then today's finished ones.</li>
        <li><b>Why the AI raised it</b>: the failure mode, the machine's health and the sensor that moved most, against its alarm and trip limits.</li>
        <li><b>The part and the window</b>: in stock, on the road with its arrival time, or arrived; and the low-impact slot the planner booked.</li>
        <li><b>The SOP excerpt</b>, notes from earlier shifts (on VMC-204 a Hinglish note from Shift B), their own notes and photos.</li>
        <li><b>English or <span lang="hi" class="deva">हिन्दी</span></b>: labels and steps switch; machine IDs, part numbers and units stay as printed on the machine.</li>
      </ul>
    </section>
    <section class="card" aria-live="polite">
      <div class="card-head"><h2>What is enforced</h2>${wo ? html`<span class="sub">live for <span class="mono">${wo.id}</span> · ${a.id}</span>` : ''}</div>
      ${wo ? html`<ol class="tp-rules">${rules.map(r => html`<li class="${r.st}"><span class="tp-rule-ic">${icon(r.st === 'ok' ? 'check' : r.st === 'block' ? 'x' : r.st === 'wait' ? 'clock' : 'more')}</span>
        <div><b>${r.title}</b><p class="small">${r.text}</p></div></li>`)}</ol>`
        : html`<ul class="tp-bullets small"><li>${term('LOTO', LOTO_TIP)} first; steps locked until the part arrives; release only at 2.3 mm/s or below (SOP-17, ISO 10816 zone A); every tick logged with a name and the time.</li></ul>`}
      ${wo && pi && pi.k === 'transit' ? html`<div class="tp-demo">
        <p class="small"><b>Demo:</b> the ${partNoun(pi.part)} arrives ${dateTime(pi.eta)}. Skip the plant clock there instead of waiting.</p>
        <div class="row"><button type="button" class="btn" data-action="t-skip" data-ms="${pi.eta}">${icon('forward')}Skip to the part arrival</button><a class="btn ghost" href="#/presenter">${icon('play')}Presenter</a></div>
      </div>` : ''}
    </section>
    ${wo ? html`<section class="card">
      <div class="card-head"><h2>Logged for this job</h2><div class="right"><a class="btn sm ghost" href="#/trust">8 · Trust Audit ${icon('arrowR')}</a></div></div>
      ${rows.length ? html`<ol class="tp-audit">${rows.map(r => { const d = String(r.detail || '').replace(wo.id, '').replace(/^[:\s]+/, '');
        return html`<li><span class="mono xs dim">${shortDT(r.ts)}</span><span>${who(r)}</span><span class="small"><b>${r.action}</b>${d ? html` · ${d}` : ''}</span></li>`; })}</ol>`
        : html`<p class="small dim">Nothing logged yet.</p>`}
      <p class="xs dim">Newest first. The AI's drafts are blue; people's decisions and ticks carry their name.</p>
    </section>` : ''}
  </aside>`;
}

function rulesFor(C) {
  const { wo, a, pi, pr, store } = C;
  const ap = wo.approvals.find(x => x.action === 'Approved');
  const out = [];
  out.push({ title: 'A person approves first (Policy G8)', st: pr.approved ? 'ok' : 'block',
    text: pr.approved ? `Approved by ${ap ? ap.by : 'a person'} at ${shortDT(ap ? ap.at : wo.createdAt)}.` : 'Waiting for approval: the phone shows the job locked and nothing can be ticked.' });
  if (wo.part && wo.part.kind !== 'local') out.push({ title: 'The part is on site before anyone starts', st: pi.ready ? 'ok' : 'wait',
    text: pi.ready ? `${wo.part.name} arrived from ${pi.fromCity}.` : pr.approved ? `On the road from ${pi.fromCity}, arrives ${dateTime(pi.eta)}. LOTO and the steps stay locked, so the machine keeps producing.` : `Released from ${pi.fromCity} only when a person approves.` });
  else out.push({ title: 'The part is on site before anyone starts', st: 'ok', text: wo.part ? `${wo.part.name}: in stock at ${pi.site.city}.` : 'No part needed for this job.' });
  out.push(wo.kind === 'INSPECT'
    ? { title: 'Safety check first (machine keeps running)', st: pr.safe ? 'ok' : 'wait', text: pr.safe ? `Ticked by ${pr.safe.by} at ${shortDT(pr.safe.at)}. SOP-50: inspect the sensor, no repair crew, no stop.` : 'Not yet. The steps are locked until it is ticked.' }
    : { title: html`${term('LOTO', LOTO_TIP)} first`, st: pr.safe ? 'ok' : 'wait', text: pr.safe ? `Ticked by ${pr.safe.by} at ${shortDT(pr.safe.at)}; it cannot be removed once a step is ticked.` : 'Not yet. Every step is locked until the lock-out is confirmed.' });
  out.push({ title: 'Each step signed with a name and the time', st: pr.nDone === wo.steps.length ? 'ok' : 'wait', text: `${pr.nDone} of ${wo.steps.length} steps ticked.${pr.nDone ? ' The first tick started the job.' : ''}` });
  if (pr.needRead) {
    const r = pr.reading;
    out.push({ title: html`Release only at 2.3 mm/s or below (${wo.mode === 'FM-01' ? 'SOP-17, ' : ''}ISO 10816 zone A)`, st: !r ? 'wait' : r.pass ? 'ok' : 'block',
      text: !r ? 'No reading yet.' : r.pass ? `${num(r.v, 1)} mm/s by ${r.by}: release allowed.` : `${num(r.v, 1)} mm/s by ${r.by}: do not release. Mark job done stays disabled.` });
  } else out.push({ title: 'Release reading', st: 'na', text: wo.kind === 'INSPECT' ? 'Not needed: a sensor check does not stop or repair the machine.' : wo.kind === 'PM' ? 'Not needed for a preventive job; the PM checklist records the readings.' : `${a.id} has no vibration sensor: release after the SOP test run.` });
  out.push(wo.status === 'DONE'
    ? { title: 'Closing needs all of the above', st: 'ok', text: `Closed by ${doneBy(store, wo) || 'a person'} at ${shortDT(wo.doneAt)}. The alert closed with it.` }
    : { title: 'Closing needs all of the above', st: pr.canFinish ? 'ok' : 'wait', text: pr.canFinish ? 'Mark job done is enabled.' : 'Mark job done stays disabled and says what is missing.' });
  return out;
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
