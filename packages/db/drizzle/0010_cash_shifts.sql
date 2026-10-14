ALTER TABLE `cash_movements` ADD `business_date` date;--> statement-breakpoint
ALTER TABLE `cash_movements` ADD `terminal_id` binary(16);--> statement-breakpoint
ALTER TABLE `shifts` ADD `scope` varchar(16) DEFAULT 'terminal' NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `opening_count` json;--> statement-breakpoint
ALTER TABLE `shifts` ADD `report` json;--> statement-breakpoint
ALTER TABLE `payments` ADD `business_date` date;--> statement-breakpoint
ALTER TABLE `refunds` ADD `business_date` date;--> statement-breakpoint
ALTER TABLE `refunds` ADD `terminal_id` binary(16);--> statement-breakpoint
ALTER TABLE `refunds` ADD `rounding_rappen` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_operations` ADD `shift_id` binary(16);--> statement-breakpoint
CREATE INDEX `idx_cash_movements_day` ON `cash_movements` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_shifts_day` ON `shifts` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_payments_day` ON `payments` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_refunds_shift` ON `refunds` (`shift_id`);--> statement-breakpoint
CREATE INDEX `idx_refunds_day` ON `refunds` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_sync_operations_shift` ON `sync_operations` (`location_id`,`shift_id`);