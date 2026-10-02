# Engineering Data Health

**Upload a dataset, get a physics-aware quality report.**

Day 3 of the PINNeAPPle 30-app program. Sensor logs, test-bench exports and SCADA dumps carry problems that silently break
analysis and machine learning. This tool reads the file, recognises the physical quantity and unit of every column, and
checks it the way an experienced engineer would.

| You give it | You get |
|---|---|
| A CSV (comma or semicolon, decimal comma), Excel, Parquet, JSON or HDF5 file | A score per category and overall, every issue with its evidence (time spans, values) and a fix, a timeline of where the problems are, each column plotted with its flagged spans, the energy balance when it can be checked, a JSON report |

## Checks

| Category | What is checked |
|---|---|
| Completeness | missing values, long missing runs |
| Time axis | gaps, duplicates, timestamps going backwards (with daylight-saving detection), irregular sampling; ISO, dd/mm, mm/dd, Unix and Excel dates |
| Physical validity | values beyond physical limits (absolute zero, 0–100 % humidity, full vacuum), error codes (−999, 9999, 32767…), kelvin labelled °C, a unit that changes mid-recording |
| Signal quality | stuck sensors (flat lines), spikes (Hampel filter), clipping at a range limit, constant channels |
| Physics consistency | thermal energy balance Q = ρ·V·cp·ΔT between supply / return temperatures, flow and reported heat rate |
| Units & metadata | missing units, numbers stored as text, duplicated channels |

Units and quantities come from headers (`T_supply [°C]`, `Pressure (bar)`, `CHW_flow_gpm`) or from file metadata
(Parquet schema metadata, HDF5 `units` attributes). Conversions use exact definitions (NIST SP 811).

Library: `pinneapple_data.physical_units`, `pinneapple_data.data_health` (`load_table`, `analyze`).

## Validation (`tests/test_data_apps.py`)

- The built-in example (a week of 1-minute chilled-water plant data) has 8 injected faults: a 3 h gap, 30 duplicate rows, a supply sensor frozen for 6 h, 14 spikes, −999 codes, humidity above 100 %, 10 h logged in kelvin, and a flow meter reading 28 % low from day 4. All 8 are found, with no false alarm. The flow-meter fault is visible only through the energy balance.
- The same plant without faults scores 99.8 / 100.
- CSV (semicolon, decimal comma, dd/mm dates), Excel, Parquet and JSON versions of the file give the same result.

## Run it

```bash
pip install -e . -r apps/data_health/requirements.txt
cd apps/data_health && uvicorn data_health.api:app --port 8082
```

`POST /api/analyze` (multipart `file`, optional `time_column`, `sheet`, `units`) returns the report; see `/docs`.
Environment: `EDH_USER` / `EDH_PASSWORD` (login), `EDH_MAX_MB` (50), `EDH_MAX_ROWS` (1,000,000), `EDH_MAX_HEAVY` (2).
Deploy with the other apps: [`apps/deploy`](../deploy/README.md).
