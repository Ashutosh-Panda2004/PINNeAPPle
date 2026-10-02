# TODO — PINNeAPPle, validation batch 4 / 0.6.2 release

Ordered by dependency, not importance — do them roughly top to bottom.

## Blocking the 0.6.2 release (do these first)

- [ ] **Check whether the background regression rerun finished** (`pp-batch4-tests-v2.log` in
  `/Users/yanbarros/Documents/GitHub/`). If it hasn't, wait for it — do not skip this check.
  Compare its `FAILED` test-ID set against `pp-batch4-tests.log`'s (the pre-fix run). Expected: the
  6 batch-4 tests flip to passing, nothing else changes. If something ELSE changed (a test that
  passed before now fails, or vice versa outside the 6), STOP and investigate before committing —
  that would mean the 3 "fixes" had a side effect not accounted for in FAILED_APPROACHES.md.
- [ ] Commit the 3 pending fixes (`_bc.py`, the two test files) with a clear message referencing
  FAILED_APPROACHES.md items 5-6, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- [ ] Push the branch, open a PR against `origin/main` (title referencing "validation batch 4"),
  body summarizing: +9 validated methods, 4 real solver/compiler bugs fixed, the MPS-leak
  investigation finding (worth mentioning even though not fixed — it's valuable information for
  reviewers), 3 test-infrastructure bugs fixed.
- [ ] Wait for CI (`.github/workflows/tests.yml`) — remember only
  `tests/test_manufactured_solutions.py` blocks the workflow; the rest runs with
  `continue-on-error: true`, so CI going green does NOT mean the full suite is clean (see
  ARCHITECTURE.md / the main checkout's PROJECT_CONTEXT.md §7 for why).
- [ ] Merge the PR.
- [ ] Fresh worktree from the merged `origin/main` (NOT `$TMPDIR` — see DECISIONS.md D9), `uv
  build`, install the wheel in a clean venv, smoke-import (`pinneapple.__version__ == "0.6.2"`,
  plus a handful of modules touched this batch: `pinneapple_simulation.numerical_solvers.fem`,
  `.meshfree`, `.eddy_current_fdm`).
- [ ] `uvx twine check dist/*`, then `uvx twine upload dist/*`.
- [ ] Confirm on pypi.org/project/pinneapple/0.6.2/, tag `v0.6.2`, push the tag.
- [ ] Update this file's "done" section and CURRENT_STATE.md once released.

## Method catalog (item 2 of the owner's standing request, ongoing across many sessions)

- [ ] Continue validation batches. Still untested (42) / tested-without-reference (53) as of this
  branch — get the current split with
  `python -c "import json;d=json.load(open('pinneapple_catalog/method_status.json'))['methods']; ..."`
  (see `docs/dev/CATALOGO_METODOS.md` for the human-readable table) rather than trusting the number
  in CURRENT_STATE.md, which will go stale.
- [ ] `immersed_boundary_fdm.py`'s channel mode needs a real pressure-Poisson projection step to
  conserve mass (see SCIENTIFIC_CONTEXT.md §4) before S12 can be validated — this is nontrivial
  numerical-methods work, not a quick fix.

## Explicitly out of scope for this branch (don't pick up casually)

- [ ] The MPS test-isolation leak (FAILED_APPROACHES.md #7) — real, worth fixing eventually (it's
  silently hiding the true pass/fail state of ~74 tests), but needs a dedicated
  investigation/bisection session, not a side quest during a release.
- [ ] Reconciling this `.agent/` package with the other one in the main checkout (see
  PROJECT_CONTEXT.md's note at the top) — that's a decision for the project owner, not something
  to auto-merge.

## Blocked on other work (not this branch's job)

- [ ] PINNeAPPle-CFD's `erosao_3d` route → `pinneapple_twin3d.openfoam` integration (waits on a
  merge in progress in a different, concurrent session's worktree there).
- [ ] OpenRadioss virtual-solver bridge (exists only as another session's uncommitted work in the
  main PINNeAPPle checkout, per that checkout's own `.agent/` notes).
