# CURRENT_STATE — PINNeAPPle, validation batch 4

Snapshot 2026-09-28, this worktree (`/Users/yanbarros/Documents/GitHub/pp-release-061`, branch
`feat/validation-batch4`). Update this file (don't append a second snapshot) as state changes.

## Git state

- **Base:** `origin/main` at `1dfc86c4` (0.6.1 release + the packaging fix, PR #16).
- **3 commits ahead**, not yet pushed / no PR opened yet:
  - `23bdf1cb` — Validation batch 4: FEM, Kansa, eddy current, similarity map + 5 compiled equations
  - `693590de` — Bump version to 0.6.2
  - (the version bump was committed BEFORE the post-hoc regression testing below found the 3 bugs in
    items 4-6 of FAILED_APPROACHES.md — those fixes are still **uncommitted**, see below)
- **Uncommitted changes** (working tree, not yet committed):
  - `pinneapple_simulation/numerical_solvers/_bc.py` — signature-inspection fix (FAILED_APPROACHES #5)
  - `tests/test_manufactured_solutions_batch4.py` — added the CPU-device autouse fixture
  - `tests/test_solver_exact_solutions_batch4.py` — added the CPU-device fixture + made
    `_on_boundary`'s `tol` keyword-only (FAILED_APPROACHES #6)
- **No PR opened yet** for this branch (`gh pr list --head feat/validation-batch4` is empty).

## What's actually verified vs. pending

**Verified (isolated run, this session):** the 16 new batch-4 tests
(`tests/test_manufactured_solutions_batch4.py` + `tests/test_solver_exact_solutions_batch4.py`)
pass cleanly in isolation, both before AND after simulating the MPS device leak (confirmed the new
fixture protects them — see FAILED_APPROACHES.md #7's methodology).

**Verified (first full 37-file regression run, `pp-batch4-tests.log`, BEFORE the 3 test-infra
fixes):** 786 passed, 80 failed, 155 skipped, 1 xfailed. Of the 80 failures, 6 were this branch's
own new tests (all traced to the MPS leak + the 2 real `_bc.py`/`_on_boundary` bugs above); the
other ~74 were spot-checked (10+ samples across 6 different files) and every single one traced to
the same MPS leak — see FAILED_APPROACHES.md #7 for the full investigation.

**IN PROGRESS as of this snapshot — not yet confirmed:** a second full 37-file run
(`pp-batch4-tests-v2.log`) with the 3 uncommitted fixes applied, to get an actual before/after diff
of the failing-test-ID **set** (not just the count — see DECISIONS.md D7). Expected result: exactly
the 6 batch-4 tests flip from FAIL to PASS, and the ~74 pre-existing MPS-leak failures are
unchanged. **The next agent picking this up MUST check whether this run finished and whether the
diff matches that expectation before doing anything else** — see SESSION_HANDOFF.md.

## Catalog numbers

- **Before this branch (0.6.1, released):** 75 validated / 53 tested / 51 untested.
- **After batch 4 (commit `23bdf1cb`):** 84 validated / 53 tested / 42 untested. (`method_status.json`
  was regenerated with `PINNEAPPLE_CFD_TESTS=/…/PINNeAPPle-CFD/tests`.)
- Two catalog items were flipped to `tested` (not `validated`) via `OVERRIDES`, with reasons, rather
  than being counted as validated by accident: `P2.8`, `P6.6` (a preset ≠ its PDE `kind` alone).
- `T5`'s probe was tightened (was falsely matching inside `buckley_leverett_two_phase`'s substring).

## Known, unfixed, documented (not blocking this branch)

- `immersed_boundary_fdm.py`'s "channel" mode doesn't conserve mass (documented in its own
  docstring). Catalog item S12 stays untested. See SCIENTIFIC_CONTEXT.md §4.
- The MPS test-isolation leak (FAILED_APPROACHES.md #7) — pre-existing, not caused by this branch,
  root cause not found, ~74 tests fail under a full-suite run but pass in isolation.

## PyPI

- **0.6.1 is published** (pypi.org/project/pinneapple/0.6.1/), released earlier this session.
- **0.6.2 is NOT yet published.** Blocked on: commit the 3 pending fixes → push → open PR → CI green
  → merge → rebuild from merged `origin/main` → smoke-test → `twine upload` → tag `v0.6.2`. See
  TODO.md and SESSION_HANDOFF.md for the exact next steps.
