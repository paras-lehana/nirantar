# 03 — Domain research: Predictive Maintenance & OEE Command Center

> Researched 2026-10-03 for the Snowflake CoCo CLI Hackathon 2026 (GCC Edition), problem #03. Citations are `[S#]` (see Sources). **Derived** = our arithmetic on cited inputs. **Synthetic default** = a generator parameter we chose; calibrate before relying on it. ₹1 lakh = ₹100,000.

## Pitch numbers

> **The 10 strongest citable stats**
> 1. **$1.4 trillion/yr**: unplanned downtime costs the Fortune Global 500 **11% of revenue** [S1].
> 2. **$2.3 M per hour** (>$600/s) on a large automotive line, 2× 2019; heavy-industry hourly cost is **4× 2019** [S1]. 2021–22: heavy industry **$434k/h**, oil & gas **$458k/h** [S2].
> 3. A large plant still loses **27 h/month in 25 incidents**; recovery now takes **81 min vs 49 min in 2019** (skills loss, slow spares) [S1].
> 4. **88% of Indian industrial firms** have unplanned outages at least monthly (69% globally), at **~₹70 lakh (INR 7 M) per hour**; 19% still run to failure [S4].
> 5. Preventive/predictive-led plants have **52.7% less unplanned downtime and 78.5% fewer defects** than reactive plants [S7].
> 6. PdM cuts machine downtime **30–50%** and extends machine life **20–40%** [S9].
> 7. PdM: **−70–75% breakdowns, −35–45% downtime, −25–30% maintenance cost, ~10× ROI** (US DOE) [S10]; Deloitte: **+25% productivity, −70% breakdowns, −25% maintenance cost** [S11].
> 8. Live deployments: **−50% unplanned downtime, −40% maintenance cost, +55% maintenance-staff productivity**, payback ~3 months [S1].
> 9. **World-class OEE is 85%; most plants run near 60%**, losing ~40% of planned time [S12].
> 10. India: **~690–700 MTPA cement capacity, world #2** [S14][S15]; **2,117 GCCs, 2.36 M people, $98.4 B revenue (FY26)** [S18]. Reliability engineering for global plants increasingly runs from India.

---

## 1. Problem statistics (2022–2026)

### 1.1 Cost of unplanned downtime

| Sector | $/h 2021–22 [S2] | $/h 2023 [S1] | Annual loss per large plant |
|---|---|---|---|
| Automotive | $2.0 M | **$2.3 M** (2× 2019) | $646 M (2022) → $695 M (2024) |
| FMCG | $39k | **$36k** (flat vs 2019) | ~$10 M |
| Heavy industry | $434k | **4× 2019** (chart only) | $128 M (2022); $59 M (2024 sample) |
| Oil & gas | $458k | fell with 2023 oil price; 2022 a record | $149 M (2022) |
| All four sectors | — | ~2× 2019 | **$253 M** (2024) |

Samples change each year (2024 edition: 181 respondents, Apr 2019–Mar 2023), so year-on-year comparisons are indicative [S1].

**Other benchmarks**
- **ABB 2023** (3,215 respondents): typical outage ~**$125k/h** (~$1 M per 8-h shift); 69% have monthly outages; 21% run to failure [S3]. **India:** 88% monthly; INR 7 M/h vs INR 10.3 M globally [S4].
- **ABB 2025** (3,600 leaders): 44% have equipment interruptions monthly, 14% weekly; most estimate $10k–500k/h [S5].
- **Fluke, Oct 2025** (600; US/UK/DE): 61% had unplanned downtime last year; average **$1.7 M/h**; 45% of outages last up to 12 h [S6].
- **NIST (US manufacturing):** maintenance costs + losses **$222.0 B/yr** [S7]. 2016: $57.3 B spend + $119.1 B preventable losses (downtime $18.1 B, defects $0.8 B, lost sales $100.2 B); the most reactive quartile had **3.3× the downtime and 16× the defects** [S8].
- **Cost share:** maintenance is **15–60% of cost of goods** by industry [S13]; poor strategy cuts plant capacity **5–20%** [S11]. Even a good large plant loses 326 h/yr, ~3.7% of calendar time (derived) [S1].

### 1.2 What PdM delivers

| Source | Downtime | Breakdowns | Maint. cost | Other |
|---|---|---|---|---|
| McKinsey 2017 [S9] | −30–50% | – | – | machine life +20–40% |
| US DOE/PNNL 2010 [S10] | −35–45% | −70–75% | −25–30% | production +20–25%; ROI ~10× |
| Deloitte 2017 [S11] | uptime +10–20% | −70% | −25% (internal: −5–10%) | productivity +25%; planning time −20–50%; MRO spend −5–10% |
| NIST 2021 [S7] | −52.7% (PM/PdM vs reactive); a further −18.5% (PdM vs PM) | – | – | defects −78.5% / −87.3% |
| Siemens Senseye clients 2024 [S1] | −50% unplanned | – | −40% | staff productivity +55%; forecast accuracy +85%; ≤40% fewer replacement parts |

**MTBF uplift (derived):** 70% fewer breakdowns → failure rate ×0.3 → MTBF ~3× for modes with a detectable P-F interval. Show ×1.5–3 in the demo; never claim it for random failures.

### 1.3 OEE reality
World-class 85% = 90% availability × 95% performance × 99.9% quality, a 1970s–80s Japanese automotive TPM benchmark (Nakajima). Most plants run near 60%; 40% is common when tracking starts [S12].

### 1.4 India and GCC context
- **Manufacturing:** 17.2% of GVA (FY25, old series); 16.3% (FY26, new series) vs a 25% ambition, so gains must come from productivity [S20].
- **Cement (context for CHITTOR-CEMENT):** ~690 MTPA; 453 Mt (FY25) → 491.4 Mt (FY26, +8.6%); 160 integrated plants, 130 grinding units, 62 mini plants; 290 kg/capita vs 540 kg globally [S14][S15].
- **Energy:** 73.75 kWh/t cement average (2023; 88 in 2014) vs ~56 best; 725 vs 675 kcal/kg clinker [S16]. Degraded fans, mills and compressors show up in kWh/t.
- **Carbon:** grid **0.675 tCO₂/MWh** (FY2025-26, CEA v22.0, Aug 2026) [S17].
- **Kiln-hour value (derived):** 10,000 tpd = 417 t clinker/h ≈ 580 t cement (0.72 clinker factor) ≈ **₹29 lakh (~$34k) sales per hour** at ₹5,000/t, before restart fuel and refractory shock.
- **GCCs:** 2,117 centres, 2.36 M staff, $98.4 B (FY26) [S18]; ER&D GCCs $36.4 B (FY24) [S19]; Avathon tripling its India headcount [S21]. **Pitch:** an Indian GCC runs a *remote reliability centre* for a global fleet on one governed Snowflake data plane.

---

## 2. Domain model and ontology

### 2.1 Standards we encode

