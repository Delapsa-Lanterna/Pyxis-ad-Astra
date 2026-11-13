use super::definitions::{entity_definitions, factions, projectiles};
use super::model::{
    MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvTable, SpecBundle,
};
use super::performance::PerformanceTrace;
use super::sources::{SourceReader, core, documents, json_documents};
use super::{invalidation, model, versions};
use crate::domain::entity_definitions::{
    EntitySpecDefinition, SHIP_SPEC_DEFINITION, SKILL_SPEC_DEFINITION, SYSTEM_SPEC_DEFINITION,
    WEAPON_SPEC_DEFINITION, csv_id_active,
};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::{
    self, EntityKind, EntitySummaries, FileChangeRecord, ProjectManifest, ResourceSource,
    SessionContentUpdate, TableSummary,
};
use crate::services::project::model::SessionCsvRow;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock, RwLockWriteGuard};

mod access;
pub(in crate::services::project) mod csv_tables;
pub(in crate::services::project) mod csv_writes;
pub(super) mod references;
pub(super) mod registry;
pub(in crate::services::project) mod source_refresh;
pub(in crate::services::project) mod source_versions;
pub(crate) use access::lock_ready_session;
pub(super) use registry::{RegisteredSession, lock_registry};
pub(crate) use registry::{lock_session, session_handle};

