CREATE TABLE `api_keys` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`key_prefix` varchar(24) NOT NULL,
	`key_hash` char(64) NOT NULL,
	`scopes` json NOT NULL,
	`created_by_user_id` binary(16),
	`last_used_at` datetime(3),
	`expires_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_api_keys_hash` UNIQUE(`key_hash`),
	CONSTRAINT `uq_api_keys_prefix` UNIQUE(`key_prefix`)
);
--> statement-breakpoint
CREATE TABLE `platform_staff` (
	`id` binary(16) NOT NULL,
	`email` varchar(254) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`totp_secret` varchar(64),
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `platform_staff_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_platform_staff_email` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `support_access_grants` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`granted_by_user_id` binary(16) NOT NULL,
	`staff_id` binary(16),
	`reason` text,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `support_access_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `organizations` ADD `pin_key` char(64);--> statement-breakpoint
ALTER TABLE `terminals` ADD `pairing_code_hash` char(64);--> statement-breakpoint
ALTER TABLE `terminals` ADD `pairing_expires_at` datetime(3);--> statement-breakpoint
ALTER TABLE `terminals` ADD `device_token_hash` char(64);--> statement-breakpoint
ALTER TABLE `terminals` ADD `paired_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `pin_lookup` char(64);--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `uq_terminals_pairing_code` UNIQUE(`pairing_code_hash`);--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `uq_terminals_device_token` UNIQUE(`device_token_hash`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `uq_users_org_pin_lookup` UNIQUE(`organization_id`,`pin_lookup`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_access_grants` ADD CONSTRAINT `support_access_grants_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_access_grants` ADD CONSTRAINT `support_access_grants_granted_by_user_id_users_id_fk` FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `support_access_grants` ADD CONSTRAINT `support_access_grants_staff_id_platform_staff_id_fk` FOREIGN KEY (`staff_id`) REFERENCES `platform_staff`(`id`) ON DELETE no action ON UPDATE no action;