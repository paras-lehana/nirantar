# RCA playbook: hypotheses and SQL patterns (adapt object names)

## Signal signatures → probable mechanism
| First signal to move | Then | Probable mechanism |
|---|---|---|
| Vibration RMS/peak (slow, then exponential) | bearing temp late | Rolling-element bearing wear / spall |
| Bearing temperature (fast) | vibration later | Lubrication loss / wrong grease / over-greasing |
| Vibration at 2× running speed, axial | — | Misalignment (often after maintenance) |
| Vibration ∝ RPM² at 1× | — | Imbalance |
| Pressure ↓ + pump current ↑ | oil temp ↑ | Internal/external hydraulic leak |
| Winding temp ↑ + current imbalance | trips | Insulation degradation |
| Spindle load ↑ + rejects ↑ (sawtooth) | — | Tool wear (process, not breakdown) |

## SQL patterns
**Supplier-lot reliability**
```sql
WITH inst AS (SELECT i.asset_id, i.part_id, i.supplier_lot, i.installed_at,
                     COALESCE(i.removed_at, CURRENT_TIMESTAMP()) AS until_ts,
                     i.removal_reason
              FROM RAW.ERP_COMPONENT_INSTALL i)
SELECT supplier_lot, COUNT(*) installs,
       COUNT_IF(removal_reason = 'FAILURE') failures,
       ROUND(AVG(DATEDIFF('hour', installed_at, until_ts)),0) avg_life_h
FROM inst GROUP BY 1 ORDER BY failures DESC;
```
**Maintenance-induced failures (≤ 7 days after PM)**
```sql
SELECT cm.asset_id, pm.wo_id pm_wo, pm.technician_id, pm.actual_end pm_done, cm.wo_id cm_wo, cm.created_at failure_ts,
       DATEDIFF('day', pm.actual_end, cm.created_at) days_after
FROM RAW.CMMS_WORK_ORDER cm JOIN RAW.CMMS_WORK_ORDER pm
  ON pm.asset_id = cm.asset_id AND pm.wo_type = 'PM' AND cm.wo_type = 'CM'
 AND cm.created_at BETWEEN pm.actual_end AND DATEADD('day', 7, pm.actual_end);
```
**Shift effect**
```sql
SELECT line_id, shift, SUM(IFF(loss_category='SMALL_STOP', minutes, 0)) small_stop_min,
       SUM(IFF(loss_category='SMALL_STOP', minutes, 0)) / NULLIF(SUM(planned_time_min),0) rate
FROM CORE.FACT_DOWNTIME d JOIN CORE.FACT_PRODUCTION_SHIFT s USING (line_id) GROUP BY 1,2;
```
**Heat effect**: join failures/trips to hourly ambient temperature per site; compare trip rate above vs below 42 °C.

**Sensor-fault check**: `STDDEV(value)` over 2 h = 0 → flat-line; value = 0 while RPM > 0 → stuck; |value − rolling
median| > 5 × MAD with correlated tags unchanged → spike.

## Fishbone template
| Bone | Evidence checked | Verdict |
|---|---|---|
| Man (people/shift) | | ✔/✖/? |
| Machine (asset condition) | | |
| Method (procedures/PM) | | |
| Material (parts/lots/suppliers) | | |
| Measurement (sensors/data) | | |
| Environment (heat/dust/utilities) | | |
