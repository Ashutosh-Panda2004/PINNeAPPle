# FAILED_APPROACHES — PINNeAPPle, validation batch 4

Real bugs found this session (all reproduced fresh, not recalled from memory), and one
investigation that was deliberately abandoned with reasoning for why. Format: what was
tried/found → why it was wrong → what fixed it → lesson.

## 1. Multiquadric RBF Laplacian used `(d-2)` instead of `(d-1)`

**What shipped first:** `_rbf_laplacian_mq` computed `Delta phi = eps^2 (d + (d-2) eps^2 r^2) /
phi^3` for the multiquadric kernel `phi(r) = sqrt(1+eps^2 r^2)`.
**Why it was wrong:** the correct radial Laplacian in d dimensions is `phi'' + (d-1) phi'/r`, not
`phi'' + (d-2) phi'/r` — off by one in the angular term. Kansa collocation using this kernel
solved `-lap u = -4` (exact solution `u=x^2+y^2`) and the max error was **stuck around 0.06**
regardless of mesh refinement (n=8 and n=16 gave essentially the same error) — a clear "wrong
equation, not insufficient resolution" signature, since a real discretization error should shrink
with refinement.
**What fixed it:** `(d-1)`. Verified two ways: (a) independent autograd check — differentiate the
same `phi(x-c)` twice with `torch.autograd.grad` and compare to the closed form, `atol=1e-12`
(`test_multiquadric_laplacian_matches_autograd`); (b) the Kansa solver now converges, n=8->16 error
6.6e-4 -> 1.8e-5.
**Lesson:** "error doesn't shrink with refinement" is a strong, cheap signal that the *equation*
being solved is wrong, not that more resolution is needed — worth checking before assuming a
convergence-rate or conditioning problem.

## 2. Neo-Hookean residual differentiated the Cauchy stress in reference coordinates

See SCIENTIFIC_CONTEXT.md §2 for the derivation. Short version: **what shipped first** built
`sigma = P F^T / J` (correct Cauchy stress formula) and then computed `Div_X sigma` — differentiating
it with respect to the REFERENCE coordinates X, even though `sigma` is naturally a function of
CURRENT (deformed) coordinates. **Why it was wrong:** the Piola identity `Div_X P = J div_x sigma`
relates the two divergences taken in their OWN natural coordinate systems; differentiating sigma
w.r.t. X is neither side of that identity. **What fixed it:** compute `Div_X P` directly (P is
already naturally a function of X). Measured: manufactured-solution residual 0.028 -> 4.5e-32 on
the identical field. **Lesson:** in finite-strain continuum mechanics, always double-check which
configuration (reference vs current) a differential operator is meant to act in before writing
`grad`/`div` — the two stress measures (Cauchy sigma vs first Piola-Kirchhoff P) are NOT
interchangeable once you start differentiating.

## 3. `axial_flux_density` had the wrong sign and dropped the imaginary part

**What shipped first:** `return -(A.real / (RR + 1e-30) + dAdr)` — used only `A.real` (discarding
the quadrature/imaginary part of a complex phasor A) and negated the result.
**Why it was wrong:** the axisymmetric curl relation is `B_z = A/r + dA/dr` (no minus sign), and for
a time-harmonic problem A is genuinely complex — dropping the imaginary part silently discards half
the physical information (the phase/quadrature component of the induced field).
**What fixed it:** `return A / (RR + 1e-30) + dAdr` on the full complex A, with `np.gradient(...,
edge_order=2)` for better boundary accuracy. **Verified:** `A = B0 r / 2` (a uniform axial field,
including a complex `B0` to check the imaginary part survives) now gives exactly `B_z = B0` to
1e-10 relative.
**Lesson:** a function whose docstring only ever exercised `A.real` outputs can hide a sign error
(a negated real number can even look "plausible" for a naive check) — the manufactured test used a
complex `B0` specifically to catch the dropped-imaginary-part bug, which a real-only test would not.

## 4. FEM/Kansa solvers crashed on any Dirichlet condition — `isinstance` against a factory function

