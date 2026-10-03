"""The top-level ``pinneapple`` namespace: everything advertised in ``__all__`` must resolve."""
import importlib

import pinneapple as pp


def test_every_name_in_all_resolves():
    broken = []
    for name in pp.__all__:
        try:
            getattr(pp, name)
        except Exception as exc:  # noqa: BLE001 - report every failure, not only the first
            broken.append(f"{name}: {type(exc).__name__}: {exc}")
    assert not broken, "names in pinneapple.__all__ that do not resolve:\n" + "\n".join(broken)


def test_star_import_works():
    ns: dict = {}
    exec("from pinneapple import *", ns)
    assert "get_preset" in ns and "SymbolicPDE" in ns


def test_every_lazy_submodule_alias_points_to_an_importable_module():
    for alias, target in pp._SUBMODULES.items():
        assert importlib.import_module(target) is getattr(pp, alias), alias


def test_info_runs_and_reports_packages_and_optional_extras(capsys):
    pp.info()
    out = capsys.readouterr().out
    assert "Packages:" in out and "Optional dependencies:" in out
    assert "import failed" not in out
