# Twin backend image. Build from the repository root, which holds the workspace and @repo/contracts:
#   docker build --file apps/backend/Dockerfile --target prod .
# `prod` runs the API (`node dist/main.js`) and, as a one-shot before each release, the migrations (`node dist/migrate.js`).
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS node

FROM node AS build
# The version in package.json's packageManager; npm, not corepack, so the build needs no signing keys.
RUN npm install --global --no-fund --no-audit pnpm@11.25.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter backend... \
    && pnpm --filter @repo/contracts build \
    && pnpm --filter backend build \
    && pnpm --filter backend deploy --legacy --prod /deploy

FROM node AS prod
ENV NODE_ENV=production \
    PORT=3030 \
    PACKAGE_STORAGE_DIR=/var/lib/dtcc-twin/packages
# The Engine image's uid, so one host directory layout fits both.
RUN useradd --uid 10001 --create-home twin \
    && mkdir -p /var/lib/dtcc-twin/packages \
    && chown twin:twin /var/lib/dtcc-twin/packages
WORKDIR /app
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/drizzle ./drizzle
USER twin
EXPOSE 3030
# Readiness, which includes the database: Compose's --wait and depends_on then mean "serving".
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
