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
- **Increment 2 is split.** 2a, local execution and packaging, runs with the current pins and is expanded into Tasks 10 to 14; 2b, execution of FEniCSx simulations, moves the pins to the Sim commit that fixes them and is expanded into Tasks 15 and 16. Cancellation moves to increment 4, whose cancellation section records the decision to use an Engine start/cancel gate after investigating Celery revocation.
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
15. The image is built after Core's `develop` has moved, or a later install step resolves Sim's dependencies again: the build fails, rather than producing an image whose Core is not the pinned commit. Pinned in Task 15, Steps 1 and 2 (the build's commit check).
16. A simulation job runs on the worker service, whose main process initialized PETSc before forking the pool process that runs it: the job completes, and its package loads with its fields. Pinned in Task 16, Step 1 (`test_fenicsx_solve_runs_in_a_prefork_pool_process`), and checked with Sim's Datasets in Step 3.
17. A consumer cancels a job that waits behind a running one, or that no worker has received yet, even if a worker starts or restarts afterwards: `200` with `cancelled`, the Dataset never runs, and the job reports `cancelled` without a package, although Celery stored `STARTED` when a worker received it. Pinned in Task 18 (`test_job_cancelled_before_a_worker_runs_never_runs`, `test_delivery_after_cancellation_never_runs`) and checked through the worker service in Task 19, Step 4.
18. A consumer cancels a job whose delivery claimed it: `409` with `execution_started`, and the job runs to its end and delivers its package. A cancellation racing the start ends in exactly one of three ways: cancelled and never run, refused and run, or `already_finished`. Pinned in Task 18 (`test_started_job_cannot_be_cancelled_and_completes`, `test_cancel_racing_the_start_either_prevents_the_run_or_is_refused`).
19. The broker delivers a finished job's message again: the Dataset does not run again, and the job keeps its outcome, finish time, record expiry, and package, although Celery stores `STARTED` over a failure. Pinned in Task 17 (`test_job_delivered_again_after_it_finished_does_not_run_again`, `test_job_delivered_again_does_not_run_again`).
20. Redis loses a job's record while the job runs: whether the job completes or fails, the worker does not recreate a partial record. Pinned in Task 17 (`test_record_lost_while_the_job_runs_is_not_recreated`).
21. A cancellation's answer is lost: `503`, which does not say the cancellation failed, and polling shows `cancelled`. Pinned in Task 18 (`test_lost_cancel_answer_leaves_the_outcome_to_polling`).
22. A job's record has no gate, as every record from before Task 17 does, or its fields contradict each other: status, download, and cancellation answer `503`, nothing changes the record, and no delivery runs the job. Pinned in Tasks 17 and 18 (`test_unusable_record_is_reported_unavailable_and_never_runs`, `test_cancel_of_an_unusable_record_is_unavailable_and_changes_nothing`).
23. A Dataset's provider rejects a request whose URL holds the provider key, in its query, its path, or its user information, or whose target does not parse: the failed job reports Core's Dataset, operation, failure class, status code, and transience, and neither the target nor the message, so no part of the key. Pinned in Task 20 (`test_upstream_failure_reports_cores_metadata_without_credentials`).
24. A job's pool process is killed: the job fails with `WorkerLostError` and a finish time, and the worker runs the next job. Pinned in Task 21 (`test_job_whose_pool_process_is_lost_fails_and_the_worker_runs_on`).
25. A worker is killed while it runs a job and is started again: the job fails with `WorkerRestarted`; a job that another worker claimed keeps running; a record whose claim or acceptance fields are unusable stays as it was and does not keep the worker from starting; a worker that does not return leaves its job running. Pinned in Task 21 (`test_worker_started_again_fails_the_jobs_its_earlier_run_left`) and checked through the worker service in Task 21, Step 6.
26. A job never finishes, because its message was lost, its submission was never queued, or its worker never returned: its record expires 31 days after its submission or its claim, and the job is then unknown; a record lost while its job is sent is not recreated when the broker confirms the message. Pinned in Task 22 (`test_job_records_outlast_the_package_retention`, `test_claim_restarts_the_lifetime_of_the_record`, `test_confirmation_does_not_recreate_a_record_lost_meanwhile`).
27. A host's package directory holds packages of expired, failed, cancelled, unknown, and running jobs, and a staging directory that a killed export left: when the worker starts, it deletes the staging directory and the packages no job can deliver, and every hour after, those packages again; it keeps the running job's package, and a staging directory made while it runs, however old. A worker started again deletes at start the package of a job its earlier run left after the export, once it has recorded the job's failure. Pinned in Task 23 (`test_worker_deletes_the_packages_no_job_can_deliver`) and in the branch review's change (`test_worker_started_again_deletes_the_package_its_earlier_run_left`).
28. The API, the worker, and Redis are restarted one at a time while jobs run and wait, in a Compose project of their own: an API or worker restart, or a graceful Redis restart, loses, fails, and repeats no job; status answers `503` while Redis is down; and after Redis is killed and returns to a snapshot saved before them, the jobs accepted after it are unknown rather than failed. Pinned in Task 24 (`test_restarted_api_serves_the_jobs_the_earlier_one_accepted`, `test_job_queued_while_no_worker_runs_runs_when_a_worker_starts`) and checked in Task 24, Step 3.
29. A worker starts under a node name other than `celery@<its target>`, with a queue other than its target's, or while a running worker answers to its node name: it exits with code 1 before it checks any claim or consumes, so it runs no other target's job and fails no job of the running worker. A running worker whose answer is late or lost, or two workers that start at once, escape the last check. Pinned in Task 25 (`test_worker_refuses_a_node_name_other_than_its_targets`, `test_worker_refuses_a_queue_other_than_its_targets_and_runs_none_of_its_jobs`, `test_worker_refuses_the_node_name_of_a_running_worker_and_fails_none_of_its_jobs`) and checked through the worker service in Task 25, Step 6.
30. `ENGINE_TARGET` cannot name a Celery node, for example because it holds a space, or `ENGINE_IMAGE_DIGEST` is malformed: the API and the worker refuse to start, rather than write claims that cannot be read back or report a digest that can never match. Pinned in Task 25 (`test_target_identifier_that_cannot_name_a_node_is_refused`, `test_malformed_image_digest_is_refused`).
31. A remote host's worker holds its limit or has jobs waiting, does not answer, consumes another queue as well or none, or runs another image, or the host's HTTP service cannot be reached, rejects the token, or redirects: `GET /api/v1/targets` reports each target's state from its worker's own answer through the broker, `busy`, `unknown`, `unavailable`, or `incompatible`, and its host-local discovery or why it is missing; a host whose HTTP service answers is not thereby ready, the shared token, and no other credential such as a `.netrc` entry's, goes only to the configured address and not to a redirect's location, and no answer repeats a job's arguments. Pinned in Task 26 (`test_target_whose_worker_holds_its_limit_or_has_jobs_waiting_is_busy`, `test_target_whose_api_answers_but_whose_worker_does_not_is_unknown`, `test_worker_that_does_not_consume_exactly_its_queue_is_unavailable`, `test_worker_is_compatible_when_its_image_digest_matches_this_hosts`, `test_host_whose_discovery_cannot_be_read_is_reported_with_the_reason`, `test_redirect_from_a_host_is_not_followed`, `test_host_is_sent_the_shared_token_and_no_other_credential`) and checked through the worker service in Task 26, Step 6.
32. `ENGINE_REMOTE_TARGETS` names the local target or one target twice, or gives an address with credentials, a query or a fragment, even an empty one, a scheme other than `http` or `https`, or a form that Python's URL parser rejects: the API refuses to start, and neither its error nor what it was raised from repeats the address. Pinned in Task 26 (`test_remote_targets_that_cannot_be_used_are_refused_without_repeating_their_addresses`).
33. A remote target's job completes, and its host keeps its package, has lost it, or cannot deliver it because the host cannot be reached, rejects the token, redirects, answers another status, or serves another target, or the target is not configured; or the host sends the package compressed or stops sending midway, or the client abandons the download: the entry's status reports the package as available, unavailable, or unknown, `null`; its download streams the host's package unchanged, decoded if the host encoded it, and keeps no copy, or answers `409` or `503` without the host's answer; a stream that fails midway fails the download; an abandoned download closes the entry's request to the host; a host's host-local route serves only its own target's packages and never forwards; and a remote job past its retention is unknown at the entry and at its host, though its file remains. Pinned in Task 27 (`test_remote_job_is_polled_and_downloaded_through_the_entry`, `test_remote_package_its_host_no_longer_has_is_unavailable`, `test_remote_package_whose_host_does_not_deliver_it_is_unknown`, `test_host_answer_that_is_not_a_package_is_not_passed_on`, `test_package_its_host_stops_sending_is_not_delivered_whole`, `test_package_its_host_sends_compressed_is_delivered_as_the_archive`, `test_download_the_client_abandons_releases_its_hosts_connection`, `test_host_serves_its_own_packages_and_forwards_none`, `test_remote_package_past_its_retention_is_unknown_though_its_file_remains`).

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

Status: expanded into Tasks 10 to 14. Tasks 10 to 13 were executed 2026-09-30; Task 14, added after the review of the whole increment, was executed 2026-10-01 and is committed in `4413401`. Task 10 was executed 2026-09-30, after a probe in the development image confirmed that a Dataset's `ProgressTracker(total=100)` update reaches the thread-local callback as `(50.0, 'halfway')` and that a bare triangle `Mesh` survives canonical export and `load_model_package`, and is committed in `bb881a0`. Its results: before the implementation, `engine:check` gave 12 failed, each on a status code or the default `Not Found` detail, and 38 passed; after it, 50 passed, and `pnpm check` passed. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed. Task 11 was executed 2026-09-30 and is committed in `cf115d5`. Its results: before the implementation, with the worker fixture running, `engine:check` gave 6 failed, each on an assertion, and 50 passed: the 4 execution tests because every job completed at once without a package, the status test with `completed` and no finish time, and the sharing test because another Celery app had the task; after it, 56 passed in 5.5 s, and `pnpm check` passed. Task 12 was executed 2026-09-30 and is committed in `3609179`. Its results: before the implementation, `engine:check` gave 6 failed and 56 passed: the new token case, the download test, and `within-retention` got `404` from the missing route, the unknown-or-unfinished test got `(404, 404)`, `after-retention` got `200` for the status, and the completed job's record had no expiry while its Celery result had the one-day default; after it, 62 passed in 6.6 s, and `pnpm check` passed. Task 13 was executed 2026-09-30 and is committed in `f4cf8a1`. Its results: with `pnpm dev:engine` running the API and the worker, a `smoke` job was `running` at its first poll and finished 0.9 s after submission; its 114 KB package downloaded with the stored file's SHA-256, and Core read it as a `VolumeMesh` from `smoke`. A `traffic_simulation` job, with roads from Overpass and DeSO zones and statistics from Statistics Sweden, finished in 11.8 s without reporting progress, and Core read its 21 KB package as a `RoadNetwork`. `engine:check` then gave 62 passed while the development database still held exactly those two jobs and the API and the worker kept running. Stopped while idle, the worker logged a warm shutdown and exited with 0, without the `MPI_Abort` that still ends the API's process. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 14's results: before the setting, the redelivery test failed on its last assertion with `['1', '2', '1']`, so the waiting job ran twice. With `path.unlink()` removed, the deletion test failed on its last assertion, because the package remained, and the failed job's download test passed; with the line restored, `jobs.py` was unchanged. After the setting, `engine:check` gave 64 passed in 11.3 s; in the full run, billiard warns that the test process is multi-threaded when the pool forks, which the test alone does not. With `pnpm dev:engine` running, `inspect conf` printed `"worker_disable_prefetch": true` for the worker, which logged a warm shutdown and exited with 0 when stopped. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed.

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

These describe the implemented 2a behavior. Increment 4's [cancellation design](#cancellation) supersedes Celery's authority over recorded terminal outcomes and the separate finalization writes when implemented; the historical decisions below are retained for context.

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

The mechanism is read from the sources under "Interfaces verified for the tasks", and Step 2 reproduced it before the fix. `worker_disable_prefetch=True` makes the worker receive a message only while it holds fewer requests than it has pool processes, running ones included. A waiting job therefore stays in Redis rather than in the worker, and early acknowledgement is kept. A prefetch multiplier of 1 would still reserve one waiting message per process. A longer visibility timeout would need an upper bound on how long jobs wait, which Engine does not have. This removes one redelivery path, not every duplicate. DESIGN.md's "No exactly-once execution" statement stays, and a worker lost during a job is increment 4's restart behavior.

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

## Increment 2b: Simulation execution

Status: executed 2026-10-01, in Tasks 15 and 16, expanded the same day. Task 15 is committed in `9e1607a`. Its results: with the commit check added and the installation unchanged, the build failed at the check with `dtcc-core and dtcc-sim are ['afe1c28b71e545750b890d8db58113c74188475e', '0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339'], not ['2289d11f85049e13d5042e5cb3e5627c6568765f', '0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339']`, because pip resolved Sim's Core requirement to the head of Core's `develop`, `afe1c28`, both when installing Sim and again when installing the Engine's dependencies. With Core installed at its pin and Sim without its dependencies, the check passed, `engine:check` gave 64 passed in 12.3 s, and the development image's `direct_url.json` files recorded Core `2289d11f85049e13d5042e5cb3e5627c6568765f` and Sim `0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339`. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, `pip check` among them, and its token checks passed; the production image recorded the same two commits. `pnpm check` passed. Task 16 is committed in `c56913c`. Its results: `engine:check tests/test_simulation.py` gave 1 passed in 6.0 s. With `pnpm dev:engine` running the API and the worker, the four jobs, submitted together, completed one at a time: `city_volume_mesh` 13.5 s after submission, `urban_heat_simulation` 18.7 s, `urban_wind_simulation` 755 s, of which the worker ran it for 737 s, and `air_quality_field` 785 s, of which 30 s, while the air quality provider returned two 500 errors. Each downloaded package had the stored file's SHA-256, and Core read each as a `VolumeMesh` from the Dataset it was submitted to, with one value per vertex in every field: `city_volume_mesh`, 68.5 KB, 1,645 vertices and no fields; `urban_heat_simulation`, 79.4 KB, `temperature` (`degC`, 1); `urban_wind_simulation`, 131.9 KB, `velocity` (`m/s`, 3), `pressure` (`m^2/s^2`, 1), and `speed` (`m/s`, 1); and `air_quality_field`, 129.9 KB, 2,599 vertices, `NO2` (`µg/m3`, 1) from 3 observations, with `z_offset` 10.13 among its request parameters. While the wind job ran, `inspect ping` got a `pong` from the worker 4 s and 6.4 minutes after the job started. The wind solve did not converge: it stopped at its `max_steps`, 2000, with a relative change of 1.0 and a CFL number of 60,132, its velocity solves reported `KSP_DIVERGED_NANORINF` from step 132, and its fields, all finite, give speeds up to 85,630 m/s for a 5 m/s inlet. The same Dataset, run on the same box in a new process in the `engine` container, outside any pool, diverged the same way in 733 s, from step 305, with speeds up to 276,600 m/s, so the divergence does not come from the pool; the job is `completed` because Sim returns a result ([dtcc-sim#12](https://github.com/dtcc-platform/dtcc-sim/issues/12)). Stopped while idle, the worker logged a warm shutdown and exited with 0. `engine:check` then gave 65 passed in 14.5 s; in the full run, billiard warns that the test process is multi-threaded when the new test's pool forks, which it does not when the test runs alone. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. On 2026-10-04 the pins moved to Sim `41055d560c66939a93e23c51f4cc71210541cb26` and Core `17c6efe44ca7622e6ef4a802627dfce3ef7f6174`, the commit in that Sim commit's `uv.lock`, by the procedure in DESIGN.md's upstream item 3, to take Sim's fix for [dtcc-sim#11](https://github.com/dtcc-platform/dtcc-sim/issues/11). Sim's package metadata still declares only Core, and `17c6efe` is reachable from Core's `develop`. Of the Core files Engine relies on, only `dtcc_core/datasets/remote.py` changed, so that remote discovery skips a name registered to a local Dataset; Engine does not use it. Sim places a station without an elevation on the mesh's ground plus `station_height_above_ground` (2 m by default), using the elevation provenance that Core `17c6efe` records, and a usable station outside the mesh is now an error. `engine:check` gave 65 passed, and the development and production images recorded both commits. With `pnpm dev:engine`, `city_volume_mesh`, `urban_heat_simulation`, and, without `z_offset`, `air_quality_field` on `[319450, 6400200, 319650, 6400400]` completed, each with matching SHA-256 digests and a package that loads with its fields: the NO2 field from 9.77 to 18.88 µg/m3. `urban_wind_simulation` completed after 16 minutes and still diverged, ending at `max_steps` with speeds up to 44,469 m/s ([dtcc-sim#12](https://github.com/dtcc-platform/dtcc-sim/issues/12)); the worker answered `inspect ping` during it and shut down warm. `engine:check:prod` gave 18 passed, and its token checks passed; `pnpm check` passed. These changes are left uncommitted for team review.

**Scope:** the Simulation execution row of the acceptance table: representative FEniCSx Sim Datasets run through the worker with their numerical dependencies, and their packages preserve model fields and provenance. The pins move to Sim `0c9d1c4`, which replaces the wind solver's missing DOLFINx call and follows Core's `develop`, and to the Core commit that Sim's lock file records for it; the image enforces that pair.

**Evidence** (2026-10-01, outside the repository): an image built from `apps/engine/Dockerfile` with Core installed first at `2289d11` and Sim `0c9d1c4` installed without its dependencies, on `linux/amd64` under emulation, gave the following.

- Sim's suite at `0c9d1c4`: 97 passed. At `2422bba` it gave 89 passed and 8 errors, all from `assemble_matrix_mat`.
- Engine's suite: 64 passed; `pip check` reports no broken requirements.
- On the three boxes of 2026-09-30, `[319891, 6399790, 320091, 6399990]`, `[319995.96, 6399009.72, 320195.96, 6399209.72]`, and `[319500, 6399300, 319900, 6399700]`, canonical export and `load_model_package` returned the same type, model encoding, and context:
  - `city_volume_mesh` and `urban_heat_simulation` on all three, with the package sizes of 2026-09-30.
  - `urban_wind_simulation` on the first in 680 s and on the second in 1,386 s; on the third it had not finished after 1,500 s, the probe's limit. Its values were not checked then. On the first box, rerun with its default `dt` of 0.2, the solve diverges from step 3, ends at `max_steps` with speeds up to 276,600 m/s, and is returned without an error; with `dt` 0.05 it diverges from step 17 and reaches 213,469 m/s, so a smaller step only delays the divergence ([dtcc-sim#12](https://github.com/dtcc-platform/dtcc-sim/issues/12)).
- `air_quality_field`: Core's `air_quality` returns stations with `z = 0`. On `[319450, 6400200, 319650, 6400400]`, which holds two NO2 stations, no station lies inside the volume mesh, whose height there runs from 0.13 m to 80.13 m, and the build fails with "no point observations were located inside the mesh". With `z_offset` set 10 m above the mesh's lowest point, 10.13, the NO2 field in µg/m3 builds and round-trips; 2 m above it is not enough. Of the stations around Gothenburg, many report stale values, some from 2013, and the provider returned some 500 errors.
- All 28 registered Datasets on the first box: 22 round-trip, against 15 at `5ca2ca4`. The point-cloud-based ones now pass. `building_footprints`, `buildings`, `calibration_grid`, and `trees` fail on canonical export ([dtcc-core#135](https://github.com/dtcc-platform/dtcc-core/issues/135)); `air_quality_field` finds no station in the box; `roads` failed because every Overpass endpoint failed at the time, while `traffic_simulation`, which also fetches roads, passed in the same run.
- A FEniCSx solve in a one-process prefork pool, through `Jobs` and Redis, completed and its package loaded with its field: Task 16's test, run from outside the repository in 6 s.
- Not yet run: Sim's Datasets through the worker service.

**Upstream interfaces**, re-verified 2026-10-01 at Core `2289d11` and Sim `0c9d1c4`, in the sources at both commits and by the evidence above:

- Every Core claim under 2a's "Upstream interfaces" and "Interfaces verified for the tasks" holds, with these differences:
  - Core no longer limits an archive or an artifact to 256 MiB. Protobuf's 2 GiB per message is the limit, and the 4 MiB manifest and 9999-artifact limits remain. `load_model_package` gains `max_bytes=None`, with no limit by default. The worker reads back only the package it has just written, and increment 3's entry service streams a remote package without reading it, so Engine is unchanged.
  - `buildings`, `city_flat_mesh`, `city_surface_mesh`, and `terrain_surface_mesh` gain an optional `center_on_origin` argument, so the catalog revision changes; `describe()` keeps its keys.
  - Core's runtime dependencies drop `pybind11`. No package that bundles GDAL, PROJ, or HDF5 is added, and no conda package is needed.
- `5ca2ca4` is not an ancestor of `2289d11`, because Core's `develop` was rewritten; `2289d11` is reachable from `develop`, whose head was `bb95f2f` on 2026-10-01.
- Sim at `0c9d1c4` declares one dependency, `dtcc-core @ git+https://github.com/dtcc-platform/dtcc-core.git@develop` (`pyproject.toml`), and its `uv.lock` records Core `2289d11f85049e13d5042e5cb3e5627c6568765f`. pip does not read `uv.lock`. The wind solver uses `assemble_matrix(A, a, bcs=...)` (`dtcc_sim/urban_wind.py`), and Sim requires DOLFINx 0.11.0, as Engine's lock does.
- Sim's fields: `urban_wind_simulation` attaches `velocity` (dimension 3, `m/s`), `pressure` (`m^2/s^2`), and `speed` (`m/s`); `urban_heat_simulation`, `temperature` (`degC`); `air_quality_field`, the phenomenon's name with the stations' unit. Each is associated with the mesh's vertices.
- Sim's continuous integration has a workflow that tests Sim against a supplied Core commit. None of its recent runs used Sim `0c9d1c4`; that commit's push build passed, and which Core it used is not checked.

**Decisions**, settled 2026-10-01:

- Engine pins both Core and Sim to full commit IDs. Core's is the commit in Sim's `uv.lock` at the pinned Sim commit. Sim deliberately follows Core's `develop` ("Track Core develop and verify current Sim integration", `66769e2`); an exact Core pin in Sim would bind every consumer of Sim to it, and pip refuses two different Git commits of one package. Choosing Core from Sim's lock does not establish that the pair works; this increment's checks do, so the pair is a candidate until Tasks 15 and 16 pass.
- The build installs Core at its pin, then Sim without its dependencies, because Sim's only one is Core. Engine's own dependencies are installed without exactly `dtcc-core` and `dtcc-sim`, so that pip does not resolve Sim's Core requirement again. One check after all installs fails the build unless Core and Sim are the pinned commits.
- `air_quality_field` fails with its default `z_offset` wherever its stations lie below the mesh. This is Sim's to fix ([dtcc-sim#11](https://github.com/dtcc-platform/dtcc-sim/issues/11)); Sim fixed it in `6364772`, in the pins since 2026-10-04. Engine passes `z_offset` through like any other parameter and supplies no default (Global Constraints).
- The wind solver's emulated duration, 11 to 23 minutes on a 200 m box, says nothing about a deployment; increment 5b measures it on a native host. A long job is not delivered again: a pool process acknowledges a job when it starts it, and the worker receives a job only when a pool process is free (Task 14).
- `urban_wind_simulation` diverges with its defaults, and Sim returns the result as if it had converged ([dtcc-sim#12](https://github.com/dtcc-platform/dtcc-sim/issues/12)). Engine reports what a Dataset returns, so such a job is `completed`; whether a simulation's values are right is Sim's. 2b is accepted for Engine's part (2026-10-02): the jobs ran with their numerical dependencies, and their packages kept their fields and provenance.
- Automated checks stay offline, as in 2a. A test-defined Dataset that solves a small FEniCSx problem checks the prefork pool; Sim's Datasets, which download city data, run once by hand, and the results are recorded.

**Checks:** the Simulation execution row in the development image: `city_volume_mesh`, `urban_heat_simulation`, `urban_wind_simulation`, and `air_quality_field` (with `z_offset`) run as jobs of the worker service, and their downloaded packages load with their fields and the Dataset that made them; a FEniCSx solve in a prefork pool process, whose parent initialized PETSc, completes (automated); the worker answers `inspect ping` while a simulation runs; the development and production images contain the pinned Core and Sim. Production acceptance on a Linux host is increment 5b's.

**Blockers:** none for Engine. Upstream: `urban_wind_simulation`'s divergence with its defaults, returned as a result ([dtcc-sim#12](https://github.com/dtcc-platform/dtcc-sim/issues/12)); the four result types canonical export does not support ([dtcc-core#135](https://github.com/dtcc-platform/dtcc-core/issues/135)).

**Design:** Engine's code does not change. Its one job task runs any registered Dataset, Sim's included, and the worker service already uses the prefork pool. The increment changes the image, the spec's pinning rule, and the tests.

**Interfaces verified for the tasks** (2026-10-01):

- pip: a requirement's direct URL, including its resolved `commit_id`, is recorded in the distribution's `direct_url.json`, which `importlib.metadata.distribution(name).read_text("direct_url.json")` returns; `pip install --no-deps` installs a distribution without resolving its requirements; `pip check` accepts Sim's URL requirement on Core when Core is installed from another commit (the evidence above).
- Docker: build arguments declared in a stage are set as environment variables in that stage's later `RUN` steps.
- DOLFINx 0.11.0: `mesh.create_unit_cube(comm, nx, ny, nz)`, `fem.functionspace(domain, ("Lagrange", 1))`, `space.tabulate_dof_coordinates()` (shape `(N, 3)`), `space.dofmap.list` (shape `(cells, 4)` for first-order tetrahedra), and `LinearProblem(a, L, petsc_options_prefix=..., petsc_options=...)` with `solve()` returning a function whose `x.array` holds its values (`tests/test_environment.py` and the prefork test above).
- Core at `2289d11`: `VolumeMesh(vertices=..., cells=..., fields=[...])` and `Field(name=..., values=..., association="vertex")`, both from `dtcc_core.model`; `Field` values must have shape `(N,)` for dimension 1 (`dtcc_core/model/values/field.py`); a loaded model's `dataset_context.request.dataset_name` names its Dataset.

### Task 15: Install Core and Sim as the pair Sim locks

**Files:**

- Modify: `apps/engine/Dockerfile` (Core and Sim installation, Engine dependencies, commit check)
- Modify: `apps/engine/DESIGN.md` (image rules, inspected revisions, upstream item 3)
- Modify: `apps/engine/PLAN.md` (Increment 2b status)

**Interfaces:**

- Consumes: the Dockerfile's builder stage from Tasks 5 to 9; `project.dependencies` in `pyproject.toml`.
- Produces: the build arguments `DTCC_CORE_COMMIT` and `DTCC_SIM_COMMIT`, with full commit IDs as defaults; a builder stage that fails unless the installed `dtcc-core` and `dtcc-sim` are those commits. No API change.

- [x] **Step 1: Make the build check the pins**

In `apps/engine/Dockerfile`, replace

```dockerfile
# Sim pins the Core commit it is tested with, so Core is not pinned separately.
ARG DTCC_SIM_COMMIT=2422bbafac6ef07466ca1bcd6905bbd99a8c2ecf
```

with

```dockerfile
# Core is the commit in Sim's uv.lock at DTCC_SIM_COMMIT; Sim's package metadata asks for Core's moving develop branch.
ARG DTCC_CORE_COMMIT=2289d11f85049e13d5042e5cb3e5627c6568765f
ARG DTCC_SIM_COMMIT=0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339
```

and, directly after the `RUN` step that installs the Engine's dependencies from `/engine/requirements.txt`, add

```dockerfile
# Fails the build unless every install above left Core and Sim at their pinned commits.
RUN python -c "import json, sys; from importlib.metadata import distribution; \
installed = [json.loads(distribution(name).read_text('direct_url.json'))['vcs_info']['commit_id'] for name in ('dtcc-core', 'dtcc-sim')]; \
sys.exit(None if installed == sys.argv[1:] else f'dtcc-core and dtcc-sim are {installed}, not {sys.argv[1:]}')" \
    "$DTCC_CORE_COMMIT" "$DTCC_SIM_COMMIT"
```

Leave the installation steps unchanged, so the build installs Sim with its dependencies, as it does now.

- [x] **Step 2: Build to verify the check fails for the right reason**

Run: `docker compose --profile engine build engine`
Expected: the build fails at the new check with `dtcc-core and dtcc-sim are ['<commit>', '0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339'], not ['2289d11f85049e13d5042e5cb3e5627c6568765f', '0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339']`, where `<commit>` is the head of Core's `develop` at build time (`bb95f2f…` on 2026-10-01), because pip resolved Sim's requirement on `develop`. If the build fails anywhere else, or passes, stop and report. Building Core from Git takes several minutes under emulation.

- [x] **Step 3: Install Core at its pin and Sim without its dependencies**

In `apps/engine/Dockerfile`, replace

```dockerfile
RUN pip install --no-cache-dir \
    "dtcc-sim @ git+https://github.com/dtcc-platform/dtcc-sim.git@${DTCC_SIM_COMMIT}"

# Resolving Sim's dependencies fetches Core from Git again, so the Engine's dependencies are installed while Git is
# present; later stages install the Engine with --no-deps.
COPY pyproject.toml /engine/
RUN python -c "import tomllib; print(*tomllib.load(open('/engine/pyproject.toml', 'rb'))['project']['dependencies'], sep='\n')" \
        > /engine/requirements.txt \
    && pip install --no-cache-dir -r /engine/requirements.txt
```

with

```dockerfile
# Sim's only dependency is Core, installed first at its pin.
RUN pip install --no-cache-dir \
        "dtcc-core @ git+https://github.com/dtcc-platform/dtcc-core.git@${DTCC_CORE_COMMIT}" \
    && pip install --no-cache-dir --no-deps \
        "dtcc-sim @ git+https://github.com/dtcc-platform/dtcc-sim.git@${DTCC_SIM_COMMIT}"

# Later stages install the Engine with --no-deps, so its other dependencies are installed here; leaving out Core and
# Sim keeps pip from resolving Sim's Core requirement again.
COPY pyproject.toml /engine/
RUN python -c "import tomllib; \
print(*[d for d in tomllib.load(open('/engine/pyproject.toml', 'rb'))['project']['dependencies'] \
if d not in ('dtcc-core', 'dtcc-sim')], sep='\n')" \
        > /engine/requirements.txt \
    && pip install --no-cache-dir -r /engine/requirements.txt
```

- [x] **Step 4: Build and run the tests**

Run: `pnpm engine:check`
Expected: the build passes the commit check, and 64 passed. Then run `docker compose --profile engine run --rm --no-deps engine python -c "from importlib.metadata import distribution; print([distribution(n).read_text('direct_url.json') for n in ('dtcc-core', 'dtcc-sim')])"`.
Expected: Core's `commit_id` is `2289d11f85049e13d5042e5cb3e5627c6568765f` and Sim's is `0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339`.

- [x] **Step 5: Amend the spec**

In `apps/engine/DESIGN.md`, under "Engine image", replace the bullet

```markdown
- The image installs pinned commits of Sim and the TetGen wrapper, supplied as
  build arguments. Core is installed at the commit that Sim pins, so Core and
  Sim remain a compatible pair. The build does not read the reference
  checkouts under `temp/`.
```

with

```markdown
- The image installs pinned commits of Core, Sim, and the TetGen wrapper,
  supplied as build arguments. Core's commit is the one that Sim's `uv.lock`
  records at Sim's pinned commit. Sim's package metadata asks for Core's
  `develop` branch, which pip would resolve to its head at build time, so the
  build installs Sim without its dependencies and fails unless the installed
  Core and Sim are the pinned commits. Taking Core's commit from Sim's lock
  file does not establish that the pair works; the checks run after a pin
  changes do. The build does not read the reference checkouts under `temp/`.
```

Under "Upstream inspection and implementation prerequisites", replace the first two rows of the revision table with

```markdown
| `dtcc-core`, from Sim's `uv.lock` | `2289d11f85049e13d5042e5cb3e5627c6568765f` |
| `dtcc-sim` | `0c9d1c4c9f00530a2ab89c82d8dfa6e17686a339` |
```

and replace item 3 of "Required upstream and integration work" with

```markdown
3. **Dependency alignment is established for the development image.** The
   image installs Sim at a pinned commit and Core at the commit that Sim's
   `uv.lock` records for it. To move the pins, choose a Sim commit; read the
   Core commit from its `uv.lock`; confirm that Sim's package metadata still
   declares no dependency other than Core, because Sim is installed without
   its dependencies; confirm that the Core commit is reachable from Core's
   `develop`, which shows only that it is reachable today; set both build
   arguments to full commit IDs; and re-verify the interfaces each increment
   relies on, running `pnpm engine:check`, `pnpm engine:check:prod`, and Sim's
   representative Datasets through the worker.
```

Run: `npx --yes prettier@3.9.6 --write apps/engine/DESIGN.md && npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 6: Validate**

Run: `pnpm engine:check:prod`, then `docker compose --project-name dtcc-twin-engine-prod --profile engine-prod run --rm --no-deps engine-prod python -c "from importlib.metadata import distribution; print([distribution(n).read_text('direct_url.json') for n in ('dtcc-core', 'dtcc-sim')])"`, then `pnpm check`.
Expected: the production checks pass with `engine-redis` in their own Compose project, `pip check` among them, and the token checks pass; the production image has the same two commit IDs as Step 4; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately.

- [x] **Step 7: Stop for review**

Record Task 15's results in Increment 2b's status, leave the changes uncommitted, and report Steps 2, 4, and 6.

### Task 16: Run Sim's simulations through the worker

**Files:**

- Create: `apps/engine/tests/test_simulation.py`
- Modify: `apps/engine/PLAN.md` (Increment 2b status)

**Interfaces:**

- Consumes:
  - From Task 15: an image with Core `2289d11` and Sim `0c9d1c4`.
  - From Tasks 10 to 14: `Jobs(redis_url, target, package_dir)`, `Jobs.submit`, `Jobs.status`, `Jobs.package_path`, `Jobs.celery_app`; the `redis_url` fixture in `conftest.py`; the API's job routes; the `engine-worker` service.
  - From Celery: `start_worker(app, pool="prefork", concurrency=1)`.
  - The DOLFINx and Core interfaces listed above.
- Produces: an automated check that a FEniCSx solve runs as a job in a prefork pool process; recorded runs of Sim's representative Datasets through the worker service. No API change.

- [x] **Step 1: Write the prefork test**

Create `apps/engine/tests/test_simulation.py`:

```python
"""Tests that a FEniCSx solve runs in the worker's prefork pool.

The worker service imports Sim, which initializes PETSc, before it forks its pool processes, and Sim's simulations run
in those forked processes. The Dataset here solves a small problem offline, so the test needs no downloaded city data.
The test has its own module so that no other test's worker thread is running in this process when the pool forks.
"""

import time
from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import pytest
import ufl
from celery.contrib.testing.worker import start_worker
from dolfinx import fem, mesh
from dolfinx.fem.petsc import LinearProblem
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, load_model_package, unregister
from dtcc_core.model import Field, VolumeMesh
from mpi4py import MPI

from dtcc_engine.jobs import Jobs

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]


def wait_for(condition: Callable[[], bool], timeout: float = 300.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline
        time.sleep(0.5)


@pytest.fixture
def fenicsx_dataset() -> Iterator[str]:
    """Register a Dataset that solves u - div(grad(u)) = 1 on the unit cube, whose exact solution is u = 1."""

    class FenicsxProbeArgs(DatasetBaseArgs):
        pass

    class FenicsxProbeDataset(DatasetDescriptor):
        name = "engine_fenicsx_probe"
        description = "Dataset defined by an Engine test that solves a small FEniCSx problem"
        ArgsModel = FenicsxProbeArgs

        def build(self, args):
            domain = mesh.create_unit_cube(MPI.COMM_WORLD, 2, 2, 2)
            space = fem.functionspace(domain, ("Lagrange", 1))
            trial, test = ufl.TrialFunction(space), ufl.TestFunction(space)
            problem = LinearProblem(
                (trial * test + ufl.inner(ufl.grad(trial), ufl.grad(test))) * ufl.dx,
                fem.Constant(domain, 1.0) * test * ufl.dx,
                petsc_options_prefix="engine_fenicsx_probe_",
                petsc_options={"ksp_type": "preonly", "pc_type": "lu"},
            )
            solution = problem.solve()
            # A first-order space has one degree of freedom per vertex, so its numbering serves as the mesh's.
            return VolumeMesh(
                vertices=space.tabulate_dof_coordinates(),
                cells=np.asarray(space.dofmap.list),
                fields=[Field(name="u", values=solution.x.array.copy(), association="vertex")],
            )

    try:
        yield "engine_fenicsx_probe"
    finally:
        unregister("engine_fenicsx_probe")


@pytest.fixture
def prefork_jobs(redis_url: str, tmp_path: Path, fenicsx_dataset: str) -> Iterator[Jobs]:
    """Jobs served by a one-process prefork worker."""
    jobs = Jobs(redis_url, "prefork-fenicsx", tmp_path)
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        yield jobs


def test_fenicsx_solve_runs_in_a_prefork_pool_process(prefork_jobs: Jobs, fenicsx_dataset: str) -> None:
    job_id = prefork_jobs.submit(fenicsx_dataset, {"bounds": BOUNDS})
    wait_for(lambda: prefork_jobs.status(job_id)["state"] in ("completed", "failed"))
    assert prefork_jobs.status(job_id)["state"] == "completed", prefork_jobs.status(job_id)
    [field] = load_model_package(prefork_jobs.package_path(job_id)).fields
    assert field.name == "u" and np.allclose(field.values, 1.0)
```

The test runs the solve in a pool process forked from a process that imported Sim and DOLFINx, as the worker service's pool processes are. The five-minute limit allows for compiling the forms into an empty cache under emulation; the run of 2026-10-01 took 6 s.

- [x] **Step 2: Run the test**

Run: `pnpm engine:check tests/test_simulation.py`
Expected: 1 passed. The test checks behavior that Engine already has, so it is expected to pass at once, as it did from outside the repository on 2026-10-01; it guards the fork that the worker service depends on. If it fails or times out, stop and report. Don't change the pool: other pools, such as `solo`, change concurrency and how the worker answers while a job runs, so they are evaluated in review rather than assumed.

- [x] **Step 3: Run Sim's Datasets through the worker service**

Start `pnpm dev:engine` in another terminal and wait for the API's health check and the worker's `ready` line, then run:

```sh
AUTH="Authorization: Bearer local-dev-engine-token"
submit() {
  curl -fsS -H "$AUTH" -H 'Content-Type: application/json' -d "$1" http://127.0.0.1:8000/api/v1/jobs \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["job_id"])'
}
BOX='[319891, 6399790, 320091, 6399990]'
MESH=$(submit "{\"dataset\": \"city_volume_mesh\", \"parameters\": {\"bounds\": $BOX}}")
HEAT=$(submit "{\"dataset\": \"urban_heat_simulation\", \"parameters\": {\"bounds\": $BOX}}")
WIND=$(submit "{\"dataset\": \"urban_wind_simulation\", \"parameters\": {\"bounds\": $BOX}}")
AIR=$(submit '{"dataset": "air_quality_field", "parameters": {"bounds": [319450, 6400200, 319650, 6400400], "z_offset": 10.13}}')
for JOB in $MESH $HEAT $WIND $AIR; do curl -fsS -H "$AUTH" http://127.0.0.1:8000/api/v1/jobs/$JOB; echo; done
```

Repeat the status loop until every job is `completed` or `failed`; the worker runs them one at a time, and the wind job takes about 11 minutes under emulation. While the wind job is `running`, run `docker compose --profile engine exec -T engine-worker /opt/conda/envs/engine/bin/celery --app dtcc_engine.worker inspect ping --timeout 10`. When all have finished, run:

```sh
for JOB in $MESH $HEAT $WIND $AIR; do
  curl -fsS -H "$AUTH" -o /tmp/$JOB.dtccpkg http://127.0.0.1:8000/api/v1/jobs/$JOB/package
  shasum -a 256 /tmp/$JOB.dtccpkg
  docker compose --profile engine exec -T engine sha256sum /var/lib/dtcc-engine/packages/$JOB.dtccpkg
  docker compose --profile engine exec -T engine /opt/conda/envs/engine/bin/python -c "
from dtcc_core.datasets import load_model_package
m = load_model_package('/var/lib/dtcc-engine/packages/$JOB.dtccpkg')
print(type(m).__name__, m.dataset_context.request.dataset_name, len(m.vertices),
      [(f.name, f.unit, f.dim, len(f.values)) for f in m.fields], m.dataset_context.request.parameters)"
done
```

Expected:

- `inspect ping` gets a `pong` from the worker while the wind job runs.
- Every job is `completed`, and each pair of SHA-256 digests matches.
- Each package loads as a `VolumeMesh` from the Dataset it was submitted to, and every field has one value per vertex: `city_volume_mesh` with no fields; `urban_heat_simulation` with `temperature` (`degC`, 1); `urban_wind_simulation` with `velocity` (`m/s`, 3), `pressure` (`m^2/s^2`, 1), and `speed` (`m/s`, 1); `air_quality_field` with `NO2` (`µg/m3`, 1), and `z_offset` 10.13 among its request parameters.

Record each job's duration, package size, and printed line. A job that fails because a data provider is unreachable or rate-limits is recorded with its error type, not retried. A simulation that fails here but succeeded in the evidence above, which ran it outside the pool, stops the task for review.

- [x] **Step 4: Validate**

Stop `pnpm dev:engine`. Run `pnpm engine:check`, `pnpm engine:check:prod`, and `pnpm check`.
Expected: 65 passed, the 64 earlier tests plus the new one; the production checks pass with `engine-redis` in their own Compose project, and the token checks pass; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately, including Step 3's outcomes.

- [x] **Step 5: Stop for review**

Record Task 16's results in Increment 2b's status, set the status to executed with the date, leave the changes uncommitted, and report Steps 2 to 4.

## Increment 3: Remote targets and delivery

Status: expansion started 2026-10-15. Task 25's review of 2026-10-15 asked for changes, which were made the same day; its second review, of 2026-10-15 and 2026-10-16, accepted it, and Step 6.5's wording was narrowed after it. The plan is committed in `2e6eb02`. Task 25 was executed 2026-10-16 and committed in `37c31f1`. Its results: with the tests written, `engine:check tests/test_discovery.py tests/test_targets.py` gave 25 failed and 30 passed in 121.6 s, each as Step 2 expects: `/api/v1/host` answered `404` where the four token cases expect `401` and the three host cases `200`, the 8 target identifiers and 6 image digests raised no `ValueError`, and the four worker cases ended in `TimeoutExpired` after 30 s. With the implementation, `engine:check` gave 159 passed in 72.6 s. `engine` and `engine-worker` were stopped and development Redis was running; database 0 held 5 job records, one claimed by `celery@engine-worker`, which had an outcome, so Step 6.1 listed none. With `pnpm dev:engine`, the worker's banner named `celery@local` and its queue `local`. A `smoke` job completed with the claim `celery@local c130156e67cc42d6b4e6678f4f64d594 32`. `/api/v1/host` answered target `local`, `image_digest` null, and the versions, catalog revision, and 28 Datasets of `/api/v1/datasets`, and `401` without the token. With `city_volume_mesh` `running`, a second worker exited with 1 after 5 s, having logged `Unrecoverable error: RuntimeError('Another running worker answers as celery@local, so this one does not start')`. The job was still `running` without a finish time when it had exited, so the attempt was conclusive; it completed after 115 s in the worker, and its 68,525-byte package downloaded. Under `celery@engine-worker`, a worker exited with 1, having logged that a worker of target `local` must run as `celery@local`; with `--queues other`, one exited with 1, having logged that it must consume only the queue `local`. The running worker logged no error; stopped, it logged a warm shutdown, and both containers exited with 0. Prettier passed for `compose.yaml`, `DESIGN.md`, and `PLAN.md`. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed. `pnpm check` failed once, on two backend e2e tests in `auth.e2e-spec.ts` that each log in twice and timed out at 5 s, at a load average of about 6; its rerun passed. Both reviews of the execution, of 2026-10-16, accepted it; the worker module's docstring now gives the launch command with `--hostname`, which Codex's review found missing. Task 26 was expanded on 2026-10-16; its first review asked for changes, which were made the same day, its second review asked for two more, to Step 6 and to wording, and its third for Step 6's stops to wait for the worker without a deadline; each was made the same day. Gemini's second and third reviews and Codex's fourth accepted it. The plan is committed in `9d423b1`. Task 26 was executed 2026-10-17. Its results: with the tests and the skeleton written, `engine:check tests/test_discovery.py tests/test_targets.py tests/test_hosts.py` gave 40 failed and 56 passed in 47.2 s, each as Step 2 expects: `/api/v1/targets` answered `404` where the four token cases expect `401` and the 11 listings `200`, the 17 remote-target values raised no `ValueError`, and the eight direct observations raised `NotImplementedError`. With the implementation, `engine:check` gave 200 passed in 129.6 s; the image has `requests` 2.34.2, and its dependency layers came from Docker's build cache, which the reviews' builds of the same `pyproject.toml` had filled. `engine` and `engine-worker` were stopped, having exited with 0 after Task 25, and the queue `local` was empty, so no job had to finish first. With `pnpm dev:engine`, the targets listed `local` `ready`, with no reason; `worker` with `image_digest` null, the versions of `/api/v1/datasets`, `job_limit` 1, `reserved` 0, and `queues` `["local"]`; `waiting` 0; and `host` with `image_digest` null and the versions, catalog revision, and 28 Dataset names of `/api/v1/datasets`, sorted, with `host_error` null; and `401` without the token. Step 6's two `celery` commands need the image's path, `/opt/conda/envs/engine/bin/celery`, as earlier tasks' do, because `exec` does not activate the environment; they were corrected. `inspect engine_worker` answered `celery@local` with the same `worker`. With `city_volume_mesh` `running` and `smoke` `queued` when they were read right after the listing, the target was `busy`, with `reserved` 1 and `waiting` 1, and the answer did not contain the bounds. `city_volume_mesh` then failed after 8 min 34 s, with `TimeoutError` in Core's lidar download: `compute.dtcc.chalmers.se:8000` sent a 74 MB lidar file to this machine at about 650 KB/s, and each of the download's four attempts timed out. Engine's code was not involved, and the busy listing stands, since the job was running when it was taken. `smoke` completed, and the target was then `ready`, with `reserved` and `waiting` 0. Stopped with `--timeout -1`, the worker logged a warm shutdown and exited with 0, and the target was `unknown`, with the reason "Its worker did not answer within 0.5 s", `worker` null, `waiting` 0, and `host` as before; started again, it was `ready`. Both containers were then stopped with `--timeout -1` and exited with 0; Redis kept running. Prettier passed for `DESIGN.md` and `PLAN.md`. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed. `pnpm check` passed. Both reviews of the execution, of 2026-10-17, accepted it, and it is committed in `666dc12`. Task 27 was expanded on 2026-10-17; its first review asked for one change, to the length a compressed package is forwarded with, which was made the same day, and Gemini's accepted it; both second reviews accepted the revision. The plan is committed in `551ee92`. Before its execution, on 2026-10-17, the image was set to start PETSc without its signal handlers, because Task 27's prototype found that they abort a process that writes to a dropped connection, and they also catch SIGTERM (Engine image in DESIGN.md). `test_write_to_a_closed_connection_raises_in_an_engine_process` pins it: written first, it failed with the process aborted, exit code 15; with the setting, `engine:check` gave 201 passed, `engine:check:prod` 19 passed with its token checks, and `pnpm check` passed. Task 27's plan was then brought up to date: its stub host writes without `MSG_NOSIGNAL`, and its note on PETSc describes the image with the setting. Tasks 28 to 31 are outlined under Expansion and are expanded one at a time. An expanded task is not an accepted one until review accepts it, and an accepted plan is not an executed task.

**Scope:** configured remote targets, automatic local-first routing, explicit targets, per-host job limits, all-hosts-busy queueing, the compute-targets operation (target identifiers, versions, local capabilities, observed availability), aggregated discovery at the entry service that reports target availability and includes remote-only capabilities without executing them locally, and package transfer from a remote Engine HTTP service to the entry service without a shared filesystem. Remote discovery and delivery use the shared token.

**Upstream interfaces:** Celery queue routing and worker concurrency; Celery's remote control, aimed at one worker's node name, to observe a target's worker; the same Engine discovery and delivery routes on each host. Packages are validated with `load_model_package` on the executing host before they become downloadable (increment 2a); the entry service streams a remote package through without validating or storing it, because `load_model_package` reads only local files and the spec requires no second stored copy at the entry host.

**Checks:** the Routing, Concurrency, and Remote execution rows of the acceptance table, with real Redis and at least two workers; the Generic discovery row across hosts; the Authentication row for remote discovery and delivery; host-local discovery does not query other hosts; downloading a remote package through the entry service leaves no copy of the archive on the entry host. Where several hosts change them, the Validation, Polling, Failure reporting, Cancellation, Package correctness, Retention, and Restart behavior rows too. A capability available only on a remote host because of its runtime conditions (for example credentials or data present only there), with every host running the same image digest, cannot be checked until Core reports such conditions (Blockers); on 2026-10-15 the user approved accepting the increment without that check, which runs once Core provides the interface.

**Blockers:** Core has no interface that reports whether a Dataset can run on a host (DESIGN.md, upstream item 6). Until it has, Engine reports each Dataset's runtime availability on each target as unknown ([dtcc-core#158](https://github.com/dtcc-platform/dtcc-core/issues/158)). Hosts are compared by platform-specific image digest, all hosts sharing one architecture, which the deployment supplies to each host's configuration; discovery's `versions` come from distribution metadata, and Git-installed Core and Sim report the same version across commits, so versions alone cannot establish compatibility.

### Expansion

**Expansion** (2026-10-15): the increment was proposed, reviewed, and decided with the user on 2026-10-15, and its tasks are expanded one at a time, each reviewed before it runs; a later task may change once the earlier ones are reviewed. Task 25's review found that Celery's `--queues` can make a worker consume another target's queue, which the naming check does not prevent; the revision of the same day makes the worker refuse any queue but its target's, describes the duplicate check as a best effort, starts test workers through one fixture that names them, and qualifies Step 6's check of a refusal during a running job. Verified on 2026-10-15:

- Celery 5.6.3 and Kombu 5.6.2: a broadcast inspection waits its full timeout after the answers, and one aimed at a node returns on that node's answer; each inspect method is a round trip of its own; `active` answers include each job's arguments; a job taken from the queue is reserved before it is active; Kombu keeps non-zero priorities in lists of their own, which its passive queue declaration counts and `LLEN` of the queue does not.
- On a connection from Celery's pool, after an inspection had timed out, the next one aimed at a running worker lost its answer in 20 of 40 calls; on a connection of its own, in none of 40. Without a timed-out call before them, 600 aimed pings lost none. The probes ran against one idle worker in a Compose project of their own. With a 0.1 s timeout, Task 25's review found 32 of 40 and 1 of 40: a connection of its own makes a lost answer rarer, not impossible. The second review traced the cause in Kombu's Redis transport: a wait that times out leaves its `BRPOP` pending on the connection, and the next call on that connection waits on it instead of on its own reply.
- Core `17c6efe` has no interface that says whether a Dataset can run on a host: `credential_env` is provenance metadata, and some credentials are request parameters.
- The production image has `requests` 2.34.2, through Core, and no `httpx`, whose absence a production check asserts.

**Decisions:**

- Identity: a target identifier names the target's queue and its worker's node, `celery@<target>`; the deployment supplies the host's image digest (Task 25).
- Observation: one call per target, aimed at its node name, to an inspect command that Engine's worker registers. It answers the worker's image digest, versions, job limit, reserved count, and consumed queues, never job arguments; the node name it is aimed at identifies the target (Task 26). Each call uses a broker connection of its own and a 0.5 s timeout; the waiting count comes from Kombu's passive queue declaration. A target that does not answer is unknown, not stopped; one whose worker does not consume exactly its target's queue is unavailable. No cache.
- Compatibility: the worker's reported image digest equals the entry's. A remote target needs both present; the local target is compared when both are set, so a development deployment without digests runs locally only.
- Routing: DESIGN.md's table, in which an unknown observation counts as unavailable.
- Delivery: each host serves its own packages through a host-local route that never forwards (Task 27). Status asks the owning host whether a completed remote job's package is available, and reports `null` when that host does not answer. The download streams from the owning host without asking for the status first, stores nothing at the entry, follows no redirects, and sends the shared token only to configured addresses. The HTTP client is `requests`, declared at 2.34.2.
- Execution environment: the claim records the worker's versions and image digest in fields of their own.
- Runtime availability: unknown until Core provides an interface (Blockers).

The tasks:

- Task 25: target identifiers, worker node names and their refusals, the image digest, and host-local discovery (Generic discovery and Authentication rows).
- Task 26: observing workers, and the compute-targets route, with the first tests across hosts: two Engine APIs, two workers in processes of their own, since Celery's reserved and active requests are kept per process, one Redis, and package directories of their own.
- Task 27: remote delivery: the host-local package route, package availability in status, and streaming downloads through the entry (Remote execution, Retention, and Authentication rows).
- Task 28: routing at submission, with explicit targets, rejections, and their status codes (Routing, Concurrency, and Validation rows).
- Task 29: recording the execution environment at claim.
- Task 30: aggregated discovery, with each Dataset's targets and their availability (Generic discovery row).
- Task 31: checks across two hosts in a Compose project of their own, and the baseline measurements.

### Task 25: Name each worker after its target, and report a host's own discovery

Later tasks find a target's worker by its node name and compare hosts by image digest, so this task fixes both. A target identifier gets a form that can name a Celery node. The worker runs as `celery@<target>` and consumes only its target's queue, and refuses to start otherwise, or while a running worker answers to its node name, which would fail the running worker's jobs as `WorkerRestarted` (Task 21). The deployment supplies the host's image digest, which a new route, host-local discovery, reports with the host's identifier, versions, and Datasets, without querying other hosts (Generic discovery and Authentication rows). The remote-target list, and observing other hosts' workers, come in Task 26.

**Interfaces verified for the task** (2026-10-15, in the development image's Celery 5.6.3 and Kombu 5.6.2 source, in a prototype, and in the review of 2026-10-15):

- Celery's configuration has no setting for a worker's node name. Its command line takes it from `--hostname`, which Click's environment prefix also reads from `CELERY_WORKER_HOSTNAME`; in Python, `WorkController` and `start_worker` take `hostname`, and `start_worker` otherwise names its worker `gen<process ID>@<host name>`.
- `--queues` replaces the queue a worker consumes, which is otherwise `task_default_queue`, the target's: `WorkController.setup_queues` selects them in `app.amqp.queues`, whose `consume_from` names them before any bootstep starts. The review ran a worker of target `other` with `--queues intended`: it ran a job of `intended` and kept its package on its own host. Celery starts its consumer step last, so a bootstep that raises stops the worker before it consumes.
- When a bootstep's `start` raises, `WorkController.start` logs `Unrecoverable error` and stops the worker with exit code 1. `start_worker`'s test worker instead waits for ever for a worker that never becomes ready, so tests start their workers through a fixture that names them, and the refusals are tested through Celery's command line.
- `app.control.ping(destination, timeout, connection=...)` returns a list of `{node: {"ok": "pong"}}`, empty when no answer came. Aimed at one node, it returns on that node's answer; its timeout bounds the wait for an answer, not the call, and a ping of an absent node with a 0.5 s timeout took 1.04 s in the review. On a connection from the app's pool, after an earlier call had timed out, a running worker's answer was lost in 20 of 40 calls in the prototype, and in 32 of 40 with a 0.1 s timeout in the review; on a connection of its own, in 0 of 40 and 1 of 40.
- With Redis unreachable, the ping raised Kombu's `OperationalError` after 6.1 s.

**Decisions** (proposed with the task, and revised after its review):

- A target identifier is lowercase letters and digits, in words joined by single hyphens, such as `local` or `remote-1`. It names the target's Celery queue and its worker's node, `celery@<identifier>`, which claims hold between spaces. `Jobs` refuses any other, so a malformed `ENGINE_TARGET` stops the API and the worker when they start. Every target name in the tests already has this form.
- `ENGINE_IMAGE_DIGEST` is the platform-specific digest of the image the host runs, which the deployment supplies: `sha256:` and 64 lowercase hexadecimal digits. Unset or empty, as in development, it means that there is none; a malformed one stops the API and the worker when they start. `Jobs` holds it, because the API reports it now and the worker from Task 26. A configured digest is the deployment's statement, not a check of the running image.
- A worker runs as `celery@<target>` and consumes only its target's queue. Celery cannot take the node name from Engine's configuration, so the deployment passes `--hostname celery@<target>`, and the worker refuses any other name rather than run where the entry service cannot find it. It also refuses to consume any queue but its target's: with `--queues`, it would run another target's jobs in its own environment and keep their packages where their owner cannot serve them. The checks are a new bootstep, `CheckWorker`, which `RecordLostClaims` now requires, so they run before the check of lost claims, the cleanup, and the consumer, and a refused worker fails and consumes nothing. A queue added later through Celery's remote control, `add_consumer`, is an operator's action that these checks cannot see; Task 26 reports a worker that does not consume exactly its target's queue as unavailable.
- `CheckWorker` also refuses to start while another running worker answers to the node name, since the two would fail each other's jobs as `WorkerRestarted`. This is a best effort against a duplicate that answers. It pings on a connection of its own, with `NODE_CHECK_TIMEOUT`, 0.5 s, as the wait for an answer, which every worker start now spends when none comes. A running worker whose answer is late or lost, two workers that start at once, or a broker error, which is logged, let a worker start, so a worker must still start only after its earlier run and that run's processes have stopped (Task 21). Failing open on a broker error keeps a worker started while Redis is down starting and waiting for it, as before.
- Host-local discovery is `GET /api/v1/host`: the host's target identifier, its image digest or null, and the listing of `GET /api/v1/datasets`, with the versions, the catalog revision, and the Datasets. It never queries another host, and does not show that the host's worker is ready or which image it runs. The two routes return the same listing until Task 30 makes `GET /api/v1/datasets` the aggregated view.
- The development worker moves from `celery@engine-worker`, its node name since Task 21, to `celery@local`. A job that a `celery@engine-worker` run claimed and left without an outcome would not be recognized when the worker starts again, and would report `running` until its record expires (Task 22), so Step 6 checks that development Redis holds no such job before the worker starts under its new name.
- Existing tests: tests start workers through a new session-scoped fixture, `start_target_worker`, which names each worker `celery@<target>` and passes on `start_worker`'s other options, so a test cannot leave the name out and wait for ever; it does not bound other hangs at start. `served_jobs`, both `prefork_jobs` fixtures, and the five tests that start a worker take it. The two restart tests' node names change from `celery@engine-test-restarted` and `celery@engine-test-restarted-after-export` to `celery@restarted` and `celery@restarted-after-export`, the names their workers now run as. The token test also covers `/api/v1/host`. No expectation changes.

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py`
- Create: `apps/engine/tests/test_targets.py`
- Modify: `apps/engine/tests/conftest.py`
- Modify: `apps/engine/tests/test_discovery.py`
- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `apps/engine/tests/test_simulation.py`
- Modify: `compose.yaml` (`engine-worker`)
- Modify: `apps/engine/DESIGN.md` (Routing and concurrency, Restart behavior)
- Modify: `apps/engine/PLAN.md` (Increment 3 status, increment 5b)

**Interfaces:**

- Consumes: from Tasks 3, 10, and 21, `dataset_catalog`, `require_token`, `create_app_from_environment`, `jobs_from_environment`, and the bootstep `RecordLostClaims`; the test fixture `redis_url`. From Celery: `bootsteps.StartStopStep` and its `requires`, `app.amqp.queues.consume_from`, `app.control.ping`, `app.connection_for_write`, `start_worker(..., hostname=...)`, and the `celery worker` command line.
- Produces: `TARGET_PATTERN`, `IMAGE_DIGEST_PATTERN`, and `NODE_CHECK_TIMEOUT`; `Jobs(redis_url, target, package_dir, image_digest=None)` and `Jobs.image_digest`; `Jobs.check_worker(node, queues)` and the worker bootstep `CheckWorker`; the setting `ENGINE_IMAGE_DIGEST`; the route `GET /api/v1/host`; the test fixture `start_target_worker`.

- [x] **Step 1: Write the tests**

In `apps/engine/tests/conftest.py`, replace `from collections.abc import Iterator` with `from collections.abc import Callable, Iterator`, add `from typing import Any` after `from pathlib import Path`, and replace the `served_jobs` fixture with:

```python
@pytest.fixture(scope="session")
def start_target_worker() -> Callable[..., Any]:
    """Start a Celery worker in this process for some jobs, as their target's node, with `start_worker`'s options.

    A worker refuses any other node name, and `start_worker` then waits for ever, so tests start workers through this.
    """

    def start(jobs: Jobs, **options: Any) -> Any:
        return start_worker(jobs.celery_app, hostname=f"celery@{jobs.target}", **options)

    return start


@pytest.fixture(scope="module")
def served_jobs(
    redis_url: str, tmp_path_factory: pytest.TempPathFactory, start_target_worker: Callable[..., Any]
) -> Iterator[Jobs]:
    """Jobs on a target served by a Celery worker in this process, which also runs test-defined Datasets."""
    served = Jobs(redis_url, "served", tmp_path_factory.mktemp("packages"))
    with start_target_worker(served):
        yield served
```

In `apps/engine/tests/test_redelivery.py`, remove `from celery.contrib.testing.worker import start_worker`; add `from typing import Any` after `from pathlib import Path`; replace each `start_worker(jobs.celery_app, pool="prefork", concurrency=1)`, and each `start_worker(jobs.celery_app, pool="prefork", concurrency=1, hostname=node)`, with `start_target_worker(jobs, pool="prefork", concurrency=1)`; replace `node = "celery@engine-test-restarted"` with `node = "celery@restarted"`, and `node = "celery@engine-test-restarted-after-export"` with `node = "celery@restarted-after-export"`; and give the fixture and the five tests that start a worker these signatures:

```python
def prefork_jobs(
    redis_url: str, tmp_path: Path, counting_dataset: str, start_target_worker: Callable[..., Any]
) -> Iterator[Jobs]:


def test_job_cancelled_before_a_worker_runs_never_runs(
    redis_url: str, tmp_path: Path, counting_dataset: str, start_target_worker: Callable[..., Any]
) -> None:


def test_worker_started_again_fails_the_jobs_its_earlier_run_left(
    redis_url: str, tmp_path: Path, counting_dataset: str, start_target_worker: Callable[..., Any]
) -> None:


def test_worker_deletes_the_packages_no_job_can_deliver(
    redis_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, start_target_worker: Callable[..., Any]
) -> None:


def test_worker_started_again_deletes_the_package_its_earlier_run_left(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:


def test_job_queued_while_no_worker_runs_runs_when_a_worker_starts(
    redis_url: str, tmp_path: Path, counting_dataset: str, start_target_worker: Callable[..., Any]
) -> None:
```

In `apps/engine/tests/test_simulation.py`, make the same changes to the imports and to the `prefork_jobs` fixture's `start_worker` call, and give the fixture this signature:

```python
def prefork_jobs(
    redis_url: str, tmp_path: Path, fenicsx_dataset: str, start_target_worker: Callable[..., Any]
) -> Iterator[Jobs]:
```

In `apps/engine/tests/test_discovery.py`, add `from pathlib import Path` after `import json`, separated by a line as now; replace the import from `dtcc_engine.api` with `from dtcc_engine.api import create_app, create_app_from_environment`; add `"/api/v1/host"` to the `path` parameters of `test_dataset_routes_reject_missing_or_invalid_tokens`; and add at the end of the file:

```python
@pytest.mark.parametrize(
    ("configured", "reported"),
    [(None, None), ("", None), ("sha256:" + "0123456789abcdef" * 4, "sha256:" + "0123456789abcdef" * 4)],
    ids=["unset", "empty", "set"],
)
def test_host_reports_its_target_image_digest_and_catalog(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, configured: str | None, reported: str | None
) -> None:
    for name, value in {
        "ENGINE_API_TOKEN": TOKEN,
        "ENGINE_REDIS_URL": redis_url,
        "ENGINE_TARGET": "this-host",
        "ENGINE_PACKAGE_DIR": str(tmp_path),
    }.items():
        monkeypatch.setenv(name, value)
    if configured is None:
        monkeypatch.delenv("ENGINE_IMAGE_DIGEST", raising=False)
    else:
        monkeypatch.setenv("ENGINE_IMAGE_DIGEST", configured)
    client = TestClient(create_app_from_environment())
    host = client.get("/api/v1/host", headers=AUTHORIZED)
    catalog = client.get("/api/v1/datasets", headers=AUTHORIZED).json()
    assert host.status_code == 200
    assert host.json() == {"target": "this-host", "image_digest": reported, **catalog}
```

Create `apps/engine/tests/test_targets.py`:

```python
"""Tests of a compute target's identity: its identifier, its image digest, and the node name and queue its worker uses.

The worker checks are run through Celery's command line, as the worker service runs it, because a worker that refuses
to start ends its process.
"""

import os
import subprocess
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from dtcc_engine.jobs import Jobs, jobs_from_environment, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]


def configure(monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str) -> None:
    monkeypatch.setenv("ENGINE_REDIS_URL", redis_url)
    monkeypatch.setenv("ENGINE_TARGET", target)
    monkeypatch.setenv("ENGINE_PACKAGE_DIR", str(tmp_path))


@pytest.mark.parametrize(
    "target",
    ["", "Local", "two words", "celery@local", "-local", "local-", "two--hyphens", "under_score"],
)
def test_target_identifier_that_cannot_name_a_node_is_refused(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, target)
    with pytest.raises(ValueError):
        jobs_from_environment()


@pytest.mark.parametrize(
    "digest",
    [
        "0123456789abcdef" * 4,
        "sha256:" + "0" * 63,
        "sha256:" + "0" * 65,
        "sha256:" + "ABCDEF0123456789" * 4,
        "sha512:" + "0" * 64,
        " sha256:" + "0" * 64,
    ],
    ids=["no-algorithm", "short", "long", "uppercase", "other-algorithm", "padded"],
)
def test_malformed_image_digest_is_refused(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, digest: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_IMAGE_DIGEST", digest)
    with pytest.raises(ValueError):
        jobs_from_environment()


def run_worker(
    redis_url: str, package_dir: Path, target: str, node: str, *options: str
) -> subprocess.CompletedProcess[str]:
    """Run the worker as the worker service does, as `node`; a worker that keeps running raises TimeoutExpired."""
    environment = {
        **os.environ,
        "ENGINE_REDIS_URL": redis_url,
        "ENGINE_TARGET": target,
        "ENGINE_PACKAGE_DIR": str(package_dir),
    }
    command = ["celery", "--app", "dtcc_engine.worker", "worker", "--hostname", node, "--pool", "solo", *options]
    return subprocess.run([sys.executable, "-m", *command], env=environment, capture_output=True, text=True, timeout=30)


def test_worker_refuses_a_node_name_other_than_its_targets(redis_url: str, tmp_path: Path) -> None:
    ended = run_worker(redis_url, tmp_path, "named", "celery@engine-worker")
    assert ended.returncode == 1
    assert "must run as celery@named, not celery@engine-worker" in ended.stderr


@pytest.mark.parametrize("queues", ["intended", "other,intended"])
def test_worker_refuses_a_queue_other_than_its_targets_and_runs_none_of_its_jobs(
    redis_url: str, tmp_path: Path, queues: str
) -> None:
    intended = Jobs(redis_url, "intended", tmp_path / "intended")
    job_id = intended.submit("smoke", {"bounds": BOUNDS})
    ended = run_worker(redis_url, tmp_path / "other", "other", "celery@other", "--queues", queues)
    assert ended.returncode == 1
    assert "must consume only the queue 'other'" in ended.stderr
    assert intended.status(job_id)["state"] == "queued"


def test_worker_refuses_the_node_name_of_a_running_worker_and_fails_none_of_its_jobs(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    running = Jobs(redis_url, "duplicated", tmp_path / "running")
    with start_target_worker(running):
        # A job the running worker claimed; a worker that started again as it would record its failure.
        job_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        claim = f"celery@duplicated {running.worker_run} {os.getpid()}"
        acceptance = {"dataset": "smoke", "target": "duplicated", "submitted_at": now, "queued_at": now}
        running.records.hset(
            record_key(job_id), mapping={**acceptance, "execution_gate": "started", "claimed_by": claim}
        )
        running.celery_app.backend.store_result(
            job_id, {"pid": os.getpid(), "hostname": "celery@duplicated"}, "STARTED"
        )
        ended = run_worker(redis_url, tmp_path / "starting", "duplicated", "celery@duplicated")
        job = running.status(job_id)
    assert ended.returncode == 1
    assert "Another running worker answers as celery@duplicated" in ended.stderr
    assert (job["state"], job["finished_at"]) == ("running", None)
```

- [x] **Step 2: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_discovery.py tests/test_targets.py`
Expected: 25 failed and 30 passed, in about two minutes. `/api/v1/host` answers `404` where the four token cases expect `401` and the three host cases `200`; the 8 target identifiers and 6 image digests raise no `ValueError`; and the four worker cases end in `TimeoutExpired` after 30 s, because the worker starts and keeps running. Stop and report if a test fails in another way.

- [x] **Step 3: Check targets, workers, and digests, and report the host**

In `apps/engine/dtcc_engine/jobs.py`, add `import re` after `import os`, and add after `CLEANUP_INTERVAL`:

```python
# A target's identifier also names its worker's node, celery@<identifier>, which claims hold between spaces.
TARGET_PATTERN = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
IMAGE_DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
# How long a starting worker waits for an answer from another running worker with its node name, once connected.
NODE_CHECK_TIMEOUT = 0.5
```

In `Jobs`'s docstring, replace the `target` and `package_dir` entries, and in `__init__`, the signature and the line `self.target = target`, so that they read, from the `target` entry to `self.image_digest = image_digest`:

```python
        target: Identifier of this compute target, lowercase letters and digits in words joined by single hyphens;
            its jobs use the Celery queue of that name, and its worker runs as `celery@<target>`.
        package_dir: Directory of completed packages, shared by this host's API and worker.
        image_digest: The platform-specific digest of the image this host runs, `sha256:` and 64 lowercase
            hexadecimal digits, if the deployment supplies it.

    Raises:
        ValueError: If the target identifier or the image digest is malformed.
    """

    def __init__(self, redis_url: str, target: str, package_dir: Path, image_digest: str | None = None) -> None:
        if not TARGET_PATTERN.fullmatch(target):
            raise ValueError(f"Target identifier {target!r} is not lowercase words joined by single hyphens")
        if image_digest is not None and not IMAGE_DIGEST_PATTERN.fullmatch(image_digest):
            raise ValueError(f"Image digest {image_digest!r} is not sha256: and 64 lowercase hexadecimal digits")
        self.target = target
        self.image_digest = image_digest
```

Replace the first two lines of the `RecordLostClaims` bootstep, its `class` line and its docstring, with:

```python
        class CheckWorker(bootsteps.StartStopStep):
            """Refuses to start a worker that would not run as this target's worker; see `Jobs.check_worker`."""

            def start(self, worker: Any) -> None:
                jobs.check_worker(worker.hostname, set(worker.app.amqp.queues.consume_from))

        self.celery_app.steps["worker"].add(CheckWorker)

        class RecordLostClaims(bootsteps.StartStopStep):
            """When the worker starts, records the failure of the jobs that an earlier run of it claimed and left."""

            # After the worker's check, so that a worker it refuses, such as a running worker's duplicate, fails no job.
            requires = {CheckWorker}
```

Add before `Jobs.record_lost_process`:

```python
    def check_worker(self, node: str, queues: set[str]) -> None:
        """Check that a worker may start: as `celery@<target>`, consuming only this target's queue.

        It also refuses a node name that another running worker answers to, as a best effort: a running worker whose
        answer is late or lost, or a broker error, which is logged, lets the worker start, as do two that start at once.

        Raises:
            ValueError: If `node` is not `celery@<target>`, or `queues` are not this target's queue alone.
            RuntimeError: If another running worker answers as `node`.
        """
        if node != f"celery@{self.target}":
            raise ValueError(f"A worker of target '{self.target}' must run as celery@{self.target}, not {node}")
        if queues != {self.target}:
            raise ValueError(
                f"A worker of target '{self.target}' must consume only the queue '{self.target}', not {sorted(queues)}"
            )
        try:
            # A connection of its own: on a pooled one, an earlier call that timed out can lose this answer.
            with self.celery_app.connection_for_write() as connection:
                answers = self.celery_app.control.ping([node], timeout=NODE_CHECK_TIMEOUT, connection=connection)
        except OperationalError:
            logger.warning("Could not check whether another running worker answers as %s", node, exc_info=True)
            return
        if answers:
            raise RuntimeError(f"Another running worker answers as {node}, so this one does not start")
```

Replace `jobs_from_environment` with:

```python
def jobs_from_environment() -> Jobs:
    """Create this host's jobs from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, `ENGINE_PACKAGE_DIR`, and the optional
    `ENGINE_IMAGE_DIGEST`, which, unset or empty, means that the deployment supplies no digest."""
    return Jobs(
        os.environ["ENGINE_REDIS_URL"],
        os.environ["ENGINE_TARGET"],
        Path(os.environ["ENGINE_PACKAGE_DIR"]),
        os.environ.get("ENGINE_IMAGE_DIGEST") or None,
    )
```

In `apps/engine/dtcc_engine/api.py`, add before the route `/api/v1/datasets/{name}`:

```python
    @app.get("/api/v1/host", dependencies=[Depends(require_token)])
    def describe_host() -> dict[str, Any]:
        # Host-local discovery, which must not query other hosts.
        return {"target": jobs.target, "image_digest": jobs.image_digest, **dataset_catalog()}
```

and in `create_app_from_environment`'s docstring, replace the `ValueError` entry with:

```python
        ValueError: If `ENGINE_API_TOKEN` is unset, empty, or not an RFC 6750 bearer token, or if `ENGINE_TARGET` or
            `ENGINE_IMAGE_DIGEST` is malformed.
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 159 passed: the 134 earlier tests and the 25 new cases.

- [x] **Step 5: Run the development worker under its target's node name, and document it**

In `compose.yaml`, in the `engine-worker` service, remove the `hostname` key and the comment above it, and replace `command` with:

```yaml
services:
  engine-worker:
    # The node name must be celery@ and ENGINE_TARGET; the worker refuses any other, and one that a running worker uses.
    command:
      [
        "celery",
        "--app",
        "dtcc_engine.worker",
        "worker",
        "--hostname",
        "celery@local",
        "--concurrency",
        "1",
        "--loglevel",
        "INFO",
      ]
```

In `apps/engine/DESIGN.md`, replace the first paragraph of Routing and concurrency with:

```markdown
Remote hosts are configured explicitly with stable target identifiers and their
Engine HTTP addresses. They do not register dynamically. Use a Celery queue for
each configured compute target. Each host's worker consumes only its designated
queue, refusing to start with any other, and enforces the configured
concurrent-job count.
```

and the second paragraph of Restart behavior, "Engine records a failure for a job whose claimant is gone ...", with:

```markdown
Engine records a failure for a job whose claimant is gone and can no longer
record an outcome. A job whose pool process is lost fails with
`WorkerLostError`, which Celery reports in the worker's main process. When a
worker starts, each job that an earlier run of the same worker claimed and left
without an outcome fails with `WorkerRestarted`. This needs each worker to run
as `celery@<target identifier>`, a node name that no other running worker uses,
and to start under it only after its earlier run and that run's processes have
stopped. A worker refuses to start under another node name. As a best effort,
it also refuses to start while a running worker answers to its node name; a
late or lost answer, a broker error, or two workers that start at once escape
that check, so it does not replace stopping the earlier run. Both checks come
before the worker checks any claim. A job whose worker is lost and not started
again keeps the state last recorded, as does a job whose lost process still
appears to exist, because Engine cannot tell whether the work stopped.
```

In this file, in increment 5b's Scope, replace "a stable Celery node name for each worker that no other running worker uses, under which a worker starts only after its earlier run stopped (Task 21);" with "each worker's Celery node name, `celery@<target identifier>`, passed with `--hostname`, under which a worker starts only after its earlier run stopped (Tasks 21 and 25); `ENGINE_IMAGE_DIGEST`, the platform-specific digest of the image each host runs;".

Run: `npx --yes prettier@3.9.6 --check compose.yaml apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 6: Move the development worker to its node name, and check the refusals through the worker service**

If `pnpm dev:engine` is running, let its running jobs finish, and stop it: `docker compose --profile engine stop engine engine-worker`. Start its Redis, if it is not running: `docker compose --profile engine up -d --wait engine-redis`. Then:

1. List the jobs that a `celery@engine-worker` run claimed and left without an outcome: `docker compose --profile engine exec -T engine-redis sh -c 'for key in $(redis-cli -n 0 --scan --pattern "dtcc-engine:job:*"); do echo "$key $(redis-cli -n 0 HGET "$key" claimed_by) outcome=$(redis-cli -n 0 HGET "$key" outcome)"; done' | grep " celery@engine-worker " | grep "outcome=$"`. Expected: no output. Stop and report any job listed: it would report `running` until its record expires. An error from the command is not an empty result: stop and report it.
2. Start `pnpm dev:engine`, and wait until the worker logs that it is ready. Expected: its banner names `celery@local`.
3. Submit `smoke` on `[319891, 6399790, 320091, 6399990]`, wait until it completes, and read its claim: `docker compose --profile engine exec -T engine-redis redis-cli -n 0 HGET dtcc-engine:job:<job ID> claimed_by`. Expected: `celery@local`, a worker run ID, and a process ID.
4. `curl -s -H "Authorization: Bearer local-dev-engine-token" http://127.0.0.1:8000/api/v1/host`. Expected: `target` `local`, `image_digest` null, and the versions, catalog revision, and Datasets of `/api/v1/datasets`. Without the token: `401`.
5. Submit `city_volume_mesh` on the same bounds, and wait until it is `running`. Start a second worker as the first: `docker compose --profile engine run --rm --no-deps -T engine-worker`. Expected: it exits with 1, having logged that another running worker answers as `celery@local`. Read the job's status as soon as it has exited. If the job is still `running` without a finish time, its claim was unfinished throughout the refusal, and the job then completes and its package downloads. If it had already completed, the attempt is inconclusive, not a failure: repeat it with another job. If it failed, for example with `WorkerRestarted`, was cancelled, or its status cannot be read, stop and find the cause instead.
6. Start a worker under the old node name: `docker compose --profile engine run --rm --no-deps -T engine-worker celery --app dtcc_engine.worker worker --hostname celery@engine-worker --concurrency 1`. Expected: it exits with 1, having logged that a worker of target `local` must run as `celery@local`.
7. Start a worker that consumes another queue: `docker compose --profile engine run --rm --no-deps -T engine-worker celery --app dtcc_engine.worker worker --hostname celery@local --queues other --concurrency 1`. Expected: it exits with 1, having logged that a worker of target `local` must consume only the queue `local`.

Stop `pnpm dev:engine`.

- [x] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [x] **Step 8: Stop for review**

Record Task 25's results in Increment 3's status, including Step 6's observations, leave the changes uncommitted, and report Steps 2, 4, 6, and 7. Suggested commit message: `Feature: Named engine workers after their targets and added host discovery`.

### Task 26: Observe each target's worker, and list the compute targets

Routing places a job by what each target's worker can take (Task 28), and consumers choose a target from the compute-targets operation, so this task observes workers and serves that operation. The entry service reads its remote targets from configuration. A worker answers an inspect command of Engine's with its image digest, versions, job limit, the jobs it holds, and the queues it consumes; the entry counts the jobs waiting in the target's queue and reports the target as ready, busy, unavailable, incompatible, or unknown. `GET /api/v1/targets` lists every configured target with that observation and its host-local discovery, read over HTTP from a remote host (List compute targets; the Authentication row). The tests across hosts start here: the remote host's API and each target's worker run in processes of their own, with one Redis and package directories of their own. Delivery, submission, and the Datasets' listing stay local until Tasks 27, 28, and 30.

**Interfaces verified for the task** (2026-10-16, in the development image's Celery 5.6.3, Kombu 5.6.2, and requests 2.34.2 source, and in a prototype in a Compose project of its own):

- Celery keeps one registry of remote control commands per process, `celery.worker.control.Panel`, to which `inspect_command(name=...)` adds a command. A worker calls a command with `state`, whose `app` is the worker's app and `consumer` its consumer. A command that raises, or one the worker does not have, is answered with `{"error": <the exception's repr>}`. Celery's command line runs a registered command: `celery --app dtcc_engine.worker inspect engine_worker --destination celery@local` printed the prototype's answer.
- `app.control.broadcast(command, destination=[node], reply=True, timeout=..., connection=...)` returns a list of `{node: answer}`; with one destination, it returns on that node's answer, as `ping` does (Task 25).
- With prefetch disabled, Celery's consumer takes a job only while `len(celery.worker.state.reserved_requests)` is below `getattr(controller, "max_concurrency", None) or pool.num_processes` (`celery/worker/consumer/tasks.py`). `reserved_requests` is a module-level set, so it is kept per process, and holds a job from its receipt until it is done, including while it runs. Celery's `active_queues` reads `consumer.task_consumer.queues`, which `add_consumer` and `cancel_consumer` change after they answer.
- Kombu's Redis channel answers `queue_declare(queue, passive=True)` with the sum of the lengths of the queue's lists, one per priority, and raises `ChannelError` when none exists, as for an empty queue. In the prototype, a queue holding one job and one of priority 5 had an `LLEN` of 1 and a declared count of 2. Kombu prefixes broadcasts with the Redis database number (`fanout_prefix`), so an observation in the tests' database 1 does not reach the development worker on database 0.
- In the prototype, an observation of a running worker took 0.01 s, and of a target without a worker 1.04 s, with a 0.5 s timeout; with Redis unreachable, it raised `OperationalError` after 6 s. A two-process worker was ready while idle and while it held one job, and busy while it held two; a third job was counted waiting, and with a fourth of priority 5, two were. `add_consumer` and `cancel_consumer` changed a worker's queues. Two worker processes answered 5.1 s after they started, and an API process 2.1 s after; its `GET /api/v1/host` took 0.05 s and returned 105 KB.
- `requests.get(..., allow_redirects=False)` returns a redirect as the response without requesting its location; `requests.RequestException` covers failed connections and timeouts; `Response.json()` raises a `ValueError` for a body that is not JSON. `requests` 2.34.2 is installed through Core. With its default `trust_env`, a request without authentication of its own takes a `.netrc` entry's credentials for the host, which replace an `Authorization` header it was given (`Session.prepare_request`); a callable passed as `auth` is its own authentication. With redirects not followed, requests still prepares the redirect's request, without sending it, and that preparation can read `.netrc` for its location; the second review found this. A connection's timeout and each read's are separate, and neither bounds the whole request. The review of 2026-10-16 found both.
- `urllib.parse.urlsplit` raises a `ValueError` that repeats the address for some malformed hosts, for example `netloc 'user:secret@exa／mple.test' contains invalid characters under NFKC normalization` or `'secret' does not appear to be an IPv4 or IPv6 address`, and `SplitResult.port` one that repeats a malformed port.

**Decisions** (proposed with the task):

- Remote targets: `ENGINE_REMOTE_TARGETS` holds `<identifier>=<address>` entries separated by commas, in placement order; unset or empty, there are none. An identifier has Task 25's form, is not the local one, and appears once. An address is the base URL of the target's Engine HTTP service: `http` or `https`, a host, and an optional port and path, without credentials, a query, or a fragment, because the shared token is the only credential Engine sends. A trailing `?` or `#` is refused too: the route's path would follow it as the query or fragment. Any other value stops the API when it starts, with an error that may name the identifier but never repeats an address: the parser's own errors, which can, are replaced, not chained. The worker does not read the list.
- Observation: `Jobs.observe(target)` counts the waiting jobs by Kombu's passive queue declaration on a broker connection of its own, then sends Engine's inspect command, `engine_worker`, to `celery@<target>` on the same connection and waits `OBSERVATION_TIMEOUT`, 0.5 s, for the answer. Counting first means that a job the worker takes from the queue in between is counted twice rather than missed, so that race errs towards busy. The worker answers with its image digest, versions, job limit, which is the limit Celery applies with prefetch disabled, the count of jobs it holds, and the queues it consumes, never with a job's arguments. The increment's decision also listed the worker's target; the node name the command is aimed at identifies it, and the worker checked that name when it started (Task 25), so the answer leaves it out. Celery registers commands per process, not per app, so the command finds the worker's `Jobs` through its Celery app.
- States, checked in this order: `unknown` if the broker does not answer, the worker does not answer within the timeout, or its answer is malformed, as a worker without the command answers; `unavailable` if the worker does not consume exactly its target's queue; `incompatible` if its image digest does not match; `ready` if it holds fewer jobs than its limit and none wait in its queue; `busy` otherwise. Unknown does not say that the worker stopped. Every state but ready and busy has a reason. There is no cache: each call observes again.
- Compatibility: a remote target's worker must report the entry's digest, and both must be set; the local target's worker is compared when both are set, so a development deployment without digests runs locally only.
- `GET /api/v1/targets` lists the local target, then the remote ones in configured order. Each has its observation and its host-local discovery without the Datasets' descriptions: the image digest, versions, catalog revision, and the Datasets' names. The local host's is read in the process. A remote host's is read from its `GET /api/v1/host` with the shared token as the request's own authentication, so that requests sends no `.netrc` credentials in its place, with `HOST_TIMEOUT`, 5 s, as the timeout to connect and for each read, and with no redirects; the environment's proxy and CA settings still apply. if the host cannot be reached, rejects the token, answers another status, answers with a malformed body, or answers as another target, `host` is null and `host_error` says which, without the host's body. The state comes from the worker alone: a host whose HTTP service answers is not thereby ready, and a ready worker is not made unavailable by its host's HTTP service. Targets are read one after another. A stopped remote host costs about 1 s for its worker, and for its HTTP service as long as its connection takes to fail: when the host does not refuse it, `HOST_TIMEOUT` for each address its name resolves to, after a name resolution that no setting bounds. A host that answers slowly can take longer, because no setting bounds the whole request or the route. Task 31 measures them.
- The HTTP client is `requests`, which Core already installs, now declared in Engine's dependencies at 2.34.2. The image installs `pyproject.toml`'s dependencies with pip, so no conda lock changes, but the image is rebuilt from that step on.
- Submission still accepts only the local target until routing (Task 28). Its refusal no longer says that another target is not configured, which a configured remote target would contradict. The test that pins the refusal checks only that it names the target, and is unchanged.
- The tests across hosts, `tests/test_hosts.py`, run each target's worker in a process of its own through Celery's command line, as the worker service does, because Celery keeps reserved jobs per process, and the remote host's API through Uvicorn on a free local port. The entry's API is the test's client, which reaches the remote one over HTTP. Both hosts use the tests' Redis, and each has a package directory of its own. The workers' module, `tests/target_worker.py`, adds a Dataset that runs until a test releases it. What one idle worker shows, its digest, its queues, and a missing or malformed answer, is observed with the in-process workers of `start_target_worker`.

**Files:**

- Create: `apps/engine/tests/target_worker.py`
- Create: `apps/engine/tests/test_hosts.py`
- Modify: `apps/engine/tests/test_targets.py`
- Modify: `apps/engine/tests/test_discovery.py`
- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py`
- Modify: `apps/engine/pyproject.toml`
- Modify: `apps/engine/DESIGN.md` (Routing and concurrency, Deployment and authentication)
- Modify: `apps/engine/PLAN.md` (Increment 3 status, increment 5b)

**Interfaces:**

- Consumes: from Task 25, `TARGET_PATTERN`, `Jobs.image_digest`, worker node names `celery@<target>`, `GET /api/v1/host`, and the test fixture `start_target_worker`; from Tasks 3 and 10, `dataset_catalog`, `installed_versions`, `create_app`, and `create_app_from_environment`. From Celery: `inspect_command`, `app.control.broadcast`, `add_consumer`, `cancel_consumer`, and `celery.worker.state.reserved_requests`; from Kombu: `queue_declare(passive=True)` and `ChannelError`; from requests: `requests.get`.
- Produces: `OBSERVATION_TIMEOUT`, `DESCRIBE_WORKER`, the worker's inspect command `engine_worker`, and `Jobs.observe(target)`; `installed_versions`, moved to `jobs.py`; `HOST_TIMEOUT`, `parse_remote_targets`, and `create_app(api_token, jobs, remote_targets=None)`; the setting `ENGINE_REMOTE_TARGETS`; the route `GET /api/v1/targets`; in `tests/test_hosts.py`, the fixtures `run_worker_process`, `run_api_process`, and `hosts`; the workers' test module `tests/target_worker.py`.

- [x] **Step 1: Write the tests, and a skeleton**

As a skeleton for the tests, in `apps/engine/dtcc_engine/api.py`, replace `def create_app(api_token: str, jobs: Jobs) -> FastAPI:` with:

```python
def create_app(api_token: str, jobs: Jobs, remote_targets: dict[str, str] | None = None) -> FastAPI:
```

and in `apps/engine/dtcc_engine/jobs.py`, add after `Jobs.check_worker`:

```python
    def observe(self, target: str) -> dict[str, Any]:
        raise NotImplementedError

```

Create `apps/engine/tests/target_worker.py`:

```python
"""The worker service's Celery app with a test Dataset, for workers that tests start in processes of their own.

The Dataset, `engine_held_probe`, holds its job until the Redis key it names exists.
"""

import os
import time

import numpy as np
import redis
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor
from dtcc_core.model import Mesh

from dtcc_engine.worker import celery_app  # noqa: F401  The app that Celery's command line finds.


class HeldProbeArgs(DatasetBaseArgs):
    release_key: str


class HeldProbeDataset(DatasetDescriptor):
    name = "engine_held_probe"
    description = "Dataset defined by an Engine test that runs until a test releases it"
    ArgsModel = HeldProbeArgs

    def build(self, args):
        client = redis.Redis.from_url(os.environ["ENGINE_REDIS_URL"])
        while not client.exists(args.release_key):
            time.sleep(0.1)
        return Mesh(vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]]))
```

In `apps/engine/tests/test_targets.py`, replace the docstring's first line with:

```python
"""Tests of compute targets: each target's identifier, image digest, and the node name and queue its worker uses; the
remote targets of the entry service; and the observation of a target's worker.
```

Add `import time` and `import traceback` after `import sys`. Replace the lines from `import pytest` to `BOUNDS` with:

```python
import pytest
from celery.worker.control import Panel
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app_from_environment
from dtcc_engine.jobs import Jobs, jobs_from_environment, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
DIGEST = "sha256:" + "0123456789abcdef" * 4
OTHER_DIGEST = "sha256:" + "fedcba9876543210" * 4
```

Add before `configure`:

```python
def observe_until(jobs: Jobs, target: str, condition: Callable[[dict[str, Any]], bool]) -> dict[str, Any]:
    """Observe a target until the observation meets the condition, and return that observation."""
    deadline = time.monotonic() + 30
    while not condition(observed := jobs.observe(target)):
        assert time.monotonic() < deadline, observed
        time.sleep(0.1)
    return observed


```

and add at the end of the file:

```python


@pytest.mark.parametrize(
    "remote_targets",
    [
        "remote",
        "remote=",
        "Remote=http://127.0.0.1:9",
        "remote=http://127.0.0.1:9,",
        "local=http://127.0.0.1:9",
        "remote=http://127.0.0.1:9,remote=http://127.0.0.1:10",
        "remote=127.0.0.1:9",
        "remote=ftp://127.0.0.1:9",
        "remote=http://",
        "remote=http://127.0.0.1:secret",
        "remote=http://engine:secret@exa\uff0fmple.test",
        "remote=http://[secret]",
        "remote=http://engine:secret@127.0.0.1:9",
        "remote=http://127.0.0.1:9?token=secret",
        "remote=http://127.0.0.1:9#secret",
        "remote=http://127.0.0.1:9?",
        "remote=http://127.0.0.1:9#",
    ],
    ids=[
        "no-address",
        "empty-address",
        "malformed-identifier",
        "empty-entry",
        "local-identifier",
        "repeated-identifier",
        "no-scheme",
        "other-scheme",
        "no-host",
        "malformed-port",
        "host-invalid-after-normalization",
        "bracketed-host-not-an-address",
        "credentials",
        "query",
        "fragment",
        "empty-query",
        "empty-fragment",
    ],
)
def test_remote_targets_that_cannot_be_used_are_refused_without_repeating_their_addresses(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, remote_targets: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_API_TOKEN", "test-token")
    monkeypatch.setenv("ENGINE_REMOTE_TARGETS", remote_targets)
    with pytest.raises(ValueError) as refused:
        create_app_from_environment()
    # What the API logs when it refuses to start: the error, and any error it was raised from.
    assert "secret" not in "".join(traceback.format_exception(refused.value))


@pytest.mark.parametrize(
    ("remote_targets", "listed"),
    [
        (None, ["local"]),
        ("", ["local"]),
        ("second=http://127.0.0.1:9,first=https://127.0.0.1:9/engine/", ["local", "second", "first"]),
    ],
    ids=["unset", "empty", "two"],
)
def test_targets_are_listed_local_first_then_in_configured_order(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, remote_targets: str | None, listed: list[str]
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_API_TOKEN", "test-token")
    if remote_targets is None:
        monkeypatch.delenv("ENGINE_REMOTE_TARGETS", raising=False)
    else:
        monkeypatch.setenv("ENGINE_REMOTE_TARGETS", remote_targets)
    client = TestClient(create_app_from_environment())
    response = client.get("/api/v1/targets", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert [target["target"] for target in response.json()["targets"]] == listed


def test_target_whose_worker_does_not_answer_is_unknown(redis_url: str, tmp_path: Path) -> None:
    jobs = Jobs(redis_url, "absent", tmp_path)
    jobs.submit("smoke", {"bounds": BOUNDS})
    assert jobs.observe("absent") == {
        "state": "unknown",
        "reason": "Its worker did not answer within 0.5 s",
        "worker": None,
        "waiting": 1,
    }


def test_target_is_unknown_while_the_broker_does_not_answer(tmp_path: Path) -> None:
    jobs = Jobs("redis://127.0.0.1:1/0", "unreachable", tmp_path)
    assert jobs.observe("unreachable") == {
        "state": "unknown",
        "reason": "The broker did not answer",
        "worker": None,
        "waiting": None,
    }


def test_worker_without_engines_inspect_command_is_unknown(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    # As a worker of an Engine without the command would, it answers with an error.
    monkeypatch.delitem(Panel.data, "engine_worker", raising=False)
    jobs = Jobs(redis_url, "commandless", tmp_path)
    with start_target_worker(jobs):
        observed = jobs.observe("commandless")
    assert observed == {"state": "unknown", "reason": "Its worker's answer is malformed", "worker": None, "waiting": 0}


@pytest.mark.parametrize("change", ["added", "cancelled"])
def test_worker_that_does_not_consume_exactly_its_queue_is_unavailable(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any], change: str
) -> None:
    jobs = Jobs(redis_url, "requeued", tmp_path)
    control = jobs.celery_app.control
    with start_target_worker(jobs):
        if change == "added":
            control.add_consumer("extra", destination=["celery@requeued"], reply=True)
        else:
            control.cancel_consumer("requeued", destination=["celery@requeued"], reply=True)
        # The worker changes its queues after it answers, and a late answer leaves the worker unknown for the moment.
        observed = observe_until(
            jobs,
            "requeued",
            lambda observed: observed["worker"] is not None and observed["worker"]["queues"] != ["requeued"],
        )
    assert observed["state"] == "unavailable"
    assert observed["reason"] == "Its worker does not consume exactly the queue 'requeued'"
    assert observed["worker"]["queues"] == (["extra", "requeued"] if change == "added" else [])


@pytest.mark.parametrize(
    ("worker_digest", "expected"),
    [
        (
            DIGEST,
            {
                ("local", DIGEST): "ready",
                ("local", None): "ready",
                ("remote", DIGEST): "ready",
                ("remote", None): "incompatible",
            },
        ),
        (
            OTHER_DIGEST,
            {
                ("local", DIGEST): "incompatible",
                ("local", None): "ready",
                ("remote", DIGEST): "incompatible",
                ("remote", None): "incompatible",
            },
        ),
        (
            None,
            {
                ("local", DIGEST): "ready",
                ("local", None): "ready",
                ("remote", DIGEST): "incompatible",
                ("remote", None): "incompatible",
            },
        ),
    ],
    ids=["same-digest", "other-digest", "no-digest"],
)
def test_worker_is_compatible_when_its_image_digest_matches_this_hosts(
    redis_url: str,
    tmp_path: Path,
    start_target_worker: Callable[..., Any],
    worker_digest: str | None,
    expected: dict[tuple[str, str | None], str],
) -> None:
    worker = Jobs(redis_url, "compared", tmp_path, worker_digest)
    with start_target_worker(worker):
        observed = {
            # A late answer leaves the worker unknown for the moment.
            (role, digest): observe_until(
                Jobs(redis_url, "compared" if role == "local" else "comparing", tmp_path, digest),
                "compared",
                lambda observed: observed["state"] != "unknown",
            )
            for role, digest in expected
        }
    assert {key: observation["state"] for key, observation in observed.items()} == expected
    for observation in observed.values():
        assert observation["worker"]["image_digest"] == worker_digest
        if observation["state"] == "incompatible":
            assert observation["reason"] == "Its worker's image digest is missing or differs from this host's"
```

In `apps/engine/tests/test_discovery.py`, add `"/api/v1/targets"` to the paths of `test_dataset_routes_reject_missing_or_invalid_tokens`:

```python
@pytest.mark.parametrize("path", ["/api/v1/datasets", "/api/v1/datasets/buildings", "/api/v1/host", "/api/v1/targets"])
```

Create `apps/engine/tests/test_hosts.py`:

```python
"""Tests across hosts: the entry service and a remote host, one Redis, and package directories of their own.

Each target's worker runs in a process of its own, as the worker service does, because Celery keeps a worker's reserved
and active jobs per process. The remote host's API also runs in a process of its own, and the entry's API reaches it
over HTTP, as it would another host.
"""

import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import requests
from celery import Celery
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app, dataset_catalog, installed_versions
from dtcc_engine.jobs import Jobs

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
DIGEST = "sha256:" + "0123456789abcdef" * 4


def wait_for(condition: Callable[[], bool], timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline
        time.sleep(0.2)


def answers(app: Celery, node: str) -> bool:
    with app.connection_for_write() as connection:
        return bool(app.control.ping([node], timeout=0.5, connection=connection))


@pytest.fixture(scope="module")
def run_worker_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's worker in a process of its own until the context ends, as the worker service runs it.

    The worker also runs `engine_held_probe` (`target_worker.py`). Its log is in a temporary directory, which a failure
    to start reports.
    """
    logs = tmp_path_factory.mktemp("worker-logs")
    app = Celery(broker=redis_url, set_as_current=False)

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None) -> Iterator[None]:
        environment = {
            **os.environ,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
            "PYTHONPATH": str(Path(__file__).parent),
        }
        command = ["celery", "--app", "target_worker", "worker", "--hostname", f"celery@{target}", "--concurrency", "1"]
        log = logs / f"{target}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        try:
            deadline = time.monotonic() + 120
            while not answers(app, f"celery@{target}"):
                assert process.poll() is None and time.monotonic() < deadline, log.read_text()
            yield
        finally:
            process.terminate()
            process.wait(timeout=60)

    return run


@pytest.fixture(scope="module")
def run_api_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's Engine API in a process of its own on a free local port until the context ends; yield its address.

    Its log is in a temporary directory, which a failure to start reports.
    """
    logs = tmp_path_factory.mktemp("api-logs")

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None) -> Iterator[str]:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = {
            **os.environ,
            "ENGINE_API_TOKEN": TOKEN,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
        }
        command = ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--port", str(port)]
        log = logs / f"{target}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        address = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 120
            while True:
                try:
                    requests.get(f"{address}/api/v1/health", timeout=1).raise_for_status()
                    break
                except requests.RequestException:
                    assert process.poll() is None and time.monotonic() < deadline, log.read_text()
                    time.sleep(0.2)
            yield address
        finally:
            process.terminate()
            process.wait(timeout=60)

    return run


@pytest.fixture(scope="module")
def hosts(
    redis_url: str,
    tmp_path_factory: pytest.TempPathFactory,
    run_worker_process: Callable[..., AbstractContextManager[None]],
    run_api_process: Callable[..., AbstractContextManager[str]],
) -> Iterator[dict[str, Any]]:
    """The entry host, target `entry`, and a remote host, target `remote`, each with its worker, in one deployment.

    Yields the remote host's address and each target's jobs; the entry's are its API's.
    """
    entry_packages, remote_packages = tmp_path_factory.mktemp("entry"), tmp_path_factory.mktemp("remote")
    with (
        run_worker_process("entry", entry_packages, DIGEST),
        run_worker_process("remote", remote_packages, DIGEST),
        run_api_process("remote", remote_packages, DIGEST) as remote_address,
    ):
        yield {
            "remote_address": remote_address,
            "entry": Jobs(redis_url, "entry", entry_packages, DIGEST),
            "remote": Jobs(redis_url, "remote", remote_packages, DIGEST),
        }


def list_targets(entry: Jobs, remote_targets: dict[str, str], token: str = TOKEN) -> dict[str, dict[str, Any]]:
    """List the compute targets through an entry API with these remote targets, by identifier."""
    response = TestClient(create_app(token, entry, remote_targets)).get(
        "/api/v1/targets", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    return {target.pop("target"): target for target in response.json()["targets"]}


def wait_for_targets(
    entry: Jobs,
    remote_targets: dict[str, str],
    condition: Callable[[dict[str, dict[str, Any]]], bool],
    token: str = TOKEN,
) -> dict[str, dict[str, Any]]:
    """List the compute targets until the listing meets the condition, and return that listing.

    A late answer leaves a worker unknown for the moment, so a condition that needs a worker's answer waits it out.
    """
    deadline = time.monotonic() + 120
    while not condition(listed := list_targets(entry, remote_targets, token)):
        assert time.monotonic() < deadline, listed
        time.sleep(0.2)
    return listed


def known(listed: dict[str, dict[str, Any]]) -> bool:
    return all(target["state"] != "unknown" for target in listed.values())


def test_targets_report_each_hosts_discovery_and_its_workers_own_answer(hosts: dict[str, Any]) -> None:
    targets = wait_for_targets(hosts["entry"], {"remote": hosts["remote_address"]}, known)
    catalog = dataset_catalog()
    host = {
        "image_digest": DIGEST,
        "versions": installed_versions(),
        "catalog_revision": catalog["catalog_revision"],
        "datasets": sorted(catalog["datasets"]),
    }
    assert list(targets) == ["entry", "remote"]
    for target, listed in targets.items():
        assert listed == {
            "state": "ready",
            "reason": None,
            "worker": {
                "image_digest": DIGEST,
                "versions": installed_versions(),
                "job_limit": 1,
                "reserved": 0,
                "queues": [target],
            },
            "waiting": 0,
            "host": host,
            "host_error": None,
        }


def test_target_whose_worker_holds_its_limit_or_has_jobs_waiting_is_busy(hosts: dict[str, Any]) -> None:
    entry, remote = hosts["entry"], hosts["remote"]
    remote_targets = {"remote": hosts["remote_address"]}
    release = f"engine-test:release:{uuid.uuid4()}"
    parameters = {"bounds": BOUNDS, "release_key": release}
    try:
        held = remote.submit("engine_held_probe", parameters)
        holding = wait_for_targets(
            entry, remote_targets, lambda listed: known(listed) and listed["remote"]["worker"]["reserved"] == 1
        )
        waiting = remote.submit("engine_held_probe", parameters)
        holding_and_waiting = wait_for_targets(
            entry, remote_targets, lambda listed: known(listed) and listed["remote"]["waiting"] == 1
        )
    finally:
        remote.records.set(release, 1)
    wait_for(lambda: all(remote.status(job_id)["state"] == "completed" for job_id in (held, waiting)))
    wait_for_targets(entry, remote_targets, lambda listed: listed["remote"]["state"] == "ready")
    for listed, expected_waiting in ((holding, 0), (holding_and_waiting, 1)):
        assert listed["entry"]["state"] == "ready"
        assert listed["remote"]["state"] == "busy"
        assert listed["remote"]["worker"]["reserved"] == 1
        assert listed["remote"]["waiting"] == expected_waiting
        # The answer counts jobs and never repeats their arguments.
        assert set(listed["remote"]["worker"]) == {"image_digest", "versions", "job_limit", "reserved", "queues"}
        assert release not in str(listed)


def test_target_whose_api_answers_but_whose_worker_does_not_is_unknown(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    with run_api_process("workerless", tmp_path) as address:
        listed = list_targets(Jobs(redis_url, "observing", tmp_path), {"workerless": address})["workerless"]
    assert listed["host"] is not None and listed["host_error"] is None
    assert (listed["state"], listed["worker"]) == ("unknown", None)


def closed_address() -> str:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{probe.getsockname()[1]}"


@pytest.mark.parametrize(
    ("identifier", "address", "token", "host_error"),
    [
        ("remote", "closed", TOKEN, "The host could not be reached"),
        ("remote", "remote", "other-token", "The host rejected the token"),
        ("elsewhere", "remote", TOKEN, "The host answers as another target"),
    ],
    ids=["unreachable", "rejected-token", "other-target"],
)
def test_host_whose_discovery_cannot_be_read_is_reported_with_the_reason(
    hosts: dict[str, Any], identifier: str, address: str, token: str, host_error: str
) -> None:
    configured = closed_address() if address == "closed" else hosts["remote_address"]
    # The worker is observed through the broker, whatever its host's HTTP service answers.
    state = "ready" if identifier == "remote" else "unknown"
    listed = wait_for_targets(
        hosts["entry"],
        {identifier: configured},
        lambda listed: state == "unknown" or listed[identifier]["state"] != "unknown",
        token,
    )[identifier]
    assert (listed["host"], listed["host_error"]) == (None, host_error)
    assert listed["state"] == state


@pytest.fixture
def redirecting_host() -> Iterator[tuple[str, list[tuple[str, str | None]]]]:
    """A host that records each request's path and authorization, and redirects it to another path of its own."""
    received: list[tuple[str, str | None]] = []

    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            received.append((self.path, self.headers.get("Authorization")))
            self.send_response(307)
            self.send_header("Location", "/elsewhere")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", received
    finally:
        server.shutdown()
        server.server_close()


def test_host_local_discovery_queries_no_other_host(
    redis_url: str, tmp_path: Path, redirecting_host: tuple[str, list[tuple[str, str | None]]]
) -> None:
    address, received = redirecting_host
    client = TestClient(create_app(TOKEN, Jobs(redis_url, "querying", tmp_path), {"recording": address}))
    assert client.get("/api/v1/host", headers=AUTHORIZED).status_code == 200
    assert client.get("/api/v1/datasets", headers=AUTHORIZED).status_code == 200
    assert received == []


def test_redirect_from_a_host_is_not_followed(
    redis_url: str, tmp_path: Path, redirecting_host: tuple[str, list[tuple[str, str | None]]]
) -> None:
    address, received = redirecting_host
    listed = list_targets(Jobs(redis_url, "redirected", tmp_path), {"redirecting": address})["redirecting"]
    assert (listed["host"], listed["host_error"]) == (None, "The host answered HTTP 307")
    assert received == [("/api/v1/host", f"Bearer {TOKEN}")]


def test_host_is_sent_the_shared_token_and_no_other_credential(
    monkeypatch: pytest.MonkeyPatch,
    redis_url: str,
    tmp_path: Path,
    redirecting_host: tuple[str, list[tuple[str, str | None]]],
) -> None:
    address, received = redirecting_host
    # Credentials that requests would send to this host in place of a header it was given.
    netrc = tmp_path / "netrc"
    netrc.write_text("machine 127.0.0.1 login engine password secret\n")
    monkeypatch.setenv("NETRC", str(netrc))
    list_targets(Jobs(redis_url, "authenticating", tmp_path), {"recording": address})
    assert received == [("/api/v1/host", f"Bearer {TOKEN}")]
```

- [x] **Step 2: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_discovery.py tests/test_targets.py tests/test_hosts.py`
Expected: 40 failed and 56 passed, in under a minute, each as follows. `/api/v1/targets` answers `404` where the four token cases expect `401`, and where the three listings of `test_targets.py` and the eight of `test_hosts.py` expect `200`; the 17 remote-target values raise no `ValueError`; and the eight direct observations raise the skeleton's `NotImplementedError`. `test_host_local_discovery_queries_no_other_host` passes already: it keeps host-local discovery local once remote targets are configured. Stop and report if a test fails in another way.

- [x] **Step 3: Observe workers, read remote hosts, and list the targets**

In `apps/engine/pyproject.toml`, add `"requests==2.34.2",` to `dependencies`, after `"redis==6.4.0",`.

In `apps/engine/dtcc_engine/jobs.py`, add `from importlib.metadata import version` after `from datetime import UTC, datetime, timedelta`; add after `from celery.signals import task_failure`:

```python
from celery.worker import state as worker_state
from celery.worker.control import inspect_command
```

and replace `from kombu.exceptions import OperationalError` with:

```python
from kombu.exceptions import ChannelError, OperationalError
from pydantic import BaseModel, ConfigDict, ValidationError
```

Add `VERSIONED_PACKAGES = ("dtcc-engine", "dtcc-core", "dtcc-sim")` before `RETENTION`, and after `NODE_CHECK_TIMEOUT`:

```python
# How long an observation waits for a target's worker to answer, once connected.
OBSERVATION_TIMEOUT = 0.5
# Engine's inspect command, which a worker answers with what an observation needs.
DESCRIBE_WORKER = "engine_worker"
```

Add before `record_key`:

```python
def installed_versions() -> dict[str, str]:
    """Return the installed Engine, Core, and Sim distribution versions."""
    return {package: version(package) for package in VERSIONED_PACKAGES}


@inspect_command(name=DESCRIBE_WORKER)
def describe_worker(state: Any) -> dict[str, Any]:
    """Describe this worker for an observation: its image digest, versions, job limit, jobs held, and queues.

    It never reports a job's arguments. Celery registers the command for every app in the process, so it finds this
    worker's jobs through the app.
    """
    consumer = state.consumer
    queues = consumer.task_consumer.queues if consumer.task_consumer else []
    return {
        "image_digest": state.app.engine_jobs.image_digest,
        "versions": installed_versions(),
        # The limit Celery applies with prefetch disabled: the worker takes a job only while it holds fewer.
        "job_limit": getattr(consumer.controller, "max_concurrency", None) or consumer.pool.num_processes,
        "reserved": len(worker_state.reserved_requests),
        "queues": sorted(queue.name for queue in queues),
    }


class WorkerDescription(BaseModel):
    """A worker's answer to `DESCRIBE_WORKER`."""

    model_config = ConfigDict(extra="forbid", strict=True)

    image_digest: str | None
    versions: dict[str, str]
    job_limit: int
    reserved: int
    queues: list[str]


```

In `Jobs.__init__`, add after `self.celery_app = Celery("dtcc_engine", broker=redis_url, backend=redis_url)`:

```python
        # Where Engine's inspect command, which Celery registers for every app, finds this app's jobs.
        self.celery_app.engine_jobs = self
```

and replace the skeleton's `observe` with:

```python
    def observe(self, target: str) -> dict[str, Any]:
        """Observe a target's worker through the broker, with the count of jobs waiting in its queue.

        Returns:
            `state`, `reason`, `worker`, the worker's answer, and `waiting`. The state is `ready` if the worker can
            start a job now; `busy` if it holds as many jobs as its limit, or jobs wait; `unavailable` if it does not
            consume exactly its target's queue; `incompatible` if its image digest does not match this host's; and
            `unknown` if the broker or the worker did not answer, or the answer is malformed, which does not show that
            the worker stopped. Only ready and busy have no reason; a value not obtained is None.
        """
        node = f"celery@{target}"
        try:
            # A connection of its own: on a pooled one, an earlier call that timed out can lose this answer.
            with self.celery_app.connection_for_write() as connection:
                # Before the worker answers: a job it takes from the queue in between is counted twice, not missed.
                try:
                    waiting = connection.default_channel.queue_declare(queue=target, passive=True).message_count
                except ChannelError:
                    # Kombu keeps no list for an empty queue, so its passive declaration finds none.
                    waiting = 0
                answers = self.celery_app.control.broadcast(
                    DESCRIBE_WORKER, destination=[node], reply=True, timeout=OBSERVATION_TIMEOUT, connection=connection
                )
        except (OperationalError, redis.RedisError):
            logger.warning("Could not observe the worker of %s", target, exc_info=True)
            return {"state": "unknown", "reason": "The broker did not answer", "worker": None, "waiting": None}
        answer = next((reply[node] for reply in answers if node in reply), None)
        if answer is None:
            reason = f"Its worker did not answer within {OBSERVATION_TIMEOUT} s"
            return {"state": "unknown", "reason": reason, "worker": None, "waiting": waiting}
        try:
            worker = WorkerDescription.model_validate(answer).model_dump()
        except ValidationError:
            return {
                "state": "unknown",
                "reason": "Its worker's answer is malformed",
                "worker": None,
                "waiting": waiting,
            }
        digests = (self.image_digest, worker["image_digest"])
        if target == self.target:
            # Compared only when both are set: a development deployment supplies none, and runs locally only.
            compatible = None in digests or digests[0] == digests[1]
        else:
            compatible = None not in digests and digests[0] == digests[1]
        reason = None
        if worker["queues"] != [target]:
            state, reason = "unavailable", f"Its worker does not consume exactly the queue '{target}'"
        elif not compatible:
            state, reason = "incompatible", "Its worker's image digest is missing or differs from this host's"
        elif worker["reserved"] < worker["job_limit"] and waiting == 0:
            state = "ready"
        else:
            state = "busy"
        return {"state": state, "reason": reason, "worker": worker, "waiting": waiting}

```

In `apps/engine/dtcc_engine/api.py`, add `from urllib.parse import urlsplit` after `from typing import Any`, and `import requests` after `import dtcc_sim`. Replace the import from `dtcc_engine.jobs` with:

```python
from dtcc_engine.jobs import (
    TARGET_PATTERN,
    ExecutionStarted,
    Jobs,
    JobStateUnavailable,
    UnconfirmedSubmission,
    installed_versions,
    jobs_from_environment,
)
```

Replace `VERSIONED_PACKAGES = ("dtcc-engine", "dtcc-core", "dtcc-sim")` with:

```python
# How long the entry waits to connect to a remote host's Engine, and then for each read of its answer.
HOST_TIMEOUT = 5.0
```

Replace the function `installed_versions`, which `jobs.py` now holds, with:

```python
class HostDiscovery(BaseModel):
    """A host's answer to `GET /api/v1/host`."""

    target: str
    image_digest: str | None
    versions: dict[str, str]
    catalog_revision: str
    datasets: dict[str, Any]


```

Add before `create_app`:

```python
def parse_remote_targets(value: str, local_target: str) -> dict[str, str]:
    """Parse the remote targets, `<identifier>=<address>` separated by commas, into addresses by identifier, in order.

    An address is the base URL of the target's Engine HTTP service: `http` or `https`, without credentials, a query,
    or a fragment. Errors never repeat an address, which could hold a credential.

    Raises:
        ValueError: If an entry is malformed, an identifier is malformed, repeated, or the local target's, or an
            address is not such a URL.
    """
    targets: dict[str, str] = {}
    for entry in value.split(",") if value else []:
        identifier, separator, address = entry.partition("=")
        if not separator or not TARGET_PATTERN.fullmatch(identifier):
            raise ValueError("Each remote target must be <identifier>=<address>, with a valid target identifier")
        if identifier == local_target or identifier in targets:
            raise ValueError(f"Remote target '{identifier}' is the local target or is configured twice")
        try:
            parts = urlsplit(address)
            parts.port  # Raises ValueError if the port is malformed.
        except ValueError:
            # The parser's own errors can repeat the address.
            parts = None
        if (
            parts is None
            or parts.scheme not in ("http", "https")
            or not parts.hostname
            or "@" in parts.netloc
            # Not parts.query or parts.fragment: an empty one is "", and would still come before the route's path.
            or "?" in address
            or "#" in address
        ):
            raise ValueError(
                f"Remote target '{identifier}' needs a valid http or https URL without credentials, query, or fragment"
            )
        targets[identifier] = address.rstrip("/")
    return targets


def host_summary(host: dict[str, Any]) -> dict[str, Any]:
    """Return a host-local discovery's image digest, versions, and catalog revision, and its Datasets' names."""
    return {
        "image_digest": host["image_digest"],
        "versions": host["versions"],
        "catalog_revision": host["catalog_revision"],
        "datasets": sorted(host["datasets"]),
    }


```

In `create_app`'s docstring, add after the description of `jobs`:

```python
        remote_targets: The base addresses of the remote targets' Engine HTTP services by identifier, in placement
            order, as `parse_remote_targets` returns them.
```

Add `remote_targets = remote_targets or {}` after `expected_token = api_token.encode()`, and after `find_job`:

```python

    def bearer_token(request: requests.PreparedRequest) -> requests.PreparedRequest:
        # As the request's authentication, so that requests does not replace it with credentials from `.netrc`.
        request.headers["Authorization"] = f"Bearer {api_token}"
        return request

    def remote_host(target: str, address: str) -> dict[str, Any]:
        """Return a remote target's host-local discovery, or the reason it could not be read, as `host_error`."""
        try:
            # Not redirected: the token goes to configured addresses only.
            response = requests.get(
                f"{address}/api/v1/host", auth=bearer_token, timeout=HOST_TIMEOUT, allow_redirects=False
            )
        except requests.RequestException:
            return {"host": None, "host_error": "The host could not be reached"}
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            return {"host": None, "host_error": "The host rejected the token"}
        if response.status_code != status.HTTP_200_OK:
            return {"host": None, "host_error": f"The host answered HTTP {response.status_code}"}
        try:
            host = HostDiscovery.model_validate(response.json())
        except (ValueError, ValidationError):
            return {"host": None, "host_error": "The host's answer is malformed"}
        if host.target != target:
            return {"host": None, "host_error": "The host answers as another target"}
        return {"host": host_summary(host.model_dump()), "host_error": None}

```

Add after the route `describe_host`:

```python
    @app.get("/api/v1/targets", dependencies=[Depends(require_token)])
    def list_targets() -> dict[str, Any]:
        local = {"host": host_summary(describe_host()), "host_error": None}
        targets = [{"target": jobs.target, **jobs.observe(jobs.target), **local}]
        for target, address in remote_targets.items():
            targets.append({"target": target, **jobs.observe(target), **remote_host(target, address)})
        return {"targets": targets}

```

In `submit_job`, replace the refusal's detail with `f"Target '{request.target}' is not accepted; this Engine runs jobs only on '{jobs.target}'"`. Replace `create_app_from_environment` with:

```python
def create_app_from_environment() -> FastAPI:
    """Create the application from `ENGINE_API_TOKEN`, the job settings, and `ENGINE_REMOTE_TARGETS`, which, unset or
    empty, means that there are none; the Uvicorn `--factory` entry point.

    Raises:
        ValueError: If `ENGINE_API_TOKEN` is unset, empty, or not an RFC 6750 bearer token, if `ENGINE_TARGET` or
            `ENGINE_IMAGE_DIGEST` is malformed, or if `ENGINE_REMOTE_TARGETS` cannot be used (`parse_remote_targets`).
        KeyError: If a job setting is unset: `ENGINE_REDIS_URL`, `ENGINE_TARGET`, or `ENGINE_PACKAGE_DIR`.
    """
    jobs = jobs_from_environment()
    remote_targets = parse_remote_targets(os.environ.get("ENGINE_REMOTE_TARGETS", ""), jobs.target)
    return create_app(os.environ.get("ENGINE_API_TOKEN", ""), jobs, remote_targets)
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 200 passed: the 159 earlier tests and the 41 new cases. The image is rebuilt from its dependency step, because `pyproject.toml` changed.

- [x] **Step 5: Document the observation, the remote targets, and compatibility**

In `apps/engine/DESIGN.md`, in Routing and concurrency, add after the paragraph that ends "HTTP liveness alone must not be treated as proof that its Celery worker is ready.":

```markdown
Engine observes a target through the broker. The target's worker answers with
its image digest, versions, job limit, the jobs it holds, and the queues it
consumes, never with a job's arguments, and the broker counts the jobs waiting
in the target's queue. A target is available when its worker answers and
consumes exactly its target's queue, and has capacity when the worker holds
fewer jobs than its limit and none wait. A target whose worker does not answer
is unknown: Engine does not conclude that the worker stopped, and routing
treats the target as unavailable.
```

In Deployment and authentication, add after "the static remote-target list, per-host concurrent-job limits, and local temporary result directories.":

```markdown
Each remote target is an identifier and the base address of its Engine HTTP
service, without credentials; the entry service sends the shared token only to
those addresses and follows no redirects.
```

and replace the line "its configuration so that discovery can report it. Image compatibility is", in the paragraph on the image digest, with:

```markdown
its configuration so that discovery and the host's worker can report it. A
remote target is compatible only when its worker reports the entry's digest; a
missing digest never matches. The local target is compared only when both
digests are set, so a development deployment without digests runs locally
only. Image compatibility is
```

In this file, in increment 5b's Scope, add after "`ENGINE_IMAGE_DIGEST`, the platform-specific digest of the image each host runs;": " `ENGINE_REMOTE_TARGETS`, the entry service's remote targets and their Engine addresses, in placement order (Task 26);".

Run: `npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 6: Observe the development worker through the worker service**

This step stops and starts the development worker and expects it idle, so it needs the development engine to itself: submit nothing else while it runs, and clear no job. Start its Redis, if it is not running: `docker compose --profile engine up -d --wait engine-redis`.

If the worker is running, through `pnpm dev:engine` or otherwise (`docker compose --profile engine ps --status running --services` lists `engine-worker`), wait until it has no job queued or running before anything stops or rebuilds it, so that none is interrupted: `docker compose --profile engine exec -T engine-redis redis-cli -n 0 LLEN local` answers 0, which counts every queued job because Engine sends no priorities, and `docker compose --profile engine exec -T engine-worker /opt/conda/envs/engine/bin/celery --app dtcc_engine.worker inspect active --destination celery@local` lists none; an answer that does not come is not an empty list. A queued job can start as a running one finishes, so check both together, and if jobs keep arriving, do the step later. Then stop the engine and the worker without a deadline: `docker compose --profile engine stop --timeout -1 engine engine-worker`. The checks can miss a job that the worker has taken from the queue and not yet started; its warm shutdown waits for such a job, and `--timeout -1` keeps Docker from killing the worker meanwhile, as its default 10 s would. Expected: `docker compose --profile engine ps -a engine-worker` shows that the worker exited with 0. Never kill the worker, and start or rebuild nothing while it runs; if it does not exit, stop and report it, as any other exit code.

Start `pnpm dev:engine`, wait until the worker logs that it is ready, and list the targets until `reserved` and `waiting` are 0: jobs queued while no worker ran run first. Send each request below with `-H "Authorization: Bearer local-dev-engine-token"`. A listing in which the worker is `unknown` because its answer was late is taken again; if the worker stays unknown, stop and find the cause.

1. `curl -s http://127.0.0.1:8000/api/v1/targets`. Expected: one target, `local`, `ready`, with no reason; `worker` with `image_digest` null, the versions of `/api/v1/datasets`, `job_limit` 1, `reserved` 0, and `queues` `["local"]`; `waiting` 0; and `host` with `image_digest` null and the versions, catalog revision, and Dataset names of `/api/v1/datasets`, with `host_error` null. Without the token: `401`.
2. `docker compose --profile engine exec -T engine-worker /opt/conda/envs/engine/bin/celery --app dtcc_engine.worker inspect engine_worker --destination celery@local --json`. Expected: `celery@local` with the `worker` of 1.
3. Submit `city_volume_mesh` on `[319891, 6399790, 320091, 6399990]`, wait until it is `running`, submit `smoke` on the same bounds, list the targets, and then read both jobs' states. If `city_volume_mesh` is still `running` and `smoke` `queued`, both were so when the targets were listed. Expected: `busy`, `reserved` 1, and `waiting` 1; the answer does not contain `319891`. If `city_volume_mesh` had already completed, the check is inconclusive, not a failure: repeat it once with another job. If a job failed or was cancelled, stop and find the cause. Wait until both jobs complete, and list the targets again. Expected: `ready`, `reserved` 0, and `waiting` 0.
4. Stop the worker: `docker compose --profile engine stop --timeout -1 engine-worker`. Expected: it logs a warm shutdown. List the targets. Expected: `unknown`, with the reason "Its worker did not answer within 0.5 s", `worker` null, `waiting` 0, and `host` as in 1. Start it with `docker compose --profile engine start engine-worker`, wait until it is ready, and list them. Expected: `ready`.

Stop the engine and the worker: `docker compose --profile engine stop --timeout -1 engine engine-worker`. Redis keeps running, with the development jobs and packages.

- [x] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [x] **Step 8: Stop for review**

Record Task 26's results in Increment 3's status, including Step 6's observations, leave the changes uncommitted, and report Steps 2, 4, 6, and 7. Suggested commit message: `Feature: Observed engine workers and listed the compute targets`.

### Task 27: Deliver remote packages through the entry

A job runs on its target's host, which keeps the package (Task 11), while its record is in the central Redis that every host reads. This task makes a remote job's package available through the entry service. Each host serves its own packages through a host-local route; the entry's status asks the job's host whether its package can be downloaded, and the entry's download streams it from that host without storing it (Remote execution, Retention, and Authentication rows). Submission still accepts only the local target until Task 28, so the tests run a remote job by submitting it through the remote target's `Jobs`, which writes the shared record as routing will.

**Interfaces verified for the task** (2026-10-17, in the development image's Starlette 1.8.0, FastAPI 0.141.1, Uvicorn 0.54.0, requests 2.34.2, and urllib3 2.8.0 source, and in a prototype in a Compose project of its own):

- Starlette's `StreamingResponse` iterates a synchronous iterator in the thread pool, one item per call. Uvicorn's h11 protocol, which the image uses because it has no `httptools`, reports ASGI spec 2.3, so Starlette listens for the client's disconnect beside the stream and cancels the stream when it comes; the cancellation waits for the read in progress, because anyio does not abandon a thread that is cancelled. Starlette then runs the response's `background` task, but an error raised by the iterator propagates and skips it. In the prototype, without an explicit close, the remote host's connection was still open 30 s after the client disconnected.
- `FileResponse` answers a `HEAD` request with its headers, including `content-length`, and no body; FastAPI's `api_route` serves both methods through one handler.
- `requests` with `stream=True` returns once the headers arrive, and `iter_content` reads the body as it is consumed, each read bounded by the read timeout. urllib3 2.8.0 enforces the declared `Content-Length`, so a body that ends early raises `ChunkedEncodingError`. `Response.close()` closes the connection of a body that was not read to its end. requests sends `Accept-Encoding: gzip, deflate, zstd`, and `iter_content` decodes an encoded body, whose `Content-Length` is the encoded length; the review of 2026-10-17 found that the entry's Uvicorn refused such a download as "Too much data for declared Content-Length".
- When the stream raises midway, Uvicorn closes the connection without completing the response, so the client's download fails, with or without a declared length (prototype).
- Importing Sim starts PETSc through dolfinx and petsc4py, and PETSc's signal handlers replace Python's ignored `SIGPIPE` with one that aborts the process. The prototype found it when its first stub host, which writes from a thread on a blocking socket, aborted the tests with exit code 15 (`MPI_Abort`) once the entry had closed its connection. An API process survived a client that disconnected after the first chunk of a 20 MB download, and a worker eight outages of the prototype's own Redis, because they noticed the reset connection before they wrote again. Since 2026-10-17, before this task's execution, the image sets `PETSC_OPTIONS=-no_signal_handler` (Engine image in DESIGN.md), so such a write raises `BrokenPipeError` in the tests, the API, and the worker, and the stub host writes as any server does.

**Decisions** (proposed with the task):

- Host-local delivery is `GET` and `HEAD /api/v1/host/jobs/{job_id}/package`, with the token. It serves this host's packages only: for a job of another target it answers `404`, "did not run on this host", and never forwards. For its own jobs it answers as the public route does for a local job: the package, `404` for an unknown or expired job, `409` without a package, and `503` when the job's state is unavailable.
- Status: a completed job of another target has its `package.available` from its host's host-local route, asked with `HEAD`: `true` for `200`, `false` for `409`, and `null` when the target is not configured, or its host cannot be reached, rejects the token, or answers anything else. `Jobs.status` reports `null` for another target's job, whose package only the API can ask about. The field becomes `bool | null`, which the `engine-integration` branch must handle. Each status of a completed remote job asks its host once; there is no cache.
- Download: for a completed job of another target, the public route requests the host-local route with `GET`, without asking for the status first, with the token as the request's own authentication (Task 26), `HOST_TIMEOUT` to connect and for each read, no redirects, and `stream=True`. `200` is streamed through as `application/zip`, with the attachment name and, when the host sent the body without a `Content-Encoding`, its `Content-Length`, because requests decodes an encoded body; `409` becomes `409`, "has no package on its host"; `401` becomes `503`, "The job's host rejected the token"; any other status `503`, "The job's host answered HTTP <status>"; a failed connection or a timeout `503`, "The job's host could not be reached"; and a target that is not configured `503`. No answer of the host's is passed on. A job that has not completed has no package on any host, so it is refused from its record, as a local one is. An expired job is unknown at the entry before its host is asked, and at its host though its file may remain.
- Streaming: `ForwardedPackage`, a `StreamingResponse`, reads the host's body in `FileResponse`'s chunks and closes the host's response in a `finally` around the whole response, so that it is closed when the download completes, fails, or the client disconnects. Starlette's `background` task is not used, because an error skips it. An error midway propagates, so the client's download fails instead of ending as a shorter archive. The entry writes nothing to disk, and does not validate the archive: its host validated it with Core before offering it (Task 11).
- Tests: `hosts` in `tests/test_hosts.py` gains the entry's API process, with the remote target configured, so that a download crosses two real HTTP servers. Stub hosts on free local ports answer with a redirect, a server error with a body, half a declared body, a gzipped body with its encoded length, or a slow body, and record what they are sent. Hosts that cannot deliver, and the stubs that do not stream, are asked through an in-process entry client. Records of a stub's target are written as its worker would write them. No expectation changes; the token test covers the host-local route.

**Files:**

- Modify: `apps/engine/dtcc_engine/api.py`
- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/test_hosts.py`
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/DESIGN.md` (Package creation, delivery, and retention)
- Modify: `apps/engine/PLAN.md` (Increment 3 status)

**Interfaces:**

- Consumes: from Task 26, `HOST_TIMEOUT`, the remote targets, the authentication callable `bearer_token`, and the fixtures `run_worker_process`, `run_api_process`, and `hosts`; from Tasks 10 to 12, `Jobs.status`, `Jobs.package_path`, the public package route, `RETENTION`, `RECORD_LIFETIME`, and `record_key`. From Starlette: `StreamingResponse` and `FileResponse`; from requests: `requests.request` with `stream=True`, `iter_content`, and `Response.close`.
- Produces: the route `GET` and `HEAD /api/v1/host/jobs/{job_id}/package`; `ForwardedPackage`; `package.available` `null` for a remote job whose host does not answer; in `tests/test_hosts.py`, the entry's API process in `hosts`, `run_api_process`'s `remote_targets`, and the helpers `fetch`, `completed_job`, `recorded_job`, and `serve`.

- [ ] **Step 1: Write the tests**

In `apps/engine/tests/test_hosts.py`, replace the module docstring's second paragraph, from "Each target's worker runs" to "as it would another host.", with:

```python
Each target's worker runs in a process of its own, as the worker service does, because Celery keeps a worker's reserved
and active jobs per process. Each host's API also runs in a process of its own, and the entry's API reaches the remote
one over HTTP, as it would another host.
```

Add `import gzip` before `import os`. Replace `from contextlib import AbstractContextManager, contextmanager` with `from contextlib import AbstractContextManager, ExitStack, contextmanager`, and add `from datetime import UTC, datetime, timedelta` after it. Replace `from dtcc_engine.jobs import Jobs` with `from dtcc_engine.jobs import RECORD_LIFETIME, RETENTION, Jobs, record_key`, and add `CHUNK = 64 * 1024` after the line that defines `DIGEST`. Replace the fixture `run_api_process` with:

```python
@pytest.fixture(scope="module")
def run_api_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's Engine API in a process of its own on a free local port until the context ends; yield its address.

    Its remote targets are given as `ENGINE_REMOTE_TARGETS` is. Its log is in a temporary directory, which a failure to
    start reports.
    """
    logs = tmp_path_factory.mktemp("api-logs")

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None, remote_targets: str = "") -> Iterator[str]:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = {
            **os.environ,
            "ENGINE_API_TOKEN": TOKEN,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
            "ENGINE_REMOTE_TARGETS": remote_targets,
        }
        command = ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--port", str(port)]
        log = logs / f"{target}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        address = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 120
            while True:
                try:
                    requests.get(f"{address}/api/v1/health", timeout=1).raise_for_status()
                    break
                except requests.RequestException:
                    assert process.poll() is None and time.monotonic() < deadline, log.read_text()
                    time.sleep(0.2)
            yield address
        finally:
            process.terminate()
            process.wait(timeout=60)

    return run


```

Replace the fixture `hosts` with:

```python
@pytest.fixture(scope="module")
def hosts(
    redis_url: str,
    tmp_path_factory: pytest.TempPathFactory,
    run_worker_process: Callable[..., AbstractContextManager[None]],
    run_api_process: Callable[..., AbstractContextManager[str]],
) -> Iterator[dict[str, Any]]:
    """The entry host, target `entry`, and a remote host, target `remote`, each with its worker and API, in one deployment.

    Yields each host's address and the entry's package directory, and each target's jobs, as its host's API has them.
    """
    entry_packages, remote_packages = tmp_path_factory.mktemp("entry"), tmp_path_factory.mktemp("remote")
    with (
        run_worker_process("entry", entry_packages, DIGEST),
        run_worker_process("remote", remote_packages, DIGEST),
        run_api_process("remote", remote_packages, DIGEST) as remote_address,
        run_api_process("entry", entry_packages, DIGEST, f"remote={remote_address}") as entry_address,
    ):
        yield {
            "entry_address": entry_address,
            "remote_address": remote_address,
            "entry_packages": entry_packages,
            "entry": Jobs(redis_url, "entry", entry_packages, DIGEST),
            "remote": Jobs(redis_url, "remote", remote_packages, DIGEST),
        }


```

Add at the end of the file:

```python


def fetch(address: str, path: str, method: str = "GET", **options: Any) -> requests.Response:
    """Send a request with the shared token to an Engine API process."""
    return requests.request(method, f"{address}{path}", headers=AUTHORIZED, timeout=60, **options)


def completed_job(jobs: Jobs) -> str:
    """Run a `smoke` job on the jobs' target, and return its ID once it completes."""
    job_id = jobs.submit("smoke", {"bounds": BOUNDS})
    wait_for(lambda: jobs.status(job_id)["state"] == "completed")
    return job_id


def recorded_job(jobs: Jobs, target: str, outcome: str | None) -> str:
    """Record a job of a target as its worker would, queued or with an outcome, without running it; return its ID."""
    job_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    fields = {"dataset": "smoke", "target": target, "submitted_at": now, "queued_at": now, "execution_gate": "waiting"}
    if outcome is not None:
        fields.update({"execution_gate": "started", "outcome": outcome, "finished_at": now})
    with jobs.records.pipeline() as pipeline:
        pipeline.hset(record_key(job_id), mapping=fields)
        pipeline.expire(record_key(job_id), RECORD_LIFETIME)
        pipeline.execute()
    return job_id


@contextmanager
def serve(answer: Callable[[BaseHTTPRequestHandler], None]) -> Iterator[str]:
    """Answer each GET and HEAD request on a free local port until the context ends; yield the address."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            answer(self)

        do_HEAD = do_GET

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def remote_job(hosts: dict[str, Any]) -> str:
    """A completed job of the remote target, whose package its host keeps."""
    return completed_job(hosts["remote"])


def test_remote_job_is_polled_and_downloaded_through_the_entry(hosts: dict[str, Any], remote_job: str) -> None:
    entry, remote = hosts["entry_address"], hosts["remote"]
    kept = set(hosts["entry_packages"].iterdir())
    polled = fetch(entry, f"/api/v1/jobs/{remote_job}")
    downloaded = fetch(entry, f"/api/v1/jobs/{remote_job}/package")
    package = remote.package_path(remote_job).read_bytes()
    # The entry reports the job as its host does, and a download does not extend the package's retention.
    assert polled.json() == remote.status(remote_job) == fetch(entry, f"/api/v1/jobs/{remote_job}").json()
    assert polled.json()["package"]["available"] is True
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/zip"
    assert downloaded.headers["content-disposition"] == f'attachment; filename="{remote_job}.dtccpkg"'
    assert downloaded.headers["content-length"] == str(len(package))
    assert downloaded.content == package
    # The entry streams the package through and keeps no copy.
    assert set(hosts["entry_packages"].iterdir()) == kept


def test_remote_package_its_host_no_longer_has_is_unavailable(hosts: dict[str, Any]) -> None:
    job_id = completed_job(hosts["remote"])
    hosts["remote"].package_path(job_id).unlink()
    polled = fetch(hosts["entry_address"], f"/api/v1/jobs/{job_id}")
    downloaded = fetch(hosts["entry_address"], f"/api/v1/jobs/{job_id}/package")
    assert polled.json()["package"]["available"] is False
    assert downloaded.status_code == 409
    assert downloaded.json() == {"detail": f"Job '{job_id}' has no package on its host"}


@pytest.mark.parametrize(
    ("host", "token", "detail"),
    [
        ("closed", TOKEN, "The job's host could not be reached"),
        ("remote", "other-token", "The job's host rejected the token"),
        ("elsewhere", TOKEN, "The job's host answered HTTP 404"),
        ("unconfigured", TOKEN, "The job's target 'remote' is not configured on this Engine"),
    ],
    ids=["unreachable", "rejected-token", "other-target", "unconfigured"],
)
def test_remote_package_whose_host_does_not_deliver_it_is_unknown(
    hosts: dict[str, Any],
    remote_job: str,
    tmp_path: Path,
    run_api_process: Callable[..., AbstractContextManager[str]],
    host: str,
    token: str,
    detail: str,
) -> None:
    with ExitStack() as stack:
        if host == "closed":
            remote_targets = {"remote": closed_address()}
        elif host == "elsewhere":
            # The host of another target, which does not serve the remote target's packages.
            remote_targets = {"remote": stack.enter_context(run_api_process("elsewhere", tmp_path))}
        elif host == "unconfigured":
            remote_targets = {}
        else:
            remote_targets = {"remote": hosts["remote_address"]}
        client = TestClient(create_app(token, hosts["entry"], remote_targets))
        headers = {"Authorization": f"Bearer {token}"}
        polled = client.get(f"/api/v1/jobs/{remote_job}", headers=headers)
        downloaded = client.get(f"/api/v1/jobs/{remote_job}/package", headers=headers)
    # Everything else the entry reads from the shared records.
    owned = hosts["remote"].status(remote_job)
    assert polled.json() == {**owned, "package": {**owned["package"], "available": None}}
    assert (downloaded.status_code, downloaded.json()) == (503, {"detail": detail})


def redirect(request: BaseHTTPRequestHandler) -> None:
    request.send_response(307)
    request.send_header("Location", "/elsewhere")
    request.send_header("Content-Length", "0")
    request.end_headers()


def fail_with_details(request: BaseHTTPRequestHandler) -> None:
    body = b"secret details"
    request.send_response(500)
    request.send_header("Content-Length", str(len(body)))
    request.end_headers()
    if request.command == "GET":
        request.wfile.write(body)


@pytest.mark.parametrize(
    ("answer", "status_code"), [(redirect, 307), (fail_with_details, 500)], ids=["redirect", "server-error"]
)
def test_host_answer_that_is_not_a_package_is_not_passed_on(
    redis_url: str, tmp_path: Path, answer: Callable[[BaseHTTPRequestHandler], None], status_code: int
) -> None:
    received: list[tuple[str, str, str | None]] = []

    def record_and_answer(request: BaseHTTPRequestHandler) -> None:
        received.append((request.command, request.path, request.headers.get("Authorization")))
        answer(request)

    entry = Jobs(redis_url, "entry", tmp_path)
    job_id = recorded_job(entry, "stubbed", "completed")
    with serve(record_and_answer) as address:
        client = TestClient(create_app(TOKEN, entry, {"stubbed": address}))
        polled = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
        downloaded = client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert polled.json()["package"]["available"] is None
    assert downloaded.status_code == 503
    assert downloaded.json() == {"detail": f"The job's host answered HTTP {status_code}"}
    # Each is asked once, with the shared token, and a redirect is not followed.
    path = f"/api/v1/host/jobs/{job_id}/package"
    assert received == [("HEAD", path, f"Bearer {TOKEN}"), ("GET", path, f"Bearer {TOKEN}")]


def test_package_its_host_stops_sending_is_not_delivered_whole(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    def send_half(request: BaseHTTPRequestHandler) -> None:
        request.send_response(200)
        request.send_header("Content-Length", str(2 * CHUNK))
        request.end_headers()
        request.wfile.write(b"x" * CHUNK)

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_half) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        # The client sees the download fail, not a shorter archive.
        with pytest.raises(requests.exceptions.ChunkedEncodingError):
            fetch(entry, f"/api/v1/jobs/{job_id}/package")


def test_package_its_host_sends_compressed_is_delivered_as_the_archive(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    archive = b"package " * CHUNK

    def send_compressed(request: BaseHTTPRequestHandler) -> None:
        body = gzip.compress(archive)
        request.send_response(200)
        request.send_header("Content-Encoding", "gzip")
        request.send_header("Content-Length", str(len(body)))
        request.end_headers()
        request.wfile.write(body)

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_compressed) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        downloaded = fetch(entry, f"/api/v1/jobs/{job_id}/package")
    # Not the host's encoding of the archive, nor that encoding's length.
    assert (downloaded.status_code, downloaded.content) == (200, archive)


def test_download_the_client_abandons_releases_its_hosts_connection(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    released = threading.Event()

    def send_slowly(request: BaseHTTPRequestHandler) -> None:
        request.send_response(200)
        request.send_header("Content-Length", str(1000 * CHUNK))
        request.end_headers()
        try:
            for _ in range(1000):
                request.wfile.write(b"x" * CHUNK)
                time.sleep(0.05)
        except OSError:
            released.set()

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_slowly) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        with fetch(entry, f"/api/v1/jobs/{job_id}/package", stream=True) as response:
            assert response.status_code == 200
            next(response.iter_content(CHUNK))
        assert released.wait(30)
        assert fetch(entry, "/api/v1/health").status_code == 200


def test_host_serves_its_own_packages_and_forwards_none(hosts: dict[str, Any], remote_job: str) -> None:
    path = f"/api/v1/host/jobs/{remote_job}/package"
    package = hosts["remote"].package_path(remote_job).read_bytes()
    served = fetch(hosts["remote_address"], path)
    described = fetch(hosts["remote_address"], path, "HEAD")
    elsewhere = fetch(hosts["entry_address"], path)
    assert (served.status_code, served.content) == (200, package)
    assert (described.status_code, described.content) == (200, b"")
    assert described.headers["content-length"] == str(len(package))
    assert elsewhere.status_code == 404
    assert elsewhere.json() == {"detail": f"Job '{remote_job}' did not run on this host"}


def test_host_has_no_package_for_an_unfinished_or_unknown_job(hosts: dict[str, Any]) -> None:
    queued = recorded_job(hosts["remote"], "remote", None)
    unfinished = fetch(hosts["remote_address"], f"/api/v1/host/jobs/{queued}/package")
    unknown_id = str(uuid.uuid4())
    unknown = fetch(hosts["remote_address"], f"/api/v1/host/jobs/{unknown_id}/package")
    entry = fetch(hosts["entry_address"], f"/api/v1/jobs/{queued}/package")
    assert (unfinished.status_code, entry.status_code) == (409, 409)
    assert (unknown.status_code, unknown.json()) == (404, {"detail": f"Job '{unknown_id}' is unknown or expired"})


def test_remote_package_past_its_retention_is_unknown_though_its_file_remains(hosts: dict[str, Any]) -> None:
    remote = hosts["remote"]
    job_id = completed_job(remote)
    # Moves the recorded finish time back instead of waiting 30 days.
    expired = (datetime.now(UTC) - RETENTION - timedelta(seconds=1)).isoformat()
    remote.records.hset(record_key(job_id), "finished_at", expired)
    paths = [
        (hosts["entry_address"], f"/api/v1/jobs/{job_id}"),
        (hosts["entry_address"], f"/api/v1/jobs/{job_id}/package"),
        (hosts["remote_address"], f"/api/v1/host/jobs/{job_id}/package"),
    ]
    assert remote.package_path(job_id).is_file()
    for address, path in paths:
        refused = fetch(address, path)
        assert (refused.status_code, refused.json()) == (404, {"detail": f"Job '{job_id}' is unknown or expired"})
```

In `apps/engine/tests/test_jobs.py`, add to the paths of `test_job_routes_reject_missing_tokens`, after `("POST", "/api/v1/jobs/some-job/cancel"),`:

```python
        ("GET", "/api/v1/host/jobs/some-job/package"),
        ("HEAD", "/api/v1/host/jobs/some-job/package"),
```

- [ ] **Step 2: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_hosts.py tests/test_jobs.py`
Expected: 16 failed and 92 passed, in under a minute, each as follows. The host-local route does not exist, so it answers `404` "Not Found" where the two token cases expect `401`, where `test_host_serves_its_own_packages_and_forwards_none` expects the package, where `test_host_has_no_package_for_an_unfinished_or_unknown_job` expects `409`, and where `test_remote_package_past_its_retention_is_unknown_though_its_file_remains` expects "unknown or expired". The entry reads a remote job's package as missing from its own disk: `available` is `false` where `test_remote_job_is_polled_and_downloaded_through_the_entry` expects `true` and the four cases of `test_remote_package_whose_host_does_not_deliver_it_is_unknown` and the two of `test_host_answer_that_is_not_a_package_is_not_passed_on` expect `null`, and its download answers `409` with the local detail where `test_remote_package_its_host_no_longer_has_is_unavailable` expects the host's, where `test_package_its_host_sends_compressed_is_delivered_as_the_archive` and `test_download_the_client_abandons_releases_its_hosts_connection` expect `200`, and where `test_package_its_host_stops_sending_is_not_delivered_whole` expects `ChunkedEncodingError`. Stop and report if a test fails in another way.

- [ ] **Step 3: Serve each host's packages, and deliver remote ones through the entry**

In `apps/engine/dtcc_engine/jobs.py`, in `Jobs.status`, replace the package's dictionary, `{"available": self.package_path(job_id).is_file(), "expires_at": (finished_at + RETENTION).isoformat()}`, with:

```python
                {
                    # Another target's package is on its host, which only the API can ask.
                    "available": self.package_path(job_id).is_file() if record["target"] == self.target else None,
                    "expires_at": (finished_at + RETENTION).isoformat(),
                }
```

In `apps/engine/dtcc_engine/api.py`, replace `from fastapi.responses import FileResponse, JSONResponse` with `from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse`, and add `from starlette.types import Receive, Scope, Send` after `from redis import RedisError`. Add before `create_app`:

```python
class ForwardedPackage(StreamingResponse):
    """A job's package streamed through from its host's Engine, whose response it closes however the download ends.

    Args:
        upstream: The host's response with the package, requested with `stream=True`.
        job_id: The job's ID, which names the downloaded file.
    """

    def __init__(self, upstream: requests.Response, job_id: str) -> None:
        headers = {"Content-Disposition": f'attachment; filename="{job_id}.dtccpkg"'}
        # The chunks are decoded, so an encoded body's length is not theirs.
        if "Content-Length" in upstream.headers and "Content-Encoding" not in upstream.headers:
            headers["Content-Length"] = upstream.headers["Content-Length"]
        chunks = upstream.iter_content(FileResponse.chunk_size)
        super().__init__(chunks, media_type="application/zip", headers=headers)
        self.upstream = upstream

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Also when the client disconnects, which cancels the stream once its current read ends.
            self.upstream.close()


```

In `create_app`, add after `remote_host`:

```python
    def host_package(job: dict[str, Any], method: str) -> requests.Response:
        """Request the package of another target's job from its host; not redirected, and streamed for a GET.

        Raises:
            HTTPException: `503` if the job's target is not configured or its host could not be reached.
        """
        address = remote_targets.get(job["target"])
        if address is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"The job's target '{job['target']}' is not configured on this Engine",
            )
        try:
            return requests.request(
                method,
                f"{address}/api/v1/host/jobs/{job['job_id']}/package",
                auth=bearer_token,
                timeout=HOST_TIMEOUT,
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The job's host could not be reached"
            ) from None

    def package_on_host(job: dict[str, Any]) -> bool | None:
        """Return whether another target's host can deliver the job's package, or None if it does not answer so."""
        try:
            answer = host_package(job, "HEAD")
        except HTTPException:
            return None
        answer.close()
        return {status.HTTP_200_OK: True, status.HTTP_409_CONFLICT: False}.get(answer.status_code)

    def local_package(job: dict[str, Any]) -> FileResponse:
        if job["package"] is None or not job["package"]["available"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Job '{job['job_id']}' has no package to download; its state is '{job['state']}'",
            )
        path = jobs.package_path(job["job_id"])
        return FileResponse(path, media_type="application/zip", filename=f"{job['job_id']}.dtccpkg")

```

Replace the route `job_status` with:

```python
    @app.get("/api/v1/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str) -> dict[str, Any]:
        job = find_job(job_id)
        if job["package"] is not None and job["target"] != jobs.target:
            job["package"]["available"] = package_on_host(job)
        return job

```

Replace the route `download_package` with:

```python
    @app.get("/api/v1/jobs/{job_id}/package", dependencies=[Depends(require_token)])
    def download_package(job_id: str) -> Response:
        job = find_job(job_id)
        # A job that has not completed has no package on any host.
        if job["target"] == jobs.target or job["package"] is None:
            return local_package(job)
        # Streamed from the job's host without asking for its status first, and stored nowhere here.
        upstream = host_package(job, "GET")
        if upstream.status_code == status.HTTP_200_OK:
            return ForwardedPackage(upstream, job_id)
        upstream.close()
        if upstream.status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"Job '{job_id}' has no package on its host"
            )
        detail = (
            "The job's host rejected the token"
            if upstream.status_code == status.HTTP_401_UNAUTHORIZED
            else f"The job's host answered HTTP {upstream.status_code}"
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)

    @app.api_route("/api/v1/host/jobs/{job_id}/package", methods=["GET", "HEAD"], dependencies=[Depends(require_token)])
    def serve_host_package(job_id: str) -> FileResponse:
        # Host-local delivery: this host's packages only, and never forwarded.
        job = find_job(job_id)
        if job["target"] != jobs.target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' did not run on this host"
            )
        return local_package(job)

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 217 passed: the 201 earlier tests and the 16 new cases.

- [ ] **Step 5: Document remote delivery**

In `apps/engine/DESIGN.md`, in Package creation, delivery, and retention, add after the paragraph that ends "a second stored copy at the entry host.":

```markdown
Each host serves its own packages through a host-local route, which never
forwards a request to another host. A completed job's status says whether its
package can be downloaded; for a job of a remote target, the entry asks that
target's host, and reports `null` when the host does not answer. A download
through the entry streams the package from the job's host without asking for
the job's status first, stores nothing at the entry, follows no redirects, and
sends the shared token only to the configured address. A host without the
package makes the download a `409`, as a local one is; a host that cannot be
reached, rejects the token, or answers otherwise, and a target that is not
configured, make it a `503`, without the host's answer. The entry closes its
request to the host when the download ends, whether it completed, failed, or
the consumer disconnected, and a stream that fails midway fails the download
rather than end it as a shorter archive.
```

Run: `npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [ ] **Step 6: Serve a package through the development engine's host-local route**

This step stops and starts the development worker, so it needs the development engine to itself: submit nothing else while it runs, and clear no job. Start its Redis, if it is not running: `docker compose --profile engine up -d --wait engine-redis`.

If the worker is running, through `pnpm dev:engine` or otherwise (`docker compose --profile engine ps --status running --services` lists `engine-worker`), wait until it has no job queued or running before anything stops or rebuilds it, as in Task 26, Step 6: `docker compose --profile engine exec -T engine-redis redis-cli -n 0 LLEN local` answers 0, and `docker compose --profile engine exec -T engine-worker /opt/conda/envs/engine/bin/celery --app dtcc_engine.worker inspect active --destination celery@local` lists none; an answer that does not come is not an empty list. Then stop the engine and the worker without a deadline: `docker compose --profile engine stop --timeout -1 engine engine-worker`. Expected: `docker compose --profile engine ps -a engine-worker` shows that the worker exited with 0. Never kill the worker, and start or rebuild nothing while it runs; if it does not exit, stop and report it, as any other exit code.

Start `pnpm dev:engine` and wait until the worker logs that it is ready. Send each request below with `-H "Authorization: Bearer local-dev-engine-token"`.

1. Submit `smoke` on `[319891, 6399790, 320091, 6399990]` and poll it until it is `completed`. Expected: `package.available` is `true`.
2. Download its package from `GET /api/v1/jobs/<job id>/package` and from `GET /api/v1/host/jobs/<job id>/package` into two files. Expected: both `200`, and `cmp` finds the files identical. `curl -s -I` on the host-local route: `200`, with the file's size as `content-length`. Without the token: `401`.
3. `GET /api/v1/host/jobs/<a new UUID>/package`. Expected: `404`, "unknown or expired".

Stop the engine and the worker: `docker compose --profile engine stop --timeout -1 engine engine-worker`. Redis keeps running, with the development jobs and packages. A remote job is not checked here: the development engine has one host, and Task 31 checks two in a Compose project of their own.

- [ ] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [ ] **Step 8: Stop for review**

Record Task 27's results in Increment 3's status, including Step 6's observations, leave the changes uncommitted, and report Steps 2, 4, 6, and 7. Suggested commit message: `Feature: Delivered remote packages through the entry`.

## Increment 4: Lifecycle behavior

Status: executed 2026-10-13 to 2026-10-15, in Tasks 17 to 24. The cancellation design and one-time development transition below were agreed on 2026-10-13, and the cancellation part was expanded the same day into Tasks 17 to 19. Task 17 was executed 2026-10-13 and is committed in `66ad923`. Its results: `pnpm dev:engine` was stopped. With the tests written, `engine:check tests/test_jobs.py tests/test_redelivery.py` gave 21 failed and 28 passed, each failure as Step 3 expects: 7 deliveries ran where `IGNORED` was expected, 6 unusable records answered `200` and `409` and the one without a Dataset raised `KeyError: 'dataset'`, the status was `running` over a recorded outcome twice and `queued` with a finish time once, `SUCCESS` raised `TypeError` and `REVOKED` raised `KeyError`, and both prefork duplicate deliveries ran the Dataset a second time. With the implementation, `engine:check` gave 88 passed in 19.9 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 18 was executed 2026-10-13 and is committed in `d2b04c2`. Its results: with the tests written, `engine:check tests/test_jobs.py tests/test_redelivery.py` gave 23 failed and 49 passed, every failure from the missing route's `404 Not Found`, as Step 2 expects: 16 answers of `404` where the tests expect `200`, `409`, `503`, or, without a token, `401`, 5 status-and-result pairs of `(404, None)` where they expect a result, FastAPI's message where the unknown job's test expects "unknown or expired", and the race test's attempts, all `(404, None)`. With the implementation, `engine:check` gave 111 passed in 29.3 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 19 was executed 2026-10-13; the user's instruction to finish the remaining tasks gave Step 1's go-ahead. Its results: `engine` and `engine-worker` were stopped. Database 0 held 21 keys, 10 of them job records from earlier manual runs, and no queued job; database 1 held 147. After `FLUSHDB`, database 0 had 0 keys and database 1 still 147. The two containers, both of project `dtcc-twin`, were the only ones that mounted `dtcc-twin_engine-packages`, whose labels named that project and `engine-packages`; the containers and the volume were removed, and `dtcc-twin_postgres-data` remained. With `pnpm dev:engine`, cancelling `smoke` while `city_volume_mesh` ran answered `200` with `cancelled`, and cancelling `city_volume_mesh` answered `409` with `execution_started`. `city_volume_mesh` completed after 103 s in the worker, and its 68,525-byte package downloaded. `smoke` stayed `cancelled`, its download answered `409`, and when the worker received it, the worker logged that it does not run because its record is `refused`, and Celery logged the task as ignored. With the worker stopped after a warm shutdown, a `smoke` job was `queued`, and cancelling it answered `200` with `cancelled`. Started again, the worker received and skipped it the same way, a later `smoke` job completed, and the first stayed `cancelled` without a package. The two cancelled records had TTLs of 2,678,263 and 2,678,384 s. Stopped, the worker logged a warm shutdown, and both containers exited with 0. `engine:check` gave 111 passed in 29.6 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; Prettier passed for `README.md`, `DESIGN.md`, and `PLAN.md`; `pnpm check` passed. The cancellation part of increment 4 is complete. The remaining lifecycle work is being expanded into tasks one at a time, from Task 20 (Remaining lifecycle work); Tasks 20 to 24 were expanded 2026-10-13 and are not executed; with them, increment 4 is expanded in full. Their review of 2026-10-13 asked for changes to each, and they were revised 2026-10-14 (Remaining lifecycle work). Their second review, of 2026-10-15, accepted the plans of Tasks 20, 21, and 23 and asked for changes to Tasks 22 and 24, which were revised the same day. Their third review, also of 2026-10-15, accepted the plans of Tasks 20 to 23 and asked for one more change to Task 24's Redis outage check, which was revised the same day. Its fourth review, also of 2026-10-15, accepted it, so the plans of Tasks 20 to 24 are accepted. Task 20 was executed 2026-10-15. Its results: with the tests written, `engine:check tests/test_jobs.py` gave 8 failed and 66 passed, each as Step 2 expects: the two new unusable records answered `200` and `409` for status and download, and `200` for cancellation, where the tests expect `503`, and the four upstream-failure cases reported `{"type": "DatasetUpstreamError"}` without `upstream`. With the implementation, `engine:check` gave 119 passed in 30.3 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 20 is committed in `555e78b`. Task 21 was executed 2026-10-15. Its results: with the tests written, `engine:check tests/test_jobs.py tests/test_redelivery.py` gave 8 failed and 80 passed, each as Step 2 expects: the three records with unusable claims answered `200` and `409` for status and download, and `200` for cancelling the waiting job and `409` for the two started ones, where the tests expect `503`; the job whose pool process killed itself was `failed` with `{"type": None}`; and the job an earlier run left was still `running`. With the implementation, `engine:check` gave 127 passed in 35.9 s. With `pnpm dev:engine`, the worker's banner named `celery@engine-worker`, and its startup check of development database 0, which held 4 job records, logged nothing. A `city_volume_mesh` job was `running` and reported progress, with the claim `celery@engine-worker 1666740453f14f34bfeeb54b4ddd3534 32`. After `kill -s KILL engine-worker`, the worker exited with 137, and the job still reported `running`. Started again, the worker logged that the job failed with `WorkerRestarted` because that claimant is gone, and was ready 1.1 s later; the job was `failed` with `{"type": "WorkerRestarted"}` and a finish time, its download answered `409`, and its record's TTL was 2,678,392 s. Stopped, the worker logged a warm shutdown, and both containers exited with 0. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed. Task 21 is committed in `ff328cf`. Task 22 was executed 2026-10-15. Its results: with the tests written, `engine:check tests/test_jobs.py` gave 3 failed and 80 passed, each as Step 2 expects: the queued job's record had a TTL of `-1`, the claim left the shortened lifetime of 60 s, and the submission whose record was lost meanwhile answered `202`, where `503` is expected; `test_confirmation_keeps_the_outcome_and_lifetime_of_a_job_that_finished_first` passed. With the implementation, `engine:check` gave 130 passed in 35.8 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; Prettier passed for `DESIGN.md` and `PLAN.md`; `pnpm check` passed. Task 22 is committed in `c000c47`. Task 23 was executed 2026-10-15. Its results: with the test written, `engine:check tests/test_redelivery.py` gave 1 failed and 8 passed, as Step 2 expects: once the worker had started, the kept packages also held `expired`, `failed`, `cancelled`, and `unknown`. With the implementation, `engine:check` gave 131 passed in 38.5 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; Prettier passed for `DESIGN.md` and `PLAN.md`; `pnpm check` passed. Task 23 is committed in `90aa5af`. Task 24 was executed 2026-10-15. Its results: `engine:check tests/test_redelivery.py` gave 11 passed in 41.2 s, the 2 new tests passing as they pin existing behavior, and `engine:check` gave 133 passed in 44.2 s. Step 3 ran in the Compose project `dtcc-twin-engine-restart`, whose `compose ps` listed only its own three containers; the development API and worker were not running, and development Redis was left alone. API: with `city_volume_mesh` `running` and `smoke` `queued`, both kept those states after `restart engine` once health answered; both completed, their packages of 68,525 and 114,403 bytes downloaded, and the worker's log had one `succeeded` line for each and no delivery logged as not run. Worker: stopped, it logged a warm shutdown; a `smoke` job submitted meanwhile was `queued`, and it completed once after the worker started. Redis: the first attempt was conclusive. `city_volume_mesh` reported progress in `download_pointcloud` before Redis stopped; the outage ran from 09:39:03.125Z to 09:39:04.240Z by the Redis container's clock, and status answered `503` "Job state is temporarily unavailable" for both jobs, never `failed`. The worker logged the lost connection at 09:39:03.278 and `Connected to redis://engine-redis:6379/0` at 09:39:05.297; its pool process read geometries from 09:39:02.69 to 09:39:04.73, across the outage. `city_volume_mesh` finished at 09:39:05.169, after the outage, having run 4.2 s with the lidar and footprint tiles that check 1 had cached in the container. `smoke` was received after the reconnection; both jobs completed once, their packages downloaded, and no message was left unacknowledged. Celery 5.6.3 logged a pending-deprecation warning that from Celery 6 a worker cancels its running late-acknowledged tasks when the broker connection is lost, unless `worker_cancel_long_running_tasks_on_connection_loss` says otherwise. Redis lost: with automatic snapshots off, `SAVE` with no job queued or running gave a `DBSIZE` of 13; `smoke` job A completed, and with the worker stopped, `smoke` job B was `queued`. After `kill -s KILL` and a start, `DBSIZE` was 13, `EXISTS` answered 0 for both records, and both jobs answered `404` with "unknown or expired"; the five jobs of the earlier checks were `completed`, and their packages downloaded. Started, the worker deleted A's package as one no job can deliver, received no delivery of B, and the queue was empty. `down --volumes --rmi local` removed the project's containers, package volume, network, and images; `dtcc-twin_engine-packages`, `dtcc-twin_postgres-data`, and the development images remained. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; Prettier passed for `PLAN.md`; `pnpm check` passed. Increment 4 is executed. The review of the branch on 2026-10-15 found that Celery orders the bootsteps `RecordLostClaims` and `CleanPackages` at random, so a worker started again could keep the package of a job its earlier run left until the next hourly pass; `CleanPackages` now requires `RecordLostClaims`, and `jobs.py` and `test_redelivery.py` are authoritative where they differ from Task 23's listings. Before the change, Celery's order put the cleanup first in 10 of 20 processes, and the new test, `test_worker_started_again_deletes_the_package_its_earlier_run_left`, failed in 2 of 6 runs, each because the package was still there after the job had failed with `WorkerRestarted`. With the change, the check of lost claims came first in 20 of 20 processes, the test passed in 6 of 6 runs, and `engine:check` gave 134 passed in 47.5 s. `engine:check:prod` gave 18 passed with `engine-redis` in its own Compose project, and its token checks passed; `pnpm check` passed.

**Scope:** failure reporting, pre-execution cancellation (moved from increment 2) and the start/cancel race, running-job cancellation reported as unsupported, restart behavior without recovery promises for separate API, worker, and broker restarts, and physical cleanup of expired packages, and of packages left without a completed job, such as one kept after its job failed or one whose record has no finish time. It also handles a failed job whose worker recorded no exception type. The loss of a pool process, which Celery may record as a failure, is distinguished from the loss of the whole worker, which can leave the job's state stale. Both gaps were found in increment 2a's review.

**Upstream interfaces:** Celery 5.6.3's task states, `Ignore`, and result expiry; Redis Lua for atomic conditional record updates, as described under Cancellation. For later failure reporting, Core's `DatasetUpstreamError` (defined in `dtcc_core.datasets.dataset`; not re-exported from `dtcc_core.datasets` at the pinned commit) and `DatasetDescriptor.serialize_upstream_error`, which converts it into JSON-safe metadata (Dataset, operation, target, failure class, status code, message, transience). Engine still decides which of that metadata a consumer sees, so that no error response exposes the API token or provider credentials.

**Checks:** the Failure reporting, Cancellation, Retention, and Restart behavior rows of the acceptance table, each restart exercised separately, against the selected Celery version (upstream item 5).

**Blockers:** none known. Tasks 17 to 19, the cancellation, are executed. Tasks 20 to 24, the remaining lifecycle work, are expanded. Review accepted the plans of Tasks 20 to 24 on 2026-10-15; Tasks 20 to 24 are executed. An expanded task is not an accepted one until review accepts it, and an accepted plan is not an executed task.

### Cancellation

**Decision and boundary:** use one atomic start/cancel gate in Engine's existing acceptance record, not Celery revoke. This is bounded coordination for permission to invoke one Dataset. Celery retains delivery, worker processes, concurrency, and task results; Core and Sim retain computation and package semantics. No automatic Dataset retries, resubmission, running-job termination, scheduler, or recovery protocol is added. Keep `task_publish_retry=False`, `task_track_started=True`, `worker_disable_prefetch=True`, instance-bound tasks, and the broker-only sender.

**Source evidence:** at Celery `v5.6.3`, [`worker/control.py`](https://github.com/celery/celery/blob/v5.6.3/celery/worker/control.py) immediately attempts to write `REVOKED` when processing a revoke. [`backends/base.py`](https://github.com/celery/celery/blob/v5.6.3/celery/backends/base.py) skips later writes over an existing `SUCCESS`, but not `FAILURE`; effective result writes through [`backends/redis.py`](https://github.com/celery/celery/blob/v5.6.3/celery/backends/redis.py) restart the backend TTL. [`app/trace.py`](https://github.com/celery/celery/blob/v5.6.3/celery/app/trace.py) writes `STARTED` before the task body, and `Ignore` prevents the subsequent normal `SUCCESS` write. An ignored duplicate can therefore overwrite a failed task's Celery state with `STARTED`. These are source findings, not tests of the proposed gate.

**Reported experiments:** implementation-side results supplied for review, not independently rerun as part of this change:

- Immediate execution beat a revoke request.
- Offline, restarted, and killed workers lost revocation information in the tested setups.
- Revoking a failed job overwrote `FAILURE`; revoking an unknown ID created a Celery result.
- A running job's progress overwrote `REVOKED`.
- After Redis state loss, a still-running job recreated an incomplete Engine record containing only `finished_at`, which status could not read.

These results justify investigating a different cancellation boundary; they do not establish that every restart loses revokes. Workers can synchronize revokes from peers at startup. [`worker/state.py`](https://github.com/celery/celery/blob/v5.6.3/celery/worker/state.py) persists revoked IDs with `--statedb`, and [`worker/components.py`](https://github.com/celery/celery/blob/v5.6.3/celery/worker/components.py) registers its save on process exit; a killed process may not save its latest state. The in-memory set has a default cap of 50,000 IDs and a 10,800-second expiry applied during set maintenance, not a guaranteed cancellation-retention interval. Worker revoke storage and Redis persistence are separate. The reports do not include the exact shutdown commands, state-file paths, or Redis snapshot settings needed to reproduce every case; those details must accompany any future reproduction rather than being inferred here. Effective Celery result writes renew that result's expiry, not Engine's finish-based public retention.

**Record and transitions:** `Jobs.submit` creates the acceptance fields and `execution_gate=waiting` together before publication. An unconfirmed publication keeps its acceptance record and is cancellable while the gate is still `waiting`. The acceptance fields are the Dataset, target, and usable submission timestamp; `queued_at` is optional because publication can be unconfirmed. A missing or unknown gate, missing acceptance fields, invalid timestamps, or inconsistent gate/outcome/finish metadata makes a record unusable. Missing records are unknown, not usable empty records. There is no permanent legacy execution branch or `legacy_job` response after the development transition.

Use small [Redis Lua operations](https://redis.io/docs/latest/develop/programmability/eval-intro/) to validate the existing record before changing it. The validation and conditional writes occur atomically, with no separate existence check and no WATCH/MULTI retry loop:

| Operation | Required state                                              | Atomic change                                                                                                                         |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Start     | Usable acceptance, `waiting`, no outcome or finish metadata | Change the gate to `started`; grant permission only to this delivery.                                                                 |
| Cancel    | Usable acceptance, `waiting`, no outcome or finish metadata | Change the gate to `cancelled`; record `outcome=cancelled`, UTC `finished_at`, and the 31-day TTL.                                    |
| Finish    | Usable acceptance, `started`, no outcome or finish metadata | Record explicit `outcome=completed` or `failed`, UTC `finished_at`, the original exception type only for failure, and the 31-day TTL. |

No operation creates a missing record or overwrites an existing decision or outcome. `completed` is written only after canonical export and Core package validation. The worker's exception metadata moves into the same finish operation; it must not use an earlier unconditional `HSET`. Existing outcomes retain their timestamp and expiry. Unfinished records still have no TTL; stale-record policy remains separate work.

**Execution and uncertainty:** place the start gate before Dataset invocation and outside ordinary execution/finalization. Only a confirmed winning response permits computation. Cancelled or duplicate deliveries and missing/unusable records raise `Ignore` without invoking the Dataset, installing its progress callback, finalizing the job, or touching its package. A failed or lost start response also grants no permission and causes no automatic execution retry; record diagnostics and leave uncertain lifecycle resolution separate. `started` is permission, not liveness. There is at most one start winner per surviving record, not exactly-once computation or protection against lost/rolled-back Redis state.

**Terminal authority:** Engine's explicit outcome decides completed, failed, and cancelled public status before Celery metadata is interpreted. Never infer successful completion from `finished_at` or the absence of `error_type`. This supersedes the Task 11 decision that Celery is authoritative and that a recorded finish can appear as running: duplicate `STARTED` writes must not hide a recorded failure. Celery still supplies observed state and progress without an Engine outcome. Do not turn a Celery-only failure into running or invent finish metadata; pool/whole-worker loss and other incomplete states remain separate lifecycle work. A package requires Engine-confirmed completion. `REVOKED` alone cannot become cancelled. Status reads must preserve these rules when the record changes during polling.

**API:** implement authenticated `POST /api/v1/jobs/{job_id}/cancel`, without a body, following the [DESIGN.md response table](DESIGN.md#cancellation). A successful response contains `job_id`, `status_url`, and `result` (`cancelled` or `already_finished`). Recorded terminal outcomes take precedence over a `started` gate. A start winner without an outcome gets `409 execution_started`; an absent or publicly expired record gets `404`; Redis errors, uncertain responses, and unusable records get `503`. A `503` does not say whether cancellation took effect: poll. No route sends a revoke.

Cancelled status includes its recorded finish time and no progress, error, or package. Package download returns `409` until the job publicly expires, then `404`. All public job routes expire cancellation after 30 periods of 24 hours; the record lasts 31 days. Repeated cancellation, polling, and eventual delivery do not reset either deadline. Delivery after the record disappears still cannot compute.

**One-time development transition:** the approved policy discards local job history, queued messages, Celery results, and packages when this implementation is introduced. Task 19 ran it on the development machine. Before cancellation code reaches the source mount, stop the API and warm-stop all old workers, allowing active computation to finish and confirming process exit. Keep Redis running; clear only the development Compose project's Engine DB 0. Identify the project's package volume, remove the stopped API/worker containers referencing it, and remove only that `engine-packages` volume. Then apply, rebuild, and start the new API and worker together before resuming submissions. Preserve DB 1, Postgres, and unrelated storage. Use the [README procedure](../../README.md#engine-cancellation-transition), including its stop-timeout and volume-reference requirements. This removes the need for permanent legacy handling; it is not a routine restart policy. Every consumer of these queues must enforce the gate before cancellation is exposed, including future deployments.

**Verification to implement, not results:** write tests first and confirm each fails for missing behavior rather than setup/import errors. Existing test expectations may change only after the proposed change and reason are reviewed and approved. Use isolated test Redis and real prefork workers for race and delivery checks, with observable Dataset execution counts:

- Cancellation wins: zero Dataset executions, confirmed cancelled status, and no package.
- Start wins: `409`, and the original computation continues normally.
- Concurrent and repeated cancels: one outcome and unchanged finish time/expiry.
- Unconfirmed submission: cancellation settles a usable waiting record; any later delivery skips it.
- Cancel without a worker, then start/restart the worker: delivery cannot compute.
- Late delivery before public expiry, after public expiry, and after record removal: no computation or record recreation.
- Duplicate delivery while running and after failure or completion: no second computation, changed outcome, extended expiry, or modified package. Exercise Celery's pre-body `STARTED` write.
- Lost cancellation response: polling observes the recorded outcome; no false assertion that cancellation failed.
- Failed/lost start response: no computation by that delivery. Redis failure never grants permission.
- Record loss while running, followed by success or exception: finalization does not recreate it. Existing terminal records cannot be overwritten.
- Terminal, unknown, expired, missing-gate, malformed, and inconsistent records: the specified HTTP outcomes, no accidental execution, and no uncaught status parsing errors.
- Engine outcomes override Celery metadata; a timestamp without an explicit outcome is never treated as completion. Preserve existing submission, progress, package-validation, authentication, and retention behavior outside the deliberate terminal-authority change.

After targeted checks, run the full Engine suite, production checks with token checks, and `pnpm check`. Record passed, failed, skipped, and not-run results separately. No gate tests, reset procedure, or cancellation runtime acceptance have been run for this documentation change. Worker-loss detection, stale-state retention, general state normalization, and automatic orphan/expired-package cleanup are not completed by this cancellation section.

**Expansion** (2026-10-13): Task 17 adds the start gate and the recorded outcomes, Task 18 the cancel route, and Task 19 the development transition and the checks through the worker service. Before they were written, their code and tests ran in a scratch copy of the Engine, in the development image at the pinned Core and Sim, against a Redis 8 of its own. With the 2a code, 21 of Task 17's 23 new tests failed, each on the behavior it specifies; the other 2 pin 2a behavior that stays. With Task 17's code, all 23 of Task 18's tests failed on the missing route. With both, the whole suite gave 111 passed in three runs in a row, in about 30 s. The prototype also showed two defects of the 2a code: `status` raises `TypeError` when Celery's state is `SUCCESS` and the record has no finish time, and `KeyError` when it is `REVOKED`. Both become `503`.

**Interfaces verified for the tasks** (2026-10-13, in the development image: Celery 5.6.3, kombu 5.6.2, redis-py 6.4.0; Redis 8):

- Celery's tracer (`celery/app/trace.py`, `build_tracer`) stores `STARTED` before the task body when `task_track_started` is set and the task is not eager. `Ignore` raised in the body gives the state `IGNORED` and skips `mark_as_done`, so no result is stored. The prototype's prefork runs confirmed both: a skipped delivery leaves `STARTED`, which replaces a stored `FAILURE` but not a `SUCCESS`.
- `Task.apply(args=..., task_id=...)` (`celery/app/task.py`) runs the same tracer in the calling process. It stores no `STARTED` and no result, because `task_store_eager_result` is false, does not raise the task's exception, because `task_eager_propagates` is false, and returns an `EagerResult` whose `state` is `IGNORED`, `SUCCESS`, or `FAILURE`. In the task, `celery.current_task.request.id` is the given `task_id`.
- redis-py 6.4.0: `Redis.register_script(script)` returns a `Script`. Calling it with `keys=` and `args=` sends `EVALSHA` and loads the script on `NoScriptError` (`redis/commands/core.py`, `Script.__call__`). With `decode_responses=True`, a Lua string reply is a `str`.
- Redis Lua (Redis 8, Lua 5.1): a script runs atomically; `HMGET` gives `false` for a missing field; `unpack` is available; `EXPIRE` takes seconds.
- Kombu's Redis transport delivers a queue's messages in the order they were sent (`LPUSH`, `BRPOP`). Task 14's test relies on this already: on a one-process worker, a job sent last completes after every earlier delivery is handled.

**Decisions for the tasks** (proposed with them):

- `Jobs.read_record` checks the whole record in Python: the Dataset, the target, a submission time that parses with a UTC offset, a known gate, an outcome the gate allows, a finish time exactly when there is an outcome, and an error type exactly when the outcome is `failed`. Starting and cancelling call it first and then run their Lua script, which checks atomically what can still change: whether the record exists, its gate, its outcome, and its finish time. The acceptance fields never change once written: submission writes them and the gate in one `HSET` and later adds only `queued_at`. So checking them outside the script keeps each decision atomic, and the scripts parse no timestamps. The finish script checks only that the record exists, that its gate is `started`, and that it has no outcome or finish time: it relies on the acceptance fields that the claim checked, which have not changed since. DESIGN.md's Cancellation section says so.
- `status` keeps its read order, Celery's state first and the record second. The worker records the outcome before Celery stores a terminal state, so a terminal state read first implies an outcome in the record read second, and a job that finishes between the two reads is reported with its recorded outcome. Without an outcome, `PENDING`, `STARTED`, `PROGRESS`, and `FAILURE` translate as in 2a; `SUCCESS` and every other Celery state, such as `REVOKED`, answer `503`. A failure that Celery recorded without Engine's outcome, such as a lost pool process, stays `failed` with no finish time and an error type of null; resolving it is the remaining lifecycle work.
- The worker claims the job before it installs the progress callback, and a delivery that does not claim it, for any reason, raises `Ignore`. After the package validates, or after an exception, the finish script records the outcome. If it answers that the record is gone or no longer claimed, the task raises `Ignore`, so Celery stores no terminal state. If Redis does not answer it, the error propagates, and the outcome may or may not be recorded. A package whose outcome was not recorded stays on disk for the orphan cleanup of the remaining lifecycle work.
- The cancel route answers `200` with `job_id`, `status_url`, and `result`; `409` with a `detail` that holds `result: execution_started` and a message; `404` with the status route's message; and `503` with a message saying that whether the job is cancelled is unknown and that the consumer should poll it.
- Tests of the gate's decisions run the job's task in the test process with `Task.apply`. It runs the same task function without a worker, so these tests are deterministic. Tests that need Celery's `STARTED` write, a second delivery of a message, or real timing use the prefork worker of `test_redelivery.py`, whose module stays separate for the reason Task 14 gives; a job submitted last shows when earlier deliveries are done.
- The race test cannot choose the winner. In the prototype, the start won all 10 attempts on an idle worker (7 answered `already_finished`, 3 `execution_started`). The test checks that every attempt ends in one of the three consistent outcomes; the test that cancels before any worker exists pins the cancellation winning.
- Existing tests: `test_job_routes_reject_missing_tokens` gains the cancel route; `counting_dataset` gains `fail`; `prefork_jobs` deletes the release key when it starts, because the module now has several tests that gate jobs and each test's teardown sets the key; `test_redelivery.py`'s docstring covers its new tests. No existing expectation changes. `test_status_read_while_the_job_finishes_is_consistent` stays as it is: its simulated finish comes after both of Engine's reads, so it passes with either code; the new `test_status_read_while_the_job_finishes_reports_its_outcome` covers a finish between them.
- The one-time development transition runs in Task 19, before `pnpm dev:engine` first serves the new code. Tasks 17 and 18 use only `pnpm engine:check`, whose database 1 the transition leaves alone. They need `pnpm dev:engine` stopped, because its API reloads mounted source and its worker does not.

### Task 17: Run a job only when its delivery claims it, and record its outcome

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py` (`find_job`)
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes:
  - From Tasks 10 to 14: `Jobs(redis_url, target, package_dir)`, `Jobs.submit`, `Jobs.status`, `Jobs.package_path`, `Jobs.records`, `Jobs.sender`, `Jobs.celery_app`, `record_key`, `RUN_DATASET`, `RETENTION`, and `RECORD_LIFETIME`.
  - From the tests: the `client`, `jobs`, `prefork_jobs`, and `counting_dataset` fixtures, and `submit`, `triangle`, `wait_for`, `wait_until_completed`, `runs_key`, `BOUNDS`, `SMOKE`, and `AUTHORIZED`.
  - From Celery: `celery.exceptions.Ignore` and `TaskRevokedError`, `celery.current_task`, and `Task.apply`. From redis-py: `Redis.register_script`.
- Produces:
  - `Jobs.submit` writes `execution_gate=waiting` with the acceptance fields.
  - `Jobs.read_record(job_id)`: the record with parsed timestamps, or None; raises `JobStateUnavailable` for an unusable record.
  - `Jobs.claim(job_id) -> bool` and `Jobs.finish(job_id, outcome, error_type="")`, through `Jobs.start_script` and `Jobs.finish_script`.
  - `Jobs.status` takes a terminal state from the recorded outcome and raises `JobStateUnavailable` when it cannot establish the state; the status and download routes answer it with `503`.
  - `parse_time`, `JobStateUnavailable`, `CELERY_STATES` (replacing `STATES`), `OUTCOMES`, `START`, and `FINISH` in `dtcc_engine.jobs`.

- [x] **Step 1: Check that the development engine is stopped**

Run: `docker compose --profile engine ps --status running --services`
Expected: neither `engine` nor `engine-worker` is listed. If either is, stop both as step 1 of the README's transition says, and clear nothing: the transition is Task 19's. The API reloads mounted source and the worker does not, so a running pair would serve the new status code with the old worker.

- [x] **Step 2: Write the tests**

In `apps/engine/tests/test_jobs.py`, replace `import pytest` and `from celery import Celery` with:

```python
import pytest
import redis
from celery import Celery, current_task
from celery.exceptions import TaskRevokedError
```

Add after the `failing_dataset` fixture:

```python
@pytest.fixture
def probe_dataset(jobs: Jobs) -> Iterator[tuple[str, list[str]]]:
    """Register a Dataset that records the ID of each job it runs for, and return its name and that list.

    `fail` makes it raise; `lose_record` makes it delete its job's record first, as Redis losing its data would.
    """
    runs: list[str] = []

    class ProbeArgs(DatasetBaseArgs):
        fail: bool = False
        lose_record: bool = False

    class ProbeDataset(DatasetDescriptor):
        name = "engine_probe"
        description = "Dataset defined by an Engine test that records its runs"
        ArgsModel = ProbeArgs

        def build(self, args):
            runs.append(current_task.request.id)
            if args.lose_record:
                jobs.records.delete(record_key(current_task.request.id))
            if args.fail:
                raise RuntimeError("probe failure")
            return triangle()

    try:
        yield "engine_probe", runs
    finally:
        unregister("engine_probe")


def deliver(jobs: Jobs, job_id: str, request: dict) -> str:
    """Run the job's task in this process, as a worker does with a delivered message, and return Celery's state.

    Unlike a worker, this stores no state in the result backend.
    """
    task = jobs.celery_app.tasks[RUN_DATASET]
    return task.apply(args=[request["dataset"], request["parameters"]], task_id=job_id).state


FINISHED_AT = "2026-10-13T12:00:00+00:00"
# Changes that make a submitted job's record unusable; None deletes the field.
UNUSABLE_CHANGES = {
    "no-gate": {"execution_gate": None},
    "unknown-gate": {"execution_gate": "paused"},
    "no-dataset": {"dataset": None},
    "unreadable-submission-time": {"submitted_at": "yesterday"},
    "finish-time-without-outcome": {"finished_at": FINISHED_AT},
    "outcome-of-a-waiting-job": {"outcome": "completed", "finished_at": FINISHED_AT},
    "failure-without-type": {"execution_gate": "started", "outcome": "failed", "finished_at": FINISHED_AT},
}


def change_record(jobs: Jobs, job_id: str, changes: dict[str, str | None]) -> None:
    for field, value in changes.items():
        if value is None:
            jobs.records.hdel(record_key(job_id), field)
        else:
            jobs.records.hset(record_key(job_id), field, value)
```

Add after `test_status_read_while_the_job_finishes_is_consistent`:

```python
def test_status_read_while_the_job_finishes_reports_its_outcome(jobs: Jobs, monkeypatch: pytest.MonkeyPatch) -> None:
    job_id = jobs.submit("smoke", {"bounds": BOUNDS})
    # Celery's backend is per thread, so this test reads the status in its own thread rather than through the API.
    read_celery_state = jobs.celery_app.backend.get_task_meta

    def finish_after_the_read(task_id: str, *args, **kwargs) -> dict:
        meta = read_celery_state(task_id, *args, **kwargs)
        # The job finishes between Engine's two reads: the worker records the outcome, then Celery stores SUCCESS.
        outcome = {"execution_gate": "started", "outcome": "completed", "finished_at": datetime.now(UTC).isoformat()}
        jobs.records.hset(record_key(job_id), mapping=outcome)
        jobs.celery_app.backend.mark_as_done(job_id, None)
        return meta

    monkeypatch.setattr(jobs.celery_app.backend, "get_task_meta", finish_after_the_read)
    job = jobs.status(job_id)
    assert (job["state"], job["finished_at"] is not None) == ("completed", True)
```

Add at the end of the file:

```python
@pytest.mark.parametrize(("fail", "outcome"), [(False, "completed"), (True, "failed")])
def test_job_delivered_again_does_not_run_again(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], fail: bool, outcome: str
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS, "fail": fail}}
    job_id = submit(client, request)
    deliver(jobs, job_id, request)
    key = record_key(job_id)
    record, lifetime = jobs.records.hgetall(key), jobs.records.ttl(key)
    package = None if fail else jobs.package_path(job_id).read_bytes()
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == [job_id]
    assert (record.get("outcome"), record.get("error_type")) == (outcome, "RuntimeError" if fail else None)
    assert jobs.records.hgetall(key) == record
    assert jobs.records.ttl(key) <= lifetime
    assert (None if fail else jobs.package_path(job_id).read_bytes()) == package


def test_delivery_of_a_job_another_delivery_claimed_does_not_run_it(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]]
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS}}
    job_id = submit(client, request)
    # Another delivery of the same message claimed the job and is running it.
    jobs.records.hset(record_key(job_id), "execution_gate", "started")
    record = jobs.records.hgetall(record_key(job_id))
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == []
    assert jobs.records.hgetall(record_key(job_id)) == record


@pytest.mark.parametrize("changes", UNUSABLE_CHANGES.values(), ids=UNUSABLE_CHANGES.keys())
def test_unusable_record_is_reported_unavailable_and_never_runs(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], changes: dict[str, str | None]
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS}}
    job_id = submit(client, request)
    change_record(jobs, job_id, changes)
    record = jobs.records.hgetall(record_key(job_id))
    polled = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    downloaded = client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert (polled.status_code, downloaded.status_code) == (503, 503)
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == []
    assert jobs.records.hgetall(record_key(job_id)) == record


