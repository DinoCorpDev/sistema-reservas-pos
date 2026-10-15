CREATE TABLE `platform_alerts` (
	`id` binary(16) NOT NULL,
	`key` varchar(120) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`severity` varchar(16) NOT NULL,
	`organization_id` binary(16),
	`location_id` binary(16),
	`subject` varchar(255) NOT NULL,
	`detail` text,
	`since` datetime(3) NOT NULL,
	`opened_at` datetime(3) NOT NULL,
	`notified_at` datetime(3),
	`resolved_at` datetime(3),
	`resolved_notified_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `platform_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_platform_alerts_open` ON `platform_alerts` (`resolved_at`,`key`);