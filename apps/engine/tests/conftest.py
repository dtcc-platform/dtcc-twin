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
