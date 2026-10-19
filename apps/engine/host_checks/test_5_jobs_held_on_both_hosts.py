"""Phase 5: both hosts run again, and a job is held on each, which the next phase releases."""

import uuid

from hosts import BOUNDS, download, queue, recall, remember, status, stored_package, targets_until, wait_for


def test_package_made_while_its_hosts_api_was_stopped_is_delivered_once_it_is_back() -> None:
    job_id = recall("job_completed_while_its_api_was_stopped")
    assert wait_for(lambda: status(job_id)["package"]["available"])
    assert download(job_id) == stored_package("remote", job_id)


def test_a_job_is_claimed_and_held_on_each_host() -> None:
    targets_until(lambda listed: all(target["state"] == "ready" for target in listed.values()))
    release = f"engine-check:release:{uuid.uuid4()}"
    held = {
        target: queue("engine_held_probe", {"bounds": BOUNDS, "release_key": release}, target)
        for target in ("entry", "remote")
    }
    # Celery stores `STARTED`, which status reports as running, before the delivery claims the job; the claim, which
    # the next phase's restart looks for, records the worker's environment.
    wait_for(lambda: all(status(job_id)["environment"] is not None for job_id in held.values()))
    assert [status(job_id)["state"] for job_id in held.values()] == ["running", "running"]
    remember("held_jobs", held)
    remember("release_key", release)
