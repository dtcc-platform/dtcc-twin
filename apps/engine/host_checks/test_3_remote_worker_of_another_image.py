"""Phase 3: the remote host's worker runs again, from an image other than the entry's."""

from hosts import DIGEST, ENTRY, SMOKE, fetch, finished, recall, status, targets_until


def test_worker_of_another_image_is_incompatible_and_runs_none_of_the_jobs_queued_before() -> None:
    remote = targets_until(lambda listed: listed["remote"]["worker"] is not None)["remote"]
    assert remote["state"] == "incompatible"
    assert remote["worker"]["image_digest"] not in (DIGEST, None)
    waiting = finished(recall("waiting_remote_job"))
    assert (waiting["state"], waiting["error"], waiting["package"]) == ("failed", {"type": "IncompatibleWorker"}, None)
    assert waiting["environment"]["image_digest"] == remote["worker"]["image_digest"]
    cancelled = status(recall("cancelled_remote_job"))
    assert (cancelled["state"], cancelled["environment"]) == ("cancelled", None)
    rejected = fetch(ENTRY, "/api/v1/jobs", "POST", json={**SMOKE, "target": "remote"})
    assert rejected.status_code == 503
    assert "Target 'remote' is incompatible" in rejected.json()["detail"]
