// ============================================================
// DONNÉES DE CARTES EN MASSE — téléchargement en flux, tiré par le front.
//
// Les fichiers de référence de certains jeux sont énormes (Magic : JSONL
// gzip de 80 Mo, 650 Mo décompressés, 120 000 objets) : impossible à lire
// d'un bloc dans la WebView d'un téléphone. Ici :
//   jsonl_open(url, keys)  → ouvre le flux (fil dédié : HTTP → gzip → lignes)
//   jsonl_next(id)         → lot suivant d'objets, réduits aux clés demandées
//   jsonl_close(id)        → abandon (le fil s'arrête au lot suivant)
// Le canal entre le fil et les appels est borné : le téléchargement avance
// au rythme où le front écrit en base (pas d'accumulation en mémoire).
// URL limitées à card_sources::card_data_url_allowed.
// ============================================================

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use flate2::read::GzDecoder;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::State;

use crate::card_sources;

const BATCH: usize = 500;
const QUEUE: usize = 4; // lots d'avance au plus
const USER_AGENT: &str = "card-manager/0.1 (+https://github.com/Vagharlix/card-manager)";

type Message = Result<Vec<Value>, String>;

struct Stream {
    rx: Mutex<mpsc::Receiver<Message>>,
    read: Arc<AtomicU64>, // octets reçus (compressés), pour la progression
    total: Option<u64>,
}

#[derive(Default)]
pub struct Streams {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Stream>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    items: Vec<Value>,
    read: u64,
    total: Option<u64>,
    done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    id: u32,
    total: Option<u64>,
}

struct Counting<R> {
    inner: R,
    count: Arc<AtomicU64>,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn check(url: &str) -> Result<(), String> {
    if card_sources::card_data_url_allowed(url) {
        Ok(())
    } else {
        Err(format!("URL not allowed: {url}"))
    }
}

/// GET d'un petit document JSON (métadonnées), renvoyé tel quel.
#[tauri::command]
pub async fn card_data_get(url: String) -> Result<String, String> {
    check(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let resp = client()?
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("fetch failed: {}", resp.status()));
        }
        resp.text().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// garde seulement les clés demandées (toutes si la liste est vide)
fn keep(mut obj: Map<String, Value>, keys: &[String]) -> Value {
    if !keys.is_empty() {
        obj.retain(|k, _| keys.iter().any(|w| w == k));
    }
    Value::Object(obj)
}

// lit le flux ligne à ligne et envoie des lots ; s'arrête si le front a fermé
fn pump(reader: Box<dyn Read + Send>, keys: Vec<String>, tx: mpsc::SyncSender<Message>) {
    let mut batch = Vec::with_capacity(BATCH);
    for line in BufReader::with_capacity(1 << 16, reader).lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                let _ = tx.send(Err(e.to_string()));
                return;
            }
        };
        // JSONL ; tolère aussi un tableau JSON « un objet par ligne »
        let t = line.trim().trim_end_matches(',');
        if t.is_empty() || t == "[" || t == "]" {
            continue;
        }
        match serde_json::from_str::<Map<String, Value>>(t) {
            Ok(obj) => batch.push(keep(obj, &keys)),
            Err(e) => {
                let _ = tx.send(Err(format!("invalid line: {e}")));
                return;
            }
        }
        if batch.len() >= BATCH && tx.send(Ok(std::mem::take(&mut batch))).is_err() {
            return; // fermé côté front
        }
    }
    if !batch.is_empty() {
        let _ = tx.send(Ok(batch));
    }
}

// ouvre le flux : la requête et la lecture vivent dans un fil dédié (le
// client HTTP bloquant ne doit pas tourner dans le runtime async) ; bloque
// jusqu'à la réponse HTTP (taille connue ou erreur)
fn spawn_stream(url: String, keys: Vec<String>) -> Result<Stream, String> {
    check(&url)?;
    let read = Arc::new(AtomicU64::new(0));
    let (tx, rx) = mpsc::sync_channel::<Message>(QUEUE);
    let (meta_tx, meta_rx) = mpsc::sync_channel::<Result<Option<u64>, String>>(1);
    let counter = read.clone();

    std::thread::spawn(move || {
        let resp = match client().and_then(|c| c.get(&url).send().map_err(|e| e.to_string())) {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let _ = meta_tx.send(Err(format!("fetch failed: {}", r.status())));
                return;
            }
            Err(e) => {
                let _ = meta_tx.send(Err(e));
                return;
            }
        };
        let _ = meta_tx.send(Ok(resp.content_length()));
        let counted = Counting {
            inner: resp,
            count: counter,
        };
        let reader: Box<dyn Read + Send> = if url.ends_with(".gz") {
            Box::new(GzDecoder::new(counted))
        } else {
            Box::new(counted)
        };
        pump(reader, keys, tx);
    });

    let total = meta_rx
        .recv()
        .map_err(|_| "download thread failed".to_string())??;
    Ok(Stream {
        rx: Mutex::new(rx),
        read,
        total,
    })
}

