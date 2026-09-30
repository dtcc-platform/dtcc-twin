# DTCC Engine v1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver DTCC Engine v1 as specified in [DESIGN.md](DESIGN.md): discovery, asynchronous execution, polling, limited cancellation, and `.dtccpkg` delivery over one HTTP address, replacing Sim's mini-service.

**Architecture:** A Python package, `dtcc_engine`, provides a FastAPI HTTP service and, from increment 2, a Celery worker from the same installed package. Both call Core's and Sim's public Dataset APIs in-process. Engine adds request handling, routing, job state, and delivery; Core and Sim keep Dataset definitions, validation, computation, and package semantics.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, pytest, httpx (test client), Celery with Redis (from increment 2), DTCC Core and DTCC Sim, the development image in `apps/engine/Dockerfile`.

**Spec:** `apps/engine/DESIGN.md`. The spec is the binding authority; this plan argues from it.

## How this plan is organized

The spec requires the plan to "begin with upstream contract and dependency verification, then organize the Engine work into testable increments for discovery, local execution and packaging, remote targets and delivery, lifecycle behavior, and production image and Linux deployment verification." It also forbids inventing missing APIs in example code. Later increments depend on unresolved upstream work, so:

- **Increments 0 and 1** are written as executable tasks with complete code.
- **Increments 2 to 6** are specified by scope, upstream interfaces, checks, and blockers. Each is expanded into executable tasks, in this file, when its prerequisites are verified. Expanding an increment is a plan change and is reviewed like one.
- **Increment 2 is split.** 2a, local execution and packaging, runs with the current pins and is expanded into Tasks 10 to 14; 2b, execution of FEniCSx simulations, waits for upstream Sim changes. Cancellation moves to increment 4, because Celery's revocation needs its race handling (see increment 4).
- **Increment 5 is split.** 5a, the production image for the HTTP service, is expanded into executable tasks and runs before increment 2, so that the worker is built and tested on the final environment layers. 5b, the worker's part and the Linux deployment, stays an outline until increments 2 to 4 provide what it verifies.

## Global Constraints

- "Engine is a Python integration service"; it "must not grow into a custom task queue, workflow engine, or cluster manager."
- "Core remains the authority for Dataset definitions, DTCC Model semantics, input/output, validation, and package contracts. Sim owns its simulation methods and specialized numerical dependencies."
- "Engine returns each registered Dataset's Core `describe()` output unchanged" and "does not filter Datasets by package, infer formats from schemas, or supply default values for missing descriptor fields."
- "Engine must not maintain hand-written copies of Dataset argument models."
- "All Engine HTTP services use the shared token"; "the only exception is an unauthenticated health route that reports liveness and returns no Dataset, job, or version information."
- "Reference checkouts remain unmodified during Engine work. Missing shared capabilities require separately proposed Core or Sim changes."
- "Engine's test suite runs in the `dev` target through `pnpm engine:check`. It is not part of the repository-wide `pnpm check`."
- "Validation reports must distinguish passed, failed, skipped, and not-run checks."
- Repository rules: Git is read-only for agents (`AGENTS.md`); tests are written first and must fail because behavior is missing, not because of an import or setup error; public Python modules and functions get concise docstrings (`apps/engine/AGENTS.md`); no comment unless it says what the code cannot (`CONVENTIONS.md`).

## Review Focus

1. A consumer calls a Dataset route with a token that contains non-ASCII characters: the request is rejected with 401, not a server error. Pinned in Task 3, Step 1 (`test_dataset_routes_reject_missing_or_invalid_tokens`, non-ASCII case).
2. `ENGINE_API_TOKEN` is unset or empty when the service starts: the service refuses to start instead of accepting every request or no request. Pinned in Task 3, Step 1 (`test_empty_token_is_rejected_at_startup`).
3. A Dataset Definition is installed and registered after Engine started: it appears in the listing and the revision changes, without Engine code changes. Pinned in Task 3, Step 1 (`test_new_dataset_definition_appears_and_changes_revision`).
4. A developer runs `pnpm engine:check` while `pnpm dev:engine` is serving: both work, because `compose run` does not publish the service port. Pinned in Task 4, Step 5.
5. A frontend or backend developer runs the README's `docker compose up -d --wait`: only Postgres starts. Pinned in Task 4, Step 5.
6. The `prod` image is built: it contains exactly the runtime lock's conda packages, with their dependencies still consistent, so no C++ compiler, CMake, Ninja, or Git, and FEniCSx still compiles a form, as the non-root user, into an empty cache. Pinned in Task 6, Step 1 (`test_conda_packages_match_the_runtime_lock`, `test_conda_dependencies_are_consistent`, `test_build_only_tools_are_removed`, `test_fenicsx_compiles_a_form_into_an_empty_cache`).
7. A developer runs `pnpm engine:check:prod` while `pnpm dev:engine` and Postgres are running: both keep running, because the check uses its own Compose project and publishes no port. Pinned in Task 7, Step 5.
8. A developer on Apple silicon builds the Engine image: it is built for `linux/amd64`, and Core builds a volume mesh of a small city, which fails on Linux arm64. Pinned in Task 9, Step 1 (`test_core_builds_a_volume_mesh_of_a_small_city`).
9. A consumer polls a job ID that Engine never accepted: `404` with "unknown or expired", not `queued`. Pinned in Task 10 (`test_unknown_job_is_not_found_rather_than_queued`).
10. Redis cannot record a submitted job: `503`, and nothing is sent. The broker does not confirm a job's message: `503` with the job's ID, the job is reported as `unconfirmed`, and it is not sent again, because it may already be queued. Pinned in Task 10 (`test_unreachable_redis_is_reported_as_unavailable`, `test_unconfirmed_submission_keeps_the_job_and_reports_it`).
11. A running job has not reported progress: its status has no progress at all; once Core reports, the report appears unchanged. Pinned in Task 11 (`test_running_job_reports_upstream_progress_and_invents_none`).
12. A package is requested a minute before and a second after 30 days from its job's finish: the first is served, the second is `404` with its status, although the file and Celery's result still exist. Pinned in Task 12 (`test_finished_job_and_its_package_expire_after_the_retention`).
13. A consumer sends a provider credential where Engine or the Dataset rejects it, as a value or by mistake as a field name: the `422` gives each error's type and location without repeating it. Pinned in Task 10 (`test_validation_errors_repeat_no_submitted_names_or_values`).
14. Jobs are submitted while a long job runs on a one-process worker: each waiting job runs once, and the broker does not deliver it again after its visibility timeout. Pinned in Task 14 (`test_job_waiting_behind_a_running_job_runs_once`).

---

## Increment 0: Upstream contract and dependency verification

Status: executed 2026-09-28; changes left uncommitted for team review.

### Task 1: Record the verified dependency baseline

**Files:**

- Modify: `apps/engine/DESIGN.md` ("Upstream inspection and implementation prerequisites")

**Interfaces:**

- Consumes: nothing.
- Produces: the baseline later increments cite: Core `5ca2ca410f24763591dc62c7b61f870cef13f717` (the commit Sim pins), Sim `2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf`, TetGen wrapper `22ab9ff2ee1dd03f82ce24dd0f378f00da7e487c`, dolfinx 0.11.0, Python 3.12.

- [x] **Step 1: Confirm the public interfaces discovery relies on, at the pinned commits**

Run (read-only):

```sh
C=5ca2ca410f24763591dc62c7b61f870cef13f717
gh api "repos/dtcc-platform/dtcc-core/contents/dtcc_core/datasets/dataset.py?ref=$C" --jq .content | base64 -d | grep -n -E "def describe|def show_options|class DatasetDescriptor|def __init_subclass__"
gh api "repos/dtcc-platform/dtcc-core/contents/dtcc_core/datasets/__init__.py?ref=$C" --jq .content | base64 -d | grep -n -E "list_datasets as list|unregister|DatasetBaseArgs"
gh api "repos/dtcc-platform/dtcc-sim/contents/pyproject.toml?ref=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf" --jq .content | base64 -d | grep -n dtcc-core
```

Expected: `DatasetDescriptor` with `__init_subclass__` auto-registration, `show_options`, and `describe`; `list_datasets as list`, `unregister`, and `DatasetBaseArgs` exported from `dtcc_core.datasets`; Sim pinning `dtcc-core` at `5ca2ca4…`. If any is missing, stop: discovery's interfaces have changed and the spec's discovery section must be revisited first.

- [x] **Step 2: Update the spec's baseline**

In `apps/engine/DESIGN.md`, replace the "Inspected revision" table rows with:

```markdown
| Reference                  | Inspected revision                         |
| -------------------------- | ------------------------------------------ |
| `dtcc-core`, pinned by Sim | `5ca2ca410f24763591dc62c7b61f870cef13f717` |
| `dtcc-sim`                 | `2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf` |
| `dtcc-tetgen-wrapper`      | `22ab9ff2ee1dd03f82ce24dd0f378f00da7e487c` |
```

Change the sentence above the table from "from the local reference checkouts inspected during planning" to "from the revisions installed in the development image, inspected through GitHub at those commits".

Replace item 3 of "Required upstream and integration work" with:

```markdown
3. **Dependency alignment is established for the development image.** The
   image installs Sim at a pinned commit and Core at the commit that Sim pins,
   so the two form the tested pair. Re-verify this pair, and the interfaces each
   increment relies on, whenever a pin changes.
```

Run: `npx --yes prettier@3.9.6 --write apps/engine/DESIGN.md && npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md`
Expected: the file uses Prettier code style.

- [x] **Step 3: Stop for review**

Leave changes uncommitted. Report the Step 1 output.

---

## Increment 1: Discovery

Status: executed 2026-09-28; changes left uncommitted for team review. A later review added RFC 6750 token-format validation at startup and a test comparing listed descriptions with Core's `describe()`; `apps/engine/dtcc_engine/api.py` and `apps/engine/tests/` are authoritative where they differ from the Task 3 listings below.

Upstream interfaces relied on: `dtcc_core.datasets.list()`, `DatasetDescriptor.describe()`, `DatasetDescriptor` auto-registration, `dtcc_core.datasets.unregister()` (tests only), and Sim's registration on `import dtcc_sim`. Unresolved upstream blockers: none.

Sim mini-service reuse: `service/routes.py:list_datasets` is the starting point. Its module-prefix filter, `_extract_formats`, and fabricated defaults (`"bin"`, `"simulation"`) are deliberately not carried over (spec, Discovery). Its route prefix `/api/v1` is kept.

### Task 2: Engine package with environment tests

**Files:**

- Create: `apps/engine/pyproject.toml`
- Create: `apps/engine/dtcc_engine/__init__.py`
- Create: `apps/engine/tests/test_environment.py`
- Delete: `apps/engine/smoke_check.py` (its checks move into `tests/test_environment.py`)
- Modify: `apps/engine/Dockerfile` (from `ENV PYTHONUNBUFFERED=1` to the end)
- Modify: `apps/engine/.dockerignore`
- Modify: `package.json` (`engine:check` script)
- Modify: `.gitignore` (add `.pytest_cache/`)

**Interfaces:**

- Consumes: the image's conda environment `engine` and entrypoint (unchanged).
- Produces: installed distribution `dtcc-engine` (version `0.1.0`), import package `dtcc_engine`, test extra `[test]` with `pytest` and `httpx`; `pnpm engine:check` runs `pytest` in the image with `apps/engine` as the working directory.

- [x] **Step 1: Write the environment tests**

Create `apps/engine/tests/test_environment.py`:

```python
"""Environment tests for the DTCC Engine development image.

They check that Core, Sim, FEniCSx, PETSc, HDF5, and the TetGen wrapper are installed
and work together. Passing them verifies only the development image,
not a production deployment.
"""

from importlib.metadata import distribution
from pathlib import Path

import basix.ufl
import dtcc_sim
import dtcc_tetgen_wrapper
import h5py
import numpy as np
import pytest
import ufl
from dolfinx import fem, io, mesh
from dolfinx.fem.petsc import LinearProblem
from dtcc_core.builder.meshing.tetgen import is_tetgen_available
from mpi4py import MPI

UNIT_CUBE_VERTICES = np.array(
    [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ]
)
UNIT_CUBE_SIDES = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
]
# A pip wheel of any of these bundles its own GDAL, PROJ or HDF5 next to conda's copy.
NATIVE_LIBRARY_PACKAGES = ("fiona", "rasterio", "pyproj", "pyogrio", "h5py")


@pytest.fixture(scope="module")
def unit_cube_tetrahedra() -> tuple[np.ndarray, np.ndarray]:
    """TetGen's points, shape (N, 3), and tetrahedra, shape (M, 4), for a unit cube."""
    no_triangles = np.empty((0, 3), dtype=np.int64)
    result = dtcc_tetgen_wrapper.tetrahedralize(UNIT_CUBE_VERTICES, no_triangles, UNIT_CUBE_SIDES)
    return np.asarray(result.points), np.asarray(result.tets)


@pytest.fixture(scope="module")
def unit_cube_domain(unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray]) -> mesh.Mesh:
    """A first-order tetrahedral FEniCSx mesh of the unit cube."""
    points, tetrahedra = unit_cube_tetrahedra
    coordinate_element = ufl.Mesh(basix.ufl.element("Lagrange", "tetrahedron", 1, shape=(3,)))
    return mesh.create_mesh(MPI.COMM_WORLD, tetrahedra.astype(np.int64), coordinate_element, points)


def test_dtcc_sim_is_installed() -> None:
    assert dtcc_sim.__version__


def test_core_uses_the_tetgen_wrapper() -> None:
    assert is_tetgen_available()


def test_native_library_packages_come_from_conda() -> None:
    installers = {name: (distribution(name).read_text("INSTALLER") or "").strip() for name in NATIVE_LIBRARY_PACKAGES}
    assert installers == {name: "conda" for name in NATIVE_LIBRARY_PACKAGES}


def test_tetgen_tetrahedralizes_the_unit_cube(unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray]) -> None:
    _, tetrahedra = unit_cube_tetrahedra
    assert tetrahedra.ndim == 2 and tetrahedra.shape[1] == 4 and len(tetrahedra) > 0


def test_fenicsx_assembles_the_unit_cube_volume(unit_cube_domain: mesh.Mesh) -> None:
    one = fem.Constant(unit_cube_domain, 1.0)
    volume = fem.assemble_scalar(fem.form(one * ufl.dx(domain=unit_cube_domain)))
    assert volume == pytest.approx(1.0, abs=1e-10)


def test_petsc_solves_a_problem_with_a_known_solution(unit_cube_domain: mesh.Mesh) -> None:
    # u - div(grad(u)) = 1 with natural boundary conditions has the exact solution u = 1.
    function_space = fem.functionspace(unit_cube_domain, ("Lagrange", 1))
    trial = ufl.TrialFunction(function_space)
    test = ufl.TestFunction(function_space)
    bilinear_form = (trial * test + ufl.inner(ufl.grad(trial), ufl.grad(test))) * ufl.dx
    linear_form = fem.Constant(unit_cube_domain, 1.0) * test * ufl.dx
    problem = LinearProblem(
        bilinear_form,
        linear_form,
        petsc_options_prefix="environment_test_",
        petsc_options={"ksp_type": "preonly", "pc_type": "lu"},
    )
    solution = problem.solve()
    assert np.max(np.abs(solution.x.array - 1.0)) < 1e-10


def test_mesh_round_trips_through_hdf5(
    unit_cube_domain: mesh.Mesh, unit_cube_tetrahedra: tuple[np.ndarray, np.ndarray], tmp_path: Path
) -> None:
    xdmf_path = tmp_path / "cube.xdmf"
    with io.XDMFFile(unit_cube_domain.comm, str(xdmf_path), "w") as xdmf_file:
        xdmf_file.write_mesh(unit_cube_domain)
    with h5py.File(xdmf_path.with_suffix(".h5"), "r") as hdf5_file:
        cells_read = hdf5_file[f"Mesh/{unit_cube_domain.name}/topology"].shape[0]
    assert cells_read == len(unit_cube_tetrahedra[1])
```

Change the `engine:check` script in `package.json` to:

```json
"engine:check": "docker compose --profile engine run --rm --build engine pytest",
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `docker compose --profile engine run --rm --build engine pytest`
Expected: FAIL, but not with `pytest: not found`: pytest is already present transitively (dtcc-core → linkml → prefixcommons → pytest-logging), so the run reports "collected 0 items" / "no tests ran" (exit 5) because the image has no Engine package or tests yet. Any other failure is a setup mistake to fix first.

- [x] **Step 3: Create the package and install it in the image**

Create `apps/engine/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=64"]
build-backend = "setuptools.build_meta"

[project]
name = "dtcc-engine"
version = "0.1.0"
description = "DTCC Engine: an HTTP service over the Datasets of DTCC Core and DTCC Sim"
requires-python = ">=3.12"
# Core and Sim versions are pinned by the environment (see Dockerfile), not here.
dependencies = [
    "dtcc-core",
    "dtcc-sim",
    "fastapi==0.141.1",
    "uvicorn==0.54.0",
]

[project.optional-dependencies]
test = ["pytest==9.1.1", "httpx==0.28.1"]

