# Engineering Data Standardizer

**Many files, many conventions, one physical schema.**

Day 4 of the PINNeAPPle 30-app program. The same plant is usually recorded by several systems: a BMS exports CSV in local
time and °C with decimal commas, a SCADA API returns JSON in Unix milliseconds, °F, gpm and tons, a test rig writes Excel
in kelvin, L/s and W. This app maps every column to a physical quantity, a canonical name and a target unit, converts,
aligns everything in UTC, and checks that the sources agree.

| You give it | You get |
|---|---|
| Up to 8 files (CSV, Excel, Parquet, JSON, HDF5) and a target unit system (metric, SI, US) | A draft mapping to review and edit, one table (wide or long) in UTC with consistent units, before/after charts, a cross-source agreement check, downloads in CSV, Parquet (units in schema metadata), HDF5 (units in attributes), JSON, and a manifest of every conversion |

The reviewed mapping is a **recipe** (JSON). `POST /api/standardize` with the same recipe standardizes next month's exports
in a script or scheduled job.

**Agreement check.** Where two sources measure the same variable, their converted values are compared:
- `agree`: the difference is within sensor noise;
- `offset`: a constant difference (calibration, or a unit offset);
- `differ`: a scale difference (wrong unit);
- `time shift`: the sources match better when shifted by whole hours (wrong time zone).

Library: `pinneapple_data.unified` (`propose_mapping`, `standardize`, `write`, `to_physical_sample` → a PINNeAPPle
`PhysicalSample` with units in the xarray attributes).

## Validation (`tests/test_data_apps.py`)

- The three-system example (BMS / SCADA / test rig) standardizes to 5-minute UTC data. All 9 cross-source comparisons agree, with median differences of 0.01–0.04 in the target unit.
- Declaring the BMS file as UTC instead of São Paulo time is flagged as a 3 h time shift on every overlapping variable.
- Parquet and HDF5 outputs are read back with their units.

## Run it

```bash
pip install -e . -r apps/data_standardizer/requirements.txt
cd apps/data_standardizer && uvicorn data_standardizer.api:app --port 8083
```

Environment: `EDS_USER` / `EDS_PASSWORD`, `EDS_MAX_MB` (80), `EDS_MAX_FILES` (8), `EDS_MAX_HEAVY` (2).
Deploy with the other apps: [`apps/deploy`](../deploy/README.md).
