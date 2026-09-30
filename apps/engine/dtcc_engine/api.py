"""HTTP API for DTCC Engine.

Exposes the Dataset Definitions registered with DTCC Core, including those that
DTCC Sim contributes on import, as Core describes them, and runs them as
asynchronous jobs.
"""

import hashlib
import json
import os
import re
import secrets
from importlib.metadata import version
from typing import Any

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, ValidationError
from redis import RedisError

from dtcc_engine.jobs import Jobs, UnconfirmedSubmission, jobs_from_environment

VERSIONED_PACKAGES = ("dtcc-engine", "dtcc-core", "dtcc-sim")
# RFC 6750 b64token: any other configured token could never match a well-formed Authorization header.
BEARER_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9\-._~+/]+=*")


class JobRequest(BaseModel):
    """A request to run one Dataset as a job."""

    model_config = ConfigDict(extra="forbid")

    dataset: str
    parameters: dict[str, Any]
    target: str | None = None


# The names that locations in a job request's own validation errors can hold.
REQUEST_FIELDS = {"body", *JobRequest.model_fields}


def public_errors(errors: list[dict[str, Any]], fields: set[str]) -> list[dict[str, Any]]:
    """Return each validation error's type and location without anything the consumer sent.

    An error's input, context, and message can repeat a submitted value, and a location part that is neither
    one of `fields` nor a list position can be a submitted name, so it becomes `<unexpected>`.
    """
    return [
        {
            "loc": [part if isinstance(part, int) or part in fields else "<unexpected>" for part in error["loc"]],
            "type": error["type"],
        }
        for error in errors
    ]


def installed_versions() -> dict[str, str]:
    """Return the installed Engine, Core, and Sim distribution versions."""
    return {package: version(package) for package in VERSIONED_PACKAGES}


def dataset_catalog() -> dict[str, Any]:
    """Return the discovery listing for every Dataset registered with Core.

    The listing holds the installed versions, each Dataset's Core `describe()`
    output keyed by name, and `catalog_revision`: a SHA-256 digest of the versions
    and descriptions, which changes whenever either changes.
    """
    content = {
        "versions": installed_versions(),
        "datasets": {name: dataset.describe() for name, dataset in datasets.list().items()},
    }
    canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
    return {"catalog_revision": "sha256:" + hashlib.sha256(canonical.encode()).hexdigest(), **content}


def create_app(api_token: str, jobs: Jobs) -> FastAPI:
    """Create the Engine HTTP application.

    Args:
        api_token: Shared token that every route except the health route requires,
            sent as `Authorization: Bearer <token>`.
        jobs: The jobs of this host's compute target.

    Raises:
        ValueError: If `api_token` is empty or is not an RFC 6750 bearer token
            (letters, digits, `-._~+/`, then optional trailing `=`).
    """
    if not BEARER_TOKEN_PATTERN.fullmatch(api_token):
        raise ValueError("The Engine API token must be a non-empty RFC 6750 bearer token")
    expected_token = api_token.encode()
    bearer = HTTPBearer(auto_error=False)

    def require_token(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
        if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), expected_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing or invalid Engine API token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    def find_job(job_id: str) -> dict[str, Any]:
        try:
            job = jobs.status(job_id)
        except RedisError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Job state is temporarily unavailable"
            ) from None
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return job

    # Generated documentation would be served without the token; health is the only public route.
    app = FastAPI(title="DTCC Engine", version=version("dtcc-engine"), docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(RequestValidationError)
    async def reject_invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": public_errors(error.errors(), REQUEST_FIELDS)},
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/datasets", dependencies=[Depends(require_token)])
    def list_datasets() -> dict[str, Any]:
        return dataset_catalog()

    @app.get("/api/v1/datasets/{name}", dependencies=[Depends(require_token)])
    def describe_dataset(name: str) -> dict[str, Any]:
        registered = datasets.list()
        if name not in registered:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dataset '{name}' is not registered")
        return registered[name].describe()

    @app.post("/api/v1/jobs", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_token)])
    def submit_job(request: JobRequest) -> dict[str, str]:
        registered = datasets.list()
        if request.dataset not in registered:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Dataset '{request.dataset}' is not registered",
            )
        if request.target not in (None, jobs.target):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Target '{request.target}' is not configured; this Engine runs jobs on '{jobs.target}'",
            )
        if request.parameters.get("format") is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Engine delivers every job as a canonical .dtccpkg; remove the 'format' parameter",
            )
        try:
            registered[request.dataset].validate(dict(request.parameters))
        except ValidationError as error:
            fields = set(registered[request.dataset].ArgsModel.model_fields)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=public_errors(error.errors(), fields)
            ) from None
        try:
            job_id = jobs.submit(request.dataset, request.parameters)
        except RedisError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The job queue is unavailable; the job was not submitted",
            ) from None
        except UnconfirmedSubmission as unconfirmed:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "message": "The queue did not confirm the job, which may still run; poll it before resubmitting",
                    "job_id": unconfirmed.job_id,
                    "status_url": f"/api/v1/jobs/{unconfirmed.job_id}",
                },
            ) from None
        return {"job_id": job_id, "status_url": f"/api/v1/jobs/{job_id}"}

    @app.get("/api/v1/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str) -> dict[str, Any]:
        return find_job(job_id)

    @app.get("/api/v1/jobs/{job_id}/package", dependencies=[Depends(require_token)])
    def download_package(job_id: str) -> FileResponse:
        job = find_job(job_id)
        if job["package"] is None or not job["package"]["available"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Job '{job_id}' has no package to download; its state is '{job['state']}'",
            )
        return FileResponse(jobs.package_path(job_id), media_type="application/zip", filename=f"{job_id}.dtccpkg")

    return app


def create_app_from_environment() -> FastAPI:
    """Create the application from `ENGINE_API_TOKEN` and the job settings; the Uvicorn `--factory` entry point.

    Raises:
        ValueError: If `ENGINE_API_TOKEN` is unset, empty, or not an RFC 6750 bearer token.
        KeyError: If a job setting is unset: `ENGINE_REDIS_URL`, `ENGINE_TARGET`, or `ENGINE_PACKAGE_DIR`.
    """
    return create_app(os.environ.get("ENGINE_API_TOKEN", ""), jobs_from_environment())
