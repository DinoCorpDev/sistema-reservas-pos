CREATE TABLE `terminal_presence` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`unlocked` boolean NOT NULL,
	`user_id` binary(16),
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `terminal_presence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD `fallback_station_id` binary(16);--> statement-breakpoint
CREATE INDEX `idx_terminal_presence_location` ON `terminal_presence` (`location_id`,`last_seen_at`);--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD CONSTRAINT `kitchen_stations_fallback_station_id_kitchen_stations_id_fk` FOREIGN KEY (`fallback_station_id`) REFERENCES `kitchen_stations`(`id`) ON DELETE no action ON UPDATE no action;