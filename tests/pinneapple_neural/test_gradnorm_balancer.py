"""GradNormBalancer: the closed-form update must equalise the *weighted* gradient norms.

Regression for the double division by the current weight (the update used ``target / ||grad(w*L)||``,
which converges to w^2 * ||grad L|| = target and oscillates between calls).
"""
import torch
from torch import nn

from pinneapple_neural.trainer.weight_scheduler import GradNormBalancer, WeightSchedulerConfig


def _setup(alpha=0.0):
    torch.manual_seed(0)
    model = nn.Sequential(nn.Linear(2, 8), nn.Tanh(), nn.Linear(8, 1))
    x = torch.randn(64, 2)
    y = model(x)
    # Two terms whose gradients differ by ~two orders of magnitude.
    losses = {"pde": (y ** 2).mean(), "bc": 100.0 * ((y - 1.0) ** 2).mean()}
    cfg = WeightSchedulerConfig(method="gradnorm", initial_weights={"pde": 1.0, "bc": 1.0},
                                update_every=1, alpha=alpha, clip_min=1e-6, clip_max=1e6)
    return model, losses, GradNormBalancer(model, ["pde", "bc"], config=cfg)


def _weighted_norms(bal, losses, weights):
    return {n: bal._grad_norm(weights[n] * losses[n]) for n in losses}


def test_one_update_equalises_weighted_gradient_norms():
    _, losses, bal = _setup(alpha=0.0)
    before = _weighted_norms(bal, losses, {"pde": 1.0, "bc": 1.0})
    assert before["bc"] / before["pde"] > 10          # the imbalance the balancer must remove
    w = bal.update_weights(losses, step=0)
    after = _weighted_norms(bal, losses, w)
    assert abs(after["bc"] / after["pde"] - 1.0) < 1e-4
    # Target is the mean weighted norm before the update (alpha = 0: every task gets the mean).
    mean_before = (before["pde"] + before["bc"]) / 2
    assert abs(after["pde"] - mean_before) / mean_before < 1e-4


def test_weights_are_stationary_on_repeated_updates():
    _, losses, bal = _setup(alpha=0.0)
    hist = [bal.update_weights(losses, step=s) for s in range(6)]
    ratios = [h["bc"] / h["pde"] for h in hist]
    # Same losses at every call: the weights must not move after the first update (no oscillation).
    for r in ratios[1:]:
        assert abs(r / ratios[0] - 1.0) < 1e-6


def test_grad_norm_is_global_l2_norm():
    model, losses, bal = _setup()
    params = [p for p in bal.shared_layer.parameters() if p.requires_grad]
    grads = torch.autograd.grad(losses["pde"], params, retain_graph=True)
    esperado = torch.sqrt(sum(g.pow(2).sum() for g in grads)).item()
    assert abs(bal._grad_norm(losses["pde"]) - esperado) < 1e-9 * max(1.0, esperado)
