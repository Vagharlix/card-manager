use tauri_plugin_sql::{Migration, MigrationKind};
 
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
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:user.db", user_migrations)
                .add_migrations("sqlite:cards-ygo.db", ygo_migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
