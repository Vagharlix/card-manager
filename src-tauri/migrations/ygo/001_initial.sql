-- ============================================================
-- cards-ygo.db — migration 001
-- YGO reference data synced from YGOPRODeck API
-- This DB is read-only from the app's perspective.
-- It is fully replaceable — never store user data here.
-- ============================================================
 
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
 
-- ============================================================
-- SYNC STATE
-- ============================================================
 
CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- key='db_version' stores the last synced YGOPRODeck version string
);
 
-- ============================================================
-- LOOKUP TABLES
-- Populated from API data during sync — not hardcoded.
-- Automatically handle new values Konami introduces (new card
-- types, new attributes, etc.) without any schema migration.
-- Also power filter dropdowns in the UI for free.
-- ============================================================
 
CREATE TABLE IF NOT EXISTS card_types      (value TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS card_attributes (value TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS card_races      (value TEXT PRIMARY KEY);
 
-- ============================================================
-- CARDS (base — universal fields every YGO card has)
-- id = passcode (8-digit number printed on the physical card)
-- Alt artworks have their OWN passcode and appear as separate
-- rows (fetched with &includeAliased=true from the API).
-- ============================================================
 
CREATE TABLE IF NOT EXISTS cards (
  id                TEXT PRIMARY KEY,      -- passcode as TEXT to avoid int overflow edge cases
  name              TEXT NOT NULL,
  image_url         TEXT,                  -- full size  (do not hotlink — cache locally)
  image_url_small   TEXT,                  -- thumbnail
  image_url_cropped TEXT,                  -- art crop only
  legal_text        TEXT                   -- card effect / flavor text
);
 
-- ============================================================
-- YGO DETAILS (game-specific fields, 1-to-1 with cards)
-- alias: if set, this card is an alternate artwork of alias's card.
-- Both share the same gameplay rules but are distinct physical prints.
-- ============================================================
 
CREATE TABLE IF NOT EXISTS ygo_details (
  card_id         TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  type            TEXT REFERENCES card_types(value),
  attribute       TEXT REFERENCES card_attributes(value),
  race            TEXT REFERENCES card_races(value),
  atk             INTEGER,                 -- NULL for non-monsters and some specials
  def             INTEGER,                 -- NULL for Link monsters
  level           INTEGER,                 -- NULL for Link/Xyz
  rank            INTEGER,                 -- Xyz only
  link_value      INTEGER,                 -- Link only
  link_markers    TEXT,                    -- JSON array e.g. '["Top","Bottom-Left"]'
  pendulum_scale  INTEGER,                 -- Pendulum only
  archetype       TEXT,
  alias           TEXT REFERENCES cards(id),  -- points to the "main" passcode if alt art
  banlist_tcg     TEXT CHECK(banlist_tcg IN ('Forbidden','Limited','Semi-Limited', NULL)),
  banlist_ocg     TEXT CHECK(banlist_ocg IN ('Forbidden','Limited','Semi-Limited', NULL)),
  banlist_md      TEXT CHECK(banlist_md  IN ('Forbidden','Limited','Semi-Limited', NULL))
);
 
-- ============================================================
-- PRINTINGS (every set printing of every card)
-- set_code is the unique identifier e.g. 'LOB-EN005'
-- Multiple printings can exist per card (different sets/rarities)
-- ============================================================
 
CREATE TABLE IF NOT EXISTS printings (
  id           TEXT PRIMARY KEY,           -- set_code e.g. 'LOB-EN005'
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  set_name     TEXT NOT NULL,
  set_code     TEXT NOT NULL,
  rarity       TEXT,                       -- 'Ultra Rare' | 'Common' | ...
  rarity_code  TEXT,                       -- '(UR)' | '(C)' | ...
  price_usd    REAL,
  price_eur    REAL
);
 
-- ============================================================
-- INDEXES
-- ============================================================
 
CREATE INDEX IF NOT EXISTS idx_cards_name
  ON cards(name);
 
CREATE INDEX IF NOT EXISTS idx_ygo_type
  ON ygo_details(type);
 
CREATE INDEX IF NOT EXISTS idx_ygo_attribute
  ON ygo_details(attribute);
 
CREATE INDEX IF NOT EXISTS idx_ygo_race
  ON ygo_details(race);
 
CREATE INDEX IF NOT EXISTS idx_ygo_archetype
  ON ygo_details(archetype);
 
CREATE INDEX IF NOT EXISTS idx_ygo_alias
  ON ygo_details(alias)
  WHERE alias IS NOT NULL;
 
CREATE INDEX IF NOT EXISTS idx_printings_card
  ON printings(card_id);
 
CREATE INDEX IF NOT EXISTS idx_printings_set
  ON printings(set_code);
 
-- ============================================================
-- FULL-TEXT SEARCH (FTS5)
-- Enables fast fuzzy name + text search like EDOPro's search bar.
-- content= links it to the cards table so no data is duplicated.
-- Triggers keep the FTS index in sync on every insert/update/delete.
-- ============================================================
 
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  name,
  legal_text,
  content       = cards,
  content_rowid = rowid,
  tokenize      = 'unicode61'
);
 
CREATE TRIGGER IF NOT EXISTS cards_fts_after_insert
  AFTER INSERT ON cards BEGIN
    INSERT INTO cards_fts(rowid, name, legal_text)
    VALUES (new.rowid, new.name, new.legal_text);
  END;
 
CREATE TRIGGER IF NOT EXISTS cards_fts_after_update
  AFTER UPDATE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, name, legal_text)
    VALUES ('delete', old.rowid, old.name, old.legal_text);
    INSERT INTO cards_fts(rowid, name, legal_text)
    VALUES (new.rowid, new.name, new.legal_text);
  END;
 
CREATE TRIGGER IF NOT EXISTS cards_fts_after_delete
  AFTER DELETE ON cards BEGIN
    INSERT INTO cards_fts(cards_fts, rowid, name, legal_text)
    VALUES ('delete', old.rowid, old.name, old.legal_text);
  END;
