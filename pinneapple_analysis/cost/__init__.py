"""Computational-cost validation per operation (time, memory, FLOPs, scaling, budgets, regressions).

>>> from pinneapple_analysis.cost import measure, scaling_study, Budget
>>> rec = measure(lambda: sum(range(10**6)), repeats=5)
>>> study = scaling_study(lambda n: (lambda a=list(range(n)): sorted(a)), [10**4, 10**5, 10**6],
...                       declared="n log n")
>>> print(study.summary())
>>> Budget(max_time_s=2.0, max_time_exponent=1.3).validate(study)

See ``profiler`` for exactly what is and is not measured.
"""
from .profiler import (
    Budget,
    BudgetExceeded,
    CostLedger,
    CostRecord,
    Regression,
    ScalingFit,
    ScalingStudy,
    expected_exponent,
    measure,
    scaling_study,
)
from .torch_ops import pinn_operation_costs, profile_ops

__all__ = [
    "Budget", "BudgetExceeded", "CostLedger", "CostRecord", "Regression", "ScalingFit", "ScalingStudy",
    "expected_exponent", "measure", "scaling_study", "pinn_operation_costs", "profile_ops",
]
