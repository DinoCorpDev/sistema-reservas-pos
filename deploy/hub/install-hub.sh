#!/usr/bin/env bash
#
# Installs or updates the hub of one location on a small Linux PC (Debian or Ubuntu) in the
# restaurant's LAN (DEC-028). Run from the repository, with sudo:
#
#   sudo deploy/hub/install-hub.sh
#
# First run: asks for the cloud URL and the pairing code of the location's «Hub» terminal
# (backoffice → Geräte & Stationen → Kopplungscode erzeugen), creates deploy/hub/.env with random
# database passwords, builds and starts the hub, waits until it is paired and forgets the code.
# Later runs: rebuild and restart with the current code (an update). Docker starts the hub again
# after a power cut.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '▸ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  fail "Docker with the compose plugin is missing. Install it first (https://docs.docker.com/engine/install/) and run this script again."
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if [[ ! -f .env ]]; then
  say "First installation of this location's hub"
  read -rp "Cloud URL (e.g. https://pos.example.ch): " cloud_url
  [[ "$cloud_url" =~ ^https?:// ]] || fail "The cloud URL must start with https://"
  read -rp "Pairing code of the «Hub» terminal: " pairing_code
  [[ -n "$pairing_code" ]] || fail "The pairing code is required"
  random() { head -c 24 /dev/urandom | base64 | tr -d '/+='; }
  sed \
    -e "s|^HUB_CLOUD_URL=.*|HUB_CLOUD_URL=${cloud_url%/}|" \
    -e "s|^HUB_PAIRING_CODE=.*|HUB_PAIRING_CODE=${pairing_code}|" \
    -e "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$(random)|" \
    -e "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=$(random)|" \
    .env.example >.env
  chmod 600 .env
fi

version="$(date -u +%Y.%m.%d)+$(git rev-parse --short HEAD 2>/dev/null || echo local)"
sed -i "s|^APP_VERSION=.*|APP_VERSION=${version}|" .env
compose() { docker compose --env-file .env "$@"; }

say "Building the hub ${version} (a few minutes on a small PC)"
compose build migrate
say "Starting MySQL, migrations and the hub"
compose up -d hub

port="$(grep -E '^HUB_PORT=' .env | cut -d= -f2)"
port="${port:-4100}"
say "Waiting for the hub to pair with the cloud"
paired=false
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null | grep -q '"database":"ok"'; then
    paired=true
    break
  fi
  sleep 3
done
if [[ "$paired" != true ]]; then
  compose logs --tail=30 hub >&2
  fail "The hub is not paired. Check the cloud URL and create a new pairing code (it is valid 15 minutes); then delete deploy/hub/.env and run this script again."
fi

# The code was single-use: it does not stay in the file.
sed -i "s|^HUB_PAIRING_CODE=.*|HUB_PAIRING_CODE=|" .env

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "The hub ${version} is running and paired"
cat <<INFO

  LAN address:  http://${ip:-<this PC>}:${port}
  Health:       curl http://127.0.0.1:${port}/health
  Logs:         docker compose -f $(pwd)/docker-compose.yml logs -f hub
  Update:       git pull && sudo deploy/hub/install-hub.sh

  Give this PC a fixed IP in the router (DHCP reservation) and keep it always on.
INFO
