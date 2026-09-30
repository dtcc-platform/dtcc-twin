"""Tests for Engine's job API against real Redis and, where a job must run, a real Celery worker.

The `client` fixture's jobs stay queued, because no worker serves its target. The `served_client` fixture's worker
runs in this process, so it also runs the Dataset Definitions that tests register.
"""

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from celery import Celery
from dtcc_core.common.progress import ProgressTracker
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, load_model_package, unregister
from dtcc_core.model import Mesh
from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError
from pydantic import field_validator

from dtcc_engine.api import create_app
from dtcc_engine.jobs import RUN_DATASET, Jobs, record_key

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
SMOKE = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}
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
