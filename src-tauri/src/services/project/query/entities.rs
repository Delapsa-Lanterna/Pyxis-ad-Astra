use super::super::definitions::entity_definitions::entity_definition;
use super::super::model::ProjectSession;
use super::super::resources::entity_references::entity_list_resource_refs;
use super::super::session::{lock_ready_session, session_handle};
use super::{entity_presentation, entity_targets, json_layers};
use crate::domain::{entity_definitions, json_composition};
use crate::errors::AppResult;
use crate::models::file_content::JsonFileContent;
use crate::models::{EntityData, EntityKind, ResourceSource};
use crate::services::project::sources::core;
use crate::services::project::sources::documents::LoadedSpecRecord;
use serde_json::Value;
use std::collections::BTreeMap;

fn document(session: &ProjectSession, kind: EntityKind, id: &str) -> Option<JsonFileContent> {
    if let Some(record) = session
        .spec_records(kind)
        .and_then(|records| records.get(id))
    {
        return Some(JsonFileContent::from(record.document.as_ref()));
    }
    let local = match kind {
        EntityKind::Variant => session
            .variant_files
            .iter()
            .find(|file| file.variant_id == id)
            .and_then(|file| session.documents.get(&file.rel_path))
            .map(|source| JsonFileContent::from(source.as_ref())),
        EntityKind::Skin => session
            .skin_files
            .iter()
            .find(|file| file.skin_hull_id == id)
            .and_then(|file| session.documents.get(&file.rel_path))
            .map(|source| JsonFileContent::from(source.as_ref())),
        EntityKind::Mission => session
            .documents
            .get(&format!("data/missions/{id}/descriptor.json"))
            .map(|source| JsonFileContent::from(source.as_ref())),
        _ => None,
    };
    local.or_else(|| {
        session
            .reference_spec(kind, id)
            .map(|record| JsonFileContent::from(record.document.as_ref()))
    })
}
pub fn query_entity(session_id: &str, kind: EntityKind, id: &str) -> AppResult<Option<EntityData>> {
    query_entity_batch(session_id, kind, &[id.into()]).map(|mut records| records.remove(0))
}
pub(in crate::services::project) fn query_entity_batch(
    session_id: &str,
    kind: EntityKind,
    ids: &[String],
) -> AppResult<Vec<Option<EntityData>>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let definition = entity_definition(kind)?;
    (definition.prepare)(&mut session)?;
    let targets = entity_targets::prepare_entity_targets(&mut session, kind)?;
    ids.iter()
        .map(|id| {
            let target = targets.describe(&session, id);
            let reference = target
                .target
                .source
                .as_ref()
                .filter(|source| source.source == ResourceSource::Reference)
                .and_then(|source| source.reference.as_deref());
            let data = if let Some(reference) = reference {
                session
                    .references
                    .iter()
                    .find(|view| view.identity == *reference)
                    .expect("registered reference source")
                    .read(|session| {
                        (definition.prepare)(session)?;
                        (definition.detail)(session, id)
                    })?
            } else {
                (definition.detail)(&mut session, id)?
            };
            let Some(data) = data else {
                return Ok(None);
            };
            let (composition, resource_refs) =
                entity_presentation::entity_presentation(&session, &target.target, &data, None)?;
            let document = document(&session, kind, id);
            entity_targets::remember_edit_target(&mut session, &target.target);
            Ok(Some(EntityData {
                kind,
                id: id.clone(),
                target: target.target,
                base_versions: target.base_versions,
                data,
                document,
                composition,
                resource_refs,
            }))
        })
        .collect()
}
pub fn query_entity_list(session_id: &str, kind: EntityKind) -> AppResult<Vec<EntityData>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let definition = entity_definition(kind)?;
    (definition.prepare)(&mut session)?;
    let entries = (definition.list)(&mut session)?;
    let targets = entity_targets::prepare_entity_targets(&mut session, kind)?;
    let mut records = Vec::with_capacity(entries.len());
    for entry in entries {
        let target = targets.describe(&session, &entry.id);
        let resources = entity_list_resource_refs(&session, kind, &entry.id, &entry.data)?;
        let (composition, resource_refs) = entity_presentation::entity_presentation(
            &session,
            &target.target,
            &entry.data,
            Some(resources),
        )?;
        let document = None;
        if matches!(
            kind,
            EntityKind::Variant | EntityKind::Skin | EntityKind::Faction | EntityKind::Mission
        ) {
            entity_targets::remember_edit_target(&mut session, &target.target);
        }
        records.push(EntityData {
            kind,
            id: entry.id,
            target: target.target,
            base_versions: target.base_versions,
            data: entry.data,
            document,
            composition,
            resource_refs,
        });
    }
    Ok(records)
}

