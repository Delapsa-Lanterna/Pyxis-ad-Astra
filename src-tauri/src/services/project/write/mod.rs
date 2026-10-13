mod csv_patch;
mod entity_description;
mod entity_identity;
#[cfg(test)]
mod ship_description_tests;
mod variant_identity;
#[cfg(test)]
mod weapon_description_tests;
pub(in crate::services::project) use entity_identity::stage_entity_content;
mod faction_identity;
pub use entity_identity::save_entity_spec;
pub use entity_identity::save_entity_text;
pub use entity_identity::save_variant_entity;
pub use faction_identity::{delete_faction_entity, save_faction_entity};

#[cfg(test)]
pub use csv_patch::save_csv_patch;
pub use csv_patch::save_csv_patch_snapshot;
pub(in crate::services::project) mod joint_edit;
