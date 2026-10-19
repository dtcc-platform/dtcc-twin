#!/bin/sh
# Builds the Engine's prod target and checks it in its own Compose project, so a running
# `pnpm dev:engine` or Postgres is left alone. The checks are mounted; the image contains none.
set -eu
cd "$(dirname "$0")/../.."
compose() { docker compose --project-name dtcc-twin-engine-prod --profile engine-prod "$@"; }
# Each run gets new volumes, which take the owners of the image's directories at their mount points.
trap 'compose down --volumes' EXIT

compose build engine-prod engine-prod-worker
# A fresh container has an empty FEniCSx cache, so every form in these tests is compiled.
compose run --rm -T --volume "$PWD/apps/engine:/checks:ro" --env XDG_CACHE_HOME=/tmp/cache \
    --env PYTHONDONTWRITEBYTECODE=1 engine-prod-worker \
    python -m pytest -p no:cacheprovider --rootdir /checks /checks/tests/test_environment.py /checks/prod_checks
compose up --detach --wait engine-prod engine-prod-worker
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
job=$(compose exec -T engine-prod python -c '
import json, os, time, urllib.request

def call(method, path, body=None):
    request = urllib.request.Request(
        "http://localhost:8000/api/v1" + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + os.environ["ENGINE_API_TOKEN"], "Content-Type": "application/json"},
        method=method,
    )
    return json.load(urllib.request.urlopen(request, timeout=10))

job_id = call("POST", "/jobs", {"dataset": "smoke", "parameters": {"bounds": [319891, 6399790, 320091, 6399990]}})["job_id"]
deadline = time.monotonic() + 120
while (state := call("GET", "/jobs/" + job_id)["state"]) in ("queued", "running"):
    assert time.monotonic() < deadline, "the smoke job did not finish within 120 s"
    time.sleep(1)
assert state == "completed", state
print(job_id)
')
package_digest() {
    compose exec -T engine-prod python -c '
import hashlib, os, sys, urllib.request

request = urllib.request.Request(
    "http://localhost:8000/api/v1/jobs/" + sys.argv[1] + "/package",
    headers={"Authorization": "Bearer " + os.environ["ENGINE_API_TOKEN"]},
)
print(hashlib.sha256(urllib.request.urlopen(request, timeout=10).read()).hexdigest())
' "$1"
}
before=$(package_digest "$job")
# Recreated containers keep only what their volumes hold; restarted ones would also keep their own files.
compose up --detach --wait --force-recreate engine-prod engine-prod-worker
after=$(package_digest "$job")
[ "$before" = "$after" ] || { echo "The package changed or was lost: $before, then $after"; exit 1; }
echo "prod worker: healthy, ran a smoke job, and its package outlasted recreated containers"
