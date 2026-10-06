// Builds the synthetic "Indus Group" world: 3 plants, 48 machines, sensors with limits, ERP (orders, spares),
// CMMS (technicians, history), documents for the copilot, 56 days of failure history for the back-test, and
// 30 days of OEE. Everything is derived from (scenario, seed, anchor time), so a reload reproduces it exactly.
// All names are fictional. Telemetry itself is NOT stored: see scoring.js valueAt(), computed on demand.
import { mulberry32, pick, clamp, strHash } from './rng.js';
import { HOUR, DAY } from './format.js';

// ---------- sensor catalogue (limits per tag; dir 'low' means a fall is bad) ----------
export const TAGS = {
  VIB_RMS:       { label: 'Vibration (RMS)', unit: 'mm/s', normal: 1.8, alarm: 4.5, trip: 11.2, dir: 'high', d: 2, group: 'vib' },
  VIB_PEAK:      { label: 'Peak vibration', unit: 'mm/s', normal: 3.0, alarm: 7.0, trip: 18.0, dir: 'high', d: 1, group: 'vib' },
  BEARING_TEMP:  { label: 'Bearing temperature', unit: '°C', normal: 50, alarm: 75, trip: 95, dir: 'high', d: 1, group: 'temp' },
  MOTOR_CURRENT: { label: 'Motor current', unit: 'A', normal: 24, alarm: 45, trip: 55, dir: 'high', d: 1, group: 'elec' },
  SPINDLE_RPM:   { label: 'Spindle speed', unit: 'rpm', normal: 12000, alarm: 13200, trip: 14000, dir: 'high', d: 0, group: 'speed' },
  COOLANT_PRESS: { label: 'Coolant pressure', unit: 'bar', normal: 5.6, alarm: 3.5, trip: 2.0, dir: 'low', d: 1, group: 'flow' },
  SPEED_RPM:     { label: 'Shaft speed', unit: 'rpm', normal: 1480, alarm: 1560, trip: 1620, dir: 'high', d: 0, group: 'speed' },
  DISCH_PRESS:   { label: 'Discharge pressure', unit: 'bar', normal: 6.2, alarm: 4.4, trip: 3.2, dir: 'low', d: 1, group: 'flow' },
  OUTLET_TEMP:   { label: 'Outlet temperature', unit: '°C', normal: 78, alarm: 98, trip: 110, dir: 'high', d: 1, group: 'temp' },
  OIL_TEMP:      { label: 'Hydraulic oil temperature', unit: '°C', normal: 48, alarm: 62, trip: 72, dir: 'high', d: 1, group: 'temp' },
  HYD_PRESS:     { label: 'Hydraulic pressure', unit: 'bar', normal: 210, alarm: 180, trip: 160, dir: 'low', d: 0, group: 'flow' },
  STROKES:       { label: 'Strokes per minute', unit: 'spm', normal: 22, alarm: 26, trip: 30, dir: 'high', d: 0, group: 'speed' },
  ZONE_TEMP:     { label: 'Zone temperature', unit: '°C', normal: 860, alarm: 900, trip: 930, dir: 'high', d: 0, group: 'temp' },
  POWER_KW:      { label: 'Power', unit: 'kW', normal: 22, alarm: 40, trip: 48, dir: 'high', d: 1, group: 'elec' },
  AIR_PRESS:     { label: 'Air pressure', unit: 'bar', normal: 6.5, alarm: 5.2, trip: 4.5, dir: 'low', d: 1, group: 'flow' },
};

const CLASS_TAGS = {
  cnc:      ['VIB_RMS', 'VIB_PEAK', 'BEARING_TEMP', 'MOTOR_CURRENT', 'SPINDLE_RPM', 'COOLANT_PRESS', 'POWER_KW'],
  rotating: ['VIB_RMS', 'VIB_PEAK', 'BEARING_TEMP', 'MOTOR_CURRENT', 'SPEED_RPM', 'POWER_KW'],
  pump:     ['VIB_RMS', 'BEARING_TEMP', 'MOTOR_CURRENT', 'SPEED_RPM', 'DISCH_PRESS', 'POWER_KW'],
  compressor: ['VIB_RMS', 'BEARING_TEMP', 'MOTOR_CURRENT', 'OUTLET_TEMP', 'POWER_KW'],
  press:    ['VIB_RMS', 'OIL_TEMP', 'HYD_PRESS', 'MOTOR_CURRENT', 'STROKES', 'POWER_KW'],
  thermal:  ['ZONE_TEMP', 'POWER_KW', 'MOTOR_CURRENT'],
  aux:      ['VIB_RMS', 'MOTOR_CURRENT', 'AIR_PRESS', 'POWER_KW'],
};

