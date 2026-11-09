// ============================================================
// Commandes pour la synchro Google Drive :
//  - google_request : requête HTTPS vers les API Google, faite côté Rust
//    (pas de CORS dans la WebView) ; seules les adresses Google passent.
//  - oauth_loopback_start / oauth_loopback_wait : retour de la connexion
//    Google sur desktop (cf. oauth_loopback.rs).
// La logique (PKCE, jetons, Drive, fusion) est côté TypeScript, testée.
// ============================================================

use crate::oauth_loopback;
use serde::Serialize;
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

const ALLOWED_PREFIXES: &[&str] = &["https://oauth2.googleapis.com/", "https://www.googleapis.com/"];

#[derive(Serialize)]
pub struct GoogleResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn google_request(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<GoogleResponse, String> {
    if !ALLOWED_PREFIXES.iter().any(|p| url.starts_with(p)) {
        return Err(format!("URL not allowed: {url}"));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = crate::http::client()
        .request(method, &url)
        .timeout(Duration::from_secs(60));
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| describe(&e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(GoogleResponse { status, body })
}

// erreur réseau lisible : reqwest n'affiche que « error sending request »,
// la vraie cause (DNS, TLS, délai…) est dans la chaîne des sources
fn describe(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        out.push_str(": ");
        out.push_str(&s.to_string());
        source = s.source();
    }
    out
}

#[derive(Default)]
pub struct Loopbacks(Mutex<HashMap<u16, TcpListener>>);

#[tauri::command]
pub fn oauth_loopback_start(state: State<'_, Loopbacks>) -> Result<u16, String> {
    let listener = oauth_loopback::bind().map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    state.0.lock().map_err(|e| e.to_string())?.insert(port, listener);
    Ok(port)
}

#[derive(Serialize)]
pub struct LoopbackResult {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn oauth_loopback_wait(
    state: State<'_, Loopbacks>,
    port: u16,
    timeout_secs: u64,
) -> Result<LoopbackResult, String> {
    let listener = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&port)
        .ok_or("no listener on this port")?;
    let cb = tauri::async_runtime::spawn_blocking(move || {
        oauth_loopback::wait(listener, Duration::from_secs(timeout_secs))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(LoopbackResult { code: cb.code, state: cb.state, error: cb.error })
}
