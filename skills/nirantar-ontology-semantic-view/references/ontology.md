# Manufacturing reliability ontology (ISA-95 × ISO 14224 × OEE × ERP/CMMS)

| Entity | Typical table | Key | Relationships |
|---|---|---|---|
| Site (plant) | DIM_SITE | site_id | 1:N Area, Line |
| Area | DIM_AREA | area_id | N:1 Site; 1:N Line |
| Line (work centre) | DIM_LINE | line_id | N:1 Area/Site; 1:N Asset, ProductionShift, ProductionOrder |
| Asset (equipment) | DIM_ASSET | asset_id | N:1 Line; 1:N Component, SensorTag, Downtime, WorkOrder, Prediction, Alert |
| Component | DIM_COMPONENT | component_id | N:1 Asset; 1:N ComponentInstall |
| Sensor tag | DIM_SENSOR_TAG | tag_id | N:1 Asset/Component; 1:N Telemetry |
| Failure mode (ISO 14224) | DIM_FAILURE_MODE | failure_mode_id | 1:N WorkOrder; asset_class scoped |
| Downtime event | FACT_DOWNTIME | (asset_id, start_ts) | N:1 Asset, ReasonCode; 0..1 WorkOrder |
| Reason code (Six Big Losses) | DIM_REASON_CODE | reason_code | 1:N Downtime |
| Production shift | FACT_PRODUCTION_SHIFT | (line_id, shift_date, shift) | N:1 Line |
| Work order | FACT_WORK_ORDER / CMMS_WORK_ORDER | wo_id | N:1 Asset, FailureMode, Technician; 1:N PartUsage |
| Spare part | DIM_SPARE_PART | part_id | 1:N Stock, PartUsage, GoodsReceipt |
| Stock | ERP_STOCK | (part_id, site_id, warehouse) | N:1 Part, Site |
| Goods receipt (supplier lot) | ERP_GOODS_RECEIPT | gr_id | N:1 Supplier, Part; supplier_lot links to ComponentInstall |
| Component install | ERP_COMPONENT_INSTALL | install_id | N:1 Asset, Component, Part; supplier_lot |
| Supplier | DIM_SUPPLIER | supplier_id | 1:N GoodsReceipt |
| Production order | ERP_PRODUCTION_ORDER | prod_order_id | N:1 Line, Product, SalesOrder |
| Sales order | ERP_SALES_ORDER | sales_order_id | N:1 Customer |
| Technician | DIM_TECHNICIAN | technician_id | 1:N WorkOrder (PII: phone masked) |
| Prediction | ML.PREDICTIONS | (asset_id, ts) | N:1 Asset |
| Alert | APP.ALERTS | alert_id | N:1 Asset; 0..1 WorkOrderDraft |

**Synonyms:** machine/equipment/asset · line/work centre/cell · breakdown/unplanned stop/failure · PdM/predictive
maintenance · WO/job/work order · spares/MRO/spare parts · MTBF/mean time between failures · MTTR/mean time to repair ·
lot/batch/supplier lot · changeover/setup.