// Per-asset scale for tags whose size depends on the machine (big kiln drive vs small pump).
const CLASS_SCALE = {
  cnc: { MOTOR_CURRENT: 1, POWER_KW: 1 },
  rotating: { MOTOR_CURRENT: 3, POWER_KW: 4, SPEED_RPM: 1 },
  pump: { MOTOR_CURRENT: 1.5, POWER_KW: 1.6 },
  compressor: { MOTOR_CURRENT: 4, POWER_KW: 5 },
  press: { MOTOR_CURRENT: 6, POWER_KW: 7 },
  thermal: { MOTOR_CURRENT: 1, POWER_KW: 14 },
  aux: { MOTOR_CURRENT: 0.8, POWER_KW: 0.8 },
};

export const FAILURE_MODES = {
  'FM-01': { name: 'Bearing wear', short: 'bearing wear', signals: ['VIB_RMS', 'VIB_PEAK', 'BEARING_TEMP'], repairH: 2, sop: 'SOP-17', part: 'SP-001' },
  'FM-02': { name: 'Tool-insert wear', short: 'tool-insert wear', signals: ['MOTOR_CURRENT', 'POWER_KW'], repairH: 0.8, sop: 'SOP-09', part: 'SP-010' },
  'FM-03': { name: 'Belt wear', short: 'belt wear', signals: ['VIB_RMS', 'MOTOR_CURRENT'], repairH: 1.5, sop: 'SOP-21', part: 'SP-020' },
  'FM-04': { name: 'Shaft misalignment', short: 'misalignment', signals: ['VIB_RMS', 'VIB_PEAK', 'BEARING_TEMP'], repairH: 4, sop: 'SOP-24', part: 'SP-030' },
  'FM-05': { name: 'Rotor imbalance', short: 'imbalance', signals: ['VIB_RMS', 'VIB_PEAK'], repairH: 6, sop: 'SOP-25', part: 'SP-040' },
  'FM-06': { name: 'Hydraulic leak', short: 'hydraulic leak', signals: ['HYD_PRESS', 'OIL_TEMP'], repairH: 3, sop: 'SOP-31', part: 'SP-050' },
  'FM-07': { name: 'Pump cavitation', short: 'cavitation', signals: ['DISCH_PRESS', 'VIB_RMS'], repairH: 3, sop: 'SOP-12', part: 'SP-060' },
  'FM-08': { name: 'Heater element failure', short: 'heater failure', signals: ['ZONE_TEMP', 'POWER_KW'], repairH: 5, sop: 'SOP-40', part: 'SP-070' },
  'FM-09': { name: 'Motor overload', short: 'motor overload', signals: ['MOTOR_CURRENT', 'BEARING_TEMP'], repairH: 3, sop: 'SOP-05', part: 'SP-080' },
};

