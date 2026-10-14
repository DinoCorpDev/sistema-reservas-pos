-- Tables and their waiter (DEC-039). New organizations get these from DEFAULT_ROLE_PERMISSIONS;
-- the existing roles get them once: working on any table for the till, managers and admins,
-- and handing a table to another waiter for managers and admins. A row that already exists for
-- the role (even soft-deleted) is left as it is.
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UUID_TO_BIN(UUID()), r.`organization_id`, r.`id`, 'order.any_table'
FROM `roles` r
WHERE r.`key` IN ('admin', 'manager', 'cashier') AND r.`deleted_at` IS NULL;
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UUID_TO_BIN(UUID()), r.`organization_id`, r.`id`, 'order.reassign'
FROM `roles` r
WHERE r.`key` IN ('admin', 'manager') AND r.`deleted_at` IS NULL;
