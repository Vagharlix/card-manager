// ============================================================
// Retour de la connexion Google sur desktop (std uniquement, sans
// dépendance Tauri → testable avec `rustc --test`, cf. CI checks).
//
// Flux « application installée » de Google : le navigateur est redirigé
// vers http://127.0.0.1:<port>/callback?code=…&state=… ; on écoute ce port
// le temps d'une connexion, on lit le code et on affiche une page
// « tu peux revenir dans l'appli ».
// ============================================================

use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Callback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Port libre choisi par le système, sur l'interface locale uniquement.
pub fn bind() -> io::Result<TcpListener> {
    TcpListener::bind(("127.0.0.1", 0))
}

/// Attend la redirection du navigateur (au plus `timeout`).
pub fn wait(listener: TcpListener, timeout: Duration) -> Result<Callback, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                // une requête qui n'est pas le retour (favicon…) est ignorée
                if let Some(cb) = handle(stream)? {
                    return Ok(cb);
                }
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timeout".into());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

const PAGE: &str = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">\
<title>card-manager</title><body style=\"font-family:sans-serif;text-align:center;padding:3em\">\
<h1>Signed in</h1><p>You can close this tab and go back to card-manager.</p></body></html>";

fn handle(mut stream: TcpStream) -> Result<Option<Callback>, String> {
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    // « GET /callback?code=…&state=… HTTP/1.1 »
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return Ok(None);
    }
    let mut cb = Callback::default();
    for (k, v) in parse_query(query) {
        match k.as_str() {
            "code" => cb.code = Some(v),
            "state" => cb.state = Some(v),
            "error" => cb.error = Some(v),
            _ => {}
        }
    }
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        PAGE.len(),
        PAGE
    );
    let _ = stream.write_all(response.as_bytes());
    Ok(Some(cb))
}

pub fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect()
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_query_values() {
        assert_eq!(percent_decode("4%2F0Ab%3D%3D"), "4/0Ab==");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(
            parse_query("code=4%2Fxyz&state=abc&scope=a+b"),
            vec![
                ("code".to_string(), "4/xyz".to_string()),
                ("state".to_string(), "abc".to_string()),
                ("scope".to_string(), "a b".to_string()),
            ]
        );
    }

    fn browser(port: u16, path: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        io::Read::read_to_string(&mut s, &mut out).unwrap();
        out
    }

    #[test]
    fn returns_the_code_and_ignores_other_requests() {
        let listener = bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let t = thread::spawn(move || {
            let favicon = browser(port, "/favicon.ico");
            let page = browser(port, "/callback?code=4%2Fabc&state=xyz");
            (favicon, page)
        });
        let cb = wait(listener, Duration::from_secs(5)).unwrap();
        let (favicon, page) = t.join().unwrap();
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Signed in"));
        assert_eq!(
            cb,
            Callback { code: Some("4/abc".into()), state: Some("xyz".into()), error: None }
        );
    }

    #[test]
    fn reports_a_refusal() {
        let listener = bind().unwrap();
        let port = listener.local_addr().unwrap().port();
        let t = thread::spawn(move || browser(port, "/callback?error=access_denied&state=s"));
        let cb = wait(listener, Duration::from_secs(5)).unwrap();
        t.join().unwrap();
        assert_eq!(cb.error.as_deref(), Some("access_denied"));
        assert_eq!(cb.code, None);
    }

    #[test]
    fn times_out() {
        let listener = bind().unwrap();
        assert_eq!(wait(listener, Duration::from_millis(200)), Err("timeout".to_string()));
    }
}
