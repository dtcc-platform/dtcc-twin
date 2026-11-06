"""Tests of compute targets: each target's identifier, image digest, and the node name and queue its worker uses; the
remote targets of the entry service; the observation of a target's worker; and the selection of a job's target.

The worker checks are run through Celery's command line, as the worker service runs it, because a worker that refuses
to start ends its process.
"""

import contextlib
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
import redis
from celery.worker.control import Panel
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app, create_app_from_environment, installed_versions
from dtcc_engine.jobs import (
    WORKER_REGISTRATION,
    WORKER_REGISTRATION_RENEWAL,
    Jobs,
    jobs_from_environment,
    record_key,
    worker_key,
)

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
DIGEST = "sha256:" + "0123456789abcdef" * 4
OTHER_DIGEST = "sha256:" + "fedcba9876543210" * 4


def observe_until(jobs: Jobs, target: str, condition: Callable[[dict[str, Any]], bool]) -> dict[str, Any]:
    """Observe a target until the observation meets the condition, and return that observation."""
    deadline = time.monotonic() + 30
    while not condition(observed := jobs.observe(target)):
        assert time.monotonic() < deadline, observed
        time.sleep(0.1)
    return observed


def configure(monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str) -> None:
    monkeypatch.setenv("ENGINE_REDIS_URL", redis_url)
    monkeypatch.setenv("ENGINE_TARGET", target)
    monkeypatch.setenv("ENGINE_PACKAGE_DIR", str(tmp_path))


@pytest.mark.parametrize(
    "target",
    ["", "Local", "two words", "celery@local", "-local", "local-", "two--hyphens", "under_score"],
)
def test_target_identifier_that_cannot_name_a_node_is_refused(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, target)
    with pytest.raises(ValueError):
        jobs_from_environment()


