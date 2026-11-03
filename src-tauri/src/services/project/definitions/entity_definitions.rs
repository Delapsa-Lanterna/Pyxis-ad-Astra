use super::super::model::{
    EntityListEntry, MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvRow,
    string_from_row,
};
use super::super::session::csv_tables::{
    ensure_registered_table_rows, ensure_session_table_rows, loaded_csv_rows,
    loaded_registered_csv_rows,
};
use super::factions;
use crate::domain::entity_definitions::{
    EntitySpecDefinition, FACTION_SPEC_DEFINITION, PROJECTILE_SPEC_DEFINITION,
    SHIP_SPEC_DEFINITION, SKILL_SPEC_DEFINITION, SKIN_SPEC_DEFINITION, SYSTEM_SPEC_DEFINITION,
    VARIANT_SPEC_DEFINITION, WEAPON_SPEC_DEFINITION,
    associated_spec_definition as domain_associated_spec_definition,
    associated_spec_tables as domain_associated_spec_tables,
};
use crate::domain::entity_identity;
use crate::domain::entity_identity::path_is_or_in_dir;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::io::relative_path_contains;
use crate::models::{
    CsvTableKey, EntityKind, EntitySummaries, GameScanWarning, InvalidatedQueryKind,
    ResourceSource, SkinFile, VariantFile,
};
use crate::services::project::definitions::projectiles;
use crate::services::project::session::source_versions::capture_changed_versions;

use crate::services::project::sources::core::load_core_variant_files;
use crate::services::project::sources::documents::LoadedSpecRecord;
use crate::services::project::sources::json_documents::{
    load_skin_files_from, load_variant_files_from,
};
use crate::services::project::sources::{SourceReader, core, documents};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

type EntityListLoader = fn(&mut ProjectSession) -> AppResult<Vec<EntityListEntry>>;
type EntityCoreListLoader = fn(&ProjectSession) -> AppResult<Vec<EntityListEntry>>;

pub(in crate::services::project) struct ProjectEntityDefinition {
    pub kind: EntityKind,
    pub spec: Option<&'static EntitySpecDefinition>,
    pub csv_table: Option<CsvTableKey>,
    pub source_options: &'static [&'static str],
    pub path_matches: fn(&ProjectEntityDefinition, &str) -> bool,
    pub query_impacts: &'static [InvalidatedQueryKind],
    pub prepare: fn(&mut ProjectSession) -> AppResult<()>,
    pub detail: fn(&mut ProjectSession, &str) -> AppResult<Option<Value>>,
    pub list: EntityListLoader,
    pub core_list: Option<EntityCoreListLoader>,
    pub refresh: fn(&ProjectSession, &mut SourceReader) -> AppResult<EntityRefresh>,
}

pub(in crate::services::project) fn entity_definition(
    kind: EntityKind,
) -> AppResult<&'static ProjectEntityDefinition> {
    PROJECT_ENTITY_DEFINITIONS
        .iter()
        .find(|definition| definition.kind == kind)
        .ok_or_else(|| {
            AppError::message("entity.kind_unknown", format!("未注册的实体种类: {kind:?}"))
        })
}

pub(in crate::services::project) fn entity_definitions() -> &'static [ProjectEntityDefinition] {
    &PROJECT_ENTITY_DEFINITIONS
}

pub(in crate::services::project) fn associated_spec_definition(
    table: CsvTableKey,
) -> Option<&'static EntitySpecDefinition> {
    domain_associated_spec_definition(table)
}

pub(in crate::services::project) fn associated_spec_tables() -> Vec<CsvTableKey> {
    domain_associated_spec_tables()
}

