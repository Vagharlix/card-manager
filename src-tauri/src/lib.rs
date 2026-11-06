use tauri_plugin_sql::{Migration, MigrationKind};

mod cache_store;
mod image_cache;

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
    ];

    let ygo_migrations = vec![Migration {
        version: 1,
        description: "initial ygo schema",
        sql: include_str!("../migrations/ygo/001_initial.sql"),
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
        .plugin(tauri_plugin_safe_area::init());

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db_name("user"), user_migrations)
                .add_migrations(&db_name("cards-ygo"), ygo_migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            image_cache::cache_card_image,
            image_cache::image_cache_size,
            image_cache::clear_image_cache,
            image_cache::prune_image_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}