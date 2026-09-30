#!/bin/sh
# Builds the Engine's prod target and checks it in its own Compose project, so a running
# `pnpm dev:engine` or Postgres is left alone. The checks are mounted; the image contains none.
set -eu
cd "$(dirname "$0")/../.."
compose() { docker compose --project-name dtcc-twin-engine-prod --profile engine-prod "$@"; }
trap 'compose down' EXIT

compose build engine-prod
# A fresh container has an empty FEniCSx cache, so every form in these tests is compiled.
compose run --rm -T --volume "$PWD/apps/engine:/checks:ro" --env XDG_CACHE_HOME=/tmp/cache \
    --env PYTHONDONTWRITEBYTECODE=1 engine-prod \
    python -m pytest -p no:cacheprovider --rootdir /checks /checks/tests/test_environment.py /checks/prod_checks
compose up --detach --wait engine-prod
compose exec -T engine-prod python -c '
import os, urllib.error, urllib.request

def status(headers):
    request = urllib.request.Request("http://localhost:8000/api/v1/datasets", headers=headers)
    try:
        return urllib.request.urlopen(request).status
    except urllib.error.HTTPError as error:
        return error.code

assert status({}) == 401
assert status({"Authorization": "Bearer " + os.environ["ENGINE_API_TOKEN"]}) == 200
print("prod API: healthy, rejects a missing token, accepts the configured token")
'
