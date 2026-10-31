use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock};

pub fn bundled_schema(id: &str) -> &'static Value {
    static SCHEMAS: LazyLock<BTreeMap<&str, Value>> = LazyLock::new(|| {
        include!(concat!(env!("OUT_DIR"), "/config_schemas.rs"))
            .into_iter()
            .map(|(id, text)| {
                #[cfg(test)]
                crate::io::work::record("schema-parse", std::path::Path::new(id));
                (
                    id,
                    super::parse_persisted_json(text).expect("bundled field schema is valid JSON"),
                )
            })
            .collect()
    });
    &SCHEMAS[id]
}