@pytest.mark.parametrize("fail", [False, True], ids=["completing", "failing"])
def test_record_lost_while_the_job_runs_is_not_recreated(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], fail: bool
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS, "fail": fail, "lose_record": True}}
    job_id = submit(client, request)
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == [job_id]
    assert not jobs.records.exists(record_key(job_id))


@pytest.mark.parametrize("claimed", [False, True], ids=["before-the-claim", "after-the-claim"])
def test_claim_without_an_answer_does_not_run_the_job(
    client: TestClient,
    jobs: Jobs,
    probe_dataset: tuple[str, list[str]],
    monkeypatch: pytest.MonkeyPatch,
    claimed: bool,
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS}}
    job_id = submit(client, request)

    def lose_the_answer(*args, **kwargs):
        # Redis fails before it runs the claim, or runs it and its answer is lost.
        if claimed:
            jobs.records.hset(record_key(job_id), "execution_gate", "started")
        raise redis.ConnectionError("connection lost before Redis answered")

    monkeypatch.setattr(jobs, "start_script", lose_the_answer, raising=False)
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == []
    assert "outcome" not in jobs.records.hgetall(record_key(job_id))


@pytest.mark.parametrize(("fail", "outcome"), [(False, "completed"), (True, "failed")])
def test_recorded_outcome_prevails_over_celery_state(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], fail: bool, outcome: str
) -> None:
    dataset, _ = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS, "fail": fail}}
    job_id = submit(client, request)
    deliver(jobs, job_id, request)
    # A later delivery of the same message: Celery stores STARTED before the task can decline to run.
    jobs.celery_app.backend.store_result(job_id, {"pid": 0, "hostname": "duplicate"}, "STARTED")
    job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
    assert (job["state"], job["error"]) == (outcome, {"type": "RuntimeError"} if fail else None)
    assert job["finished_at"] is not None
    assert (job["package"] is None) == fail


