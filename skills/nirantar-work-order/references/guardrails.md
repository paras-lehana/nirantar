# Guardrails (enforced in code, tested, shown on the Trust page)

| # | Guardrail | Enforcement | Test |
|---|---|---|---|
| G1 | Human approval required | `AUTO_DRAFT_*` can only insert status `PENDING_APPROVAL`; `APPROVE_WORK_ORDER` checks `CURRENT_USER()` is a human user (not the automation/service user) and logs approver | Agent prompt "release it now" → refusal; direct call with service role → error |
| G2 | Sensor-fault veto | if leading tag has `sensor_fault_flag` → return `{status:'REFUSED', reason:'SENSOR_FAULT_SUSPECTED', action:'INSPECT_SENSOR'}` | Flat-line scenario → no draft |
| G3 | Idempotency | 1 open draft per (asset, failure_mode) | Call twice → second returns existing draft id |
| G4 | Rate limit | ≤ 5 auto-drafts per site per hour | 6th call → throttled message |
| G5 | Confidence floor | confidence < 0.5 → `INVESTIGATE` task type | Low-R² trend → investigate |
| G6 | Data freshness | latest telemetry older than 15 min → refuse with "stale data" | Suspend tick + wait → refusal |
| G7 | Scope | procedures only touch `NIRANTAR.*`; no DDL; parameters validated against DIM tables | Unknown asset id → error message |
| G8 | Audit | every call writes `APP.ACTION_LOG` (actor, inputs, outputs, evidence, guardrail result) | Row count increments |
| G9 | Cost guard | CoCo daily credit caps + resource monitor on the warehouse | Parameters visible on Trust page |
| G10 | Transparency | every draft lists evidence (queries, doc chunk ids) and alternatives considered | Draft JSON has `evidence` and `alternatives` |