// ---------- the plants ----------
const SITE_DEFS = [
  { id: 'PUNE', name: 'Pune Machining Plant', city: 'Pune', makes: 'cylinder heads and crankshafts for car makers', lines: [
    { id: 'PUN-L1', name: 'Crankshaft Line', short: 'Crankshaft', costPerH: 29000, plannedHoursMonth: 600, assets: [
      ['LTH-101', 'CNC lathe', 'cnc', 'B'], ['LTH-102', 'CNC lathe', 'cnc', 'B'], ['MIL-101', 'Milling centre', 'cnc', 'B'],
      ['MIL-102', 'Milling centre', 'cnc', 'B'], ['GRD-101', 'Crank grinder', 'cnc', 'A'], ['WSH-101', 'Parts washer', 'aux', 'C']] },
    { id: 'PUN-L2', name: 'Cylinder Head Line', short: 'Cylinder Head', costPerH: 33600, plannedHoursMonth: 600, assets: [
      ['VMC-201', 'Vertical machining centre', 'cnc', 'A'], ['VMC-202', 'Vertical machining centre', 'cnc', 'A'],
      ['VMC-203', 'Vertical machining centre', 'cnc', 'A'], ['VMC-204', 'Vertical machining centre', 'cnc', 'A'],
      ['CMM-201', 'Coordinate measuring machine', 'aux', 'B'], ['DBR-201', 'Deburring cell', 'aux', 'C'], ['CNV-201', 'Transfer conveyor', 'rotating', 'B']] },
    { id: 'PUN-L3', name: 'Gear Cutting Line', short: 'Gear Cutting', costPerH: 27000, plannedHoursMonth: 600, assets: [
      ['HOB-301', 'Gear hobber', 'cnc', 'A'], ['HOB-302', 'Gear hobber', 'cnc', 'A'], ['HTF-301', 'Heat-treat furnace', 'thermal', 'A'],
      ['SPN-301', 'Shaving machine', 'cnc', 'B'], ['DGR-301', 'Gear grinder', 'cnc', 'B']] },
    { id: 'PUN-U1', name: 'Utilities', short: 'Utilities', costPerH: 0, plannedHoursMonth: 720, utility: true, assets: [
      ['CMP-101', 'Air compressor', 'compressor', 'B'], ['CMP-102', 'Air compressor', 'compressor', 'B'], ['CHL-101', 'Chiller', 'compressor', 'B'],
      ['CLP-101', 'Coolant pump', 'pump', 'A'], ['CLP-102', 'Coolant pump (standby)', 'pump', 'C'], ['CTP-101', 'Cooling-tower pump', 'pump', 'C']] },
  ] },
  { id: 'CHENNAI', name: 'Chennai Forge Plant', city: 'Chennai', makes: 'forged crankshafts and connecting rods', lines: [
    { id: 'CHN-F1', name: 'Press Line', short: 'Press', costPerH: 41000, plannedHoursMonth: 600, assets: [
      ['PRS-401', 'Forging press 2500 t', 'press', 'A'], ['PRS-402', 'Forging press 4000 t', 'press', 'A'], ['PRS-403', 'Trim press', 'press', 'B'],
      ['HMR-401', 'Counter-blow hammer', 'press', 'B'], ['IND-401', 'Induction billet heater', 'thermal', 'A']] },
    { id: 'CHN-F2', name: 'Heat Treatment Line', short: 'Heat Treatment', costPerH: 18000, plannedHoursMonth: 600, assets: [
      ['FUR-501', 'Hardening furnace', 'thermal', 'A'], ['QNC-501', 'Quench tank agitator', 'rotating', 'B'], ['SHB-501', 'Shot blaster', 'aux', 'C']] },
    { id: 'CHN-U2', name: 'Utilities', short: 'Utilities', costPerH: 0, plannedHoursMonth: 720, utility: true, assets: [
      ['CMP-401', 'Air compressor', 'compressor', 'B'], ['HPU-401', 'Hydraulic power unit', 'pump', 'A'], ['CTP-401', 'Cooling-tower pump', 'pump', 'C'], ['FAN-401', 'Fume extraction fan', 'rotating', 'C']] },
  ] },
  { id: 'CHITTOR', name: 'Chittorgarh Cement Plant', city: 'Chittorgarh', makes: 'OPC and PPC cement', lines: [
    { id: 'CTG-K1', name: 'Kiln and Cooler', short: 'Kiln', costPerH: 95000, plannedHoursMonth: 700, assets: [
      ['KLN-601', 'Kiln main drive', 'rotating', 'A'], ['IDF-601', 'Kiln ID fan', 'rotating', 'A'], ['CLR-601', 'Grate cooler drive', 'rotating', 'A'], ['BUR-601', 'Burner air fan', 'rotating', 'B']] },
    { id: 'CTG-M1', name: 'Raw Mill', short: 'Raw Mill', costPerH: 52000, plannedHoursMonth: 680, assets: [
      ['VRM-701', 'Vertical roller mill', 'rotating', 'A'], ['BEL-701', 'Bucket elevator', 'rotating', 'B'], ['SEP-701', 'Separator', 'rotating', 'B']] },
    { id: 'CTG-C1', name: 'Cement Mill', short: 'Cement Mill', costPerH: 47000, plannedHoursMonth: 680, assets: [
      ['CML-801', 'Ball mill drive', 'rotating', 'A'], ['PKR-801', 'Rotary packer', 'aux', 'B'], ['BAG-801', 'Bag-filter fan', 'rotating', 'B'],
      ['CMP-801', 'Air compressor', 'compressor', 'C'], ['BLW-801', 'Roots blower', 'rotating', 'C']] },
  ] },
];

const TECH_NAMES = {
  PUNE: [['T-PUN-01', 'Ravi Kulkarni', ['spindle', 'cnc', 'bearing']], ['T-PUN-02', 'Sneha Patil', ['cnc', 'hydraulics']], ['T-PUN-03', 'Amol Jadhav', ['electrical', 'drives']], ['T-PUN-04', 'Farhan Shaikh', ['pumps', 'utilities']]],
  CHENNAI: [['T-CHN-01', 'Karthik Raman', ['press', 'hydraulics']], ['T-CHN-02', 'Divya Subramanian', ['furnace', 'electrical']], ['T-CHN-03', 'Senthil Kumar', ['alignment', 'gearbox', 'bearing']]],
  CHITTOR: [['T-CTG-01', 'Mahendra Singh', ['fans', 'balancing', 'bearing']], ['T-CTG-02', 'Pooja Meena', ['instrumentation', 'sensors']], ['T-CTG-03', 'Arvind Sharma', ['mills', 'gearbox']]],
};

