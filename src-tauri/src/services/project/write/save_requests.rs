use crate::{
    errors::AppError,
    models::{JointEditQuery, JointEditSubmission},
};

pub fn prepare_json_save(
    session_id: &str,
    kind: crate::models::EntityKind,
    source_id: &str,
    edits: &[crate::models::SaveEdit],
    identities: &[crate::models::EntityIdentityChange],
) -> Result<crate::models::EntityData, AppError> {
    let mut id = source_id.to_string();
    for identity in identities {
        if identity.before.kind == kind && identity.before.id == id {
            id = identity.after.id.clone();
        }
    }
    let mut current = crate::services::query_entity(session_id, kind, &id)?
        .ok_or_else(|| AppError::message("write.target_removed", "保存目标已删除"))?;
    if kind == crate::models::EntityKind::Faction {
        current.data = serde_json::json!({"file": current.data});
    }
    crate::domain::save_edits::apply_save_edits(&mut current.data, edits);
    Ok(current)
}

pub fn prepare_joint_save(
    payload: &mut JointEditSubmission,
    edits: &[crate::models::SaveEdit],
    identities: &[crate::models::EntityIdentityChange],
) -> Result<(), AppError> {
    use crate::models::{JointValue, SaveEdit};
    for identity in identities {
        if identity.before.id == payload.snapshot.root.id
            && matches!(
                (payload.snapshot.root.kind, identity.before.kind),
                (
                    crate::models::JointEditKind::Ship,
                    crate::models::EntityKind::Ship
                ) | (
                    crate::models::JointEditKind::Skin,
                    crate::models::EntityKind::Skin
                ) | (
                    crate::models::JointEditKind::Weapon,
                    crate::models::EntityKind::Weapon
                ) | (
                    crate::models::JointEditKind::Variant,
                    crate::models::EntityKind::Variant
                )
            )
        {
            payload.snapshot.root.id = identity.after.id.clone();
        }
    }
    let retained = super::super::query::joint_edit::retained_joint_sources(&payload.snapshot)?;
    let current = crate::services::query_joint_edit_request(&JointEditQuery {
        root: payload.snapshot.root.clone(),
        row_key: None,
        values: Some(retained),
        new_sources: payload.snapshot.new_sources.clone(),
        catalog: None,
        catalog_source: None,
    })?;
    let resolve_key = |key: &String| -> Result<String, AppError> {
        use crate::models::{EntityLinkedRecord, JointRecordTarget};
        let mut target = payload
            .snapshot
            .records
            .iter()
            .find(|record| record.key == *key)
            .expect("captured changes belong to the submitted snapshot")
            .target
            .clone();
        for identity in identities {
            match &mut target {
                JointRecordTarget::Spec { target }
                    if target.kind == identity.before.kind && target.id == identity.before.id =>
                {
                    *target = identity.after.clone()
                }
                JointRecordTarget::Csv { table, row_key, .. } => {
                    if let (
                        Some(EntityLinkedRecord::Csv {
                            table: before,
                            row_key: previous,
                        }),
                        Some(EntityLinkedRecord::Csv {
                            table: after,
                            row_key: next,
                        }),
                    ) = (
                        &identity.before.linked_record,
                        &identity.after.linked_record,
                    ) && *table == *before
                        && *row_key == *previous
                    {
                        *table = *after;
                        *row_key = next.clone();
                    }
                }
                JointRecordTarget::Text { write } if write.path == identity.before.write.path => {
                    *write = identity.after.write.clone()
                }
                _ => {}
            }
        }
        current
            .records
            .iter()
            .find(|record| match (&target, &record.target) {
                (
                    JointRecordTarget::Spec { target: old },
                    JointRecordTarget::Spec { target: next },
                ) => old.kind == next.kind && old.id == next.id,
                (
                    JointRecordTarget::Csv {
                        table: old,
                        row_key: previous,
                        ..
                    },
                    JointRecordTarget::Csv {
                        table: next,
                        row_key,
                        ..
                    },
                ) => old == next && previous == row_key,
                (
                    JointRecordTarget::Text { write: old },
                    JointRecordTarget::Text { write: next },
                ) => old == next,
                _ => false,
            })
            .map(|record| record.key.clone())
            .ok_or_else(|| {
                AppError::message(
                    "joint.target_changed",
                    format!("保存来源已删除或替换: {key}"),
                )
            })
    };
    let mut values = std::collections::BTreeMap::new();
    let overrides = payload
        .create_overrides
        .iter()
        .map(|key| {
            let next = resolve_key(key)?;
            values.insert(next.clone(), serde_json::to_value(&payload.values[key])?);
            Ok(next)
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let keys = edits
        .iter()
        .map(|edit| match edit {
            SaveEdit::Set { path, .. } | SaveEdit::Remove { path } => path
                .first()
                .expect("joint edits identify their source record"),
        })
        .collect::<std::collections::BTreeSet<_>>();
    for previous in keys {
        let key = resolve_key(previous)?;
        let record = current
            .records
            .iter()
            .find(|record| record.key == key)
            .expect("resolved source belongs to the current graph");
        let value = values
            .entry(key)
            .or_insert(serde_json::to_value(&record.value)?);
        crate::domain::save_edits::apply_save_edits_at(
            value,
            edits,
            std::slice::from_ref(previous),
        );
    }
    payload.values = values
        .into_iter()
        .map(|(key, value)| serde_json::from_value::<JointValue>(value).map(|value| (key, value)))
        .collect::<Result<_, _>>()?;
    payload.create_overrides = overrides;
    let mut versions = current.base_versions.clone();
    for version in &payload.base_versions {
        if !versions
            .iter()
            .any(|current| current.path.eq_ignore_ascii_case(&version.path))
        {
            versions.push(version.clone());
        }
    }
    payload.base_versions = versions;
    payload.snapshot = current;
    Ok(())
}
