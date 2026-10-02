# ARCHITECTURE — PINNeAPPle (as relevant to this branch)

See PROJECT_CONTEXT.md for the note about the second, ecosystem-wide `.agent/` package in the main
checkout — that one covers architecture in more general terms (compatibility shims, the ecosystem's
other repos). This file covers only what this branch's work touches, verified 2026-09-28 against
`/Users/yanbarros/Documents/GitHub/pp-release-061` (branch `feat/validation-batch4`).
VERIFIED = read in code; INFERRED = interpretation.

## 1. Problem definition — `pinneapple_physics/pde_environment/`

VERIFIED:
- `spec.py`: frozen dataclasses `PDETermSpec(kind, fields, coords, params, meta)` and
  `ProblemSpec(name, dim, coords, fields, pde, conditions, ...)`.
- `conditions.py`: **`DirichletBC`, `NeumannBC`, ... are FACTORY FUNCTIONS returning a
  `ConditionSpec`, not classes.** Never `isinstance(x, DirichletBC)` — check `cond.kind ==
  "dirichlet"`. This is the #1 bug pattern found in this branch's own work (see
  FAILED_APPROACHES.md) — it will bite anyone who writes a new spec-driven solver.
- `builder.py`: the fluent builder's canonical contract: `selector(X: np.ndarray, ctx) -> bool
  mask`, `value_fn(X: np.ndarray, ctx) -> (N, n_fields) array`; tag selectors are dicts like
  `{"tag": "boundary"}`. Older call sites instead pass a one-argument callable on a torch tensor
  ("legacy" convention) — both exist in the wild.

## 2. The shared Dirichlet-condition helper — `pinneapple_simulation/numerical_solvers/_bc.py` (NEW)

VERIFIED (written this session): `dirichlet_conditions(spec)`, `select(cond, pts, edges, boundary)`,
`values(cond, pts, field)`, `boundary_rect(nodes, edges)`. Any grid/node-based solver that reads a
`ProblemSpec`'s Dirichlet conditions (currently `fem.py`, `meshfree.py`) should go through this
module rather than re-implementing condition dispatch, to avoid re-introducing the `isinstance` bug.

`_call(fn, pts)` dispatches between the two calling conventions above by **inspecting `fn`'s
signature** (`inspect.signature(fn).bind(None, None)`), not by calling `fn` and catching
`TypeError` — catching would also swallow a real `TypeError` raised from inside a well-formed
2-argument `fn` and misreport it as an arity mismatch (this exact thing happened while writing
this branch's tests — see FAILED_APPROACHES.md). **Gotcha for whoever writes a selector/value_fn
next:** if it has a second parameter with a default (e.g. `def sel(p, tol=1e-6)`), the arity check
will treat it as `(X, ctx)`-shaped and pass `ctx={}` as `tol` — keep such parameters keyword-only
(`def sel(p, *, tol=1e-6)`) if the function is also meant to be called positionally elsewhere.

## 3. Physics-loss compilation — `pinneapple_physics/pinn_solver/compiler/compile.py`

VERIFIED: `compile_problem(spec, weights=None)` returns `loss_fn(model, y_hat, batch) -> dict` with
keys including `"pde"` and `"total"`. `batch` keys: `x_col, ctx, x_bc, y_bc, x_ic, y_ic, x_data,
y_data`; `ctx` may carry `body_force_fn(X_np, ctx)`. The residual for each PDE `kind` is one branch
of a large `if/elif` chain. This branch touched exactly one: `hyperelasticity_neo_hookean` (see
SCIENTIFIC_CONTEXT.md for the physics; short version: it now differentiates the first
Piola-Kirchhoff stress P in REFERENCE coordinates, `Div_X P + b0 = 0`, not the Cauchy stress — the
two are related by the Piola identity `Div_X P = J div_x sigma`, and are NOT interchangeable when
differentiated naively in reference coordinates).

## 4. Solvers touched by this branch — `pinneapple_simulation/numerical_solvers/`

VERIFIED:
- `fem.py` (`FEMSolver`): Q1 quad elements, Poisson/Helmholtz/axisymmetric elasticity, CG or direct
  solve. Now reads Dirichlet conditions via `_bc.py` (previously via a broken `isinstance` check).
- `meshfree.py` (`RBFCollocationSolver`, the Kansa method): kernels `gaussian`, `multiquadric`,
  `imq`, `thin_plate`. **The multiquadric analytical Laplacian formula was wrong** — it used
  `(d-2)` where the correct radial-Laplacian formula needs `(d-1)`, for `phi = sqrt(1+eps^2 r^2)`
  in d dimensions (fixed this session; see SCIENTIFIC_CONTEXT.md for the derivation and measured
  before/after errors). Also now reads Dirichlet conditions via `_bc.py`, and its internal matrices
  (`A`, `rhs`) now use the input points' dtype instead of being hardcoded to float32.
- `eddy_current_fdm.py`: axisymmetric magnetostatic/eddy-current FDM (complex Helmholtz-type
  system for the azimuthal vector potential A). `axial_flux_density` had the wrong sign (returned
  `-B_z`) and silently dropped the imaginary (quadrature) part for complex A — fixed.
- `immersed_boundary_fdm.py`: **not modified**, but its "channel" boundary-condition mode was found
  NOT to conserve mass (flow rate falls to ~34% of inlet along a pipe) — documented in the module's
  own docstring rather than fixed (needs a pressure-Poisson projection instead of the current
  divergence-penalty relaxation — a real, separate piece of work). Catalog item S12 stays untested.

## 5. Catalog / validation governance — `pinneapple_catalog/`, `scripts/build_method_status.py`

VERIFIED: `pinneapple_catalog/methods.py` holds `METHODS`, built with `_m(id, name, code, probes,
refs_in_code, refs_added, equations)`. `scripts/build_method_status.py` scans every `def
test_...` function in `tests/` (plus `PINNeAPPle-CFD/tests` via `PINNEAPPLE_CFD_TESTS`); an item is
"exercised" if one of its `probes` strings appears in the test body (or is imported and the
imported name is used); it's a *reference* test (→ `validated`) if the same body also matches a
regex for exact/closed-form/manufactured/published/tabulated comparison. `OVERRIDES` records manual
corrections to the automatic scan, each with a written reason — this branch added two (`P2.8`,
`P6.6`: a preset's own geometry/BCs aren't validated just because its underlying PDE `kind` is) and
tightened one existing probe (`T5`: was accidentally matching the substring `"two_phase"` inside
`"buckley_leverett_two_phase"`).

## 6. Release mechanics (INFERRED from doing it twice this session — see DECISIONS.md D11)

No `publish.yml` GitHub workflow exists — release is manual. Version string must be updated in 4
places (`pyproject.toml`, `pinneapple/__init__.py`, `README.md`'s BibTeX block, `CITATION.cff` incl.
`date-released`) — easy to miss one; grep for the old version string across all 4 before tagging.
