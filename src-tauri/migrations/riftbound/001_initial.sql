-- ============================================================
-- cards-riftbound.db — migration 001
-- Riftbound (Riot Games), données de RiftHunt (api.rifthunt.com : fichier
-- en masse /bulk/cards + recherche paginée pour les images, numéros et
-- légalités). Base de référence, lecture seule côté app.
--
-- Modèle (comme Magic) : une CARTE (cards.id) = une IMPRESSION (uuid
-- RiftHunt, « printing_id ») ; la carte logique (root) = oracle_id, partagé
-- par toutes les impressions (art alternatif, overnumbered, signée, Metal…).
--
-- Contrat commun (cf. migrations/ygo/003) : cards, printings (vue),
-- printing_rarities, card_meta (table) et card_legality (vue : un
-- bannissement annoncé s'applique à sa date, sans nouvelle synchro).
-- Pas de PRAGMA ici (règle §3.3 de CLAUDE.md).
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- 'db_version' = date d'ingestion du fichier RiftHunt (« fetched »)
  -- 'synced_at'  = dernière mise à jour réussie (ISO)
  -- 'checked_at' = dernière vérification (ISO), pour espacer les requêtes
);

-- une ligne par impression (contrat) ; name = nom de la carte logique
-- (sans « (Alternate Art) »… : rb_prints.printed_name le garde)
CREATE TABLE IF NOT EXISTS cards (
  id                TEXT PRIMARY KEY,      -- uuid RiftHunt de l'impression
  name              TEXT NOT NULL,
  image_url         TEXT,                  -- chemin de l'image (indice envoyé à Rust)
  image_url_small   TEXT,
  image_url_cropped TEXT,
  legal_text        TEXT                   -- texte de règles (cf. rb_cards.text)
);

-- carte logique (tout ce qui est commun à ses impressions)
CREATE TABLE IF NOT EXISTS rb_cards (
  oracle_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  default_print TEXT NOT NULL,             -- impression montrée par la recherche
  type          TEXT NOT NULL,             -- Unit | Spell | Gear | Legend | Battlefield | Rune
  supertype     TEXT,                      -- Champion | Signature | Token | Basic | NULL
  domains       TEXT NOT NULL DEFAULT '',  -- 'Fury,Mind' (Colorless = aucun)
  energy        INTEGER,                   -- coût en énergie
  power         INTEGER,                   -- coût en runes
  might         INTEGER,                   -- puissance (unités)
  tags          TEXT NOT NULL DEFAULT '',  -- 'Jinx, Zaun' (étiquettes de Riot)
  keywords      TEXT NOT NULL DEFAULT '',  -- 'accelerate, deflect'
  text          TEXT                       -- règles, avec les symboles :rb_*:
);

CREATE TABLE IF NOT EXISTS rb_prints (
  card_id          TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  oracle_id        TEXT NOT NULL,
  set_code         TEXT NOT NULL,          -- 'ogn' (minuscules)
  set_name         TEXT NOT NULL,
  collector_number TEXT NOT NULL,          -- '001', '299s', 'r01', 't02' ('' si inconnu)
  riftbound_id     TEXT,                   -- id de Riot ('ogn-001-298'), pas unique
  rarity           TEXT,                   -- Common | Uncommon | Rare | Epic | Showcase | Promo
  variant          TEXT,                   -- base | alternate | overnumbered | signature | showcase | NULL
  printed_name     TEXT NOT NULL,          -- 'Jinx, Demolitionist (Alternate Art)'
  artist           TEXT,
  flavour          TEXT,
  finishes         TEXT,                   -- 'normal,foil'
  released_at      TEXT,                   -- sortie de l'extension
  orientation      TEXT                    -- portrait | landscape (champs de bataille)
);

-- statuts publiés par Riot (via RiftHunt), par carte logique et format :
-- status banned | not_legal ; since = date d'effet d'un bannissement (un
-- bannissement annoncé reste « legal » jusqu'à cette date)
CREATE TABLE IF NOT EXISTS rb_legality (
  oracle_id TEXT NOT NULL,
  format    TEXT NOT NULL,                 -- standard | 2v2
  status    TEXT NOT NULL,
  since     TEXT,
  PRIMARY KEY (oracle_id, format)
);

-- contrat : carte → carte logique + type pour le moteur de deck
-- (« Champion Unit », « Signature Spell », « Basic Rune », « Battlefield »…)
CREATE TABLE IF NOT EXISTS card_meta (
  card_id TEXT PRIMARY KEY,
  root    TEXT NOT NULL,                   -- oracle_id
  type    TEXT
);

-- empreinte de chaque impression écrite (mise à jour incrémentale : seules
-- les impressions nouvelles ou modifiées sont réécrites)
CREATE TABLE IF NOT EXISTS card_hashes (
  card_id TEXT PRIMARY KEY,
  hash    TEXT NOT NULL
);

-- contrat : restrictions par format sur la carte logique. Pas de ligne =
-- légal. 'deck_limit' (copies max hors règle du format, lu par le moteur) :
-- 12 pour une rune (le deck de runes en compte 12), 1 pour une légende ou
-- un champ de bataille (trois champs de bataille différents).
CREATE VIEW IF NOT EXISTS card_legality AS
  SELECT oracle_id AS card_id, format, 'banned' AS status FROM rb_legality
   WHERE status = 'banned' OR (since IS NOT NULL AND since <= date('now'))
  UNION ALL
  SELECT oracle_id, format, 'not_legal' FROM rb_legality WHERE status = 'not_legal'
  UNION ALL
  SELECT oracle_id, 'deck_limit', CASE type WHEN 'Rune' THEN '12' ELSE '1' END
    FROM rb_cards WHERE type IN ('Rune', 'Legend', 'Battlefield');

-- contrat : une impression a une seule rareté → table vide,
-- printingRarities() se rabat sur printings.rarity
CREATE TABLE IF NOT EXISTS printing_rarities (
  set_code    TEXT NOT NULL,
  rarity      TEXT NOT NULL,
  rarity_code TEXT,
  PRIMARY KEY (set_code, rarity)
);

-- contrat : impressions (id = carte), code affiché « OGN #001 »
CREATE VIEW IF NOT EXISTS printings AS
  SELECT card_id AS id, card_id, set_name,
         upper(set_code) || CASE WHEN collector_number = '' THEN '' ELSE ' #' || collector_number END AS set_code,
         rarity, NULL AS rarity_code
  FROM rb_prints;

CREATE INDEX IF NOT EXISTS idx_rb_prints_oracle ON rb_prints(oracle_id);
CREATE INDEX IF NOT EXISTS idx_rb_prints_set ON rb_prints(set_code, collector_number);
CREATE INDEX IF NOT EXISTS idx_card_meta_root ON card_meta(root);
CREATE INDEX IF NOT EXISTS idx_rb_cards_name ON rb_cards(name);

-- recherche plein texte sur les cartes logiques (nom, texte, étiquettes) ;
-- reconstruite à la fin de chaque mise à jour ('rebuild')
CREATE VIRTUAL TABLE IF NOT EXISTS rb_cards_fts USING fts5(
  name,
  text,
  tags,
  content       = rb_cards,
  content_rowid = rowid,
  tokenize      = 'unicode61 remove_diacritics 2'
);