| Standard | Essentials | In our model |
|---|---|---|
| **ISA-95 / IEC 62264** [S22][S23] | Levels: L0 sensors → L1 PLC/DCS → L2 SCADA/historian → L3 MOM (MES, CMMS, LIMS) → L4 ERP. Roles: Enterprise › Site › Area › Work Center (Process Cell \| Production Unit \| Production Line \| Storage Zone) › Work Unit; ISA-88 adds Equipment/Control Module. **Part 2** splits role-based *equipment* from the serialized *physical asset*, mapped over time. **Part 3**: production, maintenance, quality and inventory MOM. | Roles: `site`, `area`, `work_center`, `functional_location`. Serials: `asset`. Mapping: `asset_installation(valid_from, valid_to)` |
| **ISO 14224:2016** [S24] | 9 levels: industry, business category, installation, plant/unit, section/system, **equipment unit (6)**, **subunit (7)**, **maintainable item (8)**, part (9). Failure = **mode + mechanism + cause**. | `asset_class`, `subunit`, `component`, `spare_part` |
| **ISO 13374 / MIMOSA OSA-CBM** [S25] | Data Acquisition → Data Manipulation → State Detection → Health Assessment → Prognostic Assessment → Advisory Generation | `reading` → `feature_window` → `alarm` → `health_score` → `prediction` → work-order draft |
| **ISO 10816-3 → 20816-3:2022** [S26] | Broadband RMS velocity, 10–1,000 Hz. Zones: A new, B fine long-term, C limited run, D damage likely. 20816-3 replaced 10816-3 and 7919-3 and kept the zones. | alarm = B/C, trip = C/D |
| **P-F curve** (Moubray, RCM II) [S27] | Detected in order: oil/ultrasound → vibration → thermography → noise/heat. Vibration can lead by 12–18 months. Inspect at ≤½ the P-F interval. | `failure_mode.pf_days`; lead-time KPI |
| **FMEA** [S28] | RPN = S × O × D (each 1–10). AIAG-VDA 2019 replaced it with severity-first **Action Priority** (H/M/L). | `fmea_row` → alert priority |
| **RCM, SAE JA1011** [S29] | 7 questions: functions, functional failures, modes, effects, consequences, proactive tasks, default actions | Strategy per mode: run-to-failure, time-based, condition-based or redesign |

**ISO 14224 code lists to seed [S24]**
- **Modes (rotating):**
  - Start/stop: FTS, STP, UST (spurious stop).
  - Damage: BRD (breakdown), STD (structural).
  - Symptoms: VIB, OHE (overheating), NOI (noise).
  - Leaks: ELP/ELU (external, process/utility), INL (internal).
  - Output: LOO/HIO (low/high), ERO (erratic), PDE (parameter deviation).
  - Other: PLU (plugged), SER (minor in-service), AIR (abnormal instrument reading).
- **Mechanisms:**
  - 1 Mechanical: 1.1 leakage, 1.2 vibration, 1.3 clearance/alignment, 1.4 deformation, 1.5 looseness, 1.6 sticking.
  - 2 Material: 2.1 cavitation, 2.2 corrosion, 2.3 erosion, 2.4 wear, 2.5 breakage, 2.6 fatigue, 2.7 overheating, 2.8 burst.
  - 3 Instrument.
  - 4 Electrical: short, open circuit, power, earth fault.
  - 5 External: blockage, contamination.
  - 6 Miscellaneous.
- **Causes:**
  - Design.
  - Fabrication/installation.
  - Operation/maintenance: off-design service, operating error, **maintenance error**, expected wear.
  - Management.
  - Miscellaneous.

**Vibration zone boundaries, mm/s RMS [S26]**

| Machine | A/B | B/C (alarm) | C/D (trip) |
|---|---|---|---|
| 10816-1 Class I (≤15 kW) | 0.71 | 1.8 | 4.5 |
| Class II (15–75 kW) | 1.12 | 2.8 | 7.1 |
| Class III (large, rigid) | 1.8 | 4.5 | 11.2 |
| Class IV (large, soft) | 2.8 | 7.1 | 18 |
| 20816-3 Group 2 (15–300 kW), rigid / flexible | 1.4 / 2.3 | 2.8 / 4.5 | 4.5 / 7.1 |
| 20816-3 Group 1 (>300 kW), rigid / flexible | 2.3 / 3.5 | 4.5 / 7.1 | 7.1 / 11.0 |

### 2.2 Entities to implement

| Entity | Key columns | Links | Source |
|---|---|---|---|
| **Hierarchy & assets** | | | |
| `site`, `area`, `work_center` | area type (crusher, raw mill, kiln, coal mill, cement mill, packing, utilities); ISA-95 type; ideal rate; grid factor | site 1─* area 1─* work_center | ERP/MES |
| `functional_location` | parent, criticality A/B/C, safety flag | → work_center | SAP FLOC / Maximo LOCATION |
| `asset` | serial, ISO 14224 class, make/model, kW, rpm, commissioned date, RAV ₹, warranty end | → supplier, cost_center | SAP Equipment / Maximo ASSET |
| `asset_installation` | asset, floc, valid_from/to, reason | ISA-95 equipment↔asset | install/dismantle history |
| `component` | subunit + item (DE/NDE bearing, seal, impeller, coupling, winding, gear stage, belt); geometry n, d, D, φ, teeth | → asset; derives BPFO/BPFI/BSF/FTF/GMF | engineering data |
| `bom_item` | asset class/asset, part, qty | asset *─* spare_part | equipment BOM |
| **OT (L0–L2)** | | | |
| `tag` | measurand, unit, sample period, source (PLC/SCADA/IIoT), alarm_hi, trip | → component | historian |
| `reading` | tag, ts, value, quality | narrow time series | historian |
| `feature_window` | RMS, peak, crest, kurtosis, 1×/2×, BPFO/BPFI band, GMF sidebands, ultrasound dB | → tag | derived |
| `spectrum_snapshot` | tag, ts, sample rate, FFT bins (ARRAY) | → tag | edge/derived |
| `machine_state` | start, end, state (RUN/IDLE/STOP/FAULT/SETUP/STARVED/BLOCKED), speed | → asset | PLC/SCADA |
| `alarm` | raised/cleared/acked, priority, code, chattering flag | → tag; 0..1 → notification | SCADA (ISA-18.2) |
| `energy_reading` | kWh, kW, power factor | → asset/area | EMS/MCC |
| **Reliability & AI** | | | |
| `failure_mode` | ISO mode/mechanism, component type, pf_days, detecting measurands, Weibull β/η | → asset_class | RCM library |
| `fmea_row` | effect, S, O, D, RPN, AP | → failure_mode | RCM |
| `health_score`, `prediction` | health 0–100 + top contributors; p_fail 7d/30d, RUL P10/P50/P90, model version, explanation | → asset, failure_mode | analytics |
| `failure_event` | detected/failure ts, mode, mechanism, cause, was_predicted, lead time | → asset, component, notification | MTBF ground truth |
| **Maintenance (CMMS, L3)** | | | |
| `notification` | M1/M2/M3; origin (operator/AI/route); breakdown flag; malfunction start/end; object-part/damage/cause codes | → asset/floc; 1 → 0..1 work_order | SAP notification / Maximo SR |
| `work_order` | PM01/PM02/PM03; status CRTD→REL→TECO→CLSD; priority; planned/actual dates; craft; est/actual h & ₹; failure class/problem/cause/remedy; needs_shutdown | → notification, cost_center, maintenance_plan | SAP order / Maximo WO |
| `wo_operation`, `wo_material`, `labor_entry` | task, craft, std h, LOTO; part, qty reserved/issued; technician, start, end | → work_order, spare_part, technician | confirmations |
| `maintenance_plan` | strategy (time/counter/condition), interval, tolerance, last/next due, task list | → asset | SAP plan / Maximo PM |
| `technician`, `shift` | craft, skill, ISO 18436 cert, ₹/h; shift A/B/C, crew, supervisor | labour must fall inside a shift | HR/CMMS |
| **ERP (L4)** | | | |
| `spare_part`, `inventory` | unit cost, lead time, reorder point, criticality, interchangeables; storeroom, on hand, reserved, on order | → supplier | SAP MM / Maximo ITEM |
| `purchase_order`, `supplier`, `warranty_claim` | ordered/promised/received, price; OTIF, warranty months; failure, lot, amount | → part, failure_event | SAP MM |
| `cost_center`, `cost_posting` | area; WO, element (labour/material/external/energy), ₹ | → work_order | SAP CO |
| **Production, quality, knowledge** | | | |
| `product`, `production_order` | SKU (OPC 53, PPC, PSC; 50 kg bag); planned qty, window, actual, status | → work_center | SAP PP / MES |
| `production_count` | interval, total, good, ideal cycle time | → work_center | MES |
| `downtime_event` | start/end, planned flag, reason L1 (Six Big Losses) › L2 › L3, lost units, ₹ | → asset, work_order | MES |
| `quality_result` | Blaine, residue, 28-day strength, free lime, rejects, defect code | → work_center, lot | LIMS |
| `document`, `rca` | manual/SOP/RCA chunks; 5-Why, Ishikawa 6M, root cause, CAPA | → asset_class, failure_event | DMS (Cortex Search) |

