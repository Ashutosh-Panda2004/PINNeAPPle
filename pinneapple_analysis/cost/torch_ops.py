"""Cost per operation for PyTorch models: the PINN training step broken into its parts, and a per-operator table.

``pinn_operation_costs`` answers "where does one PINN training step spend its time and FLOPs": forward
pass, first derivatives, second derivatives (the PDE residual's Laplacian), loss backward, optimizer step.
Derivative cost is why a PINN step costs several times a plain network step; this makes the ratio visible.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List

from .profiler import CostRecord, measure


def pinn_operation_costs(model, x, *, repeats: int = 5, warmup: int = 1, optimizer=None) -> Dict[str, CostRecord]:
    """Cost of each stage of a PINN step on collocation points ``x`` of shape ``(N, d)``.

    Stages (each measured on its own, so ``backward`` includes the graph it needs):

    - ``forward``: ``u = model(x)``
    - ``grad1``: ``du/dx`` by autograd (``create_graph=True``, as in a residual)
    - ``grad2``: the Laplacian ``sum_i d2u/dx_i^2`` (second derivatives, the usual PDE-residual cost)
    - ``backward``: ``loss.backward()`` through the residual (a real PINN loss)
    - ``step``: one optimizer step (default Adam), if ``optimizer`` is not passed
    """
    import torch

    x0 = x.detach()

    def fresh():
        xx = x0.clone().requires_grad_(True)
        return xx, model(xx)

    def forward():
        with torch.enable_grad():
            model(x0)

    def grad1():
        xx, u = fresh()
        torch.autograd.grad(u.sum(), xx, create_graph=True)

    def laplacian(xx, u):
        g = torch.autograd.grad(u.sum(), xx, create_graph=True)[0]
        total = 0.0
        for i in range(xx.shape[1]):
            total = total + torch.autograd.grad(g[:, i].sum(), xx, create_graph=True)[0][:, i]
        return total

    def grad2():
        xx, u = fresh()
        laplacian(xx, u)

    def backward():
        xx, u = fresh()
        loss = (laplacian(xx, u) ** 2).mean() + (u ** 2).mean()
        model.zero_grad(set_to_none=True)
        loss.backward()

    opt = optimizer or torch.optim.Adam(model.parameters(), lr=1e-3)

    def step():
        opt.step()

    # give the optimizer real gradients so step() does a real update
    backward()
    stages = {"forward": forward, "grad1": grad1, "grad2": grad2, "backward": backward, "step": step}
    return {k: measure(fn, repeats=repeats, warmup=warmup, name=f"pinn.{k}", size=float(len(x0)))
            for k, fn in stages.items()}


def profile_ops(fn: Callable[[], Any], *, top: int = 15, sort_by: str = "self_cpu_time_total") -> List[Dict[str, Any]]:
    """Per-PyTorch-operator table for one call: calls, self CPU time (ms) and FLOPs (matmul/conv/attention)."""
    from torch.profiler import ProfilerActivity, profile

    fn()  # warm up allocator / lazy init so the table is not dominated by first-call work
    with profile(activities=[ProfilerActivity.CPU], with_flops=True) as prof:
        fn()
    rows = []
    for e in prof.key_averages():
        rows.append({"op": e.key, "calls": int(e.count),
                     "self_cpu_ms": float(e.self_cpu_time_total) / 1000.0,
                     "flops": int(e.flops) if getattr(e, "flops", 0) else None})
    rows.sort(key=lambda r: r["self_cpu_ms"], reverse=True)
    return rows[:top]
