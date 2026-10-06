// Formatting in Indian conventions: Rs with lakh/crore, IST clock, hours shown as days when long.
const IST = 'Asia/Kolkata';
export const HOUR = 3600e3;
export const MIN = 60e3;
export const DAY = 24 * HOUR;

export function inr(v, { compact = true } = {}) {
  if (v == null || isNaN(v)) return '–';
  const a = Math.abs(v);
  if (compact && a >= 1e7) return 'Rs ' + (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (compact && a >= 1e5) return 'Rs ' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L';
  return 'Rs ' + Math.round(v).toLocaleString('en-IN');
}
export const pct = (v, d = 0) => (v == null || isNaN(v) ? '–' : (v * 100).toFixed(d) + ' %');
export const num = (v, d = 1) => (v == null || isNaN(v) ? '–' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const int = v => (v == null || isNaN(v) ? '–' : Math.round(v).toLocaleString('en-IN'));

export function hours(h) {
  if (h == null || !isFinite(h)) return 'no trend';
  if (h >= 240) return Math.round(h / 24) + ' days';
  if (h >= 48) return Math.round(h) + ' h';
  return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
}

const fmtCache = {};
function f(opts) {
  const k = JSON.stringify(opts);
  return (fmtCache[k] ||= new Intl.DateTimeFormat('en-IN', { timeZone: IST, ...opts }));
}
export const time = ms => f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);   // h23: midnight is 00:10, never 24:10
export const clock = ms => f({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
export const day = ms => f({ day: '2-digit', month: 'short' }).format(ms);
export const weekday = ms => f({ weekday: 'short' }).format(ms);
export const dateTime = ms => `${weekday(ms)} ${day(ms)} ${time(ms)} IST`;
export const shortDT = ms => `${day(ms)} ${time(ms)}`;
export const isoDate = ms => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 10);

export function ago(ms, now) {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
export function inHours(ms, now) {
  const h = (ms - now) / HOUR;
  return h < 0 ? hours(-h) + ' ago' : 'in ' + hours(h);
}
// IST wall-clock hour of a timestamp (0-23)
export const istHour = ms => (new Date(ms + 5.5 * HOUR).getUTCHours());
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