### 2.3 Mapping to SAP PM and IBM Maximo

| Concept | SAP PM/MM/CO (S/4HANA) [S30] | IBM Maximo [S31] |
|---|---|---|
| Role location | Functional location (structure indicator) | LOCATIONS hierarchy |
| Physical asset | Equipment (serial, ABC indicator) installed at a FLOC | ASSET + move history |
| Request / failure report | **M1** maintenance request; **M2** malfunction report (breakdown flag; malfunction start/end feed MTTR/MTBR in PMIS MCI7/MCJB/MCJC); **M3** activity report | Service Request; failure reporting on WO |
| Failure coding | Catalogs: B object part, C damage, 5 cause, A activity, 2 tasks | Failure class → Problem → Cause → Remedy |
| Work order | Customer-configured. Usual convention: **PM01** corrective, **PM02** preventive (from maintenance plans), **PM03** inspection/predictive; standard PM04 refurbishment, PM05 calibration. Status CRTD → REL → TECO → CLSD; settles to a cost center. | Work types CM/PM/EM/CP/EV; status WAPPR → APPR → INPRG → COMP → CLOSE |
| Planning | Maintenance plan (time/performance/strategy) + task list; measuring points and documents | PM + job plan; meter/measure-point action limits auto-create WOs |
| Spares & cost | Material master, reservation, PR → PO, storage-location stock; CO cost centers, activity rates | ITEM, INVENTORY, storerooms, PR/PO, GL accounts |
| AI layer (2025–26) | SAP APM anomaly detection; Joule **Maintenance Planner Agent** [S71] | MAS 9.1 Monitor/Health/Predict + Maximo Assistant (watsonx) [S70] |

---

## 3. Physics of failure signals, for the generator

### 3.1 Kinematics and rules of thumb
- **Bearing defect frequencies.** With `fr = rpm/60`:
  - **BPFO = (n/2)·fr·(1 − (d/D)·cosφ)**
  - **BPFI = (n/2)·fr·(1 + (d/D)·cosφ)**
  - **BSF = (D/2d)·fr·(1 − ((d/D)·cosφ)²)**
  - **FTF = (fr/2)·(1 − (d/D)·cosφ)**

  SKF 6205 (CWRU): BPFI 5.4152×, BPFO 3.5848×, FTF 0.39828×, 2×BSF 4.7135× running speed [S32]. At 1,485 rpm: BPFO 88.7 Hz, BPFI 134.0 Hz, FTF 9.9 Hz (derived).
- **Bearing stages** [S33]:
  1. Ultrasonic only (20–60 kHz).
  2. Natural-frequency ringing at 500–2,000 Hz, with sidebands.
  3. Defect frequencies and harmonics: replace the bearing.
  4. Broadband noise floor: failure is imminent.
- **Time-domain features:** kurtosis is ~3 when healthy and ≥6–10 once spalls form, then falls as damage spreads. Crest factor rises early, then drops as RMS grows [S45].
- **Ultrasound** above baseline [S39]:
  - +8 dB: lubrication lacking.
  - +12 dB: failure onset.
  - +16 dB: advanced.
  - +35–50 dB: catastrophic.
- **Spectral patterns** [S34]:
  - Imbalance: 1× radial/tangential, not axial.
  - Misalignment: 1× axial plus 2× radial.
  - Looseness: many 1× harmonics.
- **Gears:** GMF = teeth × shaft Hz. Wear raises GMF, 2× and 3× GMF, with ±1× sidebands of the worn gear's shaft [S44].
- **Motor current (MCSA):**
  - Bearing faults show at |f_s ± m·f_v| [S35].
  - Broken rotor bars show as f_s(1 ± 2ks) sidebands.
  - 1% voltage unbalance gives 6–10% current unbalance; derate above 1% [S36].
- **Thermal:**
  - Insulation life halves per +10 °C above the class hot-spot limit (B 130, F 155, H 180 °C) [S38].
  - Bearings typically run at 40–70 °C; above 70 °C grease life falls ~1.5× per +10 °C [S37].
  - Belt life halves per +19 °F (~10.5 °C) [S40].
- **Pumps:** NPSHr is defined at a 3% head drop. Cavitation shows as broadband 2–20 kHz vibration, gravel-like noise, and falling head and flow [S41].
- **Belts:** drive efficiency drops from ~97% to ~92% at 4% slip and ~80% at 8% [S40].
- **Compressed air:** leaks often waste **20–30% of compressor output** [S46].

### 3.2 Degradation recipe

**1. Time to failure.** Draw T_F ~ Weibull(β, η) per component, using Barringer typical values [S42]. Scale η down 3–10× so failures land inside an 18-month window (synthetic default).

| Component | β | η (h) |
|---|---|---|
| Ball bearing | 1.3 | 40k |
| Roller bearing | 1.3 | 50k |
| Mechanical seal | 1.4 | 25k |
| Centrifugal pump | 1.2 | 35k |
| AC motor | 1.2 | 100k |
| Gears | 2.0 | 75k |
| Coupling | 2.0 | 75k |
| Drive belt | 1.2 | 30k |
| Centrifugal compressor | 1.9 | 60k |
| Grease | 1.1 | 10k |

**2. Onset.** t_P = T_F − PF, with PF ~ U(pf_min, pf_max) for the failure mode.

**3. Health index.** H(τ) = 1 − (e^{kτ} − 1)/(e^{k} − 1), with τ = (t − t_P)/PF and k ∈ [3, 5]: flat at first, then an exponential rise. IMS run-to-failure tests show this shape over ~7–35 days [S49].

**4. Signal.** x = base·load(t) + A·(1 − H) + AR(1) noise + spikes, with 0.1–1% sensor dropouts.

**5. Repair.** A repair resets H to 1. With 3–5% probability, inject a maintenance-induced defect: a misalignment step or an over-greasing temperature spike.

### 3.3 Failure-mode signatures (P-F windows are synthetic defaults)

