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
