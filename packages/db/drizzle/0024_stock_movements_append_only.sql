-- Stock movements are never edited nor deleted (DEC-051, RN-10): a correction is a new movement.
CREATE TRIGGER `trg_stock_movements_no_update` BEFORE UPDATE ON `stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_stock_movements_no_delete` BEFORE DELETE ON `stock_movements` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only (RN-10)';