| Mode | Evidence, earliest → latest | P-F | Trajectory |
|---|---|---|---|
| **Bearing wear** | ultrasound/envelope gE, kurtosis → BPFO/BPFI harmonics → velocity 1.5 → >4.5 mm/s → temperature +5–15 °C | 2–8 weeks | flat, then exponential over the last 10–20%; kurtosis peaks then falls |
| **Misalignment** | 1× axial and 2× radial ↑; coupling/bearing temp +5–10 °C; current +1–3% | weeks | step after coupling or motor work, then slow drift (maintenance-induced) |
| **Imbalance** | 1× radial ↑, phase-stable; amplitude ∝ speed² | days (ID-fan dust) to months | sawtooth: builds up, resets on blade cleaning |
| **Lubrication failure** | ultrasound +8 dB, high-frequency acceleration ↑, temp +5–20 °C; over-greasing gives +10–20 °C for hours | days–weeks | sawtooth with relube interval; untreated → bearing wear |
| **Pump cavitation** | suction pressure ↓ (strainer ΔP ↑), 2–20 kHz broadband ↑, discharge variance ↑, head/flow ↓ ≥3%, current flicker | hour–day episodes; erosion over weeks | intermittent, tied to tank level or strainer ΔP |
| **Belt slippage** | driven rpm ↓ (slip 1–2% → 4–8%), belt temp ↑, current ↓/erratic, sub-synchronous belt peaks | 1–4 weeks | gradual tension loss, squeal events |
| **Winding overheating → insulation failure** | RTD +10–30 °C (blocked cooling, overload, voltage unbalance) → current unbalance ↑ → turn-to-turn short | weeks; final short in minutes–hours | creep, then abrupt trip |
| **Gear wear / pitting** | oil ferrous ppm ↑ → GMF harmonics and ±1× sidebands ↑ → oil temp +5–10 °C | 1–6 months | slow monotone rise |
| **Cement VRM vibration** | feed swings, bed ΔP, lost N₂ accumulator pre-charge, roller/table wear, tramp metal, gas flow [S43] | hours–days | process-driven spikes, trips |
| **Kiln shell hot spot** | scanner zone above the 200–350 °C norm, local ΔT >50 °C → refractory loss | days–weeks | local ramp, forced stop |

FLSmidth's VRM cause list (Oct 2025) doubles as an RCA tree [S43]. The kiln ranges come from vendor guidance, so mark them synthetic.

### 3.4 Healthy ranges by asset class (synthetic defaults)

**Plant model.** Use the three sites of the synthetic Indus Group:
- **PUNE-MACH:** machining; the hero asset is VMC-204, a spindle bearing failure.
- **CHENNAI-FORGE:** forging and presses.
- **CHITTOR-CEMENT:** ball mill, packing and compressors.

The cement rows below only add depth to CHITTOR. Don't scale up to a full kiln plant.

**Grid emission factor.** `data-model.md` uses 0.71. The latest CEA figure is **0.675 tCO₂/MWh for FY2025-26** (v22.0, Aug 2026) [S17].

**VMC spindle defaults.** These are synthetic; no source was found for spindle vibration limits.
- **Bearing set:** angular-contact 7014 (bore 70 mm, OD 110 mm). Assume n = 19 balls, d = 12.7 mm, D = 90 mm, φ = 15°.
- **Fault frequencies:** BPFO ≈ 8.21×, BPFI ≈ 10.80×, FTF ≈ 0.432×, BSF ≈ 3.48× shaft speed. At 8,000 rpm that puts BPFO ≈ 1,094 Hz and BPFI ≈ 1,439 Hz (derived from §3.1).
- **Tool holders:** balance grade is usually G2.5 (ISO 1940/21940) [S80]. Unbalanced holders add 1× vibration.
- **Common causes:** coolant ingress past the seals, oil-air or grease starvation, crash/overload brinelling, preload loss from heat.
- **Healthy readings:** housing 25–45 °C; vibration 0.3–1.2 mm/s.
- **Alarm / trip:** housing ≥55 / 65 °C; vibration 1.8 / 2.8 mm/s, the tighter Class I zone limits.

**Data volume.** Store 5–15-minute history plus a 1-minute live tick, as `data-model.md` specifies. Raw waveforms are only needed around the hero event.

| Asset class | Key tags | Healthy | Alarm / trip |
|---|---|---|---|
| VMC / CNC spindle (8–15k rpm) | spindle vibration (mm/s, g), housing temperature, load %, motor current, coolant pressure | 0.3–1.2 mm/s; 25–45 °C; load 20–70% | 1.8 / 2.8 mm/s; 55 / 65 °C |
| LV induction motor (37–315 kW, 1,485 rpm) | vibration, DE/NDE temp, winding RTD, 3-φ current | 0.5–2.0 mm/s; 40–70 °C; 70–110 °C; 60–90% FLA, unbalance <2% | 2.8/4.5 mm/s; 85/95 °C; 130/145 °C |
| Centrifugal pump (2,960 rpm) | suction/discharge bar, flow, vibration, bearing temp, strainer ΔP | 1–2.8 mm/s; 45–70 °C | Group 2 zones |
| Screw/recip compressor | discharge 7–10 bar, oil temp, current state, load % | oil 60–90 °C; load 40–80%; MetroPT ~0/4/7 A off/unloaded/loaded [S54] | oil 100 °C |
| Gearbox | oil temp, vibration, GMF band, ferrous ppm | 50–80 °C; 1–4.5 mm/s | +10 °C over baseline; ppm ×2 |
| ID/cooler fan (0.6–3 MW) | vibration, bearing temp, damper %, gas temp | 1.5–3.5 mm/s (Group 1) | 7.1/11 mm/s |
| Conveyor / bucket elevator | speed, slip %, current, idler temp | slip <2% | 4%/8% |
| VRM / ball mill | mill vibration, ΔP, grinding pressure, kW, trunnion temp | plant-specific; trunnion 50–70 °C | OEM trip |
| Rotary kiln (reference only) | shell scanner, drive current, tyre/roller bearing temp | shell 200–350 °C | >400 °C local |

The AI4I rules [S48] can drive extra CNC tool-wear failures.

### 3.5 IT/OT consistency rules
1. Every `failure_event` has degradation on ≥2 mapped tags starting PF earlier; 10–20% are random and undetectable.
2. Alarms cross B/C, then C/D, and `machine_state` goes to FAULT at failure.
3. An M2 breakdown notification follows within 0–15 min, and a PM01 is released within 1 h.
4. Parts come from the BOM and decrement inventory; a PO is raised below reorder point, with the supplier's lead time.
5. Labour is booked by on-shift technicians of the right craft.
6. A `downtime_event` zeroes `production_count`. MTTR is lognormal: median 2–4 h for motors/pumps, 12–24 h for gearboxes, 5–7 days for refractory. Costs post to the cost centre.
7. A predicted event becomes an AI-origin notification, then a WO planned into a production gap, and no failure occurs.
8. PM02 compliance is 80–90%; late or skipped PMs raise the hazard ×1.2–2.
9. Degradation adds 2–8% to kW and drifts quality: Blaine/residue variance, burst bags.
10. 20–30% of WOs carry free-text-only failure codes, so the AI has something to back-fill.

---

## 4. OEE and maintenance KPIs

**Definitions [S12]**
- Planned Production Time (PPT) = shift − breaks.
- Run Time = PPT − stops.
- Availability = Run Time / PPT.
- Performance = (Ideal Cycle Time × Total Count) / Run Time.
- Quality = Good / Total.
- **OEE = A × P × Q = (Good × Ideal Cycle Time) / PPT.**
- **TEEP = OEE × Utilization**, where Utilization = PPT / all time (24×7).