const CUSTOMERS = ['Maratha Motors', 'Deccan Auto', 'Kaveri Tractors', 'Narmada Trucks', 'Sahyadri Two-Wheelers', 'Aravali Infra', 'Mewar Builders', 'Konkan Rail Components'];

export const PARTS = [
  { id: 'SP-001', name: 'Spindle bearing set 7014 ACD/P4A', unitCost: 48000, stock: { PUNE: 0, CHENNAI: 2, CHITTOR: 0 }, reorder: 2, leadDays: 21, for: 'FM-01' },
  { id: 'SP-002', name: 'Fan bearing 22320 E', unitCost: 36000, stock: { PUNE: 1, CHENNAI: 0, CHITTOR: 2 }, reorder: 2, leadDays: 14, for: 'FM-01' },
  { id: 'SP-010', name: 'Carbide insert pack (10)', unitCost: 6500, stock: { PUNE: 14, CHENNAI: 3, CHITTOR: 0 }, reorder: 8, leadDays: 5, for: 'FM-02' },
  { id: 'SP-020', name: 'Drive belt set', unitCost: 4200, stock: { PUNE: 4, CHENNAI: 2, CHITTOR: 3 }, reorder: 3, leadDays: 7, for: 'FM-03' },
  { id: 'SP-030', name: 'Coupling element + shim kit', unitCost: 18500, stock: { PUNE: 1, CHENNAI: 3, CHITTOR: 1 }, reorder: 2, leadDays: 10, for: 'FM-04' },
  { id: 'SP-040', name: 'Balancing weight kit', unitCost: 9000, stock: { PUNE: 0, CHENNAI: 1, CHITTOR: 2 }, reorder: 1, leadDays: 7, for: 'FM-05' },
  { id: 'SP-050', name: 'Hydraulic seal kit', unitCost: 22000, stock: { PUNE: 1, CHENNAI: 4, CHITTOR: 0 }, reorder: 2, leadDays: 12, for: 'FM-06' },
  { id: 'SP-060', name: 'Pump impeller + mechanical seal', unitCost: 27500, stock: { PUNE: 1, CHENNAI: 1, CHITTOR: 1 }, reorder: 1, leadDays: 14, for: 'FM-07' },
  { id: 'SP-070', name: 'Heater element bank', unitCost: 64000, stock: { PUNE: 1, CHENNAI: 2, CHITTOR: 0 }, reorder: 1, leadDays: 28, for: 'FM-08' },
  { id: 'SP-080', name: 'Motor rewind service kit', unitCost: 41000, stock: { PUNE: 0, CHENNAI: 1, CHITTOR: 1 }, reorder: 1, leadDays: 18, for: 'FM-09' },
  { id: 'SP-090', name: 'Vibration sensor (accelerometer)', unitCost: 7800, stock: { PUNE: 6, CHENNAI: 3, CHITTOR: 2 }, reorder: 3, leadDays: 6, for: 'SENSOR' },
];

// Road transfer times between plants (hours)
export const TRANSFER_H = { 'CHENNAI>PUNE': 48, 'PUNE>CHENNAI': 48, 'CHITTOR>PUNE': 30, 'PUNE>CHITTOR': 30, 'CHENNAI>CHITTOR': 60, 'CHITTOR>CHENNAI': 60 };

