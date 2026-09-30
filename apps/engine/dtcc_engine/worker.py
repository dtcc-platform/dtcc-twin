"""Entry point of the Celery worker that runs this host's Dataset jobs: `celery --app dtcc_engine.worker worker`."""

from dtcc_engine.jobs import jobs_from_environment

celery_app = jobs_from_environment().celery_app
