"""Entry point of the Celery worker that runs this host's Dataset jobs.

Run as `celery --app dtcc_engine.worker worker --hostname celery@<target>`, where `<target>` is `ENGINE_TARGET`.
"""

from dtcc_engine.jobs import jobs_from_environment

celery_app = jobs_from_environment().celery_app
