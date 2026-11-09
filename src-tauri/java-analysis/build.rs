use serde_json::Value;
use std::path::PathBuf;
use std::{env, fs};

fn main() {
    println!("cargo:rerun-if-changed=versions.json");
    let values: Value = serde_json::from_str(
        &fs::read_to_string("versions.json").expect("Java analysis version declaration"),
    )
    .expect("Java analysis versions are valid JSON");
    let mut generated = String::new();
    for (name, field) in [
        ("ENGINE_VERSION", "engine"),
        ("DEFAULT_LANGUAGE", "language"),
        ("JDT_VERSION", "jdt"),
    ] {
        generated.push_str(&format!(
            "pub const {name}: &str = {:?};\n",
            values[field].as_str().expect("declared version string")
        ));
    }
    for (name, field) in [("PROTOCOL_VERSION", "protocol"), ("REQUIRED_JAVA", "java")] {
        generated.push_str(&format!(
            "pub const {name}: u32 = {};\n",
            values[field].as_u64().expect("declared version number")
        ));
    }
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory")).join("versions.rs"),
        generated,
    )
    .expect("generate Java analysis version constants");
}