@pytest.mark.parametrize(
    ("celery_state", "result", "state"),
    [("STARTED", {"pid": 0, "hostname": "worker"}, "running"), ("FAILURE", RuntimeError("worker lost"), "failed")],
)
def test_celery_state_is_reported_without_a_recorded_outcome(
    client: TestClient, jobs: Jobs, celery_state: str, result: object, state: str
) -> None:
    # A failure Celery recorded without Engine's outcome, such as a lost pool process, gets no invented finish time.
    job_id = submit(client, SMOKE)
    jobs.celery_app.backend.store_result(job_id, result, celery_state)
    job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
    assert (job["state"], job["finished_at"]) == (state, None)


@pytest.mark.parametrize(("celery_state", "result"), [("SUCCESS", None), ("REVOKED", TaskRevokedError("revoked"))])
def test_celery_success_or_revocation_alone_is_unavailable(
    client: TestClient, jobs: Jobs, celery_state: str, result: object
) -> None:
    # Engine records the outcome before Celery stores SUCCESS, and Engine sends no revoke.
    job_id = submit(client, SMOKE)
    jobs.celery_app.backend.store_result(job_id, result, celery_state)
    assert client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).status_code == 503
```

In `apps/engine/tests/test_redelivery.py`, replace the module docstring's first line with:

```python
"""Tests of how often a job runs when the worker receives it once or again.
```

and, in its last sentence, "The test has its own module" with "The tests have their own module". Replace `from dtcc_engine.jobs import Jobs` with:

```python
from dtcc_engine.jobs import RUN_DATASET, Jobs, record_key
```

Replace the `counting_dataset` fixture with:

```python
@pytest.fixture
def counting_dataset(redis_url: str) -> Iterator[str]:
    """Register a Dataset that counts its runs in Redis by label, waits for the release key if `gated`, and raises if
    `fail`."""

    class CountingProbeArgs(DatasetBaseArgs):
        label: str
        gated: bool = False
        fail: bool = False

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
            if args.fail:
                raise RuntimeError("probe failure")
            return Mesh(
                vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]])
            )

    try:
        yield "engine_counting_probe"
    finally:
        unregister("engine_counting_probe")
```

Add after `wait_until_completed`:

```python
def wait_until_finished(jobs: Jobs, job_id: str) -> dict:
    wait_for(lambda: jobs.status(job_id)["state"] in ("completed", "failed"))
    return jobs.status(job_id)
```

Add at the end of the file:

```python
@pytest.mark.parametrize("fail", [False, True], ids=["completed", "failed"])
def test_job_delivered_again_after_it_finished_does_not_run_again(
    prefork_jobs: Jobs, counting_dataset: str, fail: bool
) -> None:
    records = prefork_jobs.records
    label = "failed" if fail else "completed"
    parameters = {"bounds": BOUNDS, "label": label, "fail": fail}
    job_id = prefork_jobs.submit(counting_dataset, parameters)
    finished = wait_until_finished(prefork_jobs, job_id)
    record, lifetime = records.hgetall(record_key(job_id)), records.ttl(record_key(job_id))
    package = None if fail else prefork_jobs.package_path(job_id).read_bytes()
    # The job's message again, as a broker that delivers it a second time would send it.
    prefork_jobs.sender.send_task(RUN_DATASET, args=[counting_dataset, parameters], task_id=job_id, queue="prefork")
    # Sent after the second delivery, so it runs after it.
    last = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": f"after-{label}"})
    wait_until_completed(prefork_jobs, last)
    assert records.get(runs_key(label)) == "1"
    assert prefork_jobs.status(job_id) == finished
    assert records.hgetall(record_key(job_id)) == record
    assert records.ttl(record_key(job_id)) <= lifetime
    assert (None if fail else prefork_jobs.package_path(job_id).read_bytes()) == package
    # The second delivery's STARTED replaced a failure in Celery's result, though not a success.
    celery_state = prefork_jobs.celery_app.backend.get_task_meta(job_id)["status"]
    assert celery_state == ("STARTED" if fail else "SUCCESS")
```

- [x] **Step 3: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_jobs.py tests/test_redelivery.py`
Expected: 21 failed and 28 passed. Each failure is on the behavior the test specifies:

- the second delivery's state is `SUCCESS` or `FAILURE` rather than `IGNORED`, because the job runs again, a claimed job runs, a lost record is recreated, or a delivery without an answer to its claim runs (`test_job_delivered_again_does_not_run_again`, `test_delivery_of_a_job_another_delivery_claimed_does_not_run_it`, `test_record_lost_while_the_job_runs_is_not_recreated`, `test_claim_without_an_answer_does_not_run_the_job`);
- an unusable record's status and download answer `200` and `409`, or, for the record without a Dataset, the status read raises `KeyError: 'dataset'` (`test_unusable_record_is_reported_unavailable_and_never_runs`);
- the status is `running` where Engine recorded the outcome (`test_recorded_outcome_prevails_over_celery_state`), or `queued` with a finish time (`test_status_read_while_the_job_finishes_reports_its_outcome`);
- the status read raises `TypeError` for `SUCCESS` and `KeyError: 'REVOKED'` for `REVOKED` (`test_celery_success_or_revocation_alone_is_unavailable`);
- the second delivery after a finish runs the Dataset again, so the count is `'2'` (`test_job_delivered_again_after_it_finished_does_not_run_again`).

Both cases of `test_celery_state_is_reported_without_a_recorded_outcome` pass: they pin 2a behavior that stays. Stop and report if any test fails in another way, or if another test passes.

- [x] **Step 4: Gate execution and record outcomes**

In `apps/engine/dtcc_engine/jobs.py`, replace the module docstring with:

```python
"""Asynchronous Dataset jobs on one compute target.

