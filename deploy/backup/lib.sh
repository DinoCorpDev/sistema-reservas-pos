#!/usr/bin/env bash
# Shared by the backup scripts. MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER and MYSQL_PWD come from
# the compose file; RESTIC_* and AWS_* from deploy/.env.

log() { printf '{"time":"%s","level":"%s","service":"backup","msg":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2"; }

sql() { mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -N -B "$@"; }

# Leaves one row in platform_job_runs: the monitor alerts on a failure or an old success.
record_run() {
  local job="$1" ok="$2" started="$3" detail="${4//\'/\'\'}"
  sql "$MYSQL_DATABASE" -e "INSERT INTO platform_job_runs (id, job, ok, detail, started_at, finished_at)
    VALUES (UUID_TO_BIN(UUID()), '${job}', ${ok}, '${detail:0:1000}', '${started}', UTC_TIMESTAMP(3));" \
    || log error "could not record the ${job} run"
}

now_utc() { date -u '+%F %T'; }

# The repository is created on first use (restic needs RESTIC_REPOSITORY and RESTIC_PASSWORD).
ensure_repository() { restic cat config >/dev/null 2>&1 || restic init; }
