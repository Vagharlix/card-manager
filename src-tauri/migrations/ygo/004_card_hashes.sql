-- ============================================================
-- cards-ygo.db — migration 004
-- Empreinte de chaque carte telle que reçue de YGOPRODeck (texte, stats,
-- banlist, impressions…) : une mise à jour n'écrit que les cartes dont
-- l'empreinte a changé, et supprime celles qui ont disparu de la source.
-- Table vide (base d'avant) → la première mise à jour réécrit tout, une fois.
-- ============================================================

CREATE TABLE IF NOT EXISTS card_hashes (
  card_id TEXT PRIMARY KEY,
  hash    TEXT NOT NULL
);