| Six Big Losses | Factor | Cement example | Data |
|---|---|---|---|
| Equipment failure (unplanned stop) | A | bucket-elevator gearbox seizes | `downtime_event` + WO |
| Setup & adjustment (planned stop) | A | bag-type changeover, PM | production order |
| Idling & minor stops (<5 min) | P | spout jams, bag misfeeds | `machine_state` |
| Reduced speed | P | mill fed below rated tph due to a vibration limit | `production_count` vs rate |
| Process defects | Q | burst/under-weight bags, off-spec Blaine | `quality_result` |
| Reduced yield (startup) | Q | off-spec after a restart | `quality_result` |

**Reliability:** MTBF = operating h / failures (repairable); MTTF is the same for non-repairables; MTTR = repair h / repairs; inherent availability = MTBF / (MTBF + MTTR).

| Maintenance KPI | Formula | Commonly cited target |
|---|---|---|
| PM compliance | PMs done in window / PMs due | ≥90% |
| Planned work % | planned-job hours / total hours | ≥80–90% |
| Reactive work % | breakdown + emergency hours / total | 5–15% (Blache, UTK) |
| Schedule compliance | scheduled hours done as scheduled / scheduled hours | 80–90%+ |
| Ready backlog | ready hours / weekly crew capacity | 2–4 weeks |
| Wrench time | hands-on time / paid time | typical 25–35%; best ~55% (Palmer) |
| Maintenance cost / RAV | annual cost / replacement asset value | 2–3% world-class; 3–5% average |
| PdM lead time (ours) | failure_ts − first detection | ≥½ P-F; ≥7 days on critical assets |

Public versions of these benchmarks rarely trace back to SMRP primary data, so present them as "commonly cited" [S79].

**Worked example: 8-spout rotary packer, one shift**

Inputs:
- PPT = 480 min − 30 min break = 450 min.
- Stops = 72 min: a 45-min bucket-elevator bearing failure plus a 27-min PPC→OPC changeover. Run time = 378 min.
- Ideal rate 2,400 bags/h, so ideal cycle time = 0.025 min.
- Total 12,600 bags; 380 rejects; good = 12,220.

| Factor | Calculation | Result |
|---|---|---|
| Availability | 378 / 450 | **84.0%** |
| Performance | 0.025 × 12,600 / 378 = 315 / 378 | **83.3%** |
| Quality | 12,220 / 12,600 | **97.0%** |
| **OEE** | 0.840 × 0.833 × 0.970 (check: 12,220 × 0.025 / 450) | **67.9%** |

- **Loss time:** availability 72 + performance 63 + quality 9.5 + fully productive 305.5 = 450 min.
- **TEEP**, running 3 shifts × 7 days: 67.9% × 1,350/1,440 = **63.6%**.
- **Cost of the failure:** 1,800 bags (90 t), **~₹4.5 lakh revenue at risk** at ₹5,000/t.
- **Month:** 640 run-h, 6 failures and 7.2 repair-h give MTBF 106.7 h, MTTR 1.2 h, inherent availability 98.9%.

---

## 5. Public datasets for calibration (all generation happens inside Snowflake)

| Dataset | Size / fields | License | What we borrow |
|---|---|---|---|
| **Microsoft Azure PdM** [S47] | 100 machines, hourly through 2015: telemetry 876,100 rows (volt, rotate, pressure, vibration); errors (error1–5); maintenance (comp1–4); 761 failures; machines (model1–4, age) | MS sample mirrored on Kaggle; license not stated | 5-table IT/OT shape; errors before failures; means ≈170 V, 447 rpm, 101, 40 |
| **AI4I 2020** (UCI) [S48] | 10,000 rows × 14: air/process temp (K), rpm, torque (Nm), tool wear (min), 5 failure modes (TWF/HDF/PWF/OSF/RNF); 339 failures | CC BY 4.0 | Rule template: HDF when ΔT < 8.6 K and rpm < 1,380; PWF when power is outside 3.5–9 kW; OSF when wear × torque > 11–13k min·Nm |
| **NASA C-MAPSS** [S49] | FD001–FD004: 100/260/100/249 training engines; 3 settings + 21 sensors; run to failure | NASA open data | RUL labels; multi-regime normalization |
| **IMS bearings** [S49] | 4 Rexnord ZA-2115 bearings, 2,000 rpm, 6,000 lb, 20 kHz, 1-s snapshot every 10 min; 3 tests (2,156/984/4,448 files) ending in inner/outer race and roller failures | free with citation | Natural degradation curves over days |
| **CWRU** [S32] | seeded EDM faults 7–40 mils; 12/48 kHz; 0–3 HP; 1,797–1,720 rpm; drive and fan end | free with citation | Spectral templates; defect-frequency multipliers |
| **FEMTO/PRONOSTIA** (PHM 2012) [S50] | 17 bearings (6 train, 11 test); 1,800 rpm/4 kN, 1,650/4.2 kN, 1,500/5 kN; 25.6 kHz, 0.1 s every 10 s; temperature | research with citation | Accelerated RUL shapes and scoring |
| **MIMII / MIMII DUE** (Hitachi) [S51] | 10-s, 16 kHz, 8-ch clips: valves, pumps, fans, slide rails; SNR +6/0/−6 dB; 100 GB. DUE adds gearboxes and domain shift | CC BY-SA 4.0 / DUE CC BY-NC-SA 4.0 | 2–3 clips for a spectrogram demo; anomaly-score ranges |
| **Kaggle pump sensor** [S52] | 220,320 rows at 1-min, 52 sensors, Apr–Aug 2018; 7 BROKEN events + RECOVERING periods | not stated | Failure frequency, recovery durations, missingness |
| **MetroPT-3 / MetroPT** [S54] | MetroPT-3: 1,516,948 rows, 15 signals (TP2, TP3, H1, DV pressure, reservoirs, oil temp, motor current + 8 digital), Feb–Aug 2020, 4 air-leak failures. MetroPT (2022): 10.98 M points; 2 air leaks + 1 oil leak from maintenance reports | CC BY 4.0 | Compressor duty cycles; CMMS-labelled failure windows |
| **UCI hydraulic systems** [S56] | 2,205 × 60-s cycles; 17 sensors (100 Hz pressure … 1 Hz temp); cooler, valve, pump leak, accumulator 90–130 bar | CC BY 4.0 | VRM-style accumulator pre-charge loss |
| **Paderborn KAt** [S55] | 32 bearings (6 healthy, 12 artificial damage, 14 accelerated-life); motor current + vibration at 64 kHz; 4 conditions | research | MCSA bearing signatures |
| **PHM Society challenges** [S53] | 2008–2026 series; 2023 NA: gearbox pitting across 11 health levels | per challenge | GMF sideband growth vs pitting |

**Method:**
1. Compute summary statistics offline: means, σ, autocorrelation, degradation exponents, failure rates.
2. Store them in a `SYNTH_PARAMS` table.
3. Generate data with `GENERATOR()` and Snowpark.
4. Upload no raw data, apart from optional demo clips.

---

## 6. Competitive landscape, 2025–26

