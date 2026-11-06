-- ============================================================
-- user.db — migration 004
-- Une entrée de collection supprimée (soft delete) gardait ses lignes
-- d'assignation : les conteneurs comptaient des copies qui n'existent
-- plus. removeCard les supprime désormais ; on nettoie l'existant.
-- ============================================================

DELETE FROM deckbox_cards
WHERE collection_id IN (SELECT id FROM collection WHERE deleted_at IS NOT NULL);

DELETE FROM binder_slots
WHERE collection_id IN (SELECT id FROM collection WHERE deleted_at IS NOT NULL);

DELETE FROM bulk_box_contents
WHERE collection_id IN (SELECT id FROM collection WHERE deleted_at IS NOT NULL);
