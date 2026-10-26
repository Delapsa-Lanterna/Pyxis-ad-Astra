fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=../schemas");
    let mut paths: Vec<_> = std::fs::read_dir("../schemas")
        .expect("bundled schema directory")
        .map(|entry| entry.expect("bundled schema entry").path())
        .filter(|path| {
            path.file_name()
                .expect("schema filename")
                .to_string_lossy()
                .ends_with(".schema.json")
        })
        .collect();
    paths.sort();
    let entries = paths
        .iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("schema filename")
                .to_str()
                .expect("UTF-8 schema filename")
                .strip_suffix(".schema.json")
                .expect("schema suffix");
            let path = path.canonicalize().expect("bundled schema path");
            format!("({name:?}, include_str!({path:?}))")
        })
        .collect::<Vec<_>>()
        .join(",\n");
    std::fs::write(
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"))
            .join("config_schemas.rs"),
        format!("[{entries}]"),
    )
    .expect("generate bundled schema assets");
    tauri_build::build();
}