[tool.setuptools.packages.find]
include = ["dtcc_engine*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Create `apps/engine/dtcc_engine/__init__.py`:

```python
"""DTCC Engine: an HTTP service over the Datasets of DTCC Core and DTCC Sim."""
```

Replace `apps/engine/.dockerignore` with:

```
*
!pyproject.toml
!dtcc_engine/
!tests/
**/__pycache__
```

In `apps/engine/Dockerfile`, replace everything from `ENV PYTHONUNBUFFERED=1` to the end with:

```dockerfile
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY dtcc_engine ./dtcc_engine
RUN pip install --no-cache-dir -e ".[test]"
COPY tests ./tests

# `conda run` does not forward SIGTERM to its child, so activate and exec under the base image's tini.
ENTRYPOINT ["tini", "--", "/bin/bash", "-c", "source /opt/conda/etc/profile.d/conda.sh && conda activate engine && exec \"$@\"", "engine"]
CMD ["pytest"]
```

Delete `apps/engine/smoke_check.py`.

In `.gitignore`, add `.pytest_cache/` after `__pycache__/`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose --profile engine run --rm --build engine pytest`
Expected: `7 passed`. The pip step must report `dtcc-core` and `dtcc-sim` as already satisfied, not reinstall them.

- [x] **Step 5: Verify the environment test catches a missing library**

Run: `docker compose --profile engine run --rm engine bash -c 'rm -rf "$(python -c "import petsc4py, os; print(os.path.dirname(petsc4py.__file__))")" && pytest'`
Expected: a collection error with `ModuleNotFoundError: No module named 'petsc4py'` and a non-zero exit. The container is discarded, so the image is unchanged.

- [x] **Step 6: Stop for review**

Leave changes uncommitted. Report Steps 2, 4, and 5.

### Task 3: Discovery API

**Files:**

- Create: `apps/engine/dtcc_engine/api.py`
- Create: `apps/engine/tests/test_discovery.py`

**Interfaces:**

- Consumes: `dtcc-engine` package and `[test]` extra from Task 2.
- Produces:
  - `dtcc_engine.api.create_app(api_token: str) -> fastapi.FastAPI`; raises `ValueError` for an empty token.
  - `dtcc_engine.api.create_app_from_environment() -> fastapi.FastAPI`, the Uvicorn `--factory` entry point, reading `ENGINE_API_TOKEN`.
  - `GET /api/v1/health` (no token) → `200 {"status": "ok"}`.
  - `GET /api/v1/datasets` (token) → `200 {"catalog_revision": "sha256:<hex>", "versions": {"dtcc-engine": str, "dtcc-core": str, "dtcc-sim": str}, "datasets": {name: describe()}}`.
  - `GET /api/v1/datasets/{name}` (token) → `200 describe()` or `404`.
  - Token errors → `401` with `WWW-Authenticate: Bearer`.
  - `/docs`, `/redoc`, and `/openapi.json` are not served (`404`).

- [x] **Step 1: Write the discovery tests**

Create `apps/engine/tests/test_discovery.py`:

```python
"""Tests for Engine's discovery API against the installed DTCC Core and DTCC Sim."""

import json

import pytest
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from dtcc_core.datasets import list as registered_datasets
from fastapi.testclient import TestClient
from pydantic import Field

from dtcc_engine.api import create_app

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(TOKEN))


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/api/v1/datasets", "/api/v1/datasets/buildings"])
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong-token"},
        {"Authorization": TOKEN},
        {"Authorization": "Bearer tést-token".encode("latin-1")},
    ],
    ids=["missing", "wrong", "no-scheme", "non-ascii"],
)
def test_dataset_routes_reject_missing_or_invalid_tokens(client: TestClient, path: str, headers: dict) -> None:
    response = client.get(path, headers=headers)
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_documentation_is_not_served(client: TestClient, path: str) -> None:
    # The health route is the spec's only unauthenticated exception.
    assert client.get(path).status_code == 404


def test_empty_token_is_rejected_at_startup() -> None:
    with pytest.raises(ValueError):
        create_app("")


def test_listing_contains_every_registered_core_and_sim_dataset(client: TestClient) -> None:
    listed = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["datasets"]
    assert set(listed) == set(registered_datasets())
    assert {"buildings", "urban_heat_simulation"} <= set(listed)


def test_listing_reports_installed_versions(client: TestClient) -> None:
    versions = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["versions"]
    assert set(versions) == {"dtcc-engine", "dtcc-core", "dtcc-sim"}
    assert all(versions.values())


def test_revision_is_stable_while_the_catalog_is_unchanged(client: TestClient) -> None:
    first = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["catalog_revision"]
    second = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["catalog_revision"]
    assert first == second
    assert first.startswith("sha256:")


def test_describe_returns_core_description_unchanged(client: TestClient) -> None:
    response = client.get("/api/v1/datasets/urban_heat_simulation", headers=AUTHORIZED)
    assert response.status_code == 200
    expected = json.loads(json.dumps(registered_datasets()["urban_heat_simulation"].describe()))
    assert response.json() == expected


def test_unknown_dataset_is_not_found(client: TestClient) -> None:
    response = client.get("/api/v1/datasets/no_such_dataset", headers=AUTHORIZED)
    assert response.status_code == 404


def test_new_dataset_definition_appears_and_changes_revision(client: TestClient) -> None:
    before = client.get("/api/v1/datasets", headers=AUTHORIZED).json()

    class EngineDiscoveryProbeArgs(DatasetBaseArgs):
        label: str = Field(default="probe", description="Label returned by the probe Dataset")

    class EngineDiscoveryProbeDataset(DatasetDescriptor):
        name = "engine_discovery_probe"
        description = "Dataset defined by an Engine test to check generic discovery"
        ArgsModel = EngineDiscoveryProbeArgs

        def build(self, args):
            return args.label

    try:
        after = client.get("/api/v1/datasets", headers=AUTHORIZED).json()
    finally:
        unregister("engine_discovery_probe")

    assert "engine_discovery_probe" not in before["datasets"]
    assert "engine_discovery_probe" in after["datasets"]
    assert after["catalog_revision"] != before["catalog_revision"]
```

Create `apps/engine/dtcc_engine/api.py` as a skeleton, so that the tests fail on behavior rather than on an import error:

```python
"""HTTP API for DTCC Engine."""

from fastapi import FastAPI


def create_app(api_token: str) -> FastAPI:
    """Create the Engine HTTP application."""
    return FastAPI()
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `docker compose --profile engine run --rm --build engine pytest tests/test_discovery.py`
Expected: FAIL. Route tests fail with `404` where `200` or `401` is expected, `test_api_documentation_is_not_served` fails with `200` for all three paths, and `test_empty_token_is_rejected_at_startup` fails with `DID NOT RAISE`. No test fails on an import or collection error. Environment tests are not part of this run.

- [x] **Step 3: Implement the API**

Replace `apps/engine/dtcc_engine/api.py` with:

```python
"""HTTP API for DTCC Engine.

Exposes the Dataset Definitions registered with DTCC Core, including those that
DTCC Sim contributes on import, as Core describes them.
"""

import hashlib
import json
import os
import secrets
from importlib.metadata import version
from typing import Any

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

VERSIONED_PACKAGES = ("dtcc-engine", "dtcc-core", "dtcc-sim")


def installed_versions() -> dict[str, str]:
    """Return the installed Engine, Core, and Sim distribution versions."""
    return {package: version(package) for package in VERSIONED_PACKAGES}


def dataset_catalog() -> dict[str, Any]:
    """Return the discovery listing for every Dataset registered with Core.

    The listing holds the installed versions, each Dataset's Core `describe()`
    output keyed by name, and `catalog_revision`: a SHA-256 digest of the versions
    and descriptions, which changes whenever either changes.
    """
    content = {
        "versions": installed_versions(),
        "datasets": {name: dataset.describe() for name, dataset in datasets.list().items()},
    }
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return {"catalog_revision": "sha256:" + hashlib.sha256(canonical.encode()).hexdigest(), **content}


def create_app(api_token: str) -> FastAPI:
    """Create the Engine HTTP application.

    Args:
        api_token: Shared token that every route except the health route requires,
            sent as `Authorization: Bearer <token>`.

    Raises:
        ValueError: If `api_token` is empty.
    """
    if not api_token:
        raise ValueError("The Engine API token must not be empty")
    expected_token = api_token.encode()
    bearer = HTTPBearer(auto_error=False)

    def require_token(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
        if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), expected_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing or invalid Engine API token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Generated documentation would be served without the token; health is the only public route.
    app = FastAPI(title="DTCC Engine", version=version("dtcc-engine"), docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/datasets", dependencies=[Depends(require_token)])
    def list_datasets() -> dict[str, Any]:
        return dataset_catalog()

    @app.get("/api/v1/datasets/{name}", dependencies=[Depends(require_token)])
    def describe_dataset(name: str) -> dict[str, Any]:
        registered = datasets.list()
        if name not in registered:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dataset '{name}' is not registered")
        return registered[name].describe()

    return app


def create_app_from_environment() -> FastAPI:
    """Create the application with the token from `ENGINE_API_TOKEN`; the Uvicorn `--factory` entry point.

    Raises:
        ValueError: If `ENGINE_API_TOKEN` is unset or empty.
    """
    return create_app(os.environ.get("ENGINE_API_TOKEN", ""))
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `docker compose --profile engine run --rm --build engine pytest`
Expected: 26 passed: 7 environment tests and 19 discovery tests (8 token cases, 3 documentation paths, and 8 other tests).

If `json.dumps` in `dataset_catalog` raises `TypeError` for a Dataset's description, stop: a Core `describe()` result is not JSON-serializable, which is an upstream Core defect under the spec's "Core is the authority" rule. Report the Dataset name; do not add a `default=` fallback in Engine.

- [x] **Step 5: Stop for review**

Leave changes uncommitted. Report Steps 2 and 4.

### Task 4: Serve discovery locally through Compose

**Files:**

- Modify: `compose.yaml` (`engine` service)
- Modify: `apps/engine/Dockerfile` (`CMD` and `EXPOSE`)
- Modify: `package.json` (add `dev:engine`)
- Modify: `README.md` (Start note and Commands table)

**Interfaces:**

- Consumes: `dtcc_engine.api:create_app_from_environment` from Task 3.
- Produces: `pnpm dev:engine` serves the Engine API at `http://127.0.0.1:8000/api/v1` with the local token `local-dev-engine-token` unless `ENGINE_API_TOKEN` is set; `pnpm engine:check` still runs `pytest`.

- [x] **Step 1: Write the failing check**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/health`
Expected: FAIL with a connection error (`Failed to connect`), because nothing serves the Engine API yet.

- [x] **Step 2: Serve the API from the image and Compose**

In `apps/engine/Dockerfile`, replace `CMD ["pytest"]` with:

```dockerfile
EXPOSE 8000
CMD ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--host", "0.0.0.0", "--port", "8000"]
```

Replace the `engine` service in `compose.yaml` with the following, indented one level under `services:` like `postgres`:

```yaml
engine:
  # Optional: a large Core, Sim and FEniCSx image.
  profiles: [engine]
  build: apps/engine
  command:
    [
      "uvicorn",
      "dtcc_engine.api:create_app_from_environment",
      "--factory",
      "--host",
      "0.0.0.0",
      "--port",
      "8000",
      "--reload",
    ]
  environment:
    # Local development only: the port below is reachable from this machine alone.
    ENGINE_API_TOKEN: ${ENGINE_API_TOKEN:-local-dev-engine-token}
  ports:
    - "127.0.0.1:8000:8000"
  volumes:
    - ./apps/engine:/app
  healthcheck:
    test:
      ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"]
    interval: 5s
    timeout: 3s
    retries: 30
```

In `package.json`, add after `engine:check`:

```json
"dev:engine": "docker compose --profile engine up --build engine",
```

- [x] **Step 3: Verify the API is served and protected**

Run: `docker compose --profile engine up -d --build --wait engine`
Then:

```sh
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/health
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/v1/datasets
curl -sS -H "Authorization: Bearer local-dev-engine-token" http://127.0.0.1:8000/api/v1/datasets | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['catalog_revision'][:15], len(d['datasets']))"
```

Expected: `200`; `401`; a `sha256:` revision prefix and a Dataset count of at least 28 (Core's registered Datasets plus Sim's four).

- [x] **Step 4: Verify that code changes reload without a rebuild**

Append a blank line to `apps/engine/dtcc_engine/api.py`, wait five seconds, run `docker compose --profile engine logs --tail 20 engine`, and confirm Uvicorn reports a reload. Remove the blank line afterwards. If no reload is reported, add `WATCHFILES_FORCE_POLLING: "true"` under the service's `environment`, record the change as a ruling, and repeat.

- [x] **Step 5: Verify the other workflows are unaffected**

With the service still running, run `docker compose --profile engine run --rm engine pytest`.
Expected: all tests pass; `compose run` does not publish port 8000, so it does not conflict with the running service.

Run: `docker compose config --services`
Expected: exactly `postgres`.

Then stop the service: `docker compose --profile engine stop engine`.

- [x] **Step 6: Update the README**

Replace the README paragraph that begins "The engine's development image is optional and large." with:

```markdown
The engine is optional and its image is large; frontend and backend work does not need it. `pnpm dev:engine` serves its API at <http://127.0.0.1:8000/api/v1> (token `local-dev-engine-token` unless `ENGINE_API_TOKEN` is set), and `pnpm engine:check` runs its tests in the image.
```

Change the `apps/engine` Packages row description to `DTCC Engine, a Python API over DTCC Core and Sim; serves Dataset discovery so far`.

Change the `pnpm engine:check` Commands row to `Run the engine's tests in its image. Needs Docker`, and add a row after it: `` `pnpm dev:engine` `` | `The engine API in its image, reloading on code changes. Needs Docker`.

Run: `npx --yes prettier@3.9.6 --write README.md compose.yaml package.json && npx --yes prettier@3.9.6 --check README.md compose.yaml package.json apps/engine/DESIGN.md`
Expected: all files use Prettier code style.

- [x] **Step 7: Stop for review**

Leave changes uncommitted. Report Steps 1, 3, 4, and 5.

---

## Increment 2a: Local execution and packaging

Status: expanded into Tasks 10 to 14. Tasks 10 to 13 were executed 2026-09-30; Task 14, added after the review of the whole increment, was executed 2026-10-01 and is not yet committed. Task 10 was executed 2026-09-30, after a probe in the development image confirmed that a Dataset's `ProgressTracker(total=100)` update reaches the thread-local callback as `(50.0, 'halfway')` and that a bare triangle `Mesh` survives canonical export and `load_model_package`, and is committed in `bb881a0`. Its results: before the implementation, `engine:check` gave 12 failed, each on a status code or the default `Not Found` detail, and 38 passed; after it, 50 passed, and `pnpm check` passed. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed. Task 11 was executed 2026-09-30 and is committed in `cf115d5`. Its results: before the implementation, with the worker fixture running, `engine:check` gave 6 failed, each on an assertion, and 50 passed: the 4 execution tests because every job completed at once without a package, the status test with `completed` and no finish time, and the sharing test because another Celery app had the task; after it, 56 passed in 5.5 s, and `pnpm check` passed. Task 12 was executed 2026-09-30 and is committed in `3609179`. Its results: before the implementation, `engine:check` gave 6 failed and 56 passed: the new token case, the download test, and `within-retention` got `404` from the missing route, the unknown-or-unfinished test got `(404, 404)`, `after-retention` got `200` for the status, and the completed job's record had no expiry while its Celery result had the one-day default; after it, 62 passed in 6.6 s, and `pnpm check` passed. Task 13 was executed 2026-09-30 and is committed in `f4cf8a1`. Its results: with `pnpm dev:engine` running the API and the worker, a `smoke` job was `running` at its first poll and finished 0.9 s after submission; its 114 KB package downloaded with the stored file's SHA-256, and Core read it as a `VolumeMesh` from `smoke`. A `traffic_simulation` job, with roads from Overpass and DeSO zones and statistics from Statistics Sweden, finished in 11.8 s without reporting progress, and Core read its 21 KB package as a `RoadNetwork`. `engine:check` then gave 62 passed while the development database still held exactly those two jobs and the API and the worker kept running. Stopped while idle, the worker logged a warm shutdown and exited with 0, without the `MPI_Abort` that still ends the API's process. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 14's results: before the setting, the redelivery test failed on its last assertion with `['1', '2', '1']`, so the waiting job ran twice. With `path.unlink()` removed, the deletion test failed on its last assertion, because the package remained, and the failed job's download test passed; with the line restored, `jobs.py` was unchanged. After the setting, `engine:check` gave 64 passed in 11.3 s; in the full run, billiard warns that the test process is multi-threaded when the pool forks, which the test alone does not. With `pnpm dev:engine` running, `inspect conf` printed `"worker_disable_prefetch": true` for the worker, which logged a warm shutdown and exited with 0 when stopped. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed.

**Scope:** Redis and a Celery worker from the same image; job submission (`POST`) with request-envelope and target validation, status polling with upstream progress, and `.dtccpkg` download for Datasets executed on the local target; a completed package is refused once 30 periods of 24 hours have passed since its job completed. Every registered Dataset can be submitted; one whose result Core cannot package canonically produces a failed job with Core's error, because the spec forbids a curated Dataset list and makes required packaging failures fail delivery. Pre-execution cancellation moves to increment 4.

**Upstream interfaces**, verified 2026-09-30 at Core `5ca2ca4` and Sim `2422bba` through GitHub, and by running the development image:

