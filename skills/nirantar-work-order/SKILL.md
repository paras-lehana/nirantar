---
name: nirantar-work-order
description: Draft a maintenance work order that is parts-ready and production-aware — failure mode, steps and safety (LOTO) from manuals, required spares checked across plants (reserve, transfer or purchase requisition), best maintenance window from the production schedule before predicted failure, qualified technician, cost and OEE impact — and route it for human approval with a full audit trail. Use for "create a work order", "draft WO", "schedule maintenance for", "plan the repair", "what parts do we need", and for building the agent tools/procedures that do this.
tools:
- sql_execute
- snowflake_sql_execute
---

# Work-order drafting with guardrails (Nirantar)

Two modes: **RUN** (draft a WO for an asset now) and **BUILD** (create/upgrade the stored procedures that the Cortex Agent
and alerts call). The guardrails in `references/guardrails.md` are non-negotiable in both modes.

## RUN mode — input: asset or alert · output: draft WO `PENDING_APPROVAL`
1. Pre-checks (stop with a clear message if any fails): asset exists; latest data fresh; **no sensor fault** on the
   leading signal; no open draft/WO for the same asset and mode; site draft rate limit not exceeded.
2. If `APP.AUTO_DRAFT_WORK_ORDER(asset_id)` exists, call it and present its result. Otherwise assemble the draft:
   failure mode + recommended steps + LOTO/SOP (manual search) → parts (`CHECK_SPARES`: here → other site transfer with ETA
   → purchase requisition with lead time) → window (`PROPOSE_WINDOW`: top-3 slots scored by OEE loss, penalty risk and
   parts ETA, ending before `rul_low`) → technician (skill + certification + shift + workload) → cost (labour + parts +
   downtime ₹) and OEE impact (fix-at-window vs run-to-failure) → confidence.
3. If confidence < 0.5 → produce an **INVESTIGATE** task (inspection/measurement), not a repair.
4. Write the draft to `APP.WORK_ORDER_DRAFTS` with status `PENDING_APPROVAL` and an `APP.ACTION_LOG` row (actor =
   `AGENT:nirantar-work-order`, evidence JSON with the queries/doc ids used).
5. Show the draft as a compact card + a one-line "Approve in the Command Center (Work Orders page)".

## BUILD mode
Create/replace procedures in schema `APP`: `ASSET_360`, `CHECK_SPARES`, `PROPOSE_WINDOW`, `WHAT_IF_DEFER`,
`AUTO_DRAFT_WORK_ORDER`, `APPROVE_WORK_ORDER`, plus `ACTION_LOG`. Contracts and checks are in `references/contracts.md`.
Enforce guardrails **inside** the procedures and write tests that prove each guardrail (refusal cases included).

## Never
- Never set a WO to APPROVED/RELEASED from this skill or from any agent path. Only `APPROVE_WORK_ORDER` called by a human
  user (Streamlit button) may do that.
- Never reserve or transfer stock without writing the action log.
- Never invent part numbers, technicians or windows — they must come from tables.
