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

/// Marque un fichier comme récemment utilisé (best-effort).
/// Nom sûr pour un segment de chemin (jeu, identifiant de carte) : lettres,
/// chiffres, `-` et `_` seulement, 1 à 64 caractères. Empêche de sortir du
/// dossier du cache (`..`, `/`, `\\`).
pub fn is_safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn touch(path: &Path) {
    if let Ok(f) = fs::File::options().write(true).open(path) {
        let _ = f.set_modified(SystemTime::now());
    }
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
