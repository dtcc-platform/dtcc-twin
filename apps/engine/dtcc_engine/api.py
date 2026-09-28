"""HTTP API for DTCC Engine.

Exposes the Dataset Definitions registered with DTCC Core, including those that
DTCC Sim contributes on import, as Core describes them.
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
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

VERSIONED_PACKAGES = ("dtcc-engine", "dtcc-core", "dtcc-sim")
# RFC 6750 b64token: any other configured token could never match a well-formed Authorization header.
BEARER_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9\-._~+/]+=*")


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


def create_app(api_token: str) -> FastAPI:
    """Create the Engine HTTP application.

    Args:
        api_token: Shared token that every route except the health route requires,
            sent as `Authorization: Bearer <token>`.

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

    # Generated documentation would be served without the token; health is the only public route.
    app = FastAPI(title="DTCC Engine", version=version("dtcc-engine"), docs_url=None, redoc_url=None, openapi_url=None)

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

    return app


def create_app_from_environment() -> FastAPI:
    """Create the application with the token from `ENGINE_API_TOKEN`; the Uvicorn `--factory` entry point.

    Raises:
        ValueError: If `ENGINE_API_TOKEN` is unset, empty, or not an RFC 6750 bearer token.
    """
    return create_app(os.environ.get("ENGINE_API_TOKEN", ""))
