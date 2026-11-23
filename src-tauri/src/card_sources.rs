// ============================================================
// SOURCES PAR JEU (std seul, testé par `rustc --test`) :
//  - d'où viennent les images de cartes (URL + dossier du cache) ;
//  - quelles URL la commande de téléchargement des données de cartes
//    (card_data.rs) a le droit d'ouvrir.
// Ajouter un jeu = une branche dans image_source + ses hôtes ci-dessous.
// ============================================================

use std::path::PathBuf;

/// Préfixes d'URL autorisés pour les données de cartes (métadonnées et
/// fichiers en masse). Tout le reste est refusé.
const CARD_DATA_PREFIXES: &[&str] = &[
    "https://api.scryfall.com/", // Magic : métadonnées des fichiers en masse
    "https://data.scryfall.io/", // Magic : fichiers en masse (JSONL gzip)
    "https://api.rifthunt.com/", // Riftbound : fichier en masse + recherche
];

pub fn card_data_url_allowed(url: &str) -> bool {
    CARD_DATA_PREFIXES.iter().any(|p| url.starts_with(p))
        && !url.contains("..")
        && !url.chars().any(|c| c.is_whitespace() || c == '\\')
}

/// Jeux dont l'adresse d'image ne se déduit pas de l'id : le front fournit,
/// pour chaque carte, un chemin relatif (« indice ») enregistré côté Rust
/// (commande image_sources_set, image_cache.rs).
pub fn needs_hint(game: &str) -> bool {
    game == "riftbound"
}

/// Indice d'image accepté : chemin relatif simple (« ogn/001/nom.webp?v=8de8 »),
/// sans remontée ni hôte : il ne peut viser que le serveur d'images du jeu.
pub fn is_safe_hint(hint: &str) -> bool {
    !hint.is_empty()
        && hint.len() <= 200
        && !hint.starts_with('/')
        && !hint.contains("..")
        && !hint.contains("//")
        && hint.chars().all(|c| {
            c.is_ascii_lowercase()
                || c.is_ascii_digit()
                || matches!(c, '-' | '_' | '.' | '/' | '?' | '=')
        })
}

/// Source de l'image d'une carte : (dossier relatif dans le cache, URL).
/// `size` : "small" (vignette), "full", "cropped" (illustration seule).
/// `hint` : chemin fourni par le front pour les jeux de `needs_hint`.
/// YGO garde le dossier racine historique (<cache>/card-images/<size>/).
pub fn image_source(
    game: &str,
    id: &str,
    size: &str,
    hint: Option<&str>,
) -> Option<(PathBuf, String)> {
    match game {
        "ygo" => {
            let cdn_path = match size {
                "full" => "cards",
                "cropped" => "cards_cropped",
                _ => "cards_small",
            };
            Some((
                PathBuf::from(size),
                format!(
                    "https://images.ygoprodeck.com/images/{}/{}.jpg",
                    cdn_path, id
                ),
            ))
        }
        // Scryfall : https://cards.scryfall.io/<version>/front/<a>/<b>/<uuid>.jpg
        // (a, b = deux premiers caractères de l'uuid de l'impression)
        "mtg" => {
            let mut chars = id.chars();
            let (a, b) = (chars.next()?, chars.next()?);
            let version = match size {
                "full" => "normal",
                "cropped" => "art_crop",
                _ => "small",
            };
            Some((
                PathBuf::from("mtg").join(size),
                format!(
                    "https://cards.scryfall.io/{}/front/{}/{}/{}.jpg",
                    version, a, b, id
                ),
            ))
        }
        // RiftHunt : https://images.rifthunt.com/cards/<taille>/front/<set>/<n°>/<nom>.webp?v=…
        // (WebP 200 px de large en « small », 480 px en « normal »)
        "riftbound" => {
            let hint = hint.filter(|h| is_safe_hint(h))?;
            let (dir, version) = match size {
                "full" => ("full", "normal"),
                _ => ("small", "small"),
            };
            Some((
                PathBuf::from("riftbound").join(dir),
                format!("https://images.rifthunt.com/cards/{}/front/{}", version, hint),
            ))
        }
        _ => None,
    }
}