- `DatasetDescriptor.validate(kwargs)` is `ArgsModel(**kwargs)` and raises pydantic's `ValidationError`; `DatasetBaseArgs` forbids unknown fields and checks the bounds' length and order. Engine keeps no copies of argument models.
- Calling a Dataset validates, builds, and attaches a `DatasetContext`, but only to a `dtcc_core.model.Model` result. With a non-null `format`, several builds return serialized bytes without a context (`city_volume_mesh`, `buildings`, `calibration_grid`), which cannot be packaged.
- The realization's `export(path, canonical=True)` delegates to `dtcc_core/datasets/package.py:export_model_package`. It encodes before touching the target, stages the package in a temporary `.dtcc-package-*` directory beside it, and moves it into place with `os.replace`. Limits: 256 MiB for the archive and for its artifacts, 4 MiB for the manifest, 9999 artifacts; Core `develop` removes the 256 MiB limit (`c65323d`). `DatasetDescriptor.export()` is not used: it rebuilds the Dataset, which would repeat the computation.
- `dtcc_core.datasets.load_model_package(path)` accepts only a v3 package with exactly one canonical artifact, checks every artifact's size and sha256, decodes the model, cross-checks its metadata, and restores its context.
- Canonical exchange does not support `FootprintCollection`, `CalibrationGrid`, `BuildingCollection`, or `TreeCollection` results (the last two confirmed on Core `develop`, where their Datasets build; [dtcc-core#135](https://github.com/dtcc-platform/dtcc-core/issues/135)).
- Sim's `service/progress.py` sets Core's thread-local progress callback and reports it as a `PROGRESS` state. At the pinned commit, Core's callback always supplies `percent` (`dtcc_core/common/progress.py`, `_get_state_dict`), along with a message, phase, and ETA, so the bridge's fallback of 0 is not reached; Engine keeps the percentage Core reports, including zero, and reports none when none is supplied.
- Importing Sim initializes PETSc, whose signal handler catches SIGTERM and calls `MPI_Abort`, so the process ends without its own shutdown (observed 2026-09-30 when stopping `pnpm dev:engine` on `linux/amd64`, and in a Python process that imports Sim and receives SIGTERM, on both `linux/amd64` and `linux/arm64`). This may interfere with a Celery worker's warm shutdown, but it is not established: the worker imports task modules before it installs its own SIGTERM handler (`celery/worker/worker.py`, `WorkController.__init__`; `celery/apps/worker.py`, `install_platform_tweaks`), and prefork children handle signals separately. Verify with a real worker before choosing a workaround such as PETSc's `-no_signal_handler` option.
- Celery 5.6.3, the latest stable release (2026-03-26); kombu 5.6.2's `redis` extra caps redis-py below 6.5. A task ID with no stored result reads as `PENDING` (`celery/backends/base.py`, `_get_task_meta_for`), so Engine must record accepted jobs itself. `task_track_started` defaults to false. The Redis result backend stores each state with `SETEX` and `result_expires`, so a key's lifetime restarts on each effective write (`celery/backends/redis.py`, `_set`); a write is skipped once the stored state is `SUCCESS` (`celery/backends/base.py`, `BaseKeyValueStoreBackend._store_result`). `result_expires` defaults to one day. Runtime behavior is not yet verified.

**Round-trip evidence** (development image, 200 m box in Gothenburg, EPSG:3006): at Core `5ca2ca4`, 15 of 28 registered Datasets pass canonical export and `load_model_package` with an identical model encoding and context: `air_quality`, `weather`, `hydrology`, `ocean`, `buses`, `ferries`, `metros`, `trains`, `trams`, `transit_vehicles`, `deso`, `roads`, `space_syntax`, `smoke`, and Sim's `traffic_simulation`. The vehicle and sensor results may be empty (no API keys, and `strict_live` defaults to false), so they show that the format works, not that content is complete. Point-cloud-based Datasets fail at the pin on a Core bug that `develop` fixes (increment 2b).

**Decisions**, settled 2026-09-30:

- A request whose parameters set `format` is rejected with an explanation; supplementary artifacts through `export(..., format=...)` are later work.
- `celery[redis]==5.6.3` goes in `pyproject.toml` `dependencies`, so the builder installs it while Git is present; `task_track_started=True`, so running jobs are distinguishable from queued ones.
- Development Redis is `redis:8`, pinned to the major like Postgres, with `maxmemory-policy noeviction`; Sim's Compose file used `allkeys-lru`, which can evict queued tasks and results. Redis 8 is licensed AGPL-3.0, RSALv2, or SSPL, which permits running the unmodified image; Valkey (BSD) was considered.
- Job metadata stays available until 30 periods of 24 hours after completion (DESIGN.md, "Package creation, delivery, and retention"). Engine writes its own acceptance record per job in Redis (Dataset, target, submission time) rather than relying on a Celery state; the record does not expire while the job is queued or running. When the job finishes, the record and Celery's result are kept for 31 days, a day beyond the retention, while status and package are refused from 30 periods of 24 hours after the finish time. Unknown and expired jobs are then distinguishable from queued ones. How the record of a job lost before completion ends is settled with increment 4's restart behavior.
- Packages are stored as `<job id>.dtccpkg` in `ENGINE_PACKAGE_DIR`, a volume shared by a host's API and worker containers and writable by uid 10001. Expiry is enforced from the job's UTC completion time, not from the Redis key's lifetime.
- Automated checks use `smoke` (Core; synthetic, deterministic, and offline). `traffic_simulation` (Sim), which downloads roads from OpenStreetMap and zones from Statistics Sweden, runs once as a manual, recorded verification step, so `engine:check` does not depend on those services.

**Migration from Sim's mini-service:** adapt `service/tasks.py` (Celery task invoking a Dataset inside the progress bridge) as one generic task taking the Dataset name and parameters, and `service/progress.py`, passing Core's reported values through without a fallback percentage, with the submission-validation and status-snapshot cases of `tests/test_service_routes.py`. Do not carry over the module-prefix filter, default `format` injection, reporting `PENDING` as pending, `str(result)` failure messages, `terminate=True` cancellation, `service/results.py` shared-volume delivery, or the server-sent-events stream; the spec requires polling and `.dtccpkg` over HTTP.

**Checks:** invalid parameters and bounds fail before execution with Core's validation errors (Validation row); a deterministic Core Dataset runs through the real broker and worker and produces a canonical package that `load_model_package` reads back (Local execution and Package correctness rows); a Dataset whose result Core cannot package produces a failed job and no downloadable package; queued and running states are distinguishable; missing progress is not fabricated; unknown job IDs are not reported as queued; a job that spends nonzero time queued and running keeps its status and package for 30 days after completion, and both are refused after that, measured from completion time; a job waiting behind a running one on a one-process worker runs once (Task 14).

**Blockers:** none known; `smoke` and `traffic_simulation` round-trip at the current pins.

**Design** (for Tasks 10 to 13):

- One module, `dtcc_engine/jobs.py`, holds what the HTTP API and the worker share: a `Jobs` object for one compute target, created from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, and `ENGINE_PACKAGE_DIR`. `api.py` validates requests and maps outcomes to HTTP; `worker.py` is only the entry point of the Celery command.
- Celery owns the execution state, which Engine translates: `PENDING` with an Engine record is `queued`, or `unconfirmed` if the broker never confirmed the job's message; `STARTED` and `PROGRESS` are `running`, `SUCCESS` is `completed`, and `FAILURE` is `failed`. 2a produces no other state: it exposes no cancellation and configures no retries. Increment 4 translates cancellation.
- Engine's record of a job is a Redis hash, `dtcc-engine:job:<job id>`, holding the Dataset, the target, the submission time, the time the broker confirmed the job's message, and, written by the worker, the finish time and a failed job's exception type. Retention is measured from that finish time, because a revoke broadcast can rewrite a failed job's Celery result, including its `date_done`. The exception type is read from the record, because Celery cannot rebuild every exception from the result backend: Core's `DatasetUpstreamError` takes only keyword arguments, and Celery calls `cls(message)`.
- Submission records the job first and sends it second. If Redis cannot record the job, nothing was sent: `503`. If sending fails, or its confirmation is lost, the message may already be queued, because kombu publishes with `LPUSH`: Engine keeps the record, answers `503` with the job's ID and status reference, reports the job as `unconfirmed` until a worker starts it, and does not send it again (DESIGN.md, "Failure reporting").
- `status` reads Celery's state before Engine's record. The worker writes the record's finish time and error type before Celery stores the terminal state, so a terminal state read first implies a record that already has them.
- Between the worker's record write and Celery's terminal state, `status` can report `running` with a finish time. Celery's state is authoritative, and a package is offered only for a completed job, so this stays (settled at Task 11's review).
- The job task is registered with `shared=False`. Celery's default adds a task to every app finalized later, and the first registration of a name wins, so a worker could run another `Jobs` instance's closure; the tests create many instances in one process.
- Validation errors, from the request envelope and from the Dataset, return only each error's location and type. An error's input, its context, and a validator's message can all repeat a submitted value, such as a provider credential; location parts other than the schema's field names and list positions become `<unexpected>`, because an unexpected field's name, or a dictionary key, can itself be a credential.
- Jobs are sent through a second Celery app that has a broker but no result backend. On an app with the Redis result backend, `send_task` subscribes the sending process to the job's result channel (`celery/backends/redis.py`, `on_task_call`), and the API never reads those messages, so subscriptions and unread state messages would accumulate for as long as it runs.
- The worker writes the package with Core's canonical export at `<ENGINE_PACKAGE_DIR>/<job id>.dtccpkg`, reads it back with `load_model_package` before the job succeeds, and deletes it if that check fails. The API serves a package only for a completed job within its retention.
- A failed job reports only its exception type; the worker's log keeps the full error. Which error messages are safe to return is increment 4's Failure reporting row.
- Automated tests use real Redis (`engine-redis`, database 1, apart from the development server's database 0) and a real Celery worker started in the test process with `celery.contrib.testing.worker.start_worker`, so that tests can register their own Dataset Definitions. Task 13 checks the worker container end to end by hand. Considered and not chosen: a worker container for the automated tests, which is closer to production but cannot see test-defined Datasets and needs its own code reloading.

**Interfaces verified for the tasks** (2026-09-30, in the sources at the stated versions):

- Celery 5.6.3: `Celery(main, broker=..., backend=..., set_as_current=...)`; an app without a result backend has the base backend's no-op `on_task_call` (`celery/backends/base.py`), while the Redis backend's subscribes (`celery/backends/redis.py`); `send_task(name, args=..., task_id=..., queue=...)`, whose publish retry defaults to `task_publish_retry` (`celery/app/amqp.py`); `backend.get_task_meta(task_id)` returns the state and result in one read; `@app.task(name=..., bind=True, shared=False)`, where the default `shared=True` registers the task on every app finalized later and the first registration of a name wins (`celery/app/base.py`, `celery/_state.py`); `backend.mark_as_done(task_id, result)` (tests); `Task.update_state(state=..., meta=...)`; `task_track_started` defaults to false and `result_expires` to one day (`celery/app/defaults.py`); `celery.contrib.testing.worker.start_worker(app)` runs a worker thread in the test process and first waits for the `celery.ping` task, which `celery.contrib.testing.tasks` registers; `celery --app` needs a `Celery` instance or a module holding one, not a factory (`celery/app/utils.py`, `find_app`).
- kombu 5.6.2: publishing re-raises connection errors as `kombu.exceptions.OperationalError` (`kombu/connection.py`); the Redis transport publishes with `LPUSH` (`kombu/transport/redis.py`), so an error can follow a message Redis already accepted.
- redis-py 6.4.0: `Redis.from_url(url, decode_responses=True)`, `hset(name, key, value)` and `hset(name, mapping=...)`, `hgetall`, `delete`, `expire(name, time)` with seconds or a `timedelta`, `ttl`, `keys`, `flushdb`, `pipeline()`; `redis.RedisError` is the base of its errors.
- Redelivery, verified for Task 14 in Celery 5.6.3 and kombu 5.6.2:
  - Without `acks_late`, a request acknowledges its message when a pool process accepts it (`celery/worker/request.py`, `Request.on_accepted`).
  - A worker's reserved requests include the running ones until they finish (`celery/worker/state.py`, `task_reserved` and `task_ready`).
  - `worker_disable_prefetch=True` stops receiving while the reserved requests reach the pool's process count. It applies to a Redis broker only (`celery/worker/consumer/tasks.py`, `Tasks.start`; `celery/app/defaults.py`).
  - Kombu's Redis transport keeps delivered, unacknowledged messages in one hash per database. It returns those older than `visibility_timeout` (3,600 s by default, set through `broker_transport_options`) to their queue with `RPUSH`, so they are received next (`kombu/transport/redis.py`, `QoS.restore_visible` and `Channel._do_restore_message`).
  - A worker restores once when it starts polling, on whichever of its channels comes first (`MultiChannelPoller.on_poll_init`). Its event loop then calls restore every 10 s (`Transport.register_with_event_loop`; `MultiChannelPoller.maybe_restore_messages`).
  - Each channel's QoS acts on its first call and then on every tenth, so after startup its first scheduled restore comes about 10 s or about 100 s later, depending on the channel. Any consumer of the database restores every such message, using its own timeout. A `restore_visible(interval=1)` call acts every time.
  - `inspect conf` prints the configuration as JSON (`celery/bin/base.py`).
  - `start_worker(app, pool="prefork", concurrency=...)` runs a prefork worker in the test process (`celery/contrib/testing/worker.py`).
- Redis 8: the default `maxmemory-policy` is `noeviction` (`redis.conf` at `8.10.2`).
- Starlette 1.7.0 (under FastAPI 0.141.1): `FileResponse(path, media_type=..., filename=...)` sends `Content-Disposition: attachment; filename="<name>"` for an ASCII name; the 422 constant is `HTTP_422_UNPROCESSABLE_CONTENT`. FastAPI's default handler for `RequestValidationError` returns `exc.errors()`, input values included (`fastapi/exception_handlers.py`).
- Core at `5ca2ca4`: `get_dataset(name)` raises `KeyError` for an unregistered name; `dtcc_core.common.progress.set_progress_callback` and `get_progress_callback` hold a callback per thread, and a `ProgressTracker` created while one is set calls it with Core's progress dictionary (`percent`, `message`, `phase`, `phases`, `eta_seconds`, `eta_formatted`, `elapsed`) unless `DTCC_PROGRESS_MODE` selects another mode; `report_progress(percent=..., message=...)` does nothing outside a tracker and, in a tracker without phases, changes only the message, because such a tracker reports `current / total` (0 when `total` is 0); `ProgressTracker(total=100)` with `update(current=50, message=...)` reports 50.0; entering a tracker does not report, so its first update is not throttled; `smoke` makes no network requests; `calibration_grid` builds a `CalibrationGrid`, which canonical export rejects with `NotImplementedError`.

### Task 10: Submit jobs and report queued ones

**Files:**

- Modify: `apps/engine/pyproject.toml` (dependencies)
- Modify: `compose.yaml` (add `engine-redis` and the `engine-packages` volume; job settings for `engine` and `engine-prod`)
- Create: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py`
- Create: `apps/engine/tests/conftest.py`
- Create: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/tests/test_discovery.py` (construct the app with its jobs)

**Interfaces:**

- Consumes: Increment 1's `create_app` and token check; Core's `list()` and `DatasetDescriptor.validate()`; the Celery, kombu, and redis-py interfaces above.
- Produces:
  - `dtcc_engine.jobs.Jobs(redis_url, target, package_dir)` with `submit(dataset_name, parameters) -> str`, which raises `redis.RedisError` when nothing was sent and `UnconfirmedSubmission` (carrying `job_id`) when the job may be queued, `status(job_id) -> dict | None`, `package_path(job_id) -> Path`, and the attributes `target`, `package_dir`, `records` (Redis client), `celery_app`, and `sender`; `record_key(job_id)`; `jobs_from_environment()`, which reads `ENGINE_REDIS_URL`, `ENGINE_TARGET`, and `ENGINE_PACKAGE_DIR`.
  - `create_app(api_token, jobs)`; `create_app_from_environment()` also creates the jobs from the environment.
  - `POST /api/v1/jobs` (token) with `{"dataset": str, "parameters": object, "target": str | null}` → `202 {"job_id", "status_url"}`; `422` for an unregistered Dataset, another target, a non-null `format`, or parameters the Dataset rejects; validation errors, of the envelope as of the parameters, are `[{"loc", "type"}]`, with location parts other than the schema's field names and list positions replaced by `<unexpected>`; `503` with a message when Redis cannot record the job, and `503` with `{"message", "job_id", "status_url"}` when the broker did not confirm it.
  - `GET /api/v1/jobs/{job_id}` (token) → `200 {"job_id", "dataset", "target", "submitted_at", "finished_at", "state", "progress", "error", "package"}`, where this task produces `queued` and `unconfirmed`; `404` for an unknown or expired job; `503` when Redis is unreachable.
  - The `engine-redis` service, in the `engine` and `engine-prod` profiles.

- [x] **Step 1: Write the tests, their services, and a skeleton**

In `apps/engine/pyproject.toml`, set the dependencies to:

```toml
dependencies = [
    "celery[redis]==5.6.3",
    "dtcc-core",
    "dtcc-sim",
    "fastapi==0.141.1",
    "redis==6.4.0",
    "uvicorn==0.54.0",
]
```

In `compose.yaml`, add after the `engine` service:

```yaml
engine-redis:
  # The Engine's Celery broker and result backend. Redis's default policy never evicts queued tasks or results.
  profiles: [engine, engine-prod]
  image: redis:8
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 10
```

Set the `engine` service's `environment` and `volumes`, and add its `depends_on`:

```yaml
environment:
  # Local development only: the port below is reachable from this machine alone.
  ENGINE_API_TOKEN: ${ENGINE_API_TOKEN:-local-dev-engine-token}
  ENGINE_REDIS_URL: redis://engine-redis:6379/0
  ENGINE_TARGET: local
  ENGINE_PACKAGE_DIR: /var/lib/dtcc-engine/packages
  # The tests' own database, so `pnpm engine:check` leaves a running `pnpm dev:engine`'s jobs alone.
  ENGINE_TEST_REDIS_URL: redis://engine-redis:6379/1
volumes:
  - ./apps/engine:/app
  - engine-packages:/var/lib/dtcc-engine/packages
depends_on:
  engine-redis:
    condition: service_healthy
```

Set the `engine-prod` service's `environment`, and add its `depends_on`:

```yaml
environment:
  ENGINE_API_TOKEN: local-prod-check-token
  ENGINE_REDIS_URL: redis://engine-redis:6379/0
  ENGINE_TARGET: local
  ENGINE_PACKAGE_DIR: /home/engine/packages
depends_on:
  engine-redis:
    condition: service_healthy
```

Add `engine-packages:` under the top-level `volumes`.

Create `apps/engine/tests/conftest.py`:

```python
"""Fixtures for Engine's tests that use Redis and Celery.

`compose.yaml` gives the tests a Redis database of their own, `ENGINE_TEST_REDIS_URL`.
"""

import os
from pathlib import Path

import pytest
import redis

from dtcc_engine.jobs import Jobs


@pytest.fixture(scope="session")
def redis_url() -> str:
    """The tests' Redis database, emptied once per session so that no earlier run's jobs remain queued."""
    url = os.environ["ENGINE_TEST_REDIS_URL"]
    redis.Redis.from_url(url).flushdb()
    return url


@pytest.fixture
def jobs(redis_url: str, tmp_path: Path) -> Jobs:
    """Jobs on a target that no worker serves, so submitted jobs stay queued."""
    return Jobs(redis_url, "unserved", tmp_path)
```

Create `apps/engine/tests/test_jobs.py`:

```python
"""Tests for Engine's job API against real Redis and, where a job must run, a real Celery worker.

The `client` fixture's jobs stay queued, because no worker serves its target.
"""

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError
from pydantic import field_validator

from dtcc_engine.api import create_app
from dtcc_engine.jobs import Jobs, record_key

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
SMOKE = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}


@pytest.fixture
def client(jobs: Jobs) -> TestClient:
    return TestClient(create_app(TOKEN, jobs))


def submit(client: TestClient, request: dict) -> str:
    """Submit a job that the API must accept, and return its ID."""
    response = client.post("/api/v1/jobs", json=request, headers=AUTHORIZED)
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def job_count(jobs: Jobs) -> int:
    return len(jobs.records.keys(record_key("*")))


@pytest.fixture
def value_echoing_dataset() -> Iterator[str]:
    """Register a Dataset whose validator repeats the rejected value in its message, as any validator may."""

    class EchoingProbeArgs(DatasetBaseArgs):
        key: str = ""

        @field_validator("key")
        @classmethod
        def reject(cls, value: str) -> str:
            raise ValueError(f"key {value} is not accepted")

    class EchoingProbeDataset(DatasetDescriptor):
        name = "engine_echoing_probe"
        description = "Dataset defined by an Engine test whose validation error repeats the value"
        ArgsModel = EchoingProbeArgs

        def build(self, args):
            raise NotImplementedError

    try:
        yield "engine_echoing_probe"
    finally:
        unregister("engine_echoing_probe")


@pytest.mark.parametrize(("method", "path"), [("POST", "/api/v1/jobs"), ("GET", "/api/v1/jobs/some-job")])
def test_job_routes_reject_missing_tokens(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path, json=SMOKE).status_code == 401


def test_submitted_job_is_queued(client: TestClient, jobs: Jobs) -> None:
    response = client.post("/api/v1/jobs", json=SMOKE, headers=AUTHORIZED)
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    job = client.get(response.json()["status_url"], headers=AUTHORIZED).json()
    assert job == {
        "job_id": job_id,
        "dataset": "smoke",
        "target": jobs.target,
        "submitted_at": job["submitted_at"],
        "finished_at": None,
        "state": "queued",
        "progress": None,
        "error": None,
        "package": None,
    }


def test_unknown_job_is_not_found_rather_than_queued(client: TestClient) -> None:
    response = client.get(f"/api/v1/jobs/{uuid.uuid4()}", headers=AUTHORIZED)
    assert response.status_code == 404
    assert "unknown or expired" in response.json()["detail"]


@pytest.mark.parametrize(
    ("parameters", "location"),
    [({"bounds": [1.0, 0.0, 0.0, 1.0]}, ["bounds"]), ({"bounds": BOUNDS, "no_such_parameter": 1}, ["<unexpected>"])],
    ids=["reversed-bounds", "unknown-parameter"],
)
def test_invalid_parameters_fail_before_submission_with_the_datasets_errors(
    client: TestClient, jobs: Jobs, parameters: dict, location: list[str]
) -> None:
    before = job_count(jobs)
    response = client.post("/api/v1/jobs", json={"dataset": "smoke", "parameters": parameters}, headers=AUTHORIZED)
    assert response.status_code == 422
    assert [error["loc"] for error in response.json()["detail"]] == [location]
    assert job_count(jobs) == before


def test_validation_errors_repeat_no_submitted_names_or_values(client: TestClient, value_echoing_dataset: str) -> None:
    # A consumer may send a provider credential as a value, or by mistake as a name; no error may repeat it.
    secret = "credential-7f3a9c"
    requests = [
        {**SMOKE, "api_key": secret},
        {**SMOKE, secret: 1},
        {"dataset": value_echoing_dataset, "parameters": {"bounds": BOUNDS, "key": secret}},
        {"dataset": "smoke", "parameters": {"bounds": BOUNDS, secret: 1}},
    ]
    responses = [client.post("/api/v1/jobs", json=request, headers=AUTHORIZED) for request in requests]
    assert [response.status_code for response in responses] == [422, 422, 422, 422]
    assert all(secret not in response.text for response in responses)
    assert [response.json()["detail"] for response in responses] == [
        [{"loc": ["body", "<unexpected>"], "type": "extra_forbidden"}],
        [{"loc": ["body", "<unexpected>"], "type": "extra_forbidden"}],
        [{"loc": ["key"], "type": "value_error"}],
        [{"loc": ["<unexpected>"], "type": "extra_forbidden"}],
    ]


def test_unregistered_dataset_is_rejected(client: TestClient) -> None:
    response = client.post("/api/v1/jobs", json={"dataset": "no_such_dataset", "parameters": {}}, headers=AUTHORIZED)
    assert response.status_code == 422
    assert "no_such_dataset" in response.json()["detail"]


def test_format_parameter_is_rejected(client: TestClient) -> None:
    # A format makes Datasets return serialized bytes, which cannot become a canonical package.
    request = {"dataset": "smoke", "parameters": {"bounds": BOUNDS, "format": "vtu"}}
    response = client.post("/api/v1/jobs", json=request, headers=AUTHORIZED)
    assert response.status_code == 422
    assert "format" in response.json()["detail"]


def test_only_this_hosts_target_is_accepted(client: TestClient, jobs: Jobs) -> None:
    elsewhere = client.post("/api/v1/jobs", json={**SMOKE, "target": "elsewhere"}, headers=AUTHORIZED)
    here = client.post("/api/v1/jobs", json={**SMOKE, "target": jobs.target}, headers=AUTHORIZED)
    assert elsewhere.status_code == 422
    assert "elsewhere" in elsewhere.json()["detail"]
    assert here.status_code == 202


def test_unreachable_redis_is_reported_as_unavailable(tmp_path: Path) -> None:
    client = TestClient(create_app(TOKEN, Jobs("redis://127.0.0.1:1/0", "unserved", tmp_path)))
    submitted = client.post("/api/v1/jobs", json=SMOKE, headers=AUTHORIZED)
    polled = client.get(f"/api/v1/jobs/{uuid.uuid4()}", headers=AUTHORIZED)
    assert (submitted.status_code, polled.status_code) == (503, 503)
    assert "not submitted" in submitted.json()["detail"]


def test_unconfirmed_submission_keeps_the_job_and_reports_it(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Redis can accept the message and the reply still be lost, so the job may be queued.
    def lose_the_confirmation(*args, **kwargs):
        raise OperationalError("connection lost before the broker replied")

    monkeypatch.setattr(jobs.sender, "send_task", lose_the_confirmation)
    response = client.post("/api/v1/jobs", json=SMOKE, headers=AUTHORIZED)
    assert response.status_code == 503
    detail = response.json()["detail"]
    job = client.get(detail["status_url"], headers=AUTHORIZED).json()
    assert (job["job_id"], job["state"]) == (detail["job_id"], "unconfirmed")
```

In `apps/engine/tests/test_discovery.py`, import `from dtcc_engine.jobs import Jobs`, and construct the app with the `jobs` fixture. The discovery expectations are unchanged; the app now needs its jobs. The `client` fixture becomes:

```python
@pytest.fixture
def client(jobs: Jobs) -> TestClient:
    return TestClient(create_app(TOKEN, jobs))
```

`test_unusable_tokens_are_rejected_at_startup` and `test_bearer_token_characters_are_accepted` take a `jobs: Jobs` argument and call `create_app(token, jobs)`.

Create `apps/engine/dtcc_engine/jobs.py` as a skeleton, so that the tests fail on behavior rather than on an import error:

```python
"""Asynchronous Dataset jobs on one compute target."""

from pathlib import Path

import redis
from celery import Celery


def record_key(job_id: str) -> str:
    """Return the Redis key of Engine's record of a job."""
    return f"dtcc-engine:job:{job_id}"


class Jobs:
    """Dataset jobs on one compute target."""

    def __init__(self, redis_url: str, target: str, package_dir: Path) -> None:
        self.target = target
        self.package_dir = package_dir
        self.records = redis.Redis.from_url(redis_url, decode_responses=True)
        self.sender = Celery("dtcc_engine", broker=redis_url, set_as_current=False)


def jobs_from_environment() -> Jobs:
    """Create this host's jobs from the environment."""
    raise NotImplementedError
```

In `apps/engine/dtcc_engine/api.py`, give `create_app` a second parameter, `jobs: Jobs`, imported from `dtcc_engine.jobs`, and leave its body unchanged.

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `pnpm engine:check`
Expected: FAIL. The build installs Celery 5.6.3, kombu 5.6.2, and redis-py 6.4.0 in the Engine-dependency step, and `compose run` starts `engine-redis` first. The 12 job tests fail on status codes or details: `404` from missing routes where `202`, `401`, `422`, or `503` is expected, and the default `Not Found` detail where "unknown or expired" is expected. The 38 existing tests pass. No test fails on an import, collection, or connection error.

- [x] **Step 3: Implement submission and status**

Replace `apps/engine/dtcc_engine/jobs.py` with:

```python
"""Asynchronous Dataset jobs on one compute target.

A job runs one Dataset in a Celery worker and delivers its realization as a canonical Dataset
Package. Celery owns the queue and the execution state; Engine keeps its own record of each job
in the same Redis, so unknown and expired jobs are distinguishable from queued ones.
"""

import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import redis
from celery import Celery
from kombu.exceptions import OperationalError

RUN_DATASET = "dtcc_engine.run_dataset"
STATES = {
    "PENDING": "queued",
    "STARTED": "running",
    "PROGRESS": "running",
    "SUCCESS": "completed",
    "FAILURE": "failed",
}


def record_key(job_id: str) -> str:
    """Return the Redis key of Engine's record of a job."""
    return f"dtcc-engine:job:{job_id}"


class UnconfirmedSubmission(Exception):
    """The broker did not confirm a job's message, so the job may or may not be queued.

    Attributes:
        job_id: The job's ID, recorded with the job, so its status can be polled.
    """

    def __init__(self, job_id: str) -> None:
        super().__init__(job_id)
        self.job_id = job_id


class Jobs:
    """Dataset jobs on one compute target: submission, execution, status, and packages.

    Args:
        redis_url: Redis for Celery's broker and result backend, and for Engine's job records.
        target: Identifier of this compute target; its jobs use the Celery queue of that name.
        package_dir: Directory of completed packages, shared by this host's API and worker.
    """

    def __init__(self, redis_url: str, target: str, package_dir: Path) -> None:
        self.target = target
        self.package_dir = package_dir
        self.records = redis.Redis.from_url(redis_url, decode_responses=True)
        self.celery_app = Celery("dtcc_engine", broker=redis_url, backend=redis_url)
        self.celery_app.conf.update(task_default_queue=target)
        # With a result backend, send_task subscribes this process to the job's result channel,
        # which an API that never waits for results would accumulate.
        self.sender = Celery("dtcc_engine", broker=redis_url, set_as_current=False)
        # Retrying a publish whose acknowledgement was lost could queue the job twice.
        self.sender.conf.update(task_publish_retry=False)

    def package_path(self, job_id: str) -> Path:
        """Return where the job's package is stored once the job completes."""
        return self.package_dir / f"{job_id}.dtccpkg"

    def submit(self, dataset_name: str, parameters: dict[str, Any]) -> str:
        """Record and queue a job that runs a Dataset with parameters the caller has validated; return its ID.

        Raises:
            redis.RedisError: If Redis cannot record the job; nothing was sent.
            UnconfirmedSubmission: If sending the job, or recording its confirmation, failed; the job may be queued,
                and it is not sent again.
        """
        job_id = str(uuid4())
        key = record_key(job_id)
        submitted_at = datetime.now(UTC).isoformat()
        self.records.hset(key, mapping={"dataset": dataset_name, "target": self.target, "submitted_at": submitted_at})
        try:
            self.sender.send_task(RUN_DATASET, args=[dataset_name, parameters], task_id=job_id, queue=self.target)
            self.records.hset(key, "queued_at", datetime.now(UTC).isoformat())
        except (redis.RedisError, OperationalError) as error:
            raise UnconfirmedSubmission(job_id) from error
        return job_id

    def status(self, job_id: str) -> dict[str, Any] | None:
        """Return the job's state, progress, error, and package, or None if the job is unknown or expired.

        Raises:
            redis.RedisError: If Redis is unreachable, so the state is unknown for now.
        """
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        meta = self.celery_app.backend.get_task_meta(job_id)
        state = STATES[meta["status"]]
        if state == "queued" and "queued_at" not in record:
            state = "unconfirmed"
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"],
            "finished_at": record.get("finished_at"),
            "state": state,
            "progress": None,
            "error": None,
            "package": None,
        }


def jobs_from_environment() -> Jobs:
    """Create this host's jobs from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, and `ENGINE_PACKAGE_DIR`."""
    return Jobs(os.environ["ENGINE_REDIS_URL"], os.environ["ENGINE_TARGET"], Path(os.environ["ENGINE_PACKAGE_DIR"]))
```

In `apps/engine/dtcc_engine/api.py`, change the module docstring's first paragraph to end "…as Core describes them, and runs them as asynchronous jobs." Add the imports:

```python
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError
from redis import RedisError

from dtcc_engine.jobs import Jobs, UnconfirmedSubmission, jobs_from_environment
```

(`Request` joins the existing `from fastapi import ...` line.)

Add after `BEARER_TOKEN_PATTERN`:

```python
class JobRequest(BaseModel):
    """A request to run one Dataset as a job."""

    model_config = ConfigDict(extra="forbid")

    dataset: str
    parameters: dict[str, Any]
    target: str | None = None


# The names that locations in a job request's own validation errors can hold.
REQUEST_FIELDS = {"body", *JobRequest.model_fields}


def public_errors(errors: list[dict[str, Any]], fields: set[str]) -> list[dict[str, Any]]:
    """Return each validation error's type and location without anything the consumer sent.

    An error's input, context, and message can repeat a submitted value, and a location part that is neither
    one of `fields` nor a list position can be a submitted name, so it becomes `<unexpected>`.
    """
    return [
        {
            "loc": [part if isinstance(part, int) or part in fields else "<unexpected>" for part in error["loc"]],
            "type": error["type"],
        }
        for error in errors
    ]
```

Document `jobs` in `create_app`'s docstring ("jobs: The jobs of this host's compute target."). After the `FastAPI(...)` call, add:

```python
    @app.exception_handler(RequestValidationError)
    async def reject_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": public_errors(error.errors(), REQUEST_FIELDS)},
        )
```

Add after `require_token`:

```python
    def find_job(job_id: str) -> dict[str, Any]:
        try:
            job = jobs.status(job_id)
        except RedisError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Job state is temporarily unavailable"
            ) from None
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return job
```

Add after the `describe_dataset` route:

```python
    @app.post("/api/v1/jobs", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_token)])
    def submit_job(request: JobRequest) -> dict[str, str]:
        registered = datasets.list()
        if request.dataset not in registered:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Dataset '{request.dataset}' is not registered",
            )
        if request.target not in (None, jobs.target):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Target '{request.target}' is not configured; this Engine runs jobs on '{jobs.target}'",
            )
        if request.parameters.get("format") is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Engine delivers every job as a canonical .dtccpkg; remove the 'format' parameter",
            )
        try:
            registered[request.dataset].validate(dict(request.parameters))
        except ValidationError as error:
            fields = set(registered[request.dataset].ArgsModel.model_fields)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=public_errors(error.errors(), fields)
            ) from None
        try:
            job_id = jobs.submit(request.dataset, request.parameters)
        except RedisError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The job queue is unavailable; the job was not submitted",
            ) from None
        except UnconfirmedSubmission as unconfirmed:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "message": "The queue did not confirm the job, which may still run; poll it before resubmitting",
                    "job_id": unconfirmed.job_id,
                    "status_url": f"/api/v1/jobs/{unconfirmed.job_id}",
                },
            ) from None
        return {"job_id": job_id, "status_url": f"/api/v1/jobs/{job_id}"}

    @app.get("/api/v1/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str) -> dict[str, Any]:
        return find_job(job_id)
```

`validate` receives a copy, because Core converts a `Bounds` value in place. Change `create_app_from_environment` to `return create_app(os.environ.get("ENGINE_API_TOKEN", ""), jobs_from_environment())`, and its docstring to name the three job settings; a missing setting fails the start with a `KeyError` naming it.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 50 passed: the 38 existing tests and 12 job tests.

- [x] **Step 5: Stop for review**

Leave changes uncommitted. Report Steps 2 and 4.

Ruling (2026-09-30, Task 10, review): DESIGN.md's local-development paragraph said that Redis is added together with the worker, but Task 10 adds Redis for the HTTP service before Task 13 adds the worker, and `engine-prod` uses Redis without one. The paragraph now says that the `engine` profile includes Redis, which both the HTTP service and the worker use.

### Task 11: Run jobs in a worker and package their results

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/conftest.py` (a worker)
- Modify: `apps/engine/tests/test_jobs.py` (execution tests)

**Interfaces:**

- Consumes: Task 10's `Jobs`; the Celery task, progress, and testing interfaces above; Core's `get_dataset`, calling a Dataset, `export(path, canonical=True)` on its realization, `load_model_package`, and its progress callback; in tests, `ProgressTracker(total=...)` and its `update`, `dtcc_core.model.Mesh`, and Celery's `backend.mark_as_done`.
- Produces:
  - The Celery task `dtcc_engine.run_dataset(dataset_name, parameters)`, which runs the Dataset with Core's progress reported as the `PROGRESS` state, writes and validates the package, and records `finished_at` and, for a failed job, `error_type`.
  - Status fields: `state` `running`, `completed`, or `failed`; `progress` is Core's latest report unchanged, and `null` while none exists; `error` is `{"type": <exception class name>}` for a failed job; `package` is `{"available": bool, "expires_at": <finish time + 30 days>}` for a completed job.
  - `status` reads Celery's state before Engine's record, and the task is not shared with other Celery apps.
  - The `served_jobs` fixture: jobs on a target served by a worker thread in the test process.

- [x] **Step 1: Write the execution tests and a skeleton task**

Add to `apps/engine/tests/conftest.py` the imports:

```python
from collections.abc import Iterator

import celery.contrib.testing.tasks  # noqa: F401  Registers the ping task that start_worker waits for.
from celery.contrib.testing.worker import start_worker
```

and the fixture:

```python
@pytest.fixture(scope="module")
def served_jobs(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Iterator[Jobs]:
    """Jobs on a target served by a Celery worker in this process, which also runs test-defined Datasets."""
    served = Jobs(redis_url, "served", tmp_path_factory.mktemp("packages"))
    with start_worker(served.celery_app):
        yield served
```

Add to `apps/engine/tests/test_jobs.py` the imports:

```python
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime

import numpy as np
from celery import Celery
from dtcc_core.common.progress import ProgressTracker
from dtcc_core.datasets import load_model_package
from dtcc_core.model import Mesh
```

and `RUN_DATASET` to the `dtcc_engine.jobs` import. Then

extend the module docstring with "The `served_client` fixture's worker runs in this process, so it also runs the Dataset Definitions that tests register.", and add:

```python
FINISHED = ("completed", "failed")


@pytest.fixture
def served_client(served_jobs: Jobs) -> TestClient:
    return TestClient(create_app(TOKEN, served_jobs))


def wait_until(client: TestClient, job_id: str, condition: Callable[[dict], bool], timeout: float = 120.0) -> dict:
    """Poll the job until `condition` holds; fail at once if the job finishes without meeting it."""
    deadline = time.monotonic() + timeout
    while True:
        job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
        if condition(job):
            return job
        assert job["state"] not in FINISHED and time.monotonic() < deadline, job
        time.sleep(0.1)


def triangle() -> Mesh:
    return Mesh(vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]]))


