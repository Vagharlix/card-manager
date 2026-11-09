-- ============================================================
-- Base de cartes d'un FAUX JEU (tests uniquement) : schéma volontairement
-- différent de YGO (ids texte, pas d'alias mais une table de variantes,
-- interdictions par format dans une table à part), qui fournit le même
-- contrat commun que migrations/ygo/003 : cards, printings,
-- printing_rarities, vues card_meta et card_legality.
-- ============================================================

CREATE TABLE cards (
  id                TEXT PRIMARY KEY,   -- « FK-001 », « FK-001-ALT »
  name              TEXT NOT NULL,
  image_url         TEXT,
  image_url_small   TEXT,
  image_url_cropped TEXT,
  legal_text        TEXT
);

CREATE TABLE fake_details (
  card_id   TEXT PRIMARY KEY REFERENCES cards(id),
  kind      TEXT NOT NULL,              -- 'Unit' | 'Spell' | 'Hero'
  power     INTEGER,
  base_card TEXT REFERENCES cards(id)   -- variante d'illustration de…
);

CREATE TABLE fake_bans (
  card_id TEXT NOT NULL REFERENCES cards(id),
  format  TEXT NOT NULL,                -- 'standard' | 'legacy'
  status  TEXT NOT NULL,                -- 'banned' | 'restricted'
  PRIMARY KEY (card_id, format)
);

CREATE TABLE printings (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id),
  set_name    TEXT NOT NULL,
  set_code    TEXT NOT NULL,
  rarity      TEXT,
  rarity_code TEXT
);

CREATE TABLE printing_rarities (
  set_code    TEXT NOT NULL,
  rarity      TEXT NOT NULL,
  rarity_code TEXT,
  PRIMARY KEY (set_code, rarity)
);

CREATE VIEW card_meta AS
  SELECT card_id, COALESCE(base_card, card_id) AS root, kind AS type FROM fake_details;

CREATE VIEW card_legality AS
  SELECT card_id, format, status FROM fake_bans;
