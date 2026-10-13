"""Tests of how often a job runs when the worker receives it once or again.

The worker here uses the prefork pool, as the worker service does: a pool process runs the job while the worker's
main process keeps receiving messages. The tests have their own module so that no other test's worker thread is running
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

from dtcc_engine.jobs import RUN_DATASET, Jobs, record_key

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


def wait_until_finished(jobs: Jobs, job_id: str) -> dict:
    wait_for(lambda: jobs.status(job_id)["state"] in ("completed", "failed"))
    return jobs.status(job_id)


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
