# Twin web image: the built frontend behind nginx, which also proxies /api to the backend. Build from the repository
# root, which holds the workspace and @repo/contracts:
#   docker build --file apps/frontend/Dockerfile --target prod .
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
# The version in package.json's packageManager; npm, not corepack, so the build needs no signing keys.
RUN npm install --global --no-fund --no-audit pnpm@11.25.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter frontend... && pnpm --filter frontend build

# Runs as uid 101 and listens on 8080, with no root step at startup.
FROM nginxinc/nginx-unprivileged:1.29.8-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS prod
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/healthz"]
