use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn cache_card_image(
    app: tauri::AppHandle,
    passcode: String,
    size: String,
) -> Result<String, String> {
    let cdn_path = match size.as_str() {
        "full" => "cards",
        "cropped" => "cards_cropped",
        _ => "cards_small",
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("card-images")
        .join(&size);

    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let file_path: PathBuf = cache_dir.join(format!("{}.jpg", passcode));

    // déjà en cache → retourner le chemin
    if file_path.exists() {
        return Ok(file_path.to_string_lossy().to_string());
    }

    // télécharger (Rust n'est pas soumis au CORS)
    let url = format!(
        "https://images.ygoprodeck.com/images/{}/{}.jpg",
        cdn_path, passcode
    );

    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("fetch failed: {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}