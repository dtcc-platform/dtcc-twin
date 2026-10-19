"""Phase 4: the remote host's API is stopped; its worker, of the entry's image again, and the entry host run."""

from hosts import (
    ENTRY,
    SMOKE,
    fetch,
    finished,
    measure,
    recall,
    remember,
    status,
    submit,
    targets,
    targets_until,
    timed,
)


def test_entry_cannot_deliver_the_remote_hosts_packages_and_says_so() -> None:
    remote_job = recall("remote_job")
    polled, seconds = timed(lambda: status(remote_job))
    measure("status_of_a_remote_job_with_its_api_stopped_seconds", seconds)
    assert (polled["state"], polled["package"]["available"]) == ("completed", None)
    downloaded = fetch(ENTRY, f"/api/v1/jobs/{remote_job}/package")
    assert (downloaded.status_code, downloaded.json()) == (503, {"detail": "The job's host could not be reached"})


def test_remote_target_is_observed_through_the_broker_and_takes_jobs() -> None:
    targets_until(lambda listed: listed["remote"]["state"] == "ready")
    listed, seconds = timed(targets)
    measure("targets_with_the_remote_api_stopped_seconds", seconds)
    assert (listed["remote"]["host"], listed["remote"]["host_error"]) == (None, "The host could not be reached")
    job_id = submit(SMOKE, "remote")
    job = finished(job_id)
    assert (job["state"], job["target"], job["package"]["available"]) == ("completed", "remote", None)
    remember("job_completed_while_its_api_was_stopped", job_id)