A job runs one Dataset in a Celery worker and delivers its realization as a canonical Dataset
Package. Celery owns the queue and task results; Engine keeps its own record of each job in the
same Redis, which decides whether a delivery may run the Dataset and records how the job ended.
"""
```

Replace `from celery import Celery, Task` with:

```python
from celery import Celery, Task
from celery.exceptions import Ignore
```

Replace the `STATES` dictionary with:

```python
# Celery's states of a job without a recorded outcome; SUCCESS follows the outcome, so it never appears alone.
CELERY_STATES = {"PENDING": "queued", "STARTED": "running", "PROGRESS": "running", "FAILURE": "failed"}
# The outcomes a record can hold with each value of its execution gate.
OUTCOMES = {"waiting": {None}, "started": {None, "completed", "failed"}, "cancelled": {"cancelled"}}
# Gives permission to run the job's Dataset to the delivery that changes its gate from waiting to started.
START = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if gate ~= 'waiting' or outcome or finished then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'execution_gate', 'started')
return 'started'
"""
# Records how a started job ended: ARGV is the outcome, the finish time, the record's lifetime, and the error type.
FINISH = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if gate ~= 'started' or outcome or finished then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'outcome', ARGV[1], 'finished_at', ARGV[2])
if ARGV[4] ~= '' then
  redis.call('HSET', KEYS[1], 'error_type', ARGV[4])
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'recorded'
"""
```

Add before `class UnconfirmedSubmission`:

```python
def parse_time(value: str) -> datetime:
    """Parse a timestamp Engine wrote.

    Raises:
        ValueError: If the value is not an ISO 8601 timestamp with a UTC offset.
    """
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError(f"Timestamp {value!r} has no UTC offset")
    return parsed


class JobStateUnavailable(Exception):
    """Engine's record of a job is unusable, or Celery's state cannot be trusted without the record's outcome."""
