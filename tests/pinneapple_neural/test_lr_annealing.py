"""LRAnnealing: Algorithm 1 of Wang, Teng & Perdikaris (2021) — the reference term's weight never
moves, and every other term's target is max_theta|grad L_ref| / mean_theta|grad L_i|, EMA-smoothed."""
import pytest
import torch
from torch import nn

from pinneapple_neural.trainer.loss_balancer import LRAnnealing
from pinneapple_neural.trainer.weight_scheduler import WeightScheduler, WeightSchedulerConfig


def _model_and_losses():
    torch.manual_seed(0)
    model = nn.Sequential(nn.Linear(2, 8), nn.Tanh(), nn.Linear(8, 1))
    x = torch.randn(64, 2)
    y = model(x)
    # Two terms whose gradients differ by orders of magnitude (the imbalance the balancer must fix).
    losses = {"pde": (y ** 2).mean(), "bc": 1000.0 * ((y - 1.0) ** 2).mean()}
    return model, losses


def _full_grad_abs(model, loss):
    params = [p for p in model.parameters() if p.requires_grad]
    grads = torch.autograd.grad(loss, params, retain_graph=True, allow_unused=True)
    return torch.cat([g.reshape(-1) for g in grads if g is not None]).abs()


def test_reference_weight_never_moves():
    model, losses = _model_and_losses()
    bal = LRAnnealing(model, ["pde", "bc"], reference="pde", update_every=1, alpha=0.5)
    for step in range(5):
        bal.step(losses)
        assert bal.current_weights["pde"] == 1.0


def test_unknown_reference_raises():
    model, _ = _model_and_losses()
    with pytest.raises(ValueError, match="reference"):
        LRAnnealing(model, ["pde", "bc"], reference="nope")


def test_one_update_matches_the_closed_form():
    model, losses = _model_and_losses()
    bal = LRAnnealing(model, ["pde", "bc"], reference="pde", update_every=1, alpha=1.0,  # alpha=1: no EMA inertia
                      clip_min=1e-6, clip_max=1e6)
    g_ref = _full_grad_abs(model, losses["pde"])
    g_bc = _full_grad_abs(model, losses["bc"])
    esperado = float(g_ref.max()) / float(g_bc.mean())
    bal.step(losses)
    assert bal.current_weights["bc"] == pytest.approx(esperado, rel=1e-5)


def test_ema_smoothing_moves_only_a_fraction_of_the_way():
    model, losses = _model_and_losses()
    alpha = 0.1
    bal = LRAnnealing(model, ["pde", "bc"], reference="pde", update_every=1, alpha=alpha,
                      initial_weights={"pde": 1.0, "bc": 1.0}, clip_min=1e-6, clip_max=1e6)
    g_ref = _full_grad_abs(model, losses["pde"])
    g_bc = _full_grad_abs(model, losses["bc"])
    alvo = float(g_ref.max()) / float(g_bc.mean())
    bal.step(losses)
    esperado = (1 - alpha) * 1.0 + alpha * alvo
    assert bal.current_weights["bc"] == pytest.approx(esperado, rel=1e-5)


def test_update_every_skips_steps_in_between():
    model, losses = _model_and_losses()
    bal = LRAnnealing(model, ["pde", "bc"], reference="pde", update_every=3, alpha=1.0)
    bal.step(losses)                      # step 0: updates
    w_after_first = bal.current_weights["bc"]
    bal.step(losses)                      # step 1: no update
    bal.step(losses)                      # step 2: no update
    assert bal.current_weights["bc"] == w_after_first
    bal.step(losses)                      # step 3: updates again (same losses -> same target)
    assert bal.current_weights["bc"] == pytest.approx(w_after_first, rel=1e-5)


def test_history_records_every_term_on_update():
    model, losses = _model_and_losses()
    bal = LRAnnealing(model, ["pde", "bc"], reference="pde", update_every=1, alpha=0.5)
    for _ in range(4):
        bal.step(losses)
    hist = bal.history()
    assert len(hist["pde"]) == 4 and all(v == 1.0 for v in hist["pde"])
    assert len(hist["bc"]) == 4


def test_weight_scheduler_dispatches_lr_annealing():
    model, losses = _model_and_losses()
    sched = WeightScheduler(model, ["pde", "bc"],
                            WeightSchedulerConfig(method="lr_annealing", update_every=1))
    total = sched.step(losses, step=0)
    assert total.requires_grad
    assert sched.current_weights["pde"] == 1.0
    assert sched.current_weights["bc"] != 1.0
    assert "bc" in sched.weight_history()


def test_unknown_method_message_mentions_lr_annealing():
    model, _ = _model_and_losses()
    with pytest.raises(ValueError, match="lr_annealing"):
        WeightScheduler(model, ["pde", "bc"], WeightSchedulerConfig(method="not_a_method"))
