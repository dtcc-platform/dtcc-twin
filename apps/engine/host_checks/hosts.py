"""Checks across two Engine hosts, run by `pnpm engine:check:hosts` one phase at a time.

Between phases, `check-hosts.sh` stops and starts one host's services. The phases share job IDs and measurements
through `/state`, and read each host's package volume under `/packages`. Both hosts run on one machine, whose
Compose project names them, so the measurements are a baseline for that machine, not for hosts on separate ones.
"""

import json
import os
import statistics
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from dtcc_engine.jobs import Jobs

ENTRY = "http://entry:8000"
REMOTE = "http://remote:8000"
ADDRESSES = {"entry": ENTRY, "remote": REMOTE}
AUTHORIZED = {"Authorization": f"Bearer {os.environ['ENGINE_API_TOKEN']}"}
# The digest of the image both hosts run, which the script supplies.
DIGEST = os.environ["ENGINE_IMAGE_DIGEST"]
BOUNDS = [319891, 6399790, 320091, 6399990]
SMOKE = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}
FINISHED = ("completed", "failed", "cancelled")
STATE = Path("/state")
PACKAGES = Path("/packages")


def fetch(address: str, path: str, method: str = "GET", **options: Any) -> requests.Response:
    """Send a request with the shared token to a host's API."""
    return requests.request(method, f"{address}{path}", headers=AUTHORIZED, timeout=60, **options)


def timed(call: Callable[[], Any]) -> tuple[Any, float]:
    """Call and return the result and the seconds it took."""
    start = time.monotonic()
    result = call()
    return result, time.monotonic() - start


def wait_for(condition: Callable[[], Any], timeout: float = 120.0) -> Any:
    """Return the condition's first true value, failing after the timeout."""
    deadline = time.monotonic() + timeout
    while not (value := condition()):
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.2)
    return value


def remember(name: str, value: Any) -> None:
    """Keep a value for later phases."""
    (STATE / f"{name}.json").write_text(json.dumps(value))


def recall(name: str) -> Any:
    """Return a value an earlier phase kept."""
    return json.loads((STATE / f"{name}.json").read_text())


def summary(values: list[float]) -> dict[str, float]:
    """Return the count, median, minimum, and maximum of measured values."""
    return {"count": len(values), "median": statistics.median(values), "min": min(values), "max": max(values)}


def duration(job: dict[str, Any]) -> float:
    """Return the seconds from a finished job's submission to its finish, by the hosts' clock."""
    return (datetime.fromisoformat(job["finished_at"]) - datetime.fromisoformat(job["submitted_at"])).total_seconds()


def measure(name: str, value: Any) -> None:
    """Add a measurement to those the script prints at the end."""
    path = STATE / "measurements.json"
    measurements = json.loads(path.read_text()) if path.exists() else {}
    path.write_text(json.dumps({**measurements, name: value}, indent=2))


def queue(dataset: str, parameters: dict[str, Any], target: str) -> str:
    """Record and queue a job as the entry does, without its validation or an observation; return its ID."""
    entry = Jobs(os.environ["ENGINE_REDIS_URL"], "entry", PACKAGES / "entry", DIGEST)
    return entry.submit(dataset, parameters, target)


def submit(request: dict[str, Any], target: str | None = None) -> str:
    """Submit a job through the entry, to the target or by automatic placement; return its ID."""
    response = fetch(ENTRY, "/api/v1/jobs", "POST", json={**request, "target": target})
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def download(job_id: str) -> bytes:
    """Download a job's package through the entry, which must deliver it."""
    response = fetch(ENTRY, f"/api/v1/jobs/{job_id}/package")
    assert response.status_code == 200, response.text
    return response.content


def stored_package(host: str, job_id: str) -> bytes:
    """Return the package that a host keeps for a job, read from its package volume."""
    return (PACKAGES / host / f"{job_id}.dtccpkg").read_bytes()


def status(job_id: str) -> dict[str, Any]:
    """Return a job's status through the entry."""
    return fetch(ENTRY, f"/api/v1/jobs/{job_id}").json()


def finished(job_id: str, timeout: float = 120.0) -> dict[str, Any]:
    """Wait until a job has finished, and return its status through the entry."""
    return wait_for(lambda: (job := status(job_id))["state"] in FINISHED and job, timeout)


def targets() -> dict[str, dict[str, Any]]:
    """Return the entry's compute targets by identifier."""
    return {target.pop("target"): target for target in fetch(ENTRY, "/api/v1/targets").json()["targets"]}


def targets_until(condition: Callable[[dict[str, dict[str, Any]]], bool]) -> dict[str, dict[str, Any]]:
    """Return the entry's compute targets once they meet the condition; a late answer leaves a target unknown."""
    return wait_for(lambda: condition(listed := targets()) and listed)
