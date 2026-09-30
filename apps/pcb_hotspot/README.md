# PCB Hotspot

**Board-level PCB thermal analysis: junction temperatures, hotspots and what fixes them, in about a second.**

Day 2 of the PINNeAPPle 30-app program. A working SaaS prototype for hardware design houses,
EMS/ODM engineering teams and electronics start-ups. Today these teams check a layout's
thermals with a spreadsheet of θJA values (wrong on a real board: θJA is a JEDEC test-board
number) or wait days for a CFD specialist.

| You give it | You get |
|---|---|
| Board size and stack-up (copper layers, weights, coverage), component positions / powers / packages (θJB, θJC from the datasheet or typical values), thermal vias, ambient, natural convection or airflow, optional chassis clamping | Junction, case and board temperature for every part with a ±20 % cooling band, the **critical component**, the top/bottom temperature map, a 3D view, where the heat goes, physics checks, a ranked **what-if** list of fixes, and a **calibrated model** once you have a few measurements |

## Run it

```bash
# from the repository root
pip install -e . fastapi "uvicorn[standard]" pyamg
cd apps/pcb_hotspot
uvicorn pcb_hotspot.api:app --port 8081        # open http://localhost:8081
```

Docker (from the repository root):

```bash
docker build -f apps/pcb_hotspot/Dockerfile -t pcb-hotspot .
docker run -p 8081:8081 pcb-hotspot
```

### Put it on a server (HTTPS + login)

```bash
cd apps/pcb_hotspot/deploy
cp .env.example .env          # set DOMAIN, PCB_USER, PCB_PASSWORD
docker compose up -d --build  # Caddy obtains the HTTPS certificate automatically
```

- `PCB_USER` / `PCB_PASSWORD`: HTTP Basic login for everything except `/health`.
- `PCB_MAX_HEAVY`: concurrent what-if / calibration runs per worker (default 2); the
  excess gets HTTP 429 instead of piling up. `/api/solve` is not limited (≈1–2 s).
- Running it next to HeatSink Sizer on the same server: use one Caddy with two site
  blocks (`heatsink.example.com { reverse_proxy hss:8080 }`,
  `pcb.example.com { reverse_proxy pcb:8081 }`) instead of two Caddy containers
  competing for ports 80/443.

## Using it

1. **Board & layout.** Set the stack-up and environment, then add parts or load the example.
   Drag the parts on the board. Each drop re-solves the board (quick grid, ≈1 s) and
   repaints the top- or bottom-face temperature map with each junction temperature.
   Overlapping footprints are flagged. Cases can be exported and imported as JSON.
2. **Run full analysis** produces the printable thermal report:
   - verdict;
   - a component table with the ±20 % band, heat-to-board share and status;
   - a 3D view (board coloured by copper temperature, parts by case temperature, probe, standard views, PNG export);
   - the heat split, the stack-up used and the physics checks.
3. **What-if** re-solves the full model for common fixes and ranks them by how many degrees
   each one buys on the critical part:
   - 64 thermal vias under it;
   - 2 oz outer copper;
   - +2 planes;
   - 1 m/s airflow;
   - chassis-clamped edges.
4. **Calibrate** takes a few thermocouple / IR readings (`x, y, T[, top|bottom]`) or on-die
   sensor readings (`Component, T`). It fits the actual surface cooling and the actual in-plane
   spreading of *your* product, then re-predicts every junction with a ±1σ.

## How it works

**Solver** (`pcb_hotspot/solver.py`):
- **Grid.** A 3D finite-volume model with one cell layer per copper and dielectric layer
  (a 6-layer board has 11 layers) and ~60 × 60 cells in plane. Each layer has its own anisotropic
  conductivity from the stack-up: copper and FR-4 are mixed by the copper coverage, in parallel
  in-plane and in series through the board.
- **Components.** Each component is a JEDEC JESD15-3 two-resistor node: θJB to its footprint
  cells and θJC to the air above it.
- **Thermal vias.** Modelled as parallel copper through the dielectric under the part.
- **Surfaces and edges.** Uncovered board surfaces lose heat by convection plus linearised
  radiation. Clamped edges conduct to the chassis.
- **Linear solve.** Algebraic multigrid (pyamg) preconditioned CG, which handles the ~1000:1
  anisotropy of a thin copper board. It falls back to a direct solve.
