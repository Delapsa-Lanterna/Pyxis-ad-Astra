include!(concat!(env!("OUT_DIR"), "/versions.rs"));

#[cfg(test)]
mod tests {
    use super::{ENGINE_VERSION, JDT_VERSION, PROTOCOL_VERSION, REQUIRED_JAVA};
    use crate::package::Builtin;

    #[test]
    fn bundled_host_matches_declared_versions() {
        let host: Builtin =
            serde_json::from_slice(include_bytes!("../resources/builtin.json")).unwrap();
        assert_eq!(host.version, ENGINE_VERSION);
        assert_eq!(host.protocol, PROTOCOL_VERSION);
        assert_eq!(host.java, REQUIRED_JAVA);
        assert!(
            host.dependencies
                .version
                .starts_with(&format!("jdt-{JDT_VERSION}-"))
        );
    }
}
