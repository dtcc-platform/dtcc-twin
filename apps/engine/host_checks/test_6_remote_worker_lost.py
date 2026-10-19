"""Phase 6: the remote host's worker was killed while it ran its held job, and started again."""

import os

import redis
from hosts import ADDRESSES, PACKAGES, download, finished, recall, status, stored_package


def test_job_of_the_lost_worker_fails_and_the_other_hosts_job_runs_on() -> None:
    held = recall("held_jobs")
    lost = finished(held["remote"])
    assert (lost["state"], lost["error"]) == ("failed", {"type": "WorkerRestarted"})
    assert status(held["entry"])["state"] == "running"
    redis.Redis.from_url(os.environ["ENGINE_REDIS_URL"]).set(recall("release_key"), 1)
    assert finished(held["entry"])["state"] == "completed"
    assert download(held["entry"]) == stored_package("entry", held["entry"])


def test_each_host_keeps_the_packages_of_its_own_jobs_alone() -> None:
    for host in ADDRESSES:
        packages = list((PACKAGES / host).glob("*.dtccpkg"))
        assert packages
        for package in packages:
            job = status(package.stem)
            assert (job["target"], job["state"], job["package"]["available"]) == (host, "completed", True)