const PROJECT_ENTITY_DEFINITIONS: [ProjectEntityDefinition; 9] = [
    ProjectEntityDefinition {
        kind: EntityKind::Ship,
        spec: Some(&SHIP_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Ships),
        source_options: &["ships.id", "wings.id"],
        path_matches: spec_path_matches,
        query_impacts: &[InvalidatedQueryKind::HullReferences],
        prepare: prepare_none,
        detail: ship_detail,
        list: ship_list,
        core_list: None,
        refresh: refresh_ship,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Weapon,
        spec: Some(&WEAPON_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Weapons),
        source_options: &["weapons.id"],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_weapon,
        detail: weapon_detail,
        list: weapon_list,
        core_list: None,
        refresh: refresh_weapon,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Projectile,
        spec: Some(&PROJECTILE_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["projectiles.id"],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: projectile_detail,
        list: projectile_list,
        core_list: None,
        refresh: refresh_projectile,
    },
    ProjectEntityDefinition {
        kind: EntityKind::System,
        spec: Some(&SYSTEM_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::ShipSystems),
        source_options: &[],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: system_detail,
        list: system_list,
        core_list: None,
        refresh: refresh_system,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Skill,
        spec: Some(&SKILL_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Skills),
        source_options: &[],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_skill,
        detail: skill_detail,
        list: skill_list,
        core_list: None,
        refresh: refresh_skill,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Faction,
        spec: Some(&FACTION_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["ships.tags", "weapons.tags", "wings.tags"],
        path_matches: faction_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: faction_detail,
        list: faction_list,
        core_list: None,
        refresh: refresh_faction,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Mission,
        spec: None,
        csv_table: None,
        source_options: &[],
        path_matches: mission_path_matches,
        query_impacts: &[],
        prepare: prepare_mission,
        detail: mission_detail,
        list: mission_list,
        core_list: None,
        refresh: refresh_mission,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Variant,
        spec: Some(&VARIANT_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["wings.id", "variants.variantId"],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: variant_detail,
        list: variant_list,
        core_list: Some(variant_core_list),
        refresh: refresh_variant,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Skin,
        spec: Some(&SKIN_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["ships.id", "ships.tags", "wings.id"],
        path_matches: spec_path_matches,
        query_impacts: &[InvalidatedQueryKind::HullReferences],
        prepare: prepare_none,
        detail: skin_detail,
        list: skin_list,
        core_list: None,
        refresh: refresh_skin,
    },
];

fn prepare_none(_session: &mut ProjectSession) -> AppResult<()> {
    Ok(())
}

fn spec_path_matches(definition: &ProjectEntityDefinition, path: &str) -> bool {
    definition.spec.is_some_and(|spec| spec.path_matches(path))
}

fn faction_path_matches(_definition: &ProjectEntityDefinition, path: &str) -> bool {
    path_is_or_in_dir(path, "data/world/factions") || path.ends_with(".faction")
}

fn mission_path_matches(_definition: &ProjectEntityDefinition, path: &str) -> bool {
    path_is_or_in_dir(path, "data/missions") || relative_path_contains(path, MISSION_LIST_REL_PATH)
}

fn prepare_weapon(session: &mut ProjectSession) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::Weapons)
}

fn prepare_skill(session: &mut ProjectSession) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::Skills)
}

fn prepare_mission(session: &mut ProjectSession) -> AppResult<()> {
    ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)
}

fn ship_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session.ship_files.get(id).map(|record| record.data.clone()))
}

fn weapon_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_weapon_entity_data(session, id)
}

fn projectile_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .projectile_specs
        .get(id)
        .map(|record| record.data.clone()))
}

fn system_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .system_files
        .get(id)
        .map(|record| record.data.clone()))
}

fn skill_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_skill_entity_data(session, id)
}

fn faction_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .faction_files
        .get(id)
        .map(|record| record.data.clone()))
}

fn mission_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_mission_entity(session, id)
}

fn variant_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .variant_files
        .iter()
        .find(|item| item.variant_id == id)
        .map(|item| item.data.clone()))
}

fn skin_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .skin_files
        .iter()
        .find(|item| item.skin_hull_id == id)
        .map(|item| item.data.clone()))
}

fn ship_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .ship_files
        .iter()
        .map(|(id, record)| entity_list_entry(EntityKind::Ship, id, record.data.clone()))
        .collect())
}

fn weapon_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    let mut rows = registered_weapon_rows(session)?
        .into_iter()
        .map(|entry| build_weapon_list_entity(session, EntityKind::Weapon, &entry.id, entry.data))
        .collect::<AppResult<Vec<_>>>()?;
    for id in session
        .weapon_specs
        .keys()
        .filter(|id| !rows.iter().any(|row| &row.id == *id))
        .cloned()
        .collect::<Vec<_>>()
    {
        rows.push(build_weapon_list_entity(
            session,
            EntityKind::Weapon,
            &id,
            Map::new(),
        )?);
    }
    Ok(rows)
}

