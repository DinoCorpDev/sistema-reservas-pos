ALTER TABLE `audit_events` ADD `support_staff_id` binary(16);--> statement-breakpoint
CREATE INDEX `idx_audit_events_terminal` ON `audit_events` (`organization_id`,`terminal_id`,`occurred_at`);