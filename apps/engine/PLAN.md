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

## Increment 2: Local execution and packaging (to be expanded)

**Scope:** Redis and a Celery worker from the same image; job submission (`POST`) with request-envelope and target validation, status polling, pre-execution cancellation, and `.dtccpkg` download for Datasets executed on the local target; 30-day retention of completed packages.

**Upstream interfaces:** `DatasetDescriptor.validate()` for argument validation (Core's contract; Engine keeps no copies of argument models) and Dataset invocation; the resulting realization's `export(path, canonical=True)`, which delegates to `dtcc_core/datasets/package.py:export_model_package` and writes a canonical v3 package; `dtcc_core.datasets.load_model_package` to read and integrity-check the package before it is offered for download; Core's progress callback as bridged by Sim's `service/progress.py`. `DatasetDescriptor.export()` is not used: it rebuilds the Dataset, which would repeat the computation.

**Migration from Sim's mini-service:** move and adapt `service/tasks.py` (Celery task invoking a Dataset) and `service/progress.py` (progress bridge), with their tests from `tests/test_service_routes.py` (submission validation and status snapshot cases). Do not carry over `service/results.py` shared-volume delivery or the server-sent-events stream; the spec requires polling and `.dtccpkg` over HTTP.

**Checks:** invalid parameters and bounds fail before execution with Core's validation errors (Validation row); a deterministic Core Dataset runs through the real broker and worker and produces a canonical package that `load_model_package` reads back (Local execution and Package correctness rows); a representative Sim Dataset runs with its real numerical dependencies and its package preserves model fields and provenance (Simulation execution row); queued and running states are distinguishable; missing progress is not fabricated; unknown job IDs are not reported as queued; retention expiry is measured from completion time.

**Verification prerequisite:** for each Dataset exposed for execution, confirm at the pinned commits that its actual result type round-trips through canonical export and `load_model_package` (DESIGN.md upstream item 2).

**Blockers:** any Dataset result type that fails that round trip needs upstream resolution in Core or Sim before its package delivery can be claimed compliant; Engine must not write its own package format or fall back to the legacy v2 layout.

## Increment 3: Remote targets and delivery (to be expanded)

**Scope:** configured remote targets, automatic local-first routing, explicit targets, per-host job limits, all-hosts-busy queueing, the compute-targets operation (target identifiers, versions, local capabilities, observed availability), aggregated discovery at the entry service that reports target availability and includes remote-only capabilities without executing them locally, and package transfer from a remote Engine HTTP service to the entry service without a shared filesystem. Remote discovery and delivery use the shared token.

**Upstream interfaces:** Celery queue routing and worker concurrency; the same Engine discovery and delivery routes on each host. Packages are validated with `load_model_package` on the executing host before they become downloadable (increment 2); the entry service streams a remote package through without validating or storing it, because `load_model_package` reads only local files and the spec requires no second stored copy at the entry host.

**Checks:** the Routing, Concurrency, and Remote execution rows of the acceptance table, with real Redis and at least two workers; the Generic discovery row across hosts, including a capability available only on a remote host because of its runtime conditions (for example credentials or data present only there), with every host running the same image digest; the Authentication row for remote discovery and delivery; host-local discovery does not query other hosts; downloading a remote package through the entry service leaves no copy of the archive on the entry host.

**Blockers:** none known beyond increment 2. Hosts are compared by platform-specific image digest, all hosts sharing one architecture, which the deployment supplies to each host's configuration; discovery's `versions` come from distribution metadata, and Git-installed Core and Sim report the same version across commits, so versions alone cannot establish compatibility.

## Increment 4: Lifecycle behavior (to be expanded)

**Scope:** failure reporting, the start/cancel race, running-job cancellation reported as unsupported, restart behavior without recovery promises for separate API, worker, and broker restarts, and physical cleanup of expired packages.

**Upstream interfaces:** Celery task states, revocation, and result expiry for the Celery version selected in increment 2 (revocation and termination limits, unknown-task `PENDING` state, and `result_expires`, as linked in DESIGN.md's supporting references); Core's `DatasetUpstreamError` (defined in `dtcc_core.datasets.dataset`; not re-exported from `dtcc_core.datasets` at the pinned commit) and `DatasetDescriptor.serialize_upstream_error`, which converts it into JSON-safe metadata (Dataset, operation, target, failure class, status code, message, transience). Engine still decides which of that metadata a consumer sees, so that no error response exposes the API token or provider credentials.

**Checks:** the Failure reporting, Cancellation, Retention, and Restart behavior rows of the acceptance table, each restart exercised separately, against the selected Celery version (upstream item 5).

**Blockers:** the Celery version and its cancellation semantics are unverified until increment 2 selects them; queued-task revocation races must be verified against that version before the cancellation contract is claimed.

## Increment 5a: Production image for the HTTP service

Status: expanded 2026-09-29 to run before increment 2; not yet executed.

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
- Only the build host's architecture is built and tested in 5a (`linux-aarch64` on Apple silicon). The `linux-64` lock is resolved but not built or tested.
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

- [ ] **Step 1: Write the environment files**

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

- [ ] **Step 2: Add the lock command**

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

- [ ] **Step 3: Generate and inspect the lock**

Run: `pnpm engine:lock`
Expected: `conda-lock.yml` and the four explicit `.lock` files exist; each explicit file contains `@EXPLICIT` and lists `https://conda.anaconda.org/conda-forge/...` URLs.

Run, for `linux-aarch64` and then `linux-64`:

```sh
comm -23 <(grep '^https' apps/engine/conda-build-linux-aarch64.lock | sed 's/#.*//' | sort) <(grep '^https' apps/engine/conda-linux-aarch64.lock | sed 's/#.*//' | sort) | sed 's#.*/##'
comm -13 <(grep '^https' apps/engine/conda-build-linux-aarch64.lock | sed 's/#.*//' | sort) <(grep '^https' apps/engine/conda-linux-aarch64.lock | sed 's/#.*//' | sort)
```

Expected: the first lists only build-only packages (the C++ compiler packages, `binutils`, `cmake`, `ninja`, `git`, and dependencies only they need) and no Python, numerical, GDAL, or C compiler package; the second is empty, because the build lock contains the whole runtime lock with the same builds. If a runtime package appears in the first list, stop: the category split does not behave as read in conda-lock's source.

- [ ] **Step 4: Stop for review**

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

- [ ] **Step 1: Write the production checks**

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

- [ ] **Step 2: Add the check command and a placeholder `prod` target**

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

- [ ] **Step 3: Run the checks to verify they fail for the right reason**

Run: `pnpm engine:check:prod`
Expected: the environment tests and `test_fenicsx_compiles_a_form_into_an_empty_cache` pass; `test_engine_distribution_contains_no_tests` and `test_conda_dependencies_are_consistent` pass as guards, because the development image already has those properties (Task 7, Step 4 shows the consistency check can fail); `test_runs_as_a_non_root_user`, `test_image_has_no_engine_source_checkout`, `test_engine_is_not_an_editable_install`, `test_test_extra_is_not_installed`, `test_build_only_tools_are_removed`, and `test_conda_packages_match_the_runtime_lock` fail on their assertions; the script exits non-zero after pytest, and `compose down` removes the project's containers. Any import, mount, or collection error is a setup mistake to fix first. If `test_installed_distributions_have_compatible_requirements` fails, stop and report its output: a pip conflict that already exists in the development environment is a separate decision, not something to work around here.

Run: `pnpm engine:check`
Expected: `37 passed`, unchanged.

- [ ] **Step 4: Stop for review**

Leave changes uncommitted. Report Step 3's passing and failing checks.

### Task 7: Build `dev` and `prod` from the lock

**Files:**

- Modify: `apps/engine/Dockerfile` (whole file)
- Modify: `apps/engine/.dockerignore`

**Interfaces:**

- Consumes: the lock files from Task 5; the build arguments `TETGEN_WRAPPER_COMMIT` and `DTCC_SIM_COMMIT` with their current defaults; `project.dependencies` and the `test` extra in `pyproject.toml`, read with the standard library's `tomllib`.
- Produces: stages `builder`, `runtime`, `dev`, and `prod`, with `prod` last and therefore the default target. `dev` behaves as before for `pnpm engine:check` and `pnpm dev:engine`; `prod` runs Uvicorn as user `engine` (uid 10001) with an image `HEALTHCHECK`.

- [ ] **Step 1: Replace the Dockerfile**

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

- [ ] **Step 2: Verify the development image**

Run: `pnpm engine:check`
Expected: `37 passed`. The build log shows `conda create` installing from the explicit file without a solve; the Engine-dependency step reporting `dtcc-core` and `dtcc-sim` as already satisfied and installing FastAPI and Uvicorn; the removal step removing only the build-only packages from Task 5, Step 3; and no Git clone in the `dev` stage. If the TetGen wrapper, Core, or Sim build fails for a missing tool, follow Task 5, Step 1's ruling rule. If FEniCSx fails to compile a form, the runtime lock lacks a compiler piece: stop and report the error; do not move build tools back into `prod`.

- [ ] **Step 3: Verify the production image**

Run: `pnpm engine:check:prod`
Expected: all environment tests and production checks pass; the container reports healthy; the script prints `prod API: healthy, rejects a missing token, accepts the configured token` and exits 0.

- [ ] **Step 4: Verify the checks catch a regression**

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

- [ ] **Step 5: Verify the check leaves the development services alone**

Run `docker compose up -d --wait`, start `pnpm dev:engine` in another terminal, then run `pnpm engine:check:prod`.
Expected: it passes; afterwards `docker compose --profile engine ps` still lists `postgres` and `engine` as running and healthy, and `docker compose --project-name dtcc-twin-engine-prod ps --all` lists nothing.

Run: `docker compose config --services`
Expected: exactly `postgres`. Stop the development services.

- [ ] **Step 6: Record the image sizes**

Run: `docker image ls --format '{{.Repository}} {{.Size}}' | grep engine`
Expected: sizes for the `dev` and `prod` images. Record them next to the previous development image's 4.91 GB, as observations rather than targets.

- [ ] **Step 7: Stop for review**

Leave changes uncommitted. Report Steps 2 to 6.

### Task 8: Documentation and validation

**Files:**

- Modify: `README.md` (engine note and Commands table)
- Modify: `apps/engine/PLAN.md` (Increment 5a status)

- [ ] **Step 1: Update the README**

Append to the README's engine paragraph: "`pnpm engine:check:prod` builds the production image and checks it; after a change to `apps/engine/environment*.yml`, `pnpm engine:lock` re-solves its conda packages."

Add Commands rows after `pnpm dev:engine`: `pnpm engine:check:prod` with "Build the engine's production image and check it. Needs Docker", and `pnpm engine:lock` with "Re-solve the engine's conda lock files. Needs Docker".

- [ ] **Step 2: Validate**

Run: `pnpm check`, `pnpm engine:check`, and `pnpm engine:check:prod`.
Expected: all pass. Report passed, failed, skipped, and not-run checks separately; the `linux-64` image build and the Container deployment row are not run.

- [ ] **Step 3: Stop for review**

Set Increment 5a's status to executed with the date, leave changes uncommitted, and report.

## Increment 5b: Worker image and Linux deployment (to be expanded)

**Depends on:** increment 2 for the worker, Redis, and packages; increment 3 for remote delivery measurements and comparing image digests across hosts; increment 4 for restart behavior.

**Scope:** the worker containers' Celery-specific health-check override; the documented production runtime settings (TLS reverse proxy, token secret, package and FEniCSx cache volumes, shared memory, thread counts, external Redis); choosing the deployment's single CPU architecture and building and validating the image on it; deploying the API and worker on a Linux host of that architecture, running representative Core and Sim jobs, and recording the baseline measurements the spec lists, with hardware, image digest, and software versions. The deployment runs the exact image digest it tested.

**Upstream interfaces:** Celery's worker inspection for the health check, in the version increment 2 selects; the same `prod` image and `dtcc-engine` entry points as 5a.

**Checks:** the Container deployment row of the acceptance table on a Linux host, including canonical package validation for a representative Sim job; both the API and worker containers report healthy; a restart keeps the FEniCSx cache and completed packages; the 5a checks pass on the chosen architecture.

**Blockers:** the AGPL-3.0 license review for TetGen must be completed before the image is pushed to any registry, including a private one.

## Increment 6: Mini-service retirement (to be expanded)

**Scope:** inventory the existing consumers and deployment entry points of Sim's mini-service (at least Sim's `docker-compose.yml`, `build_docker.sh`, `Dockerfile`, and `service/`, and Core's `RemoteDatasetDescriptor` client, which calls `/api/v1/datasets` without a token), transition each to Engine, verify the replacement behavior for each, and propose the retirement of `service/` from Sim as a separate upstream change.

**Upstream interfaces:** Sim's `service/` package and its deployment files at the pinned commit; Core's `RemoteDatasetDescriptor` in `dtcc_core/datasets/remote.py`.

**Checks:** the Service replacement row of the acceptance table; each inventoried consumer has a verified transition; retirement is complete only when the upstream change lands.

**Blockers:** Core's compatibility decision on whether `RemoteDatasetDescriptor` is adapted to Engine's API (including its token) or retired; the spec says this requires a separate Core decision.

## Explicitly deferred beyond v1

- Guaranteed persistence, restart recovery, job resumption, and high availability (spec, "Deferred or excluded from v1"). They are not added through the 30-day retention requirement.
- Twin backend integration (NestJS forwarding of Engine requests for the frontend) is outside this plan; it is designed as backend work under `apps/backend/CONVENTIONS.md`.
