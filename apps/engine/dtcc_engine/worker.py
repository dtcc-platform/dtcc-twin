"""Entry point of the Celery worker that runs this host's Dataset jobs.

Run as `celery --app dtcc_engine.worker worker --hostname <name>@<target>`, where `<target>` is `ENGINE_TARGET` and
`<name>` is `celery` for the host's own worker, or another name of lowercase letters and digits.
"""

from dtcc_engine.jobs import jobs_from_environment

celery_app = jobs_from_environment().celery_app
