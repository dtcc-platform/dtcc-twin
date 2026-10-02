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
