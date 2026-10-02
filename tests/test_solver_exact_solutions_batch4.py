"""Numerical solvers against exact solutions, batch 4 (item 2 of the 2026-09-24 follow-ups).

Also covers the bugs this batch found: FEM / Kansa crashed on any Dirichlet condition
(``isinstance`` against the ``DirichletBC`` factory), the multiquadric Laplacian used (d-2)
instead of (d-1), and ``axial_flux_density`` returned -B_z.
"""
import math

import numpy as np
import pytest
import torch

from pinneapple_physics.pde_environment.conditions import DirichletBC
from pinneapple_physics.pde_environment.spec import PDETermSpec, ProblemSpec
from pinneapple_simulation.numerical_solvers.eddy_current_fdm import (
    MU0,
    axial_flux_density,
    solve_axisymmetric_eddy_current,
)
from pinneapple_simulation.numerical_solvers.fem import FEMSolver
from pinneapple_simulation.numerical_solvers.meshfree import RBFCollocationSolver
from pinneapple_systems.process_components.similarity_map import (
    evaluate_map,
    make_map,
    polytropic_head_from_psi,
    required_speed_for_head,
)


@pytest.fixture(autouse=True)
def _cpu_device():
    """Pin the default device to CPU for this module: MPS doesn't support float64 (used by the
    Kansa/eddy-current tests below), and some earlier test in a full `pytest tests/` run leaves the
    global default device set to "mps" -- a pre-existing, documented test-isolation gap, not
    something this batch introduced (same workaround as
    tests/test_gradient_backend_consistency.py's `_float64_cpu` fixture)."""
    prev = torch.get_default_device()
    torch.set_default_device("cpu")
    yield
    torch.set_default_device(prev)


def _on_boundary(p, *, tol=1e-6):
    return (p[:, 0] < tol) | (p[:, 0] > 1 - tol) | (p[:, 1] < tol) | (p[:, 1] > 1 - tol)


def _spec(kind, source, u_exact, selector=_on_boundary):
    bc = DirichletBC("wall", ("u",), "callable", selector, u_exact)
    return ProblemSpec(name="mms", dim=2, coords=("x", "y"), fields=("u",),
                       pde=PDETermSpec(kind, ("u",), ("x", "y"), {"source": source}),
                       conditions=(bc,), domain_bounds={"x": (0.0, 1.0), "y": (0.0, 1.0)})


def _quadratic(p):
    return p[:, 0] ** 2 + p[:, 1] ** 2  # -lap u = -4


def _harmonic(p):
    return torch.sin(math.pi * p[:, 0]) * torch.sinh(math.pi * p[:, 1]) / math.sinh(math.pi)


def test_fem_q1_reproduces_quadratic_and_converges_second_order_on_harmonic():
    r = FEMSolver(nx=16, ny=16, solver="direct")(spec=_spec("poisson", -4.0, _quadratic))
    exact = _quadratic(r.extras["nodes"])
    assert float((r.result.reshape(-1) - exact).abs().max()) < 1e-5  # nodally exact up to float32
    errs = []
    for n in (8, 16, 32):
        r = FEMSolver(nx=n, ny=n, solver="direct")(spec=_spec("laplace", 0.0, _harmonic))
        errs.append(float((r.result.reshape(-1) - _harmonic(r.extras["nodes"])).abs().max()))
    assert errs[0] / errs[1] > 3.8 and errs[1] / errs[2] > 3.8  # measured 3.99, 4.00


def test_fem_accepts_builder_style_conditions_and_edge_tags():
    """ConditionSpec contract: selector(X, ctx) / value_fn(X, ctx) on NumPy, or a tag."""
    sel = lambda X, ctx: _on_boundary(torch.as_tensor(X)).numpy()
    val = lambda X, ctx: (X[:, 0] ** 2 + X[:, 1] ** 2)[:, None]
    r = FEMSolver(nx=8, ny=8, solver="direct")(spec=_spec("poisson", -4.0, val, selector=sel))
    assert float((r.result.reshape(-1) - _quadratic(r.extras["nodes"])).abs().max()) < 1e-5
    tagged = _spec("poisson", -4.0, _quadratic, selector={"tag": "boundary"})
    r = FEMSolver(nx=8, ny=8, solver="direct")(spec=tagged)
    assert float((r.result.reshape(-1) - _quadratic(r.extras["nodes"])).abs().max()) < 1e-5


def _kansa_nodes(n):
    g = torch.linspace(0, 1, n + 1, dtype=torch.float64)
    X, Y = torch.meshgrid(g, g, indexing="ij")
    P = torch.stack([X.reshape(-1), Y.reshape(-1)], 1)
    b = _on_boundary(P)
    return P[~b], P[b]


@pytest.mark.parametrize("rbf,eps", [("multiquadric", 2.0), ("gaussian", 3.0), ("imq", 2.0)])
def test_kansa_converges_to_exact_solution(rbf, eps):
    """-lap u = -4 with u = x^2 + y^2 on the boundary; exact solution u = x^2 + y^2.
    Measured max errors n = 8 -> 16: MQ 6.6e-4 -> 1.8e-5 (was stuck at 0.06 with the (d-2) Laplacian),
    Gaussian 1.5e-2 -> 3.7e-5, IMQ 6.3e-3 -> 1.8e-4."""
    errs = []
    for n in (8, 16):
        I, B = _kansa_nodes(n)
        out = RBFCollocationSolver(rbf=rbf, eps=eps, reg=1e-10)(spec=_spec("poisson", -4.0, _quadratic),
                                                                interior_pts=I, boundary_pts=B)
        errs.append(float((out.result - _quadratic(torch.cat([I, B]))).abs().max()))
    assert errs[1] < 5e-4 and errs[0] / errs[1] > 10