```

In `Jobs.__init__`, replace the line that creates `self.records` with:

```python
        self.records = redis.Redis.from_url(redis_url, decode_responses=True)
        self.start_script = self.records.register_script(START)
        self.finish_script = self.records.register_script(FINISH)
```

In `Jobs.submit`, replace the call that records the job with:

```python
        self.records.hset(
            key,
            mapping={
                "dataset": dataset_name,
                "target": self.target,
                "submitted_at": submitted_at,
                "execution_gate": "waiting",
            },
        )
```

Replace `Jobs.status` with:

```python
    def read_record(self, job_id: str) -> dict[str, Any] | None:
        """Return Engine's record of the job with its timestamps parsed, or None if the job has no record.

        Raises:
            JobStateUnavailable: If the record lacks an acceptance field or its gate, or its fields contradict each
                other.
            redis.RedisError: If Redis is unreachable.
        """
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        try:
            outcome = record.get("outcome")
            consistent = (
                outcome in OUTCOMES[record["execution_gate"]]
                and ("finished_at" in record) == (outcome is not None)
                and ("error_type" in record) == (outcome == "failed")
            )
            if not consistent:
                raise JobStateUnavailable(job_id)
            return {
                "dataset": record["dataset"],
                "target": record["target"],
                "submitted_at": parse_time(record["submitted_at"]),
                "queued_at": parse_time(record["queued_at"]) if "queued_at" in record else None,
                "outcome": outcome,
                "finished_at": parse_time(record["finished_at"]) if outcome else None,
                "error_type": record.get("error_type"),
            }
        except (KeyError, ValueError) as error:
            raise JobStateUnavailable(job_id) from error

    def status(self, job_id: str) -> dict[str, Any] | None:
        """Return the job's state, progress, error, and package, or None if the job is unknown or expired.

        Raises:
            JobStateUnavailable: If the job's state cannot be established from its record and Celery's state.
            redis.RedisError: If Redis is unreachable, so the state is unknown for now.
        """
        # Read before the record: the worker records an outcome before Celery stores a terminal state.
        meta = self.celery_app.backend.get_task_meta(job_id)
        record = self.read_record(job_id)
        if record is None:
            return None
        finished_at = record["finished_at"]
        if finished_at is not None and datetime.now(UTC) >= finished_at + RETENTION:
            return None
        state = record["outcome"] or CELERY_STATES.get(meta["status"])
        if state is None:
            raise JobStateUnavailable(job_id)
        if state == "queued" and record["queued_at"] is None:
            state = "unconfirmed"
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"].isoformat(),
            "finished_at": finished_at.isoformat() if finished_at else None,
            "state": state,
            "progress": meta["result"] if state == "running" and meta["status"] == "PROGRESS" else None,
            "error": {"type": record["error_type"]} if state == "failed" else None,
            "package": (
                {"available": self.package_path(job_id).is_file(), "expires_at": (finished_at + RETENTION).isoformat()}
                if state == "completed"
                else None
            ),
        }
