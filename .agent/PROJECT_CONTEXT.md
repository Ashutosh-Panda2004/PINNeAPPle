# PROJECT_CONTEXT — PINNeAPPle, release/validation branch

Written 2026-09-28 as a handoff for a coding agent (e.g. OpenCode) picking up **specifically the
work done on this git worktree/branch**, not the whole PINNeAPPle project in general.

**IMPORTANT — there are two independent `.agent/` packages, written by two different sessions
working concurrently on this repo:**
1. **This one**, at `pp-release-061/.agent/` (worktree path — see below), branch
  `feat/validation-batch4`. Scope: the PyPI release pipeline and the method-catalog validation
  work (items "1" and "2" of the owner's 2026-09-24 request ledger, `docs/dev/PEDIDOS_2026-09-24.md`).
  Everything here was verified against this branch on 2026-09-28.
2. **A second one**, at `/Users/yanbarros/Documents/GitHub/pinneapple-labs/PINNeAPPle/.agent/`
  (the shared **main** checkout — a *different* clone, currently on commit `b44c0ff0`, the 0.6.0
  base, with its own separate uncommitted work: terramechanics, a Transolver neural-operator
  integration, an OpenRadioss bridge). That package describes the whole ecosystem/project at a
  higher level and is NOT aware of this branch's work (it still says "version 0.6.0", "dist/ has a
  stale 0.5.0 wheel" — both stale relative to this branch). Read it for ecosystem-wide context
  (ROADMAP.md, GenAItor, the compatibility shims, etc.), but for anything about the PyPI release,
  PR #15/#16, or the method-validation batches, **this package is the current source**, not that one.
  Do not merge the two blindly — they describe different, only partially-overlapping bodies of work.

## 1. What this is

- **Name:** PINNeAPPle. PyPI package `pinneapple`. GitHub org `PINNeAPPle-Labs`, repo `PINNeAPPle`.
- **This worktree:** `/Users/yanbarros/Documents/GitHub/pp-release-061`, a `git worktree` checked
  out from `origin/main`, currently on branch `feat/validation-batch4` (3 commits ahead of
  `origin/main`, plus uncommitted fixes — see CURRENT_STATE.md).
- **Latest PUBLISHED release:** `0.6.1` on PyPI (pypi.org/project/pinneapple/0.6.1/), published
  2026-09-27. This branch prepares `0.6.2` (not yet released — see CURRENT_STATE.md for exactly
  what's blocking it).
- **License:** Apache-2.0. Some modules are research-only and runtime-gated (see DECISIONS.md).

## 2. Purpose

A Python library for physics-informed ML: PDE problem definition, a physics-loss compiler (PDE
residuals via autograd), PINN/neural-operator/GNN architectures, trainers, UQ, digital twins,
classical numerical solvers (FDM/FEM/FVM/LBM/spectral/SPH/...), external-solver bridges (OpenFOAM,
CalculiX, FEniCS, FMI, MuJoCo...), geometry/CAD, design optimisation, an "arena" benchmark runner,
and a model hub.

## 3. What THIS branch/session is doing (the actual scope of this handoff)

The owner's standing instruction (`docs/dev/PEDIDOS_2026-09-24.md`): keep the **method catalog**
honest. Every catalog item (solver / training method / equation / problem preset) should reach
`validated` = a test compares it with an independent reference (closed form, manufactured
solution, published/tabulated value), in the same test function that exercises it. This branch is
mid-way through **validation batch 4**: 9 more catalog items moved from untested/tested to
validated (84 validated total, up from 75 at the 0.6.1 release), and it found + fixed 4 real bugs
along the way (see FAILED_APPROACHES.md and SCIENTIFIC_CONTEXT.md). Along the way it also found and
fixed 3 more, unrelated, test-infrastructure bugs (see FAILED_APPROACHES.md).

The other half of this branch's job is the **PyPI release pipeline**: build from a merged
`origin/main`, smoke-test the wheel in a clean venv, `twine check`/`upload`, tag. This already
happened once this session for 0.6.1 (see DECISIONS.md D11), and is queued again for 0.6.2 once
batch 4 is merged.

## 4. Target users / use cases

Same as the general PINNeAPPle project (see the other `.agent/` package's PROJECT_CONTEXT.md for
the full picture: Explorer/Experimenter/Builder tiers, industrial verticals via sibling repos like
PINNeAPPle-CFD). Nothing branch-specific to add here.

## 5. Technologies

Same stack as the rest of the repo (Python ≥3.10, torch ≥2.2, hatchling build backend — see
ARCHITECTURE.md §5 for the full dependency list). One thing specific to this branch's testing:
**the dev machine is an Apple Silicon Mac**, and a pre-existing, unrelated bug in the test suite
leaks the global default PyTorch device to `"mps"` between test files in a full `pytest tests/`
run (see FAILED_APPROACHES.md — this cost significant time this session and will bite the next
agent too if not understood).

## 6. Repository structure

Same ~24-package layout as the rest of PINNeAPPle (see ARCHITECTURE.md). Files touched by this
branch specifically: `pinneapple_simulation/numerical_solvers/{fem,meshfree,eddy_current_fdm,
immersed_boundary_fdm,_bc}.py`, `pinneapple_physics/pinn_solver/compiler/compile.py` (one residual
branch), `pinneapple_systems/process_components/similarity_map.py` (read only, validated not
changed), `pinneapple_catalog/{methods.py,method_status.json}`, `scripts/build_method_status.py`,
`docs/dev/{PEDIDOS_2026-09-24.md,CATALOGO_METODOS.md}`, plus two new test files
(`tests/test_manufactured_solutions_batch4.py`, `tests/test_solver_exact_solutions_batch4.py`) and
one new module (`pinneapple_simulation/numerical_solvers/_bc.py`).

## 7. How it is run / tested / built (branch-specific notes)

- **This worktree's Python:** tests are run against
  `/Users/yanbarros/Documents/GitHub/pinneapple-labs/PINNeAPPle/.venv/bin/python` (the *main*
  checkout's venv, reused across worktrees) with `PYTHONPATH=$PWD` from inside
  `pp-release-061` so imports resolve to *this* checkout's code, not the installed package.
- **Method catalog regeneration** (after touching any solver/equation covered by a catalog probe):
  ```
  export PINNEAPPLE_CFD_TESTS=/Users/yanbarros/Documents/GitHub/pinneapple-labs/PINNeAPPle-CFD/tests
  python scripts/build_method_status.py            # -> pinneapple_catalog/method_status.json
  python scripts/build_method_status.py --markdown  # -> docs/dev/CATALOGO_METODOS.md
  ```
- **Regression discipline established this session:** don't trust an isolated test-file run alone —
  rerun the full relevant set (see CURRENT_STATE.md for the exact file list used) and diff the SET
  of failing test IDs against the previous run, not just the count (this is how the MPS leak's
  blast radius was distinguished from real regressions — see FAILED_APPROACHES.md).
- **Release steps:** see DECISIONS.md D11 for the exact sequence (merge → fresh worktree from
  `origin/main` → `uv build` → smoke-test wheel in a clean venv → `twine check`/`upload` → tag).
