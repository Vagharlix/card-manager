-- ============================================================
-- cards-mtg.db — migration 001
-- Magic: The Gathering, données de Scryfall (fichier « default_cards » :
-- chaque impression papier, en anglais ou dans sa seule langue imprimée).
-- Base de référence, lecture seule côté app, entièrement remplaçable.
--
-- Modèle : une CARTE (cards.id) = une IMPRESSION Scryfall (uuid) ; la carte
-- logique (root) = oracle_id, partagé par toutes les impressions. C'est le
-- modèle YGO (artwork → carte principale) avec plus d'impressions.
--
-- Contrat commun (cf. migrations/ygo/003) : cards, printings (vue),
-- printing_rarities, card_meta et card_legality (ici des tables, remplies
-- par l'import : des vues jointes seraient trop lentes sur 120 000 lignes).
-- Pas de PRAGMA ici (règle §3.3 de CLAUDE.md).
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- 'db_version' = updated_at du fichier Scryfall importé
  -- 'synced_at'  = date de l'import (ISO), pour espacer les mises à jour
);

-- une ligne par impression (contrat) ; le texte de règles est dans mtg_oracle
CREATE TABLE IF NOT EXISTS cards (
  id                TEXT PRIMARY KEY,      -- uuid Scryfall de l'impression
  name              TEXT NOT NULL,
  image_url         TEXT,                  -- NULL : URL déduite de l'id (image_cache.rs)
  image_url_small   TEXT,
  image_url_cropped TEXT,
  legal_text        TEXT                   -- NULL (cf. mtg_oracle.oracle_text)
);

-- carte logique (règles communes à toutes ses impressions)
CREATE TABLE IF NOT EXISTS mtg_oracle (
  oracle_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  default_print  TEXT NOT NULL,            -- impression montrée par la recherche
  mana_cost      TEXT,
  cmc            REAL,
  type_line      TEXT,
  oracle_text    TEXT,                     -- faces séparées par « // »
  power          TEXT,
  toughness      TEXT,
  loyalty        TEXT,
  defense        TEXT,
  colors         TEXT,                     -- lettres WUBRG, '' = incolore
  color_identity TEXT,
  keywords       TEXT,                     -- séparés par ', '
  reserved       INTEGER NOT NULL DEFAULT 0,
  deck_limit     INTEGER                   -- NULL = règle du format ; -1 = illimité ; n
);

CREATE TABLE IF NOT EXISTS mtg_prints (
  card_id          TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  oracle_id        TEXT NOT NULL,
  set_code         TEXT NOT NULL,          -- 'blb' (minuscules, comme Scryfall)
  set_name         TEXT NOT NULL,
  set_type         TEXT,
  collector_number TEXT NOT NULL,          -- '280', '12a', '★5'
  rarity           TEXT,                   -- common | uncommon | rare | mythic | special | bonus
  released_at      TEXT,
  lang             TEXT,
  layout           TEXT,
  finishes         TEXT,                   -- 'nonfoil,foil,etched'
  artist           TEXT,
  illustration_id  TEXT
);

-- contrat : carte → carte logique + type (indication pour le moteur de deck)
CREATE TABLE IF NOT EXISTS card_meta (
  card_id TEXT PRIMARY KEY,
  root    TEXT NOT NULL,                   -- oracle_id
  type    TEXT                             -- type_line
);

-- contrat : statut par format, sur la carte logique (card_id = oracle_id).
-- Seulement ce qui restreint : banned | restricted | not_legal ; pas de
-- ligne = légal. Plus format 'deck_limit' (copies max en dehors de la
-- règle du format, ex. terrains de base : '-1'), lu par le moteur MTG.
CREATE TABLE IF NOT EXISTS card_legality (
  card_id TEXT NOT NULL,
  format  TEXT NOT NULL,
  status  TEXT NOT NULL,
  PRIMARY KEY (card_id, format)
);

-- contrat : une impression Scryfall a une seule rareté → table vide,
-- printingRarities() se rabat sur printings.rarity
CREATE TABLE IF NOT EXISTS printing_rarities (
  set_code    TEXT NOT NULL,
  rarity      TEXT NOT NULL,
  rarity_code TEXT,
  PRIMARY KEY (set_code, rarity)
);

-- contrat : impressions (id = carte), code affiché « BLB #280 »
CREATE VIEW IF NOT EXISTS printings AS
  SELECT card_id AS id, card_id, set_name,
         upper(set_code) || ' #' || collector_number AS set_code,
         rarity, NULL AS rarity_code
  FROM mtg_prints;

CREATE INDEX IF NOT EXISTS idx_mtg_prints_oracle ON mtg_prints(oracle_id);
CREATE INDEX IF NOT EXISTS idx_mtg_prints_set ON mtg_prints(set_code, collector_number);
CREATE INDEX IF NOT EXISTS idx_card_meta_root ON card_meta(root);
CREATE INDEX IF NOT EXISTS idx_mtg_oracle_name ON mtg_oracle(name);

-- recherche plein texte sur les cartes logiques (nom + texte de règles) ;
-- reconstruite à la fin de chaque import ('rebuild')
CREATE VIRTUAL TABLE IF NOT EXISTS mtg_oracle_fts USING fts5(
  name,
  oracle_text,
  content       = mtg_oracle,
  content_rowid = rowid,
  tokenize      = 'unicode61 remove_diacritics 2'
);