@pytest.fixture
def gated_dataset() -> Iterator[tuple[threading.Event, threading.Event]]:
    """Register a Dataset that waits for `start`, reports progress, waits for `finish`, and returns a triangle."""
    start, finish = threading.Event(), threading.Event()

    class GatedProbeArgs(DatasetBaseArgs):
        pass

    class GatedProbeDataset(DatasetDescriptor):
        name = "engine_gated_probe"
        description = "Dataset defined by an Engine test to hold a job at chosen points"
        ArgsModel = GatedProbeArgs

        def build(self, args):
            start.wait(timeout=60)
            with ProgressTracker(total=100) as tracker:
                tracker.update(current=50, message="halfway")
                finish.wait(timeout=60)
            return triangle()

    try:
        yield start, finish
    finally:
        start.set()
        finish.set()
        unregister("engine_gated_probe")


@pytest.fixture
def failing_dataset() -> Iterator[str]:
    """Register a Dataset whose build always raises, and return its name."""

    class FailingProbeArgs(DatasetBaseArgs):
        pass

    class FailingProbeDataset(DatasetDescriptor):
        name = "engine_failing_probe"
        description = "Dataset defined by an Engine test that always fails"
        ArgsModel = FailingProbeArgs

        def build(self, args):
            raise RuntimeError("probe failure")

    try:
        yield "engine_failing_probe"
    finally:
        unregister("engine_failing_probe")


