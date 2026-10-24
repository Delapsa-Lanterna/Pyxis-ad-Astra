use crate::domain::schema::validate_field;
use crate::errors::AppResult;
use crate::parsers::bundled_schema;
use serde_json::{Value, json};

fn validate_document(id: &str, data: &Value) -> AppResult<()> {
    crate::domain::schema::validate_document(bundled_schema(id), data)
}

#[test]
fn asset_discovery_and_version_types() {
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../schemas")).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_suffix(".schema.json") {
            assert_eq!(bundled_schema(id)["id"], id);
        }
    }
    for version in [json!("2.4a"), json!({"major":2,"minor":"4a","patch":1})] {
        let value = json!({"version":version,"gameVersion":version,"dependencies":[{"id":"sample-library","version":version}],"utility":"true","totalConversion":"false"});
        let before = value.clone();
        validate_document("mod-info", &value).unwrap();
        assert_eq!(value, before);
    }
}

#[test]
fn object_shapes_and_open_content() {
    for (id, value) in [
        ("mod-info", json!({"dependencies":[{}]})),
        ("mod-info", json!({"dependencies":[{"id":""}]})),
        ("mod-info", json!({"version":{"minor":2}})),
        ("variant", json!({"weaponGroups":[{}]})),
        ("variant", json!({"weaponGroups":[{"mode":"LINKED"}]})),
        ("skin", json!({"engineSlotChanges":{"word":{"angle":1}}})),
        ("skin", json!({"engineSlotChanges":{"-1":{}}})),
        ("faction", json!({"shipRoles":{"sample":{"fallback":{}}}})),
        (
            "faction",
            json!({"shipRoles":{"sample":{"fallback2":{"first":1,"second":1}}}}),
        ),
    ] {
        assert_eq!(
            validate_document(id, &value).unwrap_err().code(),
            "config.shape_invalid",
            "{id}: {value}"
        );
    }
    for (id, value) in [
        ("mod-info", json!({"dependencies":[{"id":"sample"}]})),
        (
            "variant",
            json!({"weaponGroups":[{"mode":"LINKED","weapons":{}}],"quality":4,"doctrine":{"unknown":[true,null]}}),
        ),
        ("variant", json!({"modules":[{"slot":"sample-module"}]})),
        (
            "skin",
            json!({"maxSpeed":37.5,"engineSlotChanges":{"+01":{"width":2.5}}}),
        ),
        (
            "faction",
            json!({"music":{"custom.scene":"sample"},"shipRoles":{"sample":{"fallback":{"alternate":0.5}}}}),
        ),
        (
            "strings",
            json!({"direct":"001","group":{"line":"123\n $sample \"line\" "}}),
        ),
        (
            "game-settings",
            json!({"plugins":{"sample":"example.Sample"},"graphics":{"sample":{"single":"graphics/sample.png","multiple":["graphics/other.png"]}}}),
        ),
        (
            "hull-styles",
            json!({"sounds":{},"DEFAULT":{},"FIGHTER":{},"FRIGATE":{},"DESTROYER":{},"CRUISER":{},"CAPITAL_SHIP":{}}),
        ),
    ] {
        validate_document(id, &value).unwrap();
    }
}

#[test]
fn partial_and_complete_branches() {
    let field = &bundled_schema("engine-styles")["root"];
    let partial = json!({"SAMPLE":{"contrailMaxSpeedMult":"0.5f","mode":"QUAD_STRIP"}});
    validate_field(field, &partial, "file", false).unwrap();
    assert!(validate_field(field, &partial, "file", true).is_err());
    let mut complete = bundled_schema("engine-styles")["root"]["valueSchema"]["default"].clone();
    complete["mode"] = json!("QUAD_STRIP");
    assert!(validate_document("engine-styles", &json!({"SAMPLE":complete})).is_err());
    complete["contrailWidthMult"] = json!(2);
    complete["contrailDuration"] = json!(3);
    validate_document("engine-styles", &json!({"SAMPLE":complete})).unwrap();
    for track in [
        json!({"source":"sounds/music","file":"sample.ogg"}),
        json!({"source":"sounds/music","files":["sample.ogg"]}),
    ] {
        validate_document("sounds", &json!({"music":{"sample":[track]}})).unwrap();
    }
    for track in [
        json!({"source":"sounds/music","file":"sample.ogg","files":["other.ogg"]}),
        json!({"source":"sounds/music"}),
    ] {
        assert!(validate_document("sounds", &json!({"music":{"sample":[track]}})).is_err());
    }
}
