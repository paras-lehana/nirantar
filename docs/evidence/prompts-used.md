# Prompts actually sent to CoCo (Snowsight panel), in order

> Verbatim record of the build session, for evidence and reproducibility. Surface: CoCo in Snowsight (panel docked in
> Workspaces). Model: Auto (Balanced) unless noted. Approvals: Bypass after the guardrails were set.

## S0 — workspace organization (2026-10-04 ~01:35 IST)
Moved 21 uploaded files into `nirantar/docs/*` and `.snowflake/cortex/skills/<skill>/...`; created `nirantar/00_setup…06_ops_tests`.
Result: CoCo listed all 8 `nirantar-*` skills as installed. Evidence: `S/00-skills-installed-by-coco.jpg`.

## SETUP — foundation (2026-10-04 ~01:45 IST)
Roles (NIRANTAR_BUILDER + 4 business roles), NIRANTAR_WH (XS, 60 s), resource monitor NIRANTAR_RM (40 credits),
database NIRANTAR + 7 schemas, account grants (tasks/alerts/Cortex), stages RAW.DOCS + APP.SRC, CoCo daily credit caps
(Snowsight 60 / CLI 30 / Desktop 30), default warehouse, email integration + test email, OPS.COCO_JOURNAL.
