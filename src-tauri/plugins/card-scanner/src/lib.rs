//! Plugin de scan de cartes : reconnaissance de texte on-device (ML Kit)
//! sur une image fournie par le front (`plugin:card-scanner|recognize`).
//! Implémenté côté Android uniquement ; rien n'est enregistré ailleurs.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.cardmanager.cardscanner";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("card-scanner")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "CardScannerPlugin")?;
            Ok(())
        })
        .build()
}
