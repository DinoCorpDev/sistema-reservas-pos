CREATE TABLE `platform_job_runs` (
	`id` binary(16) NOT NULL,
	`job` varchar(32) NOT NULL,
	`ok` boolean NOT NULL,
	`detail` text,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `platform_job_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_platform_job_runs_job` ON `platform_job_runs` (`job`,`finished_at`);