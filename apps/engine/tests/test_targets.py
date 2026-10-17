"""Tests of compute targets: each target's identifier, image digest, and the node name and queue its worker uses; the
remote targets of the entry service; and the observation of a target's worker.

The worker checks are run through Celery's command line, as the worker service runs it, because a worker that refuses
to start ends its process.
"""

import os
import subprocess
import sys
import time
import traceback
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from celery.worker.control import Panel
from fastapi.testclient import TestClient

from dtcc_engine.api import create_app_from_environment
from dtcc_engine.jobs import Jobs, jobs_from_environment, record_key

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


def test_worker_refuses_a_node_name_other_than_its_targets(redis_url: str, tmp_path: Path) -> None:
    ended = run_worker(redis_url, tmp_path, "named", "celery@engine-worker")
    assert ended.returncode == 1
    assert "must run as celery@named, not celery@engine-worker" in ended.stderr


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
    }


def test_target_is_unknown_while_the_broker_does_not_answer(tmp_path: Path) -> None:
    jobs = Jobs("redis://127.0.0.1:1/0", "unreachable", tmp_path)
    assert jobs.observe("unreachable") == {
        "state": "unknown",
        "reason": "The broker did not answer",
        "worker": None,
        "waiting": None,
    }


def test_worker_without_engines_inspect_command_is_unknown(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, start_target_worker: Callable[..., Any]
) -> None:
    # As a worker of an Engine without the command would, it answers with an error.
    monkeypatch.delitem(Panel.data, "engine_worker", raising=False)
    jobs = Jobs(redis_url, "commandless", tmp_path)
    with start_target_worker(jobs):
        observed = jobs.observe("commandless")
    assert observed == {"state": "unknown", "reason": "Its worker's answer is malformed", "worker": None, "waiting": 0}


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