def test_job_runs_in_the_worker_into_a_valid_canonical_package(served_client: TestClient, served_jobs: Jobs) -> None:
    job_id = submit(served_client, SMOKE)
    job = wait_until(served_client, job_id, lambda job: job["state"] == "completed")
    assert job["package"] is not None and job["package"]["available"]
    model = load_model_package(served_jobs.package_path(job_id))
    assert type(model).__name__ == "VolumeMesh"
    assert model.dataset_context.request.dataset_name == "smoke"
    assert model.dataset_context.request.parameters["bounds"] == BOUNDS


def test_running_job_reports_upstream_progress_and_invents_none(
    served_client: TestClient, gated_dataset: tuple[threading.Event, threading.Event]
) -> None:
    start, finish = gated_dataset
    job_id = submit(served_client, {"dataset": "engine_gated_probe", "parameters": {"bounds": BOUNDS}})
    before_report = wait_until(served_client, job_id, lambda job: job["state"] == "running")
    start.set()
    after_report = wait_until(served_client, job_id, lambda job: job["progress"] is not None)
    finish.set()
    completed = wait_until(served_client, job_id, lambda job: job["state"] == "completed")
    assert before_report["progress"] is None
    assert after_report["state"] == "running"
    assert (after_report["progress"]["percent"], after_report["progress"]["message"]) == (50.0, "halfway")
    assert completed["progress"] is None


def test_failing_dataset_fails_the_job_without_a_package(
    served_client: TestClient, served_jobs: Jobs, failing_dataset: str
) -> None:
    job_id = submit(served_client, {"dataset": failing_dataset, "parameters": {"bounds": BOUNDS}})
    job = wait_until(served_client, job_id, lambda job: job["state"] in FINISHED)
    assert (job["state"], job["error"], job["package"]) == ("failed", {"type": "RuntimeError"}, None)
    assert job["finished_at"] is not None
    assert not served_jobs.package_path(job_id).exists()


def test_result_core_cannot_package_fails_the_job(served_client: TestClient, served_jobs: Jobs) -> None:
    # Canonical exchange does not support CalibrationGrid at the pinned Core commit.
    job_id = submit(served_client, {"dataset": "calibration_grid", "parameters": {"bounds": BOUNDS}})
    job = wait_until(served_client, job_id, lambda job: job["state"] in FINISHED)
    assert (job["state"], job["error"]) == ("failed", {"type": "NotImplementedError"})
    assert not served_jobs.package_path(job_id).exists()


def test_status_read_while_the_job_finishes_is_consistent(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = submit(client, SMOKE)
    read_record = jobs.records.hgetall

    def finish_after_the_read(key: str) -> dict:
        record = read_record(key)
        # The job finishes between Engine's two reads: the worker records its finish time, then Celery stores SUCCESS.
        jobs.records.hset(key, "finished_at", datetime.now(UTC).isoformat())
        jobs.celery_app.backend.mark_as_done(job_id, None)
        return record

    monkeypatch.setattr(jobs.records, "hgetall", finish_after_the_read)
    response = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    assert response.status_code == 200
    assert (response.json()["state"], response.json()["finished_at"]) == ("queued", None)


def test_job_task_is_not_shared_with_other_celery_apps(jobs: Jobs) -> None:
    # A shared task joins every app finalized later, and a name's first registration wins,
    # so a worker could run another Jobs instance's task.
    other = Celery("other", set_as_current=False)
    assert RUN_DATASET in jobs.celery_app.tasks
    assert RUN_DATASET not in other.tasks
```

In `apps/engine/dtcc_engine/jobs.py`, register a task with an empty body and Celery's default sharing, so that jobs finish at once and the tests fail on their assertions rather than on a worker that ignores unknown tasks. Add `from celery import Celery, Task`, and at the end of `Jobs.__init__`:

```python
        @self.celery_app.task(name=RUN_DATASET, bind=True)
        def run_dataset(task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
            pass
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `pnpm engine:check`
Expected: FAIL. The worker fixture starts, and each of the 4 execution tests fails on an assertion within seconds: each job completes at once without a package, so `wait_until` reports a finished job that never ran or failed. `test_status_read_while_the_job_finishes_is_consistent` gets `completed` without a finish time, because Task 10's `status` reads the record first; `test_job_task_is_not_shared_with_other_celery_apps` finds the task on the other app. The 50 tests from Task 10 pass.

- [x] **Step 3: Run the Dataset, report its progress, and package its result**

Replace `apps/engine/dtcc_engine/jobs.py` with the Task 10 version and these changes. Imports:

```python
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
import redis
from celery import Celery, Task
from dtcc_core.common.progress import get_progress_callback, set_progress_callback
from kombu.exceptions import OperationalError
```

Before `RUN_DATASET`, add `RETENTION = timedelta(days=30)`; after `STATES`, add `logger = logging.getLogger(__name__)`; and after `record_key`, add:

```python
def store_progress(task: Task, progress: dict[str, Any]) -> None:
    """Store a progress report from Core, unchanged, as the task's PROGRESS state."""
    try:
        task.update_state(state="PROGRESS", meta=progress)
    except redis.RedisError:
        # A lost progress report must not fail the computation.
        logger.warning("Could not store the progress of job %s", task.request.id, exc_info=True)
```

In `Jobs.__init__`, set `task_track_started=True` together with `task_default_queue`, and replace the empty task with:

```python
        # Not shared: a shared task joins every app finalized later, and the first registration of a name wins.
        @self.celery_app.task(name=RUN_DATASET, bind=True, shared=False)
        def run_dataset(task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
            self.run(task, dataset_name, parameters)
```

Replace `status` with a version that reads Celery's state before Engine's record:

```python
    def status(self, job_id: str) -> dict[str, Any] | None:
        """Return the job's state, progress, error, and package, or None if the job is unknown or expired.

        Raises:
            redis.RedisError: If Redis is unreachable, so the state is unknown for now.
        """
        meta = self.celery_app.backend.get_task_meta(job_id)
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        state = STATES[meta["status"]]
        if state == "queued" and "queued_at" not in record:
            state = "unconfirmed"
        finished_at = datetime.fromisoformat(record["finished_at"]) if "finished_at" in record else None
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"],
            "finished_at": record.get("finished_at"),
            "state": state,
            "progress": meta["result"] if meta["status"] == "PROGRESS" else None,
            "error": {"type": record.get("error_type")} if state == "failed" else None,
            "package": (
                {"available": self.package_path(job_id).is_file(), "expires_at": (finished_at + RETENTION).isoformat()}
                if state == "completed"
                else None
            ),
        }
```

The worker records `finished_at` and `error_type` before Celery stores a terminal state, so a terminal state read first implies a record that has them; reading the record first could pair a completed state with a record read before the job finished. Add to `Jobs`:

```python
    def run(self, task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
        """Run a job in the worker: invoke the Dataset, export its realization, and validate the package.

        Raises:
            Exception: Whatever the Dataset, the export, or the validation raised; the job then fails.
        """
        key = record_key(task.request.id)
        path = self.package_path(task.request.id)
        previous_callback = get_progress_callback()
        set_progress_callback(lambda progress: store_progress(task, progress))
        try:
            realization = datasets.get_dataset(dataset_name)(**parameters)
            realization.export(path, canonical=True)
            try:
                datasets.load_model_package(path)
            except Exception:
                path.unlink()
                raise
        except Exception as error:
            self.records.hset(key, "error_type", type(error).__name__)
            raise
        finally:
            set_progress_callback(previous_callback)
            self.records.hset(key, "finished_at", datetime.now(UTC).isoformat())
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 56 passed.

- [x] **Step 5: Stop for review**

Leave changes uncommitted. Report Steps 2 and 4.

### Task 12: Deliver packages until they expire

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py` (download route)
- Modify: `apps/engine/tests/test_jobs.py` (delivery and expiry tests)

**Interfaces:**

- Consumes: Task 11's completed jobs; Starlette's `FileResponse`; redis-py's `pipeline`, `expire`, and `ttl`; Celery's `result_expires` and `backend.get_key_for_task`.
- Produces:
  - `GET /api/v1/jobs/{job_id}/package` (token) → `200` with the package (`application/zip`, attachment `<job id>.dtccpkg`); `404` for an unknown or expired job; `409` for a job without an available package.
  - Status and package are `404` from 30 periods of 24 hours after the job's finish time.
  - Engine's record and Celery's result expire 31 days after the job finishes; a job's record does not expire while it is queued or running.
  - `RETENTION` and `RECORD_LIFETIME` in `dtcc_engine.jobs`.

- [x] **Step 1: Write the delivery and expiry tests**

In `apps/engine/tests/test_jobs.py`, add `("GET", "/api/v1/jobs/some-job/package")` to `test_job_routes_reject_missing_tokens`'s cases, add `timedelta` to the `datetime` import and `RECORD_LIFETIME, RETENTION` to the `dtcc_engine.jobs` import, and add:

```python
def test_completed_package_downloads_unchanged(served_client: TestClient, served_jobs: Jobs) -> None:
    job_id = submit(served_client, SMOKE)
    wait_until(served_client, job_id, lambda job: job["state"] == "completed")
    response = served_client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == f'attachment; filename="{job_id}.dtccpkg"'
    assert response.content == served_jobs.package_path(job_id).read_bytes()


def test_package_of_an_unknown_or_unfinished_job_is_refused(client: TestClient) -> None:
    queued = submit(client, SMOKE)
    unknown = client.get(f"/api/v1/jobs/{uuid.uuid4()}/package", headers=AUTHORIZED)
    unfinished = client.get(f"/api/v1/jobs/{queued}/package", headers=AUTHORIZED)
    assert (unknown.status_code, unfinished.status_code) == (404, 409)


def test_job_records_outlast_the_package_retention(
    client: TestClient, jobs: Jobs, served_client: TestClient, served_jobs: Jobs
) -> None:
    queued = submit(client, SMOKE)
    completed = submit(served_client, SMOKE)
    wait_until(served_client, completed, lambda job: job["state"] == "completed")
    result_key = served_jobs.celery_app.backend.get_key_for_task(completed)
    retention, lifetime = RETENTION.total_seconds(), RECORD_LIFETIME.total_seconds()
    assert jobs.records.ttl(record_key(queued)) == -1
    assert retention < served_jobs.records.ttl(record_key(completed)) <= lifetime
    assert retention < served_jobs.records.ttl(result_key) <= lifetime


@pytest.mark.parametrize(
    ("age", "status_code"),
    [(RETENTION - timedelta(minutes=1), 200), (RETENTION + timedelta(seconds=1), 404)],
    ids=["within-retention", "after-retention"],
)
def test_finished_job_and_its_package_expire_after_the_retention(
    served_client: TestClient, served_jobs: Jobs, age: timedelta, status_code: int
) -> None:
    job_id = submit(served_client, SMOKE)
    wait_until(served_client, job_id, lambda job: job["state"] == "completed")
    # Moves the recorded finish time back instead of waiting 30 days.
    served_jobs.records.hset(record_key(job_id), "finished_at", (datetime.now(UTC) - age).isoformat())
    polled = served_client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    downloaded = served_client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert (polled.status_code, downloaded.status_code) == (status_code, status_code)
```

In `apps/engine/dtcc_engine/jobs.py`, add after `RETENTION`, so that the tests import:

```python
# A day beyond the retention, so a job's records outlast its package even if hosts' clocks differ slightly.
RECORD_LIFETIME = RETENTION + timedelta(days=1)
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `pnpm engine:check`
Expected: FAIL. The new token case, the download test, and `within-retention` get `404` from the missing route; `test_package_of_an_unknown_or_unfinished_job_is_refused` gets `(404, 404)`; `after-retention` gets `200` for the status; `test_job_records_outlast_the_package_retention` finds no expiry on the completed job's record and Celery's one-day default on its result. The 56 earlier tests pass.

- [x] **Step 3: Implement delivery and expiry**

In `Jobs.__init__`, add `result_expires=RECORD_LIFETIME` to the Celery app's settings. In `status`, return `None` once the retention has passed, after computing `finished_at`:

```python
        if finished_at is not None and datetime.now(UTC) >= finished_at + RETENTION:
            return None
```

In `run`, replace the `finally` block's last line with a transaction that also starts the record's expiry:

```python
            with self.records.pipeline() as pipeline:
                pipeline.hset(key, "finished_at", datetime.now(UTC).isoformat())
                pipeline.expire(key, RECORD_LIFETIME)
                pipeline.execute()
```

In `apps/engine/dtcc_engine/api.py`, add `FileResponse` to the `fastapi.responses` import, and add after the `job_status` route:

```python
    @app.get("/api/v1/jobs/{job_id}/package", dependencies=[Depends(require_token)])
    def download_package(job_id: str) -> FileResponse:
        job = find_job(job_id)
        if job["package"] is None or not job["package"]["available"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Job '{job_id}' has no package to download; its state is '{job['state']}'",
            )
        return FileResponse(jobs.package_path(job_id), media_type="application/zip", filename=f"{job_id}.dtccpkg")
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 62 passed.

- [x] **Step 5: Stop for review**

Leave changes uncommitted. Report Steps 2 and 4.

### Task 13: Worker service, documentation, and end-to-end checks

**Files:**

- Create: `apps/engine/dtcc_engine/worker.py`
- Modify: `compose.yaml` (add `engine-worker`)
- Modify: `package.json` (`dev:engine`)
- Modify: `README.md` (engine paragraph)
- Modify: `apps/engine/PLAN.md` (Increment 2a status)

**Interfaces:**

- Consumes: `jobs_from_environment()` and the `dtcc_engine.run_dataset` task from Tasks 10 to 12; the Celery command, which finds the `Celery` instance in the module that `--app` names.
- Produces: `celery --app dtcc_engine.worker worker` runs the jobs of the host's target; `pnpm dev:engine` starts Redis, the API, and a worker that runs one job at a time.

- [x] **Step 1: Add the worker**

Create `apps/engine/dtcc_engine/worker.py`:

```python
"""Entry point of the Celery worker that runs this host's Dataset jobs: `celery --app dtcc_engine.worker worker`."""

from dtcc_engine.jobs import jobs_from_environment

celery_app = jobs_from_environment().celery_app
```

In `compose.yaml`, add after `engine-redis`:

```yaml
engine-worker:
  # Runs the Engine's jobs. Celery does not reload code: restart it after changing the engine.
  profiles: [engine]
  platform: linux/amd64
  build:
    context: apps/engine
    target: dev
  command: ["celery", "--app", "dtcc_engine.worker", "worker", "--concurrency", "1", "--loglevel", "INFO"]
  environment:
    ENGINE_REDIS_URL: redis://engine-redis:6379/0
    ENGINE_TARGET: local
    ENGINE_PACKAGE_DIR: /var/lib/dtcc-engine/packages
  volumes:
    - ./apps/engine:/app
    - engine-packages:/var/lib/dtcc-engine/packages
  depends_on:
    engine-redis:
      condition: service_healthy
```

In `package.json`, change `dev:engine` to `docker compose --profile engine up --build engine engine-worker`.

- [x] **Step 2: Run a Core job through the worker container**

Start `pnpm dev:engine` in another terminal and wait for the API's health check, then run:

```sh
AUTH="Authorization: Bearer local-dev-engine-token"
JOB=$(curl -fsS -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"dataset": "smoke", "parameters": {"bounds": [319891, 6399790, 320091, 6399990]}}' \
  http://127.0.0.1:8000/api/v1/jobs | python3 -c 'import json, sys; print(json.load(sys.stdin)["job_id"])')
curl -fsS -H "$AUTH" http://127.0.0.1:8000/api/v1/jobs/$JOB
curl -fsS -H "$AUTH" -o /tmp/smoke.dtccpkg http://127.0.0.1:8000/api/v1/jobs/$JOB/package
docker compose --profile engine exec -T engine /opt/conda/envs/engine/bin/python -c "from dtcc_core.datasets import load_model_package; m = load_model_package('/var/lib/dtcc-engine/packages/$JOB.dtccpkg'); print(type(m).__name__, m.dataset_context.request.dataset_name)"
shasum -a 256 /tmp/smoke.dtccpkg
docker compose --profile engine exec -T engine sha256sum /var/lib/dtcc-engine/packages/$JOB.dtccpkg
docker compose --profile engine logs engine-worker | grep "$JOB"
```

Repeat the status request until the state is `completed` before downloading.
Expected: the job goes from `queued` or `running` to `completed`; Core reads the package as a `VolumeMesh` from `smoke`; both SHA-256 digests match; the worker's log shows the task received and succeeded.

Ruling (2026-09-30, Task 13, Step 2): the first run's `docker compose exec -T engine python` failed with `ModuleNotFoundError: No module named 'dtcc_core'`, because `exec` does not run the image's entrypoint, which activates the `engine` environment, so `python` was the base environment's. The command now runs the `engine` environment's interpreter, as the production health check does.

- [x] **Step 3: Run a representative Sim job by hand**

Repeat Step 2 with `"dataset": "traffic_simulation"`, and record the result, the job's duration, and the package size. It downloads roads from OpenStreetMap and zones from Statistics Sweden: if either is unreachable or rate-limits, the job fails with the provider's error type, and that outcome is recorded rather than retried automatically.
Expected, when the providers respond: `completed`, with a `RoadNetwork` package that Core reads.

- [x] **Step 4: Verify the tests leave development jobs alone**

With `pnpm dev:engine` still running, run `pnpm engine:check`, then `docker compose --profile engine exec -T engine-redis redis-cli -n 0 keys 'dtcc-engine:job:*'`.
Expected: the tests pass; the development database still lists exactly the jobs from Steps 2 and 3; the API and the worker keep running. Stop `pnpm dev:engine`.

- [x] **Step 5: Update the README**

After the engine paragraph, add:

```markdown
`pnpm dev:engine` also starts the engine's Redis and a Celery worker. Submit a job with `POST /api/v1/jobs` and a body such as `{"dataset": "smoke", "parameters": {"bounds": [319891, 6399790, 320091, 6399990]}}`, poll `GET /api/v1/jobs/<job id>`, and download a completed job's package from `GET /api/v1/jobs/<job id>/package`. The worker does not reload code: after changing the engine, run `docker compose --profile engine restart engine-worker`. `pnpm engine:check` starts the engine's Redis if it is not running and leaves it running.
```

Run: `npx --yes prettier@3.9.6 --write README.md compose.yaml package.json && npx --yes prettier@3.9.6 --check README.md compose.yaml package.json apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 6: Validate**

Run: `pnpm engine:check`, `pnpm engine:check:prod`, `docker compose config --services`, and `pnpm check`.
Expected: 62 passed; the production checks pass with `engine-redis` in their own Compose project; the services without a profile are only `postgres`; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately, including Step 3's outcome.

- [x] **Step 7: Stop for review**

Set Increment 2a's status to executed with the date, leave changes uncommitted, and report Steps 2 to 4 and 6.

Ruling (2026-09-30, Task 13, review): the README's package table still said that the engine serves Dataset discovery so far, although increment 2a adds local jobs and their packages. The row now names all three.

### Task 14: Take a job only when the worker can run it

Added 2026-09-30 after the review of the whole increment (`baea8d1..f4cf8a1`). The worker runs one job at a time (`--concurrency 1`), but by default it reserves up to four messages. Without `acks_late`, Celery acknowledges a message only when a pool process accepts its task, so a job reserved behind a running one waits in the worker unacknowledged. Kombu's Redis transport returns unacknowledged messages older than `visibility_timeout`, 3,600 s by default, to their queue without checking whether their consumer is still alive, and the worker then receives the job a second time. Both copies run once the running job finishes. This is an automatic execution retry, which DESIGN.md excludes ("Engine adds no automatic execution retries"). It rewrites the job's finish time, which extends its retention. If the second run fails, the job keeps `completed` but gains an error type, and if its package check fails, the first run's package is deleted.

The mechanism is read from the sources under "Interfaces verified for the tasks" and has not yet been reproduced; Step 2 reproduces it. `worker_disable_prefetch=True` makes the worker receive a message only while it holds fewer requests than it has pool processes, running ones included. A waiting job therefore stays in Redis rather than in the worker, and early acknowledgement is kept. A prefetch multiplier of 1 would still reserve one waiting message per process. A longer visibility timeout would need an upper bound on how long jobs wait, which Engine does not have. This removes one redelivery path, not every duplicate. DESIGN.md's "No exactly-once execution" statement stays, and a worker lost during a job is increment 4's restart behavior.

The task also adds the review's agreed coverage of existing behavior: a package that fails validation is deleted, and a failed job's package is refused. It also corrects the README's token wording.

**Files:**

- Create: `apps/engine/tests/test_redelivery.py`
- Modify: `apps/engine/dtcc_engine/jobs.py` (`Jobs.__init__`)
- Modify: `apps/engine/tests/test_jobs.py` (validation-failure test, failed-job download)
- Modify: `README.md` (token wording)
- Modify: `apps/engine/PLAN.md` (Increment 2a status)

**Interfaces:**

- Consumes:
  - From Tasks 10 to 12: `Jobs(redis_url, target, package_dir)`, `Jobs.submit`, `Jobs.status`, `Jobs.package_path`, and `Jobs.celery_app`.
  - From `conftest.py`: the `redis_url` fixture.
  - From `test_jobs.py`: the `served_client`, `served_jobs`, and `failing_dataset` fixtures, and `submit`, `wait_until`, `SMOKE`, `AUTHORIZED`, and `FINISHED`.
  - From Celery: `start_worker(app, pool="prefork", concurrency=1)`.
  - From kombu: `Connection(url, transport_options={"visibility_timeout": ...})` and its default channel's `qos.restore_visible(interval=1)`.
- Produces: every `Jobs` instance's Celery app sets `worker_disable_prefetch=True`, so a worker, `engine-worker` included, receives a job only when a pool process is free. No API change.

- [x] **Step 1: Write the redelivery test**

Create `apps/engine/tests/test_redelivery.py`:

```python
"""Tests that a job waiting behind a running one is delivered to the worker once.

The worker here uses the prefork pool, as the worker service does: a pool process runs the job while the worker's
main process keeps receiving messages. The test has its own module so that no other test's worker thread is running
in this process when the pool forks.
"""

import time
from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import pytest
import redis
from celery.contrib.testing.worker import start_worker
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from dtcc_core.model import Mesh
from kombu import Connection

from dtcc_engine.jobs import Jobs

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
RELEASE_KEY = "engine-test:release"
VISIBILITY_TIMEOUT = 1


def runs_key(label: str) -> str:
    return f"engine-test:runs:{label}"


def wait_for(condition: Callable[[], bool], timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline
        time.sleep(0.1)


@pytest.fixture
def counting_dataset(redis_url: str) -> Iterator[str]:
    """Register a Dataset that counts its runs in Redis by label and, if `gated`, waits for the release key."""

    class CountingProbeArgs(DatasetBaseArgs):
        label: str
        gated: bool = False

    class CountingProbeDataset(DatasetDescriptor):
        name = "engine_counting_probe"
        description = "Dataset defined by an Engine test that counts how often it runs"
        ArgsModel = CountingProbeArgs

        def build(self, args):
            # Runs in a pool process, so the count and the gate go through Redis.
            client = redis.Redis.from_url(redis_url)
            client.incr(runs_key(args.label))
            if args.gated:
                wait_for(lambda: client.exists(RELEASE_KEY))
            return Mesh(
                vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]])
            )

    try:
        yield "engine_counting_probe"
    finally:
        unregister("engine_counting_probe")


