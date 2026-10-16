# syntax=docker/dockerfile:1.7
#
# Images of the cloud (DEC-045): one build of the monorepo, three targets.
#   web     Next.js (backoffice, /pos, /kds, /api/v1) in standalone output
#   worker  outbox, monitor, migrations and the legal archive (tsx on the sources)
#   hub     the LAN hub of a location (deploy/hub)
#
# docker build -f deploy/Dockerfile --target web --build-arg APP_VERSION=1.0.0+abc123 .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# ── Dependencies and build ─────────────────────────────────────────────────────
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ARG APP_VERSION=dev
# The same id names the build, the service worker's precache and the version devices report.
ENV APP_VERSION=$APP_VERSION POS_BUILD_ID=$APP_VERSION NEXT_OUTPUT=standalone
RUN pnpm --filter @pos/web build

# ── Web ────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Texts are read at request time from apps/web/messages (src/i18n/request.ts).
COPY --from=build /repo/apps/web/messages ./apps/web/messages
WORKDIR /app/apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ── Worker (outbox, monitor, migrations, archive) ──────────────────────────────
FROM build AS worker
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@pos/db", "outbox:work"]

# ── Hub (LAN) ──────────────────────────────────────────────────────────────────
# Built on its own: the location's mini PC installs only the hub and its packages and never
# builds the web. It also runs the migrations of its own database (deploy/hub).
FROM base AS hub
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@pos/hub..."
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN pnpm --filter @pos/hub build && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HUB_PORT=4100 HUB_STATE_FILE=/data/.hub-state.json
WORKDIR /repo/apps/hub
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
