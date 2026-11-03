use super::{HullReferenceResolver, resource_ref};
use crate::errors::AppResult;
use crate::models::{
    CsvTableKey, EntityKind, ResourceOwnerKind, ResourceRef, ResourceSource, VariantFile,
};
use crate::services::project::model::{
    ProjectSession, csv_table_spec, string_field, string_from_row, weapon_sprite_path,
};
use crate::services::project::sources::core::{CoreSourceData, load_core_variant_files};
use serde_json::{Map, Value};

pub(in crate::services::project) fn csv_row_resource_ref(
    session: &ProjectSession,
    table: CsvTableKey,
    row: &Map<String, Value>,
) -> Option<ResourceRef> {
    let source = ResourceSource::Mod;
    let result = match table {
        CsvTableKey::Ships => ship_row_resource(session, source, table, row),
        CsvTableKey::Weapons => weapon_row_resource(session, source, table, row),
        CsvTableKey::Wings => wing_row_resource(session, source, table, row),
        CsvTableKey::SimOpponents => sim_opponent_row_resource(session, source, table, row),
        CsvTableKey::Descriptions => Ok(None),
        _ => Ok(csv_icon_resource_ref(source, table, row)),
    };
    result.ok().flatten()
}

pub(in crate::services::project) fn csv_source_resource_ref(
    source: ResourceSource,
    table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    match table {
        CsvTableKey::Ships => ship_source_resource(source, table, value, row, core_data, session),
        CsvTableKey::Weapons => {
            weapon_source_resource(source, table, value, row, core_data, session)
        }
        CsvTableKey::Wings => wing_source_resource(source, table, value, row, core_data, session),
        CsvTableKey::SimOpponents | CsvTableKey::Descriptions => Ok(None),
        _ => Ok(csv_icon_resource_ref(source, table, row)),
    }
}

pub(in crate::services::project) fn csv_source_display_name(
    source: ResourceSource,
    table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    match table {
        CsvTableKey::Ships => {
            ship_source_display_name(source, table, value, row, core_data, session)
        }
        CsvTableKey::Wings => {
            wing_source_display_name(source, table, value, row, core_data, session)
        }
        _ => Ok(None),
    }
}

pub(in crate::services::project) fn csv_icon_resource_ref(
    source: ResourceSource,
    table: CsvTableKey,
    row: &Map<String, Value>,
) -> Option<ResourceRef> {
    let (owner, field) = match table {
        CsvTableKey::Hullmods => (ResourceOwnerKind::Hullmods, "sprite"),
        CsvTableKey::ShipSystems => (ResourceOwnerKind::ShipSystems, "icon"),
        CsvTableKey::Industries => (ResourceOwnerKind::Industries, "image"),
        CsvTableKey::Skills => (ResourceOwnerKind::Skills, "icon"),
        CsvTableKey::Abilities => (ResourceOwnerKind::Abilities, "icon"),
        CsvTableKey::Commodities => (ResourceOwnerKind::Commodities, "icon"),
        CsvTableKey::SpecialItems => (ResourceOwnerKind::SpecialItems, "icon"),
        CsvTableKey::Submarkets => (ResourceOwnerKind::Submarkets, "icon"),
        CsvTableKey::MarketConditions => (ResourceOwnerKind::MarketConditions, "icon"),
        CsvTableKey::Ships
        | CsvTableKey::Weapons
        | CsvTableKey::Wings
        | CsvTableKey::SimOpponents
        | CsvTableKey::Descriptions => return None,
    };
    let id = string_from_row(row, csv_table_spec(table).entity_id_field)?;
    let rel_path = string_from_row(row, field).or_else(|| {
        matches!(table, CsvTableKey::Hullmods).then(|| "graphics/hullmods/generic_mod.png".into())
    })?;
    Some(resource_ref(source, &rel_path, owner, &id, "icon"))
}

fn ship_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(id) = string_from_row(row, "id") else {
        return Ok(None);
    };
    HullReferenceResolver::new(session).resource(source, &id)
}

fn weapon_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(id) = string_from_row(row, "id") else {
        return Ok(None);
    };
    Ok(session
        .weapon_specs
        .get(&id)
        .and_then(|record| weapon_sprite_path(&record.data))
        .map(|path| resource_ref(source, &path, ResourceOwnerKind::Weapon, &id, "sprite")))
}