/// Type MIME d'une image d'après ses premiers octets (les serveurs d'images
/// envoient du JPEG, du PNG ou du WebP).
pub fn image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_data_urls() {
        assert!(card_data_url_allowed(
            "https://api.scryfall.com/bulk-data/default-cards"
        ));
        assert!(card_data_url_allowed(
            "https://data.scryfall.io/default-cards/default-cards-20261108220648.jsonl.gz"
        ));
        assert!(!card_data_url_allowed("http://data.scryfall.io/x"));
        assert!(!card_data_url_allowed(
            "https://data.scryfall.io.evil.com/x"
        ));
        assert!(!card_data_url_allowed(
            "https://evil.com/https://data.scryfall.io/"
        ));
        assert!(!card_data_url_allowed("https://data.scryfall.io/../x"));
        assert!(!card_data_url_allowed("https://data.scryfall.io/a b"));
        assert!(!card_data_url_allowed("file:///etc/passwd"));
        assert!(card_data_url_allowed("https://api.rifthunt.com/bulk/cards"));
        assert!(!card_data_url_allowed("https://api.rifthunt.com.evil.com/"));
    }

    #[test]
    fn riftbound_images_need_a_safe_hint() {
        let id = "01afb7e3-0e97-42a2-9458-28a51a2626b4";
        let hint = "ogn/001/blazing-scorcher.webp?v=8de89b4b8fb3";
        let (dir, url) = image_source("riftbound", id, "small", Some(hint)).unwrap();
        assert_eq!(dir, PathBuf::from("riftbound").join("small"));
        assert_eq!(
            url,
            "https://images.rifthunt.com/cards/small/front/ogn/001/blazing-scorcher.webp?v=8de89b4b8fb3"
        );
        let (dir, full) = image_source("riftbound", id, "full", Some(hint)).unwrap();
        assert_eq!(dir, PathBuf::from("riftbound").join("full"));
        assert!(full.starts_with("https://images.rifthunt.com/cards/normal/front/"));
        assert!(image_source("riftbound", id, "small", None).is_none());
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../../b",
            "a//evil.com/x",
            "https://evil.com/x",
            "a b",
            "A/B",
            "a\\b",
        ] {
            assert!(!is_safe_hint(bad), "{}", bad);
            assert!(image_source("riftbound", id, "small", Some(bad)).is_none());
        }
        assert!(needs_hint("riftbound"));
        assert!(!needs_hint("mtg"));
    }

    #[test]
    fn mime_from_bytes() {
        assert_eq!(image_mime(b"\x89PNG\r\n"), "image/png");
        assert_eq!(image_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp");
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff]), "image/jpeg");
    }

    #[test]
    fn ygo_images_keep_the_historic_folder() {
        let (dir, url) = image_source("ygo", "46986414", "small", None).unwrap();
        assert_eq!(dir, PathBuf::from("small"));
        assert_eq!(
            url,
            "https://images.ygoprodeck.com/images/cards_small/46986414.jpg"
        );
        let (_, full) = image_source("ygo", "46986414", "full", None).unwrap();
        assert!(full.contains("/cards/46986414.jpg"));
    }

    #[test]
    fn mtg_images_from_the_printing_id() {
        let id = "0000419b-0bba-4488-8f7a-6194544ce91e";
        let (dir, url) = image_source("mtg", id, "small", None).unwrap();
        assert_eq!(dir, PathBuf::from("mtg").join("small"));
        assert_eq!(
            url,
            format!("https://cards.scryfall.io/small/front/0/0/{}.jpg", id)
        );
        let (_, full) = image_source("mtg", id, "full", None).unwrap();
        assert!(full.starts_with("https://cards.scryfall.io/normal/front/0/0/"));
        let (_, crop) = image_source("mtg", id, "cropped", None).unwrap();
        assert!(crop.starts_with("https://cards.scryfall.io/art_crop/"));
        assert!(image_source("mtg", "a", "small", None).is_none());
    }

    #[test]
    fn unknown_game_has_no_images() {
        assert!(image_source("nope", "1", "small", None).is_none());
    }
}
