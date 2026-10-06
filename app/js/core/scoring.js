// The "model": turns the synthetic world into readings, health, failure confidence, time to failure, ISO zone,
// vibration spectrum, money at stake, repair windows, what-if odds, OEE roll-ups and the back-test.
// Pure functions of (world, mutable faults, time), so any page can ask about any machine at any time.
import { TAGS, FAILURE_MODES, TRANSFER_H } from './generator.js';
import { gauss, hash01, clamp } from './rng.js';
import { HOUR, DAY, istHour } from './format.js';

export const HEALTH_FORMULA = 'Health = 100 × (1 − worst)^1.27 × (1 − average), where each sensor\'s deviation is how far it has moved from normal towards its trip level (0 = normal, 1 = at trip).';
export const CONF_NOTE = 'Failure confidence: how sure Nirantar is that a real failure is developing (all related sensors agree, the trend is steady), not when it will happen.';

export function createModel(store) {
  const W = () => store.world;
  const memo = new Map();
  const assetById = id => W().assets.find(a => a.id === id);
  const lineById = id => W().lines.find(l => l.id === id);
  const siteById = id => W().sites.find(s => s.id === id);
  const tagOf = (a, key) => a.tags.find(t => t.key === key);

  function loadFactor(t, key) {
    const h = istHour(t);
    const shift = h >= 6 && h < 14 ? 1 : h >= 14 && h < 22 ? 1.03 : 0.9;
    if (key === 'MOTOR_CURRENT' || key === 'POWER_KW') return shift;
    if (key === 'BEARING_TEMP' || key === 'OIL_TEMP' || key === 'OUTLET_TEMP') return 1 + (shift - 1) * 0.35;
    if (key === 'VIB_RMS' || key === 'VIB_PEAK') return 1 + (shift - 1) * 0.25;
    return 1;
  }

  // Fault contribution of one fault to one tag at time t (0 before onset, after repair).
  function faultDelta(f, key, t) {
    const eff = f.effects[key];
    if (!eff || t < f.onset || (f.repairedAt && t >= f.repairedAt)) return 0;
    const frac = clamp((t - f.onset) / (f.failAt - f.onset), 0, 1.25);
    const jump = f.jump || 0;
    return eff * (jump + (1 - jump) * frac);
  }

  // Smoothed (noise-free) value including the shift-load pattern.
  function smoothAt(a, key, t) { return trendAt(a, key, t, true); }

  // Model view: load-free trend (what health, confidence and time to failure are computed from).
  function trendAt(a, key, t, withLoad = false) {
    const tag = tagOf(a, key);
    if (!tag) return null;
    let v = tag.base * (withLoad ? loadFactor(t, key) : 1);
    for (const f of store.state.faults) if (f.asset === a.id) v += faultDelta(f, key, t);
    const cq = W().scenario.consequence;
    if (cq && key === cq.tag && cq.lines.includes(a.lineId)) {
      const src = store.state.faults.find(f => f.asset === cq.from);
      if (src && t >= src.onset && !(src.repairedAt && t >= src.repairedAt)) v -= cq.drop * clamp((t - src.onset) / (src.failAt - src.onset), 0, 1.1);
    }
    return v;
  }

  // Raw reading with sensor noise and sensor faults (what a historian would store).
  function valueAt(a, key, t) {
    const sf = store.state.sensorFaults.find(s => s.asset === a.id && s.tag === key && t >= s.start);
    if (sf) {
      const frozen = smoothAt(a, key, sf.start);
      return Math.round(frozen * 100) / 100;
    }
    const tag = tagOf(a, key);
    const s = smoothAt(a, key, t);
    const slot = Math.floor(t / (15 * 60e3));
    const sd = key === 'VIB_RMS' || key === 'VIB_PEAK' ? 0.035 * s : key === 'SPINDLE_RPM' || key === 'SPEED_RPM' ? 0.002 * s : 0.012 * Math.abs(tag.normal);
    return s + gauss(a.idx * 31 + 7, tag.key.length * 97 + key.charCodeAt(0), slot) * sd;
  }

  function series(a, key, from, to, stepMin = 15) {
    const out = [], step = stepMin * 60e3;
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push([t, valueAt(a, key, t)]);
    return out;
  }

  function deviation(tag, v) {
    if (v == null) return 0;
    const d = tag.dir === 'low' ? (tag.normal - v) / (tag.normal - tag.trip) : (v - tag.normal) / (tag.trip - tag.normal);
    return clamp(d, 0, 1);
  }
  const isoZone = v => v == null ? null : v <= 2.3 ? 'A' : v <= 4.5 ? 'B' : v <= 7.1 ? 'C' : 'D';
  const ISO_TEXT = { A: 'new-machine condition', B: 'fine for long-term running', C: 'plan a repair soon', D: 'damage is occurring' };

  function activeFault(a, t) {
    return store.state.faults.find(f => f.asset === a.id && t >= f.onset && !(f.repairedAt && t >= f.repairedAt));
  }

  function assess(a, t) {
    const k = a.id + '@' + t;
    if (memo.has(k)) return memo.get(k);
    if (memo.size > 6000) memo.clear();
    const sf = store.state.sensorFaults.find(s => s.asset === a.id && t >= s.start);
    const devs = {};
    for (const tag of a.tags) {
      if (sf && sf.tag === tag.key) { devs[tag.key] = 0; continue; }
      devs[tag.key] = deviation(tag, trendAt(a, tag.key, t));
    }
    const vals = Object.values(devs);
    let worstKey = a.tags[0].key;
    for (const key in devs) if (devs[key] > devs[worstKey]) worstKey = key;
    const worst = devs[worstKey];
    const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
    const health = Math.round(100 * Math.pow(1 - worst, 1.27) * (1 - avg));
    const agree = vals.filter(d => d > 0.1).length;

    // trend of the worst tag over the last 12 h (per hour, in tag units)
    const wt = tagOf(a, worstKey);
    const vNow = trendAt(a, worstKey, t), v12 = trendAt(a, worstKey, t - 12 * HOUR);
    const slope = (vNow - v12) / 12 * (wt.dir === 'low' ? -1 : 1);       // positive = getting worse
    const slopeFrac = Math.max(0, slope) * 24 / Math.abs(wt.trip - wt.normal);
    const z = -5.2 + 8 * worst + 1.2 * agree + 12 * slopeFrac;
    let conf = 1 / (1 + Math.exp(-z));
    if (worst < 0.05) conf = 0.008 + hash01(a.idx, 3) * 0.03;

    // time to failure: worst tag reaching its trip level at the current rate
    let rulH = null, rulLo = null, rulHi = null, rulKind = 'trend';
    if (slope > 1e-6 && worst > 0.05) {
      const dist = wt.dir === 'low' ? vNow - wt.trip : wt.trip - vNow;
      rulH = Math.max(0.5, dist / slope); rulLo = rulH * 0.54; rulHi = rulH * 1.45;
    } else {
      rulKind = 'wear';  // no active trend: age-based wear estimate
      rulH = (110 + hash01(a.idx, 9) * 190) * 24; rulLo = rulH * 0.7; rulHi = rulH * 1.4;
    }

    const f = activeFault(a, t);
    const modeId = f ? f.mode : null;
    const vib = a.tags.find(x => x.key === 'VIB_RMS') ? trendAt(a, 'VIB_RMS', t) : null;
    // top signal: biggest change versus 72 h ago among related sensors
    let top = null;
    for (const tag of a.tags) {
      const now = trendAt(a, tag.key, t), past = trendAt(a, tag.key, t - 72 * HOUR);
      if (!past) continue;
      const ratio = tag.dir === 'low' ? past / Math.max(now, 1e-6) : now / past;
      if (devs[tag.key] > 0.05 && (!top || devs[tag.key] > devs[top.key])) top = { key: tag.key, label: tag.label, ratio, now, past, unit: tag.unit };
    }
    let state = 'normal';
    if (sf) state = 'sensor';
    else if (health < 50 || conf >= 0.8) state = 'act';
    else if (health < 80 || conf >= 0.15) state = 'watch';

    const contributions = a.tags.map(tag => ({ key: tag.key, label: tag.label, dev: devs[tag.key] })).sort((x, y) => y.dev - x.dev);
    const res = {
      assetId: a.id, t, health, worstKey, worst, avg, agree, conf, slope, slopeFrac, rulH, rulLo, rulHi, rulKind,
      mode: modeId, modeName: modeId ? FAILURE_MODES[modeId].name : null, iso: vib == null ? null : { zone: isoZone(vib), v: vib, text: ISO_TEXT[isoZone(vib)] },
      top, state, contributions,
      sensorFault: sf ? { tag: sf.tag, label: TAGS[sf.tag].label, sinceH: (t - sf.start) / HOUR, reason: `${TAGS[sf.tag].label} has not changed for ${Math.round((t - sf.start) / HOUR)} h while related sensors move` } : null,
      failAt: rulH != null ? t + rulH * HOUR : null,
    };
    memo.set(k, res);
    return res;
  }

  const assessAll = t => W().assets.map(a => assess(a, t));
  const clearMemo = () => memo.clear();

  // ---- spares, money and windows ----
  function partPlan(a, modeId) {
    const fm = FAILURE_MODES[modeId];
    if (!fm) return null;
    const part = W().parts.find(p => p.id === fm.part);
    if (!part) return null;
    if ((part.stock[a.siteId] || 0) > 0) return { part, from: a.siteId, etaH: 0, kind: 'local' };
    let best = null;
    for (const [site, qty] of Object.entries(part.stock)) {
      if (site === a.siteId || qty <= 0) continue;
      const h = TRANSFER_H[site + '>' + a.siteId] ?? 72;
      if (!best || h < best.etaH) best = { part, from: site, etaH: h, kind: 'transfer', qty };
    }
    return best || { part, from: 'Supplier', etaH: part.leadDays * 24, kind: 'purchase' };
  }

  function exposure(a, modeId) {
    const fm = FAILURE_MODES[modeId || 'FM-01'];
    const plan = modeId ? partPlan(a, modeId) : null;
    const line = lineById(a.lineId);
    let costPerH = line.costPerH;
    if (line.utility) costPerH = Math.max(...W().lines.filter(l => l.siteId === a.siteId).map(l => l.costPerH)) * (a.criticality === 'A' ? 0.6 : 0.2);
    const downH = (plan ? plan.etaH : 0) + fm.repairH;
    return { inr: Math.round(downH * costPerH), downH, costPerH, plan };
  }

  function plannedCost(a, modeId) {
    const fm = FAILURE_MODES[modeId];
    const plan = partPlan(a, modeId);
    const parts = plan ? plan.part.unitCost : 0;
    const labour = Math.round(fm.repairH * 2 * 1625 * 2) ;  // 2 technicians, double rate for the shutdown
    return { parts, labour, total: parts + labour };
  }

  // Low-impact slots: shift-handover 14:00-18:00 and night 02:00-06:00 IST (lowest demand, planned changeovers).
  function planWindow(readyAt, failAt, durH = 4) {
    const slots = [];
    const startDay = readyAt - 6 * HOUR;
    for (let d = 0; d < 10; d++) {
      for (const hh of [2, 14]) {
        const day0 = Math.floor((startDay + d * DAY + 5.5 * HOUR) / DAY) * DAY - 5.5 * HOUR;
        const s = day0 + hh * HOUR;
        if (s >= readyAt) slots.push({ start: s, end: s + durH * HOUR, reason: hh === 14 ? 'shift changeover (low-impact)' : 'night shift, lowest load' });
      }
    }
    slots.sort((x, y) => x.start - y.start);
    const ok = slots.find(s => !failAt || s.end <= failAt - 2 * HOUR);
    return ok ? { ...ok, beforeFailure: true } : { ...slots[0], beforeFailure: false };
  }

  // Chance the machine fails within `days`, from the same time-to-failure estimate shown everywhere:
  // median = rulH, 80 % range = [0.54, 1.45] × rulH (two-piece log-normal, so the odds match "likely X to Y h").
  const SIG_LO = Math.log(1 / 0.54) / 1.2816, SIG_HI = Math.log(1.45) / 1.2816;
  function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function failProb(rulH, hoursAhead) {
    if (!rulH || hoursAhead <= 0) return 0;
    const z = Math.log(hoursAhead / rulH);
    return Phi(z / (z < 0 ? SIG_LO : SIG_HI));
  }
  function whatIf(rulH, days, exposureInr) {
    const p = failProb(rulH, days * 24);
    return { p, expectedLoss: p * exposureInr };
  }

  function orderPressure(lineId, t) {
    const due = W().salesOrders.filter(o => o.lineId === lineId && o.due > t).sort((x, y) => x.due - y.due)[0];
    if (!due) return { pressure: 0, order: null };
    const days = (due.due - t) / DAY;
    return { pressure: clamp(1 - days / 7, 0, 1), order: due, days };
  }

  // ---- spectrum ----
  function bearingFreqs(b, fr) {
    const r = (b.d / b.D) * Math.cos(b.angle * Math.PI / 180);
    return { BPFO: b.n / 2 * fr * (1 - r), BPFI: b.n / 2 * fr * (1 + r), BSF: b.D / (2 * b.d) * fr * (1 - r * r), FTF: fr / 2 * (1 - r) };
  }
  function spectrum(a, t) {
    const fr = (a.rpm || 1480) / 60;
    const f = activeFault(a, t);
    const sev = f ? clamp((t - f.onset) / (f.failAt - f.onset), 0, 1.2) : 0;
    const bf = bearingFreqs(a.bearing, fr);
    const fmax = a.cls === 'cnc' ? Math.max(5000, bf.BPFI * 2.4) : Math.max(400, bf.BPFI * 3);
    const peaks = [[fr, 0.35], [2 * fr, 0.12], [3 * fr, 0.05]];
    if (f && f.mode === 'FM-01') {
      peaks.push([bf.BPFO, 1.6 * sev], [2 * bf.BPFO, 0.8 * sev], [3 * bf.BPFO, 0.35 * sev], [bf.BPFI, 0.7 * sev], [bf.BSF, 0.35 * sev],
        [bf.BPFO - fr, 0.4 * sev], [bf.BPFO + fr, 0.4 * sev]);
    }
    if (f && f.mode === 'FM-05') peaks[0][1] += 3.2 * sev;
    if (f && f.mode === 'FM-04') { peaks[1][1] += 2.6 * sev; peaks[0][1] += 0.9 * sev; peaks[2][1] += 0.6 * sev; }
    const N = 420, pts = [];
    const floor = f && f.mode === 'FM-07' ? 0.12 + 0.2 * sev : 0.04;
    for (let i = 0; i <= N; i++) {
      const fq = fmax * i / N;
      let amp = floor * (0.6 + hash01(a.idx, i, 5));
      for (const [pf, pa] of peaks) { const w = fmax / N * 1.2; amp += pa * Math.exp(-((fq - pf) ** 2) / (2 * w * w)); }
      pts.push([fq, amp]);
    }
    const markers = [{ f: fr, label: '1X' }, { f: 2 * fr, label: '2X' }];
    if (a.tags.some(x => x.key === 'VIB_RMS')) markers.push({ f: bf.BPFO, label: 'BPFO' }, { f: bf.BPFI, label: 'BPFI' }, { f: bf.BSF, label: 'BSF' });
    return { pts, markers, fr, bf, fmax, mode: f ? f.mode : null };
  }

  // ---- OEE roll-ups ----
  function oeeFor(filter, days, t) {
    const from = t - days * DAY;
    const rows = W().oee.filter(r => r.date > from && filter(r));
    if (!rows.length) return null;
    const m = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const losses = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.losses)) losses[k] = (losses[k] || 0) + v;
    return { availability: m('availability'), performance: m('performance'), quality: m('quality'), oee: m('availability') * m('performance') * m('quality'), losses, rows };
  }
  const lineOee = (lineId, days, t) => oeeFor(r => r.lineId === lineId, days, t);
  const siteOee = (siteId, days, t) => oeeFor(r => lineById(r.lineId).siteId === siteId, days, t);

  // ---- back-test at a threshold ----
  function backtestAt(th) {
    const B = W().backtest;
    const tp = B.episodes.filter(e => e.score >= th);
    const fp = B.falseAlarms.filter(f => f.score >= th);
    const leadScale = Math.pow((1 - th) / (1 - B.defaultThreshold), 0.7);
    const leads = tp.map(e => e.baseLead * leadScale).sort((x, y) => x - y);
    const median = leads.length ? leads[Math.floor(leads.length / 2)] : 0;
    return { threshold: th, total: B.episodes.length, detected: tp.length, missed: B.episodes.length - tp.length, falseAlarms: fp.length,
      precision: tp.length / Math.max(1, tp.length + fp.length), recall: tp.length / B.episodes.length,
      faRate: fp.length / B.machineMonths, medianLead: median, leads, machineMonths: B.machineMonths };
  }

  return { assetById, lineById, siteById, tagOf, smoothAt, trendAt, valueAt, series, deviation, isoZone, ISO_TEXT, assess, assessAll, clearMemo,
    activeFault, partPlan, exposure, plannedCost, planWindow, whatIf, failProb, orderPressure, bearingFreqs, spectrum, lineOee, siteOee, backtestAt };
}

export const WHATIF_NOTE = 'Chance of failing while we wait comes from the time-to-failure estimate: half of similar machines fail before the median, 10 % before the low end of the range and 90 % before the high end.';
