-- ============================================================
-- user.db — migration 008
-- Rareté et 1re édition d'un exemplaire. La rareté ne se déduit pas du
-- code d'impression (un même code existe en plusieurs raretés) : elle est
-- choisie à l'ajout ou au scan. NULL = non précisée.
-- ============================================================

ALTER TABLE collection ADD COLUMN rarity TEXT;
ALTER TABLE collection ADD COLUMN first_edition INTEGER NOT NULL DEFAULT 0;
