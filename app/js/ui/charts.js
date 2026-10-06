// SVG charts as strings (no library). Colours come from CSS tokens so light/dark themes just work.
// Every chart takes a `title` used as an accessible name (role="img" + <title>).
import { raw, esc } from './dom.js';

const TONE = { ink: 'var(--ink)', ink2: 'var(--ink-2)', normal: 'var(--normal)', watch: 'var(--watch-fill)', act: 'var(--act-fill)', ai: 'var(--ai-fill)', ok: 'var(--ok-fill)', line: 'var(--line-2)' };
const TEXT = { watch: 'var(--watch)', act: 'var(--act)', ai: 'var(--ai)', ok: 'var(--ok)', ink: 'var(--ink)', normal: 'var(--ink-2)' };
const c = t => TONE[t] || t || TONE.ink;
const tc = t => TEXT[t] || 'var(--ink-2)';
const f1 = v => Math.round(v * 10) / 10;

function niceTicks(min, max, n = 5) {
  const span = max - min || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const fmtNum = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-IN') : Math.abs(v) >= 10 ? String(Math.round(v)) : String(f1(v));
const istFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const istDay = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
export const timeLabel = (ms, span) => span > 4 * 864e5 ? istDay.format(ms) : istFmt.format(ms).replace(',', '');

function wrap(w, h, title, body, cls = 'chart') {
  return raw(`<svg class="${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><title>${esc(title)}</title>${body}</svg>`);
}

/**
 * lineChart({ title, w, h, series:[{name, points:[[x,y]], tone, dash, width, area}], xType:'time'|'num', xFmt, yFmt,
 *   yMin, yMax, unit, limits:[{y,label,tone}], bands:[{y0,y1,tone,label,opacity}], vbands:[{x0,x1,tone,label}],
 *   now:x, forecast:{points:[[x,y]...], lo:[[x,y]], hi:[[x,y]], label, tone}, annotations:[{x,y,label,tone}], xMax, xMin, legend:true })
 */
export function lineChart(o) {
  const w = o.w || 680, h = o.h || 230, L = o.padL ?? 46, R = o.padR ?? 92, T = 14, B = 26;
  const all = (o.series || []).flatMap(s => s.points);
  const fc = o.forecast ? [...o.forecast.points, ...(o.forecast.lo || []), ...(o.forecast.hi || [])] : [];
  const xs = [...all, ...fc].map(p => p[0]);
  const ys = [...all, ...fc].map(p => p[1]).concat((o.limits || []).map(l => l.y));
  const xMin = o.xMin ?? Math.min(...xs), xMax = o.xMax ?? Math.max(...xs);
  let yMin = o.yMin ?? Math.min(...ys), yMax = o.yMax ?? Math.max(...ys);
  if (o.yMin == null) yMin = yMin - (yMax - yMin) * 0.08;
  if (o.yMax == null) yMax = yMax + (yMax - yMin) * 0.08;
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const X = x => L + (x - xMin) / ((xMax - xMin) || 1) * (w - L - R);
  const Y = y => T + (1 - (y - yMin) / (yMax - yMin)) * (h - T - B);
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p[0]))},${f1(Y(p[1]))}`).join('');
  let g = '';
  // grid + y ticks
  for (const v of niceTicks(yMin, yMax, 4)) g += `<g class="grid"><line x1="${L}" x2="${w - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}"/></g><text x="${L - 6}" y="${f1(Y(v)) + 4}" text-anchor="end">${esc(o.yFmt ? o.yFmt(v) : fmtNum(v))}</text>`;
  if (o.unit) g += `<text x="${L - 6}" y="${T - 3}" text-anchor="end" class="xs">${esc(o.unit)}</text>`;
  // bands (horizontal) and vbands (vertical, e.g. repair window)
  for (const b of o.bands || []) g += `<rect x="${L}" width="${w - L - R}" y="${f1(Y(Math.min(b.y1, yMax)))}" height="${f1(Math.abs(Y(Math.max(b.y0, yMin)) - Y(Math.min(b.y1, yMax))))}" fill="${c(b.tone)}" opacity="${b.opacity ?? 0.1}"/>${b.label ? `<text x="${w - R + 6}" y="${f1((Y(Math.max(b.y0, yMin)) + Y(Math.min(b.y1, yMax))) / 2) + 4}" fill="${tc(b.tone)}">${esc(b.label)}</text>` : ''}`;
  for (const b of o.vbands || []) g += `<rect x="${f1(X(b.x0))}" width="${f1(Math.max(2, X(b.x1) - X(b.x0)))}" y="${T}" height="${h - T - B}" fill="${c(b.tone)}" opacity="${b.opacity ?? 0.16}"/>${b.label ? `<text x="${f1(X(b.x0)) + 4}" y="${T + 12}" fill="${tc(b.tone)}" class="lbl-strong">${esc(b.label)}</text>` : ''}`;
  // limits
  for (const l of o.limits || []) if (l.y >= yMin && l.y <= yMax) g += `<line x1="${L}" x2="${w - R}" y1="${f1(Y(l.y))}" y2="${f1(Y(l.y))}" stroke="${c(l.tone)}" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${w - R + 6}" y="${f1(Y(l.y)) + 4}" fill="${tc(l.tone)}" class="lbl-strong">${esc(l.label)}</text>`;
  // x ticks
  const span = xMax - xMin, nx = o.xTicks || 5;
  for (let i = 0; i <= nx; i++) {
    const x = xMin + span * i / nx;
    g += `<text x="${f1(X(x))}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${esc(o.xFmt ? o.xFmt(x) : o.xType === 'time' ? timeLabel(x, span) : fmtNum(x))}</text>`;
  }
  g += `<line x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}" stroke="var(--line-2)"/>`;
  // forecast cone + line
  if (o.forecast) {
    const F = o.forecast;
    if (F.lo && F.hi) g += `<path d="${path(F.hi)}L${[...F.lo].reverse().map(p => `${f1(X(p[0]))},${f1(Y(p[1]))}`).join('L')}Z" fill="${c(F.tone || 'ai')}" opacity=".14"/>`;
    g += `<path d="${path(F.points)}" fill="none" stroke="${c(F.tone || 'ai')}" stroke-width="2" stroke-dasharray="5 4"/>`;
    if (F.label) { const p = F.points[F.points.length - 1]; g += `<text x="${f1(X(p[0])) - 4}" y="${f1(Y(p[1])) - 8}" text-anchor="end" fill="${tc(F.tone || 'ai')}" class="lbl-strong">${esc(F.label)}</text>`; }
  }
  // series
  for (const s of o.series || []) {
    if (!s.points.length) continue;
    if (s.area) g += `<path d="${path(s.points)}L${f1(X(s.points[s.points.length - 1][0]))},${f1(Y(yMin))}L${f1(X(s.points[0][0]))},${f1(Y(yMin))}Z" fill="${c(s.tone)}" opacity=".12"/>`;
    g += `<path d="${path(s.points)}" fill="none" stroke="${c(s.tone)}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`;
    if (s.endLabel) { const p = s.points[s.points.length - 1]; g += `<circle cx="${f1(X(p[0]))}" cy="${f1(Y(p[1]))}" r="3.5" fill="${c(s.tone)}"/><text x="${f1(X(p[0])) + 6}" y="${f1(Y(p[1])) + 4}" class="lbl-strong">${esc(s.endLabel)}</text>`; }
  }
  // now rule
  if (o.now != null && o.now >= xMin && o.now <= xMax) g += `<line x1="${f1(X(o.now))}" x2="${f1(X(o.now))}" y1="${T}" y2="${h - B}" stroke="var(--ink)" stroke-width="1.2"/><text x="${f1(X(o.now))}" y="${T - 3}" text-anchor="middle" class="lbl-strong">Now</text>`;
  for (const a of o.annotations || []) {
    const ax = f1(X(a.x)), ay = f1(Y(a.y)), right = a.side ? a.side === 'left' : ax > w * 0.6;
    g += `<circle cx="${ax}" cy="${ay}" r="5" fill="${c(a.tone || 'watch')}" stroke="var(--panel)" stroke-width="2"/><text x="${right ? ax - 9 : ax + 9}" y="${ay - 8}" text-anchor="${right ? 'end' : 'start'}" fill="${tc(a.tone || 'watch')}" class="lbl-strong">${esc(a.label)}</text>`;
  }
  let legend = '';
  if (o.legend && (o.series || []).length > 1) legend = (o.series || []).map((s, i) => `<g transform="translate(${L + i * 140},${T - 2})"><rect width="14" height="3" y="-4" fill="${c(s.tone)}"/><text x="18" y="0">${esc(s.name)}</text></g>`).join('');
  return wrap(w, h + (legend ? 0 : 0), o.title || 'chart', g + legend);
}

