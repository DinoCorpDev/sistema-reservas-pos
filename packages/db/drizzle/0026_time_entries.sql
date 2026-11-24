CREATE TABLE `time_entries` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`clock_in_at` datetime(3),
	`clock_out_at` datetime(3),
	`clock_in_terminal_id` binary(16),
	`clock_out_terminal_id` binary(16),
	`corrected_by_user_id` binary(16),
	`corrected_at` datetime(3),
	`note` varchar(200),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `time_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_location_in` ON `time_entries` (`location_id`,`clock_in_at`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_user` ON `time_entries` (`organization_id`,`user_id`,`clock_in_at`);