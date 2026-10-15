CREATE TABLE `plan_addons` (
	`id` binary(16) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(64) NOT NULL,
	`adds` json NOT NULL,
	`features` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `plan_addons_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plan_addons_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `plan_prices` (
	`id` binary(16) NOT NULL,
	`item_type` varchar(8) NOT NULL,
	`item_code` varchar(32) NOT NULL,
	`country` char(2) NOT NULL,
	`currency` char(3) NOT NULL,
	`amount_minor` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `plan_prices_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plan_prices_item` UNIQUE(`item_type`,`item_code`,`country`,`currency`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` binary(16) NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(64) NOT NULL,
	`limits` json NOT NULL,
	`features` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` smallint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_plans_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `subscription_addons` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`addon_code` varchar(32) NOT NULL,
	`quantity` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `subscription_addons_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_subscription_addons` UNIQUE(`organization_id`,`addon_code`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`plan_code` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`status_since` datetime(3) NOT NULL,
	`note` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_subscriptions_organization` UNIQUE(`organization_id`)
);
--> statement-breakpoint
ALTER TABLE `subscription_addons` ADD CONSTRAINT `subscription_addons_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;