```

Replace `Jobs.run` with:

```python
    def run(self, task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
        """Run a job in the worker if this delivery claims it, and record how the job ended.

        The job invokes the Dataset, exports its realization, and validates the package.

        Raises:
            Ignore: If this delivery does not claim the job, or the job's record is gone or no longer claimed when the
                job ends; Celery then stores no result.
            Exception: Whatever the Dataset, the export, or the validation raised; the job then fails.
        """
        job_id = task.request.id
        if not self.claim(job_id):
            raise Ignore()
        path = self.package_path(job_id)
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
            self.finish(job_id, "failed", type(error).__name__)
            raise
        finally:
            set_progress_callback(previous_callback)
        self.finish(job_id, "completed")

    def claim(self, job_id: str) -> bool:
        """Claim permission to run the job's Dataset, which only one caller gets, and only while the job is waiting.

        A claim whose answer Redis did not send is not repeated: it may have been made.
        """
        try:
            # Checks the acceptance fields, which never change once written; the claim checks the rest.
            self.read_record(job_id)
            answer = self.start_script(keys=[record_key(job_id)])
        except (JobStateUnavailable, redis.RedisError):
            logger.warning("Job %s does not run: its record is unusable or Redis did not answer", job_id, exc_info=True)
            return False
        if answer != "started":
            logger.warning("Job %s does not run: its record is %s", job_id, answer)
        return answer == "started"

    def finish(self, job_id: str, outcome: str, error_type: str = "") -> None:
        """Record how a claimed job ended, with its finish time, and start its record's lifetime.

        Raises:
            Ignore: If the job's record is gone or no longer claimed, so no outcome was recorded.
            redis.RedisError: If Redis did not answer; the outcome may or may not be recorded.
        """
        finished_at = datetime.now(UTC).isoformat()
        lifetime = int(RECORD_LIFETIME.total_seconds())
        answer = self.finish_script(keys=[record_key(job_id)], args=[outcome, finished_at, lifetime, error_type])
        if answer != "recorded":
            logger.warning("Job %s %s, but its record is %s, so the outcome is not recorded", job_id, outcome, answer)
            raise Ignore()
```

- [x] **Step 5: Answer an unusable record with `503`**

In `apps/engine/dtcc_engine/api.py`, replace the import from `dtcc_engine.jobs` with:

```python
from dtcc_engine.jobs import Jobs, JobStateUnavailable, UnconfirmedSubmission, jobs_from_environment
```

Replace `find_job` with:

```python
    def find_job(job_id: str) -> dict[str, Any]:
        try:
            job = jobs.status(job_id)
        except RedisError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Job state is temporarily unavailable"
            ) from None
        except JobStateUnavailable:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Job state cannot be established"
            ) from None
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return job
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 88 passed: the 65 earlier tests and the 23 new ones.

- [x] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: the production checks pass with `engine-redis` in their own Compose project, and their token checks pass; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately.

- [x] **Step 8: Stop for review**

Record Task 17's results in Increment 4's status, leave the changes uncommitted, and report Steps 1, 3, 6, and 7. Suggested commit message: `Feature: Gated engine jobs and recorded their outcomes`.

### Task 18: Cancel a job that no delivery has claimed

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/dtcc_engine/api.py`
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `README.md` (job routes)
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes: from Task 17, `Jobs.read_record`, `JobStateUnavailable`, `parse_time`, `RECORD_LIFETIME`, and the record fields; the test helpers `deliver`, `probe_dataset`, `UNUSABLE_CHANGES`, `change_record`, and `wait_until_finished`.
- Produces:
  - `Jobs.cancel(job_id)`: `cancelled`, `already_finished`, or None; raises `ExecutionStarted`, `JobStateUnavailable`, or `redis.RedisError`. It runs `Jobs.cancel_script`, the `CANCEL` script.
  - `ExecutionStarted` in `dtcc_engine.jobs`.
  - `POST /api/v1/jobs/{job_id}/cancel`, authenticated, without a body, answering as DESIGN.md's table says.

- [x] **Step 1: Write the tests**

In `apps/engine/tests/test_jobs.py`, replace `from collections.abc import Callable, Iterator` with:

```python
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
```

Replace `from fastapi.testclient import TestClient` with:

```python
from fastapi.testclient import TestClient
from httpx import Response
```

In the parameters of `test_job_routes_reject_missing_tokens`, replace the list of routes with:

```python
    [
        ("POST", "/api/v1/jobs"),
        ("GET", "/api/v1/jobs/some-job"),
        ("GET", "/api/v1/jobs/some-job/package"),
        ("POST", "/api/v1/jobs/some-job/cancel"),
    ],
```

Add at the end of the file:

```python
def cancel(client: TestClient, job_id: str) -> Response:
    return client.post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTHORIZED)


def test_queued_job_is_cancelled_and_stays_cancelled(client: TestClient, jobs: Jobs) -> None:
    job_id = submit(client, SMOKE)
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: cancel(client, job_id), range(8)))
    record, lifetime = jobs.records.hgetall(record_key(job_id)), jobs.records.ttl(record_key(job_id))
    again = cancel(client, job_id)
    job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
    downloaded = client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    expected = {"job_id": job_id, "status_url": f"/api/v1/jobs/{job_id}", "result": "cancelled"}
    assert [(response.status_code, response.json()) for response in [*responses, again]] == [(200, expected)] * 9
    assert (job["state"], job["finished_at"], job["progress"], job["error"], job["package"]) == (
        "cancelled",
        record["finished_at"],
        None,
        None,
        None,
    )
    assert downloaded.status_code == 409
    assert jobs.records.hgetall(record_key(job_id)) == record
    assert RETENTION.total_seconds() < jobs.records.ttl(record_key(job_id)) <= lifetime


def test_unconfirmed_submission_can_be_cancelled(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    def lose_the_confirmation(*args, **kwargs):
        raise OperationalError("connection lost before the broker replied")

    monkeypatch.setattr(jobs.sender, "send_task", lose_the_confirmation)
    job_id = client.post("/api/v1/jobs", json=SMOKE, headers=AUTHORIZED).json()["detail"]["job_id"]
    response = cancel(client, job_id)
    assert (response.status_code, response.json().get("result")) == (200, "cancelled")
    assert client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()["state"] == "cancelled"
    # The message may have been queued after all.
    assert deliver(jobs, job_id, SMOKE) == "IGNORED"


@pytest.mark.parametrize(
    ("age", "status_code", "package_status_code"),
    [(RETENTION - timedelta(minutes=1), 200, 409), (RETENTION + timedelta(seconds=1), 404, 404)],
    ids=["within-retention", "after-retention"],
)
def test_cancelled_job_expires_after_the_retention(
    client: TestClient, jobs: Jobs, age: timedelta, status_code: int, package_status_code: int
) -> None:
    job_id = submit(client, SMOKE)
    assert cancel(client, job_id).status_code == 200
    # Moves the recorded finish time back instead of waiting 30 days.
    jobs.records.hset(record_key(job_id), "finished_at", (datetime.now(UTC) - age).isoformat())
    polled = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    downloaded = client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert (cancel(client, job_id).status_code, polled.status_code) == (status_code, status_code)
    assert downloaded.status_code == package_status_code


@pytest.mark.parametrize(("fail", "state"), [(False, "completed"), (True, "failed")])
def test_finished_job_is_reported_already_finished(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], fail: bool, state: str
) -> None:
    dataset, _ = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS, "fail": fail}}
    job_id = submit(client, request)
    deliver(jobs, job_id, request)
    record = jobs.records.hgetall(record_key(job_id))
    response = cancel(client, job_id)
    assert (response.status_code, response.json().get("result")) == (200, "already_finished")
    assert client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()["state"] == state
    assert jobs.records.hgetall(record_key(job_id)) == record


def test_claimed_job_cannot_be_cancelled(client: TestClient, jobs: Jobs) -> None:
    job_id = submit(client, SMOKE)
    # A delivery claimed the job: it is running, or about to run.
    jobs.records.hset(record_key(job_id), "execution_gate", "started")
    record = jobs.records.hgetall(record_key(job_id))
    response = cancel(client, job_id)
    assert response.status_code == 409
    assert response.json()["detail"]["result"] == "execution_started"
    assert jobs.records.hgetall(record_key(job_id)) == record


@pytest.mark.parametrize("changes", UNUSABLE_CHANGES.values(), ids=UNUSABLE_CHANGES.keys())
def test_cancel_of_an_unusable_record_is_unavailable_and_changes_nothing(
    client: TestClient, jobs: Jobs, changes: dict[str, str | None]
) -> None:
    job_id = submit(client, SMOKE)
    change_record(jobs, job_id, changes)
    record = jobs.records.hgetall(record_key(job_id))
    assert cancel(client, job_id).status_code == 503
    assert jobs.records.hgetall(record_key(job_id)) == record


def test_cancel_of_an_unknown_job_is_not_found(client: TestClient) -> None:
    response = cancel(client, str(uuid.uuid4()))
    assert response.status_code == 404
    assert "unknown or expired" in response.json()["detail"]


def test_lost_cancel_answer_leaves_the_outcome_to_polling(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = submit(client, SMOKE)

    def cancel_then_lose_the_answer(*args, **kwargs):
        # Redis cancels the job, and its answer is lost.
        outcome = {"execution_gate": "cancelled", "outcome": "cancelled", "finished_at": datetime.now(UTC).isoformat()}
        jobs.records.hset(record_key(job_id), mapping=outcome)
        raise redis.ConnectionError("connection lost before Redis answered")

    monkeypatch.setattr(jobs, "cancel_script", cancel_then_lose_the_answer, raising=False)
    response = cancel(client, job_id)
    assert response.status_code == 503
    assert "poll" in response.json()["detail"]
    assert client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()["state"] == "cancelled"


@pytest.mark.parametrize("record_age", ["within-retention", "after-retention", "removed"])
def test_delivery_after_cancellation_never_runs(
    client: TestClient, jobs: Jobs, probe_dataset: tuple[str, list[str]], record_age: str
) -> None:
    dataset, runs = probe_dataset
    request = {"dataset": dataset, "parameters": {"bounds": BOUNDS}}
    job_id = submit(client, request)
    assert cancel(client, job_id).status_code == 200
    if record_age == "after-retention":
        old = (datetime.now(UTC) - RETENTION - timedelta(seconds=1)).isoformat()
        jobs.records.hset(record_key(job_id), "finished_at", old)
    elif record_age == "removed":
        jobs.records.delete(record_key(job_id))
    record, lifetime = jobs.records.hgetall(record_key(job_id)), jobs.records.ttl(record_key(job_id))
    assert deliver(jobs, job_id, request) == "IGNORED"
    assert runs == []
    assert jobs.records.hgetall(record_key(job_id)) == record
    assert jobs.records.ttl(record_key(job_id)) <= lifetime
```

In `apps/engine/tests/test_redelivery.py`, replace the module docstring's first line with:

```python
"""Tests of how often a job runs when the worker receives it once, again, or after the job was cancelled.
```

Replace the imports from `dtcc_core.model` to `dtcc_engine.jobs` with:

```python
from dtcc_core.model import Mesh
from fastapi.testclient import TestClient
from kombu import Connection

from dtcc_engine.api import create_app
from dtcc_engine.jobs import RUN_DATASET, Jobs, record_key
```

Replace the `BOUNDS` line with:

```python
BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
```

Replace the `prefork_jobs` fixture with:

```python
@pytest.fixture
def prefork_jobs(redis_url: str, tmp_path: Path, counting_dataset: str) -> Iterator[Jobs]:
    """Jobs served by a one-process prefork worker; a gated job is released at the latest when the test ends."""
    jobs = Jobs(redis_url, "prefork", tmp_path)
    # An earlier test released its gated jobs.
    jobs.records.delete(RELEASE_KEY)
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        try:
            yield jobs
        finally:
            jobs.records.set(RELEASE_KEY, 1)
```

Add at the end of the file:

```python
def cancel(jobs: Jobs, job_id: str) -> tuple[int, str]:
    """Cancel the job through the API, and return the status code and the result it reports."""
    response = TestClient(create_app(TOKEN, jobs)).post(f"/api/v1/jobs/{job_id}/cancel", headers=AUTHORIZED)
    body = response.json()
    return response.status_code, body["detail"]["result"] if isinstance(body.get("detail"), dict) else body.get(
        "result"
    )


def test_job_cancelled_before_a_worker_runs_never_runs(redis_url: str, tmp_path: Path, counting_dataset: str) -> None:
    jobs = Jobs(redis_url, "late-worker", tmp_path)
    job_id = jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "cancelled"})
    assert cancel(jobs, job_id) == (200, "cancelled")
    # The decision is in Redis, so a worker that starts, or starts again, after the cancellation sees it.
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        last = jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "after-cancelled"})
        wait_until_completed(jobs, last)
    assert jobs.records.get(runs_key("cancelled")) is None
    assert jobs.status(job_id)["state"] == "cancelled"
    assert not jobs.package_path(job_id).exists()
    # The skipped delivery's STARTED, which the recorded cancellation overrides.
    assert jobs.celery_app.backend.get_task_meta(job_id)["status"] == "STARTED"


def test_started_job_cannot_be_cancelled_and_completes(prefork_jobs: Jobs, counting_dataset: str) -> None:
    records = prefork_jobs.records
    job_id = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "started", "gated": True})
    wait_for(lambda: records.get(runs_key("started")) == "1")
    assert cancel(prefork_jobs, job_id) == (409, "execution_started")
    records.set(RELEASE_KEY, 1)
    wait_until_completed(prefork_jobs, job_id)
    assert records.get(runs_key("started")) == "1"
    assert prefork_jobs.status(job_id)["package"]["available"]


def test_cancel_racing_the_start_either_prevents_the_run_or_is_refused(
    prefork_jobs: Jobs, counting_dataset: str
) -> None:
    records = prefork_jobs.records
    attempts = {}
    for attempt in range(10):
        label = f"race-{attempt}"
        job_id = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": label})
        attempts[label] = (job_id, cancel(prefork_jobs, job_id))
        if attempts[label][1] != (200, "cancelled"):
            wait_until_completed(prefork_jobs, job_id)
    # Sent last, so every earlier delivery, run or skipped, is done when it completes.
    last = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "race-last"})
    wait_until_completed(prefork_jobs, last)
    outcomes = [
        (*answer, records.get(runs_key(label)), prefork_jobs.status(job_id)["state"])
        for label, (job_id, answer) in attempts.items()
    ]
    assert set(outcomes) <= {
        (200, "cancelled", None, "cancelled"),
        (409, "execution_started", "1", "completed"),
        (200, "already_finished", "1", "completed"),
    }, outcomes
```

- [x] **Step 2: Run the tests to verify they fail for the right reason**

Run: `pnpm engine:check tests/test_jobs.py tests/test_redelivery.py`
Expected: 23 failed and 49 passed. Every failure comes from the missing route, which FastAPI answers with `404 Not Found`: the tests get `404` where they expect `200`, `409`, `503`, or, without a token, `401`, and the unknown job's test gets FastAPI's message instead of "unknown or expired". Stop and report if a test fails in another way.

- [x] **Step 3: Cancel in Redis**

In `apps/engine/dtcc_engine/jobs.py`, add after the `FINISH` script:

```python
# Cancels a job no delivery has claimed: ARGV is the finish time and the record's lifetime.
CANCEL = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if outcome then
  return 'finished'
end
if gate == 'started' and not finished then
  return 'started'
end
if gate ~= 'waiting' or finished then
  return 'unusable'
end
redis.call('HSET', KEYS[1], 'execution_gate', 'cancelled', 'outcome', 'cancelled', 'finished_at', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 'cancelled'
"""
```

Add after `class JobStateUnavailable`:

```python
class ExecutionStarted(Exception):
    """A delivery claimed the job, which has no recorded outcome yet, so it can no longer be cancelled."""
```

In `Jobs.__init__`, replace the line that registers `FINISH` with:

```python
        self.finish_script = self.records.register_script(FINISH)
        self.cancel_script = self.records.register_script(CANCEL)
```

Add before `Jobs.run`:

```python
    def cancel(self, job_id: str) -> str | None:
        """Cancel a job that no delivery has claimed.

        Returns:
            `cancelled` if the job is cancelled, now or before; `already_finished` if it completed or failed; None if
            the job is unknown or expired.

        Raises:
            ExecutionStarted: If a delivery claimed the job, and it has not finished.
            JobStateUnavailable: If the job's record is unusable.
            redis.RedisError: If Redis did not answer; the job may or may not be cancelled.
        """
        # Checks the acceptance fields, which never change once written; the cancellation checks the rest.
        if self.read_record(job_id) is None:
            return None
        finished_at = datetime.now(UTC).isoformat()
        answer = self.cancel_script(keys=[record_key(job_id)], args=[finished_at, int(RECORD_LIFETIME.total_seconds())])
        if answer == "started":
            raise ExecutionStarted(job_id)
        if answer == "unusable":
            raise JobStateUnavailable(job_id)
        # A recorded outcome never changes, so this read sees the one the cancellation found or made.
        record = self.read_record(job_id)
        if record is None or datetime.now(UTC) >= record["finished_at"] + RETENTION:
            return None
        return "cancelled" if record["outcome"] == "cancelled" else "already_finished"
```

- [x] **Step 4: Serve the cancel route**

In `apps/engine/dtcc_engine/api.py`, replace the import from `dtcc_engine.jobs` with:

```python
from dtcc_engine.jobs import ExecutionStarted, Jobs, JobStateUnavailable, UnconfirmedSubmission, jobs_from_environment
```

Add before the package route, `@app.get("/api/v1/jobs/{job_id}/package", ...)`:

```python
    @app.post("/api/v1/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
    def cancel_job(job_id: str) -> dict[str, str]:
        try:
            result = jobs.cancel(job_id)
        except (RedisError, JobStateUnavailable):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Job state is unavailable, so whether the job is cancelled is unknown; poll the job",
            ) from None
        except ExecutionStarted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "result": "execution_started",
                    "message": "Execution permission has been claimed, so the job can no longer be cancelled",
                },
            ) from None
        if result is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return {"job_id": job_id, "status_url": f"/api/v1/jobs/{job_id}", "result": result}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 111 passed: Task 17's 88 and the 23 new ones.