fn projectile_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .projectile_specs
        .iter()
        .map(|(id, record)| entity_list_entry(EntityKind::Projectile, id, record.data.clone()))
        .collect())
}

fn system_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .system_files
        .iter()
        .map(|(id, record)| entity_list_entry(EntityKind::System, id, record.data.clone()))
        .collect())
}

fn skill_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    let mut rows = registered_skill_rows(session)?
        .into_iter()
        .map(|entry| build_skill_list_entity(session, EntityKind::Skill, &entry.id, entry.data))
        .collect::<AppResult<Vec<_>>>()?;
    for id in session
        .skill_files
        .keys()
        .filter(|id| !rows.iter().any(|row| &row.id == *id))
        .cloned()
        .collect::<Vec<_>>()
    {
        rows.push(build_skill_list_entity(
            session,
            EntityKind::Skill,
            &id,
            Map::new(),
        )?);
    }
    Ok(rows)
}

fn faction_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .faction_files
        .iter()
        .map(|(id, record)| entity_list_entry(EntityKind::Faction, id, record.data.clone()))
        .collect())
}

fn mission_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    registered_mission_rows(session)?
        .into_iter()
        .map(|entry| build_mission_list_entity(session, EntityKind::Mission, &entry.id, entry.data))
        .collect()
}

fn variant_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .variant_files
        .iter()
        .map(|item| entity_list_entry(EntityKind::Variant, &item.variant_id, item.data.clone()))
        .collect())
}

/// Core-only variant entities: the complement a variant reference domain
/// offers on top of the Mod's own list when a Starsector root is configured.
fn variant_core_list(session: &ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    let Some(root) = session.manifest.starsector_root.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(load_core_variant_files(root)?
        .iter()
        .map(|item| entity_list_entry(EntityKind::Variant, &item.variant_id, item.data.clone()))
        .collect())
}

fn skin_list(session: &mut ProjectSession) -> AppResult<Vec<EntityListEntry>> {
    Ok(session
        .skin_files
        .iter()
        .map(|item| entity_list_entry(EntityKind::Skin, &item.skin_hull_id, item.data.clone()))
        .collect())
}

fn entity_list_entry(kind: EntityKind, id: &str, data: Value) -> EntityListEntry {
    EntityListEntry {
        kind,
        id: id.to_string(),
        data,
    }
}

#[derive(Debug)]
pub(in crate::services::project) struct RegisteredCsvEntityRow {
    id: String,
    data: Map<String, Value>,
}

pub(in crate::services::project) fn registered_mission_rows(
    session: &ProjectSession,
) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    let table = session
        .csv_tables
        .get(MISSION_LIST_TABLE_KEY)
        .ok_or_else(|| {
            AppError::message(
                "table.unknown",
                format!("unknown table: {MISSION_LIST_TABLE_KEY}"),
            )
        })?;
    Ok(registered_entity_rows(
        loaded_csv_rows(table, MISSION_LIST_TABLE_KEY)?,
        "mission",
    ))
}

fn registered_weapon_rows(session: &ProjectSession) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    Ok(registered_entity_rows(
        loaded_registered_csv_rows(session, CsvTableKey::Weapons)?,
        "id",
    ))
}

fn registered_skill_rows(session: &ProjectSession) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    Ok(registered_entity_rows(
        loaded_registered_csv_rows(session, CsvTableKey::Skills)?,
        "id",
    ))
}

fn registered_entity_rows(rows: &[SessionCsvRow], id_column: &str) -> Vec<RegisteredCsvEntityRow> {
    rows.iter()
        .filter(|row| !row.is_comment)
        .filter_map(|row| {
            let id = string_from_row(&row.data, id_column)?;
            Some(RegisteredCsvEntityRow {
                id,
                data: row.data.clone(),
            })
        })
        .collect()
}

fn build_weapon_list_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityListEntry> {
    let spec = session
        .weapon_specs
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec.clone());
    data.insert("csvRow".to_string(), Value::Object(row));
    Ok(EntityListEntry {
        kind,
        id: id.to_string(),
        data: Value::Object(data),
    })
}

