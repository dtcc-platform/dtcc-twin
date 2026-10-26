#!/bin/sh
# Builds the backend and web images and checks compose.prod.yaml in its own Compose project, with throwaway settings
# and volumes. Needs Docker, curl and Node.
set -eu
cd "$(dirname "$0")/.."
# Relative, so Compose resolves it against the repository root on every platform.
export TWIN_SETTINGS_DIR=./.temp/check-prod
export TWIN_WEB_PORT="${CHECK_PROD_PORT:-18080}"
base="http://127.0.0.1:$TWIN_WEB_PORT"
compose() { docker compose --file compose.prod.yaml --project-name dtcc-twin-prod-check "$@"; }
secret() { node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'; }
fail() { echo "FAILED: $1" >&2; exit 1; }
trap 'compose down --volumes; rm -rf "$TWIN_SETTINGS_DIR"' EXIT

mkdir -p "$TWIN_SETTINGS_DIR"
password=$(secret)
printf 'POSTGRES_PASSWORD=%s\n' "$password" > "$TWIN_SETTINGS_DIR/postgres.env"
printf 'DATABASE_URL=postgres://twin:%s@postgres:5432/twin\nJWT_SECRET=%s\n' "$password" "$(secret)" \
    > "$TWIN_SETTINGS_DIR/backend.env"

compose build
compose up --detach --wait --wait-timeout 180

[ "$(compose ps --all --format '{{.ExitCode}}' migrate)" = 0 ] || fail "the migration did not exit 0"
[ "$(compose exec -T backend id -u)" = 10001 ] || fail "the backend does not run as uid 10001"
[ "$(compose exec -T web id -u)" = 101 ] || fail "the web server does not run as uid 101"
echo "stack: migrated, healthy, not root"

curl -fsS "$base/healthz" > /dev/null || fail "/healthz"
curl -fsS "$base/" | grep -q '<div id="root">' || fail "/ does not serve index.html"
curl -fsS "$base/workspace/some/client/route" | grep -q '<div id="root">' || fail "a client route does not serve index.html"
curl -fsSI "$base/" | grep -qi '^cache-control: no-cache' || fail "index.html is cacheable"
curl -fsSI "$base/" | grep -qi '^x-content-type-options: nosniff' || fail "the security headers are missing"
asset=$(curl -fsS "$base/" | grep -o '/assets/[^"]*\.js' | head -n 1)
curl -fsSI "$base$asset" | grep -qi '^cache-control: .*immutable' || fail "$asset is not cached as immutable"
curl -fsSI "$base$asset" | grep -qi '^x-content-type-options: nosniff' || fail "$asset lacks the security headers"
echo "web: index.html, client routes, cache and security headers"

curl -fsS "$base/api/health/ready" | grep -q '"ok"' || fail "/api/health/ready through the web server"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/docs")" = 404 ] || fail "Swagger UI is served in production"
headers=$(curl -fsS -D - -o /dev/null -H 'content-type: application/json' \
    -d '{"email":"check@example.com","name":"Check","password":"a-long-check-password"}' "$base/api/auth/register") ||
    fail "registering through the web server"
echo "$headers" | grep -qi '^set-cookie: __Host-access_token=.*Secure' || fail "the access cookie is not a Secure __Host- cookie"
echo "api: ready, no Swagger UI, Secure __Host- cookies"

# A recreated backend has a new address, which the web server must find; the user must survive it.
compose up --detach --wait --force-recreate --no-deps backend
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
    -d '{"email":"check@example.com","password":"a-long-check-password"}' "$base/api/auth/login")" = 200 ] ||
    fail "logging in after the backend was recreated"
echo "restart: the web server reaches the new backend, and the user survived"
