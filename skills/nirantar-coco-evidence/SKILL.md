---
name: nirantar-coco-evidence
description: Build an auditable record of how Snowflake CoCo was used across a project's lifecycle — sessions by surface (Snowsight, CLI, Desktop), model, day, credits and the prompts behind each artifact — into a table and a markdown report for judges, reviewers or cost owners. Use for "prove CoCo usage", "CoCo evidence", "CoCo cost report", "which artifacts did CoCo build", "export CoCo journal".
tools:
- sql_execute
- snowflake_sql_execute
---

# CoCo usage evidence (reusable for any team)

## Procedure
1. Check access: `SNOWFLAKE.ACCOUNT_USAGE.SNOWFLAKE_COCO_USAGE_HISTORY` (or the per-surface
   `CORTEX_CODE_{CLI,DESKTOP,SNOWSIGHT}_USAGE_HISTORY` views) and `SNOWFLAKE.LOCAL.AI_OBSERVABILITY_EVENTS` (needs
   application role `SNOWFLAKE.AI_OBSERVABILITY_READER`). If a view is missing, say so and continue with what exists.
   ACCOUNT_USAGE can lag ~1 h.
2. Usage summary → `OPS.COCO_USAGE_SUMMARY`: day, interface (surface), user, model, requests, token credits, est. USD
   (AI credit price $2.00 global / $2.20 regional — state the assumption).
3. Prompt trail → `OPS.COCO_PROMPT_TRAIL`: timestamp, interface, model, first 300 chars of each user prompt from spans named
   `CodingAgent.Step-0` (inspect `OBJECT_KEYS(RECORD_ATTRIBUTES)` to find the prompt key), joined on request id when possible.
4. Map prompts to lifecycle phases with simple keyword rules (Planning: design/ontology/plan/explore; Development:
   create/build/generate; Execution: task/alert/automation/run; Testing: test/validate/eval/check), then let the user
   correct the mapping.
5. If a project journal table exists (`OPS.COCO_JOURNAL`), reconcile: every journal row should have a matching session.
6. Output `docs/coco-evidence.md`-ready markdown: totals per phase × surface, top 10 sessions with artifacts, cost, and
   the exact queries used (so judges can re-run them).

## Rules
Read-only on SNOWFLAKE.* views. Redact anything that looks like a secret (keys, tokens, passwords) before storing prompts.
