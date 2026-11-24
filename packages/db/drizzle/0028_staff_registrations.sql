CREATE TABLE `staff_invites` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`role_key` varchar(32) NOT NULL DEFAULT 'waiter',
	`expires_at` datetime(3) NOT NULL,
	`max_uses` smallint NOT NULL DEFAULT 10,
	`uses` smallint NOT NULL DEFAULT 0,
	`failed_attempts` smallint NOT NULL DEFAULT 0,
	`created_by_user_id` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `staff_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_staff_invites_code` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `staff_registrations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`invite_id` binary(16) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`ui_language` char(2) NOT NULL DEFAULT 'de',
	`pin_hash` varchar(255) NOT NULL,
	`pin_lookup` char(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`decided_by_user_id` binary(16),
	`decided_at` datetime(3),
	`user_id` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `staff_registrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `staff_invites` ADD CONSTRAINT `staff_invites_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_invites` ADD CONSTRAINT `staff_invites_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_registrations` ADD CONSTRAINT `staff_registrations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_registrations` ADD CONSTRAINT `staff_registrations_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_registrations` ADD CONSTRAINT `staff_registrations_invite_id_staff_invites_id_fk` FOREIGN KEY (`invite_id`) REFERENCES `staff_invites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_registrations` ADD CONSTRAINT `staff_registrations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_staff_registrations_status` ON `staff_registrations` (`location_id`,`status`);