| Player | 2025–26 status | Strong at | Our opening |
|---|---|---|---|
| **AWS** | Lookout for Equipment closed to new customers 7 Oct 2025 and **ends 7 Oct 2026** [S57]; Monitron closed to new customers 31 Oct 2024 [S58]; IoT SiteWise multivariate anomaly detection GA Jul 2025 [S59] | ingestion, asset models | PdM point services retired; no CMMS/ERP context |
| **Microsoft** | Fabric Real-Time Intelligence + digital twin builder (preview, 2025) + IoT Operations [S60] | OT streaming, Copilot reach | many services to stitch; twin builder in preview |
| **Siemens** | Senseye PdM + Industrial Copilot maintenance (Mar 2025) [S61]; Insights Hub; **Industrial Edge → Snowflake (Sep 2025)** [S62] | drive/PLC depth | Siemens-centric; thin ERP cost context (partner, not rival) |
| **PTC** | **Kepware + ThingWorx sold to TPG**: signed Nov 2025 for up to $725 M, closed 2026 [S63] | Kepware ubiquity | ThingWorx roadmap uncertain |
| **GE Vernova** | APM and SmartSignal upgrades (2025); Proficy sold to TPG for $600 M [S64] | power/O&G reliability (RBI, RCM) | heavy; energy-skewed |
| **AVEVA** | PI Data Infrastructure, CONNECT, Industrial AI Assistant (2025) [S65] | de facto historian | historian-centric; maintenance/ERP via partners |
| **Cognite** | Atlas AI agent workbench (Sep 2025); **zero-copy with Snowflake (Oct 2025)** [S66] | industrial knowledge graph | costly, energy-skewed; complementary |
| **Palantir** | Foundry/AIP ontology; Warp Speed: 6 new customers (Mar 2025); Lear saved >$30 M in H1 2025 [S67] | ontology + actions | expensive, long deployments, closed |
| **Augury** | $75 M Series F (Feb 2025); building agentic AI [S68] | turnkey sensors + diagnostics | hardware-led; data stays in vendor cloud |
| **Avathon** (ex-SparkCognition) / **Uptake** | Avathon rebranded Nov 2024 [S69]; Uptake quieter (fleet APM) | industrial AI apps | point solutions |
| **TRACTIAN** | $120 M Series C (Dec 2024) [S76] | sensors + CMMS bundle | own stack, SMB focus |
| **IBM Maximo** | MAS 9.1 GA 24 Jun 2025: Monitor/Health/Predict + Maximo Assistant suggests problem codes [S70] | EAM depth | heavy upgrades; separate data plane |
| **SAP** | APM + Joule Maintenance Planner Agent; **SAP BDC Connect zero-copy to Snowflake** (Nov 2025; GA at Summit 2026) [S71][S78] | system of record | OT heavy lifting happens outside SAP |
| **Litmus / Sight Machine / Tulip** | Litmus Edge (250+ drivers) → Snowpipe Streaming [S72]; Sight Machine agents + tag-mapping small language model [S73]; Tulip composable AI agents (2025) [S74] | edge DataOps, MES analytics, frontline apps | feeders or UX layers, not closed-loop reliability |
| **MaintainX / UpKeep / Fiix** | MaintainX $150 M at $2.5 B (Jul 2025); UpKeep Nova agent (Sep 2025); Fiix (Rockwell) [S75] | mobile CMMS UX | AI sees only CMMS data; shallow OT/ERP |

**Baseline judges know:** Snowflake's own quickstart (updated Feb 2026) already covers a medallion pipeline, RUL, a Streamlit command center and NL Q&A [S77]. We must go beyond it.

**Where a Snowflake-native, AI-native approach wins**
1. **No data movement.** SAP BDC Connect and Cognite zero-copy, plus Siemens/Litmus streaming [S62][S66][S71][S72], join OT, CMMS and ERP in one governed place, with no CSV exports.
2. **Governed semantic layer.** An ISA-95/ISO 14224 ontology as semantic views gives NL answers the same OEE/MTBF definitions finance uses.
3. **Agentic closed loop.** Anomaly → ISO 14224 diagnosis → drafted M2 + PM01 (parts, craft, permit) → human approval. Maximo and SAP only suggest codes.
4. **Cost- and spares-aware decisions.** P(fail) × ₹/h, weighed against stock, PO lead time and production-order gaps.
5. **Physics-aware AI.** BOM-derived bearing and gear frequencies make alerts explainable to analysts.
6. **Energy and carbon.** Excess kWh × CEA 0.675 tCO₂/MWh.
7. **Fleet/GCC view.** Data sharing enables cross-plant benchmarking for remote reliability centres.

---

## 7. "Wow" features, ranked by demo impact vs build effort

| # | Feature (manager value) | Snowflake build | Impact | Effort |
|---|---|---|---|---|
| 1 | **Downtime-to-₹ ticker**: every stop and alarm priced (lost t × margin + labour + parts + energy) | Dynamic Tables, Streamlit | 5 | S |
| 2 | **Agentic WO autopilot**: anomaly → failure-mode diagnosis → drafted M2 + PM01 with task list, reserved parts and on-shift technician → Approve | Cortex Agent + procedure tools | 5 | M |
| 3 | **NL root-cause copilot**: "Why did Cement Mill 2 OEE drop 9 points last week?" → Six-Big-Loss waterfall → tags/alarms/WOs, with citations | Cortex Analyst semantic view + Cortex Search | 5 | M |
| 4 | **Spares-aware maintenance window optimizer**: risk-cost × schedule gaps × stock/PO lead time × crew calendar | SQL/Snowpark + Streamlit | 5 | M |
| 5 | **Failure time machine**: replay tags, PLC states, alarms and WOs with a P-F overlay ("we could have known 19 days earlier") | SQL + Streamlit timeline | 5 | M |
| 6 | **Auto 5-Why + Ishikawa RCA** from the evidence, seeded with the FLSmidth VRM cause tree | AI_COMPLETE + Cortex Search | 4 | S |
| 7 | **Energy and carbon waste** from degraded assets (belt slip, leaks, imbalance) → ₹ + tCO₂ | SQL | 4 | S |
| 8 | **Shift handover brief** (English/Hindi): risks, open WOs, alarm floods, OEE deltas | Task + AI_COMPLETE | 4 | S |
| 9 | **Maintenance-induced failure detector**: failures ≤14 days after a PM, linked to crew and procedure | SQL | 4 | S |
| 10 | **Physics-aware spectrum explorer** with BPFO/BPFI/GMF markers from BOM geometry | Snowpark FFT + Altair | 4 | M |
| 11 | **What-if: defer maintenance** → risk-cost curve (Weibull × health) vs savings | Snowpark | 4 | M |
| 12 | **Technician copilot** over manuals, SOPs and past WOs | Cortex Search | 4 | S |
| 13 | **Warranty & supplier quality**: claim drafts, supplier MTBF league, bad part lots | SQL + AI_COMPLETE | 3 | S |
| 14 | **AI back-fill of ISO 14224 codes** on free-text WOs (data-quality uplift %) | AI_CLASSIFY | 3 | S |
| 15 | **Fleet/GCC benchmark** + ISA-18.2 alarm-flood ranking | secure share + SQL | 3 | S |

**Build order**
- **For 04 Oct:** 1 → 2 → 3 → 5 → 4, then 7, 8 and 9.
- **For the 27–30 Oct finale:** 10, 11, 6 and 12.

**Trial constraints**
- 1, 4, 5, 7, 9, 11 and 15 are pure SQL/Python, so they still work if Cortex stays off on the trial.
- Avoid external access, SPCS and Openflow; all are blocked on trials (see 01-coco-platform.md).

## Sources (all accessed 2026-10-03)