#[tauri::command]
pub async fn jsonl_open(
    url: String,
    keys: Vec<String>,
    streams: State<'_, Streams>,
) -> Result<Opened, String> {
    let stream = tauri::async_runtime::spawn_blocking(move || spawn_stream(url, keys))
        .await
        .map_err(|e| e.to_string())??;
    let total = stream.total;
    let id = streams.next_id.fetch_add(1, Ordering::Relaxed);
    streams.open.lock().unwrap().insert(id, Arc::new(stream));
    Ok(Opened { id, total })
}

#[tauri::command]
pub async fn jsonl_next(id: u32, streams: State<'_, Streams>) -> Result<Batch, String> {
    let stream = streams
        .open
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("unknown stream")?;
    let s = stream.clone();
    let msg = tauri::async_runtime::spawn_blocking(move || s.rx.lock().unwrap().recv())
        .await
        .map_err(|e| e.to_string())?;
    let read = stream.read.load(Ordering::Relaxed);
    match msg {
        Ok(Ok(items)) => Ok(Batch {
            items,
            read,
            total: stream.total,
            done: false,
        }),
        Ok(Err(e)) => {
            streams.open.lock().unwrap().remove(&id);
            Err(e)
        }
        Err(_) => {
            // fil terminé : fin du fichier
            streams.open.lock().unwrap().remove(&id);
            Ok(Batch {
                items: vec![],
                read,
                total: stream.total,
                done: true,
            })
        }
    }
}

#[tauri::command]
pub fn jsonl_close(id: u32, streams: State<'_, Streams>) {
    streams.open.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    fn gz(text: &str) -> Vec<u8> {
        let mut e = GzEncoder::new(Vec::new(), Compression::default());
        e.write_all(text.as_bytes()).unwrap();
        e.finish().unwrap()
    }

    fn run(bytes: Vec<u8>, keys: &[&str]) -> Vec<Message> {
        let (tx, rx) = mpsc::sync_channel(QUEUE);
        let keys = keys.iter().map(|k| k.to_string()).collect();
        let reader: Box<dyn Read + Send> = Box::new(GzDecoder::new(std::io::Cursor::new(bytes)));
        std::thread::spawn(move || pump(reader, keys, tx));
        rx.into_iter().collect()
    }

    #[test]
    fn batches_and_filters_keys() {
        let lines: String = (0..1200)
            .map(|i| format!("{{\"id\":\"c{i}\",\"name\":\"N{i}\",\"big\":[1,2,3]}}\n"))
            .collect();
        let msgs = run(gz(&lines), &["id", "name"]);
        let sizes: Vec<usize> = msgs.iter().map(|m| m.as_ref().unwrap().len()).collect();
        assert_eq!(sizes, vec![500, 500, 200]);
        let first = &msgs[0].as_ref().unwrap()[0];
        assert_eq!(first["id"], "c0");
        assert!(first.get("big").is_none());
    }

    #[test]
    fn accepts_a_json_array_one_object_per_line() {
        let msgs = run(gz("[\n{\"id\":1},\n{\"id\":2}\n]\n"), &[]);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].as_ref().unwrap().len(), 2);
    }

    // vrai téléchargement Scryfall (réseau) : cargo test --lib card_data -- --ignored
    #[test]
    #[ignore]
    fn real_scryfall_bulk_file() {
        let meta = client()
            .unwrap()
            .get("https://api.scryfall.com/bulk-data/oracle-cards")
            .header("Accept", "application/json")
            .send()
            .unwrap()
            .text()
            .unwrap();
        let meta: Value = serde_json::from_str(&meta).unwrap();
        let url = meta["jsonl_download_uri"].as_str().unwrap().to_string();
        let stream =
            spawn_stream(url, vec!["id".into(), "name".into(), "oracle_id".into()]).unwrap();
        assert!(stream.total.unwrap_or(0) > 1_000_000);
        let rx = stream.rx.into_inner().unwrap();
        let mut n = 0;
        for msg in rx {
            let items = msg.unwrap();
            assert!(items.iter().all(|v| v.as_object().unwrap().len() <= 3));
            n += items.len();
        }
        println!("{n} objets, {} octets", stream.read.load(Ordering::Relaxed));
        assert!(n > 30_000);
    }

    #[test]
    fn refuses_other_hosts() {
        assert!(spawn_stream("https://evil.com/x.jsonl.gz".into(), vec![]).is_err());
    }

    #[test]
    fn reports_an_invalid_line() {
        let msgs = run(gz("{\"id\":1}\nnot json\n"), &[]);
        assert!(msgs.last().unwrap().is_err());
    }
}
