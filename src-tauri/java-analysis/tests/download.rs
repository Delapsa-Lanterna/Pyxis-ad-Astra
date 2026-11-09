use pyxis_java_analysis::{Artifact, Package, dependencies};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
mod support;
use support::TestWorkspace;

#[test]
fn download_failures_cleanup_and_retry_share_one_local_fixture() {
    let work = TestWorkspace::new();
    let root = work.0.join("installation");
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap();
    let worker = thread::spawn(move || {
        for mode in [0, 1, 2, 3] {
            let (mut stream, _) = server.accept().unwrap();
            let mut buffer = [0u8; 4096];
            let received = stream.read(&mut buffer).unwrap();
            assert!(received > 0);
            let response = match mode {
                0 => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                1 => "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nx",
                _ => "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nlibrary",
            };
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    let mut package = Package {
        version: "fixture".into(),
        protocol: 2,
        java: 17,
        bytes: 0,
        sha256: String::new(),
        bundles: vec!["lib/dep.jar".into()],
        artifacts: vec![Artifact {
            path: "lib/dep.jar".into(),
            url: format!("http://{address}/dep.jar"),
            bytes: 7,
            sha256: format!("{:x}", Sha256::digest(b"library")),
        }],
    };
    assert!(dependencies::install(&root, &package).is_err());
    assert!(dependencies::install(&root, &package).is_err());
    package.artifacts[0].sha256 = "00".repeat(32);
    assert!(dependencies::install(&root, &package).is_err());
    assert!(!root.join("fixture.staging").exists());
    package.artifacts[0].sha256 = format!("{:x}", Sha256::digest(b"library"));
    let directory = dependencies::install(&root, &package).unwrap();
    worker.join().unwrap();
    assert_eq!(fs::read(directory.join("lib/dep.jar")).unwrap(), b"library");
    assert_eq!(dependencies::install(&root, &package).unwrap(), directory);
    work.close();
}