static OPENINGS: RwLock<()> = RwLock::new(());
static CLOSING: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
pub struct SessionOpeningPause {
    _guard: RwLockWriteGuard<'static, ()>,
}
impl Drop for SessionOpeningPause {
    fn drop(&mut self) {
        CLOSING.store(false, Ordering::Release);
    }
}
pub fn hold_session_openings() -> AppResult<SessionOpeningPause> {
    CLOSING.store(true, Ordering::Release);
    let guard = OPENINGS.write().map_err(|_| {
        CLOSING.store(false, Ordering::Release);
        AppError::message("session.opening_poisoned", "会话建立状态不可用")
    })?;
    Ok(SessionOpeningPause { _guard: guard })
}
pub fn registered_session_ids() -> AppResult<Vec<String>> {
    Ok(lock_registry()?.keys().cloned().collect())
}
pub(super) fn new_session_id() -> String {
    format!("session-{:020}", SEQUENCE.fetch_add(1, Ordering::Relaxed))
}
pub fn ensure_project_session_mod_root(id: &str, root: &str) -> AppResult<()> {
    let registered = session_handle(id)?;
    let expected = FsRootBoundary::new(Path::new(&registered.root), "registered root")?;
    let actual = FsRootBoundary::new(Path::new(root), "requested root")?;
    if expected.root() != actual.root() {
        return Err(AppError::message(
            "session.mod_root_mismatch",
            format!("session {id} does not own mod root: {root}"),
        ));
    }
    Ok(())
}
pub(crate) fn registered_manifests(
    root: &str,
    source: ResourceSource,
) -> AppResult<Vec<ProjectManifest>> {
    let key = models::windows_path_key(root);
    let handles = lock_registry()?
        .values()
        .filter(|entry| {
            models::windows_path_key(if source == ResourceSource::Core {
                entry.core_root.as_deref().unwrap_or("")
            } else {
                &entry.root
            }) == key
        })
        .cloned()
        .collect::<Vec<_>>();
    handles
        .iter()
        .map(|entry| Ok(lock_session(entry)?.manifest.clone()))
        .collect()
}
pub(crate) fn affected_session_ids(
    changes: &[FileChangeRecord],
) -> AppResult<Vec<(String, String)>> {
    Ok(lock_registry()?
        .values()
        .filter(|entry| {
            let root = models::windows_path_key(&entry.root);
            changes.iter().any(|change| {
                [&change.before_path, &change.after_path]
                    .iter()
                    .any(|path| io::relative_path_contains(&root, &models::windows_path_key(path)))
            })
        })
        .map(|entry| (entry.session_id.clone(), entry.root.clone()))
        .collect())
}
pub(crate) fn mark_session_pending(id: &str) -> AppResult<()> {
    lock_session(&session_handle(id)?)?.content_pending = true;
    Ok(())
}
pub(crate) fn current_project_manifest(id: &str) -> AppResult<ProjectManifest> {
    Ok(lock_ready_session(&session_handle(id)?)?.manifest.clone())
}
pub fn invalidate_core_cache(root: &str) -> AppResult<()> {
    core::invalidate_core_cache(root)
}
pub fn invalidate_project_session(
    id: &str,
    changes: &[FileChangeRecord],
) -> AppResult<SessionContentUpdate> {
    let handle = session_handle(id)?;
    let mut session = lock_session(&handle)?;
    let invalidation = invalidation::invalidate_session_changes(&mut session, changes)?;
    session.manifest.base_versions = vec![versions::version_for_path(&session, "mod_info.json")];
    session.content_pending = false;
    Ok(SessionContentUpdate {
        manifest: session.manifest.clone(),
        invalidation,
    })
}
pub(crate) fn open_project_session_traced(
    root: &Path,
    game: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectManifest> {
    if CLOSING.load(Ordering::Acquire) {
        return Err(AppError::message(
            "session.application_closing",
            "应用正在关闭",
        ));
    }
    let _opening = OPENINGS
        .read()
        .map_err(|_| AppError::message("session.opening_poisoned", "会话建立状态不可用"))?;
    if CLOSING.load(Ordering::Acquire) {
        return Err(AppError::message(
            "session.application_closing",
            "应用正在关闭",
        ));
    }
    let session = build_project_session(root, game, trace)?;
    let manifest = session.manifest.clone();
    lock_registry()?.insert(
        manifest.session_id.clone(),
        RegisteredSession {
            session_id: manifest.session_id.clone(),
            root: manifest.mod_root.clone(),
            core_root: manifest.starsector_root.as_ref().map(|root| {
                Path::new(root)
                    .join("starsector-core")
                    .to_string_lossy()
                    .into_owned()
            }),
            handle: Arc::new(Mutex::new(session)),
            reference: None,
        },
    );
    Ok(manifest)
}
pub(super) fn build_registered_session_csv_tables() -> BTreeMap<String, SessionCsvTable> {
    let make = |path: &str, header| SessionCsvTable {
        missing_baseline: false,
        path: path.into(),
        header,
        rows: None,
        row_index: None,
        next_row_seq: 0,
        source: None,
    };
    let mut tables = model::csv_table_specs()
        .iter()
        .map(|spec| (spec.key.as_str().into(), make(spec.rel_path, Vec::new())))
        .collect::<BTreeMap<_, _>>();
    tables.insert(
        MISSION_LIST_TABLE_KEY.into(),
        make(MISSION_LIST_REL_PATH, model::mission_list_default_header()),
    );
    tables.insert(
        "faction-index".into(),
        make("data/world/factions/factions.csv", Vec::new()),
    );
    tables
}
pub(super) fn build_project_session(
    root: &Path,
    game: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectSession> {
    let boundary = FsRootBoundary::new(root, "mod root")?;
    let root = boundary.root();
    let _lease = io::acquire_root_write_lock(root)?;
    let game = game
        .map(|root| {
            FsRootBoundary::new(root, "starsector root")
                .map(|boundary| boundary.root().to_path_buf())
        })
        .transpose()?;
    let mut sources = SourceReader::new(root)?;
    let timer = trace.timer();
    let info = sources.path("mod_info.json")?;
    let mod_info = info.exists().then(|| sources.json(&info)).transpose()?;
    let faction_files = documents::load_faction_files_from(&mut sources, ResourceSource::Mod)?;
    let faction_blueprint_tags = factions::faction_blueprint_tags(&faction_files);
    let mission_path = sources.path(MISSION_LIST_REL_PATH)?;
    let missions = sources.count(&mission_path, "mission", |id| {
        csv_id_active(EntityKind::Mission, id)
    })?;
    let bundle = load_spec_bundle(&mut sources, game.as_deref(), trace)?;
    let summaries = EntitySummaries {
        factions: faction_files.len(),
        missions,
        ships: bundle.ship_files.len(),
        weapons: bundle.weapon_specs.len(),
        projectiles: bundle.projectile_specs.len(),
        variants: bundle.variant_files.len(),
        skins: bundle.skin_files.len(),
        systems: bundle.system_files.len(),
        skills: bundle.skill_files.len(),
    };
    let table_entity_summaries =
        csv_tables::build_table_entity_summaries_from(&mut sources, &summaries)?;
    source_versions::capture_project_versions(&mut sources)?;
    let mut csv_tables = build_registered_session_csv_tables();
    for (key, table) in &mut csv_tables {
        if let Some(csv) = sources.tables.get(&table.path) {
            table.header = csv.header.clone();
            table.rows = Some(Arc::new(
                csv.rows
                    .iter()
                    .enumerate()
                    .map(|(index, row)| SessionCsvRow {
                        row_key: format!("{key}:row:{index}"),
                        data: row.data.clone(),
                        is_comment: row.is_comment,
                        source_row: Some(index),
                    })
                    .collect(),
            ));
            table.next_row_seq = csv.rows.len() as u64;
            table.source = sources.csv_sources.get(&table.path).cloned();
        }
    }
    let table_summaries = model::csv_table_specs()
        .iter()
        .map(|spec| {
            let table = &csv_tables[spec.key.as_str()];
            (
                spec.key,
                TableSummary {
                    path: table.path.clone(),
                    header: table.header.clone(),
                    available: root.join(&table.path).exists(),
                    total_rows: table.rows.as_ref().map(|rows| rows.len()),
                },
            )
        })
        .collect();
    let warnings = bundle
        .variant_warnings
        .iter()
        .chain(&bundle.skin_warnings)
        .cloned()
        .collect();
    let manifest = ProjectManifest {
        base_versions: vec![sources.versions["mod_info.json"].clone()],
        session_id: new_session_id(),
        mod_root: root.to_string_lossy().into_owned(),
        starsector_root: game
            .as_ref()
            .map(|root| root.to_string_lossy().into_owned()),
        core_available: game
            .as_ref()
            .is_some_and(|root| root.join("starsector-core").is_dir()),
        associated_spec_tables: entity_definitions::associated_spec_tables(),
        mod_info,
        table_summaries,
        table_entity_summaries,
        entity_summaries: summaries,
        warnings,
    };
    trace.record_stage("source_records", timer, || {
        vec![(
            "result",
            if sources.reused() { "reused" } else { "parsed" }.into(),
        )]
    });
    let documents = Arc::new(sources.documents());
    Ok(ProjectSession {
        documents,
        reference_revision: 0,
        references: Vec::new(),
        loaded_edit_targets: Vec::new(),
        content_pending: false,
        source_versions: Arc::new(sources.versions),
        source_scopes: Arc::new(sources.scopes),
        source_stamps: Arc::new(sources.stamps),
        manifest,
        faction_files: Arc::new(faction_files),
        faction_blueprint_tags,
        csv_tables: csv_tables
            .into_iter()
            .map(|(key, table)| (key, Arc::new(table)))
            .collect(),
        ship_files: Arc::new(bundle.ship_files),
        variant_files: Arc::new(bundle.variant_files),
        skin_files: Arc::new(bundle.skin_files),
        variant_warnings: bundle.variant_warnings,
        skin_warnings: bundle.skin_warnings,
        weapon_specs: Arc::new(bundle.weapon_specs),
        projectile_specs: Arc::new(bundle.projectile_specs),
        system_files: Arc::new(bundle.system_files),
        skill_files: Arc::new(bundle.skill_files),
    })
}
pub(super) fn load_spec_bundle(
    sources: &mut SourceReader,
    game: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<SpecBundle> {
    let timer = trace.timer();
    let mut load = |name: &'static str, definition: &EntitySpecDefinition| {
        let timer = trace.timer();
        let records = documents::load_spec_records_from(
            sources,
            definition.source_dirs(),
            definition.extension_without_dot(),
            definition.id_field,
            ResourceSource::Mod,
        )?;
        trace.record_stage(name, timer, || vec![("files", records.len().to_string())]);
        Ok::<_, AppError>(records)
    };
    let ship_files = load("spec_ships", &SHIP_SPEC_DEFINITION)?;
    let weapon_specs = load("spec_weapons", &WEAPON_SPEC_DEFINITION)?;
    let system_files = load("spec_systems", &SYSTEM_SPEC_DEFINITION)?;
    let skill_files = load("spec_skills", &SKILL_SPEC_DEFINITION)?;
    let stage = trace.timer();
    let (variant_files, variant_warnings) = json_documents::load_variant_files_from(sources)?;
    trace.record_stage("spec_variants", stage, || {
        vec![("files", variant_files.len().to_string())]
    });
    let stage = trace.timer();
    let (skin_files, skin_warnings) = json_documents::load_skin_files_from(sources)?;
    trace.record_stage("spec_skins", stage, || {
        vec![("files", skin_files.len().to_string())]
    });
    let stage = trace.timer();
    let core_projectiles = game
        .map(|root| core::load_core_projectile_specs(&root.to_string_lossy()))
        .transpose()?;
    trace.record_stage("spec_core_projectiles", stage, || {
        vec![(
            "files",
            core_projectiles
                .as_ref()
                .map_or(0, |files| files.len())
                .to_string(),
        )]
    });
    let stage = trace.timer();
    let projectile_specs =
        projectiles::load_projectile_specs_from(sources, core_projectiles.as_deref())?;
    trace.record_stage("spec_projectiles", stage, || {
        vec![("files", projectile_specs.len().to_string())]
    });
    trace.record_stage("spec_bundle", timer, || {
        vec![(
            "files",
            (ship_files.len()
                + weapon_specs.len()
                + system_files.len()
                + skill_files.len()
                + projectile_specs.len()
                + variant_files.len()
                + skin_files.len())
            .to_string(),
        )]
    });
    Ok(SpecBundle {
        ship_files,
        weapon_specs,
        system_files,
        skill_files,
        variant_files,
        variant_warnings,
        skin_files,
        skin_warnings,
        projectile_specs,
    })
}

#[cfg(test)]
mod tests {
    use super::source_refresh::refresh_core_session;
    #[cfg(test)]
    use crate::models::{EntityKind, InvalidatedResourceScope};
    use crate::test_support::work_counts;
    #[cfg(test)]
    use crate::{io, services};
    #[cfg(test)]
    use std::slice;

    use crate::services::project_sync::release_project_session;

    use super::source_refresh::refresh_mod_root_sources;
    use super::*;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::models::{CsvRowPatch, CsvRowPatchAction, CsvSearchField, CsvTableKey};
    #[cfg(test)]
    use crate::services::project::query::csv_window::query_csv_table_window;
    use crate::services::project::refresh_project_sources;
    #[cfg(test)]
    use crate::services::project::sources;
    #[cfg(test)]
    use crate::services::project::sources::json_documents::take_load_counts;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::test_support;
    #[cfg(test)]
    use crate::test_support::file_formats::save_csv_patch;
    #[cfg(test)]
    use serde_json::{Map, Value, json};
    #[cfg(test)]
    use std::sync::{Arc, Barrier};
    #[cfg(test)]
    use std::{fs, thread};

    #[test]
    fn opened_sessions_remain_registered_until_explicit_close() {
        let root = project_workspace("session_explicit_close");
        let manifests = (0..40)
            .map(|_| {
                let mut trace = PerformanceTrace::new("project.openSession");
                open_project_session_traced(&root, None, &mut trace).unwrap()
            })
            .collect::<Vec<_>>();
        for manifest in &manifests {
            ensure_project_session_mod_root(&manifest.session_id, &manifest.mod_root).unwrap();
        }
        let handle = session_handle(&manifests[0].session_id).unwrap();
        for manifest in &manifests {
            release_project_session(&manifest.session_id).unwrap();
            assert!(session_handle(&manifest.session_id).is_err());
        }
        assert_eq!(
            lock_session(&handle).unwrap().manifest.session_id,
            manifests[0].session_id
        );
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_rejects_variant_missing_required_ids() {
        let root = project_workspace("variant_missing_ids");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/bad.variant"),
            r#"{"variantId":"bad"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        assert!(error.contains("bad.variant"));
        assert!(error.contains("hullId"));
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_rejects_corrupted_mod_info() {
        let root = project_workspace("mod_info_corrupted");
        write_utf8_no_bom(&root.join("mod_info.json"), "{").unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        assert!(error.contains("mod_info.json"));
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_rejects_corrupted_mission_list() {
        let root = project_workspace("mission_list_corrupted");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        // Long rows are tolerated now; a real defect must still fail session open.
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\n\"bad\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        assert!(error.contains("mission_list.csv"));
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_rejects_parent_dir_starsector_root() {
        let root = project_workspace("session_parent_dir_starsector_root");
        let escaped = root.literal_path("..");

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, Some(&escaped), &mut trace)
            .unwrap_err()
            .to_string();

        assert!(error.contains("invalid starsector root path"));
        root.close().unwrap();
    }

    #[test]
    fn session_mod_root_validation_rejects_wrong_root() {
        let left = project_workspace("session_mod_root_left");
        let right = project_workspace("session_mod_root_right");
        write_utf8_no_bom(&left.join("mod_info.json"), r#"{"id":"left"}"#).unwrap();
        write_utf8_no_bom(&right.join("mod_info.json"), r#"{"id":"right"}"#).unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&left, None, &mut trace).unwrap();

        ensure_project_session_mod_root(&manifest.session_id, &left.to_string_lossy()).unwrap();
        let error = ensure_project_session_mod_root(&manifest.session_id, &right.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = release_project_session(&manifest.session_id);
        assert!(error.contains("does not own mod root"));
        right.close().unwrap();
        left.close().unwrap();
    }

    #[test]
    fn open_project_session_manifest_summaries_only_include_public_csv_tables() {
        let root = project_workspace("manifest_public_csv_tables");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\ndemo\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let manifest_json = serde_json::to_value(&manifest).unwrap();

        assert_eq!(manifest.entity_summaries.missions, 1);
        assert!(
            !manifest_json["tableSummaries"]
                .as_object()
                .unwrap()
                .contains_key(MISSION_LIST_TABLE_KEY)
        );
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_manifest_counts_valid_table_entities() {
        let root = project_workspace("manifest_table_entity_counts");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/wing_data.csv"),
            "id,variant\r\nwing_a,var_a\r\n,\r\n#comment,\r\nwing_b,var_b\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/sim_opponents.csv"),
            "variant id\r\nvar_a\r\n\r\n#comment\r\nvar_b\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        assert_eq!(loaded.table_entity_summaries[&CsvTableKey::Wings], 2);
        assert_eq!(loaded.table_entity_summaries[&CsvTableKey::SimOpponents], 2);
        assert_eq!(
            loaded.table_summaries[&CsvTableKey::Wings].total_rows,
            Some(4)
        );
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_variant_id() {
        let root = project_workspace("variant_duplicate_id");
        fs::create_dir_all(root.join("data/variants/a")).unwrap();
        fs::create_dir_all(root.join("data/variants/b")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/a/one.variant"),
            r#"{"variantId":"dup","hullId":"hull_a"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/b/two.variant"),
            r#"{"variantId":"dup","hullId":"hull_b"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        assert_eq!(loaded.entity_summaries.variants, 1);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|warning| warning.message.contains("重复 variantId dup")
                    && warning.path.contains("two.variant"))
        );
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_accepts_partial_skin() {
        let root = project_workspace("skin_missing_ids");
        fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/bad.skin"),
            r#"{"skinHullId":"bad"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        assert_eq!(manifest.entity_summaries.skins, 1);
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn specification_stages_report_each_loaded_family_and_keep_single_source_reads() {
        let root = project_workspace("specification_stages");
        let files = [
            (
                "data/hulls/sample.ship",
                r#"{"hullId":"sample"}"#,
                "spec_ships",
            ),
            (
                "data/weapons/sample.wpn",
                r#"{"id":"sample"}"#,
                "spec_weapons",
            ),
            (
                "data/shipsystems/sample.system",
                r#"{"id":"sample"}"#,
                "spec_systems",
            ),
            (
                "data/characters/skills/sample.skill",
                r#"{"id":"sample"}"#,
                "spec_skills",
            ),
            (
                "data/variants/sample.variant",
                r#"{"variantId":"sample","hullId":"sample"}"#,
                "spec_variants",
            ),
            (
                "data/hulls/skins/sample.skin",
                r#"{"skinHullId":"sample"}"#,
                "spec_skins",
            ),
            (
                "data/weapons/proj/sample.proj",
                r#"{"id":"sample"}"#,
                "spec_projectiles",
            ),
        ];
        for (relative, content, _) in &files {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        let mut trace = PerformanceTrace::new("specification.stages");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let entries = trace.log_entries(&[]);
        for (relative, _, stage) in files {
            let entry = entries.iter().find(|entry| entry.stage == stage).unwrap();
            assert_eq!(entry.fields, vec![("files".into(), "1".into())]);
            assert_eq!(work_counts::count("read", &root.join(relative)), 1);
            assert_eq!(work_counts::count("parse", &root.join(relative)), 1);
        }
        let core = entries
            .iter()
            .find(|entry| entry.stage == "spec_core_projectiles")
            .unwrap();
        assert_eq!(core.fields, vec![("files".into(), "0".into())]);
        let bundle = entries
            .iter()
            .find(|entry| entry.stage == "spec_bundle")
            .unwrap();
        assert_eq!(bundle.fields, vec![("files".into(), "7".into())]);
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_skin_hull_id() {
        let root = project_workspace("skin_duplicate_id");
        fs::create_dir_all(root.join("data/hulls/skins/a")).unwrap();
        fs::create_dir_all(root.join("data/hulls/skins/b")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/a/one.skin"),
            r#"{"skinHullId":"dup","baseHullId":"hull_a"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/b/two.skin"),
            r#"{"skinHullId":"dup","baseHullId":"hull_b"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        assert_eq!(loaded.entity_summaries.skins, 1);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|warning| warning.message.contains("重复 skinHullId dup")
                    && warning.path.contains("two.skin"))
        );
        root.close().unwrap();
    }

    #[test]
    fn persistent_project_index_reuses_matching_sources_and_rebuilds_changed_sources() {
        if test_support::isolated_test() {
            return;
        }

        let root = project_workspace("persistent_project_index");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"before","hullId":"hull"}"#,
        )
        .unwrap();
        fs::write(
            root.join("data/variants/duplicate.variant"),
            r#"{"variantId":"before","hullId":"hull"}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        for name in ["first", "second"] {
            fs::write(
                root.join(format!("data/hulls/skins/{name}.skin")),
                r#"{"skinHullId":"skin","baseHullId":"hull"}"#,
            )
            .unwrap();
        }
        sources::configure_persistent_index_cache(&root.outer().join("cache")).unwrap();

        let mut initial_trace = PerformanceTrace::new("project.openSession");
        take_load_counts();
        let initial = build_project_session(&root, None, &mut initial_trace).unwrap();
        source_versions::persist_session_sources(&initial).unwrap();
        assert_eq!(take_load_counts(), (1, 1));
        let mut cached_trace = PerformanceTrace::new("project.openSession");
        let cached = build_project_session(&root, None, &mut cached_trace).unwrap();
        take_load_counts();
        assert_eq!(cached.variant_warnings.len(), 1);
        assert_eq!(cached.skin_warnings.len(), 1);
        assert_eq!(cached.manifest.warnings.len(), 2);

        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"after","hullId":"hull"}"#,
        )
        .unwrap();
        let mut changed_trace = PerformanceTrace::new("project.openSession");
        let changed = build_project_session(&root, None, &mut changed_trace).unwrap();
        assert_eq!(take_load_counts(), (1, 1));
        assert!(changed.variant_warnings.is_empty());
        assert_eq!(changed.skin_warnings.len(), 1);

        assert!(
            cached
                .variant_files
                .iter()
                .any(|file| file.variant_id == "before")
        );
        assert!(
            changed
                .variant_files
                .iter()
                .any(|file| file.variant_id == "after")
        );
        assert!(cached_trace.log_entries(&[]).iter().any(|entry| {
            entry.stage == "source_records"
                && entry
                    .fields
                    .iter()
                    .any(|(key, value)| key == "result" && value == "reused")
        }));
        assert_eq!(changed.variant_files.len(), 2);
        root.close().unwrap();
    }

    #[test]
    fn concurrent_threads_on_separate_sessions_run_without_blocking_or_corruption() {
        const THREADS: usize = 4;
        const ROUNDS: usize = 4;
        const SESSIONS: usize = 2;
        const WRITES_PER_SESSION: usize = THREADS * ROUNDS / SESSIONS;

        let roots: Vec<_> = (0..SESSIONS)
            .map(|index| {
                let root = project_workspace(&format!("session_concurrency_{index}"));
                fs::create_dir_all(root.join("data/hulls")).unwrap();
                write_utf8_no_bom(
                    &root.join("data/hulls/ship_data.csv"),
                    "id,name\r\nbase_ship,Base Ship\r\n",
                )
                .unwrap();
                root
            })
            .collect();
        let session_ids: Vec<String> = roots
            .iter()
            .map(|root| {
                let mut trace = PerformanceTrace::new("project.openSession");
                open_project_session_traced(root, None, &mut trace)
                    .unwrap()
                    .session_id
            })
            .collect();

        let barrier = Arc::new(Barrier::new(THREADS));
        let mut handles = Vec::new();
        for thread_index in 0..THREADS {
            let barrier = barrier.clone();
            let session_id = session_ids[thread_index % SESSIONS].clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                for round in 0..ROUNDS {
                    let window = query_csv_table_window(
                        &session_id,
                        CsvTableKey::Ships,
                        0,
                        200,
                        None,
                        CsvSearchField::IdName,
                    )
                    .unwrap();
                    assert!(window.total_rows >= 1);
                    let mut row = Map::new();
                    row.insert(
                        "id".to_string(),
                        Value::String(format!("thread_{thread_index}_row_{round}")),
                    );
                    row.insert("name".to_string(), Value::String("Concurrent".to_string()));
                    save_csv_patch(
                        &session_id,
                        CsvTableKey::Ships,
                        vec![CsvRowPatch {
                            columns: (row).keys().cloned().collect(),
                            comment_changed: true,

                            is_comment: false,
                            insert_at: None,
                            row_key: format!("ships:new:{thread_index}-{round}"),
                            action: CsvRowPatchAction::Upsert,
                            row,
                        }],
                        Vec::new(),
                    )
                    .unwrap();
                    invalidate_project_session(&session_id, &Vec::new()).unwrap();
                }
            }));
        }
        let outcomes = handles
            .into_iter()
            .map(|handle| handle.join())
            .collect::<Vec<_>>();
        for outcome in outcomes {
            outcome.unwrap();
        }

        for (session_index, session_id) in session_ids.iter().enumerate() {
            let window = query_csv_table_window(
                session_id,
                CsvTableKey::Ships,
                0,
                200,
                None,
                CsvSearchField::IdName,
            )
            .unwrap();
            assert_eq!(window.total_rows, 1 + WRITES_PER_SESSION);
            release_project_session(session_id).unwrap();
            roots[session_index].clone().close().unwrap();
        }
    }

    #[test]
    fn session_open_keeps_business_credentials_and_defers_graphics_reads() {
        let root = project_workspace("startup_credentials");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("graphics")).unwrap();
        let ship = root.join("data/hulls/item.ship");
        let image = root.join("graphics/image.png");
        fs::write(&ship, r#"{"hullId":"item"}"#).unwrap();
        fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name\nitem,Item\n",
        )
        .unwrap();
        fs::write(&image, b"resource").unwrap();
        for value in [1, 2] {
            let manifest = open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("startup.credentials"),
            )
            .unwrap();
            let target =
                services::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "item")
                    .unwrap();
            assert!(
                target
                    .base_versions
                    .iter()
                    .all(|version| version.fingerprint.is_some())
            );
            io::verify_versions(&manifest.mod_root, &target.base_versions).unwrap();
            fs::write(&ship, json!({"hullId":"item", "value":value}).to_string()).unwrap();
            assert!(io::verify_versions(&manifest.mod_root, &target.base_versions).is_err());
            assert_eq!(work_counts::count("read", &image), 0);
            assert_eq!(work_counts::count("walk", &root.join("graphics")), 0);
            release_project_session(&manifest.session_id).unwrap();
        }
        root.close().unwrap();
    }

    #[test]
    fn resource_events_accept_untracked_image_and_directory_removals() {
        for relative in ["graphics/image.png", "graphics"] {
            let root = project_workspace("resource_removal");
            fs::create_dir_all(root.join("graphics")).unwrap();
            fs::write(root.join("graphics/image.png"), b"resource").unwrap();
            let manifest = open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("resource.removal"),
            )
            .unwrap();
            let path = root.join(relative);
            if path.is_dir() {
                fs::remove_dir_all(&path).unwrap();
            } else {
                fs::remove_file(&path).unwrap();
            }
            for expected in [1, 0] {
                let result = refresh_mod_root_sources(
                    &manifest.mod_root,
                    slice::from_ref(&manifest.session_id),
                    &[path.to_string_lossy().into_owned()],
                    false,
                )
                .unwrap();
                assert_eq!(result.session_updates.len(), expected);
                assert_eq!(result.invalidation.resources.len(), expected);
                assert!(result.invalidation.tables.is_empty());
                assert!(result.invalidation.entities.is_empty());
            }
            release_project_session(&manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn core_refresh_scopes_image_and_spec_updates_without_whole_session_invalidation() {
        let root = project_workspace("core_precise_refresh");
        let local = root.join("mod");
        fs::create_dir_all(&local).unwrap();
        fs::create_dir_all(root.join("starsector-core/graphics")).unwrap();
        let manifest = open_project_session_traced(
            &local,
            Some(&root),
            &mut PerformanceTrace::new("core.precise"),
        )
        .unwrap();
        let update = refresh_core_session(
            &manifest.session_id,
            &[InvalidatedResourceScope {
                source: ResourceSource::Core,
                rel_path: "graphics/image.png".into(),
            }],
        )
        .unwrap();
        assert!(!update.invalidation.session);
        assert!(update.invalidation.tables.is_empty());
        assert!(update.invalidation.entities.is_empty());
        let update = refresh_core_session(
            &manifest.session_id,
            &[InvalidatedResourceScope {
                source: ResourceSource::Core,
                rel_path: "data/hulls/item.ship".into(),
            }],
        )
        .unwrap();
        assert!(!update.invalidation.session);
        assert!(
            update
                .invalidation
                .entities
                .iter()
                .any(|entity| entity.kind == EntityKind::Ship)
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_rescan_reuses_unchanged_content_and_reads_each_source_once() {
        let root = project_workspace("rescan_unchanged");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("graphics")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        fs::write(&csv, "id,name\nship,Initial\n").unwrap();
        fs::write(root.join("graphics/image.png"), b"resource").unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("rescan.unchanged"),
        )
        .unwrap();
        services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
            &[],
        )
        .unwrap();
        let handle = session_handle(&manifest.session_id).unwrap();
        let rows = lock_ready_session(&handle).unwrap().csv_tables["ships"]
            .rows
            .clone()
            .unwrap();
        let baseline = refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[],
            true,
        )
        .unwrap();
        assert!(baseline.invalidation.tables.is_empty());
        assert!(
            baseline
                .invalidation
                .resources
                .iter()
                .any(|scope| scope.rel_path == "graphics")
        );
        let reads = work_counts::count("read", &csv);
        let parses = work_counts::count("parse", &csv);
        for _ in 0..3 {
            let result = refresh_mod_root_sources(
                &manifest.mod_root,
                slice::from_ref(&manifest.session_id),
                &[],
                true,
            )
            .unwrap();
            assert!(result.session_updates.is_empty());
            assert!(Arc::ptr_eq(
                &rows,
                lock_ready_session(&handle).unwrap().csv_tables["ships"]
                    .rows
                    .as_ref()
                    .unwrap()
            ));
        }
        assert_eq!(work_counts::count("read", &csv) - reads, 0);
        assert_eq!(work_counts::count("parse", &csv) - parses, 0);
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn csv_source_refresh_reuses_formal_specs_without_reading_their_bytes() {
        let root = project_workspace("csv_retained_specs");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        let spec = root.join("data/hulls/ship.ship");
        fs::write(&csv, "id,name\nship,Initial\n").unwrap();
        fs::write(&spec, r#"{"hullId":"ship","hullName":"Formal"}"#).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("csv.retained"))
                .unwrap();
        let reads = work_counts::count("read", &spec);
        let parses = work_counts::count("parse", &spec);
        let handle = session_handle(&manifest.session_id).unwrap();
        let specs = lock_ready_session(&handle).unwrap().ship_files.clone();
        fs::write(&csv, "id,name\nship,Updated\n").unwrap();
        let result = refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[csv.to_string_lossy().into_owned()],
            false,
        )
        .unwrap();
        assert_eq!(result.session_updates.len(), 1);
        assert_eq!(work_counts::count("read", &spec), reads);
        assert_eq!(work_counts::count("parse", &spec), parses);
        assert!(Arc::ptr_eq(
            &specs,
            &lock_ready_session(&handle).unwrap().ship_files
        ));
        assert_eq!(
            services::query_entity(&manifest.session_id, EntityKind::Ship, "ship")
                .unwrap()
                .unwrap()
                .data["hullName"],
            "Formal"
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_rescan_accepts_changed_files_and_preserves_missing_resource_versions() {
        let root = project_workspace("rescan_differences");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("graphics")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        let image = root.join("graphics/image.png");
        fs::write(&csv, "id,name\nship,Initial\n").unwrap();
        fs::write(&image, b"resource").unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("rescan.differences"),
        )
        .unwrap();
        refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[image.to_string_lossy().into_owned()],
            false,
        )
        .unwrap();
        fs::write(&csv, "id,name\nship,Updated\n").unwrap();
        fs::remove_file(&image).unwrap();
        let result = refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[],
            true,
        )
        .unwrap();
        assert_eq!(result.session_updates.len(), 1);
        assert!(
            result
                .invalidation
                .resources
                .iter()
                .any(|scope| scope.rel_path == "graphics")
        );
        assert!(
            !lock_ready_session(&session_handle(&manifest.session_id).unwrap())
                .unwrap()
                .source_versions
                .contains_key("graphics/image.png")
        );
        assert_eq!(work_counts::count("read", &image), 0);
        let handle = session_handle(&manifest.session_id).unwrap();
        let session = lock_ready_session(&handle).unwrap();
        let scopes = session.source_scopes.keys().cloned().collect::<Vec<_>>();
        let stamps = session.source_stamps.clone();
        drop(session);
        let repeated = refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[],
            true,
        )
        .unwrap();
        assert!(
            repeated.session_updates.is_empty(),
            "repeated resource scopes: {:?}, scopes: {:?}, stamps: {:?}",
            repeated
                .invalidation
                .resources
                .iter()
                .map(|scope| &scope.rel_path)
                .collect::<Vec<_>>(),
            scopes,
            stamps,
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_watch_review_deleted_parent_directory_updates_loaded_csv_availability() {
        let root = project_workspace("review_deleted_parent");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name\nreview,Original\n",
        )
        .unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("review.delete"))
                .unwrap();
        let original = services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
            &[],
        )
        .unwrap();
        fs::remove_dir_all(root.join("data/hulls")).unwrap();
        let updated = refresh_mod_root_sources(
            &manifest.mod_root,
            slice::from_ref(&manifest.session_id),
            &[root.join("data/hulls").to_string_lossy().into_owned()],
            false,
        )
        .unwrap();
        let available = current_project_manifest(&manifest.session_id)
            .unwrap()
            .table_summaries[&CsvTableKey::Ships]
            .available;
        let retained = services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
            &[],
        )
        .unwrap();
        let observations = (
            available,
            updated.session_updates.len(),
            retained.rows[0].row_key == original.rows[0].row_key,
            retained.base_versions[0].fingerprint.is_none(),
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
        assert_eq!(observations, (false, 1, true, true));
    }

    #[test]
    fn watched_refresh_is_atomic_across_sessions_and_reuses_one_source_read() {
        let root = project_workspace("watched_atomic");
        fs::write(
            root.join("mod_info.json"),
            r#"{"id":"atomic","name":"Atomic"}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        fs::write(&path, "id,name\nrecord,Original\n").unwrap();
        let first =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("atomic.first"))
                .unwrap();
        let second =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("atomic.second"))
                .unwrap();
        let ids = vec![first.session_id.clone(), second.session_id];
        for id in &ids {
            services::query_csv_table_index(
                id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
        }
        let descriptor = root.join("mod_info.json");
        let original = fs::read_to_string(&descriptor).unwrap();
        fs::write(&descriptor, "{").unwrap();
        fs::write(&path, "id,name\nrecord,Changed\n").unwrap();
        let paths = vec![
            path.to_string_lossy().into_owned(),
            descriptor.to_string_lossy().into_owned(),
        ];
        assert!(refresh_mod_root_sources(&first.mod_root, &ids, &paths, false).is_err());
        for id in &ids {
            let index = services::query_csv_table_index(
                id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
            assert_eq!(index.rows[0].data["name"], "Original");
        }
        fs::write(&descriptor, original).unwrap();
        let reads = work_counts::count("read", &path);
        let parses = work_counts::count("parse", &path);
        fs::create_dir_all(root.join("data/hulls-extra")).unwrap();
        let directory_paths = vec![
            root.join("data/hulls").to_string_lossy().into_owned(),
            root.join("data/hulls-extra").to_string_lossy().into_owned(),
            paths[0].clone(),
        ];
        let refreshed =
            refresh_mod_root_sources(&first.mod_root, &ids, &directory_paths, false).unwrap();
        assert_eq!(refreshed.session_updates.len(), 2);
        assert_eq!(work_counts::count("read", &path) - reads, 1);
        assert_eq!(work_counts::count("parse", &path) - parses, 1);
        for id in ids {
            assert_eq!(
                services::query_csv_table_index(
                    &id,
                    CsvTableKey::Ships,
                    1,
                    None,
                    CsvSearchField::IdName,
                    &[]
                )
                .unwrap()
                .rows[0]
                    .data["name"],
                "Changed"
            );
            release_project_session(&id).unwrap();
        }
        root.close().unwrap();
    }
    #[test]
    fn directory_refresh_compares_created_renamed_deleted_and_unchanged_sources() {
        let root = project_workspace("directory_source_versions");
        let directory = root.join("data/hulls");
        fs::create_dir_all(&directory).unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("directory.versions"),
        )
        .unwrap();
        let ids = slice::from_ref(&manifest.session_id);
        let paths = vec![directory.to_string_lossy().into_owned()];
        for (before, after, count) in [
            (None, Some("created.ship"), 1),
            (Some("created.ship"), Some("renamed.ship"), 1),
            (Some("renamed.ship"), None, 0),
        ] {
            if let Some(before) = before {
                if let Some(after) = after {
                    fs::rename(directory.join(before), directory.join(after)).unwrap();
                } else {
                    fs::remove_file(directory.join(before)).unwrap();
                }
            } else {
                fs::write(
                    directory.join(after.expect("created source")),
                    r#"{"hullId":"record"}"#,
                )
                .unwrap();
            }
            let refreshed =
                refresh_mod_root_sources(&manifest.mod_root, ids, &paths, false).unwrap();
            assert_eq!(refreshed.session_updates.len(), 1);
            assert_eq!(
                refreshed.session_updates[0]
                    .content
                    .manifest
                    .entity_summaries
                    .ships,
                count
            );
            let file = directory.join(after.unwrap_or("renamed.ship"));
            let reads = work_counts::count("read", &file);
            let parses = work_counts::count("parse", &file);
            for requested in [&paths[..], &[file.to_string_lossy().into_owned()]] {
                let repeated =
                    refresh_mod_root_sources(&manifest.mod_root, ids, requested, false).unwrap();
                assert!(repeated.session_updates.is_empty());
            }
            assert_eq!(
                work_counts::count("read", &file) - reads,
                usize::from(after.is_some()) * 2
            );
            assert_eq!(work_counts::count("parse", &file), parses);
        }
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn deleted_loaded_csv_keeps_recovery_rows_for_file_and_directory_scopes() {
        for scope in ["data/hulls/ship_data.csv", "data/hulls", "data"] {
            let root = project_workspace("watched_missing_csv");
            fs::create_dir_all(root.join("data/hulls")).unwrap();
            let path = root.join("data/hulls/ship_data.csv");
            fs::write(&path, "id,name\nrecord,Retained\n").unwrap();
            let manifest = open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("missing.loaded"),
            )
            .unwrap();
            let original = services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
            fs::remove_file(&path).unwrap();
            let result = refresh_mod_root_sources(
                &manifest.mod_root,
                slice::from_ref(&manifest.session_id),
                &[root.join(scope).to_string_lossy().into_owned()],
                false,
            )
            .unwrap();
            assert!(
                !result.session_updates[0].content.manifest.table_summaries[&CsvTableKey::Ships]
                    .available
            );
            let retained = services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
            assert_eq!(retained.rows[0].data, original.rows[0].data);
            assert_eq!(retained.rows[0].row_key, original.rows[0].row_key);
            assert!(retained.base_versions[0].fingerprint.is_none());
            release_project_session(&manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn missing_unloaded_csv_reports_its_unavailable_recovery_source() {
        let root = project_workspace("missing_unloaded_csv");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        let original = "id,name\na,Original\nb,Other\n";
        fs::write(&path, original).unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("missing.unloaded"),
        )
        .unwrap();
        invalidate_project_session(
            &manifest.session_id,
            &[io::build_text_change(&path, Some(original.into())).unwrap()],
        )
        .unwrap();
        fs::remove_file(&path).unwrap();
        let handle = session_handle(&manifest.session_id).unwrap();
        let mut state = lock_ready_session(&handle).unwrap();
        let table = csv_tables::session_table_mut(&mut state, "ships").unwrap();
        table.rows = None;
        table.source = None;
        drop(state);
        let error = services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
            &[],
        )
        .unwrap_err();
        assert_eq!(error.code(), "write.recovery_content_missing");
        assert!(
            error
                .location()
                .unwrap()
                .path
                .as_ref()
                .unwrap()
                .ends_with("ship_data.csv")
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }
    #[test]
    fn refresh_keeps_rows_and_rejects_escape() {
        let root = project_workspace("source_refresh");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        io::write_utf8_no_bom(&csv, "id,name\nship,Before\n").unwrap();
        io::write_utf8_no_bom(&root.join("data/hulls/ship.ship"), r#"{"hullId":"ship"}"#).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("test")).unwrap();
        let handle = session_handle(&manifest.session_id).unwrap();
        csv_tables::ensure_registered_table_rows(
            &mut lock_session(&handle).unwrap(),
            CsvTableKey::Ships,
        )
        .unwrap();
        let key = lock_session(&handle).unwrap().csv_tables["ships"]
            .rows
            .as_ref()
            .unwrap()[0]
            .row_key
            .clone();
        io::write_utf8_no_bom(&csv, "id,name\nship,After\nadded,New\n").unwrap();
        let source = InvalidatedResourceScope {
            source: ResourceSource::Mod,
            rel_path: "data/hulls".into(),
        };
        io::write_utf8_no_bom(&root.join("data/hulls/added.ship"), r#"{"hullId":"added"}"#)
            .unwrap();
        refresh_project_sources(&manifest.session_id, vec![source]).unwrap();
        let added =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "added")
                .unwrap();
        assert!(
            added
                .base_versions
                .iter()
                .all(|version| version.fingerprint.is_some())
        );
        let session = lock_session(&handle).unwrap();
        let rows = session.csv_tables["ships"].rows.as_ref().unwrap();
        assert_eq!(rows[0].row_key, key);
        assert_eq!(rows[0].data["name"], "After");
        assert_ne!(rows[1].row_key, key);
        drop(session);
        let invalid = InvalidatedResourceScope {
            source: ResourceSource::Mod,
            rel_path: "../outside".into(),
        };
        assert!(refresh_project_sources(&manifest.session_id, vec![invalid]).is_err());
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