/** barsH({ title, items:[{label, value, tone, note}], max, fmt, w, rowH }) — horizontal bars with labels (Pareto, contributions). */
export function barsH(o) {
  const w = o.w || 560, rowH = o.rowH || 30, labW = o.labelW || 170, valW = 70;
  const max = o.max ?? Math.max(...o.items.map(i => i.value), 1e-9);
  const h = o.items.length * rowH + 6;
  let g = '';
  o.items.forEach((it, i) => {
    const y = i * rowH + 4, bw = Math.max(2, (w - labW - valW) * Math.max(0, it.value) / max);
    g += `<text x="0" y="${y + rowH / 2 + 4}" class="${it.strong ? 'lbl-strong' : ''}">${esc(it.label)}</text>`;
    g += `<rect x="${labW}" y="${y + 6}" width="${w - labW - valW}" height="${rowH - 14}" rx="3" fill="var(--line)" opacity=".5"/>`;
    g += `<rect x="${labW}" y="${y + 6}" width="${f1(bw)}" height="${rowH - 14}" rx="3" fill="${c(it.tone || 'normal')}"/>`;
    g += `<text x="${w - valW + 8}" y="${y + rowH / 2 + 4}" class="lbl-strong">${esc(o.fmt ? o.fmt(it.value, it) : fmtNum(it.value))}</text>`;
  });
  return wrap(w, h, o.title || 'bar chart', g);
}