- [x] **Step 6: Document the route**

In `README.md`, after "and download a completed job's package from `GET /api/v1/jobs/<job id>/package`.", add: "Cancel a job before a worker claims it with `POST /api/v1/jobs/<job id>/cancel`. For a job a worker has claimed, cancellation answers `409` until the job has finished, and then `200` with `already_finished`."

Run: `npx --yes prettier@3.9.6 --check README.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [x] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [x] **Step 8: Stop for review**

Record Task 18's results in Increment 4's status, leave the changes uncommitted, and report Steps 2, 5, and 7. Suggested commit message: `Feature: Added engine job cancellation before execution`.

### Task 19: Move the development engine to the gate and cancel through the worker service

**Files:**

- Modify: `README.md` (the transition section)
- Modify: `apps/engine/DESIGN.md` (its link to that section)
- Modify: `apps/engine/PLAN.md` (that link, the transition's state, and Increment 4 status)

**Interfaces:** consumes Tasks 17 and 18 and the README's transition procedure. Produces no code: the development engine runs the gate, with its earlier jobs and packages discarded, and the README describes the transition for developers whose engine still has jobs from before it.

- [x] **Step 1: Ask before the transition**

The transition deletes the development engine's job records, queued jobs, Celery results, and packages. Its policy was approved on 2026-10-13; running it now needs the user's go-ahead. Stop until the user gives it.

- [x] **Step 2: Run the transition**

Follow the README's procedure with these commands, from the repository root:

1. `docker compose --profile engine ps -a --format '{{.Service}} {{.State}}'`. Expected: `engine` and `engine-worker` are not running (Task 17, Step 1). If either is, stop as the README's step 1 says.
2. `docker compose --profile engine up -d --wait engine-redis`, then `docker compose --profile engine exec -T engine-redis redis-cli -n 1 DBSIZE` and the same with `-n 0`; record both sizes. Then `docker compose --profile engine exec -T engine-redis redis-cli -n 0 FLUSHDB`. Expected: `OK`; database 0 then has size 0, and database 1 has the size it had.
3. Find the package volume from the containers that these Compose commands manage, because a project-name override (`-p`, `COMPOSE_PROJECT_NAME`, or `.env`) changes their names: `docker inspect --format '{{.Name}} {{index .Config.Labels "com.docker.compose.project"}}{{range .Mounts}}{{if eq .Destination "/var/lib/dtcc-engine/packages"}} {{.Name}}{{end}}{{end}}' $(docker compose --profile engine ps -aq engine engine-worker)`. Expected: the `engine` and `engine-worker` containers of one project, both mounting one volume, here called `<package volume>` (`dtcc-twin_engine-packages` without an override).
4. `docker volume inspect --format '{{index .Labels "com.docker.compose.project"}} {{index .Labels "com.docker.compose.volume"}}' <package volume>`. Expected: that project and `engine-packages`. Then `docker ps -a --filter volume=<package volume> --format '{{.Names}} {{.State}}'`. Expected: only those two containers, neither running. Stop and report any other result.
5. `docker compose --profile engine rm -f engine engine-worker`, then `docker volume rm <package volume>`.
6. `docker volume ls --filter label=com.docker.compose.project=<that project>`. Expected: the project's `postgres-data` volume remains.

- [x] **Step 3: Describe the transition as current**

In `README.md`, in the transition section:

- Replace the heading with `### Engine cancellation transition`.
- Replace its first paragraph with: "A development engine whose Redis holds jobs from before [cancellation](apps/engine/DESIGN.md#cancellation) needs the one-time transition below: those jobs' records have no execution gate, so the engine neither runs nor reports them. The transition discards old job history, queued jobs, Celery results, and stored packages. It is not a routine restart procedure or a production migration."
- In step 1, replace "**Before applying the cancellation code**" with "**Before applying the cancellation code, or at once if it is applied**".
- Replace step 4's first sentence with "Rebuild and start the Engine API and worker together with `pnpm dev:engine`, with the cancellation code applied."
- Delete the last paragraph's final sentence, "This transition has not been run or runtime-verified as part of the documentation change."

In `apps/engine/DESIGN.md` and in this file, replace `README.md#engine-cancellation-transition-planned` with `README.md#engine-cancellation-transition`. In the Cancellation section's "One-time development transition" paragraph, replace "It has not been executed." with "Task 19 ran it on the development machine."

- [x] **Step 4: Cancel through the worker service**

Start `pnpm dev:engine` and wait until the worker logs that it is ready. With the development token, and the bounds `[319891, 6399790, 320091, 6399990]`:

1. Submit `city_volume_mesh`, then `smoke`. While the first is `running`, cancel the second, then the first. Expected: `200` with `result` `cancelled` for `smoke`, and `409` with `execution_started` for `city_volume_mesh`. Once `city_volume_mesh` is `completed`, its package downloads; `smoke` stays `cancelled`, its download answers `409`, and the worker's log says that it does not run because its record is `refused`.
2. Stop the worker with `docker compose --profile engine stop engine-worker`. Submit `smoke` and cancel it: `200` with `cancelled`. Start the worker with `docker compose --profile engine start engine-worker`, wait until it is ready, and submit another `smoke` job. Expected: the second completes; the first stays `cancelled`, with no package, and the worker's log says that it does not run. A Celery revoke sent while no worker ran was lost in the 2026-10-13 experiments; this checks that the gate is not.
3. `docker compose --profile engine exec -T engine-redis redis-cli -n 0 TTL dtcc-engine:job:<a cancelled job's ID>`. Expected: between 2,592,000 and 2,678,400 seconds.

Stop `pnpm dev:engine`. Expected: the worker logs a warm shutdown.

- [x] **Step 5: Validate**

Run: `pnpm engine:check`, `pnpm engine:check:prod`, `npx --yes prettier@3.9.6 --check README.md apps/engine/DESIGN.md apps/engine/PLAN.md`, then `pnpm check`.
Expected: 111 passed; the production and token checks pass; the files use Prettier code style; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately.

- [x] **Step 6: Stop for review**

Record Task 19's results in Increment 4's status, including the outcome of each check in Step 4 and the database sizes from Step 2. Leave the changes uncommitted, and report Steps 2, 4, and 5. Suggested commit message: `Docs: Moved the development engine to job cancellation`.

### Remaining lifecycle work

**Expansion** (2026-10-13): the rest of increment 4 is expanded one task at a time, each committed and reviewed before the next is written; a later task may change once the earlier ones are reviewed. Each was first run in a scratch copy of the Engine, as Tasks 17 to 19 were. Their first review asked for changes to each, and the revisions of 2026-10-14 were run the same way: Task 20 reports neither the upstream failure's target nor its message; Task 21 validates a claim before the worker's startup check uses it; Task 22 records the broker's confirmation only on a record that still exists, and states that expiry does not stop a running job; Task 23 deletes staging directories only when the worker starts; and Task 24 runs its restarts in a Compose project of its own, against a Redis snapshot it saves. Their second review, of 2026-10-15, accepted Tasks 20, 21, and 23. The revisions of the same day answer it: Task 22's warning about a record lost while the job was sent says only that the confirmation is not recorded, since a delivery may have claimed the job before the loss; and Task 24 stops only the development API, leaving the development worker and its job running, and stops Redis only once the running job's claim is recorded. Their third review accepted Tasks 20 to 23. For Task 24 it asked that the outage check rest on the job's reported progress before the outage and its recorded finish after it, not on a stored claim or the times of Celery's log lines; the revision of the same day does so, and its fourth review accepted it. The tasks:

- Task 20: a failed job reports Core's metadata of an upstream failure, without the parts that can hold a credential (Failure reporting row).
- Task 21: a lost pool process, and a whole worker that is lost and started again, leave a recorded failure rather than a job that reports `running` for ever (Failure reporting and Restart behavior rows).
- Task 22: records of jobs that never finish expire (stale-state retention).
- Task 23: each host deletes expired packages and packages without a completed job (Retention row).
- Task 24: separate API, worker, and broker restarts are checked with real Redis and workers (Restart behavior row).

### Task 20: Report an upstream failure's metadata without its credentials

