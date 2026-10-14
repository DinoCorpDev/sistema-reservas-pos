-- Waiters open and close their own wallet when the location collects cash per person (DEC-038).
-- New organizations get it from DEFAULT_ROLE_PERMISSIONS; this gives it to the existing waiter
-- roles once; a row that already exists for the role (even soft-deleted) is left as it is.
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UUID_TO_BIN(UUID()), r.`organization_id`, r.`id`, p.`permission`
FROM `roles` r
CROSS JOIN (SELECT 'shift.open' AS `permission` UNION ALL SELECT 'shift.close') p
WHERE r.`key` = 'waiter' AND r.`deleted_at` IS NULL;
