-- ============================================================
-- user.db — migration 001
-- Personal data: collection, containers, decks, assignments
-- ============================================================
 
PRAGMA journal_mode = WAL;   -- concurrent reads while writing
PRAGMA foreign_keys = ON;    -- enforce FK constraints
 
-- ============================================================
-- USER GAME PREFERENCES
-- ============================================================
 
CREATE TABLE IF NOT EXISTS user_games (
  game       TEXT    PRIMARY KEY,           -- 'ygo' | 'mtg' | 'pokemon' | ...
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at   TEXT    NOT NULL
);
 
-- ============================================================
-- CONTAINERS (CTI base table)
-- deckbox | binder | bulk_box — more types added later via
-- new _details tables without touching this base
-- ============================================================
 
CREATE TABLE IF NOT EXISTS containers (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK(type IN ('deckbox', 'binder', 'bulk_box')),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT                           -- soft delete for sync
);
 
CREATE TABLE IF NOT EXISTS deckbox_details (
  container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE,
  max_capacity INTEGER                      -- NULL = no limit
);
 
CREATE TABLE IF NOT EXISTS binder_details (
  container_id  TEXT    PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE,
  page_count    INTEGER NOT NULL DEFAULT 0,
  rows_per_page INTEGER NOT NULL DEFAULT 3,
  cols_per_page INTEGER NOT NULL DEFAULT 3
  -- total slots = page_count * rows_per_page * cols_per_page, enforced at app level
);
 
CREATE TABLE IF NOT EXISTS bulk_box_details (
  container_id TEXT    PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE,
  max_capacity INTEGER                      -- NULL = no limit
);
 
-- ============================================================
-- COLLECTION (master inventory — what the user physically owns)
-- Each row = one stack of identical cards (same card, condition,
-- language, foil status). quantity >= 1.
-- ============================================================
 
CREATE TABLE IF NOT EXISTS collection (
  id          TEXT    PRIMARY KEY,          -- uuid
  game        TEXT    NOT NULL,             -- 'ygo' | 'mtg' | ...
  card_id     TEXT    NOT NULL,             -- game-native ID (passcode / scryfall uuid)
  quantity    INTEGER NOT NULL DEFAULT 1    CHECK(quantity > 0),
  condition   TEXT    NOT NULL DEFAULT 'NM' CHECK(condition IN ('NM','LP','MP','HP','DMG')),
  language    TEXT    NOT NULL DEFAULT 'en',
  foil        INTEGER NOT NULL DEFAULT 0    CHECK(foil    IN (0,1)),
  altered     INTEGER NOT NULL DEFAULT 0    CHECK(altered IN (0,1)),
  signed      INTEGER NOT NULL DEFAULT 0    CHECK(signed  IN (0,1)),
  notes       TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT                          -- soft delete for sync
);
 
-- fast lookup by card across the whole collection
CREATE INDEX IF NOT EXISTS idx_collection_card
  ON collection(game, card_id)
  WHERE deleted_at IS NULL;
 
-- ============================================================
-- DECKS (theoretical — no ownership required)
-- deck_cards references game card IDs, NOT collection rows,
-- so the user can build decks for cards they don't own yet
-- ============================================================
 
CREATE TABLE IF NOT EXISTS decks (
  id          TEXT PRIMARY KEY,
  game        TEXT NOT NULL,
  format      TEXT,                         -- 'master_duel'|'tcg'|'ocg'|'commander'|'standard'|...
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
 
CREATE TABLE IF NOT EXISTS deck_cards (
  id       TEXT    PRIMARY KEY,
  deck_id  TEXT    NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  game     TEXT    NOT NULL,
  card_id  TEXT    NOT NULL,               -- game-native ID, not a FK to collection
  quantity INTEGER NOT NULL DEFAULT 1      CHECK(quantity > 0),
  board    TEXT    NOT NULL DEFAULT 'main' CHECK(board IN ('main','side','extra','commander','maybe'))
);
 
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck
  ON deck_cards(deck_id);
 
CREATE INDEX IF NOT EXISTS idx_deck_cards_card
  ON deck_cards(game, card_id);
 
-- ============================================================
-- DECKBOX ASSIGNMENTS
-- A deckbox can hold:
--   (a) a full deck (only if user owns all cards — app validates)
--   (b) loose cards directly from collection
-- ============================================================
 
-- (a) deck stored inside a deckbox
CREATE TABLE IF NOT EXISTS deckbox_decks (
  deckbox_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  deck_id    TEXT NOT NULL REFERENCES decks(id)      ON DELETE CASCADE,
  PRIMARY KEY (deckbox_id, deck_id)
);
 
-- (b) loose cards stored directly in a deckbox
CREATE TABLE IF NOT EXISTS deckbox_cards (
  id            TEXT    PRIMARY KEY,
  deckbox_id    TEXT    NOT NULL REFERENCES containers(id)  ON DELETE CASCADE,
  collection_id TEXT    NOT NULL REFERENCES collection(id)  ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0)
);
 
