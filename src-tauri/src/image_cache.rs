use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;
use tokio::sync::Semaphore;

use crate::cache_store;
use crate::card_sources;

// dossier racine du cache d'images : <app_cache_dir>/card-images/[<jeu>/]<size>/<id>.jpg
fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("card-images"))
}

// téléchargements simultanés au plus : une grille qui s'ouvre sur des
// centaines de cartes jamais vues ne sature ni le réseau ni le serveur
// d'images (YGOPRODeck demande de rester sous ~20 requêtes/s)
const MAX_DOWNLOADS: usize = 6;

fn downloads() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_DOWNLOADS))
}

/// Chemin de l'image d'une carte dans le cache disque ; téléchargée d'abord
/// si absente (Rust n'est pas soumis au CORS).
async fn cached_image(
    app: &tauri::AppHandle,
    game: &str,
    id: &str,
    size: &str,
) -> Result<PathBuf, (u16, String)> {
    if !cache_store::is_safe_name(game) || !cache_store::is_safe_name(id) {
        return Err((400, "invalid card id".into()));
    }
    let size = match size {
        "full" | "cropped" => size,
        _ => "small",
    };
    let (dir, url) = card_sources::image_source(game, id, size)
        .ok_or_else(|| (404, format!("no images for game {}", game)))?;

    let cache_dir = cache_root(app).map_err(|e| (500, e))?.join(dir);
    let file_path = cache_dir.join(format!("{}.jpg", id));

    // déjà en cache → marquer comme récemment utilisé (LRU)
    if file_path.exists() {
        cache_store::touch(&file_path);
        return Ok(file_path);
    }

    let _permit = downloads().acquire().await.map_err(|e| (500, e.to_string()))?;
    // une autre requête a pu la télécharger pendant l'attente
    if file_path.exists() {
        return Ok(file_path);
    }
    std::fs::create_dir_all(&cache_dir).map_err(|e| (500, e.to_string()))?;
    let resp = crate::http::client()
        .get(&url)
        .send()
        .await
        .map_err(|e| (502, e.to_string()))?;
    if !resp.status().is_success() {
        return Err((resp.status().as_u16(), format!("fetch failed: {}", resp.status())));
    }
    let bytes = resp.bytes().await.map_err(|e| (502, e.to_string()))?;
    cache_store::write_atomic(&file_path, &bytes).map_err(|e| (500, e.to_string()))?;
    Ok(file_path)
}

/// Protocole `cardimg` : `<img src="cardimg://localhost/<jeu>/<taille>/<id>">`
/// (`http://cardimg.localhost/…` sur Android et Windows). L'image est lue
/// dans le cache, ou téléchargée puis mise en cache. Le navigateur ne demande
/// que les images visibles (chargement différé) et les garde en mémoire :
/// plus aucun appel JS → Rust par vignette.
pub fn serve(
    app: tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        let result = match cache_store::parse_image_path(request.uri().path()) {
            None => Err((400, "bad image path".to_string())),
            Some((game, size, id)) => match cached_image(&app, &game, &id, &size).await {
                Ok(path) => tokio::fs::read(&path).await.map_err(|e| (500, e.to_string())),
                Err(e) => Err(e),
            },
        };
        let response = match result {
            Ok(bytes) => tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", "image/jpeg")
                // une image de carte ne change jamais pour un même id
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes),
            Err((status, message)) => tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "text/plain")
                .header("Access-Control-Allow-Origin", "*")
                .body(message.into_bytes()),
        };
        match response {
            Ok(r) => responder.respond(r),
            Err(_) => responder.respond(tauri::http::Response::new(Vec::new())),
        }
    });
}

/// Taille du cache d'images, en octets.
#[tauri::command]
pub async fn image_cache_size(app: tauri::AppHandle) -> Result<u64, String> {
    cache_store::dir_size(&cache_root(&app)?).map_err(|e| e.to_string())
}

/// Vide entièrement le cache d'images.
#[tauri::command]
pub async fn clear_image_cache(app: tauri::AppHandle) -> Result<(), String> {
    cache_store::clear(&cache_root(&app)?).map_err(|e| e.to_string())
}

/// Ramène le cache sous `limit_mb` Mo (les moins récemment utilisées partent
/// d'abord). Retourne le nombre d'octets libérés.
#[tauri::command]
pub async fn prune_image_cache(app: tauri::AppHandle, limit_mb: u64) -> Result<u64, String> {
    cache_store::prune(&cache_root(&app)?, limit_mb * 1024 * 1024).map_err(|e| e.to_string())
}