@pytest.mark.parametrize(
    "digest",
    [
        "0123456789abcdef" * 4,
        "sha256:" + "0" * 63,
        "sha256:" + "0" * 65,
        "sha256:" + "ABCDEF0123456789" * 4,
        "sha512:" + "0" * 64,
        " sha256:" + "0" * 64,
    ],
    ids=["no-algorithm", "short", "long", "uppercase", "other-algorithm", "padded"],
)
def test_malformed_image_digest_is_refused(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, digest: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_IMAGE_DIGEST", digest)
    with pytest.raises(ValueError):
        jobs_from_environment()


def run_worker(
    redis_url: str, package_dir: Path, target: str, node: str, *options: str
) -> subprocess.CompletedProcess[str]:
    """Run the worker as the worker service does, as `node`; a worker that keeps running raises TimeoutExpired."""
    environment = {
        **os.environ,
        "ENGINE_REDIS_URL": redis_url,
        "ENGINE_TARGET": target,
        "ENGINE_PACKAGE_DIR": str(package_dir),
    }
    command = ["celery", "--app", "dtcc_engine.worker", "worker", "--hostname", node, "--pool", "solo", *options]
    return subprocess.run([sys.executable, "-m", *command], env=environment, capture_output=True, text=True, timeout=30)


@pytest.mark.parametrize(
    "node",
    ["celery@engine-worker", "w-1@named", "W1@named", "w1.a@named"],
    ids=["other-target", "hyphen", "uppercase", "dot"],
)
def test_worker_refuses_a_node_name_that_is_not_a_name_of_its_target(redis_url: str, tmp_path: Path, node: str) -> None:
    ended = run_worker(redis_url, tmp_path, "named", node)
    assert ended.returncode == 1
    assert "must run as <name>@named, with lowercase letters and digits as its name, not " in ended.stderr


@pytest.mark.parametrize("queues", ["intended", "other,intended"])
def test_worker_refuses_a_queue_other_than_its_targets_and_runs_none_of_its_jobs(
    redis_url: str, tmp_path: Path, queues: str
) -> None:
    intended = Jobs(redis_url, "intended", tmp_path / "intended")
    job_id = intended.submit("smoke", {"bounds": BOUNDS})
    ended = run_worker(redis_url, tmp_path / "other", "other", "celery@other", "--queues", queues)
    assert ended.returncode == 1
    assert "must consume only the queue 'other'" in ended.stderr
    assert intended.status(job_id)["state"] == "queued"


def test_worker_refuses_the_node_name_of_a_running_worker_and_fails_none_of_its_jobs(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    running = Jobs(redis_url, "duplicated", tmp_path / "running")
    with start_target_worker(running):
        # A job the running worker claimed; a worker that started again as it would record its failure.
        job_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        claim = f"celery@duplicated {running.worker_run} {os.getpid()}"
        acceptance = {"dataset": "smoke", "target": "duplicated", "submitted_at": now, "queued_at": now}
        running.records.hset(
            record_key(job_id), mapping={**acceptance, "execution_gate": "started", "claimed_by": claim}
        )
        running.celery_app.backend.store_result(
            job_id, {"pid": os.getpid(), "hostname": "celery@duplicated"}, "STARTED"
        )
        ended = run_worker(redis_url, tmp_path / "starting", "duplicated", "celery@duplicated")
        job = running.status(job_id)
    assert ended.returncode == 1
    assert "Another running worker answers as celery@duplicated" in ended.stderr
    assert (job["state"], job["finished_at"]) == ("running", None)


@pytest.mark.parametrize(
    "remote_targets",
    [
        "remote",
        "remote=",
        "Remote=http://127.0.0.1:9",
        "remote=http://127.0.0.1:9,",
        "local=http://127.0.0.1:9",
        "remote=http://127.0.0.1:9,remote=http://127.0.0.1:10",
        "remote=127.0.0.1:9",
        "remote=ftp://127.0.0.1:9",
        "remote=http://",
        "remote=http://127.0.0.1:secret",
        "remote=http://engine:secret@exa\uff0fmple.test",
        "remote=http://[secret]",
        "remote=http://engine:secret@127.0.0.1:9",
        "remote=http://127.0.0.1:9?token=secret",
        "remote=http://127.0.0.1:9#secret",
        "remote=http://127.0.0.1:9?",
        "remote=http://127.0.0.1:9#",
    ],
    ids=[
        "no-address",
        "empty-address",
        "malformed-identifier",
        "empty-entry",
        "local-identifier",
        "repeated-identifier",
        "no-scheme",
        "other-scheme",
        "no-host",
        "malformed-port",
        "host-invalid-after-normalization",
        "bracketed-host-not-an-address",
        "credentials",
        "query",
        "fragment",
        "empty-query",
        "empty-fragment",
    ],
)
def test_remote_targets_that_cannot_be_used_are_refused_without_repeating_their_addresses(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, remote_targets: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_API_TOKEN", "test-token")
    monkeypatch.setenv("ENGINE_REMOTE_TARGETS", remote_targets)
    with pytest.raises(ValueError) as refused:
        create_app_from_environment()
    # What the API logs when it refuses to start: the error, and any error it was raised from.
    assert "secret" not in "".join(traceback.format_exception(refused.value))


@pytest.mark.parametrize(
    ("remote_targets", "listed"),
    [
        (None, ["local"]),
        ("", ["local"]),
        ("second=http://127.0.0.1:9,first=https://127.0.0.1:9/engine/", ["local", "second", "first"]),
    ],
    ids=["unset", "empty", "two"],
)
def test_targets_are_listed_local_first_then_in_configured_order(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, remote_targets: str | None, listed: list[str]
) -> None:
    configure(monkeypatch, redis_url, tmp_path, "local")
    monkeypatch.setenv("ENGINE_API_TOKEN", "test-token")
    if remote_targets is None:
        monkeypatch.delenv("ENGINE_REMOTE_TARGETS", raising=False)
    else:
        monkeypatch.setenv("ENGINE_REMOTE_TARGETS", remote_targets)
    client = TestClient(create_app_from_environment())
    response = client.get("/api/v1/targets", headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert [target["target"] for target in response.json()["targets"]] == listed


def test_target_whose_worker_does_not_answer_is_unknown(redis_url: str, tmp_path: Path) -> None:
    jobs = Jobs(redis_url, "absent", tmp_path)
    jobs.submit("smoke", {"bounds": BOUNDS})
    assert jobs.observe("absent") == {
        "state": "unknown",
        "reason": "Its worker did not answer within 0.5 s",
        "worker": None,
        "waiting": 1,
        "workers": {"celery@absent": None},
    }


def test_target_is_unknown_while_the_broker_does_not_answer(tmp_path: Path) -> None:
    jobs = Jobs("redis://127.0.0.1:1/0", "unreachable", tmp_path)
    assert jobs.observe("unreachable") == {
        "state": "unknown",
        "reason": "The broker did not answer",
        "worker": None,
        "waiting": None,
        "workers": None,
    }


def shut(open_socket: socket.socket) -> None:
    """Close a socket and wake the threads blocked on it: closing alone wakes none, and their calls keep it open."""
    with contextlib.suppress(OSError):
        open_socket.shutdown(socket.SHUT_RDWR)
    open_socket.close()


def end(thread: threading.Thread) -> None:
    """Wait for a thread whose socket was shut, failing instead of waiting for ever."""
    thread.join(5)
    assert not thread.is_alive(), thread


@pytest.fixture
def silent_broker() -> Iterator[str]:
    """The address of a broker that accepts connections and never answers, as one that has stopped responding would."""
    server = socket.create_server(("127.0.0.1", 0))
    accepted: list[socket.socket] = []

    def accept() -> None:
        while True:
            try:
                accepted.append(server.accept()[0])
            except OSError:
                return

    accepting = threading.Thread(target=accept, daemon=True)
    accepting.start()
    try:
        yield f"redis://127.0.0.1:{server.getsockname()[1]}/0"
    finally:
        shut(server)
        end(accepting)
        for connection in accepted:
            connection.close()


@pytest.fixture
def broker_silent_after_publishing(redis_url: str) -> Iterator[str]:
    """The address of a broker that relays the tests' Redis until it is sent a PUBLISH, as an observation's command is,
    and from then on never answers, as one that stops responding during an observation would."""
    upstream = urlsplit(redis_url)
    server = socket.create_server(("127.0.0.1", 0))
    sockets: list[socket.socket] = []
    relays: list[threading.Thread] = []
    published = threading.Event()

    def relay(source: socket.socket, sink: socket.socket, from_client: bool) -> None:
        try:
            while data := source.recv(65536):
                if from_client and b"PUBLISH" in data:
                    published.set()
                if from_client or not published.is_set():
                    sink.sendall(data)
        except OSError:
            pass

    def accept() -> None:
        while True:
            try:
                client = server.accept()[0]
            except OSError:
                return
            redis = socket.create_connection((upstream.hostname, upstream.port or 6379))
            sockets.extend([client, redis])
            for args in ((client, redis, True), (redis, client, False)):
                relays.append(threading.Thread(target=relay, args=args, daemon=True))
                relays[-1].start()

    accepting = threading.Thread(target=accept, daemon=True)
    accepting.start()
    try:
        yield f"redis://127.0.0.1:{server.getsockname()[1]}{upstream.path}"
    finally:
        # The listener first, so that no connection is added while the others are shut.
        shut(server)
        end(accepting)
        for open_socket in sockets:
            shut(open_socket)
        for thread in relays:
            end(thread)


@pytest.mark.parametrize("broker", ["refusing", "silent", "silent-after-publishing"])
def test_observation_ends_within_seconds_while_the_broker_does_not_answer(
    silent_broker: str, broker_silent_after_publishing: str, tmp_path: Path, broker: str
) -> None:
    addresses = {
        "refusing": "redis://127.0.0.1:1/0",
        "silent": silent_broker,
        "silent-after-publishing": broker_silent_after_publishing,
    }
    jobs = Jobs(addresses[broker], "unanswered", tmp_path)
    observed: list[dict[str, Any]] = []
    # In a thread of its own, so that an observation that never ends fails the test instead of stopping the run.
    observation = threading.Thread(target=lambda: observed.append(jobs.observe("unanswered")), daemon=True)
    start = time.monotonic()
    observation.start()
    observation.join(30)
    assert observed == [
        {"state": "unknown", "reason": "The broker did not answer", "worker": None, "waiting": None, "workers": None}
    ]
    assert time.monotonic() - start < 4


def test_worker_without_engines_inspect_command_is_unknown(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    # As a worker of an Engine without the command would, it answers with an error.
    monkeypatch.delitem(Panel.data, "engine_worker", raising=False)
    jobs = Jobs(redis_url, "commandless", tmp_path)
    with start_target_worker(jobs):
        observed = jobs.observe("commandless")
    assert observed == {
        "state": "unknown",
        "reason": "Its worker's answer is malformed",
        "worker": None,
        "waiting": 0,
        "workers": {"celery@commandless": None},
    }


@pytest.mark.parametrize("change", ["added", "cancelled"])
def test_worker_that_does_not_consume_exactly_its_queue_is_unavailable(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any], change: str
) -> None:
    jobs = Jobs(redis_url, "requeued", tmp_path)
    control = jobs.celery_app.control
    with start_target_worker(jobs):
        if change == "added":
            control.add_consumer("extra", destination=["celery@requeued"], reply=True)
        else:
            control.cancel_consumer("requeued", destination=["celery@requeued"], reply=True)
        # The worker changes its queues after it answers, and a late answer leaves the worker unknown for the moment.
        observed = observe_until(
            jobs,
            "requeued",
            lambda observed: observed["worker"] is not None and observed["worker"]["queues"] != ["requeued"],
        )
    assert observed["state"] == "unavailable"
    assert observed["reason"] == "Its worker does not consume exactly the queue 'requeued'"
    assert observed["worker"]["queues"] == (["extra", "requeued"] if change == "added" else [])


@pytest.mark.parametrize(
    ("worker_digest", "expected"),
    [
        (
            DIGEST,
            {
                ("local", DIGEST): "ready",
                ("local", None): "ready",
                ("remote", DIGEST): "ready",
                ("remote", None): "incompatible",
            },
        ),
        (
            OTHER_DIGEST,
            {
                ("local", DIGEST): "incompatible",
                ("local", None): "ready",
                ("remote", DIGEST): "incompatible",
                ("remote", None): "incompatible",
            },
        ),
        (
            None,
            {
                ("local", DIGEST): "ready",
                ("local", None): "ready",
                ("remote", DIGEST): "incompatible",
                ("remote", None): "incompatible",
            },
        ),
    ],
    ids=["same-digest", "other-digest", "no-digest"],
)
def test_worker_is_compatible_when_its_image_digest_matches_this_hosts(
    redis_url: str,
    tmp_path: Path,
    start_target_worker: Callable[..., Any],
    worker_digest: str | None,
    expected: dict[tuple[str, str | None], str],
) -> None:
    worker = Jobs(redis_url, "compared", tmp_path, worker_digest)
    with start_target_worker(worker):
        observed = {
            # A late answer leaves the worker unknown for the moment.
            (role, digest): observe_until(
                Jobs(redis_url, "compared" if role == "local" else "comparing", tmp_path, digest),
                "compared",
                lambda observed: observed["state"] != "unknown",
            )
            for role, digest in expected
        }
    assert {key: observation["state"] for key, observation in observed.items()} == expected
    for observation in observed.values():
        assert observation["worker"]["image_digest"] == worker_digest
        if observation["state"] == "incompatible":
            assert observation["reason"] == "Its worker's image digest is missing or differs from this host's"


def test_worker_may_run_under_another_name_of_its_target(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "pooled", tmp_path)
    with start_target_worker(jobs, node="w1@pooled"):
        observed = observe_until(jobs, "pooled", lambda observed: observed["state"] != "unknown")
    assert (observed["state"], observed["worker"]["queues"]) == ("ready", ["pooled"])
    assert observed["workers"] == {"w1@pooled": observed["worker"]}


def test_worker_registers_itself_while_it_runs_and_renews_its_registration(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "registered", tmp_path)
    key = worker_key("celery@registered")
    with start_target_worker(jobs):
        assert jobs.records.get(key) == "registered"
        assert 0 < jobs.records.ttl(key) <= WORKER_REGISTRATION.total_seconds()
        assert jobs.registered_workers("registered") == ["celery@registered"]
        time.sleep(WORKER_REGISTRATION_RENEWAL.total_seconds() + 2)
        # Without the renewal, 18 s or less would be left.
        assert jobs.records.ttl(key) > 20
    # A worker that stops deregisters itself; one that is killed is registered until its registration lapses.
    assert not jobs.records.exists(key)


def test_observation_asks_the_registered_workers_and_lists_one_that_does_not_answer(
    redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "ghosted", tmp_path)
    with start_target_worker(jobs):
        # As a worker that was killed is, until its registration lapses.
        jobs.register_worker("ghost@ghosted")
        observed = observe_until(jobs, "ghosted", lambda observed: observed["state"] != "unknown")
    assert observed["state"] == "ready"
    assert observed["workers"] == {"celery@ghosted": observed["worker"], "ghost@ghosted": None}


def test_registration_ends_within_seconds_while_redis_does_not_answer(silent_broker: str, tmp_path: Path) -> None:
    jobs = Jobs(silent_broker, "unregistered", tmp_path)
    errors: list[Exception] = []

    def register_and_deregister() -> None:
        for change in (jobs.register_worker, jobs.deregister_worker):
            try:
                change("celery@unregistered")
            except redis.RedisError as error:
                errors.append(error)

    # In a thread of its own, so that a call that never ends fails the test instead of stopping the run.
    registration = threading.Thread(target=register_and_deregister, daemon=True)
    start = time.monotonic()
    registration.start()
    registration.join(30)
    assert len(errors) == 2
    assert time.monotonic() - start < 8


def described(observed: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Return the workers of an observation that answered, by node."""
    return {node: worker for node, worker in observed["workers"].items() if worker is not None}


def consume(jobs: Jobs, nodes: list[str], consuming: bool) -> None:
    """Make the nodes consume the target's queue, or leave it, and wait until an observation shows the change, which
    the worker makes after it answers the command."""
    control = jobs.celery_app.control
    if consuming:
        control.add_consumer(jobs.target, destination=nodes, reply=True)
    else:
        control.cancel_consumer(jobs.target, destination=nodes, reply=True)
    queues = [jobs.target] if consuming else []
    observe_until(
        jobs,
        jobs.target,
        lambda observed: all(described(observed).get(node, {}).get("queues") == queues for node in nodes),
    )


def hold_a_job(jobs: Jobs, on: str | None = None) -> tuple[str, str, str]:
    """Submit a job that holds its worker until a test releases it, on the node `on` if given, while the target's other
    workers leave its queue; return the job's ID, its release key, and its holder."""
    others = [node for node in jobs.registered_workers(jobs.target) if node != on] if on else []
    if others:
        consume(jobs, others, False)
    release = f"engine-test:release:{uuid.uuid4()}"
    job_id = jobs.submit("engine_held_probe", {"bounds": BOUNDS, "release_key": release})
    observed = observe_until(
        jobs, jobs.target, lambda observed: any(worker["reserved"] for worker in described(observed).values())
    )
    holder = next(node for node, worker in described(observed).items() if worker["reserved"])
    if others:
        consume(jobs, others, True)
    return job_id, release, holder


def test_target_with_two_workers_adds_their_capacity_and_lists_both(
    redis_url: str, tmp_path: Path, run_worker_process: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "doubled", tmp_path)
    with run_worker_process("doubled", tmp_path), run_worker_process("doubled", tmp_path, node="w1@doubled"):
        observed = observe_until(jobs, "doubled", lambda observed: len(described(observed)) == 2)
    assert observed["state"] == "ready"
    versions = installed_versions()
    assert observed["worker"] == {
        "image_digest": None,
        "versions": versions,
        "job_limit": 2,
        "reserved": 0,
        "queues": ["doubled"],
    }
    assert list(observed["workers"]) == ["celery@doubled", "w1@doubled"]
    # Both stopped, warm, and deregistered themselves.
    assert jobs.registered_workers("doubled") == []


def test_leaving_worker_still_counts_the_job_it_holds(
    redis_url: str, tmp_path: Path, run_worker_process: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "leaving", tmp_path)
    with run_worker_process("leaving", tmp_path), run_worker_process("leaving", tmp_path, node="w1@leaving"):
        job_id, release, holder = hold_a_job(jobs)
        try:
            jobs.celery_app.control.cancel_consumer("leaving", destination=[holder], reply=True)
            observed = observe_until(
                jobs, "leaving", lambda observed: described(observed).get(holder, {}).get("queues") == []
            )
            # The job it still holds fills the remaining worker's limit.
            assert (observed["state"], observed["worker"]["reserved"], observed["worker"]["job_limit"]) == (
                "busy",
                1,
                1,
            )
        finally:
            jobs.records.set(release, 1)
        observed = observe_until(
            jobs, "leaving", lambda observed: observed["worker"] is not None and observed["worker"]["reserved"] == 0
        )
        assert observed["state"] == "ready"
        assert jobs.status(job_id)["state"] == "completed"


def test_target_none_of_whose_workers_consumes_its_queue_is_unavailable(
    redis_url: str, tmp_path: Path, run_worker_process: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "idle", tmp_path)
    with run_worker_process("idle", tmp_path), run_worker_process("idle", tmp_path, node="w1@idle"):
        jobs.celery_app.control.cancel_consumer("idle", destination=["celery@idle", "w1@idle"], reply=True)
        observed = observe_until(
            jobs, "idle", lambda observed: [worker["queues"] for worker in described(observed).values()] == [[], []]
        )
    assert (observed["state"], observed["reason"]) == (
        "unavailable",
        "Its worker does not consume exactly the queue 'idle'",
    )
    assert observed["worker"]["job_limit"] == 0


@pytest.mark.parametrize("silenced", ["holder", "other"])
@pytest.mark.parametrize("holder", ["celery@silenced", "w1@silenced"])
def test_worker_that_holds_a_job_and_does_not_answer_is_listed_without_an_answer(
    redis_url: str, tmp_path: Path, run_worker_process: Callable[..., Any], holder: str, silenced: str
) -> None:
    jobs = Jobs(redis_url, "silenced", tmp_path)
    with (
        run_worker_process("silenced", tmp_path) as entry,
        run_worker_process("silenced", tmp_path, node="w1@silenced") as other,
    ):
        job_id, release, held_by = hold_a_job(jobs, on=holder)
        processes = {"celery@silenced": entry, "w1@silenced": other}
        silent = holder if silenced == "holder" else next(node for node in processes if node != holder)
        processes[silent].send_signal(signal.SIGSTOP)
        try:
            assert held_by == holder
            observed = observe_until(jobs, "silenced", lambda observed: observed["workers"].get(silent, {}) is None)
            # The answering worker's state is the target's: a job whose worker does not answer is not counted.
            assert (observed["state"], observed["worker"]["reserved"]) == (
                ("ready", 0) if silenced == "holder" else ("busy", 1)
            )
        finally:
            processes[silent].send_signal(signal.SIGCONT)
            jobs.records.set(release, 1)
        observe_until(
            jobs,
            "silenced",
            lambda observed: len(described(observed)) == 2 and observed["worker"]["reserved"] == 0,
        )
        assert jobs.status(job_id)["state"] == "completed"


def test_target_with_a_worker_of_another_image_is_incompatible(
    redis_url: str, tmp_path: Path, run_worker_process: Callable[..., Any]
) -> None:
    jobs = Jobs(redis_url, "mixed", tmp_path, DIGEST)
    with (
        run_worker_process("mixed", tmp_path, DIGEST),
        run_worker_process("mixed", tmp_path, OTHER_DIGEST, node="w1@mixed"),
    ):
        observed = observe_until(jobs, "mixed", lambda observed: len(described(observed)) == 2)
    assert (observed["state"], observed["reason"]) == (
        "incompatible",
        "Its worker's image digest is missing or differs from this host's",
    )
    digests = {node: worker["image_digest"] for node, worker in observed["workers"].items()}
    assert digests == {"celery@mixed": DIGEST, "w1@mixed": OTHER_DIGEST}


# The placement order of the API that `submit_observed` submits through.
PLACEMENT = ["placing", "first", "second"]


def submit_observed(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, states: dict[str, str], target: str | None
) -> tuple[Any, str | None, list[str], dict[str, int]]:
    """Submit a `smoke` job to `target`, or by automatic placement if None, through an API whose targets are observed
    in these states: its own, `placing`, then the remote `first` and `second`.

    Returns the response; the target that the job's record names, if the job was accepted; the targets observed, in
    order; and how many messages each target's queue gained.
    """
    jobs = Jobs(redis_url, "placing", tmp_path)
    observed: list[str] = []

    def observe(observed_target: str) -> dict[str, Any]:
        observed.append(observed_target)
        state = states[observed_target]
        return {"state": state, "reason": None if state in ("ready", "busy") else f"Why it is {state}"}

    monkeypatch.setattr(jobs, "observe", observe)
    client = TestClient(create_app("test-token", jobs, {"first": "http://127.0.0.1:1", "second": "http://127.0.0.1:2"}))
    before = {queue: jobs.records.llen(queue) for queue in states}
    request = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}, "target": target}
    response = client.post("/api/v1/jobs", json=request, headers={"Authorization": "Bearer test-token"})
    recorded = jobs.status(response.json()["job_id"])["target"] if response.status_code == 202 else None
    return response, recorded, observed, {queue: jobs.records.llen(queue) - before[queue] for queue in states}


@pytest.mark.parametrize(
    ("states", "target", "observed"),
    [
        ({"placing": "ready", "first": "ready", "second": "ready"}, "placing", ["placing"]),
        ({"placing": "busy", "first": "ready", "second": "ready"}, "first", ["placing", "first"]),
        ({"placing": "unknown", "first": "busy", "second": "ready"}, "second", PLACEMENT),
        ({"placing": "busy", "first": "busy", "second": "busy"}, "placing", PLACEMENT),
        ({"placing": "incompatible", "first": "unavailable", "second": "busy"}, "second", PLACEMENT),
    ],
    ids=["local-ready", "local-busy", "first-ready-remote", "all-busy", "first-busy-remote"],
)
def test_automatic_placement_takes_the_first_ready_target_or_else_the_first_busy_one(
    monkeypatch: pytest.MonkeyPatch,
    redis_url: str,
    tmp_path: Path,
    states: dict[str, str],
    target: str,
    observed: list[str],
) -> None:
    response, recorded, observed_targets, queued = submit_observed(monkeypatch, redis_url, tmp_path, states, None)
    assert (response.status_code, recorded) == (202, target)
    assert observed_targets == observed
    assert queued == {queue: int(queue == target) for queue in states}


def test_job_no_target_can_accept_is_rejected_with_each_ones_reason(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path
) -> None:
    states = {"placing": "unknown", "first": "incompatible", "second": "unavailable"}
    records = Jobs(redis_url, "counting", tmp_path).records
    before = len(records.keys(record_key("*")))
    response, recorded, observed, queued = submit_observed(monkeypatch, redis_url, tmp_path, states, None)
    assert (response.status_code, recorded) == (503, None)
    assert response.json()["detail"] == (
        "The job was not submitted. Target 'placing' is unknown: Why it is unknown. "
        "Target 'first' is incompatible: Why it is incompatible. Target 'second' is unavailable: Why it is unavailable."
    )
    assert observed == PLACEMENT
    assert queued == {"placing": 0, "first": 0, "second": 0}
    assert len(records.keys(record_key("*"))) == before


@pytest.mark.parametrize("target", ["placing", "second"])
@pytest.mark.parametrize("state", ["ready", "busy"])
def test_requested_target_that_is_ready_or_busy_takes_the_job(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str, state: str
) -> None:
    states = {"placing": "ready", "first": "ready", "second": "ready", target: state}
    response, recorded, observed, queued = submit_observed(monkeypatch, redis_url, tmp_path, states, target)
    assert (response.status_code, recorded) == (202, target)
    assert observed == [target]
    assert queued == {queue: int(queue == target) for queue in states}


@pytest.mark.parametrize("target", ["placing", "second"])
@pytest.mark.parametrize("state", ["unknown", "unavailable", "incompatible"])
def test_requested_target_that_cannot_accept_the_job_is_rejected_and_no_other_takes_it(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, target: str, state: str
) -> None:
    states = {"placing": "ready", "first": "ready", "second": "ready", target: state}
    response, recorded, observed, queued = submit_observed(monkeypatch, redis_url, tmp_path, states, target)
    assert (response.status_code, recorded) == (503, None)
    assert response.json()["detail"] == f"The job was not submitted. Target '{target}' is {state}: Why it is {state}."
    assert observed == [target]
    assert queued == {"placing": 0, "first": 0, "second": 0}


def test_requested_target_that_is_not_configured_is_rejected_without_an_observation(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path
) -> None:
    states = {"placing": "ready", "first": "ready", "second": "ready"}
    response, recorded, observed, queued = submit_observed(monkeypatch, redis_url, tmp_path, states, "elsewhere")
    assert (response.status_code, recorded) == (422, None)
    assert response.json()["detail"] == "Target 'elsewhere' is not configured on this Engine"
    assert observed == []
    assert queued == {"placing": 0, "first": 0, "second": 0}


def test_job_whose_targets_do_not_answer_is_rejected_and_not_recorded(redis_url: str, tmp_path: Path) -> None:
    # No worker serves this API's own target or its remote one, so neither answers its observation.
    jobs = Jobs(redis_url, "unanswered", tmp_path)
    client = TestClient(create_app("test-token", jobs, {"absent": "http://127.0.0.1:1"}))
    before = len(jobs.records.keys(record_key("*")))
    unknown = "is unknown: Its worker did not answer within 0.5 s."
    for target, reasons in (
        (None, f"Target 'unanswered' {unknown} Target 'absent' {unknown}"),
        ("absent", f"Target 'absent' {unknown}"),
    ):
        request = {"dataset": "smoke", "parameters": {"bounds": BOUNDS}, "target": target}
        response = client.post("/api/v1/jobs", json=request, headers={"Authorization": "Bearer test-token"})
        assert (response.status_code, response.json().get("detail")) == (503, f"The job was not submitted. {reasons}")
    assert len(jobs.records.keys(record_key("*"))) == before