fn local_spec_paths(session: &ProjectSession, kind: EntityKind) -> BTreeMap<String, String> {
    if let Some(records) = session.spec_records(kind) {
        return records
            .iter()
            .filter(|(_, record)| record.location.source == ResourceSource::Mod)
            .map(|(id, record)| (id.clone(), record.location.rel_path.clone()))
            .collect();
    }
    match kind {
        EntityKind::Variant => session
            .variant_files
            .iter()
            .map(|file| (file.variant_id.clone(), file.rel_path.clone()))
            .collect(),
        EntityKind::Skin => session
            .skin_files
            .iter()
            .map(|file| (file.skin_hull_id.clone(), file.rel_path.clone()))
            .collect(),
        _ => BTreeMap::new(),
    }
}

/// Returns physical spec identities across the session's authorized sources.
pub(in crate::services::project) fn entity_spec_paths(
    session: &ProjectSession,
    kind: EntityKind,
) -> AppResult<BTreeMap<String, String>> {
    let paths = |records: &BTreeMap<String, LoadedSpecRecord>| {
        records
            .iter()
            .map(|(id, record)| (id.clone(), record.location.rel_path.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    let mut available = if let Some(root) = &session.manifest.starsector_root {
        match kind {
            EntityKind::Ship => paths(core::load_core_ship_files(root)?.as_ref()),
            EntityKind::Weapon => paths(core::load_core_weapon_specs(root)?.as_ref()),
            EntityKind::Projectile => paths(core::load_core_projectile_specs(root)?.as_ref()),
            EntityKind::System => paths(core::load_core_system_files(root)?.as_ref()),
            EntityKind::Skill => paths(core::load_core_skill_files(root)?.as_ref()),
            EntityKind::Faction => paths(core::load_core_faction_files(root)?.as_ref()),
            EntityKind::Variant => core::load_core_variant_files(root)?
                .iter()
                .map(|file| (file.variant_id.clone(), file.rel_path.clone()))
                .collect(),
            EntityKind::Skin => core::load_core_skin_files(root)?
                .iter()
                .map(|file| (file.skin_hull_id.clone(), file.rel_path.clone()))
                .collect(),
            EntityKind::Mission => BTreeMap::new(),
        }
    } else {
        BTreeMap::new()
    };

    for view in session.references.iter().rev() {
        available.extend(local_spec_paths(&view.session, kind));
    }
    available.extend(local_spec_paths(session, kind));
    available.retain(|id, _| entity_definitions::csv_id_active(kind, id));
    Ok(available)
}

pub(in crate::services::project) fn query_entity_specs(
    session_id: &str,
    kind: EntityKind,
    ids: &[String],
) -> AppResult<Vec<Option<Value>>> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    let available = entity_spec_paths(&session, kind)?;
    ids.iter()
        .map(|id| {
            let local = session
                .spec_records(kind)
                .and_then(|records| records.get(id))
                .filter(|record| record.location.source == ResourceSource::Mod)
                .map(|record| (record.location.rel_path.clone(), record.data.clone()))
                .or_else(|| match kind {
                    EntityKind::Variant => session
                        .variant_files
                        .iter()
                        .find(|file| &file.variant_id == id)
                        .map(|file| (file.rel_path.clone(), file.data.clone())),
                    EntityKind::Skin => session
                        .skin_files
                        .iter()
                        .find(|file| &file.skin_hull_id == id)
                        .map(|file| (file.rel_path.clone(), file.data.clone())),
                    _ => None,
                });
            // Only physical records establish existence; CSV registration supplies no spec content.
            let owns_file = local.is_some();
            let record = available.get(id).map(|relative| {
                (
                    relative.clone(),
                    local
                        .map(|(_, data)| data)
                        .unwrap_or_else(|| Value::Object(Default::default())),
                )
            });
            record
                .map(|(relative, local)| {
                    let mut composition = json_layers::json_composition(&session, &relative)?;
                    composition.replace &= owns_file;
                    json_composition::compose_game_json(&composition, &local)
                })
                .transpose()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::services::project_sync::release_project_session;

    use super::super::super::definitions::entity_definitions::registered_mission_rows;
    use super::super::super::model::MISSION_LIST_TABLE_KEY;
    use super::super::super::session::open_project_session_traced;
    use super::*;
    #[cfg(test)]
    use crate::io::faction_index;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::models::{EntityLinkedRecord, EntitySummaries, ProjectManifest};
    #[cfg(test)]
    use crate::services::project::model::{ProjectSession, SessionCsvTable};
    #[cfg(test)]
    use crate::services::project::performance::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    use serde_json::{Map, Value};
    use std::collections::BTreeMap;
    #[cfg(test)]
    use std::collections::HashMap;
    #[cfg(test)]
    use std::fs;
    #[cfg(test)]
    use std::sync::Arc;

    #[test]
    fn faction_list_prepares_one_index_and_matches_loaded_nested_targets() {
        let root = project_workspace("faction_list_target_projection");
        fs::create_dir_all(root.join("data/world/factions/nested")).unwrap();
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
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        faction_index::take_faction_index_reads();
        let list = query_entity_list(&manifest.session_id, EntityKind::Faction).unwrap();
        assert_eq!(faction_index::take_faction_index_reads(), 1);
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
            Some(EntityLinkedRecord::Index { row_index: 0, .. })
        ));
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn mission_entity_query_returns_index_descriptor_text_and_icon_ref() {
        let root = project_workspace("mission_entity_query");
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let list = query_entity_list(&manifest.session_id, EntityKind::Mission).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Mission, "demo")
            .unwrap()
            .unwrap();

        let _ = release_project_session(&manifest.session_id);
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
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\ndemo,Demo Mission\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Mission, "missing").unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert!(entity.is_none());
        root.close().unwrap();
    }

    #[test]
    fn mission_list_icon_descriptor_errors_are_not_hidden() {
        let root = project_workspace("mission_list_icon_descriptor_error");
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\ndemo,Demo Mission\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/demo/descriptor.json"), "{").unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_entity_list(&manifest.session_id, EntityKind::Mission)
            .unwrap_err()
            .to_string();

        let _ = release_project_session(&manifest.session_id);
        assert!(error.contains("descriptor.json"));
        root.close().unwrap();
    }

    #[test]
    fn registered_mission_rows_requires_loaded_csv_rows() {
        let mut csv_tables = BTreeMap::new();
        csv_tables.insert(
            MISSION_LIST_TABLE_KEY.to_string(),
            SessionCsvTable {
                missing_baseline: false,
                row_index: None,
                header: vec!["mission".to_string()],
                path: "data/missions/mission_list.csv".to_string(),
                rows: None,
                next_row_seq: 0,
                source: None,
            },
        );
        let session = ProjectSession {
            documents: Default::default(),
            reference_revision: 0,
            references: Vec::new(),
            loaded_edit_targets: Vec::new(),
            content_pending: false,
            source_versions: Default::default(),
            source_scopes: Default::default(),
            source_stamps: Default::default(),
            manifest: ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: "mod".to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: Default::default(),
            faction_blueprint_tags: HashMap::new(),
            csv_tables: csv_tables
                .into_iter()
                .map(|(key, table)| (key, Arc::new(table)))
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
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\n,Auxiliary row\r\ndemo,Demo Mission\r\n#comment,\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Mission).unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "demo");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_query_returns_spec_and_csv_row() {
        let root = project_workspace("weapon_entity_query");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon")
            .unwrap()
            .unwrap();

        let _ = release_project_session(&manifest.session_id);
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
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,range,beam speed\r\ndemo_weapon,ENERGY,700,1200\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon")
            .unwrap()
            .unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entity.data["spec"], Value::Object(Map::new()));
        assert_eq!(entity.data["csvRow"]["range"], "700");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_list_includes_local_spec_files() {
        let root = project_workspace("weapon_entity_list_csv_boundary");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Weapon).unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].id, "csv_weapon");
        assert_eq!(entities[0].data["csvRow"]["range"], "700");
        assert_eq!(entities[0].data["spec"], Value::Object(Map::new()));
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_list_registers_only_rows_with_an_id() {
        let root = project_workspace("weapon_entity_rows_with_id");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,ENERGY,70\r\n#comment,,\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Weapon).unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "demo_weapon");
        root.close().unwrap();
    }

    #[test]
    fn weapon_entity_query_reads_local_spec_without_csv_row() {
        let root = project_workspace("weapon_entity_unregistered_spec");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Weapon, "demo_weapon").unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entity.unwrap().data["spec"]["specClass"], "beam");
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_list_includes_local_spec_files() {
        let root = project_workspace("skill_entity_list_csv_boundary");
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Skill).unwrap();

        let _ = release_project_session(&manifest.session_id);
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
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\nskill_one,Skill One\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Skill, "skill_one")
            .unwrap()
            .unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entity.data["spec"], Value::Object(Map::new()));
        assert_eq!(entity.data["csvRow"]["name"], "Skill One");
        assert!(!entity.resource_refs.contains_key("icon"));
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_query_reads_local_spec_without_csv_row() {
        let root = project_workspace("skill_entity_unregistered");
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
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

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entity = query_entity(&manifest.session_id, EntityKind::Skill, "missing").unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entity.unwrap().data["spec"]["id"], "missing");
        root.close().unwrap();
    }

    #[test]
    fn skill_entity_list_registers_only_rows_with_an_id() {
        let root = project_workspace("skill_entity_rows_with_id");
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\n,Auxiliary row\r\nskill_one,Skill One\r\n#comment,\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entities = query_entity_list(&manifest.session_id, EntityKind::Skill).unwrap();

        let _ = release_project_session(&manifest.session_id);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].id, "skill_one");
        root.close().unwrap();
    }
}
