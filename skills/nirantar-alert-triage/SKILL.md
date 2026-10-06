---
name: nirantar-alert-triage
description: Triage equipment alerts for a plant or line by combining OT health/failure-risk with ERP and CMMS context — rupee downtime exposure, customer orders due, spare-part availability, open work orders — while suppressing suspected sensor faults and planned changeovers. Use for "triage alerts", "what should maintenance do first", "rank risky machines", "morning risk list", "which assets need attention on line X".
tools:
- sql_execute
- snowflake_sql_execute
---

# Alert triage (Nirantar) — input: plant/line · output: ranked, explained action queue

## Procedure
1. Resolve scope: site and optional line (e.g. `PUNE-MACH`, `PUN-L2`). Default: all sites.
2. Pull latest health/prediction per asset (`ML.ASSET_HEALTH`, `ML.PREDICTIONS`) and open alerts (`APP.ALERTS`).
3. **Suppress noise first, and say how many were suppressed:**
   - `sensor_fault_flag = TRUE` → do **not** rank as failure; list under "Inspect sensor" with the tag and fault type.
   - Asset in a planned state (SETUP/PM/changeover per `ERP_PRODUCTION_ORDER.is_changeover_window` or `OT_MACHINE_STATE`)
     → mark "expected", not an alert.
   - Duplicates (same asset + mode within 24 h) → merge.
4. Enrich each remaining asset with: ₹ downtime cost/h of its line, mean repair hours of the probable failure mode,
   criticality, next sales order due on that line + late penalty, required spare parts and stock at this site / other sites,
   open WO or draft.
5. Score: `priority = risk_72h × cost_per_h × repair_h × crit_weight(A=1, B=.6, C=.3) × (1 + due_pressure)`
   (or read `APP.V_PRIORITY` if it exists — never recompute differently from the governed view).
6. Output a table (top 10): rank · asset · line · probable mode · risk 72 h · RUL (low–high h) · ₹ exposure · order
   pressure · parts status · recommended next action (`Draft WO` / `Inspect sensor` / `Monitor` / `Plan at changeover`).
7. End with **one recommended decision** in plain words and offer the chain: "Run `nirantar-rca <asset>`?" and
   "Run `nirantar-work-order <asset>`?".

## Rules
- Read-only. Never create or change work orders here.
- Every number must come from a query you ran; show the SQL in a collapsible block or appendix.
- If data is stale (latest telemetry older than 15 min), say so at the top.
