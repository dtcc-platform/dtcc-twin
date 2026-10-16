"""Asynchronous Dataset jobs on one compute target.

A job runs one Dataset in a Celery worker and delivers its realization as a canonical Dataset
Package. Celery owns the queue and task results; Engine keeps its own record of each job in the
same Redis, which decides whether a delivery may run the Dataset and records how the job ended.
"""

import json
import logging
import os
import re
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
import redis
from celery import Celery, Task, bootsteps
from celery.exceptions import Ignore, WorkerLostError
from celery.signals import task_failure
from dtcc_core.common.progress import get_progress_callback, set_progress_callback
from dtcc_core.datasets.dataset import DatasetUpstreamError
from kombu.exceptions import OperationalError

RETENTION = timedelta(days=30)
# A day beyond the retention, so a job's records outlast its package even if hosts' clocks differ slightly.
RECORD_LIFETIME = RETENTION + timedelta(days=1)
RUN_DATASET = "dtcc_engine.run_dataset"
# How often a worker deletes the packages that no job can deliver.
CLEANUP_INTERVAL = timedelta(hours=1)
# A target's identifier also names its worker's node, celery@<identifier>, which claims hold between spaces.
TARGET_PATTERN = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
IMAGE_DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
# How long a starting worker waits for an answer from another running worker with its node name, once connected.
NODE_CHECK_TIMEOUT = 0.5
# Celery's states of a job without a recorded outcome; SUCCESS follows the outcome, so it never appears alone.
CELERY_STATES = {"PENDING": "queued", "STARTED": "running", "PROGRESS": "running", "FAILURE": "failed"}
# The outcomes a record can hold with each value of its execution gate.
OUTCOMES = {"waiting": {None}, "started": {None, "completed", "failed"}, "cancelled": {"cancelled"}}
# Records the broker's confirmation of a job's message, if the job's record still exists: ARGV is the time.
QUEUED = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
redis.call('HSET', KEYS[1], 'queued_at', ARGV[1])
return 'recorded'
"""
# Gives permission to run the job's Dataset to the delivery that changes its gate from waiting to started, records its
# claim, and restarts the record's lifetime: ARGV is the claim and the lifetime.
START = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if gate ~= 'waiting' or outcome or finished then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'execution_gate', 'started', 'claimed_by', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 'started'
"""
# Records how a started job ended: ARGV is the outcome, the finish time, the record's lifetime, the error type, and the
# upstream failure's metadata.
FINISH = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if gate ~= 'started' or outcome or finished then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'outcome', ARGV[1], 'finished_at', ARGV[2])
if ARGV[4] ~= '' then
  redis.call('HSET', KEYS[1], 'error_type', ARGV[4])
