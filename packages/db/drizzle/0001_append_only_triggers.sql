-- Append-only (RN-10, RF-F13): recibos, cierres Z y auditoría no se modifican ni se borran
-- desde ninguna aplicación. Las correcciones son registros nuevos (RN-11, RN-21).
CREATE TRIGGER `trg_audit_events_no_update` BEFORE UPDATE ON `audit_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_audit_events_no_delete` BEFORE DELETE ON `audit_events` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_receipts_no_update` BEFORE UPDATE ON `receipts` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'receipts is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_receipts_no_delete` BEFORE DELETE ON `receipts` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'receipts is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_daily_closings_no_update` BEFORE UPDATE ON `daily_closings` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'daily_closings is append-only (RN-10)';
--> statement-breakpoint
CREATE TRIGGER `trg_daily_closings_no_delete` BEFORE DELETE ON `daily_closings` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'daily_closings is append-only (RN-10)';
