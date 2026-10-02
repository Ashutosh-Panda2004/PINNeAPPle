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

## Optimize (plain machine learning, no physics model)

The **Optimize** tab turns clean operating data into setpoint recommendations:

1. **Clean.** The data-health findings (error codes, frozen sensors, spikes, impossible values, duplicate rows) are removed before training.
2. **Choose roles.** Pick the **KPI** to minimize or maximize (plant kW, specific energy, yield), the **levers** operators set (setpoints, speeds, valve positions), the **context** they don't control (weather, load, feed), and **constraints** on other outputs (e.g. CHW return ≤ 13 °C). The roles are suggested from column names.
3. **Train.** A gradient-boosting model (scikit-learn) predicts the KPI. It is scored on the most recent 25 % of the record, which it never saw.
4. **Optimize.** For each test-period sample, the model searches lever settings that improve the predicted KPI, subject to:
   - the lever + context combination must resemble past operation (nearest-neighbour envelope);
   - each move is limited to a fraction of the lever's range;
   - each constraint has its own model and is enforced with a one-error margin.
5. **Report.** The output gives:
   - the predicted saving, with a range from bootstrapped models;
   - a setpoint schedule by the main driver;
   - how each lever moves the KPI, and feature importance.

**Validation.** The example is a simulated chilled-water plant with known physics: 60 days of 15-minute data, with operators' manual setpoint habits.
- The model predicts plant power within 4.3 kW MAE (R² 0.99) on the last 15 days.
- The predicted saving is 8.3 % (range 6.9–8.3 %). Running the recommended setpoints through the true physics gives 9.0 %.
- The CHW return-temperature limit goes from 4.0 % of the time violated to 0.2 %.

Savings on real plants are model estimates from historical correlations. Confirm them with a supervised A/B trial before automating.

Library: `pinneapple_data.process_optimizer` (`suggest_roles`, `clean_for_modeling`, `fit_and_optimize`).

## Run it

```bash
pip install -e . -r apps/data_health/requirements.txt
cd apps/data_health && uvicorn data_health.api:app --port 8082
```

`POST /api/analyze` (multipart `file`, optional `time_column`, `sheet`, `units`) returns the report; see `/docs`.
Environment: `EDH_USER` / `EDH_PASSWORD` (login), `EDH_MAX_MB` (50), `EDH_MAX_ROWS` (1,000,000), `EDH_MAX_HEAVY` (2).
Deploy with the other apps: [`apps/deploy`](../deploy/README.md).
