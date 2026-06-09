use tauri_plugin_sql::{Migration, MigrationKind};

mod image_cache;

fn db_name(name: &str) -> String {
    if cfg!(debug_assertions) {
        format!("sqlite:{}.dev.db", name)
    } else {
        format!("sqlite:{}.db", name)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let user_migrations = vec![Migration {
        version: 1,
        description: "initial schema",
        sql: include_str!("../migrations/user/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    let ygo_migrations = vec![Migration {
        version: 1,
        description: "initial ygo schema",
        sql: include_str!("../migrations/ygo/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db_name("user"), user_migrations)
                .add_migrations(&db_name("cards-ygo"), ygo_migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![image_cache::cache_card_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}