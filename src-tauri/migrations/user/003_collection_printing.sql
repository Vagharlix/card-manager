-- ============================================================
-- user.db — migration 003
-- Adds printing_id to collection so an owned card can be tied
-- to a specific set printing (e.g. 'LOB-EN005'), not just the
-- artwork. NULL = printing unspecified (artwork-level only).
-- ============================================================

ALTER TABLE collection ADD COLUMN printing_id TEXT;

-- fast lookup of owned cards by printing
CREATE INDEX IF NOT EXISTS idx_collection_printing
  ON collection(game, printing_id)
  WHERE deleted_at IS NULL;