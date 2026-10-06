---
name: nirantar-command-center
description: Scaffold and extend a Streamlit-in-Snowflake reliability command center — plant digital twin (Plotly floor map colored by asset health), Asset 360, alert triage with actions, work-order board with approval, OEE cockpit with Six Big Losses, Cortex Agent copilot chat, what-if simulator, trust/audit page and presenter controls. Use for "build the command center", "streamlit dashboard for maintenance", "digital twin page", "add a page to the app", "agent chat in streamlit".
tools:
- sql_execute
- snowflake_sql_execute
---

# Command Center builder (Nirantar)

Follow `references/streamlit-patterns.md`. **Runtime check first:** on accounts without compute pools (e.g. trials),
Streamlit-in-Workspaces and the container runtime are unavailable, so create the app on the **warehouse runtime** from a
stage: `CREATE STREAMLIT <db>.<schema>.<app> FROM '@<stage>' MAIN_FILE='streamlit_app.py' QUERY_WAREHOUSE=<wh>
RUNTIME_NAME='SYSTEM$WAREHOUSE_RUNTIME'` then `ALTER STREAMLIT … ADD LIVE VERSION FROM LAST`. Packages come from the
Snowflake conda channel via `environment.yml` (plotly, pydeck, altair).

## Procedure
1. Confirm app name (default `NIRANTAR.APP.NIRANTAR_COMMAND_CENTER`), warehouse (`NIRANTAR_WH`), source folder
   (`nirantar/05_app/`) and which pages to build now. Build **one page at a time**, run it, fix errors, then continue.
2. Data access only through governed objects: `APP.V_*` views, `ML.*` predictions, the semantic view metrics, and the
   `APP` procedures for actions. No ad-hoc metric formulas in Python — reuse the governed SQL.
3. Pages (emoji titles, in this order): 🏭 Twin · 🔎 Asset 360 · 🚨 Triage · 🛠 Work Orders · 📈 OEE · 💬 Copilot · 🧪 What-if
   · 🛡 Trust · 🎬 Presenter. Each page starts with a one-line "what this answers" caption.
4. Global header: plant selector, IST clock, "₹ downtime exposure today" ticker, data-freshness badge (green < 5 min).
5. Every action button (Ack, Draft WO, Snooze, Escalate, Approve/Reject, presenter actions) calls a procedure, shows a toast
   with the result and writes `APP.ACTION_LOG`. Presenter actions require typing `DEMO`.
6. Performance: `st.cache_data(ttl=300)` for master data, `ttl=30` for live views; limit sparklines to 72 h at 15-min grain.
7. After each page: open the app, screenshot, and list any warnings/errors; fix before moving on.

## Visual language
Dark industrial theme; health colors green `#2BB673` (≥ 80) → amber `#F5A623` (50–79) → red `#E5484D` (< 50); red ring =
open alert; node size = criticality (A large). INR formatting in lakh/crore. Every chart has a title that states the insight
(e.g. "VMC-204 crossed ISO zone C 31 h ago").
