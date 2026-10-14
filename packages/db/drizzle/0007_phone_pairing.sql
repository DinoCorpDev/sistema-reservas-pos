CREATE TABLE `phone_pairing_codes` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`issued_by_terminal_id` binary(16),
	`issued_by_user_id` binary(16),
	`failed_attempts` smallint NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `phone_pairing_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_phone_pairing_codes_code` UNIQUE(`code_hash`)
);
--> statement-breakpoint
ALTER TABLE `terminals` ADD `user_id` binary(16);--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `uq_terminals_location_user` UNIQUE(`location_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `phone_pairing_codes` ADD CONSTRAINT `phone_pairing_codes_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `phone_pairing_codes` ADD CONSTRAINT `phone_pairing_codes_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `phone_pairing_codes` ADD CONSTRAINT `phone_pairing_codes_issued_by_terminal_id_terminals_id_fk` FOREIGN KEY (`issued_by_terminal_id`) REFERENCES `terminals`(`id`) ON DELETE no action ON UPDATE no action;