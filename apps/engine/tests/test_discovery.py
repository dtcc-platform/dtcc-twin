"""Tests for Engine's discovery API against the installed DTCC Core and DTCC Sim."""

import json

import pytest
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from dtcc_core.datasets import list as registered_datasets
from fastapi.testclient import TestClient
from pydantic import Field

from dtcc_engine.api import create_app

TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(TOKEN))


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("path", ["/api/v1/datasets", "/api/v1/datasets/buildings"])
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
def test_unusable_tokens_are_rejected_at_startup(token: str) -> None:
    with pytest.raises(ValueError):
        create_app(token)


@pytest.mark.parametrize("token", ["local-dev-engine-token", "aZ09-._~+/", "base64token=="])
def test_bearer_token_characters_are_accepted(token: str) -> None:
    client = TestClient(create_app(token))
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
