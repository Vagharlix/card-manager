//! Connexion Google native sur Android pour la synchro Drive : le système
//! (Google Play Services) demande l'accord de l'utilisateur et renvoie un
//! jeton d'accès limité au dossier caché de l'appli (`drive.appdata`).
//! L'appli est reconnue par son nom de paquet et l'empreinte de sa clé de
//! signature (client OAuth « Android » du projet Google Cloud) : aucun
//! secret dans l'APK. Sur desktop, la connexion passe par le navigateur
//! (cf. src-tauri/src/google.rs).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.cardmanager.googleauth";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("google-auth")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin(PLUGIN_IDENTIFIER, "GoogleAuthPlugin")?;
            Ok(())
        })
        .build()
}
