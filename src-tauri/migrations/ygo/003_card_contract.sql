-- ============================================================
-- cards-ygo.db — migration 003
-- Contrat commun des bases de cartes (multi-jeu). Les couches génériques
-- (collection, rangements, decks, partage, sauvegarde) ne lisent QUE :
--   cards(id, name, image_url*, legal_text), printings, printing_rarities,
--   et les deux vues ci-dessous, que chaque jeu définit à sa façon.
-- Un autre jeu fournit les mêmes vues sur son propre schéma.
-- ============================================================

-- carte logique (root : les artworks d'une même carte partagent le root)
-- et type (indication de placement pour le moteur de deck du jeu)
CREATE VIEW IF NOT EXISTS card_meta AS
  SELECT card_id, COALESCE(alias, card_id) AS root, type
  FROM ygo_details;

-- statut par format (banlist) ; absence de ligne = aucune restriction
CREATE VIEW IF NOT EXISTS card_legality AS
  SELECT card_id, 'tcg' AS format, banlist_tcg AS status
    FROM ygo_details WHERE banlist_tcg IS NOT NULL
  UNION ALL
  SELECT card_id, 'ocg', banlist_ocg FROM ygo_details WHERE banlist_ocg IS NOT NULL
  UNION ALL
  SELECT card_id, 'md', banlist_md FROM ygo_details WHERE banlist_md IS NOT NULL;
