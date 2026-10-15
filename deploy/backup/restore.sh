#!/usr/bin/env bash
#
# Restores a backup into a database (RNF-14: RTO 4 h). By default the latest hourly snapshot into
# `pos_restore` — never over the live database by accident:
#   docker compose -f deploy/docker-compose.prod.yml run --rm backup restore.sh [snapshot] [database]
# To bring production back, stop web and worker, restore into pos_cloud explicitly, start again
# (docs/OPERACIONES.md, "Restaurar").
set -euo pipefail
source /usr/local/bin/lib.sh

snapshot="${1:-latest}"
target="${2:-pos_restore}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

log info "restoring snapshot ${snapshot} into ${target}"
restic restore "$snapshot" --tag hourly --host pos-cloud --target "$tmp" >/dev/null
dump="$(find "$tmp" -name 'pos_cloud.sql.gz' | head -n 1)"
[[ -n "$dump" ]] || { log error "no dump in snapshot ${snapshot}"; exit 1; }

sql -e "DROP DATABASE IF EXISTS \`${target}\`; CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
gunzip -c "$dump" | mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" "$target"
log info "restored into ${target}"
