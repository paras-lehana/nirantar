# Nirantar CoCo Skills: reusable reliability skills for any manufacturer

Eight [Snowflake CoCo](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code) skills. Together they take a
team from **"we have sensors, an ERP and a CMMS"** to **"an AI command center that predicts failures and drafts
approved, parts-ready work orders"**. They're built for the *Snowflake CoCo CLI Hackathon 2026 (GCC Edition)* and written
to be **industry-agnostic**: point them at your own tables, or let `nirantar-synthetic-plant` generate a realistic sandbox.

| # | Skill | Phase | Input → Output | Chains to |
|---|---|---|---|---|
| 1 | `nirantar-synthetic-plant` | Build | industry pack + size → referentially-consistent OT + ERP + CMMS + docs with failure physics | 2, 3 |
| 2 | `nirantar-ontology-semantic-view` | Build | ontology tables → governed Semantic View (ISA-95 + ISO 14224 + OEE) + verified queries + validation report | 5, 6 |
| 3 | `nirantar-command-center` | Build | semantic view + APP objects → Streamlit-in-Snowflake command center (twin, triage, OEE, copilot) | — |
| 4 | `nirantar-alert-triage` | Run | plant/line → ranked risk queue with ₹ exposure, due-order pressure, parts status; sensor faults & planned changeovers suppressed | 5, 6 |
| 5 | `nirantar-rca` | Run | asset/alert → evidence-based root cause (5-Whys + fishbone) with SQL evidence and citations | 6 |
| 6 | `nirantar-work-order` | Run | asset/alert → parts-ready, production-aware work-order draft, gated by guardrails + human approval | 7 |
| 7 | `nirantar-reliability-brief` | Run (scheduled) | plant → morning/shift briefing (top risks, OEE vs target, approvals pending, stock-outs, 1 decision) | — |
| 8 | `nirantar-coco-evidence` | Meta | account → table + markdown proving CoCo usage per lifecycle phase, surface and model | — |

**Demo workflow (CLI, one line each):**
```
$nirantar-alert-triage   PUNE-MACH line PUN-L2      # input: line  → output: ranked queue, VMC-204 at the top
$nirantar-rca            VMC-204                    # → supplier lot L-2391 + evidence
$nirantar-work-order     VMC-204                    # → draft WO: transfer from Chennai, Thu 14:00 changeover window, PENDING_APPROVAL
```
(In Snowsight use `/` instead of `$`.)

---

## Install

### A. CoCo in Snowsight (workspace-scoped personal skills)
1. *Projects ▸ Workspaces ▸ My Workspace*. Create folder **`.snowflake/cortex/skills/`** at the workspace root.
2. Upload each skill folder (e.g. `nirantar-rca/` with `SKILL.md` and `references/`) into it (*Upload Skill File(s)/Folder(s)*
   or *+ Create Skill* and paste `SKILL.md`).
3. Type `/nirantar` in the CoCo panel. The skills appear in the picker.
4. Optional: put `snowflake-workspace/AGENTS.md` from this repo at the **workspace root** (CoCo auto-loads it).

### B. CoCo CLI / Desktop
```bash
# project-level (from repo root): CoCo looks in .cortex/skills/
mkdir -p .cortex && ln -s ../skills .cortex/skills
# or user-level
cp -r skills/nirantar-* ~/.snowflake/cortex/skills/
cortex            # then type $$ to list skills, $nirantar-rca VMC-204 to run one
```

### C. Share inside an account (catalog link)
In CoCo: `/share-skill-and-plugin nirantar-rca`. It returns a `snow://skill_catalog/...` link teammates paste to install.
Or publish the folder to a stage: `cortex skill publish ./skills --to-stage @NIRANTAR.OPS.SKILLS/skills/`.

### D. From GitHub
`cortex skill add https://github.com/<org>/<this-repo>` (or `/skill add <url>` inside a session).

---

## Conventions all skills follow

- Object names default to the `NIRANTAR` database (schemas `RAW, CORE, ML, APP, AI, SIM, OPS`) but every skill accepts
  a different database/schema mapping. Ask: *"use database ACME_PLANT"*.
- **Read-only by default.** Only `nirantar-synthetic-plant`, `nirantar-ontology-semantic-view`, `nirantar-command-center`
  and the draft step of `nirantar-work-order` write, and only inside the target database.
- **Numbers come from SQL; the LLM only explains.** Every answer shows the query or object it came from.
- **Guardrails:** never approve/release work orders, never act on suspected sensor faults, never run DDL outside the target
  database, always log actions to `APP.ACTION_LOG`.
- Tools: `sql_execute` (CLI ≥ 1.1.8) and `snowflake_sql_execute` (Desktop/Snowsight). Both are listed in each skill.

Version: **1.0.0 (2026-10-04)**. License: MIT (see repo `LICENSE`).
