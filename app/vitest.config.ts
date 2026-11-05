import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// ============================================================
// Vitest — tests unitaires de la logique métier (services/).
// Indépendant de Nuxt : on reproduit juste l'alias `~` → app/app.
// La base est un vrai SQLite en mémoire (node:sqlite, Node >= 22)
// initialisé avec les migrations de src-tauri/ (cf. test/unit/helpers).
// ============================================================

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
})
