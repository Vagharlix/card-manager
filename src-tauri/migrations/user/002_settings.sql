-- ============================================================
-- user.db — migration 002
-- App settings stored as key-value pairs.
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('favorite_game',        '',     datetime('now')),
  ('show_game_picker',     'true', datetime('now')),
  ('default_condition',    'NM',   datetime('now')),
  ('default_language',     'en',   datetime('now')),
  ('image_cache_limit_mb', '200',  datetime('now'));