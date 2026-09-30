"""Asynchronous Dataset jobs on one compute target.

A job runs one Dataset in a Celery worker and delivers its realization as a canonical Dataset
Package. Celery owns the queue and the execution state; Engine keeps its own record of each job
in the same Redis, so unknown and expired jobs are distinguishable from queued ones.
"""

import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import redis
from celery import Celery
from kombu.exceptions import OperationalError

RUN_DATASET = "dtcc_engine.run_dataset"
STATES = {
    "PENDING": "queued",
    "STARTED": "running",
    "PROGRESS": "running",
    "SUCCESS": "completed",
    "FAILURE": "failed",
}


def record_key(job_id: str) -> str:
    """Return the Redis key of Engine's record of a job."""
    return f"dtcc-engine:job:{job_id}"


class UnconfirmedSubmission(Exception):
    """The broker did not confirm a job's message, so the job may or may not be queued.

    Attributes:
        job_id: The job's ID, recorded with the job, so its status can be polled.
    """

    def __init__(self, job_id: str) -> None:
        super().__init__(job_id)
        self.job_id = job_id


class Jobs:
    """Dataset jobs on one compute target: submission, execution, status, and packages.

    Args:
        redis_url: Redis for Celery's broker and result backend, and for Engine's job records.
        target: Identifier of this compute target; its jobs use the Celery queue of that name.
        package_dir: Directory of completed packages, shared by this host's API and worker.
    """

    def __init__(self, redis_url: str, target: str, package_dir: Path) -> None:
        self.target = target
        self.package_dir = package_dir
        self.records = redis.Redis.from_url(redis_url, decode_responses=True)
        self.celery_app = Celery("dtcc_engine", broker=redis_url, backend=redis_url)
        self.celery_app.conf.update(task_default_queue=target)
        # With a result backend, send_task subscribes this process to the job's result channel,
        # which an API that never waits for results would accumulate.
        self.sender = Celery("dtcc_engine", broker=redis_url, set_as_current=False)
        # Retrying a publish whose acknowledgement was lost could queue the job twice.
        self.sender.conf.update(task_publish_retry=False)

    def package_path(self, job_id: str) -> Path:
        """Return where the job's package is stored once the job completes."""
        return self.package_dir / f"{job_id}.dtccpkg"

    def submit(self, dataset_name: str, parameters: dict[str, Any]) -> str:
        """Record and queue a job that runs a Dataset with parameters the caller has validated; return its ID.

        Raises:
            redis.RedisError: If Redis cannot record the job; nothing was sent.
            UnconfirmedSubmission: If sending the job, or recording its confirmation, failed; the job may be queued,
                and it is not sent again.
        """
        job_id = str(uuid4())
        key = record_key(job_id)
        submitted_at = datetime.now(UTC).isoformat()
        self.records.hset(key, mapping={"dataset": dataset_name, "target": self.target, "submitted_at": submitted_at})
        try:
            self.sender.send_task(RUN_DATASET, args=[dataset_name, parameters], task_id=job_id, queue=self.target)
            self.records.hset(key, "queued_at", datetime.now(UTC).isoformat())
        except (redis.RedisError, OperationalError) as error:
            raise UnconfirmedSubmission(job_id) from error
        return job_id

    def status(self, job_id: str) -> dict[str, Any] | None:
        """Return the job's state, progress, error, and package, or None if the job is unknown or expired.

        Raises:
            redis.RedisError: If Redis is unreachable, so the state is unknown for now.
        """
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        meta = self.celery_app.backend.get_task_meta(job_id)
        state = STATES[meta["status"]]
        if state == "queued" and "queued_at" not in record:
            state = "unconfirmed"
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"],
            "finished_at": record.get("finished_at"),
            "state": state,
            "progress": None,
            "error": None,
            "package": None,
        }


def jobs_from_environment() -> Jobs:
    """Create this host's jobs from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, and `ENGINE_PACKAGE_DIR`."""
    return Jobs(os.environ["ENGINE_REDIS_URL"], os.environ["ENGINE_TARGET"], Path(os.environ["ENGINE_PACKAGE_DIR"]))
