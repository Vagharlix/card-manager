-- ============================================================
-- cards-mtg.db — migration 002
-- Mises à jour incrémentales : promo / variante de chaque impression
-- (pour recalculer l'impression par défaut d'une carte sans tout
-- retélécharger). Les bases importées avant n'ont pas ces valeurs : la
-- prochaine mise à jour fait un import complet, une fois.
-- ============================================================

ALTER TABLE mtg_prints ADD COLUMN promo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mtg_prints ADD COLUMN variation INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO sync_meta (key, value)
  SELECT 'needs_full', '1' WHERE EXISTS (SELECT 1 FROM mtg_prints);