- **Nonlinear coupling.** Convection and radiation depend on surface temperature. The
  coefficients are iterated to a fixed point on a coarse grid, then one fine solve follows.

**Surface heat transfer** (`pinneapple_physics/closed_form/pcb_thermal.py`):

| Case | Model |
|---|---|
| Vertical board, natural | Churchill & Chu (1975), full-range vertical plate |
| Horizontal board, natural | Upper face Nu = 0.54 Ra¼ / 0.15 Ra⅓, lower face 0.27 Ra¼ (Incropera & DeWitt) |
| Airflow | Flat plate, laminar 0.664 Re½ Pr⅓, mixed above Re = 5·10⁵ (Incropera), both faces |
| Radiation | ε σ (Ts² + T∞²)(Ts + T∞), iterated |
| Package | JEDEC two-resistor model. Default θJC(top) is the datasheet median. Default θJB is set so the model reproduces the median published θJA on the JEDEC 2s2p board. Override both with the datasheet values. |

**Calibration** (`engine.calibrate`) proceeds in five steps:
1. **Estimate.** PINNeAPPle `EnsembleKalmanInversion` estimates log h-scale and log in-plane-k scale
   on a coarse grid.
2. **Refine.** One Gauss-Newton step on the fine grid removes the coarse-grid bias.
3. **Uncertainty.** A Laplace approximation at that optimum gives the posterior (the EKI
   ensemble collapses, so its spread would understate the uncertainty).
4. **Adequacy check.** The reduced χ² of the fit tests model adequacy. If the residuals exceed the
   stated sensor noise, the uncertainty is inflated by the Birge ratio and a warning names the likely causes.
5. **Holdout.** With 5+ readings, 20 % are held out and the error on those unseen points is reported.

## Validation (all in `tests/test_pcb_hotspot.py`, 25 tests)

| Check | Result |
|---|---|
| Full-board part with fixed h vs. the exact two-path resistor network | matches to 1e-6 (relative) |
| Package + board + convection on the JEDEC JESD51-7 2s2p board, still air, vs. published θJA (SOIC-8 ≈ 120, LQFP-100 ≈ 45, TO-252 ≈ 45, QFN-32 ≈ 33, FCBGA 35 ≈ 9.5 K/W; TI, ST, Microchip datasheets) | within 8 % for all 8 packages |
| Energy balance (heat to air + chassis vs. power) | ~1e-12 |
| Grid convergence (coarse vs. fine) on the example | 0.8 % of the junction rise |
| Every standard fix lowers the hot junction (vias, 2 oz, +2 layers, airflow, chassis) | passes |
| Calibration on synthetic readings (truth h × 0.75, k × 0.60) | recovers 0.7500 ± 0.3 % and 0.6000 ± 1 %, every junction within 0.01 °C, adequacy "consistent" |
| Calibration on corrupted readings | flagged "model and measurements disagree", σ inflated ×>3 |
| API: validation (duplicate names, off-board parts, unknown package or sensor) → 422, login, 429 | passes |

Example board: 160 × 100 mm, 6 layers, 13.8 W, vertical, natural convection, 35 °C. Measured on 4 CPU cores.

| Run | Time | Result |
|---|---|---|
| Quick solve | 0.85 s | — |
| Full report | 2.1 s | FPGA 99.1 °C (band 92.8–108.4) vs. Tj,max 100 → marginal; the LDO in SOIC-8 at 0.6 W reaches 121.8 °C |
| What-if | 5.9 s | chassis −15.7 °C · 1 m/s −12.8 °C · 8 layers −3.9 °C · 64 vias −3.5 °C · 2 oz −2.4 °C |
| Calibration | ≈12 s | — |

## Limitations (stated in the app)

- Surface correlations are typically ±20 %. That is the band shown, and it is an assumption until you
  calibrate.
- Air temperature is uniform: there is no downstream pre-heating along the airflow and no shadowing by
  tall parts. Enclosures are represented only through calibration of the cooling scale.
- Package θ values are typical per package family (published θJA spans about ±25 % within one family, depending on die size). Enter the datasheet θJB/θJC for sign-off.
- Copper coverage is uniform per layer. Local pours and cut-outs aren't modelled (an import of
  Gerber/ODB++ copper maps is the natural next step).
- Steady state only.

This is an engineering estimate. Confirm critical designs by test.
