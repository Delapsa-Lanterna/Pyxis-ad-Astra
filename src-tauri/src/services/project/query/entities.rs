use super::super::definitions::entity_definitions::entity_definition;
use super::super::session::{lock_ready_session, session_handle};
use crate::{
    errors::AppResult,
    models::{EntityData, EntityKind},
};

pub fn query_entity(session_id: &str, kind: EntityKind, id: &str) -> AppResult<Option<EntityData>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let definition = entity_definition(kind)?;
    (definition.prepare)(&mut session)?;
    let info = super::entity_targets::describe_entity_target(&mut session, kind, id)?;
    let data = if let Some(source) = &info.target.source
        && let Some(reference) = source.reference.as_deref()
    {
        let view = session
            .references
            .iter()
            .find(|view| &view.identity == reference)
            .expect("reference record owner");
        view.read(|snapshot| {
            (definition.prepare)(snapshot)?;
            (definition.detail)(snapshot, id)
        })?
    } else {
        (definition.detail)(&mut session, id)?
    };
    let Some(data) = data else {
        return Ok(None);
    };
    let composition = definition
        .spec
        .filter(|_| {
            kind != EntityKind::Variant
                && info
                    .target
                    .source
                    .as_ref()
                    .is_some_and(|source| source.source == crate::models::ResourceSource::Mod)
        })
        .map(|_| super::super::json_composition(&session, &info.target.write.rel_path))
        .transpose()?;
    let content = if matches!(kind, EntityKind::Weapon | EntityKind::Skill) {
        &data["spec"]
    } else {
        &data
    };
    let effective = composition
        .as_ref()
        .map(|composition| crate::domain::json_composition::compose_game_json(composition, content))
        .transpose()?;
    let mut resource_data = data.clone();
    if let Some(effective) = &effective {
        if matches!(kind, EntityKind::Weapon | EntityKind::Skill) {
            resource_data["spec"] = effective.clone();
        } else {
            resource_data = effective.clone();
        }
    }
    let mut resource_refs = (definition.resources)(&session, id, &resource_data);
    if kind != EntityKind::Variant
        && !(kind == EntityKind::Skin && data.get("spriteName").is_none())
        && let Some(source) = &info.target.source
    {
        session.reference_resource(source, &mut resource_refs);
    }
    super::entity_targets::remember_edit_target(&mut session, &info.target);
    if let Some(composition) = &composition {
        super::json_composition::resource_origins(&mut resource_refs, content, composition);
    }
    Ok(Some(EntityData {
        composition,
        target: info.target,
        base_versions: info.base_versions,
        resource_refs,
        kind: definition.kind,
        id: id.to_string(),
        data,
    }))
}