@pytest.fixture
def prefork_jobs(redis_url: str, tmp_path: Path, counting_dataset: str) -> Iterator[Jobs]:
    """Jobs served by a one-process prefork worker; a gated job is released at the latest when the test ends."""
    jobs = Jobs(redis_url, "prefork", tmp_path)
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        try:
            yield jobs
        finally:
            jobs.records.set(RELEASE_KEY, 1)


def wait_until_completed(jobs: Jobs, job_id: str) -> None:
    def completed() -> bool:
        job = jobs.status(job_id)
        assert job["state"] != "failed", job
        return job["state"] == "completed"

    wait_for(completed)


def test_job_waiting_behind_a_running_job_runs_once(prefork_jobs: Jobs, counting_dataset: str, redis_url: str) -> None:
    runs = prefork_jobs.records
    prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "held", "gated": True})
    waiting = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "waiting"})
    wait_for(lambda: runs.get(runs_key("held")) == "1")
    # Ages any message the worker holds unacknowledged past the visibility timeout.
    time.sleep(VISIBILITY_TIMEOUT + 1)
    # The worker restores on a schedule a test cannot time; any consumer restores every unacknowledged message.
    with Connection(redis_url, transport_options={"visibility_timeout": VISIBILITY_TIMEOUT}) as connection:
        connection.default_channel.qos.restore_visible(interval=1)
    runs.set(RELEASE_KEY, 1)
    wait_until_completed(prefork_jobs, waiting)
    # Sent after the restore, so it runs after any second delivery of the waiting job.
    last = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "last"})
    wait_until_completed(prefork_jobs, last)
    assert runs.mget([runs_key(label) for label in ("held", "waiting", "last")]) == ["1", "1", "1"]
```

The count is of actual Dataset runs: a job's final `completed` state cannot show that it ran once. The worker keeps kombu's one-hour visibility timeout, so its own restores cannot act during the test. The test restores once itself, through kombu's `restore_visible`, from a connection with a one-second timeout. It does so while the held job is still running, after the waiting job's message has had time to age. The two-second sleep allows time for the worker to receive that message and for it to age, but it does not synchronize with the receipt. A test cannot wait for the receipt, because with the fix the message is never received while the held job runs. The worker's own schedule cannot be timed (see "Redelivery" under "Interfaces verified for the tasks"). The test adds about 3 s to `engine:check`.

- [x] **Step 2: Run the test to verify it fails for the right reason**

Run: `pnpm engine:check tests/test_redelivery.py`
Expected: FAIL on the last assertion with `['1', '2', '1']`, because the waiting job ran twice. If it fails in any other way, or passes, stop and report. A pass means that the redelivery was not reproduced, so the task stops for review before the setting is implemented. Before the review, observe whether the worker had received the waiting job's message, and when: check its entry in kombu's `unacked` hash and its score in `unacked_index`. Don't just lengthen the sleep. Until Step 2 has failed as expected, the test is not a demonstrated regression test.

- [x] **Step 3: Cover package deletion and a failed job's download**

In `apps/engine/tests/test_jobs.py`, add after `test_result_core_cannot_package_fails_the_job`:

```python
def test_package_that_fails_validation_is_deleted(
    served_client: TestClient, served_jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    def reject(path: Path) -> None:
        # Fails the job with another type if the export wrote no package, so the deletion below is real.
        assert path.is_file()
        raise ValueError("probe rejection")

    monkeypatch.setattr("dtcc_engine.jobs.datasets.load_model_package", reject)
    job_id = submit(served_client, SMOKE)
    job = wait_until(served_client, job_id, lambda job: job["state"] in FINISHED)
    assert (job["state"], job["error"], job["package"]) == ("failed", {"type": "ValueError"}, None)
    assert not served_jobs.package_path(job_id).exists()
```

At the end of `test_failing_dataset_fails_the_job_without_a_package`, add the following. This extends the test's expectations rather than changing them: its name already says that the job has no package, and only a queued job's refusal was tested.

```python
    assert served_client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED).status_code == 409
```

- [x] **Step 4: Check that the deletion test detects a missing deletion**

Both tests cover behavior that Tasks 11 and 12 already implement, so they pass as written. To show that the deletion test can fail, temporarily remove `path.unlink()` from `Jobs.run` and run `pnpm engine:check tests/test_jobs.py -k "fails_validation or failing_dataset"`.
Expected: `test_package_that_fails_validation_is_deleted` fails on its last assertion, and `test_failing_dataset_fails_the_job_without_a_package` passes. Restore the line, then confirm that `git diff apps/engine/dtcc_engine/jobs.py` is empty.

- [x] **Step 5: Receive a job only when a pool process is free**

In `Jobs.__init__`, replace the Celery app's settings with:

```python
        self.celery_app.conf.update(
            task_default_queue=target,
            task_track_started=True,
            result_expires=RECORD_LIFETIME,
            # Redis redelivers a message left unacknowledged for an hour, so a job must not wait inside the worker.
            worker_disable_prefetch=True,
        )
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 64 passed, the 62 earlier tests plus the two new ones.

- [x] **Step 7: Correct the README's token wording**

In `README.md`'s engine paragraph, replace "and the Dataset routes need one" with "and every other route needs one". In the next paragraph, replace "`pnpm dev:engine` also starts the engine's Redis and a Celery worker. Submit a job" with "`pnpm dev:engine` also starts the engine's Redis and a Celery worker. The job routes take the same token. Submit a job".

