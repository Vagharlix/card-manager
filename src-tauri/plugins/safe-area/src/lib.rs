//! Marges système Android exposées à la page : depuis Android 15 (SDK cible
//! ≥ 35), l'app s'affiche bord à bord, sous la barre d'état et la barre de
//! gestes. Le Kotlin lit ces marges et les pousse en variables CSS
//! (--safe-top / --safe-bottom / --safe-left / --safe-right).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.cardmanager.safearea";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("safe-area")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "SafeAreaPlugin")?;
            Ok(())
        })
        .build()
}
