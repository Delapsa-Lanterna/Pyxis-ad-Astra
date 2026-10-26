use crate::domain::schema::validate_field;
use crate::errors::AppResult;
use crate::parsers::bundled_schema;
use serde_json::{Value, json};

fn validate_document(id: &str, data: &Value) -> AppResult<()> {
    crate::domain::schema::validate_document(bundled_schema(id), data)
}

#[test]
fn variant_weapon_group_limit() {
    for count in [0, 6, 7, 8] {
        let data = json!({"weaponGroups":vec![json!({"mode":"LINKED","weapons":{}}); count]});
        let result = validate_document("variant", &data);
        if count <= 7 {
            result.unwrap();
        } else {
            let error = result.unwrap_err();
            assert_eq!(error.code(), "config.shape_invalid");
            assert_eq!(error.to_string(), "字段内容无效：weaponGroups");
        }
    }
}

#[test]
fn closed_objects_ignore_unknowns() {
    for allowed in [None, Some(false), Some(true)] {
        let mut field = json!({
            "type":"object", "nested":[{"key":"known","type":"integer"}],
            "valueSchema":{"type":"integer"}
        });
        if let Some(allowed) = allowed {
            field["allowExtraFields"] = json!(allowed);
        }
        let data = json!({"known":4,"custom":{"untouched":null}});
        let before = data.clone();
        assert_eq!(
            validate_field(&field, &data, "file", true).is_ok(),
            allowed != Some(true)
        );
        assert_eq!(data, before);
        assert!(validate_field(&field, &json!({"known":"invalid"}), "file", true).is_err());
    }
}

#[test]
fn open_parents_keep_items_closed() {
    let field = json!({
        "type":"object", "allowExtraFields":true,
        "valueSchema":{"type":"array","item":{
            "type":"object","nested":[{"key":"known","type":"integer"}],
            "valueSchema":{"type":"integer"}
        }}
    });
    let data = json!({"sample":[{"known":1,"custom":{"keep":true}}]});
    let before = data.clone();
    validate_field(&field, &data, "file", true).unwrap();
    assert_eq!(data, before);
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
fn required_particle_conditions() {
    let field = &bundled_schema("spec-weapon")["definitions"]["muzzleFlashSpec"];
    for count in [-1, 0, 1, 2] {
        assert_eq!(
            validate_field(
                field,
                &json!({"particleCount":count}),
                "muzzleFlashSpec",
                true
            )
            .is_ok(),
            count <= 0
        );
    }
    assert!(validate_field(field, &json!({}), "muzzleFlashSpec", true).is_err());
    let custom = &bundled_schema("spec-ship")["definitions"]["customEngine"];
    assert!(validate_field(custom, &json!({}), "engine", true).is_err());
    validate_field(custom, &json!({"styleId":"sample-style"}), "engine", true).unwrap();
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
