-- ============================================================
-- user.db — migration 005
-- binder_slots avait UNIQUE(collection_id) : une entrée de collection
-- (une pile, quantity >= 1) ne pouvait occuper qu'UNE case, donc ranger
-- 2 copies d'une même pile dans un classeur échouait. On reconstruit la
-- table sans cette contrainte (SQLite ne sait pas la retirer). La vue
-- card_locations dépend de la table : on la supprime puis la recrée.
-- Pas de PRAGMA ici (cf. CLAUDE.md §3.3).
-- ============================================================

DROP VIEW IF EXISTS card_locations;

CREATE TABLE binder_slots_new (
  id            TEXT    PRIMARY KEY,
  container_id  TEXT    NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  collection_id TEXT    NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL CHECK(page >= 0),
  row           INTEGER NOT NULL CHECK(row  >= 0),
  col           INTEGER NOT NULL CHECK(col  >= 0),
  UNIQUE(container_id, page, row, col)     -- une carte par case physique
);

-- les bases d'avant l'activation de foreign_keys peuvent contenir des
-- lignes orphelines : on ne recopie que les lignes valides
INSERT INTO binder_slots_new (id, container_id, collection_id, page, row, col)
SELECT id, container_id, collection_id, page, row, col
FROM binder_slots
WHERE container_id IN (SELECT id FROM containers)
  AND collection_id IN (SELECT id FROM collection);

DROP TABLE binder_slots;
ALTER TABLE binder_slots_new RENAME TO binder_slots;

CREATE INDEX IF NOT EXISTS idx_binder_slots_container
  ON binder_slots(container_id, page);

CREATE INDEX IF NOT EXISTS idx_binder_slots_collection
  ON binder_slots(collection_id);

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