**Downtime, PdM benefits, OEE**
- S1 Siemens, *The True Cost of Downtime 2024* (data Apr 2019–Mar 2023) — https://assets.new.siemens.com/siemens/assets/api/uuid:1b43afb5-2d07-47f7-9eb7-893fe7d0bc59/TCOD-2024_original.pdf
- S2 Senseye TCOD 2022 figures, Operations Engineer, 21 Nov 2022 — https://www.operationsengineer.org.uk/content/news/worlds-largest-manufacturers-lose-15-trillion-a-year-to-production-outages
- S3 ABB, Value of Reliability survey, 2023 — https://new.abb.com/news/detail/107660/abb-survey-reveals-unplanned-downtime-costs-125000-per-hour
- S4 ABB India, Oct 2023 — https://new.abb.com/news/detail/108271/abb-survey-reveals-unplanned-downtime-costs-inr-7-million-per-hour
- S5 ABB downtime study, Global Cement, Oct 2025 — https://globalcement.com/news/20002-abb-publishes-industrial-downtime-study
- S6 Fluke Reliability, 30 Oct 2025 — https://www.fluke.com/en/learn/blog/condition-monitoring-and-alignment-software/unplanned-downtime-costs-manufacturers-up-to-852m-weekly
- S7 Thomas & Weiss (NIST), IJPHM 12(1), Apr 2021 — https://doi.org/10.36001/IJPHM.2021.v12i1.2883
- S8 NIST Applied Economics Office, Manufacturing machinery maintenance (2016 data) — https://www.nist.gov/el/applied-economics-office/manufacturing-machinery-maintenance
- S9 McKinsey, "Manufacturing: Analytics unleashes productivity and profitability", Aug 2017 — https://www.mckinsey.com/capabilities/operations/our-insights/manufacturing-analytics-unleashes-productivity-and-profitability
- S10 US DOE FEMP / PNNL, O&M Best Practices Guide, Release 3.0, Aug 2010 — https://www.osti.gov/biblio/1220381
- S11 Deloitte Analytics Institute, *Predictive Maintenance* position paper, 2017 — https://www.deloitte.com/content/dam/assets-zone2/de/de/docs/about/2024/Deloitte_Predictive-Maintenance_PositionPaper.pdf
- S12 OEE.com (Vorne) — https://www.oee.com/calculating-oee/ · https://www.oee.com/world-class-oee/ · https://www.oee.com/oee-six-big-losses/ · https://www.oee.com/teep/
- S13 R. K. Mobley, *An Introduction to Predictive Maintenance*, 2nd ed., 2002 — https://www.sciencedirect.com/book/9780750675314/an-introduction-to-predictive-maintenance

**India and GCC**
- S14 CemNet (Economic Survey 2025-26), 6 Feb 2026 — https://www.cemnet.com/News/story/180762/india-s-per-capita-cement-consumption-rises.html
- S15 IBEF Cement, updated Sep 2026 — https://www.ibef.org/industry/cement-india
- S16 Indian Cement Review, 11 Sep 2025 — https://indiancementreview.com/2025/09/11/innovating-energy
- S17 CEA CO₂ Baseline Database v22.0, Aug 2026 — https://cea.nic.in/wp-content/uploads/baseline/2026/09/User_Guide__Version_22.0.pdf
- S18 Business Today (Nasscom-Zinnov FY26), 7 May 2026 — https://www.businesstoday.in/technology/news/story/the-big-boom-how-indias-gcc-story-hits-2030-target-4-years-early-530265-2026-05-07
- S19 ThePrint (Nasscom-Zinnov 2024), Sep 2024 — https://theprint.in/economy/indias-position-as-gcc-capital-of-the-world-nasscom-zinnov-study/2268673/
- S20 IdeasForIndia, "Net assessment of India's manufacturing sector", 20 Mar 2026 — https://www.ideasforindia.in/topics/macroeconomics/net-assessment-of-indias-manufacturing-sector
- S21 Avathon press release, Nov 2024 — https://avathon.com/press-release/avathon-aims-to-triple-workforce-in-india-within-24-months/

**Standards and enterprise systems**
- S22 OPC 10030, ISA-95 Common Object Model — https://reference.opcfoundation.org/specs/OPC-10030/8.2
- S23 Control Engineering, "ISA-95 Part 3 released" — https://www.controleng.com/isa-95-part-3-released
- S24 ISO 14224 lists as reproduced by Tetra Pak — https://maintenance.tetrapak.com/service/tpms/help/b-features/ampc/maintenance-plan-development/failure-analysis-configuration/failure-modes/failure-modes.html · …/failure-mechanisms/failure-mechanisms.html
- S25 MIMOSA OSA-CBM (ISO 13374) — https://www.mimosa.org/mimosa-osa-cbm/
- S26 ISO 20816-3:2022 — https://www.sis.se/en/produkter/metrology-and-measurement-physical-phenomena/vibrations-shock-and-vibration-measurements/iso-20816-32022/ · zone values: https://www.fabrico.io/blog/iso-10816-3-vibration-severity/
- S27 ISA InTech, P-F curve, Mar/Apr 2019 — https://www.isa.org/intech-home/2019/march-april/features/improving-maintenance-by-adopting-a-p-f-curve-meth
- S28 QAD on the AIAG-VDA FMEA handbook, Oct 2020 — https://www.qad.com/blog/2020/10/is-the-new-fmea-handbook-a-game-changer-for-quality
- S29 SAE JA1011 — https://www.sae.org/standards/content/ja1011_200908/
- S30 SAP Help, notification types — https://help.sap.com/saphelp_470/helpdata/EN/32/543d3854126956e10000009b38f842/content.htm · PM05 calibration — https://help.sap.com/saphelp_46C/helpdata/EN/f8/41696b6cb011d2a5a70060087a7a74/content.htm · catalog profiles — https://help.sap.com/saphelp_46C/helpdata/EN/3c/abc4f5413911d1893d0000e8323c4f/content.htm · order types — https://www.stechies.com/pm-order-types · MTTR/MTBR — https://answers.sap.com/questions/5275614/mtbf-and-mttr.html
- S31 IBM Maximo failure hierarchies — https://www.ibm.com/docs/SSLKT6_7.6.1.2/com.ibm.mbs.doc/failure/t_build_fail_hierarchy.html · work types — https://fcs.cornell.edu/sites/default/files/imce/site_contributor/Svc_Maximo/documents/SOP/REF%205%20-%20Maximo%20WO%20Work%20Types.pdf · statuses — https://fcs.cornell.edu/maximo/maximo-how-tos/ref-03-maximo-service-request-work-order-status-definitions

**Physics of failure**
- S32 CWRU Bearing Data Center — https://engineering.case.edu/bearingdatacenter/bearing-information · https://engineering.case.edu/bearingdatacenter/apparatus-and-procedures
- S33 ACOEM, four stages of bearing failure — https://www.acoem.com/en/blog/do-you-know-the-4-stages-of-bearing-failure/
- S34 Fluke, vibration diagnostics part 4 — https://fluke.com/en/learn/blog/alignment/understanding-vibration-monitoring-common-faults-part-4
- S35 Schoen et al., IEEE Trans. Industry Applications 31(6), 1995 — https://doi.org/10.1109/28.475697
- S36 DOE/NREL motor tip sheet, voltage unbalance — https://nrel.gov/docs/fy00osti/27832.pdf
- S37 STLE *TLT*, "Grease life in ball bearings", Oct 2010 — https://www.stle.org/images/pdf/STLE_ORG/BOK/LS/Bearings/Grease%20Life%20in%20Ball%20Bearings_The%20Effect%20of%20Temperatures_tlt%20article_Oct10.pdf
- S38 Motor insulation classes and the 10 °C rule — https://myelectrical.com/notes/entryid/122/understanding-electric-motor-insulation-temperature
- S39 UE Systems, ultrasound bearing monitoring — https://www.uesystems.com/bearing-condition-monitoring/
- S40 Machine Design, V-belt efficiency (cites a Gates study) — https://www.machinedesign.com/mechanical-drives/coaxing-v-belts-operate-more-efficiently
- S41 Tractian, pump cavitation — https://tractian.com/en/glossary/pump-cavitation
- S42 Barringer Weibull database (archived copy) — https://web.archive.org/web/2018/http://www.barringer1.com/wdbase.htm
- S43 FLSmidth, "Angry VRMs", *Global Cement Magazine*, Oct 2025 — https://www.fuller-technologies.com/files/gcm-oct-2025-angry-vrms.pdf
- S44 Gear mesh frequency — https://www.fabrico.io/blog/gear-mesh-frequency/
- S45 Kurtosis and crest factor — https://sensemore.io/how-is-fault-detection-performed/
- S46 US DOE Compressed Air Tip Sheet #3, Aug 2004 — https://www.energy.gov/sites/prod/files/2014/05/f16/compressed_air3.pdf
- S80 Tool and spindle balancing grades (G2.5, ISO 1940-1) — https://shop.machinemfg.com/comprehensive-guide-to-tool-balancing-and-iso-standards/

