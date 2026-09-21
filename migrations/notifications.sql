USE booking;

-- ─── Add notification queue columns ───────────────────
-- MariaDB doesn't support ADD COLUMN IF NOT EXISTS in all versions.
-- Use a stored procedure or run individually. Simplest: run each and ignore errors.

ALTER TABLE notifications ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN last_error TEXT NULL;
ALTER TABLE notifications ADD COLUMN processed_at DATETIME NULL;

-- ─── Index for the queue ──────────────────────────────
-- Regular composite index (no WHERE clause — MariaDB doesn't support partial indexes)
CREATE INDEX idx_notif_pending ON notifications(status, created_at);