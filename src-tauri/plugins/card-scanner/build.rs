// Commandes exposées au front ; elles sont exécutées par le plugin Kotlin
// (android/src/main/java/CardScannerPlugin.kt).
const COMMANDS: &[&str] = &["recognize"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