/** columns({ title, items:[{label, value, tone}], fmt, w, h, yLabel }) — vertical bars (histograms). */
export function columns(o) {
  const w = o.w || 560, h = o.h || 200, L = 34, B = 26, T = 12;
  const max = o.max ?? Math.max(...o.items.map(i => i.value), 1);
  const bw = (w - L - 6) / o.items.length;
  let g = '';
  for (const v of niceTicks(0, max, 3)) { const y = T + (1 - v / max) * (h - T - B); g += `<line x1="${L}" x2="${w}" y1="${f1(y)}" y2="${f1(y)}" stroke="var(--line)"/><text x="${L - 5}" y="${f1(y) + 4}" text-anchor="end">${fmtNum(v)}</text>`; }
  o.items.forEach((it, i) => {
    const bh = (h - T - B) * it.value / max, x = L + i * bw + 3;
    g += `<rect x="${f1(x)}" y="${f1(h - B - bh)}" width="${f1(bw - 6)}" height="${f1(bh)}" rx="2" fill="${c(it.tone || 'normal')}"><title>${esc(it.label)}: ${esc(o.fmt ? o.fmt(it.value) : it.value)}</title></rect>`;
    if (o.items.length <= 16 || i % 2 === 0) g += `<text x="${f1(x + (bw - 6) / 2)}" y="${h - 8}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return wrap(w, h, o.title || 'column chart', g);
}

/** sparkline(points, { tone, w, h, limit }) */
export function sparkline(points, o = {}) {
  const w = o.w || 120, h = o.h || 34;
  if (!points.length) return raw('');
  const ys = points.map(p => p[1]).concat(o.limit != null ? [o.limit] : []);
  const min = Math.min(...ys), max = Math.max(...ys) || 1, x0 = points[0][0], x1 = points[points.length - 1][0];
  const X = x => (x - x0) / ((x1 - x0) || 1) * (w - 4) + 2, Y = y => h - 3 - (y - min) / ((max - min) || 1) * (h - 6);
  let g = o.limit != null ? `<line x1="0" x2="${w}" y1="${f1(Y(o.limit))}" y2="${f1(Y(o.limit))}" stroke="var(--watch-fill)" stroke-dasharray="3 3"/>` : '';
  g += `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p[0]))},${f1(Y(p[1]))}`).join('')}" fill="none" stroke="${c(o.tone || 'normal')}" stroke-width="1.6"/>`;
  return wrap(w, h, o.title || 'trend', g, 'spark');
}

/** heatmap({ title, rows:[label], cols:[label], values:[[v]], fmt, lo, hi, goodHigh }) — cell tone by value. */
export function heatmap(o) {
  const cw = o.cellW || 46, ch = o.cellH || 30, L = o.labelW || 120, T = 22;
  const w = L + o.cols.length * cw, h = T + o.rows.length * ch;
  const lo = o.lo ?? 0, hi = o.hi ?? 1;
  let g = '';
  o.cols.forEach((cl, j) => { g += `<text x="${L + j * cw + cw / 2}" y="14" text-anchor="middle">${esc(cl)}</text>`; });
  o.rows.forEach((r, i) => {
    g += `<text x="0" y="${T + i * ch + ch / 2 + 4}">${esc(r)}</text>`;
    o.cols.forEach((_, j) => {
      const v = o.values[i][j];
      let k = (v - lo) / ((hi - lo) || 1); k = Math.max(0, Math.min(1, k)); if (o.goodHigh) k = 1 - k;
      const tone = k > 0.66 ? 'var(--act-bg)' : k > 0.33 ? 'var(--watch-bg)' : 'var(--panel-2)';
      g += `<rect x="${L + j * cw + 1}" y="${T + i * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${tone}" stroke="var(--line)"/><text x="${L + j * cw + cw / 2}" y="${T + i * ch + ch / 2 + 4}" text-anchor="middle" class="lbl-strong">${esc(o.fmt ? o.fmt(v) : fmtNum(v))}</text>`;
    });
  });
  return wrap(w, h, o.title || 'heatmap', g);
}