fn build_weapon_entity_data(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    ensure_registered_table_rows(session, CsvTableKey::Weapons)?;
    let Some(csv_row) = registered_weapon_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| Value::Object(row.data))
    else {
        return Ok(session
            .weapon_specs
            .get(id)
            .map(|record| serde_json::json!({"spec": record.data, "csvRow":{}})));
    };
    let spec = session
        .weapon_specs
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), csv_row);
    Ok(Some(Value::Object(data)))
}

fn build_skill_list_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityListEntry> {
    let spec = session
        .skill_files
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), Value::Object(row));
    let data = Value::Object(data);
    Ok(EntityListEntry {
        kind,
        id: id.to_string(),
        data,
    })
}

fn build_skill_entity_data(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    ensure_registered_table_rows(session, CsvTableKey::Skills)?;
    let Some(csv_row) = registered_skill_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| Value::Object(row.data))
    else {
        return Ok(session
            .skill_files
            .get(id)
            .map(|record| serde_json::json!({"spec":record.data,"csvRow":{}})));
    };
    let spec = session
        .skill_files
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), csv_row);
    Ok(Some(Value::Object(data)))
}

fn build_mission_list_entity(
    _session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityListEntry> {
    let mut data = Map::new();
    data.insert("list".to_string(), Value::Object(row));
    Ok(EntityListEntry {
        kind,
        id: id.to_string(),
        data: Value::Object(data),
    })
}

fn build_mission_entity(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    let Some(row) = registered_mission_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| row.data)
    else {
        return Ok(None);
    };
    let clean = entity_identity::validate_entity_id(id, "无效战役 ID")?;
    let dir = Path::new(&session.manifest.mod_root)
        .join("data/missions")
        .join(clean);
    let descriptor_path = dir.join("descriptor.json");
    let mut sources = SourceReader::new(Path::new(&session.manifest.mod_root))?;
    let descriptor = if descriptor_path.exists() {
        sources.json(&descriptor_path)?
    } else {
        Value::Object(Map::new())
    };
    let text_path = dir.join("mission_text.txt");
    let text = if text_path.exists() {
        let (version, bytes) = io::read_versioned_bytes(&text_path)?;
        let text = io::decode_text(&text_path, &bytes)?;
        sources.versions.insert(sources.key(&text_path), version);
        text
    } else {
        String::new()
    };
    let mut data = Map::new();
    data.insert("list".to_string(), Value::Object(row));
    data.insert("descriptor".to_string(), descriptor);
    data.insert("text".to_string(), Value::String(text));
    data.insert(
        "relPath".to_string(),
        Value::String(format!("data/missions/{clean}")),
    );
    capture_changed_versions(&mut sources, &[&format!("data/missions/{clean}")])?;
    Arc::make_mut(&mut session.source_versions).extend(sources.versions);
    Ok(Some(Value::Object(data)))
}

pub(in crate::services::project) enum EntityRefresh {
    Specs {
        kind: EntityKind,
        records: BTreeMap<String, LoadedSpecRecord>,
    },
    Variant {
        files: Vec<VariantFile>,
        warnings: Vec<GameScanWarning>,
    },
    Skin {
        files: Vec<SkinFile>,
        warnings: Vec<GameScanWarning>,
    },
    Faction {
        files: BTreeMap<String, LoadedSpecRecord>,
        tags: HashMap<String, String>,
    },
    Mission(usize),
}