Run: `npx --yes prettier@3.9.6 --check README.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 8: Validate**

Start `pnpm dev:engine`, wait until the worker logs that it is ready, and run `docker compose --profile engine exec -T engine-worker /opt/conda/envs/engine/bin/celery --app dtcc_engine.worker inspect conf`. Stop `pnpm dev:engine`. Then run `pnpm engine:check:prod` and `pnpm check`.
Expected: the worker's configuration, printed as JSON, includes `"worker_disable_prefetch": true`; the production checks pass with `engine-redis` in their own Compose project; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately.

- [x] **Step 9: Stop for review**

Record Task 14's results in Increment 2a's status, leave the changes uncommitted, and report Steps 2, 4, 6, and 8.

Ruling (2026-09-30, increment review): the review of the whole increment gave this task, and its other findings are settled as follows.

- A status read between the worker's record write and Celery's terminal state can report `running` with a finish time. This was settled at Task 11's review and is now recorded under Design.
- These go to increment 4:
  - a lost pool process, which Celery may record as a failure without Engine's exception type or finish time;
  - a lost worker, which can leave its job's state stale rather than failed;
  - a package left on disk for a failed job or for a job without a usable finish time.
- These stay as they are:
  - The `calibration_grid` test pins a type that Core cannot package at its pinned commit, and it fails visibly once Core supports it ([dtcc-core#135](https://github.com/dtcc-platform/dtcc-core/issues/135)).
  - Celery's dependencies beyond `celery[redis]` stay unpinned, as FastAPI's are.
- `docker compose --dry-run down -v`, run without a profile as `pnpm db:reset` runs it, targets only `postgres-data`, not `engine-packages`. With an Engine profile active, its behavior is not verified.
- Increments 2b and 5b gain the checks the review raised.

## Increment 2b: Simulation execution (to be expanded)

**Scope:** the Simulation execution row of the acceptance table: representative FEniCSx Sim Datasets run through the worker with their numerical dependencies, and their packages preserve model fields and provenance.

**Evidence** (2026-09-30, an experiment outside the repository): with Core `develop` (`b375f47`) installed directly and Sim `2422bba` installed without its Core pin, on `linux/amd64`, `urban_heat_simulation` and `city_volume_mesh` ran and round-tripped on three Gothenburg boxes (packages from 68 KB to 1.3 MB), and Sim's own suite gave the same result as at the current pins (89 passed, 8 errors).

**Blockers:**

- Sim pins Core `5ca2ca4`, a commit that no Core branch contains since `develop` was rewritten, so it can be garbage-collected. At that commit, point clouds carry float classifications and every terrain-based Dataset fails; `develop` fixes it (`c4d0293`). Sim must move its pin to a `develop` commit (an upstream Sim change); then `DTCC_SIM_COMMIT` changes and this increment's interfaces are re-verified (DESIGN.md upstream item 3). Engine does not pin Core separately.
- `urban_wind_simulation` calls `dolfinx.fem.petsc.assemble_matrix_mat`, which dolfinx 0.11.0 lacks (`dtcc_sim/urban_wind.py`), and Sim's 8 test errors come from it. It needs a Sim fix.
- `air_quality_field` has not run: it needs a box that contains a measuring station.

**Checks:** besides the Simulation execution row, each representative FEniCSx Dataset runs through the worker service's prefork pool, not only in a process that imports Sim. The worker's main process imports Sim, which initializes PETSc, before it forks the pool process that runs the job. FEniCSx after such a fork is unverified, although `smoke` and `traffic_simulation` ran this way in Task 13. If it fails, other pools, such as `solo`, are evaluated rather than assumed, because they change concurrency and how the worker responds while a job runs.

## Increment 3: Remote targets and delivery (to be expanded)

**Scope:** configured remote targets, automatic local-first routing, explicit targets, per-host job limits, all-hosts-busy queueing, the compute-targets operation (target identifiers, versions, local capabilities, observed availability), aggregated discovery at the entry service that reports target availability and includes remote-only capabilities without executing them locally, and package transfer from a remote Engine HTTP service to the entry service without a shared filesystem. Remote discovery and delivery use the shared token.

**Upstream interfaces:** Celery queue routing and worker concurrency; the same Engine discovery and delivery routes on each host. Packages are validated with `load_model_package` on the executing host before they become downloadable (increment 2a); the entry service streams a remote package through without validating or storing it, because `load_model_package` reads only local files and the spec requires no second stored copy at the entry host.

**Checks:** the Routing, Concurrency, and Remote execution rows of the acceptance table, with real Redis and at least two workers; the Generic discovery row across hosts, including a capability available only on a remote host because of its runtime conditions (for example credentials or data present only there), with every host running the same image digest; the Authentication row for remote discovery and delivery; host-local discovery does not query other hosts; downloading a remote package through the entry service leaves no copy of the archive on the entry host.

**Blockers:** none known beyond increment 2. Hosts are compared by platform-specific image digest, all hosts sharing one architecture, which the deployment supplies to each host's configuration; discovery's `versions` come from distribution metadata, and Git-installed Core and Sim report the same version across commits, so versions alone cannot establish compatibility.

## Increment 4: Lifecycle behavior (to be expanded)

**Scope:** failure reporting, pre-execution cancellation (moved from increment 2) and the start/cancel race, running-job cancellation reported as unsupported, restart behavior without recovery promises for separate API, worker, and broker restarts, and physical cleanup of expired packages, and of packages left without a completed job, such as one kept after its job failed or one whose record has no finish time. It also handles a failed job whose worker recorded no exception type. The loss of a pool process, which Celery may record as a failure, is distinguished from the loss of the whole worker, which can leave the job's state stale. Both gaps were found in increment 2a's review.

**Upstream interfaces:** Celery 5.6.3's task states, revocation, and result expiry (increment 2a), read in its source at `v5.6.3`. `control.revoke` without termination makes each worker that receives the broadcast add the ID to an in-memory revoked set (by default at most 50,000 IDs, oldest evicted first when full, entries older than 10,800 seconds purged lazily; kept across restarts only with `--statedb`) and immediately attempt to write `REVOKED` to the result backend for the ID, whatever its state (`celery/worker/control.py`, `_revoke`). The write is skipped when the stored state is `SUCCESS` (`celery/backends/base.py`, `BaseKeyValueStoreBackend._store_result`); a queued message is discarded when a worker receives it (`celery/worker/request.py`, `Request.revoked`). So `REVOKED` does not confirm cancellation: a running task keeps running and its result overwrites it; revoking a failed job overwrites `FAILURE` and restarts its expiry, while a succeeded job keeps `SUCCESS`; revoking an unknown ID creates a record; a revoke sent while no worker runs is lost. The worker's `task_revoked` signal marks an actual discard. Core's `DatasetUpstreamError` (defined in `dtcc_core.datasets.dataset`; not re-exported from `dtcc_core.datasets` at the pinned commit) and `DatasetDescriptor.serialize_upstream_error`, which converts it into JSON-safe metadata (Dataset, operation, target, failure class, status code, message, transience). Engine still decides which of that metadata a consumer sees, so that no error response exposes the API token or provider credentials.

**Checks:** the Failure reporting, Cancellation, Retention, and Restart behavior rows of the acceptance table, each restart exercised separately, against the selected Celery version (upstream item 5).

**Blockers:** the revocation behavior above comes from source only; it and the queued-task races must be verified with real Redis and workers before the cancellation contract is claimed.

## Increment 5a: Production image for the HTTP service

Status: executed 2026-09-29 to 2026-09-30, before increment 2. Tasks 5 to 7 are committed in `8d934a8` and Task 8 in `9d32bd3`. Tasks 5 to 8 ran on `linux-aarch64`, with image sizes `dev` 4.08 GB and `prod` 4.07 GB, against 4.91 GB for the previous development image. Task 9, added 2026-09-30 when `linux/amd64` was chosen as the only architecture, was executed the same day under emulation on Apple silicon and is committed in `1d45970`. Its results: before the switch, `engine:check` gave 1 failed (the new test, with TetGen's internal error) and 37 passed; on `linux/amd64`, `engine:check` gave 38 passed on `x86_64`, `engine:check:prod` gave 18 passed with the container healthy and the token checks passing, `dev:engine` answered health, the Dataset listing, and 401 without a token, and `pnpm check` passed on a rerun after one backend e2e test timed out at 5 s under heavy machine load. Observed timings: 5.3 s for the 38 tests; 88 s for a build that reuses the conda, TetGen, and Sim layers; 116 s for the Sim layer, which compiles Core. Not run: native x86_64 execution and the Container deployment acceptance row (5b).

**Scope:** a `prod` target in `apps/engine/Dockerfile` that shares the conda, TetGen, Core, and Sim layers with `dev`: the Engine package installed without its test extra or test files, no source mounts or reloading, a non-root user, a `HEALTHCHECK` against `/api/v1/health`, and only a C compiler kept from the build tools. Both targets' conda environment is resolved from a lock file for `linux-64` and `linux-aarch64`. 5a lays the image's foundation; increment 2 still adds Celery and the worker to it.

**Upstream interfaces:**

- conda-lock 4.0.2, verified in its source at `v4.0.2`: an `environment.yml` may set a top-level `category:`; several `--file` sources are solved together; a package reachable from `main` keeps only the `main` category (`conda_lock/lockfile/__init__.py`, `_truncate_main_category`); `render --kind explicit` writes one explicit file per platform, and `--extras build` adds the `build` category.
- conda: `conda create --file` installs an explicit lock file without solving; `conda remove --force` removes only the named packages, not those that depend on them (conda documentation, `conda remove`).
- dolfinx 0.11.0 caches compiled forms in `$XDG_CACHE_HOME/fenics`, by default `~/.cache/fenics` (`python/dolfinx/jit.py` at `v0.11.0`); `fem.form` accepts `jit_options={"cache_dir": ...}` (`python/dolfinx/fem/forms.py`).
- Core at `5ca2ca4` compiles C++ when installed (scikit-build-core and pybind11) and installs `dtcc-mesher` from Git; the TetGen wrapper builds with CMake. The build tools are needed at install time only.
- pip: a direct-URL requirement's only candidate is its link, never the installed distribution (`src/pip/_internal/resolution/resolvelib/factory.py`, explicit candidates), and the resolver follows installed distributions' dependencies. Any install that resolves Sim's dependencies therefore fetches `dtcc-core @ git+...` again and needs Git.
- conda 26.7.2's `conda doctor consistency` checks every installed record's `depends` and `constrains` with `MatchSpec` and prints "The environment is consistent." or "The environment is not consistent."; it exits 0 either way (`conda/plugins/subcommands/doctor/health_checks/consistency.py`).

**Design:** one solve covers the runtime packages (`environment.yml`, category `main`, including `c-compiler` because FEniCSx compiles forms at runtime) and the build-only tools (`environment-build.yml`, category `build`). A `builder` stage creates the environment from the rendered build lock, installs the TetGen wrapper and Sim with pip as the development image does now, installs the Engine's runtime dependencies from `pyproject.toml` while Git is still present, and then force-removes the packages that only the build lock contains; by construction of the categories, no runtime package depends on them. A `runtime` stage copies the environment to the same absolute path on the same pinned base image, because a conda environment contains absolute paths. `dev` and `prod` both start from `runtime` and install the Engine package itself with `--no-deps`, so they never resolve Sim's Git requirements; `dev` then installs the test extra's requirements, which do not reach Sim. No wheels move between stages: pip resolves against the installed conda packages as it does now, so Fiona, Rasterio, PyProj, Pyogrio, and h5py stay conda's, and compiled extensions run against the libraries they were built with.

**Recorded limits:**

- Pip dependencies of Core and Sim that conda does not provide stay unlocked; the spec requires only the conda lock. A rebuild can resolve different pip versions, so a deployment runs the exact image digest it tested (5b).
- Tasks 5 to 8 built and tested only the build host's architecture (`linux-aarch64` on Apple silicon). Task 9 moves the image to `linux/amd64` and builds and tests the `linux-64` lock under emulation; native x86_64 is not tested until 5b.
- The production checks run with the pytest that Core depends on. If Core drops it upstream, `pnpm engine:check:prod` needs another runner.

**Checks:** the environment tests pass in `dev` and, as the production user, in `prod`; `prod` runs as a non-root user; it contains no Engine source checkout (`/app`, `/src`), its installed Engine distribution contains no tests and is not editable; the test extra's current package `httpx` is absent; the build-only tools are absent, including conda's target-prefixed compilers; the installed conda packages equal the runtime lock and `conda doctor` reports them consistent; `pip check` passes; FEniCSx compiles a form into an empty cache; the container reports healthy; the Dataset routes reject a missing token and accept the configured one. The Container deployment acceptance row stays not run until 5b.

**Blockers:** none for building and checking locally. The AGPL-3.0 license review for TetGen must be completed before the image is pushed to any registry, including a private one.

### Task 5: Lock the conda environment

**Files:**

- Create: `apps/engine/environment.yml`
- Create: `apps/engine/environment-build.yml`
- Create: `apps/engine/lock.sh`
- Create (generated): `apps/engine/conda-lock.yml`, `apps/engine/conda-linux-64.lock`, `apps/engine/conda-linux-aarch64.lock`, `apps/engine/conda-build-linux-64.lock`, `apps/engine/conda-build-linux-aarch64.lock`
- Modify: `compose.yaml` (add `engine-lock`)
- Modify: `package.json` (add `engine:lock`)
- Modify: `.prettierignore`

**Interfaces:**

- Consumes: the package list of the current Dockerfile's `mamba create`.
- Produces: `conda-{platform}.lock` (runtime, category `main`) and `conda-build-{platform}.lock` (runtime plus build tools) for `linux-64` and `linux-aarch64`; `pnpm engine:lock` regenerates all five files.

- [x] **Step 1: Write the environment files**

Create `apps/engine/environment.yml`:

```yaml
# Conda packages of the Engine image at runtime. After a change, run `pnpm engine:lock`.
channels:
  - conda-forge
  - nodefaults
dependencies:
  - python=3.12
  # Not a dependency of python: conda adds pip only when it solves an environment itself, and conda-lock does not.
  - pip
  - fenics-dolfinx=0.11.0
  - petsc4py=3.25.5
  - mpich=5.0.1
  # Packages linking GDAL, PROJ or HDF5 come from conda-forge so one copy of each library is shared;
  # their pip wheels bundle their own. h5py matches Core's exact pin.
  - fiona
  - rasterio
  - pyproj
  - pyogrio
  - h5py=3.16.0
  # FEniCSx compiles forms when a simulation runs.
  - c-compiler
```

Create `apps/engine/environment-build.yml`:

```yaml
# Tools that build the TetGen wrapper, Core and Sim; the image removes them after the build.
category: build
channels:
  - conda-forge
  - nodefaults
dependencies:
  - cxx-compiler
  # The unprefixed `ar` that CMake looks for, which the compilers do not provide.
  - binutils
  - cmake
  - ninja
  - git
```

Ruling (2026-09-29, Task 5, Step 3): the first lock contained no `pip`. conda-forge's `python` does not depend on it, and conda-lock's solve does not add it as conda does, so without it the builder's `pip install` fails or uses the base environment's pip. `pip` is added to `environment.yml`.

`compilers` becomes `c-compiler` plus `cxx-compiler`, because nothing in the image compiles Fortran. If the Task 7 build fails for a missing tool, add that tool to `environment-build.yml`, record the change as a ruling, and relock.

- [x] **Step 2: Add the lock command**

Create `apps/engine/lock.sh`:

```sh
#!/bin/sh
# Solves the Engine's conda environment for both Linux platforms; run it through `pnpm engine:lock`.
set -eu
conda create --yes --quiet --prefix /tmp/conda-lock conda-lock=4.0.2
lock=/tmp/conda-lock/bin/conda-lock
"$lock" lock --file environment.yml --file environment-build.yml --platform linux-64 --platform linux-aarch64 --lockfile conda-lock.yml
"$lock" render --kind explicit --filename-template "conda-{platform}.lock" conda-lock.yml
"$lock" render --kind explicit --extras build --filename-template "conda-build-{platform}.lock" conda-lock.yml
```

Add to `compose.yaml`, after the `engine` service and indented like it:

```yaml
engine-lock:
  # Regenerates the Engine's conda lock files: `pnpm engine:lock`.
  profiles: [engine-lock]
  image: condaforge/miniforge3:26.7.2-0
  working_dir: /engine
  command: ["sh", "lock.sh"]
  volumes:
    - ./apps/engine:/engine
```

In `package.json`, add after `dev:engine`:

```json
"engine:lock": "docker compose --profile engine-lock run --rm engine-lock",
```

Add `apps/engine/conda-lock.yml` to `.prettierignore`; it is generated.

- [x] **Step 3: Generate and inspect the lock**

Run: `pnpm engine:lock`
Expected: `conda-lock.yml` and the four explicit `.lock` files exist; each explicit file contains `@EXPLICIT` and lists `https://conda.anaconda.org/conda-forge/...` URLs.

Run, for `linux-aarch64` and then `linux-64`:

```sh
comm -23 <(grep '^https' apps/engine/conda-build-linux-aarch64.lock | sed 's/#.*//' | sort) <(grep '^https' apps/engine/conda-linux-aarch64.lock | sed 's/#.*//' | sort) | sed 's#.*/##'
comm -13 <(grep '^https' apps/engine/conda-build-linux-aarch64.lock | sed 's/#.*//' | sort) <(grep '^https' apps/engine/conda-linux-aarch64.lock | sed 's/#.*//' | sort)
```

Expected: the first lists only build-only packages (the C++ compiler packages, `binutils`, `cmake`, `ninja`, `git`, and dependencies only they need) and no Python, numerical, GDAL, or C compiler package; the second is empty, because the build lock contains the whole runtime lock with the same builds. If a runtime package appears in the first list, stop: the category split does not behave as read in conda-lock's source.

- [x] **Step 4: Stop for review**

Leave changes uncommitted. Report the package counts per platform and the build-only lists.

### Task 6: Production checks

**Files:**

- Create: `apps/engine/prod_checks/test_prod_image.py`
- Create: `apps/engine/check-prod.sh`
- Modify: `apps/engine/tests/test_environment.py` (module docstring)
- Modify: `apps/engine/Dockerfile` (name the stage `dev`; add a placeholder `prod` stage)
- Modify: `compose.yaml` (`engine` target; add `engine-prod`)
- Modify: `package.json` (add `engine:check:prod`)

**Interfaces:**

- Consumes: the explicit lock files from Task 5; `tests/test_environment.py`.
- Produces: `pnpm engine:check:prod` builds the `prod` target and, in the separate Compose project `dtcc-twin-engine-prod`, runs the environment tests and the production checks inside it as the image's user, then checks health and authentication. `apps/engine` is mounted read-only at `/checks`; the image contains no checks.

- [x] **Step 1: Write the production checks**

Create `apps/engine/prod_checks/test_prod_image.py`:

```python
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
```

Ruling (2026-09-29, Task 6, Step 3): the first run looked the distribution up with `distribution("dtcc-engine")`, which searches `sys.path` in order. `python -m` puts the working directory first, and the placeholder's `/app/dtcc_engine.egg-info` shadowed the installed `dist-info`, so the editable-install check passed without reading it. Both checks now use `installed_engine()`, which searches only the environment's `site-packages` and fails on a missing or duplicate distribution.

In `apps/engine/tests/test_environment.py`, replace the docstring sentence "Passing them verifies only the development image, not a production deployment." with "They run in the development image through `pnpm engine:check` and in the production image through `pnpm engine:check:prod`; passing them does not verify a deployment."

- [x] **Step 2: Add the check command and a placeholder `prod` target**

Create `apps/engine/check-prod.sh`:

```sh
#!/bin/sh
# Builds the Engine's prod target and checks it in its own Compose project, so a running
# `pnpm dev:engine` or Postgres is left alone. The checks are mounted; the image contains none.
set -eu
cd "$(dirname "$0")/../.."
compose() { docker compose --project-name dtcc-twin-engine-prod --profile engine-prod "$@"; }
trap 'compose down' EXIT

compose build engine-prod
# A fresh container has an empty FEniCSx cache, so every form in these tests is compiled.
compose run --rm -T --volume "$PWD/apps/engine:/checks:ro" --env XDG_CACHE_HOME=/tmp/cache \
    --env PYTHONDONTWRITEBYTECODE=1 engine-prod \
    python -m pytest -p no:cacheprovider --rootdir /checks /checks/tests/test_environment.py /checks/prod_checks
compose up --detach --wait engine-prod
compose exec -T engine-prod python -c '
import os, urllib.error, urllib.request

def status(headers):
    request = urllib.request.Request("http://localhost:8000/api/v1/datasets", headers=headers)
    try:
        return urllib.request.urlopen(request).status
    except urllib.error.HTTPError as error:
        return error.code

assert status({}) == 401
assert status({"Authorization": "Bearer " + os.environ["ENGINE_API_TOKEN"]}) == 200
print("prod API: healthy, rejects a missing token, accepts the configured token")
'
```

In `apps/engine/Dockerfile`, change `FROM condaforge/miniforge3:26.7.2-0` to `FROM condaforge/miniforge3:26.7.2-0 AS dev` and append `FROM dev AS prod`. The placeholder makes the checks fail on the missing production properties rather than on a missing build target.

In `compose.yaml`, change the `engine` service's `build: apps/engine` to:

```yaml
build:
  context: apps/engine
  target: dev
```

and add after `engine-lock`, indented like it:

```yaml
engine-prod:
  # Local check of the production target: `pnpm engine:check:prod`. No port is published.
  profiles: [engine-prod]
  build:
    context: apps/engine
    target: prod
  environment:
    ENGINE_API_TOKEN: local-prod-check-token
```

In `package.json`, add after `engine:lock`:

```json
"engine:check:prod": "sh apps/engine/check-prod.sh",
```

- [x] **Step 3: Run the checks to verify they fail for the right reason**

Run: `pnpm engine:check:prod`
Expected: the environment tests and `test_fenicsx_compiles_a_form_into_an_empty_cache` pass; `test_engine_distribution_contains_no_tests` and `test_conda_dependencies_are_consistent` pass as guards, because the development image already has those properties (Task 7, Step 4 shows the consistency check can fail); `test_runs_as_a_non_root_user`, `test_image_has_no_engine_source_checkout`, `test_engine_is_not_an_editable_install`, `test_test_extra_is_not_installed`, `test_build_only_tools_are_removed`, and `test_conda_packages_match_the_runtime_lock` fail on their assertions; the script exits non-zero after pytest, and `compose down` removes the project's containers. Any import, mount, or collection error is a setup mistake to fix first. If `test_installed_distributions_have_compatible_requirements` fails, stop and report its output: a pip conflict that already exists in the development environment is a separate decision, not something to work around here.

Run: `pnpm engine:check`
Expected: `37 passed`, unchanged.

- [x] **Step 4: Stop for review**

Leave changes uncommitted. Report Step 3's passing and failing checks.

### Task 7: Build `dev` and `prod` from the lock

