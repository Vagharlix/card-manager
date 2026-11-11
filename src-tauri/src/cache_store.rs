// ============================================================
// Gestion d'un dossier de cache sur disque (std uniquement, sans
// dépendance Tauri → testable avec `rustc --test`, cf. CI checks).
//
// Politique LRU approximée par la date de modification : un fichier
// relu est « touché » (mtime = maintenant), et l'élagage supprime les
// plus anciens d'abord jusqu'à repasser sous la limite.
// ============================================================

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

struct Entry {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}

fn collect(dir: &Path, out: &mut Vec<Entry>) -> io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for item in fs::read_dir(dir)? {
        let item = item?;
        let meta = item.metadata()?;
        if meta.is_dir() {
            collect(&item.path(), out)?;
        } else {
            out.push(Entry {
                path: item.path(),
                size: meta.len(),
                modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            });
        }
    }
    Ok(())
}

/// Taille totale (octets) des fichiers sous `dir` ; 0 si absent.
pub fn dir_size(dir: &Path) -> io::Result<u64> {
    let mut entries = Vec::new();
    collect(dir, &mut entries)?;
    Ok(entries.iter().map(|e| e.size).sum())
}

/// Supprime tout le contenu de `dir` (le dossier lui-même est conservé).
pub fn clear(dir: &Path) -> io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for item in fs::read_dir(dir)? {
        let path = item?.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// Supprime les fichiers les plus anciens jusqu'à `total <= limit`.
/// Retourne le nombre d'octets libérés.
pub fn prune(dir: &Path, limit: u64) -> io::Result<u64> {
    let mut entries = Vec::new();
    collect(dir, &mut entries)?;
    let mut total: u64 = entries.iter().map(|e| e.size).sum();
    if total <= limit {
        return Ok(0);
    }
    entries.sort_by_key(|e| e.modified);
    let mut freed = 0;
    for e in entries {
        if total <= limit {
            break;
        }
        fs::remove_file(&e.path)?;
        total -= e.size;
        freed += e.size;
    }
    Ok(freed)
}

/// Nom sûr pour un segment de chemin (jeu, identifiant de carte) : lettres,
/// chiffres, `-` et `_` seulement, 1 à 64 caractères. Empêche de sortir du
/// dossier du cache (`..`, `/`, `\\`).
pub fn is_safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Marque un fichier comme récemment utilisé (best-effort).
pub fn touch(path: &Path) {
    if let Ok(f) = fs::File::options().write(true).open(path) {
        let _ = f.set_modified(SystemTime::now());
    }
}

/// Écrit `bytes` dans `path` sans jamais laisser d'image à moitié écrite à
/// sa place : fichier temporaire dans le même dossier, puis renommage
/// (atomique sur un même disque). Une appli fermée en pleine écriture laisse
/// au pire un `.part` (élagué comme le reste), jamais une image tronquée
/// que le cache servirait ensuite indéfiniment.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("part{}-{}", std::process::id(), n));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e
    })
}

