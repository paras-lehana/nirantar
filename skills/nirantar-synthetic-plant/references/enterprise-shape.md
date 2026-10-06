# Default enterprise shape: "Indus Group" (fictional)

| Site | Industry | Lines (assets) |
|---|---|---|
| PUNE-MACH (Chakan, MH) | AUTO_COMPONENTS machining | PUN-L1 Crankshaft (CNC lathes ×2, CNC mills ×2, grinder, washer) · **PUN-L2 Cylinder Head** (VMC-201…204 5-axis, CMM, deburr robot, conveyor) · PUN-L3 Gear Cutting (hobbers ×2, heat-treat furnace, shot peen, gear grinder) · PUN-U1 Utilities (air compressors ×2, chiller, coolant pumps ×2, cooling-tower pump) |
| CHENNAI-FORGE (Oragadam, TN) | AUTO_COMPONENTS forging | CHN-L1 Hot Forging (induction heater, forging press 2500 t, trim press, robot, conveyor) · CHN-L2 Press & Trim (hydraulic presses ×3, transfer robot) · CHN-U1 Utilities (compressors ×2, hydraulic power units ×2) |
| CHITTOR-CEMENT (Chittorgarh, RJ) | CEMENT grinding | CTG-L1 Cement Mill (ball mill main drive, separator, bag-filter fan, bucket elevator, belt conveyors ×2) · CTG-L2 Packing (rotary packers ×2, palletiser) · CTG-U1 Compressors ×2 |

Criticality A for bottleneck assets (VMC-204, forging press, ball mill main drive, rotary packers), B for most, C for spares.
Shifts A 06–14, B 14–22, C 22–06 IST. Customers (fictional): Maratha Motors, Coromandel Tractors, Deccan Two-Wheelers,
Ganga Infra. Suppliers (fictional): Shree Bearings Pvt Ltd, Kaveri Hydraulics, Vindhya Electricals, Narmada Tooling.

## Seeded insight patterns (the RCA copilot must find them)
1. **Supplier lot L-2391** (Shree Bearings): spindle bearings from this lot fail at ≈ ⅓ normal MTBF — 3 failures on
   PUN-L2 since March + 1 at Chennai.
2. **Maintenance-induced failures:** 2 hydraulic-press failures within 5 days after a PM by the same technician.
3. **Shift effect:** C-shift small-stop rate 1.6 × A-shift on CHN-L2.
4. **Heat effect:** Chittorgarh compressor trips when ambient > 42 °C (afternoons, heat-wave week in history).
5. **Energy waste:** degraded ball mill draws +6–9 % kWh/tonne before liner change.

## Hero scenario: `HERO_VMC204_BEARING`
VMC-204 (PUN-L2, class II, criticality A) spindle bearing wear; after ~10 live ticks: VIB_RMS ≈ 6.8 mm/s (zone C),
bearing temp + 9 °C, risk_72h ≈ 0.8, RUL 48–80 h. ERP: SKF-7014-ACD/P4A stock Pune 0, Chennai 2 (transfer ETA 9 h),
supplier lead time 21 days. PUN-L2 downtime cost ₹ 4.2 lakh/h; Maratha Motors order due Friday, penalty ₹ 6 lakh/day;
planned changeover Thursday 14:00–18:00. Technician R. Patil (spindle-certified, B-shift). Installed bearing lot L-2391.

## OEE realism targets
PUNE-MACH 62–68 %, CHENNAI-FORGE 55–62 %, CHITTOR packing 70–75 %; breakdowns 35–45 % of downtime minutes; quality
97–99.5 %. World-class reference 85 %.
