"""Phase 1: both hosts run. Checks across them, and the baseline measurements."""

import uuid
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from hosts import (
    ADDRESSES,
    BOUNDS,
    DIGEST,
    ENTRY,
    PACKAGES,
    REMOTE,
    SMOKE,
    download,
    duration,
    fetch,
    finished,
    measure,
    remember,
    status,
    stored_package,
    submit,
    summary,
    targets_until,
    timed,
    wait_for,
)

# The failures of a Dataset whose provider or download failed, which leave a simulation's measurement not run.
DOWNLOAD_FAILURES = ("DatasetUpstreamError", "TimeoutError", "ConnectionError")


def ready(listed: dict) -> bool:
    return all(target["state"] == "ready" for target in listed.values())


def ready_in(listing: dict) -> bool:
    return all(target["state"] == "ready" for target in listing["targets"]["smoke"])


def test_targets_report_both_hosts_ready_with_their_own_discovery() -> None:
    listed = targets_until(ready)
    assert list(listed) == ["entry", "remote"]
    for target, observed in listed.items():
        assert (observed["worker"]["image_digest"], observed["worker"]["queues"]) == (DIGEST, [target])
        assert (observed["host"]["image_digest"], observed["host_error"]) == (DIGEST, None)
    # Both hosts run one image, so they discover the same catalog.
    assert listed["entry"]["host"] == listed["remote"]["host"]


def test_entry_lists_each_dataset_with_both_targets() -> None:
    # A late answer leaves a target unknown for the moment.
    listing = wait_for(lambda: ready_in(body := fetch(ENTRY, "/api/v1/datasets").json()) and body)
    ready_target = {"state": "ready", "reason": None, "runtime_availability": "unknown"}
    targets = [{"target": "entry", **ready_target}, {"target": "remote", **ready_target}]
    assert listing["targets"] == {name: targets for name in listing["datasets"]}
    assert fetch(REMOTE, "/api/v1/host").json()["catalog_revision"] == listing["catalog_revision"]


@pytest.mark.parametrize("address", [ENTRY, REMOTE])
def test_hosts_refuse_requests_without_the_shared_token(address: str) -> None:
    job_id = uuid.uuid4()
    paths = ["/api/v1/datasets", "/api/v1/host", "/api/v1/targets", f"/api/v1/jobs/{job_id}"]
    paths.append(f"/api/v1/host/jobs/{job_id}/package")
    for headers in ({}, {"Authorization": "Bearer another-token"}):
        refused = [requests.get(f"{address}{path}", headers=headers, timeout=60).status_code for path in paths]
        assert refused == [401] * len(paths)


def test_jobs_run_on_their_targets_and_are_delivered_through_the_entry() -> None:
    targets_until(ready)
    placed = {"entry": submit(SMOKE), "remote": submit(SMOKE, "remote")}
    for target, job_id in placed.items():
        job = finished(job_id)
        assert (job["state"], job["target"], job["package"]["available"]) == ("completed", target, True)
        assert job["environment"]["image_digest"] == DIGEST
        stored = stored_package(target, job_id)
        served = fetch(ADDRESSES[target], f"/api/v1/host/jobs/{job_id}/package")
        assert (served.status_code, served.content, download(job_id)) == (200, stored, stored)
        # Each package is on its host's volume alone: the entry streams a remote one through and keeps no copy.
        on_hosts = {host: (PACKAGES / host / f"{job_id}.dtccpkg").is_file() for host in ADDRESSES}
        assert on_hosts == {host: host == target for host in ADDRESSES}
    remember("remote_job", placed["remote"])


def test_measure_discovery() -> None:
    targets_until(ready)
    listings = [timed(lambda: fetch(ENTRY, "/api/v1/datasets").json()) for _ in range(100)]
    measure("listing_seconds", summary([seconds for _, seconds in listings]))
    # Each listing observes each target once, waiting 0.5 s for its worker's answer, without a retry.
    observations = Counter(target["state"] for body, _ in listings for target in body["targets"]["smoke"])
    measure("listing_observations", observations)
    measure("targets_seconds", summary([timed(lambda: fetch(ENTRY, "/api/v1/targets"))[1] for _ in range(10)]))
    host_discovery = [timed(lambda: fetch(REMOTE, "/api/v1/host"))[1] for _ in range(10)]
    measure("remote_host_discovery_seconds", summary(host_discovery))


@pytest.mark.parametrize("target", ["entry", "remote"])
def test_measure_jobs(target: str) -> None:
    samples = defaultdict(list)
    for _ in range(10):
        targets_until(ready)
        response, seconds = timed(lambda: fetch(ENTRY, "/api/v1/jobs", "POST", json={**SMOKE, "target": target}))
        samples["submission_seconds"].append(seconds)
        job = finished(response.json()["job_id"])
        # Smoke runs in milliseconds, so the time from submission to finish holds the queue wait and the run.
        samples["submitted_to_finished_seconds"].append(duration(job))
        polled, seconds = timed(lambda: status(job["job_id"]))
        samples["status_seconds"].append(seconds)
        package, seconds = timed(lambda: download(job["job_id"]))
        samples["download_seconds"].append(seconds)
        samples["package_bytes"].append(len(package))
        assert (polled["state"], polled["package"]["available"]) == ("completed", True)
    measure(f"smoke_on_{target}", {name: summary(values) for name, values in samples.items()})


def test_measure_concurrent_submissions() -> None:
    targets_until(ready)
    with ThreadPoolExecutor(6) as pool:
        responses = list(pool.map(lambda _: timed(lambda: fetch(ENTRY, "/api/v1/jobs", "POST", json=SMOKE)), range(6)))
    jobs = [finished(response.json()["job_id"]) for response, _ in responses]
    assert [job["state"] for job in jobs] == ["completed"] * 6
    # Each host's worker runs one job at a time, so the jobs placed on a host finish one after another.
    durations = {host: sorted(duration(job) for job in jobs if job["target"] == host) for host in ADDRESSES}
    submissions = summary([seconds for _, seconds in responses])
    measure("concurrent_smoke", {"submission_seconds": submissions, "submitted_to_finished_seconds": durations})


def test_measure_a_simulation_on_each_host() -> None:
    for target in ADDRESSES:
        targets_until(ready)
        job = finished(submit({"dataset": "urban_heat_simulation", "parameters": {"bounds": BOUNDS}}, target), 3600)
        if job["state"] == "failed" and job["error"]["type"] in DOWNLOAD_FAILURES:
            # Both hosts obtain the data from the same providers, so the other host is not tried.
            not_run = {"target": target, "error": job["error"], "submitted_to_finished_seconds": duration(job)}
            measure("urban_heat_simulation_not_run", not_run)
            pytest.skip(f"urban_heat_simulation could not obtain its data on {target}: {job['error']}")
        assert job["state"] == "completed", job
        package, seconds = timed(lambda: download(job["job_id"]))
        run = {
            "submitted_to_finished_seconds": duration(job),
            "package_bytes": len(package),
            "download_seconds": seconds,
        }
        measure(f"urban_heat_simulation_on_{target}", run)