end
if ARGV[5] ~= '' then
  redis.call('HSET', KEYS[1], 'error_upstream', ARGV[5])
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 'recorded'
"""
# Cancels a job no delivery has claimed: ARGV is the finish time and the record's lifetime.
CANCEL = """
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'missing'
end
local gate, outcome, finished = unpack(redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at'))
if outcome then
  return 'finished'
end
if gate == 'started' and not finished then
  return 'started'
end
if gate ~= 'waiting' or finished then
  return 'unusable'
end
redis.call('HSET', KEYS[1], 'execution_gate', 'cancelled', 'outcome', 'cancelled', 'finished_at', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 'cancelled'
"""
# Records the failure of a started job whose claimant is gone, unless its claim changed or it has an outcome:
# ARGV is the claim, the error type, the finish time, and the record's lifetime.
LOST = """
local fields = redis.call('HMGET', KEYS[1], 'execution_gate', 'outcome', 'finished_at', 'claimed_by')
local gate, outcome, finished, claim = unpack(fields)
if gate ~= 'started' or outcome or finished or claim ~= ARGV[1] then
  return 'refused'
end
redis.call('HSET', KEYS[1], 'outcome', 'failed', 'finished_at', ARGV[3], 'error_type', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'recorded'
"""
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


def parse_time(value: str) -> datetime:
    """Parse a timestamp Engine wrote.

    Raises:
        ValueError: If the value is not an ISO 8601 timestamp with a UTC offset.
    """
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError(f"Timestamp {value!r} has no UTC offset")
    return parsed


def parse_claim(claim: str) -> tuple[str, str, int]:
    """Split a claim into the worker's node name, the worker run, and the pool process ID.

    Raises:
        ValueError: If the claim does not hold these three, separated by spaces.
    """
    node, worker_run, pid = claim.split(" ")
    return node, worker_run, int(pid)


def process_alive(pid: int) -> bool:
    """Return whether a process with this ID exists on this host."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def public_upstream_error(error: DatasetUpstreamError) -> dict[str, Any]:
    """Return Core's metadata of an upstream failure without its message and its target, which can hold credentials.

    The message can repeat a request URL with its query, which can hold a provider key, and the target can be built
    from a Dataset's base URL, which a consumer sets and which can hold a credential anywhere in it.
    """
    metadata = datasets.DatasetDescriptor.serialize_upstream_error(error)
    del metadata["message"], metadata["target"]
    return metadata


class JobStateUnavailable(Exception):
    """Engine's record of a job is unusable, or Celery's state cannot be trusted without the record's outcome."""


class ExecutionStarted(Exception):
    """A delivery claimed the job, which has no recorded outcome yet, so it can no longer be cancelled."""


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
        target: Identifier of this compute target, lowercase letters and digits in words joined by single hyphens;
            its jobs use the Celery queue of that name, and its worker runs as `celery@<target>`.
        package_dir: Directory of completed packages, shared by this host's API and worker.
        image_digest: The platform-specific digest of the image this host runs, `sha256:` and 64 lowercase
            hexadecimal digits, if the deployment supplies it.

    Raises:
        ValueError: If the target identifier or the image digest is malformed.
    """

    def __init__(self, redis_url: str, target: str, package_dir: Path, image_digest: str | None = None) -> None:
        if not TARGET_PATTERN.fullmatch(target):
            raise ValueError(f"Target identifier {target!r} is not lowercase words joined by single hyphens")
        if image_digest is not None and not IMAGE_DIGEST_PATTERN.fullmatch(image_digest):
            raise ValueError(f"Image digest {image_digest!r} is not sha256: and 64 lowercase hexadecimal digits")
        self.target = target
        self.image_digest = image_digest
        self.package_dir = package_dir
        self.records = redis.Redis.from_url(redis_url, decode_responses=True)
        self.queued_script = self.records.register_script(QUEUED)
        self.start_script = self.records.register_script(START)
        self.finish_script = self.records.register_script(FINISH)
        self.cancel_script = self.records.register_script(CANCEL)
        self.lost_script = self.records.register_script(LOST)
        # Identifies this run of the worker, so that a worker started again tells its earlier run's claims from its own.
        self.worker_run = uuid4().hex
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

        # Celery identifies a method receiver by its function, so without its own ID only one Jobs would receive.
        task_failure.connect(self.record_lost_process, weak=False, dispatch_uid=self.worker_run)
        jobs = self

        class CheckWorker(bootsteps.StartStopStep):
            """Refuses to start a worker that would not run as this target's worker; see `Jobs.check_worker`."""

            def start(self, worker: Any) -> None:
                jobs.check_worker(worker.hostname, set(worker.app.amqp.queues.consume_from))

        self.celery_app.steps["worker"].add(CheckWorker)

        class RecordLostClaims(bootsteps.StartStopStep):
            """When the worker starts, records the failure of the jobs that an earlier run of it claimed and left."""

            # After the worker's check, so that a worker it refuses, such as a running worker's duplicate, fails no job.
            requires = {CheckWorker}

            def start(self, worker: Any) -> None:
                try:
                    jobs.record_lost_claims(node=worker.hostname)
                except redis.RedisError:
                    # The worker still starts; the claims are checked again when it next starts.
                    logger.warning(
                        "Could not check the jobs left by an earlier run of %s", worker.hostname, exc_info=True
                    )

        self.celery_app.steps["worker"].add(RecordLostClaims)

        class CleanPackages(bootsteps.StartStopStep):
            """Deletes the packages that no job can deliver when the worker starts, and then every interval.

            When the worker starts, it also deletes the staging directories of exports that were killed.
            """

            # After the check of lost claims, which Celery would otherwise order at random, so that the packages of the
            # jobs it fails are deleted at start.
            requires = {"celery.worker.components:Timer", RecordLostClaims}

            def start(self, worker: Any) -> None:
                # Celery starts the consumer after every other step, so none of this worker's exports runs yet.
                jobs.clean_staging()
                jobs.clean_packages()
                self.cleanup = worker.timer.call_repeatedly(CLEANUP_INTERVAL.total_seconds(), jobs.clean_packages)

            def stop(self, worker: Any) -> None:
                self.cleanup.cancel()

        self.celery_app.steps["worker"].add(CleanPackages)

    def package_path(self, job_id: str) -> Path:
        """Return where the job's package is stored once the job completes."""
        return self.package_dir / f"{job_id}.dtccpkg"

    def submit(self, dataset_name: str, parameters: dict[str, Any]) -> str:
        """Record and queue a job that runs a Dataset with parameters the caller has validated; return its ID.

        Raises:
            redis.RedisError: If Redis cannot record the job; nothing was sent.
            UnconfirmedSubmission: If sending the job or recording its confirmation failed, or the job's record was
                lost meanwhile; the job may be queued, and it is not sent again.
        """
        job_id = str(uuid4())
        key = record_key(job_id)
        submitted_at = datetime.now(UTC).isoformat()
        acceptance = {"dataset": dataset_name, "target": self.target, "submitted_at": submitted_at}
        with self.records.pipeline() as pipeline:
            pipeline.hset(key, mapping={**acceptance, "execution_gate": "waiting"})
            # The record of a job that never finishes expires too.
            pipeline.expire(key, RECORD_LIFETIME)
            pipeline.execute()
        try:
            self.sender.send_task(RUN_DATASET, args=[dataset_name, parameters], task_id=job_id, queue=self.target)
            answer = self.queued_script(keys=[key], args=[datetime.now(UTC).isoformat()])
        except (redis.RedisError, OperationalError) as error:
            raise UnconfirmedSubmission(job_id) from error
        if answer != "recorded":
            # Recreating the record would leave one without its acceptance fields or a lifetime.
            logger.warning("Job %s was sent, but its record is %s, so its confirmation is not recorded", job_id, answer)
            raise UnconfirmedSubmission(job_id)
        return job_id

    def read_record(self, job_id: str) -> dict[str, Any] | None:
        """Return Engine's record of the job with its timestamps parsed, or None if the job has no record.

        Raises:
            JobStateUnavailable: If the record lacks an acceptance field or its gate, or its fields contradict each
                other.
            redis.RedisError: If Redis is unreachable.
        """
        record = self.records.hgetall(record_key(job_id))
        if not record:
            return None
        try:
            outcome = record.get("outcome")
            consistent = (
                outcome in OUTCOMES[record["execution_gate"]]
                and ("finished_at" in record) == (outcome is not None)
                and ("error_type" in record) == (outcome == "failed")
                and ("error_upstream" not in record or outcome == "failed")
                and ("claimed_by" not in record or record["execution_gate"] == "started")
            )
            if not consistent:
                raise JobStateUnavailable(job_id)
            if "claimed_by" in record:
                parse_claim(record["claimed_by"])
            return {
                "dataset": record["dataset"],
                "target": record["target"],
                "submitted_at": parse_time(record["submitted_at"]),
                "queued_at": parse_time(record["queued_at"]) if "queued_at" in record else None,
                "outcome": outcome,
                "finished_at": parse_time(record["finished_at"]) if outcome else None,
                "error_type": record.get("error_type"),
                "error_upstream": json.loads(record["error_upstream"]) if "error_upstream" in record else None,
                "claimed_by": record.get("claimed_by"),
            }
        except (KeyError, ValueError) as error:
            raise JobStateUnavailable(job_id) from error

    def status(self, job_id: str) -> dict[str, Any] | None:
        """Return the job's state, progress, error, and package, or None if the job is unknown or expired.

        Raises:
            JobStateUnavailable: If the job's state cannot be established from its record and Celery's state.
            redis.RedisError: If Redis is unreachable, so the state is unknown for now.
        """
        # Read before the record: the worker records an outcome before Celery stores a terminal state.
        meta = self.celery_app.backend.get_task_meta(job_id)
        record = self.read_record(job_id)
        if record is None:
            return None
        finished_at = record["finished_at"]
        if finished_at is not None and datetime.now(UTC) >= finished_at + RETENTION:
            return None
        state = record["outcome"] or CELERY_STATES.get(meta["status"])
        if state is None:
            raise JobStateUnavailable(job_id)
        if state == "queued" and record["queued_at"] is None:
            state = "unconfirmed"
        error = {"type": record["error_type"]} if state == "failed" else None
        if error is not None and record["error_upstream"] is not None:
            error["upstream"] = record["error_upstream"]
        return {
            "job_id": job_id,
            "dataset": record["dataset"],
            "target": record["target"],
            "submitted_at": record["submitted_at"].isoformat(),
            "finished_at": finished_at.isoformat() if finished_at else None,
            "state": state,
            "progress": meta["result"] if state == "running" and meta["status"] == "PROGRESS" else None,
            "error": error,
            "package": (
                {"available": self.package_path(job_id).is_file(), "expires_at": (finished_at + RETENTION).isoformat()}
                if state == "completed"
                else None
            ),
        }

    def cancel(self, job_id: str) -> str | None:
        """Cancel a job that no delivery has claimed.

        Returns:
            `cancelled` if the job is cancelled, now or before; `already_finished` if it completed or failed; None if
            the job is unknown or expired.

        Raises:
            ExecutionStarted: If a delivery claimed the job, and it has not finished.
            JobStateUnavailable: If the job's record is unusable.
            redis.RedisError: If Redis did not answer; the job may or may not be cancelled.
        """
        # Checks the acceptance fields, which never change once written; the cancellation checks the rest.
        if self.read_record(job_id) is None:
            return None
        finished_at = datetime.now(UTC).isoformat()
        answer = self.cancel_script(keys=[record_key(job_id)], args=[finished_at, int(RECORD_LIFETIME.total_seconds())])
        if answer == "started":
            raise ExecutionStarted(job_id)
        if answer == "unusable":
            raise JobStateUnavailable(job_id)
        # A recorded outcome never changes, so this read sees the one the cancellation found or made.
        record = self.read_record(job_id)
        if record is None or datetime.now(UTC) >= record["finished_at"] + RETENTION:
            return None
        return "cancelled" if record["outcome"] == "cancelled" else "already_finished"

    def run(self, task: Task, dataset_name: str, parameters: dict[str, Any]) -> None:
        """Run a job in the worker if this delivery claims it, and record how the job ended.

        The job invokes the Dataset, exports its realization, and validates the package.

        Raises:
            Ignore: If this delivery does not claim the job, or the job's record is gone or no longer claimed when the
                job ends; Celery then stores no result.
            Exception: Whatever the Dataset, the export, or the validation raised; the job then fails.
        """
        job_id = task.request.id
        if not self.claim(job_id, f"{task.request.hostname} {self.worker_run} {os.getpid()}"):
            raise Ignore()
        path = self.package_path(job_id)
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
            upstream = public_upstream_error(error) if isinstance(error, DatasetUpstreamError) else None
            self.finish(job_id, "failed", type(error).__name__, upstream)
            raise
        finally:
            set_progress_callback(previous_callback)
        self.finish(job_id, "completed")

    def claim(self, job_id: str, claim: str) -> bool:
        """Claim permission to run the job's Dataset, which only one caller gets, and only while the job is waiting.

        The claim names the worker's node, the worker run, and the pool process. A claim whose answer Redis did not send
        is not repeated: it may have been made.
        """
        try:
            # Checks the acceptance fields, which never change once written; the claim checks the rest.
            self.read_record(job_id)
            answer = self.start_script(keys=[record_key(job_id)], args=[claim, int(RECORD_LIFETIME.total_seconds())])
        except (JobStateUnavailable, redis.RedisError):
            logger.warning("Job %s does not run: its record is unusable or Redis did not answer", job_id, exc_info=True)
            return False
        if answer != "started":
            logger.warning("Job %s does not run: its record is %s", job_id, answer)
        return answer == "started"

    def finish(self, job_id: str, outcome: str, error_type: str = "", upstream: dict[str, Any] | None = None) -> None:
        """Record how a claimed job ended, with its finish time and error, and start its record's lifetime.

        Raises:
            Ignore: If the job's record is gone or no longer claimed, so no outcome was recorded.
            redis.RedisError: If Redis did not answer; the outcome may or may not be recorded.
        """
        finished_at = datetime.now(UTC).isoformat()
        lifetime = int(RECORD_LIFETIME.total_seconds())
        details = json.dumps(upstream) if upstream else ""
        answer = self.finish_script(
            keys=[record_key(job_id)], args=[outcome, finished_at, lifetime, error_type, details]
        )
        if answer != "recorded":
            logger.warning("Job %s %s, but its record is %s, so the outcome is not recorded", job_id, outcome, answer)
            raise Ignore()

    def clean_packages(self) -> None:
        """Delete this host's packages that no job can deliver.

        A package goes when its job is unknown or expired, failed, was cancelled, or completed more than the retention
        ago. It stays while its job has no outcome, which may still be completion, and while the job's record is
        unusable. A pass that Redis does not answer deletes no more packages; the next pass does.
        """
        now = datetime.now(UTC)
        try:
            for path in self.package_dir.glob("*.dtccpkg"):
                try:
                    record = self.read_record(path.stem)
                except JobStateUnavailable:
                    continue
                outcome = record["outcome"] if record else None
                expired = outcome == "completed" and now >= record["finished_at"] + RETENTION
                if record is None or outcome in ("failed", "cancelled") or expired:
                    path.unlink(missing_ok=True)
                    logger.info("Deleted package %s, which no job can deliver", path.name)
        except redis.RedisError:
            logger.warning("Could not read job records; packages are deleted at the next pass", exc_info=True)

    def clean_staging(self) -> None:
        """Delete the directories in which Core staged exports beside the packages.

        Call it only before the worker runs jobs: the host's worker is the only one that exports here, and its earlier
        run has stopped, so every such directory belongs to an export that was killed.
        """
        for staging in self.package_dir.glob(".dtcc-package-*"):
            shutil.rmtree(staging, ignore_errors=True)
            logger.info("Deleted %s, left by an export that was killed", staging.name)

    def check_worker(self, node: str, queues: set[str]) -> None:
        """Check that a worker may start: as `celery@<target>`, consuming only this target's queue.

        It also refuses a node name that another running worker answers to, as a best effort: a running worker whose
        answer is late or lost, or a broker error, which is logged, lets the worker start, as do two that start at once.

        Raises:
            ValueError: If `node` is not `celery@<target>`, or `queues` are not this target's queue alone.
            RuntimeError: If another running worker answers as `node`.
        """
        if node != f"celery@{self.target}":
            raise ValueError(f"A worker of target '{self.target}' must run as celery@{self.target}, not {node}")
        if queues != {self.target}:
            raise ValueError(
                f"A worker of target '{self.target}' must consume only the queue '{self.target}', not {sorted(queues)}"
            )
        try:
            # A connection of its own: on a pooled one, an earlier call that timed out can lose this answer.
            with self.celery_app.connection_for_write() as connection:
                answers = self.celery_app.control.ping([node], timeout=NODE_CHECK_TIMEOUT, connection=connection)
        except OperationalError:
            logger.warning("Could not check whether another running worker answers as %s", node, exc_info=True)
            return
        if answers:
            raise RuntimeError(f"Another running worker answers as {node}, so this one does not start")

    def record_lost_process(self, sender: Task, task_id: str, exception: BaseException, **kwargs: Any) -> None:
        """Record the failure of a job whose pool process was lost, reported by Celery in the worker's main process."""
        if sender.app is self.celery_app and isinstance(exception, WorkerLostError):
            self.record_lost_claims(job_ids=[task_id])

    def record_lost_claims(self, node: str | None = None, job_ids: list[str] | None = None) -> None:
        """Record the failure of each started job without an outcome whose claimant is gone.

        A claimant is gone if it is a pool process of this worker run that no longer exists (`WorkerLostError`), or,
        with `node`, an earlier run of the worker with that node name (`WorkerRestarted`). Only the claim that was read
        is replaced, so a claim or an outcome recorded meanwhile stays. An unusable record is left as it is.
        """
        if job_ids is None:
            job_ids = [key.removeprefix(record_key("")) for key in self.records.scan_iter(record_key("*"))]
        for job_id in job_ids:
            try:
                record = self.read_record(job_id)
            except JobStateUnavailable:
                logger.warning("Job %s is not checked for a lost claimant: its record is unusable", job_id)
                continue
            if record is None or record["claimed_by"] is None or record["outcome"] is not None:
                continue
            claim = record["claimed_by"]
            claim_node, worker_run, pid = parse_claim(claim)
            if worker_run == self.worker_run and not process_alive(pid):
                error_type = "WorkerLostError"
            elif claim_node == node and worker_run != self.worker_run:
                error_type = "WorkerRestarted"
            else:
                continue
            finished_at = datetime.now(UTC).isoformat()
            lifetime = int(RECORD_LIFETIME.total_seconds())
            answer = self.lost_script(keys=[record_key(job_id)], args=[claim, error_type, finished_at, lifetime])
            if answer == "recorded":
                logger.warning("Job %s failed with %s: %s, which claimed it, is gone", job_id, error_type, claim)


def jobs_from_environment() -> Jobs:
    """Create this host's jobs from `ENGINE_REDIS_URL`, `ENGINE_TARGET`, `ENGINE_PACKAGE_DIR`, and the optional
    `ENGINE_IMAGE_DIGEST`, which, unset or empty, means that the deployment supplies no digest."""
    return Jobs(
        os.environ["ENGINE_REDIS_URL"],
        os.environ["ENGINE_TARGET"],
        Path(os.environ["ENGINE_PACKAGE_DIR"]),
        os.environ.get("ENGINE_IMAGE_DIGEST") or None,
    )