**Datasets**
- S47 Azure PdM — https://www.kaggle.com/datasets/arnabbiswas1/microsoft-azure-predictive-maintenance · row counts: https://h1st.readthedocs.io/en/latest/tutorials/examples/oracle-iot.html
- S48 AI4I 2020 — https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset
- S49 NASA PCoE repository (C-MAPSS, IMS) — https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/
- S50 FEMTO/PRONOSTIA — https://github.com/VictorBauler/awesome-bearing-dataset
- S51 MIMII (Sep 2019) — https://zenodo.org/records/3384388 · MIMII DUE (May 2021) — https://zenodo.org/record/4740355
- S52 Kaggle pump sensor data — https://www.kaggle.com/datasets/nphantawee/pump-sensor-data
- S53 PHM Society data challenges — https://data.phmsociety.org/ · https://data.phmsociety.org/phm2023-conference-data-challenge/
- S54 MetroPT-3 — https://archive.ics.uci.edu/dataset/791/metropt+3+dataset · MetroPT — https://arxiv.org/abs/2207.05466
- S55 Paderborn KAt bearing data — https://mb.uni-paderborn.de/en/kat/research/bearing-datacenter/data-sets-and-download
- S56 UCI hydraulic systems — https://archive.ics.uci.edu/dataset/447/condition+monitoring+of+hydraulic+systems

**Competitors**
- S57 AWS, Lookout for Equipment (Sep 2024, updated Oct 2025) — https://aws.amazon.com/blogs/machine-learning/preserve-access-and-explore-alternatives-for-amazon-lookout-for-equipment
- S58 AWS, Monitron — https://aws.amazon.com/blogs/machine-learning/maintain-access-and-consider-alternatives-for-amazon-monitron
- S59 AWS IoT SiteWise anomaly detection, Jul 2025 — https://aws.amazon.com/about-aws/whats-new/2025/07/aws-iot-sitewise-multivariate-anomaly-detection/
- S60 Microsoft Fabric digital twin builder — https://www.processexcellencenetwork.com/digital-adoption/news/microsoft-announces-digital-twin-builder-for-fabric
- S61 Siemens Industrial Copilot / Senseye, Mar 2025 — https://www.automation.com/en-us/products/march-2025/siemens-industrial-copilot-generative-ai
- S62 Siemens and Snowflake, 2 Sep 2025 — https://itdaily.com/news/innovation/siemens-snowflake-connect-data
- S63 PTC sale to TPG — https://www.arcweb.com/blog/ptc-completes-sale-kepware-thingworx-tpg · https://www.iot-now.com/2026/03/17/155881-ptc-completes-divestiture-of-kepware-and-thingworx-businesses/
- S64 GE Vernova — https://gevernova.com/news/press-releases/tpg-to-acquire-ge-vernovas-proficy-manufacturing-software-business · https://gevernova.com/software/resources/webinar/2025-software-innovations
- S65 AVEVA World 2025, ARC — https://www.arcweb.com/blog/aveva-world-2025-unifying-legacies-forging-ecosystems-industrial-ai-era
- S66 Cognite — https://www.cognite.com/en/company/newsroom/cognite-atlas-ai-drives-customer-momentum-with-new-major-release · https://www.cognite.com/en/company/newsroom/cognite-and-snowflake-form-strategic-partnership-to-unify-industrial-data-for-enterprise-wide-ai
- S67 Palantir Warp Speed, 13 Mar 2025 — https://www.businesswire.com/news/home/20250313062266/en/Palantir-Warp-Speed-Accelerates-Announces-Six-New-Customers-That-Are-Re-Industrializing-American-Manufacturing · Lear — https://supplychaindive.com/news/lear-corp-palantir-technologies-ai-software-partnership-five-year/760396
- S68 Augury, 19 Feb 2025 — https://siliconangle.com/2025/02/19/augury-raises-75m-ai-driven-industrial-equipment-health-repair-process-optimization/
- S69 Avathon rebrand — https://www.supplychain247.com/article/sparkcognition_rebrands_as_avathon_releases_industrial_ai_platform
- S70 IBM MAS 9.1 GA — https://community.ibm.com/community/user/blogs/kim-woodbury1/2025/06/23/maximo-application-suite-91-generally-available
- S71 SAP Maintenance Planner Agent — https://www.sap.com/products/erp/maintenance-planner-agent.html · SAP and Snowflake, Nov 2025 — https://investors.snowflake.com/news/news-details/2025/SAP-and-Snowflake-Unleash-the-Power-of-Data-and-Enterprise-AI-Across-the-Business-Data-Fabric/default.aspx
- S72 Litmus and Snowflake — https://litmus.io/integrations/snowflake
- S73 Sight Machine — https://www.assemblymag.com/articles/100151-video-sight-machine-expands-ai-platform-for-factory-operations
- S74 Tulip — https://tulip.co/blog/ai-in-action-5-highlights-from-operations-calling/
- S75 MaintainX, 9 Jul 2025 — https://www.getmaintainx.com/newsroom/maintainx-raises-150m · UpKeep Nova, Sep 2025 — https://smb.americanpress.com/article/UpKeep-Launches-Nova-AI-Agent-to-Automate-Maintenance-Workflows/68b828b075dfdb000226dbbb · Fiix — https://www.rockwellautomation.com/en-au/company/news/press-releases/Rockwell-Automation-Acquires-Fiix-Inc--Cloud-Software-Company-for-Leading-Edge-Maintenance-Solutions.html
- S76 TRACTIAN, Dec 2024 — https://wilmerhale.com/en/insights/news/20241219-tractian-raises-$120m-in-series-c-funding

**Snowflake and KPI caveats**
- S77 Snowflake PdM guide (updated 3 Feb 2026) — https://www.snowflake.com/en/developers/guides/predictive-maintenance-with-snowflake-cortex/ · hands-on lab, 27 May 2026 — https://www.snowflake.com/en/webinars/virtual-hands-on-lab/eliminate-unplanned-downtime-a-live-build-with-snowflake-cortex-ai-2026-05-27/
- S78 Snowflake Summit 2026 recap — https://www.flexera.com/blog/perspectives/snowflake-summit-2026/ · CoCo changelog — https://docs.snowflake.com/en/user-guide/cortex-code/changelog
- S79 KPI benchmark caveats — https://reliamag.com/guides/maintenance-reliability-kpi-reference/ · https://reliamag.com/guides/wrench-time-benchmarks-typical-good-and-world-class-rates/
