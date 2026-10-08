CREATE TABLE `print_jobs` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`job_key` varchar(120) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`source_operation_id` binary(16),
	`printer_id` binary(16) NOT NULL,
	`kitchen_station_id` binary(16),
	`document` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` varchar(255),
	`requested_at` datetime(3) NOT NULL,
	`next_attempt_at` datetime(3) NOT NULL,
	`printed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `print_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_print_jobs_key` UNIQUE(`location_id`,`job_key`)
);
--> statement-breakpoint
CREATE TABLE `printer_status` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`last_ok_at` datetime(3),
	`last_error` varchar(255),
	`last_error_at` datetime(3),
	`last_test_at` datetime(3),
	`last_test_ok` boolean,
	`reported_at` datetime(3) NOT NULL,
	CONSTRAINT `printer_status_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `kitchen_ticket_items` ADD `preparing_at` datetime(3);--> statement-breakpoint
ALTER TABLE `kitchen_ticket_items` ADD `ready_at` datetime(3);--> statement-breakpoint
ALTER TABLE `printers` ADD `test_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `kitchen_ticket_items` ADD CONSTRAINT `uq_kitchen_ticket_items_item` UNIQUE(`kitchen_ticket_id`,`order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_print_jobs_pending` ON `print_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_printer_status_location` ON `printer_status` (`location_id`);