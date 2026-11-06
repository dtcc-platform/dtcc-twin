"""Fixtures for Engine's tests that use Redis and Celery.

`compose.yaml` gives the tests a Redis database of their own, `ENGINE_TEST_REDIS_URL`.
"""

import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import celery.contrib.testing.tasks  # noqa: F401  Registers the ping task that start_worker waits for.
import pytest
import redis
from celery import Celery
from celery.contrib.testing.worker import TestWorkController, start_worker

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


class CheckedWorker(TestWorkController):
    """A test worker that fails its test when it stops before it starts, where `start_worker` would wait for ever."""

    def start(self) -> None:
        try:
            super().start()
        finally:
            self._on_started.set()

    def ensure_started(self) -> None:
        assert self._on_started.wait(120), "The worker did not start within 120 s"
        assert self.exitcode is None, f"The worker stopped before it started, with exit code {self.exitcode}"


@pytest.fixture(scope="session")
def start_target_worker() -> Callable[..., Any]:
    """Start a Celery worker in this process for some jobs, as a node of their target, with `start_worker`'s options.

    The node is `celery@<target>` unless `node` names another of the target's. A worker that refuses to start, as one
    under another target's node name does, fails the test, where `start_worker` alone would wait for ever.
    """

    def start(jobs: Jobs, node: str | None = None, **options: Any) -> Any:
        hostname = node or f"celery@{jobs.target}"
        return start_worker(jobs.celery_app, hostname=hostname, WorkController=CheckedWorker, **options)

    return start


def answers(app: Celery, node: str) -> bool:
    """Return whether a running worker answers a ping as this node."""
    with app.connection_for_write() as connection:
        return bool(app.control.ping([node], timeout=0.5, connection=connection))


@pytest.fixture(scope="module")
def run_worker_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's worker in a process of its own until the context ends, as the worker service runs it; yield the
    process.

    The worker runs as `celery@<target>` unless `node` names another of the target's. It also runs `engine_held_probe`
    (`target_worker.py`). Its log is in a temporary directory, which a failure to start reports.
    """
    logs = tmp_path_factory.mktemp("worker-logs")
    app = Celery(broker=redis_url, set_as_current=False)

    @contextmanager
    def run(
        target: str, package_dir: Path, image_digest: str | None = None, node: str | None = None
    ) -> Iterator[subprocess.Popen[bytes]]:
        node = node or f"celery@{target}"
        environment = {
            **os.environ,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
            "PYTHONPATH": str(Path(__file__).parent),
        }
        command = ["celery", "--app", "target_worker", "worker", "--hostname", node, "--concurrency", "1"]
        log = logs / f"{node}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        try:
            deadline = time.monotonic() + 120
            while not answers(app, node):
                assert process.poll() is None and time.monotonic() < deadline, log.read_text()
            yield process
        finally:
            process.terminate()
            try:
                process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                # A worker that a failed test left holding a job would wait for it for ever.
                process.kill()
                process.wait()

    return run


@pytest.fixture(scope="module")
def served_jobs(
    redis_url: str, tmp_path_factory: pytest.TempPathFactory, start_target_worker: Callable[..., Any]
) -> Iterator[Jobs]:
    """Jobs on a target served by a Celery worker in this process, which also runs test-defined Datasets."""
    served = Jobs(redis_url, "served", tmp_path_factory.mktemp("packages"))
    with start_target_worker(served):
        yield served
