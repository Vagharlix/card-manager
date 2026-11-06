-- ============================================================
-- user.db — migration 006
-- Quantité proposée à l'échange, par pile de collection
-- (0..quantity, borne haute appliquée par l'app). Sert au partage
-- de collection : « ce que j'ai » et « ce que je peux céder ».
-- ============================================================

ALTER TABLE collection ADD COLUMN trade_qty INTEGER NOT NULL DEFAULT 0 CHECK (trade_qty >= 0);
