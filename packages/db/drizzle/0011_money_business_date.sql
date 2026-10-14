-- Payments and refunds recorded before shifts (version 2 operations, DEC-026) carry no business
-- day of their own: they count for the day of their order, as the receipts of that time did.
UPDATE `payments` p JOIN `orders` o ON o.`id` = p.`order_id`
SET p.`business_date` = o.`business_date`
WHERE p.`business_date` IS NULL;
--> statement-breakpoint
UPDATE `refunds` r JOIN `orders` o ON o.`id` = r.`order_id`
SET r.`business_date` = o.`business_date`
WHERE r.`business_date` IS NULL;
