# CLAUDE.md — card-manager

> Fichier lu automatiquement par Claude Code. Il donne la carte du projet, les
> règles impératives, l'état **fait / à faire**, et comment vérifier une modif.
> Gestionnaire de collection de cartes TCG : **Yu-Gi-Oh!, Magic: The Gathering et Riftbound** (multi-TCG par conception).

---

## 0. Orientation express

- **Stack** : Tauri v2 (Rust) + Nuxt 4 SPA (`app/`) + Nuxt UI v4 (4.8.1, embarque Reka UI) + Tailwind v4 + SQLite (`tauri-plugin-sql`) + VueUse. `withGlobalTauri: true`.
- **Dépôt** : branche d'intégration `dev`, commits conventionnels. Claude travaille sur des branches `claude/*`, committe et pousse lui-même, ouvre une PR vers `dev` ; **Félix relit et merge**. Jamais de push direct sur `dev`.
- **Langue** : répondre à Félix **en français**. **L'interface de l'appli est en anglais** (décision du 9 nov. 2026) : tout nouveau texte visible (libellés, notifications, messages d'erreur montrés à l'utilisateur) s'écrit en anglais. Vocabulaire : rangement = *storage*, non rangées = *unsorted*, ranger = *store*, à l'échange = *for trade*, exemplaire = *copy*, classeur = *binder*, boîte = *bulk box*, 1re édition = *1st edition*. Les commentaires de code et la doc restent en français.
- **OS dev** : CachyOS (Arch). Bases dans `~/.config/com.card-manager.app/`.
- **CI** : GitHub Actions, `checks` (typecheck + Vitest + tests Rust std-only, ~1 min) et `e2e` (19 parcours WebdriverIO, ~10 min) sur push `dev` + PR ; `release` = **versions numérotées** (tag `vX.Y.Z`, Linux / Windows / macOS / Android), cf. §5 « Release ».

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
# Tests Rust des modules sans dépendance Tauri (pas besoin des libs système)
rustc --edition 2021 --test src-tauri/src/cache_store.rs -o /tmp/cache_store_test && /tmp/cache_store_test  # + is_safe_name
rustc --edition 2021 --test src-tauri/src/oauth_loopback.rs -o /tmp/oauth_test && /tmp/oauth_test
rustc --edition 2021 --test src-tauri/src/card_sources.rs -o /tmp/card_sources_test && /tmp/card_sources_test
# Tests Rust de la crate entière (lots du téléchargement Magic) : libs système nécessaires
cd src-tauri && cargo test --lib card_data
# Import Magic sur le VRAI fichier Scryfall (~80 Mo, à télécharger d'abord, cf. §5 Magic)
cd app && MTG_GZ=/chemin/default-cards.jsonl.gz npx vitest run test/unit/mtgFullImport.test.ts
# Mise à jour Riftbound sur le VRAI catalogue RiftHunt (réseau, ~15 s)
cd app && RB_LIVE=1 npx vitest run test/unit/riftboundLive.test.ts

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
│   ├── src/lib.rs            # db_name() (test/dev/prod) + enregistrement migrations + commandes
│   ├── src/image_cache.rs    # protocole cardimg (images servies depuis le cache disque, téléchargées au besoin) + commandes taille / vider / élaguer
│   ├── src/card_sources.rs   # (std seul, testé) URL des images par jeu + URL autorisées pour les données de cartes
│   ├── src/card_data.rs      # téléchargement en flux des données en masse (Magic : JSONL gzip) : jsonl_open/next/close, card_data_get
│   ├── src/cache_store.rs    # logique disque du cache (std seul, testée par rustc --test)
│   ├── plugins/card-scanner/ # plugin LOCAL Android : OCR ML Kit (commande `recognize`), Kotlin dans android/
│   ├── plugins/safe-area/    # plugin LOCAL Android : marges système → variables CSS --safe-* (commande `insets`)
│   ├── plugins/google-auth/  # plugin LOCAL Android : connexion Google native (Identity AuthorizationClient), commandes `authorize`, `clear_token`
│   ├── src/google.rs         # commandes google_request (HTTPS vers *.googleapis.com seulement) + oauth_loopback_start/wait
│   ├── src/oauth_loopback.rs # retour OAuth desktop sur 127.0.0.1 (std seul, testé par rustc --test)
│   ├── capabilities/         # default.json, mobile.json (barcode-scanner), android.json (card-scanner, safe-area, google-auth)
│   ├── build.rs              # rerun-if-env-changed=VITE_TEST_MODE
│   └── migrations/
│       ├── user/001_initial.sql, 002_settings.sql, 003_collection_printing.sql,
│       │        004_detach_deleted_collection.sql, 005_binder_slots_multi_copy.sql,
│       │        006_collection_trade_qty.sql, 007_shared_collections.sql,
│       │        008_collection_rarity_edition.sql, 009_sync_state.sql, 010_container_games.sql,
│       │        011_deck_boards.sql
│       ├── ygo/001_initial.sql, 002_printing_rarities.sql, 003_card_contract.sql (vues communes), 004_card_hashes.sql
│       ├── mtg/001_initial.sql   # Magic (Scryfall) : une carte = une impression ; 002_incremental.sql (promo / variation, needs_full)
│       └── riftbound/001_initial.sql  # Riftbound (RiftHunt) : une carte = une impression ; card_legality = vue datée
├── app/                      # racine de config Nuxt (package.json "app", scripts generate/dev/build)
│   ├── pnpm-lock.yaml
│   ├── vitest.config.ts      # alias ~ -> app/app, env node, include test/unit/**
│   ├── test/unit/            # tests Vitest (HORS de app/app, donc pas vus par Nuxt)
│   │   ├── deckLink, collection, decks, containers, share, scan, settings,
│   │   │   search, cardDetail, userSync, drive, backup, perf, multiGame,
│   │   │   mtgImport, mtg, mtgFullImport, riftbound, riftboundLive (.test.ts)
│   │   ├── fixtures/fake-game/   # schéma de la base de cartes du FAUX JEU
│   │   ├── fixtures/scryfall-sample.jsonl  # 36 vraies impressions Scryfall (pièges choisis), aussi utilisé par l'E2E
│   │   ├── fixtures/rifthunt-sample.json   # 59 vraies impressions Riftbound (bulk + objets carte), aussi utilisé par l'E2E
│   │   └── helpers/testDb.ts, seed.ts, ygoCards.ts, fakeGame.ts
│   └── app/                  # ⚠️ DOUBLE app/ : LE CODE SOURCE RÉEL est ici
│       ├── pages/            # decks/[id].vue, decks/index.vue, collection.vue, index.vue,
│       │                     #   search.vue, settings.vue  (PAS de containers.vue)
│       ├── components/
│       ├── composables/useDatabase.ts   # ⚠️ ici (pas services/), parfois importé ~/services/useDatabase
│       ├── composables/useSettings.ts   # store réactif global des settings
│       ├── services/deckLink.ts
│       ├── services/settings.ts, services/game/ (définitions par jeu : types/common/ygo/index)
│       ├── services/game/modules/      # MODULES DE JEU : point d'entrée unique de chaque jeu (index = registre, ygo.ts)
│       ├── services/card/meta.ts       # contrat commun des bases de cartes (root, nom, type, légalité, raretés)
│       ├── services/{card,scan,search}/ygo.ts, services/deck/ygo.ts, services/sync.ts  # tout ce qui est YGO
│       ├── services/{card,scan,search,deck,game}/mtg.ts, services/mtgData/ (import.ts pur, sync.ts)  # tout ce qui est Magic
│       ├── components/MtgSearchFilters.vue  # filtres de recherche Magic (searchFilters.vue = YGO)
│       ├── services/{card,scan,search,deck,game}/riftbound.ts, services/riftboundData/ (import.ts pur, sync.ts)  # tout ce qui est Riftbound
│       ├── components/RiftboundSearchFilters.vue  # filtres de recherche Riftbound
│       ├── utils/hash.ts               # empreinte cyrb53 (mises à jour incrémentales des bases de cartes)
│       ├── services/cardData.ts        # mise à jour de la base de cartes d'un jeu (routeur) + cardDataProgress.ts
│       ├── composables/useCurrentGame.ts, components/GamePicker.vue, GameLaunchModal.vue, utils/gameUi.ts
│       ├── services/imageCache.ts      # wrappers des commandes Rust du cache d'images (taille, vider, élaguer)
│       ├── composables/useCardImage.ts # adresse cardimg:// d'une image de carte (cardImageUrl)
│       ├── components/virtualGrid.vue  # grille/liste virtualisée (@tanstack/vue-virtual) des grandes listes
│       ├── components/collectionCard.vue # carte de la page Collection (props simples : re-rendu ciblé)
│       ├── utils/userWrites.ts         # compteur d'écritures user.db (raccourci de la synchro au retour dans l'appli)
│       ├── services/share/             # partage : codec.ts (format CMSHARE1), frames.ts (QR animé), index.ts (service)
│       ├── pages/share.vue + components/QrScanner.vue   # écran de partage + scanner caméra continu (mobile)
│       ├── services/backup.ts          # sauvegarde fichier : export/import JSON, export CSV, restauration
│       ├── services/userSync/          # synchro ENTRE APPAREILS (≠ services/sync.ts = base de cartes) : tables, snapshot, merge, index, google, drive, cloud
│       ├── composables/useDeviceSync.ts # état global de la synchro (run au lancement, epoch → remontage de page)
│       ├── services/scan/              # OCR : text.ts (codes d'impression, noms, stabilisation), index.ts (identification)
│       ├── pages/scan.vue              # scan de cartes en session (Android)
│       ├── composables/useRearCamera.ts, utils/platform.ts (isAndroid)
│       ├── utils/db-names.ts
│       ├── plugins/test-reset.client.ts # helpers de test (VITE_TEST_MODE)
│       └── app.vue
├── e2e/                      # runner WebdriverIO — utilise npm (package-lock.json), pas pnpm
│   ├── wdio.conf.ts
│   ├── specs/*.spec.ts
│   ├── specs/helpers.ts
│   ├── perf/perf.spec.ts     # OUTIL de mesure (2000 cartes), hors suite : --spec ./perf/perf.spec.ts
│   └── fixtures/             # cards-ygo.test.db (committée), build-fixture.sh, passcodes.txt
├── scripts/android-keystore.sh   # génère la clé de signature APK + affiche les secrets GitHub (cf. §5 Release)
└── .github/workflows/checks.yml, e2e.yml, release.yml
```

**Pièges majeurs :**
- **Double `app/`** : le code vit dans `app/app/`. Ne pas se tromper de niveau.
- **Nommage INCOHÉRENT des composants** (vérifié, respecter le casing réel pour `git add`) :
  - Conteneurs/cartes = **camelCase** : `cardDetail.vue`, `cardThumb.vue`, `artThumb.vue`, `containerTree.vue`, `containerCreateModal.vue`, `containerPicker.vue`, `containerEditModal.vue`, `binderView.vue`, `unrangedCardPicker.vue`.
  - Decks = **PascalCase** : `DeckCard.vue`, `DeckBoard.vue`, `DeckboxRangeModal.vue`.
- **Trois `package.json`** (racine / `app/` / `e2e/`), trois installs distincts.
- La gestion des conteneurs (ContainerTree, BinderView, deckbox/binder/bulk + « non rangées ») vit **dans `collection.vue`**, route `/collection` — il n'y a pas de page dédiée. Vue par défaut : **« Toute ma collection »** (`ALL_ID = '__all__'`, à côté de `UNRANGED_ID` dans `utils/container.ts`). L'accueil `/` redirige vers `/collection`.

---

## 3. Règles impératives (à ne pas violer)

0. **Textes d'interface en anglais** (cf. §0) ; E2E toujours sans texte (§3.2).
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

- **Une base de cartes par jeu** (`GameDefinition.cardDb`, ex. `cards-ygo`), ouverte par `useDatabase().cards(game)` — seul point d'accès. **Contrat commun** (ce que lisent les couches génériques, via `services/card/meta.ts`) : `cards(id, name, image_url*, legal_text)`, `printings`, `printing_rarities`, et deux vues que chaque jeu définit sur son schéma : `card_meta(card_id, root, type)` (une ligne par carte ; `root` = carte logique, les artworks la partagent ; `type` = indication pour le moteur de deck) et `card_legality(card_id, format, status)` (pas de ligne = aucune restriction). YGO : migration `ygo/003`.
- **`cards-mtg.db`** — Magic, importée depuis Scryfall (cf. §5 « Magic »). **Une carte = une impression** (`cards.id` = uuid Scryfall), carte logique (`root`) = `oracle_id`. Tables `mtg_oracle` (règles, `default_print` = impression montrée par la recherche, `deck_limit`), `mtg_prints` (extension, numéro, rareté…), `card_meta` / `card_legality` (**tables** remplies par l'import, pas des vues : jointure trop lente sur 110 000 lignes), `printings` (vue, code « BLB #280 »), `printing_rarities` (vide), FTS `mtg_oracle_fts` (reconstruit à chaque import), `sync_meta` (`db_version` = `updated_at` Scryfall, `synced_at`).
- **`cards-riftbound.db`** — Riftbound, depuis RiftHunt (cf. §5 « Riftbound »). **Une carte = une impression** (`cards.id` = uuid RiftHunt `printing_id`), `root` = `oracle_id`. `cards.name` = nom de la carte logique (sans « (Alternate Art) »), `cards.image_url` = **indice d'image** (chemin relatif envoyé à Rust). Tables `rb_cards` (carte logique : type, supertype Champion/Signature/Token/Basic, `domains` « Fury,Chaos », énergie, power, might, `tags`, `keywords`, texte avec symboles `:rb_*:`, `default_print`), `rb_prints` (extension, numéro imprimé « 001 » / « 299s » / « r01 », id de Riot, rareté, variante, nom imprimé), `rb_legality` (brut : banned / not_legal + `since`), `card_meta` (table, `type` = « Champion Unit »…), `card_hashes`, **vue `card_legality`** (bannissement effectif à sa date `since <= date('now')`, `not_legal` des jetons, `deck_limit` 12 rune / 1 légende ou champ de bataille), `printings` (vue, « OGN #001 »), FTS `rb_cards_fts` (nom, texte, étiquettes), `sync_meta` (`db_version` = `fetched` RiftHunt, `synced_at`, `checked_at`, `full_at`, `sets_sig`).
- **`cards-ygo.db`** — données de référence (lecture seule côté app). Schéma = migration `ygo/001` :
  `cards` + `ygo_details` + `printings` + lookups (`card_types`/`card_attributes`/`card_races`) + `sync_meta` + FTS5 (`cards_fts`, `content=cards`, triggers de synchro).
  - `ygo_details.alias` → passcode « principal » d'une carte à artworks multiples.
  - `ygo_details.banlist_tcg/ocg/md` ∈ {`Forbidden`,`Limited`,`Semi-Limited`,NULL}.
  - Peuplée par une vraie **sync réseau YGOPRODeck** déclenchée dans l'app, **incrémentale** (cf. « Mises à jour des bases de cartes »).
  - `printings.id` = code d'impression : quand un code existe en plusieurs raretés, `printings` n'en garde qu'une (la dernière écrite). **Toutes** les raretés sont dans `printing_rarities(set_code, rarity, rarity_code)` (migration `ygo/002`, remplie par la synchro ; vide sur une base synchronisée avant → la synchro relance **un** téléchargement complet). Lecture : `printingRarities()` / `CardPrinting.rarities` (`services/card/detail.ts`), repli sur `printings.rarity`.
- **`user.db`** — collection, containers, decks, settings. Migrations `user/001` (collection, containers, decks, deck_cards, deckbox_cards, deckbox_decks, binder_slots, bulk_box_contents, *_details, vue `card_locations`), `002` (settings k/v + seed), `003` (`printing_id` sur collection), `004` (nettoyage des assignations d'entrées soft-deleted), `005` (`binder_slots` reconstruite sans `UNIQUE(collection_id)` : plusieurs cases par pile ; vue `card_locations` recréée), `006` (`collection.trade_qty` : copies proposées à l'échange, 0..quantity borné par l'app), `007` (`shared_collections` : collections reçues, une par (jeu, propriétaire), code stocké tel quel), `008` (`collection.rarity` TEXT NULL = non précisée, `collection.first_edition` 0/1), `009` (`sync_state` k/v : `device_id`, `base` = instantané de la dernière synchro, `backup` = état local avant la dernière fusion ; jamais synchronisée), `010` (`containers.games` : jeux d'un rangement, « ygo,mtg », NULL = tous les jeux ; les rangements existants prennent les jeux de leurs cartes), `011` (`deck_cards` reconstruite : `board` accepte tout nom de zone court, `CHECK(length(board) BETWEEN 1 AND 32)`, pour les zones Riftbound ; vue `card_locations` recréée).

**Choix du nom** (`app/app/utils/db-names.ts`, `dbName(base)`) : `.test.db` si `VITE_TEST_MODE==='true'`, `.dev.db` si `import.meta.env.DEV`, sinon `.db`. Exporte `DB_NAMES = {user, ygo}`.
**Côté Rust** (`src-tauri/src/lib.rs`, `db_name()`) : `option_env!("VITE_TEST_MODE")==Some("true")` → `.test.db` ; `cfg!(debug_assertions)` → `.dev.db` ; sinon `.db`.
**`useDatabase.ts`** : cache les connexions via une promesse partagée (une seule init concurrente) ; applique `PRAGMA foreign_keys = ON` par connexion (best-effort) ; `resetDatabaseInstance()` existe. **Requêtes sérialisées par base** (`serialized()`, une à la fois) : tauri-plugin-sql ouvre jusqu'à 10 connexions dès que des requêtes partent en même temps et les prête à tour de rôle (file FIFO de sqlx) → les commandes d'une transaction (`BEGIN`…`COMMIT` : synchro, sauvegarde, imports de cartes) tombaient sur des connexions différentes. Bug réel (nov. 2026) : synchro qui échouait sur le 2e appareil (celui qui intègre les données de l'autre). E2E `db-transaction` le reproduit.

**Procédure de reset dev** (si checksum cassé) : fermer l'app → `rm user.dev.db*` (et/ou `cards-ygo.dev.db*`) → `pnpm dev` recrée à neuf → re-sync des cartes dans l'app si la base ygo a été supprimée → **régénérer la fixture** (`./e2e/fixtures/build-fixture.sh`).

---

## 5. CE QUI EST FAIT

### Phases
Phases 1–4 ✅ · **Phase 5 (OCR) ✅** (fonctionne sur téléphone ; rareté, 1re édition, langue) · Phase 6 ✅ · Phase 7 ✅ · **Phase 8 (Partage) ✅** (scan QR à valider sur téléphone) · **Phase 10 (Testing) ✅** (E2E + unitaires) · **Phase 9 (Settings) en cours** · Phase 2 ✅ (structure, refonte mobile).

### Phase 9 — Settings (en cours)
- `services/game/` : registre par jeu (`GameDefinition` : conditions, langues, défauts). Les couches génériques interrogent le registre, jamais de valeurs YGO en dur.
- `services/settings.ts` (DB + cache) + `composables/useSettings.ts` (store réactif `createGlobalState`, écriture directe, `ensureLoaded()` au boot).
- Défauts d'ajout en collection résolus par jeu (`services/collection.ts`) ; `settings.vue` branchée ; `cardDetail.vue` consomme le registre.
- **Stockage** : taille du cache affichée, vidage, limite appliquée (LRU par mtime : un fichier relu est « touché ») à l'enregistrement et au lancement, au plus une fois par jour (`app.vue` → `pruneImageCache`, `localStorage.imageCachePrunedAt`). Une image supprimée du disque est retéléchargée à sa prochaine demande (protocole `cardimg`, cf. « Performances »).
- **Synchronisation** : version locale affichée (numéro YGOPRODeck, ou date de la dernière mise à jour pour Magic), « Check for updates » et « Download everything again » (`force`), bilan en notification (`CardDataReport` : nouvelles / modifiées / retirées), progression `[data-sync-status]`.
- **Partage** (nom affiché, même réglage que la page Partage) et **Apparence** (thème système / clair / sombre, `useColorMode`) : sections ajoutées avec la refonte mobile (plus de bouton de thème dans l'en-tête sur mobile).
- `favoriteGame` / `showGamePicker` sont consommés par `useCurrentGame` (jeu ouvert au lancement, fenêtre « Which game? ») ; invisibles tant qu'il n'y a qu'un jeu.

### Magic: The Gathering (nov. 2026) — 2e jeu, choisi par Félix
- **Données** : Scryfall, fichier en masse `default_cards` (chaque impression papier, en anglais ou dans sa seule langue) en **JSONL gzip** (~80 Mo, 650 Mo décompressé, ~120 000 objets). Métadonnées : `GET https://api.scryfall.com/bulk-data/default-cards` (`updated_at`, `jsonl_download_uri`) via la commande Rust `card_data_get` (User-Agent requis par Scryfall). Téléchargement : `jsonl_open(url, keys)` → `jsonl_next(id)` → … : un fil Rust lit HTTP → gzip → lignes, garde les clés demandées (`SCRYFALL_KEYS`) et envoie des lots de 500 par un canal **borné** (4 lots) : le téléchargement avance au rythme des écritures, jamais tout en mémoire. URL limitées à `card_sources::card_data_url_allowed` (api.scryfall.com, data.scryfall.io).
- **Import** (`services/mtgData/`) : `import.ts` (pur) : on écarte le numérique seul (`digital` / pas `paper`) et les Art Series ; faces jointes par « // » ; restrictions des formats suivis (banned / restricted / not_legal) ; `deck_limit` (-1 terrains de base et « any number of cards named », 7 Seven Dwarves, 9 Nazgûl) ; impression par défaut = extension normale, numéro simple, pas promo/variante, anglais, la plus récente. `sync.ts` : une transaction (DELETE puis INSERT par lots, l'ancienne base reste lisible jusqu'au COMMIT, ROLLBACK si erreur), cartes logiques et légalités à la fin, `rebuild` FTS. Mesure sur le vrai fichier (nov. 2026) : 108 000 impressions, 36 000 cartes, ~12 s en Node, ~1 060 requêtes.
- **Mises à jour** : incrémentales, cf. « Mises à jour des bases de cartes ». Première bascule sur Magic = téléchargement initial, en arrière-plan comme tout le reste.
- **Images** : `https://cards.scryfall.io/{small|normal|art_crop}/front/a/b/<uuid>.jpg`, déduites de l'id (`card_sources::image_source`), cache `card-images/mtg/<size>/`.
- **Deck** (`deck/mtg.ts`) : zones main (60+), side (15), commander (0–2, `pickable` : on y place une carte à la main, menu « Move to Commander ») ; formats casual (défaut, 4 copies), standard, pioneer, modern, legacy, vintage, pauper, commander (1 copie) ; banned / not_legal → 0, restricted → 1, `deck_limit` prioritaire. Messages via `DeckEngine.limitLabel` / `limitMessage`.
- **Recherche** (`search/mtg.ts`) : une ligne par carte logique (impression par défaut), FTS nom ou texte (mots entre guillemets, préfixe), nom exact en tête ; filtres couleurs (« a toutes ces couleurs »), incolore, types (OU), valeur de mana, légal dans un format (`MtgSearchFilters.vue`, `[data-mtg-filters]`, `[data-mtg-color]`, `#mtg-format-filter`).
- **Fiche** (`card/mtg.ts`) : toutes les impressions de la carte, chacune est une carte (`CardPrinting.cardId`) → `cardDetail.vue` montre `#card-printing-select` : choisir l'impression change l'image, les exemplaires comptés et ce qui est ajouté (**compteur et liste « My copies » = toute la carte logique**, toutes impressions / artworks confondus : `entriesForCards`, `[data-owned-count]` = total, `[data-owned-here]` = impression affichée, exemplaire d'une autre impression `[data-entry-variant]` cliquable ; bug corrigé nov. 2026 : une 2e impression ajoutée n'était pas comptée) (`printingId` = la carte, rareté de l'impression). Pas de « 1st edition » (`GameDefinition.firstEdition` = YGO seulement). Mentions Banned / Restricted in … et Reserved List.
- **Scan** (`scan/mtg.ts`) : bas à gauche des cartes récentes, « BLB • EN » (extension + langue, point souvent mal lu) + numéro (« 0280 », « 280/281 ») → impression exacte et sa langue ; plusieurs numéros plausibles → celle dont le nom ressemble au nom lu ; sinon le nom (faces comprises) → impression par défaut. `Identified.printingLabel` (« BLB #280 ») affiché dans la session.
- **Partage** : ids uuid → `CMSHARE2` (~37 car. par carte : 1000 cartes ≈ 40 images de QR animé).
- **Tests** : `mtgImport.test.ts` (mapping, import, remplacement, erreur → ancienne base gardée, mises à jour espacées), `mtg.test.ts` (recherche, filtres, fiche, règles par format, collection, partage, scan), `mtgFullImport.test.ts` (vrai fichier, si `MTG_GZ`), E2E `mtg` (bascule de jeu, `window.__seedMtg(objets)` = vrai importeur sans réseau, fiche + choix d'impression, deck).
- **À valider sur appareil** : téléchargement réel (80 Mo, durée sur téléphone), images Scryfall, scan sur de vraies cartes Magic.

### Riftbound (nov. 2026) — 3e jeu, demandé par Félix
- **Données** : **RiftHunt** (api.rifthunt.com : gratuit, sans clé, usage commercial permis, « fan content » Riot ; demande un User-Agent qui nomme le projet → commande Rust `card_data_get`, hôte autorisé dans `card_sources::card_data_url_allowed`, et **au plus un téléchargement du catalogue par jour**). Riftcodex (autre API) écarté : ~90 s par page de 100. Sources : `/bulk/cards` (1 requête, ~2 Mo : supertype, étiquettes de Riot, dates des extensions) + `/cards/search?q=set:<code>&unique=prints` par extension (pages de 175, ~15 pages : numéro imprimé, mots-clés, légalités, images), joints sur `printing_id` ; `/sets` (signature des extensions) ; `banned:any` + `banned:upcoming` (bannissements). 429 / 50x → nouvel essai après 2, 4, 8, 16 s ; 300 ms entre deux pages.
- **Import** (`services/riftboundData/import.ts`, pur) : impression par défaut = variante `base` (RiftHunt en marque une par carte), sinon pas promo, pas variante, la plus ancienne ; numéro d'après l'id de Riot si l'API ne le donne pas (`collectorFromRiotId`) ; indice d'image = `images.small` sans le préfixe `https://images.rifthunt.com/cards/small/front/` (`imageHint`, mêmes caractères permis que `card_sources::is_safe_hint`).
- **Mise à jour** (`sync.ts`) : au lancement au plus toutes les `AUTO_HOURS` = 24 h ; `/sets` inchangé et catalogue relu il y a moins de `FULL_DAYS` = 30 j → bannissements seuls (`writeBans`, garde les `not_legal` des jetons) ; sinon catalogue complet comparé impression par impression (`printHash` = impression + carte logique + « par défaut ») → `writeRiftbound` n'écrit que le nouveau / modifié, supprime le disparu, réécrit les cartes logiques touchées, reconstruit le FTS. Mesure sur le vrai catalogue (nov. 2026) : 1 732 impressions, 1 112 cartes, ~13 s (surtout l'attente entre pages), 41 requêtes SQL ; 2e passage : 0 écriture.
- **Images** : l'URL ne se déduit pas de l'id (extension / numéro / nom / `?v=`) → **indices** : après chaque mise à jour, le front envoie `{ id: indice }` à Rust (`image_sources_set`, fichier `<app_data_dir>/image-sources/riftbound.json`, hors du cache d'images : le vider ne les perd pas ; `image_sources_count` pour les renvoyer s'ils manquent). `card_sources::needs_hint` / `image_source(…, hint)` → `https://images.rifthunt.com/cards/{small|normal}/front/<indice>` (WebP 200 / 480 px), cache `card-images/riftbound/<size>/`. Type MIME deviné des octets (`image_mime` : JPEG / PNG / WebP). Une image dont le `?v=` change garde l'ancienne copie en cache (même id).
- **Deck** (`deck/riftbound.ts`, règles officielles 103) : zones `legend` (1), `champion` (1, `pickable` : menu « Move to Chosen Champion »), `main` (39+ : 40 avec le champion), `runes` (12), `battlefields` (3), `side` (≤ 8). Placement auto par `card_meta.type` (Legend / Rune / Battlefield). Limites : 3 par nom (toutes zones), `deck_limit` (rune 12, légende / champ de bataille 1), banned → 0 (sauf format `casual`), jeton → 0 toujours. Formats standard (défaut), 2v2, casual. **Règles du deck entier** via le nouveau hook générique `DeckEngine.deckIssues` (async, lit la base du jeu ; `getDeckState().issues`, alerte `[data-deck-issues]` avec `[data-deck-issue=<code>]`, cartes en cause `[data-warned]` encadrées) : codes `legend`, `champion` (champion d'une autre légende, pas une unité Champion), `main`, `runes`, `battlefields`, `side`, `zone` (carte dans la mauvaise zone), `signatures` (> 3), `signature-tag` (signature d'une autre légende), `identity` (domaines hors de ceux de la légende ; multi-domaines = tous requis ; incolore partout).
- **Recherche** (`search/riftbound.ts`) : une ligne par carte logique, FTS nom (ou texte + étiquettes), nom exact puis « Nom, … » en tête ; filtres domaines (tous requis), incolore, types (OU), supertype, énergie, puissance, extension, légal dans un format (`RiftboundSearchFilters.vue`, `[data-rb-filters]`, `[data-rb-domain]`, `[data-rb-type]`, `#rb-supertype-filter`, `#rb-set-filter`, `#rb-format-filter`).
- **Fiche** (`card/riftbound.ts`) : toutes les impressions (`CardPrinting.cardId`), libellé « Origins · Alternate Art » / « · Metal » ; titre = nom imprimé ; texte avec symboles lisibles (`readableText` : `[2]`, `[Fury]`, `[Any rune]`, `[Might]`) ; badges Banned in Standard / 2v2, bannissement annoncé (« from <date> »), jeton.
- **Scan** (`scan/riftbound.ts`) : bas de carte « UNL • 131/219 » (« 007a/298 », « 299*/298 », ★ lu) ; le texte est minuscule → lecture tolérante appuyée sur la base (`knownSets` : codes d'extension + tailles tirées des ids de Riot, en cache 1 min) : « / » lu 1 / l / I / | accepté **seulement** devant une taille connue, « • » sauté, O/I/l/S/B → 0/1/1/5/8, taille gardée sur 3 chiffres (« 024 » : Proving Grounds). L'id de Riot (`unl-131-219`) contient numéro **et** taille → impression trouvée même sans code d'extension lisible ; taille illisible → code d'extension + numéro, accepté seulement si le nom lu ressemble ; plusieurs (promos Metal qui partagent l'id) → code d'extension lu, nom lu, pas promo, impression par défaut. Sinon le nom : lignes du haut **et lignes voisines recollées** (`nameGuesses` : les champions impriment « Jinx » / « REBEL » sur deux lignes), partie avant la virgule tolérée (pénalisée).
- **Tests** : `cardDisplay.test.ts` (format par jeu, `fitStyle`, 1re installation en arrière-plan via `syncCardData`) ; `riftbound.test.ts` (18, scan avec lecture OCR imparfaite et noms sur deux lignes ; import, outils, légalités datées, incrémental, vérification quotidienne / catalogue / force / 30 j, `syncRiftbound` + indices, recherche + filtres, fiche, limites, deck légal + chaque règle, identité / signatures / zones, collection + partage v2, scan), `riftboundLive.test.ts` (vrai catalogue si `RB_LIVE=1`), migration user 011 (`decks.test.ts`), E2E `riftbound` (`window.__seedRiftbound(échantillon)`), `card_sources.rs` (indices refusés, MIME).
- **À valider sur appareil** : téléchargement réel au premier passage, images, scan de vraies cartes (format exact du bas de carte supposé « OGN • 030/298 »).

### Mises à jour des bases de cartes (nov. 2026) — incrémentales, en arrière-plan
- **Principe** : n'écrire que ce qui a changé ; **tout se fait en arrière-plan, même la 1re installation d'une base, pour tous les jeux** (décision de Félix, nov. 2026 : plus d'écran bloquant). Pastille commune `[data-card-update]` (`[data-first-install]` pendant une installation ; nom du jeu affiché) ; cartes consultables pendant une mise à jour (une transaction, l'ancienne base reste lisible). Le routeur `syncCardData` (`services/cardData.ts`) pose `syncingGame` / `syncFirstInstall` et, à la fin d'une installation réussie, incrémente `cardDataInstalled` (dans la clé de page d'`app.vue` → la page relit ses cartes). Pendant l'installation, la recherche et le panneau de recherche du deck affichent `CardDataPending.vue` (`[data-card-data-pending]`, progression) au lieu de « rien trouvé ». Échec → notification avec « Retry » (sinon au prochain lancement ou Réglages → Check for updates). Les sources (`syncYgo`, `syncMtg`, `syncRiftbound`) ne gèrent plus l'affichage. Une mise à jour à la fois : `syncCardData` met les demandes en file (changer de jeu pendant une mise à jour télécharge quand même la base du nouveau jeu ensuite). `CardDataSource.sync` renvoie un `CardDataReport { changed, removed }`.
- **Yu-Gi-Oh!** (`services/sync.ts`) : à chaque lancement, `checkDBVer` (une petite requête) ; version changée → fichier complet (~3,5 Mo compressés, 14 855 cartes, 47 137 impressions, YGOPRODeck n'a pas de « modifié depuis » : ses dates sont des dates de sortie) **comparé carte par carte** : `cardHash` (cyrb53 de tout ce qui est écrit, **sauf les prix**, non affichés) vs `card_hashes` (migration ygo 004) → `planYgoUpdate` → `writeYgoUpdate` n'écrit que les cartes nouvelles / modifiées (cartes, détails, impressions, raretés) et supprime les disparues (FTS par triggers). Base d'avant les empreintes : réécrite une fois. `force` : tout réécrire.
- **Magic** (`services/mtgData/sync.ts`) : au lancement, rien avant `AUTO_DAYS` = 7 jours (aucune requête). Ensuite **incrémental** (`updateMtgIncremental`, sources injectées) : 1) nouvelles impressions par la recherche Scryfall (`recentPrintsUrl` : `date>=… game:paper`, `unique=prints`, extras et variantes, pages de 175, 120 ms entre pages, 404 = rien de neuf ; fenêtre `recentWindowStart` = dernière mise à jour − 21 j, au plus 60 j ; ~1 600 impressions sur 4 semaines) ; 2) règles et légalités (errata, bannissements, rotations) depuis `oracle_cards` (~25 Mo, flux Rust) tous les `ORACLE_DAYS` = 30 j ; 3) impression par défaut recalculée (`recomputeDefaults`, d'où `promo` / `variation` en base, migration mtg 002) et FTS reconstruit. **Complet** (`importMtg`, default_cards ~80 Mo) : installation, « Force », `needs_full` (posé par la migration mtg 002 sur une base remplie) et tous les `FULL_DAYS` = 90 j (impressions ajoutées tard ou seulement en langue étrangère, suppressions). `sync_meta` : `db_version`, `synced_at`, `full_at`, `oracle_at`, `needs_full`.
- **Tests** : `ygoSync.test.ts` (rien à écrire si rien n'a changé, prix ignorés, errata / banlist / nouvelle rareté, carte retirée partout, force, base sans empreintes, `syncYgo` avec `fetch` simulé) ; `mtgImport.test.ts` (**base incrémentale = import complet**, ligne pour ligne ; rien de neuf ; doublons ; bannissement par oracle_cards ; fenêtre ; URL ; migration 002 ; routage complet / incrémental).

### Multi-jeu (préparé, nov. 2026)
- **Module de jeu** (`services/game/modules/`) : `GameModule { def, deck, search, detail, scan?, cardData? }` ; `registerGameModule` (aussi pour les tests), `gameModule(game)`. Les routeurs (`deckEngine`, `searchCards`, `getCardDetail`, `canScan`/`identifyCard`, `syncCardData`) passent par lui. Checklist « ajouter un jeu » en tête de `modules/index.ts` (définition, migrations + `lib.rs`, module, une branche dans `image_cache.rs`, panneau de filtres facultatif dans `utils/gameUi.ts`).
- **Contraintes de user.db** à respecter par un jeu : états = sous-ensemble de NM/LP/MP/HP/DMG (CHECK de `collection.condition`, libellés libres), zones de deck : tout nom court (migration user 011), à déclarer dans le type `Board` (`deck/types.ts`). Règles qui portent sur le deck entier : `DeckEngine.deckIssues` (facultatif). Images non déductibles de l'id : indices (`card_sources::needs_hint`, `image_sources_set`).
- **Jeu courant** : `useCurrentGame()` (choix de session, sinon jeu favori, sinon le 1er). Les pages lisent `const GAME = useCurrentGame().game.value` ; changer de jeu **remonte la page** (clé de page d'`app.vue`) et relance la mise à jour de sa base de cartes. `GamePicker` (en-tête desktop, titre de Collection mobile, `#game-picker`) et `GameLaunchModal` (`[data-game-choice]`, `#game-launch-remember`) n'apparaissent qu'avec plusieurs jeux.
- **Format des cartes** : `GameDefinition.cardAspect` (largeur / hauteur ; défaut `CARD_ASPECT_STANDARD` = 63/88, YGO 59/86) → `cardAspectOf(game)`, `useCurrentGame().cardAspect`, variable CSS `--card-aspect` posée par `app.vue` ; utilitaires Tailwind `aspect-card` / `aspect-card-landscape` (`main.css`). **Jamais de proportion en dur** (`aspect-[0.686]` a disparu) ; `VirtualGrid` estime ses lignes avec le format du jeu ; cadre de scan idem.
- **Cartes imprimées en paysage** (champs de bataille Riftbound, comme RiftHunt / les images de Riot en 1039×744) : dans une case portrait (grilles, classeurs, recherche du deck), l'image est **tournée d'un quart de tour** pour la remplir (`composables/useCardFit.ts`, `fitStyle` pur et testé : orientation de l'image comparée à celle de sa case au chargement, rien à savoir d'avance ; `ArtThumb :rotate="false"` pour un recadrage voulu, ex. couverture de deck ; `img-class`). Fiche : `CardDetail.landscape` → cadre paysage (`[data-landscape]`). Deck : `BoardDef.landscape` → cases paysage, moins de colonnes (zone Battlefields).
- **Génériques** : collection, rangements, decks (zones et limites lues dans le moteur ; `getDeckContents` / `validateDeck` / `planDeckToDeckbox` déduisent le jeu du deck), partage, sauvegarde (CSV : noms par jeu), fiche carte (`CardDetail.facts` / `badges` fournis par le module), images (protocole `cardimg://<jeu>/<taille>/<id>`, `cardImageUrl` / `useCardImage`, ids filtrés par `cache_store::parse_image_path` / `is_safe_name`, YGO garde son dossier de cache historique).
- **Partage v2** : `CMSHARE2:` pour les ids non numériques (ids triés, préfixe commun + reste en UTF-8) ; l'encodeur garde v1 dès que tous les ids sont numériques. QR animé : morceaux = code sans `CMSHARE1:` (v1, compatible avec les versions précédentes) ou sans `CMSHARE` (« 2:… »).
- **Faux jeu de test** (`helpers/fakeGame.ts` + `fixtures/fake-game/001_cards.sql`, ids texte, variantes sans alias, interdictions par format, héros en zone commander) : `multiGame.test.ts` le fait traverser collection, rangements, decks, rangement deck → deckbox, recherche, fiche, raretés, partage v2 + QR animé, CSV, synchro entre appareils. **Garde** dans le même fichier : aucun `'ygo'` / `ygo_details` / `ygoprodeck` hors des fichiers propres à YGO (liste `YGO_FILES`).

### Collection (Phase 4)
- **Toute ma collection** : `listCollectionCards(game, { search, onlyTrade, sort })` (`services/collection.ts`) — une ligne par carte logique (artworks regroupés, vignette = artwork le plus possédé), quantités possédée / à l'échange / non rangée ; tri nom / quantité / ajout récent. Barre de filtres dans `collection.vue` (recherche debounced 250 ms).
- **À l'échange** : `trade_qty` par pile, édité dans la fiche carte (`#entry-trade-qty-input`), borné à la quantité (à l'ajout, à la modification, et quand la quantité baisse). Prérequis du partage (Phase 8). La vente n'est pas modélisée (pas de prix) : à ajouter le jour où on en a besoin.

### Rangements par jeu (nov. 2026)
- Un rangement est associé à **aucun, un ou plusieurs jeux** (`containers.games`, `encodeGames` / `decodeGames`, `containerInGame` dans `services/containers.ts`) ; aucun = proposé partout. À la création, le jeu affiché est coché par défaut (`containerGameSelect.vue`, `[data-container-game-option]`, `[data-selected]`), modifiable dans « Edit » (`#container-edit-save`).
- Liste (`containerTree.vue`) : « This game » / « All games » (`[data-storage-filter=game|all]`, mémorisé en `localStorage.storageShowAllGames`) ; en « All games », ceux du jeu affiché d'abord, puis par jeu, badge `[data-container-games]` (« YGO · MTG »). Les choix de rangement (`listContainers(game)` / `listContainersWithCapacity(game)` : fiche carte, sélection, deck → deckbox, ajout groupé) ne proposent que ceux du jeu. Les cartes déjà rangées ne bougent pas.
- Tests : `containers.test.ts` (encodage, filtres, migration 010), `userSync.test.ts` (synchro des jeux), E2E `container-games`.

### Recherche : sélection multiple (nov. 2026)
- `#search-select-btn` (`[data-active]`) : un clic coche au lieu d'ouvrir la fiche (`CardGrid` `selectable` / `selectedIds`, `.card-thumb[data-selected]`) ; sélection gardée entre pages et recherches ; barre `#search-selection-bar[data-selected-count]`, `#search-clear-selection`, `#search-add-selected`.
- Ajout groupé : `#search-batch-qty` (copies de chaque carte), `#search-batch-storage` (rangement du jeu, facultatif), `#search-batch-confirm` → `addCard` (défauts du jeu) puis `assignCardToContainer`. `.card-thumb[data-owned]` = carte possédée. E2E `search-select`.

### Partage de collection (Phase 8) — **sans serveur** (choix de Félix : pas d'hébergement)
- **But** : montrer à un autre joueur ma collection et ce que je propose à l'échange ; il la voit croisée avec la sienne (« tu l'as ×n » / « manquante »).
- **Format** (`services/share/codec.ts`) : `CMSHARE1:` + base32( deflateRaw( binaire ) ). Binaire = jeu, nom, date, puis par carte (triée) écart d'id + quantité + quantité à l'échange, en varints. Base32 majuscule → jeu **alphanumérique QR** (mode le plus dense) et robuste au copier-coller (décodage insensible à la casse et aux espaces). Ids numériques canoniques uniquement (passcodes YGO) ; un jeu à ids non numériques demandera un `CMSHARE2`. ~5,7 car./carte : 1000 cartes ≈ 5,7 k car.
- **QR animé** (`frames.ts`) : le code est découpé en images `CMSQ:<lot>:<i>:<n>:<morceau>` (~700 car., QR peu dense) affichées en boucle à 4 images/s ; `FrameAssembler` les réassemble dans n'importe quel ordre (lot = empreinte FNV pour ne pas mélanger deux partages). 1000 cartes ≈ 9 images (~2 s), 5000 ≈ 36 (~9 s). Un code complet scanné directement est accepté aussi.
- **Transports** : face à face → QR animé ; à distance → « Copier le code » envoyé par messagerie et collé côté récepteur (`#share-import-input`). Pas de relais en ligne, pas de Wi-Fi local, pas de Bluetooth (écartés : hébergement refusé / réseau commun rarement dispo / plugin natif intestable).
- **Scanner** (`QrScanner.vue`, Android seulement — détecté par l'user agent) : `getUserMedia` caméra arrière dans la WebView, `BarcodeDetector` si dispo sinon `jsQR`, ~10 décodages/s. La permission passe par le plugin officiel **barcode-scanner** (dépendance Rust mobile-only + capability `capabilities/mobile.json`) : il déclare `CAMERA` dans le manifeste et sert à `requestPermissions()` ; `wry` accorde ensuite `VIDEO_CAPTURE` à la WebView. Sa fonction `scan()` n'est **pas** utilisée (s'arrête au premier QR, inadapté au QR animé). **Non testable ici** : à valider sur téléphone.
- **Service** (`share/index.ts`) : `buildMyShare` / `shareCode` (option « à l'échange uniquement », nom mémorisé dans le setting `share_owner_name`), `resolveShare` (noms, artworks regroupés, croisement par carte logique), `saveShare` (remplace pour le même joueur), `listSavedShares` / `loadSavedShare` / `deleteSavedShare`.
- **Versions plugin** : le CLI Tauri refuse un écart majeur/mineur entre crate et paquet npm d'un même plugin → `tauri-plugin-barcode-scanner = "~2.4"` (Cargo) et `@tauri-apps/plugin-barcode-scanner ~2.4.6` (npm), à monter ensemble.

### Scan de cartes OCR (Phase 5) — Android uniquement
- **Chaîne** : caméra arrière dans la WebView (`useRearCamera`, même permission que le scan QR) → image JPEG base64 toutes les ~250 ms → `invoke('plugin:card-scanner|recognize', { image })` → lignes de texte + positions (ML Kit) → `identifyCard(game, lignes)` → `ScanStabilizer` (2 images identiques de suite) → `addCard` avec les défauts du jeu → liste de session avec annulation (`removeCard`).
- **Plugin local** `src-tauri/plugins/card-scanner` : crate Rust minimale (enregistre `app.cardmanager.cardscanner.CardScannerPlugin`), Kotlin avec **ML Kit text-recognition 16.0.1 embarqué** (hors ligne, ~11 Mo de modèle dans l'APK). Dépendance de l'app **Android seulement** (`[target.'cfg(target_os = "android")'.dependencies]`, `#[cfg(target_os = "android")]` dans `lib.rs`), capability `capabilities/android.json`. Les commandes non définies en Rust sont routées vers le Kotlin par Tauri. Le build Android local a vérifié que le Kotlin compile et que la classe + le modèle sont dans l'APK ; **comportement réel à valider sur téléphone**.
- **Identification YGO** (`services/scan`) : 1) **code d'impression** extrait par regex tolérante (régions EN/FR/F/…/absente, confusions OCR O→0, I/L→1, S→5, B→8 dans les chiffres) puis cherché dans `printings` par clé sans région (préférence à l'impression `-EN`) → carte **et** impression ; 2) sinon le **nom** (lignes du haut, surtout des lettres) → FTS puis similarité de Levenshtein ≥ 0,8, ramené à l'artwork principal (alias). Moteur par jeu (`canScan(game)`).
- **1re édition** : `detectFirstEdition` (« 1st Edition », « 1re Édition », « 1. Auflage », « 1a Edizione », « 1ª Edición », « 1ª Edição », confusions OCR l/I/1) → `Identified.firstEdition`. La mention est petite : une carte vue avec elle sur une des 4 dernières images la garde. Modifiable d'un geste dans la liste de session.
- **Rareté** : à l'ajout, `printingRarities(printingId)` ; une seule → enregistrée ; plusieurs → choix dans la liste de session (`USelect` « Rareté ? »). Le choix et la 1re édition passent par `updateCard`. Ligne de session = `components/ScanSessionItem.vue` (`[data-scan-rarity]`, `[data-scan-first-edition]`, `[data-scan-rarity-select]`, `[data-scan-first-edition-toggle]`).
- **Recadrage** : l'OCR ne reçoit que la zone du cadre de visée + 15 % de marge (`frameCrop()` refait le calcul inverse d'`object-cover`), en 1600 px : texte plus grand, image plus légère.
- **Relecture de près** (nov. 2026, retour de Félix : la ligne « SFD • 227/221 » n'était jamais lue, image de 719 px) : caméra demandée en 4K (`useRearCamera`, `width 3840 / height 2160` idéals) ; et quand la carte entière ne donne pas l'impression, la **zone du jeu** où est imprimé le numéro (`GameModule.scanZones`, fractions de la carte : Riftbound et Magic bas gauche, YGO sous l'illustration à droite) est recadrée (`frameCrop(zone)`, marge 6 %), **agrandie** jusqu'à 1600 px (`grab(…, upscale)`), passée en gris + contraste étiré (`utils/imageEnhance.ts`, `enhanceForOcr`, testé), relue par ML Kit, puis ses lignes sont ajoutées sous celles de la carte (`withZoneLines` : jamais prises pour le nom). Une zone par image (alternance s'il y en a plusieurs). Diagnostic : « zoom <taille> » + lignes lues. Hook de test : `window.__scanFeed(lignes, lignesDeZone?)` (E2E `scan`, dernier cas).
- **Langue** : la région du code d'impression donne la langue de la carte (`regionLanguage` dans `services/scan/text.ts` : EN/E/AE/sans région → en, FR/F/FC → fr, DE/G → de, IT/I → it, SP/S → es, PT/P → pt, JP → ja, KR → ko ; autre → null). `Identified.language` est passé à `addCard` (sinon langue par défaut du jeu). Le passcode et le nom sont identiques dans toutes les langues → pas de langue déduite. `[data-scan-language]` sur chaque carte ajoutée.
- **Stabilisation** : une carte n'est ajoutée qu'après 2 images identiques, et ne l'est à nouveau qu'après avoir quitté l'image 3 images (pour scanner plusieurs exemplaires à la suite). Mode manuel : `#scan-auto-add` désactivé → bouton `#scan-add-btn`.
- **Test** : en `VITE_TEST_MODE`, la page expose `window.__scanFeed(lignes)` qui alimente la vraie chaîne (sans caméra ni ML Kit) → E2E `scan`. Accès : bouton central de la barre d'onglets (`[data-tab=scan]`, Android seulement) ou `#scan-open-btn` dans `/collection` (desktop), route `/scan`.
- **Diagnostic** (bouton insecte en haut de l'écran de scan) : `#scan-debug` affiche caméra active, nombre d'images analysées, durée OCR, taille d'image, texte lu et résultat — pour comprendre un échec sur téléphone.

### Synchro entre appareils (PC ↔ téléphone) — faite (à valider sur PC + téléphone réels)
- **Modèle repris de kechimochi** (github.com/Morgawr/kechimochi, `src-tauri/src/sync_*.rs`) : un état publié unique dans le dossier caché Drive (`appDataFolder`, scope `drive.appdata`), écriture conditionnelle (ETag), fusion à trois avec une base locale, sauvegarde avant fusion. Chez eux, un client OAuth « bureau » (loopback 127.0.0.1 + PKCE) et un client « Android » (Identity `AuthorizationClient`, paquet + SHA-1 de la clé de signature) du même projet Google Cloud voient le même `appDataFolder`.
- **`services/userSync/`** :
  - `tables.ts` : `SYNC_TABLES` (ordre parents → enfants, clé, colonne d'horodatage, filtre, `replaceOnUpdate` pour les unicités secondaires, clés étrangères). Réglages synchronisés : nom de partage, jeu favori, défauts d'ajout par jeu ; pas la limite du cache. **`USER_SCHEMA_VERSION` = nombre de migrations user/** (un test le vérifie : à incrémenter avec chaque migration).
  - `merge.ts` (pur) : `mergeTables(base|null, local, remote)` ligne puis colonne ; changé d'un seul côté → repris ; absent d'un côté et présent dans la base → supprimé ; vrai conflit → horodatage le plus récent, sinon le distant ; modification > suppression ; sans base (1re synchro) → union. `repairTables` rétablit les règles : clés étrangères, rangements d'une carte retirée, une carte par case de classeur (la publiée gagne), une collection reçue par joueur, copies rangées ≤ quantité, `trade_qty` ≤ quantité.
  - `snapshot.ts` : `takeSnapshot` / `applySnapshot` (une transaction ; colonnes inconnues localement ignorées ; colonnes absentes d'un instantané plus ancien = inchangées).
  - `index.ts` : `syncNow(transport)` : instantané + base + état publié → fusion → sauvegarde → application → publication conditionnelle (refusée = on refusionne, 4 essais) → nouvelle base. `SyncTransport { pull, push(snapshot, expectedVersion) }` ; `MemoryTransport` pour les tests. État publié d'une appli plus récente → `SyncError('REMOTE_NEWER')`.
- **Pas de tombstones** : la base de la fusion à trois suffit à détecter les suppressions (les tables principales ont déjà `deleted_at`, les liaisons sont supprimées en dur).
- **Compte Google** (`google.ts`) :
  - **PC** : flux « appli installée » : `oauth_loopback_start` (port libre sur 127.0.0.1) → navigateur (`plugin-opener`) sur accounts.google.com avec PKCE S256 + `state` → `oauth_loopback_wait` lit `?code` → échange contre jetons (`oauth2.googleapis.com/token`, client_id + client_secret du client « bureau »). Jeton de renouvellement dans `sync_state.google_account` ; renouvelé automatiquement ; `invalid_grant` → compte oublié (NOT_CONNECTED).
  - **Android** : plugin local `google-auth` (Play Services `AuthorizationClient`, scopes `drive.appdata` + `userinfo.email`) ; reconnu par paquet `com.card_manager.app` + SHA-1 de la clé de release ; jeton redemandé sans écran (`allowInteraction:false`).
  - Toutes les requêtes passent par la commande Rust `google_request` (pas de CORS ; refuse tout ce qui n'est pas `https://oauth2.googleapis.com/` ou `https://www.googleapis.com/`). Un **client HTTP partagé** (`src-tauri/src/http.rs`, aussi pour les images) garde les connexions ouvertes : un client par requête refaisait DNS + TLS à chaque fois (6 requêtes : 1,0 s → 0,3 s mesuré depuis un serveur, bien plus sur téléphone). Erreur réseau : `google_request` renvoie toute la chaîne des causes ; `syncErrorMessage` affiche l'erreur brute quand ce n'est pas une erreur prévue.
- **Transport Drive** (`drive.ts`) : un fichier `card-manager-sync.json` dans `appDataFolder`. Lecture : ETag via **API v2** (`/drive/v2/files/{id}?fields=etag`, v3 n'a plus d'ETag) avant/après téléchargement. Écriture : `PUT /upload/drive/v2/files/{id}` + `If-Match` → **412** si un autre appareil a écrit → refusion. Création : si deux appareils créent en même temps, le plus récent supprime le sien. Version = `fileId|etag`.
- **Synchro sans changement** : `SyncTransport.version()` (facultatif) ; si la version publiée = `sync_state.base_version` et que rien n'a changé localement depuis la base → arrêt immédiat (pas de téléchargement, pas de réécriture de la base). `push` renvoie `{ ok, version }` : sur Drive, la version vient de la réponse du `PUT …?fields=etag` (celle réellement écrite, jamais celle d'une écriture concurrente) ; après une création, version inconnue (`null`) → lue à la synchro suivante. La base n'est réécrite que si elle a changé.
- **`cloud.ts`** : `syncWithGoogle()` + `lastSync()` (`sync_state.last_sync`). **`useDeviceSync`** : `run(silent)` (au lancement dans `app.vue`, hors mode test) ; `epoch` incrémenté si la base locale a changé → `NuxtPage :page-key` remonte la page.
- **Écran** : Réglages → « Synchronisation » (1re section) : `#gsync-connect`, `#gsync-now`, `#gsync-disconnect`, `[data-gsync-email]`, `[data-gsync-last]`. Déconnexion = oubli du compte **et** de la base (une reconnexion repart d'une union : rien n'est supprimé).
- **Build** : le PC a besoin de `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET` (client « bureau », secrets GitHub `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) au `nuxt generate`. `release.yml` les passe (décision de Félix, 9 nov. 2026) : le secret est donc lisible dans l'AppImage publique, ce que Google admet pour une appli installée (il ne donne accès à aucune donnée sans la connexion de l'utilisateur). En cas d'abus : régénérer le secret dans Google Cloud puis mettre à jour le secret GitHub. Sans eux (dev local, E2E) : « Non disponible dans cette version » sur PC ; Android fonctionne quand même (pas d'identifiant nécessaire). Le secret `GOOGLE_ANDROID_CLIENT_ID` n'est pas utilisé (Android identifie l'appli par paquet + SHA-1). Projet Google Cloud `card-manager-513909`, écran de consentement en mode test (utilisateurs test).
- **Tests** : `drive.test.ts` (faux Google : liste appDataFolder, ETag v2, If-Match/412, création multipart et création simultanée, 401, deux appareils via Drive, PKCE RFC 7636, renouvellement / `invalid_grant` / déconnexion) ; `oauth_loopback.rs` (4 tests rustc).

### Sauvegarde (fichier, indépendante de Google)
- **`services/backup.ts`** : `exportBackup()` = instantané de la synchro (mêmes tables, sans `sync_state`) + `kind: 'card-manager-backup'` ; `importBackup(text)` **remplace** les données locales (après `repairTables`) et garde l'état d'avant dans `sync_state.backup` ; `restoreLastBackup()` revient à cet état en gardant l'actuel (on peut refaire) — même point de restauration que celui pris avant chaque fusion de synchro ; `exportCollectionCsv()` : une ligne par exemplaire (nom lu dans la base de cartes du jeu), `csvCell` échappe `" , ; \n`. Fichier plus récent que l'appli → `BackupError('NEWER')`.
- **Fichiers** : plugins officiels `dialog` (~2.6) + `fs` (~2.5) — versions choisies pour **rester sur Tauri 2.11** (dialog 2.7+ / fs 2.6+ imposent Tauri 2.12, et le CLI exige crate et npm alignés). Capabilities `dialog:allow-save/open`, `fs:allow-write/read-text-file` (le chemin choisi dans la boîte de dialogue est autorisé automatiquement). Sur Android, la boîte de dialogue renvoie une URI `content://` : **à valider sur téléphone**.
- **Écran** : Réglages → Backup : `#backup-export`, `#backup-import` (+ `#backup-import-confirm`), `#backup-csv`, `#backup-restore` (`[data-restore-point]`).
- **Synchro au premier plan** : `useDeviceSync().watchForeground()` (enregistré dans `app.vue`) relance une synchro discrète au retour sur l'appli (`visibilitychange`), au plus toutes les 2 min ; `dataChanged()` remonte la page après un import / une restauration.
- **Tests** : `backup.test.ts` (aller-retour entre deux appareils, annulation dans les deux sens, rien à restaurer, fichier invalide / plus récent, `sync_state` exclu, CSV et échappement, noms de fichiers).

### Interface mobile (< 768 px) — maquettes : https://claude.ai/artifact/B4fH5zWqaexGgwwz4XYwNr
- **Principe** : desktop inchangé ; tout ce qui est mobile passe par `useResponsive().isMobile` (`v-if` exclusifs → jamais deux fois le même `id`). L'E2E tourne en 1000×700 → il ne voit que le desktop.
- **Coque** (`layouts/default.vue`) : pas d'en-tête global ; `MobileTabBar.vue` en bas (Collection · Recherche · **Scan** au centre, Android seulement · Decks · Partage ; `[data-tab]`). Réglages = icône `#mobile-settings-btn` en haut de Collection. `definePageMeta({ fullscreen: true })` (scan) masque onglets et marge du haut.
- **Marges système** : `viewport-fit=cover` (`nuxt.config`) + variables `--safe-top/bottom/left/right` (`main.css`, `env()` par défaut). Sur Android (bord à bord, SDK 35+), le plugin `safe-area` pousse les vraies valeurs ; `plugins/safe-area.client.ts` les redemande au démarrage.
- **`AppPage`** : props `title`/`subtitle` (grand titre mobile), slots `#leading`/`#actions` ; la sidebar devient un `UDrawer` (panneau du bas) ouvert par un bouton du titre ; `:mobile-sidebar="false"` = la page affiche elle-même ce contenu ; `:sidebar-button="false"` + `v-model:sidebar-open` = la page ouvre le panneau (deck : « Ajouter des cartes »).
- **Pages** : Collection = bascule Cartes / Rangements (`[data-mobile-segment]`, `ContainerTree` a une variante mobile en grandes lignes + bouton « Nouveau » flottant) + filtres en puces ; fiche carte = `UDrawer` ; deck = onglets Main/Extra/Side (`[data-mobile-board]`) ; partage = bascule Montrer / Recevoir (`[data-mobile-share-section]`) avec les collections reçues sous « Recevoir » ; réglages = toutes les sections empilées en cartes ; notifications en haut (`UApp :toaster`).
- **Captures** : `cd e2e && SCREENS_DIR=/tmp/out SCREEN_DARK=1 xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./screens/mobile.spec.ts` (390×844, pas un test).
- **Panneaux du bas** (`UDrawer` de la fiche carte et de la sidebar d'`AppPage`) : `handle-only` (on ne fait glisser que la poignée : le contenu défile sans fermer le panneau), bouton ✕ dans l'en-tête (`#card-detail-close`, `[data-drawer-close]`), hauteur max sous la caméra (`100dvh - --safe-top`), marges latérales `--safe-left/right`, image de la fiche à taille fixe (`aspect-[0.686]`, pas de saut au chargement).
- **Bouclier anti clic fantôme** (`composables/useClickShield.ts` + `plugins/click-shield.client.ts`) : un toucher sur le fond grisé ferme le panneau au `pointerdown`, et le `click` du relâchement tombait sur la carte dessous (le panneau se rouvrait : le « glitch » de fermeture). Le clic suivant est avalé **seulement** si un panneau était affiché (`[data-vaul-drawer][data-state=open]`) quand le doigt s'est posé et que le doigt est encore posé à la fermeture ; ✕ / Retour ne bloquent rien. Piège : la librairie signale encore des « touchers extérieurs » juste après une fermeture → sans le test « panneau affiché », le toucher suivant était avalé.
- Deck mobile : ajouter une carte depuis le panneau de recherche n'ouvre plus la fiche par-dessus (l'aperçu ne sert qu'au PC) ; onglets de zone `[data-mobile-board][data-board-count]`.
- **Tous appareils** :
  - `useResponsive().isMobile` = largeur < 768 px **ou** téléphone en paysage (hauteur < 520 px et pointeur grossier). Variantes Tailwind (`main.css`) : `touch:` (`hover: none`, les boutons `opacity-0 group-hover:` sont visibles au doigt) et `short:` (hauteur < 520 px : barre d'onglets réduite, sans libellés).
  - Barre d'onglets : `composables/useMobileTabs.ts` (onglets + bouton Scan surélevé) ; `RAISED_TAB_OVERLAP` = marge du bas de la page quand le bouton Scan dépasse (la pagination de la recherche, centrée sur mobile, n'est plus dessous).
  - Caméra incrustée / encoches : la coque bureau applique aussi les quatre `--safe-*` (tablette, paysage).
  - Pliables / doubles écrans : `composables/useViewportSegments.ts` (+ `utils/segments.ts` pur, testé) lit `window.viewport.segments` (ou `getWindowSegments`) ; deux colonnes → la sidebar d'`AppPage` occupe l'écran de gauche et le contenu commence après la charnière (`[data-dual-screen]`), l'en-tête se cale de même (`GamePicker compact` : `GameDefinition.shortLabel`, ex. « MTG »). Écrans pliés étroits (280 px) : titres réduits.
  - Indicateurs de test (mode test seulement, `utils/platform.ts` `testFlag`) : `localStorage.__forceAndroid` / `__forceTouch` = `'1'`, `window.__testSegments` = faux segments.
  - **Captures multi-appareils** : `cd e2e && SCREENS_DIR=/tmp/out xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./screens/devices.spec.ts` (Galaxy A52s portrait/paysage avec fausse caméra incrustée, Galaxy Fold plié / déplié, Surface Duo étalé avec charnière, tablette).

### Performances (nov. 2026) — mesuré avec `e2e/perf/perf.spec.ts`
- **Mesure** : `cd e2e && xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./perf/perf.spec.ts` → tableau (durée jusqu'à l'affichage, pire image, appels JS → Rust). 2000 cartes synthétiques, vignettes en cache (liens durs). Sous xvfb, rendu logiciel : durées pessimistes, comparer avant / après sur la même machine.
- **Images** : protocole Rust `cardimg` (`image_cache::serve`, `register_asynchronous_uri_scheme_protocol`) : `<img src="cardimg://localhost/ygo%2Fsmall%2F<id>">` (`http://cardimg.localhost/…` sur Android / Windows, `convertFileSrc(…, 'cardimg')`). Lu dans le cache ou téléchargé (6 en parallèle au plus, sémaphore tokio ; `cache_store::write_atomic` = fichier temporaire + renommage). Plus d'appel JS → Rust par vignette (avant : 1958 appels pour ouvrir 2000 cartes), le navigateur ne charge que les images visibles. `cache_card_image` et le protocole `asset` ont été retirés.
- **Grilles** : `VirtualGrid` (collection grille + liste, collection reçue du Partage, choix d'une carte non rangée) ne dessine que les lignes visibles (+3) ; colonnes par largeur de fenêtre (`columns: { base: 3, sm: 4, md: 5, lg: 6, xl: 8 }`), hauteur des lignes mesurée. Sa `:key` = ce qui est affiché (rangement + filtres) : changer de vue repart du haut, un rechargement garde la position.
- **Re-rendus** : dans une grande liste, un composant par carte avec des **props simples** (`collectionCard.vue`), jamais un objet construit dans le template (`:card="{…}"` = objet neuf à chaque rendu = toutes les vignettes redessinées) ; objets construits une fois (`thumbCards` dans `share.vue`). Listes en `shallowRef`. Pas de `v-memo` dans un slot appelé par élément (cache partagé).
- **Fiche carte** : exemplaires lus une fois (le watcher d'`activeArtId` les relisait en double), quantité = somme des exemplaires, rangements lus à l'ouverture du choix de rangement seulement ; vignette affichée tout de suite, grande image par-dessus une fois chargée (`bigLoaded`).
- **Icônes** : Lucide embarquées (`@iconify-json/lucide`, `icon.clientBundle` dans `nuxt.config.ts` : scan des `.vue` **et** `.ts` + icônes propres à Nuxt UI, liste `NUXT_UI_ICONS`) ; avant, chaque icône venait d'`api.iconify.design` à sa 1re apparition. Nouvelle icône Nuxt UI hors liste → elle repasserait par le réseau (l'outil de mesure compte `NET iconify`).
- **Decks** : `getDeckState` (contenu + limites par carte logique + validation, une lecture) ; la page applique chaque action à l'écran d'abord (`bump`, validation par `validateContents`), écrit ensuite dans l'ordre des clics (`persist`), relit quand plus rien n'est en cours ; copie de trop refusée sur place (`limitCheck` partagé avec `addCardToDeck`, `deckSearchMeta` pour les résultats). `DeckCard.root` = carte logique.
- **Synchro au retour dans l'appli** : `useDatabase` compte les `execute` sur user.db (`utils/userWrites`) ; la synchro écrit via `uncounted(db)`. Rien écrit depuis la dernière synchro réussie de la session + version publiée inchangée → une vérification de version, aucune relecture (avant : 17 requêtes). Synchro et élagage du cache démarrent 1,5 s après l'ouverture / le retour (`FOREGROUND_DELAY_MS`).
- **Mobile** : barre d'onglets sans `backdrop-blur` ; scan : JPEG encodé par `toBlob` (hors du fil principal) au lieu de `toDataURL`, même image.
- **Linux / DMABUF** : `WEBKIT_DISABLE_DMABUF_RENDERER=1` n'est plus posé que dans l'AppImage (`APPIMAGE` défini) : Félix constate nettement plus de fluidité avec DMABUF sur CachyOS (vrai GPU). Sans GPU (xvfb) c'est l'inverse (2,5× plus lent) : `wdio.conf.ts` le désactive pour l'E2E. Fenêtre vide : `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **Chiffres** (2000 cartes, xvfb, avant → après) : collection affichée avec ses images ~4 s → 0,2 s ; défilement moy. 50 ms/image (35-50 % > 50 ms) → 28 ms (1/120) ; fiche 1,2-1,6 s → 0,19 s ; entrer en sélection 0,45-0,6 s → 0,04 s ; cocher 0,1-0,5 s → 0,02 s ; ajout au deck 0,08-0,18 s (18-20 requêtes avant affichage) → 0,02-0,05 s (affiché avant écriture).

### Mode test (committé)
- `src-tauri/src/lib.rs` : `db_name()` gère le mode test (a corrigé au passage un bug prod : migrations enregistrées pour le mauvais nom de base en build test → table settings manquante).
- `src-tauri/build.rs` : rerun si `VITE_TEST_MODE` change.
- `app/app/plugins/test-reset.client.ts` (actif si `VITE_TEST_MODE==='true'`) :
  - `window.__resetTestDb()` — vide les tables user (sauf `_sqlx_migrations`).
  - `window.__seedRarities(setCode, raretés)` — remplit `printing_rarities` pour un code (la fixture n'en contient pas).
  - `window.__seedOwned(cardId, qty)` — INSERT direct d'une ligne `collection` pour un `card_id` exact ; lit `PRAGMA table_info(collection)` pour s'adapter aux colonnes (condition/language/printing_id/timestamps si présents ; NOT NULL sans défaut → valeur de secours).
- `app/app/app.vue` : `runSync()` retourne tôt si `VITE_TEST_MODE`.

### E2E — 19 parcours (local + CI), dans `e2e/specs/`
1. `smoke` — header, nav.
2. `collection-add` — `/search` → Dark Magician → `#card-detail` → `#btn-quick-add` → `data-owned-count >= 1`.
3. `container-crud` — créer deckbox → vérifier → renommer → supprimer.
4. `container-assign` — ajouter carte → `/collection` → deckbox → « non rangées » (`__unranged__`) → `#btn-range-card` → picker → `#picker-confirm` → re-sélection → `data-content-card-id` → `[data-unassign]` → `#unassign-confirm`.
5. `binder-slots` — binder (pages=1) → slot `[data-slot-page=0][row=0][col=0]` → picker → `data-slot-filled`/`data-slot-card-id` → `[data-slot-clear]`.
6. `deck-crud` — les deux boutons (`#deck-create-btn` ET `#deck-create-empty`) ; `createDeckVia` fait `waitForPath(/^\/decks\/.+/)` PUIS `goTo('/decks')` PUIS `waitForPath('/decks')` (corrige une race router.push). Rename/delete via menu.
7. `deck-build` — `#deck-search-input` (watchDebounced 300 ms) → `.deck-search-result` → board Main `data-quantity=1` → menu `add`→2 → `remove`×2 → disparu.
8. `deck-range` — créer deck → ajouter 1er résultat → lire son `data-deck-card-id` → `__seedOwned(thatId)` → deckbox → ranger (combobox USelect) → `data-plan-total >= 1` → confirmer → carte physiquement dans la deckbox.
9. `deck-banlist` — alerte banlist via passage du format casual → tcg (`#deck-format-select`, `data-flagged` sur `.deck-board-card`, `data-banlist-alert`).
11. `collection-all` — `__seedOwned` → `/search` puis `/collection` (vue « toute ma collection » ; passer par une autre route car l'app démarre déjà sur `/collection`) → fiche → `[data-entry-edit]` → `#entry-trade-qty-input` → `#entry-save-btn` → badge `[data-trade-qty]` → `#collection-only-trade` → `#collection-search`.
12. `share` — `__seedOwned` → `/share` → `#share-owner-input` → `#share-generate-btn` → `[data-share-code]` (CMSHARE1) + `#share-qr[data-qr-frames]` → `[data-share-section=receive]` → `#share-import-input` → `#share-import-btn` → `#shared-view` `.shared-card[data-shared-qty/mine]` → `#shared-only-missing` → `#shared-delete-btn`.
13. `scan` — langue (`LOB-FR005` → fr), 1re édition lue + bascule, rareté à choisir quand le code en a plusieurs (`window.__seedRarities(code, [...])`, la fixture n'a pas de raretés) ; `/scan` → `window.__scanFeed` (lignes OCR simulées : `LOB-EN005`, `MP25-EN050`) ×2 → `[data-scan-count]` / `[data-scan-entry]` ; pas de doublon tant que la carte reste ; 2e exemplaire après 3 images vides ; `[data-scan-undo]` ; mode manuel `#scan-auto-add` + `#scan-add-btn`.
16. `db-transaction` — requêtes simultanées puis export + réimport d'une sauvegarde (`window.__txProbe`) : la transaction doit tenir (échouait avant la sérialisation de `useDatabase`).
15. `mtg` — `#game-picker` (`data-current-game`) → `window.__seedMtg(échantillon Scryfall)` → recherche (une ligne par carte, `[data-mtg-filters]`) → fiche `#card-printing-select` + ajout → collection → deck (zones main/side/commander, 6 Forest acceptées, 5e Lightning Bolt refusé) → retour YGO. En E2E, la fenêtre « Which game? » n'apparaît jamais (`useCurrentGame` en mode test).
14. `mobile` — fenêtre 390×844 (`browser.setWindowSize` après `waitForApp`, qui attend l'en-tête du mode bureau) : barre d'onglets (`[data-tab]`, 4 hors Android, `data-active`), bascule `[data-mobile-segment]` + création d'un rangement depuis la liste mobile, `[data-mobile-back-all]`, fiche carte en panneau du bas + ajout rapide, deck : `[data-mobile-board]` (une zone à la fois) + `[data-mobile-deck-add]` → panneau de recherche, partage `[data-mobile-share-section]`, réglages empilés (`[data-section-body]` sur chaque section, pas de `[data-section]`).
10. `settings-storage` — `/settings` → `[data-section=storage]` → `#image-cache-size[data-cache-bytes]` numérique → `#image-cache-clear` → `0` (vérifie que les commandes Rust sont enregistrées).
17. `container-games` — rangement créé dans YGO (jeu coché par défaut) + un sans jeu → bascule MTG : le premier masqué en « This game », visible avec badge en « All games », puis associé aussi à MTG via « Edit ».
18. `search-select` — `#search-select-btn` → cocher / décocher (pas de fiche ouverte) → `#search-add-selected` → 2 copies rangées dans une deckbox → `.card-thumb[data-owned]` + contenu de la deckbox.
19. `riftbound` — `#game-picker` → `window.__seedRiftbound(échantillon RiftHunt)` → recherche (`[data-rb-filters]`) → fiche `#card-printing-select` + ajout → deck : 6 zones `[data-board]`, légende placée seule, champion choisi par `[data-menu-action=move-to-champion]`, 12 runes acceptées (13e refusée), 1 champ de bataille, règles `[data-deck-issue]` (identity, main, battlefields) → retour YGO.

**Leçon deck-range** (⚠️ réutilisable) : « Dark Magician » a plusieurs artworks ; l'ordre des résultats diffère entre `/search` et la sidebar du deck → la carte possédée ≠ la carte du deck → `owned=0`. Résolu en possédant **le `card_id` exact** de la carte du deck via `__seedOwned`. Tout test qui a besoin d'un état de collection précis doit faire pareil, ne pas dépendre de l'ordre de recherche.

### Conventions de sélecteurs E2E (validées sous WebKit)
- **`UDropdownMenu` ET `USelect`** ciblés via le slot `#item` où on rend notre markup avec `:data-menu-action` / `:data-select-value`, + `:data-menu-trigger` / `id` sur le trigger. Le contenu **téléporté** (portal) est trouvable par `document.querySelector`.
- **`USelect` v4.8 = combobox Reka** (`<button role="combobox">` + `reka-select-content-*` téléporté), PAS un `<select>` natif : on ouvre (clic trigger) puis on clique l'option téléportée portant `data-select-value`.
- `id` sémantiques kebab-case + `data-*`. **Pas de data-testid.** Inspiration : github.com/Morgawr/kechimochi.

### Contournements WebKitWebDriver (tout via `browser.execute`)
`browser.keys` (touche Échap…) n'atteint pas la WebView : fermer un panneau par son bouton ✕.
`elementSendKeys` KO → `typeInto` (setter du prototype `HTMLInputElement` **ou** `HTMLTextAreaElement` selon l'élément, descend dans le wrapper Nuxt UI si besoin, + dispatch input/change). Actions API KO → pas de scroll/clic natif. Clics natifs interceptés → `click` dispatche une séquence pointer/mouse. `free(): corrupted unsorted chunks` à la fermeture = inoffensif. Éléments `opacity-0 group-hover` → le clic JS marche quand même.

### `data-*` / `id` posés (committés)
`cardDetail.vue` (#card-detail, #card-detail-owned[data-owned-count], #btn-quick-add, #btn-range-card) · `cardThumb.vue` (.card-thumb[data-card-id]) · `search.vue` (#search-card-input, #search-results) · `containerCreateModal.vue` (data-type, .container-type-btn, #container-name-input, #container-{pages,rows,cols,capacity}-input, #container-create-confirm) · `containerTree.vue` (#container-create-btn, .container-item[data-container-id/name], data-menu-trigger, #item data-menu-action rename/edit/delete, #container-rename-input/confirm, #container-delete-confirm ; non rangées = data-container-id="__unranged__") · `containerPicker.vue` (.picker-container[data-picker-container-id], #picker-qty-input, #picker-confirm) · `collection.vue` (#container-content, .container-card[data-content-card-id], [data-unassign], #unassign-confirm) · `binderView.vue` (.binder-slot[data-slot-page/row/col/filled/card-id], [data-slot-clear], #binder-prev/next-page, data-binder-page) · `unrangedCardPicker.vue` (.unranged-picker-card[data-picker-card-id], #unranged-picker-search) · `decks/index.vue` (#deck-create-btn, #deck-create-empty, #deck-name-input, #deck-create-confirm, #deck-rename-input/confirm, #deck-delete-confirm) · `DeckCard.vue` (.deck-card[data-deck-id/name], data-menu-trigger, #item data-menu-action rename/range/delete) · `DeckBoard.vue` (prop board → :data-board, .deck-board-card[data-deck-card-id/data-quantity], data-board-count, #item data-menu-action info/add/remove/move, data-menu-trigger, [data-move]) · `decks/[id].vue` (#deck-search-input, .deck-search-result[data-search-card-id], data-total-cards, boards main/extra/side, #deck-range-btn, **data-banlist-alert**) · `DeckboxRangeModal.vue` (#deck-range-select, #item data-select-value, #deck-range-confirm, data-range-modal-body, data-range-plan, data-plan-total) · `collection.vue` (vue complète : `[data-container-id=__all__]`, #collection-search, #collection-sort + #item data-select-value, #collection-only-trade, [data-trade-qty]) · `cardDetail.vue` édition d'exemplaire ([data-entry-edit], #entry-trade-qty-input, #entry-save-btn, [data-entry-trade-qty], #add-rarity-select, #entry-rarity-select, #entry-first-edition, [data-entry-rarity], [data-entry-first-edition]) · `share.vue` ([data-share-section=mine|receive], #share-owner-input, #share-only-trade, #share-generate-btn, #share-qr[data-qr-frames], [data-share-code], #share-copy-btn, #share-scan-btn, #share-import-input, #share-import-btn, [data-saved-share-id], #shared-view, #shared-search, #shared-only-trade, #shared-only-missing, #shared-delete-btn, .shared-card[data-shared-card-id/qty/trade/mine]) · `QrScanner.vue` ([data-scan-progress]) · `scan.vue` (#scan-view, [data-scan-current], #scan-auto-add, #scan-add-btn, [data-scan-count], [data-scan-entry], [data-scan-undo]) · `collection.vue` #scan-open-btn · `settings.vue` (nav [data-section] devices/backup/collection/share/appearance/sync/storage/games, #backup-export, #backup-import, #backup-import-confirm, #backup-csv, #backup-restore, [data-restore-point], #gsync-connect, #gsync-now, #gsync-disconnect, [data-gsync-email], [data-gsync-last], #image-cache-size[data-cache-bytes], #image-cache-clear, #sync-check-btn, #sync-force-btn, [data-sync-version], #settings-owner-name, #settings-color-mode) · `decks/[id].vue` règles du deck entier ([data-deck-issues][data-issue-count], [data-deck-issue=<code>]) · `CardDataPending.vue` [data-card-data-pending] · `app.vue` pastille [data-card-update][data-progress][data-first-install] · `cardDetail.vue` / `DeckBoard.vue` [data-landscape] · `DeckBoard.vue` [data-warned] · `RiftboundSearchFilters.vue` ([data-rb-filters], [data-rb-domain], [data-rb-type], #rb-supertype-filter, #rb-set-filter, #rb-format-filter) · mobile : `MobileTabBar.vue` ([data-tab]), #mobile-settings-btn, [data-mobile-segment], [data-mobile-back-all], [data-mobile-board], [data-mobile-deck-add], [data-mobile-share-section].

### Tests unitaires Vitest (`app/test/unit/`)
- **Approche** : vrai SQLite en mémoire via `node:sqlite` (intégré à Node 22, pas de module natif), schéma = **les vraies migrations** `src-tauri/migrations/{user,ygo}` appliquées dans l'ordre → aucune dérive possible avec la prod. `useDatabase` est remplacé par `vi.mock('~/composables/useDatabase')` → **aucun refactor des services nécessaire**.
- `helpers/testDb.ts` : `TestDatabase` imite `select`/`execute` de plugin-sql (params `?`), active `foreign_keys`. `helpers/seed.ts` : builders (`card`, `owned`, `deck`, `deckCard`, `deckbox`, `binder`, `bulkBox`, `inDeckbox/inBinder/inBulk`, `softDelete*`, `linkDeck`) + lectures (`contentsOf`, `deckboxesOfDeck`, `capacityOf`).
- `helpers/testDb.ts` accepte `{ upTo: n }` + `applyMigration(n)` pour tester une migration sur des données existantes.
- `collection.test.ts` : vue complète (regroupement, recherche, filtre échange, tris, supprimées ignorées), `trade_qty` borné, migration 006, défauts par jeu à l'ajout, `removeCard` détache des conteneurs, compteurs de conteneurs, `updateCard` refuse une quantité < copies rangées, migration 004.
- `decks.test.ts` : placement auto (dont « XYZ Monster » → extra), limites alias/banlist par format, move, validation, possédées par carte logique, filtres de recherche.
- `containers.test.ts` : classeur multi-copies, classeur plein, capacité deckbox, non rangées, retrait, regroupement artworks, migration 005 (orphelines écartées, vue OK).
- `share.test.ts` : codec (aller-retour, fusion des piles, copier-coller abîmé, erreurs, version future, ids refusés, 650 cartes dans un QR), QR animé (5000 cartes en désordre + images d'un autre partage, **vraie chaîne qrcode → pixels → jsQR** sur 1000 cartes), service (construction, résolution croisée, enregistrement/remplacement/suppression).
- `scan.test.ts` : codes d'impression (variantes régionales, confusions OCR, faux positifs), extraction dans du bruit, similarité de noms, candidats « nom », stabilisation (confirmation, doublons, ré-ajout après retrait, enchaînement), identification sur base (code → carte + impression, code non anglais → impression EN, nom abîmé → artwork principal, nom proche distingué, rien → null).
- `settings.test.ts` : graines, types décodés, cache + invalidation, bornes (limite du cache), nom de partage, réglages par jeu (registre, isolation, jeu inconnu, ancienne clé globale ignorée).
- `search.test.ts` : FTS nom / effet, catégories, sous-types en OU insensibles à la casse, égalités, numériques (opérateur inconnu ignoré), flèches Link, combinaisons, pagination, cohérence search/count, options de filtres. Cartes complètes via `helpers/ygoCards.ts`.
- `cardDetail.test.ts` : stats, Link, impressions triées avec toutes leurs raretés (+ repli), artworks par alias, `printingRarities`.
- `userSync.test.ts` : deux bases « PC » / « téléphone » + transport mémoire, données créées par les vrais services : 1re synchro, union sans base, idempotence, ajouts parallèles, champs différents, même champ (le plus récent gagne), retrait vs modification, suppression propagée, conteneur supprimé ailleurs, sur-rangement, case de classeur disputée, réglages partagés ou non, course entre appareils (refusion), état plus récent refusé, état plus ancien accepté, sauvegarde avant fusion ; `USER_SCHEMA_VERSION` = nombre de migrations.
- `perf.test.ts` : **5 000 cartes** (rangements, classeur de 1 000 cases, deck) ; mesure **durée et nombre de requêtes** de chaque opération (`TestDatabase.queries` : dans l'appli, chaque requête = un aller-retour WebView → Rust). Seuils larges (requêtes max par opération, < 3 s) pour attraper une boucle « une requête par carte ». `npx vitest run test/unit/perf.test.ts --reporter=verbose` affiche le tableau. Mesures (nov. 2026) : collection complète 2 requêtes / ~40 ms, plan deck → deckbox 11 requêtes (était 67 : une boucle par carte, regroupée en 4 requêtes), synchro sans changement 1 vérification de version.
- `multiGame.test.ts` : faux jeu de bout en bout + garde anti-« ygo » en dur (cf. §5 « Multi-jeu »).
- `deckLink.test.ts` : 26 cas (plan + apply) : alias/boards fusionnés, déjà là, partiel, non rangées prioritaires, multi-sources ordonnées par nom, conteneur supprimé, isolation par jeu, purge (alt art conservée), capacité (NULL / purge déduite / dépassement + relève), relink unique, idempotence, pas de sur-assignation, entrées de collection soft-deleted.
- **Bug corrigé grâce à ces tests** : `removeCard` (soft delete) laisse les lignes d'assignation ; `deckLink` les comptait (alreadyHere/currentInBox/purge) et pouvait déplacer ces copies fantômes. Toutes les requêtes d'assignation joignent maintenant `collection ... AND c.deleted_at IS NULL`. Résolution alias/nom factorisée dans `rootsOf()`.
- Pour tester un autre service : même schéma `vi.hoisted` + `vi.mock` + `createTestDatabases()` / `createSeeder()` (cf. en-tête de `deckLink.test.ts`).

### Fixture de cartes (déterministe, versionnée)
`e2e/fixtures/cards-ygo.test.db` (~244 Ko) : **54 cartes** (~20 noms classiques + artworks alt + alias), 663 printings, **1 Forbidden (Pot of Greed, passcode 55144522)**, FTS « Dark » = 20, zéro violation FK. Régénérable via `build-fixture.sh` (sélection par NOM, inclut alt arts + alias, lookups entières, rebuild FTS, check FK, aplatit le WAL). `.gitignore` a une exception `!e2e/fixtures/cards-ygo.test.db`.

### CI checks (`.github/workflows/checks.yml`)
`ubuntu-22.04`, push `dev` + PR, **Node 22** (node:sqlite), pnpm v9, `pnpm install --ignore-workspace --frozen-lockfile` dans `app/` → `typecheck` → `test:unit` → tests Rust std-only (`rustc --test src-tauri/src/cache_store.rs`). Pas de build Tauri.

### Sessions Claude Code cloud
- `.claude/hooks/session-start.sh` (uniquement si `CLAUDE_CODE_REMOTE=true`) installe les deps de `app/` ; ne réinstalle que si `package.json`/`pnpm-lock.yaml`/le script changent.
- **Environnement cloud `card-manager`** (personnel, créé nov. 2026) : son script d'installation ajoute WebKitGTK, `webkit2gtk-driver`, `xvfb`, `tauri-driver` et les deps des trois `package.json`. Une session sur cet environnement peut lancer **tout** : `cargo check`, typecheck, Vitest, et l'E2E complet (`cd e2e && xvfb-run -a npm test`, ~4 min avec build). Sur l'environnement Default, l'E2E n'est pas disponible → s'appuyer sur la CI de la PR.

### Nettoyage (nov. 2026)
- 59 erreurs vue-tsc corrigées, dont un vrai bug : `cardDetail.vue` référençait `CONDITIONS`/`LANGUAGES` supprimés (selects État/Langue vides) → `conditionItems`/`languageItems`.
- `DeckboxRangeModal` : on peut re-confirmer sur la même deckbox s'il y a quelque chose à placer/purger (le commentaire le disait, le code non).
- `nuxt.config` : `vite.server.host` (ignoré par Nuxt) → `devServer.host`.
- Code mort supprimé (`listCollection`, `listCollectionGrouped`, `assignToContainer`, `unassignDeckboxCard`, `unassignBulkBoxCard`, `clearBinderSlot`, `getSetting`) ; restes de templates (`public/` racine, README Nuxt) ; `.gitignore` réparé (commentaires en fin de ligne = motifs invalides : `*.db-shm`/`*.db-wal` n'étaient pas ignorés).

### Releases (`.github/workflows/release.yml`) — versions numérotées, comme CardStudio et Mango
- **Quand** : push sur `dev` qui modifie `.github/release-notes.md` (version = `src-tauri/tauri.conf.json`, rien si le tag existe déjà → **monter la version avec les notes**) ; push d'un tag `vX.Y.Z` ; ou onglet Actions → « Run workflow » (cases Linux / Windows / macOS / Android + tag ; `-beta.N` = pré-release ; sans tag = construction seule, fichiers en artefacts). PR qui touche le workflow : tout est construit, rien publié.
- **Fichiers** : `Card-Manager-vX.Y.Z-linux-x86_64` (exécutable seul, Félix l'utilise), `-linux-amd64.deb`, `-linux-x86_64.rpm`, `-linux-x86_64.AppImage`, `-windows-x64-setup.exe` (+ `.msi` hors pré-release : WiX refuse « -beta »), `-macos-arm64.dmg` (non signée), `-android-arm64.apk`. Notes = `.github/release-notes.md` + `.github/release-install.md` (installation par système).
- **Version** : `tauri.conf.json` (0.2.0 = première version numérotée ; les anciens builds `dev-latest` étaient 0.1.N, l'APK 0.2.0 se met à jour par-dessus). versionCode Android dérivé de la version.
- Windows et macOS : construits par la CI, **jamais testés sur appareil**.
- **AppImage cassée sur CachyOS** (nov. 2026) : « Could not create default EGL display: EGL_BAD_PARAMETER », même avec `GDK_BACKEND=x11` et `WEBKIT_DISABLE_*` : les bibliothèques graphiques embarquées (Ubuntu 22.04) ne s'entendent pas avec celles du système. D'où l'exécutable seul / .deb / .rpm, qui utilisent les bibliothèques du système. Félix utilise l'exécutable seul.
- Android : `src-tauri/gen/` n'est pas versionné → `tauri android init --ci` + `tauri icon` en CI, build `--target aarch64`, puis `zipalign` + `apksigner`.
- **Signature (dépôt public)** : la clé n'est **jamais** dans git (`*.keystore`/`*.jks` ignorés). Elle vit dans les secrets du dépôt `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, **configurés** (6 nov. 2026 : clé générée en session cloud et remise à Félix, qui la conserve ; `scripts/android-keystore.sh` reste l'outil pour en refaire une). La perdre = plus de mise à jour des APK installés. Empreinte SHA-1 du certificat (client OAuth Android de la synchro) : `41:26:48:4D:D2:52:D7:C7:45:74:9D:35:81:98:51:3C:7B:B1:D6:DA`. Paquet Android : `com.card_manager.app`. Sans secret : une **publication échoue** (comme Mango : jamais d'APK qui ne pourrait pas mettre à jour l'appli installée) ; une construction seule signe avec une **clé jetable** + warning. L'ancienne clé de test (`.github/release/android-test.keystore`, publique via l'historique) est **abandonnée** : un APK signé avec doit être désinstallé avant d'installer un APK signé avec la nouvelle clé.
- **Incident GitHub Actions** (6 nov. 2026) : jobs refusés sans runner (« account locked due to billing issue ») à cause d'un budget Actions à 0 $ « Usage blocked ». Résolu (dépôt passé public + déblocage côté compte). Si ça revient : Settings → Billing → Budgets.
- **Build APK local (session cloud)** : SDK Android dans `/opt/android-sdk` (cmdline-tools → `platforms;android-34`, `build-tools;34.0.0`, `ndk;27.2.12479018`, `rustup target add aarch64-linux-android`), `ANDROID_HOME` + `NDK_HOME`, puis les mêmes commandes que le job `android`. Maven Central peut répondre **429** depuis l'IP partagée du conteneur → script d'init Gradle `~/.gradle/init.d/maven-central-mirror.gradle` qui interroge d'abord le miroir `https://maven-central.storage-download.googleapis.com/maven2/`. AppImage local : il faut `xdg-utils` (`xdg-open`).
- Builds release = bases `.db` (pas `.dev.db`) → n'interfèrent pas avec les données de dev.

### CI E2E (`.github/workflows/e2e.yml`) — verte
`ubuntu-22.04`, push `dev` + PR, `timeout 30`, `concurrency` cancel-in-progress. Étapes : checkout → deps système (`libwebkit2gtk-4.1-dev`, gtk-3, ayatana-appindicator3, rsvg2, xdo, ssl, build-essential, **`webkit2gtk-driver`**, **`xvfb`** ; `which WebKitWebDriver`) → Rust + `Swatinem/rust-cache` → `cargo install tauri-driver --locked` → pnpm v9 → Node 20 + cache pnpm → **`pnpm install --ignore-workspace --frozen-lockfile` racine** (fournit le CLI `tauri`) → idem dans `app/` → `npm ci` dans `e2e/` → **`xvfb-run -a npm test`** → upload logs si échec. **Le build n'est PAS dupliqué** : `onPrepare` de wdio fait generate + tauri build. ~4 min avec cache.

### Robustesse corrigée
PRAGMA WAL/foreign_keys retirés des deux `001` (échouaient sur base vierge) ; `foreign_keys = ON` réactivé par connexion dans `useDatabase.ts`.

---

## 6. CE QUI RESTE À FAIRE (backlog priorisé)

### ✅ Tâche 1 — Spec E2E banlist : faite (`deck-banlist.spec.ts`).
### ✅ Tâche 2 — Vitest sur `deckLink.ts` : fait (cf. §5 « Tests unitaires »).

### ✅ Soft delete de collection corrigé à la racine
`removeCard` supprime les assignations de l'entrée (deckbox/binder/bulk) avant le soft delete ; `updateCard` refuse une quantité inférieure aux copies rangées (`QUANTITY_BELOW_ASSIGNED`, toast dédié dans `cardDetail.vue`) ; migration `004` nettoie les fantômes existants. Les filtres `deleted_at` de `deckLink` restent en défense.

### ✅ Bugs corrigés en écrivant les tests (nov. 2026)
- Monstres Xyz placés dans le Main Deck (YGOPRODeck écrit « XYZ Monster ») + filtre « Xyz » jamais proposé → comparaisons insensibles à la casse.
- Ranger 2 copies d'une même pile dans un classeur plantait (`UNIQUE(collection_id)`) → migration 005.
- Vue deck : « possédées » compté par artwork exact → par carte logique (comme le rangement).

### ✅ Tests unitaires settings / recherche / fiche carte : faits. 339 Vitest au total (nov. 2026, avec Riftbound).

### ✖ Protection de branche : abandonnée (choix de Félix) ; les merges se font après CI verte.

### Phases futures (hors testing)
- **Phase 5 — OCR** : fonctionne sur téléphone (retour de Félix) ; rareté, 1re édition, langue et recadrage faits. Reste à valider sur téléphone la lecture de la 1re édition et le recadrage.
- **Phase 9 — Settings** : terminer (base en place, cf. §5).
- **Phase 2 (structure)** : terminée avec la refonte mobile.
- **Synchro PC ↔ mobile** : faite (cf. §5), synchro au premier plan + restauration faites ; à valider sur PC + téléphone réels (connexion Google, aller-retour Drive).
- **Plan validé par Félix (9 nov. 2026)** : 1) sauvegarde ✅ ; 2) appli **entièrement en anglais** ✅ ; 3) performances 5000 cartes + E2E en taille téléphone ✅ ; 4) préparation multi-jeu ✅ (cf. §5 « Multi-jeu ») ; 5) **Magic: The Gathering** ✅ (cf. §5 « Magic »), à valider sur appareil.
- **Riftbound** ✅ (nov. 2026, cf. §5 « Riftbound »), à valider sur appareil. **Prochain jeu envisagé : Lorcana.**
- **Pistes Riftbound** : prix (RiftHunt `/bulk/prices` : TCGplayer + Cardmarket), règles de mots-clés (rulings `/bulk/rulings`), langues d'impression lues au scan.
- **Pistes Magic** : identité de couleur du commandant (validation commander), prix (Scryfall les fournit), recherche par extension / rareté, mise à jour sans bloquer l'écran.

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
- Types YGOPRODeck en casse variable (« XYZ Monster ») : toujours comparer en minuscules.
- Contrainte à retirer en SQLite = reconstruire la table dans une migration (et supprimer/recréer les vues qui en dépendent, sinon le RENAME échoue). Recopier en filtrant les orphelines (anciennes bases sans foreign_keys).
- Soft delete de `collection` : passer par `removeCard` (qui détache des conteneurs), jamais un `UPDATE ... deleted_at` direct. (§6)
- Transactions SQLite côté front : ne JAMAIS contourner `useDatabase()` (requêtes sérialisées) ; un `Database.load` direct referait des connexions parallèles et casserait `BEGIN`/`COMMIT`. Les tests unitaires (une seule connexion) ne voient pas ce problème : c'est l'E2E `db-transaction` qui le garde.
- Tests unitaires : Node >= 22 obligatoire (`node:sqlite`) ; le warning « SQLite is an experimental feature » est normal.
- Grande liste de cartes : props simples par carte (pas d'objet construit dans le template), `shallowRef`, `VirtualGrid` au-delà de ~200 éléments. Images : toujours `useCardImage` / `cardImageUrl` (protocole `cardimg`), jamais d'appel Rust par vignette. (§5 « Performances »)
- Écriture dans user.db hors `useDatabase()` : le compteur d'écritures ne la voit pas → la synchro au retour dans l'appli pourrait la croire inutile. (§5 « Performances »)
- Fenêtre vide / plantage EGL sous Linux avec l'AppImage (CachyOS, nov. 2026) : utiliser l'exécutable seul ou le .deb/.rpm (bibliothèques du système, cf. §5 Release). `lib.rs` pose `WEBKIT_DISABLE_DMABUF_RENDERER=1` dans l'AppImage seulement (ailleurs DMABUF = plus fluide), sauf si l'utilisateur l'a déjà défini.
- Proportion d'une case de carte : `aspect-card` / `aspect-card-landscape` (format du jeu), jamais une valeur en dur ; une carte paysage dans une case portrait est tournée par `useCardFit`. (§5 « Multi-jeu »)
- Image d'un jeu dont l'URL ne se déduit pas de l'id (Riftbound) : passer par les indices (`image_sources_set`), jamais une URL complète dans `<img src>` ; Rust refait l'adresse et refuse tout indice qui n'est pas un chemin relatif simple. (§5 « Riftbound »)
- RiftHunt : pas plus d'un téléchargement du catalogue par jour, pause entre les pages, User-Agent du projet (Rust) ; un 429 se rattrape par la reprise de `getJson`.
- Migration user ajoutée → incrémenter `USER_SCHEMA_VERSION` (test) ; un appareil resté sur l'ancienne version refuse alors la synchro (« update the app ») : mettre à jour tous les appareils.
