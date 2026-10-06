# Governed metric definitions

| Metric | Formula (aggregate numerators and denominators first) | Unit |
|---|---|---|
| availability | Σ run_time_min / Σ planned_time_min | ratio |
| performance | Σ (ideal_cycle_time_sec × total_count) / 60 / Σ run_time_min | ratio |
| quality | Σ good_count / Σ total_count | ratio |
| oee | availability × performance × quality (computed at the grouping level requested) | ratio |
| teep | oee × Σ planned_time_min / Σ calendar_time_min | ratio |
| unplanned_downtime_hours | Σ minutes where loss_category = 'BREAKDOWN' / 60 | h |
| downtime_cost_inr | Σ downtime minutes × line.downtime_cost_inr_per_hour / 60 | INR |
| failures_count | count(distinct WO where wo_type = 'CM' and failure_mode_id is not null) | count |
| mtbf_hours | Σ run_time_hours / failures_count | h |
| mttr_hours | Σ (actual_end − actual_start) for CM WOs / failures_count | h |
| pm_compliance_pct | PM WOs completed by due date / PM WOs due | % |
| wo_backlog_count | WOs with status in (APPROVED, SCHEDULED) older than 7 days | count |
| planned_maintenance_pct | PM+PdM labour hours / total maintenance labour hours | % |
| avg_risk_72h | avg(risk_72h) latest per asset | ratio |
| assets_at_risk | count(asset where latest risk_72h ≥ 0.6) | count |
| spare_stockout_count | critical parts with (on_hand − reserved) ≤ 0 at a site | count |
| energy_waste_kwh | Σ (actual_kwh − baseline_kwh at same output) for degraded periods | kWh |
| co2e_tonnes | energy_waste_kwh × site.grid_emission_factor_t_per_mwh / 1000 | tCO₂e |
| early_warning_lead_time_h | median(failure_ts − first_alert_ts) over detected failures (backtest) | h |

World-class reference: OEE 85 % (A 90 %, P 95 %, Q 99.9 %). Six Big Losses: BREAKDOWN, SETUP_ADJUST (availability);
SMALL_STOP, REDUCED_SPEED (performance); STARTUP_REJECT, PRODUCTION_REJECT (quality).
