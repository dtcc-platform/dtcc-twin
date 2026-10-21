"""Tests of a retention other than the default: read from `ENGINE_RETENTION_DAYS`, and used for every expiry.

Jobs here are claimed and finished directly, without a worker, and their records' finish times are moved back instead of
waiting for the retention to pass.
"""

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from dtcc_engine.jobs import Jobs, jobs_from_environment, record_key

BOUNDS = [319891.0, 6399790.0, 320091.0, 6399990.0]
RETENTION = timedelta(days=2)


def configure(monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path) -> None:
    monkeypatch.setenv("ENGINE_REDIS_URL", redis_url)
    monkeypatch.setenv("ENGINE_TARGET", "retention")
    monkeypatch.setenv("ENGINE_PACKAGE_DIR", str(tmp_path))


@pytest.fixture
def jobs(monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path) -> Jobs:
    configure(monkeypatch, redis_url, tmp_path)
    monkeypatch.setenv("ENGINE_RETENTION_DAYS", str(RETENTION.days))
    return jobs_from_environment()


def assert_lifetime(jobs: Jobs, job_id: str, days: int) -> None:
    """Assert that the job's record expires a day after a retention of `days`, from about now."""
    assert timedelta(days=days) < timedelta(seconds=jobs.records.ttl(record_key(job_id))) <= timedelta(days=days + 1)


def completed_job(jobs: Jobs, age: timedelta) -> str:
    """Return a job that completed `age` ago, with its package on this host."""
    job_id = jobs.submit("smoke", {"bounds": BOUNDS})
    assert jobs.claim(job_id, f"celery@retention {uuid.uuid4().hex} 7")
    jobs.finish(job_id, "completed")
    jobs.records.hset(record_key(job_id), "finished_at", (datetime.now(UTC) - age).isoformat())
    jobs.package_path(job_id).write_bytes(b"package")
    return job_id


@pytest.mark.parametrize(("configured", "days"), [(None, 30), ("90", 90), ("1", 1)])
def test_retention_is_read_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, configured: str | None, days: int
) -> None:
    configure(monkeypatch, redis_url, tmp_path)
    if configured is None:
        monkeypatch.delenv("ENGINE_RETENTION_DAYS", raising=False)
    else:
        monkeypatch.setenv("ENGINE_RETENTION_DAYS", configured)
    configured_jobs = jobs_from_environment()
    assert_lifetime(configured_jobs, configured_jobs.submit("smoke", {"bounds": BOUNDS}), days)
    assert configured_jobs.celery_app.conf.result_expires == timedelta(days=days + 1)


@pytest.mark.parametrize("configured", ["", "0", "-1", "1.5", "ninety", " 90", "+90"])
def test_retention_other_than_a_positive_number_of_days_is_refused(
    monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path, configured: str
) -> None:
    configure(monkeypatch, redis_url, tmp_path)
    monkeypatch.setenv("ENGINE_RETENTION_DAYS", configured)
    with pytest.raises(ValueError):
        jobs_from_environment()


def test_hosts_jobs_keep_their_own_retention(monkeypatch: pytest.MonkeyPatch, redis_url: str, tmp_path: Path) -> None:
    configure(monkeypatch, redis_url, tmp_path)
    monkeypatch.setenv("ENGINE_RETENTION_DAYS", "2")
    shorter = jobs_from_environment()
    monkeypatch.setenv("ENGINE_RETENTION_DAYS", "5")
    longer = jobs_from_environment()
    assert_lifetime(shorter, shorter.submit("smoke", {"bounds": BOUNDS}), 2)
    assert_lifetime(longer, longer.submit("smoke", {"bounds": BOUNDS}), 5)
    assert shorter.celery_app.conf.result_expires == timedelta(days=3)
    assert longer.celery_app.conf.result_expires == timedelta(days=6)


def test_each_change_of_state_restarts_the_record_lifetime_from_the_retention(jobs: Jobs) -> None:
    finished = jobs.submit("smoke", {"bounds": BOUNDS})
    assert_lifetime(jobs, finished, 2)
    # Each step shortens the lifetime first, as if the job had waited for almost all of it.
    jobs.records.expire(record_key(finished), 60)
    assert jobs.claim(finished, f"celery@retention {uuid.uuid4().hex} 7")
    assert_lifetime(jobs, finished, 2)
    jobs.records.expire(record_key(finished), 60)
    jobs.finish(finished, "completed")
    assert_lifetime(jobs, finished, 2)

    cancelled = jobs.submit("smoke", {"bounds": BOUNDS})
    jobs.records.expire(record_key(cancelled), 60)
    assert jobs.cancel(cancelled) == "cancelled"
    assert_lifetime(jobs, cancelled, 2)

    lost = jobs.submit("smoke", {"bounds": BOUNDS})
    node = f"celery@lost-{uuid.uuid4().hex}"
    assert jobs.claim(lost, f"{node} earlier-run 7")
    jobs.records.expire(record_key(lost), 60)
    jobs.record_lost_claims(node=node)
    assert jobs.records.hget(record_key(lost), "error_type") == "WorkerRestarted"
    assert_lifetime(jobs, lost, 2)


@pytest.mark.parametrize(
    ("age", "expired"),
    [(RETENTION - timedelta(minutes=1), False), (RETENTION + timedelta(seconds=1), True)],
    ids=["within-retention", "after-retention"],
)
def test_finished_job_expires_and_its_package_is_deleted_after_the_retention(
    jobs: Jobs, age: timedelta, expired: bool
) -> None:
    job_id = completed_job(jobs, age)
    status = jobs.status(job_id)
    cancelled = jobs.cancel(job_id)
    jobs.clean_packages()
    if expired:
        assert (status, cancelled, jobs.package_path(job_id).exists()) == (None, None, False)
    else:
        finished_at = datetime.fromisoformat(jobs.records.hget(record_key(job_id), "finished_at"))
        assert status["package"] == {"available": True, "expires_at": (finished_at + RETENTION).isoformat()}
        assert (cancelled, jobs.package_path(job_id).exists()) == ("already_finished", True)
