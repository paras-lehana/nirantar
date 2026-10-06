# Streamlit-in-Snowflake patterns (verify against the current SiS runtime)

## Session & queries
```python
import streamlit as st
from snowflake.snowpark.context import get_active_session
session = get_active_session()

@st.cache_data(ttl=30)
def q(sql: str, params=None):
    return session.sql(sql, params=params).to_pandas()
```

## Digital twin floor map (Plotly; works without external network)
- Lanes: one `go.Scatter` rectangle per line (`fill='toself'`, light border) from `DIM_LINE.layout_x/layout_y` + width/height.
- Assets: one `go.Scatter(mode='markers+text')` with `marker.color = health_index` (custom green/amber/red scale),
  `marker.size = {A: 34, B: 26, C: 18}`, `marker.line = red, width 4` when an open alert exists, hover text with health,
  RUL band, top contributor, ₹/h.
- Click-through: `st.plotly_chart(fig, on_select="rerun", selection_mode="points")` → selected asset id → Asset 360
  (fallback: `st.selectbox` of assets sorted by priority).
- Optional 3D "risk towers": `pydeck` `ColumnLayer` on a local coordinate system without a basemap (elevation = risk).

## Cortex Agent chat inside SiS (warehouse runtime)
The Agents REST API is **not supported from warehouse-runtime SiS** (docs, 2026). Use SQL instead:
```python
import json
req = {"messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}
row = session.sql(
    "SELECT TRY_PARSE_JSON(SNOWFLAKE.CORTEX.DATA_AGENT_RUN(?, ?, TRUE)) AS r",
    params=["NIRANTAR.AI.NIRANTAR_COPILOT", json.dumps(req)]).collect()[0]
resp = json.loads(row["R"]) if row["R"] else None
# walk resp content: text → st.markdown; tool_use/tool_result → st.expander (SQL via st.code, tables via st.dataframe);
# chart specs → st.vega_lite_chart; citations → footnotes
```
**Fallback (automatic on error):** Cortex Analyst REST (supported in the warehouse runtime):
`_snowflake.send_snow_api_request("POST", "/api/v2/cortex/analyst/message", {}, {}, {"messages": [...],
"semantic_view": "NIRANTAR.AI.SV_PLANT_OPS"}, None, 60000)` → run the returned SQL, plus
`SNOWFLAKE.CORTEX.SEARCH_PREVIEW('NIRANTAR.AI.CSS_MAINT_KNOWLEDGE', '{"query": …, "limit": 3}')`, then summarise both with
`AI_COMPLETE`. Show a badge with the path that answered. Container runtime (after an account upgrade): use `requests` with
the session token at `/snowflake/session/token` against `/api/v2/databases/…/agents/…:run` (SSE).

## Actions
```python
res = session.call("NIRANTAR.APP.AUTO_DRAFT_WORK_ORDER", asset_id)
st.toast(json.loads(res)["status"])
```

## Pitfalls
- Avoid external CDNs and fonts (blocked). Use Plotly, Altair, pydeck, st.* only.
- Keep each page < ~400 lines; shared helpers in `common.py`.
- Auto-refresh: a "Live" toggle + `st.rerun()` after `time.sleep(30)` only on Twin/Triage pages, and only while toggled.