/**
 * pfCurve({ title, w, h, detect, now, window:[a,b], fail, labels:{detect,now,window,fail}, compact })
 * Positions are fractions 0..1 along the curve's time axis. The curve: condition stays high, then falls ever faster to F.
 */
export function pfCurve(o) {
  const w = o.w || (o.compact ? 120 : 640), h = o.h || (o.compact ? 46 : 210), L = o.compact ? 4 : 30, R = o.compact ? 4 : 18, T = o.compact ? 6 : 26, B = o.compact ? 6 : 34;
  const cond = x => 1 - Math.pow(Math.max(0, (x - 0.15) / 0.85), 2.2);   // condition 1 → 0
  const X = x => L + x * (w - L - R), Y = y => T + (1 - y) * (h - T - B);
  let d = '';
  for (let i = 0; i <= 60; i++) { const x = i / 60; d += `${i ? 'L' : 'M'}${f1(X(x))},${f1(Y(cond(x)))}`; }
  let g = '';
  if (!o.compact) {
    g += `<line x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}" stroke="var(--line-2)"/><text x="${L}" y="${h - 12}">time →</text><text transform="translate(${L - 10},${(h - B + T) / 2}) rotate(-90)" text-anchor="middle">condition</text>`;
  }
  if (o.window) g += `<rect x="${f1(X(o.window[0]))}" width="${f1(Math.max(3, X(o.window[1]) - X(o.window[0])))}" y="${T}" height="${h - T - B}" fill="var(--ok-fill)" opacity=".18"/>${o.compact ? '' : `<text x="${f1(X(o.window[0]))}" y="${T - 8}" fill="var(--ok)" class="lbl-strong">${esc(o.labels?.window || 'Planned repair')}</text>`}`;
  g += `<path d="${d}" fill="none" stroke="var(--normal)" stroke-width="${o.compact ? 2 : 2.5}"/>`;
  const dot = (x, tone, lab, below) => {
    const cx = f1(X(x)), cy = f1(Y(cond(x)));
    return `<circle cx="${cx}" cy="${cy}" r="${o.compact ? 3.5 : 6}" fill="${c(tone)}" stroke="var(--panel)" stroke-width="2"/>` +
      (o.compact || !lab ? '' : `<text x="${cx}" y="${below ? Number(cy) + 22 : Number(cy) - 12}" text-anchor="middle" fill="${tc(tone)}" class="lbl-strong">${esc(lab)}</text>`);
  };
  if (o.detect != null) g += dot(o.detect, 'ai', o.labels?.detect || 'P: first sign', false);
  if (o.fail != null) g += dot(o.fail, 'act', o.labels?.fail || 'F: failure', false);
  if (o.now != null) g += dot(o.now, 'ink', o.labels?.now || 'Now', true);
  return wrap(w, h, o.title || 'P-F curve: where this machine is on its way from first sign of wear to failure', g, o.compact ? 'chart pf-mini' : 'chart');
}

/** zoneRuler({ title, v, unit, zones:[[from,to,label,tone,text]], max }) — ISO 10816 style severity ruler with a marker. */
export function zoneRuler(o) {
  const w = o.w || 560, h = 64, L = 4, R = 4, max = o.max || o.zones[o.zones.length - 1][1];
  const X = v => L + Math.min(v, max) / max * (w - L - R);
  let g = '';
  for (const [a, b, lab, tone] of o.zones) {
    g += `<rect x="${f1(X(a))}" y="18" width="${f1(X(b) - X(a))}" height="16" fill="${c(tone)}" opacity="${tone === 'normal' ? 0.35 : 0.55}"/><text x="${f1((X(a) + X(b)) / 2)}" y="30" text-anchor="middle" class="lbl-strong">${esc(lab)}</text><text x="${f1(X(b))}" y="48" text-anchor="middle">${fmtNum(b)}</text>`;
  }
  if (o.v != null) g += `<path d="M${f1(X(o.v))},16 l-6,-10 h12z" fill="var(--ink)"/><text x="${f1(X(o.v))}" y="62" text-anchor="middle" class="lbl-strong">${esc(fmtNum(o.v) + ' ' + (o.unit || ''))}</text>`;
  return wrap(w, h, o.title || 'severity zones', g);
}