pub fn query_entity_list(session_id: &str, kind: EntityKind) -> AppResult<Vec<EntityData>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let definition = entity_definition(kind)?;
    (definition.prepare)(&mut session)?;
    let projections = (definition.list)(&mut session)?;
    let targets = super::entity_targets::prepare_entity_targets(&mut session, kind)?;
    let records: Vec<EntityData> = projections
        .into_iter()
        .map(|projection| {
            let info = targets.describe(&session, &projection.id);
            EntityData {
                composition: None,
                target: info.target,
                base_versions: info.base_versions,
                kind: projection.kind,
                id: projection.id,
                data: projection.data,
                resource_refs: projection.resource_refs,
            }
        })
        .collect();
    for record in &records {
        if matches!(
            kind,
            EntityKind::Variant | EntityKind::Skin | EntityKind::Faction | EntityKind::Mission
        ) {
            super::entity_targets::remember_edit_target(&mut session, &record.target);
        }
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::super::super::definitions::entity_definitions::registered_mission_rows;
    use super::super::super::model::MISSION_LIST_TABLE_KEY;
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;
    use serde_json::{Map, Value};
    use std::collections::BTreeMap;

    #[test]
    fn faction_list_prepares_one_index_and_matches_loaded_nested_targets() {
        let root = project_workspace("faction_list_target_projection");
        std::fs::create_dir_all(root.join("data/world/factions/nested")).unwrap();
        write_utf8_no_bom(&root.join("data/world/factions/factions.csv"),
            "faction,file,custom\r\nalias,data/world/factions/nested/one.faction,kept\r\ntwo,data/world/factions/two.faction,other\r\n").unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/nested/one.faction"),
            r#"{"id":"one","displayName":"One"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/two.faction"),
            r#"{"id":"two","displayName":"Two"}"#,
        )
        .unwrap();
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        crate::io::faction_index::take_faction_index_reads();
        let list = query_entity_list(&manifest.session_id, EntityKind::Faction).unwrap();
        assert_eq!(crate::io::faction_index::take_faction_index_reads(), 1);
        assert_eq!(list.len(), 2);
        for record in &list {
            let detail = query_entity(&manifest.session_id, EntityKind::Faction, &record.id)
                .unwrap()
                .unwrap();
            assert_eq!(record.target, detail.target);
            assert_eq!(record.base_versions, detail.base_versions);
        }
        assert_eq!(
            list[0].target.write.rel_path,
            "data/world/factions/nested/one.faction"
        );
        assert!(matches!(
            &list[0].target.linked_record,
            Some(crate::models::EntityLinkedRecord::Index { row_index: 0, .. })
        ));
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn mission_entity_query_returns_index_descriptor_text_and_icon_ref() {
        let root = project_workspace("mission_entity_query");
        std::fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\ndemo,Demo Mission\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/demo/descriptor.json"),
            r#"{"title":"Demo","icon":"icon.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/demo/mission_text.txt"),
            "mission text",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let list = query_entity_list(&manifest.session_id, EntityKind::Mission).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Mission, "demo")
            .unwrap()
            .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "demo");
        assert_eq!(entity.data["list"]["mission"], "demo");
        assert_eq!(entity.data["descriptor"]["title"], "Demo");
        assert_eq!(entity.data["text"], "mission text");
        assert_eq!(
            entity
                .resource_refs
                .get("icon")
                .map(|resource| resource.rel_path.as_str()),
            Some("data/missions/demo/icon.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn mission_entity_query_returns_none_for_unregistered_mission() {
        let root = project_workspace("mission_entity_missing");
        std::fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\ndemo,Demo Mission\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Mission, "missing").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert!(entity.is_none());
        root.close().unwrap();
    }

    #[test]
    fn mission_list_icon_descriptor_errors_are_not_hidden() {
        let root = project_workspace("mission_list_icon_descriptor_error");
        std::fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\ndemo,Demo Mission\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/demo/descriptor.json"), "{").unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_entity_list(&manifest.session_id, EntityKind::Mission)
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("descriptor.json"));
        root.close().unwrap();
    }

    #[test]
    fn registered_mission_rows_requires_loaded_csv_rows() {
        let mut csv_tables = BTreeMap::new();
        csv_tables.insert(
            MISSION_LIST_TABLE_KEY.to_string(),
            super::super::super::model::SessionCsvTable {
                row_index: None,
                header: vec!["mission".to_string()],
                path: "data/missions/mission_list.csv".to_string(),
                rows: None,
                next_row_seq: 0,
                saved_text: None,
            },
        );
        let session = super::super::super::model::ProjectSession {
            reference_revision: 0,
            references: Vec::new(),
            loaded_edit_targets: Vec::new(),
            projection_pending: false,
            source_versions: Default::default(),
            manifest: crate::models::ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: "mod".to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: crate::models::EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: Default::default(),
            faction_blueprint_tags: std::collections::HashMap::new(),
            csv_tables: csv_tables
                .into_iter()
                .map(|(key, table)| (key, std::sync::Arc::new(table)))
                .collect(),
            ship_files: Default::default(),
            variant_files: Default::default(),
            skin_files: Default::default(),
            variant_warnings: Vec::new(),
            skin_warnings: Vec::new(),
            weapon_specs: Default::default(),
            projectile_specs: Default::default(),
            system_files: Default::default(),
            skill_files: Default::default(),
        };

        let error = registered_mission_rows(&session).unwrap_err().to_string();

        assert!(error.contains("CSV rows are not loaded: missions"));
    }

    #[test]
    fn mission_entity_list_registers_only_rows_with_a_mission_id() {
        let root = project_workspace("mission_entity_rows_with_mission_id");
        std::fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\n,Auxiliary row\r\ndemo,Demo Mission\r\n#comment,\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Mission).unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "demo");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_query_returns_spec_and_csv_row() {
        let root = project_workspace("weapon_entity_query");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,range,beam speed\r\ndemo_weapon,ENERGY,700,1200\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/demo_weapon.wpn"),
            r#"{"id":"demo_weapon","specClass":"beam","turretSprite":"graphics/weapons/demo.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon")
            .unwrap()
            .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entity.data["spec"]["specClass"], "beam");
        assert_eq!(entity.data["csvRow"]["range"], "700");
        assert_eq!(
            entity
                .resource_refs
                .get("turretSprite")
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/weapons/demo.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_query_uses_csv_registration_without_spec() {
        let root = project_workspace("weapon_entity_csv_only");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,range,beam speed\r\ndemo_weapon,ENERGY,700,1200\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon")
            .unwrap()
            .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entity.data["spec"], Value::Object(Map::new()));
        assert_eq!(entity.data["csvRow"]["range"], "700");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_list_includes_local_spec_files() {
        let root = project_workspace("weapon_entity_list_csv_boundary");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,range\r\ncsv_weapon,ENERGY,700\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/spec_only.wpn"),
            r#"{"id":"spec_only","specClass":"beam"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Weapon).unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].id, "csv_weapon");
        assert_eq!(entities[0].data["csvRow"]["range"], "700");
        assert_eq!(entities[0].data["spec"], Value::Object(Map::new()));
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_list_registers_only_rows_with_an_id() {
        let root = project_workspace("weapon_entity_rows_with_id");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,ENERGY,70\r\n#comment,,\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Weapon).unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "demo_weapon");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_query_reads_local_spec_without_csv_row() {
        let root = project_workspace("weapon_entity_unregistered_spec");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,range,beam speed\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/demo_weapon.wpn"),
            r#"{"id":"demo_weapon","specClass":"beam"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entity.unwrap().data["spec"]["specClass"], "beam");
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_list_includes_local_spec_files() {
        let root = project_workspace("skill_entity_list_csv_boundary");
        std::fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name,icon\r\nskill_one,Skill One,graphics/icons/skill_one.png\r\n#comment,,\r\n,,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_one.skill"),
            r#"{"id":"skill_one","effect":"demo"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/spec_only.skill"),
            r#"{"id":"spec_only"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Skill).unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].id, "skill_one");
        assert_eq!(entities[0].data["spec"]["effect"], "demo");
        assert_eq!(entities[0].data["csvRow"]["name"], "Skill One");
        assert_eq!(
            entities[0]
                .resource_refs
                .get("icon")
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/icons/skill_one.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_query_uses_empty_spec_for_registered_skill_without_file() {
        let root = project_workspace("skill_entity_csv_only");
        std::fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\nskill_one,Skill One\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Skill, "skill_one")
            .unwrap()
            .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entity.data["spec"], Value::Object(Map::new()));
        assert_eq!(entity.data["csvRow"]["name"], "Skill One");
        assert!(!entity.resource_refs.contains_key("icon"));
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_query_reads_local_spec_without_csv_row() {
        let root = project_workspace("skill_entity_unregistered");
        std::fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\nskill_one,Skill One\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/missing.skill"),
            r#"{"id":"missing"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Skill, "missing").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entity.unwrap().data["spec"]["id"], "missing");
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_list_registers_only_rows_with_an_id() {
        let root = project_workspace("skill_entity_rows_with_id");
        std::fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\n,Auxiliary row\r\nskill_one,Skill One\r\n#comment,\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Skill).unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "skill_one");
        root.close().unwrap();
    }
}
