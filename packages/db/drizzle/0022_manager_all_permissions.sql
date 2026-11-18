-- The manager has every permission, like the administrator (DEC-050). New organizations get it
-- from DEFAULT_ROLE_PERMISSIONS; this gives the missing ones to the existing manager roles once.
-- A row that already exists for the role (even soft-deleted by the owner) is left as it is.
INSERT IGNORE INTO `role_permissions` (`id`, `organization_id`, `role_id`, `permission`)
SELECT UUID_TO_BIN(UUID()), r.`organization_id`, r.`id`, p.`permission`
FROM `roles` r
CROSS JOIN (
  SELECT 'catalog.manage' AS `permission`
  UNION ALL SELECT 'catalog.price_change'
  UNION ALL SELECT 'tax.manage'
  UNION ALL SELECT 'location.manage'
  UNION ALL SELECT 'user.manage'
  UNION ALL SELECT 'customer.anonymize'
  UNION ALL SELECT 'support.grant_access'
) p
WHERE r.`key` = 'manager' AND r.`deleted_at` IS NULL;
