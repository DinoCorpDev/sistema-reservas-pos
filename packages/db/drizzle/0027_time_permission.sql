-- Working time (DEC-054): the administrator and the manager of the existing organizations get the
-- new permission once; new organizations get it from DEFAULT_ROLE_PERMISSIONS. A row that already
-- exists for the role (even soft-deleted by the owner) is left as it is. UNHEX(REPLACE(UUID()))
-- instead of UUID_TO_BIN so it runs the same on MySQL 8 and MariaDB (DEC-052).
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UNHEX(REPLACE(UUID(), '-', '')), r.`organization_id`, r.`id`, 'time.manage'
FROM `roles` r
WHERE r.`key` IN ('admin', 'manager') AND r.`deleted_at` IS NULL;