/** interval({ title, lo, mid, hi, max, unit, w }) — RUL estimate with its band (box + whiskers). */
export function interval(o) {
  const w = o.w || 520, h = 56, L = 8, R = 8, max = o.max || o.hi * 1.2;
  const X = v => L + Math.min(v, max) / max * (w - L - R);
  let g = `<line x1="${L}" x2="${w - R}" y1="26" y2="26" stroke="var(--line-2)"/>`;
  for (const v of niceTicks(0, max, 4)) g += `<line x1="${f1(X(v))}" x2="${f1(X(v))}" y1="22" y2="30" stroke="var(--line-2)"/><text x="${f1(X(v))}" y="48" text-anchor="middle">${fmtNum(v)}${esc(o.unit || '')}</text>`;
  g += `<line x1="${f1(X(o.lo))}" x2="${f1(X(o.hi))}" y1="26" y2="26" stroke="var(--ai-fill)" stroke-width="2"/><rect x="${f1(X(o.lo + (o.mid - o.lo) * 0.45))}" y="17" width="${f1(X(o.mid + (o.hi - o.mid) * 0.45) - X(o.lo + (o.mid - o.lo) * 0.45))}" height="18" rx="3" fill="var(--ai-fill)" opacity=".28"/><line x1="${f1(X(o.mid))}" x2="${f1(X(o.mid))}" y1="13" y2="39" stroke="var(--ai-fill)" stroke-width="3"/><text x="${f1(X(o.mid))}" y="10" text-anchor="middle" fill="var(--ai)" class="lbl-strong">${esc(fmtNum(o.mid) + (o.unit || ''))}</text>`;
  return wrap(w, h, o.title || 'estimate with uncertainty band', g);
}

/** ring({ value 0..100, tone, label, size }) — health ring. */
export function ring(o) {
  const s = o.size || 92, r = s / 2 - 8, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, o.value));
  const g = `<circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="none" stroke="${c(o.tone)}" stroke-width="8" stroke-dasharray="${f1(C * v / 100)} ${f1(C)}" transform="rotate(-90 ${s / 2} ${s / 2})" stroke-linecap="round"/><text x="${s / 2}" y="${s / 2 + 7}" text-anchor="middle" style="font: 600 22px var(--mono); fill: var(--ink)">${Math.round(v)}</text>`;
  return wrap(s, s, o.label || 'health', g, 'ring');
}

/** spectrum({ title, pts, markers, fmax, w, h }) — vibration spectrum with labelled defect frequencies. */
export function spectrum(o) {
  const w = o.w || 680, h = o.h || 220, L = 40, R = 14, T = 26, B = 26;
  const max = Math.max(...o.pts.map(p => p[1])) * 1.1 || 1;
  const X = f => L + f / o.fmax * (w - L - R), Y = a => T + (1 - a / max) * (h - T - B);
  let g = '';
  for (const v of niceTicks(0, max, 3)) g += `<line x1="${L}" x2="${w - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="var(--line)"/><text x="${L - 5}" y="${f1(Y(v)) + 4}" text-anchor="end">${f1(v)}</text>`;
  for (const v of niceTicks(0, o.fmax, 5)) g += `<text x="${f1(X(v))}" y="${h - 8}" text-anchor="middle">${fmtNum(v)}</text>`;
  g += `<text x="${w - R}" y="${h - B - 6}" text-anchor="end">Hz →</text><text x="${L - 5}" y="${T - 10}" text-anchor="end">mm/s</text>`;
  const markers = (o.markers || []).filter(m => m.f < o.fmax);
  markers.forEach((m, i) => { g += `<line x1="${f1(X(m.f))}" x2="${f1(X(m.f))}" y1="${T}" y2="${h - B}" stroke="${m.tone ? c(m.tone) : 'var(--ai-fill)'}" stroke-dasharray="3 3" opacity=".8"/><text x="${f1(X(m.f))}" y="${T - 6 - (i % 2) * 11}" text-anchor="middle" fill="var(--ai)" class="lbl-strong">${esc(m.label)}</text>`; });
  g += `<path d="${o.pts.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p[0]))},${f1(Y(p[1]))}`).join('')}" fill="none" stroke="var(--ink)" stroke-width="1.3"/>`;
  return wrap(w, h, o.title || 'vibration spectrum', g);
}
