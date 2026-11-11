use pyxis_java_analysis::transfer::TransferControl;
use pyxis_java_analysis::versions::PROTOCOL_VERSION;
use pyxis_java_analysis::{Artifact, Error, Package, dependencies};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};
mod support;
use support::TestWorkspace;

#[test]
fn cancellation_releases_pending_requests_and_retry_reuses_verified_files() {
    let work = TestWorkspace::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&requests);
    let server = thread::spawn(move || {
        let mut workers = Vec::new();
        for _ in 0..4 {
            let (mut stream, _) = listener.accept().unwrap();
            let recorded = Arc::clone(&recorded);
            workers.push(thread::spawn(move || {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0u8; 4096];
                let length = stream.read(&mut bytes).unwrap();
                let request = String::from_utf8_lossy(&bytes[..length]);
                let path = request.split_whitespace().nth(1).unwrap().to_string();
                recorded.lock().unwrap().push(path.clone());
                if path == "/headers" {
                    assert_eq!(stream.read(&mut bytes).unwrap(), 0);
                    return;
                }
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\n")
                    .unwrap();
                if path == "/body" {
                    stream.write_all(b"l").unwrap();
                    assert_eq!(stream.read(&mut bytes).unwrap(), 0);
                } else if path != "/body" {
                    stream.write_all(b"library").unwrap();
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
    });
    let artifact = |path: &str, url: &str| Artifact {
        path: path.into(),
        url: format!("http://{address}{url}"),
        bytes: 7,
        sha256: format!("{:x}", Sha256::digest(b"library")),
    };
    let mut package = Package {
        version: "fixture".into(),
        protocol: PROTOCOL_VERSION,
        java: 17,
        bytes: 0,
        sha256: String::new(),
        bundles: vec!["lib/cached.jar".into()],
        artifacts: vec![
            artifact("lib/cached.jar", "/ok"),
            artifact("lib/next.jar", "/headers"),
        ],
    };
    let root = work.0.join("dependencies");
    let (ready, waiting) = mpsc::channel();
    let control = TransferControl::new(Arc::new(move |progress| {
        if progress.files_done == 1 {
            let _ = ready.send(());
        }
    }));
    let worker_control = control.clone();
    let worker_package = package.clone();
    let worker_root = root.clone();
    let worker = thread::spawn(move || {
        dependencies::install_with_control(&worker_root, &worker_package, &worker_control)
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    control.cancel();
    assert!(matches!(worker.join().unwrap(), Err(Error::Cancelled)));
    let response_cancel = started.elapsed().as_secs_f64() * 1000.0;
    assert!(response_cancel < 1000.0);
    assert_eq!(
        fs::read(root.join("fixture.staging/lib/cached.jar")).unwrap(),
        b"library"
    );
    assert!(!root.join("fixture/engine.json").exists());
    package.artifacts[0].url = format!("http://{address}/must-not-request");
    package.artifacts[1].url = format!("http://{address}/ok");
    dependencies::install(&root, &package).unwrap();
    assert_eq!(
        requests
            .lock()
            .unwrap()
            .iter()
            .filter(|path| path.as_str() == "/ok")
            .count(),
        2
    );
    assert!(
        !requests
            .lock()
            .unwrap()
            .iter()
            .any(|path| path == "/must-not-request")
    );
    let (ready, waiting) = mpsc::channel();
    let body_control = TransferControl::new(Arc::new(move |progress| {
        if progress.phase == "downloading" {
            let _ = ready.send(());
        }
    }));
    let body_package = Package {
        artifacts: vec![artifact("lib/cached.jar", "/body")],
        ..package.clone()
    };
    let worker_control = body_control.clone();
    let worker_root = work.0.join("body");
    let worker = thread::spawn(move || {
        dependencies::install_with_control(&worker_root, &body_package, &worker_control)
    });
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    let started = Instant::now();
    body_control.cancel();
    assert!(matches!(worker.join().unwrap(), Err(Error::Cancelled)));
    let body_cancel = started.elapsed().as_secs_f64() * 1000.0;
    assert!(body_cancel < 1000.0);
    server.join().unwrap();
    let cancelled = TransferControl::default();
    cancelled.cancel();
    assert!(matches!(
        dependencies::install_with_control(&work.0.join("before-connect"), &package, &cancelled),
        Err(Error::Cancelled)
    ));
    println!(
        "{{\"headerCancelMilliseconds\":{response_cancel},\"bodyCancelMilliseconds\":{body_cancel},\"httpRequests\":4}}"
    );
    work.close();
}
