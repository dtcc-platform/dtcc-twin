"""Tests across hosts: the entry service and a remote host, one Redis, and package directories of their own.

Each target's worker runs in a process of its own, as the worker service does, because Celery keeps a worker's reserved
and active jobs per process. Each host's API also runs in a process of its own, and the entry's API reaches the remote
one over HTTP, as it would another host.
"""

import gzip
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager, ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
import requests
from celery import Celery
from dtcc_core.datasets import DatasetBaseArgs, DatasetDescriptor, unregister
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app, dataset_catalog, installed_versions
from dtcc_engine.jobs import RECORD_LIFETIME, RETENTION, Jobs, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
TOKEN = "test-token"
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
DIGEST = "sha256:" + "0123456789abcdef" * 4
CHUNK = 64 * 1024


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

    Its remote targets are given as `ENGINE_REMOTE_TARGETS` is. Its log is in a temporary directory, which a failure to
    start reports.
    """
    logs = tmp_path_factory.mktemp("api-logs")

    @contextmanager
    def run(target: str, package_dir: Path, image_digest: str | None = None, remote_targets: str = "") -> Iterator[str]:
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
            "ENGINE_REMOTE_TARGETS": remote_targets,
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
    """The entry host, target `entry`, and a remote host, target `remote`, each with its worker and API, in one deployment.

    Yields each host's address and the entry's package directory, and each target's jobs, as its host's API has them.
    """
    entry_packages, remote_packages = tmp_path_factory.mktemp("entry"), tmp_path_factory.mktemp("remote")
    with (
        run_worker_process("entry", entry_packages, DIGEST),
        run_worker_process("remote", remote_packages, DIGEST),
        run_api_process("remote", remote_packages, DIGEST) as remote_address,
        run_api_process("entry", entry_packages, DIGEST, f"remote={remote_address}") as entry_address,
    ):
        yield {
            "entry_address": entry_address,
            "remote_address": remote_address,
            "entry_packages": entry_packages,
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


def fetch(address: str, path: str, method: str = "GET", **options: Any) -> requests.Response:
    """Send a request with the shared token to an Engine API process."""
    return requests.request(method, f"{address}{path}", headers=AUTHORIZED, timeout=60, **options)


def completed_job(jobs: Jobs) -> str:
    """Run a `smoke` job on the jobs' target, and return its ID once it completes."""
    job_id = jobs.submit("smoke", {"bounds": BOUNDS})
    wait_for(lambda: jobs.status(job_id)["state"] == "completed")
    return job_id


def recorded_job(jobs: Jobs, target: str, outcome: str | None) -> str:
    """Record a job of a target as its worker would, queued or with an outcome, without running it; return its ID."""
    job_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    fields = {"dataset": "smoke", "target": target, "submitted_at": now, "queued_at": now, "execution_gate": "waiting"}
    if outcome is not None:
        fields.update({"execution_gate": "started", "outcome": outcome, "finished_at": now})
    with jobs.records.pipeline() as pipeline:
        pipeline.hset(record_key(job_id), mapping=fields)
        pipeline.expire(record_key(job_id), RECORD_LIFETIME)
        pipeline.execute()
    return job_id


