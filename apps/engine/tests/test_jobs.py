"""Tests for Engine's job API against real Redis and, where a job must run, a real Celery worker.

The `client` fixture's jobs stay queued, because no worker serves its target. The `served_client` fixture's worker
runs in this process, so it also runs the Dataset Definitions that tests register.
"""

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import redis
from celery import Celery, current_task
from celery.exceptions import TaskRevokedError
from dtcc_core.common.progress import ProgressTracker
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, load_model_package, unregister
from dtcc_core.datasets.dataset import DatasetUpstreamError
from dtcc_core.model import Mesh
from fastapi.testclient import TestClient
from httpx import Response
from kombu.exceptions import OperationalError
from pydantic import field_validator

from dtcc_engine.api import create_app
from dtcc_engine.jobs import RECORD_LIFETIME, RETENTION, RUN_DATASET, Jobs, record_key

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
SMOKE = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}
PROVIDER_KEY = "provider-key-5e1d"
FINISHED = ("completed", "failed")


@pytest.fixture
def client(jobs: Jobs) -> TestClient:
    return TestClient(create_app(TOKEN, jobs))


@pytest.fixture
def served_client(served_jobs: Jobs) -> TestClient:
    return TestClient(create_app(TOKEN, served_jobs))


def submit(client: TestClient, request: dict) -> str:
    """Submit a job that the API must accept, and return its ID."""
    response = client.post("/api/v1/jobs", json=request, headers=AUTHORIZED)
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def job_count(jobs: Jobs) -> int:
    return len(jobs.records.keys(record_key("*")))


def wait_until(client: TestClient, job_id: str, condition: Callable[[dict], bool], timeout: float = 120.0) -> dict:
    """Poll the job until `condition` holds; fail at once if the job finishes without meeting it."""
    deadline = time.monotonic() + timeout
    while True:
        job = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED).json()
        if condition(job):
            return job
        assert job["state"] not in FINISHED and time.monotonic() < deadline, job
        time.sleep(0.1)


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
    "upstream-detail-without-failure": {
        "execution_gate": "started",
        "outcome": "completed",
        "finished_at": FINISHED_AT,
        "error_upstream": "{}",
    },
    "claim-of-a-waiting-job": {"claimed_by": "celery@engine-test earlier-run 7"},
    "claim-without-its-parts": {"execution_gate": "started", "claimed_by": "earlier-run"},
    "claim-without-a-process-id": {"execution_gate": "started", "claimed_by": "celery@engine-test earlier-run seven"},
    "unreadable-upstream-detail": {
        "execution_gate": "started",
        "outcome": "failed",
        "finished_at": FINISHED_AT,
        "error_type": "DatasetUpstreamError",
        "error_upstream": "not json",
    },
}


def change_record(jobs: Jobs, job_id: str, changes: dict[str, str | None]) -> None:
    for field, value in changes.items():
        if value is None:
            jobs.records.hdel(record_key(job_id), field)
        else:
            jobs.records.hset(record_key(job_id), field, value)


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/jobs"),
        ("GET", "/api/v1/jobs/some-job"),
        ("GET", "/api/v1/jobs/some-job/package"),
        ("POST", "/api/v1/jobs/some-job/cancel"),
    ],
)
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
    assert served_client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED).status_code == 409


def test_result_core_cannot_package_fails_the_job(served_client: TestClient, served_jobs: Jobs) -> None:
    # Canonical exchange does not support CalibrationGrid at the pinned Core commit.
    job_id = submit(served_client, {"dataset": "calibration_grid", "parameters": {"bounds": BOUNDS}})
    job = wait_until(served_client, job_id, lambda job: job["state"] in FINISHED)
    assert (job["state"], job["error"]) == ("failed", {"type": "NotImplementedError"})
    assert not served_jobs.package_path(job_id).exists()


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


def test_job_task_is_not_shared_with_other_celery_apps(jobs: Jobs) -> None:
    # A shared task joins every app finalized later, and a name's first registration wins,
    # so a worker could run another Jobs instance's task.
    other = Celery("other", set_as_current=False)
    assert RUN_DATASET in jobs.celery_app.tasks
    assert RUN_DATASET not in other.tasks


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
    assert retention < jobs.records.ttl(record_key(queued)) <= lifetime
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