**Files:**

- Modify: `apps/engine/Dockerfile` (whole file)
- Modify: `apps/engine/.dockerignore`

**Interfaces:**

- Consumes: the lock files from Task 5; the build arguments `TETGEN_WRAPPER_COMMIT` and `DTCC_SIM_COMMIT` with their current defaults; `project.dependencies` and the `test` extra in `pyproject.toml`, read with the standard library's `tomllib`.
- Produces: stages `builder`, `runtime`, `dev`, and `prod`, with `prod` last and therefore the default target. `dev` behaves as before for `pnpm engine:check` and `pnpm dev:engine`; `prod` runs Uvicorn as user `engine` (uid 10001) with an image `HEALTHCHECK`.

- [x] **Step 1: Replace the Dockerfile**

Replace `apps/engine/Dockerfile` with:

```dockerfile
# DTCC Engine image: the `dev` target for local development and tests, `prod` for deployment; see DESIGN.md.
# It bundles AGPL-3.0 TetGen through dtcc-tetgen-wrapper: review licensing before publishing it.
# Conda packages are pinned by environment*.yml through `pnpm engine:lock`, Git dependencies by the build arguments below.
FROM condaforge/miniforge3:26.7.2-0 AS builder

ARG TARGETARCH
COPY conda-*.lock /locks/
# The build lock is the runtime lock plus the build-only tools, from one solve.
RUN case "$TARGETARCH" in amd64) platform=linux-64 ;; arm64) platform=linux-aarch64 ;; esac \
    && conda create --yes --name engine --file "/locks/conda-build-$platform.lock"

# Activation sets the conda compiler and data-path variables that native builds and GDAL need.
SHELL ["conda", "run", "--no-capture-output", "-n", "engine", "/bin/bash", "-c"]

ARG TETGEN_WRAPPER_COMMIT=22ab9ff2ee1dd03f82ce24dd0f378f00da7e487c
RUN pip install --no-cache-dir \
    "dtcc-tetgen-wrapper @ git+https://github.com/dtcc-platform/dtcc-tetgen-wrapper.git@${TETGEN_WRAPPER_COMMIT}"

# Sim pins the Core commit it is tested with, so Core is not pinned separately.
ARG DTCC_SIM_COMMIT=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf
RUN pip install --no-cache-dir \
    "dtcc-sim @ git+https://github.com/dtcc-platform/dtcc-sim.git@${DTCC_SIM_COMMIT}"

# Resolving Sim's dependencies fetches Core from Git again, so the Engine's dependencies are installed while Git is
# present; later stages install the Engine with --no-deps.
COPY pyproject.toml /engine/
RUN python -c "import tomllib; print(*tomllib.load(open('/engine/pyproject.toml', 'rb'))['project']['dependencies'], sep='\n')" \
        > /engine/requirements.txt \
    && pip install --no-cache-dir -r /engine/requirements.txt

# Removes the packages that only the build lock has; no runtime package depends on them.
SHELL ["/bin/bash", "-c"]
RUN case "$TARGETARCH" in amd64) platform=linux-64 ;; arm64) platform=linux-aarch64 ;; esac \
    && comm -23 <(grep '^https' "/locks/conda-build-$platform.lock" | sed 's/#.*//' | sort) \
        <(grep '^https' "/locks/conda-$platform.lock" | sed 's/#.*//' | sort) \
    | sed -E 's#.*/##; s/\.(conda|tar\.bz2)$//; s/-[^-]+-[^-]+$//' \
    | xargs conda remove --yes --name engine --force --offline

FROM condaforge/miniforge3:26.7.2-0 AS runtime
# Same base image and path as the builder: a conda environment contains absolute paths.
COPY --from=builder /opt/conda/envs/engine /opt/conda/envs/engine
ENV PYTHONUNBUFFERED=1
SHELL ["conda", "run", "--no-capture-output", "-n", "engine", "/bin/bash", "-c"]
# `conda run` does not forward SIGTERM to its child, so activate and exec under the base image's tini.
ENTRYPOINT ["tini", "--", "/bin/bash", "-c", "source /opt/conda/etc/profile.d/conda.sh && conda activate engine && exec \"$@\"", "engine"]
EXPOSE 8000
CMD ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS dev
WORKDIR /app
COPY pyproject.toml ./
COPY dtcc_engine ./dtcc_engine
RUN pip install --no-cache-dir --no-deps -e . \
    && python -c "import tomllib; print(*tomllib.load(open('pyproject.toml', 'rb'))['project']['optional-dependencies']['test'], sep='\n')" \
        > /tmp/test-requirements.txt \
    && pip install --no-cache-dir -r /tmp/test-requirements.txt \
    && rm /tmp/test-requirements.txt
COPY tests ./tests

FROM runtime AS prod
# setuptools writes build files into the source tree; the writable mount discards them.
RUN --mount=type=bind,target=/src,rw pip install --no-cache-dir --no-deps /src \
    && useradd --create-home --uid 10001 engine
USER engine
WORKDIR /home/engine
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=5s \
    CMD ["/opt/conda/envs/engine/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')"]
```

In `apps/engine/.dockerignore`, add `!conda-*.lock` after `!pyproject.toml`.

- [x] **Step 2: Verify the development image**

Run: `pnpm engine:check`
Expected: `37 passed`. The build log shows `conda create` installing from the explicit file without a solve; the Engine-dependency step reporting `dtcc-core` and `dtcc-sim` as already satisfied and installing FastAPI and Uvicorn; the removal step removing only the build-only packages from Task 5, Step 3; and no Git clone in the `dev` stage. If the TetGen wrapper, Core, or Sim build fails for a missing tool, follow Task 5, Step 1's ruling rule. If FEniCSx fails to compile a form, the runtime lock lacks a compiler piece: stop and report the error; do not move build tools back into `prod`.

- [x] **Step 3: Verify the production image**

Run: `pnpm engine:check:prod`
Expected: all environment tests and production checks pass; the container reports healthy; the script prints `prod API: healthy, rejects a missing token, accepts the configured token` and exits 0.

- [x] **Step 4: Verify the checks catch a regression**

Temporarily delete the removal `RUN` from the `builder` stage and run `pnpm engine:check:prod`.
Expected: `test_build_only_tools_are_removed` and `test_conda_packages_match_the_runtime_lock` fail. Restore the `RUN`.

Run, in a throwaway container:

```sh
docker compose --project-name dtcc-twin-engine-prod --profile engine-prod run --rm -T --user root \
  --volume "$PWD/apps/engine:/checks:ro" engine-prod bash -c \
  'rm "$CONDA_PREFIX"/conda-meta/libzlib-*.json \
   && python -m pytest -p no:cacheprovider --rootdir /checks /checks/prod_checks -k consistent'
```

Only `libzlib`'s conda record is removed; its library files stay, so the module's numerical imports still load and the test reaches its assertion.
Expected: `test_conda_dependencies_are_consistent` fails on its assertion, and the report lists `libzlib` as missing for the packages that depend on it. An import or collection error means the control did not reach the check. The container is discarded, so the image is unchanged.

- [x] **Step 5: Verify the check leaves the development services alone**

Run `docker compose up -d --wait`, start `pnpm dev:engine` in another terminal, then run `pnpm engine:check:prod`.
Expected: it passes; afterwards `docker compose --profile engine ps` still lists `postgres` and `engine` as running and healthy, and `docker compose --project-name dtcc-twin-engine-prod ps --all` lists nothing.

Run: `docker compose config --services`
Expected: exactly `postgres`. Stop the development services.

- [x] **Step 6: Record the image sizes**

Run: `docker image ls --format '{{.Repository}} {{.Size}}' | grep engine`
Expected: sizes for the `dev` and `prod` images. Record them next to the previous development image's 4.91 GB, as observations rather than targets.

- [x] **Step 7: Stop for review**

Leave changes uncommitted. Report Steps 2 to 6.

### Task 8: Documentation and validation

**Files:**

- Modify: `README.md` (engine note and Commands table)
- Modify: `apps/engine/PLAN.md` (Increment 5a status)

- [x] **Step 1: Update the README**

Append to the README's engine paragraph: "`pnpm engine:check:prod` builds the production image and checks it; after a change to `apps/engine/environment*.yml`, `pnpm engine:lock` re-solves its conda packages."

Add Commands rows after `pnpm dev:engine`: `pnpm engine:check:prod` with "Build the engine's production image and check it. Needs Docker", and `pnpm engine:lock` with "Re-solve the engine's conda lock files. Needs Docker".

- [x] **Step 2: Validate**

Run: `pnpm check`, `pnpm engine:check`, and `pnpm engine:check:prod`.
Expected: all pass. Report passed, failed, skipped, and not-run checks separately; the `linux-64` image build and the Container deployment row are not run.

- [x] **Step 3: Stop for review**

Set Increment 5a's status to executed with the date, leave changes uncommitted, and report.

### Task 9: Build and check the image on `linux/amd64`

Added 2026-09-30. On Linux arm64, GCC contracts floating-point multiply-adds by default, and Core's volume and flat meshing then fail: the same five of Core's own meshing tests fail in this image and in Core's locked uv environment on Ubuntu 24.04 arm64, and all pass when Core, `dtcc-mesher`, and the TetGen wrapper are compiled with `-ffp-contract=off` or for `linux/amd64`. Core's CI covers x86_64 Linux, macOS, and Windows, not Linux arm64 ([dtcc-core#134](https://github.com/dtcc-platform/dtcc-core/issues/134)). The image therefore targets `linux/amd64` only, in development and in production (DESIGN.md, "Engine image"), and Apple silicon runs it under Docker's emulation. Engine does not carry the compiler flag: it would work around an upstream bug for an architecture that is not deployed.

**Files:**

- Modify: `apps/engine/tests/test_environment.py` (add a volume-mesh test)
- Modify: `compose.yaml` (`platform` for `engine` and `engine-prod`)
- Modify: `README.md` (engine paragraph)

**Interfaces:**

- Consumes: DESIGN.md's `linux/amd64` rule; the `linux-64` lock files from Task 5, which the Dockerfile already selects when `TARGETARCH` is `amd64`; Core's `build_city_volume_mesh` and the model classes `City`, `Building`, `Surface`, `Terrain`, `Raster`, `Bounds`, and `GeometryType`, public at `5ca2ca4` and used the same way by Core's `test_build_city_volume_mesh_smoke`.
- Produces: `pnpm engine:check`, `pnpm dev:engine`, and `pnpm engine:check:prod` build and run the `linux/amd64` image on any host. The `linux-aarch64` lock files stay: removing that platform from `lock.sh` re-solves the lock, so it waits for the next relock.

- [x] **Step 1: Write the failing test**

In `apps/engine/tests/test_environment.py`, add the imports:

```python
from dtcc_core.builder import build_city_volume_mesh
from dtcc_core.model import Bounds, Building, City, GeometryType, Raster, Surface, Terrain
from shapely.geometry import box
```

Add after the fixtures:

```python
def flat_city(buildings: list[tuple[tuple[float, float, float, float], float]]) -> City:
    """A city on flat 80 m by 80 m terrain with LOD0 buildings, given as (footprint box, height) pairs."""
    raster = Raster()
    raster.data = np.zeros((8, 8))
    raster.set_bounds(Bounds(0.0, 0.0, 80.0, 80.0))
    terrain = Terrain()
    terrain.add_geometry(raster, GeometryType.RASTER)
    city = City()
    city.add_terrain(terrain)
    city_buildings = []
    for footprint, height in buildings:
        surface = Surface()
        surface.from_polygon(box(*footprint), height)
        building = Building()
        building.add_geometry(surface, GeometryType.LOD0)
        building.attributes["estimated_height"] = height
        building.attributes["ground_height"] = 0.0
        city_buildings.append(building)
    city.add_buildings(city_buildings)
    return city
```

Add after `test_tetgen_tetrahedralizes_the_unit_cube`:

```python
def test_core_builds_a_volume_mesh_of_a_small_city(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # TetGen writes its failure dumps to the working directory, which is the mounted source tree in the dev image.
    monkeypatch.chdir(tmp_path)
    # Core's own smoke case. On Linux arm64, GCC's floating-point contraction makes TetGen reject its surface.
    city = flat_city([((10, 10, 18, 18), 10.0), ((24, 10, 32, 18), 12.0)])
    volume_mesh = build_city_volume_mesh(
        city,
        lod=GeometryType.LOD0,
        domain_height=40.0,
        max_mesh_size=8.0,
        min_mesh_angle=20.0,
        merge_buildings=True,
        min_building_detail=0.0,
        min_building_area=1.0,
        merge_tolerance=0.0,
        smoothing=0,
        boundary_face_markers=False,
        report_mesh_quality=False,
    )
    assert volume_mesh.cells.shape[0] > 0
```

- [x] **Step 2: Confirm it fails on the current `linux/arm64` image**

Run on Apple silicon: `pnpm engine:check`
Expected: `1 failed, 37 passed`; the new test fails with `RuntimeError: TetGen failed (code 2): internal error (report bug)`, as it did in the 2026-09-30 experiment. An import or collection error means the test is wrong, not the architecture.

Ruling (2026-09-30, Task 9, Step 2): the first run left TetGen's four `tetgen_fail.*` dump files in `apps/engine`, because TetGen writes them to the working directory, which in the development image is the mounted source tree. The test now changes into its temporary directory first, as the Step 1 listing shows.

- [x] **Step 3: Target `linux/amd64`**

In `compose.yaml`, add to the `engine` service, after `profiles`:

```yaml
# The image supports linux/amd64 only (apps/engine/DESIGN.md); Apple silicon emulates it.
platform: linux/amd64
```

Add `platform: linux/amd64` to the `engine-prod` service, after `profiles`. `engine-lock` stays native: conda-lock solves both platforms from any host.

- [x] **Step 4: Verify the development image**

Run: `pnpm engine:check`, then `docker compose --profile engine run --rm -T engine uname -m`
Expected: `38 passed`; `x86_64`. The build log shows `conda create` installing from `conda-build-linux-64.lock`. Record the build and test durations as observations; this is the first build from the `linux-64` lock.

- [x] **Step 5: Verify the production image**

Run: `pnpm engine:check:prod`
Expected: all environment tests and production checks pass, including `test_conda_packages_match_the_runtime_lock` against `conda-linux-64.lock`; the container reports healthy; the script prints `prod API: healthy, rejects a missing token, accepts the configured token`. If the health check does not pass within its 60-second start period under emulation, stop and report the startup time rather than changing the health check.

- [x] **Step 6: Verify the development server**

Run `pnpm dev:engine`, then:

```sh
curl -fsS http://127.0.0.1:8000/api/v1/health
curl -fsS -H "Authorization: Bearer local-dev-engine-token" http://127.0.0.1:8000/api/v1/datasets | head -c 200
```

Expected: `{"status":"ok"}`; a listing that starts with `catalog_revision`. Stop the server.

- [x] **Step 7: Update the README**

Append to the README's engine paragraph: "The engine image is built for `linux/amd64`; on Apple silicon, Docker emulates it, so its builds and tests are slower."

Run: `npx --yes prettier@3.9.6 --write README.md compose.yaml && npx --yes prettier@3.9.6 --check README.md compose.yaml apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 8: Validate and stop for review**

Run: `pnpm check`
Expected: passes. Set Task 9's status in 5a's status line, leave changes uncommitted, and report Steps 2, 4, 5, and 6 with passed, failed, skipped, and not-run checks. Native x86_64 execution stays not run until 5b.

## Increment 5b: Worker image and Linux deployment (to be expanded)

**Depends on:** increments 2a and 2b for the worker, Redis, packages, and simulation jobs; increment 3 for remote delivery measurements and comparing image digests across hosts; increment 4 for restart behavior.

**Scope:** the worker containers' Celery-specific health-check override; the documented production runtime settings (TLS reverse proxy, token secret, package and FEniCSx cache volumes, shared memory, thread counts, external Redis); building and validating the `linux/amd64` image on a native x86_64 Linux host (Task 9 ran it only under emulation); deploying the API and worker on that host, running representative Core and Sim jobs, and recording the baseline measurements the spec lists, with hardware, image digest, and software versions. The deployment runs the exact image digest it tested.

**Upstream interfaces:** Celery's worker inspection for the health check, Celery 5.6.3 (increment 2a); the same `prod` image and `dtcc-engine` entry points as 5a.

**Checks:** the Container deployment row of the acceptance table on a Linux host, including canonical package validation for a representative Sim job; both the API and worker containers report healthy; a restart keeps the FEniCSx cache and completed packages; the 5a checks pass on the native x86_64 host; the API and worker containers write and serve packages on the mounted package volume as uid 10001. The 5a `engine-prod` check sets `ENGINE_PACKAGE_DIR` but runs only the HTTP service and mounts no volume. Whether the services check the directory at startup is decided when 5b is expanded.

**Blockers:** the AGPL-3.0 license review for TetGen must be completed before the image is pushed to any registry, including a private one.

## Increment 6: Mini-service retirement (to be expanded)

**Scope:** inventory the existing consumers and deployment entry points of Sim's mini-service (at least Sim's `docker-compose.yml`, `build_docker.sh`, `Dockerfile`, and `service/`, and Core's `RemoteDatasetDescriptor` client, which calls `/api/v1/datasets` without a token), transition each to Engine, verify the replacement behavior for each, and propose the retirement of `service/` from Sim as a separate upstream change.

**Upstream interfaces:** Sim's `service/` package and its deployment files at the pinned commit; Core's `RemoteDatasetDescriptor` in `dtcc_core/datasets/remote.py`.

**Checks:** the Service replacement row of the acceptance table; each inventoried consumer has a verified transition; retirement is complete only when the upstream change lands.

**Blockers:** Core's compatibility decision on whether `RemoteDatasetDescriptor` is adapted to Engine's API (including its token) or retired; the spec says this requires a separate Core decision.

## Explicitly deferred beyond v1

- Guaranteed persistence, restart recovery, job resumption, and high availability (spec, "Deferred or excluded from v1"). They are not added through the 30-day retention requirement.
- Twin backend integration (NestJS forwarding of Engine requests for the frontend) is outside this plan; it is designed as backend work under `apps/backend/CONVENTIONS.md`.
