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

## Increment 5: Production image and Linux deployment (to be expanded)

**Scope:** add a `prod` target to `apps/engine/Dockerfile` that shares the conda, TetGen, Core, and Sim layers with `dev`: the Engine package installed without its test extra or test files, no source mounts or reloading, a non-root user, a `HEALTHCHECK` against `/api/v1/health` with a Celery-specific override for worker containers, and only a C compiler kept from the build tools; resolve the conda environment from a lock file; document the production runtime settings (TLS reverse proxy, token secret, package and FEniCSx cache volumes, shared memory, thread counts, external Redis); choose the deployment's single CPU architecture; deploy the API and worker on a Linux host of that architecture, run representative Core and Sim jobs, and record the baseline measurements the spec lists, with hardware, image digest, and software versions.

**Upstream interfaces:** the conda-forge packages already pinned in the image (dolfinx 0.11.0 has `linux-64` and `linux-aarch64` builds), a conda lock tool such as `conda-lock`, the TetGen wrapper and Core and Sim at the pinned commits, and the same `dtcc-engine` package and entry points as `dev`.

**Checks:** the Container deployment row of the acceptance table on a Linux host, including canonical package validation for a representative Sim job; the `prod` image contains neither the Engine test extra nor test files (pytest from Core's own dependencies is expected until removed upstream) and runs as a non-root user; both the API and worker containers report healthy; FEniCSx still compiles forms in `prod`; a restart keeps the FEniCSx cache and completed packages.

**Blockers:** the AGPL-3.0 license review for TetGen must be completed before the image is pushed to any registry, including a private one.

## Increment 6: Mini-service retirement (to be expanded)

**Scope:** inventory the existing consumers and deployment entry points of Sim's mini-service (at least Sim's `docker-compose.yml`, `build_docker.sh`, `Dockerfile`, and `service/`, and Core's `RemoteDatasetDescriptor` client, which calls `/api/v1/datasets` without a token), transition each to Engine, verify the replacement behavior for each, and propose the retirement of `service/` from Sim as a separate upstream change.

**Upstream interfaces:** Sim's `service/` package and its deployment files at the pinned commit; Core's `RemoteDatasetDescriptor` in `dtcc_core/datasets/remote.py`.

**Checks:** the Service replacement row of the acceptance table; each inventoried consumer has a verified transition; retirement is complete only when the upstream change lands.

**Blockers:** Core's compatibility decision on whether `RemoteDatasetDescriptor` is adapted to Engine's API (including its token) or retired; the spec says this requires a separate Core decision.

## Explicitly deferred beyond v1

- Guaranteed persistence, restart recovery, job resumption, and high availability (spec, "Deferred or excluded from v1"). They are not added through the 30-day retention requirement.
- Twin backend integration (NestJS forwarding of Engine requests for the frontend) is outside this plan; it is designed as backend work under `apps/backend/CONVENTIONS.md`.