impl EntityRefresh {
    pub fn update_summary(&self, summary: &mut EntitySummaries) {
        match self {
            Self::Specs { kind, records } => match kind {
                EntityKind::Ship => summary.ships = records.len(),
                EntityKind::Weapon => summary.weapons = records.len(),
                EntityKind::Projectile => summary.projectiles = records.len(),
                EntityKind::System => summary.systems = records.len(),
                EntityKind::Skill => summary.skills = records.len(),
                _ => unreachable!("spec refresh kinds have a record map"),
            },
            Self::Variant { files, .. } => summary.variants = files.len(),
            Self::Skin { files, .. } => summary.skins = files.len(),
            Self::Faction { files, .. } => summary.factions = files.len(),
            Self::Mission(count) => summary.missions = *count,
        }
    }
    pub fn apply(self, session: &mut ProjectSession) {
        self.update_summary(&mut session.manifest.entity_summaries);
        match self {
            Self::Specs { kind, records } => match kind {
                EntityKind::Ship => session.ship_files = records.into(),
                EntityKind::Weapon => session.weapon_specs = records.into(),
                EntityKind::Projectile => session.projectile_specs = records.into(),
                EntityKind::System => session.system_files = records.into(),
                EntityKind::Skill => session.skill_files = records.into(),
                _ => unreachable!("spec refresh kinds have a record map"),
            },
            Self::Variant { files, warnings } => {
                session.variant_files = files.into();
                session.variant_warnings = warnings;
            }
            Self::Skin { files, warnings } => {
                session.skin_files = files.into();
                session.skin_warnings = warnings;
            }
            Self::Faction { files, tags } => {
                session.faction_files = files.into();
                session.faction_blueprint_tags = tags;
            }
            Self::Mission(_) => {}
        }
    }
}

fn refresh_spec_records(
    _session: &ProjectSession,
    kind: EntityKind,
    directories: &[&str],
    extension: &str,
    id_field: &str,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    Ok(EntityRefresh::Specs {
        kind,
        records: documents::load_spec_records_from(
            sources,
            directories,
            extension,
            id_field,
            ResourceSource::Mod,
        )?,
    })
}
fn refresh_ship(session: &ProjectSession, sources: &mut SourceReader) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::Ship,
        SHIP_SPEC_DEFINITION.source_dirs(),
        "ship",
        "hullId",
        sources,
    )
}
fn refresh_weapon(
    session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::Weapon,
        WEAPON_SPEC_DEFINITION.source_dirs(),
        "wpn",
        "id",
        sources,
    )
}
fn refresh_projectile(
    session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    let core = session
        .manifest
        .starsector_root
        .as_deref()
        .map(core::load_core_projectile_specs)
        .transpose()?;
    let records = projectiles::load_projectile_specs_from(sources, core.as_deref())?;
    Ok(EntityRefresh::Specs {
        kind: EntityKind::Projectile,
        records,
    })
}
fn refresh_system(
    session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::System,
        SYSTEM_SPEC_DEFINITION.source_dirs(),
        "system",
        "id",
        sources,
    )
}
fn refresh_skill(session: &ProjectSession, sources: &mut SourceReader) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::Skill,
        SKILL_SPEC_DEFINITION.source_dirs(),
        "skill",
        "id",
        sources,
    )
}
fn refresh_faction(
    _session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    let files = factions::load_faction_files_from(sources)?;
    let tags = factions::faction_blueprint_tags(&files);
    Ok(EntityRefresh::Faction { files, tags })
}
fn refresh_mission(
    _session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    Ok(EntityRefresh::Mission(
        sources.count(&sources.path(MISSION_LIST_REL_PATH)?, "mission")?,
    ))
}
fn refresh_variant(
    _session: &ProjectSession,
    sources: &mut SourceReader,
) -> AppResult<EntityRefresh> {
    let (files, warnings) = load_variant_files_from(sources)?;
    Ok(EntityRefresh::Variant { files, warnings })
}
fn refresh_skin(_session: &ProjectSession, sources: &mut SourceReader) -> AppResult<EntityRefresh> {
    let (files, warnings) = load_skin_files_from(sources)?;
    Ok(EntityRefresh::Skin { files, warnings })
}

pub(in crate::services::project) fn source_option_origin_scopes(
    definition: &ProjectEntityDefinition,
) -> impl Iterator<Item = String> + '_ {
    definition
        .source_options
        .iter()
        .flat_map(|source| [(*source).to_string(), format!("csv:{source}")])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faction_source_option_scopes_include_fighter_tags() {
        let definition = entity_definition(EntityKind::Faction).unwrap();
        let scopes = source_option_origin_scopes(definition).collect::<Vec<_>>();

        assert!(scopes.contains(&"wings.tags".to_string()));
        assert!(scopes.contains(&"csv:wings.tags".to_string()));
    }
}
