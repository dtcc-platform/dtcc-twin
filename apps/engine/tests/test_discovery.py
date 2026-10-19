"""Tests for Engine's discovery API against the installed DTCC Core and DTCC Sim.

The `client` fixture's target has no worker; its API observes that target as unknown at once, instead of waiting for
an answer that never comes.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from dtcc_core.datasets import list as registered_datasets
from fastapi.testclient import TestClient
from pydantic import Field

from dtcc_engine.api import create_app, create_app_from_environment, dataset_catalog
from dtcc_engine.jobs import Jobs

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(jobs: Jobs, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(jobs, "observe", lambda target: {"state": "unknown", "reason": "Not observed"})
    return TestClient(create_app(TOKEN, jobs))


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/api/v1/datasets", "/api/v1/datasets/buildings", "/api/v1/host", "/api/v1/targets"])
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


@pytest.mark.parametrize(
    "token",
    ["", " padded-token", "padded-token ", "has space", "line\nbreak", "tést-token", "quote\"token", "=leading-padding"],
    ids=["empty", "leading-space", "trailing-space", "inner-space", "newline", "non-ascii", "quote", "leading-equals"],
)
def test_unusable_tokens_are_rejected_at_startup(token: str, jobs: Jobs) -> None:
    with pytest.raises(ValueError):
        create_app(token, jobs)


@pytest.mark.parametrize("token", ["local-dev-engine-token", "aZ09-._~+/", "base64token=="])
def test_bearer_token_characters_are_accepted(token: str, jobs: Jobs) -> None:
    client = TestClient(create_app(token, jobs))
    response = client.get("/api/v1/datasets", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_listing_contains_every_registered_core_and_sim_dataset(client: TestClient) -> None:
    listed = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["datasets"]
    assert set(listed) == set(registered_datasets())
    assert {"buildings", "urban_heat_simulation"} <= set(listed)


def test_listing_returns_core_descriptions_unchanged(client: TestClient) -> None:
    listed = client.get("/api/v1/datasets", headers=AUTHORIZED).json()["datasets"]
    expected = {name: dataset.describe() for name, dataset in registered_datasets().items()}
    assert listed == json.loads(json.dumps(expected))


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
    assert host.status_code == 200
    assert host.json() == {"target": "this-host", "image_digest": reported, **json.loads(json.dumps(dataset_catalog()))}


def listing_observed(
    monkeypatch: pytest.MonkeyPatch, jobs: Jobs, states: dict[str, tuple[str, str | None]]
) -> tuple[dict[str, Any], list[str]]:
    """List the Datasets through an API whose targets are observed in these states and reasons: its own, then the
    remote `second` and `first`, configured in that order. Returns the listing and the targets observed, in order.
    """
    observed: list[str] = []

    def observe(target: str) -> dict[str, Any]:
        observed.append(target)
        state, reason = states[target]
        return {"state": state, "reason": reason, "worker": None, "waiting": 0}

    monkeypatch.setattr(jobs, "observe", observe)
    client = TestClient(create_app(TOKEN, jobs, {"second": "http://127.0.0.1:1", "first": "http://127.0.0.1:2"}))
    response = client.get("/api/v1/datasets", headers=AUTHORIZED)
    assert response.status_code == 200
    return response.json(), observed


def test_listing_reports_every_target_of_each_dataset_as_observed_with_runtime_availability_unknown(
    monkeypatch: pytest.MonkeyPatch, jobs: Jobs
) -> None:
    states = {
        "unserved": ("ready", None),
        "second": ("busy", None),
        "first": ("incompatible", "Its worker's image digest is missing or differs from this host's"),
    }
    listing, observed = listing_observed(monkeypatch, jobs, states)
    targets = [
        {"target": target, "state": state, "reason": reason, "runtime_availability": "unknown"}
        for target, (state, reason) in states.items()
    ]
    assert listing["targets"] == {name: targets for name in listing["datasets"]}
    assert set(listing["datasets"]) == set(registered_datasets())
    assert observed == ["unserved", "second", "first"]


def test_revision_does_not_change_with_the_targets_states(monkeypatch: pytest.MonkeyPatch, jobs: Jobs) -> None:
    unknown = ("unknown", "Its worker did not answer within 0.5 s")
    before, _ = listing_observed(monkeypatch, jobs, {"unserved": ("ready", None), "second": unknown, "first": unknown})
    after, _ = listing_observed(monkeypatch, jobs, {"unserved": unknown, "second": ("busy", None), "first": unknown})
    assert before["targets"] != after["targets"]
    assert before["catalog_revision"] == after["catalog_revision"] == dataset_catalog()["catalog_revision"]


def test_listing_while_the_broker_does_not_answer_reports_every_dataset_and_its_target_unknown(tmp_path: Path) -> None:
    client = TestClient(create_app(TOKEN, Jobs("redis://127.0.0.1:1/0", "unreachable", tmp_path)))
    response = client.get("/api/v1/datasets", headers=AUTHORIZED)
    assert response.status_code == 200
    listing = response.json()
    unknown = {"state": "unknown", "reason": "The broker did not answer", "runtime_availability": "unknown"}
    assert set(listing["datasets"]) == set(registered_datasets())
    assert listing["targets"] == {name: [{"target": "unreachable", **unknown}] for name in listing["datasets"]}


def test_host_local_discovery_observes_no_target(monkeypatch: pytest.MonkeyPatch, jobs: Jobs) -> None:
    observed: list[str] = []
    monkeypatch.setattr(jobs, "observe", observed.append)
    client = TestClient(create_app(TOKEN, jobs, {"remote": "http://127.0.0.1:1"}))
    host = client.get("/api/v1/host", headers=AUTHORIZED)
    assert host.status_code == 200
    assert "targets" not in host.json()
    assert observed == []
