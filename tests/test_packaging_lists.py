"""The wheel is built from the sdist: every wheel package must also be in the sdist include list."""
import os
import sys

import pytest

tomllib = pytest.importorskip("tomllib") if sys.version_info >= (3, 11) else pytest.importorskip("tomli")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_every_wheel_package_is_in_the_sdist():
    with open(os.path.join(ROOT, "pyproject.toml"), "rb") as f:
        targets = tomllib.load(f)["tool"]["hatch"]["build"]["targets"]
    wheel = set(targets["wheel"]["packages"])
    sdist = {i[:-3] for i in targets["sdist"]["include"] if i.endswith("/**")}
    assert wheel - sdist == set(), "missing from [tool.hatch.build.targets.sdist] include"
    for pkg in wheel:
        assert os.path.isfile(os.path.join(ROOT, pkg, "__init__.py")), pkg
