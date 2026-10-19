"""Phase 2: the remote host's worker is stopped; its API and the entry host run."""

from hosts import ENTRY, SMOKE, fetch, finished, measure, queue, remember, status, submit, targets_until, timed


def test_entry_reports_the_remote_target_unknown_and_places_jobs_on_its_own() -> None:
    listed = targets_until(lambda listed: listed["entry"]["state"] == "ready")
    assert (listed["remote"]["state"], listed["remote"]["worker"]) == ("unknown", None)
    assert listed["remote"]["host"] is not None
    listing, seconds = timed(lambda: fetch(ENTRY, "/api/v1/datasets").json())
    measure("listing_with_the_remote_worker_stopped_seconds", seconds)
    assert listing["targets"]["smoke"][1]["state"] == "unknown"
    rejected, seconds = timed(lambda: fetch(ENTRY, "/api/v1/jobs", "POST", json={**SMOKE, "target": "remote"}))
    measure("submission_to_the_stopped_remote_target_seconds", seconds)
    assert rejected.status_code == 503
    assert "Target 'remote' is unknown: Its worker did not answer within 0.5 s." in rejected.json()["detail"]
    automatic, seconds = timed(lambda: submit(SMOKE))
    measure("automatic_submission_with_the_remote_worker_stopped_seconds", seconds)
    assert (finished(automatic)["state"], status(automatic)["target"]) == ("completed", "entry")


def test_remote_job_queued_while_its_worker_is_stopped_is_cancelled_through_the_entry() -> None:
    cancelled, waiting = (queue("smoke", SMOKE["parameters"], "remote") for _ in range(2))
    assert [status(job_id)["state"] for job_id in (cancelled, waiting)] == ["queued", "queued"]
    response = fetch(ENTRY, f"/api/v1/jobs/{cancelled}/cancel", "POST")
    assert (response.status_code, response.json()["result"]) == (200, "cancelled")
    # The cancelled job's message waits in the queue too, until a worker takes it and does not run it.
    assert targets_until(lambda listed: listed["entry"]["state"] == "ready")["remote"]["waiting"] == 2
    remember("cancelled_remote_job", cancelled)
    remember("waiting_remote_job", waiting)
