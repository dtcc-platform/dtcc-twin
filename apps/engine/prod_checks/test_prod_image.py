"""Checks of the DTCC Engine production image, run inside it by `pnpm engine:check:prod`.

The image contains no tests; `check-prod.sh` mounts this directory read-only.
"""

import json
import os
import platform
import subprocess
import sys
import sysconfig
from importlib.metadata import Distribution, distributions
from importlib.util import find_spec
from pathlib import Path

import ufl
from dolfinx import fem, mesh
from mpi4py import MPI

ENGINE_DIR = Path(__file__).resolve().parents[1]
LOCK_PLATFORMS = {"x86_64": "linux-64", "aarch64": "linux-aarch64"}
# Conda also installs compilers under a target prefix, such as aarch64-conda-linux-gnu-g++.
BUILD_ONLY_TOOLS = ("g++", "c++", "gfortran", "cmake", "ninja", "git")


def package_urls(explicit_list: str) -> set[str]:
    """The package URLs of a conda explicit list, without their hashes."""
    return {line.split("#")[0] for line in explicit_list.splitlines() if line.startswith("https://")}


def installed_engine() -> Distribution:
    """The dtcc-engine distribution in the environment's site-packages, not a source tree's egg-info on sys.path."""
    [engine] = distributions(name="dtcc-engine", path=[sysconfig.get_path("purelib")])
    return engine


def test_runs_as_a_non_root_user() -> None:
    assert os.getuid() != 0


def test_image_has_no_engine_source_checkout() -> None:
    # /app is the development image's checkout; /src is where the production build mounts it.
    assert [path for path in (Path("/app"), Path("/src")) if path.exists()] == []


def test_engine_distribution_contains_no_tests() -> None:
    files = installed_engine().files or []
    assert [str(file) for file in files if "tests" in file.parts or file.name.startswith("test_")] == []


def test_engine_is_not_an_editable_install() -> None:
    direct_url = json.loads(installed_engine().read_text("direct_url.json") or "{}")
    assert not direct_url.get("dir_info", {}).get("editable", False)


def test_test_extra_is_not_installed() -> None:
    # httpx is the test extra's only package that nothing else installs; pytest comes from Core.
    assert find_spec("httpx") is None


def test_build_only_tools_are_removed() -> None:
    bin_dir = Path(sys.prefix) / "bin"
    found = sorted(
        path.name
        for tool in BUILD_ONLY_TOOLS
        for path in bin_dir.glob(f"*{tool}")
        if path.name == tool or path.name.endswith(f"-{tool}")
    )
    assert found == []


def test_conda_packages_match_the_runtime_lock() -> None:
    lock = ENGINE_DIR / f"conda-{LOCK_PLATFORMS[platform.machine()]}.lock"
    installed = subprocess.run(
        ["conda", "list", "--prefix", sys.prefix, "--explicit"], check=True, capture_output=True, text=True
    ).stdout
    assert package_urls(installed) == package_urls(lock.read_text())


def test_conda_dependencies_are_consistent() -> None:
    # Removing the build-only packages bypassed conda's dependency checks; conda doctor exits 0 either way.
    report = subprocess.run(
        ["conda", "doctor", "--prefix", sys.prefix, "--verbose", "consistency"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert "The environment is consistent." in report, report


def test_installed_distributions_have_compatible_requirements() -> None:
    result = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


def test_fenicsx_compiles_a_form_into_an_empty_cache(tmp_path: Path) -> None:
    domain = mesh.create_unit_cube(MPI.COMM_WORLD, 1, 1, 1)
    fem.form(fem.Constant(domain, 1.0) * ufl.dx(domain=domain), jit_options={"cache_dir": tmp_path})
    assert any(tmp_path.iterdir())