CREATE INDEX IF NOT EXISTS idx_deckbox_cards_collection
  ON deckbox_cards(collection_id);
 
-- ============================================================
-- BINDER ASSIGNMENTS
-- Each slot holds exactly one collection entry (quantity = 1).
-- Position = (page, row, col) — zero-indexed.
-- UNIQUE on (container_id, page, row, col) enforces one card per slot.
-- UNIQUE on collection_id prevents same entry in two slots.
-- ============================================================
 
CREATE TABLE IF NOT EXISTS binder_slots (
  id            TEXT    PRIMARY KEY,
  container_id  TEXT    NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  collection_id TEXT    NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL CHECK(page >= 0),
  row           INTEGER NOT NULL CHECK(row  >= 0),
  col           INTEGER NOT NULL CHECK(col  >= 0),
  UNIQUE(container_id, page, row, col),    -- one card per physical slot
  UNIQUE(collection_id)                    -- one slot per collection entry
);
 
CREATE INDEX IF NOT EXISTS idx_binder_slots_container
  ON binder_slots(container_id, page);
 
CREATE INDEX IF NOT EXISTS idx_binder_slots_collection
  ON binder_slots(collection_id);
 
-- ============================================================
-- BULK BOX ASSIGNMENTS
-- No positional tracking — cards just live in the box.
-- ============================================================
 
CREATE TABLE IF NOT EXISTS bulk_box_contents (
  id            TEXT    PRIMARY KEY,
  container_id  TEXT    NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  collection_id TEXT    NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0)
);
 
CREATE INDEX IF NOT EXISTS idx_bulk_collection
  ON bulk_box_contents(collection_id);
 
CREATE INDEX IF NOT EXISTS idx_bulk_container
  ON bulk_box_contents(container_id);
 
-- ============================================================
-- CARD LOCATIONS VIEW
-- Unifies all location types into a single queryable surface.
-- App always queries this view — never the 4 underlying tables.
-- ============================================================
 
CREATE VIEW IF NOT EXISTS card_locations AS
 
  -- Cards inside a deck (theoretical, may or may not be in a deckbox)
  SELECT
    dc.game,
    dc.card_id,
    NULL          AS collection_id,
    'deck'        AS location_type,
    d.id          AS location_id,
    d.name        AS location_name,
    dd.deckbox_id AS container_id,
    dc.board      AS extra_info,           -- main / side / extra / commander / maybe
    dc.quantity,
    NULL AS page, NULL AS row, NULL AS col
  FROM deck_cards dc
  JOIN decks d          ON dc.deck_id = d.id  AND d.deleted_at IS NULL
  LEFT JOIN deckbox_decks dd ON d.id = dd.deck_id
 
  UNION ALL
 
  -- Loose cards stored directly in a deckbox
  SELECT
    c.game,
    c.card_id,
    c.id          AS collection_id,
    'deckbox'     AS location_type,
    bc.deckbox_id AS location_id,
    cn.name       AS location_name,
    bc.deckbox_id AS container_id,
    NULL          AS extra_info,
    bc.quantity,
    NULL AS page, NULL AS row, NULL AS col
  FROM deckbox_cards bc
  JOIN collection c   ON bc.collection_id = c.id  AND c.deleted_at IS NULL
  JOIN containers cn  ON bc.deckbox_id    = cn.id AND cn.deleted_at IS NULL
 
  UNION ALL
 
  -- Cards in a binder with exact position
  SELECT
    c.game,
    c.card_id,
    c.id            AS collection_id,
    'binder'        AS location_type,
    bs.container_id AS location_id,
    cn.name         AS location_name,
    bs.container_id AS container_id,
    NULL            AS extra_info,
    1               AS quantity,
    bs.page, bs.row, bs.col
  FROM binder_slots bs
  JOIN collection c  ON bs.collection_id = c.id  AND c.deleted_at IS NULL
  JOIN containers cn ON bs.container_id  = cn.id AND cn.deleted_at IS NULL
 
  UNION ALL
 
  -- Cards in a bulk box
  SELECT
    c.game,
    c.card_id,
    c.id            AS collection_id,
    'bulk_box'      AS location_type,
    bb.container_id AS location_id,
    cn.name         AS location_name,
    bb.container_id AS container_id,
    NULL            AS extra_info,
    bb.quantity,
    NULL AS page, NULL AS row, NULL AS col
  FROM bulk_box_contents bb
  JOIN collection c  ON bb.collection_id = c.id  AND c.deleted_at IS NULL
  JOIN containers cn ON bb.container_id  = cn.id AND cn.deleted_at IS NULL;
