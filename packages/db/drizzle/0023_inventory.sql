CREATE TABLE `ingredients` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`unit` varchar(8) NOT NULL,
	`low_stock_threshold` int,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `ingredients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`owner_type` varchar(16) NOT NULL,
	`owner_id` binary(16) NOT NULL,
	`ingredient_id` binary(16) NOT NULL,
	`quantity` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `recipe_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_recipe_lines` UNIQUE(`owner_type`,`owner_id`,`ingredient_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_consumptions` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`order_item_id` binary(16) NOT NULL,
	`ingredient_id` binary(16) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`per_unit` int NOT NULL,
	`quantity` int NOT NULL,
	`business_date` date,
	`occurred_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `stock_consumptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_consumptions_item` UNIQUE(`order_item_id`,`ingredient_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`ingredient_id` binary(16) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`quantity` int NOT NULL,
	`counted_quantity` int,
	`note` varchar(200),
	`user_id` binary(16) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ingredients` ADD CONSTRAINT `ingredients_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_lines` ADD CONSTRAINT `recipe_lines_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recipe_lines` ADD CONSTRAINT `recipe_lines_ingredient_id_ingredients_id_fk` FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_consumptions_ingredient` ON `stock_consumptions` (`location_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_ingredient` ON `stock_movements` (`location_id`,`ingredient_id`);