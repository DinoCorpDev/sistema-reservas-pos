CREATE TABLE `order_number_claims` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`business_date` date NOT NULL,
	`order_number` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `order_number_claims_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `joined_table_ids` json;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `seq` bigint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `user_id` binary(16);--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `schema_version` smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `hlc` varchar(18) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `related_entity_id` binary(16);--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `cloud_acked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `sync_operations` ADD CONSTRAINT `uq_sync_operations_seq` UNIQUE(`location_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_sync_operations_entity` ON `sync_operations` (`location_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_operations_related` ON `sync_operations` (`location_id`,`related_entity_id`);