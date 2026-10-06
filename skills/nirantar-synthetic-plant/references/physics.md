# Signal physics for believable synthetic telemetry

## Healthy baselines
| Measure | Unit | Healthy behaviour |
|---|---|---|
| VIB_RMS (velocity) | mm/s | ISO class I 0.7–1.8 · II 1.1–2.8 · III 1.8–4.5 · IV 2.8–7.1; noise σ ≈ 5 % |
| VIB_PEAK | mm/s | ≈ 1.4–1.6 × RMS when healthy; crest factor rises with bearing defects |
| BEARING_TEMP | °C | ambient + 20–35 °C under load; lags load by ~20 min |
| OIL_TEMP / WINDING_TEMP | °C | 45–70 / 60–95 (class F insulation trip ≈ 140) |
| RPM | rpm | setpoint ± 0.5 % while RUN; 0 when DOWN/IDLE; ramps 30–90 s on start |
| MOTOR_CURRENT | A | ∝ load (± 3 %); three-phase imbalance < 2 % healthy |
| PRESSURE (hydraulic) | bar | 140–210 working; drop < 3 % over shift healthy |
| LOAD_PCT (spindle) | % | 35–75 % by operation; tool wear adds +0.5–1 %/hour until tool change |
| POWER_KW | kW | load × rated; degraded assets draw +6–9 % for the same output |

Add a daily ambient cycle (sine, amplitude: Pune 4 °C, Chennai 3 °C, Chittorgarh 7 °C; peak 15:00 IST) and a shift load
pattern (A 100 %, B 95 %, C 85 %; lunch dips).

## ISO 10816 / 20816 zones (velocity RMS, mm/s)
| Class | A/B | B/C (alarm) | C/D (trip) |
|---|---|---|---|
| I (small < 15 kW) | 0.71 | 1.8 | 4.5 |
| II (medium 15–75 kW) | 1.12 | 2.8 | 7.1 |
| III (large, rigid) | 1.8 | 4.5 | 11.2 |
| IV (large, flexible) | 2.8 | 7.1 | 18.0 |
Set `alarm_high` = B/C boundary and `trip_high` = C/D boundary on vibration tags.

## Degradation episodes (onset → P → F)
Severity `s(t) = ((t − onset)/(F − onset))^k`, k = 1 for linear modes, k = 2.5–3 for bearing wear (slow, then exponential).
| Mode | Leading signal | Secondary (delay) | P–F (days) | Down time at F (h) |
|---|---|---|---|---|
| Bearing wear | VIB_RMS × (1 + 2.5 s), VIB_PEAK × (1 + 4 s) | BEARING_TEMP + 15 s °C (after 60 %) | 5–14 | 6–12 |
| Lubrication loss | BEARING_TEMP + 30 s °C | VIB × (1 + 0.8 s) (after 50 %) | 1–3 | 4–8 |
| Misalignment | VIB × (1 + 1.5 s) step at onset | temp + 5 s | 7–20 | 3–6 |
| Imbalance | VIB × (1 + s·(rpm/rated)²) | — | 10–30 | 2–4 |
| Hydraulic leak | PRESSURE × (1 − 0.12 s); pump current + 10 s % | OIL_TEMP + 12 s | 3–10 | 4–10 |
| Winding insulation | WINDING_TEMP + 25 s; imbalance + 6 s % | random trips last 10 % | 7–21 | 8–14 |
| Tool wear (cyclic) | LOAD_PCT sawtooth; rejects ↑ when LOAD > 85 % | POWER + 5 % | 1–2 | 0.5 (tool change) |
| Cavitation | PRESSURE noise σ × 4; VIB_PEAK × (1 + 2 s) | flow − 10 s % | 2–8 | 3–6 |
| Mill liner/gear wear | VIB × (1 + s); current + 8 s % at same tph | bearing temp + 8 s | 10–30 | 10–24 |

At F: state DOWN, reason BREAKDOWN, CM work order (failure mode, cause/action text, parts with supplier_lot, labour 1.5–2 ×
repair hours), component install closed and a new one opened (new lot). After repair: signals return to baseline ± 10 %.

## Sensor faults (must NOT look like machine failures)
- Flat-line: identical value ≥ 2 h (σ = 0) while correlated tags vary.
- Stuck-at-zero: 0 while RPM/current show RUN.
- Spike: one sample 5–10 × median; neighbours normal.
- Dropout: missing samples 15–120 min (quality = 'STALE' around edges).
Rate ≈ 1 % of tags over the history; label `_fault_type`.
