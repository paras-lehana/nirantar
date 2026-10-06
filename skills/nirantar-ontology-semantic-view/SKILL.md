---
name: nirantar-ontology-semantic-view
description: Turn plant, maintenance and ERP tables into a governed manufacturing ontology expressed as a Snowflake Semantic View (ISA-95 hierarchy, ISO 14224 failure taxonomy, OEE and reliability metrics) with synonyms, verified queries and an accuracy test against natural-language paraphrases. Use for "build the semantic view", "OEE semantic model", "manufacturing ontology", "add verified queries", "why do teams get different OEE numbers", "validate Cortex Analyst answers".
tools:
- sql_execute
- snowflake_sql_execute
---

# Ontology → Semantic View (Nirantar)

Goal: **one governed definition** of every plant metric so the Copilot, CoWork, dashboards and SQL all return the same
number. Use the built-in `/agent-studio` capabilities for semantic-view DDL when available.

## Procedure
1. **Discover** the schema (`SHOW TABLES`, `DESCRIBE`) in the target database (default `NIRANTAR.CORE/APP/ML/RAW`). Map
   tables to ontology entities using `references/ontology.md`. Report unmapped tables and missing keys before building.
2. **Draft the ontology** as a Mermaid ER diagram (entities, keys, relationships, cardinality) and show it to the user.
3. **Create the semantic view** (default `AI.SV_PLANT_OPS`) with logical tables, primary keys, relationships, facts,
   dimensions (site, line, asset, asset_class, criticality, shift, date, loss_category, failure_mode, supplier,
   supplier_lot, technician, wo_type, wo_status) and the metrics in `references/metrics.md`. Use the exact formulas, add
   **synonyms** and plain-English **descriptions** for every metric and dimension.
4. **Add verified queries** from `references/verified-queries.md` (adapt names); verify each runs and returns rows.
5. **Validate:** for each verified question plus ≥ 5 paraphrases, ask Cortex Analyst and compare to the SQL ground truth.
   Write results to `OPS.SV_VALIDATION(question, expected, got, passed, ts)` and report the pass rate. Fix definitions
   (not tests) until ≥ 90 % pass.
6. Save DDL/YAML to the workspace folder the user names (default `nirantar/04_semantic_ai/`).

## Rules
- Metric definitions are the contract: OEE = Availability × Performance × Quality computed from shift facts (never an
  average of percentages across lines — aggregate numerators/denominators first).
- Currency is INR; show lakh/crore formatting hints in descriptions.
- Never expose PII columns (technician phone/email) as dimensions.
