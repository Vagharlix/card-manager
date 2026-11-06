# card-manager

Gestionnaire de collection de cartes TCG (Yu-Gi-Oh d'abord, multi-TCG par conception) :
collection, conteneurs physiques (deckbox, classeur, bulk box), decks et banlist.

**Stack** : Tauri v2 (Rust) · Nuxt 4 en SPA · Nuxt UI v4 · Tailwind v4 · SQLite (`tauri-plugin-sql`).

## Démarrer

```bash
pnpm install --ignore-workspace                 # racine : CLI Tauri
cd app && pnpm install --ignore-workspace       # front Nuxt
cd .. && pnpm dev                               # app desktop (Nuxt + tauri dev)
```

## Tester sans environnement de dev

Chaque push sur `dev` publie la pré-release **`dev-latest`** (onglet *Releases*) :

- **PC Linux** : `card-manager-linux-x86_64.AppImage` → `chmod +x` puis lancer.
- **Android** : `card-manager-android-arm64.apk` → ouvrir depuis le téléphone et installer.

La signature des APK utilise une clé stockée dans les secrets du dépôt (jamais dans git) :
lancer `scripts/android-keystore.sh` une fois, puis créer les trois secrets qu'il affiche.

## Vérifier

```bash
cd app && pnpm --ignore-workspace typecheck     # vue-tsc
cd app && pnpm --ignore-workspace test:unit     # Vitest (Node >= 22)
cd e2e && npm ci && npm test                    # E2E WebdriverIO sur la vraie app
```

La CI (`.github/workflows/`) lance `checks` (typecheck + unitaires) et `e2e` sur chaque PR et push sur `dev`.

Architecture, conventions et pièges : voir [`CLAUDE.md`](./CLAUDE.md).
