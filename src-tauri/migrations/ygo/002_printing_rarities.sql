-- ============================================================
-- cards-ygo.db — migration 002
-- Toutes les raretés d'un code d'impression. `printings` a pour clé le
-- code (« RA01-EN001 ») : quand une impression existe en plusieurs
-- raretés (Super, Ultra, Secret…), la synchro n'en gardait qu'une.
-- Remplie par la synchro ; vide sur une base synchronisée avant cette
-- migration → la synchro relance un téléchargement complet une fois.
-- ============================================================

CREATE TABLE IF NOT EXISTS printing_rarities (
  set_code    TEXT NOT NULL,          -- 'RA01-EN001' (= printings.id)
  rarity      TEXT NOT NULL,          -- 'Ultra Rare'
  rarity_code TEXT,                   -- '(UR)'
  PRIMARY KEY (set_code, rarity)
);
