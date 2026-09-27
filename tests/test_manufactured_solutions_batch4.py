"""Exact solutions plugged into compiled residuals, batch 4 (item 2 of the 2026-09-24 follow-ups).

Same protocol as batch 2: an exact solution must give a ~zero residual and a perturbed one must not.
Every exact solution is derived in its docstring. Float64 throughout, so "zero" means round-off.
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn

from pinneapple_physics.pde_environment.spec import PDETermSpec, ProblemSpec
from pinneapple_physics.pinn_solver.compiler.compile import compile_problem

DT = torch.float64


class _Exact(nn.Module):
    def __init__(self, fn):
        super().__init__()
        self.fn = fn
        self._dummy = nn.Parameter(torch.zeros(1, dtype=DT))

    def forward(self, x):
        return self.fn(x)


def _residual(kind, coords, fields, params, fn, x, ctx=None):
    pde = PDETermSpec(kind=kind, fields=tuple(fields), coords=tuple(coords), params=params)
    spec = ProblemSpec(name=f"_mms_{kind}", dim=len(coords), coords=tuple(coords), fields=tuple(fields),
                       pde=pde, conditions=())
    loss_fn = compile_problem(spec)
    nc, nf = len(coords), len(fields)
    z = lambda n: torch.zeros((0, n), dtype=DT)
    batch = {"x_col": x.clone().requires_grad_(True), "ctx": ctx or {},
             "x_bc": z(nc), "y_bc": z(nf), "x_ic": z(nc), "y_ic": z(nf), "x_data": z(nc), "y_data": z(nf)}
    out = loss_fn(_Exact(fn), None, batch)
    return float((out["pde"] if "pde" in out else out["total"]).item())


def _pts(n, lows, highs, seed=0):
    g = torch.Generator().manual_seed(seed)
    lo, hi = torch.tensor(lows, dtype=DT), torch.tensor(highs, dtype=DT)
    return lo + (hi - lo) * torch.rand(n, len(lows), generator=g, dtype=DT)


def test_buckley_leverett_layered_reservoir():
    """Stratified reservoir: p = -G x, Sw = S(y) (layers). Total flux q = (k lam_t(S(y)) G, 0) does not
    vary along x, so phi Sw_t + div(fw q) = 0 and div(k lam_t grad p) = 0 hold exactly for any S(y).
    Perturbation: Sw also varying along x makes div(fw q) != 0."""
    params = {"phi": 0.2, "k": 1.0, "mu_w": 1.0, "mu_o": 3.0}
    G = 2.0
    S = lambda X: 0.5 + 0.2 * torch.sin(3.0 * X[:, 2:3])
    exact = lambda X: torch.cat([S(X), -G * X[:, 1:2]], 1)
    wrong = lambda X: torch.cat([S(X) + 0.1 * X[:, 1:2], -G * X[:, 1:2]], 1)
    x = _pts(256, [0, 0, 0], [1, 1, 1])
    kind, c, f = "buckley_leverett_two_phase", ("t", "x", "y"), ("Sw", "p")
    assert _residual(kind, c, f, params, exact, x) < 1e-20
    assert _residual(kind, c, f, params, wrong, x) > 1e-4


def test_neo_hookean_total_lagrangian_manufactured_body_force():
    """Manufactured solution: pick a non-homogeneous finite displacement, compute P = mu(F - F^-T)
    + K ln(J) F^-T by autograd and set the reference body force b0 = -Div_X P. Div_X P + b0 = 0
    exactly. (A residual built from div_X of the Cauchy stress fails this: ~6% of |b0|^2.)"""
    E, nu, K = 3.0, 0.3, 2.0
    mu = E / (2 * (1 + nu))

    def disp(X):
        x, y = X[:, 0:1], X[:, 1:2]
        return torch.cat([0.2 * x * y + 0.1 * y * y, 0.15 * x * x - 0.1 * x * y], 1)

    def div_P(X):
        U = disp(X)
        G = torch.stack([torch.autograd.grad(U[:, i].sum(), X, create_graph=True)[0] for i in range(2)], 1)
        F = torch.eye(2, dtype=DT) + G
        FiT = torch.linalg.inv(F).transpose(1, 2)
        P = mu * (F - FiT) + K * torch.log(torch.det(F))[:, None, None] * FiT
        return torch.stack([sum(torch.autograd.grad(P[:, i, j].sum(), X, create_graph=True)[0][:, j]
                                for j in range(2)) for i in range(2)], 1)

    x = _pts(200, [0.25, 0.25], [0.75, 0.75])
    b0 = (-div_P(x.clone().requires_grad_(True))).detach().numpy()
    ctx = {"body_force_fn": lambda X, c: b0}
    kind, c, f, params = "hyperelasticity_neo_hookean", ("x", "y"), ("u", "v"), {"E": E, "nu": nu, "K": K}
    assert _residual(kind, c, f, params, disp, x, ctx) < 1e-20
    assert _residual(kind, c, f, params, lambda X: 1.1 * disp(X), x, ctx) > 1e-4


def test_thermoelasticity_free_thermal_expansion():
    """T = x is harmonic; eps = alpha T I is compatible for linear T: ux = alpha (x^2 - y^2)/2,
    uy = alpha x y give eps_xx = eps_yy = alpha x, eps_xy = 0, so sigma = 0 (stress-free expansion)."""
    a = 1e-2
    params = {"alpha_T": a, "lambda": 1.5, "mu": 1.0}
    exact = lambda X: torch.cat([a * (X[:, 0:1] ** 2 - X[:, 1:2] ** 2) / 2, a * X[:, 0:1] * X[:, 1:2], X[:, 0:1]], 1)
    wrong = lambda X: torch.cat([a * (X[:, 0:1] ** 2 - X[:, 1:2] ** 2) / 2, 0 * X[:, 1:2], X[:, 0:1]], 1)
    x = _pts(256, [0, 0], [1, 1])
    kind, c, f = "thermoelasticity_2d", ("x", "y"), ("ux", "uy", "T")
    assert _residual(kind, c, f, params, exact, x) < 1e-24
    assert _residual(kind, c, f, params, wrong, x) > 1e-8


def test_biot_terzaghi_consolidation_mode():
    """1D consolidation mode: p = exp(-c t) sin x, v = 0, u = -alpha exp(-c t) cos x / (lam + 2 mu).
    Momentum: (lam + 2 mu) u_xx = alpha p_x holds. Flow: p_t/M + alpha u_xt - (k/mu_f) p_xx = 0 gives
    the exact decay rate c = (k/mu_f) / (1/M + alpha^2/(lam + 2 mu)): an exact solution of Biot consolidation
    (Terzaghi mode)."""
    lam, mu, alpha, M, k, mu_f = 1.2, 0.8, 0.9, 2.0, 0.5, 1.0
    c = (k / mu_f) / (1 / M + alpha ** 2 / (lam + 2 * mu))
    params = {"lambda": lam, "mu": mu, "alpha": alpha, "M": M, "k": k, "mu_f": mu_f}

    def sol(rate):
        def fn(X):
            t, x = X[:, 0:1], X[:, 1:2]
            e = torch.exp(-rate * t)
            return torch.cat([-alpha * e * torch.cos(x) / (lam + 2 * mu), 0 * x, e * torch.sin(x)], 1)
        return fn

    x = _pts(256, [0, 0, 0], [1, math.pi, 1])
    kind, co, f = "biot_poroelasticity", ("t", "x", "y"), ("u", "v", "p")
    assert _residual(kind, co, f, params, sol(c), x) < 1e-24
    assert _residual(kind, co, f, params, sol(1.2 * c), x) > 1e-4


def _heston_params():
    return {"kappa": 2.0, "theta": 0.04, "sigma_v": 0.3, "rho": -0.7, "r": 0.05}


def test_heston_claim_paying_S_times_v():
    """V(S, v, tau) = S (a + b v) prices the payoff S v. Substituting: a' = kappa theta b and
    b' = (rho sigma_v - kappa) b, so b = exp((rho sigma_v - kappa) tau), a = kappa theta (b - 1)/(rho sigma_v - kappa)
    (exact solution; exercises the mixed d2V/dSdv term)."""
    p = _heston_params()
    lam = p["rho"] * p["sigma_v"] - p["kappa"]

    def sol(lam_):
        def fn(X):
            S, v, tau = X[:, 0:1], X[:, 1:2], X[:, 2:3]
            b = torch.exp(lam_ * tau)
            return S * (p["kappa"] * p["theta"] * (b - 1) / lam_ + b * v)
        return fn

    x = _pts(256, [50, 0.01, 0], [150, 0.2, 1])
    kind, c, f = "heston_pde_2d", ("S", "v", "tau"), ("V",)
    assert _residual(kind, c, f, p, sol(lam), x) < 1e-20
    assert _residual(kind, c, f, p, sol(-p["kappa"]), x) > 1e-4  # rho dropped


def test_heston_claim_paying_v_squared():
    """V = exp(-r tau)(c0 + c1 v + c2 v^2) prices the payoff v^2 (CIR second moment):
    c2 = exp(-2 kappa tau), c1 = (sigma^2 + 2 kappa theta)(exp(-kappa tau) - exp(-2 kappa tau))/kappa,
    c0 = theta (sigma^2 + 2 kappa theta)[(1 - exp(-kappa tau)) - (1 - exp(-2 kappa tau))/2]/kappa
    (exact solution; exercises the 0.5 sigma_v^2 v d2V/dv2 term)."""
    p = _heston_params()
    kap, th, r = p["kappa"], p["theta"], p["r"]

    def sol(sig):
        def fn(X):
            v, tau = X[:, 1:2], X[:, 2:3]
            e1, e2 = torch.exp(-kap * tau), torch.exp(-2 * kap * tau)
            A = sig * sig + 2 * kap * th
            c1 = A * (e1 - e2) / kap
            c0 = th * A * ((1 - e1) - (1 - e2) / 2) / kap
            return torch.exp(-r * tau) * (c0 + c1 * v + e2 * v * v)
        return fn

    x = _pts(256, [50, 0.01, 0], [150, 0.2, 1])
    kind, c, f = "heston_pde_2d", ("S", "v", "tau"), ("V",)
    assert _residual(kind, c, f, p, sol(p["sigma_v"]), x) < 1e-24
    assert _residual(kind, c, f, p, sol(0.0), x) > 1e-10  # vol-of-vol term dropped
