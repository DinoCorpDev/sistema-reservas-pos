CREATE TABLE `approval_uses` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `approval_uses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_approval_uses_expires` ON `approval_uses` (`expires_at`);