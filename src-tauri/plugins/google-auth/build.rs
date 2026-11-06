// Commandes exposées au front, exécutées par le plugin Kotlin (GoogleAuthPlugin.kt).
const COMMANDS: &[&str] = &["authorize", "clear_token"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
