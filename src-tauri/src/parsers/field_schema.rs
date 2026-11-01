use crate::parsers::parse_persisted_json;
#[cfg(test)]
use crate::test_support::work_counts;
use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::Path;
use std::sync::LazyLock;

pub fn bundled_schema(id: &str) -> &'static Value {
    static SCHEMAS: LazyLock<BTreeMap<&str, Value>> = LazyLock::new(|| {
        include!(concat!(env!("OUT_DIR"), "/config_schemas.rs"))
            .into_iter()
            .map(|(id, text)| {
                #[cfg(test)]
                work_counts::record("schema-parse", Path::new(id));
                (
                    id,
                    parse_persisted_json(text).expect("bundled field schema is valid JSON"),
                )
            })
            .collect()
    });
    &SCHEMAS[id]
}