// ---------- documents the copilot can cite ----------
export const DOCS = [
  { id: 'SOP-17', title: 'SOP-17 Spindle bearing replacement (VMC)', kind: 'SOP', text: 'Lock out and tag out the machine (LOTO). Remove the spindle cartridge, press out the 7014 ACD/P4A bearing set as a matched set, clean the housing, fit new set with preload 0.6 kN, run-in 20 min at 30 % speed, check vibration below 2.3 mm/s before release. Typical duration 2 h with two technicians.' },
  { id: 'SOP-09', title: 'SOP-09 Tool-insert change', kind: 'SOP', text: 'Replace worn carbide inserts when cutting current rises 15 % above baseline or surface finish fails CMM. 45 minutes.' },
  { id: 'SOP-24', title: 'SOP-24 Shaft alignment (laser)', kind: 'SOP', text: 'Laser-align motor and gearbox shafts; tolerance 0.05 mm offset, 0.05 mm/100 mm angularity. Replace coupling element if worn. 4 h.' },
  { id: 'SOP-25', title: 'SOP-25 Fan field balancing', kind: 'SOP', text: 'Clean blades (clinker build-up is the usual cause), then two-plane balance until 1X vibration is below 2.8 mm/s. 6 h with kiln on reduced draught.' },
  { id: 'SOP-12', title: 'SOP-12 Coolant pump cavitation', kind: 'SOP', text: 'Low discharge pressure with noisy vibration means cavitation: check suction strainer, sump level and impeller. Switch to the standby pump CLP-102 first.' },
  { id: 'SOP-31', title: 'SOP-31 Press hydraulic leak', kind: 'SOP', text: 'Falling system pressure with rising oil temperature: inspect cylinder seals and return-line fittings; replace seal kit. 3 h.' },
  { id: 'SOP-50', title: 'SOP-50 Suspected sensor fault', kind: 'SOP', text: 'A reading that is perfectly flat, or that disagrees with all physically related sensors, is a sensor fault. Do not dispatch a repair crew; send instrumentation to check the cable and mounting, and swap the accelerometer if needed.' },
  { id: 'MAN-VMC', title: 'VMC maintenance manual §6 Spindle', kind: 'Manual', text: 'Spindle bearing damage shows as rising RMS and peak vibration with bearing-defect frequencies (BPFO, BPFI) in the spectrum and a bearing temperature rise of 10-20 °C before seizure.' },
  { id: 'ISO-10816', title: 'Vibration severity zones (ISO 10816-3, group 2)', kind: 'Standard', text: 'Zone A up to 2.3 mm/s: new machine. Zone B up to 4.5 mm/s: acceptable for long-term operation. Zone C up to 7.1 mm/s: plan a repair soon. Zone D above 7.1 mm/s: damage is occurring.' },
  { id: 'NOTE-204', title: 'Technician note, VMC-204 (Hinglish)', kind: 'Note', text: 'Shift B: VMC-204 spindle se halki si ghis-ghis awaaz aa rahi hai high RPM pe. Coolant theek hai. Next PM mein bearing check karna. (Shift B: a faint grinding noise from the VMC-204 spindle at high RPM. Coolant is fine. Check the bearing at the next PM.)' },
  { id: 'NOTE-LOT', title: 'Supplier quality note, bearing lot L-2391', kind: 'Quality', text: 'Fleet review: two early spindle-bearing failures on VMC-201 and HOB-302 earlier this year used bearings from lot L-2391 (cage hardness out of spec). Lot quarantined; remaining stock at Chennai is from lot L-2477 (passed).' },
  { id: 'OEE-DEF', title: 'How OEE is calculated', kind: 'Definition', text: 'OEE = Availability x Performance x Quality. Availability = run time / planned time; Performance = (ideal cycle time x count) / run time; Quality = good count / total count. 85 % is the common world-class benchmark.' },
  { id: 'POL-G8', title: 'Policy G8: human approval for work orders', kind: 'Policy', text: 'The AI may draft work orders, check spares and propose windows. Only a named person may approve, release, schedule or close a work order. Every action is logged with who and when.' },
  { id: 'ENERGY-01', title: 'Energy note: degrading bearings', kind: 'Note', text: 'A worn bearing raises motor current 5-15 %, which shows up as wasted kWh per part before the failure.' },
];

