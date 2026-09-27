"""Numerical solvers against closed-form solutions (item 2 of the 2026-09-24 follow-ups, batch 3)."""
import math

import numpy as np
import pytest
import torch

from pinneapple_simulation.numerical_solvers.beam_bvp_fdm import solve_euler_bernoulli_beam_1d
from pinneapple_simulation.numerical_solvers.fvm import _fvm_diffusion_2d
from pinneapple_simulation.numerical_solvers.spectral import poisson_periodic_fft
from pinneapple_simulation.numerical_solvers.tvd_advection import tvd_advection_rhs


def test_fvm_diffusion_decays_the_first_mode_at_the_exact_rate():
    """u0 = sin(pi x) sin(pi y), u = 0 on the boundary: exact u = exp(-2 pi^2 alpha t) u0."""
    n, alpha, t_end = 64, 0.1, 0.05
    dx = 1.0 / n
    xc = (torch.arange(n, dtype=torch.float64) + 0.5) * dx
    X, Y = torch.meshgrid(xc, xc, indexing="ij")
    u0 = torch.sin(math.pi * X) * torch.sin(math.pi * Y)
    dt = 0.2 * dx * dx / alpha
    steps = int(round(t_end / dt))
    u = u0.clone()
    for _ in range(steps):
        u = _fvm_diffusion_2d(u, dx, dx, alpha, 0.0, dt, 0.0)
    exact = math.exp(-2 * math.pi ** 2 * alpha * steps * dt) * u0
    assert float((u - exact).abs().max() / exact.abs().max()) < 5e-3


def test_spectral_poisson_is_exact_for_a_fourier_mode():
    """lap u = f with u = sin(2 pi x) sin(4 pi y) on the periodic unit square."""
    n = 64
    s = torch.arange(n, dtype=torch.float64) / n
    Y, X = torch.meshgrid(s, s, indexing="ij")  # rows = y, columns = x (poisson_periodic_fft layout)
    exact = torch.sin(2 * math.pi * X) * torch.sin(4 * math.pi * Y)
    f = -((2 * math.pi) ** 2 + (4 * math.pi) ** 2) * exact
    assert float((poisson_periodic_fft(f) - exact).abs().max()) < 1e-10


def _advect(f0, v, dz, t_end, cfl=0.4):
    f = f0.copy()
    dt = cfl * dz / abs(v)
    n = int(math.ceil(t_end / dt))
    dt = t_end / n
    for _ in range(n):
        f1 = f + dt * tvd_advection_rhs(f, v, dz)
        f = 0.5 * f + 0.5 * (f1 + dt * tvd_advection_rhs(f1, v, dz))
    return f


def test_tvd_advection_second_order_on_smooth_data_and_no_new_extrema():
    v, t_end = 1.0, 0.3
    errs = []
    for N in (200, 400):
        z = (np.arange(N) + 0.5) / N
        g = lambda s: np.exp(-((s - 0.3) / 0.05) ** 2)
        f = _advect(g(z), v, 1.0 / N, t_end)
        errs.append(np.abs(f - g(z - v * t_end)).sum() / N)  # exact solution: shifted profile
    # measured 1.59 -> 1.74 -> 1.90 as N doubles from 100: second order except where the TVD
    # limiter clips extrema (it must, to stay TVD), so the L1 order approaches 2 from below
    assert errs[1] < 1.5e-3 and errs[0] / errs[1] > 3.0
    z = (np.arange(300) + 0.5) / 300
    sq = ((z > 0.2) & (z < 0.4)).astype(float)
    f = _advect(sq, v, 1.0 / 300, 0.3)
    assert f.max() <= 1.0 + 1e-12 and f.min() >= -1e-12  # TVD: no overshoot / undershoot
    g = _advect(sq[::-1].copy(), -v, 1.0 / 300, 0.3)  # same test for leftward flow
    assert g.max() <= 1.0 + 1e-12 and g.min() >= -1e-12


@pytest.mark.parametrize("bc,where,coef", [(0, "mid", 5 / 384), (1, "tip", 1 / 8), (2, "mid", 1 / 384)])
def test_beam_bvp_matches_textbook_deflections(bc, where, coef):
    """Uniform load q: simply supported 5qL^4/384EI (mid), cantilever qL^4/8EI (tip), fixed-fixed qL^4/384EI (mid)."""
    L, E, I, q = 10.0, 200e9, 8.33e-6, 1000.0
    r = solve_euler_bernoulli_beam_1d(L_m=L, E_Pa=E, I_m4=I, q_N_per_m=q, nx=201, bc_type=bc)
    w = np.abs(np.asarray(r["deflection_m"]))
    z = np.asarray(r["z"])
    val = w[np.argmin(np.abs(z - L / 2))] if where == "mid" else w.max()
    assert val == pytest.approx(coef * q * L ** 4 / (E * I), rel=5e-4)  # closed form (Timoshenko)


@pytest.mark.parametrize("bc,where,coef", [(0, "mid", 5 / 384), (1, "tip", 1 / 8), (2, "mid", 1 / 384)])
def test_beam_bvp_is_second_order(bc, where, coef):
    """Ghost-node boundary conditions: halving dz divides the deflection error by ~4."""
    L, E, I, q = 10.0, 200e9, 8.33e-6, 1000.0
    errs = []
    for nx in (101, 201):
        r = solve_euler_bernoulli_beam_1d(L_m=L, E_Pa=E, I_m4=I, q_N_per_m=q, nx=nx, bc_type=bc)
        w, z = np.abs(r["deflection_m"]), r["z"]
        val = w[np.argmin(np.abs(z - L / 2))] if where == "mid" else w.max()
        errs.append(abs(val / (coef * q * L ** 4 / (E * I)) - 1))  # exact value: closed form
    assert errs[0] / errs[1] > 3.5
