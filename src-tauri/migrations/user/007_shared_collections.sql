-- ============================================================
-- user.db — migration 007
-- Collections reçues d'autres joueurs (partage par QR / code).
-- On garde le code tel quel (source de vérité, décodé à l'affichage)
-- plus quelques colonnes dénormalisées pour la liste.
-- Une seule entrée par (jeu, propriétaire) : un nouveau partage du
-- même joueur remplace l'ancien.
-- ============================================================

CREATE TABLE IF NOT EXISTS shared_collections (
  id          TEXT    PRIMARY KEY,
  game        TEXT    NOT NULL,
  owner       TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  card_count  INTEGER NOT NULL,
  trade_count INTEGER NOT NULL,
  shared_at   TEXT    NOT NULL,   -- date de création du partage (côté émetteur)
  received_at TEXT    NOT NULL,
  UNIQUE(game, owner)
);
