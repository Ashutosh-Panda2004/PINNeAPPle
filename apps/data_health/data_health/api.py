"""Engineering Data Health web API + single-page UI.

Run:  uvicorn data_health.api:app --port 8082   (from apps/data_health)

Environment (all optional):
  EDH_USER / EDH_PASSWORD   HTTP Basic login on everything except /health
  EDH_MAX_MB                largest upload in MB (default 50)
  EDH_MAX_ROWS              rows analysed per file (default 1,000,000)
  EDH_MAX_HEAVY             concurrent analyses per worker (default 2)
"""
from __future__ import annotations

import json
import os
import sys
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from pinneapple_data.data_health import analyze, example_chiller_plant, load_table

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "_shared"))
from appkit import BusyLimiter, install  # noqa: E402

VERSION = "1.0.0"
STATIC = os.path.join(os.path.dirname(__file__), "static")
MAX_MB = float(os.environ.get("EDH_MAX_MB", "50"))
MAX_ROWS = int(os.environ.get("EDH_MAX_ROWS", "1000000"))
FORMATS = [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".parquet", ".json", ".jsonl", ".h5", ".hdf5"]

app = FastAPI(title="Engineering Data Health", version=VERSION,
              description="Physics-aware quality report for engineering datasets (PINNeAPPle Physical Data Layer). "
                          "POST a CSV, Excel, Parquet, JSON or HDF5 file to /api/analyze.")
install(app, prefix="EDH")
_HEAVY = BusyLimiter("EDH_MAX_HEAVY")

VALIDATION = [
    "Finds all 8 faults injected into a week of chilled-water plant data (gap, duplicates, frozen sensor, "
    "spikes, -999 codes, humidity above 100 %, a °C → K switch, a flow meter reading 28 % low) with no false alarm",
    "The same plant without faults scores 99.8 / 100 with no warning",
    "Identical results from CSV (comma or semicolon, decimal comma, dd/mm or mm/dd dates), Excel, Parquet, JSON and "
    "HDF5 (units read from dataset attributes)",
    "Unit conversions use exact definitions (NIST SP 811); round trips are exact to 1e-12",
]


def scope() -> dict:
    items = [
        {"topic": "Energy balance fluid", "effect": "check",
         "detail": "The heat-rate check uses water properties (ρ 997 kg/m³, cp 4186 J/(kg·K)). A glycol loop has "
                   "a lower cp, which shows as a constant ratio below 1 rather than a fault.",
         "today": "Read the ratio's changes over time, not its absolute level, for glycol loops.",
         "planned": "Fluid selection (glycol %, brines, refrigerants) with temperature-dependent properties."},
        {"topic": "Relations found from column names", "effect": "optimistic",
         "detail": "Physics checks run only when columns are named consistently (e.g. CHW_supply, CHW_return, "
                   "CHW_flow, Cooling_load). Other relations are not checked yet.",
         "today": "Use a common prefix and supply/return (or in/out) in the names of loop sensors.",
         "planned": "User-defined relations: mass balance, pump affinity laws, P = √3·V·I·PF, psychrometrics."},
        {"topic": "Generic thresholds", "effect": "check",
         "detail": "Spike, flat-line and gap thresholds are generic. A very fast real transient can be flagged as a "
                   "spike; a slow drift is not caught by any single-column check.",
         "today": "Open the flagged spans in the column chart and confirm before deleting data.",
         "planned": "Thresholds learned per quantity from your own history; drift detection against redundant "
                    "sensors and physics models."},
        {"topic": "Units come from the headers", "effect": "optimistic",
         "detail": "A column without a unit in its header (or file metadata) skips the physical-limit and unit "
                   "checks.",
         "today": "Write units in headers, e.g. 'Flow [m3/h]', or upload Parquet/HDF5 with unit metadata.",
         "planned": "Unit inference from value ranges and BACnet / OPC UA tag dictionaries."},
    ]
    return {"validated": VALIDATION, "items": items, "title": "Checks scope & validation", "noun": "limitation",
            "items_title": "What the checks assume",
            "band": "Every issue lists its evidence (rows, time spans, values) so it can be verified by hand.",
            "tags": {"conservative": "Errs on the side of flagging", "optimistic": "Can miss problems",
                     "check": "Assumption to confirm"}}


def _run(data: bytes, filename: str, sheet: Optional[str], time_column: Optional[str], units: Optional[str]) -> dict:
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"File larger than {MAX_MB:g} MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    try:
        unit_map = json.loads(units) if units else {}
        if not isinstance(unit_map, dict):
            raise ValueError("units must be a JSON object {column: unit}")
        with _HEAVY:
            df, info = load_table(data, filename, sheet=sheet or None, max_rows=MAX_ROWS)
            unit_map = {**info.units_from_file, **unit_map}
            report = analyze(df, units=unit_map, time_column=time_column or None)
    except HTTPException:
        raise
    except (ValueError, KeyError, TypeError, UnicodeError, OSError) as e:
        raise HTTPException(422, f"Could not analyse '{filename}': {e}") from e
    except Exception as e:  # pandas / pyarrow / h5py parser errors
        raise HTTPException(422, f"Could not read '{filename}': {type(e).__name__}: {e}") from e
    report["file"] = {"name": filename, "bytes": len(data), **info.__dict__}
    report["scope"] = scope()
    report["columns_all"] = list(df.columns)
    return report


@app.get("/health")
def health():
    return {"status": "ok", "version": VERSION}


@app.get("/api/meta")
def meta():
    return {"version": VERSION, "formats": FORMATS, "max_mb": MAX_MB, "max_rows": MAX_ROWS}


@app.post("/api/analyze")
async def api_analyze(file: UploadFile = File(...), sheet: Optional[str] = Form(None),
                      time_column: Optional[str] = Form(None), units: Optional[str] = Form(None)):
    """Upload a table; returns the quality report (JSON). `units` is an optional JSON object
    {column: unit} that overrides units read from headers."""
    data = await file.read()
    return _run(data, file.filename or "upload.csv", sheet, time_column, units)


def _example_csv() -> bytes:
    df, _ = example_chiller_plant()
    return df.to_csv(index=False).encode()


@app.get("/api/example")
def api_example():
    """Report on the built-in example (chilled-water plant with 8 injected faults) plus the answer key."""
    rep = _run(_example_csv(), "chiller_plant_week.csv", None, None, None)
    rep["answer_key"] = example_chiller_plant()[1]
    return rep


@app.get("/api/example.csv")
def api_example_csv():
    return Response(_example_csv(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="chiller_plant_week.csv"'})


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))