fn wing_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    let Some(variant) = session
        .variant_files
        .iter()
        .find(|variant| variant.variant_id == variant_id)
    else {
        return Ok(None);
    };
    HullReferenceResolver::new(session).resource(source, &variant.hull_id)
}

fn sim_opponent_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(variant_id) = string_from_row(row, "variant id") else {
        return Ok(None);
    };
    let hull_id = if let Some(variant) = session
        .variant_files
        .iter()
        .find(|variant| variant.variant_id == variant_id)
    {
        Some(variant.hull_id.clone())
    } else {
        let Some(root) = session.manifest.starsector_root.as_deref() else {
            return Ok(None);
        };
        load_core_variant_files(root)?
            .iter()
            .find(|variant| variant.variant_id == variant_id)
            .map(|variant| variant.hull_id.clone())
    };
    let Some(hull_id) = hull_id else {
        return Ok(None);
    };
    HullReferenceResolver::new(session).resource(source, &hull_id)
}

fn ship_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    _row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    if let Some(resource) = HullReferenceResolver::new(session).resource(source, value)? {
        return Ok(Some(resource));
    }
    Ok(core_data
        .and_then(|core_data| {
            core_data
                .ship_files
                .get(value)
                .and_then(|ship| string_field(&ship.data, "spriteName"))
        })
        .map(|path| resource_ref(source, &path, ResourceOwnerKind::Ship, value, "sprite")))
}

fn ship_source_display_name(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    _core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    if let Some(name) = string_from_row(row, "name") {
        return Ok(Some(name));
    }
    Ok(HullReferenceResolver::new(session)
        .field(source, value, "hullName")?
        .map(|(name, _, _)| name))
}

fn weapon_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    _row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    let record = match source {
        ResourceSource::Reference => session.reference_spec(EntityKind::Weapon, value),
        ResourceSource::Core => core_data
            .and_then(|data| data.weapon_specs.get(value))
            .cloned(),
        ResourceSource::Mod => session
            .weapon_specs
            .get(value)
            .filter(|record| record.location.source == ResourceSource::Mod)
            .cloned()
            .or_else(|| session.reference_spec(EntityKind::Weapon, value))
            .or_else(|| session.weapon_specs.get(value).cloned())
            .or_else(|| {
                core_data
                    .and_then(|data| data.weapon_specs.get(value))
                    .cloned()
            }),
    };
    Ok(record.and_then(|record| {
        weapon_sprite_path(&record.data).map(|path| {
            let mut resource = resource_ref(
                record.location.source,
                &path,
                ResourceOwnerKind::Weapon,
                value,
                "sprite",
            );
            resource.reference = record.location.reference.as_deref().cloned();
            resource
        })
    }))
}

fn wing_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    match source_variant(source, &variant_id, core_data, session) {
        Some(variant) => HullReferenceResolver::new(session).resource(source, &variant.hull_id),
        None => Ok(None),
    }
}

fn wing_source_display_name(
    source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    Ok(source_variant(source, &variant_id, core_data, session)
        .and_then(|variant| string_field(&variant.data, "displayName")))
}

fn source_variant<'a>(
    source: ResourceSource,
    variant_id: &str,
    core_data: Option<&'a CoreSourceData>,
    session: &'a ProjectSession,
) -> Option<&'a VariantFile> {
    match source {
        ResourceSource::Reference => session
            .references
            .iter()
            .flat_map(|view| view.session.variant_files.iter())
            .find(|variant| variant.variant_id == variant_id),
        ResourceSource::Core => core_data.and_then(|data| {
            data.variant_files
                .iter()
                .find(|variant| variant.variant_id == variant_id)
        }),
        ResourceSource::Mod => session
            .variant_files
            .iter()
            .chain(
                session
                    .references
                    .iter()
                    .flat_map(|view| view.session.variant_files.iter()),
            )
            .chain(
                core_data
                    .into_iter()
                    .flat_map(|data| data.variant_files.iter()),
            )
            .find(|variant| variant.variant_id == variant_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn row_icon_resource_ref_requires_owner_id() {
        let mut row = Map::new();
        row.insert(
            "icon".to_string(),
            Value::String("graphics/icons/skill.png".to_string()),
        );

        let resource = csv_icon_resource_ref(ResourceSource::Mod, CsvTableKey::Skills, &row);

        assert!(resource.is_none());
    }
}
