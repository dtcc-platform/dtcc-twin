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
from urllib.parse import urlsplit

import dtcc_core.datasets as datasets
import dtcc_sim  # noqa: F401  Importing Sim registers its Dataset Definitions with Core.
import requests
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, ValidationError
from redis import RedisError

from dtcc_engine.jobs import (
    TARGET_PATTERN,
    ExecutionStarted,
    Jobs,
    JobStateUnavailable,
    UnconfirmedSubmission,
    installed_versions,
    jobs_from_environment,
)

# How long the entry waits to connect to a remote host's Engine, and then for each read of its answer.
HOST_TIMEOUT = 5.0
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


class HostDiscovery(BaseModel):
    """A host's answer to `GET /api/v1/host`."""

    target: str
    image_digest: str | None
    versions: dict[str, str]
    catalog_revision: str
    datasets: dict[str, Any]


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


def parse_remote_targets(value: str, local_target: str) -> dict[str, str]:
    """Parse the remote targets, `<identifier>=<address>` separated by commas, into addresses by identifier, in order.

    An address is the base URL of the target's Engine HTTP service: `http` or `https`, without credentials, a query,
    or a fragment. Errors never repeat an address, which could hold a credential.

    Raises:
        ValueError: If an entry is malformed, an identifier is malformed, repeated, or the local target's, or an
            address is not such a URL.
    """
    targets: dict[str, str] = {}
    for entry in value.split(",") if value else []:
        identifier, separator, address = entry.partition("=")
        if not separator or not TARGET_PATTERN.fullmatch(identifier):
            raise ValueError("Each remote target must be <identifier>=<address>, with a valid target identifier")
        if identifier == local_target or identifier in targets:
            raise ValueError(f"Remote target '{identifier}' is the local target or is configured twice")
        try:
            parts = urlsplit(address)
            parts.port  # Raises ValueError if the port is malformed.
        except ValueError:
            # The parser's own errors can repeat the address.
            parts = None
        if (
            parts is None
            or parts.scheme not in ("http", "https")
            or not parts.hostname
            or "@" in parts.netloc
            # Not parts.query or parts.fragment: an empty one is "", and would still come before the route's path.
            or "?" in address
            or "#" in address
        ):
            raise ValueError(
                f"Remote target '{identifier}' needs a valid http or https URL without credentials, query, or fragment"
            )
        targets[identifier] = address.rstrip("/")
    return targets


def host_summary(host: dict[str, Any]) -> dict[str, Any]:
    """Return a host-local discovery's image digest, versions, and catalog revision, and its Datasets' names."""
    return {
        "image_digest": host["image_digest"],
        "versions": host["versions"],
        "catalog_revision": host["catalog_revision"],
        "datasets": sorted(host["datasets"]),
    }


def create_app(api_token: str, jobs: Jobs, remote_targets: dict[str, str] | None = None) -> FastAPI:
    """Create the Engine HTTP application.

    Args:
        api_token: Shared token that every route except the health route requires,
            sent as `Authorization: Bearer <token>`.
        jobs: The jobs of this host's compute target.
        remote_targets: The base addresses of the remote targets' Engine HTTP services by identifier, in placement
            order, as `parse_remote_targets` returns them.

    Raises:
        ValueError: If `api_token` is empty or is not an RFC 6750 bearer token
            (letters, digits, `-._~+/`, then optional trailing `=`).
    """
    if not BEARER_TOKEN_PATTERN.fullmatch(api_token):
        raise ValueError("The Engine API token must be a non-empty RFC 6750 bearer token")
    expected_token = api_token.encode()
    remote_targets = remote_targets or {}
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
        except JobStateUnavailable:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Job state cannot be established"
            ) from None
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return job

    def bearer_token(request: requests.PreparedRequest) -> requests.PreparedRequest:
        # As the request's authentication, so that requests does not replace it with credentials from `.netrc`.
        request.headers["Authorization"] = f"Bearer {api_token}"
        return request

    def remote_host(target: str, address: str) -> dict[str, Any]:
        """Return a remote target's host-local discovery, or the reason it could not be read, as `host_error`."""
        try:
            # Not redirected: the token goes to configured addresses only.
            response = requests.get(
                f"{address}/api/v1/host", auth=bearer_token, timeout=HOST_TIMEOUT, allow_redirects=False
            )
        except requests.RequestException:
            return {"host": None, "host_error": "The host could not be reached"}
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            return {"host": None, "host_error": "The host rejected the token"}
        if response.status_code != status.HTTP_200_OK:
            return {"host": None, "host_error": f"The host answered HTTP {response.status_code}"}
        try:
            host = HostDiscovery.model_validate(response.json())
        except (ValueError, ValidationError):
            return {"host": None, "host_error": "The host's answer is malformed"}
        if host.target != target:
            return {"host": None, "host_error": "The host answers as another target"}
        return {"host": host_summary(host.model_dump()), "host_error": None}

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

    @app.get("/api/v1/host", dependencies=[Depends(require_token)])
    def describe_host() -> dict[str, Any]:
        # Host-local discovery, which must not query other hosts.
        return {"target": jobs.target, "image_digest": jobs.image_digest, **dataset_catalog()}

    @app.get("/api/v1/targets", dependencies=[Depends(require_token)])
    def list_targets() -> dict[str, Any]:
        local = {"host": host_summary(describe_host()), "host_error": None}
        targets = [{"target": jobs.target, **jobs.observe(jobs.target), **local}]
        for target, address in remote_targets.items():
            targets.append({"target": target, **jobs.observe(target), **remote_host(target, address)})
        return {"targets": targets}

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
                detail=f"Target '{request.target}' is not accepted; this Engine runs jobs only on '{jobs.target}'",
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

    @app.post("/api/v1/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
    def cancel_job(job_id: str) -> dict[str, str]:
        try:
            result = jobs.cancel(job_id)
        except (RedisError, JobStateUnavailable):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Job state is unavailable, so whether the job is cancelled is unknown; poll the job",
            ) from None
        except ExecutionStarted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "result": "execution_started",
                    "message": "Execution permission has been claimed, so the job can no longer be cancelled",
                },
            ) from None
        if result is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' is unknown or expired")
        return {"job_id": job_id, "status_url": f"/api/v1/jobs/{job_id}", "result": result}

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
    """Create the application from `ENGINE_API_TOKEN`, the job settings, and `ENGINE_REMOTE_TARGETS`, which, unset or
    empty, means that there are none; the Uvicorn `--factory` entry point.

    Raises:
        ValueError: If `ENGINE_API_TOKEN` is unset, empty, or not an RFC 6750 bearer token, if `ENGINE_TARGET` or
            `ENGINE_IMAGE_DIGEST` is malformed, or if `ENGINE_REMOTE_TARGETS` cannot be used (`parse_remote_targets`).
        KeyError: If a job setting is unset: `ENGINE_REDIS_URL`, `ENGINE_TARGET`, or `ENGINE_PACKAGE_DIR`.
    """
    jobs = jobs_from_environment()
    remote_targets = parse_remote_targets(os.environ.get("ENGINE_REMOTE_TARGETS", ""), jobs.target)
    return create_app(os.environ.get("ENGINE_API_TOKEN", ""), jobs, remote_targets)
