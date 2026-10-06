# Nirantar interactive demo — developer contract

Static app, no build step, vanilla ES modules. Served from `/app/` (GitHub Pages).
Design rule: **grey means normal, colour means act** (ISA-101 style). Tokens in `css/tokens.css` (contrast verified).

## Files
| Path | Owner | What |
|---|---|---|
| `js/core/generator.js` | shared (do not edit) | Builds the world: sites, lines, 48 assets with tags/limits, parts, technicians, sales orders, CMMS history, back-test episodes, 30-day OEE, energy, DOCS (copilot sources), SCENARIOS, FAILURE_MODES, TAGS, TRANSFER_H |
| `js/core/scoring.js` | shared | `createModel(store)` → `M`: `assetById, lineById, siteById, tagOf, valueAt(a,key,t)` (raw with noise), `smoothAt`, `trendAt` (model view), `series(a,key,from,to,stepMin)` → `[[t,v]]`, `deviation(tag,v)`, `assess(a,t)` → `{health, conf, rulH, rulLo, rulHi, rulKind, state('normal'|'watch'|'act'|'sensor'), mode, modeName, iso{zone,v,text}, top{key,label,ratio}, contributions[{key,label,dev}], worstKey, agree, sensorFault, failAt}`, `assessAll(t)`, `partPlan(a,mode)`, `exposure(a,mode)` → `{inr, downH, costPerH, plan}`, `plannedCost(a,mode)` → `{parts,labour,total}`, `planWindow(readyAt,failAt,durH)`, `whatIf(rulH,days,exposureInr)` → `{p, expectedLoss}`, `orderPressure(lineId,t)`, `bearingFreqs`, `spectrum(a,t)` → `{pts, markers, fr, bf, fmax, mode}`, `lineOee(lineId,days,t)`, `siteOee(siteId,days,t)` → `{availability, performance, quality, oee, losses, rows}`, `backtestAt(threshold)` |
| `js/core/store.js` | shared | `store` (`world`, `model`, `state`, `prefs`, `t` = current 15-min model time, `loaded`), actions: `loadScenario, clearData, acknowledge, shelve, escalate, aiDraft, approve(woId,name,comment), reject, startWork, complete, injectFault, injectSensorFault, logCopilot({q,a,tools,sources,blocked,rule}), setThreshold, advance(ms), jumpTo`, helpers (v1.1): `pmPlan(t?)` → `[{assetId, lineId, siteId, cls, last, interval, due, daysToDue, overdue, scheduled}]`, `PM_INTERVAL`, actions (v1.1): `schedulePM(assetId, {start, durH, reason, bundleWith}, name)` → PM work order (kind 'PM', status SCHEDULED), `toggleCheck(woId, key, name)` (keys `loto`, `step-<i>`, `parts`, `clean`), `recordReading(woId, mmPerS, name)` → `{v, pass, limit 2.3}`, `addNote(woId, text, name)`; helpers: `attention(a, ass)` → `{score, band, tone, why, exposure, order}`, `feedback(alertId, useful)`, `alarmHealth()`, `openAlerts()`, `audit(actor, action, target, detail, kind)`, `toast({kind,title,body,href})`, `changed(what)` |
| `js/core/format.js` | shared | `inr, pct, num, int, hours, time, clock, day, weekday, dateTime, shortDT, isoDate, ago, inHours, istHour, HOUR, MIN, DAY` (IST everywhere) |
| `js/ui/dom.js` | shared | `html``…`` (auto-escapes; nest html results freely), `raw(str)`, `esc`, `delegate(root, {action: (el, ev) => …})`, `icon(name)`, `logo`, `$`, `$$` |
| `js/ui/components.js` | shared | `pageHead(page)`, `stepBar(n)`, `headline(content, tone)`, `doThis([items])`, `marker(n)`, `kpi({label,value,unit,mean,tone,tip})`, `stateChip(state, text?)`, `aiChip(text)`, `humanChip(text)`, `term(word, tip)`, `why(text)`, `confPct(c)`, `nextBack(page)`, `noData(what)`, `caseStrip(assetId?)`, `heroId()`, `legendStates()`, `attentionBadge(att)`, `table({cols:[{label,key|get,n}], rows, onRow})`, `STATE_TEXT`, `toneOf` |
| `js/ui/charts.js` | shared | SVG strings: `lineChart({series, limits, bands, vbands, now, forecast:{points,lo,hi,label,tone}, annotations, xType:'time', unit, yMin, yMax, xFmt, yFmt, legend, title, w, h})`, `barsH({items:[{label,value,tone,note,strong}], fmt, max, labelW})`, `columns({items, fmt})`, `sparkline(points,{tone,limit})`, `heatmap({rows, cols, values, fmt, lo, hi, goodHigh})`, `pfCurve({detect, now, window:[a,b], fail, labels, compact})`, `zoneRuler({v, unit, zones:[[from,to,label,tone]]})`, `interval({lo, mid, hi, max, unit})`, `ring({value, tone, label})`, `spectrum({pts, markers, fmax})` |
| `js/main.js` (grouped rail; `NO_DATA_OK` pages render without data: data, help, home, built, roi), `js/routes.js` (`TOOLS[].group`), `css/tokens.css`, `css/base.css`, `css/components.css` | shared (do not edit) | shell, router, palette, data menu, toasts |
| `js/pages/<page>.js` + `css/pages/<page>.css` | **one owner per page** | the page |

If you need a change in a shared file, do it locally in your page (or its CSS) and list the request in your final report.

## Page module contract
```js
import { html, icon, delegate } from '../ui/dom.js';
let ui = { /* local UI state survives re-renders (module scope) */ };
export default {
  // autoRerender: false,          // set when the page has a text input that must not be wiped by the 15-min clock ticks
  // onStore(what, detail) {},     // only called when autoRerender is false; what = load, clear, tick, alert, wo, … (clock seconds are not sent)
  render(root, ctx) {            // ctx = { params, store, S, M, navigate, rerender, toast }
    root.innerHTML = String(html`<div class="page …">…</div>`);
    return delegate(root, { myAction: (el, ev) => { ui.x = el.dataset.id; ctx.rerender(); } });
  },
};
```
- Re-render after local state changes with `ctx.rerender()` (it cleans up listeners). Never call `render` yourself.
- Data-changing actions go through `S.*` (they log the audit row, toast and trigger a re-render).
- `main.js` shows `noData()` for you when no data is loaded (except Home/Data/Help).
- Read time from `store.t` (model time, 15-min buckets) and `store.state.simNow` (clock). The clock keeps running.

## Page anatomy (tour pages)
`pageHead(page)` → optional `caseStrip()` → `headline(one sentence with live numbers that answers the page question, tone)` →
`doThis([…])` with `marker(n)` placed next to the thing to press → cards (put the same `marker(n)` in the card head) → `nextBack(page)`.

## Copy and design rules
- Plain English, sentence case, active voice. No ALL-CAPS labels. Every number has a meaning line or a `term()` tooltip.
- Never show raw tag codes (`VIB_RMS`); use `tag.label`. Money as `inr()` (Rs 16.8 L), times as IST via `format.js`.
- Never hard-code numbers that the model can compute; everything comes from `store`/`M`.
- Colour = meaning: grey normal, amber watch, red act now, blue = made by the AI (`aiChip`), green = a human decision done. Status always has an icon or word too.
- Buttons: `.btn.primary` (navigation / main action), `.btn.approve` (a human decision such as Approve, Acknowledge), `.btn.danger`, `.btn.ai` (ask the AI to draft), `.btn.ghost`.
- Phone first: layouts must work at 390 px (no horizontal page scroll; wide tables go inside `.table-wrap`). Touch targets ≥ 40 px.
- Text ≥ 12 px (11 px only for chart ticks). Check contrast with tokens only (no new colours unless measured).
- Empty states teach: say what the section is for and the one action to start.

## QA (before a change ships)
Serve the repo (`python3 -m http.server 8090`); the app is `http://127.0.0.1:8090/app/#/<route>`.
```bash
node app/tests/store.test.mjs          # model + store: hero numbers, approvals, technician flow
node app/tests/golden.test.mjs         # copilot: golden questions, phrasings, guardrail
python3 tools/appsweep.py --scenarios  # every route at 390 / 820 / 1440 px, both themes, 5 scenarios (Playwright)
python3 tools/build_sw.py              # refresh the offline file list after adding files
```
Look at every changed screen at phone and desktop width, in light and dark, before calling a change done.
Logic can be unit-tested in Node (see `package.json` "type": "module"; stub `globalThis.localStorage`).
