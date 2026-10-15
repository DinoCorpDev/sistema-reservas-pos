#!/usr/bin/env bash
#
# Monthly restore test (RNF-14: "prueba de restauración mensual"): the latest backup is restored
# into `pos_restore_check` and compared with the live database. A backup that cannot be restored
# is not a backup. The result is a row in platform_job_runs; the monitor alerts on a failure.
#   - the restore works and every table of the schema is there;
#   - the Z closings and receipts of the backup are exactly those of the live database up to the
#     time of the dump (same ids and the same content hashes: nothing lost, nothing altered).
set -uo pipefail
source /usr/local/bin/lib.sh

started="$(now_utc)"
check="pos_restore_check"

if ! restore.sh latest "$check"; then
  record_run restore_test 0 "$started" "restore failed"
  exit 1
fi

fingerprint() {
  local db="$1" table="$2" until="$3"
  sql "$db" -e "SELECT CONCAT(COUNT(*), ':', COALESCE(SHA2(GROUP_CONCAT(CONCAT(HEX(id), content_hash)
    ORDER BY id SEPARATOR ','), 256), '-')) FROM \`${table}\` WHERE created_at <= '${until}';"
}

# The backup's own last moment: the newest closing or receipt it holds.
until="$(sql "$check" -e "SELECT COALESCE(GREATEST(
  COALESCE((SELECT MAX(created_at) FROM daily_closings), '1970-01-01'),
  COALESCE((SELECT MAX(created_at) FROM receipts), '1970-01-01')), '1970-01-01');")"

tables_live="$(sql information_schema -e "SELECT COUNT(*) FROM tables WHERE table_schema='${MYSQL_DATABASE}';")"
tables_check="$(sql information_schema -e "SELECT COUNT(*) FROM tables WHERE table_schema='${check}';")"

problems=""
[[ "$tables_live" == "$tables_check" ]] || problems+="tables ${tables_check}/${tables_live}; "
for table in daily_closings receipts; do
  live="$(fingerprint "$MYSQL_DATABASE" "$table" "$until")"
  restored="$(fingerprint "$check" "$table" "$until")"
  [[ "$live" == "$restored" ]] || problems+="${table} differ; "
done

sql -e "DROP DATABASE IF EXISTS \`${check}\`;"
if [[ -z "$problems" ]]; then
  record_run restore_test 1 "$started" "tables ${tables_check}, data up to ${until}"
  log info "restore test passed"
else
  record_run restore_test 0 "$started" "$problems"
  log error "restore test failed: ${problems}"
  exit 1
fi
