-- Custom SQL migration file, put your code below! --
-- The starting catalog of plans and add-ons (DEC-045, @pos/core DEFAULT_PLANS/DEFAULT_ADDONS):
-- an example DINOLABS edits in /support. Prices are left for DINOLABS to set per country.
INSERT INTO `plans` (`id`, `code`, `name`, `limits`, `features`, `is_active`, `sort_order`) VALUES
  (UUID_TO_BIN(UUID()), 'cafe', 'Café', '{"devices":2,"users":5,"locations":1}', '[]', true, 1),
  (UUID_TO_BIN(UUID()), 'restaurant', 'Restaurant', '{"devices":8,"users":25,"locations":1}', '["kds","handhelds","phones","table_ownership"]', true, 2),
  (UUID_TO_BIN(UUID()), 'pro', 'Pro', '{"devices":null,"users":null,"locations":null}', '["kds","handhelds","phones","table_ownership","api","multi_location"]', true, 3);
--> statement-breakpoint
INSERT INTO `plan_addons` (`id`, `code`, `name`, `adds`, `features`, `is_active`) VALUES
  (UUID_TO_BIN(UUID()), 'extra_device', 'Extra device', '{"devices":1}', '[]', true),
  (UUID_TO_BIN(UUID()), 'extra_user', 'Extra user', '{"users":1}', '[]', true),
  (UUID_TO_BIN(UUID()), 'extra_location', 'Extra location', '{"locations":1}', '["multi_location"]', true),
  (UUID_TO_BIN(UUID()), 'kitchen_display', 'Kitchen displays', '{}', '["kds"]', true),
  (UUID_TO_BIN(UUID()), 'api_access', 'API access', '{}', '["api"]', true);
--> statement-breakpoint
-- Organizations from before plans keep everything they had: Pro.
INSERT INTO `subscriptions` (`id`, `organization_id`, `plan_code`, `status`, `status_since`)
SELECT UUID_TO_BIN(UUID()), `id`, 'pro', 'active', UTC_TIMESTAMP(3)
FROM `organizations`
WHERE `deleted_at` IS NULL;
