# Simulation Metadata API

**Drop a simulation, get its solver, mesh, boundary conditions, parameters and convergence verdict.**

Day 5 of the PINNeAPPle 30-app program. Months after a study, nobody remembers which mesh, time step or turbulence model
produced a result, or whether the run had converged. The answer is in the case files and the solver log, scattered over a
dozen text formats. This service reads them (it never runs them) and returns one structured record (`pinneapple.simmeta/1`).

| Input | Extracted |
|---|---|
| OpenFOAM case (zip, or loose files): `controlDict`, `fvSchemes`, `fvSolution`, `blockMeshDict`, `constant/*Properties`, `polyMesh/{owner,boundary,points}`, `0/*`, solver / blockMesh / checkMesh logs, `postProcessing` monitors | application and version, steady / transient, physics, turbulence model, pressure-velocity algorithm, cells / faces / points, patches, bounding box, mesh quality, Δt and Courant limit, every BC on every patch, viscosity, inlet velocity, an indicative Reynolds number, schemes, linear solvers, relaxation, residual history |
| CalculiX / Abaqus `.inp` (with `*INCLUDE`), `.sta`, `.cvg`, `.dat`, solver output | procedure per step, NLGEOM, nodes / elements / element types, sets, materials, supports, loads, increments and Newton iterations, printed results |
| Residual history table (SU2 `history.csv`, Fluent / STAR-CCM+ exports) | convergence verdict and monitors |

**Convergence verdict:** `converged`, `still_falling` (with an estimate of the extra iterations needed), `stalled`, `diverged`,
`crashed`, `completed` (transient, with Courant and continuity notes), `failed` (FEA), `incomplete`. Every verdict lists its
reasons and what to do next.

Library: `pinneapple_data.simulation_metadata` (`read_upload`, `extract`).

## Validation (`tests/test_data_apps.py`)

The five examples in [`examples/`](examples) are real runs made for this app with OpenFOAM v1912 and CalculiX 2.21:

| Example | What the solver did | Verdict |
|---|---|---|
| `openfoam_pitzDaily_converged` | simpleFoam, k-ε, "SIMPLE solution converged in 282 iterations" | converged |
| `openfoam_pitzDaily_stopped_early` | same case, endTime 60, residuals still above target and falling (the full run converges at 282) | still_falling |
| `openfoam_pitzDaily_diverged` | relaxation 0.99, plain SIMPLE: floating-point exception after 5 iterations | diverged |
| `openfoam_cavity_transient` | icoFoam, 100 steps, max Courant 0.85 | completed |
| `calculix_cantilever_nlgeom` | static NLGEOM, 6 increments of 2 Newton iterations | converged |

- Mesh counts match checkMesh (12,225 cells; 400 cells; 640 C3D8I elements / 1,025 nodes).
- The beam's tip deflection read from the `.dat` file, 7.58 mm, is within 1 % of Euler–Bernoulli (F L³/3EI = 7.62 mm).

## Run it

```bash
pip install -e . -r apps/simulation_metadata/requirements.txt
cd apps/simulation_metadata && uvicorn simulation_metadata.api:app --port 8084
curl -F "files=@case.zip" localhost:8084/api/extract
```

Environment: `SMD_USER` / `SMD_PASSWORD`, `SMD_MAX_MB` (100), `SMD_MAX_HEAVY` (2).
Deploy with the other apps: [`apps/deploy`](../deploy/README.md).
