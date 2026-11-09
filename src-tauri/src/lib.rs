use tauri_plugin_sql::{Migration, MigrationKind};

mod cache_store;
mod card_data;
mod card_sources;
mod google;
mod http;
mod image_cache;
mod oauth_loopback;

fn db_name(name: &str) -> String {
    // Test build: the frontend is generated with VITE_TEST_MODE=true and the
    // Tauri binary is compiled in the same env, so we read it at compile time.
    // This MUST match the suffix chosen by db-names.ts on the JS side, so that
    // migrations are registered for the same database file the app opens.
    if option_env!("VITE_TEST_MODE") == Some("true") {
        format!("sqlite:{}.test.db", name)
    } else if cfg!(debug_assertions) {
        format!("sqlite:{}.dev.db", name)
    } else {
        format!("sqlite:{}.db", name)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux : WebKitGTK peut afficher une fenêtre vide avec son moteur de
    // rendu DMABUF selon le pilote graphique (NVIDIA, certaines sessions
    // Wayland), surtout en AppImage (WebKitGTK d'Ubuntu 22.04 sur un système
    // plus récent). On le désactive, sauf si l'utilisateur a choisi lui-même.
    // À faire avant la création de la moindre fenêtre (GTK lit la variable à
    // l'initialisation) : premier appel de run(), encore mono-fil.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let user_migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/user/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "settings table",
            sql: include_str!("../migrations/user/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "collection printing_id",
            sql: include_str!("../migrations/user/003_collection_printing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "detach deleted collection entries",
            sql: include_str!("../migrations/user/004_detach_deleted_collection.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "binder slots: several copies of one entry",
            sql: include_str!("../migrations/user/005_binder_slots_multi_copy.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "collection trade quantity",
            sql: include_str!("../migrations/user/006_collection_trade_qty.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "shared collections",
            sql: include_str!("../migrations/user/007_shared_collections.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "collection rarity and first edition",
            sql: include_str!("../migrations/user/008_collection_rarity_edition.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "sync state",
            sql: include_str!("../migrations/user/009_sync_state.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let ygo_migrations = vec![
        Migration {
            version: 1,
            description: "initial ygo schema",
            sql: include_str!("../migrations/ygo/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "printing rarities",
            sql: include_str!("../migrations/ygo/002_printing_rarities.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "shared card contract views",
            sql: include_str!("../migrations/ygo/003_card_contract.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mtg_migrations = vec![Migration {
        version: 1,
        description: "initial mtg schema",
        sql: include_str!("../migrations/mtg/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    let builder = tauri::Builder::default();

    // scan de QR codes (partage de collection) : caméra, mobile uniquement
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    // scan de cartes (OCR ML Kit) : plugin local, Android uniquement
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_card_scanner::init())
        .plugin(tauri_plugin_safe_area::init())
        .plugin(tauri_plugin_google_auth::init());

    builder
        .plugin(tauri_plugin_opener::init())
        // sauvegarde : « Enregistrer sous » / « Ouvrir » + lecture/écriture du fichier choisi
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db_name("user"), user_migrations)
                .add_migrations(&db_name("cards-ygo"), ygo_migrations)
                .add_migrations(&db_name("cards-mtg"), mtg_migrations)
                .build(),
        )
        .manage(google::Loopbacks::default())
        .manage(card_data::Streams::default())
        .invoke_handler(tauri::generate_handler![
            google::google_request,
            google::oauth_loopback_start,
            google::oauth_loopback_wait,
            image_cache::cache_card_image,
            image_cache::image_cache_size,
            image_cache::clear_image_cache,
            image_cache::prune_image_cache,
            card_data::card_data_get,
            card_data::jsonl_open,
            card_data::jsonl_next,
            card_data::jsonl_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
