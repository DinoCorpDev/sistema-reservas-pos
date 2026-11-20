-- Inventory (DEC-051): the administrator and the manager of the existing organizations get the
-- new permission once; new organizations get it from DEFAULT_ROLE_PERMISSIONS. A row that already
-- exists for the role (even soft-deleted by the owner) is left as it is.
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UUID_TO_BIN(UUID()), r.`organization_id`, r.`id`, 'inventory.manage'
FROM `roles` r
WHERE r.`key` IN ('admin', 'manager') AND r.`deleted_at` IS NULL;
