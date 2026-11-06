-- ============================================================
-- user.db — migration 009
-- État local de la synchronisation entre appareils (jamais synchronisé
-- lui-même) : identifiant de l'appareil, instantané de la dernière
-- synchro réussie (la « base » de la fusion à trois), sauvegarde de la
-- base locale avant la dernière fusion.
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
