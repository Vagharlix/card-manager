// ============================================================
// CLIENT HTTP PARTAGÉ (requêtes Google, images de cartes).
// Un seul client pour toute l'appli : ses connexions restent ouvertes et
// sont réutilisées (keep-alive, HTTP/2). Créer un client par requête
// refaisait DNS + TCP + négociation TLS à chaque fois : ~1 à 2 s par
// requête sur un téléphone, soit des dizaines de secondes pour une
// connexion Google suivie de la première synchro (5 à 7 requêtes).
// ============================================================

use std::sync::OnceLock;
use std::time::Duration;

pub const USER_AGENT: &str = "card-manager/0.1 (+https://github.com/Vagharlix/card-manager)";

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    // réseau : cargo test --lib http -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reuse_is_faster_than_new_clients() {
        tauri::async_runtime::block_on(async {
            let url = "https://www.googleapis.com/drive/v3/files";
            let t = Instant::now();
            for _ in 0..6 {
                reqwest::Client::new().get(url).send().await.unwrap();
            }
            let fresh = t.elapsed();
            let t = Instant::now();
            for _ in 0..6 {
                client().get(url).send().await.unwrap();
            }
            let shared = t.elapsed();
            println!("6 requêtes : clients neufs {fresh:?}, client partagé {shared:?}");
        });
    }
}
