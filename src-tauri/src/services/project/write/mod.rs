pub(in crate::services) mod csv_patch;
mod csv_staging;
mod entity_description;
pub(in crate::services) mod entity_identity;
#[cfg(test)]
mod ship_description_tests;
mod variant_identity;
#[cfg(test)]
mod weapon_description_tests;
pub(in crate::services::project) use entity_identity::stage_entity_content;
pub(in crate::services) mod faction_identity;

pub(in crate::services) mod joint_edit;

pub(in crate::services) mod json_recovery;

#[cfg(test)]
mod json_recovery_tests;

#[cfg(test)]
mod csv_first_save_tests;
