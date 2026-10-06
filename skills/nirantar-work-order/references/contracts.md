# Procedure contracts (schema APP; all return VARIANT JSON; all log to APP.ACTION_LOG)

| Procedure | Input | Output (JSON keys) |
|---|---|---|
| `ASSET_360(asset_id)` | asset id | asset, line, site, criticality, health_index, iso_zone, risk_72h, rul_hours, rul_low, rul_high, failure_mode_guess, top_contributor, sensor_fault_flag, last_5_wos[], open_alert, installed_lots[], parts_on_hand[] |
| `CHECK_SPARES(part_id, site_id)` | part, site | on_hand, reserved, available, other_sites[{site_id, available, transfer_eta_h}], pr_needed bool, supplier, lead_time_days, recommendation (RESERVE / TRANSFER / PURCHASE) |
| `PROPOSE_WINDOW(asset_id)` | asset | rul_low_ts, parts_eta_ts, repair_hours, options[{start, end, type (CHANGEOVER/LOW_LOAD/WEEKEND/ASAP), lost_good_units, oee_impact_pct, cost_inr, penalty_risk_inr, feasible bool, reason}], recommended_index |
| `WHAT_IF_DEFER(asset_id, days)` | asset, days 0–14 | curve[{day, p_fail, expected_cost_inr, oee_delta_pct}], break_even_day, recommendation |
| `AUTO_DRAFT_WORK_ORDER(asset_id)` | asset | status (DRAFTED/REFUSED/INVESTIGATE/EXISTS/THROTTLED), draft_id, failure_mode, steps[], safety[], parts[{part_id, qty, action, eta}], window, technician, cost_inr, oee_impact_pct, confidence, evidence{queries[], doc_chunks[]}, alternatives[] |
| `APPROVE_WORK_ORDER(draft_id, decision, comment)` | draft, APPROVE/REJECT | wo_id, status, approver, ts |

Window scoring: `score = lost_good_units × margin_inr + penalty_risk_inr + overtime_inr`; feasible only if
`start ≥ parts_eta` and `end ≤ rul_low_ts − 4 h safety margin`. If nothing is feasible, recommend
`CONTROLLED STOP ASAP` + expedite parts, and say why.
