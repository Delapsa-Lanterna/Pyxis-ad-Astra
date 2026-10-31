#[cfg(test)]
use super::test_support::project_workspace;
mod access;
pub(super) mod references;
mod registry;
pub(in crate::services::project) mod source_projection;
use crate::services::project::sources::json_documents::{
    load_skin_files_from, load_variant_files_from,
};
pub(crate) use access::lock_ready_session;
pub(super) use registry::{RegisteredSession, lock_registry};
pub(crate) use registry::{lock_session, session_handle};
use std::sync::{RwLock, RwLockWriteGuard, atomic::AtomicBool};
static OPENINGS: RwLock<()> = RwLock::new(());
static OPENINGS_HELD: AtomicBool = AtomicBool::new(false);
pub struct SessionOpeningPause {
    _guard: RwLockWriteGuard<'static, ()>,
}
impl Drop for SessionOpeningPause {
    fn drop(&mut self) {
        OPENINGS_HELD.store(false, Ordering::Release);
    }
}
pub fn hold_session_openings() -> AppResult<SessionOpeningPause> {
    OPENINGS_HELD.store(true, Ordering::Release);
    match OPENINGS.write() {
        Ok(guard) => Ok(SessionOpeningPause { _guard: guard }),
        Err(_) => {
            OPENINGS_HELD.store(false, Ordering::Release);
            Err(AppError::message(
                "session.opening_poisoned",
                "会话建立状态不可用",
            ))
        }
    }
}
pub fn registered_session_ids() -> AppResult<Vec<String>> {
    Ok(lock_registry()?.keys().cloned().collect())
}
use super::model::{
    MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvTable, SpecBundle,
};
use super::{
    cache,
    definitions::{factions, projectiles, table_definitions},
    performance::PerformanceTrace,
    sources,
};
use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
    models::{EntitySummaries, ProjectManifest, TableSummary},
    models::{FileChangeRecord, ProjectInvalidation, ProjectSessionInvalidationResult},
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex},
};

pub fn close_project_session(session_id: String) -> AppResult<()> {
    let removed = lock_registry()?.remove(&session_id);
    if let Some(registered) = removed {
        let root = registered.root;
        let same_root = lock_registry()?
            .values()
            .any(|registered| registered.root == root);
        if !same_root {
            crate::services::file_history::release_history(&root)?;
        }
    }
    cache::clear_sprite_media_for_session(&session_id);
    references::reference_sources_changed(Some(&session_id))?;
    Ok(())
}

pub fn ensure_project_session_mod_root(session_id: &str, mod_root: &str) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let expected_root = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "mod root")?;
    let actual_root = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    if expected_root.root() != actual_root.root() {
        return Err(AppError::message(
            "session.mod_root_mismatch",
            format!("project session {session_id} does not own mod root: {mod_root}"),
        ));
    }
    Ok(())
}

pub fn invalidate_project_session(
    session_id: &str,
    changes: Vec<FileChangeRecord>,
) -> AppResult<ProjectSessionInvalidationResult> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    let mut invalidation = ProjectInvalidation::default();
    invalidation.merge(super::invalidation::invalidate_session_changes(
        &mut session,
        &changes,
    )?);
    session.manifest.base_versions =
        vec![super::versions::version_for_path(&session, "mod_info.json")];
    session.projection_pending = false;
    Ok(ProjectSessionInvalidationResult {
        manifest: session.manifest.clone(),
        invalidation,
    })
}

pub fn invalidate_core_cache(starsector_root: &str) -> AppResult<()> {
    crate::services::project::sources::core::invalidate_core_cache(starsector_root)
}

pub(crate) fn affected_session_ids(
    changes: &[FileChangeRecord],
) -> AppResult<Vec<(String, String)>> {
    let mut affected = Vec::new();
    for (session_id, registered) in lock_registry()?.iter() {
        let root_key = crate::models::windows_path_key(&registered.root);
        if changes.iter().any(|change| {
            [&change.before_path, &change.after_path]
                .iter()
                .any(|path| {
                    let key = crate::models::windows_path_key(path);
                    key == root_key || key.starts_with(&format!("{root_key}/"))
                })
        }) {
            affected.push((session_id.clone(), registered.root.clone()));
        }
    }
    Ok(affected)
}

