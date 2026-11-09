use std::path::PathBuf;
use tauri::Manager;

use crate::cache_store;

// dossier racine du cache d'images : <app_cache_dir>/card-images/[<jeu>/]<size>/<id>.jpg
fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("card-images"))
}

// Source des images de chaque jeu : (dossier dans le cache, URL).
// Ajouter un jeu = une branche ici. YGO garde le dossier racine historique
// (<cache>/card-images/<size>/) pour ne pas retélécharger un cache existant.
fn image_source(game: &str, id: &str, size: &str) -> Option<(PathBuf, String)> {
    match game {
        "ygo" => {
            let cdn_path = match size {
                "full" => "cards",
                "cropped" => "cards_cropped",
                _ => "cards_small",
            };
            Some((
                PathBuf::from(size),
                format!("https://images.ygoprodeck.com/images/{}/{}.jpg", cdn_path, id),
            ))
        }
        _ => None,
    }
}

#[tauri::command]
pub async fn cache_card_image(
    app: tauri::AppHandle,
    game: String,
    id: String,
    size: String,
) -> Result<String, String> {
    if !cache_store::is_safe_name(&game) || !cache_store::is_safe_name(&id) {
        return Err("invalid card id".into());
    }
    let size = match size.as_str() {
        "full" | "cropped" => size,
        _ => "small".to_string(),
    };
    let (dir, url) =
        image_source(&game, &id, &size).ok_or_else(|| format!("no images for game {}", game))?;

    let cache_dir = cache_root(&app)?.join(dir);
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let file_path: PathBuf = cache_dir.join(format!("{}.jpg", id));

    // déjà en cache → marquer comme récemment utilisé (LRU) et retourner le chemin
    if file_path.exists() {
        cache_store::touch(&file_path);
        return Ok(file_path.to_string_lossy().to_string());
    }

    // télécharger (Rust n'est pas soumis au CORS)
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("fetch failed: {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
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