/// Chemin demandé au protocole d'images (`<jeu>/<taille>/<id>`, encodé ou
/// non : `ygo%2Fsmall%2F46986414`) → (jeu, taille, id). None si le chemin
/// n'a pas exactement trois segments sûrs (cf. is_safe_name).
pub fn parse_image_path(path: &str) -> Option<(String, String, String)> {
    let decoded = percent_decode(path.trim_start_matches('/'))?;
    let parts: Vec<&str> = decoded.split('/').collect();
    match parts.as_slice() {
        [game, size, id] if [game, size, id].iter().all(|p| is_safe_name(p)) => {
            Some((game.to_string(), size.to_string(), id.to_string()))
        }
        _ => None,
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cache-store-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("small")).unwrap();
        dir
    }

    fn file(dir: &Path, rel: &str, size: usize, age_secs: u64) -> PathBuf {
        let p = dir.join(rel);
        fs::write(&p, vec![0u8; size]).unwrap();
        let f = fs::File::options().write(true).open(&p).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(age_secs)).unwrap();
        p
    }

    #[test]
    fn safe_names() {
        assert!(is_safe_name("46986414"));
        assert!(is_safe_name("ygo"));
        assert!(is_safe_name("FK-001_a"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("../etc"));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name("a\\b"));
        assert!(!is_safe_name("a.jpg"));
        assert!(!is_safe_name(&"x".repeat(65)));
    }

    #[test]
    fn size_of_missing_dir_is_zero() {
        assert_eq!(dir_size(Path::new("/nonexistent/cache-store")).unwrap(), 0);
    }

    #[test]
    fn size_is_recursive() {
        let d = temp_dir("size");
        file(&d, "a.jpg", 100, 0);
        file(&d, "small/b.jpg", 50, 0);
        assert_eq!(dir_size(&d).unwrap(), 150);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn prune_removes_oldest_first_until_under_limit() {
        let d = temp_dir("prune");
        let old = file(&d, "small/old.jpg", 100, 300);
        let mid = file(&d, "small/mid.jpg", 100, 200);
        let new = file(&d, "new.jpg", 100, 100);
        assert_eq!(prune(&d, 150).unwrap(), 200);
        assert!(!old.exists() && !mid.exists() && new.exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn prune_under_limit_is_noop() {
        let d = temp_dir("noop");
        let a = file(&d, "a.jpg", 100, 0);
        assert_eq!(prune(&d, 100).unwrap(), 0);
        assert!(a.exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn touch_protects_a_file_from_pruning() {
        let d = temp_dir("touch");
        let old = file(&d, "old.jpg", 100, 300);
        let new = file(&d, "new.jpg", 100, 100);
        touch(&old);
        prune(&d, 100).unwrap();
        assert!(old.exists() && !new.exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn write_atomic_replaces_without_leftovers() {
        let d = temp_dir("atomic");
        let p = d.join("small/a.jpg");
        write_atomic(&p, b"first").unwrap();
        write_atomic(&p, b"second").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second");
        let names: Vec<_> = fs::read_dir(d.join("small")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "pas de fichier temporaire restant : {names:?}");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn write_atomic_fails_cleanly_in_a_missing_dir() {
        assert!(write_atomic(Path::new("/nonexistent/cache-store/a.jpg"), b"x").is_err());
    }

    #[test]
    fn image_paths() {
        let ok = |g: &str, s: &str, i: &str| Some((g.to_string(), s.to_string(), i.to_string()));
        assert_eq!(parse_image_path("/ygo/small/46986414"), ok("ygo", "small", "46986414"));
        assert_eq!(parse_image_path("ygo%2Fsmall%2F46986414"), ok("ygo", "small", "46986414"));
        assert_eq!(parse_image_path("/ygo%2ffull%2f1"), ok("ygo", "full", "1"));
        assert_eq!(
            parse_image_path("/mtg%2Fsmall%2F0000579f-7b35-4ed3-b44c-db2a538066fe"),
            ok("mtg", "small", "0000579f-7b35-4ed3-b44c-db2a538066fe")
        );
        assert_eq!(parse_image_path("/ygo/small"), None);
        assert_eq!(parse_image_path("/ygo/small/1/2"), None);
        assert_eq!(parse_image_path("/ygo/small/..%2F..%2Fetc"), None);
        assert_eq!(parse_image_path("/ygo/..%2Fsmall/1"), None);
        assert_eq!(parse_image_path("/ygo/small/a.jpg"), None);
        assert_eq!(parse_image_path("/ygo/small/%zz"), None);
        assert_eq!(parse_image_path("/ygo/small/%2"), None);
        assert_eq!(parse_image_path(""), None);
    }

    #[test]
    fn clear_empties_but_keeps_dir() {
        let d = temp_dir("clear");
        file(&d, "a.jpg", 10, 0);
        file(&d, "small/b.jpg", 10, 0);
        clear(&d).unwrap();
        assert!(d.exists());
        assert_eq!(dir_size(&d).unwrap(), 0);
        fs::remove_dir_all(&d).unwrap();
    }
}