**What shipped first (from an earlier session, batch 3 or before):** `if isinstance(cond,
DirichletBC): ...` inside `fem.py`/`meshfree.py`.
**Why it was wrong:** `DirichletBC` (in `pinneapple_physics/pde_environment/conditions.py`) is a
FACTORY FUNCTION that returns a `ConditionSpec` — not a class. `isinstance(x, DirichletBC)` raises
`TypeError: isinstance() arg 2 must be a type...` immediately, so these solvers could never
actually accept a boundary condition through the normal `ProblemSpec` path.
**What fixed it:** a new shared module (`_bc.py`) that checks `cond.kind == "dirichlet"` and
dispatches value/selector callables via signature inspection (see #5 below). **Lesson:** this same
`isinstance`-against-a-factory bug pattern is worth grepping for anywhere else in the codebase that
reads `ProblemSpec.conditions` — it's an easy mistake to repeat since `DirichletBC` LOOKS like a
class from its call site (`DirichletBC("wall", ...)`).

## 5. `_bc._call`'s first version caught `TypeError` around calling `fn`, not around its signature

**What was tried:** dispatch between the builder's `(X, ctx)` convention and the legacy one-arg
convention with `try: return fn(X_np, ctx) \n except TypeError: return fn(pts)`.
**Why it failed:** while writing `test_fem_accepts_builder_style_conditions_and_edge_tags`, a
`TypeError` raised from INSIDE a correctly-2-argument lambda (because `torch.as_tensor(X).numpy()`
failed on an MPS-device tensor — see #7 below) was silently caught and reinterpreted as "fn must
be 1-argument", producing a confusing SECOND error ("missing 1 required positional argument:
'ctx'") that had nothing to do with the real problem.
**What fixed it:** inspect the signature instead of executing and catching:
`inspect.signature(fn).bind(None, None)` raises `TypeError` (arity mismatch) without ever calling
`fn`'s body, so a real exception from inside `fn` now propagates normally.
**Lesson:** never use `try/except TypeError` (or any broad exception type) to detect "this callable
has the wrong arity" — it's indistinguishable from a real `TypeError` raised during execution.
Signature introspection is the correct tool for this.

## 6. `_on_boundary(p, tol=1e-6)`'s own signature was accidentally 2-positional-argument-compatible

**What was tried:** a plain helper `def _on_boundary(p, tol=1e-6): ...` used both directly
(`_on_boundary(P)`, one argument) and as a `ProblemSpec` selector (where `_bc._call` would
introspect it).
**Why it failed:** `inspect.signature(_on_boundary).bind(None, None)` SUCCEEDS (both `p` and `tol`
can be bound positionally, `tol`'s default doesn't prevent that), so `_call` treated it as the
`(X, ctx)` builder form and passed `ctx={}` as `tol` — then `p[:, 0] < tol` raised `TypeError: '<'
not supported between float and dict` (a clear, correct error, but only after being confused for
one build).
**What fixed it:** make `tol` keyword-only: `def _on_boundary(p, *, tol=1e-6)`. Now
`bind(None, None)` correctly fails (too many positional args), and `_call` uses the legacy 1-arg
path. **Lesson:** any helper meant to be called with exactly one positional argument, that ALSO
gets passed as a `ProblemSpec` selector/value_fn (arity-inspected by `_bc.py`), needs every other
parameter to be keyword-only — an innocent-looking optional positional parameter is enough to
trigger the wrong dispatch branch.

## 7. The pre-existing MPS-default-device test leak — investigated, root cause NOT found, deliberately stopped

**What happens:** running the full batch-4-relevant test set (37 files) end to end produces 80
failures; running any of the new/touched test files in isolation, 0 failures. All ~80 failures
share the identical signature: some earlier test leaves PyTorch's **global default device** set to
`"mps"` (Apple GPU), so any later bare `torch.rand(...)`, `torch.linspace(..., dtype=torch.float64)`
(MPS doesn't support float64), or `.numpy()` call on an unmoved result fails.
**Confirmed pre-existing:** exists on `origin/main` before this branch (in
`tests/test_gradient_backend_consistency.py`'s own defensive fixture, which predates this branch's
first commit — `git log` confirms). **Independently confirmed** by a concurrent session's
`.agent/FAILED_APPROACHES.md` (main checkout), which describes the exact same symptom for a
different pair of tests (`test_calibration_component_*`) and says it wasn't root-caused either.
**What was tried to find the source:**
- `grep -rn "set_default_device"` across `pinneapple_*` and `tests/` — the ONLY hit is the
  properly-scoped fixture in `test_gradient_backend_consistency.py` itself (saves/restores).
- `grep -rn "with torch.device("` — no hits (so it's not an un-exited `with` block written that way).
- Checked `tests/conftest.py` (trivial, no device logic) and `pinneapple_data/device.py` (a
  per-tensor `.to(device)` mover, never touches the global default) and the two top-level package
  `__init__.py` files that showed up in a broader `torch.device(` grep (both just construct a local
  `torch.device` object, no global side effect).
- **Found evidence it's not a SINGLE leak point:** the `torch.utils._device.DeviceContext` object's
  Python `id()` differs between different failure sites in the same run (`0x155f6ff20` in one
  cluster, `0x12ccb67b0` in another) — meaning the leaked context gets pushed more than once by
  different code paths, not "one test sets it once near the start and nothing ever resets it".
**Why the investigation was stopped:** with no `set_default_device`/`with torch.device(` call found
anywhere and multiple distinct leaked contexts, the actual mechanism is likely inside a third-party
library or a `TorchFunctionMode` push/pop imbalance triggered under specific conditions (e.g. an
exception path, or a fixture/generator that isn't closed) — an open-ended search across the whole
test suite and possibly PyTorch's own internals, unbounded in scope and clearly outside "finish
batch 4 + release 0.6.2".
**What was done instead:** confirmed (by re-running the full 37-file set after the fact) that this
branch's changes introduce exactly 0 new failures and fix exactly the 6 batch-4 tests that were
failing because of it (via a local defensive fixture, not a fix of the leak itself) — see
CURRENT_STATE.md for the actual before/after diff. **If someone picks this up:** the next concrete
step would be to run with `python -X importtime` or a `sys.settrace`/`faulthandler`-based approach
to find exactly which test's teardown order coincides with the first pollution, or to bisect the
37-file list by running growing prefixes until the first failure appears — this session did not
have the time budget to do that bisection.
