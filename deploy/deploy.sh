#!/usr/bin/env bash
#
# Deploys the cloud without downtime (RNF-17, DEC-045):
#   1. builds the images of this commit (version = date + commit);
#   2. applies the migrations (they only add: older terminals keep working);
#   3. restarts web-1, waits until it is healthy, then web-2: Caddy sends the traffic to the
#      container that is up meanwhile;
#   4. restarts the worker and the backups.
# Run on the server from the repository: deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "deploy/.env is missing: copy deploy/.env.example and fill it in." >&2
  exit 1
fi

APP_VERSION="${APP_VERSION:-$(date -u +%Y.%m.%d)+$(git rev-parse --short HEAD)}"
export APP_VERSION
echo "▸ Deploying ${APP_VERSION}"

compose() { docker compose -f docker-compose.prod.yml --env-file .env "$@"; }

wait_healthy() {
  local service="$1" id status
  id="$(compose ps -q "$service")"
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$id")"
    if [[ "$status" == "healthy" ]]; then
      echo "  ✓ ${service} healthy"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ ${service} did not become healthy: stopping the deployment (the other container keeps serving)." >&2
  compose logs --tail=50 "$service" >&2
  exit 1
}

echo "▸ Building images"
compose build web-1 worker backup

echo "▸ Database"
compose up -d mysql
compose run --rm --no-deps worker pnpm --filter @pos/db db:migrate

echo "▸ Rolling out the web containers one by one"
for service in web-1 web-2; do
  compose up -d --no-deps "$service"
  wait_healthy "$service"
done

echo "▸ Worker, backups and proxy"
compose up -d --no-deps worker backup caddy

echo "✓ ${APP_VERSION} is live"
