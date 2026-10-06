# AGENTS.md — instructions for CoCo in this Snowflake Workspace (project NIRANTAR)

> Upload this file to the **root of the Snowsight Workspace** (and the CLI project root). CoCo loads it automatically.

## What we are building
**Nirantar**: a Predictive Maintenance & OEE Command Center for the fictional *Indus Group* (3 plants: PUNE-MACH,
CHENNAI-FORGE, CHITTOR-CEMENT). It converges OT telemetry, ERP (spares, supplier lots, production/sales orders) and CMMS
(work orders, failure codes, technicians) to predict failures, auto-draft parts-ready, production-aware work orders
(human-approved) and lift OEE. **All data is synthetic.** Specs: `nirantar/docs/design.md`, `nirantar/docs/data-model.md`,
`nirantar/docs/feature-catalog.md`. When a spec and your idea differ, the spec wins. Ask before deviating.

## Objects & naming
- Database `NIRANTAR`; schemas `RAW` (sources), `CORE` (ontology + facts, Dynamic Tables), `ML` (features, health,
  predictions, backtest), `APP` (views, procedures, alerts, drafts, action log), `AI` (semantic view, search, agent),
  `SIM` (generators, scenarios), `OPS` (tests, evals, journal).
- Warehouse `NIRANTAR_WH` (X-Small) only. Never create or resize warehouses, and never use another warehouse.
- Role `NIRANTAR_BUILDER` for all build work. Account-level changes only when the user explicitly asks.
- Hero scenario: `HERO_VMC204_BEARING` (asset VMC-204, line PUN-L2). It must be deterministic after `CALL SIM.RESET_DEMO()`.

## Guardrails (non-negotiable)
1. Never approve/release work orders in code paths an agent can trigger. Drafts are `PENDING_APPROVAL`; only
   `APP.APPROVE_WORK_ORDER` (human via Streamlit) approves.
2. Suspected sensor faults (flat-line, stuck, spike, dropout) must never create repair work orders. Raise `INSPECT_SENSOR` instead.
3. Every write done by an agent/procedure is logged in `APP.ACTION_LOG` with evidence JSON.
4. No `DROP DATABASE`, no grants to PUBLIC, no account-level `ALTER` unless the user asks in this chat.
5. Cost: Dynamic Table lags ≥ 15 minutes (or DOWNSTREAM) — a 1-minute lag costs ~$100/day in this region; the live path
   uses serverless tasks. Suspend DTs outside demo windows. Tasks and alerts are created **SUSPENDED**.
   `SIM.T_TICK` self-stops after 120 ticks. Tell the user the expected credits before any statement likely to run > 2 minutes.

## Coding conventions
- SQL first; Snowpark Python for generators/procs when SQL gets awkward. Seeded randomness only.
- Every object gets a `COMMENT` ("Nirantar · <purpose> · synthetic" where relevant).
- Save every file you create under `nirantar/<NN_area>/` (00_setup, 01_data, 02_pipeline, 03_ml, 04_semantic_ai, 05_app,
  06_ops_tests, docs). File names: lower_snake_case.
- Numbers come from SQL. When you explain results, show the query (or the object) you used.
- Prefer our skills: `/nirantar-synthetic-plant`, `/nirantar-ontology-semantic-view`, `/nirantar-command-center`,
  `/nirantar-alert-triage`, `/nirantar-rca`, `/nirantar-work-order`, `/nirantar-reliability-brief`, `/nirantar-coco-evidence`.

## Definition of done for any task
1. Objects exist (show `SHOW … LIKE` / row counts).
2. The relevant tests in `OPS.RUN_TESTS()` pass (add a test when you add a feature).
3. A one-line row is inserted into `OPS.COCO_JOURNAL(ts, phase, surface, skill_used, prompt_summary, artifact)` with phase
   PLANNING / DEVELOPMENT / EXECUTION / TESTING.
4. A 3-line summary: what changed, how it was verified, what to watch.
