"""Tests of how often a job runs when the worker receives it once, again, or after the job was cancelled, of the
outcome a job gets when the process or the worker run that claimed it is lost, and of the packages the worker deletes.

The worker here uses the prefork pool, as the worker service does: a pool process runs the job while the worker's
main process keeps receiving messages. The tests have their own module so that no other test's worker thread is running
in this process when the pool forks.
"""

import os
import signal
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import redis
from celery.contrib.testing.worker import start_worker
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from dtcc_core.model import Mesh
from fastapi.testclient import TestClient
from kombu import Connection

from dtcc_engine.api import create_app
from dtcc_engine.jobs import RECORD_LIFETIME, RETENTION, RUN_DATASET, Jobs, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
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


def test_worker_started_again_deletes_the_package_its_earlier_run_left(redis_url: str, tmp_path: Path) -> None:
    jobs = Jobs(redis_url, "restarted-after-export", tmp_path)
    node = "celery@engine-test-restarted-after-export"
    # The earlier run exported the package and was lost before it recorded the job's completion.
    left = claimed_job(jobs, f"{node} earlier-run 7")
    jobs.package_path(left).write_bytes(b"package")
    # Once the worker has started, its cleanup has run after its check of lost claims, not only an hour later.
    with start_worker(jobs.celery_app, pool="prefork", concurrency=1, hostname=node):
        assert jobs.status(left)["error"] == {"type": "WorkerRestarted"}
        assert not jobs.package_path(left).exists()


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