// ---------- scenarios ----------
// A fault: { asset, mode, onsetH (hours before anchor), failH (hours after anchor when functional failure happens),
//            effects: { TAG: totalChange at failure } }
// A sensor fault: { asset, tag, startH (hours before anchor), kind: 'flatline' }
export const SCENARIOS = [
  {
    id: 'pune-bearing', site: 'PUNE', name: 'Pune · spindle bearing wear', hero: 'VMC-204',
    blurb: 'A spindle bearing on VMC-204 (Cylinder Head line) is wearing out. No spare in Pune; Chennai has two. Orders for Maratha Motors depend on the line.',
    faults: [{ asset: 'VMC-204', mode: 'FM-01', onsetH: 72, failH: 67, effects: { VIB_RMS: 9.6, VIB_PEAK: 11.4, BEARING_TEMP: 35, MOTOR_CURRENT: 8, POWER_KW: 3.5 } },
             { asset: 'CLP-101', mode: 'FM-07', onsetH: 20, failH: 400, jump: 0.3, effects: { DISCH_PRESS: -2.4, VIB_RMS: 2.0, BEARING_TEMP: 6 } }],
    sensorFaults: [],
    history: { 'VMC-204': [['FM-02', 22], ['FM-02', 42]] },
  },
  {
    id: 'chennai-misalign', site: 'CHENNAI', name: 'Chennai · press gearbox misalignment', hero: 'PRS-402',
    blurb: 'The 4000 t forging press PRS-402 shows a growing 2X vibration after a motor change: shaft misalignment. Parts are in stock locally.',
    faults: [{ asset: 'PRS-402', mode: 'FM-04', onsetH: 96, failH: 118, effects: { VIB_RMS: 9.2, OIL_TEMP: 16, MOTOR_CURRENT: 30, POWER_KW: 40 } }],
    sensorFaults: [],
    history: { 'PRS-402': [['FM-06', 30]] },
  },
  {
    id: 'chittor-fan', site: 'CHITTOR', name: 'Chittorgarh · kiln fan imbalance + a sensor fault', hero: 'IDF-601',
    blurb: 'Clinker build-up is unbalancing the kiln ID fan IDF-601. Separately, the bucket elevator BEL-701 vibration sensor has flat-lined: that must be inspected, not repaired.',
    faults: [{ asset: 'IDF-601', mode: 'FM-05', onsetH: 60, failH: 88, effects: { VIB_RMS: 9.1, VIB_PEAK: 13, BEARING_TEMP: 12, MOTOR_CURRENT: 10, POWER_KW: 9 } }],
    sensorFaults: [{ asset: 'BEL-701', tag: 'VIB_RMS', startH: 9, kind: 'flatline' }],
    history: { 'IDF-601': [['FM-05', 70]] },
  },
  {
    id: 'pune-flood', site: 'PUNE', name: 'Pune · alarm flood from one root cause', hero: 'CLP-101',
    blurb: 'The main coolant pump CLP-101 is cavitating. Coolant pressure is falling on every machine it feeds, so a dozen alarms arrive at once. Nirantar groups them under one root cause (ISA-18.2 style).',
    faults: [{ asset: 'CLP-101', mode: 'FM-07', onsetH: 30, failH: 26, effects: { DISCH_PRESS: -3.6, VIB_RMS: 6.8, BEARING_TEMP: 14 } }],
    consequence: { from: 'CLP-101', tag: 'COOLANT_PRESS', lines: ['PUN-L1', 'PUN-L2', 'PUN-L3'], drop: 4.0 },
    sensorFaults: [],
    history: {},
  },
  {
    id: 'quiet', site: 'PUNE', name: 'Quiet day · nothing to fix', hero: null,
    blurb: 'Every machine is healthy. Useful to see what "normal" looks like: grey everywhere, no alerts, the copilot and OEE still work.',
    faults: [], sensorFaults: [], history: {},
  },
];

