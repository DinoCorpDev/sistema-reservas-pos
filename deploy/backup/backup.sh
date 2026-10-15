#!/usr/bin/env bash
#
# Hourly backup of the cloud database (RNF-14: RPO 1 h, 30 days) and the legal archive
# (RNF-15, RF-F13: 10 years), encrypted with restic to a bucket in Switzerland (RNF-13).
#   - every hour at BACKUP_MINUTE: a consistent mysqldump, tag `hourly`;
#     kept 48 hourly, 30 daily and 12 monthly snapshots;
#   - the monthly legal archive (JSON of receipts, closings, cash books and audit, written by the
#     worker to /archive), tag `legal`, never forgotten;
#   - on RESTORE_TEST_DAY of each month, the restore test (restore-test.sh).
set -uo pipefail
source /usr/local/bin/lib.sh

BACKUP_MINUTE="${BACKUP_MINUTE:-17}"
RESTORE_TEST_DAY="${RESTORE_TEST_DAY:-1}"

backup_once() {
  local started tmp
  started="$(now_utc)"
  tmp="$(mktemp -d)"
  if ! ensure_repository; then
    record_run backup 0 "$started" "restic repository not reachable"
    return 1
  fi
  if mysqldump -h "$MYSQL_HOST" -u "$MYSQL_USER" --single-transaction --routines --triggers \
       --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE" | gzip -6 >"$tmp/pos_cloud.sql.gz" \
     && restic backup --tag hourly --host pos-cloud "$tmp/pos_cloud.sql.gz" >/dev/null; then
    restic forget --tag hourly --host pos-cloud --keep-hourly 48 --keep-daily 30 --keep-monthly 12 \
      --prune >/dev/null || log warn "forget/prune failed; retried next hour"
    if [[ -d /archive ]] && [[ -n "$(ls -A /archive 2>/dev/null)" ]]; then
      restic backup --tag legal --host pos-cloud /archive >/dev/null \
        || log warn "legal archive backup failed; retried next hour"
    fi
    record_run backup 1 "$started" "$(du -h "$tmp/pos_cloud.sql.gz" | cut -f1)"
    log info "backup done"
  else
    record_run backup 0 "$started" "mysqldump or restic backup failed"
    log error "backup failed"
  fi
  rm -rf "$tmp"
}

log info "backup loop started (minute ${BACKUP_MINUTE}, restore test on day ${RESTORE_TEST_DAY})"
last_hour=""
last_test=""
while true; do
  hour="$(date -u +%F-%H)"
  minute="$((10#$(date -u +%M)))"
  if [[ "$hour" != "$last_hour" && "$minute" -ge "$BACKUP_MINUTE" ]]; then
    last_hour="$hour"
    backup_once
    month="$(date -u +%Y-%m)"
    if [[ "$((10#$(date -u +%d)))" -eq "$RESTORE_TEST_DAY" && "$month" != "$last_test" ]]; then
      last_test="$month"
      restore-test.sh || true
    fi
  fi
  sleep 30
done
