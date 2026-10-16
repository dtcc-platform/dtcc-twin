"""Tests of a compute target's identity: its identifier, its image digest, and the node name and queue its worker uses.

The worker checks are run through Celery's command line, as the worker service runs it, because a worker that refuses
to start ends its process.
"""

import os
import subprocess
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from dtcc_engine.jobs import Jobs, jobs_from_environment, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]


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