pub(crate) fn mark_projection_pending(session_id: &str) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    lock_session(&handle)?.projection_pending = true;
    Ok(())
}

pub(crate) fn current_projection(session_id: &str) -> AppResult<ProjectSessionInvalidationResult> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    Ok(ProjectSessionInvalidationResult {
        manifest: session.manifest.clone(),
        invalidation: ProjectInvalidation::default(),
    })
}

pub(crate) fn open_project_session_traced(
    mod_root: &Path,
    starsector_root_override: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectManifest> {
    if OPENINGS_HELD.load(Ordering::Acquire) {
        return Err(AppError::message(
            "session.application_closing",
            "应用正在关闭",
        ));
    }
    let _opening = OPENINGS
        .read()
        .map_err(|_| AppError::message("session.opening_poisoned", "会话建立状态不可用"))?;
    if OPENINGS_HELD.load(Ordering::Acquire) {
        return Err(AppError::message(
            "session.application_closing",
            "应用正在关闭",
        ));
    }
    let session = build_project_session(mod_root, starsector_root_override, trace)?;
    let manifest = session.manifest.clone();
    let mut guard = lock_registry()?;
    guard.insert(
        manifest.session_id.clone(),
        RegisteredSession {
            session_id: manifest.session_id.clone(),
            root: manifest.mod_root.clone(),
            handle: Arc::new(Mutex::new(session)),
            reference: None,
        },
    );
    drop(guard);
    // Open concentrated cold loads of core assets; persist them once here so
    // the dump never runs inside a query.
    if let Some(root) = &manifest.starsector_root
        && let Err(error) = crate::services::project::sources::core::flush_core_cache(root)
    {
        crate::diagnostics::record(format!("core cache flush failed: {error}"));
    }
    Ok(manifest)
}

pub(super) fn build_project_session(
    mod_root: &Path,
    starsector_root_override: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectSession> {
    let mod_root_boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let mod_root = mod_root_boundary.root();
    let _lease = crate::io::acquire_root_write_lock(mod_root)?;
    let source_timer = trace.timer();
    let mut sources = super::sources::SourceReader::new(mod_root)?;
    let session_id = new_session_id();
    let starsector_root = starsector_root_override.map(Path::to_path_buf);
    let starsector_root = starsector_root
        .as_deref()
        .map(|root| {
            FsRootBoundary::new(root, "starsector root")
                .map(|boundary| boundary.root().to_path_buf())
        })
        .transpose()?;
    let core_available = starsector_root
        .as_ref()
        .is_some_and(|root| root.join("starsector-core").exists());
    let content = load_project_content(&mut sources, starsector_root.as_deref(), trace)?;
    source_projection::capture_project_versions(&mut sources)?;
    trace.record_stage("source_records", source_timer, || {
        vec![(
            "result",
            if sources.reused() { "reused" } else { "parsed" }.to_string(),
        )]
    });
    sources.flush();
    let source_versions = sources.versions;
    let mut csv_tables = build_registered_session_csv_tables();
    for (path, csv) in sources.tables {
        if let Some((key, state)) = csv_tables.iter_mut().find(|(_, table)| table.path == path) {
            state.header = csv.header;
            state.rows = Some(
                csv.rows
                    .into_iter()
                    .enumerate()
                    .map(|(index, row)| super::model::SessionCsvRow {
                        row_key: format!("{key}:row:{index}"),
                        data: row.data,
                        is_comment: row.is_comment,
                    })
                    .collect::<Vec<_>>()
                    .into(),
            );
            state.next_row_seq = state.rows.as_ref().expect("loaded rows").len() as u64;
        }
    }
    let super::model::ProjectContent {
        mod_info,
        faction_files,
        faction_blueprint_tags,
        mission_count,
        spec_bundle,
        table_entity_summaries,
    } = content;
    let table_summaries = super::definitions::table_definitions::csv_table_definitions()
        .iter()
        .map(|definition| {
            let table = csv_tables
                .get(definition.spec.key.as_str())
                .ok_or_else(|| {
                    AppError::message(
                        "table.unknown",
                        format!(
                            "missing registered CSV table: {}",
                            definition.spec.key.as_str()
                        ),
                    )
                })?;
            Ok((
                definition.spec.key,
                TableSummary {
                    path: table.path.clone(),
                    header: table.header.clone(),
                    available: mod_root.join(&table.path).exists(),
                    total_rows: None,
                },
            ))
        })
        .collect::<AppResult<BTreeMap<_, _>>>()?;
    let entity_summaries = EntitySummaries {
        factions: faction_files.len(),
        missions: mission_count,
        ships: spec_bundle.ship_files.len(),
        weapons: spec_bundle.weapon_specs.len(),
        projectiles: spec_bundle.projectile_specs.len(),
        variants: spec_bundle.variant_files.len(),
        skins: spec_bundle.skin_files.len(),
        systems: spec_bundle.system_files.len(),
        skills: spec_bundle.skill_files.len(),
    };
    let manifest = ProjectManifest {
        base_versions: vec![source_versions["mod_info.json"].clone()],
        session_id,
        mod_root: mod_root.to_string_lossy().to_string(),
        starsector_root: starsector_root.map(|path| path.to_string_lossy().to_string()),
        core_available,
        associated_spec_tables: super::definitions::entity_definitions::associated_spec_tables(),
        mod_info,
        table_summaries,
        table_entity_summaries,
        entity_summaries,
        warnings: spec_bundle
            .variant_warnings
            .iter()
            .chain(&spec_bundle.skin_warnings)
            .cloned()
            .collect(),
    };
    Ok(ProjectSession {
        reference_revision: 0,
        references: Vec::new(),
        loaded_edit_targets: Vec::new(),
        projection_pending: false,
        source_versions: source_versions.into(),
        manifest,
        faction_files: faction_files.into(),
        faction_blueprint_tags,
        csv_tables: csv_tables
            .into_iter()
            .map(|(key, table)| (key, Arc::new(table)))
            .collect(),
        ship_files: spec_bundle.ship_files.into(),
        variant_files: spec_bundle.variant_files.into(),
        skin_files: spec_bundle.skin_files.into(),
        variant_warnings: spec_bundle.variant_warnings,
        skin_warnings: spec_bundle.skin_warnings,
        weapon_specs: spec_bundle.weapon_specs.into(),
        projectile_specs: spec_bundle.projectile_specs.into(),
        system_files: spec_bundle.system_files.into(),
        skill_files: spec_bundle.skill_files.into(),
    })
}

fn load_project_content(
    sources: &mut super::sources::SourceReader,
    starsector_root: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<super::model::ProjectContent> {
    let timer = trace.timer();
    let mod_root = sources.root().to_path_buf();
    let info_path = sources.path("mod_info.json")?;
    let mod_info = info_path
        .exists()
        .then(|| sources.json(&info_path))
        .transpose()?;
    trace.record_stage("mod_info", timer, || {
        vec![(
            "path",
            mod_root.join("mod_info.json").to_string_lossy().to_string(),
        )]
    });
    let timer = trace.timer();
    let faction_files = factions::load_faction_files_from(sources)?;
    let faction_blueprint_tags = factions::faction_blueprint_tags(&faction_files);
    trace.record_stage("factions", timer, || {
        vec![
            ("factionFiles", faction_files.len().to_string()),
            ("tags", faction_blueprint_tags.len().to_string()),
        ]
    });
    let timer = trace.timer();
    let mission_count =
        sources.count(&sources.path("data/missions/mission_list.csv")?, "mission")?;
    trace.record_stage("mission_count", timer, || {
        vec![("missions", mission_count.to_string())]
    });
    let spec_bundle = load_spec_bundle(sources, starsector_root, trace)?;
    let entity_summaries = EntitySummaries {
        factions: faction_files.len(),
        missions: mission_count,
        ships: spec_bundle.ship_files.len(),
        weapons: spec_bundle.weapon_specs.len(),
        projectiles: spec_bundle.projectile_specs.len(),
        variants: spec_bundle.variant_files.len(),
        skins: spec_bundle.skin_files.len(),
        systems: spec_bundle.system_files.len(),
        skills: spec_bundle.skill_files.len(),
    };
    let table_entity_summaries =
        table_definitions::build_table_entity_summaries_from(sources, &entity_summaries)?;
    let content = super::model::ProjectContent {
        mod_info,
        faction_files,
        faction_blueprint_tags,
        mission_count,
        spec_bundle,
        table_entity_summaries,
    };
    Ok(content)
}

pub(super) fn build_registered_session_csv_tables() -> BTreeMap<String, SessionCsvTable> {
    let mut tables: BTreeMap<String, SessionCsvTable> =
        super::definitions::table_definitions::csv_table_definitions()
            .iter()
            .map(|definition| {
                (
                    definition.spec.key.as_str().to_string(),
                    SessionCsvTable {
                        row_index: None,
                        header: Vec::new(),
                        path: definition.spec.rel_path.to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                )
            })
            .collect();
    tables.insert(
        MISSION_LIST_TABLE_KEY.to_string(),
        SessionCsvTable {
            row_index: None,
            header: super::model::mission_list_default_header(),
            path: MISSION_LIST_REL_PATH.to_string(),
            rows: None,
            next_row_seq: 0,
            saved_text: None,
        },
    );
    tables.insert(
        "faction-index".to_string(),
        SessionCsvTable {
            row_index: None,
            header: Vec::new(),
            path: "data/world/factions/factions.csv".into(),
            rows: None,
            next_row_seq: 0,
            saved_text: None,
        },
    );
    tables
}

pub(super) fn new_session_id() -> String {
    static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("session-{sequence:020}")
}

pub(super) fn load_spec_bundle(
    sources: &mut super::sources::SourceReader,
    starsector_root: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<SpecBundle> {
    let total_timer = trace.timer();
    let timer = trace.timer();
    let ship_files = sources::documents::load_spec_records_from(
        sources,
        "data/hulls",
        "ship",
        "hullId",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage("spec.ship_files", timer, || {
        vec![("files", ship_files.len().to_string())]
    });
    let timer = trace.timer();
    let weapon_specs = sources::documents::load_spec_records_from(
        sources,
        "data/weapons",
        "wpn",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage("spec.weapon_specs", timer, || {
        vec![("files", weapon_specs.len().to_string())]
    });
    let timer = trace.timer();
    let (variant_files, variant_warnings) = load_variant_files_from(sources)?;
    trace.record_stage("spec.variant_files", timer, || {
        vec![
            ("files", variant_files.len().to_string()),
            ("warnings", variant_warnings.len().to_string()),
        ]
    });
    let timer = trace.timer();
    let (skin_files, skin_warnings) = load_skin_files_from(sources)?;
    trace.record_stage("spec.skin_files", timer, || {
        vec![
            ("files", skin_files.len().to_string()),
            ("warnings", skin_warnings.len().to_string()),
        ]
    });
    let timer = trace.timer();
    let core_projectiles = starsector_root
        .map(|root| {
            crate::services::project::sources::core::load_core_projectile_specs(
                &root.to_string_lossy(),
            )
        })
        .transpose()?;
    let projectile_specs =
        projectiles::load_projectile_specs_from(sources, core_projectiles.as_deref())?;
    trace.record_stage("spec.projectile_specs", timer, || {
        vec![("files", projectile_specs.len().to_string())]
    });
    let timer = trace.timer();
    let system_files = sources::documents::load_spec_records_from(
        sources,
        "data/shipsystems",
        "system",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage("spec.system_files", timer, || {
        vec![("files", system_files.len().to_string())]
    });
    let timer = trace.timer();
    let skill_files = sources::documents::load_spec_records_from(
        sources,
        "data/characters/skills",
        "skill",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage("spec.skill_files", timer, || {
        vec![("files", skill_files.len().to_string())]
    });
    let bundle = SpecBundle {
        ship_files,
        variant_files,
        skin_files,
        weapon_specs,
        projectile_specs,
        system_files,
        skill_files,
        variant_warnings,
        skin_warnings,
    };
    trace.record_stage("spec_bundle", total_timer, || {
        vec![
            ("shipFiles", bundle.ship_files.len().to_string()),
            ("weaponSpecs", bundle.weapon_specs.len().to_string()),
            ("projectileSpecs", bundle.projectile_specs.len().to_string()),
            ("systemFiles", bundle.system_files.len().to_string()),
            ("skillFiles", bundle.skill_files.len().to_string()),
            ("variantFiles", bundle.variant_files.len().to_string()),
            ("skinFiles", bundle.skin_files.len().to_string()),
        ]
    });
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;

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
            close_project_session(manifest.session_id.clone()).unwrap();
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
        std::fs::create_dir_all(root.join("data/variants")).unwrap();
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
        std::fs::create_dir_all(root.join("data/missions")).unwrap();
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

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("does not own mod root"));
        right.close().unwrap();
        left.close().unwrap();
    }

    #[test]
    fn open_project_session_manifest_summaries_only_include_public_csv_tables() {
        let root = project_workspace("manifest_public_csv_tables");
        std::fs::create_dir_all(root.join("data/missions")).unwrap();
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
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
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

        assert_eq!(
            loaded.table_entity_summaries[&crate::models::CsvTableKey::Wings],
            2
        );
        assert_eq!(
            loaded.table_entity_summaries[&crate::models::CsvTableKey::SimOpponents],
            2
        );
        assert_eq!(
            loaded.table_summaries[&crate::models::CsvTableKey::Wings].total_rows,
            None
        );
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_variant_id() {
        let root = project_workspace("variant_duplicate_id");
        std::fs::create_dir_all(root.join("data/variants/a")).unwrap();
        std::fs::create_dir_all(root.join("data/variants/b")).unwrap();
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
        std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/bad.skin"),
            r#"{"skinHullId":"bad"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        assert_eq!(manifest.entity_summaries.skins, 1);
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_skin_hull_id() {
        let root = project_workspace("skin_duplicate_id");
        std::fs::create_dir_all(root.join("data/hulls/skins/a")).unwrap();
        std::fs::create_dir_all(root.join("data/hulls/skins/b")).unwrap();
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
        if crate::test_support::isolated_test() {
            return;
        }
        use super::sources::json_documents::take_load_counts;
        let root = project_workspace("persistent_project_index");
        std::fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"before","hullId":"hull"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/variants/duplicate.variant"),
            r#"{"variantId":"before","hullId":"hull"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        for name in ["first", "second"] {
            std::fs::write(
                root.join(format!("data/hulls/skins/{name}.skin")),
                r#"{"skinHullId":"skin","baseHullId":"hull"}"#,
            )
            .unwrap();
        }
        super::super::sources::configure_persistent_index_cache(&root.outer().join("cache"))
            .unwrap();

        let mut initial_trace = PerformanceTrace::new("project.openSession");
        take_load_counts();
        let _ = build_project_session(&root, None, &mut initial_trace).unwrap();
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
        use crate::models::{CsvRowPatch, CsvRowPatchAction, CsvSearchField, CsvTableKey};

        use crate::services::project::query::csv_window::query_csv_table_window;
        use crate::services::project::write::csv_patch::save_csv_patch;
        use serde_json::{Map, Value};
        use std::sync::{Arc, Barrier};

        const THREADS: usize = 4;
        const ROUNDS: usize = 4;
        const SESSIONS: usize = 2;
        const WRITES_PER_SESSION: usize = THREADS * ROUNDS / SESSIONS;

        let roots: Vec<_> = (0..SESSIONS)
            .map(|index| {
                let root = project_workspace(&format!("session_concurrency_{index}"));
                std::fs::create_dir_all(root.join("data/hulls")).unwrap();
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
            handles.push(std::thread::spawn(move || {
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
                            is_comment: false,
                            insert_at: None,
                            row_key: format!("ships:new:{thread_index}-{round}"),
                            action: CsvRowPatchAction::Upsert,
                            row,
                        }],
                        Vec::new(),
                    )
                    .unwrap();
                    invalidate_project_session(&session_id, Vec::new()).unwrap();
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
            close_project_session(session_id.clone()).unwrap();
            roots[session_index].clone().close().unwrap();
        }
    }
}

/// Refreshes authorized sources while retaining session and CSV row identities.
pub fn refresh_project_sources(
    session_id: &str,
    sources: Vec<crate::models::InvalidatedResourceScope>,
) -> AppResult<ProjectSessionInvalidationResult> {
    let handle = session_handle(session_id)?;
    let root = lock_ready_session(&handle)?.manifest.mod_root.clone();
    let _lease = crate::io::acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_ready_session(&handle)?;
    let invalidation = super::invalidation::refresh_sources(&mut session, &sources)?;
    Ok(ProjectSessionInvalidationResult {
        manifest: session.manifest.clone(),
        invalidation,
    })
}

#[cfg(test)]
mod source_refresh_tests {
    use super::*;
    use crate::models::{CsvTableKey, InvalidatedResourceScope, ResourceSource};
    #[test]
    fn missing_unloaded_csv_reports_its_unavailable_recovery_source() {
        let root = project_workspace("missing_unloaded_csv");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        let original = "id,name\na,Original\nb,Other\n";
        std::fs::write(&path, original).unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("missing.unloaded"),
        )
        .unwrap();
        invalidate_project_session(
            &manifest.session_id,
            vec![crate::io::build_text_change(&path, Some(original.into())).unwrap()],
        )
        .unwrap();
        std::fs::remove_file(&path).unwrap();
        let error = crate::services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            crate::models::CsvSearchField::IdName,
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
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
    #[test]
    fn removed_project_root_releases_session_history_and_registration() {
        let root = project_workspace("release_removed_project");
        std::fs::write(root.join("notes.txt"), "before").unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("release.removed"))
                .unwrap();
        let transaction = crate::services::write_transactions::begin(
            &crate::models::TextSave {
                json_write: Default::default(),
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: root.join("notes.txt").to_string_lossy().into(),
                text: "after".into(),
                base_versions: vec![],
            },
            &[],
        )
        .unwrap();
        let result = crate::services::file_editor::save_text_file(
            &manifest.mod_root,
            &root.join("notes.txt").to_string_lossy(),
            "after".into(),
        )
        .unwrap();
        let saved = transaction.commit(result, "saved").unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        crate::services::project_session::release_project_session(manifest.session_id.clone())
            .unwrap();
        assert!(
            !registered_session_ids()
                .unwrap()
                .contains(&manifest.session_id)
        );
        assert!(
            crate::services::file_history::query(&manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        assert_eq!(
            crate::services::query_entity_list(
                &manifest.session_id,
                crate::models::EntityKind::Ship
            )
            .unwrap_err()
            .code(),
            "session.unknown"
        );
        root.close().unwrap();
    }
    #[test]
    fn refresh_keeps_rows_and_rejects_escape() {
        let root = project_workspace("source_refresh");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        crate::io::write_utf8_no_bom(&csv, "id,name\nship,Before\n").unwrap();
        crate::io::write_utf8_no_bom(&root.join("data/hulls/ship.ship"), r#"{"hullId":"ship"}"#)
            .unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("test")).unwrap();
        let handle = session_handle(&manifest.session_id).unwrap();
        cache::ensure_registered_table_rows(
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
        crate::io::write_utf8_no_bom(&csv, "id,name\nship,After\nadded,New\n").unwrap();
        let source = InvalidatedResourceScope {
            source: ResourceSource::Mod,
            rel_path: "data/hulls".into(),
        };
        crate::io::write_utf8_no_bom(&root.join("data/hulls/added.ship"), r#"{"hullId":"added"}"#)
            .unwrap();
        refresh_project_sources(&manifest.session_id, vec![source]).unwrap();
        let added = crate::services::query_entity_edit_target(
            &manifest.session_id,
            crate::models::EntityKind::Ship,
            "added",
        )
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
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
