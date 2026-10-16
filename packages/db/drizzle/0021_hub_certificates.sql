CREATE TABLE `hub_certificates` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`hostname` varchar(253) NOT NULL,
	`lan_ip` varchar(45) NOT NULL,
	`csr_pem` text NOT NULL,
	`status` varchar(16) NOT NULL,
	`certificate_pem` text,
	`not_after` datetime(3),
	`issued_at` datetime(3),
	`failures` int NOT NULL DEFAULT 0,
	`last_error` varchar(500),
	`next_attempt_at` datetime(3),
	`requested_at` datetime(3) NOT NULL,
	CONSTRAINT `hub_certificates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_hub_certificates_status` ON `hub_certificates` (`status`,`next_attempt_at`);