// ---------- build ----------
export function buildWorld(scenarioId = 'pune-bearing', seed = 2391, anchor = roundTo15(Date.now())) {
  const sc = SCENARIOS.find(s => s.id === scenarioId) || SCENARIOS[0];
  const r = mulberry32(seed ^ strHash(sc.id));
  const sites = [], lines = [], assets = [];
  let idx = 0;
  for (const sd of SITE_DEFS) {
    sites.push({ id: sd.id, name: sd.name, city: sd.city, makes: sd.makes });
    sd.lines.forEach((ld, li) => {
      lines.push({ id: ld.id, siteId: sd.id, name: ld.name, short: ld.short, costPerH: ld.costPerH, plannedHoursMonth: ld.plannedHoursMonth, utility: !!ld.utility, order: li });
      ld.assets.forEach(([id, kind, cls, crit], ai) => {
        const tags = CLASS_TAGS[cls].map(key => {
          const t = TAGS[key], sc2 = (CLASS_SCALE[cls] || {})[key] || 1;
          const scale = (key === 'MOTOR_CURRENT' || key === 'POWER_KW') ? sc2 : 1;
          // healthy baseline sits a little on the safe side of "normal", jittered by up to 4 % of the normal-to-trip range
          const range = Math.abs(t.trip - t.normal);
          const safe = t.dir === 'low' ? 1 : -1;
          const fixed = key === 'SPINDLE_RPM' || key === 'SPEED_RPM' || key === 'STROKES';
          const base = key === 'VIB_RMS' ? 1.6 * (1 + (r() - 0.5) * 0.06) : fixed ? t.normal : t.normal + safe * r() * 0.04 * range;
          return { key, label: t.label, unit: t.unit, dir: t.dir, d: t.d, group: t.group,
            normal: round(t.normal * scale, t.d), alarm: round(t.alarm * scale, t.d), trip: round(t.trip * scale, t.d), base: round(base * scale, t.d + 1) };
        });
        const rpm = cls === 'cnc' ? 12000 : cls === 'press' ? 600 : cls === 'thermal' ? 0 : 1480;
        assets.push({
          id, idx: idx++, name: kind, cls, criticality: crit, siteId: sd.id, lineId: ld.id, pos: ai, lineCount: ld.assets.length,
          installed: 2013 + Math.floor(r() * 10), rpm,
          bearing: cls === 'cnc' ? { model: '7014 ACD/P4A', n: 16, d: 11.1, D: 87.5, angle: 25 } : { model: '22320 E', n: 13, d: 40, D: 160, angle: 0 },
          tags,
        });
      });
    });
  }

  const faults = sc.faults.map(f => ({ ...f, onset: anchor - f.onsetH * HOUR, failAt: anchor + f.failH * HOUR, repairedAt: null }));
  const sensorFaults = sc.sensorFaults.map(s => ({ ...s, start: anchor - s.startH * HOUR }));

  // technicians
  const technicians = [];
  for (const [site, list] of Object.entries(TECH_NAMES)) list.forEach(([id, name, skills], i) =>
    technicians.push({ id, name, siteId: site, skills, shift: ['A', 'B', 'C'][i % 3] }));

  // sales orders (next 10 days) per production line
  const salesOrders = [];
  let so = 4100;
  for (const ln of lines.filter(l => !l.utility)) {
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const due = anchor + (1.5 + r() * 8) * DAY;
      salesOrders.push({ id: 'SO-' + (so++), customer: pick(r, CUSTOMERS.slice(ln.siteId === 'CHITTOR' ? 5 : 0, ln.siteId === 'CHITTOR' ? 8 : 6)),
        lineId: ln.id, due, valueInr: Math.round((4 + r() * 9) * 1e5 / 1000) * 1000, penaltyPerDay: Math.round((0.2 + r() * 0.5) * 1e5 / 1000) * 1000 });
    }
  }
  // the hero order that makes VMC-204 urgent: due on the next Friday
  if (sc.id === 'pune-bearing') {
    const fri = nextWeekday(anchor, 5, 18);
    salesOrders.unshift({ id: 'SO-4099', customer: 'Maratha Motors', lineId: 'PUN-L2', due: fri, valueInr: 1240000, penaltyPerDay: 62000, hero: true });
  }

  // CMMS history: past work orders per asset (last 120 days)
  const history = [];
  let wo = 300;
  for (const a of assets) {
    const scripted = (sc.history || {})[a.id];
    if (scripted) scripted.forEach(([mode, daysAgo]) => history.push(histWO(a, mode, anchor - daysAgo * DAY, 'CM', wo++, technicians, r)));
    const pms = 1 + Math.floor(r() * 3);
    for (let i = 0; i < pms; i++) history.push(histWO(a, null, anchor - (10 + r() * 110) * DAY, 'PM', wo++, technicians, r));
  }
  history.sort((x, y) => y.date - x.date);

  // Back-test material: 43 past failure episodes in the last 56 days, with model scores; 61 alert candidates
  const backtest = buildBacktest(r, assets, anchor);

  // OEE: 30 days x production lines, plus shift split
  const oee = buildOee(r, lines, anchor, sc);

  // energy baseline per asset (kWh/day)
  const energy = assets.map(a => {
    const p = a.tags.find(t => t.key === 'POWER_KW');
    return { assetId: a.id, kwhDay: p ? round(p.base * (a.cls === 'thermal' ? 22 : 18), 0) : 0 };
  });

  return {
    scenario: { id: sc.id, name: sc.name, blurb: sc.blurb, site: sc.site, hero: sc.hero, consequence: sc.consequence || null },
    seed, anchor, sites, lines, assets, faults, sensorFaults,
    parts: JSON.parse(JSON.stringify(PARTS)), technicians, salesOrders, history, backtest, oee, energy, docs: DOCS,
  };
}

function histWO(a, mode, date, type, n, techs, r) {
  const fm = mode ? FAILURE_MODES[mode] : null;
  const t = techs.filter(x => x.siteId === a.siteId);
  return { id: `WO-${type}-${String(n).padStart(4, '0')}`, assetId: a.id, type, mode, date,
    title: fm ? fm.name : 'Scheduled preventive maintenance', durationH: fm ? fm.repairH + 0.5 : 1 + Math.round(r() * 3),
    technician: t.length ? t[Math.floor(r() * t.length)].id : '—', costInr: fm ? 12000 + Math.round(r() * 30) * 1000 : 3000 + Math.round(r() * 6) * 1000 };
}

