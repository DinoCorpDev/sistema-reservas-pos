CREATE TABLE `cash_movements` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`shift_id` binary(16),
	`kind` varchar(16) NOT NULL,
	`amount_rappen` int NOT NULL DEFAULT 0,
	`reason` text NOT NULL,
	`attachment_url` varchar(500),
	`user_id` binary(16) NOT NULL,
	`daily_closing_id` binary(16),
	`occurred_at` datetime(3) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `cash_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_closings` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`business_date` date NOT NULL,
	`closing_number` int NOT NULL,
	`totals` json NOT NULL,
	`content_hash` char(64) NOT NULL,
	`closed_by_user_id` binary(16) NOT NULL,
	`closed_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `daily_closings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_daily_closings_location_day` UNIQUE(`location_id`,`business_date`),
	CONSTRAINT `uq_daily_closings_location_number` UNIQUE(`location_id`,`closing_number`)
);
--> statement-breakpoint
CREATE TABLE `order_number_sequences` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`business_date` date NOT NULL,
	`prefix` varchar(4) NOT NULL DEFAULT '',
	`last_number` int NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `order_number_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_order_number_sequences` UNIQUE(`location_id`,`business_date`,`prefix`)
);
--> statement-breakpoint
CREATE TABLE `payment_reconciliations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`business_date` date NOT NULL,
	`shift_id` binary(16),
	`method` varchar(16) NOT NULL,
	`pos_total_rappen` int NOT NULL DEFAULT 0,
	`terminal_total_rappen` int NOT NULL DEFAULT 0,
	`difference_rappen` int NOT NULL DEFAULT 0,
	`reason` text,
	`user_id` binary(16) NOT NULL,
	`reconciled_at` datetime(3) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `payment_reconciliations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`terminal_id` binary(16),
	`cashier_user_id` binary(16),
	`business_date` date NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`opened_at` datetime(3) NOT NULL,
	`opened_by_user_id` binary(16) NOT NULL,
	`opening_float_rappen` int NOT NULL DEFAULT 0,
	`closed_at` datetime(3),
	`closed_by_user_id` binary(16),
	`expected_cash_rappen` int,
	`counted_cash_rappen` int,
	`difference_rappen` int,
	`count_by_denomination` json,
	`difference_comment` text,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `availability_rules` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`product_id` binary(16),
	`category_id` binary(16),
	`channel` varchar(16),
	`days_of_week` tinyint NOT NULL DEFAULT 127,
	`start_time` time,
	`end_time` time,
	`valid_from` date,
	`valid_to` date,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `availability_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`parent_id` binary(16),
	`name` varchar(150) NOT NULL,
	`description` text,
	`image_url` varchar(500),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `channel_prices` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`product_id` binary(16) NOT NULL,
	`variant_id` binary(16),
	`channel` varchar(16) NOT NULL,
	`price_rappen` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `channel_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifier_allergens` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`modifier_id` binary(16) NOT NULL,
	`allergen` varchar(16) NOT NULL,
	`presence` varchar(16) NOT NULL DEFAULT 'contains',
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `modifier_allergens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_modifier_allergens` UNIQUE(`modifier_id`,`allergen`)
);
--> statement-breakpoint
CREATE TABLE `modifier_groups` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`min_select` smallint NOT NULL DEFAULT 0,
	`max_select` smallint NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `modifier_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `modifiers` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`modifier_group_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`price_delta_rappen` int NOT NULL DEFAULT 0,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `modifiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_allergens` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`allergen` varchar(16) NOT NULL,
	`presence` varchar(16) NOT NULL DEFAULT 'contains',
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_allergens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_allergens` UNIQUE(`product_id`,`allergen`)
);
--> statement-breakpoint
CREATE TABLE `product_location_settings` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`price_rappen` int,
	`sold_out_at` datetime(3),
	`sold_out_by_user_id` binary(16),
	`sold_out_until` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_location_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_location_settings` UNIQUE(`location_id`,`product_id`)
);
--> statement-breakpoint
CREATE TABLE `product_modifier_groups` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`modifier_group_id` binary(16) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_modifier_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_modifier_groups` UNIQUE(`product_id`,`modifier_group_id`)
);
--> statement-breakpoint
CREATE TABLE `product_origins` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`species` varchar(64),
	`country` char(2) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_origins_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_station_routes` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`kitchen_station_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_station_routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_product_station_routes` UNIQUE(`location_id`,`product_id`,`kitchen_station_id`)
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`price_rappen` int NOT NULL DEFAULT 0,
	`is_default` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `product_variants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`category_id` binary(16) NOT NULL,
	`tax_category_id` binary(16) NOT NULL,
	`sku` varchar(64),
	`name` varchar(150) NOT NULL,
	`description` text,
	`base_price_rappen` int NOT NULL DEFAULT 0,
	`default_course` smallint NOT NULL DEFAULT 1,
	`image_url` varchar(500),
	`requires_origin` boolean NOT NULL DEFAULT false,
	`allergens_complete` boolean NOT NULL DEFAULT false,
	`publish_qr` boolean NOT NULL DEFAULT true,
	`publish_web` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `translations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`entity_type` varchar(32) NOT NULL,
	`entity_id` binary(16) NOT NULL,
	`language` char(2) NOT NULL,
	`field` varchar(16) NOT NULL,
	`value` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_translations` UNIQUE(`entity_type`,`entity_id`,`language`,`field`)
);
--> statement-breakpoint
CREATE TABLE `consents` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`customer_id` binary(16) NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`source` varchar(16) NOT NULL,
	`text_version` varchar(32) NOT NULL,
	`text_snapshot` text NOT NULL,
	`granted_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`recorded_by_user_id` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`first_name` varchar(100),
	`last_name` varchar(100),
	`phone` varchar(20),
	`email` varchar(254),
	`language` char(2),
	`notes` text,
	`declared_allergies` text,
	`tags` json,
	`anonymized_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customers_org_phone` UNIQUE(`organization_id`,`phone`),
	CONSTRAINT `uq_customers_org_email` UNIQUE(`organization_id`,`email`)
);
--> statement-breakpoint
CREATE TABLE `kitchen_ticket_items` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`kitchen_ticket_id` binary(16) NOT NULL,
	`order_item_id` binary(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'sent',
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `kitchen_ticket_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kitchen_tickets` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`kitchen_station_id` binary(16) NOT NULL,
	`course` smallint,
	`status` varchar(16) NOT NULL DEFAULT 'sent',
	`language` char(2) NOT NULL,
	`sent_at` datetime(3) NOT NULL,
	`preparing_at` datetime(3),
	`ready_at` datetime(3),
	`served_at` datetime(3),
	`voided_at` datetime(3),
	`printed_at` datetime(3),
	`print_count` int NOT NULL DEFAULT 0,
	`sent_by_user_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `kitchen_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discounts` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`order_item_id` binary(16),
	`kind` varchar(16) NOT NULL,
	`value` int NOT NULL,
	`amount_rappen` int NOT NULL DEFAULT 0,
	`reason_code` varchar(32) NOT NULL,
	`reason_text` text,
	`applied_by_user_id` binary(16) NOT NULL,
	`authorized_by_user_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `discounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_item_modifiers` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_item_id` binary(16) NOT NULL,
	`modifier_id` binary(16) NOT NULL,
	`name_snapshot` varchar(100) NOT NULL,
	`price_delta_rappen` int NOT NULL DEFAULT 0,
	`quantity` smallint NOT NULL DEFAULT 1,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `order_item_modifiers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`product_id` binary(16) NOT NULL,
	`variant_id` binary(16),
	`name_snapshot` varchar(200) NOT NULL,
	`variant_name_snapshot` varchar(100),
	`quantity` smallint NOT NULL DEFAULT 1,
	`unit_price_rappen` int NOT NULL DEFAULT 0,
	`modifiers_rappen` int NOT NULL DEFAULT 0,
	`discount_rappen` int NOT NULL DEFAULT 0,
	`line_total_rappen` int NOT NULL DEFAULT 0,
	`tax_category_key` varchar(32) NOT NULL,
	`tax_rate_code` varchar(16) NOT NULL,
	`tax_rate_bp` int NOT NULL,
	`tax_rappen` int NOT NULL DEFAULT 0,
	`course` smallint NOT NULL DEFAULT 1,
	`seat` smallint,
	`note` text,
	`prep_status` varchar(16) NOT NULL DEFAULT 'pending',
	`sent_at` datetime(3),
	`preparing_at` datetime(3),
	`ready_at` datetime(3),
	`served_at` datetime(3),
	`voided_at` datetime(3),
	`void_reason` text,
	`voided_by_user_id` binary(16),
	`void_authorized_by_user_id` binary(16),
	`added_by_user_id` binary(16),
	`transferred_from_order_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`terminal_id` binary(16),
	`business_date` date NOT NULL,
	`order_number` int NOT NULL,
	`order_number_prefix` varchar(4) NOT NULL DEFAULT '',
	`display_number` varchar(12) NOT NULL,
	`channel` varchar(16) NOT NULL,
	`consumption_type` varchar(16) NOT NULL,
	`table_id` binary(16),
	`visit_id` binary(16),
	`customer_id` binary(16),
	`waiter_user_id` binary(16),
	`guest_count` smallint,
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`payment_status` varchar(16) NOT NULL DEFAULT 'unpaid',
	`pickup_at` datetime(3),
	`customer_name` varchar(200),
	`note` text,
	`subtotal_rappen` int NOT NULL DEFAULT 0,
	`discount_total_rappen` int NOT NULL DEFAULT 0,
	`total_rappen` int NOT NULL DEFAULT 0,
	`tax_total_rappen` int NOT NULL DEFAULT 0,
	`paid_total_rappen` int NOT NULL DEFAULT 0,
	`tip_total_rappen` int NOT NULL DEFAULT 0,
	`opened_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	`voided_at` datetime(3),
	`void_reason` text,
	`reopened_at` datetime(3),
	`merged_into_order_id` binary(16),
	`split_from_order_id` binary(16),
	`created_by_user_id` binary(16),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_orders_location_day_number` UNIQUE(`location_id`,`business_date`,`display_number`)
);
--> statement-breakpoint
CREATE TABLE `areas` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`qr_mode` varchar(16) NOT NULL DEFAULT 'view',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `areas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`area_id` binary(16) NOT NULL,
	`label` varchar(16) NOT NULL,
	`qr_code` varchar(32) NOT NULL,
	`capacity` smallint NOT NULL DEFAULT 4,
	`shape` varchar(16) NOT NULL DEFAULT 'rect',
	`pos_x` int NOT NULL DEFAULT 0,
	`pos_y` int NOT NULL DEFAULT 0,
	`width` int NOT NULL DEFAULT 1,
	`height` int NOT NULL DEFAULT 1,
	`qr_mode` varchar(16),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `dining_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dining_tables_location_label` UNIQUE(`location_id`,`label`),
	CONSTRAINT `uq_dining_tables_qr_code` UNIQUE(`qr_code`)
);
--> statement-breakpoint
CREATE TABLE `kitchen_stations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`alert_after_minutes` smallint,
	`language` char(2),
	`printer_id` binary(16),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `kitchen_stations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`name` varchar(200) NOT NULL,
	`legal_name` varchar(200) NOT NULL,
	`street` varchar(200) NOT NULL,
	`postal_code` varchar(10) NOT NULL,
	`city` varchar(100) NOT NULL,
	`canton` char(2),
	`country` char(2) NOT NULL DEFAULT 'CH',
	`vat_uid` varchar(32),
	`currency` char(3) NOT NULL DEFAULT 'CHF',
	`timezone` varchar(64) NOT NULL DEFAULT 'Europe/Zurich',
	`default_language` char(2) NOT NULL DEFAULT 'de',
	`kitchen_language` char(2) NOT NULL DEFAULT 'de',
	`languages` json NOT NULL,
	`opening_hours` json,
	`phone` varchar(32),
	`email` varchar(254),
	`receipt_header` text,
	`receipt_footer` text,
	`settings` json NOT NULL,
	`setup_completed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_locations_org_name` UNIQUE(`organization_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` binary(16) NOT NULL,
	`name` varchar(200) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`legal_name` varchar(200),
	`default_language` char(2) NOT NULL DEFAULT 'de',
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`is_training` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_organizations_slug` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `printers` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`protocol` varchar(24) NOT NULL DEFAULT 'escpos',
	`host` varchar(255) NOT NULL,
	`port` int NOT NULL DEFAULT 9100,
	`paper_width_mm` smallint NOT NULL DEFAULT 80,
	`has_cash_drawer` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`last_test_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `printers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` varchar(16) NOT NULL,
	`order_number_prefix` varchar(4) NOT NULL,
	`kitchen_station_id` binary(16),
	`receipt_printer_id` binary(16),
	`app_version` varchar(32),
	`last_seen_at` datetime(3),
	`is_active` boolean NOT NULL DEFAULT true,
	`deactivated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `terminals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_terminals_location_prefix` UNIQUE(`location_id`,`order_number_prefix`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`shift_id` binary(16),
	`terminal_id` binary(16),
	`user_id` binary(16) NOT NULL,
	`method` varchar(16) NOT NULL,
	`adapter` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`currency` char(3) NOT NULL DEFAULT 'CHF',
	`amount_rappen` int NOT NULL DEFAULT 0,
	`rounding_rappen` int NOT NULL DEFAULT 0,
	`tip_rappen` int NOT NULL DEFAULT 0,
	`tendered_rappen` int NOT NULL DEFAULT 0,
	`change_rappen` int NOT NULL DEFAULT 0,
	`provider` varchar(32),
	`external_reference` varchar(128),
	`split_label` varchar(32),
	`idempotency_key` varchar(64) NOT NULL,
	`completed_at` datetime(3),
	`failed_at` datetime(3),
	`failure_reason` text,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payments_idempotency` UNIQUE(`organization_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`payment_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`shift_id` binary(16),
	`method` varchar(16) NOT NULL,
	`adapter` varchar(32) NOT NULL,
	`amount_rappen` int NOT NULL DEFAULT 0,
	`tip_rappen` int NOT NULL DEFAULT 0,
	`reason` text NOT NULL,
	`user_id` binary(16) NOT NULL,
	`authorized_by_user_id` binary(16),
	`external_reference` varchar(128),
	`idempotency_key` varchar(64) NOT NULL,
	`refunded_at` datetime(3) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_refunds_idempotency` UNIQUE(`organization_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `tips` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`payment_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`amount_rappen` int NOT NULL DEFAULT 0,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `tips_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(48) NOT NULL,
	`entity_id` binary(16),
	`user_id` binary(16),
	`authorized_by_user_id` binary(16),
	`terminal_id` binary(16),
	`reason` text,
	`before` json,
	`after` json,
	`request_id` varchar(64),
	`occurred_at` datetime(3) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`type` varchar(64) NOT NULL,
	`schema_version` smallint NOT NULL DEFAULT 1,
	`aggregate_type` varchar(48) NOT NULL,
	`aggregate_id` binary(16) NOT NULL,
	`payload` json NOT NULL,
	`user_id` binary(16),
	`terminal_id` binary(16),
	`occurred_at` datetime(3) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sync_operations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`terminal_id` binary(16) NOT NULL,
	`idempotency_key` varchar(64) NOT NULL,
	`operation` varchar(64) NOT NULL,
	`entity_type` varchar(48) NOT NULL,
	`entity_id` binary(16) NOT NULL,
	`payload` json NOT NULL,
	`base_version` int,
	`device_created_at` datetime(3) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`applied_at` datetime(3),
	`status` varchar(16) NOT NULL DEFAULT 'received',
	`conflict` json,
	`resolved_by_user_id` binary(16),
	`resolved_at` datetime(3),
	CONSTRAINT `sync_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sync_operations_idempotency` UNIQUE(`organization_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`order_id` binary(16) NOT NULL,
	`payment_id` binary(16),
	`receipt_number` varchar(32) NOT NULL,
	`copy_number` smallint NOT NULL DEFAULT 0,
	`language` char(2) NOT NULL,
	`content` json NOT NULL,
	`content_hash` char(64) NOT NULL,
	`customer_name` varchar(200),
	`customer_address` text,
	`terminal_id` binary(16),
	`issued_by_user_id` binary(16),
	`issued_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receipts_number_copy` UNIQUE(`location_id`,`receipt_number`,`copy_number`)
);
--> statement-breakpoint
CREATE TABLE `reservation_tables` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`reservation_id` binary(16) NOT NULL,
	`table_id` binary(16) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `reservation_tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reservation_tables` UNIQUE(`reservation_id`,`table_id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`customer_id` binary(16),
	`external_ref` varchar(64),
	`source` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`starts_at` datetime(3) NOT NULL,
	`duration_minutes` smallint NOT NULL DEFAULT 120,
	`party_size` smallint NOT NULL,
	`area_id` binary(16),
	`guest_name` varchar(200),
	`guest_phone` varchar(20),
	`notes` text,
	`held_by_manager` boolean NOT NULL DEFAULT false,
	`confirmed_at` datetime(3),
	`seated_at` datetime(3),
	`completed_at` datetime(3),
	`no_show_at` datetime(3),
	`cancelled_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reservations_location_external` UNIQUE(`location_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`reservation_id` binary(16),
	`customer_id` binary(16),
	`table_id` binary(16),
	`waiter_user_id` binary(16),
	`party_size` smallint NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`started_at` datetime(3) NOT NULL,
	`ended_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`device_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `visits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tax_categories` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`key` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `tax_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tax_categories_org_key` UNIQUE(`organization_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`code` varchar(16) NOT NULL,
	`rate_bp` int NOT NULL,
	`valid_from` date NOT NULL,
	`valid_to` date,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `tax_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tax_rates_org_code_from` UNIQUE(`organization_id`,`code`,`valid_from`)
);
--> statement-breakpoint
CREATE TABLE `tax_rules` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`tax_category_id` binary(16) NOT NULL,
	`consumption_type` varchar(16) NOT NULL,
	`rate_code` varchar(16) NOT NULL,
	`valid_from` date NOT NULL,
	`valid_to` date,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `tax_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_tax_rules_cat_consumption_from` UNIQUE(`tax_category_id`,`consumption_type`,`valid_from`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`role_id` binary(16) NOT NULL,
	`permission` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_role_permissions` UNIQUE(`role_id`,`permission`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`key` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_roles_org_key` UNIQUE(`organization_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `user_locations` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`location_id` binary(16) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `user_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_locations` UNIQUE(`user_id`,`location_id`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`role_id` binary(16) NOT NULL,
	`location_id` binary(16),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_roles` UNIQUE(`user_id`,`role_id`,`location_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` binary(16) NOT NULL,
	`organization_id` binary(16) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`email` varchar(254),
	`password_hash` varchar(255),
	`pin_hash` varchar(255),
	`ui_language` char(2) NOT NULL DEFAULT 'de',
	`failed_pin_attempts` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`two_factor_enabled` boolean NOT NULL DEFAULT false,
	`last_login_at` datetime(3),
	`is_active` boolean NOT NULL DEFAULT true,
	`deactivated_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`deleted_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `availability_rules` ADD CONSTRAINT `availability_rules_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `availability_rules` ADD CONSTRAINT `availability_rules_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `availability_rules` ADD CONSTRAINT `availability_rules_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `availability_rules` ADD CONSTRAINT `availability_rules_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_id_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_prices` ADD CONSTRAINT `channel_prices_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_prices` ADD CONSTRAINT `channel_prices_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_prices` ADD CONSTRAINT `channel_prices_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `channel_prices` ADD CONSTRAINT `channel_prices_variant_id_product_variants_id_fk` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_allergens` ADD CONSTRAINT `modifier_allergens_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_allergens` ADD CONSTRAINT `modifier_allergens_modifier_id_modifiers_id_fk` FOREIGN KEY (`modifier_id`) REFERENCES `modifiers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifier_groups` ADD CONSTRAINT `modifier_groups_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifiers` ADD CONSTRAINT `modifiers_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `modifiers` ADD CONSTRAINT `modifiers_modifier_group_id_modifier_groups_id_fk` FOREIGN KEY (`modifier_group_id`) REFERENCES `modifier_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_allergens` ADD CONSTRAINT `product_allergens_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_allergens` ADD CONSTRAINT `product_allergens_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_location_settings` ADD CONSTRAINT `product_location_settings_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_location_settings` ADD CONSTRAINT `product_location_settings_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_location_settings` ADD CONSTRAINT `product_location_settings_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_location_settings` ADD CONSTRAINT `product_location_settings_sold_out_by_user_id_users_id_fk` FOREIGN KEY (`sold_out_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_modifier_groups` ADD CONSTRAINT `product_modifier_groups_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_modifier_groups` ADD CONSTRAINT `product_modifier_groups_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_modifier_groups` ADD CONSTRAINT `product_modifier_groups_modifier_group_id_modifier_groups_id_fk` FOREIGN KEY (`modifier_group_id`) REFERENCES `modifier_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_origins` ADD CONSTRAINT `product_origins_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_origins` ADD CONSTRAINT `product_origins_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_station_routes` ADD CONSTRAINT `product_station_routes_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_station_routes` ADD CONSTRAINT `product_station_routes_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_station_routes` ADD CONSTRAINT `product_station_routes_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_station_routes` ADD CONSTRAINT `product_station_routes_kitchen_station_id_kitchen_stations_id_fk` FOREIGN KEY (`kitchen_station_id`) REFERENCES `kitchen_stations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_variants` ADD CONSTRAINT `product_variants_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_tax_category_id_tax_categories_id_fk` FOREIGN KEY (`tax_category_id`) REFERENCES `tax_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `translations` ADD CONSTRAINT `translations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consents` ADD CONSTRAINT `consents_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consents` ADD CONSTRAINT `consents_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consents` ADD CONSTRAINT `consents_customer_id_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `consents` ADD CONSTRAINT `consents_recorded_by_user_id_users_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `areas` ADD CONSTRAINT `areas_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `areas` ADD CONSTRAINT `areas_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `dining_tables_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `dining_tables_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dining_tables` ADD CONSTRAINT `dining_tables_area_id_areas_id_fk` FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD CONSTRAINT `kitchen_stations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD CONSTRAINT `kitchen_stations_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kitchen_stations` ADD CONSTRAINT `kitchen_stations_printer_id_printers_id_fk` FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `locations` ADD CONSTRAINT `locations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printers` ADD CONSTRAINT `printers_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printers` ADD CONSTRAINT `printers_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_kitchen_station_id_kitchen_stations_id_fk` FOREIGN KEY (`kitchen_station_id`) REFERENCES `kitchen_stations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_receipt_printer_id_printers_id_fk` FOREIGN KEY (`receipt_printer_id`) REFERENCES `printers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_categories` ADD CONSTRAINT `tax_categories_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_rates` ADD CONSTRAINT `tax_rates_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_rules` ADD CONSTRAINT `tax_rules_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tax_rules` ADD CONSTRAINT `tax_rules_tax_category_id_tax_categories_id_fk` FOREIGN KEY (`tax_category_id`) REFERENCES `tax_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_locations` ADD CONSTRAINT `user_locations_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_locations` ADD CONSTRAINT `user_locations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_locations` ADD CONSTRAINT `user_locations_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_location_id_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_organization_id_organizations_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_cash_movements_shift` ON `cash_movements` (`shift_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_reconciliations_day` ON `payment_reconciliations` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `idx_shifts_location_status` ON `shifts` (`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_ticket_items_ticket` ON `kitchen_ticket_items` (`kitchen_ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_tickets_station_status` ON `kitchen_tickets` (`location_id`,`kitchen_station_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_tickets_order` ON `kitchen_tickets` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_discounts_order` ON `discounts` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_item_modifiers_item` ON `order_item_modifiers` (`order_item_id`);--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_location_status` ON `orders` (`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_location_table` ON `orders` (`location_id`,`table_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_shift` ON `payments` (`shift_id`);--> statement-breakpoint
CREATE INDEX `idx_refunds_payment` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_tips_user` ON `tips` (`location_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_org_time` ON `audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_entity` ON `audit_events` (`organization_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_user` ON `audit_events` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_events_pending` ON `outbox_events` (`published_at`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_outbox_events_aggregate` ON `outbox_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_operations_status` ON `sync_operations` (`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_receipts_order` ON `receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_reservations_location_starts` ON `reservations` (`location_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_visits_location_customer` ON `visits` (`location_id`,`customer_id`);