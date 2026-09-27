"""Read Dirichlet conditions of a ProblemSpec for grid / node-based solvers.

``DirichletBC`` is a factory returning a ``ConditionSpec`` (kind="dirichlet"), so solvers must
check ``cond.kind`` (an ``isinstance`` check against the factory raises TypeError). The builder's
contract is ``selector(X, ctx) -> bool mask`` and ``value_fn(X, ctx) -> (N, n_fields)`` on NumPy
arrays; older call sites pass one-argument callables on tensors. Both are accepted here.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
import torch


def dirichlet_conditions(spec) -> List:
    return [c for c in getattr(spec, "conditions", ()) if getattr(c, "kind", None) == "dirichlet"]


def _call(fn, pts: torch.Tensor):
    """Try the builder contract fn(X_numpy, ctx) first, then the legacy fn(X_tensor)."""
    try:
        return fn(pts.detach().cpu().numpy(), {})
    except TypeError:
        return fn(pts)


def select(cond, pts: torch.Tensor, edges: Optional[Dict[str, torch.Tensor]] = None,
           boundary: Optional[torch.Tensor] = None) -> torch.Tensor:
    """Indices of ``pts`` the condition applies to.

    ``edges`` maps tag names ("left", "right", ...) to indices; ``boundary`` is the index set used
    for selector None / "all" / {"tag": "boundary"}.
    """
    sel = cond.selector
    tag = sel.get("tag") if isinstance(sel, dict) else sel
    if tag is None or tag in ("all", "boundary"):
        if boundary is None:
            return torch.arange(pts.shape[0])
        return boundary
    if isinstance(tag, str):
        if edges is None or tag not in edges:
            raise KeyError(f"unknown boundary tag {tag!r}; known: {sorted(edges or {})}")
        return edges[tag]
    mask = torch.as_tensor(np.asarray(_call(sel, pts)), dtype=torch.bool).reshape(-1)
    return torch.where(mask)[0]


def values(cond, pts: torch.Tensor, field: int = 0) -> torch.Tensor:
    """Dirichlet values at ``pts`` for one field (column ``field`` of a multi-field value_fn)."""
    fn = cond.value_fn
    if not callable(fn):
        return torch.full((pts.shape[0],), float(fn), dtype=pts.dtype, device=pts.device)
    r = _call(fn, pts)
    v = (r if torch.is_tensor(r) else torch.as_tensor(np.asarray(r, dtype=np.float64))).to(pts.dtype).to(pts.device)
    if v.ndim == 2:
        v = v[:, field]
    return v.reshape(-1).expand(pts.shape[0]) if v.numel() == 1 else v.reshape(-1)


def boundary_rect(nodes: torch.Tensor, edges: Dict[str, torch.Tensor]) -> torch.Tensor:
    return torch.unique(torch.cat(list(edges.values())))


__all__: Tuple[str, ...] = ("dirichlet_conditions", "select", "values", "boundary_rect")
