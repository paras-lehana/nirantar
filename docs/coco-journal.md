# CoCo Journal: Nirantar

> One row per CoCo milestone. Mirrored in `NIRANTAR.OPS.COCO_JOURNAL`.
> Phases: Planning · Development · Execution · Testing · Sharing. Surfaces: Snowsight · CLI · Desktop · CoWork.

| # | Time (IST) | Phase | Surface | Model | Skill(s) | Prompt (summary) | Artifact(s) | Evidence | Human fix? |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-10-03 23:45 | Planning (pre-build) | Snowsight | Auto (Balanced) | `/skill-development` (auto-sent by "+ New skill") | First CoCo request on the trial account | none: blocked with "Cortex Code is not enabled… upgrade your account" (trial gate, see research 05) | our account notes (trial gate), not in this repo | Card must be added by the owner |
| 1 | 2026-10-04 01:00 | Setup (S0) | Snowsight (panel in Workspaces) | Auto (Balanced) | built-in file tools | Reorganize 21 uploaded files into `nirantar/docs` + `.snowflake/cortex/skills/*` | 8 `nirantar-*` skills installed; workspace folders | `S/00-skills-installed-by-coco.jpg` | none |
| 2 | 2026-10-04 01:08 | Setup | Snowsight | Auto (Balanced) | `sql-author` | Foundation: roles, NIRANTAR_WH, resource monitor, DB + 7 schemas, grants, stages, CoCo credit caps, email integration, journal table | 21 objects verified OK; test email received by owner | `0-setup/02-foundation-verified-by-coco.jpg` | none |
| 3 | 2026-10-04 01:18 | Planning (P1) | Snowsight (full screen) | Auto (Balanced) | — | Problem framing, ontology ER, workflow, build plan, risks | `nirantar/docs/coco-planning.md` (437 lines); journal row #2 | `P/01-planning-coco.jpg` | none |
| 4 | 2026-10-04 01:24 | Development (D1) | Snowsight | Auto (Balanced) | `nirantar-synthetic-plant` | Enterprise master data procedure | 7/13 DIM tables; self-fixed ARRAY_CONSTRUCT-in-VALUES error; run stalled when browser hidden | — | resume needed |
| 5 | 2026-10-04 01:30 | Development (D3, parallel chat) | Snowsight | Auto (Balanced) | `nirantar-synthetic-plant` | Synthetic maintenance documents via AI_COMPLETE + chunks + AI_TRANSLATE | 34 docs, 79 chunks; self-fixed NULL bodies (AI_COMPLETE output parsing) | `D/03-docs-corpus.jpg` | none |
| 6 | 2026-10-04 01:40 | Development (D10) | Snowsight | Auto (Balanced) | — | Cortex Search service on doc chunks + 5 test queries | CSS_MAINT_KNOWLEDGE (arctic-embed-l-v2.0, lag 1 day, auto-suspend) | `D/12-cortex-search.jpg` | none |
| 7 | 2026-10-04 01:43 | Sharing (X1) | Snowsight (Cloud Agent shell: `cortex skill catalog publish`) | Auto (Balanced) | `share-skill-and-plugin` | Publish 8 skills to the account catalog | CLI publish hung in sandbox; to retry non-interactively | — | retry |
| 8 | 2026-10-06 23:08 | Sharing (X2) | **CoCo CLI v1.1.104** (this server) | — | built-in `cortex skill` | `cortex skill add https://github.com/paras-lehana/nirantar` then `cortex skill list` (re-run against the public repository; first run 21:05 against our working repository) | All 8 `nirantar-*` skills discovered as remote skills, nothing else (no Snowflake login needed for this step) | `X/02-coco-cli-skill-add.png` + `.txt` | none |