A failed job reports only its exception type (Increment 2a). Core gives its live Datasets a typed `DatasetUpstreamError` and `DatasetDescriptor.serialize_upstream_error`, which turns one into JSON-safe metadata; Engine decides which of it a consumer sees (this increment's upstream interfaces). This task returns that metadata for a job that failed with one, without the parts that can hold a credential: the Failure reporting row's useful error information, within DESIGN.md's rule that no error response exposes the API token or provider credentials.

**Interfaces verified for the task** (2026-10-13, at Core `17c6efe` and Sim `41055d5`, through `git show` in the reference checkouts):

- `DatasetUpstreamError(*, dataset, operation, target, failure_class, status_code=None, message)` is a `RuntimeError` in `dtcc_core/datasets/dataset.py`; `dtcc_core.datasets` does not export it. Its `is_transient` is true for the failure classes `connection`, `timeout`, and `http_5xx`.
- `DatasetDescriptor.serialize_upstream_error(exc)` returns `dataset`, `operation`, `target`, `failure_class`, `status_code`, `message`, and `is_transient`.
- `DatasetDescriptor.build_upstream_error` sets the message to `f"{dataset} {operation} failed for {target}: {exc}"`, where `exc` is the requests exception, and a requests `HTTPError`'s text holds the full request URL, query included. Trafiklab's GTFS requests send the API key as the `key` query parameter (`dtcc_core/datasets/transport/trafiklab_gtfs.py`), so a message can hold it.
- Callers pass as the target a request URL without its query parameters, built from a constant or from a Dataset's `base_url` argument, which a consumer can set (`weather.py`, `ocean.py`, `hydrology.py`, `air_quality.py`); a provider name (`transport/base.py`); or a description such as the requested bounds (`transit_vehicles.py`).
- Sim raises no `DatasetUpstreamError` at `41055d5`.

**Decisions** (proposed with the task):

- A job that failed with a `DatasetUpstreamError` reports `error.upstream`: Core's serialized metadata without `message` and `target`, so its Dataset, operation, failure class, status code, and transience. Both can hold a credential: the message a request URL's query, and the target whatever a consumer gave in a Dataset's `base_url`, in its user information, path, or query; Core does not promise otherwise. Engine does not parse a target to remove credentials, because it could not show that the rest holds none, and a target that does not parse would keep the job's failure from being recorded. The Dataset and the operation already name the provider and the request. Every other failure keeps `{"type": ...}` alone. The worker's log keeps the full error (DESIGN.md, Failure reporting).
- The worker computes the metadata, and the finish script records it with the outcome as `error_upstream`, in JSON. A record holds it only with `outcome=failed`; one that is unreadable, or that holds it with another outcome, is unusable.
- Only the raised exception is checked, not the exceptions it was raised from: Core raises the typed error itself.
- Existing tests: `UNUSABLE_CHANGES` gains two records, so both parametrized unusable-record tests cover them; no expectation changes.

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes: from Task 17, the `FINISH` script, `Jobs.read_record`, `Jobs.status`, `Jobs.run`, and `Jobs.finish`; the test helpers `submit`, `deliver`, `UNUSABLE_CHANGES`, and the `client` and `jobs` fixtures. From Core: `DatasetUpstreamError` and `DatasetDescriptor.serialize_upstream_error`.
- Produces: `public_upstream_error(error)` in `dtcc_engine.jobs`; the record field `error_upstream`, the `FINISH` script's fifth argument, and `Jobs.finish(job_id, outcome, error_type="", upstream=None)`; a failed job's `error.upstream` in its status.

- [ ] **Step 1: Write the tests**

In `apps/engine/tests/test_jobs.py`, replace `from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, load_model_package, unregister` with:

```python
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, load_model_package, unregister
from dtcc_core.datasets.dataset import DatasetUpstreamError
```

Replace the `SMOKE` line with:

```python
SMOKE = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}
PROVIDER_KEY = "provider-key-5e1d"
```

In `UNUSABLE_CHANGES`, add after the `failure-without-type` entry:

```python
    "upstream-detail-without-failure": {
        "execution_gate": "started",
        "outcome": "completed",
        "finished_at": FINISHED_AT,
        "error_upstream": "{}",
    },
    "unreadable-upstream-detail": {
        "execution_gate": "started",
        "outcome": "failed",
        "finished_at": FINISHED_AT,
        "error_type": "DatasetUpstreamError",
        "error_upstream": "not json",
    },
```

Add before `deliver`:

```python
@pytest.fixture
def upstream_failing_dataset() -> Iterator[str]:
    """Register a Dataset that fails as Core's live Datasets do when their provider fails, and return its name.

    Its message repeats a provider key, as a request URL's query can, and its target is the one requested.
    """

    class UpstreamProbeArgs(DatasetBaseArgs):
        target: str

    class UpstreamProbeDataset(DatasetDescriptor):
        name = "engine_upstream_probe"
        description = "Dataset defined by an Engine test whose provider fails"
        ArgsModel = UpstreamProbeArgs

        def build(self, args):
            raise DatasetUpstreamError(
                dataset="engine_upstream_probe",
                operation="fetch",
                target=args.target,
                failure_class="http_4xx",
                status_code=401,
                message=f"401 Client Error: Unauthorized for url: https://provider.example/data?key={PROVIDER_KEY}",
            )

    try:
        yield "engine_upstream_probe"
    finally:
        unregister("engine_upstream_probe")
```

Add at the end of the file:

```python
@pytest.mark.parametrize(
    "target",
    [
        f"https://user:{PROVIDER_KEY}@provider.example:8443/data?key={PROVIDER_KEY}",
        f"//user:{PROVIDER_KEY}@provider.example/data",
        f"https://provider.example/{PROVIDER_KEY}/data",
        f"https://[{PROVIDER_KEY}/data",
    ],
    ids=["url", "url-without-scheme", "key-in-path", "malformed-url"],
)
def test_upstream_failure_reports_cores_metadata_without_credentials(
    client: TestClient, jobs: Jobs, upstream_failing_dataset: str, target: str
) -> None:
    request = {"dataset": upstream_failing_dataset, "parameters": {"bounds": BOUNDS, "target": target}}
    job_id = submit(client, request)
    assert deliver(jobs, job_id, request) == "FAILURE"
    response = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    job = response.json()
    assert job["error"] == {
        "type": "DatasetUpstreamError",
        "upstream": {
            "dataset": "engine_upstream_probe",
            "operation": "fetch",
            "failure_class": "http_4xx",
            "status_code": 401,
            "is_transient": False,
        },
    }
    assert job["finished_at"] is not None
    assert PROVIDER_KEY not in response.text
```

- [ ] **Step 2: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_jobs.py`
Expected: 8 failed and 66 passed. The four cases of `test_upstream_failure_reports_cores_metadata_without_credentials` get `{"type": "DatasetUpstreamError"}` without `upstream`. With the two new unusable records, `test_unusable_record_is_reported_unavailable_and_never_runs` gets `200` and `409` for status and download instead of `503`, and `test_cancel_of_an_unusable_record_is_unavailable_and_changes_nothing` gets `200` instead of `503`. Stop and report if a test fails in another way.

- [ ] **Step 3: Record and report the metadata**

In `apps/engine/dtcc_engine/jobs.py`, replace `import logging` with:

```python
import json
import logging
```

Replace the import from `dtcc_core.common.progress` with:

```python
from dtcc_core.common.progress import get_progress_callback, set_progress_callback
from dtcc_core.datasets.dataset import DatasetUpstreamError
```

Replace the comment above the `FINISH` script with:

```python
# Records how a started job ended: ARGV is the outcome, the finish time, the record's lifetime, the error type, and the
# upstream failure's metadata.
```

In the `FINISH` script, add before `redis.call('EXPIRE', KEYS[1], ARGV[3])`:

```python
if ARGV[5] ~= '' then
  redis.call('HSET', KEYS[1], 'error_upstream', ARGV[5])
end
```

Add before `class JobStateUnavailable`:

```python
def public_upstream_error(error: DatasetUpstreamError) -> dict[str, Any]:
    """Return Core's metadata of an upstream failure without its message and its target, which can hold credentials.

    The message can repeat a request URL with its query, which can hold a provider key, and the target can be built
    from a Dataset's base URL, which a consumer sets and which can hold a credential anywhere in it.
    """
    metadata = datasets.DatasetDescriptor.serialize_upstream_error(error)
    del metadata["message"], metadata["target"]
    return metadata
```

In `Jobs.read_record`, replace the assignment to `consistent` with:

```python
            consistent = (
                outcome in OUTCOMES[record["execution_gate"]]
                and ("finished_at" in record) == (outcome is not None)
                and ("error_type" in record) == (outcome == "failed")
                and ("error_upstream" not in record or outcome == "failed")
            )
```

and, in the dictionary it returns, replace the `error_type` entry with:

```python
                "error_type": record.get("error_type"),
                "error_upstream": json.loads(record["error_upstream"]) if "error_upstream" in record else None,
```

In `Jobs.status`, add before `return {`:

```python
        error = {"type": record["error_type"]} if state == "failed" else None
        if error is not None and record["error_upstream"] is not None:
            error["upstream"] = record["error_upstream"]
```

and replace its `error` entry with `"error": error,`. In `Jobs.run`, replace the `except Exception as error:` clause with:

```python
        except Exception as error:
            upstream = public_upstream_error(error) if isinstance(error, DatasetUpstreamError) else None
            self.finish(job_id, "failed", type(error).__name__, upstream)
            raise
```

Replace `Jobs.finish` with:

```python
    def finish(self, job_id: str, outcome: str, error_type: str = "", upstream: dict[str, Any] | None = None) -> None:
        """Record how a claimed job ended, with its finish time and error, and start its record's lifetime.

        Raises:
            Ignore: If the job's record is gone or no longer claimed, so no outcome was recorded.
            redis.RedisError: If Redis did not answer; the outcome may or may not be recorded.
        """
        finished_at = datetime.now(UTC).isoformat()
        lifetime = int(RECORD_LIFETIME.total_seconds())
        details = json.dumps(upstream) if upstream else ""
        answer = self.finish_script(
            keys=[record_key(job_id)], args=[outcome, finished_at, lifetime, error_type, details]
        )
        if answer != "recorded":
            logger.warning("Job %s %s, but its record is %s, so the outcome is not recorded", job_id, outcome, answer)
            raise Ignore()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 119 passed: the 111 earlier tests and the 8 new cases.

- [ ] **Step 5: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [ ] **Step 6: Stop for review**

Record Task 20's results in Increment 4's status, leave the changes uncommitted, and report Steps 2, 4, and 5. Suggested commit message: `Feature: Reported engine upstream failures without credentials`.

### Task 21: Record a failure when the process or the worker run that claimed a job is lost

A job's claim is the only record of who runs it. When the claimant dies, nothing records an outcome: a lost pool process leaves Celery's `FAILURE` without Engine's outcome, reported as failed with an error type of null and no finish time, and a lost worker leaves `STARTED`, reported as running for ever (the experiments of 2026-10-13). This task records who claimed each job, and records a failure when that claimant is provably gone: the pool process of this worker run no longer exists, or the same worker started again. The Failure reporting and Restart behavior rows ask for host failures to be reported without false claims that work stopped, so a worker that never returns leaves its jobs as they were.

**Interfaces verified for the task** (2026-10-13, in the development image's Celery 5.6.3 source and in the prototype):

- When a pool process dies, the worker's main process runs `Request.on_failure` with `WorkerLostError`: it stores `FAILURE` and sends `task_failure` with the task as sender, `task_id`, and the exception (`celery/worker/request.py`). For an ordinary exception, `task_failure` is sent in the pool process instead, where Engine has already recorded the outcome.
- Celery's signals identify a receiver by its function, so bound methods of two objects share one identity, and the second `connect` is ignored unless it passes its own `dispatch_uid` (`celery/utils/dispatch/signal.py`, `_make_id`). The prototype first lost the receiver of every `Jobs` after the first this way.
- `worker_ready` is sent only by the command-line worker (`celery/apps/worker.py`, `on_consumer_ready`), not by `start_worker`'s `TestWorkController`. A worker bootstep, a `bootsteps.StartStopStep` added to `app.steps["worker"]`, starts in both, with the worker as its argument; its `hostname` is the node name. The blueprint calls each step's `start` without catching what it raises (`celery/bootsteps.py`, `Blueprint.start`): in the prototype, a check that split a malformed claim raised `ValueError`, and the test worker never started.
- The prefork pool's processes are initialized with the worker's node name (`celery/concurrency/prefork.py`, `process_initializer(app, hostname)`), which a task reads as `task.request.hostname`; the experiments' `STARTED` results from a command-line worker held `celery@<container host name>`. In `start_worker`'s test worker, the prototype's claims held the bare host name instead, so the automated restart test records its earlier run's claims itself; Step 6 checks a command-line worker.
- A Compose service's `hostname` sets the container's host name, which Celery's default node name `celery@%h` uses.

**Decisions** (proposed with the task):

- The claim records `claimed_by`, "`<node name> <worker run> <pool process ID>`", in the same `HSET` that changes the gate. The worker run is a random ID that each `Jobs` instance makes, so a worker's pool processes, forked from its main process, share it, and a worker started again has a new one.
- A claimant is gone if it is a pool process of this worker run that no longer exists, which the worker's main process checks when Celery reports `WorkerLostError` for the job; the job then fails with `WorkerLostError`. When a worker starts, every job claimed by an earlier run with the same node name, and without an outcome, fails with `WorkerRestarted`. A lost process that still appears to exist, because the pool has not reaped it yet or its ID was reused, leaves its job as it was: a failure Engine misses, never one it invents. The prototype ran the suite three times without meeting that case: Celery reports the loss after the pool has reaped the process.
- A new Lua script records the failure, with the finish time and the record's lifetime, only if the claim it read is still the record's claim and the job has no outcome, so a claim or an outcome written meanwhile stays. A worker whose check meets a Redis error still starts, and the claims are checked when it next starts.
- The claim is part of the record's validation: a record whose `claimed_by` does not hold a node name, a worker run, and a numeric process ID, separated by spaces, is unusable, as is a claim on a job that is not `started`. The worker's check reads each record through that validation and leaves an unusable record as it is, with a warning, so no record can keep a worker from starting, and an incomplete record gets no outcome. The Lua script still checks the claim and the outcome when it writes.
- A job whose worker is lost and never started again keeps reporting `running`: Engine cannot prove that the work stopped. Task 22 bounds how long its record stays.
- The development worker gets the fixed host name `engine-worker`. A deployment's workers each need a stable node name that no other running worker uses, and a worker may start under its node name only once its earlier run, with that run's pool processes, has stopped: the name tells a worker's runs apart, but does not show that an earlier run stopped. Increment 5b records it, and DESIGN.md's Restart behavior says so. Two running workers with one node name would fail each other's jobs when one restarts.
- Existing tests: `UNUSABLE_CHANGES` gains a claim on a waiting job, a claim without its three parts, and a claim whose process ID is not a number; `counting_dataset` gains `crash`; `test_redelivery.py`'s docstring covers the new tests. No expectation changes.

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `compose.yaml` (`engine-worker`)
- Modify: `apps/engine/DESIGN.md` (Restart behavior)
- Modify: `apps/engine/PLAN.md` (Increment 4 status, increment 5b)

**Interfaces:**

- Consumes: from Tasks 17 and 20, the `START` script, `Jobs.claim`, `Jobs.run`, `Jobs.read_record`, and the record fields; the test helpers `counting_dataset`, `prefork_jobs`, `wait_until_finished`, `wait_until_completed`, `UNUSABLE_CHANGES`. From Celery: `task_failure`, `WorkerLostError`, `bootsteps.StartStopStep`, and `start_worker(..., hostname=...)`.
- Produces: the record field `claimed_by`; `Jobs.worker_run`; `Jobs.claim(job_id, claim)`; the `LOST` script and `Jobs.lost_script`; `Jobs.record_lost_process` and `Jobs.record_lost_claims(node=None, job_ids=None)`; the worker bootstep `RecordLostClaims`; `parse_claim(claim)` and `process_alive(pid)`; `claimed_by` in what `Jobs.read_record` returns; the error types `WorkerLostError` and `WorkerRestarted`.

- [ ] **Step 1: Write the tests**

In `apps/engine/tests/test_jobs.py`, in `UNUSABLE_CHANGES`, add before the `unreadable-upstream-detail` entry:

```python
    "claim-of-a-waiting-job": {"claimed_by": "celery@engine-test earlier-run 7"},
    "claim-without-its-parts": {"execution_gate": "started", "claimed_by": "earlier-run"},
    "claim-without-a-process-id": {"execution_gate": "started", "claimed_by": "celery@engine-test earlier-run seven"},
```

In `apps/engine/tests/test_redelivery.py`, replace the module docstring's first line with:

```python
"""Tests of how often a job runs when the worker receives it once, again, or after the job was cancelled, and of the
outcome a job gets when the process or the worker run that claimed it is lost.
```

Replace the imports from `import time` to `from pathlib import Path` with:

```python
import os
import signal
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
```

Replace the import from `dtcc_engine.jobs` with:

```python
from dtcc_engine.jobs import RECORD_LIFETIME, RETENTION, RUN_DATASET, Jobs, record_key
```

Replace the `counting_dataset` fixture with:

```python
@pytest.fixture
def counting_dataset(redis_url: str) -> Iterator[str]:
    """Register a Dataset that counts its runs in Redis by label.

    It waits for the release key if `gated`, raises if `fail`, and kills its own process if `crash`.
    """

    class CountingProbeArgs(DatasetBaseArgs):
        label: str
        gated: bool = False
        fail: bool = False
        crash: bool = False

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
            if args.fail:
                raise RuntimeError("probe failure")
            if args.crash:
                os.kill(os.getpid(), signal.SIGKILL)
            return Mesh(
                vertices=np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]), faces=np.array([[0, 1, 2]])
            )

    try:
        yield "engine_counting_probe"
    finally:
        unregister("engine_counting_probe")
```

Add at the end of the file:

```python
def claimed_job(jobs: Jobs, claimant: str) -> str:
    """Record a job that `claimant` claimed and left running, as a worker run lost with it does; return its ID."""
    job_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    acceptance = {"dataset": "smoke", "target": jobs.target, "submitted_at": now, "queued_at": now}
    jobs.records.hset(record_key(job_id), mapping={**acceptance, "execution_gate": "started", "claimed_by": claimant})
    jobs.celery_app.backend.store_result(job_id, {"pid": 7, "hostname": claimant.split()[0]}, "STARTED")
    return job_id


def test_job_whose_pool_process_is_lost_fails_and_the_worker_runs_on(prefork_jobs: Jobs, counting_dataset: str) -> None:
    records = prefork_jobs.records
    job_id = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "crashed", "crash": True})
    wait_until_finished(prefork_jobs, job_id)
    # Celery stores the failure just before the worker's main process records the outcome.
    deadline = time.monotonic() + 5
    while prefork_jobs.status(job_id)["finished_at"] is None and time.monotonic() < deadline:
        time.sleep(0.1)
    job = prefork_jobs.status(job_id)
    assert (job["state"], job["error"]) == ("failed", {"type": "WorkerLostError"})
    assert job["finished_at"] is not None
    assert RETENTION.total_seconds() < records.ttl(record_key(job_id)) <= RECORD_LIFETIME.total_seconds()
    last = prefork_jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "after-crash"})
    wait_until_completed(prefork_jobs, last)


def test_worker_started_again_fails_the_jobs_its_earlier_run_left(
    redis_url: str, tmp_path: Path, counting_dataset: str
) -> None:
    jobs = Jobs(redis_url, "restarted", tmp_path)
    node = "celery@engine-test-restarted"
    left = claimed_job(jobs, f"{node} earlier-run 7")
    elsewhere = claimed_job(jobs, "celery@engine-test-elsewhere earlier-run 7")
    # Unusable records: the worker leaves them as they are, and they do not keep it from starting.
    unusable = [
        claimed_job(jobs, "earlier-run"),
        claimed_job(jobs, f"{node} earlier-run seven"),
        claimed_job(jobs, f"{node} earlier-run 7"),
    ]
    jobs.records.hdel(record_key(unusable[2]), "submitted_at")
    before = [jobs.records.hgetall(record_key(job_id)) for job_id in unusable]
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1, hostname=node):
        last = jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "after-restart"})
        wait_until_completed(jobs, last)
    left_job, elsewhere_job = jobs.status(left), jobs.status(elsewhere)
    assert (left_job["state"], left_job["error"]) == ("failed", {"type": "WorkerRestarted"})
    assert left_job["finished_at"] is not None
    assert RETENTION.total_seconds() < jobs.records.ttl(record_key(left)) <= RECORD_LIFETIME.total_seconds()
    # Another worker's claim: that worker may still be running the job.
    assert (elsewhere_job["state"], elsewhere_job["finished_at"]) == ("running", None)
    assert [jobs.records.hgetall(record_key(job_id)) for job_id in unusable] == before
```

- [ ] **Step 2: Run the tests to verify they fail for the right reasons**

Run: `pnpm engine:check tests/test_jobs.py tests/test_redelivery.py`
Expected: 8 failed and 80 passed. The job whose pool process killed itself is `failed` with `{"type": None}`, from Celery alone; the job an earlier run left is still `running`; and the three records with unusable claims are served, `200` and `409` for status and download, and `200` for cancelling the waiting job and `409` for cancelling the two started ones, where `503` is expected. Stop and report if a test fails in another way.

- [ ] **Step 3: Record claims and the failures of lost claimants**

In `apps/engine/dtcc_engine/jobs.py`, replace the imports from `celery` and `celery.exceptions` with:

```python
from celery import Celery, Task, bootsteps
from celery.exceptions import Ignore, WorkerLostError
from celery.signals import task_failure
```

Replace the comment above the `START` script with:

```python
# Gives permission to run the job's Dataset to the delivery that changes its gate from waiting to started, and
# records its claim: ARGV is the claim, which names the worker's node, the worker run, and the pool process.
```

and, in the script, replace the `HSET` line with:

```lua
redis.call('HSET', KEYS[1], 'execution_gate', 'started', 'claimed_by', ARGV[1])
```

Add after the `CANCEL` script:

```python
# Records the failure of a started job whose claimant is gone, unless its claim changed or it has an outcome:
# ARGV is the claim, the error type, the finish time, and the record's lifetime.
LOST = """
local fields = redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at', 'claimed_by')
local gate, outcome, finished, claim = unpack(fields)
if gate ~= 'started' or outcome or finished or claim ~= ARGV[1] then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'outcome', 'failed', 'finished_at', ARGV[3], 'error_type', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'recorded'
"""
```

Add before `public_upstream_error`:

```python
def parse_claim(claim: str) -> tuple[str, str, int]:
    """Split a claim into the worker's node name, the worker run, and the pool process ID.

    Raises:
        ValueError: If the claim does not hold these three, separated by spaces.
    """
    node, worker_run, pid = claim.split(" ")
    return node, worker_run, int(pid)


def process_alive(pid: int) -> bool:
    """Return whether a process with this ID exists on this host."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True
```

In `Jobs.__init__`, add after the line that registers `CANCEL`:

```python
        self.lost_script = self.records.register_script(LOST)
        # Identifies this run of the worker, so that a worker started again tells its earlier run's claims from its own.
        self.worker_run = uuid4().hex
```

and add after the `run_dataset` task:

```python
        # Celery identifies a method receiver by its function, so without its own ID only one Jobs would receive.
        task_failure.connect(self.record_lost_process, weak=False, dispatch_uid=self.worker_run)
        jobs = self

        class RecordLostClaims(bootsteps.StartStopStep):
            """When the worker starts, records the failure of the jobs that an earlier run of it claimed and left."""

            def start(self, worker: Any) -> None:
                try:
                    jobs.record_lost_claims(node=worker.hostname)
                except redis.RedisError:
                    # The worker still starts; the claims are checked again when it next starts.
                    logger.warning(
                        "Could not check the jobs left by an earlier run of %s", worker.hostname, exc_info=True
                    )

        self.celery_app.steps["worker"].add(RecordLostClaims)
```

In `Jobs.read_record`, add to the conditions of `consistent`, after the `error_upstream` condition:

```python
                and ("claimed_by" not in record or record["execution_gate"] == "started")
```

after the `if not consistent:` statement, add:

```python
            if "claimed_by" in record:
                parse_claim(record["claimed_by"])
```

and, in the dictionary it returns, add after the `error_upstream` entry:

```python
                "claimed_by": record.get("claimed_by"),
```

In `Jobs.run`, replace the line that calls `self.claim` with:

```python
        if not self.claim(job_id, f"{task.request.hostname} {self.worker_run} {os.getpid()}"):
```

Replace `Jobs.claim` with:

```python
    def claim(self, job_id: str, claim: str) -> bool:
        """Claim permission to run the job's Dataset, which only one caller gets, and only while the job is waiting.

        The claim names the worker's node, the worker run, and the pool process. A claim whose answer Redis did not send
        is not repeated: it may have been made.
        """
        try:
            # Checks the acceptance fields, which never change once written; the claim checks the rest.
            self.read_record(job_id)
            answer = self.start_script(keys=[record_key(job_id)], args=[claim])
        except (JobStateUnavailable, redis.RedisError):
            logger.warning("Job %s does not run: its record is unusable or Redis did not answer", job_id, exc_info=True)
            return False
        if answer != "started":
            logger.warning("Job %s does not run: its record is %s", job_id, answer)
        return answer == "started"
```

Add after `Jobs.finish`:

```python
    def record_lost_process(self, sender: Task, task_id: str, exception: BaseException, **kwargs: Any) -> None:
        """Record the failure of a job whose pool process was lost, reported by Celery in the worker's main process."""
        if sender.app is self.celery_app and isinstance(exception, WorkerLostError):
            self.record_lost_claims(job_ids=[task_id])

    def record_lost_claims(self, node: str | None = None, job_ids: list[str] | None = None) -> None:
        """Record the failure of each started job without an outcome whose claimant is gone.

        A claimant is gone if it is a pool process of this worker run that no longer exists (`WorkerLostError`), or,
        with `node`, an earlier run of the worker with that node name (`WorkerRestarted`). Only the claim that was read
        is replaced, so a claim or an outcome recorded meanwhile stays. An unusable record is left as it is.
        """
        if job_ids is None:
            job_ids = [key.removeprefix(record_key("")) for key in self.records.scan_iter(record_key("*"))]
        for job_id in job_ids:
            try:
                record = self.read_record(job_id)
            except JobStateUnavailable:
                logger.warning("Job %s is not checked for a lost claimant: its record is unusable", job_id)
                continue
            if record is None or record["claimed_by"] is None or record["outcome"] is not None:
                continue
            claim = record["claimed_by"]
            claim_node, worker_run, pid = parse_claim(claim)
            if worker_run == self.worker_run and not process_alive(pid):
                error_type = "WorkerLostError"
            elif claim_node == node and worker_run != self.worker_run:
                error_type = "WorkerRestarted"
            else:
                continue
            finished_at = datetime.now(UTC).isoformat()
            lifetime = int(RECORD_LIFETIME.total_seconds())
            answer = self.lost_script(keys=[record_key(job_id)], args=[claim, error_type, finished_at, lifetime])
            if answer == "recorded":
                logger.warning("Job %s failed with %s: %s, which claimed it, is gone", job_id, error_type, claim)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 127 passed: the 119 earlier tests and the 8 new cases.

- [ ] **Step 5: Give the development worker a fixed node name, and document the requirement**

In `compose.yaml`, in the `engine-worker` service, add the `hostname` key and its comment after `platform: linux/amd64`:

```yaml
services:
  engine-worker:
    platform: linux/amd64
    # A fixed host name gives the worker a fixed Celery node name, so that when it starts again it records the failure
    # of the jobs its earlier run left.
    hostname: engine-worker
```

In `apps/engine/DESIGN.md`, add to Restart behavior, after its first paragraph:

```markdown
Engine records a failure for a job whose claimant is gone and can no longer
record an outcome. A job whose pool process is lost fails with
`WorkerLostError`, which Celery reports in the worker's main process. When a
worker starts, each job that an earlier run of the same worker claimed and left
without an outcome fails with `WorkerRestarted`. This needs every worker to have
a stable node name that no other running worker uses, and to start under it
only after its earlier run and that run's processes have stopped. A job whose
worker is lost and not started again keeps the state last recorded, as does a
job whose lost process still appears to exist, because Engine cannot tell
whether the work stopped.
```

In this file, in increment 5b's Scope, add after "the worker containers' Celery-specific health-check override;": "a stable Celery node name for each worker that no other running worker uses, under which a worker starts only after its earlier run stopped (Task 21);".

Run: `npx --yes prettier@3.9.6 --check compose.yaml apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [ ] **Step 6: Lose a worker through the worker service**

Start `pnpm dev:engine` and wait until the worker logs that it is ready; its banner names `celery@engine-worker`. Submit `city_volume_mesh` on `[319891, 6399790, 320091, 6399990]` and wait until it is `running`. Then:

1. `docker compose --profile engine exec -T engine-redis redis-cli -n 0 HGET dtcc-engine:job:<job ID> claimed_by`. Expected: `celery@engine-worker`, a worker run ID, and a process ID.
2. `docker compose --profile engine kill -s KILL engine-worker`. Expected: the job still reports `running`.
3. `docker compose --profile engine start engine-worker`, and wait until it is ready. Expected: the job is `failed` with `{"type": "WorkerRestarted"}` and a finish time, its download answers `409`, and the worker logged that the job failed because its claimant is gone.

Stop `pnpm dev:engine`. If the claim names a host name other than `celery@engine-worker`, or the job stays `running`, stop and report: the restart check depends on the node name.

- [ ] **Step 7: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [ ] **Step 8: Stop for review**

Record Task 21's results in Increment 4's status, including Step 6's observations, leave the changes uncommitted, and report Steps 2, 4, 6, and 7. Suggested commit message: `Feature: Recorded engine jobs lost with their process or worker`.

### Task 22: Expire the records of jobs that never finish

A record gets its lifetime, 31 days, only when its job finishes, is cancelled, or is recorded as lost (Tasks 17, 18, and 21). A record whose job never gets there lives for ever: a job whose message was lost with Redis's data after the record was saved, an unconfirmed submission that was never queued, a job whose worker never returns. Increment 2a decided that a record does not expire while its job is queued or running and left the end of a job lost before completion to this increment. This task gives every record the same lifetime from its submission, and restarts it when a delivery claims the job, so an unfinished record expires 31 days after the later of the two.

**Decisions** (proposed with the task):

- Submission writes the acceptance fields, the gate, and the lifetime in one Redis transaction, so no record exists without a lifetime. The `START` script restarts the lifetime with the claim. A finish, cancellation, or lost claimant sets it again from the finish time, as before.
- The broker's confirmation, `queued_at`, is recorded by a new Lua script, `QUEUED`, only on a record that still exists, and without changing its lifetime, gate, or outcome. The plain `HSET` it replaces would create a record of only `queued_at`, without a lifetime, if the record was lost while the message was sent. Such a submission answers as an unconfirmed one does: `503` with the job's ID, which polling finds unknown. The job is not sent again. A delivery after the loss finds no record to claim and does not run the job, but one may have claimed it before the loss: that delivery runs the job and, as after an expiry, cannot record its outcome or deliver its package. The warning therefore says only that the confirmation is not recorded.
- The lifetime is `RECORD_LIFETIME`, 31 days. A job that waits in the queue, or runs, for longer loses its record: it is then unknown, and a later delivery does not run it. The expiry bounds the record and is not a finding that the job stopped: it neither cancels nor stops a run, and a run that finishes after it cannot record its outcome or deliver its package, which is left for Task 23's cleanup. A job that finishes within the bound keeps the usual retention, its package for 30 days from the finish and its record a day longer. Engine has no bound on queue waits or run times, and none of the measured jobs comes near one. DESIGN.md's Restart behavior states this.
- This supersedes Increment 2a's decision that a record does not expire while its job is queued or running. `test_job_records_outlast_the_package_retention` asserted that rule for a queued job, a TTL of `-1`; its expectation changes to the record lifetime, the one changed expectation, for that reason. Of the new tests, `test_confirmation_keeps_the_outcome_and_lifetime_of_a_job_that_finished_first` passes before the change: the plain `HSET` also kept a recorded outcome and its lifetime, and the script must keep them.

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/test_jobs.py`
- Modify: `apps/engine/DESIGN.md` (Restart behavior)
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes: from Task 21, the `START` script with its claim argument and `Jobs.claim(job_id, claim)`; `Jobs.submit`, `Jobs.finish`, and `UnconfirmedSubmission`; `RECORD_LIFETIME` and `RETENTION`; the test helper `submit` and the `client` and `jobs` fixtures.
- Produces: every record has a lifetime from its submission; the `START` script's second argument, the lifetime; the `QUEUED` script and `Jobs.queued_script`; a submission whose record was lost before its confirmation raises `UnconfirmedSubmission`.

- [ ] **Step 1: Write the tests**

In `apps/engine/tests/test_jobs.py`, in `test_job_records_outlast_the_package_retention`, replace `assert jobs.records.ttl(record_key(queued)) == -1` with:

```python
    assert retention < jobs.records.ttl(record_key(queued)) <= lifetime
```

Add at the end of the file:

```python
def test_claim_restarts_the_lifetime_of_the_record(jobs: Jobs) -> None:
    job_id = jobs.submit("smoke", {"bounds": BOUNDS})
    # As if the job had waited in the queue for almost all of its record's lifetime.
    jobs.records.expire(record_key(job_id), 60)
    assert jobs.claim(job_id, "celery@engine-test earlier-run 7")
    assert RETENTION.total_seconds() < jobs.records.ttl(record_key(job_id)) <= RECORD_LIFETIME.total_seconds()


def test_confirmation_does_not_recreate_a_record_lost_meanwhile(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    # As if Redis lost the record while the broker took the message.
    def lose_the_record(*args, task_id, **kwargs):
        jobs.records.delete(record_key(task_id))

    monkeypatch.setattr(jobs.sender, "send_task", lose_the_record)
    response = client.post("/api/v1/jobs", json=SMOKE, headers=AUTHORIZED)
    assert response.status_code == 503
    job_id = response.json()["detail"]["job_id"]
    assert not jobs.records.exists(record_key(job_id))
    assert client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).status_code == 404


def test_confirmation_keeps_the_outcome_and_lifetime_of_a_job_that_finished_first(
    client: TestClient, jobs: Jobs, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A worker can run a short job to its end before the API records the broker's confirmation.
    def finish_while_sending(*args, task_id, **kwargs):
        assert jobs.claim(task_id, "celery@engine-test earlier-run 7")
        jobs.finish(task_id, "failed", "RuntimeError")
        # Shortened, so that a confirmation that restarted the lifetime would show.
        jobs.records.expire(record_key(task_id), 60)

    monkeypatch.setattr(jobs.sender, "send_task", finish_while_sending)
    job_id = submit(client, SMOKE)
    job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
    assert (job["state"], job["error"]) == ("failed", {"type": "RuntimeError"})
    assert jobs.records.ttl(record_key(job_id)) <= 60
```

- [ ] **Step 2: Run the tests to verify they fail for the right reason**

Run: `pnpm engine:check tests/test_jobs.py`
Expected: 3 failed and 80 passed. The queued job's record has no lifetime, a TTL of `-1`; the claim leaves the shortened lifetime of 60 s; and the submission whose record was lost meanwhile answers `202`, because the plain `HSET` recreates the record, where `503` is expected. `test_confirmation_keeps_the_outcome_and_lifetime_of_a_job_that_finished_first` passes. Stop and report if a test fails in another way.

- [ ] **Step 3: Give records a lifetime from submission and from the claim**

In `apps/engine/dtcc_engine/jobs.py`, add before the comment above the `START` script:

```python
# Records the broker's confirmation of a job's message, if the job's record still exists: ARGV is the time.
QUEUED = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
redis.call('HSET', KEYS[1], 'queued_at', ARGV[1])
return 'recorded'
"""
```

Replace the comment above the `START` script with:

```python
# Gives permission to run the job's Dataset to the delivery that changes its gate from waiting to started, records its
# claim, and restarts the record's lifetime: ARGV is the claim and the lifetime.
```

and, in the script, add after the `HSET` line:

```lua
redis.call('EXPIRE', KEYS[1], ARGV[2])
```

In `Jobs.__init__`, add before the line that registers `START`:

```python
        self.queued_script = self.records.register_script(QUEUED)
```

Replace `Jobs.submit` with:

```python
    def submit(self, dataset_name: str, parameters: dict[str, Any]) -> str:
        """Record and queue a job that runs a Dataset with parameters the caller has validated; return its ID.

        Raises:
            redis.RedisError: If Redis cannot record the job; nothing was sent.
            UnconfirmedSubmission: If sending the job or recording its confirmation failed, or the job's record was
                lost meanwhile; the job may be queued, and it is not sent again.
        """
        job_id = str(uuid4())
        key = record_key(job_id)
        submitted_at = datetime.now(UTC).isoformat()
        acceptance = {"dataset": dataset_name, "target": self.target, "submitted_at": submitted_at}
        with self.records.pipeline() as pipeline:
            pipeline.hset(key, mapping={**acceptance, "execution_gate": "waiting"})
            # The record of a job that never finishes expires too.
            pipeline.expire(key, RECORD_LIFETIME)
            pipeline.execute()
        try:
            self.sender.send_task(RUN_DATASET, args=[dataset_name, parameters], task_id=job_id, queue=self.target)
            answer = self.queued_script(keys=[key], args=[datetime.now(UTC).isoformat()])
        except (redis.RedisError, OperationalError) as error:
            raise UnconfirmedSubmission(job_id) from error
        if answer != "recorded":
            # Recreating the record would leave one without its acceptance fields or a lifetime.
            logger.warning("Job %s was sent, but its record is %s, so its confirmation is not recorded", job_id, answer)
            raise UnconfirmedSubmission(job_id)
        return job_id
```

In `Jobs.claim`, replace the call to `self.start_script` with:

```python
            answer = self.start_script(keys=[record_key(job_id)], args=[claim, int(RECORD_LIFETIME.total_seconds())])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 130 passed: the 127 earlier tests and the 3 new ones.

- [ ] **Step 5: Document the lifetime**

In `apps/engine/DESIGN.md`, add to Restart behavior, after the paragraph that Task 21 added:

```markdown
Engine's record of a job that never finishes expires 31 days after the job's
submission or, once a delivery claimed it, after the claim. The job is then
unknown, and a later delivery of it does not run. The expiry bounds the record;
it does not show that the job stopped, and it neither cancels nor stops a job
that still runs. A job that finishes after its record expired cannot record its
outcome or deliver its package; one that finishes before keeps the retention
that Package creation, delivery, and retention describes.
```

Run: `npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [ ] **Step 6: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [ ] **Step 7: Stop for review**

Record Task 22's results in Increment 4's status, leave the changes uncommitted, and report Steps 2, 4, and 6. Suggested commit message: `Feature: Expired engine records of unfinished jobs`.

### Task 23: Delete the packages that no job can deliver

A completed job's package stays on disk after it expires, and a package can be left without a job that can deliver it: its job's record expired or was lost, or its job was recorded as failed after the export, as Task 21 records a lost claimant. DESIGN.md requires each host to clean up expired package files automatically, so that broker metadata expiry is not the only cleanup; expired packages are already refused (Task 12). This task has each host's worker delete them.

**Interfaces verified for the task** (2026-10-13, at Core `17c6efe` and in the development image's Celery 5.6.3):

- Core's canonical export stages the archive in `tempfile.TemporaryDirectory(dir=<package directory>, prefix='.dtcc-package-')` and moves it into place with `os.replace` (`dtcc_core/datasets/package.py`). The directory is removed when the export ends, unless its process is killed.
- A worker bootstep that requires `celery.worker.components:Timer` gets the worker's timer, whose `call_repeatedly(seconds, function)` returns an entry with `cancel()`. The timer runs in the worker's main process, so a pass takes no pool process.
- The worker blueprint's `Consumer` step is marked `last` (`celery/worker/components.py`), and the blueprint orders every other step before it (`celery/bootsteps.py`, `Blueprint._finalize_steps`), so a step's `start` runs before the worker consumes any message.

**Decisions** (proposed with the task):

- The worker deletes a package when its job's record is gone, or its job failed, was cancelled, or completed 30 periods of 24 hours ago or earlier. It keeps a package while its job has no outcome, because the job may still record completion, and while the job's record is unusable. A pass whose Redis read fails deletes no more packages; the next pass tries again. Deleting a package is retention, not a finding that the job's computation stopped: Core moves a package into place at the end of its export, and a job whose record is gone cannot deliver it.
- When the worker starts, before it consumes any job, it also deletes every `.dtcc-package-*` directory. None of this worker's exports runs yet, because Celery starts the consumer after every other step; the host's worker is the only one that exports into its package directory (DESIGN.md, Runtime architecture: one worker on each compute host); and Task 21's deployment requirement has its earlier run stopped before it starts. So each such directory belongs to an export that was killed. The hourly pass leaves staging directories alone: Core sets no deadline on an export, so a directory's age does not show that its export stopped. A directory left while the worker runs is deleted when the worker next starts.
- A bootstep runs a pass when the worker starts and then every hour, `CLEANUP_INTERVAL`. A host whose worker does not run keeps its files until the worker starts again; status and download already refuse expired packages. Each host's worker cleans the package directory it shares with that host's API.
- Existing tests: `test_redelivery.py`'s docstring covers the new test. No expectation changes. The test shortens the interval to one second to see a later pass, and ages a staging directory made while the worker runs, which a later pass must keep.

**Files:**

- Modify: `apps/engine/dtcc_engine/jobs.py`
- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `apps/engine/DESIGN.md` (Package creation, delivery, and retention)
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes: `Jobs.read_record`, `Jobs.package_path`, `Jobs.package_dir`, `RETENTION`, and the worker bootsteps of Task 21; the test helper `wait_for`.
- Produces: `CLEANUP_INTERVAL`, `Jobs.clean_packages()`, `Jobs.clean_staging()`, and the worker bootstep `CleanPackages`.

- [ ] **Step 1: Write the test**

In `apps/engine/tests/test_redelivery.py`, replace the module docstring's first two lines with:

```python
"""Tests of how often a job runs when the worker receives it once, again, or after the job was cancelled, of the
outcome a job gets when the process or the worker run that claimed it is lost, and of the packages the worker deletes.
```

Replace `from datetime import UTC, datetime` with:

```python
from datetime import UTC, datetime, timedelta
```

Add at the end of the file:

```python
def package_with_record(jobs: Jobs, fields: dict[str, str]) -> str:
    """Write a package and a record of its job with these fields besides the acceptance fields; return the job's ID."""
    job_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    acceptance = {"dataset": "smoke", "target": jobs.target, "submitted_at": now, "queued_at": now}
    jobs.records.hset(record_key(job_id), mapping={**acceptance, **fields})
    jobs.package_path(job_id).write_bytes(b"package")
    return job_id


def test_worker_deletes_the_packages_no_job_can_deliver(
    redis_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("dtcc_engine.jobs.CLEANUP_INTERVAL", timedelta(seconds=1), raising=False)
    jobs = Jobs(redis_url, "cleaned", tmp_path)
    now = datetime.now(UTC)
    finished = {"execution_gate": "started", "finished_at": now.isoformat()}
    expired = (now - RETENTION - timedelta(seconds=1)).isoformat()
    packages = {
        "completed": package_with_record(jobs, {**finished, "outcome": "completed"}),
        "expired": package_with_record(jobs, {**finished, "outcome": "completed", "finished_at": expired}),
        "failed": package_with_record(jobs, {**finished, "outcome": "failed", "error_type": "WorkerLostError"}),
        "cancelled": package_with_record(
            jobs, {"execution_gate": "cancelled", "outcome": "cancelled", "finished_at": now.isoformat()}
        ),
        # Its job may still record completion.
        "running": package_with_record(jobs, {"execution_gate": "started"}),
        # Its state cannot be established, so it is kept.
        "unusable": package_with_record(jobs, {}),
    }
    unknown = str(uuid.uuid4())
    jobs.package_path(unknown).write_bytes(b"package")
    packages["unknown"] = unknown
    # Core stages an export beside the package; one there before the worker starts belongs to an export that was killed.
    killed_export = tmp_path / ".dtcc-package-killed"
    killed_export.mkdir()
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        kept = {name for name, job_id in packages.items() if jobs.package_path(job_id).exists()}
        assert kept == {"completed", "running", "unusable"}
        assert not killed_export.exists()
        # One that appears while the worker runs may belong to a running export, however old it is.
        running_export = tmp_path / ".dtcc-package-running"
        running_export.mkdir()
        two_days_ago = time.time() - 2 * 86400
        os.utime(running_export, (two_days_ago, two_days_ago))
        # A package whose job fails while the worker runs goes at a later pass.
        failed_later = package_with_record(jobs, {**finished, "outcome": "failed", "error_type": "RuntimeError"})
        wait_for(lambda: not jobs.package_path(failed_later).exists(), timeout=10)
        assert running_export.exists()
```

- [ ] **Step 2: Run the test to verify it fails for the right reason**

Run: `pnpm engine:check tests/test_redelivery.py`
Expected: 1 failed and 8 passed. When the worker has started, every package is still there, so the set of kept packages also holds `expired`, `failed`, `cancelled`, and `unknown`. Stop and report if the test fails in another way.

- [ ] **Step 3: Delete the packages in the worker**

In `apps/engine/dtcc_engine/jobs.py`, replace `import os` with:

```python
import os
import shutil
```

Add after the `RUN_DATASET` line:

```python
# How often a worker deletes the packages that no job can deliver.
CLEANUP_INTERVAL = timedelta(hours=1)
```

In `Jobs.__init__`, add after the line that adds `RecordLostClaims`:

```python
        class CleanPackages(bootsteps.StartStopStep):
            """Deletes the packages that no job can deliver when the worker starts, and then every interval.

            When the worker starts, it also deletes the staging directories of exports that were killed.
            """

            requires = {"celery.worker.components:Timer"}

            def start(self, worker: Any) -> None:
                # Celery starts the consumer after every other step, so none of this worker's exports runs yet.
                jobs.clean_staging()
                jobs.clean_packages()
                self.cleanup = worker.timer.call_repeatedly(CLEANUP_INTERVAL.total_seconds(), jobs.clean_packages)

            def stop(self, worker: Any) -> None:
                self.cleanup.cancel()

        self.celery_app.steps["worker"].add(CleanPackages)
```

Add before `Jobs.record_lost_process`:

```python
    def clean_packages(self) -> None:
        """Delete this host's packages that no job can deliver.

        A package goes when its job is unknown or expired, failed, was cancelled, or completed more than the retention
        ago. It stays while its job has no outcome, which may still be completion, and while the job's record is
        unusable. A pass that Redis does not answer deletes no more packages; the next pass does.
        """
        now = datetime.now(UTC)
        try:
            for path in self.package_dir.glob("*.dtccpkg"):
                try:
                    record = self.read_record(path.stem)
                except JobStateUnavailable:
                    continue
                outcome = record["outcome"] if record else None
                expired = outcome == "completed" and now >= record["finished_at"] + RETENTION
                if record is None or outcome in ("failed", "cancelled") or expired:
                    path.unlink(missing_ok=True)
                    logger.info("Deleted package %s, which no job can deliver", path.name)
        except redis.RedisError:
            logger.warning("Could not read job records; packages are deleted at the next pass", exc_info=True)

    def clean_staging(self) -> None:
        """Delete the directories in which Core staged exports beside the packages.

        Call it only before the worker runs jobs: the host's worker is the only one that exports here, and its earlier
        run has stopped, so every such directory belongs to an export that was killed.
        """
        for staging in self.package_dir.glob(".dtcc-package-*"):
            shutil.rmtree(staging, ignore_errors=True)
            logger.info("Deleted %s, left by an export that was killed", staging.name)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm engine:check`
Expected: 131 passed: the 130 earlier tests and the new one.

- [ ] **Step 5: Document the cleanup**

In `apps/engine/DESIGN.md`, in Package creation, delivery, and retention, add after the paragraph that ends "merely because their files remain on disk.":

```markdown
Each host's worker deletes the packages that no job can deliver when it starts
and every hour: those whose job is unknown or expired, failed, was cancelled, or
completed more than 30 periods of 24 hours ago. A package stays while its job
has no outcome. Deleting a package is retention; it does not show that the
job's computation stopped. When the worker starts, before it runs any job, it
also deletes the staging directories that exports left beside the packages: the
host's worker is the only one that exports there, and it starts only after its
earlier run stopped (Restart behavior), so those exports were killed. A staging
directory left while the worker runs stays until the worker starts again.
```

Run: `npx --yes prettier@3.9.6 --check apps/engine/DESIGN.md apps/engine/PLAN.md`
Expected: all files use Prettier code style.

- [ ] **Step 6: Validate**

Run: `pnpm engine:check:prod`, then `pnpm check`.
Expected: as in Task 17, Step 7.

- [ ] **Step 7: Stop for review**

Record Task 23's results in Increment 4's status, leave the changes uncommitted, and report Steps 2, 4, and 6. Suggested commit message: `Feature: Deleted engine packages that no job can deliver`.

### Task 24: Check API, worker, and broker restarts separately

The Restart behavior row asks that separate API, worker, and broker restarts promise no recovery, delete no surviving work, and report unavailable and unknown state honestly; the Failure reporting row asks the same of broker and host failures. Tasks 17 to 23 give a lost claimant a recorded failure, every record a lifetime, and every host a cleanup. This task checks each restart on its own: two automated tests pin what a new API and a worker started later do with surviving work, and the restarts themselves, including Redis's, run in a Compose project of their own, because the automated suite shares `engine-redis` with `pnpm dev:engine` and cannot restart it.

**Interfaces verified for the task** (2026-10-13 to 2026-10-15, in the experiments and in Compose):

- `engine-redis` runs `redis:8` with its defaults: RDB snapshots at the save points `3600 1 300 100 60 10000`, no append-only file, and its data in the container's anonymous `/data` volume, which a stopped or killed container keeps. A graceful restart saves a snapshot and loses nothing; a killed Redis comes back with its last snapshot. The experiments of 2026-10-13 showed both, and that a worker reconnects about 2 s after Redis returns. Which snapshot a kill returns to depends on elapsed time and write counts, not on what the jobs do.
- `CONFIG SET save ""` turns automatic snapshots off until Redis restarts, and `SAVE` writes a snapshot before it answers ([Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)).
- Compose's `stop`, `restart`, and `kill` of `engine-redis` act on Redis alone: with a worker that depends on it running, `--dry-run` listed only the Redis container for each.
- A Compose project name gives a project its own containers, network, and volumes, as `pnpm engine:check:prod` uses `dtcc-twin-engine-prod`. The `engine` service publishes port 8000 in every project; `engine-redis` and `engine-worker` publish none.
- `docker compose stop` of one service, from another terminal, leaves an attached `docker compose up`, which `pnpm dev:engine` runs, and its other services running, and `docker compose start` brings the service back: checked on 2026-10-15 in a throwaway project. Interrupting `pnpm dev:engine` instead stops all its services, and Compose kills a container that has not stopped 10 seconds after it was asked to ([stop grace period](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)); `compose.yaml` gives the worker no longer one.
- Celery may store `STARTED`, which status reports as `running`, before a delivery claims the job (DESIGN.md's Cancellation). A claim is in Redis before the worker has Redis's answer, and a delivery whose claim raises does not run the job. The worker sets Core's progress callback only once its claim succeeds, and `city_volume_mesh` at Core `17c6efe` reports its phases through a `ProgressTracker`, which status shows as `progress` while the job runs; a reported `progress` therefore shows that the Dataset runs. A progress report that Redis does not take is logged without failing the job.
- Engine's `finished_at` is the worker's time when it records the finish. Celery 5.6.3 logs a task's success or failure only after storing its result, which can wait for Redis, so the log line's time is not the job's finish. The Redis container's `date -u +%FT%T.%3NZ` reads the clock that the worker's containers share.
- The API keeps no state of its own; status and packages come from Redis and the package directory.

**Decisions** (proposed with the task):

- The two new tests pin existing behavior, so they pass when written, as Task 14's coverage tests did. The first creates a new application over the same Redis and package directory; Step 3 restarts the API's process.
- The restarts run in a Compose project of their own, `dtcc-twin-engine-restart`, with its own Redis, package volume, API, and worker. The development Redis, both its databases, and the development package volume are left alone, so the check discards no development data. Only the development API is stopped meanwhile, because both projects' APIs publish port 8000; it keeps no state and runs no job, so the development worker and Redis keep running, with any job they run. `pnpm dev:engine` is not interrupted, which would stop its worker too and kill a job that runs longer than the grace period. The project is removed at the end with its volumes. Components are restarted one at a time with Compose's `restart`, `stop`, `start`, and `kill`. A worker lost during a job is Task 21's Step 6 and is not repeated.
- The Redis loss is checked against a known snapshot: automatic snapshots are turned off, and one is saved while no job is queued or running. Jobs accepted after it are then lost with the kill, whatever they do, and the jobs in it come back as it holds them, which the check records. DESIGN.md promises nothing after Redis loses data or returns to an earlier state: a job saved while claimed or waiting would come back so, and could then fail with `WorkerRestarted` or run again. The check avoids that state rather than requiring an outcome for it.
- Expectations accept a job that has advanced: a job may complete before the API is back. Redis stops only once status reports the running job's `progress`, which shows that its Dataset runs; `running` alone, or a stored claim, does not. Redis stays down until status answers `503`, so a short outage cannot fall between polls. The attempt is judged by the job's `finished_at` against the outage's start and end, read from the same clock, and not by the time of Celery's log line. It shows a job that ran through the outage only if the job reported progress before the outage and finished after it. A job that finished before the outage, whose finish fell within it, which may lose the outcome as the contract allows, or whose order cannot be established makes the attempt inconclusive: it is recorded and repeated once. Every attempt is reported with its job IDs, `progress`, outage times, `finished_at`, and the worker's timestamped log. Any other result is diagnosed against DESIGN.md's Restart behavior, not inferred from a log line's time. The check shows that a job's run, from a progress report to its recorded finish, spanned the outage; it does not show which part of the run, the Dataset, the export, or the validation, did. A barrier would hold the job deterministically, but needs a worker started for the check with a test Dataset; the check runs the served worker instead, with `city_volume_mesh`, which runs about 100 s. The worker's log shows how often each job ran.

**Files:**

- Modify: `apps/engine/tests/test_redelivery.py`
- Modify: `apps/engine/PLAN.md` (Increment 4 status)

**Interfaces:**

- Consumes: the fixtures `prefork_jobs` and `counting_dataset`, the helpers `wait_until_completed`, `runs_key`, `TOKEN`, and `AUTHORIZED`, and `create_app`; Tasks 17 to 23 for the behavior observed through the worker service.
- Produces: two tests; the Restart behavior and Failure reporting rows' evidence in Increment 4's status.

- [ ] **Step 1: Write the tests**

In `apps/engine/tests/test_redelivery.py`, add at the end of the file:

```python
def test_restarted_api_serves_the_jobs_the_earlier_one_accepted(
    redis_url: str, prefork_jobs: Jobs, counting_dataset: str
) -> None:
    request = {"dataset": counting_dataset, "parameters": {"bounds": BOUNDS, "label": "api-restart"}}
    response = TestClient(create_app(TOKEN, prefork_jobs)).post("/api/v1/jobs", json=request, headers=AUTHORIZED)
    job_id = response.json()["job_id"]
    wait_until_completed(prefork_jobs, job_id)
    # The API keeps no state of its own: a new one reads the same Redis and package directory.
    restarted = TestClient(create_app(TOKEN, Jobs(redis_url, "prefork", prefork_jobs.package_dir)))
    polled = restarted.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
    downloaded = restarted.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert (polled.status_code, polled.json()["state"]) == (200, "completed")
    assert downloaded.content == prefork_jobs.package_path(job_id).read_bytes()


def test_job_queued_while_no_worker_runs_runs_when_a_worker_starts(
    redis_url: str, tmp_path: Path, counting_dataset: str
) -> None:
    jobs = Jobs(redis_url, "started-later", tmp_path)
    job_id = jobs.submit(counting_dataset, {"bounds": BOUNDS, "label": "queued-without-worker"})
    assert jobs.status(job_id)["state"] == "queued"
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1):
        wait_until_completed(jobs, job_id)
    assert jobs.records.get(runs_key("queued-without-worker")) == "1"
```

- [ ] **Step 2: Run the tests**

Run: `pnpm engine:check tests/test_redelivery.py`
Expected: 11 passed: the 9 earlier tests and the 2 new ones, which pin existing behavior. If either fails, stop and report.

Run: `pnpm engine:check`
Expected: 133 passed.

- [ ] **Step 3: Restart each component in a Compose project of its own**

If `pnpm dev:engine` runs, do not interrupt it: from another terminal, stop only its API with `docker compose --profile engine stop engine`, and check that `docker compose --profile engine ps` still lists its worker and Redis as running. In this step, `compose` stands for `docker compose --project-name dtcc-twin-engine-restart --profile engine`, run from the repository root. Start the project with `compose up --build --detach engine engine-worker`. Before any other command, check that `compose ps` lists only containers whose names start with `dtcc-twin-engine-restart-`, and wait until `compose logs engine-worker` shows that the worker is ready.

Use the development token and the bounds `[319891, 6399790, 320091, 6399990]`. In checks 1 and 3, `city_volume_mesh` is the job that runs and `smoke` the job queued behind it. A job ran once if `compose logs engine-worker` has one line `Task dtcc_engine.run_dataset[<job ID>] succeeded`, and any other delivery of it is logged as not run.

1. **API.** Submit both; while `city_volume_mesh` runs, `compose restart engine`, and wait until `/api/v1/health` answers. Expected: neither job is `failed` or unknown; `city_volume_mesh` is `running` or `completed`, and `smoke` `queued` or later. Both complete, both packages download, and each job ran once.
2. **Worker.** `compose stop engine-worker`; the worker logs a warm shutdown. Submit `smoke`: it is `queued`. `compose start engine-worker`. Expected: the job completes, and it ran once.
3. **Redis.** Submit both, and poll `city_volume_mesh` until its status has a `progress`; record it. Note the outage's start with `compose exec -T engine-redis date -u +%FT%T.%3NZ`, then `compose stop engine-redis`, and poll the job until status answers `503` with "temporarily unavailable". Then `compose start engine-redis`, and note the outage's end the same way. Expected: no answer during the outage is `failed`; the worker logs that it reconnected; both jobs complete, both packages download, and each job ran once; and the `finished_at` of `city_volume_mesh` is after the outage's end. If its `finished_at` is before the outage's start or between start and end, or it has none and the worker's log shows a Redis error while finishing it, or the order cannot be established, the attempt is inconclusive: record it, and repeat the check once. Record each attempt's job IDs, `progress`, outage times, `finished_at`, and `compose logs --timestamps engine-worker`. Diagnose any other result against DESIGN.md's Restart behavior, and report it.
4. **Redis lost.** With no job queued or running, run `compose exec -T engine-redis redis-cli CONFIG SET save ""` and `compose exec -T engine-redis redis-cli SAVE`, and note what `compose exec -T engine-redis redis-cli DBSIZE` answers. Submit `smoke`, job A, and wait until it completes. `compose stop engine-worker`, and submit `smoke` again: job B is `queued`. Then `compose kill -s KILL engine-redis` and `compose start engine-redis`. Expected: `DBSIZE` answers the noted size, and `EXISTS dtcc-engine:job:<job ID>` answers 0 for A and B. A and B are `404` with "unknown or expired", and the jobs of checks 1 to 3 are still `completed`, with their packages. `compose start engine-worker`. Expected: the worker logs that it deleted A's package, and it receives no delivery of B, whose message was lost with the data. Record what came back.
5. **Remove the project.** `compose down --volumes --rmi local`. Expected: `docker volume ls` no longer lists `dtcc-twin-engine-restart_engine-packages`, and still lists `dtcc-twin_engine-packages` and `dtcc-twin_postgres-data`. If the development API was stopped, start it again with `docker compose --profile engine start engine`.

- [ ] **Step 4: Validate**

Run: `pnpm engine:check:prod`, `npx --yes prettier@3.9.6 --check apps/engine/PLAN.md`, then `pnpm check`.
Expected: the production and token checks pass; the plan uses Prettier code style; `pnpm check` passes. Report passed, failed, skipped, and not-run checks separately.

- [ ] **Step 5: Stop for review**

Record Task 24's results in Increment 4's status, including each check in Step 3, set Increment 4's status to executed once Tasks 20 to 24 are, leave the changes uncommitted, and report Steps 2, 3, and 4. Suggested commit message: `Test: Checked engine restarts`.

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

**Cancellation prerequisite:** every worker consuming the deployment's queues must enforce the start/cancel gate before any API exposes cancellation. The one-time development reset in increment 4 is not a production upgrade procedure.

**Scope:** the worker containers' Celery-specific health-check override; each worker's Celery node name, `celery@<target identifier>`, passed with `--hostname`, under which a worker starts only after its earlier run stopped (Tasks 21 and 25); `ENGINE_IMAGE_DIGEST`, the platform-specific digest of the image each host runs; `ENGINE_REMOTE_TARGETS`, the entry service's remote targets and their Engine addresses, in placement order (Task 26); the documented production runtime settings (TLS reverse proxy, token secret, package and FEniCSx cache volumes, shared memory, thread counts, external Redis); building and validating the `linux/amd64` image on a native x86_64 Linux host (Task 9 ran it only under emulation); deploying the API and worker on that host, running representative Core and Sim jobs, and recording the baseline measurements the spec lists, with hardware, image digest, and software versions. The deployment runs the exact image digest it tested.

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
