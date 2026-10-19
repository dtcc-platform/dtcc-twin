"""Fixtures for Engine's tests that use Redis and Celery.

`compose.yaml` gives the tests a Redis database of their own, `ENGINE_TEST_REDIS_URL`.
"""

import os
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import celery.contrib.testing.tasks  # noqa: F401  Registers the ping task that start_worker waits for.
import pytest
import redis
from celery.contrib.testing.worker import start_worker

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
