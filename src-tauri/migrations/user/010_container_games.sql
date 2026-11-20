-- ============================================================
-- user.db — migration 010
-- Jeux d'un rangement (facultatif) : liste d'identifiants de jeux séparés
-- par des virgules (« ygo,mtg »), NULL = aucun jeu précisé = tous les jeux.
-- Un rangement n'est proposé que dans ses jeux (liste des rangements, choix
-- d'un rangement pour y ranger des cartes, deckbox d'un deck).
-- ============================================================

ALTER TABLE containers ADD COLUMN games TEXT;

-- rangements existants qui contiennent déjà des cartes : associés aux jeux
-- de ces cartes (les vides restent « tous les jeux »)
UPDATE containers
SET games = (
  SELECT GROUP_CONCAT(g) FROM (
    SELECT DISTINCT col.game AS g FROM collection col
    WHERE col.deleted_at IS NULL AND col.id IN (
      SELECT collection_id FROM deckbox_cards WHERE deckbox_id = containers.id
      UNION SELECT collection_id FROM binder_slots WHERE container_id = containers.id
      UNION SELECT collection_id FROM bulk_box_contents WHERE container_id = containers.id
    )
    ORDER BY g
  )
)
WHERE deleted_at IS NULL;