def test_multiquadric_laplacian_matches_autograd():
    from pinneapple_simulation.numerical_solvers.meshfree import _rbf_laplacian_mq

    for d in (1, 2, 3):
        c = torch.rand(6, d, dtype=torch.float64, generator=torch.Generator().manual_seed(d))
        L = _rbf_laplacian_mq(c, 1.7)
        x = c.clone().requires_grad_(True)
        phi = lambda x_, cj: torch.sqrt(1 + 1.7 ** 2 * ((x_ - cj) ** 2).sum(-1))
        for j in range(6):
            g = torch.autograd.grad(phi(x, c[j]).sum(), x, create_graph=True)[0]
            lap = sum(torch.autograd.grad(g[:, k].sum(), x, retain_graph=True)[0][:, k] for k in range(d))
            assert torch.allclose(L[:, j], lap, atol=1e-12)


def test_eddy_current_manufactured_solution_second_order():
    """A = sin(k(r - a)) sin(m z) vanishes on the box boundary; J_source = -(L[A] - i omega mu sigma A)/mu
    with L the axisymmetric operator, so A is the exact solution. Measured errors 3.4e-5, 8.5e-6, 2.1e-6."""
    a, b, L = 0.1, 0.5, 0.4
    sig, om = 5e6, 2 * np.pi * 50
    k, m = np.pi / (b - a), np.pi / L
    A_ex = lambda r, z: np.sin(k * (r - a)) * np.sin(m * z)

    def L_A(r, z):
        s, c = np.sin(k * (r - a)), np.cos(k * (r - a))
        return (-k * k * s + k * c / r - s / r ** 2 - m * m * s) * np.sin(m * z)

    errs = []
    for n in (41, 81, 161):
        r, z = np.linspace(a, b, n), np.linspace(0, L, n)
        R, Z = np.meshgrid(r, z, indexing="ij")
        mu, sigma = np.full_like(R, MU0), np.full_like(R, sig)
        J = -(L_A(R, Z) - 1j * om * MU0 * sig * A_ex(R, Z)) / MU0
        A = solve_axisymmetric_eddy_current(r, z, om, mu, sigma, J)
        errs.append(np.abs(A - A_ex(R, Z)).max())
    assert errs[0] / errs[1] > 3.8 and errs[1] / errs[2] > 3.8


def test_axial_flux_density_of_uniform_field():
    """A_theta = B0 r / 2 is a uniform axial field: exact B_z = (1/r) d(r A)/dr = B0 (sign included)."""
    r, z = np.linspace(0.01, 1, 200), np.linspace(0, 1, 5)
    B = axial_flux_density((0.7 * r / 2)[:, None] * np.ones((1, 5)) * (1 + 0.5j), r, z)
    assert np.allclose(B, 0.7 * (1 + 0.5j), rtol=1e-10)


def _compressor():
    return make_map("c", D2_m=0.4, phi_ref_bep=0.07, psi_ref_bep=0.65, psi0=0.85, eta_p_max=0.8,
                    eta_p_shape_b=55.0, phi_surge=0.04, phi_choke=0.1, Mu2_ref=0.8, n_stages=3)


def test_similarity_map_affinity_laws_are_exact_below_reference_mach():
    """Fan / affinity laws: at the same phi, Q ~ N and head ~ N^2 (closed form), while Mu2 < Mu2_ref."""
    c = _compressor()
    a, nu = 340.0, 1.5e-5
    e1 = evaluate_map(c, 1.2, 6000, a, nu)
    e2 = evaluate_map(c, 1.2 * 1.5, 9000, a, nu)
    assert e1.Mu2 < c.Mu2_ref and e2.Mu2 < c.Mu2_ref
    assert e2.phi == pytest.approx(e1.phi, rel=1e-12)
    assert e2.psi == pytest.approx(e1.psi, rel=1e-12)
    h1, h2 = polytropic_head_from_psi(e1.psi, 6000, c), polytropic_head_from_psi(e2.psi, 9000, c)
    assert h2 / h1 == pytest.approx(1.5 ** 2, rel=1e-12)
    bep = evaluate_map(c, c.phi_ref_bep * 6000 / 60 * c.D2_m ** 3, 6000, a, nu)
    assert bep.psi == pytest.approx(c.psi_ref_bep, rel=1e-12)  # curve passes through the stated BEP


def test_required_speed_matches_closed_form():
    """H = n_st pi^2 D^2 (psi0 n^2 - a Q^2 / D^6), n in rev/s, so
    n = sqrt((H / (n_st pi^2 D^2) + a Q^2 / D^6) / psi0) (closed form, no Mach correction)."""
    c = _compressor()
    Q, H = 0.5, 40e3  # near BEP, ~7000 rpm
    N = required_speed_for_head(H, Q, c, 340.0, 1.5e-5, N_min_rpm=1000, N_max_rpm=9000)
    n_exact = math.sqrt((H / (c.n_stages * math.pi ** 2 * c.D2_m ** 2) + c.psi_shape_a * Q ** 2 / c.D2_m ** 6) / c.psi0)
    assert evaluate_map(c, Q, N, 340.0, 1.5e-5).Mu2 < c.Mu2_ref
    assert N / 60 == pytest.approx(n_exact, rel=1e-6)
