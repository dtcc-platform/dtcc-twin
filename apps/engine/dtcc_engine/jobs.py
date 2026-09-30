"""Asynchronous Dataset jobs on one compute target.

A job runs one Dataset in a Celery worker and delivers its realization as a canonical Dataset
Package. Celery owns the queue and the execution state; Engine keeps its own record of each job
in the same Redis, so unknown and expired jobs are distinguishable from queued ones.
"""

import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
import redis
from celery import Celery, Task
from dtcc_core.common.progress import get_progress_callback, set_progress_callback
from kombu.exceptions import OperationalError

RETENTION = timedelta(days=30)
# A day beyond the retention, so a job's records outlast its package even if hosts' clocks differ slightly.
RECORD_LIFETIME = RETENTION + timedelta(days=1)
RUN_DATASET = "dtcc_engine.run_dataset"
STATES = {
    "PENDING": "queued",
    "STARTED": "running",
    "PROGRESS": "running",
    "SUCCESS": "completed",
    "FAILURE": "failed",
}
logger = logging.getLogger(__name__)


def record_key(job_id: str) -> str:
    """Return the Redis key of Engine's record of a job."""
    return f"dtcc-engine:job:{job_id}"


def store_progress(task: Task, progress: dict[str, Any]) -> None:
    """Store a progress report from Core, unchanged, as the task's PROGRESS state."""
    try:
        task.update_state(state="PROGRESS", meta=progress)
    except redis.RedisError:
        # A lost progress report must not fail the computation.
        logger.warning("Could not store the progress of job %s", task.request.id, exc_info=True)


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
        self.celery_app.conf.update(
            task_default_queue=target,
            task_track_started=True,
            result_expires=RECORD_LIFETIME,
            # Redis redelivers a message left unacknowledged for an hour, so a job must not wait inside the worker.
            worker_disable_prefetch=True,
        )
        # With a result backend, send_task subscribes this process to the job's result channel,
        # which an API that never waits for results would accumulate.
        self.sender = Celery("dtcc_engine", broker=redis_url, set_as_current=False)
        # Retrying a publish whose acknowledgement was lost could queue the job twice.
        self.sender.conf.update(task_publish_retry=False)

        # Not shared: a shared task joins every app finalized later, and the first registration of a name wins.
        @self.celery_app.task(name=RUN_DATASET, bind=True, shared=False)
        def run_dataset(task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
            self.run(task, dataset_name, parameters)

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
        meta = self.celery_app.backend.get_task_meta(job_id)
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        state = STATES[meta["status"]]
        if state == "queued" and "queued_at" not in record:
            state = "unconfirmed"
        finished_at = datetime.fromisoformat(record["finished_at"]) if "finished_at" in record else None
        if finished_at is not None and datetime.now(UTC) >= finished_at + RETENTION:
            return None
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"],
            "finished_at": record.get("finished_at"),
            "state": state,
            "progress": meta["result"] if meta["status"] == "PROGRESS" else None,
            "error": {"type": record.get("error_type")} if state == "failed" else None,
            "package": (
                {"available": self.package_path(job_id).is_file(), "expires_at": (finished_at + RETENTION).isoformat()}
                if state == "completed"
                else None
            ),
        }

    def run(self, task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
        """Run a job in the worker: invoke the Dataset, export its realization, and validate the package.

        Raises:
            Exception: Whatever the Dataset, the export, or the validation raised; the job then fails.
        """
        key = record_key(task.request.id)
        path = self.package_path(task.request.id)
        previous_callback = get_progress_callback()
        set_progress_callback(lambda progress: store_progress(task, progress))
        try:
            realization = datasets.get_dataset(dataset_name)(**parameters)
            realization.export(path, canonical=True)
            try:
                datasets.load_model_package(path)
            except Exception:
                path.unlink()
                raise
        except Exception as error:
            self.records.hset(key, "error_type", type(error).__name__)
            raise
        finally:
            set_progress_callback(previous_callback)
            with self.records.pipeline() as pipeline:
                pipeline.hset(key, "finished_at", datetime.now(UTC).isoformat())
                pipeline.expire(key, RECORD_LIFETIME)
                pipeline.execute()


def jobs_from_environment() -> Jobs:
    """Create this host's jobs from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, and `ENGINE_PACKAGE_DIR`."""
    return Jobs(os.environ["ENGINE_REDIS_URL"], os.environ["ENGINE_TARGET"], Path(os.environ["ENGINE_PACKAGE_DIR"]))
