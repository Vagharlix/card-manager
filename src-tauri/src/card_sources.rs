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
];

pub fn card_data_url_allowed(url: &str) -> bool {
    CARD_DATA_PREFIXES.iter().any(|p| url.starts_with(p))
        && !url.contains("..")
        && !url.chars().any(|c| c.is_whitespace() || c == '\\')
}

/// Source de l'image d'une carte : (dossier relatif dans le cache, URL).
/// `size` : "small" (vignette), "full", "cropped" (illustration seule).
/// YGO garde le dossier racine historique (<cache>/card-images/<size>/).
pub fn image_source(game: &str, id: &str, size: &str) -> Option<(PathBuf, String)> {
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
        _ => None,
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
    }

    #[test]
    fn ygo_images_keep_the_historic_folder() {
        let (dir, url) = image_source("ygo", "46986414", "small").unwrap();
        assert_eq!(dir, PathBuf::from("small"));
        assert_eq!(
            url,
            "https://images.ygoprodeck.com/images/cards_small/46986414.jpg"
        );
        let (_, full) = image_source("ygo", "46986414", "full").unwrap();
        assert!(full.contains("/cards/46986414.jpg"));
    }

    #[test]
    fn mtg_images_from_the_printing_id() {
        let id = "0000419b-0bba-4488-8f7a-6194544ce91e";
        let (dir, url) = image_source("mtg", id, "small").unwrap();
        assert_eq!(dir, PathBuf::from("mtg").join("small"));
        assert_eq!(
            url,
            format!("https://cards.scryfall.io/small/front/0/0/{}.jpg", id)
        );
        let (_, full) = image_source("mtg", id, "full").unwrap();
        assert!(full.starts_with("https://cards.scryfall.io/normal/front/0/0/"));
        let (_, crop) = image_source("mtg", id, "cropped").unwrap();
        assert!(crop.starts_with("https://cards.scryfall.io/art_crop/"));
        assert!(image_source("mtg", "a", "small").is_none());
    }

    #[test]
    fn unknown_game_has_no_images() {
        assert!(image_source("nope", "1", "small").is_none());
    }
}
