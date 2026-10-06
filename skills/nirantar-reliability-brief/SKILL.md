---
name: nirantar-reliability-brief
description: Produce a concise morning or shift-handover reliability briefing for a plant — top risks with RUL and rupee exposure, yesterday's OEE vs target with the biggest loss, work orders awaiting approval, spare-part stock-outs, sensor-health issues and one recommended decision. Designed to run unattended as a scheduled CoCo automation. Use for "morning brief", "shift handover", "daily reliability report", "what happened overnight".
tools:
- sql_execute
- snowflake_sql_execute
---

# Reliability briefing (Nirantar)

Audience: plant manager and maintenance planner on a phone, so keep it to **≤ 250 words**, numbers first, no jargon.

## Procedure
1. Scope: site (default `PUNE-MACH`), window (default: since 06:00 IST yesterday; for shift handover: last 8 h).
2. Query (governed objects only): top 5 assets by `APP.V_PRIORITY`; OEE by line vs 85 % target and biggest loss
   (semantic view metrics); drafts in `PENDING_APPROVAL`; critical spares with available ≤ 0; sensor-fault flags;
   any failures since the last brief.
3. Write the brief in this structure:
   - **Headline** (1 line: the single most important thing)
   - **Top risks** (≤ 5 bullets: asset · risk · RUL · ₹/h · recommended action)
   - **OEE yesterday** (per line, Δ vs target, top loss)
   - **Waiting on you** (approvals, stock-outs)
   - **Data health** (sensor faults / stale feeds)
   - **One decision to make today**
4. Store it: `INSERT INTO APP.SHIFT_BRIEFS(site_id, kind, created_at, body_md, source='COCO_AUTOMATION')`.
5. Reply with the same markdown (automations email the report).

## Rules
Read-only except the single insert. If a query fails, say which section is missing; never invent numbers.