function buildBacktest(r, assets, anchor) {
  const rot = assets.filter(a => a.tags.some(t => t.key === 'VIB_RMS'));
  const modes = ['FM-01', 'FM-01', 'FM-01', 'FM-04', 'FM-05', 'FM-03', 'FM-07', 'FM-09', 'FM-02', 'FM-06'];
  const episodes = [];
  for (let i = 0; i < 43; i++) {
    const a = rot[Math.floor(r() * rot.length)];
    const score = 0.62 + r() * 0.36;              // detected episodes, adjusted below
    const baseLead = 12 + r() * 60;               // hours of warning at the default threshold
    episodes.push({ id: 'EP-' + (i + 1), assetId: a.id, mode: pick(r, modes), at: anchor - (2 + r() * 54) * DAY, score, baseLead, repairH: 2 + r() * 10, costInr: Math.round((2 + r() * 14) * 1e5 / 1000) * 1000 });
  }
  // exactly 7 episodes stay below the default threshold 0.60 (missed)
  episodes.sort((x, y) => x.score - y.score).slice(0, 7).forEach((e, i) => { e.score = 0.31 + i * 0.035; });
  // median lead at default threshold = 36 h
  const leads = episodes.filter(e => e.score >= 0.6).map(e => e.baseLead).sort((x, y) => x - y);
  const med = leads[Math.floor(leads.length / 2)];
  episodes.forEach(e => { e.baseLead = e.baseLead * 36 / med; });
  // false-alarm candidates: 25 of them score above 0.60
  const falseAlarms = [];
  for (let i = 0; i < 80; i++) falseAlarms.push({ id: 'FA-' + (i + 1), assetId: rot[Math.floor(r() * rot.length)].id, at: anchor - r() * 56 * DAY, score: 0.2 + r() * 0.4 });
  falseAlarms.sort((x, y) => y.score - x.score).slice(0, 25).forEach((f, i) => { f.score = 0.6 + (24 - i) * 0.012; });
  return { episodes, falseAlarms, machineMonths: 90, defaultThreshold: 0.6, windowDays: 56 };
}

function buildOee(r, lines, anchor, sc) {
  const days = [];
  const prod = lines.filter(l => !l.utility);
  const baseBy = { 'PUN-L1': [0.84, 0.82, 0.985], 'PUN-L2': [0.83, 0.84, 0.976], 'PUN-L3': [0.80, 0.81, 0.98],
    'CHN-F1': [0.78, 0.86, 0.965], 'CHN-F2': [0.86, 0.88, 0.97], 'CTG-K1': [0.91, 0.87, 0.99], 'CTG-M1': [0.88, 0.85, 0.99], 'CTG-C1': [0.87, 0.86, 0.985] };
  for (let d = 29; d >= 0; d--) {
    const date = anchor - d * DAY;
    for (const ln of prod) {
      const [A0, P0, Q0] = baseBy[ln.id] || [0.82, 0.84, 0.98];
      const dip = r() < 0.08 ? 0.12 + r() * 0.1 : 0;
      const A = clamp(A0 + (r() - 0.5) * 0.06 - dip, 0.5, 0.97);
      const P = clamp(P0 + (r() - 0.5) * 0.05, 0.6, 0.97);
      const Q = clamp(Q0 + (r() - 0.5) * 0.015, 0.9, 0.998);
      const planned = 20;  // planned production hours per day
      const lost = planned * (1 - A);
      const losses = {
        breakdown: round(lost * (0.35 + r() * 0.2) + dip * planned * 0.6, 2),
        setup: round(lost * (0.25 + r() * 0.1), 2),
        smallStops: round(planned * A * (1 - P) * (0.4 + r() * 0.1), 2),
        speed: round(planned * A * (1 - P) * (0.5 + r() * 0.1), 2),
        startupRejects: round(planned * A * P * (1 - Q) * 0.4, 2),
        prodRejects: round(planned * A * P * (1 - Q) * 0.6, 2),
        planned: round(3 + r() * 1.2, 2),
      };
      const shifts = ['A', 'B', 'C'].map((s, i) => ({ shift: s, oee: clamp(A * P * Q + [0.02, 0, -0.035][i] + (r() - 0.5) * 0.04, 0.4, 0.95) }));
      days.push({ lineId: ln.id, date, availability: A, performance: P, quality: Q, oee: A * P * Q, losses, shifts });
    }
  }
  return days;
}

export function roundTo15(ms) { return Math.floor(ms / (15 * 60e3)) * 15 * 60e3; }
function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
// next given weekday (0 Sun..6 Sat) at hour IST, at least 36 h ahead
function nextWeekday(from, wd, hourIst) {
  let t = from + 36 * HOUR;
  for (let i = 0; i < 8; i++) {
    const d = new Date(t + 5.5 * HOUR);
    if (d.getUTCDay() === wd) { d.setUTCHours(hourIst, 0, 0, 0); return d.getTime() - 5.5 * HOUR; }
    t += DAY;
  }
  return from + 4 * DAY;
}
