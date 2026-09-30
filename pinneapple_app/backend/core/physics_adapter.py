"""Physics adapters: turn a ``ProblemDefinition`` into a trainable physics loss.

The experiment runner used to call ``compile_problem``'s loss with the wrong
arguments (``physics_fn(model, x_col, {})``), which raised inside a bare
``try/except`` every epoch -- so no physics loss was ever applied -- and it
replaced every boundary condition with ``u = 0``. Custom problems got a
``(pred ** 2).mean() * 0.0`` placeholder. This module is the replacement:

* :class:`PresetPhysics` builds the batch ``compile_problem`` actually expects
  (``x_col``, ``x_bc``/``n_bc``/``x_ic`` and one ``mask_<condition>`` per
  condition), with boundary/initial points placed exactly on the faces of the
  preset's box domain so the presets' own selectors and value functions apply.
* :class:`CustomPhysics` compiles user equations such as ``"u_xx + u_yy"``
  through :class:`pinneapple_physics.symbolic_pde.SymbolicPDE` and enforces
  Dirichlet/Neumann boundary and initial conditions.

Anything that cannot be applied (e.g. a ``"tag"`` condition naming real
geometry such as ``"fin_surfaces"``) is listed in ``unresolved`` instead of
being silently dropped, so the report can flag it.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch

Bounds = Dict[str, Tuple[float, float]]
Face = Tuple[str, str]  # (coordinate, "min" | "max")

# Tags that have an unambiguous meaning on an axis-aligned box domain. The
# inlet/outlet/walls convention matches
# pinneapple_simulation.numerical_solvers.problem_runner._sample_boundary_tag.
_BOX_TAGS = ("boundary", "inlet", "left", "outlet", "right", "walls", "wall",
             "top", "lid", "bottom")

_BC_KINDS = ("dirichlet", "neumann", "robin", "interface")


def unwrap(out: Any) -> torch.Tensor:
    """Model output -> plain (N, F) tensor (PINNOutput/ModelOutput carry ``.y``)."""
    y = out.y if hasattr(out, "y") else out
    if y.ndim == 1:
        y = y[:, None]
    return y


class _TensorModel(torch.nn.Module):
    """Wraps a model so ``forward`` always returns a plain tensor."""

    def __init__(self, model: torch.nn.Module):
        super().__init__()
        self.model = model

    def forward(self, x):
        return unwrap(self.model(x))


# ── Box-domain geometry ──────────────────────────────────────────────────────

def spatial_coords(coords: Sequence[str]) -> List[str]:
    return [c for c in coords if c != "t"]


def all_faces(coords: Sequence[str]) -> List[Face]:
    return [(c, side) for c in spatial_coords(coords) for side in ("min", "max")]


def faces_for_tag(tag: str, coords: Sequence[str]) -> Optional[List[Face]]:
    """Box-face convention for the tags in ``_BOX_TAGS``; ``None`` otherwise."""
    sp = spatial_coords(coords)
    if not sp:
        return None
    tag = tag.lower()
    if tag == "boundary":
        return all_faces(coords)
    if tag in ("inlet", "left"):
        return [(sp[0], "min")]
    if tag in ("outlet", "right"):
        return [(sp[0], "max")]
    if len(sp) < 2:
        return None
    if tag in ("walls", "wall"):
        return [f for f in all_faces(coords) if f[0] != sp[0]]
    if tag in ("top", "lid"):
        return [(sp[-1], "max")]
    if tag == "bottom":
        return [(sp[-1], "min")]
    return None


def sample_faces(
    bounds: Bounds, coords: Sequence[str], faces: Sequence[Face], n: int,
    rng: np.random.Generator,
) -> Tuple[np.ndarray, np.ndarray]:
    """Uniform points on the given box faces, with outward unit normals.

    Points are split across faces in proportion to face measure; the time
    coordinate (if any) is sampled over its whole range.
    """
    coords = list(coords)
    sp = spatial_coords(coords)
    measures = []
    for c, _ in faces:
        m = 1.0
        for o in sp:
            if o != c:
                m *= bounds[o][1] - bounds[o][0]
        measures.append(max(m, 1e-12))
    measures = np.asarray(measures) / np.sum(measures)
    counts = np.maximum(1, np.round(measures * n).astype(int))

    xs, ns = [], []
    for (c, side), k in zip(faces, counts, strict=True):
        X = np.empty((k, len(coords)), dtype=np.float32)
        for i, name in enumerate(coords):
            lo, hi = bounds[name]
            X[:, i] = rng.uniform(lo, hi, k)
        ci = coords.index(c)
        X[:, ci] = bounds[c][0] if side == "min" else bounds[c][1]
        N = np.zeros_like(X)
        N[:, ci] = -1.0 if side == "min" else 1.0
        xs.append(X)
        ns.append(N)
    return np.concatenate(xs), np.concatenate(ns)


def sample_initial(bounds: Bounds, coords: Sequence[str], n: int,
                   rng: np.random.Generator) -> np.ndarray:
    coords = list(coords)
    X = np.empty((n, len(coords)), dtype=np.float32)
    for i, name in enumerate(coords):
        lo, hi = bounds[name]
        X[:, i] = lo if name == "t" else rng.uniform(lo, hi, n)
    return X


def sample_interior(bounds: Bounds, coords: Sequence[str], n: int,
                    rng: np.random.Generator) -> np.ndarray:
    coords = list(coords)
    X = np.empty((n, len(coords)), dtype=np.float32)
    for i, name in enumerate(coords):
        lo, hi = bounds[name]
        X[:, i] = rng.uniform(lo, hi, n)
    return X


def characteristic_length(bounds: Bounds, coords: Sequence[str]) -> float:
    """Mean spatial extent (time extent for ODE-only problems)."""
    ext = [bounds[c][1] - bounds[c][0] for c in spatial_coords(coords)]
    if not ext and "t" in bounds:
        ext = [bounds["t"][1] - bounds["t"][0]]
    return float(np.mean(ext)) if ext else 1.0


# ── Common interface ─────────────────────────────────────────────────────────

@dataclass
class ConditionInfo:
    key: str               # loss-term key, e.g. "bc_inlet" / "ic_u_init"
    name: str
    kind: str              # dirichlet | neumann | initial | ...
    fields: Tuple[str, ...]
    weight: float          # effective multiplier applied to the raw MSE
    n_points: int = 0
    how: str = ""          # how the points were placed
    target_rms: float = 0.0  # RMS of the prescribed value (dirichlet/initial scale)


class PhysicsAdapter:
    """Shared interface used by the experiment runner and the report."""

    label: str = ""
    pde_kind: str = ""
    coords: List[str]
    fields: List[str]
    bounds: Bounds
    w_pde: float = 1.0
    pde_params: Dict[str, Any] = {}
    field_ranges: Dict[str, Tuple[float, float]] = {}

    def __init__(self):
        self.conditions: Dict[str, ConditionInfo] = {}
        self.unresolved: List[Dict[str, str]] = []
        self.warnings: List[str] = []

    def build_batch(self, x_col: np.ndarray, n_bnd: int, n_ic: int, seed: int,
                    device: torch.device) -> Dict[str, Any]:
        raise NotImplementedError

    def loss(self, model, batch) -> Tuple[torch.Tensor, Dict[str, float]]:
        """Return (total differentiable loss, raw per-term MSE values)."""
        raise NotImplementedError

    def weighted(self, raw: Dict[str, float]) -> Dict[str, float]:
        out = {}
        for k, v in raw.items():
            if k == "pde":
                out[k] = self.w_pde * v
            elif k in self.conditions:
                out[k] = self.conditions[k].weight * v
        return out



# ── Preset problems (compile_problem) ────────────────────────────────────────

class PresetPhysics(PhysicsAdapter):
    def __init__(self, spec, *, w_physics: Optional[float] = None,
                 w_bc: Optional[float] = None):
        super().__init__()
        from pinneapple_physics.pinn_solver import LossWeights, compile_problem

        base = LossWeights()
        self.lw = LossWeights(
            w_pde=base.w_pde if w_physics is None else float(w_physics),
            w_bc=base.w_bc if w_bc is None else float(w_bc),
            w_ic=base.w_ic if w_bc is None else float(w_bc),
            w_data=base.w_data,
        )
        self.spec = spec
        self.label = spec.name or "preset"
        self.pde_kind = spec.pde.kind
        self.coords = list(spec.coords)
        self.fields = list(spec.fields)
        self.bounds = {c: tuple(map(float, spec.domain_bounds[c])) for c in self.coords}
        self.w_pde = self.lw.w_pde
        self.field_ranges = dict(spec.field_ranges or {})
        self.pde_params = dict(spec.pde.params or {})
        self._loss_fn = compile_problem(spec, weights=self.lw)
        self.ctx = {
            "bounds": {
                "coords": self.coords,
                "min": [self.bounds[c][0] for c in self.coords],
                "max": [self.bounds[c][1] for c in self.coords],
                **self.bounds,
            },
            "tag_masks": {},
        }
        if self.pde_kind in ("poisson", "heat_equation_steady", "heat_equation_steady_multilayer"):
            self.warnings.append(
                f"'{self.pde_kind}' reads its source term from ctx['source_fn']; none is "
                "supplied by the app, so the source is taken as zero."
            )

    @staticmethod
    def _bucket(kind: str) -> str:
        if kind in _BC_KINDS:
            return "bc"
        if kind == "initial":
            return "ic"
        return "data"

    def _points_for(self, cond, n_bnd, n_ic, rng):
        """(X, normals, how) for one condition, or (None, None, reason)."""
        coords, bounds = self.coords, self.bounds
        if cond.kind == "initial":
            if "t" not in coords:
                return None, None, "initial condition but the problem has no 't' coordinate"
            X = sample_initial(bounds, coords, n_ic, rng)
            return X, np.zeros_like(X), "t = t_min slice"

        if cond.selector_type == "tag":
            tag = (cond.selector or {}).get("tag", "")
            faces = faces_for_tag(tag, coords)
            if faces is None:
                return None, None, (f"tag '{tag}' names real geometry; it cannot be placed on "
                                    "the box domain (needs a mesh/STL)")
            X, N = sample_faces(bounds, coords, faces, n_bnd, rng)
            return X, N, f"box-face convention for tag '{tag}': {faces}"

        if self._bucket(cond.kind) == "data":
            X = sample_interior(bounds, coords, n_bnd, rng)
            N = np.zeros_like(X)
        else:
            X, N = sample_faces(bounds, coords, all_faces(coords), 4 * n_bnd, rng)
        if cond.selector_type == "callable":
            m = np.asarray(cond.mask(X, self.ctx), dtype=bool)
            X, N = X[m], N[m]
            if len(X) == 0:
                return None, None, "selector matched no point on the box boundary"
            if len(X) > n_bnd:
                idx = rng.choice(len(X), n_bnd, replace=False)
                X, N = X[idx], N[idx]
            return X, N, "box boundary filtered by the preset's own selector"
        return X[:n_bnd], N[:n_bnd], "all box faces"

    def build_batch(self, x_col, n_bnd, n_ic, seed, device):
        rng = np.random.default_rng(seed)
        parts: Dict[str, List[Tuple[str, np.ndarray, np.ndarray]]] = {"bc": [], "ic": [], "data": []}
        record = not self.conditions and not self.unresolved
        for cond in self.spec.conditions:
            X, N, how = self._points_for(cond, n_bnd, n_ic, rng)
            prefix = {"bc": "bc", "ic": "ic", "data": "data"}[self._bucket(cond.kind)]
            key = f"{prefix}_{cond.name}"
            if X is None:
                if record:
                    self.unresolved.append({"name": cond.name, "kind": cond.kind, "reason": how})
                continue
            parts[self._bucket(cond.kind)].append((cond.name, X, N))
            if record:
                w = {"bc": self.lw.w_bc, "ic": self.lw.w_ic, "data": self.lw.w_data}[self._bucket(cond.kind)]
                try:
                    target_rms = float(np.sqrt(np.mean(np.square(cond.values(X, self.ctx)))))
                except Exception:
                    target_rms = 0.0
                self.conditions[key] = ConditionInfo(
                    key=key, name=cond.name, kind=cond.kind, fields=tuple(cond.fields),
                    weight=w * float(cond.weight), n_points=len(X), how=how,
                    target_rms=target_rms,
                )

        batch: Dict[str, Any] = {
            "x_col": torch.as_tensor(x_col, dtype=torch.float32, device=device),
            "ctx": self.ctx,
        }
        for bucket, xkey in (("bc", "x_bc"), ("ic", "x_ic"), ("data", "x_data")):
            items = parts[bucket]
            if not items:
                continue
            X = np.concatenate([it[1] for it in items])
            batch[xkey] = torch.as_tensor(X, dtype=torch.float32, device=device)
            if bucket == "bc":
                N = np.concatenate([it[2] for it in items])
                batch["n_bc"] = torch.as_tensor(N, dtype=torch.float32, device=device)
            offset = 0
            spans = {}
            for name, Xi, _ in items:
                spans[name] = (offset, offset + len(Xi))
                offset += len(Xi)
            # Every condition of every bucket gets an explicit mask: without
            # one, compile_problem would apply the condition to ALL points of
            # that bucket (including other conditions' points).
            for cond in self.spec.conditions:
                if self._bucket(cond.kind) != bucket:
                    continue
                m = torch.zeros(offset, dtype=torch.bool, device=device)
                if cond.name in spans:
                    a, b = spans[cond.name]
                    m[a:b] = True
                batch[f"mask_{cond.name}"] = m
        return batch

    def loss(self, model, batch):
        out = self._loss_fn(model, None, batch)
        raw = {k: float(v.detach()) for k, v in out.items() if k != "total"}
        return out["total"], raw


# ── Custom problems (symbolic equations) ─────────────────────────────────────

_DERIV = re.compile(r"\b([A-Za-z][A-Za-z0-9]*)_([a-z]+)\b")


def parse_equation(expr: str, coords: Sequence[str], fields: Sequence[str]):
    """``"u_t + u*u_x - 0.01*u_xx"`` -> SymPy expression in u(x, t)."""
    import sympy as sp

    csyms = {c: sp.Symbol(c) for c in coords}
    funcs = {f: sp.Function(f)(*csyms.values()) for f in fields}
    local: Dict[str, Any] = {**csyms, **funcs, "pi": sp.pi, "E": sp.E}
    single = {c for c in coords if len(c) == 1}

    def repl(m):
        name, suffix = m.group(1), m.group(2)
        if name not in fields:
            return m.group(0)
        if not set(suffix) <= single:
            raise ValueError(
                f"'{m.group(0)}': derivative suffix '{suffix}' must use single-letter "
                f"coordinates from {sorted(single)}"
            )
        key = f"__d_{name}_{suffix}"
        local[key] = sp.Derivative(funcs[name], *[csyms[ch] for ch in suffix])
        return key

    text = _DERIV.sub(repl, expr)
    parsed = sp.sympify(text, locals=local)
    unknown = parsed.free_symbols - set(csyms.values())
    if unknown:
        raise ValueError(
            f"Equation '{expr}' uses unknown symbol(s) {sorted(map(str, unknown))}; "
            "substitute numeric values for parameters."
        )
    return parsed


def _value_fn(value: Any, coords: Sequence[str]) -> Callable[[np.ndarray], np.ndarray]:
    """Constant, expression string in the coordinates, or callable."""
    if callable(value):
        return lambda X: np.asarray(value(X), dtype=np.float32).reshape(-1, 1)
    if isinstance(value, (int, float)):
        v = float(value)
        return lambda X: np.full((len(X), 1), v, dtype=np.float32)
    import sympy as sp

    syms = [sp.Symbol(c) for c in coords]
    expr = sp.sympify(str(value), locals={c: s for c, s in zip(coords, syms, strict=True)})
    unknown = expr.free_symbols - set(syms)
    if unknown:
        raise ValueError(f"Boundary value '{value}' uses unknown symbol(s) {sorted(map(str, unknown))}")
    f = sp.lambdify(syms, expr, "numpy")
    return lambda X: np.broadcast_to(
        np.asarray(f(*[X[:, i] for i in range(X.shape[1])]), dtype=np.float32), (len(X),)
    ).reshape(-1, 1).copy()


def parse_location(location: str, bounds: Bounds, coords: Sequence[str]) -> List[Face]:
    """``""``/``"all"``/``"boundary"``, ``"x=0"``, ``"x_min"``, ``"left"``..."""
    loc = (location or "").strip().lower().replace(" ", "")
    if loc in ("", "all", "boundary"):
        return all_faces(coords)
    m = re.fullmatch(r"([a-z]\w*)=(-?[\d.eE+-]+)", loc)
    if m:
        c, val = m.group(1), float(m.group(2))
        if c not in bounds or c == "t":
            raise ValueError(f"Boundary location '{location}': unknown spatial coordinate '{c}'")
        lo, hi = bounds[c]
        if math.isclose(val, lo, abs_tol=1e-9):
            return [(c, "min")]
        if math.isclose(val, hi, abs_tol=1e-9):
            return [(c, "max")]
        raise ValueError(f"Boundary location '{location}' is not a face of the domain {bounds[c]}")
    m = re.fullmatch(r"([a-z]\w*)_(min|max)", loc)
    if m and m.group(1) in bounds and m.group(1) != "t":
        return [(m.group(1), m.group(2))]
    faces = faces_for_tag(loc, coords)
    if faces is None:
        raise ValueError(
            f"Boundary location '{location}' not understood; use 'x=0', 'x_min', 'left', "
            "'right', 'top', 'bottom' or '' for the whole boundary"
        )
    return faces


class CustomPhysics(PhysicsAdapter):
    def __init__(self, problem, *, w_physics: Optional[float] = None,
                 w_bc: Optional[float] = None):
        super().__init__()
        from pinneapple_physics.symbolic_pde import SymbolicPDE
        import sympy as sp

        bounds = {k: tuple(map(float, v)) for k, v in problem.domain_bounds.items()}
        if problem.is_time_dependent and "t" not in bounds:
            bounds["t"] = (0.0, 1.0)
        self.bounds = bounds
        self.coords = list(bounds)
        self.fields = list(problem.field_names)
        self.label = problem.name
        self.pde_kind = "custom"
        self.field_ranges = {}
        self.w_pde = 1.0 if w_physics is None else float(w_physics)
        w_bc = 10.0 if w_bc is None else float(w_bc)

        csyms = [sp.Symbol(c) for c in self.coords]
        fsyms = [sp.Function(f) for f in self.fields]
        self.equations = []
        for eq in problem.equations:
            text = eq.expression if isinstance(eq.expression, str) else str(eq.expression)
            expr = parse_equation(text, self.coords, self.fields)
            self.equations.append((text, SymbolicPDE(expr, csyms, fsyms)))
        if not self.equations:
            raise ValueError("Custom problem has no equations.")

        self._conds: List[Dict[str, Any]] = []
        for i, bc in enumerate(problem.bcs):
            kind = (bc.kind or "dirichlet").lower()
            if kind not in ("dirichlet", "neumann"):
                self.unresolved.append({"name": f"bc_{i}", "kind": kind,
                                        "reason": f"'{kind}' boundary conditions are not supported "
                                                  "for custom problems yet (dirichlet, neumann)"})
                continue
            if bc.field not in self.fields:
                raise ValueError(f"Boundary condition on unknown field '{bc.field}'")
            faces = parse_location(bc.location, bounds, self.coords)
            self._conds.append({"key": f"bc_{i}", "kind": kind, "field": bc.field,
                                "faces": faces, "value": _value_fn(bc.value, self.coords),
                                "how": f"{kind} on {faces}"})
        for i, ic in enumerate(problem.ics):
            if "t" not in self.coords:
                self.unresolved.append({"name": f"ic_{i}", "kind": "initial",
                                        "reason": "initial condition on a problem without time"})
                continue
            self._conds.append({"key": f"ic_{i}", "kind": "initial", "field": ic.field,
                                "faces": None, "value": _value_fn(ic.expression, self.coords),
                                "how": "t = t_min slice"})
        for c in self._conds:
            self.conditions[c["key"]] = ConditionInfo(
                key=c["key"], name=c["key"], kind=c["kind"], fields=(c["field"],),
                weight=w_bc, how=c["how"],
            )

    def build_batch(self, x_col, n_bnd, n_ic, seed, device):
        rng = np.random.default_rng(seed)
        batch: Dict[str, Any] = {
            "x_col": torch.as_tensor(x_col, dtype=torch.float32, device=device),
            "conds": [],
        }
        for c in self._conds:
            if c["kind"] == "initial":
                X = sample_initial(self.bounds, self.coords, n_ic, rng)
                N = np.zeros_like(X)
            else:
                X, N = sample_faces(self.bounds, self.coords, c["faces"], n_bnd, rng)
            y = c["value"](X)
            self.conditions[c["key"]].n_points = len(X)
            self.conditions[c["key"]].target_rms = float(np.sqrt(np.mean(y ** 2)))
            batch["conds"].append({
                "key": c["key"], "kind": c["kind"], "fi": self.fields.index(c["field"]),
                "x": torch.as_tensor(X, device=device),
                "n": torch.as_tensor(N, device=device),
                "y": torch.as_tensor(y, device=device),
            })
        return batch

    def _residual(self, model, x):
        tm = _TensorModel(model)
        res = [pde.to_residual_fn(tm)(x) for _, pde in self.equations]
        return torch.cat([r if r.ndim == 2 else r[:, None] for r in res], dim=1)

    def loss(self, model, batch):
        pde = torch.mean(self._residual(model, batch["x_col"]) ** 2)
        total = self.w_pde * pde
        raw = {"pde": float(pde.detach())}
        for c in batch["conds"]:
            X = c["x"].clone().requires_grad_(c["kind"] == "neumann")
            u = unwrap(model(X))[:, c["fi"]:c["fi"] + 1]
            if c["kind"] == "neumann":
                g = torch.autograd.grad(u, X, torch.ones_like(u), create_graph=True)[0]
                pred = torch.sum(g * c["n"], dim=1, keepdim=True)
            else:
                pred = u
            mse = torch.mean((pred - c["y"]) ** 2)
            total = total + self.conditions[c["key"]].weight * mse
            raw[c["key"]] = float(mse.detach())
        return total, raw


def build_physics(problem, *, weight_override: Optional[Dict[str, float]] = None
                  ) -> Optional[PhysicsAdapter]:
    """Adapter for the problem, or ``None`` when it defines no physics at all."""
    wo = weight_override or {}
    kw = {"w_physics": wo.get("physics"), "w_bc": wo.get("bc")}
    if problem.kind == "preset" and problem.spec is not None:
        return PresetPhysics(problem.spec, **kw)
    if problem.kind == "custom" and problem.equations:
        return CustomPhysics(problem, **kw)
    return None