@contextmanager
def serve(answer: Callable[[BaseHTTPRequestHandler], None]) -> Iterator[str]:
    """Answer each GET and HEAD request on a free local port until the context ends; yield the address."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            answer(self)

        do_HEAD = do_GET

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def remote_job(hosts: dict[str, Any]) -> str:
    """A completed job of the remote target, whose package its host keeps."""
    return completed_job(hosts["remote"])


def test_remote_job_is_polled_and_downloaded_through_the_entry(hosts: dict[str, Any], remote_job: str) -> None:
    entry, remote = hosts["entry_address"], hosts["remote"]
    kept = set(hosts["entry_packages"].iterdir())
    polled = fetch(entry, f"/api/v1/jobs/{remote_job}")
    downloaded = fetch(entry, f"/api/v1/jobs/{remote_job}/package")
    package = remote.package_path(remote_job).read_bytes()
    # The entry reports the job as its host does, and a download does not extend the package's retention.
    assert polled.json() == remote.status(remote_job) == fetch(entry, f"/api/v1/jobs/{remote_job}").json()
    assert polled.json()["package"]["available"] is True
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/zip"
    assert downloaded.headers["content-disposition"] == f'attachment; filename="{remote_job}.dtccpkg"'
    assert downloaded.headers["content-length"] == str(len(package))
    assert downloaded.content == package
    # The entry streams the package through and keeps no copy.
    assert set(hosts["entry_packages"].iterdir()) == kept


def test_remote_job_reports_the_environment_of_the_worker_that_ran_it(hosts: dict[str, Any], remote_job: str) -> None:
    job = fetch(hosts["entry_address"], f"/api/v1/jobs/{remote_job}").json()
    assert job["environment"] == {"image_digest": DIGEST, "versions": installed_versions()}


def test_remote_package_its_host_no_longer_has_is_unavailable(hosts: dict[str, Any]) -> None:
    job_id = completed_job(hosts["remote"])
    hosts["remote"].package_path(job_id).unlink()
    polled = fetch(hosts["entry_address"], f"/api/v1/jobs/{job_id}")
    downloaded = fetch(hosts["entry_address"], f"/api/v1/jobs/{job_id}/package")
    assert polled.json()["package"]["available"] is False
    assert downloaded.status_code == 409
    assert downloaded.json() == {"detail": f"Job '{job_id}' has no package on its host"}


@pytest.mark.parametrize(
    ("host", "token", "detail"),
    [
        ("closed", TOKEN, "The job's host could not be reached"),
        ("remote", "other-token", "The job's host rejected the token"),
        ("elsewhere", TOKEN, "The job's host answered HTTP 404"),
        ("unconfigured", TOKEN, "The job's target 'remote' is not configured on this Engine"),
    ],
    ids=["unreachable", "rejected-token", "other-target", "unconfigured"],
)
def test_remote_package_whose_host_does_not_deliver_it_is_unknown(
    hosts: dict[str, Any],
    remote_job: str,
    tmp_path: Path,
    run_api_process: Callable[..., AbstractContextManager[str]],
    host: str,
    token: str,
    detail: str,
) -> None:
    with ExitStack() as stack:
        if host == "closed":
            remote_targets = {"remote": closed_address()}
        elif host == "elsewhere":
            # The host of another target, which does not serve the remote target's packages.
            remote_targets = {"remote": stack.enter_context(run_api_process("elsewhere", tmp_path))}
        elif host == "unconfigured":
            remote_targets = {}
        else:
            remote_targets = {"remote": hosts["remote_address"]}
        client = TestClient(create_app(token, hosts["entry"], remote_targets))
        headers = {"Authorization": f"Bearer {token}"}
        polled = client.get(f"/api/v1/jobs/{remote_job}", headers=headers)
        downloaded = client.get(f"/api/v1/jobs/{remote_job}/package", headers=headers)
    # Everything else the entry reads from the shared records.
    owned = hosts["remote"].status(remote_job)
    assert polled.json() == {**owned, "package": {**owned["package"], "available": None}}
    assert (downloaded.status_code, downloaded.json()) == (503, {"detail": detail})


def redirect(request: BaseHTTPRequestHandler) -> None:
    request.send_response(307)
    request.send_header("Location", "/elsewhere")
    request.send_header("Content-Length", "0")
    request.end_headers()


def fail_with_details(request: BaseHTTPRequestHandler) -> None:
    body = b"secret details"
    request.send_response(500)
    request.send_header("Content-Length", str(len(body)))
    request.end_headers()
    if request.command == "GET":
        request.wfile.write(body)


@pytest.mark.parametrize(
    ("answer", "status_code"), [(redirect, 307), (fail_with_details, 500)], ids=["redirect", "server-error"]
)
def test_host_answer_that_is_not_a_package_is_not_passed_on(
    redis_url: str, tmp_path: Path, answer: Callable[[BaseHTTPRequestHandler], None], status_code: int
) -> None:
    received: list[tuple[str, str, str | None]] = []

    def record_and_answer(request: BaseHTTPRequestHandler) -> None:
        received.append((request.command, request.path, request.headers.get("Authorization")))
        answer(request)

    entry = Jobs(redis_url, "entry", tmp_path)
    job_id = recorded_job(entry, "stubbed", "completed")
    with serve(record_and_answer) as address:
        client = TestClient(create_app(TOKEN, entry, {"stubbed": address}))
        polled = client.get(f"/api/v1/jobs/{job_id}", headers=AUTHORIZED)
        downloaded = client.get(f"/api/v1/jobs/{job_id}/package", headers=AUTHORIZED)
    assert polled.json()["package"]["available"] is None
    assert downloaded.status_code == 503
    assert downloaded.json() == {"detail": f"The job's host answered HTTP {status_code}"}
    # Each is asked once, with the shared token, and a redirect is not followed.
    path = f"/api/v1/host/jobs/{job_id}/package"
    assert received == [("HEAD", path, f"Bearer {TOKEN}"), ("GET", path, f"Bearer {TOKEN}")]


def test_package_its_host_stops_sending_is_not_delivered_whole(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    def send_half(request: BaseHTTPRequestHandler) -> None:
        request.send_response(200)
        request.send_header("Content-Length", str(2 * CHUNK))
        request.end_headers()
        request.wfile.write(b"x" * CHUNK)

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_half) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        # The client sees the download fail, not a shorter archive.
        with pytest.raises(requests.exceptions.ChunkedEncodingError):
            fetch(entry, f"/api/v1/jobs/{job_id}/package")


def test_package_its_host_sends_compressed_is_delivered_as_the_archive(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    archive = b"package " * CHUNK

    def send_compressed(request: BaseHTTPRequestHandler) -> None:
        body = gzip.compress(archive)
        request.send_response(200)
        request.send_header("Content-Encoding", "gzip")
        request.send_header("Content-Length", str(len(body)))
        request.end_headers()
        request.wfile.write(body)

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_compressed) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        downloaded = fetch(entry, f"/api/v1/jobs/{job_id}/package")
    # Not the host's encoding of the archive, nor that encoding's length.
    assert (downloaded.status_code, downloaded.content) == (200, archive)


def test_download_the_client_abandons_releases_its_hosts_connection(
    redis_url: str, tmp_path: Path, run_api_process: Callable[..., AbstractContextManager[str]]
) -> None:
    released = threading.Event()

    def send_slowly(request: BaseHTTPRequestHandler) -> None:
        request.send_response(200)
        request.send_header("Content-Length", str(1000 * CHUNK))
        request.end_headers()
        try:
            for _ in range(1000):
                request.wfile.write(b"x" * CHUNK)
                time.sleep(0.05)
        except OSError:
            released.set()

    job_id = recorded_job(Jobs(redis_url, "entry", tmp_path), "stubbed", "completed")
    with serve(send_slowly) as address, run_api_process("entry", tmp_path, None, f"stubbed={address}") as entry:
        with fetch(entry, f"/api/v1/jobs/{job_id}/package", stream=True) as response:
            assert response.status_code == 200
            next(response.iter_content(CHUNK))
        assert released.wait(30)
        assert fetch(entry, "/api/v1/health").status_code == 200


def test_host_serves_its_own_packages_and_forwards_none(hosts: dict[str, Any], remote_job: str) -> None:
    path = f"/api/v1/host/jobs/{remote_job}/package"
    package = hosts["remote"].package_path(remote_job).read_bytes()
    served = fetch(hosts["remote_address"], path)
    described = fetch(hosts["remote_address"], path, "HEAD")
    elsewhere = fetch(hosts["entry_address"], path)
    assert (served.status_code, served.content) == (200, package)
    assert (described.status_code, described.content) == (200, b"")
    assert described.headers["content-length"] == str(len(package))
    assert elsewhere.status_code == 404
    assert elsewhere.json() == {"detail": f"Job '{remote_job}' did not run on this host"}


def test_host_has_no_package_for_an_unfinished_or_unknown_job(hosts: dict[str, Any]) -> None:
    queued = recorded_job(hosts["remote"], "remote", None)
    unfinished = fetch(hosts["remote_address"], f"/api/v1/host/jobs/{queued}/package")
    unknown_id = str(uuid.uuid4())
    unknown = fetch(hosts["remote_address"], f"/api/v1/host/jobs/{unknown_id}/package")
    entry = fetch(hosts["entry_address"], f"/api/v1/jobs/{queued}/package")
    assert (unfinished.status_code, entry.status_code) == (409, 409)
    assert (unknown.status_code, unknown.json()) == (404, {"detail": f"Job '{unknown_id}' is unknown or expired"})


def test_remote_package_past_its_retention_is_unknown_though_its_file_remains(hosts: dict[str, Any]) -> None:
    remote = hosts["remote"]
    job_id = completed_job(remote)
    # Moves the recorded finish time back instead of waiting 30 days.
    expired = (datetime.now(UTC) - RETENTION - timedelta(seconds=1)).isoformat()
    remote.records.hset(record_key(job_id), "finished_at", expired)
    paths = [
        (hosts["entry_address"], f"/api/v1/jobs/{job_id}"),
        (hosts["entry_address"], f"/api/v1/jobs/{job_id}/package"),
        (hosts["remote_address"], f"/api/v1/host/jobs/{job_id}/package"),
    ]
    assert remote.package_path(job_id).is_file()
    for address, path in paths:
        refused = fetch(address, path)
        assert (refused.status_code, refused.json()) == (404, {"detail": f"Job '{job_id}' is unknown or expired"})


def states(listed: dict[str, dict[str, Any]]) -> list[str]:
    return [target["state"] for target in listed.values()]


def ready(listed: dict[str, dict[str, Any]]) -> bool:
    return all(state == "ready" for state in states(listed))


def submit_through(address: str, target: str | None) -> str:
    """Submit a `smoke` job through an Engine API process, to `target` or by automatic placement; return its ID."""
    request = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}, "target": target}
    response = fetch(address, "/api/v1/jobs", "POST", json=request)
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


@pytest.mark.parametrize(
    ("requested", "target"), [(None, "entry"), ("remote", "remote")], ids=["automatic", "requested"]
)
def test_job_submitted_through_the_entry_runs_on_its_target_and_is_delivered_through_the_entry(
    hosts: dict[str, Any], requested: str | None, target: str
) -> None:
    entry = hosts["entry_address"]
    wait_for_targets(hosts["entry"], {"remote": hosts["remote_address"]}, ready)
    job_id = submit_through(entry, requested)
    wait_for(lambda: fetch(entry, f"/api/v1/jobs/{job_id}").json()["state"] == "completed")
    job = fetch(entry, f"/api/v1/jobs/{job_id}").json()
    assert (job["target"], job["package"]["available"]) == (target, True)
    # The package is on the host whose worker ran the job.
    assert fetch(entry, f"/api/v1/jobs/{job_id}/package").content == hosts[target].package_path(job_id).read_bytes()


def test_automatic_placement_follows_the_configured_order_of_the_remote_targets(
    redis_url: str, tmp_path: Path, hosts: dict[str, Any]
) -> None:
    # No worker serves this API's own target, so it places jobs on the hosts' targets, as remote ones, in their order.
    workerless = Jobs(redis_url, "workerless", tmp_path, DIGEST)
    for order in (["entry", "remote"], ["remote", "entry"]):
        wait_for_targets(hosts["entry"], {"remote": hosts["remote_address"]}, ready)
        client = TestClient(create_app(TOKEN, workerless, {target: hosts[f"{target}_address"] for target in order}))
        request = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}}
        response = client.post("/api/v1/jobs", json=request, headers=AUTHORIZED)
        assert response.status_code == 202, response.text
        job_id = response.json()["job_id"]
        assert workerless.status(job_id)["target"] == order[0]
        wait_for(lambda: workerless.status(job_id)["state"] == "completed")


def test_jobs_pass_a_busy_target_and_queue_on_one_when_none_is_ready(hosts: dict[str, Any]) -> None:
    entry, remote, address = hosts["entry"], hosts["remote"], hosts["entry_address"]
    remote_targets = {"remote": hosts["remote_address"]}
    held = {"bounds": BOUNDS, "release_key": f"engine-test:release:{uuid.uuid4()}"}
    try:
        entry.submit("engine_held_probe", held)
        wait_for_targets(entry, remote_targets, lambda listed: states(listed) == ["busy", "ready"])
        passed = submit_through(address, None)
        assert entry.status(passed)["target"] == "remote"
        wait_for(lambda: entry.status(passed)["state"] == "completed")
        remote.submit("engine_held_probe", held)
        wait_for_targets(entry, remote_targets, lambda listed: states(listed) == ["busy", "busy"])
        queued = {requested: submit_through(address, requested) for requested in (None, "remote")}
        held_back = {requested: entry.status(job_id) for requested, job_id in queued.items()}
    finally:
        entry.records.set(held["release_key"], 1)
    # With every target busy, automatic placement queues on this host's, and a requested target queues its job.
    assert {requested: (job["target"], job["state"]) for requested, job in held_back.items()} == {
        None: ("entry", "queued"),
        "remote": ("remote", "queued"),
    }
    wait_for(lambda: all(entry.status(job_id)["state"] == "completed" for job_id in queued.values()))


@pytest.fixture
def held_probe() -> Iterator[None]:
    """Register `engine_held_probe` in this process for a test, with the arguments that `target_worker.py` gives it,
    so that an API in this process accepts its jobs, which only the workers run."""

    class HeldProbeArgs(DatasetBaseArgs):
        release_key: str

    class HeldProbeDataset(DatasetDescriptor):
        name = "engine_held_probe"
        description = "Dataset defined by an Engine test that runs until a test releases it"
        ArgsModel = HeldProbeArgs

        def build(self, args):
            raise NotImplementedError

    try:
        yield
    finally:
        unregister("engine_held_probe")


def test_concurrent_submissions_run_no_more_jobs_on_a_host_than_its_limit(
    hosts: dict[str, Any], held_probe: None
) -> None:
    entry, remote_targets = hosts["entry"], {"remote": hosts["remote_address"]}
    app = create_app(TOKEN, entry, remote_targets)
    release = f"engine-test:release:{uuid.uuid4()}"
    request = {"dataset": "engine_held_probe", "parameters": {"bounds": BOUNDS, "release_key": release}}
    wait_for_targets(entry, remote_targets, ready)
    try:
        # The submissions observe the targets at about the same time, so several see the same capacity.
        with ThreadPoolExecutor(6) as pool:
            responses = list(
                pool.map(lambda _: TestClient(app).post("/api/v1/jobs", json=request, headers=AUTHORIZED), range(6))
            )
        assert [response.status_code for response in responses] == [202] * 6
        job_ids = [response.json()["job_id"] for response in responses]

        def each_target_runs_a_job() -> bool:
            jobs = [entry.status(job_id) for job_id in job_ids]
            return {job["target"] for job in jobs if job["state"] == "running"} == {job["target"] for job in jobs}

        wait_for(each_target_runs_a_job)
        held = [entry.status(job_id) for job_id in job_ids]
    finally:
        entry.records.set(release, 1)
    # Each target's worker, whose limit is 1, runs one of the jobs placed on it, and the others wait in its queue.
    for target in {job["target"] for job in held}:
        placed = sorted(job["state"] for job in held if job["target"] == target)
        assert placed == ["queued"] * (len(placed) - 1) + ["running"]
    wait_for(lambda: all(entry.status(job_id)["state"] == "completed" for job_id in job_ids))
