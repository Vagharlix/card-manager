-- ============================================================
-- user.db — migration 011
-- deck_cards.board était limité à main / side / extra / commander / maybe
-- (CHECK). Riftbound a d'autres zones (legend, champion, runes,
-- battlefields) et chaque jeu définit les siennes (DeckEngine.rules.boards) :
-- on reconstruit la table avec une contrainte qui accepte tout nom de zone
-- court (SQLite ne sait pas modifier un CHECK). La vue card_locations
-- dépend de la table : supprimée puis recréée à l'identique.
-- Pas de PRAGMA ici (cf. CLAUDE.md §3.3).
-- ============================================================

DROP VIEW IF EXISTS card_locations;

CREATE TABLE deck_cards_new (
  id       TEXT    PRIMARY KEY,
  deck_id  TEXT    NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  game     TEXT    NOT NULL,
  card_id  TEXT    NOT NULL,               -- game-native ID, not a FK to collection
  quantity INTEGER NOT NULL DEFAULT 1      CHECK(quantity > 0),
  board    TEXT    NOT NULL DEFAULT 'main' CHECK(length(board) BETWEEN 1 AND 32)
);

-- bases d'avant l'activation de foreign_keys : seulement les lignes valides
INSERT INTO deck_cards_new (id, deck_id, game, card_id, quantity, board)
SELECT id, deck_id, game, card_id, quantity, board
FROM deck_cards
WHERE deck_id IN (SELECT id FROM decks);

DROP TABLE deck_cards;
ALTER TABLE deck_cards_new RENAME TO deck_cards;

CREATE INDEX IF NOT EXISTS idx_deck_cards_deck
  ON deck_cards(deck_id);

CREATE INDEX IF NOT EXISTS idx_deck_cards_card
  ON deck_cards(game, card_id);

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
    dc.board      AS extra_info,           -- zone du deck (cf. DeckEngine.rules.boards)
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
