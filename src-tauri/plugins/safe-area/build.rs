// Commande exposée au front, exécutée par le plugin Kotlin (SafeAreaPlugin.kt).
const COMMANDS: &[&str] = &["insets"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
