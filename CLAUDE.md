# CLAUDE.md — card-manager

> Fichier lu automatiquement par Claude Code. Il donne la carte du projet, les
> règles impératives, l'état **fait / à faire**, et comment vérifier une modif.
> Gestionnaire de collection de cartes TCG (Yu-Gi-Oh d'abord, **multi-TCG par conception**).

---

## 0. Orientation express

- **Stack** : Tauri v2 (Rust) + Nuxt 4 SPA (`app/`) + Nuxt UI v4 (4.8.1, embarque Reka UI) + Tailwind v4 + SQLite (`tauri-plugin-sql`) + VueUse. `withGlobalTauri: true`.
- **Dépôt** : branche d'intégration `dev`, commits conventionnels. Claude travaille sur des branches `claude/*`, committe et pousse lui-même, ouvre une PR vers `dev` ; **Félix relit et merge**. Jamais de push direct sur `dev`.
- **Langue** : répondre **en français**.
- **OS dev** : Fedora. Bases dans `~/.config/com.card-manager.app/`.
- **CI** : GitHub Actions, deux workflows sur push `dev` + PR : `checks` (typecheck + Vitest, ~1 min) et `e2e` (9 parcours WebdriverIO, ~5-15 min).

---

## 1. Commandes (à connaître avant toute chose)

```bash
# Dev desktop (concurrently: front Nuxt + tauri dev)
pnpm dev
# Dev mobile (USB adb)
pnpm dev:mobile

# Installer les deps du FRONT (obligatoire: --ignore-workspace)
cd app && pnpm install --ignore-workspace

# E2E complet : onPrepare fait `nuxt generate` + `tauri build --no-bundle`
# (~30 s à chaud) puis lance les specs WebdriverIO.
cd e2e && npm test

# Typecheck (vue-tsc via nuxt typecheck) — doit rester à 0 erreur
cd app && pnpm --ignore-workspace typecheck
# Tests unitaires Vitest (services, SQLite en mémoire) — Node >= 22 requis
cd app && pnpm --ignore-workspace test:unit
# en mode watch
cd app && npx vitest

# Lancer UN seul spec (utile en debug)
cd e2e && npx wdio run ./wdio.conf.ts --spec ./specs/deck-range.spec.ts

# Régénérer la fixture de cartes (après re-sync ou changement du schéma ygo 001)
./e2e/fixtures/build-fixture.sh
# puis recommiter e2e/fixtures/cards-ygo.test.db si elle a changé

# Réinitialiser les bases de dev (erreur de checksum de migration, cf. §4)
# Fermer l'app d'abord.
rm ~/.config/com.card-manager.app/user.dev.db*         # user seul
rm ~/.config/com.card-manager.app/cards-ygo.dev.db*    # + cartes (⇒ re-sync nécessaire)

# Port zombie (3000)
lsof -ti:3000 | xargs kill -9
```

Build front isolé (ce que fait la CI) : `cd app && pnpm --ignore-workspace generate`.

---

## 2. Carte du repo (⚠️ pièges)

```
card-manager/
├── package.json              # racine (name: "card-manager") : @tauri-apps/cli, concurrently,
│                             #   wait-on ; scripts dev/build/tauri ; pnpm-lock.yaml ici
├── CLAUDE.md                 # ce fichier
├── .claude/                  # settings.json + hooks/session-start.sh (sessions cloud : install deps app/)
├── src-tauri/
│   ├── src/lib.rs            # db_name() (test/dev/prod) + enregistrement migrations
│   ├── build.rs              # rerun-if-env-changed=VITE_TEST_MODE
│   └── migrations/
│       ├── user/001_initial.sql, 002_settings.sql, 003_collection_printing.sql
│       └── ygo/001_initial.sql
├── app/                      # racine de config Nuxt (package.json "app", scripts generate/dev/build)
│   ├── pnpm-lock.yaml
│   ├── vitest.config.ts      # alias ~ -> app/app, env node, include test/unit/**
│   ├── test/unit/            # tests Vitest (HORS de app/app, donc pas vus par Nuxt)
│   │   ├── deckLink.test.ts
│   │   └── helpers/testDb.ts, seed.ts
│   └── app/                  # ⚠️ DOUBLE app/ : LE CODE SOURCE RÉEL est ici
│       ├── pages/            # decks/[id].vue, decks/index.vue, collection.vue, index.vue,
│       │                     #   search.vue, settings.vue  (PAS de containers.vue)
│       ├── components/
│       ├── composables/useDatabase.ts   # ⚠️ ici (pas services/), parfois importé ~/services/useDatabase
│       ├── composables/useSettings.ts   # store réactif global des settings
│       ├── services/deckLink.ts
│       ├── services/settings.ts, services/game/ (registre par jeu : types/common/ygo/index)
│       ├── utils/db-names.ts
│       ├── plugins/test-reset.client.ts # helpers de test (VITE_TEST_MODE)
│       └── app.vue
├── e2e/                      # runner WebdriverIO — utilise npm (package-lock.json), pas pnpm
│   ├── wdio.conf.ts
│   ├── specs/*.spec.ts
│   ├── specs/helpers.ts
│   └── fixtures/             # cards-ygo.test.db (committée), build-fixture.sh, passcodes.txt
└── .github/workflows/checks.yml, e2e.yml
```

**Pièges majeurs :**
- **Double `app/`** : le code vit dans `app/app/`. Ne pas se tromper de niveau.
- **Nommage INCOHÉRENT des composants** (vérifié, respecter le casing réel pour `git add`) :
  - Conteneurs/cartes = **camelCase** : `cardDetail.vue`, `cardThumb.vue`, `artThumb.vue`, `containerTree.vue`, `containerCreateModal.vue`, `containerPicker.vue`, `containerEditModal.vue`, `binderView.vue`, `unrangedCardPicker.vue`.
  - Decks = **PascalCase** : `DeckCard.vue`, `DeckBoard.vue`, `DeckboxRangeModal.vue`.
- **Trois `package.json`** (racine / `app/` / `e2e/`), trois installs distincts.
- La gestion des conteneurs (ContainerTree, BinderView, deckbox/binder/bulk + « non rangées ») vit **dans `collection.vue`**, route `/collection` — il n'y a pas de page dédiée.

---

## 3. Règles impératives (à ne pas violer)

1. **Multi-TCG** : ne rien hardcoder YGO-only sans raison. Le schéma porte `game` partout.
2. **Tests E2E i18n-safe** : ne JAMAIS cibler/asserter du **texte d'UI**. Uniquement `id`, `data-*`, rôles ARIA. Les assertions lisent des `data-*`.
3. **Jamais de `PRAGMA journal_mode` (ni `foreign_keys`) dans une migration** : `tauri-plugin-sql` enveloppe chaque migration dans une transaction, et SQLite refuse WAL dans une transaction → échec sur base vierge. Les PRAGMA runtime vont dans `useDatabase.ts`, par connexion (hors transaction).
4. **Ne pas modifier une migration déjà appliquée** : le plugin vérifie un **checksum** → « migration was previously applied but has been modified ». Préférer une **nouvelle** migration, ou réinitialiser les bases de dev (cf. §4).
5. **Installs pnpm** : toujours `--ignore-workspace` (racine ET `app/`). `e2e/` = `npm ci`.
6. **Casing des fichiers** au `git add` (cf. §2).
7. **Git** : branches `claude/*` → PR vers `dev`, Félix merge. Ne jamais pousser sur `dev`.
8. **Typecheck à 0 erreur** : Nuxt 4 active `noUncheckedIndexedAccess` par défaut → `rows[0]` est `T | undefined`, tester avant usage. Nuxt UI type `onClick` en `void | Promise<void>` : un handler inline qui renvoie une valeur (`@click="open = true"`) ne passe pas → fonction nommée, ou `close` du slot `#footer` de `UModal`.

---

## 4. Bases de données

Deux bases, nom suffixé selon le mode.

- **`cards-ygo.db`** — données de référence (lecture seule côté app). Schéma = migration `ygo/001` :
  `cards` + `ygo_details` + `printings` + lookups (`card_types`/`card_attributes`/`card_races`) + `sync_meta` + FTS5 (`cards_fts`, `content=cards`, triggers de synchro).
  - `ygo_details.alias` → passcode « principal » d'une carte à artworks multiples.
  - `ygo_details.banlist_tcg/ocg/md` ∈ {`Forbidden`,`Limited`,`Semi-Limited`,NULL}.
  - Peuplée par une vraie **sync réseau YGOPRODeck** déclenchée dans l'app.
- **`user.db`** — collection, containers, decks, settings. Migrations `user/001` (collection, containers, decks, deck_cards, deckbox_cards, deckbox_decks, binder_slots, bulk_box_contents, *_details, vue `card_locations`), `002` (settings k/v + seed), `003` (`printing_id` sur collection).

**Choix du nom** (`app/app/utils/db-names.ts`, `dbName(base)`) : `.test.db` si `VITE_TEST_MODE==='true'`, `.dev.db` si `import.meta.env.DEV`, sinon `.db`. Exporte `DB_NAMES = {user, ygo}`.
**Côté Rust** (`src-tauri/src/lib.rs`, `db_name()`) : `option_env!("VITE_TEST_MODE")==Some("true")` → `.test.db` ; `cfg!(debug_assertions)` → `.dev.db` ; sinon `.db`.
**`useDatabase.ts`** : cache les connexions via une promesse partagée (une seule init concurrente) ; applique `PRAGMA foreign_keys = ON` par connexion (best-effort) ; `resetDatabaseInstance()` existe.

**Procédure de reset dev** (si checksum cassé) : fermer l'app → `rm user.dev.db*` (et/ou `cards-ygo.dev.db*`) → `pnpm dev` recrée à neuf → re-sync des cartes dans l'app si la base ygo a été supprimée → **régénérer la fixture** (`./e2e/fixtures/build-fixture.sh`).

---

## 5. CE QUI EST FAIT

### Phases
Phases 1–4 ✅ · Phase 6 ✅ · Phase 7 ✅ · **Phase 10 (Testing) ✅** (E2E + unitaires, détail ci-dessous) · **Phase 9 (Settings) en cours** · Phase 2 partielle.

### Phase 9 — Settings (en cours)
- `services/game/` : registre par jeu (`GameDefinition` : conditions, langues, défauts). Les couches génériques interrogent le registre, jamais de valeurs YGO en dur.
- `services/settings.ts` (DB + cache) + `composables/useSettings.ts` (store réactif `createGlobalState`, écriture directe, `ensureLoaded()` au boot).
- Défauts d'ajout en collection résolus par jeu (`services/collection.ts`) ; `settings.vue` branchée ; `cardDetail.vue` consomme le registre.

### Mode test (committé)
- `src-tauri/src/lib.rs` : `db_name()` gère le mode test (a corrigé au passage un bug prod : migrations enregistrées pour le mauvais nom de base en build test → table settings manquante).
- `src-tauri/build.rs` : rerun si `VITE_TEST_MODE` change.
- `app/app/plugins/test-reset.client.ts` (actif si `VITE_TEST_MODE==='true'`) :
  - `window.__resetTestDb()` — vide les tables user (sauf `_sqlx_migrations`).
  - `window.__seedOwned(cardId, qty)` — INSERT direct d'une ligne `collection` pour un `card_id` exact ; lit `PRAGMA table_info(collection)` pour s'adapter aux colonnes (condition/language/printing_id/timestamps si présents ; NOT NULL sans défaut → valeur de secours).
- `app/app/app.vue` : `runSync()` retourne tôt si `VITE_TEST_MODE`.

### E2E — 9 parcours (local + CI), dans `e2e/specs/`
1. `smoke` — header, nav.
2. `collection-add` — `/search` → Dark Magician → `#card-detail` → `#btn-quick-add` → `data-owned-count >= 1`.
3. `container-crud` — créer deckbox → vérifier → renommer → supprimer.
4. `container-assign` — ajouter carte → `/collection` → deckbox → « non rangées » (`__unranged__`) → `#btn-range-card` → picker → `#picker-confirm` → re-sélection → `data-content-card-id` → `[data-unassign]` → `#unassign-confirm`.
5. `binder-slots` — binder (pages=1) → slot `[data-slot-page=0][row=0][col=0]` → picker → `data-slot-filled`/`data-slot-card-id` → `[data-slot-clear]`.
6. `deck-crud` — les deux boutons (`#deck-create-btn` ET `#deck-create-empty`) ; `createDeckVia` fait `waitForPath(/^\/decks\/.+/)` PUIS `goTo('/decks')` PUIS `waitForPath('/decks')` (corrige une race router.push). Rename/delete via menu.
7. `deck-build` — `#deck-search-input` (watchDebounced 300 ms) → `.deck-search-result` → board Main `data-quantity=1` → menu `add`→2 → `remove`×2 → disparu.
8. `deck-range` — créer deck → ajouter 1er résultat → lire son `data-deck-card-id` → `__seedOwned(thatId)` → deckbox → ranger (combobox USelect) → `data-plan-total >= 1` → confirmer → carte physiquement dans la deckbox.
9. `deck-banlist` — alerte banlist via passage du format casual → tcg (`#deck-format-select`, `data-flagged` sur `.deck-board-card`, `data-banlist-alert`).

**Leçon deck-range** (⚠️ réutilisable) : « Dark Magician » a plusieurs artworks ; l'ordre des résultats diffère entre `/search` et la sidebar du deck → la carte possédée ≠ la carte du deck → `owned=0`. Résolu en possédant **le `card_id` exact** de la carte du deck via `__seedOwned`. Tout test qui a besoin d'un état de collection précis doit faire pareil, ne pas dépendre de l'ordre de recherche.

### Conventions de sélecteurs E2E (validées sous WebKit)
- **`UDropdownMenu` ET `USelect`** ciblés via le slot `#item` où on rend notre markup avec `:data-menu-action` / `:data-select-value`, + `:data-menu-trigger` / `id` sur le trigger. Le contenu **téléporté** (portal) est trouvable par `document.querySelector`.
- **`USelect` v4.8 = combobox Reka** (`<button role="combobox">` + `reka-select-content-*` téléporté), PAS un `<select>` natif : on ouvre (clic trigger) puis on clique l'option téléportée portant `data-select-value`.
- `id` sémantiques kebab-case + `data-*`. **Pas de data-testid.** Inspiration : github.com/Morgawr/kechimochi.

### Contournements WebKitWebDriver (tout via `browser.execute`)
`elementSendKeys` KO → `typeInto` (setter prototype + dispatch input/change). Actions API KO → pas de scroll/clic natif. Clics natifs interceptés → `click` dispatche une séquence pointer/mouse. `free(): corrupted unsorted chunks` à la fermeture = inoffensif. Éléments `opacity-0 group-hover` → le clic JS marche quand même.

### `data-*` / `id` posés (committés)
`cardDetail.vue` (#card-detail, #card-detail-owned[data-owned-count], #btn-quick-add, #btn-range-card) · `cardThumb.vue` (.card-thumb[data-card-id]) · `search.vue` (#search-card-input, #search-results) · `containerCreateModal.vue` (data-type, .container-type-btn, #container-name-input, #container-{pages,rows,cols,capacity}-input, #container-create-confirm) · `containerTree.vue` (#container-create-btn, .container-item[data-container-id/name], data-menu-trigger, #item data-menu-action rename/edit/delete, #container-rename-input/confirm, #container-delete-confirm ; non rangées = data-container-id="__unranged__") · `containerPicker.vue` (.picker-container[data-picker-container-id], #picker-qty-input, #picker-confirm) · `collection.vue` (#container-content, .container-card[data-content-card-id], [data-unassign], #unassign-confirm) · `binderView.vue` (.binder-slot[data-slot-page/row/col/filled/card-id], [data-slot-clear], #binder-prev/next-page, data-binder-page) · `unrangedCardPicker.vue` (.unranged-picker-card[data-picker-card-id], #unranged-picker-search) · `decks/index.vue` (#deck-create-btn, #deck-create-empty, #deck-name-input, #deck-create-confirm, #deck-rename-input/confirm, #deck-delete-confirm) · `DeckCard.vue` (.deck-card[data-deck-id/name], data-menu-trigger, #item data-menu-action rename/range/delete) · `DeckBoard.vue` (prop board → :data-board, .deck-board-card[data-deck-card-id/data-quantity], data-board-count, #item data-menu-action info/add/remove/move, data-menu-trigger, [data-move]) · `decks/[id].vue` (#deck-search-input, .deck-search-result[data-search-card-id], data-total-cards, boards main/extra/side, #deck-range-btn, **data-banlist-alert**) · `DeckboxRangeModal.vue` (#deck-range-select, #item data-select-value, #deck-range-confirm, data-range-modal-body, data-range-plan, data-plan-total).

### Tests unitaires Vitest (`app/test/unit/`)
- **Approche** : vrai SQLite en mémoire via `node:sqlite` (intégré à Node 22, pas de module natif), schéma = **les vraies migrations** `src-tauri/migrations/{user,ygo}` appliquées dans l'ordre → aucune dérive possible avec la prod. `useDatabase` est remplacé par `vi.mock('~/composables/useDatabase')` → **aucun refactor des services nécessaire**.
- `helpers/testDb.ts` : `TestDatabase` imite `select`/`execute` de plugin-sql (params `?`), active `foreign_keys`. `helpers/seed.ts` : builders (`card`, `owned`, `deck`, `deckCard`, `deckbox`, `binder`, `bulkBox`, `inDeckbox/inBinder/inBulk`, `softDelete*`, `linkDeck`) + lectures (`contentsOf`, `deckboxesOfDeck`, `capacityOf`).
- `deckLink.test.ts` : 26 cas (plan + apply) : alias/boards fusionnés, déjà là, partiel, non rangées prioritaires, multi-sources ordonnées par nom, conteneur supprimé, isolation par jeu, purge (alt art conservée), capacité (NULL / purge déduite / dépassement + relève), relink unique, idempotence, pas de sur-assignation, entrées de collection soft-deleted.
- **Bug corrigé grâce à ces tests** : `removeCard` (soft delete) laisse les lignes d'assignation ; `deckLink` les comptait (alreadyHere/currentInBox/purge) et pouvait déplacer ces copies fantômes. Toutes les requêtes d'assignation joignent maintenant `collection ... AND c.deleted_at IS NULL`. Résolution alias/nom factorisée dans `rootsOf()`.
- Pour tester un autre service : même schéma `vi.hoisted` + `vi.mock` + `createTestDatabases()` / `createSeeder()` (cf. en-tête de `deckLink.test.ts`).

### Fixture de cartes (déterministe, versionnée)
`e2e/fixtures/cards-ygo.test.db` (~244 Ko) : **54 cartes** (~20 noms classiques + artworks alt + alias), 663 printings, **1 Forbidden (Pot of Greed, passcode 55144522)**, FTS « Dark » = 20, zéro violation FK. Régénérable via `build-fixture.sh` (sélection par NOM, inclut alt arts + alias, lookups entières, rebuild FTS, check FK, aplatit le WAL). `.gitignore` a une exception `!e2e/fixtures/cards-ygo.test.db`.

### CI checks (`.github/workflows/checks.yml`)
`ubuntu-22.04`, push `dev` + PR, **Node 22** (node:sqlite), pnpm v9, `pnpm install --ignore-workspace --frozen-lockfile` dans `app/` → `typecheck` → `test:unit`. Pas de build Tauri.

### Sessions Claude Code cloud
`.claude/hooks/session-start.sh` (uniquement si `CLAUDE_CODE_REMOTE=true`) installe les deps de `app/` ; ne réinstalle que si `package.json`/`pnpm-lock.yaml`/le script changent. Typecheck, test:unit et generate tournent dans le conteneur ; l'E2E non (pas de WebKit/tauri-driver) → s'appuyer sur la CI de la PR.

### Nettoyage (nov. 2026)
- 59 erreurs vue-tsc corrigées, dont un vrai bug : `cardDetail.vue` référençait `CONDITIONS`/`LANGUAGES` supprimés (selects État/Langue vides) → `conditionItems`/`languageItems`.
- `DeckboxRangeModal` : on peut re-confirmer sur la même deckbox s'il y a quelque chose à placer/purger (le commentaire le disait, le code non).
- `nuxt.config` : `vite.server.host` (ignoré par Nuxt) → `devServer.host`.
- Code mort supprimé (`listCollection`, `listCollectionGrouped`, `assignToContainer`, `unassignDeckboxCard`, `unassignBulkBoxCard`, `clearBinderSlot`, `getSetting`) ; restes de templates (`public/` racine, README Nuxt) ; `.gitignore` réparé (commentaires en fin de ligne = motifs invalides : `*.db-shm`/`*.db-wal` n'étaient pas ignorés).

### CI E2E (`.github/workflows/e2e.yml`) — verte
`ubuntu-22.04`, push `dev` + PR, `timeout 30`, `concurrency` cancel-in-progress. Étapes : checkout → deps système (`libwebkit2gtk-4.1-dev`, gtk-3, ayatana-appindicator3, rsvg2, xdo, ssl, build-essential, **`webkit2gtk-driver`**, **`xvfb`** ; `which WebKitWebDriver`) → Rust + `Swatinem/rust-cache` → `cargo install tauri-driver --locked` → pnpm v9 → Node 20 + cache pnpm → **`pnpm install --ignore-workspace --frozen-lockfile` racine** (fournit le CLI `tauri`) → idem dans `app/` → `npm ci` dans `e2e/` → **`xvfb-run -a npm test`** → upload logs si échec. **Le build n'est PAS dupliqué** : `onPrepare` de wdio fait generate + tauri build. ~4 min avec cache.

### Robustesse corrigée
PRAGMA WAL/foreign_keys retirés des deux `001` (échouaient sur base vierge) ; `foreign_keys = ON` réactivé par connexion dans `useDatabase.ts`.

---

## 6. CE QUI RESTE À FAIRE (backlog priorisé)

### ✅ Tâche 1 — Spec E2E banlist : faite (`deck-banlist.spec.ts`).
### ✅ Tâche 2 — Vitest sur `deckLink.ts` : fait (cf. §5 « Tests unitaires »).

### ▶ Prochaines pistes de tests unitaires
`services/containers.ts` (assign/unassign, binder slots, compteurs), `services/decks.ts`, `services/collection.ts` (défauts par jeu via settings), `services/settings.ts`. Réutiliser `test/unit/helpers`.
⚠️ Vérifier ailleurs le même piège soft delete que deckLink : toute requête sur `deckbox_cards`/`binder_slots`/`bulk_box_contents` doit ignorer les entrées `collection.deleted_at IS NOT NULL` (ou `removeCard` doit détacher les assignations).

### ▶ Tâche 3 — Protection de branche (ops, optionnel)
Bloquer le merge des PR vers `dev` tant que les checks `e2e` et `checks` ne sont pas verts : Settings → Branches → Require status checks → cocher `e2e` et `checks` (n'apparaissent qu'après un 1er run). Réserve : build Tauri ~5-10 min/PR.

### Phases futures (hors testing)
- **Phase 5 — OCR** (reconnaissance de cartes).
- **Phase 8 — Partage**.
- **Phase 9 — Settings** : terminer (base en place, cf. §5).
- **Compléter Phase 2** (partielle).

---

## 7. Vérifier une modification

1. **Front/logique** : `pnpm dev`, tester le parcours à la main.
2. **Touche à la DB / migrations** : vérifier le démarrage à neuf (reset dev si besoin, cf. §4) — ne jamais supposer que « ça marche en dev » ⇒ « ça marche sur base vierge ».
3. **Toute modif du front** : `cd app && pnpm --ignore-workspace typecheck && pnpm --ignore-workspace test:unit`.
4. **Avant de committer un changement UI testé en E2E** : `cd e2e && npm test` (ou un spec ciblé). Vert en local = bon signe pour la CI.
5. **CI** : pousser sur `dev` / ouvrir une PR → onglet Actions. En cas d'échec, l'erreur réelle est dans les **dernières lignes** de l'étape rouge ; logs uploadés en artifact. Attention au **timing** : un spec peut timeout sur le runner (plus lent) alors qu'il passe en local → augmenter le timeout concerné, pas « réparer » le code.
6. **Changement de schéma ygo 001 ou re-sync** → régénérer la fixture + recommiter.

---

## 8. Mini-glossaire des pièges (anti-régression)

- PRAGMA dans une migration → échec base vierge. (§3.3)
- Modifier une migration appliquée → checksum cassé. (§3.4, reset §4)
- Oublier `--ignore-workspace` → `packages field missing or empty`. (§1)
- CLI `tauri` introuvable en CI → il faut installer les deps **racine**. (déjà fait dans le workflow)
- Asserter sur du texte d'UI → casse en multi-langue. (§3.2)
- Multi-artwork : « 1er résultat » instable entre `/search` et sidebar deck. (§5 deck-range, §6 Tâche 1)
- Double `app/` et casing des composants. (§2)
- Soft delete de `collection` : les assignations restent → filtrer `c.deleted_at IS NULL` dans toute requête d'assignation. (§5 Tests unitaires)
- Tests unitaires : Node >= 22 obligatoire (`node:sqlite`) ; le warning « SQLite is an experimental feature » est normal.
