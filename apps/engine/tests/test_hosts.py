"""Tests across hosts: the entry service and a remote host, one Redis, and package directories of their own.

Each target's worker runs in a process of its own, as the worker service does, because Celery keeps a worker's reserved
and active jobs per process. The remote host's API also runs in a process of its own, and the entry's API reaches it
over HTTP, as it would another host.
"""

import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import requests
from celery import Celery
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app, dataset_catalog, installed_versions
from dtcc_engine.jobs import Jobs

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
DIGEST = "sha256:" + "0123456789abcdef" * 4


def wait_for(condition: Callable[[], bool], timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline
        time.sleep(0.2)


def answers(app: Celery, node: str) -> bool:
    with app.connection_for_write() as connection:
        return bool(app.control.ping([node], timeout=0.5, connection=connection))


@pytest.fixture(scope="module")
def run_worker_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's worker in a process of its own until the context ends, as the worker service runs it.

    The worker also runs `engine_held_probe` (`target_worker.py`). Its log is in a temporary directory, which a failure
    to start reports.
    """
    logs = tmp_path_factory.mktemp("worker-logs")
    app = Celery(broker=redis_url, set_as_current=False)

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None) -> Iterator[None]:
        environment = {
            **os.environ,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
            "PYTHONPATH": str(Path(__file__).parent),
        }
        command = ["celery", "--app", "target_worker", "worker", "--hostname", f"celery@{target}", "--concurrency", "1"]
        log = logs / f"{target}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        try:
            deadline = time.monotonic() + 120
            while not answers(app, f"celery@{target}"):
                assert process.poll() is None and time.monotonic() < deadline, log.read_text()
            yield
        finally:
            process.terminate()
            process.wait(timeout=60)

    return run


@pytest.fixture(scope="module")
def run_api_process(redis_url: str, tmp_path_factory: pytest.TempPathFactory) -> Callable[..., Any]:
    """Run a target's Engine API in a process of its own on a free local port until the context ends; yield its address.

    Its log is in a temporary directory, which a failure to start reports.
    """
    logs = tmp_path_factory.mktemp("api-logs")

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None) -> Iterator[str]:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        environment = {
            **os.environ,
            "ENGINE_API_TOKEN": TOKEN,
            "ENGINE_REDIS_URL": redis_url,
            "ENGINE_TARGET": target,
            "ENGINE_PACKAGE_DIR": str(package_dir),
            "ENGINE_IMAGE_DIGEST": image_digest or "",
        }
        command = ["uvicorn", "dtcc_engine.api:create_app_from_environment", "--factory", "--port", str(port)]
        log = logs / f"{target}.log"
        with log.open("w") as output:
            process = subprocess.Popen([sys.executable, "-m", *command], env=environment, stdout=output, stderr=output)
        address = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 120
            while True:
                try:
                    requests.get(f"{address}/api/v1/health", timeout=1).raise_for_status()
                    break
                except requests.RequestException:
                    assert process.poll() is None and time.monotonic() < deadline, log.read_text()
                    time.sleep(0.2)
            yield address
        finally:
            process.terminate()
            process.wait(timeout=60)

    return run


@pytest.fixture(scope="module")
def hosts(
    redis_url: str,
    tmp_path_factory: pytest.TempPathFactory,
    run_worker_process: Callable[..., AbstractContextManager[None]],
    run_api_process: Callable[..., AbstractContextManager[str]],
) -> Iterator[dict[str, Any]]:
    """The entry host, target `entry`, and a remote host, target `remote`, each with its worker, in one deployment.

    Yields the remote host's address and each target's jobs; the entry's are its API's.
    """
    entry_packages, remote_packages = tmp_path_factory.mktemp("entry"), tmp_path_factory.mktemp("remote")
    with (
        run_worker_process("entry", entry_packages, DIGEST),
        run_worker_process("remote", remote_packages, DIGEST),
        run_api_process("remote", remote_packages, DIGEST) as remote_address,
    ):
        yield {
            "remote_address": remote_address,
            "entry": Jobs(redis_url, "entry", entry_packages, DIGEST),
            "remote": Jobs(redis_url, "remote", remote_packages, DIGEST),
        }


def list_targets(entry: Jobs, remote_targets: dict[str, str], token: str = TOKEN) -> dict[str, dict[str, Any]]:
    """List the compute targets through an entry API with these remote targets, by identifier."""
    response = TestClient(create_app(token, entry, remote_targets)).get(
        "/api/v1/targets", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    return {target.pop("target"): target for target in response.json()["targets"]}


def wait_for_targets(
    entry: Jobs,
    remote_targets: dict[str, str],
    condition: Callable[[dict[str, dict[str, Any]]], bool],
    token: str = TOKEN,
) -> dict[str, dict[str, Any]]:
    """List the compute targets until the listing meets the condition, and return that listing.

    A late answer leaves a worker unknown for the moment, so a condition that needs a worker's answer waits it out.
    """
    deadline = time.monotonic() + 120
    while not condition(listed := list_targets(entry, remote_targets, token)):
        assert time.monotonic() < deadline, listed
        time.sleep(0.2)
    return listed


def known(listed: dict[str, dict[str, Any]]) -> bool:
    return all(target["state"] != "unknown" for target in listed.values())


def test_targets_report_each_hosts_discovery_and_its_workers_own_answer(hosts: dict[str, Any]) -> None:
    targets = wait_for_targets(hosts["entry"], {"remote": hosts["remote_address"]}, known)
    catalog = dataset_catalog()
    host = {
        "image_digest": DIGEST,
        "versions": installed_versions(),
        "catalog_revision": catalog["catalog_revision"],
        "datasets": sorted(catalog["datasets"]),
    }
    assert list(targets) == ["entry", "remote"]
    for target, listed in targets.items():
        assert listed == {
            "state": "ready",
            "reason": None,
            "worker": {
                "image_digest": DIGEST,
                "versions": installed_versions(),
                "job_limit": 1,
                "reserved": 0,
                "queues": [target],
            },
            "waiting": 0,
            "host": host,
            "host_error": None,
        }


def test_target_whose_worker_holds_its_limit_or_has_jobs_waiting_is_busy(hosts: dict[str, Any]) -> None:
    entry, remote = hosts["entry"], hosts["remote"]
    remote_targets = {"remote": hosts["remote_address"]}
    release = f"engine-test:release:{uuid.uuid4()}"
    parameters = {"bounds": BOUNDS, "release_key": release}
    try:
        held = remote.submit("engine_held_probe", parameters)
        holding = wait_for_targets(
            entry, remote_targets, lambda listed: known(listed) and listed["remote"]["worker"]["reserved"] == 1
        )
        waiting = remote.submit("engine_held_probe", parameters)
        holding_and_waiting = wait_for_targets(
            entry, remote_targets, lambda listed: known(listed) and listed["remote"]["waiting"] == 1
        )
    finally:
        remote.records.set(release, 1)
    wait_for(lambda: all(remote.status(job_id)["state"] == "completed" for job_id in (held, waiting)))
    wait_for_targets(entry, remote_targets, lambda listed: listed["remote"]["state"] == "ready")
    for listed, expected_waiting in ((holding, 0), (holding_and_waiting, 1)):
        assert listed["entry"]["state"] == "ready"
        assert listed["remote"]["state"] == "busy"
        assert listed["remote"]["worker"]["reserved"] == 1
        assert listed["remote"]["waiting"] == expected_waiting
        # The answer counts jobs and never repeats their arguments.
        assert set(listed["remote"]["worker"]) == {"image_digest", "versions", "job_limit", "reserved", "queues"}
        assert release not in str(listed)


def test_target_whose_api_answers_but_whose_worker_does_not_is_unknown(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    with run_api_process("workerless", tmp_path) as address:
        listed = list_targets(Jobs(redis_url, "observing", tmp_path), {"workerless": address})["workerless"]
    assert listed["host"] is not None and listed["host_error"] is None
    assert (listed["state"], listed["worker"]) == ("unknown", None)


def closed_address() -> str:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{probe.getsockname()[1]}"


@pytest.mark.parametrize(
    ("identifier", "address", "token", "host_error"),
    [
        ("remote", "closed", TOKEN, "The host could not be reached"),
        ("remote", "remote", "other-token", "The host rejected the token"),
        ("elsewhere", "remote", TOKEN, "The host answers as another target"),
    ],
    ids=["unreachable", "rejected-token", "other-target"],
)
def test_host_whose_discovery_cannot_be_read_is_reported_with_the_reason(
    hosts: dict[str, Any], identifier: str, address: str, token: str, host_error: str
) -> None:
    configured = closed_address() if address == "closed" else hosts["remote_address"]
    # The worker is observed through the broker, whatever its host's HTTP service answers.
    state = "ready" if identifier == "remote" else "unknown"
    listed = wait_for_targets(
        hosts["entry"],
        {identifier: configured},
        lambda listed: state == "unknown" or listed[identifier]["state"] != "unknown",
        token,
    )[identifier]
    assert (listed["host"], listed["host_error"]) == (None, host_error)
    assert listed["state"] == state


@pytest.fixture
def redirecting_host() -> Iterator[tuple[str, list[tuple[str, str | None]]]]:
    """A host that records each request's path and authorization, and redirects it to another path of its own."""
    received: list[tuple[str, str | None]] = []

    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            received.append((self.path, self.headers.get("Authorization")))
            self.send_response(307)
            self.send_header("Location", "/elsewhere")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", received
    finally:
        server.shutdown()
        server.server_close()


def test_host_local_discovery_queries_no_other_host(
    redis_url: str, tmp_path: Path, redirecting_host: tuple[str, list[tuple[str, str | None]]]
) -> None:
    address, received = redirecting_host
    client = TestClient(create_app(TOKEN, Jobs(redis_url, "querying", tmp_path), {"recording": address}))
    assert client.get("/api/v1/host", headers=AUTHORIZED).status_code == 200
    assert client.get("/api/v1/datasets", headers=AUTHORIZED).status_code == 200
    assert received == []


def test_redirect_from_a_host_is_not_followed(
    redis_url: str, tmp_path: Path, redirecting_host: tuple[str, list[tuple[str, str | None]]]
) -> None:
    address, received = redirecting_host
    listed = list_targets(Jobs(redis_url, "redirected", tmp_path), {"redirecting": address})["redirecting"]
    assert (listed["host"], listed["host_error"]) == (None, "The host answered HTTP 307")
    assert received == [("/api/v1/host", f"Bearer {TOKEN}")]


def test_host_is_sent_the_shared_token_and_no_other_credential(
    monkeypatch: pytest.MonkeyPatch,
    redis_url: str,
    tmp_path: Path,
    redirecting_host: tuple[str, list[tuple[str, str | None]]],
) -> None:
    address, received = redirecting_host
    # Credentials that requests would send to this host in place of a header it was given.
    netrc = tmp_path / "netrc"
    netrc.write_text("machine 127.0.0.1 login engine password secret\n")
    monkeypatch.setenv("NETRC", str(netrc))
    list_targets(Jobs(redis_url, "authenticating", tmp_path), {"recording": address})
    assert received == [("/api/v1/host", f"Bearer {TOKEN}")]
