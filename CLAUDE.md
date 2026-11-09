# CLAUDE.md — card-manager

> Fichier lu automatiquement par Claude Code. Il donne la carte du projet, les
> règles impératives, l'état **fait / à faire**, et comment vérifier une modif.
> Gestionnaire de collection de cartes TCG (Yu-Gi-Oh d'abord, **multi-TCG par conception**).

---

## 0. Orientation express

- **Stack** : Tauri v2 (Rust) + Nuxt 4 SPA (`app/`) + Nuxt UI v4 (4.8.1, embarque Reka UI) + Tailwind v4 + SQLite (`tauri-plugin-sql`) + VueUse. `withGlobalTauri: true`.
- **Dépôt** : branche d'intégration `dev`, commits conventionnels. Claude travaille sur des branches `claude/*`, committe et pousse lui-même, ouvre une PR vers `dev` ; **Félix relit et merge**. Jamais de push direct sur `dev`.
- **Langue** : répondre **en français**.
- **OS dev** : CachyOS (Arch). Bases dans `~/.config/com.card-manager.app/`.
- **CI** : GitHub Actions, `checks` (typecheck + Vitest + tests Rust std-only, ~1 min) et `e2e` (13 parcours WebdriverIO, ~15 min) sur push `dev` + PR ; `release` (AppImage + APK → pré-release `dev-latest`) sur push `dev`.

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
rustc --edition 2021 --test src-tauri/src/cache_store.rs -o /tmp/cache_store_test && /tmp/cache_store_test
rustc --edition 2021 --test src-tauri/src/oauth_loopback.rs -o /tmp/oauth_test && /tmp/oauth_test

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
│   ├── src/image_cache.rs    # commandes cache d'images (télécharger, taille, vider, élaguer)
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
│       │        008_collection_rarity_edition.sql, 009_sync_state.sql
│       └── ygo/001_initial.sql, 002_printing_rarities.sql
├── app/                      # racine de config Nuxt (package.json "app", scripts generate/dev/build)
│   ├── pnpm-lock.yaml
│   ├── vitest.config.ts      # alias ~ -> app/app, env node, include test/unit/**
│   ├── test/unit/            # tests Vitest (HORS de app/app, donc pas vus par Nuxt)
│   │   ├── deckLink, collection, decks, containers, share, scan, settings,
│   │   │   search, cardDetail, userSync, drive, backup (.test.ts)
│   │   └── helpers/testDb.ts, seed.ts, ygoCards.ts
│   └── app/                  # ⚠️ DOUBLE app/ : LE CODE SOURCE RÉEL est ici
│       ├── pages/            # decks/[id].vue, decks/index.vue, collection.vue, index.vue,
│       │                     #   search.vue, settings.vue  (PAS de containers.vue)
│       ├── components/
│       ├── composables/useDatabase.ts   # ⚠️ ici (pas services/), parfois importé ~/services/useDatabase
│       ├── composables/useSettings.ts   # store réactif global des settings
│       ├── services/deckLink.ts
│       ├── services/settings.ts, services/game/ (registre par jeu : types/common/ygo/index)
│       ├── services/imageCache.ts      # wrappers des commandes Rust du cache d'images
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
  - `printings.id` = code d'impression : quand un code existe en plusieurs raretés, `printings` n'en garde qu'une (la dernière écrite). **Toutes** les raretés sont dans `printing_rarities(set_code, rarity, rarity_code)` (migration `ygo/002`, remplie par la synchro ; vide sur une base synchronisée avant → la synchro relance **un** téléchargement complet). Lecture : `printingRarities()` / `CardPrinting.rarities` (`services/card/detail.ts`), repli sur `printings.rarity`.
- **`user.db`** — collection, containers, decks, settings. Migrations `user/001` (collection, containers, decks, deck_cards, deckbox_cards, deckbox_decks, binder_slots, bulk_box_contents, *_details, vue `card_locations`), `002` (settings k/v + seed), `003` (`printing_id` sur collection), `004` (nettoyage des assignations d'entrées soft-deleted), `005` (`binder_slots` reconstruite sans `UNIQUE(collection_id)` : plusieurs cases par pile ; vue `card_locations` recréée), `006` (`collection.trade_qty` : copies proposées à l'échange, 0..quantity borné par l'app), `007` (`shared_collections` : collections reçues, une par (jeu, propriétaire), code stocké tel quel), `008` (`collection.rarity` TEXT NULL = non précisée, `collection.first_edition` 0/1), `009` (`sync_state` k/v : `device_id`, `base` = instantané de la dernière synchro, `backup` = état local avant la dernière fusion ; jamais synchronisée).

**Choix du nom** (`app/app/utils/db-names.ts`, `dbName(base)`) : `.test.db` si `VITE_TEST_MODE==='true'`, `.dev.db` si `import.meta.env.DEV`, sinon `.db`. Exporte `DB_NAMES = {user, ygo}`.
**Côté Rust** (`src-tauri/src/lib.rs`, `db_name()`) : `option_env!("VITE_TEST_MODE")==Some("true")` → `.test.db` ; `cfg!(debug_assertions)` → `.dev.db` ; sinon `.db`.
**`useDatabase.ts`** : cache les connexions via une promesse partagée (une seule init concurrente) ; applique `PRAGMA foreign_keys = ON` par connexion (best-effort) ; `resetDatabaseInstance()` existe.

**Procédure de reset dev** (si checksum cassé) : fermer l'app → `rm user.dev.db*` (et/ou `cards-ygo.dev.db*`) → `pnpm dev` recrée à neuf → re-sync des cartes dans l'app si la base ygo a été supprimée → **régénérer la fixture** (`./e2e/fixtures/build-fixture.sh`).

---

## 5. CE QUI EST FAIT

### Phases
Phases 1–4 ✅ · **Phase 5 (OCR) ✅** (fonctionne sur téléphone ; rareté, 1re édition, langue) · Phase 6 ✅ · Phase 7 ✅ · **Phase 8 (Partage) ✅** (scan QR à valider sur téléphone) · **Phase 10 (Testing) ✅** (E2E + unitaires) · **Phase 9 (Settings) en cours** · Phase 2 ✅ (structure, refonte mobile).

### Phase 9 — Settings (en cours)
- `services/game/` : registre par jeu (`GameDefinition` : conditions, langues, défauts). Les couches génériques interrogent le registre, jamais de valeurs YGO en dur.
- `services/settings.ts` (DB + cache) + `composables/useSettings.ts` (store réactif `createGlobalState`, écriture directe, `ensureLoaded()` au boot).
- Défauts d'ajout en collection résolus par jeu (`services/collection.ts`) ; `settings.vue` branchée ; `cardDetail.vue` consomme le registre.
- **Stockage** : taille du cache affichée, vidage, limite appliquée (LRU par mtime : un fichier relu est « touché ») à l'enregistrement et à chaque lancement (`app.vue` → `pruneImageCache`). Après suppression de fichiers, `forgetCachedImages()` vide les URLs résolues en mémoire (`useCardImage`).
- **Synchronisation** : version locale affichée, « Vérifier les mises à jour » et « Forcer la resynchronisation » (`syncYgo({ force: true })`, progression dans l'overlay d'`app.vue`).
- **Partage** (nom affiché, même réglage que la page Partage) et **Apparence** (thème système / clair / sombre, `useColorMode`) : sections ajoutées avec la refonte mobile (plus de bouton de thème dans l'en-tête sur mobile).
- **Reste** : `favoriteGame` / `showGamePicker` sont stockés et éditables mais rien ne les consomme encore (pas de sélecteur de jeu tant qu'il n'y a qu'un jeu).

### Collection (Phase 4)
- **Toute ma collection** : `listCollectionCards(game, { search, onlyTrade, sort })` (`services/collection.ts`) — une ligne par carte logique (artworks regroupés, vignette = artwork le plus possédé), quantités possédée / à l'échange / non rangée ; tri nom / quantité / ajout récent. Barre de filtres dans `collection.vue` (recherche debounced 250 ms).
- **À l'échange** : `trade_qty` par pile, édité dans la fiche carte (`#entry-trade-qty-input`), borné à la quantité (à l'ajout, à la modification, et quand la quantité baisse). Prérequis du partage (Phase 8). La vente n'est pas modélisée (pas de prix) : à ajouter le jour où on en a besoin.

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
  - Toutes les requêtes passent par la commande Rust `google_request` (pas de CORS ; refuse tout ce qui n'est pas `https://oauth2.googleapis.com/` ou `https://www.googleapis.com/`).
- **Transport Drive** (`drive.ts`) : un fichier `card-manager-sync.json` dans `appDataFolder`. Lecture : ETag via **API v2** (`/drive/v2/files/{id}?fields=etag`, v3 n'a plus d'ETag) avant/après téléchargement. Écriture : `PUT /upload/drive/v2/files/{id}` + `If-Match` → **412** si un autre appareil a écrit → refusion. Création : si deux appareils créent en même temps, le plus récent supprime le sien. Version = `fileId|etag`.
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

### Mode test (committé)
- `src-tauri/src/lib.rs` : `db_name()` gère le mode test (a corrigé au passage un bug prod : migrations enregistrées pour le mauvais nom de base en build test → table settings manquante).
- `src-tauri/build.rs` : rerun si `VITE_TEST_MODE` change.
- `app/app/plugins/test-reset.client.ts` (actif si `VITE_TEST_MODE==='true'`) :
  - `window.__resetTestDb()` — vide les tables user (sauf `_sqlx_migrations`).
  - `window.__seedRarities(setCode, raretés)` — remplit `printing_rarities` pour un code (la fixture n'en contient pas).
  - `window.__seedOwned(cardId, qty)` — INSERT direct d'une ligne `collection` pour un `card_id` exact ; lit `PRAGMA table_info(collection)` pour s'adapter aux colonnes (condition/language/printing_id/timestamps si présents ; NOT NULL sans défaut → valeur de secours).
- `app/app/app.vue` : `runSync()` retourne tôt si `VITE_TEST_MODE`.

### E2E — 10 parcours (local + CI), dans `e2e/specs/`
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
10. `settings-storage` — `/settings` → `[data-section=storage]` → `#image-cache-size[data-cache-bytes]` numérique → `#image-cache-clear` → `0` (vérifie que les commandes Rust sont enregistrées).

**Leçon deck-range** (⚠️ réutilisable) : « Dark Magician » a plusieurs artworks ; l'ordre des résultats diffère entre `/search` et la sidebar du deck → la carte possédée ≠ la carte du deck → `owned=0`. Résolu en possédant **le `card_id` exact** de la carte du deck via `__seedOwned`. Tout test qui a besoin d'un état de collection précis doit faire pareil, ne pas dépendre de l'ordre de recherche.

### Conventions de sélecteurs E2E (validées sous WebKit)
- **`UDropdownMenu` ET `USelect`** ciblés via le slot `#item` où on rend notre markup avec `:data-menu-action` / `:data-select-value`, + `:data-menu-trigger` / `id` sur le trigger. Le contenu **téléporté** (portal) est trouvable par `document.querySelector`.
- **`USelect` v4.8 = combobox Reka** (`<button role="combobox">` + `reka-select-content-*` téléporté), PAS un `<select>` natif : on ouvre (clic trigger) puis on clique l'option téléportée portant `data-select-value`.
- `id` sémantiques kebab-case + `data-*`. **Pas de data-testid.** Inspiration : github.com/Morgawr/kechimochi.

### Contournements WebKitWebDriver (tout via `browser.execute`)
`elementSendKeys` KO → `typeInto` (setter du prototype `HTMLInputElement` **ou** `HTMLTextAreaElement` selon l'élément, descend dans le wrapper Nuxt UI si besoin, + dispatch input/change). Actions API KO → pas de scroll/clic natif. Clics natifs interceptés → `click` dispatche une séquence pointer/mouse. `free(): corrupted unsorted chunks` à la fermeture = inoffensif. Éléments `opacity-0 group-hover` → le clic JS marche quand même.

### `data-*` / `id` posés (committés)
`cardDetail.vue` (#card-detail, #card-detail-owned[data-owned-count], #btn-quick-add, #btn-range-card) · `cardThumb.vue` (.card-thumb[data-card-id]) · `search.vue` (#search-card-input, #search-results) · `containerCreateModal.vue` (data-type, .container-type-btn, #container-name-input, #container-{pages,rows,cols,capacity}-input, #container-create-confirm) · `containerTree.vue` (#container-create-btn, .container-item[data-container-id/name], data-menu-trigger, #item data-menu-action rename/edit/delete, #container-rename-input/confirm, #container-delete-confirm ; non rangées = data-container-id="__unranged__") · `containerPicker.vue` (.picker-container[data-picker-container-id], #picker-qty-input, #picker-confirm) · `collection.vue` (#container-content, .container-card[data-content-card-id], [data-unassign], #unassign-confirm) · `binderView.vue` (.binder-slot[data-slot-page/row/col/filled/card-id], [data-slot-clear], #binder-prev/next-page, data-binder-page) · `unrangedCardPicker.vue` (.unranged-picker-card[data-picker-card-id], #unranged-picker-search) · `decks/index.vue` (#deck-create-btn, #deck-create-empty, #deck-name-input, #deck-create-confirm, #deck-rename-input/confirm, #deck-delete-confirm) · `DeckCard.vue` (.deck-card[data-deck-id/name], data-menu-trigger, #item data-menu-action rename/range/delete) · `DeckBoard.vue` (prop board → :data-board, .deck-board-card[data-deck-card-id/data-quantity], data-board-count, #item data-menu-action info/add/remove/move, data-menu-trigger, [data-move]) · `decks/[id].vue` (#deck-search-input, .deck-search-result[data-search-card-id], data-total-cards, boards main/extra/side, #deck-range-btn, **data-banlist-alert**) · `DeckboxRangeModal.vue` (#deck-range-select, #item data-select-value, #deck-range-confirm, data-range-modal-body, data-range-plan, data-plan-total) · `collection.vue` (vue complète : `[data-container-id=__all__]`, #collection-search, #collection-sort + #item data-select-value, #collection-only-trade, [data-trade-qty]) · `cardDetail.vue` édition d'exemplaire ([data-entry-edit], #entry-trade-qty-input, #entry-save-btn, [data-entry-trade-qty], #add-rarity-select, #entry-rarity-select, #entry-first-edition, [data-entry-rarity], [data-entry-first-edition]) · `share.vue` ([data-share-section=mine|receive], #share-owner-input, #share-only-trade, #share-generate-btn, #share-qr[data-qr-frames], [data-share-code], #share-copy-btn, #share-scan-btn, #share-import-input, #share-import-btn, [data-saved-share-id], #shared-view, #shared-search, #shared-only-trade, #shared-only-missing, #shared-delete-btn, .shared-card[data-shared-card-id/qty/trade/mine]) · `QrScanner.vue` ([data-scan-progress]) · `scan.vue` (#scan-view, [data-scan-current], #scan-auto-add, #scan-add-btn, [data-scan-count], [data-scan-entry], [data-scan-undo]) · `collection.vue` #scan-open-btn · `settings.vue` (nav [data-section] devices/backup/collection/share/appearance/sync/storage/games, #backup-export, #backup-import, #backup-import-confirm, #backup-csv, #backup-restore, [data-restore-point], #gsync-connect, #gsync-now, #gsync-disconnect, [data-gsync-email], [data-gsync-last], #image-cache-size[data-cache-bytes], #image-cache-clear, #sync-check-btn, #sync-force-btn, [data-sync-version], #settings-owner-name, #settings-color-mode) · mobile : `MobileTabBar.vue` ([data-tab]), #mobile-settings-btn, [data-mobile-segment], [data-mobile-back-all], [data-mobile-board], [data-mobile-deck-add], [data-mobile-share-section].

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

### Release de test (`.github/workflows/release.yml`)
- Push sur `dev` (ou lancement manuel) → jobs `linux` (AppImage, ubuntu-22.04) + `android` (APK arm64) → job `publish` recrée la pré-release **`dev-latest`** avec `card-manager-linux-x86_64.AppImage` et `card-manager-android-arm64.apk`. Sur une PR qui touche le workflow : build sans publication.
- Version = `0.1.<run_number>` (passée via `--config`) → chaque build met à jour le précédent.
- Android : `src-tauri/gen/` n'est pas versionné → `tauri android init --ci` + `tauri icon` en CI, build `--target aarch64`, puis `zipalign` + `apksigner`.
- **Signature (dépôt public)** : la clé n'est **jamais** dans git (`*.keystore`/`*.jks` ignorés). Elle vit dans les secrets du dépôt `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, **configurés** (6 nov. 2026 : clé générée en session cloud et remise à Félix, qui la conserve ; `scripts/android-keystore.sh` reste l'outil pour en refaire une). La perdre = plus de mise à jour des APK installés. Empreinte SHA-1 du certificat (client OAuth Android de la synchro) : `41:26:48:4D:D2:52:D7:C7:45:74:9D:35:81:98:51:3C:7B:B1:D6:DA`. Paquet Android : `com.card_manager.app`. Sans secret (ex. PR de fork), la CI signe avec une **clé jetable** + warning. L'ancienne clé de test (`.github/release/android-test.keystore`, publique via l'historique) est **abandonnée** : un APK signé avec doit être désinstallé avant d'installer un APK signé avec la nouvelle clé.
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

### ✅ Tests unitaires settings / recherche / fiche carte : faits. 205 Vitest au total (dont 22 synchro).

### ✖ Protection de branche : abandonnée (choix de Félix) ; les merges se font après CI verte.

### Phases futures (hors testing)
- **Phase 5 — OCR** : fonctionne sur téléphone (retour de Félix) ; rareté, 1re édition, langue et recadrage faits. Reste à valider sur téléphone la lecture de la 1re édition et le recadrage.
- **Phase 9 — Settings** : terminer (base en place, cf. §5).
- **Phase 2 (structure)** : terminée avec la refonte mobile.
- **Synchro PC ↔ mobile** : faite (cf. §5), synchro au premier plan + restauration faites ; à valider sur PC + téléphone réels (connexion Google, aller-retour Drive).
- **Plan validé par Félix (9 nov. 2026)** : 1) sauvegarde ✅ ; 2) appli **entièrement en anglais** (UI ; les échanges avec Félix restent en français) ; 3) performances 5000 cartes + E2E en taille téléphone ; 4) préparation multi-jeu (jeu courant + sélecteur, point d'entrée unique par jeu : base de cartes / images / recherche / decks / scan, partage v2 à identifiants non numériques, faux jeu dans les tests). Le 2e jeu sera choisi ensuite.

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
- Tests unitaires : Node >= 22 obligatoire (`node:sqlite`) ; le warning « SQLite is an experimental feature » est normal.
